variable "project_name" {
  type        = string
  description = "Project identifier for naming."
}

variable "bucket_domain" {
  type        = string
  description = "S3 bucket regional domain name."
}

variable "use_custom_domain" {
  type        = bool
  description = "Whether to attach a custom domain."
}

variable "domain_name" {
  type        = string
  description = "Custom domain name."
  default     = ""
}

variable "acm_certificate_arn" {
  type        = string
  description = "ACM certificate ARN in us-east-1."
  default     = ""
}
