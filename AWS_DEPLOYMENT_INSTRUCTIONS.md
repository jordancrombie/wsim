# WSIM AWS Production Deployment Instructions

## For the BSIM Team

This document provides instructions for deploying WSIM (Wallet Simulator) to AWS production alongside the existing BSIM ecosystem.

---

## Overview

WSIM adds **3 new services** to the BSIM ecosystem:

| Service | Subdomain | Port | Description |
|---------|-----------|------|-------------|
| **wsim-backend** | `wsim.banksim.ca` (via nginx path `/api`) | 3003 | Wallet API server |
| **wsim-auth-server** | `wsim-auth.banksim.ca` | 3005 | OIDC provider for wallet |
| **wsim-frontend** | `wsim.banksim.ca` | 3000 | Wallet UI (Next.js) |

All services share the existing BSIM infrastructure:
- VPC, subnets, security groups
- Application Load Balancer
- RDS PostgreSQL (separate database: `wsim`)
- SSL certificate (`*.banksim.ca`)

---

## ⚠️ CRITICAL: Required Database Setup

> **IMPORTANT:** Complete these database steps BEFORE testing the enrollment flow.
> Without this setup, users will see OAuth errors when trying to enroll banks.

### 1. Register WSIM as OAuth Client in BSIM Database

WSIM needs to authenticate with BSIM to enroll bank accounts. This OAuth client must be registered in the **BSIM database** (not WSIM).

> ⚠️ **IMPORTANT:** The BSIM `oauth_clients` table uses `scope` (singular, space-separated string), NOT `scopes` (array).

```sql
-- =====================================================
-- RUN THIS IN THE BSIM DATABASE (bsim, not wsim!)
-- Table name is: oauth_clients (lowercase with underscore)
-- =====================================================

-- First, generate a client secret (run this in bash):
-- openssl rand -base64 32
-- Example output: K7xPq2mN8vR3sT6wY9zA1bC4dE5fG8hJ0kL2mN3oP4qR

INSERT INTO oauth_clients (
  "id",
  "clientId",
  "clientSecret",
  "clientName",
  "redirectUris",
  "grantTypes",
  "responseTypes",
  "scope",              -- ⚠️ SINGULAR (not "scopes")
  "contacts",
  "createdAt",
  "updatedAt"
) VALUES (
  gen_random_uuid(),
  'wsim-wallet',
  'YOUR_GENERATED_SECRET_HERE',  -- ← Replace with generated secret
  'WSIM Wallet',
  ARRAY['https://wsim.banksim.ca/api/enrollment/callback'],
  ARRAY['authorization_code'],   -- ⚠️ ONLY authorization_code (NOT refresh_token!)
  ARRAY['code'],
  'openid profile email wallet:enroll',  -- ⚠️ SPACE-SEPARATED STRING (not array!)
  ARRAY[]::text[],               -- Empty contacts array
  NOW(),
  NOW()
);

-- Verify it was created:
SELECT "clientId", "grantTypes", "scope" FROM oauth_clients WHERE "clientId" = 'wsim-wallet';

-- Expected output:
--  clientId    |      grantTypes       |                scope
-- -------------+-----------------------+--------------------------------------
--  wsim-wallet | {authorization_code}  | openid profile email wallet:enroll
```

**Common Mistakes (will cause OAuth errors):**
| Mistake | Error Message | Fix |
|---------|--------------|-----|
| Using `"scopes"` (array) instead of `"scope"` (string) | Column doesn't exist or scope validation fails | Use `"scope"` with space-separated string |
| Using array syntax for scope | "scope must only contain supported scope values" | Use `'openid profile email wallet:enroll'` (space-separated) |
| `grantTypes` includes `refresh_token` | "grant_types can only contain 'implicit' or 'authorization_code'" | Use only `ARRAY['authorization_code']` |
| `scope` includes `wallet:cards` | "scope must only contain supported scope values" | Use `wallet:enroll` instead |
| Wrong database | Client not found | Run in BSIM database, not WSIM |
| Wrong table name | Table doesn't exist | Use `oauth_clients` (lowercase with underscore) |

### 2. Configure WSIM Backend with BSIM Client Secret

The same client secret from step 1 must be configured in the WSIM backend's `BSIM_PROVIDERS` environment variable:

```json
{
  "name": "BSIM_PROVIDERS",
  "value": "[{\"bsimId\":\"bsim\",\"name\":\"Bank Simulator\",\"issuer\":\"https://auth.banksim.ca\",\"apiUrl\":\"https://banksim.ca\",\"clientId\":\"wsim-wallet\",\"clientSecret\":\"YOUR_GENERATED_SECRET_HERE\"}]"
}
```

**The `clientSecret` in BSIM_PROVIDERS must match the `clientSecret` in the OAuthClient table.**

### 3. Register SSIM as OAuth Client in WSIM Database (Required for SSIM)

**Required** if SSIM will use "Pay with Wallet" feature.

```bash
# First, generate the secrets you'll need:
# Client Secret:
openssl rand -base64 32
# Example output: K7xPq2mN8vR3sT6wY9zA1bC4dE5fG8hJ0kL2mN3oP4qR

# API Key:
echo "wsim_api_$(openssl rand -hex 16)"
# Example output: wsim_api_a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6
```

