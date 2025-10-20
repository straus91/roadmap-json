# 🏥 ROADMAP Model Card Editor

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Static Site](https://img.shields.io/badge/100%25-static-brightgreen.svg)]()

> **Create and edit ROADMAP-compliant JSON files for AI models and datasets in medical imaging.**

A modern web application with secure cloud backend that helps researchers document their AI models and datasets following the ROADMAP (Radiological AI Deployment for Medical Imaging) standard.

🌟 **[Try Live Demo](https://straus91.github.io/roadmap-json/)** - Now with secure cloud backend!

---

## 🎯 What is This?

This tool helps medical imaging researchers create **standardized documentation** for their AI models and datasets. The ROADMAP format ensures that critical information about models (like performance metrics, training data, and intended use) is captured in a structured, machine-readable format.

### Why Use This?

- ✅ **No coding required** - Fill out forms instead of writing JSON manually
- ✅ **AI-powered PDF extraction** - Upload a research paper and let AI extract the information
- ✅ **Secure backend** - API keys protected server-side, no configuration needed
- ✅ **Validates your data** - Catches errors before you publish
- ✅ **Free to use** - Deployed on GitHub Pages with AWS backend

---

## ✨ Key Features

### 📄 **AI-Powered PDF Extraction**
- Upload a PDF of your research paper
- AI automatically extracts model/dataset information
- **Secure AWS backend** - No API key configuration needed
- Supports both text-only and multimodal (images + text) processing
- Powered by Google Gemini 2.5 Pro

### 📝 **Three Ways to Create Cards**
1. **Create from PDF** - AI extracts info from research papers (new!)
2. **Create New Card** - Start with a blank form
3. **Load & Edit** - Upload and edit existing ROADMAP JSON files

### ✅ **Smart Validation**
- Real-time validation against ROADMAP schema
- Clear error messages
- Non-blocking warnings (can download even with validation errors)

### 🎨 **Flexible UI**
- Toggle between showing/hiding empty fields
- Live JSON preview
- Guided view for beginners, advanced view for experts

---

## 🚀 Quick Start

### Option 1: Use Online (Easiest)
Just visit: **[https://straus91.github.io/roadmap-json/](https://straus91.github.io/roadmap-json/)**

No installation or API key configuration needed!

### Option 2: Run Locally

```bash
# Clone the repo
git clone https://github.com/straus91/roadmap-json.git
cd roadmap-json

# Start any web server (no npm install needed!)
python -m http.server 8000
# or
npx http-server -p 8000

# Open in browser
open http://localhost:8000
```

**That's it!** No dependencies to install, no backend to configure.

---

## 📖 How to Use

### For PDF Extraction (Recommended)

1. **Upload your PDF**:
   - Choose Model or Dataset card type
   - Click "Select PDF File"
   - Click "Process PDF"

2. **Review and edit**:
   - AI pre-fills the form with extracted information
   - Review and correct any mistakes
   - Add missing details

3. **Download**:
   - Click "Validate" to check for errors
   - Click "Download JSON" to save your ROADMAP card

**That's it!** The secure backend handles all AI processing for you.

### For Manual Entry

1. Click "Create New Card"
2. Choose "Model Card" or "Dataset Card"
3. Fill out the form fields
4. Download your JSON

### For Editing Existing Cards

1. Click "Load & Edit Card"
2. Upload your existing ROADMAP JSON file
3. Make edits
4. Download the updated JSON

---

## 🛠️ Technology Stack

**Frontend**: Static site hosted on GitHub Pages
- **Client-Side**: HTML5, CSS3, JavaScript (ES6+)
- **UI Framework**: Bootstrap 4
- **Form Engine**: JSON Editor library
- **PDF Processing**: PDF.js (client-side)
- **Schema Validation**: JSON Schema (fetched from GitHub)

**Backend**: Secure AWS infrastructure
- **Compute**: AWS Lambda (Node.js 20)
- **API Gateway**: RESTful API with CORS
- **Secrets**: AWS Secrets Manager (API key storage)
- **Monitoring**: CloudWatch Logs & Alarms
- **AI Model**: Google Gemini 2.5 Pro

**All external dependencies loaded via CDN** - No npm install needed for frontend!

---

## 📁 Project Structure

```
roadmap-json/
├── index.html                  # Main application
├── css/
│   └── style.css              # Custom styling
├── js/
│   ├── app.js                 # Main application logic
│   ├── gemini-client.js       # AI PDF processing
│   ├── pdf-extractor.js       # Client-side PDF parsing
│   └── dynamic-schema.js      # Schema processor
├── examples/                   # Example ROADMAP files
├── DEPLOYMENT.md              # Deployment guide
└── README.md                  # This file
```

---

## 🚢 Deployment

**Frontend**: Static site deployed on GitHub Pages
- Live at: https://straus91.github.io/roadmap-json/
- Auto-deploys from `main` branch

**Backend**: AWS infrastructure deployed in us-west-2
- API Endpoint: `https://v928g5gem9.execute-api.us-west-2.amazonaws.com/prod/gemini`
- Managed via CloudFormation
- See [AWS Infrastructure Guide](aws-infrastructure/README.md) for details

For deployment instructions, see [DEPLOYMENT.md](DEPLOYMENT.md).

---

## 🔒 Privacy & Security

- **Secure backend** - API keys stored in AWS Secrets Manager (never exposed to users)
- **No analytics** - We don't track anything
- **HTTPS only** - All communication encrypted
- **Open source** - Audit the code yourself
- **Minimal data processing** - PDFs processed on-demand, nothing stored

Your PDF content is sent to the AWS backend, which forwards it to Google's Gemini API for processing. No data is stored permanently.

---

## 📚 About ROADMAP

ROADMAP (Radiological AI Deployment for Medical Imaging) is a standardized format for documenting AI models and datasets in medical imaging. It was developed by the RSNA (Radiological Society of North America) to ensure transparency and reproducibility in AI research.

**Learn more:**
- [ROADMAP GitHub Repository](https://github.com/cekahn/ROADMAP)
- [ROADMAP Specification](https://github.com/cekahn/ROADMAP/blob/main/README.md)

---

## 🤝 Contributing

Contributions welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **RSNA** for developing the ROADMAP standard
- **Google** for the Gemini API
- **JSON Editor** for the form generation library
- **PDF.js** by Mozilla for client-side PDF parsing

---

## 💬 Support

- 🐛 [Report bugs](https://github.com/straus91/roadmap-json/issues)
- 💡 [Request features](https://github.com/straus91/roadmap-json/issues)
- 📖 [Read the docs](https://github.com/straus91/roadmap-json/wiki)

---

**Made with ❤️ for the medical imaging AI community**
