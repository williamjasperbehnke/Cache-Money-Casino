#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
TF_DIR="$ROOT_DIR/infra/terraform"
SITE_DIR="$ROOT_DIR"

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI not found. Install it before deploying." >&2
  exit 1
fi

if ! command -v terraform >/dev/null 2>&1; then
  echo "terraform not found. Install it before deploying." >&2
  exit 1
fi

if [ -z "${TF_STATE_BUCKET:-}" ] || [ -z "${TF_LOCK_TABLE:-}" ] || [ -z "${AWS_REGION:-}" ]; then
  echo "Set TF_STATE_BUCKET, TF_LOCK_TABLE, and AWS_REGION before running." >&2
  exit 1
fi

cd "$TF_DIR"

if [ ! -f terraform.tfvars ]; then
  echo "Missing terraform.tfvars. Copy terraform.tfvars.example and edit it." >&2
  exit 1
fi

terraform init \
  -backend-config="bucket=$TF_STATE_BUCKET" \
  -backend-config="key=terraform/state.tfstate" \
  -backend-config="region=$AWS_REGION" \
  -backend-config="dynamodb_table=$TF_LOCK_TABLE" \
  -backend-config="encrypt=true"

terraform apply -auto-approve

BUCKET_NAME=$(terraform output -raw s3_bucket_name)

aws s3 sync "$SITE_DIR" "s3://$BUCKET_NAME" \
  --exclude ".git/*" \
  --exclude "infra/*" \
  --exclude "*.tfstate*" \
  --exclude "node_modules/*" \
  --delete

echo "Deployment complete."
terraform output -raw cloudfront_domain
