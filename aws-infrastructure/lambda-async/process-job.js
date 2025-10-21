/**
 * Process Job Lambda - Async PDF processing worker
 *
 * Flow:
 * 1. Receives job from submit-job Lambda
 * 2. Updates job status to "processing"
 * 3. Calls Gemini API (can take 30-60+ seconds - no timeout!)
 * 4. Saves results to S3
 * 5. Updates job status to "completed"
 *
 * This runs async, so it can take as long as needed (up to 5 minutes)
 *
 * @author Claude Code
 * @version 1.0.0
 */

const https = require('https');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

// AWS clients
const ddbClient = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(ddbClient);
const s3Client = new S3Client({});
const secretsClient = new SecretsManagerClient({});

// Environment variables
const JOBS_TABLE = process.env.JOBS_TABLE;
const RESULTS_BUCKET = process.env.RESULTS_BUCKET;
const GEMINI_SECRET_ARN = process.env.GEMINI_SECRET_ARN;
const ENVIRONMENT = process.env.ENVIRONMENT || 'prod';

// Gemini API configuration
const GEMINI_API_ENDPOINT = 'generativelanguage.googleapis.com';
const GEMINI_API_PATH = '/v1beta/models';
const DEFAULT_MODEL = 'gemini-2.5-flash';
const MAX_OUTPUT_TOKENS = 8192;

// Cached API key
let cachedApiKey = null;

/**
 * Lambda handler
 */
exports.handler = async (event) => {
    const { jobId, pdfData, schema, cardType, processingMode } = event;
    console.log(`Processing job: ${jobId}`);

    try {
        // Update job status to "processing"
        await updateJobStatus(jobId, 'processing', { startedAt: new Date().toISOString() });

        // Get Gemini API key
        const apiKey = await getGeminiApiKey();

        // Build extraction prompt
        const prompt = buildExtractionPrompt(pdfData, schema, cardType, processingMode);
        console.log(`Prompt length: ${prompt.length} characters`);

        // Call Gemini API (can take 30-60+ seconds, no problem!)
        const startTime = Date.now();
        const geminiResponse = await callGeminiAPI(apiKey, prompt, {
            model: DEFAULT_MODEL,
            maxOutputTokens: MAX_OUTPUT_TOKENS
        });
        const duration = Date.now() - startTime;

        console.log(`Gemini API completed in ${duration}ms`);

        // Extract JSON from response
        const extractedData = extractJsonFromResponse(geminiResponse);

        // Save results to S3
        const s3Key = `results/${jobId}.json`;
        await s3Client.send(new PutObjectCommand({
            Bucket: RESULTS_BUCKET,
            Key: s3Key,
            Body: JSON.stringify(extractedData, null, 2),
            ContentType: 'application/json',
            Metadata: {
                jobId,
                cardType,
                processingMode,
                processingDuration: duration.toString()
            }
        }));

        console.log(`Results saved to S3: ${s3Key}`);

        // Update job status to "completed"
        await updateJobStatus(jobId, 'completed', {
            completedAt: new Date().toISOString(),
            duration,
            s3Key,
            resultUrl: `s3://${RESULTS_BUCKET}/${s3Key}`
        });

        console.log(`Job completed: ${jobId}`);

        return { success: true, jobId, s3Key };

    } catch (error) {
        console.error(`Error processing job ${jobId}:`, error);

        // Update job status to "failed"
        await updateJobStatus(jobId, 'failed', {
            failedAt: new Date().toISOString(),
            error: error.message,
            stack: error.stack
        });

        // Re-throw to trigger DLQ
        throw error;
    }
};

/**
 * Update job status in DynamoDB
 */
async function updateJobStatus(jobId, status, additionalData = {}) {
    const updateExpression = ['SET #status = :status', 'updatedAt = :updatedAt'];
    const expressionAttributeNames = { '#status': 'status' };
    const expressionAttributeValues = {
        ':status': status,
        ':updatedAt': new Date().toISOString()
    };

    // Add any additional fields
    Object.entries(additionalData).forEach(([key, value], index) => {
        const attrName = `#attr${index}`;
        const attrValue = `:val${index}`;
        updateExpression.push(`${attrName} = ${attrValue}`);
        expressionAttributeNames[attrName] = key;
        expressionAttributeValues[attrValue] = value;
    });

    await docClient.send(new UpdateCommand({
        TableName: JOBS_TABLE,
        Key: { jobId },
        UpdateExpression: updateExpression.join(', '),
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues
    }));
}

/**
 * Get Gemini API key from Secrets Manager
 */
