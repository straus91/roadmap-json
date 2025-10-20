#!/bin/bash

###############################################################################
# ROADMAP Model Card Editor - AWS Deployment Script
#
# This script deploys the complete MVP backend infrastructure to AWS using
# CloudFormation and automated Lambda packaging.
#
# Prerequisites:
#   - AWS CLI installed and configured (aws configure)
#   - Node.js 20+ installed
#   - Valid Gemini API key
#   - AWS account with appropriate permissions
#
# Usage:
#   ./deploy.sh <gemini-api-key> <alert-email> [environment] [budget]
#
# Example:
#   ./deploy.sh AIzaSyABC123... admin@example.com prod 5
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

# Check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Validate prerequisites
validate_prerequisites() {
    print_section "Validating Prerequisites"

    # Check AWS CLI
    if ! command_exists aws; then
        print_msg "$RED" "❌ AWS CLI not found. Please install: https://aws.amazon.com/cli/"
        exit 1
    fi
    print_msg "$GREEN" "✓ AWS CLI found: $(aws --version)"

    # Check AWS credentials
    if ! aws sts get-caller-identity >/dev/null 2>&1; then
        print_msg "$RED" "❌ AWS credentials not configured. Run: aws configure"
        exit 1
    fi
    AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
    AWS_REGION=$(aws configure get region)
    print_msg "$GREEN" "✓ AWS credentials valid"
    print_msg "$GREEN" "  Account: $AWS_ACCOUNT"
    print_msg "$GREEN" "  Region: $AWS_REGION"

    # Check Node.js
    if ! command_exists node; then
        print_msg "$RED" "❌ Node.js not found. Please install Node.js 20+"
        exit 1
    fi
    NODE_VERSION=$(node --version)
    print_msg "$GREEN" "✓ Node.js found: $NODE_VERSION"

    # Check npm
    if ! command_exists npm; then
        print_msg "$RED" "❌ npm not found. Please install npm"
        exit 1
    fi
    print_msg "$GREEN" "✓ npm found: $(npm --version)"

    # Check zip
    if ! command_exists zip; then
        print_msg "$RED" "❌ zip not found. Please install zip utility"
        exit 1
    fi
    print_msg "$GREEN" "✓ zip utility found"
}

