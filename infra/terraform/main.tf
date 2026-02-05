terraform {
  required_version = ">= 1.4.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

locals {
  use_custom_domain = length(var.domain_name) > 0 && length(var.hosted_zone_id) > 0
}

module "s3_site" {
  source      = "./modules/s3-site"
  bucket_name = var.bucket_name
}

module "cloudfront" {
  source            = "./modules/cloudfront"
  project_name      = var.project_name
  bucket_domain     = module.s3_site.bucket_domain
  use_custom_domain = local.use_custom_domain
  domain_name       = var.domain_name
  acm_certificate_arn = module.dns.certificate_arn
}

module "dns" {
  source = "./modules/dns"

  providers = {
    aws         = aws
    aws.us_east_1 = aws.us_east_1
  }

  use_custom_domain  = local.use_custom_domain
  domain_name        = var.domain_name
  hosted_zone_id     = var.hosted_zone_id
  cloudfront_domain  = module.cloudfront.domain_name
  cloudfront_zone_id = module.cloudfront.hosted_zone_id
}

data "aws_iam_policy_document" "site" {
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${module.s3_site.bucket_arn}/*"]

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [module.cloudfront.distribution_arn]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = module.s3_site.bucket_id
  policy = data.aws_iam_policy_document.site.json
}

resource "aws_dynamodb_table" "users" {
  name         = var.users_table_name
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "username"

  attribute {
    name = "username"
    type = "S"
  }
}

resource "aws_secretsmanager_secret" "jwt" {
  name = var.jwt_secret_name
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id     = aws_secretsmanager_secret.jwt.id
  secret_string = random_password.jwt.result
}

resource "random_password" "jwt" {
  length  = 32
  special = true
}

module "api" {
  source             = "./modules/api-ec2"
  project_name       = var.project_name
  aws_region         = var.aws_region
  api_instance_type  = var.api_instance_type
  api_port           = var.api_port
  api_artifact_key   = var.api_artifact_key
  artifact_bucket    = module.s3_site.bucket_id
  artifact_bucket_arn = module.s3_site.bucket_arn
  users_table_name   = aws_dynamodb_table.users.name
  users_table_arn    = aws_dynamodb_table.users.arn
  jwt_secret_arn     = aws_secretsmanager_secret.jwt.arn
  cors_origin        = var.domain_name != "" ? "https://${var.domain_name}" : "*"
}
