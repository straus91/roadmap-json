# Gemini PDF API Feasibility Evaluation Plan

**Created:** 2025-10-16
**Project:** ROADMAP Model Card Editor
**Objective:** Evaluate replacing Google Document AI with Gemini API for PDF extraction

---

## 🎯 Executive Summary

**Proposal:** Replace the current two-step process (Document AI → Gemini) with a single Gemini API call for PDF processing.

**Current Architecture:**
```
PDF → Document AI (OCR, tables, images) → Gemini API (JSON extraction)
      ^^^^^^^^^^^^^^^^                      ^^^^^^^^^^^^^^^^
      Structured extraction                 Information extraction
      (~22-23s, costly)                     (variable, less costly)
```

**Proposed Architecture:**
```
PDF → Gemini API (direct PDF processing + JSON extraction)
      ^^^^^^^^^^^^^^^^
      Single-step multimodal processing
      (faster?, 8-80x cheaper)
```

---

## 📊 Key Findings from Research

### **Gemini PDF Capabilities (2025)**

✅ **What Gemini CAN do:**
- Native PDF processing (up to 1000 pages, 50MB max)
- Multimodal understanding (text, images, charts, tables)
- Context window: 1M tokens (massive capacity)
- File API: Free storage for 48 hours
- Context caching: Reduces repeat processing costs
- Cost: **8-80x cheaper** than Document AI for typical documents

❌ **What Gemini CANNOT do (or does poorly):**
- Precise object localization (bounding boxes)
- Exact text positioning coordinates
- Reliable OCR on handwritten text
- Guaranteed structured table extraction
- May hallucinate on complex layouts
- May approximate object counts

### **Document AI Strengths**

✅ **What Document AI DOES WELL:**
- Precise bounding box coordinates for tables/images
- Structured table extraction with headers/rows
- Accurate OCR (including handwritten text)
- Spatial layout understanding
- Consistent output format
- Enterprise-grade reliability

---

## 🔍 Current System Analysis

### **What We Actually USE from Document AI**

**Critical features (lines 1638-1756):**
1. ✅ **Extracted text** - Full document text (Gemini can do this)
2. ✅ **Tables** - Structured headers + rows (Gemini can do this, but less reliably)
3. ✅ **Images** - Base64 encoded figures (Gemini can do this via File API)
4. 🟡 **Bounding boxes** - For `filterIncorrectTables()` (Gemini CANNOT do this)
5. 🟡 **Figure detection** - `findReferencedImages()` (Gemini can analyze context better)

### **Custom Logic We've Built**

**Smart table filtering (lines 140-173):**
```javascript
function filterIncorrectTables(tables, images, pageIndex) {
  // Uses bounding box overlap detection
  // Removes tables overlapping with images
  // Filters giant single-cell tables
}
```

**Impact if we lose bounding boxes:**
- Cannot filter tables overlapping with figures
- May send noisy/incorrect tables to final extraction
- Workaround: Let Gemini handle this with better prompting

---

## ⚖️ Risk Assessment Matrix

### 🔴 **HIGH RISK - Critical Dependencies**

| Risk | Current Mitigation | Gemini Alternative | Risk Level |
|------|-------------------|-------------------|------------|
| **Structured table extraction accuracy** | Document AI's precise parsing | Gemini's multimodal understanding (less reliable) | 🔴 HIGH |
| **Table/image overlap detection** | Bounding box filtering | None (prompt-based guidance) | 🔴 HIGH |
| **Production reliability** | Proven stable integration | Unproven in this use case | 🟡 MEDIUM |

### 🟡 **MEDIUM RISK - Quality Concerns**

| Risk | Current Mitigation | Gemini Alternative | Risk Level |
|------|-------------------|-------------------|------------|
| **Complex table handling** | Document AI structure preservation | Gemini may interpret creatively | 🟡 MEDIUM |
| **Image extraction** | Explicit image objects | File API + visual analysis | 🟢 LOW |
| **Handwritten content** | Document AI OCR | Gemini may hallucinate | 🟡 MEDIUM |

### 🟢 **LOW RISK - Acceptable Trade-offs**

