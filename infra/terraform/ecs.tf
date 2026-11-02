resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${local.name}-web"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "capture" {
  name              = "/ecs/${local.name}-capture"
  retention_in_days = 30
}

locals {
  web_image     = "${aws_ecr_repository.repo["${local.name}-web"].repository_url}:${var.image_tag}"
  capture_image = "${aws_ecr_repository.repo["${local.name}-capture"].repository_url}:${var.image_tag}"

  common_aws_env = [
    { name = "AWS_REGION", value = var.region },
    { name = "AWS_S3_BUCKET", value = var.s3_bucket_name },
    { name = "AWS_S3_BASE_URL", value = var.s3_base_url },
    { name = "AWS_S3_ROLE_ARN", value = var.s3_cross_account_role_arn },
    { name = "NODE_ENV", value = "production" },
  ]

  # When S3 access uses keys (not a cross-account role), inject them so the
  # SDK's default credential chain picks them up. AWS_S3_ROLE_ARN stays empty,
  # so lib/s3.js / store.js fall back to the default chain.
  s3_key_env    = var.s3_access_key_id != "" ? [{ name = "AWS_ACCESS_KEY_ID", value = var.s3_access_key_id }] : []
  s3_key_secret = var.s3_access_key_id != "" ? [{ name = "AWS_SECRET_ACCESS_KEY", valueFrom = aws_secretsmanager_secret.s3_key.arn }] : []
}

# --- Web task definition ----------------------------------------------------
resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.web_task.arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name      = "web"
    image     = local.web_image
    essential = true
    portMappings = [{
      containerPort = 3000
      protocol      = "tcp"
    }]
    environment = concat(local.common_aws_env, local.s3_key_env, [
      { name = "PORT", value = "3000" },
      { name = "HOSTNAME", value = "0.0.0.0" },
      { name = "EVENTS_TTL_DAYS", value = tostring(var.events_ttl_days) },
    ])
    secrets = concat([
      { name = "MONGODB_URI", valueFrom = aws_secretsmanager_secret.mongo_web.arn },
    ], local.s3_key_secret)
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.web.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

# --- Capture task definition ------------------------------------------------
resource "aws_ecs_task_definition" "capture" {
  family                   = "${local.name}-capture"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.capture_cpu
  memory                   = var.capture_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.capture_task.arn

  runtime_platform {
    cpu_architecture        = "ARM64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([{
    name        = "capture"
    image       = local.capture_image
    essential   = true
    stopTimeout = 60
    environment = concat(local.common_aws_env, local.s3_key_env, [
      { name = "CAPTURE_CONCURRENCY", value = "3" },
    ])
    secrets = concat([
      { name = "MONGODB_URI", valueFrom = aws_secretsmanager_secret.mongo_capture.arn },
    ], local.s3_key_secret)
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.capture.name
        "awslogs-region"        = var.region
        "awslogs-stream-prefix" = "ecs"
      }
    }
  }])
}

# --- Web service (behind the ALB) -------------------------------------------
resource "aws_ecs_service" "web" {
  count                  = var.create_services ? 1 : 0
  name                   = "${local.name}-web"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.web.arn
  desired_count          = var.web_min_tasks
  enable_execute_command = true

  capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 1
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.web_tasks.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  health_check_grace_period_seconds = 120

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # CI owns image rollouts (register new task def + update service), so ignore
  # drift Terraform would otherwise try to revert.
  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  depends_on = [aws_lb_listener.https]
}

# --- Capture service (Fargate Spot, no load balancer) -----------------------
resource "aws_ecs_service" "capture" {
  count                  = var.create_services ? 1 : 0
  name                   = "${local.name}-capture"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.capture.arn
  desired_count          = 1
  enable_execute_command = true

  capacity_provider_strategy {
    capacity_provider = "FARGATE_SPOT"
    weight            = 1
  }

  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.capture_tasks.id]
    assign_public_ip = true
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }
}

# --- Web autoscaling --------------------------------------------------------
resource "aws_appautoscaling_target" "web" {
  count              = var.create_services ? 1 : 0
  max_capacity       = var.web_max_tasks
  min_capacity       = var.web_min_tasks
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.web[0].name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "web_cpu" {
  count              = var.create_services ? 1 : 0
  name               = "${local.name}-web-cpu"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.web[0].resource_id
  scalable_dimension = aws_appautoscaling_target.web[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.web[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = 60
    scale_in_cooldown  = 120
    scale_out_cooldown = 60
  }
}
