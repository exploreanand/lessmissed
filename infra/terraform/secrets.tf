# Empty secret shells. Set the actual connection strings with the CLI so the
# values never enter Terraform state (see DEPLOYMENT.md):
#   aws secretsmanager put-secret-value --secret-id lessmissed/prod/mongodb-uri-web --secret-string '...'
resource "aws_secretsmanager_secret" "mongo_web" {
  name                    = "${local.name}/prod/mongodb-uri-web"
  description             = "MongoDB Atlas connection string for the web app (lm_web user)."
  recovery_window_in_days = 7
}

resource "aws_secretsmanager_secret" "mongo_capture" {
  name                    = "${local.name}/prod/mongodb-uri-capture"
  description             = "MongoDB Atlas connection string for the capture worker (lm_capture user)."
  recovery_window_in_days = 7
}

# Secret access key for the screenshots bucket (lives in the store account).
# Value set out of band via the CLI; only used when s3_access_key_id is set.
resource "aws_secretsmanager_secret" "s3_key" {
  name                    = "${local.name}/prod/s3-secret-key"
  description             = "AWS secret access key for the cross-account screenshots bucket."
  recovery_window_in_days = 7
}