```sql
-- =====================================================
-- RUN THIS IN THE WSIM DATABASE (wsim, not bsim!)
-- Table name is: "OAuthClient" (PascalCase with quotes)
-- =====================================================

INSERT INTO "OAuthClient" (
  "id",
  "clientId",
  "clientSecret",
  "clientName",
  "redirectUris",
  "postLogoutRedirectUris",
  "grantTypes",
  "scope",                    -- ⚠️ SINGULAR, space-separated string
  "logoUri",
  "trusted",
  "apiKey",
  "createdAt",
  "updatedAt"
) VALUES (
  gen_random_uuid(),
  'ssim-merchant',
  'YOUR_GENERATED_CLIENT_SECRET',   -- ← Replace with generated secret
  'Store Simulator',
  ARRAY['https://ssim.banksim.ca/payment/wallet-callback'],
  ARRAY[]::text[],
  ARRAY['authorization_code'],
  'openid payment:authorize',        -- ⚠️ Space-separated string (not array!)
  NULL,
  false,
  'wsim_api_YOUR_GENERATED_HEX',    -- ← Replace with generated API key
  NOW(),
  NOW()
);

-- Verify it was created and get the values for SSIM config:
SELECT "clientId", "clientSecret", "apiKey", "redirectUris", "scope"
FROM "OAuthClient"
WHERE "clientId" = 'ssim-merchant';
```

**After running the SQL, configure SSIM with these environment variables:**

| SSIM Env Variable | Value | Source |
|-------------------|-------|--------|
| `WSIM_CLIENT_ID` | `ssim-merchant` | Fixed value |
| `WSIM_CLIENT_SECRET` | (from SQL output) | The `clientSecret` you generated |
| `WSIM_API_KEY` | (from SQL output) | The `apiKey` you generated |
| `WSIM_ISSUER` | `https://wsim-auth.banksim.ca` | WSIM's OIDC issuer |
| `WSIM_REDIRECT_URI` | `https://ssim.banksim.ca/payment/wallet-callback` | Must match `redirectUris` |

**Important:** The `clientSecret` and `apiKey` in SSIM's config must exactly match what you inserted into WSIM's database.

---

## Prerequisites

Before deploying WSIM, ensure:

1. **BSIM infrastructure is deployed** (VPC, ALB, RDS, ECS cluster)
2. **WSIM repository cloned** as sibling to BSIM:
   ```
   ~/projects/
   ├── bsim/
   ├── wsim/    ← This repo
   └── ssim/
   ```
3. **AWS CLI configured** with the banksim_ca_user credentials

---

## Step 1: Create WSIM Database

WSIM uses a separate PostgreSQL database (not the same as BSIM) to avoid Prisma schema conflicts.

```bash
# Connect to RDS and create the wsim database
PGPASSWORD=8O9MwSmoA1IUQfOZyw7H4L2lDoeA2M8w psql \
  -h bsim-db.cb80gi4u4k7g.ca-central-1.rds.amazonaws.com \
  -U bsimadmin \
  -d postgres \
  -c "CREATE DATABASE wsim;"
```

Or via an ECS task that runs the BSIM backend with a one-time command:
```bash
aws ecs run-task \
  --cluster bsim-cluster \
  --task-definition bsim-backend \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-0a02b8f394914dabd,subnet-03d015986a76a2677],securityGroups=[sg-06aaaf996187d82fc],assignPublicIp=ENABLED}" \
  --overrides '{"containerOverrides":[{"name":"backend","command":["node","-e","const{Client}=require(\"pg\");const c=new Client({connectionString:\"postgresql://bsimadmin:8O9MwSmoA1IUQfOZyw7H4L2lDoeA2M8w@bsim-db.cb80gi4u4k7g.ca-central-1.rds.amazonaws.com:5432/postgres\"});c.connect().then(()=>c.query(\"CREATE DATABASE wsim\")).then(()=>console.log(\"WSIM database created\")).catch(e=>console.log(e.message)).finally(()=>c.end())"]}]}' \
  --region ca-central-1
```

---

## Step 2: Create ECR Repositories

```bash
# Create repositories for all 3 WSIM services
aws ecr create-repository --repository-name wsim/backend --region ca-central-1
aws ecr create-repository --repository-name wsim/auth-server --region ca-central-1
aws ecr create-repository --repository-name wsim/frontend --region ca-central-1
```

---

## Step 3: Build and Push Docker Images

**IMPORTANT:** Build with `--platform linux/amd64` for ECS Fargate.

```bash
# Login to ECR
aws ecr get-login-password --region ca-central-1 | docker login --username AWS --password-stdin 301868770392.dkr.ecr.ca-central-1.amazonaws.com

# Navigate to WSIM repo
cd ~/projects/wsim

# Build and push Backend
docker build --platform linux/amd64 -t wsim/backend ./backend
docker tag wsim/backend:latest 301868770392.dkr.ecr.ca-central-1.amazonaws.com/wsim/backend:latest
docker push 301868770392.dkr.ecr.ca-central-1.amazonaws.com/wsim/backend:latest

# Build and push Auth Server
docker build --platform linux/amd64 -t wsim/auth-server ./auth-server
docker tag wsim/auth-server:latest 301868770392.dkr.ecr.ca-central-1.amazonaws.com/wsim/auth-server:latest
docker push 301868770392.dkr.ecr.ca-central-1.amazonaws.com/wsim/auth-server:latest

# Build and push Frontend (REQUIRES build args!)
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_API_URL=https://wsim.banksim.ca/api \
  --build-arg NEXT_PUBLIC_AUTH_URL=https://wsim-auth.banksim.ca \
  -t wsim/frontend ./frontend
docker tag wsim/frontend:latest 301868770392.dkr.ecr.ca-central-1.amazonaws.com/wsim/frontend:latest
docker push 301868770392.dkr.ecr.ca-central-1.amazonaws.com/wsim/frontend:latest
```

