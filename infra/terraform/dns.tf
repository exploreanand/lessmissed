# The domain is registered at an external registrar (GoDaddy). Terraform owns
# the hosted zone; point the registrar's nameservers at root_zone_nameservers.
resource "aws_route53_zone" "root" {
  name = var.root_domain
  tags = local.tags
}

# Only created once in_domain is set (the .in domain has been bought).
resource "aws_route53_zone" "in" {
  count = local.in_enabled ? 1 : 0
  name  = var.in_domain
  tags  = local.tags
}

# Public DNS -> CloudFront (app). origin.* -> ALB (CloudFront's origin).
resource "aws_route53_record" "apex_a" {
  zone_id = aws_route53_zone.root.zone_id
  name    = local.apex_domain
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.app.domain_name
    zone_id                = aws_cloudfront_distribution.app.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "apex_aaaa" {
  zone_id = aws_route53_zone.root.zone_id
  name    = local.apex_domain
  type    = "AAAA"
  alias {
    name                   = aws_cloudfront_distribution.app.domain_name
    zone_id                = aws_cloudfront_distribution.app.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www_a" {
  zone_id = aws_route53_zone.root.zone_id
  name    = local.www_domain
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.app.domain_name
    zone_id                = aws_cloudfront_distribution.app.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www_aaaa" {
  zone_id = aws_route53_zone.root.zone_id
  name    = local.www_domain
  type    = "AAAA"
  alias {
    name                   = aws_cloudfront_distribution.app.domain_name
    zone_id                = aws_cloudfront_distribution.app.hosted_zone_id
    evaluate_target_health = false
  }
}

# ALB is IPv4-only, so origin.* is an A alias only.
resource "aws_route53_record" "origin_a" {
  zone_id = aws_route53_zone.root.zone_id
  name    = local.origin_domain
  type    = "A"
  alias {
    name                   = aws_lb.app.dns_name
    zone_id                = aws_lb.app.zone_id
    evaluate_target_health = true
  }
}

# lessmissed.in + www -> CloudFront redirect distribution
resource "aws_route53_record" "in_apex_a" {
  count   = local.in_enabled ? 1 : 0
  zone_id = aws_route53_zone.in[0].zone_id
  name    = local.in_apex
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.in_redirect[0].domain_name
    zone_id                = aws_cloudfront_distribution.in_redirect[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "in_www_a" {
  count   = local.in_enabled ? 1 : 0
  zone_id = aws_route53_zone.in[0].zone_id
  name    = local.in_www
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.in_redirect[0].domain_name
    zone_id                = aws_cloudfront_distribution.in_redirect[0].hosted_zone_id
    evaluate_target_health = false
  }
}
