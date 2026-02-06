# Terraform: AWS S3 + CloudFront Hosting + Serverless API

This configuration hosts the static site on S3 behind CloudFront, with an optional custom domain (Route 53 + ACM). It also provisions a serverless API (HTTP + WebSocket) for auth and game sessions.

## Structure
- `modules/s3-site`: S3 bucket + ownership + public access block
- `modules/cloudfront`: CloudFront distribution + OAC
- `modules/dns`: ACM + Route 53 records (optional)
- `modules/serverless`: API Gateway (HTTP + WebSocket) + Lambda + DynamoDB

## Quick start

```sh
cd infra/terraform
terraform init
terraform apply -var="bucket_name=your-unique-bucket-name"
```

## Custom domain (optional)

Provide your Route 53 hosted zone ID and domain:

```sh
terraform apply \
  -var="bucket_name=your-unique-bucket-name" \
  -var="domain_name=casino.example.com" \
  -var="hosted_zone_id=Z1234567890ABC"
```

## Notes
- ACM certs for CloudFront **must** be in `us-east-1` (handled via provider alias).
- This config does **not** upload site files. Use `deploy.sh` to sync the site to S3.
