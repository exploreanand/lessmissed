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
}
