variable "project_name" {
  type        = string
  description = "Project identifier for tagging and naming."
  default     = "cache-money-casino"
}

variable "aws_region" {
  type        = string
  description = "AWS region for S3 + Route53 (CloudFront is global)."
  default     = "us-east-1"
}

variable "bucket_name" {
  type        = string
  description = "S3 bucket name for the static site."
}

variable "users_table_name" {
  type        = string
  description = "DynamoDB table name for user accounts."
  default     = "casino_users"
}

variable "jwt_secret_name" {
  type        = string
  description = "Secrets Manager secret name for JWT signing."
  default     = "casino-jwt-secret"
}

variable "cors_origin" {
  type        = string
  description = "CORS allowed origin for the API (use * for development)."
  default     = "*"
}

variable "enable_serverless" {
  type        = bool
  description = "Create the serverless API Gateway + Lambda stack."
  default     = true
}

variable "domain_name" {
  type        = string
  description = "Optional custom domain (leave empty to use CloudFront URL)."
  default     = ""
}

variable "hosted_zone_id" {
  type        = string
  description = "Route53 hosted zone ID for the domain. Required if domain_name is set."
  default     = ""
}
