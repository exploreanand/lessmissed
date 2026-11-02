data "aws_cloudfront_cache_policy" "disabled" {
  name = "Managed-CachingDisabled"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_origin_request_policy" "all_viewer" {
  name = "Managed-AllViewer"
}

data "aws_cloudfront_response_headers_policy" "security" {
  name = "Managed-SecurityHeadersPolicy"
}

# www.lessmissed.com -> lessmissed.com (301), preserving the path.
resource "aws_cloudfront_function" "www_redirect" {
  name    = "${local.name}-www-redirect"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var req = event.request;
      var host = req.headers.host && req.headers.host.value;
      if (host === "${local.www_domain}") {
        return {
          statusCode: 301,
          statusDescription: "Moved Permanently",
          headers: { location: { value: "https://${local.apex_domain}" + req.uri } }
        };
      }
      return req;
    }
  EOT
}

# Any lessmissed.in request -> https://lessmissed.com<path> (301).
resource "aws_cloudfront_function" "in_redirect" {
  count   = local.in_enabled ? 1 : 0
  name    = "${local.name}-in-redirect"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var req = event.request;
      return {
        statusCode: 301,
        statusDescription: "Moved Permanently",
        headers: { location: { value: "https://${local.apex_domain}" + req.uri } }
      };
    }
  EOT
}

locals {
  alb_origin_id = "alb"
}

resource "aws_cloudfront_distribution" "app" {
  enabled         = true
  is_ipv6_enabled = true
  http_version    = "http2and3"
  aliases         = [local.apex_domain, local.www_domain]
  comment         = "${local.name} app"
  price_class     = "PriceClass_All"
  web_acl_id      = aws_wafv2_web_acl.app.arn

  origin {
    domain_name = local.origin_domain
    origin_id   = local.alb_origin_id

    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    custom_header {
      name  = "X-Origin-Verify"
      value = random_password.origin_verify.result
    }
  }

  # SSR pages + everything not matched below: no caching, forward everything.
  default_cache_behavior {
    target_origin_id           = local.alb_origin_id
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods             = ["GET", "HEAD"]
    cache_policy_id            = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id   = data.aws_cloudfront_origin_request_policy.all_viewer.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.www_redirect.arn
    }
  }

  # Next build assets: immutable, cache hard.
  ordered_cache_behavior {
    path_pattern           = "/_next/static/*"
    target_origin_id       = local.alb_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
  }

  # Tag script + webgazer + models.
  ordered_cache_behavior {
    path_pattern           = "/tag/v1/*"
    target_origin_id       = local.alb_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD", "OPTIONS"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
  }

  # API: never cache, forward everything incl. cookies + the tag key header.
  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = local.alb_origin_id
    viewer_protocol_policy   = "redirect-to-https"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = data.aws_cloudfront_origin_request_policy.all_viewer.id
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.cloudfront.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

# Redirect-only distribution for lessmissed.in. The origin is never reached —
# the viewer-request function returns a 301 first — but a distribution must
# declare one, so it points at the same ALB origin.
resource "aws_cloudfront_distribution" "in_redirect" {
  count           = local.in_enabled ? 1 : 0
  enabled         = true
  is_ipv6_enabled = true
  aliases         = [local.in_apex, local.in_www]
  comment         = "${local.name} .in redirect"
  price_class     = "PriceClass_All"
  web_acl_id      = aws_wafv2_web_acl.in[0].arn

  origin {
    domain_name = local.origin_domain
    origin_id   = local.alb_origin_id
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }
  }

  default_cache_behavior {
    target_origin_id       = local.alb_origin_id
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    cache_policy_id        = data.aws_cloudfront_cache_policy.disabled.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.in_redirect[0].arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.in[0].certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}
