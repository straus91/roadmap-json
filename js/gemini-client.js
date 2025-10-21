/**
 * Gemini API Client for ROADMAP Model Card Editor
 * Routes requests through secure AWS backend
 */

// AWS Backend Configuration
const AWS_API_ENDPOINT = 'https://v928g5gem9.execute-api.us-west-2.amazonaws.com/prod/gemini';

// Legacy API Key Management (kept for backward compatibility, but unused)
const API_KEY_STORAGE_KEY = 'roadmap_gemini_api_key';

/**
 * Save API key to localStorage
 */
function saveApiKey() {
    const apiKeyInput = document.getElementById('gemini-api-key');
    const apiKey = apiKeyInput.value.trim();

    if (!apiKey) {
        showApiKeyStatus('Please enter an API key', 'warning');
        return;
    }

    // Basic validation - Gemini API keys start with "AIza"
    if (!apiKey.startsWith('AIza')) {
        showApiKeyStatus('Invalid API key format. Gemini API keys should start with "AIza"', 'danger');
        return;
    }

    localStorage.setItem(API_KEY_STORAGE_KEY, apiKey);
    showApiKeyStatus('API key saved successfully!', 'success');

    // Enable PDF processing card if it was disabled
    updatePdfCardState();
}

/**
 * Clear saved API key
 */
function clearApiKey() {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
    document.getElementById('gemini-api-key').value = '';
    showApiKeyStatus('API key cleared', 'info');

    // Update PDF card state
    updatePdfCardState();
}

/**
 * Get saved API key
 */
function getApiKey() {
    return localStorage.getItem(API_KEY_STORAGE_KEY);
}

/**
 * Check if API key is configured
 */
function isApiKeyConfigured() {
    const apiKey = getApiKey();
    return apiKey && apiKey.length > 0;
}

/**
 * Show API key status message
 */
function showApiKeyStatus(message, type = 'info') {
    const statusDiv = document.getElementById('api-key-status');
    const statusMessage = document.getElementById('api-key-status-message');

    statusMessage.textContent = message;
    statusDiv.className = `alert alert-${type} mb-3`;
    statusDiv.style.display = 'block';

    // Auto-hide after 5 seconds for success messages
    if (type === 'success') {
        setTimeout(() => {
            statusDiv.style.display = 'none';
        }, 5000);
    }
}

/**
 * Toggle API key visibility
 */
document.addEventListener('DOMContentLoaded', function() {
    // API key UI removed - using AWS backend
    // No client-side API key configuration needed

    // Legacy code for API key toggle - check if elements exist first
    const apiKeyInput = document.getElementById('gemini-api-key');
    const toggleButton = document.getElementById('toggle-api-key-visibility');

    if (apiKeyInput && toggleButton) {
        // Load saved API key on page load
        const savedKey = getApiKey();
        if (savedKey) {
            apiKeyInput.value = savedKey;
            showApiKeyStatus('API key loaded from browser storage', 'success');
        }

        // Toggle password visibility
        toggleButton.addEventListener('click', function() {
            const input = document.getElementById('gemini-api-key');
            const icon = this.querySelector('i');

            if (input.type === 'password') {
                input.type = 'text';
                icon.className = 'fa fa-eye-slash';
            } else {
                input.type = 'password';
                icon.className = 'fa fa-eye';
            }
        });
    }

    // Update PDF card state on load
    updatePdfCardState();
});

/**
 * Update PDF processing card state based on API key availability
 * Note: Now using AWS backend, so PDF cards are always enabled
 */
function updatePdfCardState() {
    const pdfCard = document.getElementById('process-pdf-card');
    const debugCard = document.getElementById('debug-pdf-card');

    // Always enable PDF cards (using secure backend)
    if (pdfCard) {
        pdfCard.style.opacity = '1';
        pdfCard.style.pointerEvents = 'auto';
    }
    if (debugCard) {
        debugCard.style.opacity = '1';
        debugCard.style.pointerEvents = 'auto';
    }
}

/**
 * Call Gemini API through secure AWS backend
 * @param {string} prompt - The prompt to send to Gemini
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Gemini API response
 */
