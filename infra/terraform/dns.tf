# Hosted zones are created when you register the domains in Route 53 (Step 1).
data "aws_route53_zone" "root" {
  name = var.root_domain
}

data "aws_route53_zone" "in" {
  name = var.in_domain
}

# Public DNS -> CloudFront (app). origin.* -> ALB (CloudFront's origin).
resource "aws_route53_record" "apex_a" {
  zone_id = data.aws_route53_zone.root.zone_id
  name    = local.apex_domain
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.app.domain_name
    zone_id                = aws_cloudfront_distribution.app.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "apex_aaaa" {
  zone_id = data.aws_route53_zone.root.zone_id
  name    = local.apex_domain
  type    = "AAAA"
  alias {
    name                   = aws_cloudfront_distribution.app.domain_name
    zone_id                = aws_cloudfront_distribution.app.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www_a" {
  zone_id = data.aws_route53_zone.root.zone_id
  name    = local.www_domain
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.app.domain_name
    zone_id                = aws_cloudfront_distribution.app.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "www_aaaa" {
  zone_id = data.aws_route53_zone.root.zone_id
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
  zone_id = data.aws_route53_zone.root.zone_id
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
  zone_id = data.aws_route53_zone.in.zone_id
  name    = local.in_apex
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.in_redirect.domain_name
    zone_id                = aws_cloudfront_distribution.in_redirect.hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "in_www_a" {
  zone_id = data.aws_route53_zone.in.zone_id
  name    = local.in_www
  type    = "A"
  alias {
    name                   = aws_cloudfront_distribution.in_redirect.domain_name
    zone_id                = aws_cloudfront_distribution.in_redirect.hosted_zone_id
    evaluate_target_health = false
  }
}
