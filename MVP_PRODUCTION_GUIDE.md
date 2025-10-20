# 🚀 ROADMAP MVP - Production Deployment Guide

## **Complete Best-Practice Implementation with Risk Management**

**Version**: 1.0.0
**Last Updated**: 2025-01-20
**Complexity**: Medium
**Timeline**: 3-4 days

---

## 📋 **TABLE OF CONTENTS**

1. [Executive Summary](#executive-summary)
2. [Risk Assessment](#risk-assessment)
3. [Architecture Overview](#architecture-overview)
4. [Prerequisites](#prerequisites)
5. [Deployment Steps](#deployment-steps)
6. [Testing & Validation](#testing--validation)
7. [Monitoring & Operations](#monitoring--operations)
8. [Cost Management](#cost-management)
9. [Security Hardening](#security-hardening)
10. [Disaster Recovery](#disaster-recovery)
11. [Troubleshooting](#troubleshooting)

---

## 📊 **EXECUTIVE SUMMARY**

### **What This MVP Does**

Deploys a secure, monitored AWS backend that:
- ✅ Handles Gemini API calls with your API key (no user keys needed)
- ✅ Automatically scales from 0 to 1000+ concurrent users
- ✅ Includes comprehensive monitoring and alerting
- ✅ Costs $0-2/month within AWS free tier
- ✅ Deploys via Infrastructure-as-Code (repeatable, version-controlled)

### **Key Metrics**

| Metric | Target | Actual (Expected) |
|--------|--------|-------------------|
| **Deployment Time** | <30 min | 15-25 min |
| **Monthly Cost (100 users)** | <$5 | $0.53 |
| **API Latency (p95)** | <3 sec | 2-4 sec |
| **Error Rate** | <1% | <0.5% |
| **Availability** | 99.9% | 99.95%+ |

---

## 🎯 **RISK ASSESSMENT**

### **Risk Matrix**

| # | Risk | Probability | Impact | Mitigation Status |
|---|------|------------|--------|-------------------|
| 1 | API key exposure | MEDIUM | 🔴 CRITICAL | ✅ **MITIGATED** - Secrets Manager + log masking |
| 2 | Runaway costs | HIGH | 🟡 MEDIUM | ✅ **MITIGATED** - Budget alarms + throttling |
| 3 | DDoS attack | MEDIUM | 🟡 MEDIUM | ✅ **MITIGATED** - API Gateway rate limits |
| 4 | Data breach | LOW | 🔴 CRITICAL | ✅ **MITIGATED** - No data storage, HTTPS only |
| 5 | Service outage | LOW | 🟡 MEDIUM | ⚠️ **PARTIAL** - Single region (multi-region in roadmap) |
| 6 | Rate limit exceeded | HIGH | 🟢 LOW | ✅ **MITIGATED** - Exponential backoff + retry |

### **Mitigation Details**

#### **1. API Key Exposure (CRITICAL)**
- **Control**: AWS Secrets Manager with encryption at rest
- **Control**: API key masked in all CloudWatch logs
- **Control**: IAM least-privilege policies
- **Control**: Automated key rotation (90 days)
- **Validation**: Manual audit of logs for key leaks

#### **2. Runaway Costs**
- **Control**: AWS Budget set at $5/month (80% alert threshold)
- **Control**: Lambda concurrency limit (10 concurrent executions)
- **Control**: API Gateway throttling (100 req/sec)
- **Validation**: Cost Explorer monitoring

#### **3. DDoS / Abuse**
- **Control**: API Gateway burst limit (200 req)
- **Control**: API Gateway steady-state limit (100 req/sec)
- **Control**: Lambda timeout (30 seconds max)
- **Future**: WAF with IP rate limiting

---

## 🏛️ **ARCHITECTURE OVERVIEW**

### **Component Diagram**

```
┌──────────────┐
│    User      │
│   Browser    │
└──────┬───────┘
       │ HTTPS
       ▼
┌──────────────────────┐
│   API Gateway        │
│   (Throttled)        │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐      ┌──────────────────┐
│   Lambda Function    │─────>│ Secrets Manager  │
│   (10 concurrent)    │      │ (API Key)        │
└──────┬───────────────┘      └──────────────────┘
       │
       ▼
┌──────────────────────┐      ┌──────────────────┐
│   Google Gemini API  │      │  CloudWatch      │
└──────────────────────┘      │  (Logs/Metrics)  │
                               └──────────────────┘
                                       │
                                       ▼
                               ┌──────────────────┐
                               │   SNS Topic      │
                               │   (Email Alerts) │
                               └──────────────────┘
```

### **Technology Stack**

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | Static HTML/JS/CSS | User interface |
| **API Gateway** | AWS API Gateway REST | HTTP endpoint + throttling |
| **Compute** | AWS Lambda (Node.js 20) | Gemini API proxy |
| **Secrets** | AWS Secrets Manager | Encrypted API key storage |
| **Monitoring** | CloudWatch | Logs, metrics, alarms |
| **Alerting** | SNS | Email notifications |
| **IaC** | CloudFormation | Infrastructure definition |

---

## ✅ **PREREQUISITES**

### **Required**

- [ ] AWS Account (free tier eligible)
- [ ] AWS CLI installed ([install guide](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html))
- [ ] AWS CLI configured (`aws configure`)
- [ ] Node.js 20+ installed ([download](https://nodejs.org/))
- [ ] Google Gemini API key ([get key](https://aistudio.google.com/app/apikey))
- [ ] Email address for alerts
- [ ] Git (to clone repo)
- [ ] `zip` utility (for packaging)

### **AWS Permissions Required**

Your AWS IAM user needs these permissions:
```yaml
- cloudformation:*
- lambda:*
- apigateway:*
- secretsmanager:*
- iam:CreateRole
- iam:AttachRolePolicy
- iam:PutRolePolicy
- logs:CreateLogGroup
- logs:PutRetentionPolicy
- sns:CreateTopic
- sns:Subscribe
- budgets:CreateBudget
```

### **Validation Commands**

```bash
# Check AWS CLI
aws --version
# Expected: aws-cli/2.x.x or higher

# Check AWS credentials
aws sts get-caller-identity
# Should show your account ID

# Check Node.js
node --version
# Expected: v20.x.x or higher

# Check npm
npm --version
# Expected: 10.x.x or higher

# Check zip
zip --version
# Should show zip version
```

---

## 🚀 **DEPLOYMENT STEPS**

### **Step 1: Clone Repository**

```bash
cd ~/projects
git clone https://github.com/YOUR-USERNAME/roadmap-json.git
cd roadmap-json/aws-infrastructure
```

### **Step 2: Make Deployment Script Executable**

```bash
chmod +x deploy.sh
```

### **Step 3: Run Deployment**

```bash
./deploy.sh YOUR_GEMINI_API_KEY your-email@example.com prod 5
```

**Parameters**:
- `YOUR_GEMINI_API_KEY`: Your Gemini API key (starts with `AIza`)
- `your-email@example.com`: Email for alerts
- `prod`: Environment name (dev/staging/prod)
- `5`: Monthly budget limit in USD

**Expected Output**:
```
╔═══════════════════════════════════════════════════════════════╗
║   ROADMAP Model Card Editor - AWS MVP Deployment Script      ║
╚═══════════════════════════════════════════════════════════════╝

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Validating Prerequisites
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✓ AWS CLI found: aws-cli/2.15.0
✓ AWS credentials valid
  Account: 123456789012
  Region: us-east-1
✓ Node.js found: v20.11.0
✓ npm found: 10.2.4
✓ zip utility found

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Deployment Configuration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Environment:       prod
Alert Email:       admin@example.com
Monthly Budget:    $5 USD
AWS Region:        us-east-1
API Key:           ****MNO

Ready to deploy. Continue? (y/n)
```

Type `y` and press Enter.

**Deployment Timeline**:
```
[00:00-00:30] Packaging Lambda (npm install + zip)
[00:30-03:00] Deploying CloudFormation stack
[03:00-03:30] Updating Lambda code
[03:30-03:45] Testing deployment
[03:45-04:00] Displaying outputs
```

**Total Time**: 3-4 minutes

### **Step 4: Confirm SNS Subscription**

1. Check your email for "AWS Notification - Subscription Confirmation"
2. Click the confirmation link
3. You'll receive alerts at this email address

### **Step 5: Save Output**

The script creates `deployment-output.json`:

```json
{
  "apiEndpoint": "https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod/gemini",
  "lambdaArn": "arn:aws:lambda:us-east-1:123456789012:function:roadmap-gemini-proxy-prod",
  "environment": "prod",
  "region": "us-east-1",
  "stackName": "roadmap-backend-prod",
  "deploymentTime": "2025-01-20T10:30:00Z"
}
```

**⚠️ IMPORTANT**: Save this file! You'll need the API endpoint for the frontend.

---

## 🧪 **TESTING & VALIDATION**

### **Test 1: Lambda Function (Direct)**

```bash
# Get function name
FUNCTION_NAME=$(aws cloudformation describe-stacks \
  --stack-name roadmap-backend-prod \
  --query "Stacks[0].Outputs[?OutputKey=='LambdaFunctionArn'].OutputValue" \
  --output text | cut -d':' -f7)

# Invoke function
aws lambda invoke \
  --function-name $FUNCTION_NAME \
  --payload '{"body":"{\"prompt\":\"Say hello\"}"}' \
  response.json

# Check response
cat response.json
```

**Expected**: `statusCode: 200` with Gemini response

### **Test 2: API Gateway (End-to-End)**

```bash
# Get API endpoint
API_ENDPOINT=$(cat deployment-output.json | grep apiEndpoint | cut -d'"' -f4)

# Send test request
curl -X POST $API_ENDPOINT \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Generate a single word greeting"}'
```

**Expected**: JSON response with `candidates` array

### **Test 3: Error Handling**

```bash
# Test invalid request (should return 400)
curl -X POST $API_ENDPOINT \
  -H "Content-Type: application/json" \
  -d '{"invalid":"field"}'

# Expected: {"error":"Validation failed","details":[...]}
```

### **Test 4: Rate Limiting**

```bash
# Send 150 requests rapidly (should throttle after 100)
for i in {1..150}; do
  curl -X POST $API_ENDPOINT \
    -H "Content-Type: application/json" \
    -d '{"prompt":"Test"}' &
done
wait

# Check for 429 responses
```

### **Test 5: CloudWatch Logs**

```bash
# View recent logs
aws logs tail /aws/lambda/$FUNCTION_NAME --follow
```

**Expected**: Structured JSON logs with request/response info

---

## 📊 **MONITORING & OPERATIONS**

### **CloudWatch Dashboard**

Access at: https://console.aws.amazon.com/cloudwatch/home

**Key Metrics to Monitor**:

| Metric | Threshold | Action |
|--------|-----------|--------|
| **Lambda Errors** | >5 in 5 min | Alert → Check logs |
| **Lambda Duration (p95)** | >25 sec | Increase memory or investigate |
| **API Gateway 5XX** | >5 in 5 min | Alert → Check Lambda |
| **Lambda Throttles** | >1 | Increase concurrency limit |
| **Estimated Cost** | >$4 | Review usage patterns |

### **Accessing Logs**

```bash
# View Lambda logs
aws logs tail /aws/lambda/roadmap-gemini-proxy-prod --follow

# View API Gateway logs
aws logs tail API-Gateway-Execution-Logs_YOUR-API-ID/prod --follow

# Search for errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/roadmap-gemini-proxy-prod \
  --filter-pattern "ERROR"
```

### **Checking Metrics**

```bash
# Lambda invocations (last hour)
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=roadmap-gemini-proxy-prod \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum

# Lambda errors (last hour)
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Errors \
  --dimensions Name=FunctionName,Value=roadmap-gemini-proxy-prod \
  --start-time $(date -u -d '1 hour ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 300 \
  --statistics Sum
```

---

## 💰 **COST MANAGEMENT**

### **Cost Breakdown (100 PDFs/month)**

```
AWS Costs:
├── Lambda: $0.00 (within free tier 1M requests)
├── API Gateway: $0.00 (within free tier 1M requests)
├── Secrets Manager: $0.40/month (1 secret)
├── CloudWatch Logs: $0.00 (within free tier 5GB)
├── SNS: $0.00 (within free tier 1000 emails)
├── Data Transfer: $0.13/month (~2GB out)
└── TOTAL AWS: $0.53/month

Gemini API Costs:
├── Free Tier: 5 RPM = ~7200 requests/day
├── At 100 PDFs/month: ~3 requests/day
└── TOTAL GEMINI: $0.00/month (within free tier)

TOTAL MONTHLY COST: $0.53
```

### **Scaling Costs**

| Usage | AWS Cost | Gemini Cost† | Total/Month |
|-------|----------|--------------|-------------|
| 100 PDFs | $0.53 | $0.00 | **$0.53** |
| 500 PDFs | $2.15 | $0.00 | **$2.15** |
| 1,000 PDFs | $4.30 | $2.50 | **$6.80** |
| 5,000 PDFs | $21.50 | $12.50 | **$34.00** |

† Gemini 2.5 Pro: ~$0.0025/request beyond free tier

### **Cost Optimization Tips**

1. **Use Gemini 2.5 Flash** (90% cheaper, slightly lower quality)
   - Change `DEFAULT_MODEL` in Lambda to `gemini-2.5-flash`
   - Reduces cost to ~$0.00025/request

2. **Reduce Lambda Memory** (if latency acceptable)
   - 256MB instead of 512MB = 50% compute cost reduction

3. **Shorten Log Retention**
   - Current: 7 days
   - Change to 3 days = 40% log storage savings

4. **Enable Response Caching** (future enhancement)
   - Cache identical prompts
   - Could save 50%+ on Gemini costs

### **Budget Alerts**

You'll receive emails when:
- ✅ Monthly cost exceeds $4 (80% of $5 budget)
- ✅ Monthly cost exceeds $5 (100% of budget)

---

## 🔒 **SECURITY HARDENING**

### **Security Checklist**

- [x] **API key encrypted** (AWS Secrets Manager)
- [x] **API key masked in logs** (automatic)
- [x] **HTTPS only** (API Gateway)
- [x] **IAM least privilege** (Lambda role)
- [x] **No public S3 buckets**
- [x] **CloudTrail enabled** (audit logs)
- [ ] **API Gateway API key** (add in Step 2)
- [ ] **WAF rate limiting** (add in Step 3)
- [ ] **VPC endpoints** (add in Step 4)

### **Step 2: Add API Gateway Authentication (Optional)**

```bash
# Create API key
aws apigateway create-api-key \
  --name roadmap-frontend-key \
  --enabled

# Create usage plan
aws apigateway create-usage-plan \
  --name roadmap-usage-plan \
  --throttle burstLimit=50,rateLimit=10

# Associate key with plan
# (Follow AWS documentation for detailed steps)
```

### **Step 3: Add WAF (Web Application Firewall)**

```bash
# Create WAF WebACL with rate limiting
aws wafv2 create-web-acl \
  --scope REGIONAL \
  --name roadmap-waf \
  --default-action Allow={} \
  --rules file://waf-rules.json
```

### **Security Audit Commands**

```bash
# Check IAM role permissions
aws iam get-role-policy \
  --role-name roadmap-lambda-role-prod \
  --policy-name SecretsManagerReadPolicy

# Check CloudTrail events (last 24 hours)
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=roadmap-gemini-api-key-prod \
  --start-time $(date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%S) \
  --max-results 50

# Scan logs for potential API key leaks
aws logs filter-log-events \
  --log-group-name /aws/lambda/roadmap-gemini-proxy-prod \
  --filter-pattern "AIza"
# Should return NO results (keys are masked)
```

---

## 🆘 **DISASTER RECOVERY**

### **Backup Strategy**

| Component | Backup Method | Frequency | Retention |
|-----------|---------------|-----------|-----------|
| **Infrastructure** | CloudFormation template (Git) | Every change | Indefinite |
| **Lambda Code** | S3 versioning | Every deployment | 30 versions |
| **API Key** | Secrets Manager | Manual rotation | Current + previous |
| **Logs** | CloudWatch | Automatic | 7 days |

### **Recovery Procedures**

#### **Scenario 1: Lambda Function Failure**

**Symptoms**: All requests return 500 errors

**Recovery**:
```bash
# Rollback to previous version
FUNCTION_NAME=roadmap-gemini-proxy-prod

# List versions
aws lambda list-versions-by-function \
  --function-name $FUNCTION_NAME

# Rollback to version N-1
PREVIOUS_VERSION=2
aws lambda update-alias \
  --function-name $FUNCTION_NAME \
  --name PROD \
  --function-version $PREVIOUS_VERSION
```

**Time to Recovery**: <5 minutes

#### **Scenario 2: API Key Compromised**

**Symptoms**: Unauthorized API usage detected

**Recovery**:
```bash
# 1. Generate new Gemini API key at Google AI Studio

# 2. Update secret
aws secretsmanager update-secret \
  --secret-id roadmap-gemini-api-key-prod \
  --secret-string "NEW-API-KEY-HERE"

# 3. Verify Lambda picks up new key (wait 5 minutes for cache expiry)
```

**Time to Recovery**: <10 minutes

#### **Scenario 3: Complete Stack Deletion**

**Symptoms**: Stack accidentally deleted

**Recovery**:
```bash
# Redeploy from Git (no data loss - infrastructure is code!)
git pull origin main
cd aws-infrastructure
./deploy.sh YOUR_API_KEY your-email@example.com prod 5
```

**Time to Recovery**: <5 minutes

#### **Scenario 4: AWS Region Outage**

**Symptoms**: All AWS services in region unavailable

**Recovery** (Future - Multi-Region):
```bash
# Deploy to secondary region
AWS_REGION=us-west-2 ./deploy.sh YOUR_API_KEY your-email@example.com prod 5

# Update frontend to use new API endpoint
```

**Time to Recovery**: <10 minutes

---

## 🔧 **TROUBLESHOOTING**

### **Issue 1: Deployment Fails**

**Symptom**: `deploy.sh` exits with error

**Common Causes**:
1. **Invalid API key format**
   - Check: Key starts with `AIza` and is exactly 39 characters
   - Fix: Copy key again from Google AI Studio

2. **AWS permissions insufficient**
   - Check: `aws iam get-user`
   - Fix: Contact AWS admin to grant CloudFormation permissions

3. **Stack already exists**
   - Check: `aws cloudformation describe-stacks --stack-name roadmap-backend-prod`
   - Fix: Delete stack or use different environment name

**Debug Commands**:
```bash
# Check CloudFormation events
aws cloudformation describe-stack-events \
  --stack-name roadmap-backend-prod \
  --max-items 20

# Check specific resource failure
aws cloudformation describe-stack-resources \
  --stack-name roadmap-backend-prod \
  --logical-resource-id GeminiProxyFunction
```

### **Issue 2: Lambda Returns 500 Errors**

**Symptom**: API calls return `{"error":"Internal server error"}`

**Debug Steps**:
```bash
# 1. Check CloudWatch logs
aws logs tail /aws/lambda/roadmap-gemini-proxy-prod --follow

# 2. Look for error patterns
aws logs filter-log-events \
  --log-group-name /aws/lambda/roadmap-gemini-proxy-prod \
  --filter-pattern "ERROR" \
  --start-time $(date -u -d '1 hour ago' +%s)000

# 3. Test Lambda directly
aws lambda invoke \
  --function-name roadmap-gemini-proxy-prod \
  --payload '{"body":"{\"prompt\":\"test\"}"}' \
  --log-type Tail \
  response.json
```

**Common Causes**:
- API key not set/invalid → Check Secrets Manager
- Gemini API down → Check [status.google.com](https://status.google.com)
- Lambda timeout → Increase timeout in CloudFormation

### **Issue 3: Rate Limiting**

**Symptom**: Frequent 429 errors

**Causes**:
1. **API Gateway throttling** (100 req/sec)
   - Fix: Increase throttle limits in CloudFormation
   ```yaml
   ThrottlingBurstLimit: 500  # Increase from 200
   ThrottlingRateLimit: 250   # Increase from 100
   ```

2. **Gemini API rate limit** (5 RPM free tier)
   - Fix: Upgrade to paid tier or implement request queue

3. **Lambda concurrency limit** (10 concurrent)
   - Fix: Increase in CloudFormation
   ```yaml
   ReservedConcurrentExecutions: 50  # Increase from 10
   ```

### **Issue 4: High Costs**

**Symptom**: AWS bill exceeds expectations

**Debug**:
```bash
# Check cost breakdown
aws ce get-cost-and-usage \
  --time-period Start=2025-01-01,End=2025-01-31 \
  --granularity MONTHLY \
  --metrics BlendedCost \
  --group-by Type=DIMENSION,Key=SERVICE

# Check Lambda invocations
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=roadmap-gemini-proxy-prod \
  --start-time $(date -u -d '1 month ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 86400 \
  --statistics Sum
```

**Common Causes**:
- Unexpected traffic spike → Check API Gateway logs
- Lambda memory too high → Reduce from 512MB to 256MB
- Log retention too long → Reduce from 7 days to 3 days

---

## 📚 **ADDITIONAL RESOURCES**

- [AWS Lambda Best Practices](https://docs.aws.amazon.com/lambda/latest/dg/best-practices.html)
- [API Gateway Throttling](https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-request-throttling.html)
- [Secrets Manager Rotation](https://docs.aws.amazon.com/secretsmanager/latest/userguide/rotating-secrets.html)
- [CloudWatch Alarms](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html)
- [Gemini API Documentation](https://ai.google.dev/docs)

---

## ✅ **POST-DEPLOYMENT CHECKLIST**

After deployment, verify:

- [ ] API endpoint accessible (`curl` test passes)
- [ ] Lambda logs appearing in CloudWatch
- [ ] SNS subscription confirmed (check email)
- [ ] Budget alarm configured
- [ ] Test request successful (PDF extraction works)
- [ ] Frontend updated with new API endpoint
- [ ] Frontend deployed to AWS Amplify/S3
- [ ] CloudWatch dashboard bookmarked
- [ ] `deployment-output.json` backed up
- [ ] API key stored securely (password manager)
- [ ] Team notified of new backend

---

**🎉 Congratulations! Your production MVP is live!**

For questions or issues, check:
1. CloudWatch logs first
2. This troubleshooting section
3. GitHub issues

**Next Steps**: See [ROADMAP.md](ROADMAP.md) for planned enhancements (caching, multi-region, etc.)
