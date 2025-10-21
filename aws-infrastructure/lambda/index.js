/**
 * ROADMAP Model Card Editor - Gemini API Proxy Lambda Function
 *
 * Production-ready implementation with:
 * - Secure API key management (AWS Secrets Manager)
 * - Comprehensive error handling
 * - CloudWatch metrics & structured logging
 * - Exponential backoff for rate limits
 * - Input validation
 * - Cost controls
 *
 * @version 1.0.0
 * @license MIT
 */

const https = require('https');
const {
    SecretsManagerClient,
    GetSecretValueCommand
} = require('@aws-sdk/client-secrets-manager');
const {
    CloudWatchClient,
    PutMetricDataCommand
} = require('@aws-sdk/client-cloudwatch');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    GEMINI_API_ENDPOINT: 'generativelanguage.googleapis.com',
    GEMINI_API_PATH: '/v1beta/models',
    DEFAULT_MODEL: 'gemini-2.5-pro',
    DEFAULT_TEMPERATURE: 0.2,
    DEFAULT_MAX_TOKENS: 8192,
    MAX_RETRIES: 3,
    RETRY_DELAYS: [1000, 2000, 4000], // Exponential backoff in ms
    MAX_PROMPT_LENGTH: 100000, // Characters (increased from 50K to handle table-heavy PDFs)
    MAX_IMAGES: 10,
    CLOUDWATCH_NAMESPACE: 'ROADMAP/Backend',
    LOG_LEVEL: process.env.LOG_LEVEL || 'INFO'
};

// ============================================================================
// AWS CLIENTS (reuse across invocations)
// ============================================================================

const secretsClient = new SecretsManagerClient({});
const cloudWatchClient = new CloudWatchClient({});

// Cache API key for Lambda execution context reuse
let cachedApiKey = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 300000; // 5 minutes

// ============================================================================
// LOGGING UTILITIES
// ============================================================================

const LOG_LEVELS = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
const currentLogLevel = LOG_LEVELS[CONFIG.LOG_LEVEL] || LOG_LEVELS.INFO;

/**
 * Structured logging
 */
function log(level, message, metadata = {}) {
    if (LOG_LEVELS[level] > currentLogLevel) return;

    const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        message,
        ...metadata,
        environment: process.env.ENVIRONMENT || 'unknown'
    };

    console.log(JSON.stringify(logEntry));
}

/**
 * Mask sensitive data in logs
 */
function maskSensitiveData(data) {
    if (typeof data !== 'string') return data;

    // Mask API keys (show last 4 chars only)
    return data.replace(/AIza[0-9A-Za-z_-]{35}/g, (match) =>
        '****' + match.slice(-4)
    );
}

// ============================================================================
// CLOUDWATCH METRICS
// ============================================================================

/**
 * Send custom metric to CloudWatch
 */
async function publishMetric(metricName, value, unit = 'Count', dimensions = []) {
    try {
        const command = new PutMetricDataCommand({
            Namespace: CONFIG.CLOUDWATCH_NAMESPACE,
            MetricData: [{
                MetricName: metricName,
                Value: value,
                Unit: unit,
                Timestamp: new Date(),
                Dimensions: dimensions
            }]
        });

        await cloudWatchClient.send(command);
    } catch (error) {
        log('WARN', 'Failed to publish metric', {
            metric: metricName,
            error: error.message
        });
    }
}

// ============================================================================
// API KEY MANAGEMENT
// ============================================================================

/**
 * Get Gemini API key from Secrets Manager with caching
 */
async function getGeminiApiKey() {
    const now = Date.now();

    // Return cached key if still valid
    if (cachedApiKey && now < cacheExpiry) {
        log('DEBUG', 'Using cached API key');
        return cachedApiKey;
    }

    const secretArn = process.env.GEMINI_SECRET_ARN;
    if (!secretArn) {
        throw new Error('GEMINI_SECRET_ARN environment variable not set');
    }

    log('INFO', 'Fetching API key from Secrets Manager');

    try {
        const command = new GetSecretValueCommand({ SecretId: secretArn });
        const response = await secretsClient.send(command);

        if (!response.SecretString) {
            throw new Error('Secret value is empty');
        }

        // Parse if JSON, otherwise use as-is
        let apiKey;
        try {
            const parsed = JSON.parse(response.SecretString);
            apiKey = parsed.apiKey || parsed.GEMINI_API_KEY || response.SecretString;
        } catch {
            apiKey = response.SecretString;
        }

        // Validate API key format
        if (!apiKey.startsWith('AIza') || apiKey.length !== 39) {
            throw new Error('Invalid API key format');
        }

        // Cache the key
        cachedApiKey = apiKey;
        cacheExpiry = now + CACHE_TTL_MS;

        log('INFO', 'API key fetched and cached', {
            expiresIn: `${CACHE_TTL_MS / 1000}s`
        });

        return apiKey;

    } catch (error) {
        log('ERROR', 'Failed to fetch API key', { error: error.message });
        throw new Error('API key retrieval failed');
    }
}