async function callGeminiAPI(prompt, options = {}) {
    const {
        model = 'gemini-2.5-pro',
        temperature = 0.2,
        maxOutputTokens = 8192,
        images = []
    } = options;

    // Build request body in simple format expected by Lambda backend
    const requestBody = {
        prompt: prompt,
        model: model,
        temperature: temperature,
        maxOutputTokens: maxOutputTokens,
        images: images || []
    };

    console.log('📤 Sending request to AWS backend...');
    console.log('📝 Model:', model);
    console.log('📝 Prompt length:', prompt.length, 'characters');
    console.log('🖼️ Images:', images.length);

    try {
        const response = await fetch(AWS_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Backend API error:', response.status, response.statusText);
            console.error('❌ Error details:', errorText);

            // Parse error for better user messages
            let errorMessage = 'Backend API request failed';
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.error?.message) {
                    errorMessage = errorJson.error.message;
                }
            } catch (e) {
                errorMessage = errorText.substring(0, 200);
            }

            throw new Error(errorMessage);
        }

        const result = await response.json();
        console.log('✅ API call successful');

        return result;

    } catch (error) {
        console.error('❌ API call failed:', error);

        // Provide helpful error messages
        if (error.message.includes('quota')) {
            throw new Error('API quota exceeded. Please try again later.');
        }
        if (error.message.includes('SAFETY')) {
            throw new Error('Content blocked by safety filters. Please try with different content.');
        }
        if (error.message.includes('NetworkError') || error.message.includes('Failed to fetch')) {
            throw new Error('Network error. Please check your internet connection and try again.');
        }

        throw error;
    }
}

/**
 * Extract JSON from Gemini response
 * @param {Object} geminiResponse - Raw response from Gemini API
 * @param {string} cardType - 'model' or 'dataset'
 * @returns {Object|null} - Parsed JSON or null if failed
 */
function extractJsonFromGeminiResponse(geminiResponse, cardType) {
    try {
        console.log('🔧 Parsing Gemini response...');

        // Extract text from Gemini response structure
        if (!geminiResponse.candidates || geminiResponse.candidates.length === 0) {
            console.error('❌ No candidates in Gemini response');
            return null;
        }

        const candidate = geminiResponse.candidates[0];

        // Check for safety blocks
        if (candidate.finishReason === 'SAFETY') {
            throw new Error('Response blocked by safety filters');
        }

        if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
            console.error('❌ No content parts in response');
            return null;
        }

        const textContent = candidate.content.parts[0].text;

        if (!textContent) {
            console.error('❌ No text in response');
            return null;
        }

        console.log('📝 Extracted text length:', textContent.length);

        // Clean and extract JSON
        let cleanText = textContent.trim();

        // Remove markdown code blocks if present
        cleanText = cleanText.replace(/```json\s*\n?/g, '').replace(/```\s*$/g, '');

        // Find JSON object boundaries
        const startIndex = cleanText.indexOf('{');
        const lastIndex = cleanText.lastIndexOf('}');

        if (startIndex === -1 || lastIndex === -1) {
            console.error('❌ No JSON object found in response');
            return null;
        }

        const jsonText = cleanText.slice(startIndex, lastIndex + 1);

        // Parse JSON
        const parsedJson = JSON.parse(jsonText);

        // Validate structure
        const expectedKey = cardType.charAt(0).toUpperCase() + cardType.slice(1);
        if (!parsedJson[expectedKey]) {
            console.error(`❌ JSON missing expected key: ${expectedKey}`);
            console.log('Parsed JSON keys:', Object.keys(parsedJson));
            return null;
        }

        console.log('✅ JSON parsing successful');
        return parsedJson;

    } catch (error) {
        console.error('❌ Error parsing Gemini response:', error);
        return null;
    }
}

/**
 * Process PDF with Gemini AI
 * @param {Object} pdfData - Extracted PDF data (text, tables, images)
 * @param {Object} schema - ROADMAP schema
 * @param {string} cardType - 'model' or 'dataset'
 * @param {string} processingMode - 'text-only' or 'multimodal'
 * @returns {Promise<Object>} - Extracted ROADMAP JSON
 */
