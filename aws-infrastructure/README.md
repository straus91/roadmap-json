# AWS Infrastructure - ROADMAP MVP Backend

## 📁 Directory Structure

```
aws-infrastructure/
├── cloudformation-mvp.yaml      # AWS infrastructure definition (335 lines)
├── deploy.sh                    # Automated deployment script (400+ lines)
├── deployment-output.json       # Generated after deployment (API endpoint)
├── lambda/
│   ├── index.js                 # Lambda function code (687 lines)
│   ├── package.json             # Node.js dependencies
│   └── function.zip             # Generated deployment package
├── test/
│   └── lambda.test.js           # Unit tests (300+ lines)
└── README.md                    # This file
```

## 🚀 Quick Deployment

```bash
# From this directory
./deploy.sh YOUR_GEMINI_API_KEY your@email.com prod 5

# Wait 4 minutes...
# ✅ Backend deployed!
```

## 📦 What Gets Created

### AWS Resources

| Resource | Purpose | Cost |
|----------|---------|------|
| **Lambda Function** | Gemini API proxy | Free tier (1M requests) |
| **API Gateway** | HTTP endpoint | Free tier (1M requests) |
| **Secrets Manager** | API key storage | $0.40/month |
| **CloudWatch Logs** | Logging | Free tier (5GB) |
| **CloudWatch Alarms** | Monitoring | $0.10/alarm |
| **SNS Topic** | Email alerts | Free tier (1000 emails) |
| **IAM Roles** | Permissions | Free |
| **Budget** | Cost alerts | Free |

**Total**: $0.53-2.00/month for typical usage

## 🔧 Files Explained

### `cloudformation-mvp.yaml`

Complete AWS infrastructure defined as code:
- ✅ Secrets Manager secret for API key
- ✅ Lambda function with least-privilege IAM role
- ✅ API Gateway REST API with CORS
- ✅ CloudWatch log groups and alarms
- ✅ SNS topic for alerts
- ✅ Budget for cost control

**Parameters**:
- `GeminiApiKey`: Your Gemini API key
- `AlertEmail`: Email for notifications
- `Environment`: dev/staging/prod
- `MonthlyBudgetLimit`: Cost threshold (USD)

### `deploy.sh`

Automated deployment script that:
1. ✅ Validates prerequisites (AWS CLI, Node.js, etc.)
2. ✅ Packages Lambda function (npm install + zip)
3. ✅ Deploys CloudFormation stack
4. ✅ Updates Lambda code
5. ✅ Tests deployment
6. ✅ Displays API endpoint

**Usage**:
```bash
./deploy.sh <api-key> <email> [env] [budget]
```

### `lambda/index.js`

Production-ready Lambda function with:
- ✅ Input validation
- ✅ Error handling
- ✅ Retry logic (exponential backoff)
- ✅ CloudWatch metrics
- ✅ Structured logging
- ✅ API key caching
- ✅ Security (key masking)

**Environment Variables**:
- `GEMINI_SECRET_ARN`: Secrets Manager ARN
- `ENVIRONMENT`: dev/staging/prod
- `LOG_LEVEL`: INFO/DEBUG/WARN/ERROR

### `test/lambda.test.js`

Comprehensive test suite covering:
- ✅ Input validation (10+ test cases)
- ✅ Error handling (rate limits, timeouts)
- ✅ API key management
- ✅ Metrics publishing

**Run tests**:
```bash
cd lambda
npm install
npm test
```

## 🔍 Deployment Output

After deployment, `deployment-output.json` contains:

```json
{
  "apiEndpoint": "https://abc123.execute-api.us-east-1.amazonaws.com/prod/gemini",
  "lambdaArn": "arn:aws:lambda:us-east-1:123456789012:function:roadmap-gemini-proxy-prod",
  "environment": "prod",
  "region": "us-east-1",
  "stackName": "roadmap-backend-prod",
  "deploymentTime": "2025-01-20T10:30:00Z"
}
```

**⚠️ IMPORTANT**: Copy `apiEndpoint` - you need it for frontend configuration!

## 📊 Monitoring

### CloudWatch Dashboards

View at: https://console.aws.amazon.com/cloudwatch

**Key Metrics**:
- Lambda invocations
- Lambda errors
- Lambda duration (p50, p95, p99)
- API Gateway requests
- API Gateway 4XX/5XX errors

### CloudWatch Alarms

You'll receive emails when:
- ✅ Lambda errors >5 in 5 minutes
- ✅ Lambda throttles >1
- ✅ API Gateway 5XX errors >5 in 5 minutes
- ✅ Lambda p95 duration >25 seconds
- ✅ Monthly cost exceeds $4 (80% of budget)

### View Logs

```bash
# Lambda logs (real-time)
aws logs tail /aws/lambda/roadmap-gemini-proxy-prod --follow

# Filter for errors
aws logs filter-log-events \
  --log-group-name /aws/lambda/roadmap-gemini-proxy-prod \
  --filter-pattern "ERROR"

# API Gateway logs
aws logs tail API-Gateway-Execution-Logs_YOUR-API-ID/prod --follow
```

