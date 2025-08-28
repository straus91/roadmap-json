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
async function loadSchemas() {
  try {
    const schemasDir = path.join(process.cwd(), 'schemas');
    
    const modelSchemaPath = path.join(schemasDir, 'base-model-schema.json');
    const datasetSchemaPath = path.join(schemasDir, 'base-dataset-schema.json');
    
    const [modelSchemaContent, datasetSchemaContent] = await Promise.all([
      fs.readFile(modelSchemaPath, 'utf8'),
      fs.readFile(datasetSchemaPath, 'utf8')
    ]);
    
    return {
      model: JSON.parse(modelSchemaContent),
      dataset: JSON.parse(datasetSchemaContent)
    };
  } catch (error) {
    console.error('Error loading schemas:', error);
    throw new Error('Failed to load ROADMAP schemas');
  }
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
        examples: value.examples,
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
          examples: value.items.examples,
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
            result[key].items.examples = refDef.examples;
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
            examples: refDef.examples,
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
function createMultimodalPrompt(documentData, schemas) {
  const modelStructure = extractSchemaStructure(schemas.model, 'model');
  const datasetStructure = extractSchemaStructure(schemas.dataset, 'dataset');
  
  return `You are an expert AI system specialized in extracting structured information from medical imaging research papers and documents to populate ROADMAP (Radiology Ontology for AI Models, Datasets and Projects) cards.

TASK: Analyze the following multimodal document content (text + tables + images) from a research paper PDF and determine if it describes an AI MODEL or a DATASET, then extract structured information according to the exact ROADMAP schema format.

DOCUMENT CONTENT INCLUDES:
- Full text content from the PDF
- Structured table data extracted from the document  
- Referenced figures, charts, and diagrams as images
- Document metadata

INSTRUCTIONS:
1. ANALYZE the text content, structured tables, AND visual figures/charts provided
2. DETERMINE if this describes a MODEL (AI/ML algorithm) or DATASET (collection of medical images/data)
3. EXTRACT information following the exact schema structure provided below
4. RETURN a valid JSON object with either "Model" or "Dataset" key
5. USE proper data types (strings, arrays, objects, numbers) as specified
6. INCLUDE as many relevant fields as possible from the schema
7. SET empty strings "" for text fields you cannot find information for
8. SET empty arrays [] for array fields you cannot find information for
9. SET appropriate default values for required fields

MODEL SCHEMA STRUCTURE:
${JSON.stringify(modelStructure, null, 2)}

DATASET SCHEMA STRUCTURE:
${JSON.stringify(datasetStructure, null, 2)}

CRITICAL REQUIREMENTS:
- Return ONLY valid JSON (no markdown, no explanations)
- Use exact field names from schema (case-sensitive)
- Follow proper nesting structure
- Include required fields even if empty
- Use appropriate data types (string, number, array, object)
- For arrays of strings: ["item1", "item2"]
- For arrays of objects: [{"field": "value"}]
- For nested objects: {"field": {"nested": "value"}}

EXAMPLE OUTPUT FORMAT:
For a MODEL:
{
  "Model": {
    "Name": "extracted model name",
    "Use": {
      "Intended": ["use case 1", "use case 2"]
    },
    "Results": [
      {
        "Metric": ["accuracy", "sensitivity"],
        "Value": "0.95",
        "Result Information": "description of result"
      }
    ],
    ...other fields
  }
}

For a DATASET:
{
  "Dataset": {
    "Name": "extracted dataset name",
    "Composition": {
      "Number of instances": 1000,
      "Data type": ["Image"]
    },
    "Imaging": {
      "File format": ["DICOM"],
      "Resolution": "512x512"
    },
    ...other fields
  }
}

DOCUMENT CONTENT:

TEXT CONTENT:
"""${documentData.text.substring(0, 12000)}${documentData.text.length > 12000 ? '\n\n... [text truncated]' : ''}"""

STRUCTURED TABLES (${documentData.tables.length} tables found):
${documentData.tables.length > 0 ? JSON.stringify(documentData.tables, null, 2) : 'No tables found in document'}

REFERENCED FIGURES:
${documentData.images.length > 0 ? 
  documentData.images.map(img => `- Figure ${img.figureNumber} (Page ${img.page}) - ${img.referenced ? 'Referenced in text' : 'Available'}`).join('\n') 
  : 'No figures available'}

Note: Visual content (charts, diagrams, images) will be provided as additional input for analysis.

METADATA:
- Filename: ${documentData.metadata.filename}
- Text length: ${documentData.metadata.text_length} characters
- Tables extracted: ${documentData.metadata.tables_count}
- Images selected: ${documentData.metadata.images_count}

OUTPUT (JSON only):`;
}

// Function to create text-only prompt (without images/figures)
function createTextOnlyPrompt(documentData, schemas) {
  const modelStructure = extractSchemaStructure(schemas.model, 'model');
  const datasetStructure = extractSchemaStructure(schemas.dataset, 'dataset');
  
  return `You are an expert AI system specialized in extracting structured information from medical imaging research papers and documents to populate ROADMAP (Radiology Ontology for AI Models, Datasets and Projects) cards.

TASK: Analyze the following document content (text + tables) from a research paper PDF and determine if it describes an AI MODEL or a DATASET, then extract structured information according to the exact ROADMAP schema format.

DOCUMENT CONTENT INCLUDES:
- Full text content from the PDF
- Structured table data extracted from the document  
- Document metadata

INSTRUCTIONS:
1. ANALYZE the text content and structured tables provided
2. DETERMINE if this describes a MODEL (AI/ML algorithm) or DATASET (collection of medical images/data)
3. EXTRACT information following the exact schema structure provided below
4. RETURN a valid JSON object with either "Model" or "Dataset" key
5. USE proper data types (strings, arrays, objects, numbers) as specified
6. INCLUDE as many relevant fields as possible from the schema
7. SET empty strings "" for text fields you cannot find information for
8. SET empty arrays [] for array fields you cannot find information for
9. SET appropriate default values for required fields

MODEL SCHEMA STRUCTURE:
${JSON.stringify(modelStructure, null, 2)}

DATASET SCHEMA STRUCTURE:
${JSON.stringify(datasetStructure, null, 2)}

CRITICAL REQUIREMENTS:
- Return ONLY valid JSON (no markdown, no explanations)
- Use exact field names from schema (case-sensitive)
- Follow proper nesting structure
- Include required fields even if empty
- Use appropriate data types (string, number, array, object)
- For arrays of strings: ["item1", "item2"]
- For arrays of objects: [{"field": "value"}]
- For nested objects: {"field": {"nested": "value"}}

EXAMPLE OUTPUT FORMAT:
For a MODEL:
{
  "Model": {
    "Name": "extracted model name",
    "Use": {
      "Intended": ["use case 1", "use case 2"]
    },
    "Performance": {
      "Metrics": [
        {
          "Metric": "AUC",
          "Value": "0.95"
        }
      ]
    }
  }
}

For a DATASET:
{
  "Dataset": {
    "Name": "extracted dataset name",
    "Format": ["DICOM", "NIfTI"],
    "Content": {
      "Annotation": "ground truth labels"
    }
  }
}

DOCUMENT CONTENT:

TEXT CONTENT:
"""${documentData.text.substring(0, 15000)}${documentData.text.length > 15000 ? '\n\n... [text truncated]' : ''}"""

STRUCTURED TABLES (${documentData.tables.length} tables found):
${documentData.tables.length > 0 ? JSON.stringify(documentData.tables, null, 2) : 'No tables found in document'}

METADATA:
- Filename: ${documentData.metadata.filename}
- Text length: ${documentData.metadata.text_length} characters
- Tables extracted: ${documentData.metadata.tables_count}
- Processing mode: Text-only (images excluded)

OUTPUT (JSON only):`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Load ROADMAP schemas
    console.log('Loading ROADMAP schemas...');
    const schemas = await loadSchemas();
    console.log('Schemas loaded successfully');

    // 2. Parse the incoming PDF file
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

      // Process the document
      const [result] = await client.processDocument({
        name,
        rawDocument: {
          content: fileContent.toString('base64'),
          mimeType: 'application/pdf',
        },
      });

      const { document } = result;
      console.log('✅ Document AI processing completed');
      console.log('📊 Pages processed:', document.pages?.length || 0);

      // Extract text content
      if (document.text) {
        extractedText = document.text;
        console.log('📝 Text extracted, length:', extractedText.length);
      }

      // Extract tables and images with structure
      extractedImages = [];
      
      if (document.pages) {
        document.pages.forEach((page, pageIndex) => {
          // Extract tables
          if (page.tables) {
            page.tables.forEach((table, tableIndex) => {
              const tableData = {
                page: pageIndex + 1,
                tableIndex: tableIndex + 1,
                headers: [],
                rows: []
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
                extractedTables.push(tableData);
              }
            });
          }

          // Extract images/figures
          if (page.images) {
            page.images.forEach((image, imageIndex) => {
              const imageData = {
                page: pageIndex + 1,
                imageIndex: imageIndex + 1,
                bounds: image.layout?.boundingPoly,
                base64: null,
                caption: null,
                figureNumber: null
              };

              // Try to extract image content if available
              if (image.image && image.image.content) {
                imageData.base64 = image.image.content;
              }

              extractedImages.push(imageData);
            });
          }

          // Extract visual elements (figures, charts)
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

                extractedImages.push(visualData);
              }
            });
          }
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

    // 4. Call Gemini API with enhanced prompt and retry logic
    const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ error: 'Gemini API key not configured' });
    }

    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
    
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
    
    let geminiResult;
    
    if (processingMode === 'text-only') {
      // Create text-only prompt (without image references)
      const textOnlyPrompt = createTextOnlyPrompt(documentData, schemas);
      console.log('📝 Using text-only processing mode');
      
      // Call Gemini API with text content only
      geminiResult = await callGeminiAPI(geminiApiUrl, textOnlyPrompt, {
        temperature: 0.2,
        maxOutputTokens: 4096,
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
      });
    } else {
      // Default multimodal processing
      const multimodalPrompt = createMultimodalPrompt(documentData, schemas);
      console.log('🖼️ Using multimodal processing mode');
      
      // Call Gemini API with multimodal content (text + images)
      geminiResult = await callGeminiAPIMultimodal(geminiApiUrl, multimodalPrompt, documentData, {
        temperature: 0.2,
        maxOutputTokens: 4096,
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
      });
    }

    // Handle retry function errors
    if (geminiResult.error) {
      console.error('Gemini API failed after retries:', geminiResult.message);
      return res.status(500).json({ 
        error: 'Gemini API request failed after retries',
        details: geminiResult.message?.substring(0, 200)
      });
    }

    console.log('Received response from Gemini API');
    
    if (!geminiResult.candidates || !geminiResult.candidates[0] || !geminiResult.candidates[0].content) {
      console.error('Invalid Gemini response structure:', geminiResult);
      return res.status(500).json({ error: 'Invalid response from Gemini API' });
    }

    // Parse the Gemini response
    let structuredJson;
    try {
      const responseContent = geminiResult.candidates[0].content.parts[0].text.trim();
      console.log('Raw Gemini response length:', responseContent.length);
      
      // Clean up the response (remove any markdown formatting)
      const cleanResponse = responseContent
        .replace(/```json\n?|\n?```/g, '')
        .replace(/```\n?|\n?```/g, '')
        .trim();
      
      structuredJson = JSON.parse(cleanResponse);
      console.log('Successfully parsed JSON response');
      
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', geminiResult.candidates[0].content.parts[0].text.substring(0, 500));
      return res.status(500).json({ 
        error: 'Failed to parse Gemini response as JSON',
        geminiResponse: geminiResult.candidates[0].content.parts[0].text.substring(0, 500),
        parseError: parseError.message
      });
    }

    // Validate response structure
    if (!structuredJson.Model && !structuredJson.Dataset) {
      console.error('Invalid structure - no Model or Dataset key found');
      return res.status(500).json({ 
        error: 'Invalid response structure - missing Model or Dataset key',
        response: structuredJson
      });
    }

    console.log('PDF processing completed successfully');
    
    // 5. Send the structured JSON back to the frontend
    res.status(200).json(structuredJson);

  } catch (error) {
    console.error('Backend error:', error);
    res.status(500).json({ 
      error: 'Failed to process PDF',
      details: error.message 
    });
  }
}