---

## Step 4: Create CloudWatch Log Groups

```bash
aws logs create-log-group --log-group-name /ecs/wsim-backend --region ca-central-1
aws logs create-log-group --log-group-name /ecs/wsim-auth-server --region ca-central-1
aws logs create-log-group --log-group-name /ecs/wsim-frontend --region ca-central-1
```

---

## Step 5: Add Security Group Rules

Allow ALB to reach WSIM services:

```bash
# Add ports for WSIM services to bsim-ecs-sg
for port in 3003 3005; do
  aws ec2 authorize-security-group-ingress \
    --group-id sg-06aaaf996187d82fc \
    --protocol tcp \
    --port $port \
    --source-group sg-09c7dc697ef09a779 \
    --region ca-central-1
done

# Port 3000 should already exist for BSIM frontend
# If not, add it too
aws ec2 authorize-security-group-ingress \
  --group-id sg-06aaaf996187d82fc \
  --protocol tcp \
  --port 3000 \
  --source-group sg-09c7dc697ef09a779 \
  --region ca-central-1
```

---

## Step 6: Create Target Groups

```bash
# WSIM Backend Target Group (port 3003)
aws elbv2 create-target-group \
  --name wsim-backend-tg \
  --protocol HTTP \
  --port 3003 \
  --vpc-id vpc-0c69941007c671517 \
  --target-type ip \
  --health-check-path /health \
  --health-check-interval-seconds 30 \
  --health-check-timeout-seconds 5 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3 \
  --region ca-central-1

# WSIM Auth Server Target Group (port 3005)
aws elbv2 create-target-group \
  --name wsim-auth-server-tg \
  --protocol HTTP \
  --port 3005 \
  --vpc-id vpc-0c69941007c671517 \
  --target-type ip \
  --health-check-path /health \
  --health-check-interval-seconds 30 \
  --health-check-timeout-seconds 5 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3 \
  --region ca-central-1

# WSIM Frontend Target Group (port 3000)
aws elbv2 create-target-group \
  --name wsim-frontend-tg \
  --protocol HTTP \
  --port 3000 \
  --vpc-id vpc-0c69941007c671517 \
  --target-type ip \
  --health-check-path / \
  --health-check-interval-seconds 30 \
  --health-check-timeout-seconds 5 \
  --healthy-threshold-count 2 \
  --unhealthy-threshold-count 3 \
  --region ca-central-1
```

---

## Step 7: Create ECS Task Definitions

### wsim-backend-task-definition.json

```json
{
  "family": "wsim-backend",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::301868770392:role/bsim-ecs-task-execution-role",
  "containerDefinitions": [
    {
      "name": "wsim-backend",
      "image": "301868770392.dkr.ecr.ca-central-1.amazonaws.com/wsim/backend:latest",
      "portMappings": [
        {
          "containerPort": 3003,
          "protocol": "tcp"
        }
      ],
      "essential": true,
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "PORT", "value": "3003" },
        { "name": "DATABASE_URL", "value": "postgresql://bsimadmin:8O9MwSmoA1IUQfOZyw7H4L2lDoeA2M8w@bsim-db.cb80gi4u4k7g.ca-central-1.rds.amazonaws.com:5432/wsim" },
        { "name": "APP_URL", "value": "https://wsim.banksim.ca" },
        { "name": "FRONTEND_URL", "value": "https://wsim.banksim.ca" },
        { "name": "AUTH_SERVER_URL", "value": "https://wsim-auth.banksim.ca" },
        { "name": "JWT_SECRET", "value": "GENERATE_A_SECURE_SECRET_HERE" },
        { "name": "SESSION_SECRET", "value": "GENERATE_A_SECURE_SECRET_HERE" },
        { "name": "ENCRYPTION_KEY", "value": "GENERATE_32_CHAR_ENCRYPTION_KEY" },
        { "name": "INTERNAL_API_SECRET", "value": "GENERATE_A_SECURE_SECRET_HERE" },
        { "name": "CORS_ORIGINS", "value": "https://wsim.banksim.ca,https://wsim-auth.banksim.ca,https://ssim.banksim.ca" },
        { "name": "WEBAUTHN_RP_NAME", "value": "WSIM Wallet" },
        { "name": "WEBAUTHN_RP_ID", "value": "banksim.ca" },
        { "name": "WEBAUTHN_ORIGINS", "value": "https://wsim.banksim.ca,https://wsim-auth.banksim.ca" },
        { "name": "BSIM_PROVIDERS", "value": "[{\"bsimId\":\"bsim\",\"name\":\"Bank Simulator\",\"issuer\":\"https://auth.banksim.ca\",\"apiUrl\":\"https://banksim.ca\",\"clientId\":\"wsim-wallet\",\"clientSecret\":\"BSIM_PROVIDES_THIS_SECRET\"}]" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/wsim-backend",
          "awslogs-region": "ca-central-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "node -e \"require('http').get('http://localhost:3003/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})\""],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
```

### wsim-auth-server-task-definition.json

