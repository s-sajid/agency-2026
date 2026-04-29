terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# ── ECR + Docker image ─────────────────────────────────────────────────────────

resource "aws_ecr_repository" "app" {
  name                 = var.service_name
  image_tag_mutability = "MUTABLE"
  force_delete         = true
}

data "aws_ecr_authorization_token" "token" {}

provider "docker" {
  registry_auth {
    address  = data.aws_ecr_authorization_token.token.proxy_endpoint
    username = data.aws_ecr_authorization_token.token.user_name
    password = data.aws_ecr_authorization_token.token.password
  }
}

resource "docker_image" "app" {
  name = "${aws_ecr_repository.app.repository_url}:${var.docker_image_tag}"

  build {
    context    = "${path.module}/.."
    dockerfile = "Dockerfile"
    platform   = "linux/amd64"
    no_cache   = true
  }

  depends_on = [aws_ecr_repository.app]
}

resource "docker_registry_image" "app" {
  name       = docker_image.app.name
  depends_on = [docker_image.app]
}

# ── SQS job queue ──────────────────────────────────────────────────────────────

resource "aws_sqs_queue" "jobs_dlq" {
  name                      = "${var.service_name}-jobs-dlq"
  message_retention_seconds = 1209600 # 14 days
}

resource "aws_sqs_queue" "jobs" {
  name                       = "${var.service_name}-jobs"
  visibility_timeout_seconds = 910 # must exceed orchestrator Lambda timeout
  message_retention_seconds  = 86400

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.jobs_dlq.arn
    maxReceiveCount     = 3
  })
}

# ── DynamoDB jobs table ────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "jobs" {
  name         = "${var.service_name}-jobs"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "job_id"

  attribute {
    name = "job_id"
    type = "S"
  }

  ttl {
    attribute_name = "ttl"
    enabled        = true
  }
}

# ── App Runner IAM ─────────────────────────────────────────────────────────────

resource "aws_iam_role" "apprunner_ecr_access" {
  name = "${var.service_name}-ecr-access"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "build.apprunner.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "apprunner_ecr_access" {
  role       = aws_iam_role.apprunner_ecr_access.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess"
}

resource "aws_iam_role" "apprunner_instance" {
  name = "${var.service_name}-instance"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "tasks.apprunner.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "apprunner_api" {
  name = "api-access"
  role = aws_iam_role.apprunner_instance.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["sqs:SendMessage"]
        Resource = aws_sqs_queue.jobs.arn
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:PutItem",
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
        ]
        Resource = aws_dynamodb_table.jobs.arn
      }
    ]
  })
}

# ── App Runner service ─────────────────────────────────────────────────────────

resource "aws_apprunner_service" "app" {
  service_name = var.service_name

  source_configuration {
    image_repository {
      image_identifier      = "${aws_ecr_repository.app.repository_url}:${var.docker_image_tag}"
      image_repository_type = "ECR"

      image_configuration {
        port = "8000"
        runtime_environment_variables = {
          AWS_REGION       = var.region
          PYTHONUNBUFFERED = "1"
          QUEUE_URL        = aws_sqs_queue.jobs.url
          JOBS_TABLE       = aws_dynamodb_table.jobs.name
          PG_DSN           = var.pg_dsn
        }
      }
    }

    authentication_configuration {
      access_role_arn = aws_iam_role.apprunner_ecr_access.arn
    }

    auto_deployments_enabled = true
  }

  instance_configuration {
    instance_role_arn = aws_iam_role.apprunner_instance.arn
    cpu               = "1024"
    memory            = "2048"
  }

  depends_on = [
    docker_registry_image.app,
    aws_iam_role_policy_attachment.apprunner_ecr_access,
  ]
}

# ── Specialist Lambdas (Discovery / Investigation / Validator / Narrative) ─────

resource "aws_iam_role" "lambda_specialist" {
  name = "${var.service_name}-lambda-specialist"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_specialist_basic" {
  role       = aws_iam_role.lambda_specialist.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_specialist_bedrock" {
  name = "bedrock-invoke"
  role = aws_iam_role.lambda_specialist.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
      Resource = "*"
    }]
  })
}

