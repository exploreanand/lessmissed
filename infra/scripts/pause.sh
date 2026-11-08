#!/usr/bin/env bash
# Pause the AWS stack to stop hourly charges. See docs/PAUSE.md.
#
# Why this is a script and not just `terraform apply -var paused=true`:
# Terraform only guarantees that *dependents* are destroyed before their
# dependencies. Here the CloudFront distribution is merely UPDATED (dropping
# web_acl_id) while the WAF ACL is DESTROYED, and Terraform runs those two in
# parallel — so DeleteWebACL fires while the distribution still references the
# ACL and AWS rejects it with WAFAssociatedItemException.
#
# `-target=aws_cloudfront_distribution.app` does not help: -target pulls in the
# target's dependencies, which schedules the very same WAF destroy.
#
# So: detach via the CloudFront API, wait for it to propagate, then let
# Terraform destroy everything. The detach is not drift — it is exactly the
# state Terraform wants while paused, so the apply reports 0 changed for it.
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-lessmissed}"
ROOT_DOMAIN="${ROOT_DOMAIN:-lessmissed.com}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../terraform"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

require_creds

DIST=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?contains(Aliases.Items, '${ROOT_DOMAIN}')].Id | [0]" \
  --output text)
if [[ -z "$DIST" || "$DIST" == "None" ]]; then
  echo "No CloudFront distribution found for ${ROOT_DOMAIN}; nothing to detach." >&2
  DIST=""
fi

if [[ -n "$DIST" ]]; then
  CURRENT=$(aws cloudfront get-distribution --id "$DIST" \
    --query 'Distribution.DistributionConfig.WebACLId' --output text)
  if [[ -n "$CURRENT" && "$CURRENT" != "None" ]]; then
    echo "Detaching WAF from CloudFront $DIST ..."
    TMP=$(mktemp -d)
    trap 'rm -rf "$TMP"' EXIT
    aws cloudfront get-distribution-config --id "$DIST" > "$TMP/full.json"
    python3 - "$TMP" <<'PY'
import json, sys
t = sys.argv[1]
d = json.load(open(f"{t}/full.json"))
cfg = d["DistributionConfig"]
cfg["WebACLId"] = ""
json.dump(cfg, open(f"{t}/cfg.json", "w"))
open(f"{t}/etag", "w").write(d["ETag"])
PY
    aws cloudfront update-distribution --id "$DIST" \
      --distribution-config "file://$TMP/cfg.json" \
      --if-match "$(cat "$TMP/etag")" >/dev/null
    echo "Waiting for CloudFront to redeploy (5-15 min; do not interrupt) ..."
    aws cloudfront wait distribution-deployed --id "$DIST"
    echo "Detached."
  else
    echo "WAF already detached from CloudFront."
  fi
fi

set_paused true

echo "Applying paused=true ..."
terraform apply -var paused=true
