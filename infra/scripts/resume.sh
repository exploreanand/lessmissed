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
cd "$(dirname "$0")/../terraform"

terraform apply -var paused=false

echo
echo "Smoke tests (a new ALB needs a minute or two to pass health checks):"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://${ROOT_DOMAIN:-lessmissed.com}/api/health   # 200"