locals {
  specialist_envs = {
    BEDROCK_MODEL_ID = var.bedrock_model_id
    LLM_BACKEND      = "bedrock"
    LLM_MODEL        = var.bedrock_model_id
    AWS_REGION_NAME  = var.region
    PG_DSN           = var.pg_dsn
  }
}

resource "aws_lambda_function" "discovery_agent" {
  function_name    = "${var.service_name}-discovery-agent"
  role             = aws_iam_role.lambda_specialist.arn
  filename         = "${path.module}/../backend/discovery_agent/discovery_agent.zip"
  source_code_hash = fileexists("${path.module}/../backend/discovery_agent/discovery_agent.zip") ? filebase64sha256("${path.module}/../backend/discovery_agent/discovery_agent.zip") : null
  handler          = "handler.handler"
  runtime          = "python3.12"
  timeout          = 300
  memory_size      = 1024

  environment {
    variables = local.specialist_envs
  }

  depends_on = [aws_iam_role_policy_attachment.lambda_specialist_basic]
}

resource "aws_lambda_function" "investigation_agent" {
  function_name    = "${var.service_name}-investigation-agent"
  role             = aws_iam_role.lambda_specialist.arn
  filename         = "${path.module}/../backend/investigation_agent/investigation_agent.zip"
  source_code_hash = fileexists("${path.module}/../backend/investigation_agent/investigation_agent.zip") ? filebase64sha256("${path.module}/../backend/investigation_agent/investigation_agent.zip") : null
  handler          = "handler.handler"
  runtime          = "python3.12"
  timeout          = 300
  memory_size      = 1024

  environment {
    variables = local.specialist_envs
  }

  depends_on = [aws_iam_role_policy_attachment.lambda_specialist_basic]
}

resource "aws_lambda_function" "validator_agent" {
  function_name    = "${var.service_name}-validator-agent"
  role             = aws_iam_role.lambda_specialist.arn
  filename         = "${path.module}/../backend/validator_agent/validator_agent.zip"
  source_code_hash = fileexists("${path.module}/../backend/validator_agent/validator_agent.zip") ? filebase64sha256("${path.module}/../backend/validator_agent/validator_agent.zip") : null
  handler          = "handler.handler"
  runtime          = "python3.12"
  timeout          = 300
  memory_size      = 1024

  environment {
    variables = local.specialist_envs
  }

  depends_on = [aws_iam_role_policy_attachment.lambda_specialist_basic]
}

resource "aws_lambda_function" "narrative_agent" {
  function_name    = "${var.service_name}-narrative-agent"
  role             = aws_iam_role.lambda_specialist.arn
  filename         = "${path.module}/../backend/narrative_agent/narrative_agent.zip"
  source_code_hash = fileexists("${path.module}/../backend/narrative_agent/narrative_agent.zip") ? filebase64sha256("${path.module}/../backend/narrative_agent/narrative_agent.zip") : null
  handler          = "handler.handler"
  runtime          = "python3.12"
  timeout          = 300
  memory_size      = 1024

  environment {
    variables = local.specialist_envs
  }

  depends_on = [aws_iam_role_policy_attachment.lambda_specialist_basic]
}

# ── Orchestrator Lambda ────────────────────────────────────────────────────────

resource "aws_iam_role" "lambda_orchestrator" {
  name = "${var.service_name}-lambda-orchestrator"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_orchestrator_basic" {
  role       = aws_iam_role.lambda_orchestrator.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_orchestrator_access" {
  name = "orchestrator-access"
  role = aws_iam_role.lambda_orchestrator.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = ["lambda:InvokeFunction"]
        Resource = [
          aws_lambda_function.discovery_agent.arn,
          aws_lambda_function.investigation_agent.arn,
          aws_lambda_function.validator_agent.arn,
          aws_lambda_function.narrative_agent.arn,
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:UpdateItem",
          "dynamodb:PutItem",
        ]
        Resource = aws_dynamodb_table.jobs.arn
      },
      {
        Effect = "Allow"
        Action = [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
        ]
        Resource = aws_sqs_queue.jobs.arn
      }
    ]
  })
}

