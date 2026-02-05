output "s3_bucket_name" {
  value       = module.s3_site.bucket_id
  description = "S3 bucket for the static site."
}

output "cloudfront_domain" {
  value       = module.cloudfront.domain_name
  description = "CloudFront distribution domain name."
}

output "cloudfront_distribution_id" {
  value       = module.cloudfront.distribution_id
  description = "CloudFront distribution id."
}

output "custom_domain" {
  value       = var.domain_name
  description = "Custom domain (if configured)."
}

output "api_alb_dns_name" {
  value       = module.api.alb_dns_name
  description = "ALB DNS name for the API service."
}

output "api_instance_id" {
  value       = module.api.instance_id
  description = "EC2 instance id for the API service."
}