```json
{
  "family": "wsim-auth-server",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "512",
  "memory": "1024",
  "executionRoleArn": "arn:aws:iam::301868770392:role/bsim-ecs-task-execution-role",
  "containerDefinitions": [
    {
      "name": "wsim-auth-server",
      "image": "301868770392.dkr.ecr.ca-central-1.amazonaws.com/wsim/auth-server:latest",
      "portMappings": [
        {
          "containerPort": 3005,
          "protocol": "tcp"
        }
      ],
      "essential": true,
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "PORT", "value": "3005" },
        { "name": "DATABASE_URL", "value": "postgresql://bsimadmin:8O9MwSmoA1IUQfOZyw7H4L2lDoeA2M8w@bsim-db.cb80gi4u4k7g.ca-central-1.rds.amazonaws.com:5432/wsim" },
        { "name": "ISSUER", "value": "https://wsim-auth.banksim.ca" },
        { "name": "BACKEND_URL", "value": "http://wsim-backend.bsim-internal:3003" },
        { "name": "FRONTEND_URL", "value": "https://wsim.banksim.ca" },
        { "name": "COOKIE_SECRET", "value": "GENERATE_A_SECURE_SECRET_HERE" },
        { "name": "INTERNAL_API_SECRET", "value": "SAME_AS_BACKEND_INTERNAL_SECRET" },
        { "name": "CORS_ORIGINS", "value": "https://wsim.banksim.ca,https://ssim.banksim.ca" },
        { "name": "WEBAUTHN_RP_NAME", "value": "WSIM Wallet" },
        { "name": "WEBAUTHN_RP_ID", "value": "banksim.ca" },
        { "name": "WEBAUTHN_ORIGINS", "value": "https://wsim.banksim.ca,https://wsim-auth.banksim.ca" },
        { "name": "ALLOWED_POPUP_ORIGINS", "value": "https://ssim.banksim.ca" },
        { "name": "ALLOWED_EMBED_ORIGINS", "value": "https://ssim.banksim.ca" },
        { "name": "AUTH_ADMIN_JWT_SECRET", "value": "GENERATE_A_SECURE_SECRET_HERE" },
        { "name": "AUTH_SERVER_URL", "value": "https://wsim-auth.banksim.ca" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/wsim-auth-server",
          "awslogs-region": "ca-central-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "node -e \"require('http').get('http://localhost:3005/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})\""],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
```

### wsim-frontend-task-definition.json

```json
{
  "family": "wsim-frontend",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "arn:aws:iam::301868770392:role/bsim-ecs-task-execution-role",
  "containerDefinitions": [
    {
      "name": "wsim-frontend",
      "image": "301868770392.dkr.ecr.ca-central-1.amazonaws.com/wsim/frontend:latest",
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "essential": true,
      "environment": [
        { "name": "NODE_ENV", "value": "production" },
        { "name": "PORT", "value": "3000" }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/wsim-frontend",
          "awslogs-region": "ca-central-1",
          "awslogs-stream-prefix": "ecs"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "node -e \"require('http').get('http://localhost:3000', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})\""],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
```

Register the task definitions:

```bash
aws ecs register-task-definition --cli-input-json file://wsim-backend-task-definition.json --region ca-central-1
aws ecs register-task-definition --cli-input-json file://wsim-auth-server-task-definition.json --region ca-central-1
aws ecs register-task-definition --cli-input-json file://wsim-frontend-task-definition.json --region ca-central-1
```

---

## Step 8: Create ALB Listener Rules

Add host-based routing rules to the existing HTTPS listener:

```bash
# Get the HTTPS listener ARN
LISTENER_ARN=$(aws elbv2 describe-listeners \
  --load-balancer-arn <ALB_ARN> \
  --query 'Listeners[?Protocol==`HTTPS`].ListenerArn' \
  --output text \
  --region ca-central-1)

# Get target group ARNs
WSIM_FRONTEND_TG=$(aws elbv2 describe-target-groups --names wsim-frontend-tg --query 'TargetGroups[0].TargetGroupArn' --output text --region ca-central-1)
WSIM_AUTH_TG=$(aws elbv2 describe-target-groups --names wsim-auth-server-tg --query 'TargetGroups[0].TargetGroupArn' --output text --region ca-central-1)
WSIM_BACKEND_TG=$(aws elbv2 describe-target-groups --names wsim-backend-tg --query 'TargetGroups[0].TargetGroupArn' --output text --region ca-central-1)

# Rule for wsim.banksim.ca (frontend + API via path-based routing)
# Priority should be higher than default (use 10, 11, 12 etc.)
aws elbv2 create-rule \
  --listener-arn $LISTENER_ARN \
  --priority 10 \
  --conditions '[{"Field":"host-header","Values":["wsim.banksim.ca"]},{"Field":"path-pattern","Values":["/api/*"]}]' \
  --actions Type=forward,TargetGroupArn=$WSIM_BACKEND_TG \
  --region ca-central-1

aws elbv2 create-rule \
  --listener-arn $LISTENER_ARN \
  --priority 11 \
  --conditions Field=host-header,Values=wsim.banksim.ca \
  --actions Type=forward,TargetGroupArn=$WSIM_FRONTEND_TG \
  --region ca-central-1

# Rule for wsim-auth.banksim.ca
aws elbv2 create-rule \
  --listener-arn $LISTENER_ARN \
  --priority 12 \
  --conditions Field=host-header,Values=wsim-auth.banksim.ca \
  --actions Type=forward,TargetGroupArn=$WSIM_AUTH_TG \
  --region ca-central-1
```

---

## Step 9: Create ECS Services

