variable "project_name" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "lambda_source_dir" {
  type = string
}

variable "cors_origin" {
  type    = string
  default = "*"
}
