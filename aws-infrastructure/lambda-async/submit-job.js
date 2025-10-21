/**
 * Submit Job Lambda - Creates a new PDF processing job
 *
 * Flow:
 * 1. Receives PDF data from frontend
 * 2. Generates unique job ID
 * 3. Stores job in DynamoDB with status "pending"
 * 4. Invokes async processing Lambda
 * 5. Returns job ID to frontend immediately
 *
 * @author Claude Code
 * @version 1.0.0
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { randomUUID } = require('crypto');

// AWS clients
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const lambdaClient = new LambdaClient({});

// Environment variables
const JOBS_TABLE = process.env.JOBS_TABLE;
const PROCESS_JOB_FUNCTION = process.env.PROCESS_JOB_FUNCTION;
const ENVIRONMENT = process.env.ENVIRONMENT || 'prod';

/**
 * Lambda handler
 */
exports.handler = async (event) => {
    console.log('Submit job request received');

    try {
        // Parse request body
        let body;
        try {
            body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        } catch (error) {
            console.error('Invalid JSON in request body:', error);
            return response(400, { error: 'Invalid JSON in request body' });
        }

        // Validate required fields
        if (!body.pdfData || !body.schema || !body.cardType) {
            return response(400, {
                error: 'Missing required fields',
                required: ['pdfData', 'schema', 'cardType']
            });
        }

        // Generate unique job ID
        const jobId = randomUUID();
        const now = new Date().toISOString();
        const expiresAt = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60); // 7 days from now

        // Extract user ID from headers (or use anonymous)
        const userId = event.headers?.['x-user-id'] || 'anonymous';

        // Create job record
        const job = {
            jobId,
            userId,
            status: 'pending',
            cardType: body.cardType,
            processingMode: body.processingMode || 'text-only',
            createdAt: now,
            updatedAt: now,
            expiresAt,  // TTL for auto-cleanup
            metadata: {
                pdfTextLength: body.pdfData.text?.length || 0,
                tableCount: body.pdfData.tables?.length || 0,
                imageCount: body.pdfData.images?.length || 0
            }
        };

        // Store job in DynamoDB
        await docClient.send(new PutCommand({
            TableName: JOBS_TABLE,
            Item: job
        }));

        console.log(`Job created: ${jobId}`);

        // Invoke async processing Lambda
        const payload = {
            jobId,
            pdfData: body.pdfData,
            schema: body.schema,
            cardType: body.cardType,
            processingMode: body.processingMode || 'text-only'
        };

        await lambdaClient.send(new InvokeCommand({
            FunctionName: PROCESS_JOB_FUNCTION,
            InvocationType: 'Event',  // Async invocation
            Payload: JSON.stringify(payload)
        }));

        console.log(`Processing Lambda invoked for job: ${jobId}`);

        // Return job ID immediately (don't wait for processing)
        return response(202, {  // 202 Accepted
            jobId,
            status: 'pending',
            message: 'Job submitted successfully. Poll /status/{jobId} for results.',
            pollUrl: `/status/${jobId}`
        });

    } catch (error) {
        console.error('Error submitting job:', error);
        return response(500, {
            error: 'Failed to submit job',
            message: error.message,
            requestId: event.requestContext?.requestId
        });
    }
};

/**
 * Helper: Create HTTP response
 */
function response(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
        },
        body: JSON.stringify(body)
    };
}
