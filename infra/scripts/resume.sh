#!/usr/bin/env bash
# Bring the stack back up. See docs/PAUSE.md.
#
# Resume needs no special ordering: nothing is being destroyed, and the
# dependency edge in cloudfront.tf (one(aws_wafv2_web_acl.app[*].arn)) makes
# Terraform create and attach the ACL in the right order.
#
# The images deployed are web_image_tag / capture_image_tag from
# terraform.tfvars — make sure they are current before running this.
set -euo pipefail

export AWS_PROFILE="${AWS_PROFILE:-lessmissed}"
ROOT_DOMAIN="${ROOT_DOMAIN:-lessmissed.com}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../terraform"
# shellcheck source=_paused_state.sh
source "$SCRIPT_DIR/_paused_state.sh"

set_paused false

terraform apply -var paused=false

echo
echo "Smoke tests (a new ALB needs a minute or two to pass health checks):"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://${ROOT_DOMAIN}/api/health   # expect 200"
echo
echo "  # tag ingest reachable through CloudFront + WAF (401 = app reached, key rejected;"
echo "  # 403 means WAF is blocking the body again):"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' -X POST https://${ROOT_DOMAIN}/api/tag/events \\"
echo "    -H 'Origin: https://example.com' -H 'Content-Type: application/json' \\"
echo "    -H 'X-Lessmissed-Key: pk_00000000000000000000000000000000' \\"
echo "    --data '{\"session_id\":\"x\",\"events\":[{\"type\":\"click\",\"page_url\":\"/\",\"timestamp\":1}]}'"