// ============================================================================
// INPUT VALIDATION
// ============================================================================

/**
 * Validate request payload
 */
function validateRequest(body) {
    const errors = [];

    // Required field: prompt
    if (!body.prompt || typeof body.prompt !== 'string') {
        errors.push('Missing or invalid required field: prompt (string)');
    } else if (body.prompt.length === 0) {
        errors.push('prompt cannot be empty');
    } else if (body.prompt.length > CONFIG.MAX_PROMPT_LENGTH) {
        errors.push(`prompt exceeds maximum length of ${CONFIG.MAX_PROMPT_LENGTH} characters`);
    }

    // Optional: model
    if (body.model && typeof body.model !== 'string') {
        errors.push('Invalid field type: model (must be string)');
    }

    // Optional: temperature
    if (body.temperature !== undefined) {
        if (typeof body.temperature !== 'number' || body.temperature < 0 || body.temperature > 2) {
            errors.push('Invalid temperature: must be number between 0 and 2');
        }
    }

    // Optional: maxOutputTokens
    if (body.maxOutputTokens !== undefined) {
        if (typeof body.maxOutputTokens !== 'number' || body.maxOutputTokens < 1 || body.maxOutputTokens > 8192) {
            errors.push('Invalid maxOutputTokens: must be number between 1 and 8192');
        }
    }

    // Optional: images
    if (body.images !== undefined) {
        if (!Array.isArray(body.images)) {
            errors.push('Invalid images: must be array');
        } else if (body.images.length > CONFIG.MAX_IMAGES) {
            errors.push(`Too many images: maximum ${CONFIG.MAX_IMAGES}`);
        } else {
            body.images.forEach((img, idx) => {
                if (!img.base64 || typeof img.base64 !== 'string') {
                    errors.push(`Image ${idx}: missing or invalid base64 field`);
                }
                if (!img.mimeType || typeof img.mimeType !== 'string') {
                    errors.push(`Image ${idx}: missing or invalid mimeType field`);
                }
            });
        }
    }

    return errors;
}

// ============================================================================
// GEMINI API CLIENT
// ============================================================================

/**
 * Make HTTPS request with retry logic
 */
async function httpsRequest(url, options, postData, retryCount = 0) {
    return new Promise((resolve, reject) => {
        const req = https.request(url, options, (res) => {
            let data = '';

            res.on('data', chunk => data += chunk);

            res.on('end', async () => {
                // Success
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve({ statusCode: res.statusCode, body: data });
                    return;
                }

                // Rate limit - retry with exponential backoff
                if (res.statusCode === 429 && retryCount < CONFIG.MAX_RETRIES) {
                    const delay = CONFIG.RETRY_DELAYS[retryCount];
                    log('WARN', 'Rate limit hit, retrying', {
                        retryCount: retryCount + 1,
                        delayMs: delay
                    });

                    await new Promise(r => setTimeout(r, delay));

                    try {
                        const retryResult = await httpsRequest(url, options, postData, retryCount + 1);
                        resolve(retryResult);
                    } catch (retryError) {
                        reject(retryError);
                    }
                    return;
                }

                // Other errors
                reject(new Error(`HTTP ${res.statusCode}: ${data}`));
            });
        });

        req.on('error', reject);
        req.setTimeout(25000, () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });

        if (postData) req.write(postData);
        req.end();
    });
}

/**
 * Call Google Gemini API
 */
