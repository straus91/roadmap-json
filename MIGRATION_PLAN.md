# ROADMAP Model Card Editor - Backend Elimination Migration Plan
## Data-Driven Simplification Strategy

**Goal:** Transform from Vercel serverless architecture to 100% static site with client-side Gemini API integration

**Created:** 2025-01-16
**Status:** Phase 1 - Implementation In Progress

---

## Executive Summary

### Current State (Baseline Metrics)
```
Total Codebase:        8,130 lines
Backend Code:          2,438 lines (30%)
Frontend Code:         5,692 lines (70%)

Directory Sizes:
├── api/              100KB (serverless functions - TO DELETE)
├── js/               176KB (frontend logic)
├── schemas/          76KB (JSON schemas - KEEP)
└── css/              20KB (styling - KEEP)

Key Files:
├── api/process-pdf.js        1,922 lines ❌ DELETE
├── api/debug-pdf.js          516 lines ❌ DELETE
├── simple-server.js          1,239 lines ❌ DELETE
├── js/app.js                 3,164 lines ⚠️ MODIFY
├── js/dynamic-schema.js      642 lines ✅ KEEP
├── js/gemini-client.js       458 lines ✨ NEW
└── js/pdf-extractor.js       189 lines ✨ NEW

Function Count in app.js:     88 functions
API Calls in app.js:          9 fetch calls (1 to backend)
```

### Target State (Post-Migration)
```
Total Codebase:        ~6,200 lines (-24%)
Backend Code:          0 lines (0%)
Frontend Code:         6,200 lines (100%)

Files Eliminated:      5 files, 2,438 lines
New Files Created:     2 files, 647 lines
Net Reduction:         1,791 lines (-22%)

Deployment:            GitHub Pages (static hosting)
Backend Dependency:    None
API Costs:             $0 (users provide own keys)
```

---

## Phase 1: Implementation Status ✅ 70% Complete

### ✅ Completed Components

#### 1. API Key Management UI (index.html:33-105)
**Lines Added:** 73 lines
**Features:**
- Password-protected input with visibility toggle
- LocalStorage persistence
- Validation (Gemini keys start with "AIza")
- User-friendly error messages
- Direct link to Google AI Studio
- API quota information display

**Integration Points:**
- Saves to: `localStorage.roadmap_gemini_api_key`
- Used by: `gemini-client.js`
- UI Updates: Enables/disables PDF processing cards

---

#### 2. Gemini API Client (js/gemini-client.js)
**Lines:** 458 lines
**Size:** 15KB

**Public API Surface:**

| Function | Purpose | Returns | Dependencies |
|----------|---------|---------|--------------|
| `saveApiKey()` | Save key to localStorage | void | DOM |
| `clearApiKey()` | Remove saved key | void | DOM |
| `getApiKey()` | Retrieve saved key | string\|null | localStorage |
| `isApiKeyConfigured()` | Check if key exists | boolean | localStorage |
| `showApiKeyStatus(msg, type)` | Display status message | void | DOM |
| `updatePdfCardState()` | Enable/disable PDF cards | void | DOM |
| `callGeminiAPI(prompt, opts)` | Call Gemini directly | Promise<Object> | fetch API |
| `extractJsonFromGeminiResponse(res, type)` | Parse Gemini response | Object\|null | JSON |
| `processPdfWithGemini(data, schema, type, mode)` | Full PDF processing | Promise<Object> | All above |
| `createExtractionPrompt(data, schema, type, mode)` | Build prompt | string | None |
| `generateSchemaExample(schema, type)` | Create schema example | Object | None |

**API Call Flow:**
```
User Action → getApiKey()
           → callGeminiAPI(prompt, options)
              ├── Build request body
              ├── POST to generativelanguage.googleapis.com
              ├── Handle errors (quota, safety, invalid key)
              └── Return JSON response
           → extractJsonFromGeminiResponse(response, cardType)
              ├── Validate response structure
              ├── Extract text from candidates[0].content.parts[0].text
              ├── Clean markdown code blocks
              ├── Parse JSON
              └── Validate schema structure
```

