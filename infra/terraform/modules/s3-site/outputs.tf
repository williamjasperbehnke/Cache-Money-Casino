output "bucket_id" {
  value       = aws_s3_bucket.site.id
  description = "S3 bucket id."
}

output "bucket_arn" {
  value       = aws_s3_bucket.site.arn
  description = "S3 bucket ARN."
}

output "bucket_domain" {
  value       = aws_s3_bucket.site.bucket_regional_domain_name
  description = "S3 bucket regional domain name."
}