```bash
# WSIM Backend Service
aws ecs create-service \
  --cluster bsim-cluster \
  --service-name wsim-backend-service \
  --task-definition wsim-backend \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-0bb6a8a308c8e0671,subnet-002b78c53d968db85],securityGroups=[sg-06aaaf996187d82fc],assignPublicIp=DISABLED}" \
  --load-balancers targetGroupArn=$WSIM_BACKEND_TG,containerName=wsim-backend,containerPort=3003 \
  --region ca-central-1

# WSIM Auth Server Service
aws ecs create-service \
  --cluster bsim-cluster \
  --service-name wsim-auth-server-service \
  --task-definition wsim-auth-server \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-0bb6a8a308c8e0671,subnet-002b78c53d968db85],securityGroups=[sg-06aaaf996187d82fc],assignPublicIp=DISABLED}" \
  --load-balancers targetGroupArn=$WSIM_AUTH_TG,containerName=wsim-auth-server,containerPort=3005 \
  --region ca-central-1

# WSIM Frontend Service
aws ecs create-service \
  --cluster bsim-cluster \
  --service-name wsim-frontend-service \
  --task-definition wsim-frontend \
  --desired-count 1 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-0bb6a8a308c8e0671,subnet-002b78c53d968db85],securityGroups=[sg-06aaaf996187d82fc],assignPublicIp=DISABLED}" \
  --load-balancers targetGroupArn=$WSIM_FRONTEND_TG,containerName=wsim-frontend,containerPort=3000 \
  --region ca-central-1
```

---

## Step 10: Run Database Migrations

WSIM uses Prisma. Run migrations via a one-time task:

```bash
aws ecs run-task \
  --cluster bsim-cluster \
  --task-definition wsim-backend \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-0a02b8f394914dabd,subnet-03d015986a76a2677],securityGroups=[sg-06aaaf996187d82fc],assignPublicIp=ENABLED}" \
  --overrides '{"containerOverrides":[{"name":"wsim-backend","command":["npx","prisma","db","push","--skip-generate","--accept-data-loss"]}]}' \
  --region ca-central-1
```

---

## Step 11: Configure Route 53 DNS

Add A records (alias) pointing to the ALB:

| Record | Type | Alias Target |
|--------|------|--------------|
| `wsim.banksim.ca` | A (Alias) | bsim-alb |
| `wsim-auth.banksim.ca` | A (Alias) | bsim-alb |

```bash
# Get ALB hosted zone ID and DNS name
aws elbv2 describe-load-balancers --names bsim-alb --query 'LoadBalancers[0].[CanonicalHostedZoneId,DNSName]' --output text --region ca-central-1

# Create Route 53 records (use AWS Console or CLI)
# Example with CLI (replace with actual values):
# aws route53 change-resource-record-sets --hosted-zone-id Z00354511TXC0NR2LH3WH --change-batch file://route53-wsim.json
```

---

## Step 12: Verify Database Setup

Confirm the OAuth client registration from the "CRITICAL: Required Database Setup" section at the top of this document is complete:

```sql
-- In BSIM database: Verify WSIM client exists with correct values
SELECT "clientId", "grantTypes", "scope" FROM oauth_clients WHERE "clientId" = 'wsim-wallet';

-- Expected output:
--  clientId    |      grantTypes       |                scope
-- -------------+-----------------------+--------------------------------------
--  wsim-wallet | {authorization_code}  | openid profile email wallet:enroll
```

**Check for common issues:**
```sql
-- If scope shows as an array like {openid,profile,...}, it's WRONG
-- Fix with:
UPDATE oauth_clients
SET "scope" = 'openid profile email wallet:enroll'
WHERE "clientId" = 'wsim-wallet';
```

If the client doesn't exist or has wrong values, go back to the "CRITICAL: Required Database Setup" section.

---

## Environment Variables Summary

### Secrets to Generate

Generate secure random values for these secrets:

| Variable | Service | Notes |
|----------|---------|-------|
| `JWT_SECRET` | wsim-backend | 32+ chars |
| `SESSION_SECRET` | wsim-backend | 32+ chars |
| `ENCRYPTION_KEY` | wsim-backend | Exactly 32 chars (AES-256) |
| `INTERNAL_API_SECRET` | wsim-backend, wsim-auth-server | Must match between services |
| `COOKIE_SECRET` | wsim-auth-server | 32+ chars |
| `AUTH_ADMIN_JWT_SECRET` | wsim-auth-server | 32+ chars, for admin sessions |
| `BSIM_CLIENT_SECRET` | wsim-backend | Get from BSIM team |

### Non-Secret Environment Variables

| Variable | Service | Value |
|----------|---------|-------|
| `AUTH_SERVER_URL` | wsim-auth-server | `https://wsim-auth.banksim.ca` |

### Generate Secrets

```bash
# Generate random 32-char secret
openssl rand -base64 32

# Generate exactly 32-char encryption key
openssl rand -hex 16
```

---

## Testing Production Deployment

After deployment, verify each component:

```bash
# Health checks
curl https://wsim.banksim.ca/api/health
curl https://wsim-auth.banksim.ca/health
curl https://wsim.banksim.ca

# OIDC discovery
curl https://wsim-auth.banksim.ca/.well-known/openid-configuration

# View logs
aws logs tail /ecs/wsim-backend --follow --region ca-central-1
aws logs tail /ecs/wsim-auth-server --follow --region ca-central-1
aws logs tail /ecs/wsim-frontend --follow --region ca-central-1
```