async function getGeminiApiKey() {
    if (cachedApiKey) return cachedApiKey;

    const response = await secretsClient.send(new GetSecretValueCommand({
        SecretId: GEMINI_SECRET_ARN
    }));

    let apiKey;
    try {
        const parsed = JSON.parse(response.SecretString);
        apiKey = parsed.apiKey || parsed.GEMINI_API_KEY || response.SecretString;
    } catch {
        apiKey = response.SecretString;
    }

    cachedApiKey = apiKey;
    return apiKey;
}

/**
 * Build extraction prompt (simplified version from gemini-client.js)
 */
function buildExtractionPrompt(pdfData, schema, cardType, processingMode) {
    const cardTypeUpper = cardType.toUpperCase();

    // Remove references
    const cleanedText = removeReferences(pdfData.text || '');

    // Truncate tables
    const tablesText = truncateTablesForPrompt(pdfData.tables || [], 15000);

    return `Extract medical imaging research data into ROADMAP ${cardTypeUpper} card JSON format.

**EXTRACTION RULES:**
• Extract ALL authors with affiliations, keywords, and exact numerical values - never summarize
• For Content/Keywords fields: extract ALL applicable codes/terms as arrays
• RadLex/SNOMED codes: ONLY if explicitly stated in PDF - do NOT guess or generate
• Omit fields with no data (no empty arrays/objects)
• Return ONLY valid JSON (no markdown, no explanations)

**RESULTS FORMAT:**
Use simple string format for values:
- "Result Information": description
- "Metric": array of metric names
- "Value": simple string with all values (e.g., "Model A: 0.88, Model B: 0.86")
- "Uncertainty": confidence intervals as string
- "Subset": dataset subset
Do NOT use nested objects in Value field

**REQUIRED JSON STRUCTURE:**
${JSON.stringify(generateSchemaExample(schema, cardType), null, 2)}

**DOCUMENT TEXT:**
"""${cleanedText.substring(0, 15000)}"""

${tablesText ? `**TABLES:**\n${tablesText}` : ''}

**OUTPUT:**`;
}

/**
 * Remove references section from text
 */
function removeReferences(text) {
    const referencePatterns = [
        /\n\s*REFERENCES\s*\n/i,
        /\n\s*References\s*\n/i,
        /\n\s*BIBLIOGRAPHY\s*\n/i
    ];

    let earliestMatch = text.length;
    for (const pattern of referencePatterns) {
        const match = text.search(pattern);
        if (match !== -1 && match < earliestMatch) {
            earliestMatch = match;
        }
    }

    return earliestMatch < text.length ? text.substring(0, earliestMatch) : text;
}

/**
 * Truncate tables for prompt (simplified)
 */
function truncateTablesForPrompt(tables, maxChars) {
    if (!tables || tables.length === 0) return '';

    let result = '';
    let currentLength = 0;

    for (const table of tables) {
        const tableJson = JSON.stringify(table, null, 2);
        const tableStr = `TABLE (Page ${table.page}):\n${tableJson}\n\n`;

        if (currentLength + tableStr.length > maxChars) break;

        result += tableStr;
        currentLength += tableStr.length;
    }

    return result;
}

/**
 * Generate schema example (simplified)
 */
function generateSchemaExample(schema, cardType) {
    const properties = schema.properties || {};
    const example = {};

    Object.entries(properties).forEach(([key, prop]) => {
        if (prop.type === 'string') example[key] = `Example ${key}`;
        else if (prop.type === 'array') example[key] = [];
        else if (prop.type === 'object') example[key] = {};
    });

    return example;
}

/**
 * Call Gemini API
 */
async function callGeminiAPI(apiKey, prompt, options = {}) {
    const model = options.model || DEFAULT_MODEL;
    const maxOutputTokens = options.maxOutputTokens || MAX_OUTPUT_TOKENS;

    const payload = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.2,
            maxOutputTokens,
            topK: 40,
            topP: 0.95
        }
    };

    const postData = JSON.stringify(payload);
    const url = `https://${GEMINI_API_ENDPOINT}${GEMINI_API_PATH}/${model}:generateContent?key=${apiKey}`;

    return new Promise((resolve, reject) => {
        const req = https.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(JSON.parse(data));
                } else {
                    reject(new Error(`HTTP ${res.statusCode}: ${data}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(120000, () => {  // 2 minutes timeout (plenty of time!)
            req.destroy();
            reject(new Error('Request timeout'));
        });

        req.write(postData);
        req.end();
    });
}

/**
 * Extract JSON from Gemini response
 */
function extractJsonFromResponse(geminiResponse) {
    const text = geminiResponse.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Try to extract JSON from markdown code blocks
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
        return JSON.parse(jsonMatch[1]);
    }

    // Try to parse the whole response
    try {
        return JSON.parse(text);
    } catch {
        // If all else fails, return the raw text
        return { raw: text };
    }
}
