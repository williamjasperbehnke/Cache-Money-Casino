output "rest_api_url" {
  value = aws_apigatewayv2_api.rest.api_endpoint
}

output "ws_api_url" {
  value = aws_apigatewayv2_api.ws.api_endpoint
}

output "users_table" {
  value = aws_dynamodb_table.users.name
}
