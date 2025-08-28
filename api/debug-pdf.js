// api/debug-pdf.js - Debug endpoint to show PDF processing pipeline
import { IncomingForm } from 'formidable';
import { promises as fs } from 'fs';
import path from 'path';
import { DocumentProcessorServiceClient } from '@google-cloud/documentai';

export const config = {
  api: {
    bodyParser: false,
  },
};

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
        console.log(`🚫 DEBUG Page ${pageIndex + 1}: Discarding giant single-cell table (${singleCellText.length} chars)`);
        isValidTable = false;
      }
    }
    
    // Check 2: Bounding box overlap with images
    if (isValidTable && table.boundingPoly) {
      for (const image of images) {
        if (image.bounds && boundingBoxesOverlap(table.boundingPoly, image.bounds)) {
          console.log(`🚫 DEBUG Page ${pageIndex + 1}: Discarding table overlapping with image`);
          isValidTable = false;
          break;
        }
      }
    }
    
    if (isValidTable) {
      filteredTables.push(table);
    }
  }
  
  console.log(`📊 DEBUG Page ${pageIndex + 1}: Filtered tables from ${tables.length} to ${filteredTables.length}`);
  return filteredTables;
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

// Function to find images referenced in the text
function findReferencedImages(text, images) {
  const referencedImages = [];
  
  const figurePatterns = [
    /Figure\s+(\d+)/gi,
    /Fig\.\s*(\d+)/gi,
    /Chart\s+(\d+)/gi,
    /Graph\s+(\d+)/gi,
    /Diagram\s+(\d+)/gi,
    /Image\s+(\d+)/gi
  ];
  
  const referencedNumbers = new Set();
  
  figurePatterns.forEach(pattern => {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      referencedNumbers.add(parseInt(match[1]));
    }
  });
  
  const maxImages = Math.min(3, images.length);
  
  images.slice(0, maxImages).forEach((image, index) => {
    const figureNumber = index + 1;
    if (referencedNumbers.has(figureNumber) || referencedNumbers.size === 0) {
      referencedImages.push({
        ...image,
        figureNumber: figureNumber,
        referenced: referencedNumbers.has(figureNumber)
      });
    }
  });
  
  return {
    referencedImages,
    allReferences: Array.from(referencedNumbers).sort()
  };
}

// Create enhanced debug prompt matching the production version
function createEnhancedDebugPrompt(documentData, cardType, processingMode) {
  return `You are an expert AI system specializing in high-detail, structured information extraction from medical imaging research papers to populate ROADMAP (Radiology Ontology for AI Models, Datasets and Projects) cards.

**Your task is to extract information for a ${cardType.toUpperCase()} card and perform a two-step process in a single pass:**
1.  **Internal Analysis (Chain of Thought):** First, you will mentally scan the entire document and extract all key entities, relationships, and data points. You will pay special attention to lists of people, organizations, and detailed data subsets.
2.  **JSON Formatting:** Second, using your internal analysis, you will meticulously construct the final JSON output, ensuring every possible field from the schema is populated with the information you found.

**CRITICAL INSTRUCTIONS FOR MAXIMUM DETAIL:**

* **Extract ALL Authors and Organizations:** Do not summarize. If there are 30 authors listed, extract all 30. For each, extract their name and any listed affiliation.
* **Deeply Nested Subsets:** For datasets, pay close attention to tables describing patient demographics or clinical characteristics. Each distinct group or subgroup mentioned (e.g., "Female," "Age 50-60," "Stage I lung cancer") must be converted into a separate, complete object within the "Subset" array, as seen in the examples.
* **Do Not Summarize Data:** Extract exact numerical values, statistical measures (like age ± standard deviation), and full descriptions.
* **Follow the Schema Exactly:** The final output must be ONLY a valid JSON object that strictly adheres to the provided schema structure.

**DOCUMENT CONTENT TO ANALYZE:**
"""${documentData.text.substring(0, processingMode === 'text-only' ? 8000 : 6000)}${documentData.text.length > (processingMode === 'text-only' ? 8000 : 6000) ? '\n\n... [text continues but truncated for debug display]' : ''}"""

**STRUCTURED TABLES:**
${JSON.stringify(documentData.tables, null, 2)}

**OUTPUT (Valid JSON only):**`;
}

