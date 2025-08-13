// Safe PDF processing wrapper
export async function extractTextFromPDF(fileBuffer) {
  try {
    // Dynamic import to avoid initialization issues
    const pdfParse = await import('pdf-parse');
    const pdf = pdfParse.default || pdfParse;
    
    console.log('🔍 Starting PDF text extraction...');
    const data = await pdf(fileBuffer);
    
    console.log('✅ PDF parsed successfully');
    console.log('📊 Pages:', data.numpages);
    console.log('📝 Text length:', data.text.length, 'characters');
    
    return {
      text: data.text,
      pages: data.numpages,
      info: data.info
    };
    
  } catch (error) {
    console.error('❌ PDF extraction failed:', error.message);
    throw new Error(`PDF text extraction failed: ${error.message}`);
  }
}