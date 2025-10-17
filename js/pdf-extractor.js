/**
 * Client-Side PDF Extractor for ROADMAP Model Card Editor
 * Uses PDF.js to extract text from PDFs directly in the browser
 */

/**
 * Extract text and metadata from a PDF file
 * @param {File} pdfFile - The PDF file to process
 * @param {Function} progressCallback - Optional callback for progress updates
 * @returns {Promise<Object>} - Extracted PDF data
 */
async function extractPdfData(pdfFile, progressCallback = null) {
    console.log('📄 Starting client-side PDF extraction...');
    console.log('📝 File:', pdfFile.name);
    console.log('📏 Size:', Math.round(pdfFile.size / 1024), 'KB');

    try {
        // Read the PDF file as ArrayBuffer
        const arrayBuffer = await pdfFile.arrayBuffer();

        // Load the PDF document
        if (progressCallback) progressCallback({ stage: 'loading', progress: 10, message: 'Loading PDF document...' });

        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
        const pdf = await loadingTask.promise;

        console.log('✅ PDF loaded successfully');
        console.log('📊 Total pages:', pdf.numPages);

        // Extract data from all pages
        let fullText = '';
        const tables = [];
        const metadata = {
            filename: pdfFile.name,
            filesize: pdfFile.size,
            numPages: pdf.numPages,
            extractedAt: new Date().toISOString()
        };

        // Process each page
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            if (progressCallback) {
                const progress = 10 + Math.floor((pageNum / pdf.numPages) * 80);
                progressCallback({
                    stage: 'extracting',
                    progress: progress,
                    message: `Extracting text from page ${pageNum} of ${pdf.numPages}...`
                });
            }

            console.log(`📄 Processing page ${pageNum}/${pdf.numPages}...`);

            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();

            // Extract text from page
            const pageText = textContent.items
                .map(item => item.str)
                .join(' ');

            fullText += pageText + '\n\n';

            // Try to detect tables (basic heuristic)
            const detectedTables = detectTablesInText(textContent, pageNum);
            tables.push(...detectedTables);
        }

        console.log('✅ PDF extraction complete');
        console.log('📝 Total text length:', fullText.length, 'characters');
        console.log('📋 Tables detected:', tables.length);

        if (progressCallback) progressCallback({ stage: 'complete', progress: 100, message: 'Extraction complete!' });

        return {
            text: fullText.trim(),
            tables: tables,
            images: [], // Client-side image extraction is complex, so we'll skip it for now
            metadata: {
                ...metadata,
                text_length: fullText.length,
                tables_count: tables.length,
                images_count: 0
            }
        };

    } catch (error) {
        console.error('❌ PDF extraction failed:', error);
        if (progressCallback) progressCallback({ stage: 'error', progress: 0, message: `Error: ${error.message}` });
        throw new Error(`Failed to extract PDF data: ${error.message}`);
    }
}

/**
 * Detect tables in text content (basic heuristic)
 * @param {Object} textContent - PDF.js text content
 * @param {number} pageNum - Page number
 * @returns {Array} - Detected tables
 */
function detectTablesInText(textContent, pageNum) {
    const tables = [];
    const items = textContent.items;

    // Basic table detection: Look for aligned text patterns
    // This is a simplified heuristic - real table detection is complex

    // Group items by Y coordinate (rows)
    const rowMap = new Map();
    items.forEach(item => {
        const y = Math.round(item.transform[5]); // Y coordinate
        if (!rowMap.has(y)) {
            rowMap.set(y, []);
        }
        rowMap.get(y).push(item);
    });

    // Look for rows with multiple columns
    const potentialRows = Array.from(rowMap.values())
        .filter(row => row.length >= 3) // At least 3 columns
        .map(row => row.sort((a, b) => a.transform[4] - b.transform[4])); // Sort by X coordinate

    if (potentialRows.length >= 3) {
        // Potential table found
        const tableData = {
            page: pageNum,
            headers: potentialRows[0].map(item => item.str.trim()),
            rows: potentialRows.slice(1).map(row => row.map(item => item.str.trim()))
        };

        // Only add if it looks like a real table
        if (tableData.headers.some(h => h.length > 0)) {
            tables.push(tableData);
            console.log(`📊 Table detected on page ${pageNum} with ${tableData.rows.length} rows`);
        }
    }

    return tables;
}

/**
 * Extract text from PDF using simpler approach (fallback)
 * @param {File} pdfFile - The PDF file to process
 * @returns {Promise<string>} - Extracted text
 */
async function extractPdfTextSimple(pdfFile) {
    const arrayBuffer = await pdfFile.arrayBuffer();
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    let fullText = '';

    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
        const page = await pdf.getPage(pageNum);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map(item => item.str).join(' ');
        fullText += pageText + '\n\n';
    }

    return fullText.trim();
}

/**
 * Validate PDF file
 * @param {File} file - File to validate
 * @returns {boolean} - True if valid PDF
 */
function validatePdfFile(file) {
    // Check if file exists
    if (!file) {
        throw new Error('No file provided');
    }

    // Check file type
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        throw new Error('Invalid file type. Please upload a PDF file.');
    }

    // Check file size (max 50MB for client-side processing)
    const maxSize = 50 * 1024 * 1024; // 50 MB
    if (file.size > maxSize) {
        throw new Error(`File too large (${Math.round(file.size / 1024 / 1024)}MB). Maximum size is 50MB.`);
    }

    // Check for empty file
    if (file.size === 0) {
        throw new Error('File is empty');
    }

    return true;
}
