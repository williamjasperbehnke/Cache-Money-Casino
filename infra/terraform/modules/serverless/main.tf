data "archive_file" "bundle" {
  type        = "zip"
  source_dir  = var.lambda_source_dir
  output_path = "${path.module}/lambda-bundle.zip"
}

resource "aws_dynamodb_table" "users" {
  name         = "${var.project_name}_users"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "username"

  attribute {
    name = "username"
    type = "S"
  }
}

resource "aws_dynamodb_table" "sessions" {
  name         = "${var.project_name}_sessions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "token"

  attribute {
    name = "token"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

resource "aws_dynamodb_table" "rooms" {
  name         = "${var.project_name}_rooms"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "room_id"
  range_key    = "player_id"

  attribute {
    name = "room_id"
    type = "S"
  }

  attribute {
    name = "player_id"
    type = "S"
  }
}

resource "aws_dynamodb_table" "connections" {
  name         = "${var.project_name}_connections"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "connection_id"

  attribute {
    name = "connection_id"
    type = "S"
  }
}

resource "aws_dynamodb_table" "game_sessions" {
  name         = "${var.project_name}_game_sessions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "session_id"

  attribute {
    name = "session_id"
    type = "S"
  }
}

resource "aws_iam_role" "lambda" {
  name = "${var.project_name}-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "lambda.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_policy" "lambda_ddb" {
  name = "${var.project_name}-lambda-ddb"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan"
        ]
        Resource = [
          aws_dynamodb_table.users.arn,
          aws_dynamodb_table.sessions.arn,
          aws_dynamodb_table.rooms.arn,
          aws_dynamodb_table.connections.arn,
          aws_dynamodb_table.game_sessions.arn
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_ddb" {
  role       = aws_iam_role.lambda.name
  policy_arn = aws_iam_policy.lambda_ddb.arn
}

resource "aws_lambda_function" "auth" {
  function_name = "${var.project_name}-auth"
  role          = aws_iam_role.lambda.arn
  handler       = "auth.handler"
  runtime       = "nodejs18.x"
  filename      = data.archive_file.bundle.output_path
  source_code_hash = data.archive_file.bundle.output_base64sha256
  timeout       = 10

  environment {
    variables = {
      USERS_TABLE    = aws_dynamodb_table.users.name
      SESSIONS_TABLE = aws_dynamodb_table.sessions.name
      CORS_ORIGIN    = var.cors_origin
    }
  }
}

resource "aws_lambda_function" "account" {
  function_name = "${var.project_name}-account"
  role          = aws_iam_role.lambda.arn
  handler       = "account.handler"
  runtime       = "nodejs18.x"
  filename      = data.archive_file.bundle.output_path
  source_code_hash = data.archive_file.bundle.output_base64sha256
  timeout       = 10

  environment {
    variables = {
      USERS_TABLE    = aws_dynamodb_table.users.name
      SESSIONS_TABLE = aws_dynamodb_table.sessions.name
      CORS_ORIGIN    = var.cors_origin
    }
  }
}

resource "aws_lambda_function" "game" {
  function_name = "${var.project_name}-game"
  role          = aws_iam_role.lambda.arn
  handler       = "game.handler"
  runtime       = "nodejs18.x"
  filename      = data.archive_file.bundle.output_path
  source_code_hash = data.archive_file.bundle.output_base64sha256
  timeout       = 10

  environment {
    variables = {
      GAME_SESSIONS_TABLE = aws_dynamodb_table.game_sessions.name
      USERS_TABLE         = aws_dynamodb_table.users.name
      SESSIONS_TABLE      = aws_dynamodb_table.sessions.name
      CORS_ORIGIN         = var.cors_origin
    }
  }
}

resource "aws_lambda_function" "ws_connect" {
  function_name = "${var.project_name}-ws-connect"
  role          = aws_iam_role.lambda.arn
  handler       = "ws_connect.handler"
  runtime       = "nodejs18.x"
  filename      = data.archive_file.bundle.output_path
  source_code_hash = data.archive_file.bundle.output_base64sha256
  timeout       = 10

  environment {
    variables = {
      CONNECTIONS_TABLE = aws_dynamodb_table.connections.name
      SESSIONS_TABLE    = aws_dynamodb_table.sessions.name
      CORS_ORIGIN       = var.cors_origin
    }
  }
}

resource "aws_lambda_function" "ws_disconnect" {
  function_name = "${var.project_name}-ws-disconnect"
  role          = aws_iam_role.lambda.arn
  handler       = "ws_disconnect.handler"
  runtime       = "nodejs18.x"
  filename      = data.archive_file.bundle.output_path
  source_code_hash = data.archive_file.bundle.output_base64sha256
  timeout       = 10

  environment {
    variables = {
      CONNECTIONS_TABLE = aws_dynamodb_table.connections.name
      CORS_ORIGIN       = var.cors_origin
    }
  }
}

resource "aws_lambda_function" "ws_message" {
  function_name = "${var.project_name}-ws-message"
  role          = aws_iam_role.lambda.arn
  handler       = "ws_message.handler"
  runtime       = "nodejs18.x"
  filename      = data.archive_file.bundle.output_path
  source_code_hash = data.archive_file.bundle.output_base64sha256
  timeout       = 10

  environment {
    variables = {
      CONNECTIONS_TABLE = aws_dynamodb_table.connections.name
      ROOMS_TABLE       = aws_dynamodb_table.rooms.name
      CORS_ORIGIN       = var.cors_origin
    }
  }
}

resource "aws_apigatewayv2_api" "rest" {
  name          = "${var.project_name}-http-api"
  protocol_type = "HTTP"

  cors_configuration {
    allow_headers = ["authorization", "content-type"]
    allow_methods = ["GET", "POST", "OPTIONS"]
    allow_origins = [var.cors_origin]
    max_age       = 86400
  }
}

resource "aws_apigatewayv2_stage" "rest" {
  api_id      = aws_apigatewayv2_api.rest.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_apigatewayv2_integration" "auth" {
  api_id           = aws_apigatewayv2_api.rest.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.auth.invoke_arn
}

resource "aws_apigatewayv2_integration" "account" {
  api_id           = aws_apigatewayv2_api.rest.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.account.invoke_arn
}

resource "aws_apigatewayv2_integration" "game" {
  api_id           = aws_apigatewayv2_api.rest.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.game.invoke_arn
}

resource "aws_apigatewayv2_route" "auth_register" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/auth/register"
  target    = "integrations/${aws_apigatewayv2_integration.auth.id}"
}

resource "aws_apigatewayv2_route" "auth_login" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/auth/login"
  target    = "integrations/${aws_apigatewayv2_integration.auth.id}"
}

