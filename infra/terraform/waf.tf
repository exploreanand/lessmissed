# Flat-rate CloudFront pricing plans require a WAF web ACL per distribution.
# CLOUDFRONT-scoped ACLs must be created in us-east-1.

resource "aws_wafv2_web_acl" "app" {
  provider    = aws.us_east_1
  name        = "${local.name}-app"
  description = "App distribution protections"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "ip-reputation"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "known-bad-inputs"
    priority = 2
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-known-bad"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "common"
    priority = 3
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesCommonRuleSet"
        # Tag event batches legitimately exceed the 8KB body inspection limit,
        # so count (don't block) the body-size rule.
        rule_action_override {
          name = "SizeRestrictions_BODY"
          action_to_use {
            count {}
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-auth"
    priority = 4
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = 100
        aggregate_key_type = "IP"
        scope_down_statement {
          byte_match_statement {
            positional_constraint = "STARTS_WITH"
            search_string         = "/api/auth/"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-rate-auth"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "rate-tag"
    priority = 5
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.tag_rate_limit_per_5min
        aggregate_key_type = "IP"
        scope_down_statement {
          byte_match_statement {
            positional_constraint = "STARTS_WITH"
            search_string         = "/api/tag/"
            field_to_match {
              uri_path {}
            }
            text_transformation {
              priority = 0
              type     = "NONE"
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-rate-tag"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-app"
    sampled_requests_enabled   = true
  }
}

# Minimal ACL for the .in redirect distribution (required by the pricing plan).
resource "aws_wafv2_web_acl" "in" {
  count       = local.in_enabled ? 1 : 0
  provider    = aws.us_east_1
  name        = "${local.name}-in"
  description = "Redirect distribution"
  scope       = "CLOUDFRONT"

  default_action {
    allow {}
  }

  rule {
    name     = "ip-reputation"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesAmazonIpReputationList"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-in-ip-reputation"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-in"
    sampled_requests_enabled   = true
  }
}
