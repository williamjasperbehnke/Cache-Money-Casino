output "certificate_arn" {
  value       = var.use_custom_domain ? aws_acm_certificate_validation.site[0].certificate_arn : ""
  description = "ACM certificate ARN (if created)."
}
