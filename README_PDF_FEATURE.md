# PDF Processing Feature - Setup Instructions

## Overview
This feature allows users to upload PDF documents (research papers, reports) and automatically extract structured information to populate ROADMAP Model Card or Dataset Card forms using AI/LLM processing.

## Features Added
1. **New PDF Upload Card** - Added to the main interface alongside existing options
2. **Backend API** - Serverless function for PDF processing (`/api/process-pdf`)
3. **Frontend Integration** - JavaScript functions to handle PDF upload and form population
4. **Error Handling** - Comprehensive validation and error reporting

## Requirements
- Node.js 18+
- Vercel account (for deployment)
- Google Gemini API key

## Setup Instructions

### 1. Environment Variables
Create a `.env.local` file in the root directory with:
```
GEMINI_API_KEY=your_gemini_api_key_here
# OR use generic LLM_API_KEY if using different provider
LLM_API_KEY=your_gemini_api_key_here
```

### 1.1. Getting a Gemini API Key
1. Go to https://aistudio.google.com/app/apikey
2. Sign in with your Google account
3. Click "Create API Key"
4. Copy the key and paste it in your `.env.local` file

### 2. Local Development
```bash
# Install dependencies (already done)
npm install

# Start local development server
npx vercel dev
```

### 3. Deployment to Vercel
```bash
# Login to Vercel
npx vercel login

# Set environment variables in Vercel dashboard or CLI
npx vercel env add GEMINI_API_KEY

# Deploy
npx vercel --prod
```

## Usage
1. Users see three options on the main screen:
   - **Create New Card** (existing)
   - **Load & Edit Card** (existing) 
   - **Create from PDF** (NEW)

2. When "Upload PDF" is clicked:
   - File validation (PDF format, max 10MB)
   - Upload to `/api/process-pdf`
   - PDF text extraction using pdf-parse
   - LLM processing to extract structured data
   - Automatic form population
   - User can review/edit before saving

## API Endpoint
- **POST** `/api/process-pdf`
- Accepts: `multipart/form-data` with PDF file
- Returns: JSON with extracted model/dataset information
- Timeout: 30 seconds

## File Structure Added
```
/api/
  process-pdf.js       # Serverless function
package.json           # Dependencies
vercel.json           # Vercel configuration
```

## Error Handling
- File validation (type, size)
- API key validation
- PDF parsing errors
- LLM API errors
- Network errors
- Graceful fallbacks with user-friendly messages

## Testing
To test the feature:
1. Start local server: `npx vercel dev`
2. Open browser to local URL
3. Click "Create from PDF" 
4. Upload a research paper PDF
5. Verify extracted information populates the form correctly

## Enhanced Features (NEW)
- **Dynamic Schema Loading**: Automatically reads ROADMAP schema files for accurate extraction
- **Intelligent Prompting**: Uses full schema structure as reference for precise field mapping
- **Gemini AI Integration**: Leverages Google's Gemini 1.5 Flash model for superior performance
- **Comprehensive Field Coverage**: Extracts 50+ fields vs. original 6-8 fields
- **Schema-Aware Validation**: Ensures output matches exact ROADMAP format requirements

## Notes
- The enhanced prompt includes complete ROADMAP schema structure as reference
- Dynamically loads and parses both model and dataset schemas
- Uses Google Gemini 1.5 Flash for state-of-the-art extraction accuracy
- Text extraction increased to 12,000 characters for better coverage
- Comprehensive error handling and response validation