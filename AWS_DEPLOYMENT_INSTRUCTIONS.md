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
        { "name": "ALLOWED_EMBED_ORIGINS", "value": "https://ssim.banksim.ca" }
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

## Step 12: Register WSIM OAuth Client in BSIM

WSIM needs to be registered as an OAuth client in BSIM's auth server to enable bank enrollment:

```sql
-- Run this in the BSIM database (not WSIM)
INSERT INTO "OAuthClient" (
  "id", "clientId", "clientSecret", "clientName",
  "redirectUris", "grantTypes", "responseTypes", "scopes",
  "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(),
  'wsim-wallet',
  'GENERATE_A_SECURE_CLIENT_SECRET',
  'WSIM Wallet',
  ARRAY['https://wsim.banksim.ca/api/enrollment/callback'],
  ARRAY['authorization_code'],
  ARRAY['code'],
  ARRAY['openid', 'profile', 'email', 'wallet:enroll'],
  NOW(),
  NOW()
);

-- NOTES:
-- 1. grant_types: Only 'authorization_code' or 'implicit' are valid (NOT 'refresh_token')
-- 2. scopes: Must match BSIM's supported scopes. Valid wallet scope is 'wallet:enroll' (NOT 'wallet:cards')
```

---

## Step 13: Register SSIM OAuth Client in WSIM

SSIM needs to be registered in WSIM to enable "Pay with Wallet":

```sql
-- Run this in the WSIM database
INSERT INTO "OAuthClient" (
  "id", "clientId", "clientSecret", "clientName",
  "redirectUris", "grantTypes", "responseTypes", "scopes",
  "apiKey", "createdAt", "updatedAt"
) VALUES (
  gen_random_uuid(),
  'ssim-merchant',
  'GENERATE_A_SECURE_CLIENT_SECRET',
  'Store Simulator',
  ARRAY['https://ssim.banksim.ca/payment/wallet-callback'],
  ARRAY['authorization_code'],
  ARRAY['code'],
  ARRAY['openid', 'payment:authorize'],
  'wsim_api_GENERATE_UNIQUE_KEY',
  NOW(),
  NOW()
);
```

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
| `BSIM_CLIENT_SECRET` | wsim-backend | Get from BSIM team |

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

## Support

- **WSIM Repository:** https://github.com/jordancrombie/wsim
- **Documentation:** See `EMBEDDED_WALLET_PLAN.md` for integration details
- **Changelog:** See `CHANGELOG.md` for recent changes

---

*Document created: 2025-12-06*
