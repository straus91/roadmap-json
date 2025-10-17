# Implementation Quick Reference
## Replacing Backend with Client-Side Processing

**Last Updated:** 2025-01-16

---

## TL;DR - What Needs to Change

### Single Critical Modification
**File:** `js/app.js`
**Function:** `handlePdfUpload()` (lines 2437-2586)
**Change:** Replace lines 2510-2523 (backend API call) with client-side processing

---

## Step-by-Step Implementation

### Step 1: Locate the Backend Call

**Find this code in `js/app.js` around line 2510:**

```javascript
try {
    // Send the file to the streaming serverless function
    const response = await fetch('/api/process-pdf', {  ← DELETE THIS
        method: 'POST',
        body: formData,
    });

    if (!response.ok) {                                 ← DELETE THIS
        const errorData = await response.json().catch(() => ({ error: 'Unknown error occurred' }));
        throw new Error(errorData.error || `Server error: ${response.status}`);
    }

    // Get the complete JSON response from backend
    const structuredJson = await response.json();       ← DELETE THIS
    console.log('✅ Received clean JSON response from backend');
```

### Step 2: Replace with Client-Side Processing

**Replace the above code with:**

```javascript
try {
    // ===== NEW CLIENT-SIDE PROCESSING =====

    // Validate API key is configured
    if (!isApiKeyConfigured()) {
        throw new Error('Gemini API key not configured. Please enter your API key at the top of the page.');
    }

    // Step 1: Extract PDF data using PDF.js (client-side)
    showAlert('Extracting text from PDF...', 'info', 0);

    const pdfData = await extractPdfData(file, (progress) => {
        // Update UI with progress
        if (progress.stage === 'extracting') {
            showAlert(progress.message, 'info', 0);
        }
    });

    console.log('✅ PDF extraction complete');
    console.log('📝 Text length:', pdfData.text.length, 'characters');
    console.log('📋 Tables found:', pdfData.tables.length);

    // Step 2: Process with Gemini AI (direct API call)
    showAlert('Processing with Gemini AI... This may take a moment.', 'info', 0);

    const geminiResponse = await processPdfWithGemini(
        pdfData,
        customSchema,      // Already fetched earlier in this function
        pdfState.cardType, // 'model' or 'dataset'
        pdfState.processingMode  // 'text-only' or 'multimodal'
    );

    console.log('✅ Gemini processing complete');

    // Step 3: Use the result (existing code continues unchanged from here)
    const structuredJson = geminiResponse;
```

### Step 3: Keep Everything Else the Same

**The rest of the function (lines 2524+) stays exactly the same:**

```javascript
    // Store PDF metadata for potential saving
    if (structuredJson._metadata) {
        currentPdfMetadata = structuredJson._metadata;
        console.log('📋 PDF metadata stored:', currentPdfMetadata);
        delete structuredJson._metadata;
    }

    // Hide the loading indicator
    document.querySelector('.alert.custom-alert')?.remove();

    // ... continue with existing editor initialization code ...
```

---

## Complete Modified Function

**Here's the full `handlePdfUpload()` function with changes:**