---

## Cost Estimate

Additional costs for WSIM services:

| Resource | Estimate |
|----------|----------|
| 3x ECS Fargate tasks (0.5 vCPU, 1GB each) | ~$25-35/month |
| Additional ALB rules | Included in ALB cost |
| CloudWatch Logs | ~$2-5/month |
| **Total Additional** | ~$30-40/month |

---

## Updating WSIM

To deploy updates:

```bash
# Build and push new images
cd ~/projects/wsim
docker build --platform linux/amd64 -t wsim/backend ./backend
docker tag wsim/backend:latest 301868770392.dkr.ecr.ca-central-1.amazonaws.com/wsim/backend:latest
docker push 301868770392.dkr.ecr.ca-central-1.amazonaws.com/wsim/backend:latest

# Force new deployment
aws ecs update-service \
  --cluster bsim-cluster \
  --service wsim-backend-service \
  --force-new-deployment \
  --region ca-central-1
```

---

## Rollback

If issues occur:

1. **Scale services to 0:**
   ```bash
   aws ecs update-service --cluster bsim-cluster --service wsim-backend-service --desired-count 0 --region ca-central-1
   ```

2. **Check logs:**
   ```bash
   aws logs tail /ecs/wsim-backend --since 1h --region ca-central-1
   ```

3. **Roll back to previous task definition:**
   ```bash
   aws ecs update-service --cluster bsim-cluster --service wsim-backend-service --task-definition wsim-backend:PREVIOUS_VERSION --region ca-central-1
   ```

---

## Troubleshooting: Cards Not Appearing After Enrollment

If users complete enrollment successfully (bank shows as connected) but cards don't appear:

### 1. Check WSIM Backend Logs for Card Fetch Errors

```bash
# AWS Production
aws logs tail /ecs/wsim-backend --filter-pattern "Enrollment" --region ca-central-1

# Look for these log messages:
# ✓ Good: "[Enrollment] Got 3 cards from bsim"
# ✗ Bad:  "[Enrollment] No wallet_credential in token response"
# ✗ Bad:  "[Enrollment] Failed to fetch cards:"
```

### 2. Verify `wallet_credential` is in Token Response

The most common cause is BSIM not including `wallet_credential` in the access token. This happens if:
- The `wallet:enroll` scope wasn't granted during consent
- BSIM's grant doesn't have `walletCredentialToken` stored

**Check WSIM logs for:**
```
[Enrollment] No wallet_credential in token response - BSIM may not have granted wallet:enroll scope
```

### 3. Verify Cards Exist in WSIM Database

```sql
-- Connect to WSIM database
-- Check if enrollment exists
SELECT id, "bsimId", "fiUserRef", "createdAt"
FROM "BsimEnrollment"
WHERE "bsimId" = 'bsim';

-- Check if cards were stored
SELECT wc.id, wc."cardType", wc."lastFour", wc."createdAt"
FROM "WalletCard" wc
JOIN "BsimEnrollment" be ON wc."enrollmentId" = be.id
WHERE be."bsimId" = 'bsim';
```

If enrollment exists but no cards, the issue is card fetching.
If cards exist, the issue is on the frontend display.

### 4. Verify BSIM OAuth Client Has `wallet:enroll` Scope

```sql
-- In BSIM database
SELECT "clientId", scope FROM oauth_clients WHERE "clientId" = 'wsim-wallet';

-- scope MUST include 'wallet:enroll'
-- Expected: 'openid profile email wallet:enroll'
```

### 5. Test Card Fetch Endpoint Directly (Local Development)

If you have access to a wallet credential, test the BSIM API directly:

```bash
# Replace with actual wallet credential from logs
curl -H "Authorization: Bearer wcred_xxxx" \
  https://banksim.ca/api/wallet/cards
```

### 6. Check BSIM Wallet Credential Generation

BSIM generates wallet credentials during the consent/interaction flow. The credential is stored in the Grant and then added to the access token via `extraTokenClaims`. Check BSIM auth-server logs:

```bash
# Look for wallet credential generation
aws logs tail /ecs/bsim-auth-server --filter-pattern "wallet_credential" --region ca-central-1
```

### Root Cause Summary

| Symptom | Cause | Fix |
|---------|-------|-----|
| Log shows "No wallet_credential in token response" | BSIM not granting `wallet:enroll` scope | Verify OAuth client has `wallet:enroll` in scope |
| Log shows "Failed to fetch cards" with 401 | Using access token instead of wallet credential | BSIM issue - wallet credential not in token |
| Log shows "Failed to fetch cards" with 404 | Wrong API URL | Check `apiUrl` in BSIM_PROVIDERS matches BSIM API |
| No card fetch log at all | Code error or enrollment failed earlier | Check for earlier errors in enrollment flow |
| Cards in DB but not in UI | Frontend issue | Check `/api/cards` endpoint and frontend |

---

## Troubleshooting: SSIM OAuth Errors (`invalid_client`)

When SSIM tries to start the wallet payment flow and gets `invalid_client`:

### 1. Verify OAuth Client Exists in WSIM Database

```sql
-- Run in WSIM database
SELECT "clientId", "redirectUris", "scope", "grantTypes"
FROM "OAuthClient"
WHERE "clientId" = 'ssim-merchant';
```

If no rows returned, create the client using the SQL in Section 3 above.

### 2. Restart WSIM Auth-Server After Adding Client

