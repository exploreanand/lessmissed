#!/usr/bin/env bash
# Sourced by pause.sh / resume.sh. Not meant to be run directly.
#
# `var.paused` defaults to false, so if the paused state lived only in the
# -var flag, any later bare `terraform apply` (changing an alarm email, a WAF
# rule, anything) would silently recreate the ALB + WAF + health check and
# restart both services — billing back on with no one noticing. So the flag is
# also written into terraform.tfvars, which makes it the sticky desired state
# of this machine's stack. The -var on the apply line agrees with it; the grep
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
