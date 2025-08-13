// Complete local server with real PDF processing
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { promises as fs } from 'fs';
import { IncomingForm } from 'formidable';
import { extractTextFromPDF } from './pdf-processor.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = 3000;

// Load environment variables from .env.local
async function loadEnvVars() {
  try {
    const envContent = await fs.readFile('.env.local', 'utf8');
    const lines = envContent.split('\n');
    for (const line of lines) {
      if (line.trim() && !line.startsWith('#')) {
        const [key, ...valueParts] = line.split('=');
        const value = valueParts.join('=').trim();
        process.env[key.trim()] = value;
      }
    }
    console.log('✅ Environment variables loaded');
    console.log('🔑 Gemini API Key:', process.env.GEMINI_API_KEY ? 'Found' : 'Not found');
  } catch (error) {
    console.log('⚠️ No .env.local file found');
  }
}

await loadEnvVars();

// Serve static files
app.use(express.static(__dirname));

// Test endpoint to verify Gemini API works
app.get('/api/test-gemini', async (req, res) => {
  try {
    console.log('🧪 Testing Gemini API...');
    
    const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Gemini API key not configured' });
    }

    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
    
    const testPrompt = `Extract information from this text about a medical AI model:

"We developed a deep learning model called ChestX-Net for chest X-ray classification. The model achieved 95% accuracy on pneumonia detection using a dataset of 50,000 chest X-rays from multiple hospitals. The model was trained for 100 epochs and can process images in DICOM format."

Return a JSON object with Model information:`;

    const requestBody = {
      contents: [{
        parts: [{
          text: testPrompt
        }]
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1000,
      }
    };

    console.log('📤 Sending test request to Gemini...');
    const geminiResponse = await fetch(geminiApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.text();
      console.error('❌ Gemini API Error:', errorData);
      return res.status(500).json({ 
        error: `Gemini API failed: ${geminiResponse.status}`,
        details: errorData.substring(0, 200)
      });
    }

    const geminiResult = await geminiResponse.json();
    console.log('✅ Gemini API test successful!');
    
    const responseText = geminiResult.candidates?.[0]?.content?.parts?.[0]?.text || 'No response';
    
    res.json({ 
      success: true, 
      geminiResponse: responseText.substring(0, 1000),
      message: 'Gemini API is working!' 
    });
    
  } catch (error) {
    console.error('❌ Test error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Handle PDF upload with REAL file processing
app.post('/api/process-pdf', async (req, res) => {
  console.log('📄 PDF endpoint called - processing real file...');
  
  try {
    // Parse the multipart form data
    const form = new IncomingForm({
      uploadDir: './temp',
      keepExtensions: true,
      maxFileSize: 10 * 1024 * 1024, // 10MB limit
    });

    // Create temp directory if it doesn't exist
    try {
      await fs.mkdir('./temp', { recursive: true });
    } catch (err) {
      console.log('Temp directory already exists or created');
    }

    console.log('🔍 Parsing uploaded file...');
    const { files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) {
          console.error('❌ Form parsing error:', err);
          return reject(err);
        }
        console.log('✅ File parsed successfully');
        console.log('📁 Files received:', Object.keys(files));
        resolve({ files });
      });
    });

    // Get the PDF file
    const pdfFile = files.pdf?.[0] || files.pdf;
    if (!pdfFile) {
      console.error('❌ No PDF file found in upload');
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    console.log('📄 Processing PDF:', pdfFile.originalFilename);
    console.log('📊 File size:', pdfFile.size, 'bytes');
    console.log('📍 Temp file path:', pdfFile.filepath);

    // Read and process the PDF
    const fileBuffer = await fs.readFile(pdfFile.filepath);
    
    const pdfData = await extractTextFromPDF(fileBuffer);
    const extractedText = pdfData.text;
    
    console.log('📋 First 200 chars:', extractedText.substring(0, 200));

    // Clean up temp file
    try {
      await fs.unlink(pdfFile.filepath);
      console.log('🧹 Temp file cleaned up');
    } catch (cleanupError) {
      console.log('⚠️ Temp file cleanup failed:', cleanupError.message);
    }

    if (!extractedText || extractedText.trim().length === 0) {
      console.error('❌ No text extracted from PDF');
      return res.status(400).json({ error: 'No text could be extracted from the PDF' });
    }

    // Process the extracted text with multi-stage Gemini pipeline
    console.log('🧠 Starting multi-stage AI processing...');
    const processedData = await processTextWithMultiStageGemini(extractedText.substring(0, 12000));
    
    if (!processedData) {
      console.error('❌ Gemini processing failed');
      return res.status(500).json({ error: 'Failed to process extracted text' });
    }

    console.log('✅ PDF processed successfully!');
    console.log('📤 Returning structured data');
    
    res.json(processedData);

  } catch (error) {
    console.error('❌ PDF processing error:', error);
    res.status(500).json({ 
      error: 'Failed to process PDF',
      details: error.message 
    });
  }
});

// Multi-stage AI processing pipeline
async function processTextWithMultiStageGemini(extractedText) {
  try {
    console.log('🧠 === STAGE 1: Document Analysis & Summarization ===');
    const summary = await analyzeAndSummarizeDocument(extractedText);
    if (!summary) {
      console.error('❌ Stage 1 failed');
      return null;
    }

    console.log('🧠 === STAGE 2: Model vs Dataset Classification ===');
    const classification = await classifyDocumentType(summary);
    if (!classification) {
      console.error('❌ Stage 2 failed');
      return null;
    }

    console.log('🧠 === STAGE 3: ROADMAP Schema Extraction ===');
    const roadmapData = await extractToRoadmapFormat(summary, classification, extractedText);
    if (!roadmapData) {
      console.error('❌ Stage 3 failed');
      return null;
    }

    console.log('✅ Multi-stage processing completed successfully');
    return roadmapData;

  } catch (error) {
    console.error('❌ Multi-stage processing error:', error.message);
    return null;
  }
}

// Stage 1: Analyze and summarize the document
async function analyzeAndSummarizeDocument(text) {
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-latest:generateContent?key=${apiKey}`;

    const prompt = `You are an expert radiologist and AI researcher specializing in analyzing published radiology AI journal articles. Your task is to perform comprehensive document analysis for ROADMAP (Radiology Ontology for AI Models, Datasets and Projects) extraction.

TASK: Perform deep analysis of this radiology AI journal article and extract ALL available information in a structured format. Leave no detail behind.

RADIOLOGY AI JOURNAL ARTICLE ANALYSIS FRAMEWORK:

1. **IDENTIFICATION & NAMING:**
   - Full title/name of the AI model, algorithm, or dataset
   - Alternative names, abbreviations, or versions mentioned
   - Publication title and journal information

2. **CLINICAL APPLICATION & PURPOSE:**
   - Specific radiology imaging modality (CT, MRI, X-ray, ultrasound, etc.)
   - Target anatomy/organ system (chest, brain, abdomen, etc.)
   - Clinical task (detection, classification, segmentation, quantification)
   - Disease/condition being addressed
   - Clinical workflow integration points

3. **TECHNICAL METHODOLOGY:**
   - AI/ML architecture (CNN, transformer, ensemble, etc.)
   - Specific model type (ResNet, U-Net, BERT, etc.)
   - Training methodology and hyperparameters
   - Data preprocessing steps
   - Augmentation techniques used

4. **DATA CHARACTERISTICS:**
   - Dataset size (number of images, patients, cases)
   - Image specifications (resolution, bit depth, file formats)
   - Acquisition parameters and protocols
   - Multi-center vs single-center data
   - Demographic information (age ranges, gender distribution)
   - Disease prevalence and case distribution

5. **PERFORMANCE METRICS (Extract ALL mentioned):**
   - Primary metrics (accuracy, AUC, sensitivity, specificity)
   - Secondary metrics (precision, recall, F1-score, etc.)
   - Confidence intervals and statistical significance
   - Comparison with radiologists or existing methods
   - Subgroup analyses and performance variations

6. **VALIDATION & TESTING:**
   - Cross-validation methodology
   - Internal vs external validation
   - Test set characteristics
   - Prospective vs retrospective validation
   - Multi-reader studies

7. **CLINICAL USERS & DEPLOYMENT:**
   - Target user types (radiologists, technologists, clinicians)
   - Clinical setting (screening, diagnosis, monitoring)
   - Integration requirements (PACS, EMR, etc.)
   - Regulatory considerations mentioned

8. **TECHNICAL REQUIREMENTS:**
   - Hardware specifications (GPU, memory, processing time)
   - Software dependencies and frameworks
   - Computing infrastructure needs
   - Real-time vs batch processing capabilities

9. **LIMITATIONS & BIASES:**
   - Explicitly stated limitations
   - Potential biases (demographic, institutional, technical)
   - Generalizability concerns
   - Edge cases or failure modes

10. **REGULATORY & ETHICAL:**
    - IRB approval and ethical considerations
    - Data privacy and anonymization
    - Regulatory pathway or FDA considerations
    - Fair AI and bias mitigation efforts

INSTRUCTIONS:
- Extract EVERY piece of quantitative data (numbers, percentages, ranges)
- Capture ALL performance metrics with exact values
- Note technical specifications with precision
- Include methodology details that enable reproducibility
- Flag any missing standard information that should be present
- Use medical terminology accurately
- Preserve exact names and abbreviations as written

DOCUMENT TEXT:
"""${text}"""

COMPREHENSIVE STRUCTURED ANALYSIS:`;

    const response = await callGeminiAPI(geminiApiUrl, prompt, { temperature: 0.3, maxOutputTokens: 2000 });
    if (response) {
      console.log('✅ Stage 1 complete - Document summarized');
      console.log('📋 Summary preview:', response.substring(0, 200) + '...');
      return response;
    }
    return null;

  } catch (error) {
    console.error('❌ Stage 1 error:', error.message);
    return null;
  }
}

// Stage 2: Classify document type (Model vs Dataset)
async function classifyDocumentType(summary) {
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

    const prompt = `You are an expert radiologist and AI researcher specializing in classifying radiology AI journal articles. Analyze this document summary to determine if it primarily describes an AI MODEL/ALGORITHM or a DATASET/DATABASE.

RADIOLOGY AI JOURNAL CLASSIFICATION CRITERIA:

**AI MODEL/ALGORITHM** indicators:
- Primary focus on developing, training, or validating an AI system
- Reports model architecture (CNN, U-Net, ResNet, transformer, etc.)
- Describes training methodology and hyperparameters
- Reports performance metrics (AUC, sensitivity, specificity, accuracy)
- Discusses model validation against radiologists or gold standards
- Mentions inference time, computational requirements
- Describes clinical deployment or integration
- Keywords: "model", "algorithm", "network", "deep learning", "training", "validation", "performance", "accuracy", "CNN", "AI system"

**DATASET/DATABASE** indicators:
- Primary focus on creating, curating, or describing a data collection
- Details data acquisition protocols and imaging parameters
- Describes annotation methodology and inter-reader agreement
- Reports dataset statistics (patient demographics, case distributions)
- Discusses data quality control and standardization processes
- Mentions multi-center data collection or harmonization
- Describes ground truth establishment and expert consensus
- Keywords: "dataset", "database", "collection", "cohort", "annotated", "curated", "ground truth", "multi-center", "imaging protocol"

**HYBRID CASES** (choose primary focus):
- If introduces a new dataset AND trains a model on it → MODEL (if performance evaluation is emphasized)
- If creates a dataset AND provides baseline results → DATASET (if data creation is emphasized)
- If proposes a model AND releases the training data → MODEL (if model is the main contribution)

ANALYSIS FRAMEWORK:
1. Identify the PRIMARY contribution and main research objective
2. Determine what the authors consider their main novelty/contribution
3. Assess whether the paper's value lies in the algorithm or the data
4. Consider the journal section (if mentioned) and paper structure

DOCUMENT SUMMARY:
"""${summary}"""

INSTRUCTIONS:
- Provide definitive classification based on PRIMARY contribution
- Explain your reasoning with specific evidence from the text
- Note any secondary contributions (e.g., "primarily MODEL with released dataset")

RESPOND in this exact format:
"CLASSIFICATION: [MODEL/DATASET]"

Detailed reasoning with specific textual evidence:

CLASSIFICATION:`;

    const response = await callGeminiAPI(geminiApiUrl, prompt, { temperature: 0.1, maxOutputTokens: 500 });
    if (response) {
      const classification = response.includes('DATASET') ? 'DATASET' : 'MODEL';
      console.log('✅ Stage 2 complete - Classification:', classification);
      console.log('📋 Reasoning:', response.substring(0, 300) + '...');
      return { type: classification, reasoning: response };
    }
    return null;

  } catch (error) {
    console.error('❌ Stage 2 error:', error.message);
    return null;
  }
}

// Stage 3: Extract to ROADMAP format using real schema
async function extractToRoadmapFormat(summary, classification, originalText) {
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

    // Load the actual ROADMAP schema
    const schemaType = classification.type.toLowerCase();
    let realSchema = {};
    
    try {
      const schemaContent = await fs.readFile(`./schemas/base-${schemaType}-schema.json`, 'utf8');
      const fullSchema = JSON.parse(schemaContent);
      realSchema = fullSchema.$defs?.[schemaType]?.properties || {};
      console.log('✅ Real ROADMAP schema loaded:', Object.keys(realSchema).length, 'fields');
    } catch (schemaError) {
      console.log('⚠️ Could not load real schema, using fallback');
    }

    const schemaFieldsList = Object.keys(realSchema).slice(0, 20).join(', ');

    const prompt = `You are a ROADMAP (Radiology Ontology for AI Models, Datasets and Projects) expert specializing in extracting comprehensive information from published radiology AI journal articles. Your mission is to capture EVERY piece of relevant information for maximum completeness and accuracy.

DOCUMENT TYPE: ${classification.type}
AVAILABLE ROADMAP SCHEMA FIELDS: ${schemaFieldsList}

EXTRACTION METHODOLOGY FOR RADIOLOGY AI JOURNAL ARTICLES:

${classification.type === 'MODEL' ? ENHANCED_MODEL_EXTRACTION_PROMPT : ENHANCED_DATASET_EXTRACTION_PROMPT}

CRITICAL EXTRACTION PRINCIPLES:
1. **PRECISION**: Extract exact values, percentages, and measurements as published
2. **COMPLETENESS**: Capture every available detail, no matter how minor
3. **ACCURACY**: Use precise medical and technical terminology
4. **CONTEXT**: Include confidence intervals, p-values, and statistical context
5. **STANDARDIZATION**: Map journal terminology to ROADMAP schema fields
6. **VALIDATION**: Cross-reference summary with original text for accuracy
7. **INDIVIDUAL METRICS**: CREATE SEPARATE RESULT ENTRIES for each performance metric using EXACT ROADMAP schema names
8. **ROADMAP METRIC NAMES**: Use exact names: "Area under the receiver operating characteristic curve", "Sensitivity", "Specificity", "Accuracy", "Precision", "Recall"
9. **SEPARATE TEST SETS**: If multiple test sets, create separate entries for each
10. **SUBGROUP ANALYSES**: If subgroup results reported, create separate entries for each subgroup
11. **NO DUPLICATES**: Never create duplicate entries - each unique metric/test set combination should appear only once

DOCUMENT ANALYSIS SUMMARY:
"""${summary}"""

ORIGINAL JOURNAL ARTICLE TEXT (for precise detail extraction):
"""${originalText.substring(0, 8000)}"""

EXTRACTION INSTRUCTIONS:
- Mine ALL numerical data (performance metrics, dataset sizes, technical specs)
- Extract complete methodology details for reproducibility
- Capture regulatory, ethical, and clinical deployment information
- Include ALL limitations, biases, and generalizability concerns
- Map journal-specific terminology to ROADMAP standard fields
- Preserve exact naming conventions and abbreviations from the paper
- Include version information and temporal details where available
- **AVOID DUPLICATES**: Before creating new entries, check if similar information already exists and consolidate instead of duplicating
- **RESULTS ARRAY**: Create individual entries for each metric - if paper reports "AUC=0.95, Sensitivity=92%, Specificity=88%" create 3 separate Result objects
- **MULTIPLE TEST SETS**: If tested on internal + external sets, create separate entries for each
- **SUBGROUP RESULTS**: If results broken down by demographics/subgroups, create separate entries
- **METHOD ARRAY**: Create separate entries for Architecture, Training, Preprocessing, Validation - each as individual Method objects
- **DEDUPLICATION**: Never create duplicate entries - consolidate similar information into single entries with comprehensive details

CRITICAL DEDUPLICATION REQUIREMENT:
- Review all array entries (Results, Method) before finalizing
- Consolidate duplicate or highly similar entries into single comprehensive entries
- Each unique metric/test set combination should appear only once
- Each unique methodological aspect should appear only once

Return ONLY valid JSON in this exact ROADMAP format:
${classification.type === 'MODEL' ? ENHANCED_MODEL_JSON_TEMPLATE : ENHANCED_DATASET_JSON_TEMPLATE}

COMPREHENSIVE JSON OUTPUT:`;

    const response = await callGeminiAPI(geminiApiUrl, prompt, { 
      temperature: 0.1, 
      maxOutputTokens: 3000 
    });

    if (response) {
      try {
        const cleanResponse = response.replace(/```json\n?|\n?```/g, '').trim();
        const parsed = JSON.parse(cleanResponse);
        
        if ((classification.type === 'MODEL' && parsed.Model) || 
            (classification.type === 'DATASET' && parsed.Dataset)) {
          console.log('✅ Stage 3 complete - ROADMAP format extracted');
          return parsed;
        } else {
          console.error('❌ Invalid structure in Stage 3 response');
          return null;
        }
      } catch (parseError) {
        console.error('❌ JSON parsing failed in Stage 3:', parseError.message);
        return null;
      }
    }
    return null;

  } catch (error) {
    console.error('❌ Stage 3 error:', error.message);
    return null;
  }
}

// Helper function to call Gemini API
async function callGeminiAPI(url, prompt, config = {}) {
  try {
    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: config.temperature || 0.2,
        maxOutputTokens: config.maxOutputTokens || 2000,
        topK: 40,
        topP: 0.95
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      console.error('❌ Gemini API error:', response.status);
      return null;
    }

    const result = await response.json();
    return result.candidates?.[0]?.content?.parts?.[0]?.text || null;

  } catch (error) {
    console.error('❌ Gemini API call failed:', error.message);
    return null;
  }
}

// Enhanced prompt templates for radiology AI journal articles
const ENHANCED_MODEL_EXTRACTION_PROMPT = `Extract COMPREHENSIVE MODEL information from this radiology AI journal article:

**CORE IDENTIFICATION:**
- Name: Full model name, abbreviations, and any version identifiers
- Comments: Complete technical description including architecture details, novelty, and clinical significance
- Version: Model version, iteration, or development stage if mentioned

**CLINICAL APPLICATION:**
- Use → Intended: ALL mentioned clinical applications, imaging tasks, and use cases
- Use → Clinical Setting: Screening, diagnosis, monitoring, treatment planning
- Target Anatomy: Specific organs, body regions, or anatomical structures
- Imaging Modality: CT, MRI, X-ray, ultrasound, mammography, etc.
- Disease Focus: Specific conditions, pathologies, or abnormalities targeted

**USER SPECIFICATIONS:**
- User → Intended: Complete list of intended users (radiologists, residents, technologists, clinicians, etc.)
- User → Experience Level: Required expertise level or training
- Clinical Workflow: Integration points in radiological workflow

**TECHNICAL SPECIFICATIONS:**
- Input: Detailed input requirements (image formats, resolution, preprocessing)
- Output: Complete output description (classifications, scores, visualizations)
- Method: CREATE SEPARATE ENTRIES for different methodological aspects:
  * One entry for Architecture (neural network design, layers, components)
  * One entry for Training (methodology, loss function, optimization)
  * One entry for Data Preprocessing (augmentation, normalization, preprocessing)
  * One entry for Validation (cross-validation, test methodology)
  * Additional entries for other methodological components as needed
  * CONSOLIDATE DUPLICATES: If multiple mentions of same methodological aspect, merge into single comprehensive entry

**PERFORMANCE ANALYSIS - CRITICAL: INDIVIDUAL METRIC ENTRIES:**
- Results: CREATE ONE SEPARATE ENTRY FOR EACH INDIVIDUAL METRIC
  * MANDATORY: One dedicated entry for each metric using EXACT ROADMAP schema names:
    - "Area under the receiver operating characteristic curve" (for AUC)
    - "Sensitivity" (for sensitivity/recall)
    - "Specificity" (for specificity)
    - "Accuracy" (for accuracy)
    - "Precision" (for precision)
    - "Recall" (for recall/sensitivity)
  * MULTIPLE TEST SETS: Create separate entries for each test set (e.g., "AUC - Internal Test", "AUC - External Test")
  * SUBGROUP ANALYSES: Create separate entries for each subgroup (e.g., "Sensitivity - Men", "Sensitivity - Women")
  * COMPARISON STUDIES: Create separate entries for comparisons (e.g., "Specificity - Model", "Specificity - Radiologists")
  * READER STUDIES: Create separate entries for each reader or reader group
  * EACH ENTRY MUST INCLUDE: Exact value, confidence interval, p-value, test set description
  * EXAMPLE: If paper reports AUC=0.95, Sensitivity=92%, Specificity=88% → CREATE 3 SEPARATE ENTRIES
  * USE EXACT METRIC NAMES from ROADMAP schema: "Area under the receiver operating characteristic curve", "Sensitivity", "Specificity"
  * NO DUPLICATES: Each unique metric+test set combination should appear only once - consolidate multiple mentions into single comprehensive entry
- Validation: Cross-validation methodology, test set characteristics
- Clinical Validation: Prospective studies, reader studies, clinical trials

**DEPLOYMENT & REQUIREMENTS:**
- Required Processor: Hardware specifications, GPU requirements, processing time
- Software: Dependencies, frameworks, compatibility requirements
- Integration: PACS integration, EMR connectivity, workflow requirements

**LIMITATIONS & CONSIDERATIONS:**
- Limitations: ALL stated limitations, failure modes, edge cases
- Bias: Demographic, institutional, or technical biases identified
- Generalizability: Population, institutional, or technical generalizability concerns
- Regulatory: FDA status, CE marking, or regulatory pathway mentioned
- Ethical: Fairness, bias mitigation, ethical considerations`;

const ENHANCED_DATASET_EXTRACTION_PROMPT = `Extract COMPREHENSIVE DATASET information from this radiology AI journal article:

**CORE IDENTIFICATION:**
- Name: Complete dataset/database name, abbreviations, and versions
- Comments: Comprehensive description including purpose, scope, and clinical significance
- Version: Dataset version, updates, or release information

**DATA COMPOSITION:**
- Composition → Number of instances: Exact counts (images, patients, studies, cases)
- Composition → Data type: All data types (images, annotations, metadata, clinical data)
- Demographics: Age distributions, gender ratios, population characteristics
- Disease Distribution: Case types, pathology prevalence, severity distributions
- Temporal: Collection period, longitudinal follow-up if applicable

**IMAGING SPECIFICATIONS:**
- Imaging → File format: All formats (DICOM, JPEG, PNG, NIfTI, etc.)
- Imaging → Resolution: Spatial resolution, bit depth, matrix sizes
- Imaging → Modality: Specific imaging techniques and parameters
- Acquisition: Scanner types, imaging protocols, technical parameters
- Quality: Image quality criteria, exclusion criteria

**DATA COLLECTION:**
- Collection process: Detailed methodology for data acquisition
- Sources: Contributing institutions, multi-center vs single-center
- Time period: Data collection timeline and duration
- Inclusion/Exclusion: Patient selection criteria and exclusion rules
- IRB/Ethics: Ethical approval and consent processes

**ANNOTATION & LABELING:**
- Labeling: Complete annotation methodology and guidelines
- Ground Truth: Gold standard establishment and expert consensus
- Inter-reader: Agreement metrics, kappa values, consensus processes
- Quality Control: Annotation validation and quality assurance
- Annotation Tools: Software and platforms used for labeling

**ACCESS & USAGE:**
- License → Text: Complete licensing terms, usage rights, and restrictions
- Availability: Public/private access, download procedures
- Citation: Required citation and acknowledgment information
- Updates: Maintenance schedule and update policies

**TECHNICAL DETAILS:**
- Storage: Data storage format, organization, and structure
- Privacy: De-identification procedures and privacy protections
- Validation: Dataset validation and integrity checks
- Benchmarking: Baseline results, benchmark tasks, evaluation metrics

**CLINICAL RELEVANCE:**
- Clinical Application: Intended research applications and clinical uses
- Validation Studies: Studies using this dataset for validation
- Impact: Clinical impact and research contributions enabled`;

const ENHANCED_MODEL_JSON_TEMPLATE = `{
  "Model": {
    "Name": "complete model name with versions",
    "Comments": "comprehensive technical description including architecture, novelty, and clinical significance",
    "Version": "version or development stage",
    "Use": {
      "Intended": ["clinical application 1", "imaging task 2", "diagnostic use case 3"],
      "Clinical Setting": ["screening", "diagnosis", "monitoring"],
      "Target Anatomy": ["organ/region 1", "anatomical structure 2"],
      "Imaging Modality": ["CT", "MRI", "X-ray", "ultrasound"],
      "Disease Focus": ["condition 1", "pathology 2"]
    },
    "User": {
      "Intended": ["radiologists", "residents", "technologists", "clinicians"],
      "Experience Level": "required expertise level",
      "Clinical Workflow": "workflow integration points"
    },
    "Input": "detailed input requirements with formats and preprocessing",
    "Output": "comprehensive output description with formats and interpretations",
    "Method": [
      {
        "Type": "Architecture",
        "Description": "Neural network architecture (e.g., U-Net, ResNet-50, ensemble)",
        "Details": "Specific architectural components and modifications"
      },
      {
        "Type": "Training", 
        "Description": "Training methodology and approach",
        "Details": "Loss function, optimizer, learning rate, epochs, etc."
      },
      {
        "Type": "Data Preprocessing",
        "Description": "Image preprocessing and augmentation",
        "Details": "Normalization, augmentation techniques, preprocessing steps"
      }
    ],
    "Results": [
      {
        "Metric": ["Area under the receiver operating characteristic curve"],
        "Value": "exact performance values with confidence intervals",
        "Result Information": "detailed performance analysis with statistical significance",
        "Comparison": "comparison with radiologists or existing methods",
        "Subgroup Analysis": "performance variations across subgroups"
      }
    ],
    "Validation": {
      "Method": "cross-validation methodology",
      "Test Set": "test set characteristics",
      "Clinical Studies": "prospective studies or reader studies"
    },
    "Required processor": "hardware specifications and processing requirements",
    "Software": "dependencies, frameworks, and compatibility",
    "Integration": "PACS, EMR, and workflow integration requirements",
    "Limitations": "comprehensive limitations including failure modes and edge cases",
    "Bias": "demographic, institutional, or technical biases identified",
    "Generalizability": "population and institutional generalizability concerns",
    "Regulatory": "FDA status, CE marking, or regulatory pathway",
    "Ethical": "fairness, bias mitigation, and ethical considerations"
  }
}`;

const ENHANCED_DATASET_JSON_TEMPLATE = `{
  "Dataset": {
    "Name": "complete dataset name with versions",
    "Comments": "comprehensive description including purpose, scope, and clinical significance",
    "Version": "dataset version or release information",
    "Composition": {
      "Number of instances": "exact counts: images, patients, studies, cases",
      "Data type": ["Image", "Annotation", "Metadata", "Clinical data"],
      "Demographics": "age distributions, gender ratios, population characteristics",
      "Disease Distribution": "case types, pathology prevalence, severity distributions",
      "Temporal": "collection period and longitudinal follow-up"
    },
    "Imaging": {
      "File format": ["DICOM", "JPEG", "PNG", "NIfTI"],
      "Resolution": "spatial resolution, bit depth, matrix sizes",
      "Modality": "specific imaging techniques and parameters",
      "Acquisition": "scanner types, imaging protocols, technical parameters",
      "Quality": "image quality criteria and exclusion criteria"
    },
    "Collection process": {
      "Methodology": "detailed data acquisition methodology",
      "Sources": "contributing institutions, multi-center vs single-center",
      "Time period": "data collection timeline and duration",
      "Inclusion Exclusion": "patient selection and exclusion criteria",
      "IRB Ethics": "ethical approval and consent processes"
    },
    "Labeling": {
      "Methodology": "complete annotation methodology and guidelines",
      "Ground Truth": "gold standard establishment and expert consensus",
      "Inter-reader": "agreement metrics, kappa values, consensus processes",
      "Quality Control": "annotation validation and quality assurance",
      "Annotation Tools": "software and platforms used for labeling"
    },
    "License": {
      "Text": "complete licensing terms, usage rights, and restrictions",
      "Availability": "public/private access and download procedures",
      "Citation": "required citation and acknowledgment information",
      "Updates": "maintenance schedule and update policies"
    },
    "Technical": {
      "Storage": "data storage format, organization, and structure",
      "Privacy": "de-identification procedures and privacy protections",
      "Validation": "dataset validation and integrity checks",
      "Benchmarking": "baseline results, benchmark tasks, evaluation metrics"
    },
    "Clinical": {
      "Application": "intended research applications and clinical uses",
      "Validation Studies": "studies using this dataset for validation",
      "Impact": "clinical impact and research contributions enabled"
    }
  }
}`;

// Legacy single-stage processing (kept for backward compatibility)
async function processTextWithGemini(extractedText) {
  console.log('⚠️ Using legacy single-stage processing. Consider using multi-stage pipeline for better results.');
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
    if (!apiKey) {
      console.error('❌ No Gemini API key found');
      return null;
    }

    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
    
    // Load actual ROADMAP schemas for more accurate processing
    let modelSchema, datasetSchema;
    try {
      const [modelContent, datasetContent] = await Promise.all([
        fs.readFile('./schemas/base-model-schema.json', 'utf8'),
        fs.readFile('./schemas/base-dataset-schema.json', 'utf8')
      ]);
      modelSchema = JSON.parse(modelContent);
      datasetSchema = JSON.parse(datasetContent);
      console.log('✅ ROADMAP schemas loaded for enhanced processing');
    } catch (schemaError) {
      console.log('⚠️ Could not load schemas, using enhanced templates');
    }

    const prompt = `You are an expert radiologist and AI researcher specialized in extracting comprehensive information from published radiology AI journal articles to populate ROADMAP (Radiology Ontology for AI Models, Datasets and Projects) cards.

TASK: Analyze this radiology AI journal article and determine if it describes an AI MODEL or a DATASET, then extract ALL available information with maximum accuracy and completeness.

RADIOLOGY AI JOURNAL ANALYSIS INSTRUCTIONS:
1. READ the entire article text with expert clinical and technical understanding
2. DETERMINE primary contribution: MODEL (AI/ML algorithm) or DATASET (data collection)
3. EXTRACT comprehensive information using the enhanced schema templates below
4. RETURN valid JSON with complete field population
5. PRIORITIZE accuracy and completeness over brevity
6. INCLUDE exact numerical values, percentages, and measurements
7. CAPTURE methodology details for reproducibility
8. NOTE regulatory, ethical, and clinical deployment aspects

ENHANCED MODEL STRUCTURE (use if AI model/algorithm):
${ENHANCED_MODEL_JSON_TEMPLATE}

ENHANCED DATASET STRUCTURE (use if dataset/database):
${ENHANCED_DATASET_JSON_TEMPLATE}

RADIOLOGY AI JOURNAL ARTICLE TEXT:
"""${extractedText}"""

COMPREHENSIVE EXTRACTION OUTPUT (JSON only):`;

    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { 
        temperature: 0.2, 
        maxOutputTokens: 4096,
        topK: 40,
        topP: 0.95
      },
      safetySettings: [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        }
      ]
    };

    console.log('📤 Sending to Gemini API...');
    const geminiResponse = await fetch(geminiApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.text();
      console.error('❌ Gemini API error:', errorData.substring(0, 200));
      return null;
    }

    const result = await geminiResponse.json();
    console.log('📥 Received response from Gemini');
    
    if (!result.candidates || !result.candidates[0] || !result.candidates[0].content) {
      console.error('❌ Invalid Gemini response structure');
      return null;
    }

    const responseText = result.candidates[0].content.parts[0].text || '';
    console.log('📋 Raw response length:', responseText.length);
    
    // Clean up the response
    const cleanResponse = responseText
      .replace(/```json\n?|\n?```/g, '')
      .replace(/```\n?|\n?```/g, '')
      .trim();
    
    console.log('🧹 Cleaned response preview:', cleanResponse.substring(0, 200));
    
    try {
      const parsed = JSON.parse(cleanResponse);
      
      // Validate response structure
      if (!parsed.Model && !parsed.Dataset) {
        console.error('❌ Invalid structure - missing Model or Dataset key');
        return null;
      }
      
      console.log('✅ Successfully parsed and validated JSON');
      return parsed;
      
    } catch (parseError) {
      console.error('❌ JSON parsing failed:', parseError.message);
      console.log('📋 Problematic response:', cleanResponse.substring(0, 500));
      return null;
    }
    
  } catch (error) {
    console.error('❌ processTextWithGemini error:', error.message);
    return null;
  }
}

// Generate mock data using real Gemini API with proper ROADMAP schema
async function generateMockWithGemini() {
  try {
    const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
    
    const mockText = `
    We developed ResNet-COVID, a deep convolutional neural network for COVID-19 detection in chest CT scans. 
    The model was trained on 15,000 CT images from 3 medical centers and achieved 97.2% accuracy, 94.1% sensitivity, 
    and 98.7% specificity. Training took 72 hours on 4 Tesla V100 GPUs. The model processes DICOM images at 512x512 resolution.
    Intended users include radiologists and emergency physicians. The model is intended for screening COVID-19 in emergency departments.
    Limitations include potential bias toward the training population and reduced performance on low-quality images.
    `;
    
    const prompt = `You are an expert AI system specialized in extracting structured information from medical imaging research text to populate ROADMAP (Radiology Ontology for AI Models, Datasets and Projects) Model Cards.

TASK: Extract information from the following text and format it according to the EXACT ROADMAP Model Card schema structure.

CRITICAL REQUIREMENTS:
- Return ONLY valid JSON (no markdown, no explanations)
- Use exact field names from ROADMAP schema (case-sensitive)
- Follow proper nesting structure as shown below
- Include required fields even if empty
- Use appropriate data types (string, number, array, object)

EXACT ROADMAP MODEL SCHEMA FORMAT:
{
  "Model": {
    "Name": "string - model name",
    "Comments": "string - description and technical details",
    "Use": {
      "Intended": ["array of intended use cases"]
    },
    "User": {
      "Intended": ["array of intended users"]
    },
    "Input": "string - input format/type",
    "Output": "string - output format/type", 
    "Results": [
      {
        "Metric": ["Area under the receiver operating characteristic curve"],
        "Value": "exact value with confidence interval (e.g., 0.95 (95% CI: 0.92-0.98))",
        "Result Information": "detailed description of this specific metric",
        "Test Set": "which test set or validation approach",
        "Statistical Significance": "p-value or significance test results"
      }
    ],
    "Limitations": "string - model limitations",
    "Method": "string - methodology/architecture",
    "Required processor": "string - hardware requirements"
  }
}

TEXT TO EXTRACT FROM:
"${mockText}"

OUTPUT (JSON only):`;

    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 2000 }
    };

    console.log('🧠 Sending enhanced prompt to Gemini for proper ROADMAP format...');
    const geminiResponse = await fetch(geminiApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (geminiResponse.ok) {
      const result = await geminiResponse.json();
      const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text || '';
      console.log('📋 Raw Gemini response:', responseText.substring(0, 500));
      
      const cleanResponse = responseText.replace(/```json\n?|\n?```/g, '').replace(/```\n?|\n?```/g, '').trim();
      console.log('🧹 Cleaned response:', cleanResponse.substring(0, 300));
      
      try {
        const parsed = JSON.parse(cleanResponse);
        console.log('✅ Successfully parsed ROADMAP format JSON');
        return parsed;
      } catch (parseError) {
        console.error('❌ JSON parsing failed:', parseError.message);
        console.log('🔄 Using fallback mock data');
        return createFallbackMock();
      }
    }
    
    return createFallbackMock();
  } catch (error) {
    console.log('❌ Gemini mock generation failed:', error.message);
    console.log('🔄 Using static fallback mock');
    return createFallbackMock();
  }
}

function createFallbackMock() {
  return {
    "Model": {
      "Name": "ResNet-COVID",
      "Comments": "Deep convolutional neural network for COVID-19 detection in chest CT scans. Trained on 15,000 CT images from 3 medical centers over 72 hours on 4 Tesla V100 GPUs.",
      "Use": {
        "Intended": ["COVID-19 detection", "chest CT screening", "emergency department screening"]
      },
      "User": {
        "Intended": ["radiologists", "emergency physicians"]
      },
      "Input": "DICOM chest CT images at 512x512 resolution",
      "Output": "COVID-19 detection classification",
      "Results": [
        {
          "Metric": ["Accuracy"],
          "Value": "97.2%",
          "Result Information": "97.2% accuracy, 94.1% sensitivity, 98.7% specificity on COVID-19 detection from 15,000 CT images"
        }
      ],
      "Limitations": "Potential bias toward training population, reduced performance on low-quality images",
      "Method": "Deep convolutional neural network (ResNet architecture)",
      "Required processor": "4 Tesla V100 GPUs for training, standard GPU for inference"
    }
  };
}

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Simple test server running at http://localhost:${PORT}`);
  console.log('✅ Frontend: Available');
  console.log('✅ API: /api/test-gemini - Test Gemini connection');
  console.log('✅ API: /api/process-pdf - Mock PDF processing');
  console.log('\nTest steps:');
  console.log('1. Open browser: http://localhost:3000');
  console.log('2. Test Gemini: http://localhost:3000/api/test-gemini (POST)');
  console.log('3. Try PDF upload - should populate form with mock data');
});