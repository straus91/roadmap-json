// DOI extraction utility for research papers
export function extractDOI(text) {
  try {
    // Common DOI patterns in academic papers
    const doiPatterns = [
      // Standard DOI format: DOI: 10.xxxx/xxxxx
      /DOI:\s*(\d{2}\.\d{4,}\/[^\s]+)/gi,
      // doi: format
      /doi:\s*(\d{2}\.\d{4,}\/[^\s]+)/gi,
      // https://doi.org/ format
      /https?:\/\/doi\.org\/(\d{2}\.\d{4,}\/[^\s]+)/gi,
      // dx.doi.org format
      /https?:\/\/dx\.doi\.org\/(\d{2}\.\d{4,}\/[^\s]+)/gi,
      // Direct DOI without prefix
      /(?:^|\s)(\d{2}\.\d{4,}\/[^\s]+)(?:\s|$)/gm
    ];

    const foundDOIs = new Set();
    
    for (const pattern of doiPatterns) {
      let match;
      while ((match = pattern.exec(text)) !== null) {
        let doi = match[1].trim();
        
        // Clean up common trailing characters
        doi = doi.replace(/[.,;:)\]}>]*$/, '');
        
        // Validate DOI format (basic validation)
        if (isValidDOI(doi)) {
          foundDOIs.add(doi);
        }
      }
    }

    // Convert Set to Array and sort by length (prefer longer, more specific DOIs)
    const doiArray = Array.from(foundDOIs).sort((a, b) => b.length - a.length);
    
    console.log('📋 Found DOIs:', doiArray);
    return doiArray;
    
  } catch (error) {
    console.error('❌ DOI extraction error:', error.message);
    return [];
  }
}

// Basic DOI validation
function isValidDOI(doi) {
  // DOI should start with 10. followed by registrant code and suffix
  const doiRegex = /^10\.\d{4,}\/[^\s]+$/;
  
  // Additional checks
  const isValidFormat = doiRegex.test(doi);
  const hasReasonableLength = doi.length >= 10 && doi.length <= 200;
  const hasValidCharacters = !/[<>{}|\\^`\[\]"]/.test(doi);
  
  return isValidFormat && hasReasonableLength && hasValidCharacters;
}

// Sanitize DOI for use as filename
export function sanitizeDOI(doi) {
  return doi.replace(/[\/\\:*?"<>|]/g, '_');
}

// Extract paper metadata from text
export function extractPaperMetadata(text, doi) {
  try {
    const metadata = {
      doi: doi,
      title: extractTitle(text),
      authors: extractAuthors(text),
      journal: extractJournal(text),
      year: extractYear(text),
      abstract: extractAbstract(text)
    };
    
    console.log('📄 Extracted metadata:', {
      doi: metadata.doi,
      title: metadata.title?.substring(0, 100) + '...',
      authors: metadata.authors?.slice(0, 3),
      journal: metadata.journal,
      year: metadata.year
    });
    
    return metadata;
  } catch (error) {
    console.error('❌ Metadata extraction error:', error.message);
    return { doi: doi };
  }
}

function extractTitle(text) {
  // Look for title patterns at the beginning of the document
  const titlePatterns = [
    // Title on its own line, often in caps or title case
    /^([A-Z][^.!?]*(?:[.!?][A-Z][^.!?]*){0,10})\s*$/m,
    // After common prefixes
    /(?:Title|TITLE):\s*([^\n]+)/i,
    // First substantial line that looks like a title
    /^\s*([A-Z][A-Za-z\s,:-]+(?:AI|ML|Deep Learning|Neural|Model|Dataset|MRI|CT|X-ray)[A-Za-z\s,:-]*)\s*$/m
  ];

  for (const pattern of titlePatterns) {
    const match = text.match(pattern);
    if (match && match[1].length > 20 && match[1].length < 300) {
      return match[1].trim();
    }
  }
  
  // Fallback: get first meaningful line
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 10);
  return lines[0]?.substring(0, 200) || 'Unknown Title';
}

function extractAuthors(text) {
  // Look for author patterns
  const authorPatterns = [
    // Common author list patterns
    /Authors?:\s*([^\n]+)/i,
    // Names with degrees/affiliations
    /([A-Z][a-z]+\s+[A-Z][a-z]+(?:,\s*[A-Z][a-z]+\s*[A-Z][a-z]+)*)/g
  ];

  for (const pattern of authorPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].split(/[,;&]/).map(author => author.trim()).slice(0, 10);
    }
  }
  
  return [];
}

function extractJournal(text) {
  // Look for journal name patterns
  const journalPatterns = [
    /Journal of ([^.\n]+)/i,
    /([A-Z][a-z]+\s+(?:Journal|Review|Medicine|Radiology|Imaging))/i,
    /Published in:\s*([^\n]+)/i
  ];

  for (const pattern of journalPatterns) {
    const match = text.match(pattern);
    if (match) {
      return match[1].trim();
    }
  }
  
  return null;
}

function extractYear(text) {
  // Look for publication year
  const yearPatterns = [
    /(?:20\d{2})/g,
    /Published:?\s*(20\d{2})/i,
    /Copyright.*?(20\d{2})/i
  ];

  const years = new Set();
  for (const pattern of yearPatterns) {
    const matches = text.matchAll(pattern);
    for (const match of matches) {
      const year = parseInt(match[1] || match[0]);
      if (year >= 2010 && year <= new Date().getFullYear()) {
        years.add(year);
      }
    }
  }
  
  // Return the most recent reasonable year
  return years.size > 0 ? Math.max(...years) : null;
}

function extractAbstract(text) {
  // Look for abstract section
  const abstractPatterns = [
    /Abstract[:\s]*\n((?:(?!\n(?:Keywords|Introduction|1\.|Methods)).)*)/is,
    /ABSTRACT[:\s]*\n((?:(?!\n(?:KEYWORDS|INTRODUCTION|1\.|METHODS)).)*)/is
  ];

  for (const pattern of abstractPatterns) {
    const match = text.match(pattern);
    if (match && match[1].length > 50) {
      return match[1].trim().substring(0, 1000);
    }
  }
  
  return null;
}