resource "aws_apigatewayv2_route" "auth_guest" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/auth/guest"
  target    = "integrations/${aws_apigatewayv2_integration.auth.id}"
}

resource "aws_apigatewayv2_route" "me" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "GET /api/me"
  target    = "integrations/${aws_apigatewayv2_integration.account.id}"
}

resource "aws_apigatewayv2_route" "balance" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/balance"
  target    = "integrations/${aws_apigatewayv2_integration.account.id}"
}

resource "aws_apigatewayv2_route" "stats" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/stats/record"
  target    = "integrations/${aws_apigatewayv2_integration.account.id}"
}

resource "aws_apigatewayv2_route" "game_session" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/games/{game}/session"
  target    = "integrations/${aws_apigatewayv2_integration.game.id}"
}

resource "aws_apigatewayv2_route" "game_state" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "GET /api/games/{game}/state"
  target    = "integrations/${aws_apigatewayv2_integration.game.id}"
}

resource "aws_apigatewayv2_route" "roulette_spin" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/games/roulette/spin"
  target    = "integrations/${aws_apigatewayv2_integration.game.id}"
}

resource "aws_apigatewayv2_route" "roulette_chaos" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/games/roulette/chaos"
  target    = "integrations/${aws_apigatewayv2_integration.game.id}"
}

resource "aws_apigatewayv2_route" "slots_spin" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/games/slots/spin"
  target    = "integrations/${aws_apigatewayv2_integration.game.id}"
}

resource "aws_apigatewayv2_route" "blackjack_deal" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/games/blackjack/deal"
  target    = "integrations/${aws_apigatewayv2_integration.game.id}"
}

resource "aws_apigatewayv2_route" "blackjack_hit" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/games/blackjack/hit"
  target    = "integrations/${aws_apigatewayv2_integration.game.id}"
}

resource "aws_apigatewayv2_route" "blackjack_stand" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/games/blackjack/stand"
  target    = "integrations/${aws_apigatewayv2_integration.game.id}"
}

resource "aws_apigatewayv2_route" "blackjack_double" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/games/blackjack/double"
  target    = "integrations/${aws_apigatewayv2_integration.game.id}"
}

resource "aws_apigatewayv2_route" "blackjack_split" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/games/blackjack/split"
  target    = "integrations/${aws_apigatewayv2_integration.game.id}"
}