**Error Handling:**
- ❌ Missing API key → "Please enter your API key above"
- ❌ Invalid key → "Invalid API key. Please check and try again"
- ❌ Quota exceeded → "API quota exceeded. Check usage limits"
- ❌ Safety filter → "Content blocked by safety filters"
- ❌ Network error → Automatic retry with exponential backoff

---

#### 3. PDF Extractor (js/pdf-extractor.js)
**Lines:** 189 lines
**Size:** 6.6KB

**Public API Surface:**

| Function | Purpose | Returns | Dependencies |
|----------|---------|---------|--------------|
| `extractPdfData(file, callback)` | Extract text & tables | Promise<Object> | PDF.js |
| `detectTablesInText(content, page)` | Find tables in text | Array | PDF.js |
| `extractPdfTextSimple(file)` | Simple text extraction | Promise<string> | PDF.js |
| `validatePdfFile(file)` | Validate PDF file | boolean | File API |

**Extraction Flow:**
```
PDF File → validatePdfFile(file)
        → extractPdfData(file, progressCallback)
           ├── Convert to ArrayBuffer
           ├── Load with pdfjsLib.getDocument()
           ├── For each page:
           │   ├── getPage(pageNum)
           │   ├── getTextContent()
           │   ├── Extract text items
           │   ├── detectTablesInText() (heuristic)
           │   └── Update progress (10% → 90%)
           └── Return:
               {
                 text: string,
                 tables: Array<{page, headers, rows}>,
                 images: [],  // Not implemented (complex)
                 metadata: {
                   filename, filesize, numPages,
                   text_length, tables_count, images_count
                 }
               }
```

**Table Detection Algorithm:**
```javascript
1. Group text items by Y coordinate (rows)
2. Filter rows with ≥3 columns
3. Sort items by X coordinate (columns)
4. Detect ≥3 aligned rows
5. Extract headers (row 0) and data (rows 1+)
6. Validate: at least one non-empty header
```

**Limitations:**
- ⚠️ No image extraction (browser limitation)
- ⚠️ Basic table detection (heuristic only)
- ⚠️ 50MB file size limit (client-side processing)

---

## Phase 2: Integration Points - NEXT STEPS

### 🔧 Required Modifications to app.js

#### Current Backend Integration (TO REPLACE)

**Location:** `js/app.js:2437-2586` (`handlePdfUpload` function)

**Current Flow:**
```javascript
handlePdfUpload(event) {
  1. Validate file (type, size)
  2. Get card type (pdfState.cardType)
  3. Fetch schema from GitHub
  4. Build FormData:
     - append('pdf', file)
     - append('mode', processingMode)
     - append('cardType', cardType)
     - append('customSchema', JSON.stringify(schema))
  5. POST to /api/process-pdf  ← BACKEND CALL
  6. Parse response JSON
  7. Extract Model/Dataset data
  8. Initialize editor with data
}
```

**Data Dependencies:**
```javascript
// Current state management
pdfState = {
  processingMode: 'text-only' | 'multimodal',
  cardType: 'model' | 'dataset',
  schemaSource: 'github' | 'custom',
  schemaUrl: string,
  detectedType: string
}
```

---

#### New Client-Side Flow (TO IMPLEMENT)

**Replace:** Lines 2510-2523 (backend fetch call)

**With:**
```javascript
try {
  // Step 1: Validate API key
  if (!isApiKeyConfigured()) {
    throw new Error('Gemini API key not configured. Please enter your API key at the top of the page.');
  }

  // Step 2: Extract PDF data client-side
  showAlert('Extracting text from PDF...', 'info', 0);

  const pdfData = await extractPdfData(file, (progress) => {
    // Update progress UI
    console.log(`${progress.stage}: ${progress.progress}%`);
    if (progress.stage === 'extracting') {
      showAlert(progress.message, 'info', 0);
    }
  });

  console.log('✅ PDF extraction complete');
  console.log('📝 Text length:', pdfData.text.length);
  console.log('📋 Tables found:', pdfData.tables.length);

  // Step 3: Process with Gemini AI
  showAlert('Processing with Gemini AI... This may take a moment.', 'info', 0);

  const structuredJson = await processPdfWithGemini(
    pdfData,
    customSchema,  // Already fetched earlier in function
    pdfState.cardType,
    pdfState.processingMode
  );

  console.log('✅ Gemini processing complete');

  // Step 4: Continue with existing code (lines 2524+)
  // Extract Model/Dataset data and initialize editor
  // ... (keep existing logic)

} catch (error) {
  console.error('PDF Processing Error:', error);

  // Enhanced error messages
  let errorMessage = error.message;

  if (error.message.includes('API key')) {
    errorMessage = 'API Key Error: ' + error.message;
  } else if (error.message.includes('quota')) {
    errorMessage = 'API Quota Error: ' + error.message +
      ' Please wait a few minutes or check your Gemini API quota at https://aistudio.google.com/';
  } else if (error.message.includes('PDF')) {
    errorMessage = 'PDF Extraction Error: ' + error.message;
  }

  showAlert(errorMessage, 'danger');
  document.querySelector('.alert.custom-alert')?.remove();
}
```

