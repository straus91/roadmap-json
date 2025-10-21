#!/bin/bash

###############################################################################
# ROADMAP Async Architecture - Deployment Script
#
# This script deploys the complete async PDF processing architecture to AWS
#
# Usage:
#   ./deploy-async.sh <gemini-api-key> <alert-email> [environment]
#
# Example:
#   ./deploy-async.sh AIzaSyABC123... admin@example.com prod
#
###############################################################################

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Print colored message
print_msg() {
    local color=$1
    shift
    echo -e "${color}$@${NC}"
}

# Print section header
print_section() {
    echo ""
    print_msg "$BLUE" "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    print_msg "$BLUE" "  $1"
    print_msg "$BLUE" "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""
}

# Parse arguments
if [ $# -lt 2 ]; then
    print_msg "$RED" "Usage: $0 <gemini-api-key> <alert-email> [environment]"
    print_msg "$YELLOW" ""
    print_msg "$YELLOW" "Arguments:"
    print_msg "$YELLOW" "  gemini-api-key  Your Google Gemini API key (required)"
    print_msg "$YELLOW" "  alert-email     Email for alerts (required)"
    print_msg "$YELLOW" "  environment     Environment name: dev, staging, prod (default: prod)"
    exit 1
fi

GEMINI_API_KEY="$1"
ALERT_EMAIL="$2"
ENVIRONMENT="${3:-prod}"

# Validate API key format
if [[ ! "$GEMINI_API_KEY" =~ ^AIza[0-9A-Za-z_-]{35}$ ]]; then
    print_msg "$RED" "❌ Invalid Gemini API key format"
    exit 1
fi

# Validate email format
if [[ ! "$ALERT_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
    print_msg "$RED" "❌ Invalid email address format"
    exit 1
fi

AWS_REGION=$(aws configure get region)
STACK_NAME="roadmap-async-$ENVIRONMENT"

print_section "Deploying ROADMAP Async Architecture"
print_msg "$GREEN" "Environment:       $ENVIRONMENT"
print_msg "$GREEN" "Alert Email:       $ALERT_EMAIL"
print_msg "$GREEN" "AWS Region:        $AWS_REGION"

# Confirm deployment
echo ""
print_msg "$YELLOW" "Ready to deploy. Continue? (y/n)"
read -r CONFIRM
if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
    print_msg "$YELLOW" "Deployment cancelled"
    exit 0
fi

# Package Lambda functions
print_section "Packaging Lambda Functions"

cd lambda-async

# Install dependencies
print_msg "$YELLOW" "Installing Node.js dependencies..."
npm install --production --quiet

# Create deployment packages
print_msg "$YELLOW" "Creating deployment packages..."
mkdir -p ../build

# Package submit-job
zip -q ../build/submit-job.zip submit-job.js package.json node_modules -r
print_msg "$GREEN" "✓ submit-job.zip created"

# Package process-job
zip -q ../build/process-job.zip process-job.js package.json node_modules -r
print_msg "$GREEN" "✓ process-job.zip created"

# Package get-status
zip -q ../build/get-status.zip get-status.js package.json node_modules -r
print_msg "$GREEN" "✓ get-status.zip created"

cd ..

# Deploy CloudFormation stack
print_section "Deploying CloudFormation Stack"

# Check if stack exists
if aws cloudformation describe-stacks --stack-name "$STACK_NAME" >/dev/null 2>&1; then
    print_msg "$YELLOW" "Stack exists. Updating..."
    OPERATION="update-stack"
else
    print_msg "$YELLOW" "Creating new stack..."
    OPERATION="create-stack"
fi

# Deploy stack
STACK_OUTPUT=$(aws cloudformation $OPERATION \
    --stack-name "$STACK_NAME" \
    --template-body file://cloudformation-async.yaml \
    --parameters \
        ParameterKey=GeminiApiKey,ParameterValue="$GEMINI_API_KEY" \
        ParameterKey=AlertEmail,ParameterValue="$ALERT_EMAIL" \
        ParameterKey=Environment,ParameterValue="$ENVIRONMENT" \
    --capabilities CAPABILITY_NAMED_IAM \
    --tags \
        Key=Application,Value=ROADMAP \
        Key=Environment,Value="$ENVIRONMENT" \
        Key=ManagedBy,Value=CloudFormation 2>&1)

if [ $? -ne 0 ]; then
    # Check if error is because no updates needed
    if echo "$STACK_OUTPUT" | grep -q "No updates are to be performed"; then
        print_msg "$YELLOW" "No stack updates needed - stack is already up to date"
    else
        print_msg "$RED" "CloudFormation operation failed:"
        echo "$STACK_OUTPUT"
        exit 1
    fi
else
    print_msg "$YELLOW" "Waiting for stack operation to complete..."
    print_msg "$YELLOW" "(This may take 2-3 minutes)"

    if [ "$OPERATION" = "create-stack" ]; then
        if ! aws cloudformation wait stack-create-complete --stack-name "$STACK_NAME" 2>&1; then
            print_msg "$RED" "Stack creation failed. Checking events..."
            aws cloudformation describe-stack-events --stack-name "$STACK_NAME" \
                --query 'StackEvents[?ResourceStatus==`CREATE_FAILED`].[ResourceType,ResourceStatusReason]' \
                --output table
            exit 1
        fi
    else
        aws cloudformation wait stack-update-complete --stack-name "$STACK_NAME" 2>/dev/null || true
    fi

    print_msg "$GREEN" "✓ CloudFormation stack deployed successfully"
fi

# Update Lambda function code
print_section "Updating Lambda Function Code"

# Get function names from stack outputs
SUBMIT_FUNCTION=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='SubmitJobFunctionArn'].OutputValue" \
    --output text | cut -d':' -f7)

PROCESS_FUNCTION=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='ProcessJobFunctionArn'].OutputValue" \
    --output text | cut -d':' -f7)

STATUS_FUNCTION=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='GetStatusFunctionArn'].OutputValue" \
    --output text | cut -d':' -f7)

