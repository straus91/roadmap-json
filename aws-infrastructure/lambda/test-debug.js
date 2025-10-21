/**
 * Local test script for Lambda function with debug mode
 * Run with: node test-debug.js
 */

const handler = require('./index').handler;

// Sample event mimicking API Gateway format with simple request body
const sampleEvent = {
    httpMethod: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        prompt: 'Test prompt: What is 2+2? Respond with just the number.',
        model: 'gemini-2.5-flash',
        temperature: 0.2,
        maxOutputTokens: 1024,
        images: []
    })
};

// Mock context
const mockContext = {
    requestId: 'test-request-123',
    getRemainingTimeInMillis: () => 30000,
    functionName: 'test-function',
    awsRequestId: 'test-aws-request-123'
};

// Run the test
async function runTest() {
    console.log('🧪 Testing Lambda function locally...\n');
    console.log('📤 Sending test request with Gemini format...\n');

    try {
        const result = await handler(sampleEvent, mockContext);

        console.log('\n✅ Lambda Response:');
        console.log('Status Code:', result.statusCode);
        console.log('Headers:', JSON.stringify(result.headers, null, 2));

        if (result.body) {
            const body = JSON.parse(result.body);
            console.log('\n📄 Response Body:');
            console.log(JSON.stringify(body, null, 2));

            // Check if debug data is present
            if (body.debug) {
                console.log('\n🐛 Debug Data Found:');
                console.log('- Request payload included:', !!body.debug.requestPayload);
                console.log('- Gemini response included:', !!body.debug.geminiResponse);
                console.log('- Processing time:', body.debug.processingTimeMs || 'N/A');
            } else {
                console.log('\n⚠️  No debug data in response');
            }
        }

    } catch (error) {
        console.error('\n❌ Test failed:');
        console.error(error);
        process.exit(1);
    }
}

// Check if AWS credentials are available
if (!process.env.GEMINI_SECRET_ARN) {
    console.warn('⚠️  GEMINI_SECRET_ARN not set - test will fail on AWS calls');
    console.warn('   Set environment variable to test with real AWS services\n');
}

runTest();