async function processPdfWithGemini(pdfData, schema, cardType, processingMode = 'text-only') {
    console.log('🚀 Processing PDF with Gemini...');
    console.log('📝 Card type:', cardType);
    console.log('🎛️ Processing mode:', processingMode);

    // Build prompt from GitHub schema
    const prompt = createExtractionPrompt(pdfData, schema, cardType, processingMode);

    // Determine which model to use
    const model = 'gemini-2.5-pro';

    // Call Gemini API
    const response = await callGeminiAPI(prompt, {
        model: model,
        maxOutputTokens: 8192,
        images: processingMode === 'multimodal' ? pdfData.images : []
    });

    // Extract and parse JSON
    const extractedJson = extractJsonFromGeminiResponse(response, cardType);

    if (!extractedJson) {
        throw new Error('Failed to extract valid JSON from Gemini response');
    }

    // Validate and clean extracted JSON to remove likely hallucinations
    const validatedJson = validateExtractedJson(extractedJson, cardType);

    return validatedJson;
}

/**
 * Validate and clean extracted JSON - remove likely hallucinations
 * @param {Object} jsonData - Extracted JSON data
 * @param {string} cardType - 'model' or 'dataset'
 * @returns {Object} - Cleaned JSON data
 */
function validateExtractedJson(jsonData, cardType) {
    const cardTypeKey = cardType.charAt(0).toUpperCase() + cardType.slice(1);
    const data = jsonData[cardTypeKey];

    if (!data) {
        return jsonData;
    }

    // Check for likely hallucinated RadLex codes
    if (data['Indexing code']?.RadLex) {
        const radlex = data['Indexing code'].RadLex;

        // Check if it's just the schema example (RID58)
        if (Array.isArray(radlex) && radlex.length === 1) {
            if (radlex[0] === 'RID58' || (typeof radlex[0] === 'object' && radlex[0]['RID58'])) {
                console.warn('⚠️ Removed likely hallucinated RadLex code (schema example)');
                delete data['Indexing code'].RadLex;
            }
        }
    }

    // Check for likely hallucinated SNOMED codes
    if (data['Indexing code']?.SNOMED) {
        const snomed = data['Indexing code'].SNOMED;

        // If it's a single generic 8-9 digit number, likely hallucinated
        if (Array.isArray(snomed) && snomed.length === 1) {
            if (typeof snomed[0] === 'string' && snomed[0].match(/^\d{8,9}$/)) {
                console.warn('⚠️ WARNING: SNOMED code may be hallucinated:', snomed[0]);
                console.warn('   Verify this code exists in SNOMED CT before using');
                // Don't remove - just warn, as some codes might be valid
            }
        }
    }

    // Recursively clean empty fields
    jsonData[cardTypeKey] = cleanEmptyFields(data);

    return jsonData;
}

/**
 * Recursively remove empty fields from object
 * @param {any} obj - Object to clean
 * @returns {any} - Cleaned object
 */
function cleanEmptyFields(obj) {
    if (Array.isArray(obj)) {
        const cleaned = obj
            .map(cleanEmptyFields)
            .filter(item => {
                if (item === null || item === undefined || item === '') return false;
                if (Array.isArray(item) && item.length === 0) return false;
                if (typeof item === 'object' && item !== null && Object.keys(item).length === 0) return false;
                return true;
            });
        return cleaned.length > 0 ? cleaned : [];
    }

    if (typeof obj === 'object' && obj !== null) {
        const cleaned = {};
        for (const [key, value] of Object.entries(obj)) {
            const cleanedValue = cleanEmptyFields(value);

            // Skip empty values
            if (cleanedValue === null || cleanedValue === undefined || cleanedValue === '') continue;
            if (Array.isArray(cleanedValue) && cleanedValue.length === 0) continue;
            if (typeof cleanedValue === 'object' && cleanedValue !== null && Object.keys(cleanedValue).length === 0) continue;

            cleaned[key] = cleanedValue;
        }
        return cleaned;
    }

    return obj;
}

/**
 * Create extraction prompt for Gemini
 * @param {Object} pdfData - Extracted PDF data
 * @param {Object} schema - ROADMAP schema from GitHub
 * @param {string} cardType - 'model' or 'dataset'
 * @param {string} processingMode - 'text-only' or 'multimodal'
 * @returns {string} - Prompt for Gemini
 */