```javascript
async function handlePdfUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
        showAlert('Please select a valid PDF file.', 'danger');
        return;
    }

    // Validate file size (50MB limit for client-side processing)
    const maxSizeInMB = 50;  // Increased from 10MB
    if (file.size > maxSizeInMB * 1024 * 1024) {
        showAlert(`File size exceeds ${maxSizeInMB}MB limit. Please select a smaller PDF file.`, 'danger');
        return;
    }

    // Step 1: Use manually selected card type
    console.log('✅ Using manually selected card type:', pdfState.cardType);

    // Step 2: Fetch the schema
    showAlert('Fetching schema...', 'info', 0);
    let customSchema = null;

    try {
        const customUrl = document.getElementById('pdf-custom-schema-url').value;
        const schemaUrl = getSchemaUrl(pdfState.cardType, pdfState.schemaSource, customUrl);
        pdfState.schemaUrl = schemaUrl;

        customSchema = await fetchAndCacheSchema(schemaUrl);
        console.log('✅ Schema loaded from:', schemaUrl);
    } catch (error) {
        console.error('Error fetching schema:', error);
        showAlert('Warning: Could not fetch custom schema, will use defaults', 'warning', 3000);
    }

    // Step 3: Process PDF with client-side extraction + Gemini
    try {
        // ========== NEW CLIENT-SIDE PROCESSING ==========

        // Validate API key
        if (!isApiKeyConfigured()) {
            throw new Error('Gemini API key not configured. Please enter your API key at the top of the page.');
        }

        // Extract PDF data using PDF.js
        showAlert('Extracting text from PDF...', 'info', 0);

        const pdfData = await extractPdfData(file, (progress) => {
            if (progress.stage === 'extracting') {
                showAlert(progress.message, 'info', 0);
            }
        });

        console.log('✅ PDF extraction complete');
        console.log('📝 Text length:', pdfData.text.length);
        console.log('📋 Tables found:', pdfData.tables.length);

        // Process with Gemini AI
        showAlert('Processing with Gemini AI... This may take a moment.', 'info', 0);

        const structuredJson = await processPdfWithGemini(
            pdfData,
            customSchema,
            pdfState.cardType,
            pdfState.processingMode
        );

        console.log('✅ Gemini processing complete');

        // ========== CONTINUE WITH EXISTING CODE ==========

        // Hide the loading indicator
        document.querySelector('.alert.custom-alert')?.remove();

        // Validate the response structure
        if (!structuredJson || (typeof structuredJson !== 'object')) {
            throw new Error('Invalid response format from PDF processing');
        }

        // Use the user-selected card type
        const cardType = pdfState.cardType;
        let editorData = {};

        // Extract data based on user selection
        if (cardType === CARD_TYPES.MODEL) {
            if (structuredJson.Model) {
                editorData = structuredJson.Model;
            } else {
                editorData = structuredJson;
            }
        } else if (cardType === CARD_TYPES.DATASET) {
            if (structuredJson.Dataset) {
                editorData = structuredJson.Dataset;
            } else {
                editorData = structuredJson;
            }
        }

        // Show success message
        showAlert(`✅ Successfully extracted ${cardType} information from PDF!`, 'success');

        // Start the editor with the pre-filled data
        currentCardType = cardType;
        document.getElementById('initial-screen').style.display = 'none';
        document.getElementById('editor-section').style.display = 'block';
        updateEditorUI(cardType);

        // Initialize editor with the extracted data
        initializeEditor(editorData);

        // Clear the file input for next use
        event.target.value = '';

    } catch (error) {
        console.error('PDF Processing Error:', error);

        // Hide the loading indicator
        document.querySelector('.alert.custom-alert')?.remove();

        // Enhanced error messages
        let errorMessage = error.message;

        if (error.message.includes('API key')) {
            errorMessage = '🔑 API Key Required: ' + error.message;
        } else if (error.message.includes('quota')) {
            errorMessage = '⚠️ API Quota Error: ' + error.message +
                '\n\nPlease wait a few minutes or check your quota at https://aistudio.google.com/';
        } else if (error.message.includes('SAFETY') || error.message.includes('safety')) {
            errorMessage = '🚫 Content Blocked: The PDF content was blocked by Gemini safety filters. Try a different PDF.';
        } else if (error.message.includes('PDF') || error.message.includes('extraction')) {
            errorMessage = '📄 PDF Error: ' + error.message;
        } else {
            errorMessage = 'Error processing PDF: ' + error.message;
        }

        showAlert(errorMessage, 'danger');

        // Clear the file input
        event.target.value = '';
    }
}
```

---

## Testing the Changes

### Quick Test Script

**1. Save this test HTML file as `test-integration.html` in project root:**

```html
<!DOCTYPE html>
<html>
<head>
    <title>Integration Test</title>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
    <script>
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    </script>
    <script src="js/pdf-extractor.js"></script>
    <script src="js/gemini-client.js"></script>
</head>
<body>
    <h1>Integration Test</h1>

    <div>
        <label>API Key:</label>
        <input type="text" id="gemini-api-key" placeholder="Enter Gemini API key">
        <button onclick="saveApiKey()">Save</button>
    </div>

    <div>
        <label>Upload PDF:</label>
        <input type="file" id="test-pdf" accept=".pdf" onchange="testPdf(event)">
    </div>

    <div id="results"></div>

    <script>
        async function testPdf(event) {
            const file = event.target.files[0];
            if (!file) return;

            const results = document.getElementById('results');
            results.innerHTML = '<p>Processing...</p>';

            try {
                // Test PDF extraction
                const pdfData = await extractPdfData(file);
                results.innerHTML += `<p>✅ Extraction: ${pdfData.text.length} chars, ${pdfData.tables.length} tables</p>`;

                // Test Gemini call (basic schema)
                const schema = {
                    properties: {
                        Model: {
                            properties: {
                                Name: { type: 'string' },
                                Description: { type: 'string' }
                            }
                        }
                    }
                };

                const result = await processPdfWithGemini(pdfData, schema, 'model', 'text-only');
                results.innerHTML += `<p>✅ Gemini: ${JSON.stringify(result, null, 2)}</p>`;

            } catch (error) {
                results.innerHTML += `<p>❌ Error: ${error.message}</p>`;
            }
        }
    </script>
</body>
</html>
```