resource "aws_lambda_function" "orchestrator" {
  function_name    = "${var.service_name}-orchestrator"
  role             = aws_iam_role.lambda_orchestrator.arn
  filename         = "${path.module}/../backend/orchestrator/orchestrator.zip"
  source_code_hash = fileexists("${path.module}/../backend/orchestrator/orchestrator.zip") ? filebase64sha256("${path.module}/../backend/orchestrator/orchestrator.zip") : null
  handler          = "handler.handler"
  runtime          = "python3.12"
  timeout          = 900
  memory_size      = 1024

  environment {
    variables = {
      BEDROCK_MODEL_ID       = var.bedrock_model_id
      LLM_BACKEND            = "bedrock"
      LLM_MODEL              = var.bedrock_model_id
      AWS_REGION_NAME        = var.region
      JOBS_TABLE             = aws_dynamodb_table.jobs.name
      DISCOVERY_FUNCTION     = aws_lambda_function.discovery_agent.function_name
      INVESTIGATION_FUNCTION = aws_lambda_function.investigation_agent.function_name
      VALIDATOR_FUNCTION     = aws_lambda_function.validator_agent.function_name
      NARRATIVE_FUNCTION     = aws_lambda_function.narrative_agent.function_name
    }
  }

  depends_on = [aws_iam_role_policy_attachment.lambda_orchestrator_basic]
}

resource "aws_lambda_event_source_mapping" "orchestrator_sqs" {
  event_source_arn = aws_sqs_queue.jobs.arn
  function_name    = aws_lambda_function.orchestrator.arn
  batch_size       = 1
}

# ── Smoke-test scheduler ───────────────────────────────────────────────────────

resource "aws_iam_role" "lambda_scheduler" {
  name = "${var.service_name}-lambda-scheduler"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "lambda_scheduler_basic" {
  role       = aws_iam_role.lambda_scheduler.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "lambda_scheduler_metrics" {
  name = "cloudwatch-metrics"
  role = aws_iam_role.lambda_scheduler.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["cloudwatch:PutMetricData"]
      Resource = "*"
    }]
  })
}

resource "aws_lambda_function" "scheduler" {
  function_name    = "${var.service_name}-scheduler"
  role             = aws_iam_role.lambda_scheduler.arn
  filename         = "${path.module}/../backend/scheduler/scheduler.zip"
  source_code_hash = fileexists("${path.module}/../backend/scheduler/scheduler.zip") ? filebase64sha256("${path.module}/../backend/scheduler/scheduler.zip") : null
  handler          = "handler.handler"
  runtime          = "python3.12"
  timeout          = 60
  memory_size      = 256

  environment {
    variables = {
      APP_RUNNER_URL = "https://${aws_apprunner_service.app.service_url}"
      SERVICE_NAME   = var.service_name
    }
  }

  depends_on = [aws_iam_role_policy_attachment.lambda_scheduler_basic]
}

resource "aws_iam_role" "scheduler_invoke" {
  name = "${var.service_name}-scheduler-invoke"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "scheduler.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "scheduler_invoke" {
  name = "invoke-lambda"
  role = aws_iam_role.scheduler_invoke.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["lambda:InvokeFunction"]
      Resource = aws_lambda_function.scheduler.arn
    }]
  })
}

resource "aws_scheduler_schedule" "smoke_test" {
  name = "${var.service_name}-smoke-test"

  flexible_time_window {
    mode = "OFF"
  }

  schedule_expression = "rate(5 minutes)"

  target {
    arn      = aws_lambda_function.scheduler.arn
    role_arn = aws_iam_role.scheduler_invoke.arn
  }
}

# ── Outputs ────────────────────────────────────────────────────────────────────

output "service_url" {
  value       = "https://${aws_apprunner_service.app.service_url}"
  description = "Public URL of the App Runner service (frontend + API)"
}

output "ecr_repository_url" {
  value       = aws_ecr_repository.app.repository_url
  description = "ECR repository URL"
}

output "jobs_table_name" {
  value = aws_dynamodb_table.jobs.name
}

output "queue_url" {
  value = aws_sqs_queue.jobs.url
}
