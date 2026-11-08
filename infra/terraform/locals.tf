locals {
  name = var.project

  tags = {
    Project     = var.project
    Environment = "production"
    ManagedBy   = "terraform"
  }

  azs = [for s in ["a", "b"] : "${var.region}${s}"]

  # Public hostnames
  apex_domain   = var.root_domain             # lessmissed.com
  www_domain    = "www.${var.root_domain}"    # www.lessmissed.com
  origin_domain = "origin.${var.root_domain}" # origin.lessmissed.com -> ALB
  in_apex       = var.in_domain               # lessmissed.in
  in_www        = "www.${var.in_domain}"      # www.lessmissed.in

  # The .in redirect (cert, CloudFront distro, WAF, DNS) only exists once the
  # .in domain has been bought and in_domain is set.
  in_enabled = var.in_domain != ""

  # --- Cost pause (var.paused) ----------------------------------------------
  # Only the pieces that bill by the hour regardless of traffic are torn down:
  # the ALB (hourly + one public IPv4 per AZ) and the WAF ACL ($5/ACL + $1 per
  # rule), plus the Route 53 health check and the alarms that would otherwise
  # email continuously while the stack is down.
  #
  # CloudFront deliberately stays: it is traffic-priced, so an idle
  # distribution costs ~nothing, and keeping it avoids ~20 minutes of
  # disable-then-delete on pause and another ~20 on resume. The apex/www alias
  # records point at it and stay too; only origin.* (which targets the ALB) goes.
  edge_enabled = !var.paused

  # Pausing implies no compute: the web service registers into the ALB's target
  # group, so it cannot exist while the ALB is gone.
  services_enabled = var.create_services && !var.paused
}
