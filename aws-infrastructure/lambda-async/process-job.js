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
const DEFAULT_MODEL = 'gemini-2.5-flash';  // Flash for better rate limits (15 RPM vs 2 RPM for Pro)
const MAX_OUTPUT_TOKENS = 65536;  // Gemini 2.5 Flash max output (4x increase from 16K)

// Retry configuration for API rate limits and overload
const MAX_RETRIES = 10;  // Maximum retry attempts for 429/503 errors
const INITIAL_RETRY_DELAY_MS = 1000;  // Start with 1 second
const MAX_RETRY_DELAY_MS = 60000;  // Max 60 seconds between retries
const BACKOFF_MULTIPLIER = 2;  // Exponential backoff multiplier

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

        // Build extraction prompt (using comprehensive version from frontend)
        const prompt = createExtractionPrompt(pdfData, schema, cardType, processingMode);
        console.log(`Prompt length: ${prompt.length} characters`);

        // Call Gemini API with retry logic (can take 30-60+ seconds, no problem!)
        const startTime = Date.now();
        const geminiResponse = await callGeminiAPIWithRetry(apiKey, prompt, {
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
 * Create extraction prompt (comprehensive version from gemini-client.js)
 * Generates detailed schema example with all fields to guide Gemini
 */
function createExtractionPrompt(pdfData, schema, cardType, processingMode) {
    const cardTypeUpper = cardType.toUpperCase();
    const cardTypeCapitalized = cardType.charAt(0).toUpperCase() + cardType.slice(1);

    // Generate complete structure directly from GitHub schema with deep traversal
    console.log('📝 Generating example structure from GitHub schema...');
    const exampleStructure = generateSchemaExample(schema, cardType);
    const exampleJson = JSON.stringify(exampleStructure, null, 2);
    console.log(`✅ Generated example structure (${exampleJson.length} characters)`);

    // Remove references section
    const cleanedText = removeReferences(pdfData.text || '');

    // Smart table handling - no truncation, use intelligent prioritization
    const tablesText = pdfData.tables && pdfData.tables.length > 0
        ? truncateTablesForPrompt(pdfData.tables, 100000)  // Very large limit, let smart scoring handle it
        : '';

    return `Extract medical imaging research data into ROADMAP ${cardTypeUpper} card JSON format.

**EXTRACTION RULES:**
• Extract ALL authors with affiliations, keywords, and exact numerical values - never summarize
• For Content/Keywords fields: extract ALL applicable codes/terms as arrays
• RadLex/SNOMED codes: ONLY if explicitly stated in PDF - do NOT guess or generate
• Omit fields with no data (no empty arrays/objects)
• Return ONLY valid JSON (no markdown, no explanations)

**INDEXING EXTRACTION:**

Keywords - Extract from paper's Keywords section (priority order):
1. Look for "Keywords:", "Key words:", "Index terms:" (usually after abstract)
2. If found: extract exactly as written by authors (use FIRST found location only)
3. If not found: extract 5-15 specific technical terms from document content

INCLUDE: Imaging modalities, anatomical structures, pathologies, AI architectures, clinical tasks
EXCLUDE: "Deep Learning", "Machine Learning", "Artificial Intelligence", "Study", "Method", "Research"

Content Codes - RSNA 2-letter codes (extract ALL that apply to paper's CENTRAL topics):
Strategy: 1) Look for codes in PDF text/metadata, 2) If not found, infer from paper focus
• AI: machine learning, deep learning, neural networks (if central topic)
• BR: breast imaging, mammography (if central topic)
• BQ: radiomics, quantitative imaging, biomarkers
• CA: cardiac, heart, coronary imaging
• CH: chest, lung, thoracic imaging
• CT: computed tomography (if modality is focus)
• MR: MRI, magnetic resonance (if modality is focus)
• US: ultrasound, sonography (if modality is focus)
• NR: neuroradiology, brain, spine, CNS
• OB: obstetric, fetal, prenatal imaging
• OI: oncologic imaging, cancer imaging
• PD: pediatric, children, neonatal

⚠️ IMPORTANT: Only include codes CENTRAL to the paper (in title/abstract/main focus).
Don't include codes for concepts just briefly mentioned.

Example: "AI breast cancer detection" → [AI, BR, OI] ✓
Example: "Brain tumor study using MRI" → [NR, OI, MR] ✓
Example: "CT quality paper that mentions AI once" → [CT, PH] (NOT AI) ✓

**PARTITION EXTRACTION (Dataset Cards):**
For dataset partitions (training/validation/test splits), extract:
• Patient Count: total number of unique patients
• Exam Count: total number of imaging exams/studies
• Image Count: total number of images
• Age Range: min-max age of patients (e.g., "18-85 years")
• Sex Distribution: breakdown by gender (e.g., "52% female, 48% male")
• Demographics: racial/ethnic composition if stated
• Subset Criterion: how this partition differs (e.g., "Images with confirmed diagnosis")
Look for this data in tables with headers like "Training Set", "Validation Set", "Test Set", "Dataset Statistics", "Cohort Characteristics"

**METRICS EXTRACTION (CLAIM 2024 Compliant):**

Metric names (array): Extract performance metric TYPES from this list:
"accuracy", "sensitivity", "specificity", "area under the receiver operating characteristic curve",
"Dice similarity coefficient", "F1 score", "precision", "recall", "mean absolute error",
"confusion matrix", "calibration curve", "precision-recall curve"

Metrics description (string): Combine ALL numerical results into ONE comprehensive description.
⚠️ Keep concise (<300 words) while including all required elements.

Required elements (if present in paper):
✓ Metric values with precision (0.92 not "92%")
✓ 95% Confidence intervals or standard deviation
✓ Data partition (test/validation/training)
✓ Sample sizes (n=X images, Y patients)
✓ Demographic subgroups (sex, age, disease type)
✓ Statistical significance (p-values)
✓ Comparison to baseline/reference standard

Format: "[Metric]: [Value] (95% CI: [range]) on [partition] (n=[size]). [Subgroup]: [value]. [Next metric]..."

Extract from (priority order):
1. Results tables (Table 2, Table 3 - primary source) ⚠️ If tables poorly formatted, use Results text
2. Results section text
3. Abstract summary

Example output:
"AUC-ROC: 0.94 (95% CI: 0.91-0.96) on test set (n=1,000 images, 500 patients). Sensitivity: 0.92 (95% CI: 0.88-0.95), Specificity: 0.87 (95% CI: 0.82-0.91). Female patients: AUC 0.95, Male patients: AUC 0.93 (p=0.04). Dice coefficient: 0.88±0.05. Outperformed radiologist baseline (AUC 0.82, p<0.001)."

**REQUIRED JSON STRUCTURE:**

⚠️ CRITICAL: Return FLAT JSON with fields at ROOT level (NOT wrapped in "${cardTypeCapitalized}" key).
Your response must start with: { "Name": "...", "Link": "...
NOT with: { "${cardTypeCapitalized}": { "Name": ...

Example structure (fields at root level):
${exampleJson}

**DOCUMENT TEXT:**
"""${cleanedText}"""

${tablesText ? `**TABLES:**
${tablesText}` : ''}

${processingMode === 'multimodal' && pdfData.images && pdfData.images.length > 0 ? `**REFERENCED FIGURES (${pdfData.images.length} images will be provided):**
${pdfData.images.map(img => `- Figure ${img.figureNumber} (Page ${img.page})`).join('\n')}

Note: Visual content will be provided as additional input for analysis.` : ''}

**OUTPUT (Valid JSON only):**`;
}

/**
 * Generate complete example structure from GitHub schema with deep traversal
 * @param {Object} schema - ROADMAP schema from GitHub
 * @param {string} cardType - 'model' or 'dataset'
 * @param {number} depth - Current recursion depth (max 5)
 * @returns {Object} - Complete example structure with nested objects
 */
function generateSchemaExample(schema, cardType, depth = 0) {
    const MAX_DEPTH = 5;
    if (depth > MAX_DEPTH) {
        console.warn('⚠️ Max schema depth reached, stopping recursion');
        return {};
    }

    const cardTypeCapitalized = cardType.charAt(0).toUpperCase() + cardType.slice(1);

    // Extract schema properties from GitHub schema structure
    const schemaProperties = schema.properties?.[cardTypeCapitalized]?.properties ||
                            schema.$defs?.[cardTypeCapitalized]?.properties ||
                            {};

    console.log(`📋 Generating complete example for ${cardType}...`);
    console.log(`   Total properties: ${Object.keys(schemaProperties).length}`);

    const example = {};

    // Generate ALL fields from schema to ensure complete extraction
    for (const [key, prop] of Object.entries(schemaProperties)) {
        example[key] = generatePropertyExample(prop, schema, depth + 1);
    }

    console.log(`   Generated ${Object.keys(example).length} fields in example`);

    // Return UNWRAPPED example so Gemini returns flat structure
    // Frontend normalization will handle wrapping
    return example;
}

/**
 * Generate example value for a single property based on its schema definition
 * @param {Object} prop - Property schema definition
 * @param {Object} schema - Full ROADMAP schema (for $ref resolution)
 * @param {number} depth - Current recursion depth
 * @returns {any} - Example value for this property
 */
function generatePropertyExample(prop, schema, depth) {
    const MAX_DEPTH = 5;
    if (depth > MAX_DEPTH) {
        return null;
    }

    // Handle $ref (references to schema.$defs)
    if (prop.$ref) {
        const refPath = prop.$ref.replace('#/$defs/', '');
        const referencedDef = schema.$defs?.[refPath];
        if (referencedDef) {
            return generatePropertyExample(referencedDef, schema, depth + 1);
        }
    }

    // Handle different types
    if (prop.type === 'string') {
        // Use enum values if available (show first option as example)
        if (prop.enum && prop.enum.length > 0) {
            return prop.enum[0];
        }
        // Use examples if available
        if (prop.examples && prop.examples.length > 0) {
            return prop.examples[0];
        }
        // Use description as placeholder (NO angle brackets - breaks JSON)
        if (prop.description) {
            const desc = prop.description.substring(0, 50).replace(/[<>]/g, '');
            return desc || "string value";
        }
        return "string value";

    } else if (prop.type === 'array') {
        // Generate array with example items
        if (prop.items) {
            // For enums: show 2-3 examples to indicate multiple values expected
            if (prop.items.enum && prop.items.enum.length > 1) {
                const count = Math.min(3, prop.items.enum.length);
                return prop.items.enum.slice(0, count);  // ["AI", "BR", "CT"]
            }

            // For text fields without enum (RadLex, SNOMED, Keywords):
            // Show empty array to avoid hallucination
            if (!prop.items.enum && !prop.items.properties && !prop.items.$ref) {
                return [];  // Empty array signals "optional, extract if found"
            }

            const exampleItem = generatePropertyExample(prop.items, schema, depth + 1);
            return [exampleItem];
        }
        return [];

    } else if (prop.type === 'object') {
        // Recursively generate nested object
        const nestedExample = {};
        if (prop.properties) {
            for (const [nestedKey, nestedProp] of Object.entries(prop.properties)) {
                nestedExample[nestedKey] = generatePropertyExample(nestedProp, schema, depth + 1);
            }
        }
        return nestedExample;

    } else if (prop.type === 'number' || prop.type === 'integer') {
        if (prop.examples && prop.examples.length > 0) {
            return prop.examples[0];
        }
        return 0;

    } else if (prop.type === 'boolean') {
        return false;

    } else if (prop.oneOf || prop.anyOf) {
        // Use first option from oneOf/anyOf
        const options = prop.oneOf || prop.anyOf;
        if (options.length > 0) {
            return generatePropertyExample(options[0], schema, depth + 1);
        }
    }

    // Handle array type specified as array (not string 'array')
    if (Array.isArray(prop.type) && prop.type.includes('array')) {
        if (prop.items) {
            const exampleItem = generatePropertyExample(prop.items, schema, depth + 1);
            return [exampleItem];
        }
        return [];
    }

    return null;
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
 * Intelligently truncate tables to fit within character limit
 * Prioritizes tables with numerical data and performance metrics (from gemini-client.js)
 * @param {Array} tables - Array of table objects
 * @param {number} maxChars - Maximum characters for all tables
 * @returns {string} - Formatted table string
 */
function truncateTablesForPrompt(tables, maxChars) {
    if (!tables || tables.length === 0) return '';

    // Priority scoring: favor tables with numbers (likely performance/results)
    const scoredTables = tables.map((table, index) => {
        let score = 0;
        const tableStr = JSON.stringify(table);

        // Check for numerical data (higher priority)
        const numberCount = (tableStr.match(/\d+\.?\d*/g) || []).length;
        score += numberCount * 2;

        // Check for keywords indicating results/performance/partitions
        const keywords = ['accuracy', 'auc', 'precision', 'recall', 'sensitivity',
                         'specificity', 'f1', 'performance', 'result', 'metric',
                         'training', 'validation', 'test', 'partition', 'split',
                         'cohort', 'patient', 'exam', 'demographics', 'dataset'];
        keywords.forEach(keyword => {
            if (tableStr.toLowerCase().includes(keyword)) score += 10;
        });

        // Smaller tables are easier to include
        score += Math.max(0, 50 - table.rows.length);

        return { table, index, score };
    });

    // Sort by score (highest priority first)
    scoredTables.sort((a, b) => b.score - a.score);

    // Build table string, adding tables until we hit limit
    let result = '';
    let currentLength = 0;
    let includedCount = 0;

    for (const {table, index} of scoredTables) {
        const tableJson = JSON.stringify({
            page: table.page,
            headers: table.headers,
            rows: table.rows
        }, null, 2);

        const tableStr = `TABLE ${index + 1} (Page ${table.page}, ${table.rows.length} rows):\n${tableJson}\n\n`;

        if (currentLength + tableStr.length > maxChars) {
            // Try to include a sampled version
            if (table.rows.length > 10) {
                const sampledTable = {
                    page: table.page,
                    headers: table.headers,
                    rows: [
                        ...table.rows.slice(0, 5),
                        ['... (rows truncated) ...'],
                        ...table.rows.slice(-3)
                    ]
                };
                const sampledStr = `TABLE ${index + 1} (Page ${table.page}, ${table.rows.length} rows - SAMPLED):\n${JSON.stringify(sampledTable, null, 2)}\n\n`;

                if (currentLength + sampledStr.length <= maxChars) {
                    result += sampledStr;
                    currentLength += sampledStr.length;
                    includedCount++;
                }
            }
            // If we can't fit even a sample, we're done
            break;
        } else {
            result += tableStr;
            currentLength += tableStr.length;
            includedCount++;
        }
    }

    const skippedCount = tables.length - includedCount;
    if (skippedCount > 0) {
        result += `\n[Note: ${skippedCount} additional table(s) omitted due to length constraints]\n`;
    }

    console.log(`📊 Table processing: Included ${includedCount}/${tables.length} tables (${currentLength.toLocaleString()} chars)`);

    return result;
}


/**
 * Call Gemini API with automatic retry for rate limits and overload
 */
async function callGeminiAPIWithRetry(apiKey, prompt, options = {}) {
    let lastError = null;
    let delay = INITIAL_RETRY_DELAY_MS;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
            console.log(attempt > 0 ? `🔄 Retry attempt ${attempt}/${MAX_RETRIES}` : '📤 Calling Gemini API...');

            const response = await callGeminiAPI(apiKey, prompt, options);

            if (attempt > 0) {
                console.log(`✅ Succeeded after ${attempt} retries`);
            }

            return response;

        } catch (error) {
            lastError = error;
            const errorMessage = error.message || '';

            // Try to parse error response to check status code
            let statusCode = null;
            let retryAfter = null;

            // Extract status code from error message (format: "HTTP 429: {...}")
            const statusMatch = errorMessage.match(/HTTP (\d+):/);
            if (statusMatch) {
                statusCode = parseInt(statusMatch[1]);
            }

            // Try to parse JSON error for retry delay
            try {
                const jsonMatch = errorMessage.match(/HTTP \d+: ({.*})/s);
                if (jsonMatch) {
                    const errorData = JSON.parse(jsonMatch[1]);

                    // Google provides retry delay in the error
                    if (errorData.error?.details) {
                        const retryInfo = errorData.error.details.find(d => d['@type']?.includes('RetryInfo'));
                        if (retryInfo?.retryDelay) {
                            // Parse delay like "14.543836516s" to milliseconds
                            const delayMatch = retryInfo.retryDelay.match(/([\d.]+)s/);
                            if (delayMatch) {
                                retryAfter = Math.ceil(parseFloat(delayMatch[1]) * 1000);
                            }
                        }
                    }
                }
            } catch (parseError) {
                // Ignore parsing errors
            }

            // Check if this is a retryable error (429 quota or 503 overload)
            const isRetryable = statusCode === 429 || statusCode === 503;

            if (!isRetryable || attempt >= MAX_RETRIES) {
                console.error(`❌ Non-retryable error or max retries reached: ${errorMessage.substring(0, 200)}`);
                throw error;
            }

            // Calculate delay: use Google's suggested delay or exponential backoff
            if (retryAfter) {
                delay = Math.min(retryAfter, MAX_RETRY_DELAY_MS);
                console.log(`⏱️  Rate limited (${statusCode}), waiting ${(delay/1000).toFixed(1)}s as suggested by API...`);
            } else {
                // Exponential backoff with jitter
                const jitter = Math.random() * 0.3 * delay;  // Add 0-30% jitter
                delay = Math.min(delay * BACKOFF_MULTIPLIER + jitter, MAX_RETRY_DELAY_MS);
                console.log(`⏱️  Error ${statusCode}, backing off for ${(delay/1000).toFixed(1)}s (attempt ${attempt + 1}/${MAX_RETRIES})...`);
            }

            // Wait before retry
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    // Should never reach here, but just in case
    throw lastError;
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
        req.setTimeout(300000, () => {  // 5 minutes timeout (matches Lambda max timeout)
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
