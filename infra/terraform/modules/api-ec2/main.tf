data "aws_vpc" "default" {
  default = true
}

data "aws_subnets" "default" {
  filter {
    name   = "vpc-id"
    values = [data.aws_vpc.default.id]
  }
}

resource "aws_security_group" "alb" {
  name        = "${var.project_name}-api-alb"
  description = "ALB security group"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "api" {
  name        = "${var.project_name}-api-ec2"
  description = "API instance security group"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port       = var.api_port
    to_port         = var.api_port
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_iam_role" "api" {
  name = "${var.project_name}-api-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.api.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_policy" "api" {
  name = "${var.project_name}-api-policy"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem"]
        Resource = var.users_table_arn
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = ["${var.artifact_bucket_arn}/${var.api_artifact_key}"]
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = var.jwt_secret_arn
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "api" {
  role       = aws_iam_role.api.name
  policy_arn = aws_iam_policy.api.arn
}

resource "aws_iam_instance_profile" "api" {
  name = "${var.project_name}-api-profile"
  role = aws_iam_role.api.name
}

data "aws_ami" "al2023" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}

resource "aws_instance" "api" {
  ami                         = data.aws_ami.al2023.id
  instance_type               = var.api_instance_type
  subnet_id                   = data.aws_subnets.default.ids[0]
  vpc_security_group_ids      = [aws_security_group.api.id]
  iam_instance_profile        = aws_iam_instance_profile.api.name
  associate_public_ip_address = true

  user_data = <<-USERDATA
              #!/bin/bash
              set -e
              dnf update -y
              dnf install -y nodejs awscli unzip
              mkdir -p /opt/casino-api
              aws s3 cp "s3://${var.artifact_bucket}/${var.api_artifact_key}" /opt/casino-api/server.zip
              cd /opt/casino-api
              unzip -o server.zip
              npm install --production

              SECRET=$(aws secretsmanager get-secret-value --secret-id "${var.jwt_secret_arn}" --query SecretString --output text)
              cat <<EOF >/etc/systemd/system/casino-api.service
              [Unit]
              Description=Cache Money Casino API
              After=network.target

              [Service]
              Environment=AWS_REGION=${var.aws_region}
              Environment=USERS_TABLE=${var.users_table_name}
              Environment=CORS_ORIGIN=${var.cors_origin}
              Environment=JWT_SECRET=$SECRET
              Environment=PORT=${var.api_port}
              WorkingDirectory=/opt/casino-api
              ExecStart=/usr/bin/node index.js
              Restart=always

              [Install]
              WantedBy=multi-user.target
              EOF

              systemctl daemon-reload
              systemctl enable casino-api
              systemctl start casino-api
              USERDATA

  tags = {
    Name = "${var.project_name}-api"
  }
}

resource "aws_lb" "api" {
  name               = "${var.project_name}-api"
  load_balancer_type = "application"
  subnets            = data.aws_subnets.default.ids
  security_groups    = [aws_security_group.alb.id]
}

resource "aws_lb_target_group" "api" {
  name        = "${var.project_name}-api-tg"
  port        = var.api_port
  protocol    = "HTTP"
  vpc_id      = data.aws_vpc.default.id
  target_type = "instance"

  health_check {
    path                = "/health"
    port                = var.api_port
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 20
    timeout             = 5
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.api.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_lb_target_group_attachment" "api" {
  target_group_arn = aws_lb_target_group.api.arn
  target_id        = aws_instance.api.id
  port             = var.api_port
}
