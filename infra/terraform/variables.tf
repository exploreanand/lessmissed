variable "project" {
  type        = string
  default     = "lessmissed"
  description = "Name prefix for all resources."
}

variable "region" {
  type        = string
  default     = "ap-south-1"
  description = "Primary AWS region (Mumbai)."
}

variable "root_domain" {
  type        = string
  default     = "lessmissed.com"
  description = "Primary domain. Its Route 53 hosted zone must already exist."
}

variable "in_domain" {
  type        = string
  default     = "lessmissed.in"
  description = "Secondary domain that 301-redirects to root_domain. Its zone must already exist."
}

# --- Networking -------------------------------------------------------------
variable "vpc_cidr" {
  type        = string
  default     = "10.40.0.0/16"
  description = "VPC CIDR."
}

variable "public_subnet_cidrs" {
  type        = list(string)
  default     = ["10.40.0.0/20", "10.40.16.0/20"]
  description = "Two public subnet CIDRs, one per AZ."
}

variable "atlas_peering_connection_id" {
  type        = string
  default     = ""
  description = "VPC peering connection id Atlas initiates. Leave empty on the first apply; set it after requesting peering in the Atlas UI."
}

variable "atlas_cidr" {
  type        = string
  default     = ""
  description = "The Atlas project's CIDR block, routed to the peering connection. Required when atlas_peering_connection_id is set."
}

# --- Images -----------------------------------------------------------------
variable "image_tag" {
  type        = string
  default     = "bootstrap"
  description = "Container image tag to run (the commit SHA in CI). Used only when create_services = true."
}

variable "create_services" {
  type        = bool
  default     = false
  description = "Stand up the ECS services. Keep false on the first apply (no images in ECR yet); flip to true after the first image push."
}

variable "web_cpu" {
  type        = number
  default     = 1024
  description = "Web task vCPU units (1024 = 1 vCPU)."
}

variable "web_memory" {
  type        = number
  default     = 2048
  description = "Web task memory (MiB)."
}

variable "web_min_tasks" {
  type    = number
  default = 1
}

variable "web_max_tasks" {
  type    = number
  default = 4
}

variable "capture_cpu" {
  type        = number
  default     = 2048
  description = "Capture task vCPU units (2048 = 2 vCPU)."
}

variable "capture_memory" {
  type        = number
  default     = 4096
  description = "Capture task memory (MiB)."
}

# --- S3 (separate account) --------------------------------------------------
variable "s3_bucket_name" {
  type        = string
  default     = "lessmissed-screenshots-prod"
  description = "Screenshots bucket name (lives in a SEPARATE AWS account)."
}

variable "s3_base_url" {
  type        = string
  description = "Public base URL the app builds screenshot URLs from (e.g. the bucket's public endpoint or its CDN)."
}

variable "s3_cross_account_role_arn" {
  type        = string
  description = "ARN of the role in the screenshots-prod account that the ECS task roles assume for S3 access. The tasks get sts:AssumeRole on this; the role + bucket policy are created in that other account (see DEPLOYMENT.md)."
}

# --- CI / OIDC --------------------------------------------------------------
variable "github_repo" {
  type        = string
  default     = "exploreanand/lessmissed"
  description = "owner/repo allowed to assume the deploy role via OIDC."
}

variable "github_oidc_thumbprint" {
  type        = string
  default     = "6938fd4d98bab03faadb97b34396831e3780aea1"
  description = "GitHub Actions OIDC provider root CA thumbprint."
}

# --- Ops --------------------------------------------------------------------
variable "alarm_email" {
  type        = string
  description = "Address subscribed to the CloudWatch alarm SNS topic."
}

variable "monthly_budget_usd" {
  type    = number
  default = 250
}

variable "tag_rate_limit_per_5min" {
  type        = number
  default     = 3000
  description = "WAF per-IP rate limit for /api/tag/* over a 5-minute window."
}

variable "events_ttl_days" {
  type    = number
  default = 90
}