# Update each function
print_msg "$YELLOW" "Updating $SUBMIT_FUNCTION..."
aws lambda update-function-code \
    --function-name "$SUBMIT_FUNCTION" \
    --zip-file fileb://build/submit-job.zip \
    --no-cli-pager >/dev/null

print_msg "$YELLOW" "Updating $PROCESS_FUNCTION..."
aws lambda update-function-code \
    --function-name "$PROCESS_FUNCTION" \
    --zip-file fileb://build/process-job.zip \
    --no-cli-pager >/dev/null

print_msg "$YELLOW" "Updating $STATUS_FUNCTION..."
aws lambda update-function-code \
    --function-name "$STATUS_FUNCTION" \
    --zip-file fileb://build/get-status.zip \
    --no-cli-pager >/dev/null

print_msg "$GREEN" "✓ All Lambda functions updated"

# Get outputs
print_section "Deployment Complete"

API_ENDPOINT=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
    --output text)

JOBS_TABLE=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='JobsTableName'].OutputValue" \
    --output text)

RESULTS_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='ResultsBucketName'].OutputValue" \
    --output text)

print_msg "$GREEN" "✅ Async architecture deployed successfully!"
echo ""
print_msg "$BLUE" "📋 Important Information:"
echo ""
print_msg "$BLUE" "  API Endpoint:"
print_msg "$YELLOW" "  $API_ENDPOINT"
echo ""
print_msg "$BLUE" "  DynamoDB Table:"
print_msg "$YELLOW" "  $JOBS_TABLE"
echo ""
print_msg "$BLUE" "  S3 Results Bucket:"
print_msg "$YELLOW" "  $RESULTS_BUCKET"
echo ""

# Save to config file
cat > deployment-async-output.json <<EOF
{
  "apiEndpoint": "$API_ENDPOINT",
  "jobsTable": "$JOBS_TABLE",
  "resultsBucket": "$RESULTS_BUCKET",
  "environment": "$ENVIRONMENT",
  "region": "$AWS_REGION",
  "stackName": "$STACK_NAME",
  "deploymentTime": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

print_msg "$GREEN" "Configuration saved to: deployment-async-output.json"

# Update frontend config
print_section "Next Steps"

print_msg "$YELLOW" "1. Update frontend API URL:"
print_msg "$BLUE" "   File: ../js/async-api-client.js"
print_msg "$BLUE" "   Change: ASYNC_API_BASE_URL = '$API_ENDPOINT'"
echo ""

print_msg "$YELLOW" "2. Update app.js to use async client (I'll do this for you)"
echo ""

print_msg "$YELLOW" "3. Push changes to GitHub:"
print_msg "$BLUE" "   cd .."
print_msg "$BLUE" "   git add ."
print_msg "$BLUE" "   git commit -m 'feat: Add async PDF processing architecture'"
print_msg "$BLUE" "   git push origin main"
echo ""

print_msg "$YELLOW" "4. Test your application!"
echo ""

print_msg "$GREEN" "🎉 Deployment complete!"