async function callGeminiAPI(apiKey, prompt, options = {}) {
    const model = options.model || CONFIG.DEFAULT_MODEL;
    const temperature = options.temperature ?? CONFIG.DEFAULT_TEMPERATURE;
    const maxOutputTokens = options.maxOutputTokens || CONFIG.DEFAULT_MAX_TOKENS;
    const images = options.images || [];

    // Build request payload
    const contentParts = [{ text: prompt }];

    // Add images for multimodal
    images.forEach(img => {
        contentParts.push({
            inlineData: {
                mimeType: img.mimeType,
                data: img.base64
            }
        });
    });

    const payload = {
        contents: [{ parts: contentParts }],
        generationConfig: {
            temperature,
            maxOutputTokens,
            topK: 40,
            topP: 0.95
        },
        safetySettings: [
            { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
            { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
            { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_MEDIUM_AND_ABOVE" },
            { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_MEDIUM_AND_ABOVE" }
        ]
    };

    const postData = JSON.stringify(payload);
    const url = `https://${CONFIG.GEMINI_API_ENDPOINT}${CONFIG.GEMINI_API_PATH}/${model}:generateContent?key=${apiKey}`;

    log('INFO', 'Calling Gemini API', {
        model,
        promptLength: prompt.length,
        imageCount: images.length,
        temperature,
        maxOutputTokens
    });

    const startTime = Date.now();

    try {
        const response = await httpsRequest(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData)
            }
        }, postData);

        const duration = Date.now() - startTime;

        log('INFO', 'Gemini API call successful', {
            durationMs: duration,
            statusCode: response.statusCode
        });

        // Publish metrics
        await Promise.all([
            publishMetric('GeminiApiSuccess', 1, 'Count', [{ Name: 'Model', Value: model }]),
            publishMetric('GeminiApiDuration', duration, 'Milliseconds', [{ Name: 'Model', Value: model }])
        ]);

        return JSON.parse(response.body);

    } catch (error) {
        const duration = Date.now() - startTime;

        log('ERROR', 'Gemini API call failed', {
            error: error.message,
            durationMs: duration
        });

        // Publish error metric
        await publishMetric('GeminiApiError', 1, 'Count', [{ Name: 'Model', Value: model }]);

        throw error;
    }
}

// ============================================================================
// LAMBDA HANDLER
// ============================================================================

/**
 * Main Lambda handler
 */
exports.handler = async (event, context) => {
    const requestId = context.requestId;
    const startTime = Date.now();

    log('INFO', 'Lambda invocation started', {
        requestId,
        remainingTimeMs: context.getRemainingTimeInMillis()
    });

    try {
        // Parse request body
        let body;
        try {
            body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        } catch (error) {
            log('WARN', 'Invalid JSON in request body', { error: error.message });
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ error: 'Invalid JSON in request body' })
            };
        }

        // Validate request
        const validationErrors = validateRequest(body);
        if (validationErrors.length > 0) {
            log('WARN', 'Request validation failed', { errors: validationErrors });
            return {
                statusCode: 400,
                headers: {
                    'Access-Control-Allow-Origin': '*',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    error: 'Validation failed',
                    details: validationErrors
                })
            };
        }

        // Get API key
        const apiKey = await getGeminiApiKey();

        // Call Gemini API
        const geminiResponse = await callGeminiAPI(apiKey, body.prompt, {
            model: body.model,
            temperature: body.temperature,
            maxOutputTokens: body.maxOutputTokens,
            images: body.images
        });

        const duration = Date.now() - startTime;

        log('INFO', 'Lambda invocation completed', {
            requestId,
            durationMs: duration
        });

        // Publish success metric
        await publishMetric('LambdaInvocationSuccess', 1);

        // Return success response
        return {
            statusCode: 200,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(geminiResponse)
        };

    } catch (error) {
        const duration = Date.now() - startTime;

        log('ERROR', 'Lambda invocation failed', {
            requestId,
            error: error.message,
            stack: error.stack,
            durationMs: duration
        });

        // Publish error metric
        await publishMetric('LambdaInvocationError', 1);

        // Extract detailed error information from Gemini API responses
        let geminiDetails = null;
        try {
            // Check if error message contains Gemini JSON error
            const geminiErrorMatch = error.message.match(/HTTP \d+: ({[\s\S]*?})\n/);
            if (geminiErrorMatch) {
                geminiDetails = JSON.parse(geminiErrorMatch[1]);
            }
        } catch (parseError) {
            // Ignore parsing errors
        }

        // Determine appropriate error response with detailed messages
        let statusCode = 500;
        let errorMessage = 'Internal server error';
        let errorType = 'INTERNAL_ERROR';

        if (error.message.includes('API key')) {
            statusCode = 503;
            errorMessage = 'Service temporarily unavailable - API key issue';
            errorType = 'API_KEY_ERROR';
        } else if (error.message.includes('Rate limit') || error.message.includes('RESOURCE_EXHAUSTED')) {
            statusCode = 429;
            errorMessage = 'Gemini API rate limit exceeded';
            errorType = 'RATE_LIMIT';
        } else if (error.message.includes('timeout')) {
            statusCode = 504;
            errorMessage = 'Request timeout - Gemini API took too long to respond';
            errorType = 'TIMEOUT';
        } else if (error.message.includes('503') || error.message.includes('overloaded') || error.message.includes('UNAVAILABLE')) {
            statusCode = 503;
            errorMessage = 'Gemini API is overloaded or unavailable';
            errorType = 'SERVICE_UNAVAILABLE';
        } else if (error.message.includes('400') || error.message.includes('INVALID_ARGUMENT')) {
            statusCode = 400;
            errorMessage = 'Invalid request to Gemini API';
            errorType = 'INVALID_REQUEST';
        } else if (geminiDetails) {
            // Use Gemini's error message if available
            errorMessage = geminiDetails.error?.message || error.message;
            errorType = geminiDetails.error?.status || 'GEMINI_ERROR';
        }

        return {
            statusCode,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                error: errorMessage,
                errorType: errorType,
                geminiError: geminiDetails?.error || null,
                requestId,
                // Include helpful context in development/debugging
                ...(process.env.LOG_LEVEL === 'DEBUG' && {
                    debugInfo: {
                        originalError: error.message,
                        duration: duration
                    }
                })
            })
        };
    }
};