function createExtractionPrompt(pdfData, schema, cardType, processingMode) {
    const cardTypeUpper = cardType.toUpperCase();
    const cardTypeCapitalized = cardType.charAt(0).toUpperCase() + cardType.slice(1);

    // Generate structure directly from GitHub schema with deep traversal
    console.log('📝 Generating example structure from GitHub schema...');
    const exampleStructure = generateSchemaExample(schema, cardType);
    const exampleJson = JSON.stringify(exampleStructure, null, 2);

    console.log(`✅ Generated example structure (${exampleJson.length} characters)`);

    return `You are an expert AI system specializing in extracting structured information from medical imaging research papers for ROADMAP ${cardTypeUpper} cards.

**TASK:** Extract information for a ${cardTypeUpper} card in valid JSON format.

**CRITICAL INSTRUCTIONS:**
• Extract ALL authors with affiliations - do not summarize
• Extract exact numerical values and statistical measures - never summarize or approximate
• For tables: Extract complete data, labels, classifications, performance metrics
• Include publication details, performance metrics, and technical specifications
• For Content codes: Extract ALL applicable 2-letter codes (e.g., ["CT", "MR", "BR"] not just one)
• For Keywords: Extract ALL keywords mentioned (e.g., ["Breast", "MRI", "Deep Learning"] not just one)
• **CRITICAL: For RadLex/SNOMED codes - ONLY extract if explicitly stated in the PDF**
• **DO NOT invent, guess, or generate ontology codes (RadLex RID*, SNOMED numbers)**
• **If RadLex/SNOMED codes are not explicitly mentioned in the PDF, OMIT these fields entirely**
• Only include fields where you find actual data in the document
• Skip empty arrays, empty objects, and fields you cannot populate from the PDF
• Output must be valid JSON with proper ROADMAP structure
• Return ONLY valid JSON (no markdown, no explanations, no additional text)

**FIELD-SPECIFIC GUIDANCE:**
• Content: Array of ALL applicable 2-letter codes. Example: ["CT", "MR", "BR"]
• Keywords: Extract ALL keywords. Example: ["Breast", "MRI", "Deep Learning"]
• Authors: Extract ALL author names with exact affiliations
• RadLex/SNOMED: **ONLY if explicitly stated in PDF** - DO NOT GUESS
• Dates: Use exact dates from PDF (YYYY-MM-DD format or year)
• Counts/Numbers: Extract exact values - never estimate

**RESULTS FIELD GUIDANCE (CRITICAL):**
The ROADMAP schema uses a simple structure for Results/Performance metrics:
• "Result Information": Description of the result (e.g., "AUC comparison on test dataset")
• "Metric": Array of metric names (e.g., ["Area under the receiver operating characteristic curve"])
• "Value": **SIMPLE STRING** containing all values (e.g., "Small 2D CNN: 0.88, Radiologists: 0.86")
• "Uncertainty": Confidence intervals as string (e.g., "95% CI: 0.81-0.93 vs 0.78-0.91")
• "Subset": Dataset subset (e.g., "Test dataset")

**DO NOT create nested structures**:
❌ "Value": [{"Model": "X", "Value": "Y"}] - WRONG
✅ "Value": "Model X: Y, Model Z: W" - CORRECT

**Example Results entry**:
{
  "Result Information": "AUC comparison between Small 2D CNN and Radiologists on test dataset",
  "Metric": ["Area under the receiver operating characteristic curve"],
  "Value": "Small 2D CNN + augmentation: 0.88, Radiologists: 0.86",
  "Uncertainty": "Small 2D CNN: 95% CI 0.81–0.93, Radiologists: 95% CI 0.78–0.91"
}

**REQUIRED JSON STRUCTURE:**
${exampleJson}

**DOCUMENT TEXT:**
"""${pdfData.text.substring(0, 15000)}"""

${pdfData.tables && pdfData.tables.length > 0 ? `**TABLES:**
${JSON.stringify(pdfData.tables, null, 2)}` : ''}

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
                            schema.$defs?.[cardType]?.properties ||
                            {};

    console.log(`📋 Generating complete example for ${cardType}...`);
    console.log(`   Total properties: ${Object.keys(schemaProperties).length}`);

    const example = {};

    // Generate ALL fields from schema to ensure complete extraction
    for (const [key, prop] of Object.entries(schemaProperties)) {
        example[key] = generatePropertyExample(prop, schema, depth + 1);
    }

    console.log(`   Generated ${Object.keys(example).length} fields in example`);

    return {
        [cardTypeCapitalized]: example
    };
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

    // Handle multi-type fields (e.g., type: ["string", "number"])
    if (Array.isArray(prop.type)) {
        // Use first type
        return generatePropertyExample({...prop, type: prop.type[0]}, schema, depth);
    }

    // Default fallback
    return null;
}