// Legacy function for backwards compatibility  
function createExtractionPromptDebug(documentData, processingMode = 'multimodal') {
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
"""${documentData.text.substring(0, processingMode === 'text-only' ? 8000 : 6000)}${documentData.text.length > (processingMode === 'text-only' ? 8000 : 6000) ? '\n\n... [text continues but truncated for debug display]' : ''}"""

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

function createFormattingPromptDebug(extractedInformation) {
  return `You are an expert JSON formatting specialist. Your task is to take a pre-extracted structured summary of information and format it perfectly into the ROADMAP JSON schema format.

FORMATTING TASK:
Take the provided structured information summary and convert it into a valid ROADMAP JSON object following the exact schema specifications.

FORMATTING INSTRUCTIONS:
1. Use the document type identified in the summary (MODEL or DATASET)
2. Map ALL extracted information to the appropriate schema fields
3. Follow exact field names and data types as specified in the schema
4. Use proper JSON formatting with correct nesting structure
5. Fill in as many fields as possible from the extracted information
6. Set empty strings "" for text fields without information
7. Set empty arrays [] for array fields without information
8. Use appropriate default values for required fields
9. Maintain all numerical precision from the extracted data
10. Preserve all technical details and performance metrics

CRITICAL FORMATTING REQUIREMENTS:
- Return ONLY valid JSON (no markdown, no explanations, no additional text)
- Use exact field names from schema (case-sensitive)
- Follow proper nesting structure exactly as shown
- Include required fields even if empty
- Use appropriate data types (string, number, array, object)
- For arrays of strings: ["item1", "item2"]
- For arrays of objects: [{"field": "value"}]
- For nested objects: {"field": {"nested": "value"}}

EXTRACTED INFORMATION TO FORMAT:

${extractedInformation.substring(0, 5000)}${extractedInformation.length > 5000 ? '\n\n... [extraction continues but truncated for debug display]' : ''}

OUTPUT (Valid JSON only):`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('🔍 DEBUG API: Starting PDF analysis...');

    // Parse the PDF file
    const form = new IncomingForm();
    const { files, fields } = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) return reject(err);
        resolve({ files, fields });
      });
    });

    // Get processing mode (default to multimodal for backward compatibility)
    const processingMode = fields.mode?.[0] || 'multimodal';
    console.log('🔍 DEBUG: Processing mode:', processingMode);
    
    // Get card type (default to model for backward compatibility)
    const cardType = fields.cardType?.[0] || 'model';
    console.log('🔍 DEBUG: Card type:', cardType);

    const pdfFile = files.pdf[0];
    if (!pdfFile) {
      return res.status(400).json({ error: 'No PDF file uploaded' });
    }

    const fileContent = await fs.readFile(pdfFile.filepath);
    console.log('📄 File loaded:', pdfFile.originalFilename, Math.round(fileContent.length / 1024) + 'KB');

    // Initialize Document AI
    const googleCloudKey = process.env.GOOGLE_CLOUD_KEY;
    const processorId = process.env.DOCUMENT_AI_PROCESSOR_ID;
    const location = 'us';
    
    if (!googleCloudKey || !processorId) {
      return res.status(500).json({ 
        error: 'Google Document AI not configured',
        details: 'Missing GOOGLE_CLOUD_KEY or DOCUMENT_AI_PROCESSOR_ID'
      });
    }

    console.log('🤖 Initializing Document AI client...');
    const credentials = JSON.parse(Buffer.from(googleCloudKey, 'base64').toString());
    const client = new DocumentProcessorServiceClient({
      credentials,
      projectId: credentials.project_id
    });

    const name = `projects/${credentials.project_id}/locations/${location}/processors/${processorId}`;

    console.log('📊 Processing PDF with Document AI...');
    const [result] = await client.processDocument({
      name,
      rawDocument: {
        content: fileContent.toString('base64'),
        mimeType: 'application/pdf',
      },
    });

    const { document } = result;
    
    // Extract text
    let extractedText = document.text || '';
    
    // Extract tables
    let extractedTables = [];
    let extractedImages = [];
    
    if (document.pages) {
      document.pages.forEach((page, pageIndex) => {
        const pageImages = [];
        const pageTables = [];
        
        // First pass: Extract all images from this page
        if (page.images) {
          page.images.forEach((image, imageIndex) => {
            pageImages.push({
              page: pageIndex + 1,
              imageIndex: imageIndex + 1,
              bounds: image.layout?.boundingPoly,
              hasBase64: !!image.image?.content
            });
          });
        }

        // Also extract visual elements (figures, charts)
        if (page.visualElements) {
          page.visualElements.forEach((element, elementIndex) => {
            if (element.layout) {
              pageImages.push({
                page: pageIndex + 1,
                elementIndex: elementIndex + 1,
                type: element.type || 'visual_element',
                bounds: element.layout.boundingPoly,
                hasBase64: false
              });
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

    // Find referenced images
    const { referencedImages, allReferences } = findReferencedImages(extractedText, extractedImages);
    
    // Create document data structure
    const documentData = {
      text: extractedText,
      tables: extractedTables,
      images: referencedImages,
      metadata: {
        filename: pdfFile.originalFilename,
        text_length: extractedText.length,
        tables_count: extractedTables.length,
        images_count: referencedImages.length,
        total_images_found: extractedImages.length,
        figure_references: allReferences
      }
    };

    // Create the enhanced single prompt that would be sent to Gemini
    const enhancedPrompt = createEnhancedDebugPrompt(documentData, cardType, processingMode);

    console.log('✅ Debug processing complete - Two-step workflow analysis ready');
    
    // Return comprehensive debug information showing both steps
    res.status(200).json({
      // Document extraction results (same as before)
      extractedText,
      extractedTables,
      referencedImages,
      allImagesFound: extractedImages,
      figureReferences: allReferences,
      
      // Enhanced single-step workflow prompt  
      enhanced_prompt: enhancedPrompt,
      
      // Enhanced metadata
      metadata: documentData.metadata,
      processing_summary: {
        pages_processed: document.pages?.length || 0,
        text_length: extractedText.length,
        tables_extracted: extractedTables.length,
        total_images_found: extractedImages.length,
        referenced_images_selected: referencedImages.length,
        processing_mode: processingMode,
        card_type: cardType,
        workflow_type: 'enhanced_single_step_chain_of_thought',
        enhanced_prompt_length: enhancedPrompt.length
      }
    });

  } catch (error) {
    console.error('🔍 DEBUG API Error:', error);
    res.status(500).json({ 
      error: 'Debug processing failed',
      details: error.message,
      stack: error.stack?.substring(0, 500)
    });
  }
}