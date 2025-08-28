// api/process-pdf.js
import { IncomingForm } from 'formidable';
import { promises as fs } from 'fs';
import path from 'path';

// This disables the default body parser to allow formidable to handle the file stream
export const config = {
  api: {
    bodyParser: false,
  },
};

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

// Function to create intelligent prompt with full schema reference
function createEnhancedPrompt(extractedText, schemas) {
  const modelStructure = extractSchemaStructure(schemas.model, 'model');
  const datasetStructure = extractSchemaStructure(schemas.dataset, 'dataset');
  
  return `You are an expert AI system specialized in extracting structured information from medical imaging research papers and documents to populate ROADMAP (Radiology Ontology for AI Models, Datasets and Projects) cards.

TASK: Analyze the following structured JSON data extracted from a PDF and determine if it describes an AI MODEL or a DATASET, then extract structured information according to the exact ROADMAP schema format.

INSTRUCTIONS:
1. READ the structured JSON data carefully - it contains organized content from a research paper PDF
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

STRUCTURED PDF DATA:
"""${extractedText.substring(0, 15000)}"""

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
    const { files } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ files });
      });
    });

    const pdfFile = files.pdf[0];
    if (!pdfFile) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    console.log('Processing PDF file:', pdfFile.originalFilename);
    const fileContent = await fs.readFile(pdfFile.filepath);

    // 3. Extract text using PDF.co API
    const pdfcoApiKey = process.env.PDFCO_API_KEY;
    
    if (!pdfcoApiKey) {
      return res.status(500).json({ error: 'PDF.co API key not configured' });
    }

    let extractedText = '';
    try {
      console.log('Step 1: Uploading PDF to PDF.co...');
      
      // Step 1: Upload PDF file to PDF.co
      const uploadResponse = await fetch('https://api.pdf.co/v1/file/upload', {
        method: 'POST',
        headers: {
          'x-api-key': pdfcoApiKey
        },
        body: (() => {
          const formData = new FormData();
          formData.append('file', new Blob([fileContent], { type: 'application/pdf' }), pdfFile.originalFilename);
          return formData;
        })()
      });

      if (!uploadResponse.ok) {
        const errorData = await uploadResponse.text();
        console.error('PDF.co Upload Error:', errorData);
        return res.status(500).json({ 
          error: `PDF.co upload failed with status ${uploadResponse.status}`,
          details: errorData.substring(0, 200)
        });
      }

      const uploadResult = await uploadResponse.json();
      
      if (uploadResult.error) {
        console.error('PDF.co upload error:', uploadResult.message);
        return res.status(500).json({ 
          error: 'PDF.co upload failed',
          details: uploadResult.message
        });
      }

      const uploadedFileUrl = uploadResult.url;
      console.log('Step 1 complete: PDF uploaded, URL:', uploadedFileUrl.substring(0, 50) + '...');
      
      // Step 2: Extract AI-enhanced text from uploaded PDF
      console.log('Step 2: Extracting AI-enhanced text from uploaded PDF...');
      
      const pdfcoResponse = await fetch('https://api.pdf.co/v1/pdf/convert/to/text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': pdfcoApiKey
        },
        body: JSON.stringify({
          url: uploadedFileUrl,
          inline: true,
          pages: "0-",
          async: false,
          lang: "eng",
          ocrAccuracy: "balanced",
          unwrap: true,
          removeTextShadows: true,
          detectTables: true,
          cleanupAndEnhanceText: true
        })
      });

      if (!pdfcoResponse.ok) {
        const errorData = await pdfcoResponse.text();
        console.error('PDF.co AI Text Extraction Error:', errorData);
        return res.status(500).json({ 
          error: `PDF.co AI text extraction failed with status ${pdfcoResponse.status}`,
          details: errorData.substring(0, 200)
        });
      }

      const pdfcoResult = await pdfcoResponse.json();
      console.log('PDF.co AI text extraction response received');

      if (pdfcoResult.error) {
        console.error('PDF.co AI text extraction error:', pdfcoResult.message);
        return res.status(500).json({ 
          error: 'PDF.co AI text extraction failed',
          details: pdfcoResult.message
        });
      }

      extractedText = pdfcoResult.body || '';
      console.log('Step 2 complete: AI-enhanced text extraction completed');
      console.log('Raw text length:', extractedText.length);
      console.log('Page count:', pdfcoResult.pageCount);
      console.log('AI enhancements applied: unwrap, cleanup, table detection');

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
    
    const enhancedPrompt = createEnhancedPrompt(extractedText, schemas);
    
    // Call Gemini API with retry logic
    const geminiResult = await callGeminiAPI(geminiApiUrl, enhancedPrompt, {
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