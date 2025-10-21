/**
 * Async API Client for ROADMAP Model Card Editor
 *
 * Handles asynchronous PDF processing with job polling
 *
 * @author Claude Code
 * @version 1.0.0
 */

// API Configuration (set during deployment)
const ASYNC_API_BASE_URL = 'https://eaubzj7nh1.execute-api.us-west-2.amazonaws.com/prod';

// Polling configuration
const POLL_INTERVAL_MS = 2000;  // Poll every 2 seconds
const MAX_POLL_ATTEMPTS = 150;  // 5 minutes max (150 * 2 seconds)

/**
 * Submit PDF for async processing
 * @param {Object} pdfData - Extracted PDF data
 * @param {Object} schema - ROADMAP schema
 * @param {string} cardType - 'model' or 'dataset'
 * @param {string} processingMode - 'text-only' or 'multimodal'
 * @returns {Promise<Object>} - Job submission response
 */
async function submitPdfJob(pdfData, schema, cardType, processingMode = 'text-only') {
    console.log('📤 Submitting PDF job to async API...');

    const requestBody = {
        pdfData,
        schema,
        cardType,
        processingMode
    };

    try {
        const response = await fetch(`${ASYNC_API_BASE_URL}/submit`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        console.log('✅ Job submitted:', data.jobId);

        return data;
    } catch (error) {
        console.error('❌ Error submitting job:', error);
        throw new Error(`Failed to submit job: ${error.message}`);
    }
}

/**
 * Get job status
 * @param {string} jobId - Job ID to check
 * @returns {Promise<Object>} - Job status response
 */
async function getJobStatus(jobId) {
    try {
        const response = await fetch(`${ASYNC_API_BASE_URL}/status/${jobId}`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error('Job not found');
            }
            const errorData = await response.json();
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error(`❌ Error getting status for job ${jobId}:`, error);
        throw error;
    }
}

/**
 * Poll job status until completion
 * @param {string} jobId - Job ID to poll
 * @param {Function} progressCallback - Optional callback for progress updates
 * @returns {Promise<Object>} - Final job result
 */
async function pollJobUntilComplete(jobId, progressCallback = null) {
    console.log(`🔄 Polling job status: ${jobId}`);

    let attempts = 0;

    while (attempts < MAX_POLL_ATTEMPTS) {
        attempts++;

        try {
            const status = await getJobStatus(jobId);

            // Call progress callback if provided
            if (progressCallback) {
                progressCallback({
                    status: status.status,
                    progress: status.progress || 0,
                    message: status.message,
                    attempt: attempts,
                    maxAttempts: MAX_POLL_ATTEMPTS
                });
            }

            // Check if job is complete
            if (status.status === 'completed') {
                console.log('✅ Job completed:', jobId);
                return status;
            }

            // Check if job failed
            if (status.status === 'failed') {
                console.error('❌ Job failed:', status.error);
                throw new Error(`Job processing failed: ${status.error}`);
            }

            // Job is still pending or processing - wait and poll again
            await sleep(POLL_INTERVAL_MS);

        } catch (error) {
            // If it's a network error, retry a few times
            if (attempts < 3) {
                console.warn(`⚠️ Polling error (attempt ${attempts}), retrying...`);
                await sleep(POLL_INTERVAL_MS);
                continue;
            }
            throw error;
        }
    }

    // Max attempts reached
    throw new Error('Job processing timeout - exceeded maximum polling time');
}

/**
 * Process PDF with async API (main entry point)
 * @param {Object} pdfData - Extracted PDF data
 * @param {Object} schema - ROADMAP schema
 * @param {string} cardType - 'model' or 'dataset'
 * @param {string} processingMode - 'text-only' or 'multimodal'
 * @param {Function} progressCallback - Optional callback for progress updates
 * @returns {Promise<Object>} - Extracted model card data
 */
async function processPdfAsync(pdfData, schema, cardType, processingMode = 'text-only', progressCallback = null) {
    console.log('🚀 Starting async PDF processing...');

    // Step 1: Submit job
    if (progressCallback) {
        progressCallback({
            status: 'submitting',
            progress: 0,
            message: 'Submitting PDF for processing...'
        });
    }

    const submitResponse = await submitPdfJob(pdfData, schema, cardType, processingMode);
    const jobId = submitResponse.jobId;

    // Step 2: Poll for completion
    if (progressCallback) {
        progressCallback({
            status: 'polling',
            progress: 10,
            message: 'Processing PDF...',
            jobId
        });
    }

    const finalStatus = await pollJobUntilComplete(jobId, progressCallback);

    // Step 3: Return results
    if (finalStatus.result) {
        console.log('✅ PDF processing complete');
        return finalStatus.result;
    }

    // If result not included, fetch from URL
    if (finalStatus.resultUrl) {
        console.log('📥 Fetching results from S3...');
        const response = await fetch(finalStatus.resultUrl);
        return await response.json();
    }

    throw new Error('No result data in job response');
}

/**
 * Helper: Sleep for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Check if async API is configured
 */
function isAsyncApiConfigured() {
    return ASYNC_API_BASE_URL && !ASYNC_API_BASE_URL.includes('YOUR_API_GATEWAY_URL');
}
