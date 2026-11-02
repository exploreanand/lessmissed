provider "aws" {
  region = var.region
  default_tags {
    tags = local.tags
  }
}

# CloudFront ACM certificates and CLOUDFRONT-scoped WAF web ACLs must live in
# us-east-1, regardless of where the rest of the stack runs.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
  default_tags {
    tags = local.tags
  }
}