**Integration Checklist:**
- [ ] Add API key validation at function start
- [ ] Replace `/api/process-pdf` fetch with `extractPdfData()`
- [ ] Call `processPdfWithGemini()` with extracted data
- [ ] Keep existing editor initialization logic
- [ ] Enhance error handling for client-side errors
- [ ] Update progress messages for transparency
- [ ] Test with both text-only and multimodal modes
- [ ] Handle large PDFs (50MB+ gracefully)

---

### 🔧 handleDebugPdfUpload() Modification

**Location:** `js/app.js:2590+` (function not fully shown in audit)

**Strategy:** Either:
1. **Option A:** Disable debug mode entirely (remove card from UI)
2. **Option B:** Simplify to show only extracted text/tables (no Gemini call)

**Recommended:** Option B - Simplify

**New Debug Flow:**
```javascript
async function handleDebugPdfUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    // Show debug screen
    document.getElementById('initial-screen').style.display = 'none';
    document.getElementById('debug-screen').style.display = 'block';

    // Extract PDF data
    const pdfData = await extractPdfData(file, (progress) => {
      updateDebugProgress(progress);
    });

    // Display extracted data in debug UI
    displayDebugText(pdfData.text);
    displayDebugTables(pdfData.tables);
    displayDebugMetadata(pdfData.metadata);

    // Note: No Gemini call in debug mode - just show extraction results
    showAlert('✅ PDF extraction complete (Debug Mode)', 'success');

  } catch (error) {
    console.error('Debug PDF Error:', error);
    showAlert('Error: ' + error.message, 'danger');
  }
}
```

---

## Phase 3: Cleanup & Deletion

### Files to Delete (100KB backend code)

#### Backend Functions (api/ folder)
```
DELETE: /api/process-pdf.js       1,922 lines
DELETE: /api/debug-pdf.js         516 lines
TOTAL:                            2,438 lines
```

#### Local Development Server
```
DELETE: simple-server.js          1,239 lines
DELETE: database.js               299 lines
DELETE: doi-extractor.js          189 lines
DELETE: pdf-processor.js          24 lines
TOTAL:                            1,751 lines
```

#### Configuration Files
```
DELETE: vercel.json
DELETE: package-lock.json         (will regenerate after package.json cleanup)
```

#### package.json Dependencies to Remove
```json
{
  "dependencies": {
    "@google-cloud/documentai": "^8.11.0",  ❌ DELETE (backend PDF OCR)
    "better-sqlite3": "^9.6.0",             ❌ DELETE (local DB)
    "express": "^5.1.0",                    ❌ DELETE (local server)
    "formidable": "^3.5.1",                 ❌ DELETE (file uploads)
    "uuid": "^10.0.0"                       ❌ DELETE (backend util)
  },
  "devDependencies": {
    "@vercel/node": "^3.0.0"                ❌ DELETE (Vercel runtime)
  }
}
```

**New package.json (simplified):**
```json
{
  "name": "roadmap-model-card-editor",
  "version": "2.0.0",
  "description": "ROADMAP Model Card Editor - Fully Static Version",
  "main": "index.html",
  "scripts": {
    "serve": "npx http-server . -p 8080"
  },
  "keywords": [
    "roadmap",
    "model-card",
    "ai",
    "medical-imaging",
    "static-site"
  ],
  "author": "",
  "license": "MIT",
  "dependencies": {},
  "devDependencies": {}
}
```

