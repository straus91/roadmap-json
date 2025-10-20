# 🚀 QUICK START - Deploy in 5 Minutes

## **TL;DR: Get Your AWS Backend Running NOW**

---

## Prerequisites (2 minutes)

```bash
# Check you have everything
aws --version          # Need AWS CLI
node --version         # Need Node.js 20+
zip --version          # Need zip
aws sts get-caller-identity  # AWS credentials configured
```

**Don't have these?**
- AWS CLI: https://aws.amazon.com/cli/
- Node.js: https://nodejs.org/
- AWS credentials: Run `aws configure`

---

## Step 1: Get Your Gemini API Key (30 seconds)

1. Go to https://aistudio.google.com/app/apikey
2. Click "Create API Key"
3. Copy it (starts with `AIza`)

---

## Step 2: Deploy (4 minutes)

```bash
# Clone and navigate
git clone https://github.com/YOUR-USER/roadmap-json.git
cd roadmap-json/aws-infrastructure

# Make deployment script executable
chmod +x deploy.sh

# Deploy (replace with YOUR values)
./deploy.sh AIzaSyABC123... your-email@example.com prod 5
```

**Wait 4 minutes** while it:
- Packages Lambda function
- Creates AWS infrastructure
- Deploys and tests

---

## Step 3: Confirm Email (30 seconds)

Check your email for "AWS Notification - Subscription Confirmation"
Click the link to confirm.

---

## Step 4: Get Your API Endpoint

After deployment, you'll see:

```
📋 Important Information:

  API Endpoint (use in frontend):
  https://abc123xyz.execute-api.us-east-1.amazonaws.com/prod/gemini
```

**Copy this URL** - you need it for your frontend!

---

## Step 5: Test It Works

```bash
# Quick test
curl -X POST https://YOUR-API-ENDPOINT-HERE \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Say hello in one word"}'

# Should return JSON with Gemini's response
```

---

## ✅ Done!

Your backend is live! Now:

1. **Update frontend**: Edit `public/js/backend-api-client.js`
   - Replace `API_GATEWAY_URL` with your endpoint

2. **Deploy frontend**: Upload to AWS Amplify or S3

3. **Monitor**: https://console.aws.amazon.com/cloudwatch

---

## 💰 Cost

- **100 PDFs/month**: $0.53
- **1000 PDFs/month**: $6.80
- **Within AWS free tier** for low usage

Budget alert set at $5/month (you'll get email if exceeded)

---

## 🆘 Something Wrong?

### Deployment failed?
```bash
# Check CloudFormation events
aws cloudformation describe-stack-events \
  --stack-name roadmap-backend-prod \
  --max-items 10
```

### Lambda not working?
```bash
# Check logs
aws logs tail /aws/lambda/roadmap-gemini-proxy-prod --follow
```

### Need full docs?
- **Complete guide**: `MVP_PRODUCTION_GUIDE.md`
- **Executive summary**: `MVP_EXECUTIVE_SUMMARY.md`

---

## 🎉 That's It!

Your production AWS backend with:
- ✅ Secure API key storage
- ✅ Auto-scaling
- ✅ Monitoring & alerts
- ✅ Cost controls

**Questions?** Check the full documentation in `MVP_PRODUCTION_GUIDE.md`
