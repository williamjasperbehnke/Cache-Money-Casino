output "alb_dns_name" {
  value = aws_lb.api.dns_name
}

output "instance_id" {
  value = aws_instance.api.id
}
