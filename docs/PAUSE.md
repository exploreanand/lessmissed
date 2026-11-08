# Pausing AWS between work sessions

LessMissed only needs to be online while a feature is being built or a demo is
being given. `terraform apply -var paused=true` tears down the pieces that bill
by the hour whether or not anyone visits, and keeps everything whose loss would
cost you setup time.

Running costs roughly **$105/month**; paused it is roughly **$2–3/month**.

## Pause

`providers.tf` sets no profile, so Terraform reads the environment — without
`AWS_PROFILE` it fails with "No valid credential sources found". Log in first
(`aws sso login --profile lessmissed`), then:

```bash
cd infra/terraform
export AWS_PROFILE=lessmissed
terraform plan  -var paused=true     # read the plan first
terraform apply -var paused=true
```

That destroys:

| Resource | Why |
|---|---|
| ALB + target group + listener + rule | ~$24/mo: hourly charge plus one public IPv4 per AZ |
| WAF web ACL `lessmissed-app` | ~$10/mo: $5 per ACL + $1 per rule × 5 |
| Route 53 health check + `app-health` alarm | ~$0.75/mo, and it would email you every minute while down |
| `alb-5xx` / `alb-unhealthy-hosts` alarms | They alarm on a load balancer that no longer exists |
| Both ECS services + autoscaling target + `web-cpu` / `capture-down` alarms | ~$68/mo of Fargate; `capture-down` treats missing data as breaching |
| `origin.lessmissed.com` A record | Points at the ALB |

It deliberately keeps:

- **Route 53 hosted zone** — deleting it changes your nameservers and forces
  the whole GoDaddy delegation to be redone. Never delete it.
- **CloudFront** — traffic-priced, so ~$0 while idle. Keeping it avoids ~20
  minutes of disable-then-delete now and ~20 minutes of creation on resume.
  `lessmissed.com` keeps resolving and returns a CloudFront error page while
  paused, because its origin no longer exists. That is expected.
- **ACM certificates** — free, and keeping them skips re-validation.
- **ECR images** (~$0.34/mo) — resume needs no rebuild, which matters most for
  the ~2.75 GB Playwright capture image.
- **Secrets Manager** (~$1.20/mo) — no re-entering the Mongo URI or S3 key.
- VPC, subnets, security groups (no NAT, so free), ECS cluster, task
  definitions, log groups, IAM roles, SNS, budget, tfstate bucket.

MongoDB Atlas is the free M0 tier, so it costs nothing and keeps your data. It
auto-sleeps after ~60 days idle and wakes on the next connection.

## Resume

```bash
cd infra/terraform
export AWS_PROFILE=lessmissed
terraform apply -var paused=false
```

This recreates the ALB, WAF, health check, alarms and the `origin` record, and
re-attaches the WAF to CloudFront. Because `create_services = true` is already
in `terraform.tfvars`, it also brings both ECS services back on the image tags
pinned there.

Then confirm the stack is actually serving:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://lessmissed.com/api/health
# expect 200

curl -s -o /dev/null -w '%{http_code}\n' -X POST https://lessmissed.com/api/tag/events \
  -H 'Origin: https://example.com' -H 'Content-Type: application/json' \
  -H 'X-Lessmissed-Key: pk_00000000000000000000000000000000' \
  --data '{"session_id":"x","events":[{"type":"click","page_url":"/","timestamp":1}]}'
# expect 401 — the app was reached and rejected the fake key
```

A new ALB takes a minute or two to pass health checks, so a 502/503 right after
the apply is normal. CloudFront caches `/tag/v1/lm.js` for 5 minutes; if you
changed the tag, invalidate it:

```bash
aws cloudfront create-invalidation --distribution-id E19SHXYWD3PBC5 \
  --paths '/tag/v1/lm.js' --profile lessmissed
```

## Keep the image tags current

`web_image_tag` and `capture_image_tag` in `terraform.tfvars` are what a resume
deploys. They are separate because the two services roll out independently and
are normally on different commits — a single shared tag would silently roll one
of them back. After any rollout, update them. The live task definition is the
source of truth:

```bash
for s in web capture; do
  printf '%s: ' "$s"
  aws ecs describe-task-definition --task-definition lessmissed-$s \
    --profile lessmissed --region ap-south-1 \
    --query 'taskDefinition.containerDefinitions[0].image' --output text | sed 's/.*://'
done
```

## Before the first pause: check for a CloudFront plan

CloudFront flat-rate plans (e.g. Pro, ~$15/mo) bill regardless of traffic and
are a console-level subscription with no reliable CLI. Open the CloudFront
console → pricing/plans and cancel any active plan, otherwise it keeps charging
while everything else is paused. Note that a flat-rate plan requires a WAF ACL
per distribution (see the comment at the top of `waf.tf`), so cancelling the
plan is also what makes it safe for `paused=true` to remove the ACL.

## Where the bill actually lands

This is member account `061953574559` inside an Organization, so charges
consolidate into the management account `548185496740`. Cost Explorer in the
member account reports ~$0; check the management account for the real invoice
and for any credits.

## Verifying a pause took effect

```bash
aws ecs describe-services --cluster lessmissed \
  --services lessmissed-web lessmissed-capture \
  --profile lessmissed --region ap-south-1 --query 'services[].status'   # [] or INACTIVE
aws elbv2 describe-load-balancers --profile lessmissed --region ap-south-1 \
  --query 'LoadBalancers[].LoadBalancerName'                            # []
aws wafv2 list-web-acls --scope CLOUDFRONT --profile lessmissed \
  --region us-east-1 --query 'WebACLs[].Name'                           # []
aws route53 list-health-checks --profile lessmissed --query 'HealthChecks[].Id'  # []
aws route53 list-hosted-zones --profile lessmissed --query 'HostedZones[].Name'  # still lessmissed.com.
```

No alarm emails should arrive in the hour after pausing. A day later, daily
spend in the management account should have collapsed.

## Expected plan noise

Both `paused=true` and `paused=false` plans show a few items that are not the
pause itself:

- **`aws_ecs_task_definition.{web,capture}` must be replaced** — the task
  definitions in state were built from the old shared `image_tag`; replacing
  them is what pins the correct per-service images. A task definition revision
  is free.
- **`aws_sns_topic_subscription.alarms_use1_email` will be created** — the
  us-east-1 alarm subscription is missing in AWS (SNS deletes unconfirmed
  subscriptions after 3 days). Applying sends a fresh confirmation email.
- **`aws_iam_role_policy.github_deploy` updated in-place** (pause only) — its
  resource list shrinks while the ECS services do not exist, and it comes back
  on resume.

What you should *not* see on `paused=false` is any destroy/recreate of the ALB,
WAF, alarms or services. If you do, state addresses have drifted and the plan
needs a closer look before applying.
