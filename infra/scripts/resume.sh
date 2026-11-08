#!/usr/bin/env bash
# Bring the stack back up. See docs/PAUSE.md.
#
# Resume needs no special ordering: nothing is being destroyed, and the
# dependency edge in cloudfront.tf (one(aws_wafv2_web_acl.app[*].arn)) makes
# Terraform create and attach the ACL in the right order.
#
# The images deployed are web_image_tag / capture_image_tag from
# terraform.tfvars. This script compares them against the newest task
# definition first and warns if resuming would roll a service back, then
# polls /api/health and the tag ingest path after the apply, so a clean
# exit means the stack is actually serving — not merely that Terraform ran.
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-lessmissed}"
ROOT_DOMAIN="${ROOT_DOMAIN:-lessmissed.com}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../terraform"
# shellcheck source=_lib.sh
source "$SCRIPT_DIR/_lib.sh"

require_creds

echo "Image tags a resume would deploy:"
warn_on_stale_image_tags
echo

# The -var below overrides tfvars, so the apply is correct either way. The
# tfvars write happens only AFTER a successful apply, deliberately: if you
# answer "no" at the prompt, or the apply fails part way, the file keeps saying
# paused = true. Every failure path then leaves the sticky state biased toward
# paused, which is the direction that cannot quietly cost money. (pause.sh is
# biased the same way, by writing before its apply.)
terraform apply -var paused=false

set_paused false

echo
echo "=== Smoke tests ==="
rc=0
wait_for_health || rc=1
if (( rc == 0 )); then
  check_tag_ingest || rc=1
fi

echo
if (( rc == 0 )); then
  echo "Resume complete and verified. ${ROOT_DOMAIN} is serving."
else
  echo "Resume applied, but the smoke tests did not pass. See the notes above." >&2
fi
exit $rc