**Note:** All external libraries (PDF.js, Bootstrap, jQuery, JSON Editor) are loaded via CDN, so no npm dependencies needed!

---

## Phase 4: Testing & Validation

### Test Suite Checklist

#### Unit Tests (Manual)
- [ ] **API Key Management**
  - [ ] Save valid API key → Persists in localStorage
  - [ ] Save invalid key (not starting with "AIza") → Shows error
  - [ ] Clear API key → Removes from localStorage
  - [ ] Toggle visibility → Switches password/text input
  - [ ] Page reload → Loads saved key automatically

- [ ] **PDF Extraction (pdf-extractor.js)**
  - [ ] Upload valid PDF → Extracts text successfully
  - [ ] Upload 1-page PDF → Returns correct page count
  - [ ] Upload multi-page PDF → Extracts all pages
  - [ ] Upload PDF with tables → Detects tables (heuristic)
  - [ ] Upload 51MB PDF → Shows size error
  - [ ] Upload non-PDF file → Shows type error
  - [ ] Upload corrupt PDF → Shows extraction error

- [ ] **Gemini API Client (gemini-client.js)**
  - [ ] Call with valid key → Returns response
  - [ ] Call with invalid key → Shows "Invalid API key" error
  - [ ] Call with expired quota → Shows "quota exceeded" error
  - [ ] Call with blocked content → Shows "safety filter" error
  - [ ] Parse valid JSON response → Extracts Model/Dataset object
  - [ ] Parse invalid response → Returns null

#### Integration Tests (End-to-End)
- [ ] **Full PDF Processing Flow**
  - [ ] No API key → Shows error immediately
  - [ ] Valid API key + small PDF → Processes successfully
  - [ ] Valid API key + large PDF → Shows progress updates
  - [ ] Model card PDF → Extracts Model JSON
  - [ ] Dataset card PDF → Extracts Dataset JSON
  - [ ] Text-only mode → Uses gemini-1.5-flash-latest
  - [ ] Multimodal mode → Uses gemini-1.5-pro-latest (note: images not extracted yet)

- [ ] **UI State Management**
  - [ ] No API key → PDF cards disabled (grayed out)
  - [ ] API key saved → PDF cards enabled
  - [ ] Processing → Shows loading indicator
  - [ ] Success → Opens editor with pre-filled data
  - [ ] Error → Shows error message, stays on home screen

#### Browser Compatibility
- [ ] Chrome/Edge (latest) → All features work
- [ ] Firefox (latest) → All features work
- [ ] Safari (latest) → All features work
- [ ] Mobile Chrome → PDF processing works (may be slow)
- [ ] Mobile Safari → PDF processing works

#### Performance Benchmarks
```
Small PDF (1-2 pages, <1MB):
  Extraction:   < 2 seconds
  Gemini API:   < 5 seconds
  Total:        < 7 seconds

Medium PDF (5-10 pages, 2-5MB):
  Extraction:   < 5 seconds
  Gemini API:   < 10 seconds
  Total:        < 15 seconds

Large PDF (20+ pages, 5-10MB):
  Extraction:   < 15 seconds
  Gemini API:   < 30 seconds
  Total:        < 45 seconds
```

---

## Phase 5: Deployment

### GitHub Pages Setup (Static Hosting)

#### Step 1: Create gh-pages branch
```bash
# From main branch
git checkout -b gh-pages
git push origin gh-pages
```

#### Step 2: Enable GitHub Pages
```
1. Go to repository Settings
2. Click "Pages" in left sidebar
3. Source: Deploy from branch
4. Branch: gh-pages / (root)
5. Click Save
```

#### Step 3: Access your site
```
URL: https://<username>.github.io/roadmap-json/
Example: https://yourusername.github.io/roadmap-json/
```

#### Step 4: Automatic Deployments
```
Every push to gh-pages branch → Auto-deploys in ~1 minute
No build process needed (100% static files)
```

### Alternative Hosting Options

#### Netlify (Drag & Drop)
```
1. Visit https://app.netlify.com/drop
2. Drag the entire project folder
3. Done! Instant deployment
```