# Parse arguments
parse_arguments() {
    if [ $# -lt 2 ]; then
        print_msg "$RED" "Usage: $0 <gemini-api-key> <alert-email> [environment] [budget]"
        print_msg "$YELLOW" ""
        print_msg "$YELLOW" "Arguments:"
        print_msg "$YELLOW" "  gemini-api-key  Your Google Gemini API key (required)"
        print_msg "$YELLOW" "  alert-email     Email for alerts (required)"
        print_msg "$YELLOW" "  environment     Environment name: dev, staging, prod (default: prod)"
        print_msg "$YELLOW" "  budget          Monthly budget in USD (default: 5)"
        print_msg "$YELLOW" ""
        print_msg "$YELLOW" "Example:"
        print_msg "$YELLOW" "  $0 AIzaSyABC123... admin@example.com prod 10"
        exit 1
    fi

    GEMINI_API_KEY="$1"
    ALERT_EMAIL="$2"
    ENVIRONMENT="${3:-prod}"
    BUDGET="${4:-5}"

    # Validate API key format
    if [[ ! "$GEMINI_API_KEY" =~ ^AIza[0-9A-Za-z_-]{35}$ ]]; then
        print_msg "$RED" "❌ Invalid Gemini API key format"
        print_msg "$YELLOW" "   Expected: AIza followed by 35 characters"
        exit 1
    fi

    # Validate email format
    if [[ ! "$ALERT_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
        print_msg "$RED" "❌ Invalid email address format"
        exit 1
    fi

    # Validate environment
    if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
        print_msg "$RED" "❌ Invalid environment: $ENVIRONMENT"
        print_msg "$YELLOW" "   Must be one of: dev, staging, prod"
        exit 1
    fi

    print_section "Deployment Configuration"
    print_msg "$GREEN" "Environment:       $ENVIRONMENT"
    print_msg "$GREEN" "Alert Email:       $ALERT_EMAIL"
    print_msg "$GREEN" "Monthly Budget:    \$$BUDGET USD"
    print_msg "$GREEN" "AWS Region:        $AWS_REGION"
    print_msg "$GREEN" "API Key:           ****${GEMINI_API_KEY: -4}"
}

# Package Lambda function
package_lambda() {
    print_section "Packaging Lambda Function"

    cd lambda

    # Install production dependencies
    print_msg "$YELLOW" "Installing dependencies..."
    npm ci --production --quiet

    # Create deployment package
    print_msg "$YELLOW" "Creating deployment package..."
    if [ -f function.zip ]; then
        rm function.zip
    fi
    zip -qr function.zip node_modules/ index.js package.json

    PACKAGE_SIZE=$(du -h function.zip | cut -f1)
    print_msg "$GREEN" "✓ Lambda package created: function.zip ($PACKAGE_SIZE)"

    cd ..
}

# Deploy CloudFormation stack
deploy_stack() {
    print_section "Deploying CloudFormation Stack"

    STACK_NAME="roadmap-backend-$ENVIRONMENT"

    # Check if stack exists
    if aws cloudformation describe-stacks --stack-name "$STACK_NAME" >/dev/null 2>&1; then
        print_msg "$YELLOW" "Stack exists. Updating..."
        OPERATION="update-stack"
    else
        print_msg "$YELLOW" "Creating new stack..."
        OPERATION="create-stack"
    fi

    # Deploy stack
    aws cloudformation $OPERATION \
        --stack-name "$STACK_NAME" \
        --template-body file://cloudformation-mvp.yaml \
        --parameters \
            ParameterKey=GeminiApiKey,ParameterValue="$GEMINI_API_KEY" \
            ParameterKey=AlertEmail,ParameterValue="$ALERT_EMAIL" \
            ParameterKey=Environment,ParameterValue="$ENVIRONMENT" \
            ParameterKey=MonthlyBudgetLimit,ParameterValue="$BUDGET" \
        --capabilities CAPABILITY_NAMED_IAM \
        --tags \
            Key=Application,Value=ROADMAP \
            Key=Environment,Value="$ENVIRONMENT" \
            Key=ManagedBy,Value=CloudFormation

    print_msg "$YELLOW" "Waiting for stack operation to complete..."
    print_msg "$YELLOW" "(This may take 2-3 minutes)"

    if [ "$OPERATION" = "create-stack" ]; then
        aws cloudformation wait stack-create-complete --stack-name "$STACK_NAME"
    else
        aws cloudformation wait stack-update-complete --stack-name "$STACK_NAME" 2>/dev/null || true
    fi

    print_msg "$GREEN" "✓ CloudFormation stack deployed successfully"
}

# Update Lambda function code
update_lambda_code() {
    print_section "Updating Lambda Function Code"

    STACK_NAME="roadmap-backend-$ENVIRONMENT"

    # Get Lambda function name from stack
    FUNCTION_NAME=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --query "Stacks[0].Outputs[?OutputKey=='LambdaFunctionArn'].OutputValue" \
        --output text | cut -d':' -f7)

    if [ -z "$FUNCTION_NAME" ]; then
        print_msg "$RED" "❌ Could not find Lambda function name"
        exit 1
    fi

    print_msg "$YELLOW" "Updating function: $FUNCTION_NAME"

    # Update function code
    aws lambda update-function-code \
        --function-name "$FUNCTION_NAME" \
        --zip-file fileb://lambda/function.zip \
        --no-cli-pager >/dev/null

    print_msg "$GREEN" "✓ Lambda function code updated"

    # Wait for update to complete
    print_msg "$YELLOW" "Waiting for function update to complete..."
    aws lambda wait function-updated --function-name "$FUNCTION_NAME"

    print_msg "$GREEN" "✓ Function update completed"
}

# Get stack outputs
get_outputs() {
    print_section "Deployment Outputs"

    STACK_NAME="roadmap-backend-$ENVIRONMENT"

    API_ENDPOINT=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --query "Stacks[0].Outputs[?OutputKey=='ApiEndpoint'].OutputValue" \
        --output text)

    LAMBDA_ARN=$(aws cloudformation describe-stacks \
        --stack-name "$STACK_NAME" \
        --query "Stacks[0].Outputs[?OutputKey=='LambdaFunctionArn'].OutputValue" \
        --output text)

    print_msg "$GREEN" "✓ Deployment completed successfully!"
    echo ""
    print_msg "$GREEN" "📋 Important Information:"
    echo ""
    print_msg "$BLUE" "  API Endpoint (use in frontend):"
    print_msg "$YELLOW" "  $API_ENDPOINT"
    echo ""
    print_msg "$BLUE" "  Lambda Function ARN:"
    print_msg "$YELLOW" "  $LAMBDA_ARN"
    echo ""
    print_msg "$BLUE" "  CloudWatch Logs:"
    print_msg "$YELLOW" "  https://console.aws.amazon.com/cloudwatch/home?region=$AWS_REGION#logsV2:log-groups/log-group/\$252Faws\$252Flambda\$252F$(echo $LAMBDA_ARN | cut -d':' -f7)"
    echo ""
    print_msg "$BLUE" "  Stack Name:"
    print_msg "$YELLOW" "  $STACK_NAME"
    echo ""

    # Save to config file
    cat > deployment-output.json <<EOF
{
  "apiEndpoint": "$API_ENDPOINT",
  "lambdaArn": "$LAMBDA_ARN",
  "environment": "$ENVIRONMENT",
  "region": "$AWS_REGION",
  "stackName": "$STACK_NAME",
  "deploymentTime": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
}
EOF

    print_msg "$GREEN" "Configuration saved to: deployment-output.json"
}

# Test deployment
test_deployment() {
    print_section "Testing Deployment"

    API_ENDPOINT=$(cat deployment-output.json | grep apiEndpoint | cut -d'"' -f4)

    print_msg "$YELLOW" "Sending test request to Lambda..."

    # Test request
    RESPONSE=$(curl -s -X POST "$API_ENDPOINT" \
        -H "Content-Type: application/json" \
        -d '{"prompt":"Say hello in one word"}')

    if echo "$RESPONSE" | grep -q "candidates"; then
        print_msg "$GREEN" "✓ Test request successful!"
        print_msg "$GREEN" "  Backend is responding correctly"
    else
        print_msg "$RED" "⚠️  Test request failed"
        print_msg "$YELLOW" "  Response: $RESPONSE"
        print_msg "$YELLOW" "  Check CloudWatch logs for details"
    fi
}

# Print next steps
print_next_steps() {
    print_section "Next Steps"

    print_msg "$YELLOW" "1. Update your frontend:"
    print_msg "$BLUE" "   Edit: public/js/backend-api-client.js"
    print_msg "$BLUE" "   Set: API_GATEWAY_URL = '$API_ENDPOINT'"
    echo ""

    print_msg "$YELLOW" "2. Deploy frontend to AWS Amplify or S3"
    echo ""

    print_msg "$YELLOW" "3. Monitor your deployment:"
    print_msg "$BLUE" "   CloudWatch: https://console.aws.amazon.com/cloudwatch"
    print_msg "$BLUE" "   Lambda: https://console.aws.amazon.com/lambda"
    echo ""

    print_msg "$YELLOW" "4. Check your email for SNS subscription confirmation"
    echo ""

    print_msg "$GREEN" "🎉 Deployment complete! Your MVP is live!"
}

# Cleanup on error
cleanup() {
    if [ $? -ne 0 ]; then
        print_msg "$RED" ""
        print_msg "$RED" "❌ Deployment failed!"
        print_msg "$YELLOW" "Check the error messages above for details"
    fi
}

trap cleanup EXIT

# Main execution
main() {
    clear
    print_msg "$GREEN" "╔═══════════════════════════════════════════════════════════════╗"
    print_msg "$GREEN" "║   ROADMAP Model Card Editor - AWS MVP Deployment Script      ║"
    print_msg "$GREEN" "╚═══════════════════════════════════════════════════════════════╝"

    validate_prerequisites
    parse_arguments "$@"

    # Confirm deployment
    echo ""
    print_msg "$YELLOW" "Ready to deploy. Continue? (y/n)"
    read -r CONFIRM
    if [[ ! "$CONFIRM" =~ ^[Yy]$ ]]; then
        print_msg "$YELLOW" "Deployment cancelled"
        exit 0
    fi

    package_lambda
    deploy_stack
    update_lambda_code
    get_outputs
    test_deployment
    print_next_steps
}

# Run main function
main "$@"