resource "aws_apigatewayv2_route" "holdem_deal" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/games/holdem/deal"
  target    = "integrations/${aws_apigatewayv2_integration.game.id}"
}

resource "aws_apigatewayv2_route" "holdem_action" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/games/holdem/action"
  target    = "integrations/${aws_apigatewayv2_integration.game.id}"
}

resource "aws_apigatewayv2_route" "holdem_fold" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/games/holdem/fold"
  target    = "integrations/${aws_apigatewayv2_integration.game.id}"
}

resource "aws_apigatewayv2_route" "poker_deal" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/games/poker/deal"
  target    = "integrations/${aws_apigatewayv2_integration.game.id}"
}

resource "aws_apigatewayv2_route" "poker_bet" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/games/poker/bet"
  target    = "integrations/${aws_apigatewayv2_integration.game.id}"
}

resource "aws_apigatewayv2_route" "poker_draw" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/games/poker/draw"
  target    = "integrations/${aws_apigatewayv2_integration.game.id}"
}

resource "aws_apigatewayv2_route" "poker_call" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/games/poker/call"
  target    = "integrations/${aws_apigatewayv2_integration.game.id}"
}

resource "aws_apigatewayv2_route" "poker_fold" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/games/poker/fold"
  target    = "integrations/${aws_apigatewayv2_integration.game.id}"
}

resource "aws_apigatewayv2_route" "poker_reveal" {
  api_id    = aws_apigatewayv2_api.rest.id
  route_key = "POST /api/games/poker/reveal"
  target    = "integrations/${aws_apigatewayv2_integration.game.id}"
}

resource "aws_lambda_permission" "auth" {
  statement_id  = "AllowInvokeAuth"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.auth.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.rest.execution_arn}/*/*"
}

resource "aws_lambda_permission" "account" {
  statement_id  = "AllowInvokeAccount"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.account.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.rest.execution_arn}/*/*"
}

resource "aws_lambda_permission" "game" {
  statement_id  = "AllowInvokeGame"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.game.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.rest.execution_arn}/*/*"
}

resource "aws_apigatewayv2_api" "ws" {
  name                       = "${var.project_name}-ws"
  protocol_type              = "WEBSOCKET"
  route_selection_expression = "$request.body.action"
}

resource "aws_apigatewayv2_integration" "ws_connect" {
  api_id           = aws_apigatewayv2_api.ws.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.ws_connect.invoke_arn
}

resource "aws_apigatewayv2_integration" "ws_disconnect" {
  api_id           = aws_apigatewayv2_api.ws.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.ws_disconnect.invoke_arn
}

resource "aws_apigatewayv2_integration" "ws_message" {
  api_id           = aws_apigatewayv2_api.ws.id
  integration_type = "AWS_PROXY"
  integration_uri  = aws_lambda_function.ws_message.invoke_arn
}

resource "aws_apigatewayv2_route" "ws_connect" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "$connect"
  target    = "integrations/${aws_apigatewayv2_integration.ws_connect.id}"
}

resource "aws_apigatewayv2_route" "ws_disconnect" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "$disconnect"
  target    = "integrations/${aws_apigatewayv2_integration.ws_disconnect.id}"
}

resource "aws_apigatewayv2_route" "ws_default" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "$default"
  target    = "integrations/${aws_apigatewayv2_integration.ws_message.id}"
}

resource "aws_apigatewayv2_route" "ws_join" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "join"
  target    = "integrations/${aws_apigatewayv2_integration.ws_message.id}"
}

resource "aws_apigatewayv2_route" "ws_leave" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "leave"
  target    = "integrations/${aws_apigatewayv2_integration.ws_message.id}"
}

resource "aws_apigatewayv2_route" "ws_action" {
  api_id    = aws_apigatewayv2_api.ws.id
  route_key = "action"
  target    = "integrations/${aws_apigatewayv2_integration.ws_message.id}"
}

resource "aws_apigatewayv2_stage" "ws" {
  api_id      = aws_apigatewayv2_api.ws.id
  name        = "prod"
  auto_deploy = true
}

resource "aws_lambda_permission" "ws_connect" {
  statement_id  = "AllowInvokeWsConnect"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ws_connect.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ws.execution_arn}/*/*"
}

resource "aws_lambda_permission" "ws_disconnect" {
  statement_id  = "AllowInvokeWsDisconnect"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ws_disconnect.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ws.execution_arn}/*/*"
}

resource "aws_lambda_permission" "ws_message" {
  statement_id  = "AllowInvokeWsMessage"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ws_message.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.ws.execution_arn}/*/*"
}
