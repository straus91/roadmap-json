/**
 * Get Status Lambda - Returns job status and results
 *
 * Flow:
 * 1. Frontend polls this endpoint every 2 seconds
 * 2. Returns job status: pending, processing, completed, or failed
 * 3. If completed, includes S3 presigned URL to download results
 * 4. If failed, includes error details
 *
 * This is called frequently, so it's optimized for speed
 *
 * @author Claude Code
 * @version 1.0.0
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

// AWS clients
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const s3Client = new S3Client({});

// Environment variables
const JOBS_TABLE = process.env.JOBS_TABLE;
const RESULTS_BUCKET = process.env.RESULTS_BUCKET;
const ENVIRONMENT = process.env.ENVIRONMENT || 'prod';

// Presigned URL expiration (15 minutes)
const PRESIGNED_URL_EXPIRATION = 900;

/**
 * Lambda handler
 */
exports.handler = async (event) => {
    // Extract job ID from path parameters
    const jobId = event.pathParameters?.jobId;

    if (!jobId) {
        return response(400, { error: 'Missing jobId in path' });
    }

    console.log(`Getting status for job: ${jobId}`);

    try {
        // Get job from DynamoDB
        const result = await docClient.send(new GetCommand({
            TableName: JOBS_TABLE,
            Key: { jobId }
        }));

        if (!result.Item) {
            return response(404, { error: 'Job not found', jobId });
        }

        const job = result.Item;

        // Build response based on status
        const responseBody = {
            jobId: job.jobId,
            status: job.status,
            cardType: job.cardType,
            processingMode: job.processingMode,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt
        };

        // Add status-specific data
        switch (job.status) {
            case 'pending':
                responseBody.message = 'Job is queued for processing';
                responseBody.estimatedWaitTime = '10-30 seconds';
                break;

            case 'processing':
                responseBody.message = 'Job is currently being processed';
                responseBody.startedAt = job.startedAt;

                // Calculate approximate progress (rough estimate)
                if (job.startedAt) {
                    const elapsed = Date.now() - new Date(job.startedAt).getTime();
                    const estimatedTotal = 45000; // 45 seconds estimate
                    responseBody.progress = Math.min(Math.floor((elapsed / estimatedTotal) * 100), 95);
                }
                break;

            case 'completed':
                responseBody.message = 'Job completed successfully';
                responseBody.completedAt = job.completedAt;
                responseBody.duration = job.duration;

                // Generate presigned URL for results
                if (job.s3Key) {
                    try {
                        const command = new GetObjectCommand({
                            Bucket: RESULTS_BUCKET,
                            Key: job.s3Key
                        });

                        const presignedUrl = await getSignedUrl(s3Client, command, {
                            expiresIn: PRESIGNED_URL_EXPIRATION
                        });

                        responseBody.resultUrl = presignedUrl;
                        responseBody.urlExpiresIn = PRESIGNED_URL_EXPIRATION;

                        // Also try to fetch and include the actual data
                        // (small optimization - saves frontend an extra request)
                        try {
                            const s3Response = await s3Client.send(command);
                            const resultData = await streamToString(s3Response.Body);
                            responseBody.result = JSON.parse(resultData);
                        } catch (fetchError) {
                            console.warn('Could not fetch result data:', fetchError);
                            // Not critical - frontend can use presigned URL
                        }
                    } catch (urlError) {
                        console.error('Error generating presigned URL:', urlError);
                        responseBody.error = 'Could not generate download URL';
                    }
                }
                break;

            case 'failed':
                responseBody.message = 'Job processing failed';
                responseBody.failedAt = job.failedAt;
                responseBody.error = job.error;

                // Don't expose full stack trace to frontend
                if (ENVIRONMENT !== 'prod' && job.stack) {
                    responseBody.stack = job.stack;
                }
                break;

            default:
                responseBody.message = 'Unknown job status';
        }

        // Add metadata if available
        if (job.metadata) {
            responseBody.metadata = job.metadata;
        }

        return response(200, responseBody);

    } catch (error) {
        console.error(`Error getting job status for ${jobId}:`, error);
        return response(500, {
            error: 'Failed to retrieve job status',
            message: error.message,
            jobId,
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
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Cache-Control': 'no-cache, no-store, must-revalidate'  // Don't cache status
        },
        body: JSON.stringify(body)
    };
}

/**
 * Helper: Convert stream to string
 */
async function streamToString(stream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}