| Risk | Current Mitigation | Gemini Alternative | Risk Level |
|------|-------------------|-------------------|------------|
| **API cost** | Expensive Document AI calls | 8-80x cheaper with Gemini | 🟢 LOW (benefit!) |
| **Processing time** | 22-23s for Document AI | Potentially faster single call | 🟢 LOW (benefit!) |
| **Prompt complexity** | Separated concerns | More complex single prompt | 🟢 LOW |

---

## 💡 Vibe Coding + Data-Driven Approach

### **Phase 1: Hypothesis Generation** (1 hour)

**Hypothesis:** "Gemini 2.5 Flash can directly process research PDFs and extract ROADMAP JSON with acceptable accuracy, eliminating the need for Document AI."

**Success Criteria:**
- JSON extraction accuracy ≥ 85% (compared to current system)
- Table data completeness ≥ 80%
- Processing time ≤ current system
- Cost reduction ≥ 50%

**Failure Criteria (automatic NO-GO):**
- Table extraction accuracy < 60%
- Cannot reliably identify figures
- Hallucination rate > 20%
- Processing time > 2x current system

### **Phase 2: Minimal Proof-of-Concept** (4-6 hours)

**Build Strategy:**
1. **Don't touch production code** - Create `api/test-gemini-pdf.js`
2. **Test with existing PDFs** - Use your trusted test PDFs
3. **Measure, don't guess** - Log everything, compare outputs
4. **Fail fast** - If Phase 2 fails, stop immediately

**Implementation Steps:**

**Step 1: Create test endpoint** (1 hour)
```javascript
// api/test-gemini-pdf.js
import { IncomingForm } from 'formidable';
import { promises as fs } from 'fs';

export default async function handler(req, res) {
  // 1. Upload PDF to Gemini File API
  // 2. Send single prompt: "Extract ROADMAP JSON from this PDF"
  // 3. Return raw Gemini response + timing metrics
  // 4. Log comparison data
}
```

**Step 2: Design comparison test** (30 min)
```javascript
// Test harness
const testPDFs = [
  'model-paper-simple.pdf',     // Best case
  'dataset-paper-complex.pdf',  // Complex tables
  'multi-table-paper.pdf'       // Edge case
];

for (const pdf of testPDFs) {
  const docAIResult = await processWithDocumentAI(pdf);
  const geminiResult = await processWithGeminiDirect(pdf);

  compareResults(docAIResult, geminiResult);
}
```

**Step 3: Metrics collection** (30 min)
```javascript
function compareResults(docAI, gemini) {
  return {
    // Completeness
    fieldsExtracted: { docAI: countFields(docAI), gemini: countFields(gemini) },
    tablesFound: { docAI: docAI.tables.length, gemini: gemini.tables?.length || 0 },

    // Accuracy
    schemaCompliance: { docAI: validateSchema(docAI), gemini: validateSchema(gemini) },

    // Performance
    processingTime: { docAI: docAI.duration, gemini: gemini.duration },
    cost: { docAI: estimateDocAICost(docAI), gemini: estimateGeminiCost(gemini) },

    // Quality
    hallucinationScore: detectHallucinations(gemini),
    tableAccuracy: compareTableData(docAI.tables, gemini.tables)
  };
}
```

**Step 4: Run experiments** (2-3 hours)
- Test 5-10 PDFs from your existing test set
- Measure accuracy, completeness, speed, cost
- Document edge cases and failures

### **Phase 3: Analysis & Decision** (2 hours)

**Data-Driven Decision Matrix:**

| Metric | Threshold | Action if Below Threshold |
|--------|-----------|---------------------------|
| JSON accuracy | ≥ 85% | ❌ **STOP** - Gemini not viable |
| Table completeness | ≥ 80% | ⚠️ Investigate improvements |
| Cost savings | ≥ 50% | ⚠️ Re-evaluate business case |
| Processing time | ≤ 1.5x current | ⚠️ Acceptable if cost savings high |

**Go/No-Go Decision Tree:**
```
Is JSON accuracy ≥ 85%?
  ├─ NO → ❌ STOP - Keep Document AI
  └─ YES → Are tables ≥ 80% complete?
      ├─ NO → Can we improve with prompt engineering?
      │   ├─ YES → Iterate on prompts (1 more week)
      │   └─ NO → ❌ STOP - Keep Document AI
      └─ YES → ✅ GO - Proceed to Phase 4 (Hybrid Approach)
```

