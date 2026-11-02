terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # Remote state. Create the bucket once (see DEPLOYMENT.md) before `init`.
  # S3 native locking (use_lockfile) needs Terraform >= 1.10 — no DynamoDB table.
  backend "s3" {
    bucket       = "lessmissed-tfstate"
    key          = "prod/terraform.tfstate"
    region       = "ap-south-1"
    encrypt      = true
    use_lockfile = true
  }
}