#### Cloudflare Pages
```
1. Visit https://pages.cloudflare.com/
2. Connect GitHub repository
3. Build command: (leave empty)
4. Publish directory: /
5. Deploy
```

#### Any Static Host
```
Simply upload these files to any web server:
├── index.html
├── css/
├── js/
└── schemas/
```

---

## Phase 6: Documentation Updates

### Files to Update

#### README.md - Complete Rewrite
**Sections:**
1. **Quick Start** - "Clone, open index.html, done!"
2. **Get Gemini API Key** - Step-by-step with screenshots
3. **Usage** - How to create Model/Dataset cards
4. **PDF Processing** - Explain client-side extraction
5. **Deployment** - GitHub Pages instructions
6. **Architecture** - Show simplified stack
7. **FAQ** - Common questions about API keys
8. **Contributing** - How to contribute

#### New File: DEPLOYMENT.md
```markdown
# Deployment Guide

## GitHub Pages (Recommended)
[Step-by-step instructions]

## Netlify
[Step-by-step instructions]

## Cloudflare Pages
[Step-by-step instructions]

## Custom Domain
[DNS configuration instructions]
```

#### New File: API_KEY_GUIDE.md
```markdown
# Gemini API Key Setup

## Get Your Free API Key
1. Visit https://aistudio.google.com/app/apikey
2. Sign in with Google account
3. Click "Create API Key"
4. Copy the key

## Usage Limits (Free Tier)
- 15 requests/minute
- 1 million tokens/minute
- 1500 requests/day

## Security
- Stored locally in browser (localStorage)
- Never sent to any server except Google Gemini
- Cleared when you clear browser data

## Troubleshooting
[Common API key errors and solutions]
```

---

## Risk Assessment & Mitigation

### Identified Risks

| Risk | Impact | Probability | Mitigation |
|------|--------|-------------|------------|
| **API Key Exposure** | Medium | Low | Keys stored in localStorage (client-side only), never logged to console in production |
| **User Friction** | Medium | High | Provide clear 30-second setup guide, link directly to API key page |
| **Quota Limits** | Medium | Medium | Show clear error messages, link to quota dashboard, suggest waiting period |
| **PDF Extraction Quality** | Medium | Medium | PDF.js is mature, but table detection is heuristic - set user expectations |
| **Large PDF Performance** | Low | Medium | Implement 50MB limit, show progress updates, warn about processing time |
| **Browser Compatibility** | Low | Low | PDF.js and Fetch API widely supported (IE11 not supported, which is acceptable) |
| **Schema Changes** | Low | Low | Fetch schemas from GitHub (same as before), graceful fallback to local |

---

## Migration Execution Plan

### Pre-Migration Checklist
- [ ] Backup entire project: `git tag pre-migration-backup`
- [ ] Document current Vercel deployment URL
- [ ] Export any saved schemas from Vercel deployment
- [ ] Create new branch: `git checkout -b static-migration`

### Migration Steps (Sequential)

#### Week 1: Core Integration
- [ ] Day 1: Modify `handlePdfUpload()` in app.js
- [ ] Day 2: Modify `handleDebugPdfUpload()` in app.js
- [ ] Day 3: Test PDF processing with sample files
- [ ] Day 4: Test both Model and Dataset card types
- [ ] Day 5: Test text-only and multimodal modes

#### Week 2: Cleanup & Testing
- [ ] Day 1: Delete backend files (api/, simple-server.js, etc.)
- [ ] Day 2: Update package.json, remove dependencies
- [ ] Day 3: Run full test suite (manual tests)
- [ ] Day 4: Test on multiple browsers
- [ ] Day 5: Performance testing with various PDF sizes

#### Week 3: Deployment & Documentation
- [ ] Day 1: Create gh-pages branch
- [ ] Day 2: Deploy to GitHub Pages
- [ ] Day 3: Test production deployment
- [ ] Day 4: Update README.md
- [ ] Day 5: Write DEPLOYMENT.md and API_KEY_GUIDE.md

#### Week 4: Validation & Handoff
- [ ] Day 1: User acceptance testing
- [ ] Day 2: Fix any discovered issues
- [ ] Day 3: Final production deployment
- [ ] Day 4: Update project documentation
- [ ] Day 5: Archive old Vercel deployment