---

## 🏗️ Proposed Implementation Strategies

### **Strategy A: Full Replacement** (Aggressive)

**Risk:** 🔴 HIGH
**Effort:** Medium (1 week)
**Cost Savings:** Maximum (8-80x)

```javascript
// Replace entire Document AI step
export default async function handler(req, res) {
  // 1. Upload PDF to Gemini File API
  const fileUri = await uploadToGeminiFileAPI(pdfFile);

  // 2. Single comprehensive prompt
  const prompt = createEnhancedGeminiPDFPrompt(schemas, cardType);

  // 3. Call Gemini with file reference
  const result = await gemini.generateContent({
    contents: [{ fileData: { fileUri, mimeType: 'application/pdf' } }],
    contents: [{ text: prompt }]
  });

  // 4. Parse and return JSON
  return parseGeminiResponse(result);
}
```

**Pros:**
- Simplest architecture
- Maximum cost savings
- Faster processing (single API call)

**Cons:**
- Higher risk of accuracy degradation
- Lose table filtering logic
- All-or-nothing deployment

### **Strategy B: Hybrid Approach** (Conservative)

**Risk:** 🟡 MEDIUM
**Effort:** Medium-High (2 weeks)
**Cost Savings:** Moderate (depends on user choice)

```javascript
// Add "extraction_method" parameter: "document-ai" | "gemini-direct"
export default async function handler(req, res) {
  const extractionMethod = fields.extractionMethod?.[0] || 'document-ai';

  if (extractionMethod === 'gemini-direct') {
    // New: Direct Gemini PDF processing
    return await processWithGeminiDirect(pdfFile, schemas, cardType);
  } else {
    // Existing: Document AI → Gemini
    return await processWithDocumentAI(pdfFile, schemas, cardType);
  }
}
```

**Pros:**
- Safe fallback to proven method
- A/B testing in production
- Gradual migration path
- User choice (speed vs accuracy)

**Cons:**
- Maintain two code paths
- More complex testing
- Split user experience

### **Strategy C: Intelligent Routing** (Smart)

**Risk:** 🟢 LOW
**Effort:** High (3 weeks)
**Cost Savings:** Optimized per use case

```javascript
// Automatically route based on document characteristics
async function chooseExtractionMethod(pdfFile, schemas, cardType) {
  // Quick analysis: page count, file size, complexity
  const analysis = await analyzeDocument(pdfFile);

  if (analysis.complexity === 'simple' && analysis.pages < 10) {
    // Fast path: Gemini direct
    return 'gemini-direct';
  } else if (analysis.hasManyTables || analysis.hasHandwriting) {
    // Precision path: Document AI
    return 'document-ai';
  } else {
    // Try Gemini first, fallback if low confidence
    return 'gemini-with-fallback';
  }
}
```

**Pros:**
- Best of both worlds
- Optimized cost/accuracy per document
- Smart resource allocation

**Cons:**
- Most complex implementation
- Requires document complexity analysis
- Harder to debug

---

## 📋 Proof-of-Concept Implementation Plan

### **Week 1: Research & Setup** (8 hours)

**Day 1-2: API Setup** (4 hours)
- [ ] Create Gemini File API test endpoint
- [ ] Test PDF upload (max 50MB, 1000 pages)
- [ ] Verify context caching works
- [ ] Test multimodal prompt with PDF

**Day 3-4: Baseline Testing** (4 hours)
- [ ] Select 10 representative test PDFs (5 model, 5 dataset)
- [ ] Process all with current Document AI system
- [ ] Save outputs as baseline (JSON + metrics)
- [ ] Document current accuracy, time, cost

### **Week 2: Experimentation** (12 hours)

**Day 1-2: Build Gemini PDF Processor** (6 hours)
- [ ] Create `api/test-gemini-pdf.js`
- [ ] Implement File API upload
- [ ] Create single-step extraction prompt
- [ ] Add comprehensive logging

**Day 3-4: Run Comparison Tests** (6 hours)
- [ ] Process same 10 PDFs with Gemini direct
- [ ] Measure: accuracy, completeness, speed, cost
- [ ] Document hallucinations and errors
- [ ] Compare table extraction quality

