variable "project_name" {
  type        = string
  description = "Project identifier for tagging and naming."
  default     = "cache-money-casino"
}

variable "aws_region" {
  type        = string
  description = "AWS region for S3 + Route53 (CloudFront is global)."
  default     = "us-east-2"
}

variable "bucket_name" {
  type        = string
  description = "S3 bucket name for the static site."
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
