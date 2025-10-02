// api/process-pdf.js
import { IncomingForm } from 'formidable';
import { promises as fs } from 'fs';
import path from 'path';
import { DocumentProcessorServiceClient } from '@google-cloud/documentai';

// This disables the default body parser to allow formidable to handle the file stream
export const config = {
  api: {
    bodyParser: false,
  },
};

// Recursive function to sanitize stringified JSON objects in API responses
function sanitizeStringifiedJson(obj) {
  // Handle null, undefined, or primitive types
  if (obj === null || obj === undefined || typeof obj !== 'object') {
    return obj;
  }
  
  // Handle arrays
  if (Array.isArray(obj)) {
    return obj.map(item => {
      // If array item is a string that looks like JSON, try to parse it
      if (typeof item === 'string') {
        const trimmed = item.trim();
        if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
            (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
          try {
            const parsed = JSON.parse(trimmed);
            // Recursively sanitize the parsed object
            return sanitizeStringifiedJson(parsed);
          } catch (e) {
            // If parsing fails, return the original string
            console.log('📝 Note: String looks like JSON but failed to parse:', trimmed.substring(0, 100));
            return item;
          }
        }
      }
      // Recursively process non-string items
      return sanitizeStringifiedJson(item);
    });
  }
  
  // Handle objects
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      const trimmed = value.trim();
      // Check if string looks like JSON (starts with { or [ and ends with } or ])
      if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || 
          (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
        try {
          const parsed = JSON.parse(trimmed);
          // Recursively sanitize the parsed object
          result[key] = sanitizeStringifiedJson(parsed);
          console.log(`✅ Successfully parsed stringified JSON for key: ${key}`);
        } catch (e) {
          // If parsing fails, keep the original string
          console.log(`📝 Note: Key "${key}" has string that looks like JSON but failed to parse:`, trimmed.substring(0, 100));
          result[key] = value;
        }
      } else {
        // Regular string, keep as is
        result[key] = value;
      }
    } else if (typeof value === 'object') {
      // Recursively process nested objects/arrays
      result[key] = sanitizeStringifiedJson(value);
    } else {
      // Primitive types (number, boolean, etc.)
      result[key] = value;
    }
  }
  
  return result;
}

// Helper function to extract text from Document AI text anchors
function getText(textAnchor, text) {
  if (!textAnchor || !textAnchor.textSegments || !text) {
    return '';
  }
  
  let extractedText = '';
  textAnchor.textSegments.forEach(segment => {
    const startIndex = parseInt(segment.startIndex) || 0;
    const endIndex = parseInt(segment.endIndex) || text.length;
    extractedText += text.substring(startIndex, endIndex);
  });
  
  return extractedText.trim();
}

// Helper function to check if two bounding boxes overlap significantly
function boundingBoxesOverlap(box1, box2, overlapThreshold = 0.3) {
  if (!box1?.vertices || !box2?.vertices) return false;
  
  // Extract coordinates from vertices
  const getBoxCoords = (box) => {
    const xs = box.vertices.map(v => v.x || 0);
    const ys = box.vertices.map(v => v.y || 0);
    return {
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys)
    };
  };
  
  const coords1 = getBoxCoords(box1);
  const coords2 = getBoxCoords(box2);
  
  // Calculate intersection area
  const intersectionLeft = Math.max(coords1.left, coords2.left);
  const intersectionRight = Math.min(coords1.right, coords2.right);
  const intersectionTop = Math.max(coords1.top, coords2.top);
  const intersectionBottom = Math.min(coords1.bottom, coords2.bottom);
  
  // No intersection if coordinates don't overlap
  if (intersectionLeft >= intersectionRight || intersectionTop >= intersectionBottom) {
    return false;
  }
  
  const intersectionArea = (intersectionRight - intersectionLeft) * (intersectionBottom - intersectionTop);
  const box1Area = (coords1.right - coords1.left) * (coords1.bottom - coords1.top);
  const box2Area = (coords2.right - coords2.left) * (coords2.bottom - coords2.top);
  
  // Check if intersection area is significant relative to either box
  const overlapRatio1 = intersectionArea / box1Area;
  const overlapRatio2 = intersectionArea / box2Area;
  
  return overlapRatio1 > overlapThreshold || overlapRatio2 > overlapThreshold;
}

// Function to filter out tables that are actually part of images/figures
function filterIncorrectTables(tables, images, pageIndex) {
  const filteredTables = [];
  
  for (const table of tables) {
    let isValidTable = true;
    
    // Check 1: Giant cell filter - tables with single cells containing excessive text
    if (table.rows.length === 1 && table.rows[0].length === 1) {
      const singleCellText = table.rows[0][0] || '';
      if (singleCellText.length > 500) {
        console.log(`🚫 Page ${pageIndex + 1}: Discarding giant single-cell table (${singleCellText.length} chars)`);
        isValidTable = false;
      }
    }
    
    // Check 2: Bounding box overlap with images
    if (isValidTable && table.boundingPoly) {
      for (const image of images) {
        if (image.bounds && boundingBoxesOverlap(table.boundingPoly, image.bounds)) {
          console.log(`🚫 Page ${pageIndex + 1}: Discarding table overlapping with image`);
          isValidTable = false;
          break;
        }
      }
    }
    
    if (isValidTable) {
      filteredTables.push(table);
    }
  }
  
  console.log(`📊 Page ${pageIndex + 1}: Filtered tables from ${tables.length} to ${filteredTables.length}`);
  return filteredTables;
}

// Function to find images referenced in the text
function findReferencedImages(text, images) {
  const referencedImages = [];
  
  // Common figure reference patterns
  const figurePatterns = [
    /Figure\s+(\d+)/gi,
    /Fig\.\s*(\d+)/gi,
    /Chart\s+(\d+)/gi,
    /Graph\s+(\d+)/gi,
    /Diagram\s+(\d+)/gi,
    /Image\s+(\d+)/gi
  ];
  
  const referencedNumbers = new Set();
  
  // Find all figure numbers mentioned in text
  figurePatterns.forEach(pattern => {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      referencedNumbers.add(parseInt(match[1]));
    }
  });
  
  console.log('📊 Figure references found in text:', Array.from(referencedNumbers).sort());
  
  // Match referenced numbers to available images
  // For now, select first few images as most papers start with Figure 1, 2, etc.
  const maxImages = Math.min(3, images.length); // Limit to 3 images max
  
  images.slice(0, maxImages).forEach((image, index) => {
    // Assign figure numbers based on order if not detected
    const figureNumber = index + 1;
    if (referencedNumbers.has(figureNumber) || referencedNumbers.size === 0) {
      referencedImages.push({
        ...image,
        figureNumber: figureNumber,
        referenced: referencedNumbers.has(figureNumber)
      });
    }
  });
  
  return referencedImages;
}

// Function to load and parse schema files
// GitHub URLs for latest ROADMAP schemas (same as frontend)
const GITHUB_SCHEMAS = {
  model: 'https://raw.githubusercontent.com/cekahn/ROADMAP/main/ROADMAP.model.json',
  dataset: 'https://raw.githubusercontent.com/cekahn/ROADMAP/main/ROADMAP.dataset.json'
};

