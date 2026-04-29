variable "region" {
  description = "AWS region"
  type        = string
  default     = "us-west-2"
}

variable "service_name" {
  description = "Name prefix for App Runner, ECR, Lambdas, IAM, SQS, DynamoDB"
  type        = string
  default     = "vendor-agent"
}

variable "bedrock_model_id" {
  description = "Amazon Bedrock model ID used by all agents"
  type        = string
  default     = "openai.gpt-oss-120b-1:0"
}

variable "docker_image_tag" {
  description = "Tag for the App Runner Docker image"
  type        = string
  default     = "latest"
}

variable "pg_dsn" {
  description = "Read-only Postgres DSN passed to Lambdas + App Runner. Defaults to the Render replica from .env.example."
  type        = string
  default     = ""
  sensitive   = true
}
