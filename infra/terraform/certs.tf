# --- ALB certificate (regional, ap-south-1) for origin.lessmissed.com -------
resource "aws_acm_certificate" "alb" {
  domain_name       = local.origin_domain
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "alb_cert" {
  for_each = {
    for dvo in aws_acm_certificate.alb.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }
  zone_id         = aws_route53_zone.root.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "alb" {
  certificate_arn         = aws_acm_certificate.alb.arn
  validation_record_fqdns = [for r in aws_route53_record.alb_cert : r.fqdn]
}

# --- CloudFront certificate (us-east-1) for lessmissed.com + www ------------
resource "aws_acm_certificate" "cloudfront" {
  provider                  = aws.us_east_1
  domain_name               = var.root_domain
  subject_alternative_names = [local.www_domain]
  validation_method         = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "cloudfront_cert" {
  for_each = {
    for dvo in aws_acm_certificate.cloudfront.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  }
  zone_id         = aws_route53_zone.root.zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "cloudfront" {
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.cloudfront.arn
  validation_record_fqdns = [for r in aws_route53_record.cloudfront_cert : r.fqdn]
}

# --- .in certificate (us-east-1) for lessmissed.in + www --------------------
# All gated on in_enabled: nothing here exists until in_domain is set.
resource "aws_acm_certificate" "in" {
  count                     = local.in_enabled ? 1 : 0
  provider                  = aws.us_east_1
  domain_name               = var.in_domain
  subject_alternative_names = [local.in_www]
  validation_method         = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_route53_record" "in_cert" {
  for_each = local.in_enabled ? {
    for dvo in aws_acm_certificate.in[0].domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      type   = dvo.resource_record_type
      record = dvo.resource_record_value
    }
  } : {}
  zone_id         = aws_route53_zone.in[0].zone_id
  name            = each.value.name
  type            = each.value.type
  records         = [each.value.record]
  ttl             = 60
  allow_overwrite = true
}

resource "aws_acm_certificate_validation" "in" {
  count                   = local.in_enabled ? 1 : 0
  provider                = aws.us_east_1
  certificate_arn         = aws_acm_certificate.in[0].arn
  validation_record_fqdns = [for r in aws_route53_record.in_cert : r.fqdn]
}
