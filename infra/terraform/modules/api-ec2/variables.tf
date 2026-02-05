variable "project_name" {
  type = string
}

variable "aws_region" {
  type = string
}

variable "api_instance_type" {
  type = string
}

variable "api_port" {
  type = number
}

variable "artifact_bucket" {
  type = string
}

variable "artifact_bucket_arn" {
  type = string
}

variable "api_artifact_key" {
  type = string
}

variable "users_table_name" {
  type = string
}

variable "users_table_arn" {
  type = string
}

variable "jwt_secret_arn" {
  type = string
}

variable "cors_origin" {
  type = string
}
