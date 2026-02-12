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

variable "blackjack_multi_room_idle_timeout_seconds" {
  type    = number
  default = 3600
}