**Important:** WSIM's auth-server loads OAuth clients at startup. If you added the client after the service started, you must restart:

```bash
aws ecs update-service \
  --cluster bsim-cluster \
  --service wsim-auth-server-service \
  --force-new-deployment \
  --region ca-central-1
```

### 3. Verify Redirect URI Matches Exactly

The redirect URI in SSIM's config must **exactly** match what's in WSIM's database:
- SSIM: `WSIM_REDIRECT_URI=https://ssim.banksim.ca/payment/wallet-callback`
- WSIM DB: `redirectUris` array must include this exact URL

---

## Troubleshooting: Popup/Embed 404 Errors

If SSIM's popup/embed wallet flows show 404 errors:

### Check the URL Pattern

**Broken URLs (wrong):**
```
https://wsim.banksim.ca/payment/popup/popup/card-picker  ❌ (double /popup)
https://wsim.banksim.ca/popup/card-picker               ❌ (wrong host)
```

**Correct URLs:**
```
https://wsim-auth.banksim.ca/popup/card-picker          ✓
https://wsim-auth.banksim.ca/embed/card-picker          ✓
```

### Fix: Set `WSIM_POPUP_URL` Correctly in SSIM

The popup/embed endpoints are on the **auth-server**, not the frontend.

```bash
# Check current SSIM config
aws ecs describe-task-definition --task-definition ssim \
  --query 'taskDefinition.containerDefinitions[0].environment' \
  --region ca-central-1 | grep -A1 WSIM_POPUP

# Correct value:
WSIM_POPUP_URL=https://wsim-auth.banksim.ca
```

### URL Reference

| SSIM Env Variable | Correct Value | Purpose |
|-------------------|---------------|---------|
| `WSIM_POPUP_URL` | `https://wsim-auth.banksim.ca` | Popup/embed card picker |
| `WSIM_AUTH_URL` | `https://wsim-auth.banksim.ca` | OIDC authorization |
| `WSIM_ISSUER` | `https://wsim-auth.banksim.ca` | OIDC issuer (same as auth) |
| `WSIM_API_URL` | `https://wsim.banksim.ca` | Backend API (if used) |

---

## Troubleshooting: "Failed to get Payment Token"

This error appears in the popup/embed when passkey verification succeeds but token generation fails.

### Error Flow
```
User selects card → Passkey verified ✓ → Auth-server calls Backend → Backend calls BSIM → FAILS
```

### 1. Check WSIM Backend Logs

```bash
aws logs tail /ecs/wsim-backend --filter-pattern "Payment" --region ca-central-1
```

Look for:
- `[Payment] Requesting card token from https://...` - Shows the BSIM URL being called
- `[Payment] BSIM token request failed: XXX` - Shows the actual error

### 2. Check WSIM Auth-Server Logs

```bash
aws logs tail /ecs/wsim-auth-server --filter-pattern "Embed\|Popup" --region ca-central-1
```

Look for:
- `[Embed] Failed to get card token:` - Shows response from backend

### 3. Verify `INTERNAL_API_SECRET` Matches

The secret must be **identical** in both WSIM services:

```bash
# Get backend secret
aws ecs describe-task-definition --task-definition wsim-backend \
  --query 'taskDefinition.containerDefinitions[0].environment[?name==`INTERNAL_API_SECRET`].value' \
  --output text --region ca-central-1

# Get auth-server secret
aws ecs describe-task-definition --task-definition wsim-auth-server \
  --query 'taskDefinition.containerDefinitions[0].environment[?name==`INTERNAL_API_SECRET`].value' \
  --output text --region ca-central-1
```

If they don't match, update one and redeploy.

### 4. Verify BSIM `/api/wallet/tokens` Endpoint Exists

WSIM's backend calls BSIM at `/api/wallet/tokens` to get payment card tokens. Test it:

```bash
curl -X POST https://banksim.ca/api/wallet/tokens \
  -H "Content-Type: application/json" \
  -d '{"cardId":"test"}'
```

- If 404: BSIM endpoint doesn't exist (BSIM issue)
- If 401: Wallet credential expired or invalid
- If 200: Endpoint works, issue is elsewhere

### 5. Check `BSIM_PROVIDERS` Configuration

```bash
aws ecs describe-task-definition --task-definition wsim-backend \
  --query 'taskDefinition.containerDefinitions[0].environment[?name==`BSIM_PROVIDERS`].value' \
  --output text --region ca-central-1
```

Verify:
- `apiUrl` is correct (e.g., `https://banksim.ca`)
- `bsimId` matches what's stored in enrollments

### Root Cause Summary

| Error in Logs | Cause | Fix |
|---------------|-------|-----|
| `unauthorized` from backend | `INTERNAL_API_SECRET` mismatch | Sync secret between auth-server and backend |
| `not_found` for card | Card doesn't exist in WSIM DB | Re-enroll with BSIM |
| `provider_not_found` | `BSIM_PROVIDERS` misconfigured | Fix env var in backend task definition |
| `bsim_error` with 404 | BSIM `/api/wallet/tokens` missing | BSIM needs to implement endpoint |
| `bsim_error` with 401 | Wallet credential expired | User needs to re-enroll |

---

## Troubleshooting: Quick Checklist

Use this checklist when debugging WSIM/SSIM integration issues:

### BSIM Database (bsim)
- [ ] `wsim-wallet` client exists in `oauth_clients`
- [ ] `scope` is `'openid profile email wallet:enroll'` (string, not array)
- [ ] `grantTypes` is `ARRAY['authorization_code']` (no `refresh_token`)