---

## Success Metrics

### Quantitative Metrics
```
✅ Lines of Code Reduction:     -22% (1,791 lines)
✅ File Count Reduction:        -5 files
✅ Backend Dependencies:        0 (from 6)
✅ Deployment Time:             <1 min (from ~3 min)
✅ Hosting Cost:                $0/month (from $0-20/month)
✅ Build Complexity:            None (from serverless config)
```

### Qualitative Metrics
- ✅ **Simplicity:** No backend to maintain or monitor
- ✅ **Transparency:** Users control their own API usage
- ✅ **Portability:** Can be hosted anywhere (GitHub Pages, Netlify, S3, etc.)
- ✅ **Security:** No server-side API keys to manage
- ✅ **Scalability:** Scales automatically with CDN (no server limits)
- ✅ **Maintainability:** Easier for contributors (no backend knowledge needed)

---

## Rollback Plan

If migration fails or issues are discovered:

### Quick Rollback (Same Day)
```bash
# Revert to pre-migration state
git checkout main
git branch -D static-migration

# Redeploy old Vercel version
vercel --prod
```

### Post-Deployment Rollback
```bash
# If deployed to GitHub Pages
git checkout gh-pages
git revert HEAD~3  # Revert last 3 commits
git push origin gh-pages

# Restore Vercel deployment
git checkout main
vercel --prod
```

---

## Next Actions

### Immediate (This Week)
1. **Review this migration plan** - Confirm approach is acceptable
2. **Backup current deployment** - Create git tag
3. **Modify handlePdfUpload()** - Implement client-side processing
4. **Test with sample PDFs** - Validate extraction works

### Short-term (Next 2 Weeks)
1. **Complete app.js modifications**
2. **Delete backend files**
3. **Run comprehensive tests**
4. **Deploy to GitHub Pages**

### Long-term (Month 1-2)
1. **Monitor user feedback**
2. **Improve table detection algorithm** (if needed)
3. **Add client-side image extraction** (optional enhancement)
4. **Create video tutorial** for API key setup

---

## Appendix

### A. Function Mapping (Old → New)

| Old Backend Function | New Client-Side Function | Location |
|---------------------|-------------------------|----------|
| `/api/process-pdf` → POST | `extractPdfData()` + `processPdfWithGemini()` | pdf-extractor.js + gemini-client.js |
| Backend schema caching | Browser fetch with same logic | app.js (unchanged) |
| Google Document AI | PDF.js (client-side) | pdf-extractor.js |
| Backend Gemini API call | Direct Gemini API call | gemini-client.js |
| Server-side API key | LocalStorage API key | gemini-client.js |

### B. API Endpoint Changes

| Old Endpoint | New Approach |
|-------------|--------------|
| `POST /api/process-pdf` | Direct PDF.js + Gemini API calls |
| `POST /api/debug-pdf` | Simplified client-side debug |
| `GET /api/schemas/*` | Removed (schemas served as static files) |
| `POST /api/save-schema` | Removed (download JSON instead) |

### C. Environment Variables (Eliminated)

```bash
# OLD (Vercel)
GEMINI_API_KEY=<secret>
LLM_API_KEY=<secret>
GOOGLE_CLOUD_KEY=<secret>
DOCUMENT_AI_PROCESSOR_ID=<secret>

# NEW (None!)
# All API keys provided by users
```

---

## Conclusion

This migration transforms the ROADMAP Model Card Editor from a complex serverless application into a simple, maintainable static site. By eliminating the backend:

- **Reduces codebase by 22%** (1,791 lines)
- **Eliminates hosting costs** (GitHub Pages is free)
- **Improves transparency** (users control their API usage)
- **Simplifies deployment** (drag-and-drop or git push)
- **Eases maintenance** (no backend to monitor or debug)

The trade-off is minimal: users need to obtain a free Gemini API key (30-second process), which is reasonable for a public tool aimed at researchers who likely already have API access.

**Total Migration Time:** ~3-4 weeks (with testing)
**Total Effort:** ~20-30 hours
**Risk Level:** Low (can rollback easily)

---

*Generated: 2025-01-16*
*Next Review: After Phase 2 completion*
