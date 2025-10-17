# Gemini PDF Direct Extraction - Experiment

**Status:** 🟡 Phase 1 - Manual Testing
**Branch:** `experiment/gemini-pdf-direct`
**Started:** 2025-10-16

---

## 🎯 Experiment Goal

Evaluate feasibility of replacing Google Document AI with Gemini's native PDF processing to:
- Reduce API costs by 88% (8-80x cheaper)
- Simplify architecture (single API call instead of two)
- Potentially improve processing speed

---

## 📊 Experiment Phases

### **Phase 1: Manual Feasibility Test** 🟡 IN PROGRESS
**Time:** 2 hours
**Goal:** Quick test in Google AI Studio - is it even viable?
**Document:** `PHASE1_MANUAL_TEST.md`
**Status:** Awaiting execution

**Success Criteria:**
- Gemini can read PDF structure ✓
- Basic information extraction works ✓
- Table extraction is reasonable ✓
- JSON output is usable ✓

### **Phase 2: Automated POC** ⏸️ PENDING
**Time:** 6 hours
**Dependency:** Phase 1 must pass
**Deliverables:**
- `api/test-gemini-pdf.js` - Test endpoint
- Side-by-side comparison with 5 PDFs
- Accuracy metrics

### **Phase 3: Comprehensive Evaluation** ⏸️ PENDING
**Time:** 8 hours
**Dependency:** Phase 2 must achieve ≥70% accuracy
**Deliverables:**
- Test 20-30 PDFs
- Full metrics analysis
- Final GO/NO-GO decision

---

## 📁 Directory Structure

```
experiments/gemini-pdf-phase1/
├── README.md                      # This file
├── PHASE1_MANUAL_TEST.md         # Manual test protocol & results
├── pdf1_gemini_response.txt      # Gemini output for test PDF 1
├── pdf1_current_output.json      # Current system output for comparison
├── pdf2_gemini_response.txt      # Gemini output for test PDF 2
├── pdf2_current_output.json      # Current system output for comparison
└── screenshots/                   # AI Studio screenshots
```

---

## 🚦 Decision Gates

**Stop Immediately If:**
- ❌ Phase 1 score < 4/10
- ❌ Gemini cannot read PDFs at all
- ❌ Table extraction completely broken
- ❌ Hallucination rate > 50%

**Proceed with Caution If:**
- ⚠️ Phase 1 score 4-7/10
- ⚠️ Tables work but have quality issues
- ⚠️ Some hallucinations but fixable with prompting

**Full Steam Ahead If:**
- ✅ Phase 1 score 8-10/10
- ✅ Table extraction comparable to Document AI
- ✅ JSON output usable with minimal fixes

---

## 📖 Reference Materials

**Planning Documents:**
- `../../GEMINI_PDF_FEASIBILITY_PLAN.md` - Complete evaluation plan
- `../../PDF_EXTRACTION_ANALYSIS.md` - Current system analysis
- `../../CLAUDE.md` - Development guidelines

**Current System:**
- `../../api/process-pdf.js` - Document AI integration

**Gemini Resources:**
- Google AI Studio: https://aistudio.google.com/
- Gemini API Docs: https://ai.google.dev/gemini-api/docs/document-processing
- File API Docs: https://ai.google.dev/gemini-api/docs/file-api

---

## ✅ Quick Start - Phase 1

1. **Open this file:** `PHASE1_MANUAL_TEST.md`
2. **Go to AI Studio:** https://aistudio.google.com/
3. **Select 2-3 test PDFs** from your trusted test set
4. **Follow the test protocol** (prompts provided)
5. **Document results** in PHASE1_MANUAL_TEST.md
6. **Make GO/NO-GO decision** based on scores

**Time budget:** 2 hours max

---

**Last Updated:** 2025-10-16
**Next Update:** After Phase 1 completion
