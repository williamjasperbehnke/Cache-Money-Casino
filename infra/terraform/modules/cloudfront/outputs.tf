
output "distribution_arn" {
  value       = aws_cloudfront_distribution.site.arn
  description = "CloudFront distribution ARN."
}

output "domain_name" {
  value       = aws_cloudfront_distribution.site.domain_name
  description = "CloudFront domain name."
}

output "hosted_zone_id" {
  value       = aws_cloudfront_distribution.site.hosted_zone_id
  description = "CloudFront hosted zone id."
}

output "distribution_id" {
  value       = aws_cloudfront_distribution.site.id
  description = "CloudFront distribution id."
}
