// api/process-pdf.js
import { IncomingForm } from 'formidable';
import { promises as fs } from 'fs';
import pdf from 'pdf-parse';
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

// Function to create intelligent prompt with full schema reference
function createEnhancedPrompt(extractedText, schemas) {
  const modelStructure = extractSchemaStructure(schemas.model, 'model');
  const datasetStructure = extractSchemaStructure(schemas.dataset, 'dataset');
  
  return `You are an expert AI system specialized in extracting structured information from medical imaging research papers and documents to populate ROADMAP (Radiology Ontology for AI Models, Datasets and Projects) cards.

TASK: Analyze the following extracted text and determine if it describes an AI MODEL or a DATASET, then extract structured information according to the exact ROADMAP schema format.

INSTRUCTIONS:
1. READ the entire text carefully
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

EXTRACTED TEXT:
"""${extractedText.substring(0, 12000)}"""

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

    // 3. Extract text from the PDF buffer
    const data = await pdf(fileContent);
    const extractedText = data.text;

    if (!extractedText || extractedText.trim().length === 0) {
      return res.status(400).json({ error: 'No text could be extracted from the PDF' });
    }

    console.log('Extracted text length:', extractedText.length, 'characters');

    // 4. Call Gemini API with enhanced prompt
    const apiKey = process.env.GEMINI_API_KEY || process.env.LLM_API_KEY;
    
    if (!apiKey) {
      return res.status(500).json({ error: 'Gemini API key not configured' });
    }

    const geminiApiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;
    
    const enhancedPrompt = createEnhancedPrompt(extractedText, schemas);
    console.log('Prompt length:', enhancedPrompt.length, 'characters');

    const requestBody = {
      contents: [{
        parts: [{
          text: enhancedPrompt
        }]
      }],
      generationConfig: {
        temperature: 0.2,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 4096,
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

    console.log('Sending request to Gemini API...');
    const geminiResponse = await fetch(geminiApiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!geminiResponse.ok) {
      const errorData = await geminiResponse.text();
      console.error('Gemini API Error:', errorData);
      return res.status(500).json({ 
        error: `Gemini API request failed with status ${geminiResponse.status}`,
        details: errorData.substring(0, 200)
      });
    }

    const geminiResult = await geminiResponse.json();
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