// In-memory cache for schemas (persists during API lifetime)
let schemaCache = null;
let schemaCacheTime = null;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Loads ROADMAP schemas from GitHub
 * Uses in-memory caching to avoid repeated fetches
 * Note: Local schema files in /schemas are kept for reference but not used
 */
async function loadSchemas() {
  try {
    // Check if we have a valid cached copy
    if (schemaCache && schemaCacheTime && (Date.now() - schemaCacheTime < CACHE_DURATION_MS)) {
      console.log('📦 Using cached schemas');
      return schemaCache;
    }

    console.log('🌐 Fetching schemas from GitHub...');

    // Fetch both schemas in parallel
    const [modelResponse, datasetResponse] = await Promise.all([
      fetch(GITHUB_SCHEMAS.model),
      fetch(GITHUB_SCHEMAS.dataset)
    ]);

    // Check for HTTP errors
    if (!modelResponse.ok) {
      throw new Error(`Failed to fetch model schema: ${modelResponse.status} ${modelResponse.statusText}`);
    }
    if (!datasetResponse.ok) {
      throw new Error(`Failed to fetch dataset schema: ${datasetResponse.status} ${datasetResponse.statusText}`);
    }

    // Parse JSON
    const [modelSchema, datasetSchema] = await Promise.all([
      modelResponse.json(),
      datasetResponse.json()
    ]);

    console.log('✅ Successfully fetched schemas from GitHub');

    // Cache the results
    schemaCache = {
      model: modelSchema,
      dataset: datasetSchema
    };
    schemaCacheTime = Date.now();

    return schemaCache;
  } catch (error) {
    console.error('❌ Error loading schemas from GitHub:', error);
    throw new Error(`Failed to load ROADMAP schemas: ${error.message}`);
  }
}

// Helper function to filter examples for display
function filterExamples(examples) {
  if (!examples || !Array.isArray(examples)) return examples;
  
  // Filter out complex objects/arrays that cause [object Object] display
  return examples.filter(example => {
    if (typeof example === 'string' || typeof example === 'number' || typeof example === 'boolean') {
      return true;
    }
    return false; // Filter out objects and arrays
  });
}

// Function to extract relevant schema structure for LLM
function extractSchemaStructure(schema, schemaType) {
  const mainDef = schema.$defs?.[schemaType];
  if (!mainDef) return null;

  // Extract properties with descriptions, examples, and structure
  const extractProperties = (properties, level = 0) => {
    if (!properties || level > 3) return {}; // Prevent infinite recursion
    
    const result = {};
    for (const [key, value] of Object.entries(properties)) {
      result[key] = {
        type: value.type,
        description: value.description,
        examples: value.examples ? filterExamples(value.examples) : undefined,
        enum: value.enum
      };
      
      // Handle nested objects
      if (value.type === 'object' && value.properties) {
        result[key].properties = extractProperties(value.properties, level + 1);
      }
      
      // Handle arrays
      if (value.type === 'array' && value.items) {
        result[key].items = {
          type: value.items.type,
          examples: value.items.examples ? filterExamples(value.items.examples) : undefined,
          enum: value.items.enum
        };
        
        // Handle array of objects
        if (value.items.properties) {
          result[key].items.properties = extractProperties(value.items.properties, level + 1);
        }
        
        // Handle $ref in array items
        if (value.items.$ref) {
          const refPath = value.items.$ref.replace('#/$defs/', '');
          const refDef = schema.$defs?.[refPath];
          if (refDef?.properties) {
            result[key].items.properties = extractProperties(refDef.properties, level + 1);
          }
          if (refDef?.enum) {
            result[key].items.enum = refDef.enum;
          }
          if (refDef?.examples) {
            result[key].items.examples = filterExamples(refDef.examples);
          }
        }
      }
      
      // Handle $ref at field level
      if (value.$ref) {
        const refPath = value.$ref.replace('#/$defs/', '');
        const refDef = schema.$defs?.[refPath];
        if (refDef) {
          result[key] = {
            ...result[key],
            type: refDef.type,
            description: refDef.description,
            examples: refDef.examples ? filterExamples(refDef.examples) : undefined,
            enum: refDef.enum
          };
          if (refDef.properties) {
            result[key].properties = extractProperties(refDef.properties, level + 1);
          }
        }
      }
    }
    return result;
  };
  
  return extractProperties(mainDef.properties || {});
}

// Function to extract meaningful content from PDF.co JSON response
function extractContentFromPdfJson(pdfData) {
  const result = {
    metadata: {},
    pages: [],
    text_content: "",
    document_structure: []
  };

  try {
    // Extract basic metadata if available
    if (pdfData.info) {
      result.metadata = {
        title: pdfData.info.Title || "",
        author: pdfData.info.Author || "",
        creator: pdfData.info.Creator || "",
        pages: pdfData.pageCount || pdfData.pages?.length || 0
      };
    }

    // Extract text content from pages
    if (pdfData.pages && Array.isArray(pdfData.pages)) {
      pdfData.pages.forEach((page, pageIndex) => {
        const pageContent = {
          page_number: pageIndex + 1,
          text_blocks: [],
          tables: []
        };

        // Extract text blocks (looking for common text properties)
        if (page.text || page.content || page.elements) {
          const textSource = page.text || page.content || page.elements;
          
          if (Array.isArray(textSource)) {
            textSource.forEach(element => {
              if (element.text || element.content || element.str) {
                const text = element.text || element.content || element.str;
                if (text && text.trim().length > 0) {
                  pageContent.text_blocks.push({
                    text: text.trim(),
                    font_size: element.fontSize || element.size || null,
                    font_weight: element.fontWeight || element.bold || null
                  });
                  result.text_content += text.trim() + " ";
                }
              }
            });
          } else if (typeof textSource === 'string') {
            pageContent.text_blocks.push({ text: textSource.trim() });
            result.text_content += textSource.trim() + " ";
          }
        }

        // Extract tables if present
        if (page.tables && Array.isArray(page.tables)) {
          page.tables.forEach(table => {
            if (table.rows) {
              pageContent.tables.push({
                rows: table.rows.map(row => 
                  row.cells ? row.cells.map(cell => cell.text || cell.content || "") : []
                )
              });
            }
          });
        }

        if (pageContent.text_blocks.length > 0 || pageContent.tables.length > 0) {
          result.pages.push(pageContent);
        }
      });
    }

    // If no pages structure, try to extract from root level
    if (result.text_content.trim().length === 0 && pdfData.text) {
      result.text_content = pdfData.text;
    }

    // Create document structure analysis
    const textLines = result.text_content.split('\n').filter(line => line.trim().length > 0);
    textLines.forEach((line, index) => {
      const trimmed = line.trim();
      // Identify potential headers (short lines, all caps, or numbered sections)
      if (trimmed.length < 100 && 
          (trimmed === trimmed.toUpperCase() || 
           /^\d+\.\s/.test(trimmed) || 
           /^[A-Z][A-Z\s]+$/.test(trimmed))) {
        result.document_structure.push({
          type: "potential_header",
          text: trimmed,
          position: index
        });
      }
    });

    console.log('Extracted text blocks:', result.pages.reduce((sum, p) => sum + p.text_blocks.length, 0));
    console.log('Extracted tables:', result.pages.reduce((sum, p) => sum + p.tables.length, 0));
    console.log('Text content length:', result.text_content.length);

    return result;

  } catch (error) {
    console.error('Error extracting content from PDF JSON:', error);
    // Fallback: return the original data but remove obvious bloat
    return {
      text_content: JSON.stringify(pdfData).replace(/("x":\d+\.?\d*)|("y":\d+\.?\d*)|("width":\d+\.?\d*)|("height":\d+\.?\d*)/g, ''),
      metadata: { pages: pdfData.pageCount || 0 },
      pages: [],
      document_structure: []
    };
  }
}

