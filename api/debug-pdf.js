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

function createDebugPrompt(documentData, processingMode = 'multimodal') {
  if (processingMode === 'text-only') {
    return `ROADMAP extraction from research paper PDF.

PROCESSING MODE: Text-only (images excluded)

DOCUMENT CONTENT:

TEXT CONTENT (${documentData.text.length} characters):
"""${documentData.text.substring(0, 10000)}${documentData.text.length > 10000 ? '\n\n... [text truncated for display]' : ''}"""

STRUCTURED TABLES (${documentData.tables.length} tables found):
${documentData.tables.length > 0 ? JSON.stringify(documentData.tables, null, 2) : 'No tables found in document'}

METADATA:
- Filename: ${documentData.metadata.filename}
- Text length: ${documentData.metadata.text_length} characters
- Tables extracted: ${documentData.metadata.tables_count}
- Processing mode: Text-only

[Note: This is a debug view showing text-only processing - images are not included]`;
  } else {
    return `ROADMAP extraction from research paper PDF.

PROCESSING MODE: Multimodal (text + tables + images)

DOCUMENT CONTENT:

TEXT CONTENT (${documentData.text.length} characters):
"""${documentData.text.substring(0, 8000)}${documentData.text.length > 8000 ? '\n\n... [text truncated for display]' : ''}"""

STRUCTURED TABLES (${documentData.tables.length} tables found):
${documentData.tables.length > 0 ? JSON.stringify(documentData.tables, null, 2) : 'No tables found in document'}

REFERENCED FIGURES (${documentData.images.length} selected):
${documentData.images.length > 0 ? 
  documentData.images.map(img => `- Figure ${img.figureNumber} (Page ${img.page}) - ${img.referenced ? 'Referenced in text' : 'Available'}`).join('\n') 
  : 'No figures available'}

METADATA:
- Filename: ${documentData.metadata.filename}
- Text length: ${documentData.metadata.text_length} characters
- Tables extracted: ${documentData.metadata.tables_count}
- Images selected: ${documentData.metadata.images_count}
- Processing mode: Multimodal

[Note: This is a debug view - in actual processing, images are included as base64 data]`;
  }
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
        // Extract tables
        if (page.tables) {
          page.tables.forEach((table, tableIndex) => {
            const tableData = {
              page: pageIndex + 1,
              tableIndex: tableIndex + 1,
              headers: [],
              rows: []
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
              extractedTables.push(tableData);
            }
          });
        }

        // Extract images/figures (placeholder for actual image data)
        if (page.images) {
          page.images.forEach((image, imageIndex) => {
            extractedImages.push({
              page: pageIndex + 1,
              imageIndex: imageIndex + 1,
              bounds: image.layout?.boundingPoly,
              hasBase64: !!image.image?.content
            });
          });
        }
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

    // Create the prompt that would be sent to Gemini (based on processing mode)
    const promptForGemini = createDebugPrompt(documentData, processingMode);

    console.log('✅ Debug processing complete');
    
    // Return all debug information
    res.status(200).json({
      extractedText,
      extractedTables,
      referencedImages,
      allImagesFound: extractedImages,
      figureReferences: allReferences,
      multimodalPrompt: promptForGemini,
      metadata: documentData.metadata,
      processing_summary: {
        pages_processed: document.pages?.length || 0,
        text_length: extractedText.length,
        tables_extracted: extractedTables.length,
        total_images_found: extractedImages.length,
        referenced_images_selected: referencedImages.length,
        prompt_length: promptForGemini.length,
        processing_mode: processingMode
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