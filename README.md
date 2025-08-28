# 🏥 ROADMAP Model Card Editor

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Vercel](https://img.shields.io/badge/demo-live-green.svg)](https://roadmap-json-extractor-e8vlz5526.vercel.app/)

> **A user-friendly web application for creating and editing ROADMAP-compliant JSON files for AI models and datasets in medical imaging.**

🌟 **[Try the Live Demo](https://roadmap-json-extractor-e8vlz5526.vercel.app/)** | 📖 **[Documentation](https://github.com/straus91/roadmap-json/wiki)** | 🐛 **[Report Issues](https://github.com/straus91/roadmap-json/issues)**

## ✨ Key Features

### 🎯 **Dynamic, Schema-Driven Form Generation**
- Reads official ROADMAP JSON schemas and dynamically generates web forms
- Clear controls for selecting card type (Model or Dataset)
- Schema descriptions displayed as tooltips and contextual help

### 🔄 **Dual-Input Workflow**
- **Create New Card**: Start with a blank form for manual input
- **Load & Edit Existing Card**: Upload and edit pre-populated ROADMAP JSON files
- Clear, visually distinct interface for workflow selection

### ✅ **Interactive Editing and Validation**
- Real-time validation with human-readable error messages
- Complex field UI for arrays of objects with intuitive controls
- Add/delete/reorder functionality for list items

### 📥 **Compliant JSON Export**
- One-click download of schema-compliant JSON files
- Automatic structure validation before export
- Properly formatted ROADMAP JSON output

### 👁️ **Smart UI Views**
- **Guided View**: Shows essential/required fields by default
- **Advanced View**: Option to show all available fields
- **Live JSON Preview**: Optional side panel showing generated JSON in real-time

## 🚀 Quick Start

### **Option 1: Use Online (Recommended)**
Visit the live demo: **[https://roadmap-json-extractor-e8vlz5526.vercel.app/](https://roadmap-json-extractor-e8vlz5526.vercel.app/)**

### **Option 2: Run Locally**

#### Prerequisites
- Modern web browser (Chrome, Firefox, Safari, Edge)
- Local web server (Python, Node.js, or any HTTP server)

#### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/straus91/roadmap-json.git
   cd roadmap-json
   ```

2. **Start a development server**:
   ```bash
   # Using Python (recommended)
   python -m http.server 8000
   
   # Or using Node.js
   npx http-server
   
   # Or using PHP
   php -S localhost:8000
   ```

3. **Open in browser**:
   ```
   http://localhost:8000
   ```

### Usage

1. **Choose your workflow**:
   - Click "Create New Card" to start from scratch
   - Click "Load & Edit Card" to upload an existing JSON file

2. **Select card type**:
   - Choose "Model Card" for AI/ML model documentation
   - Choose "Dataset Card" for dataset documentation

3. **Fill out the form**:
   - Use the guided view for essential fields
   - Switch to advanced view for complete control
   - Hover over field labels for help text

4. **Validate and export**:
   - Click "Validate" to check for errors
   - Click "Download JSON" to export your card

## 🛠️ Technology Stack

- **Frontend**: HTML5, CSS3, JavaScript (ES6+)
- **UI Framework**: Bootstrap 4
- **Form Generation**: JSON Editor library
- **Icons**: Font Awesome 4
- **Architecture**: Pure client-side application (no backend required)

## 📁 Project Structure

```
roadmap-card-editor/
├── index.html                      # Main application entry point
├── css/
│   └── style.css                   # Custom styling
├── js/
│   ├── app.js                      # Main application logic
│   └── schema.js                   # Schema processor for form generation
├── LICENSE                         # MIT License
└── README.md                       # This file
```