// Helper function to call Gemini API with retry logic
async function callGeminiAPI(url, prompt, config = {}, retryCount = 0) {
  const maxRetries = 3;
  const baseDelay = 1000; // 1 second
  
  try {
    const requestBody = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: config.temperature || 0.2,
        maxOutputTokens: config.maxOutputTokens || 4096,
        topK: 40,
        topP: 0.95
      },
      safetySettings: config.safetySettings || [
        {
          category: "HARM_CATEGORY_HARASSMENT",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          threshold: "BLOCK_MEDIUM_AND_ABOVE"
        }
      ]
    };

    console.log(`📤 Sending request to Gemini API (attempt ${retryCount + 1}/${maxRetries + 1})...`);
    console.log('📝 Prompt length:', prompt.length, 'characters');
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error details');
      console.error('❌ Gemini API error:', response.status, response.statusText);
      console.error('❌ Error details:', errorText.substring(0, 500));
      
      // Retry for 503 (Service Unavailable) and 429 (Rate Limited) errors
      if ((response.status === 503 || response.status === 429) && retryCount < maxRetries) {
        const delay = baseDelay * Math.pow(2, retryCount); // Exponential backoff
        console.log(`🔄 Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return await callGeminiAPI(url, prompt, config, retryCount + 1);
      }
      
      return { error: true, status: response.status, message: errorText };
    }

    const result = await response.json();
    console.log('✅ Gemini API call successful');
    return result;

  } catch (error) {
    console.error('❌ Gemini API call failed:', error.message);
    
    // Retry on network errors
    if (retryCount < maxRetries && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {
      const delay = baseDelay * Math.pow(2, retryCount);
      console.log(`🔄 Network error, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return await callGeminiAPI(url, prompt, config, retryCount + 1);
    }
    
    return { error: true, message: error.message };
  }
}