**2. Open in browser and test:**
```
1. Enter your Gemini API key
2. Upload a small PDF
3. Check console for logs
4. Verify extraction + Gemini processing works
```

---

## Debugging Tips

### Common Issues

#### 1. "isApiKeyConfigured is not defined"
**Cause:** `gemini-client.js` not loaded
**Fix:** Verify script tag order in index.html:
```html
<script src="js/pdf-extractor.js"></script>
<script src="js/gemini-client.js"></script>
<script src="js/app.js"></script>
```

#### 2. "extractPdfData is not defined"
**Cause:** `pdf-extractor.js` not loaded
**Fix:** Add script tag before `app.js`

#### 3. "PDF.js worker not found"
**Cause:** PDF.js worker URL incorrect
**Fix:** Check index.html has:
```html
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>
<script>
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
</script>
```

#### 4. "Invalid API key" even with valid key
**Cause:** Key not saved to localStorage
**Fix:** Call `saveApiKey()` explicitly or check localStorage:
```javascript
console.log(localStorage.getItem('roadmap_gemini_api_key'));
```

#### 5. Gemini returns empty response
**Cause:** Prompt too long or content blocked
**Fix:** Check console logs, reduce PDF size, or adjust safety settings

---

## File Checklist

### Files Modified
- [x] `index.html` - Added API key UI (lines 33-105)
- [ ] `js/app.js` - Modified `handlePdfUpload()` (lines 2510-2523) ← **YOUR TASK**

### Files Created
- [x] `js/gemini-client.js` - 458 lines, 15KB
- [x] `js/pdf-extractor.js` - 189 lines, 6.6KB
- [x] `MIGRATION_PLAN.md` - This guide

### Files to Delete (After Testing)
- [ ] `api/process-pdf.js`
- [ ] `api/debug-pdf.js`
- [ ] `simple-server.js`
- [ ] `database.js`
- [ ] `doi-extractor.js`
- [ ] `pdf-processor.js`
- [ ] `vercel.json`

---

## Validation Checklist

After making the changes, verify:

- [ ] Page loads without console errors
- [ ] API key input appears at top
- [ ] Can save API key
- [ ] PDF upload cards become enabled after saving key
- [ ] Can upload a PDF
- [ ] Progress messages appear during processing
- [ ] Editor opens with extracted data
- [ ] Model cards extract correctly
- [ ] Dataset cards extract correctly
- [ ] Error messages are user-friendly

---

## Performance Expectations

### Client-Side Processing Times
```
Small PDF (1-2 pages):    2-7 seconds total
Medium PDF (5-10 pages):  5-15 seconds total
Large PDF (20+ pages):    15-45 seconds total
```

### Breakdown
```
PDF Extraction (PDF.js):     10-30% of total time
Gemini API Call:             70-90% of total time
Network latency:             ~500ms - 2s
```

---

## Next Steps

1. **Make the modification** - Edit `js/app.js` lines 2510-2523
2. **Test locally** - Open `index.html` in browser
3. **Upload test PDF** - Try with sample medical imaging paper
4. **Verify extraction** - Check console logs for success messages
5. **Test error cases** - Try without API key, with large PDF, etc.
6. **Commit changes** - `git commit -m "Replace backend with client-side processing"`

---

## Need Help?

**Console Logs to Check:**
```javascript
// Should see these in order:
"📄 Starting client-side PDF extraction..."
"✅ PDF loaded successfully"
"📄 Processing page 1/X..."
"✅ PDF extraction complete"
"📤 Sending request to Gemini API..."
"✅ Gemini API call successful"
"✅ JSON parsing successful"
"✅ Gemini processing complete"
```

**Error Logs Pattern:**
```javascript
// API key errors
"❌ Missing API key"

// PDF errors
"❌ PDF extraction failed: [reason]"

// Gemini errors
"❌ Gemini API error: [status] [statusText]"
```

---

*Last Updated: 2025-01-16*
*For detailed migration plan, see MIGRATION_PLAN.md*