## 🔄 Update Deployment

### Update Lambda Code Only

```bash
cd lambda
npm install --production
zip -r function.zip node_modules/ index.js package.json

aws lambda update-function-code \
  --function-name roadmap-gemini-proxy-prod \
  --zip-file fileb://function.zip
```

### Update Infrastructure

```bash
# Modify cloudformation-mvp.yaml
# Then redeploy
./deploy.sh YOUR_API_KEY your@email.com prod 5

# CloudFormation will update existing stack (no downtime)
```

### Update API Key

```bash
aws secretsmanager update-secret \
  --secret-id roadmap-gemini-api-key-prod \
  --secret-string "NEW-API-KEY-HERE"

# Lambda will pick up new key within 5 minutes (cache TTL)
```

## 🗑️ Delete Everything

```bash
# Delete CloudFormation stack (removes all resources)
aws cloudformation delete-stack --stack-name roadmap-backend-prod

# Wait for deletion
aws cloudformation wait stack-delete-complete --stack-name roadmap-backend-prod

# Manually delete Secrets Manager secret (has 7-day recovery window)
aws secretsmanager delete-secret \
  --secret-id roadmap-gemini-api-key-prod \
  --force-delete-without-recovery
```

**⚠️ WARNING**: This is irreversible! Make sure you have backups.

## 🐛 Troubleshooting

### Issue: Deployment fails with "Invalid API key"

**Fix**: Check API key format
```bash
echo "YOUR_API_KEY" | wc -c  # Should be 40 chars (39 + newline)
# Key must start with "AIza"
```

### Issue: Lambda returns 500 errors

**Debug**:
```bash
# Check CloudWatch logs
aws logs tail /aws/lambda/roadmap-gemini-proxy-prod --follow

# Test Lambda directly
aws lambda invoke \
  --function-name roadmap-gemini-proxy-prod \
  --payload '{"body":"{\"prompt\":\"test\"}"}' \
  response.json

cat response.json
```

### Issue: 429 Rate Limit Errors

**Cause**: Either:
1. API Gateway throttling (100 req/sec)
2. Lambda concurrency limit (10 concurrent)
3. Gemini API rate limit (5 RPM free tier)

**Fix**: Increase limits in `cloudformation-mvp.yaml`

### Issue: High costs

**Debug**:
```bash
# Check Lambda invocations
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=roadmap-gemini-proxy-prod \
  --start-time $(date -u -d '1 day ago' +%Y-%m-%dT%H:%M:%S) \
  --end-time $(date -u +%Y-%m-%dT%H:%M:%S) \
  --period 3600 \
  --statistics Sum
```

## 📚 Additional Documentation

- **Quick Start**: `../QUICK_START.md` (5-minute deployment)
- **Production Guide**: `../MVP_PRODUCTION_GUIDE.md` (comprehensive operations)
- **Executive Summary**: `../MVP_EXECUTIVE_SUMMARY.md` (overview & risk assessment)

## ✅ Deployment Checklist

Before deployment:
- [ ] AWS CLI configured (`aws sts get-caller-identity`)
- [ ] Node.js 20+ installed (`node --version`)
- [ ] Gemini API key obtained
- [ ] Email address for alerts ready
- [ ] Reviewed cost projections

After deployment:
- [ ] `deployment-output.json` created
- [ ] API endpoint accessible (test with `curl`)
- [ ] SNS subscription confirmed (check email)
- [ ] CloudWatch logs appearing
- [ ] Budget alarm configured

## 🔐 Security Best Practices

- ✅ API key stored in Secrets Manager (encrypted)
- ✅ API key masked in all logs
- ✅ IAM least-privilege roles
- ✅ HTTPS only (no HTTP)
- ✅ CORS properly configured
- ✅ CloudTrail audit logs
- ⚠️ No API Gateway authentication (add API key for production)
- ⚠️ No WAF (add for DDoS protection if needed)

## 📈 Performance Tuning

### Reduce Lambda Cold Starts

```yaml
# In cloudformation-mvp.yaml
ProvisionedConcurrencyConfig:
  ProvisionedConcurrentExecutions: 1
```

Cost: ~$12/month, reduces cold starts to <100ms

### Increase Lambda Memory (faster execution)

```yaml
MemorySize: 1024  # Increase from 512
```

Cost: +50% compute cost, but faster execution may offset

### Enable API Gateway Caching

```yaml
CacheClusterEnabled: true
CacheClusterSize: '0.5'  # 0.5GB cache
```

Cost: ~$0.02/hour = ~$15/month

## 🎯 Next Steps

1. Deploy this backend (`./deploy.sh`)
2. Update frontend with API endpoint
3. Deploy frontend to AWS Amplify
4. Monitor CloudWatch dashboard
5. Review costs after 1 week
6. Optimize based on usage patterns

## 📞 Support

- AWS Documentation: https://docs.aws.amazon.com/
- Gemini API Docs: https://ai.google.dev/docs
- GitHub Issues: (your-repo-url/issues)

---

**Ready to deploy?** Run `./deploy.sh` and follow the prompts! 🚀