// Helper function to call Gemini API with multimodal content (text + images)
async function callGeminiAPIMultimodal(url, textPrompt, documentData, config = {}, retryCount = 0) {
  const maxRetries = 3;
  const baseDelay = 1000;
  
  try {
    // Build multimodal content parts
    const contentParts = [];
    
    // Validate text prompt
    if (!textPrompt || typeof textPrompt !== 'string' || textPrompt.trim().length === 0) {
      console.error('❌ Invalid textPrompt for multimodal request:', { textPrompt, type: typeof textPrompt });
      throw new Error('Invalid textPrompt: must be a non-empty string');
    }
    
    // Add the main text prompt
    contentParts.push({ text: textPrompt });
    
    // Add referenced images
    if (documentData.images && documentData.images.length > 0) {
      documentData.images.forEach(image => {
        if (image.base64) {
          contentParts.push({
            text: `\n\nFigure ${image.figureNumber} (Page ${image.page}):`
          });
          contentParts.push({
            inlineData: {
              mimeType: 'image/jpeg',
              data: image.base64
            }
          });
        }
      });
    }

    const requestBody = {
      contents: [{ parts: contentParts }],
      generationConfig: {
        temperature: config.temperature || 0.2,
        maxOutputTokens: config.maxOutputTokens || 4096,
        topK: 40,
        topP: 0.95
      },
      safetySettings: config.safetySettings || []
    };

    console.log(`📤 Sending multimodal request to Gemini API (attempt ${retryCount + 1}/${maxRetries + 1})...`);
    console.log('📝 Text parts:', contentParts.filter(p => p.text).length);
    console.log('🖼️ Image parts:', contentParts.filter(p => p.inlineData).length);
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No error details');
      console.error('❌ Gemini Multimodal API error:', response.status, response.statusText);
      console.error('❌ Error details:', errorText.substring(0, 500));
      
      // Retry for 503 (Service Unavailable) and 429 (Rate Limited) errors
      if ((response.status === 503 || response.status === 429) && retryCount < maxRetries) {
        const delay = baseDelay * Math.pow(2, retryCount);
        console.log(`🔄 Retrying multimodal request in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return await callGeminiAPIMultimodal(url, textPrompt, documentData, config, retryCount + 1);
      }
      
      return { error: true, status: response.status, message: errorText };
    }

    const result = await response.json();
    console.log('✅ Gemini Multimodal API call successful');
    return result;

  } catch (error) {
    console.error('❌ Gemini Multimodal API call failed:', error.message);
    
    if (retryCount < maxRetries && (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT')) {
      const delay = baseDelay * Math.pow(2, retryCount);
      console.log(`🔄 Network error, retrying multimodal request in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return await callGeminiAPIMultimodal(url, textPrompt, documentData, config, retryCount + 1);
    }
    
    return { error: true, message: error.message };
  }
}

// Function to create multimodal prompt with text, tables, and images
function createMultimodalPrompt(documentData, schemas, cardType) {
  console.log('🔍 createMultimodalPrompt called with cardType:', cardType);

  const cardTypeUpper = cardType.toUpperCase();

  // Generate example structure from dynamic schema
  const exampleStructure = generateExampleFromSchema(schemas[cardType], cardType);
  const exampleJson = JSON.stringify(exampleStructure, null, 2);

  return `You are an expert AI system specializing in extracting structured information from medical imaging research papers for ROADMAP ${cardTypeUpper} cards.

**TASK:** Extract information for a ${cardTypeUpper} card in valid JSON format.

**CRITICAL INSTRUCTIONS:**
• Extract ALL authors with affiliations - do not summarize
• For datasets: Convert patient demographics/characteristics tables into detailed Subset objects
• **TABLE DATA PRIORITY**: Look specifically for labels, classifications, metrics, performance data, demographic breakdowns, and statistical measures in ALL tables
• **METRICS EXTRACTION**: Extract accuracy, sensitivity, specificity, AUC, F1-scores, sample sizes, age ranges, gender distributions, and any classification categories
• **LABEL MAPPING**: If tables contain label categories, class distributions, or annotation schemes, extract these comprehensively
• Extract exact numerical values and statistical measures - never summarize or approximate
• Include publication details, performance metrics, and technical specifications
• Output must be valid JSON with proper ROADMAP structure

**REQUIRED JSON STRUCTURE:**
${exampleJson}

**DOCUMENT TEXT:**
"""${documentData.text.substring(0, 15000)}"""

**TABLES:**
${JSON.stringify(documentData.tables, null, 2)}

**OUTPUT (Valid JSON only):**`;
}

// STEP 1: Function to create extraction prompt - focuses solely on extracting information
function createExtractionPrompt(documentData, processingMode = 'multimodal') {
  const basePrompt = `You are an expert data extraction specialist for medical imaging research papers. Your task is to thoroughly analyze the provided document content and extract ALL key information in a structured, human-readable format.

ANALYSIS TASK:
Examine the document content (text + tables${processingMode === 'multimodal' ? ' + figures' : ''}) and create a comprehensive structured summary of ALL information that would be relevant for creating either a Model Card or Dataset Card for ROADMAP (Radiology Ontology for AI Models, Datasets and Projects).

EXTRACTION INSTRUCTIONS:
1. First determine if this describes a MODEL (AI/ML algorithm) or DATASET (collection of medical images/data)
2. Extract ALL relevant information systematically - do NOT summarize or skip details
3. For tables: Provide complete table contents, not summaries
4. For figures: Describe what they show and their relevance${processingMode === 'multimodal' ? ' (visual content will be provided)' : ''}
5. Include specific metrics, numbers, dates, and technical details
6. Capture author information, affiliations, and publication details
7. Extract performance metrics, evaluation methods, and statistical results
8. Note any limitations, ethical considerations, or usage restrictions mentioned

OUTPUT STRUCTURE:
Organize your findings into these sections:

DOCUMENT TYPE: [MODEL or DATASET]

IDENTIFICATION:
- Name/Title: [Full name or title]
- Authors: [Complete author list with affiliations]
- Publication: [Journal, conference, date, DOI if available]
- Version/Release: [Any version information]

CORE DESCRIPTION:
- Purpose: [What it's designed for]
- Target Domain: [Specific medical imaging area]
- Key Innovation: [What makes it novel or significant]

TECHNICAL DETAILS:
- Architecture/Methodology: [Detailed technical approach]
- Data Requirements: [Input specifications, format requirements]
- Performance Metrics: [Complete results from all tables and evaluations]
- Validation Methods: [How it was tested/validated]

DATASETS USED/PROVIDED:
- Training Data: [Complete details of datasets used]
- Test Data: [Evaluation datasets]
- Data Characteristics: [Size, demographics, imaging modalities, etc.]

IMPLEMENTATION:
- Software/Frameworks: [Technical implementation details]
- Hardware Requirements: [Computational requirements]
- Availability: [Where to access, licensing, etc.]

EVALUATION RESULTS:
- Primary Results: [Main performance findings]
- Detailed Table Data: [Complete extraction of all numerical results]
- Comparative Analysis: [How it compares to other methods]
- Statistical Analysis: [P-values, confidence intervals, etc.]

LIMITATIONS & CONSIDERATIONS:
- Known Limitations: [Acknowledged weaknesses]
- Ethical Considerations: [Bias, fairness, privacy concerns]
- Usage Guidelines: [Recommended and prohibited uses]

ADDITIONAL INFORMATION:
- Funding Sources: [Grant information, support]
- Code/Data Availability: [GitHub links, data repositories]
- Related Work: [Key references, prior work]

DOCUMENT CONTENT TO ANALYZE:

TEXT CONTENT:
"""${documentData.text.substring(0, processingMode === 'text-only' ? 20000 : 15000)}${documentData.text.length > (processingMode === 'text-only' ? 20000 : 15000) ? '\n\n... [text continues but truncated for processing]' : ''}"""

STRUCTURED TABLES (${documentData.tables.length} tables found):
${documentData.tables.length > 0 ? 
  documentData.tables.map((table, idx) => 
    `TABLE ${idx + 1} (Page ${table.page}):\nHeaders: ${JSON.stringify(table.headers)}\nRows: ${JSON.stringify(table.rows)}`
  ).join('\n\n') : 'No tables found in document'}

${processingMode === 'multimodal' ? `
REFERENCED FIGURES (${documentData.images.length} selected):
${documentData.images.length > 0 ? 
  documentData.images.map(img => `- Figure ${img.figureNumber} (Page ${img.page}) - ${img.referenced ? 'Referenced in text' : 'Available'}`).join('\n') 
  : 'No figures available'}

Note: Visual content (charts, diagrams, images) will be provided as additional input for analysis.
` : `
PROCESSING MODE: Text-only (images excluded)
`}

METADATA:
- Filename: ${documentData.metadata.filename}
- Text length: ${documentData.metadata.text_length} characters
- Tables extracted: ${documentData.metadata.tables_count}
${processingMode === 'multimodal' ? `- Images selected: ${documentData.metadata.images_count}` : ''}

IMPORTANT: Extract ALL information thoroughly. Do not summarize tables - provide complete data. This structured summary will be used in a second step to create the final ROADMAP JSON format.

OUTPUT (Structured text summary):`;

  return basePrompt;
}

// STEP 2: Function to create formatting prompt - focuses solely on JSON formatting
function createFormattingPrompt(extractedInformation, schemas) {
  const modelStructure = extractSchemaStructure(schemas.model, 'model');
  const datasetStructure = extractSchemaStructure(schemas.dataset, 'dataset');
  
  return `You are an expert JSON formatting specialist. Your task is to take a pre-extracted structured summary of information and format it perfectly into the ROADMAP JSON schema format.

FORMATTING TASK:
Take the provided structured information summary and convert it into a valid ROADMAP JSON object following the exact schema specifications.

FORMATTING INSTRUCTIONS:
1. CRITICAL: The JSON MUST have either "Model" or "Dataset" as the TOP-LEVEL key based on the document type
2. Use the document type identified in the summary (MODEL or DATASET) 
3. Map ALL extracted information to the appropriate schema fields
4. Follow exact field names and data types as specified in the schema
5. Use proper JSON formatting with correct nesting structure
6. Fill in as many fields as possible from the extracted information
7. Set empty strings "" for text fields without information
8. Set empty arrays [] for array fields without information
9. Use appropriate default values for required fields
10. Maintain all numerical precision from the extracted data
11. Preserve all technical details and performance metrics

SCHEMA STRUCTURES:

MODEL SCHEMA:
${JSON.stringify(modelStructure, null, 2)}

DATASET SCHEMA:
${JSON.stringify(datasetStructure, null, 2)}

CRITICAL FORMATTING REQUIREMENTS:
- Return ONLY valid JSON (no markdown, no explanations, no additional text)
- MUST start with either {"Model": {...}} or {"Dataset": {...}} as the root structure
- Use exact field names from schema (case-sensitive)
- Follow proper nesting structure exactly as shown
- Include required fields even if empty
- Use appropriate data types (string, number, array, object)
- For arrays of strings: ["item1", "item2"]
- For arrays of objects: [{"field": "value"}]
- For nested objects: {"field": {"nested": "value"}}

REQUIRED JSON ROOT STRUCTURE:
For a MODEL document:
{
  "Model": {
    "Name": "extracted name",
    "Description": "extracted description",
    ... (all other model fields)
  }
}

For a DATASET document:
{
  "Dataset": {
    "Name": "extracted name", 
    "Description": "extracted description",
    ... (all other dataset fields)
  }
}

EXTRACTED INFORMATION TO FORMAT:

${extractedInformation}

OUTPUT (Valid JSON only):`;
}

// Generate example JSON structure from schema
function generateExampleFromSchema(schema, cardType) {
  console.log('🏗️ Generating example structure from schema for:', cardType);

  // Get the main section from schema
  const sectionName = cardType.charAt(0).toUpperCase() + cardType.slice(1);
  const sectionDef = schema.$defs?.[cardType.toLowerCase()];

  if (!sectionDef || !sectionDef.properties) {
    console.warn('⚠️ Schema definition not found, using fallback');
    return {
      [sectionName]: {
        "Name": "string",
        "Description": "string"
      }
    };
  }

  // Recursively generate example values from properties
  function generateValue(propDef, visited = new Set(), depth = 0) {
    const maxDepth = 5;
    if (depth > maxDepth) return "...";

    // Handle $ref
    if (propDef.$ref) {
      const refPath = propDef.$ref.replace('#/$defs/', '');
      if (visited.has(refPath)) return "circular reference";

      const refDef = schema.$defs?.[refPath];
      if (refDef) {
        const newVisited = new Set(visited);
        newVisited.add(refPath);
        return generateValue(refDef, newVisited, depth + 1);
      }
    }

    // Handle by type
    switch (propDef.type) {
      case 'string':
        if (propDef.enum) {
          return propDef.enum[0] || "string";
        }
        return "string";

      case 'number':
      case 'integer':
        return 0;

      case 'boolean':
        return false;

      case 'array':
        if (propDef.items) {
          const itemExample = generateValue(propDef.items, visited, depth + 1);
          return [itemExample];
        }
        return [];

      case 'object':
        if (propDef.properties) {
          const objExample = {};
          for (const [key, subProp] of Object.entries(propDef.properties)) {
            objExample[key] = generateValue(subProp, visited, depth + 1);
          }
          return objExample;
        }
        return {};

      default:
        return "string";
    }
  }

  // Generate the main structure
  const exampleStructure = {};
  for (const [propKey, propDef] of Object.entries(sectionDef.properties)) {
    exampleStructure[propKey] = generateValue(propDef);
  }

  return {
    [sectionName]: exampleStructure
  };
}

// Function to create text-only prompt (without images/figures)
function createTextOnlyPrompt(documentData, schemas, cardType) {
  console.log('🔍 createTextOnlyPrompt called with cardType:', cardType);

  const cardTypeUpper = cardType.toUpperCase();

  // Generate example structure from dynamic schema
  const exampleStructure = generateExampleFromSchema(schemas[cardType], cardType);
  const exampleJson = JSON.stringify(exampleStructure, null, 2);

  return `You are an expert AI system specializing in extracting structured information from medical imaging research papers for ROADMAP ${cardTypeUpper} cards.

**TASK:** Extract information for a ${cardTypeUpper} card in valid JSON format (text-only analysis).

**CRITICAL: STRICT SCHEMA COMPLIANCE**
Your output MUST match the schema structure EXACTLY. DO NOT create any fields not shown in the schema example below.

**FIELD MAPPING GUIDE - READ CAREFULLY:**
When you find information about:
• "Modalities" or "imaging type" (CT, MRI, etc.) → Use: Imaging.Modality (array of strings with RadLex codes)
• "Anatomy" or "body parts" → Use: Imaging.Anatomy (array within Imaging.Content)
• "Dataset description" or "purpose" → Use: Labeling (string) or Motivation.Purpose (string)
• "Training/test/validation split" → Use: Partition (array) with "Partition name" and "Data" fields
• "Total sample size" or "number of instances" → Use: Composition.Number of instances (integer)
• "Patient demographics" → Use: Data.Demographics (within Partition items or Subsets items)
• "Inclusion/exclusion criteria" → Use: Data.Inclusion or Data.Exclusion (within Partition or Subsets)
• "Tasks" (detection, segmentation, classification) → Describe in Labeling field (string)
• "Authors" → Use: Author (array) with Name, Email, Address fields (NOT "affiliation")
• Any info that doesn't fit → Use: Comments field (string)

**CRITICAL RULES:**
1. DO NOT create fields like: "description", "modalities", "anatomy", "tasks", "sample_size", "inclusion_criteria", "affiliation"
2. DO NOT use lowercase for schema fields: use "Author" not "authors", "Subsets" not "subsets", "Name" not "name"
3. Use NESTED structures: Imaging.Modality, NOT a top-level "modalities" field
4. For author affiliations: put in Address field, NOT "affiliation"
5. ALL extracted information must go somewhere in the schema structure
6. If uncertain where info goes: put it in Comments field with clear labels

**DATASET PARTITION EXAMPLE:**
{
  "Dataset": {
    "Name": "Example Dataset",
    "Imaging": {
      "Modality": ["Computed tomography (RID10321)"],
      "Content": {
        "Anatomy": ["Abdomen", "Pelvis"]
      }
    },
    "Labeling": "Dataset includes detection, classification, and segmentation tasks for traumatic injuries",
    "Partition": [
      {
        "Partition name": "Training",
        "Data": {
          "Number of instances": 3147,
          "Demographics": {
            "Age": "Mean 45.2 years",
            "Sex": "60% male, 40% female"
          },
          "Inclusion": "Adult patients ≥18 years with abdominal trauma"
        }
      },
      {
        "Partition name": "Testing",
        "Data": {
          "Number of instances": 404
        }
      }
    ],
    "Comments": "Additional details: Uses DICOM format, includes segmentation masks for 206 series"
  }
}

**VALIDATION CHECKLIST (verify before output):**
□ All field names match schema example EXACTLY (case-sensitive)
□ No top-level fields like "description", "modalities", "tasks", "sample_size"
□ Nested structures used correctly (Imaging.Modality, not "modality")
□ Author uses "Address" field, NOT "affiliation"
□ Partitions use "Partition name" and "Data", NOT "name" and other custom fields
□ All extracted information is placed somewhere in the structure
□ Any info that doesn't fit is in "Comments" field

**REQUIRED JSON STRUCTURE:**
${exampleJson}

**DOCUMENT TEXT:**
"""${documentData.text.substring(0, 15000)}"""

**TABLES:**
${JSON.stringify(documentData.tables, null, 2)}

**OUTPUT (Valid JSON only):**`;
}

// Helper functions for type-specific extraction guidance
function getModelSpecificInstructions() {
  return `**MODEL CARD SPECIFIC PRIORITIES:**
6.  **Architecture Details:** Extract network architecture, model type (CNN, RNN, transformer, etc.), layer specifications, and architectural innovations. Look in Methods → "Model Architecture", "Network Design", or "Architecture" subsections.
7.  **Training Methodology:** Extract loss functions, optimizers, learning rates, batch sizes, number of epochs, data augmentation techniques. Look in Methods → "Training Procedure", "Optimization", or "Implementation Details".
8.  **Performance Metrics:** Focus on TEST set performance. Extract accuracy, sensitivity, specificity, AUC, F1-scores from Results tables. Include comparisons with baselines and state-of-the-art methods.
9.  **Computational Requirements:** Extract GPU type, training time, inference speed, memory usage, hardware specifications. Often mentioned in Methods or supplementary materials.
10. **Implementation Details:** Extract framework/library used (PyTorch, TensorFlow, Keras), code repository URLs (GitHub, GitLab), pre-trained model availability. Check end of paper and supplementary materials.
11. **Input/Output Specifications:** Extract input image dimensions, preprocessing steps, output format (classification, segmentation masks, bounding boxes).`;
}

function getDatasetSpecificInstructions() {
  return `**DATASET CARD SPECIFIC PRIORITIES:**
6.  **Data Collection Protocols:** Extract acquisition protocols, scanner manufacturers/models, imaging parameters (slice thickness, resolution), collection timeframe. Look in Methods → "Data Collection", "Image Acquisition".
7.  **Demographics & Characteristics:** Extract ALL patient/subject characteristics including age (mean, range, distribution), sex/gender, diagnoses, clinical history. Convert demographic tables into structured Subset objects with counts.
8.  **Subsets & Partitions:** Convert train/validation/test split tables into detailed Subset objects. For EACH subset, extract sample size and demographic breakdown. Look for tables with "Training Set", "Test Set", "Validation Set" labels.
9.  **Annotation & Labeling:** Extract labeling methodology, number of annotators, annotation tools used, inter-rater agreement metrics (Kappa, ICC), ground truth definition. Look in Methods → "Annotation", "Ground Truth", "Reference Standard".
10. **Label Distributions:** Convert label/classification tables into Classification objects with counts. Extract injury grades, disease categories, anatomical structure labels with their frequencies.
11. **Inclusion/Exclusion Criteria:** Extract patient selection criteria, exclusion reasons, quality control measures. Usually in Methods → "Study Population" or "Patient Selection".`;
}

function getModelFieldLocationHints() {
  return `**WHERE TO FIND MODEL INFORMATION:**
• **Name**: Title of paper or explicitly stated model name
• **Architecture**: Methods → "Model Architecture", "Network Design" subsections
• **Training Details**: Methods → "Training Procedure", "Optimization" subsections
• **Performance Metrics**: Results section → Tables comparing your model vs baselines, ablation studies
• **Dataset Used**: Methods → "Dataset", "Data" subsections (extract name, size, source)
• **Code Repository**: End of paper, supplementary materials → "Code availability", "Data and code availability"
• **Computational Requirements**: Methods → "Implementation Details", supplementary materials
• **Input/Output**: Methods → "Preprocessing", "Model Input", "Output"`;
}

function getDatasetFieldLocationHints() {
  return `**WHERE TO FIND DATASET INFORMATION:**
• **Name**: Title of paper or dataset name in abstract
• **Sample Size**: Abstract, Methods, often as "N=X patients/images/scans/cases"
• **Demographics**: Tables labeled "Patient Characteristics", "Study Population", "Demographics"
• **Subsets/Partitions**: Tables with "Training", "Validation", "Test", "Development", "Internal", "External"
• **Imaging Modality**: Methods → "Image Acquisition", "Scanning Protocol" (look for CT, MRI, ultrasound, X-ray, PET)
• **Anatomy**: Methods → mentions of organ systems, body regions (brain, abdomen, chest, etc.)
• **Collection Period**: Methods → "Study Period", "Data Collection", dates of acquisition
• **Annotations**: Methods → "Labeling", "Ground Truth", "Reference Standard", "Annotation Protocol"
• **Label Distributions**: Tables showing injury grades, disease categories, classification counts`;
}

// Helper function to create the enhanced single prompt based on processing mode and card type
function createEnhancedSinglePrompt(documentData, schemas, processingMode, cardType) {
  const cardTypeUpper = cardType.toUpperCase();
  const schemaForPrompt = cardType === 'model' ? schemas.model : schemas.dataset;

  // Dynamically extract the structure from the official schema file
  const dynamicSchemaStructure = extractSchemaStructure(schemaForPrompt, cardType);
  const modelToUse = processingMode === 'multimodal' ? "gemini-1.5-pro-latest" : "gemini-1.5-flash-latest";

  // Generate type-specific extraction guidance
  const typeSpecificInstructions = cardType === 'model'
    ? getModelSpecificInstructions()
    : getDatasetSpecificInstructions();

  const fieldLocationHints = cardType === 'model'
    ? getModelFieldLocationHints()
    : getDatasetFieldLocationHints();

  // This prompt combines detailed instructions with the dynamic schema
  return `You are an expert AI system specializing in extracting structured information from medical imaging research papers for ROADMAP ${cardTypeUpper} cards. Your model is ${modelToUse}.

**TASK:** Analyze the provided document text, tables, and figures to extract comprehensive information for a ${cardTypeUpper} card. Your output MUST be a single, valid JSON object that strictly adheres to the provided ROADMAP schema structure.

**CRITICAL INSTRUCTIONS:**
1.  **EXACT FIELD NAMES:** Use the EXACT field names and capitalization from the schema structure below (e.g., "Author" not "authors", "Subsets" not "subsets", "Name" not "name"). Field name precision is critical for proper rendering.
2.  **Strict Schema Compliance:** Your entire output must be a single JSON object that perfectly matches the structure, field names, and data types defined in the "REQUIRED JSON STRUCTURE" section below.
3.  **Comprehensive Extraction:** Extract ALL relevant information from the document. Search thoroughly for each schema field before omitting. If truly not found after checking relevant sections, omit the field. Never use placeholder text like "Not specified" or "N/A".
4.  **Author Details:** Extract ALL authors with their full names and affiliations. Do not summarize the author list.
5.  **Table Data is Key:** Look specifically for labels, classifications, performance metrics, demographic breakdowns, and statistical measures in ALL tables.
6.  **Numerical Precision:** Extract exact numerical values, age ranges, and statistical measures (e.g., "47.9 ± 21.0 (18-90)"). Do not approximate.

${typeSpecificInstructions}

${fieldLocationHints}

---

**REQUIRED JSON STRUCTURE (from official ROADMAP schema):**
\`\`\`json
{
  "${cardType.charAt(0).toUpperCase() + cardType.slice(1)}": ${JSON.stringify(dynamicSchemaStructure, null, 2)}
}
\`\`\`

---

**DOCUMENT CONTENT TO ANALYZE:**

**TEXT:**
"""
${documentData.text.substring(0, 15000)}
"""

**TABLES:**
${JSON.stringify(documentData.tables, null, 2)}

---

**FINAL OUTPUT (A single, valid JSON object only):**`;
}

// Parse and clean Gemini response to extract valid JSON
async function parseAndCleanGeminiResponse(response, cardType) {
  try {
    console.log('🔧 Parsing Gemini response...');
    
    // Parse the Gemini API response format
    const parsedResponse = JSON.parse(response);
    
    // Extract text content from Gemini's response structure
    let textContent = '';
    if (parsedResponse.candidates?.[0]?.content?.parts?.[0]?.text) {
      textContent = parsedResponse.candidates[0].content.parts[0].text;
    } else {
      console.error('❌ Unexpected Gemini response structure');
      return null;
    }
    
    console.log('📝 Extracted text content length:', textContent.length);
    
    // Clean the text content to extract JSON
    const cleanedJson = extractJsonFromText(textContent, cardType);
    
    if (cleanedJson) {
      console.log('✅ Successfully parsed and validated JSON');
      return cleanedJson;
    }
    
    console.error('❌ No valid JSON found in response');
    return null;
    
  } catch (error) {
    console.error('❌ Error parsing Gemini response:', error);
    return null;
  }
}

// Extract and validate JSON from text content
function extractJsonFromText(text, cardType) {
  try {
    // Remove markdown code blocks if present
    let cleanText = text.replace(/```json\s*\n?/g, '').replace(/```\s*$/g, '');
    
    // Find JSON object boundaries
    const startIndex = cleanText.indexOf('{');
    const lastIndex = cleanText.lastIndexOf('}');
    
    if (startIndex === -1 || lastIndex === -1) {
      console.error('❌ No JSON object boundaries found');
      return null;
    }
    
    const jsonText = cleanText.slice(startIndex, lastIndex + 1);
    
    // Parse and validate the JSON
    const parsedJson = JSON.parse(jsonText);
    
    // Validate it has the expected structure
    const expectedKey = cardType.charAt(0).toUpperCase() + cardType.slice(1).toLowerCase();
    if (!parsedJson[expectedKey]) {
      console.error(`❌ JSON missing expected key: ${expectedKey}`);
      return null;
    }
    
    console.log('✅ JSON validation successful');
    return parsedJson;
    
  } catch (error) {
    console.error('❌ JSON parsing error:', error);
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Parse the incoming PDF file first to get custom schema
    const form = new IncomingForm();
    const { files, fields } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ files, fields });
      });
    });

    // Get processing mode (default to multimodal for backward compatibility)
    const processingMode = fields.mode?.[0] || 'multimodal';
    console.log('🎛️ Processing mode:', processingMode);

    // Get card type (default to model for backward compatibility)
    const cardType = fields.cardType?.[0] || 'model';
    console.log('🎯 Card type received:', cardType);
    console.log('🔍 DEBUG fields.cardType:', fields.cardType);

    // Check for custom schema
    let schemas;
    if (fields.customSchema && fields.customSchema[0]) {
      try {
        console.log('📦 Using custom schema from frontend');
        const customSchemaData = JSON.parse(fields.customSchema[0]);

        // Determine if custom schema is for model or dataset
        schemas = {
          model: customSchemaData.Model || customSchemaData,
          dataset: customSchemaData.Dataset || customSchemaData
        };

        // If the custom schema is specifically for one type, use it for both to simplify
        // The cardType will determine which is actually used
        if (cardType === 'model' && !schemas.model.Model) {
          schemas.model = customSchemaData;
        } else if (cardType === 'dataset' && !schemas.dataset.Dataset) {
          schemas.dataset = customSchemaData;
        }

        console.log('✅ Custom schema loaded');
      } catch (error) {
        console.error('❌ Error parsing custom schema, falling back to local schemas:', error);
        schemas = await loadSchemas();
      }
    } else {
      // Load default local schemas
      console.log('📂 Loading local ROADMAP schemas...');
      schemas = await loadSchemas();
      console.log('✅ Schemas loaded successfully');
    }

    const pdfFile = files.pdf[0];
    if (!pdfFile) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    console.log('Processing PDF file:', pdfFile.originalFilename);
    const fileContent = await fs.readFile(pdfFile.filepath);

    // 3. Process PDF with Google Document AI
    const googleCloudKey = process.env.GOOGLE_CLOUD_KEY;
    const processorId = process.env.DOCUMENT_AI_PROCESSOR_ID;
    const location = 'us';
    
    if (!googleCloudKey) {
      return res.status(500).json({ error: 'Google Cloud credentials not configured' });
    }

    if (!processorId) {
      return res.status(500).json({ error: 'Document AI Processor ID not configured' });
    }

    let extractedText = '';
    let extractedTables = [];
    let referencedImages = [];
    let extractedImages = [];
    
    try {
      console.log('🤖 Step 1: Initializing Google Document AI...');
      
      // Initialize Document AI client with credentials
      const credentials = JSON.parse(Buffer.from(googleCloudKey, 'base64').toString());
      const client = new DocumentProcessorServiceClient({
        credentials,
        projectId: credentials.project_id
      });

      // Construct the processor name
      const name = `projects/${credentials.project_id}/locations/${location}/processors/${processorId}`;
      
      console.log('📄 Step 2: Processing PDF with Document AI...');
      console.log('Processing PDF file:', pdfFile.originalFilename);
      console.log('File size:', Math.round(fileContent.length / 1024), 'KB');

      // Process the document with explicit request for images
      console.log('🔍 DEBUG: Processor name:', name);
      const [result] = await client.processDocument({
        name,
        rawDocument: {
          content: fileContent.toString('base64'),
          mimeType: 'application/pdf',
        },
        // Request specific features including images
        processOptions: {
          layoutConfig: {
            chunkingConfig: {
              chunkSize: 500,
              includeAncestorHeadings: true,
            },
          },
        },
        // Explicitly request image extraction
        fieldMask: {
          paths: ['text', 'pages.layout', 'pages.tables', 'pages.images', 'pages.visualElements']
        }
      });

      const { document } = result;
      console.log('✅ Document AI processing completed');
      console.log('📊 Pages processed:', document.pages?.length || 0);
      
      // Debug: Log the complete structure of the first page if it exists
      if (document.pages && document.pages[0]) {
        const firstPage = document.pages[0];
        console.log('🔍 DEBUG: First page structure:', {
          hasImages: !!firstPage.images,
          imageCount: firstPage.images?.length || 0,
          hasVisualElements: !!firstPage.visualElements,
          visualElementCount: firstPage.visualElements?.length || 0,
          hasTables: !!firstPage.tables,
          tableCount: firstPage.tables?.length || 0,
          pageKeys: Object.keys(firstPage)
        });
        
        // If there are images, log the first image structure completely
        if (firstPage.images && firstPage.images[0]) {
          console.log('🔍 DEBUG: First image complete structure:', JSON.stringify(firstPage.images[0], null, 2));
        }
        
        // If there are visual elements, log the first one
        if (firstPage.visualElements && firstPage.visualElements[0]) {
          console.log('🔍 DEBUG: First visual element structure:', JSON.stringify(firstPage.visualElements[0], null, 2));
        }
      }

      // Extract text content
      if (document.text) {
        extractedText = document.text;
        console.log('📝 Text extracted, length:', extractedText.length);
      }

      // Extract tables and images with structure
      extractedImages = [];
      
      if (document.pages) {
        document.pages.forEach((page, pageIndex) => {
          const pageImages = [];
          const pageTables = [];
          
          // First pass: Extract all images from this page
          if (page.images) {
            console.log(`🔍 DEBUG: Page ${pageIndex + 1} has ${page.images.length} images`);
            page.images.forEach((image, imageIndex) => {
              console.log(`🔍 DEBUG: Image ${imageIndex + 1} structure:`, {
                hasImage: !!image.image,
                hasContent: !!image.image?.content,
                hasData: !!image.image?.data,
                hasInlineData: !!image.inlineData,
                keys: Object.keys(image),
                imageKeys: image.image ? Object.keys(image.image) : null
              });
              
              const imageData = {
                page: pageIndex + 1,
                imageIndex: imageIndex + 1,
                bounds: image.layout?.boundingPoly,
                base64: null,
                caption: null,
                figureNumber: null
              };

              // Try to extract image content - check multiple possible locations
              if (image.image?.content) {
                imageData.base64 = image.image.content;
                console.log(`✅ Found image content in image.image.content (${image.image.content.length} chars)`);
              } else if (image.image?.data) {
                imageData.base64 = image.image.data;
                console.log(`✅ Found image content in image.image.data (${image.image.data.length} chars)`);
              } else if (image.inlineData?.data) {
                imageData.base64 = image.inlineData.data;
                console.log(`✅ Found image content in image.inlineData.data (${image.inlineData.data.length} chars)`);
              } else {
                console.log(`❌ No image content found for image ${imageIndex + 1} on page ${pageIndex + 1}`);
              }

              pageImages.push(imageData);
            });
          }

          // Also extract visual elements (figures, charts)
          if (page.visualElements) {
            page.visualElements.forEach((element, elementIndex) => {
              if (element.layout) {
                const visualData = {
                  page: pageIndex + 1,
                  elementIndex: elementIndex + 1,
                  type: element.type || 'visual_element',
                  bounds: element.layout.boundingPoly,
                  text: element.layout.textAnchor ? getText(element.layout.textAnchor, document.text) : null
                };

                pageImages.push(visualData);
              }
            });
          }
          
          // Second pass: Extract tables with bounding box information
          if (page.tables) {
            page.tables.forEach((table, tableIndex) => {
              const tableData = {
                page: pageIndex + 1,
                tableIndex: tableIndex + 1,
                headers: [],
                rows: [],
                boundingPoly: table.layout?.boundingPoly // Store bounding box for filtering
              };

              // Extract table structure
              if (table.headerRows) {
                table.headerRows.forEach(headerRow => {
                  const headerCells = headerRow.cells?.map(cell => 
                    getText(cell.layout.textAnchor, document.text)
                  ) || [];
                  tableData.headers.push(headerCells);
                });
              }

              if (table.bodyRows) {
                table.bodyRows.forEach(bodyRow => {
                  const rowCells = bodyRow.cells?.map(cell => 
                    getText(cell.layout.textAnchor, document.text)
                  ) || [];
                  tableData.rows.push(rowCells);
                });
              }

              if (tableData.headers.length > 0 || tableData.rows.length > 0) {
                pageTables.push(tableData);
              }
            });
          }
          
          // Third pass: Filter out incorrect tables using the filtering function
          const filteredTables = filterIncorrectTables(pageTables, pageImages, pageIndex);
          
          // Add filtered tables to the global array (without boundingPoly for final output)
          filteredTables.forEach(table => {
            const cleanTable = {
              page: table.page,
              tableIndex: table.tableIndex,
              headers: table.headers,
              rows: table.rows
            };
            extractedTables.push(cleanTable);
          });
          
          // Add all page images to the global array
          extractedImages.push(...pageImages);
        });
      }

      console.log('📋 Tables extracted:', extractedTables.length);
      console.log('🖼️ Images found:', extractedImages.length);
      
      // Find figure references in text and match to extracted images
      referencedImages = findReferencedImages(extractedText, extractedImages);
      console.log('🎯 Referenced images selected:', referencedImages.length);
      
      console.log('✅ Document AI processing complete - text + tables + selective images extracted');

    } catch (pdfError) {
      console.error('PDF processing failed:', pdfError);
      return res.status(500).json({ 
        error: 'Failed to process PDF file',
        details: pdfError.message 
      });
    }

    console.log('🔍 DEBUG: About to validate extracted text');
    console.log('🔍 DEBUG: extractedText defined?', typeof extractedText);
    console.log('🔍 DEBUG: extractedText length:', extractedText?.length || 'undefined');

    if (!extractedText || extractedText.trim().length === 0) {
      console.log('❌ Text validation failed - no text extracted');
      return res.status(400).json({ error: 'No text could be extracted from the PDF' });
    }

    console.log('✅ Text validation passed - proceeding to Gemini API');

    console.log('Extracted text length:', extractedText.length, 'characters');

    // 4. Call Gemini API with streaming for large responses
    const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ error: 'Gemini API key not configured' });
    }

    // Use standard generateContent endpoint for single clean JSON response
    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
    
    // Create enhanced prompt with text, tables, and images
    const documentData = {
      text: extractedText,
      tables: extractedTables,
      images: referencedImages,
      metadata: {
        filename: pdfFile.originalFilename,
        text_length: extractedText.length,
        tables_count: extractedTables.length,
        images_count: referencedImages.length
      }
    };
    
    const prompt = createEnhancedSinglePrompt(documentData, schemas, processingMode, cardType);
    
    console.log('🚀 Processing document with STREAMING and enhanced chain-of-thought prompt...');
    console.log('📝 Processing mode:', processingMode);
    console.log('🎯 Using cardType for prompt generation:', cardType);

    // Build request body based on processing mode
    let requestBody;
    if (processingMode === 'text-only') {
      requestBody = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH", 
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          }
        ]
      };
    } else {
      // Multimodal request with images
      const contentParts = [{ text: prompt }];
      
      // Add referenced images
      if (documentData.images && documentData.images.length > 0) {
        documentData.images.forEach(image => {
          if (image.base64) {
            contentParts.push({
              text: `\n\nFigure ${image.figureNumber} (Page ${image.page}):`
            });
            contentParts.push({
              inlineData: {
                mimeType: 'image/jpeg',
                data: image.base64
              }
            });
          }
        });
      }

      requestBody = {
        contents: [{ parts: contentParts }],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 8192,
        },
        safetySettings: [
          {
            category: "HARM_CATEGORY_HARASSMENT",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          },
          {
            category: "HARM_CATEGORY_HATE_SPEECH",
            threshold: "BLOCK_MEDIUM_AND_ABOVE"
          }
        ]
      };
    }

    const geminiResponse = await fetch(geminiApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('❌ Gemini API error:', errorText);
      return res.status(500).json({ error: 'Failed to connect to Gemini endpoint', details: errorText.substring(0, 200) });
    }

    // Get the complete response from Gemini
    const fullResponse = await geminiResponse.text();
    console.log('✅ Full response received, length:', fullResponse.length);

    // Parse and clean the Gemini response
    const cleanedJson = await parseAndCleanGeminiResponse(fullResponse, cardType);
    
    if (!cleanedJson) {
      console.error('❌ Failed to parse valid JSON from Gemini response');
      return res.status(500).json({ error: 'Failed to generate valid JSON from AI response' });
    }

    // Return the clean, validated JSON response
    console.log('✅ Sending clean JSON response');
    res.status(200).json(cleanedJson);

  } catch (error) {
    console.error('Backend error:', error);
    res.status(500).json({ 
      error: 'Failed to process PDF',
      details: error.message 
    });
  }
}