### **Week 3: Analysis & Decision** (8 hours)

**Day 1-2: Data Analysis** (4 hours)
- [ ] Calculate accuracy metrics
- [ ] Analyze failure patterns
- [ ] Estimate cost savings
- [ ] Identify edge cases

**Day 3: Decision Meeting** (2 hours)
- [ ] Review metrics against thresholds
- [ ] Make GO/NO-GO decision
- [ ] If GO: Choose implementation strategy
- [ ] If NO-GO: Document lessons learned

**Day 4: Planning** (2 hours)
- [ ] If GO: Create detailed implementation roadmap
- [ ] If NO-GO: Explore prompt optimization alternatives

---

## 🎯 Success Metrics (Data-Driven)

### **Primary Metrics (Must Pass All)**

| Metric | Current Baseline | Target | Measurement |
|--------|-----------------|--------|-------------|
| **Schema Compliance** | ~95% | ≥ 85% | % of fields matching ROADMAP schema |
| **Table Data Accuracy** | ~90% | ≥ 80% | Manual review of 20 random tables |
| **Field Completeness** | Baseline | ≥ 90% of baseline | # of populated fields / baseline fields |

### **Secondary Metrics (Nice to Have)**

| Metric | Current Baseline | Target | Measurement |
|--------|-----------------|--------|-------------|
| **Processing Time** | 22-30s | ≤ 30s | Median across 50 PDFs |
| **Cost per Document** | Baseline | ≤ 50% of baseline | API call costs |
| **Hallucination Rate** | ~5% | ≤ 10% | Manual review of suspicious outputs |

### **Quality Assurance Tests**

**Test Suite (10 PDFs):**
1. Simple 2-page model paper (baseline test)
2. Complex 10-page dataset paper with many tables
3. PDF with multiple figures and charts
4. Low-quality scanned PDF
5. Paper with nested tables
6. International paper (non-English authors)
7. Paper with handwritten annotations
8. Very long paper (>20 pages)
9. Paper with unusual formatting
10. Supplementary materials PDF

**Pass Criteria:**
- 8/10 PDFs must meet accuracy thresholds
- 0/10 PDFs can have critical failures (corrupted JSON, missing required fields)
- Average accuracy across all 10 ≥ 85%

---

## 🚨 Risk Mitigation Strategies

### **Technical Risks**

**Risk 1: Table Extraction Degradation**
- **Mitigation:** Enhanced prompts with explicit table extraction instructions
- **Fallback:** Hybrid mode - use Document AI only for table-heavy documents
- **Detection:** Automated table count comparison in tests

**Risk 2: Hallucination on Complex Documents**
- **Mitigation:** Add validation layer, confidence scoring
- **Fallback:** Flag low-confidence extractions for manual review
- **Detection:** Cross-reference extracted data with source text

**Risk 3: Loss of Spatial Understanding**
- **Mitigation:** Use Gemini's visual understanding to infer layout
- **Fallback:** Accept trade-off (less critical for final JSON output)
- **Detection:** Compare figure reference accuracy

### **Business Risks**

**Risk 4: User Experience Regression**
- **Mitigation:** Hybrid deployment (user choice, or A/B test)
- **Fallback:** Easy rollback to Document AI
- **Detection:** User feedback, error rate monitoring

**Risk 5: Accuracy Not Meeting Threshold**
- **Mitigation:** Stop at Phase 2 if metrics fail
- **Fallback:** Keep current architecture
- **Detection:** Automated threshold checks in test suite

---

## 💰 Cost-Benefit Analysis

### **Current Costs (Document AI + Gemini)**

```
Document AI:
  - OCR/Layout parsing: ~$1.50 per 1,000 pages (US pricing)
  - For typical 10-page PDF: ~$0.015 per document

Gemini API (current usage):
  - Input: 15K chars text + tables JSON + images
  - Output: 32K tokens max
  - Estimated: ~$0.002 per document

Total current cost: ~$0.017 per document
```

### **Proposed Costs (Gemini Direct)**

```
Gemini File API:
  - File storage: FREE for 48 hours
  - PDF processing: Treated as images (1 page = 1 image)
  - For 10-page PDF: ~$0.002 per document (8x cheaper)

Total proposed cost: ~$0.002 per document

Savings: $0.015 per document (88% cost reduction)
```

