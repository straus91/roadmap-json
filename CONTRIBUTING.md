# Contributing to ROADMAP Model Card Editor

Thank you for your interest in contributing to the ROADMAP Model Card Editor! This project helps create standardized documentation for AI models and datasets in medical imaging.

## 🚀 Quick Start for Contributors

### Development Setup

1. **Clone the repository**:
   ```bash
   git clone https://github.com/your-username/roadmap-card-editor.git
   cd roadmap-card-editor
   ```

2. **Start a development server**:
   ```bash
   # Python (recommended)
   python -m http.server 8000
   
   # Node.js
   npx http-server
   
   # PHP
   php -S localhost:8000
   ```

3. **Open in browser**: http://localhost:8000

### Project Structure

```
roadmap-card-editor/
├── index.html              # Main application
├── css/style.css           # Styling
├── js/
│   ├── schema.js          # Form generation
│   └── app.js             # Core logic
├── LICENSE                # MIT License
└── README.md              # Documentation
```

## 🛠️ Types of Contributions

### 1. **Bug Reports**
- Use GitHub Issues to report bugs
- Include browser version, steps to reproduce, and screenshots
- Test with the latest version

### 2. **Feature Requests**
- Suggest new features that align with ROADMAP standards
- Consider both technical and non-technical users
- Provide use cases and mockups if possible

### 3. **Code Contributions**

#### **Frontend Improvements**:
- UI/UX enhancements
- Better form validation
- Accessibility improvements
- Mobile responsiveness

#### **Schema Enhancements**:
- Support for new ROADMAP schema versions
- Better field organization
- Smart defaults and validation

#### **New Features**:
- Export to other formats (PDF, Word)
- Template system for common use cases
- Batch processing capabilities
- Integration with external APIs

### 4. **Documentation**
- Improve user guides
- Add developer documentation
- Create video tutorials
- Update schema documentation

## 📋 Development Guidelines

### **Code Style**
- Use consistent JavaScript ES6+ syntax
- Follow existing naming conventions
- Comment complex logic clearly
- Test across modern browsers

### **Schema Compliance**
- All changes must maintain ROADMAP schema compliance
- Test with official schema validation
- Preserve backward compatibility when possible

### **User Experience**
- Prioritize simplicity for non-technical users
- Provide clear error messages
- Include helpful tooltips and guidance
- Test with real-world use cases

## 🧪 Testing

### **Manual Testing Checklist**:
- [ ] Create new Model card from scratch
- [ ] Create new Dataset card from scratch  
- [ ] Load and edit existing JSON files
- [ ] Validate forms with missing data
- [ ] Download and verify JSON output
- [ ] Test on different screen sizes
- [ ] Test in Chrome, Firefox, Safari, Edge

### **Test Files**:
- Create test cases for edge cases
- Verify ROADMAP schema compliance

## 📝 Pull Request Process

1. **Fork the repository** and create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes**:
   - Follow coding standards
   - Update documentation if needed
   - Add/update tests as appropriate

3. **Test thoroughly**:
   - Run the application locally
   - Test your changes across browsers
   - Verify schema compliance

4. **Commit with clear messages**:
   ```bash
   git commit -m "Add: New field validation for email addresses"
   git commit -m "Fix: Checkbox selection bug in Use Cases"
   git commit -m "Update: README with new installation steps"
   ```

5. **Push and create Pull Request**:
   ```bash
   git push origin feature/your-feature-name
   ```
   - Provide clear description of changes
   - Include screenshots for UI changes
   - Reference related issues

## 🏷️ Schema Version Updates

When ROADMAP releases new schema versions:

1. **Add new schema definitions** to `js/schema.js`
2. **Test compatibility** with existing JSON files
3. **Update documentation** and examples
4. **Maintain backward compatibility** when possible

## 🤝 Community Guidelines

- **Be respectful** and constructive in discussions
- **Help others** with questions and issues  
- **Share knowledge** about ROADMAP standards
- **Consider the diverse user base** (clinical to technical)

## 📞 Getting Help

- **GitHub Issues**: For bugs and feature requests
- **Discussions**: For questions and general discussion
- **Documentation**: Check README and project docs first

## 🎯 Priority Areas

Current areas where contributions are especially welcome:

1. **Accessibility improvements** (WCAG compliance)
2. **Mobile responsiveness** enhancements
3. **Performance optimization** for large forms
4. **Better error messages** and user guidance
5. **Integration testing** with real ROADMAP files

## 🏆 Recognition

Contributors will be:
- Listed in the project README
- Credited in release notes
- Invited to provide feedback on major changes

Thank you for helping make ROADMAP model and dataset documentation better for the entire medical imaging community! 🚀