### WSIM Database (wsim)
- [ ] `ssim-merchant` client exists in `"OAuthClient"`
- [ ] `scope` is `'openid payment:authorize'`
- [ ] `redirectUris` includes SSIM's callback URL

### WSIM Backend Task Definition
- [ ] `BSIM_PROVIDERS` JSON is valid and has correct values
- [ ] `INTERNAL_API_SECRET` matches auth-server

### WSIM Auth-Server Task Definition
- [ ] `INTERNAL_API_SECRET` matches backend
- [ ] `ALLOWED_POPUP_ORIGINS` includes `https://ssim.banksim.ca`
- [ ] `ALLOWED_EMBED_ORIGINS` includes `https://ssim.banksim.ca`

### SSIM Task Definition
- [ ] `WSIM_POPUP_URL` is `https://wsim-auth.banksim.ca` (not frontend!)
- [ ] `WSIM_CLIENT_ID` is `ssim-merchant`
- [ ] `WSIM_CLIENT_SECRET` matches WSIM database
- [ ] `WSIM_REDIRECT_URI` matches WSIM database exactly

### After Database Changes
- [ ] Restarted `wsim-auth-server-service` (loads clients at startup)

---

## Admin Interface Setup (Required for Production)

The WSIM auth-server includes an administration interface for managing OAuth clients, admin users, and invites. This must be set up after initial deployment.

### New Environment Variable Required

Add `AUTH_SERVER_URL` to the wsim-auth-server task definition:

```json
{ "name": "AUTH_SERVER_URL", "value": "https://wsim-auth.banksim.ca" }
```

This is used for generating invite URLs. Without it, invites will use the wrong domain.

### Updated wsim-auth-server Task Definition Environment

Add these environment variables to the existing wsim-auth-server task definition:

```json
{ "name": "AUTH_ADMIN_JWT_SECRET", "value": "GENERATE_A_SECURE_SECRET_HERE" },
{ "name": "AUTH_SERVER_URL", "value": "https://wsim-auth.banksim.ca" }
```

### First-Time Admin Setup

After deployment, create the first administrator:

1. **Navigate to setup page**: `https://wsim-auth.banksim.ca/administration/setup`

2. **Enter admin details**:
   - Email address
   - First name
   - Last name

3. **Register passkey**:
   - Click "Create Account & Register Passkey"
   - Follow browser prompts (Touch ID, Face ID, security key, etc.)

4. **Automatic login**: After passkey registration, you're logged in and redirected to the dashboard.

**Note**: The setup page is only accessible when no admin users exist. After the first admin (SUPER_ADMIN) is created, new admins must be invited.

### Admin Features

| Feature | Route | Access |
|---------|-------|--------|
| OAuth Client Management | `/administration` | All admins |
| Session Management | `/administration/sessions` | All admins |
| User List | `/administration/users` | All admins |
| Admin User List | `/administration/admins` | SUPER_ADMIN only |
| Admin Invitations | `/administration/invites` | SUPER_ADMIN only |

### Admin User Management (SUPER_ADMIN only)

SUPER_ADMINs can:
- **View all admins** on the Admins tab
- **Edit admins** - Change name and role (cannot change own role)
- **Remove admins** - Delete other admin accounts (cannot delete self)
- **Manage passkeys** - View and delete individual passkeys per admin
- **Create invites** - Generate secure invite links for new admins

### Creating Admin Invites

1. Go to `/administration/invites`
2. Click "+ Create Invite"
3. Configure:
   - **Email restriction** (optional) - Lock invite to specific email
   - **Role** - ADMIN or SUPER_ADMIN
   - **Expiry** - 1, 3, 7, 14, or 30 days
4. Copy the invite URL and send to the new admin

The invite URL format: `https://wsim-auth.banksim.ca/administration/join/<64-char-code>`

### Admin Database Tables

The following tables are created by Prisma migration:

```sql
-- Admin users table
SELECT id, email, "firstName", "lastName", role, "createdAt"
FROM admin_users;

-- Admin passkeys table (WebAuthn credentials)
SELECT id, "adminUserId", "credentialId", "lastUsedAt"
FROM admin_passkeys;

-- Admin invites table
SELECT id, code, email, role, "expiresAt", "usedAt", "revokedAt"
FROM admin_invites;
```

### Troubleshooting Admin Interface

**"Setup already complete" error:**
- First admin exists. Go to `/administration/login` instead.

**Passkey registration fails:**
```bash
aws logs tail /ecs/wsim-auth-server --filter-pattern "passkey\|WebAuthn" --region ca-central-1
```
- Check `WEBAUTHN_ORIGINS` includes `https://wsim-auth.banksim.ca`
- Check `WEBAUTHN_RP_ID` is `banksim.ca`

**Invite URLs show wrong domain:**
- Ensure `AUTH_SERVER_URL` is set to `https://wsim-auth.banksim.ca`

**Cannot change own role / Cannot delete self:**
- This is intentional - prevents lockout. Have another SUPER_ADMIN make the change.

---

## Support

- **WSIM Repository:** https://github.com/jordancrombie/wsim
- **Documentation:** See `EMBEDDED_WALLET_PLAN.md` for integration details
- **Changelog:** See `CHANGELOG.md` for recent changes

---

*Document created: 2025-12-06*
*Last updated: 2025-12-06 - Added admin interface setup and management documentation*
