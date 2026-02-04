variable "use_custom_domain" {
  type        = bool
  description = "Whether to attach a custom domain."
}

variable "domain_name" {
  type        = string
  description = "Custom domain name."
  default     = ""
}

variable "hosted_zone_id" {
  type        = string
  description = "Route53 hosted zone id."
  default     = ""
}

variable "cloudfront_domain" {
  type        = string
  description = "CloudFront domain name."
}

variable "cloudfront_zone_id" {
  type        = string
  description = "CloudFront hosted zone id."
}