**At Scale:**
- 100 PDFs/month: Save $1.50/month (minimal)
- 10,000 PDFs/month: Save $150/month (significant)
- 100,000 PDFs/month: Save $1,500/month (substantial)

**Effort Investment:**
- POC: ~28 hours ($2,800 @ $100/hr developer time)
- Break-even: 18,667 PDFs processed

**Conclusion:** Cost savings are significant at scale, but POC effort is non-trivial for solo developer.

---

## 🔄 Recommendation & Next Steps

### **Conservative Recommendation: HYBRID APPROACH**

**Rationale:**
1. **Risk Management:** Preserve proven Document AI path while testing Gemini
2. **Data Collection:** Gather real-world metrics before full commitment
3. **User Choice:** Let users opt into faster/cheaper Gemini path
4. **Easy Rollback:** Can disable Gemini path if issues arise

**Immediate Next Steps (This Week):**

1. **Phase 1: Quick Feasibility Check** (2 hours)
   - [ ] Manually test Gemini with 1-2 PDFs via AI Studio
   - [ ] Upload PDF, ask "Extract ROADMAP model card as JSON"
   - [ ] Eyeball results - is it even close to working?
   - **GO/NO-GO Decision Point:** If completely broken, stop here

2. **Phase 2: Build POC** (If Phase 1 passes - 6 hours)
   - [ ] Create `api/test-gemini-pdf.js` endpoint
   - [ ] Test with 5 trusted PDFs
   - [ ] Compare outputs side-by-side
   - **GO/NO-GO Decision Point:** If accuracy < 70%, stop here

3. **Phase 3: Comprehensive Testing** (If Phase 2 passes - 8 hours)
   - [ ] Test 20-30 PDFs
   - [ ] Measure all metrics
   - [ ] Document edge cases
   - **FINAL GO/NO-GO Decision**

**Decision Gates:**
- ❌ **STOP after Phase 1 if:** Gemini produces unusable output
- ❌ **STOP after Phase 2 if:** Accuracy < 70% or hallucination rate > 30%
- ⚠️ **PAUSE after Phase 3 if:** Metrics marginal - iterate prompts (1 more week)
- ✅ **PROCEED if:** All metrics pass - implement hybrid approach

---

## 📖 Reference Materials

**Gemini Documentation:**
- [Document Understanding Guide](https://ai.google.dev/gemini-api/docs/document-processing)
- [File API Reference](https://ai.google.dev/gemini-api/docs/file-api)
- [Context Caching](https://ai.google.dev/gemini-api/docs/caching)

**Current System:**
- `api/process-pdf.js` lines 1546-1773 (Document AI integration)
- `api/process-pdf.js` lines 140-173 (Table filtering logic)
- `PDF_EXTRACTION_ANALYSIS.md` (Current system analysis)

**Test Resources:**
- Your trusted PDFs in project directory
- Existing ROADMAP JSON outputs for comparison
- Current processing logs for baseline metrics

---

## ✅ Evaluation Checklist

**Before Starting POC:**
- [ ] Review this plan with fresh eyes
- [ ] Ensure you have 2-3 trusted test PDFs ready
- [ ] Confirm Gemini API access and quotas
- [ ] Set aside dedicated time (no interruptions)
- [ ] Define acceptable failure criteria

**During POC:**
- [ ] Log EVERYTHING (inputs, outputs, timings, errors)
- [ ] Take screenshots of comparisons
- [ ] Document surprises (good and bad)
- [ ] Stop immediately if hitting failure criteria
- [ ] Ask for help if stuck > 2 hours on one issue

**After POC:**
- [ ] Write decision memo (GO/NO-GO + reasoning)
- [ ] Update ROADMAP.md with decision
- [ ] If GO: Create detailed implementation plan
- [ ] If NO-GO: Document what was learned
- [ ] Archive POC code and test results

---

**Status:** 🟡 DRAFT - Awaiting Phase 1 Execution
**Next Review:** After Phase 1 Manual Test (2 hours)
**Decision Deadline:** End of Week 3 (or earlier if clear NO-GO)
