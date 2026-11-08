#!/usr/bin/env bash
# Sourced by pause.sh / resume.sh. Not meant to be run directly.
# Callers must already have set AWS_PROFILE and cd'd into infra/terraform.

# SSO tokens expire after a few hours, and Terraform's own failure for this is
# the opaque "No valid credential sources found". Fail early with the fix.
require_creds() {
  if ! aws sts get-caller-identity >/dev/null 2>&1; then
    echo "AWS credentials for profile '${AWS_PROFILE}' are not valid." >&2
    echo "SSO tokens expire after a few hours. Run:" >&2
    echo "    aws sso login --profile ${AWS_PROFILE}" >&2
    exit 1
  fi
}

# `var.paused` defaults to false, so if the paused state lived only in the -var
# flag, any later bare `terraform apply` (changing an alarm email, a WAF rule,
# anything) would silently recreate the ALB + WAF + health check and restart
# both services — billing back on with no one noticing. So the flag is also
# written into terraform.tfvars, which makes it the sticky desired state of
# this machine's stack. The -var on the apply line agrees with it; the grep
# below fails the run loudly if the two could ever disagree.
set_paused() {
  local want="$1"
  python3 - "$want" <<'PY'
import os, re, sys

want = sys.argv[1]
path = "terraform.tfvars"
src = open(path).read() if os.path.exists(path) else ""
line = f"paused = {want}"

if re.search(r"(?m)^[ \t]*paused[ \t]*=", src):
    src = re.sub(r"(?m)^[ \t]*paused[ \t]*=.*$", line, src)
else:
    header = "\n# Cost pause - maintained by infra/scripts/{pause,resume}.sh.\n"
    src = src.rstrip("\n") + "\n" + header + line + "\n"

open(path, "w").write(src)
PY
  if ! grep -qE "^paused = ${want}\$" terraform.tfvars; then
    echo "FAILED to record 'paused = ${want}' in terraform.tfvars; aborting so" >&2
    echo "the file cannot disagree with the real state of the stack." >&2
    exit 1
  fi
  echo "Recorded 'paused = ${want}' in terraform.tfvars."
}

# Terraform owns the task definitions, so a resume starts each service on the
# image tag pinned in terraform.tfvars. Rollouts, though, are done by hand with
# the CLI — so if a rollout happened and tfvars was not updated, resuming would
# silently roll that service back to older code. Compare the two and say so.
warn_on_stale_image_tags() {
  local svc var_name pinned live drift=0
  for svc in web capture; do
    var_name="${svc}_image_tag"
    pinned=$(sed -nE "s/^${var_name}[ \t]*=[ \t]*\"([^\"]*)\".*/\1/p" terraform.tfvars | head -1)
    live=$(aws ecs describe-task-definition --task-definition "lessmissed-${svc}" \
      --query 'taskDefinition.containerDefinitions[0].image' --output text 2>/dev/null \
      | sed 's/.*://')
    if [[ -n "$pinned" && -n "$live" && "$pinned" != "$live" ]]; then
      echo "  ${svc}: tfvars pins '${pinned}' but the newest task definition runs '${live}'" >&2
      drift=1
    else
      echo "  ${svc}: ${pinned:-<unset>} (matches newest task definition)"
    fi
  done
  if (( drift )); then
    echo >&2
    echo "WARNING: resuming would deploy the tfvars tags above, rolling a service back." >&2
    echo "Fix terraform.tfvars first, or answer 'no' at the Terraform prompt." >&2
    echo >&2
  fi
}

# A new ALB needs a minute or two before its targets pass health checks, so an
# apply finishing is not the same as the site serving. Poll until it does.
wait_for_health() {
  local url="https://${ROOT_DOMAIN}/api/health" code i
  echo "Waiting for ${url} (a new ALB takes a minute or two) ..."
  for i in $(seq 1 40); do
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$url" || true)
    if [[ "$code" == "200" ]]; then
      echo "  health: 200 after ~$(( (i - 1) * 15 ))s"
      return 0
    fi
    printf '  attempt %2d/40: %s\n' "$i" "${code:-no response}"
    sleep 15
  done
  echo "  health never returned 200 after 10 minutes. Check:" >&2
  echo "    aws logs tail /ecs/lessmissed-web --since 10m --profile ${AWS_PROFILE}" >&2
  return 1
}

# 401 means the request crossed CloudFront and the WAF and reached the app,
# which then rejected the fake key. 403 means the WAF is blocking event bodies
# again — the /api/tag/* scope-down did not come back.
check_tag_ingest() {
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 \
    -X POST "https://${ROOT_DOMAIN}/api/tag/events" \
    -H 'Origin: https://example.com' -H 'Content-Type: application/json' \
    -H 'X-Lessmissed-Key: pk_00000000000000000000000000000000' \
    --data '{"session_id":"x","events":[{"type":"click","page_url":"/p?q=<script>alert(1)</script>","timestamp":1}]}' || true)
  case "$code" in
    401) echo "  tag ingest: 401 (reached the app, fake key rejected)"; return 0 ;;
    403) echo "  tag ingest: 403 — the WAF is blocking tag bodies again." >&2
         echo "  Check the /api/tag/* scope-down on the 'common' rule group in waf.tf." >&2
         return 1 ;;
    *)   echo "  tag ingest: ${code:-no response} (expected 401)" >&2; return 1 ;;
  esac
}
