data "aws_availability_zones" "available" {
  state = "available"
}

resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags                 = { Name = local.name }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = local.name }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.main.id
  cidr_block              = var.public_subnet_cidrs[count.index]
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true
  tags                    = { Name = "${local.name}-public-${local.azs[count.index]}" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  tags   = { Name = "${local.name}-public" }
}

resource "aws_route" "default_igw" {
  route_table_id         = aws_route_table.public.id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.main.id
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

# Free S3 traffic (image reads/writes to the regional endpoint) stays off the
# internet gateway.
resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${var.region}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id]
  tags              = { Name = "${local.name}-s3" }
}

# --- MongoDB Atlas VPC peering (optional second apply) ----------------------
resource "aws_vpc_peering_connection_accepter" "atlas" {
  count                     = var.atlas_peering_connection_id == "" ? 0 : 1
  vpc_peering_connection_id = var.atlas_peering_connection_id
  auto_accept               = true
  tags                      = { Name = "${local.name}-atlas" }
}

resource "aws_route" "atlas" {
  count                     = var.atlas_peering_connection_id == "" ? 0 : 1
  route_table_id            = aws_route_table.public.id
  destination_cidr_block    = var.atlas_cidr
  vpc_peering_connection_id = var.atlas_peering_connection_id
  depends_on                = [aws_vpc_peering_connection_accepter.atlas]
}
