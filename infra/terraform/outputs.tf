output "vpc_id" {
  value       = aws_vpc.main.id
  description = "Give this to Atlas when requesting VPC peering."
}

output "vpc_cidr" {
  value       = aws_vpc.main.cidr_block
  description = "Add to the Atlas IP access list."
}

output "aws_account_id" {
  value       = local.account_id
  description = "This account's id (for the peering request and cross-account trust)."
}

output "ecr_web_url" {
  value = aws_ecr_repository.repo["${local.name}-web"].repository_url
}

output "ecr_capture_url" {
  value = aws_ecr_repository.repo["${local.name}-capture"].repository_url
}

output "alb_dns_name" {
  value = aws_lb.app.dns_name
}

output "cloudfront_app_domain" {
  value       = aws_cloudfront_distribution.app.domain_name
  description = "Distribution domain behind lessmissed.com."
}

output "cloudfront_in_domain" {
  value = aws_cloudfront_distribution.in_redirect.domain_name
}

output "root_zone_nameservers" {
  value       = data.aws_route53_zone.root.name_servers
  description = "Route 53 nameservers for the root domain."
}

output "github_deploy_role_arn" {
  value       = aws_iam_role.github_deploy.arn
  description = "Set as the AWS_DEPLOY_ROLE_ARN repo variable in GitHub."
}

output "web_task_role_arn" {
  value       = aws_iam_role.web_task.arn
  description = "Trust this principal in the screenshots-prod cross-account role."
}

output "capture_task_role_arn" {
  value       = aws_iam_role.capture_task.arn
  description = "Trust this principal in the screenshots-prod cross-account role."
}

output "mongo_web_secret_arn" {
  value = aws_secretsmanager_secret.mongo_web.arn
}

output "mongo_capture_secret_arn" {
  value = aws_secretsmanager_secret.mongo_capture.arn
}
