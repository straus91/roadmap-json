// ROADMAP Model Card Editor - Production Version

// Global variables
let editor = null;
let currentCardType = null;
let isJsonPreviewVisible = false;
let schemaProcessor = null;

// Application initialization
document.addEventListener('DOMContentLoaded', function() {
    console.log('ROADMAP Model Card Editor initialized');
    
    // Initialize dynamic schema processor
    schemaProcessor = new DynamicSchemaProcessor();
    
    // Initialize file input handler
    initializeFileHandler();
    
    // Set up JSON Editor defaults
    setupJsonEditorDefaults();
    
    console.log('✅ Application ready');
});

// JSON Editor configuration
function setupJsonEditorDefaults() {
    JSONEditor.defaults.options.theme = 'bootstrap4';
    JSONEditor.defaults.options.iconlib = 'fontawesome4';
    JSONEditor.defaults.options.show_errors = 'interaction';
    JSONEditor.defaults.options.required_by_default = false;
    JSONEditor.defaults.options.keep_oneof_values = false;
    JSONEditor.defaults.options.prompt_before_delete = true;
    
    // Custom language strings
    if (!JSONEditor.defaults.languages.en) {
        JSONEditor.defaults.languages.en = {};
    }
    
    const lang = JSONEditor.defaults.languages.en;
    lang.button_add = "Add Item";
    lang.button_delete = "Delete";
    lang.button_delete_last = "Delete Last";
    lang.button_move_up = "Move Up";
    lang.button_move_down = "Move Down";
}

// Navigation functions
function showCardTypeSelection(action) {
    document.getElementById('initial-screen').style.display = 'none';
    document.getElementById('card-type-selection').style.display = 'block';
}

function showFileUpload() {
    document.getElementById('initial-screen').style.display = 'none';
    document.getElementById('file-upload-section').style.display = 'block';
}

function goBack() {
    // Hide all sections
    document.getElementById('card-type-selection').style.display = 'none';
    document.getElementById('file-upload-section').style.display = 'none';
    document.getElementById('editor-section').style.display = 'none';
    
    // Show initial screen
    document.getElementById('initial-screen').style.display = 'block';
    
    // Clean up editor if it exists
    if (editor) {
        try {
            editor.destroy();
        } catch (e) {
            console.log('Editor cleanup:', e);
        }
        editor = null;
    }
    
    resetForm();
}

function startOver() {
    if (confirm('Are you sure you want to start over? All unsaved changes will be lost.')) {
        goBack();
    }
}

// Editor initialization
function startEditor(cardType) {
    currentCardType = cardType;
    
    console.log(`Starting editor for ${cardType}`);
    
    // Hide selection screen and show editor
    document.getElementById('card-type-selection').style.display = 'none';
    document.getElementById('editor-section').style.display = 'block';
    
    // Update UI
    updateEditorUI(cardType);
    
    // Initialize editor
    initializeEditor();
}

function updateEditorUI(cardType) {
    const title = cardType.charAt(0).toUpperCase() + cardType.slice(1) + ' Card';
    document.getElementById('editor-title').textContent = title + ' Editor';
    document.getElementById('form-title').textContent = title + ' Information';
}

async function initializeEditor(initialData = null) {
    const editorHolder = document.getElementById('editor-holder');
    editorHolder.innerHTML = '<div class="text-center p-4"><div class="spinner-border text-primary" role="status"></div><p class="mt-2 text-muted">Loading schema...</p></div>';
    
    console.log(`Initializing editor for ${currentCardType}`);
    
    try {
        // Get custom schema URL if provided
        const customUrl = document.getElementById('custom-schema-url')?.value.trim() || null;
        
        // Get schema (base or custom)
        const schema = await schemaProcessor.getSchema(currentCardType, customUrl);
        
        if (!schema) {
            showAlert('Schema not available for ' + currentCardType + ' cards.', 'danger');
            return;
        }
        
        // Update schema info display
        updateSchemaInfo();
    
        // Clear loading indicator
        editorHolder.innerHTML = '';

        // Initialize JSON Editor
        editor = new JSONEditor(editorHolder, {
            schema: schema,
            startval: initialData || {},
            theme: 'bootstrap4',
            iconlib: 'fontawesome4',
            show_errors: 'interaction',
            required_by_default: false,
            keep_oneof_values: false,
            prompt_before_delete: true,
            no_additional_properties: false,
            disable_edit_json: true,
            disable_properties: false,
            show_opt_in: false,
            compact: false,
            object_layout: 'normal',
            // Additional options to help with dropdown rendering
            use_default_values: true,
            remove_empty_properties: false,
            array_controls_top: true,
            object_controls_top: false
        });
        
        // Editor event listeners
        editor.on('ready', function() {
            console.log('✅ Editor ready for', currentCardType);
            enableEditorControls();
            
            // Fix dropdown positioning issues
            fixDropdownOverlapIssues();
            
            // Add examples to form fields - wait longer for full form rendering
            setTimeout(() => {
                addExamplesToFields();
            }, 1500);
            
            
            // Expand all by default
            setTimeout(() => {
                if (editor && typeof editor.expandAll === 'function') {
                    try {
                        editor.expandAll();
                    } catch (e) {
                        console.log('Expand all skipped:', e);
                    }
                }
            }, 100);
        });
        
        editor.on('change', function() {
            updateJsonPreview();
        });
        
    } catch (error) {
        console.error('Error loading schema or initializing editor:', error);
        showAlert('Error: ' + error.message, 'danger');
        
        // Show fallback message
        editorHolder.innerHTML = '<div class="alert alert-warning"><i class="fa fa-exclamation-triangle mr-2"></i>Unable to load schema. Please check your connection or try a different schema URL.</div>';
    }
}

function enableEditorControls() {
    document.getElementById('validate-btn').disabled = false;
    document.getElementById('download-json-btn').disabled = false;
    document.getElementById('download-txt-btn').disabled = false;
}

// File handling
function initializeFileHandler() {
    const fileInput = document.getElementById('json-file-input');
    const fileLabel = document.querySelector('.custom-file-label');
    const loadBtn = document.getElementById('load-file-btn');
    
    fileInput.addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            fileLabel.textContent = file.name;
            
            const reader = new FileReader();
            reader.onload = function(e) {
                try {
                    const fileContent = e.target.result;
                    const jsonData = JSON.parse(fileContent);
                    const fileFormat = detectFileFormat(file.name, jsonData);
                    displayFilePreview(jsonData, fileFormat);
                    loadBtn.disabled = false;
                } catch (error) {
                    showAlert('Invalid file format. Please select a valid ROADMAP JSON or TXT file.', 'danger');
                    fileLabel.textContent = 'Choose file...';
                    loadBtn.disabled = true;
                    hideFilePreview();
                }
            };
            reader.readAsText(file);
        } else {
            fileLabel.textContent = 'Choose file...';
            loadBtn.disabled = true;
            hideFilePreview();
        }
    });
}

function displayFilePreview(jsonData, fileFormat) {
    const preview = document.getElementById('file-preview');
    const content = document.getElementById('file-content-preview');
    
    // Determine card type from JSON structure
    let detectedType = 'unknown';
    if (jsonData.Model || jsonData.model_name) {
        detectedType = 'model';
    } else if (jsonData.Dataset || jsonData.dataset_name) {
        detectedType = 'dataset';
    }
    
    content.innerHTML = `
        <strong>Format:</strong> ${fileFormat.toUpperCase()}<br>
        <strong>Type:</strong> ${detectedType.charAt(0).toUpperCase() + detectedType.slice(1)} Card<br>
        <strong>Size:</strong> ${JSON.stringify(jsonData).length} characters<br>
        <strong>Schema:</strong> ${jsonData.$schema || 'Detected from content'}
    `;
    
    preview.style.display = 'block';
    window.uploadedJsonData = jsonData;
    window.detectedCardType = detectedType;
    window.uploadedFileFormat = fileFormat;
}

function hideFilePreview() {
    document.getElementById('file-preview').style.display = 'none';
    window.uploadedJsonData = null;
    window.detectedCardType = null;
    window.uploadedFileFormat = null;
}

function loadFile() {
    if (!window.uploadedJsonData) {
        showAlert('No file data available to load.', 'danger');
        return;
    }
    
    const jsonData = window.uploadedJsonData;
    const cardType = window.detectedCardType;
    
    if (cardType === 'unknown') {
        showAlert('Unable to determine card type from the uploaded file.', 'danger');
        return;
    }
    
    // Set current card type and start editor
    currentCardType = cardType;
    
    // Hide upload section and show editor
    document.getElementById('file-upload-section').style.display = 'none';
    document.getElementById('editor-section').style.display = 'block';
    
    // Update UI
    updateEditorUI(cardType);
    
    // Extract the relevant data for the editor
    let editorData = {};
    
    if (window.uploadedFileFormat === 'txt') {
        // Convert TXT format to ROADMAP format
        editorData = convertTxtToRoadmapFormat(jsonData, cardType);
    } else {
        // Standard JSON format
        if (cardType === 'model' && jsonData.Model) {
            editorData = jsonData.Model;
        } else if (cardType === 'dataset' && jsonData.Dataset) {
            editorData = jsonData.Dataset;
        }
    }
    
    // Initialize editor with data
    initializeEditor(editorData);
}

// View management
function toggleView(viewType) {
    if (viewType === 'guided') {
        showAlert('Guided view - showing essential fields', 'info');
    } else if (viewType === 'advanced') {
        showAlert('Advanced view - showing all fields', 'info');
    }
}

function toggleJsonPreview() {
    isJsonPreviewVisible = !isJsonPreviewVisible;
    const panel = document.getElementById('json-preview-panel');
    
    if (isJsonPreviewVisible) {
        panel.style.display = 'block';
        updateJsonPreview();
    } else {
        panel.style.display = 'none';
    }
}

function updateJsonPreview() {
    if (!isJsonPreviewVisible || !editor) return;
    
    try {
        const data = editor.getValue();
        const previewContent = document.getElementById('json-preview-content');
        previewContent.textContent = JSON.stringify(data, null, 2);
    } catch (error) {
        console.error('Error updating JSON preview:', error);
        const previewContent = document.getElementById('json-preview-content');
        previewContent.textContent = 'Preview not available - editor still loading';
    }
}

// Validation
function validateForm(showSuccessMessage = true) {
    if (!editor) {
        showAlert('Editor not ready yet. Please wait a moment and try again.', 'warning');
        return false;
    }
    
    try {
        const errors = editor.validate();
        
        if (errors.length === 0) {
            if (showSuccessMessage) {
                showAlert('✅ Validation successful! Your card is valid.', 'success');
            }
            return true;
        } else {
            let errorMessage = 'Please fix the following validation errors:\n';
            errors.slice(0, 5).forEach(error => {  // Show max 5 errors
                errorMessage += `• ${error.path}: ${error.message}\n`;
            });
            if (errors.length > 5) {
                errorMessage += `... and ${errors.length - 5} more errors`;
            }
            showAlert(errorMessage, 'danger');
            return false;
        }
    } catch (error) {
        console.error('Validation error:', error);
        showAlert('Error during validation: ' + error.message, 'danger');
        return false;
    }
}

// Download functionality
function downloadJSON() {
    if (!editor) {
        showAlert('Editor not ready yet. Please wait and try again.', 'warning');
        return;
    }
    
    try {
        const editorData = editor.getValue();
        
        // Construct the complete ROADMAP JSON structure
        const roadmapData = {
            $schema: `ROADMAP-${currentCardType}-2025-05.json`
        };
        
        // Add the appropriate section
        if (currentCardType === 'model') {
            roadmapData.Model = editorData;
        } else if (currentCardType === 'dataset') {
            roadmapData.Dataset = editorData;
        }
        
        // Create and download file
        const jsonString = JSON.stringify(roadmapData, null, 2);
        const blob = new Blob([jsonString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `roadmap-${currentCardType}-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showAlert('✅ JSON file downloaded successfully!', 'success');
        
    } catch (error) {
        console.error('Download error:', error);
        showAlert('Error creating download file: ' + error.message, 'danger');
    }
}

// Utility functions
function showAlert(message, type = 'info', duration = 5000) {
    // Remove existing alerts
    const existingAlerts = document.querySelectorAll('.alert.custom-alert');
    existingAlerts.forEach(alert => alert.remove());
    
    // Create new alert
    const alert = document.createElement('div');
    alert.className = `alert alert-${type} alert-dismissible fade show custom-alert`;
    alert.style.position = 'fixed';
    alert.style.top = '20px';
    alert.style.right = '20px';
    alert.style.zIndex = '9999';
    alert.style.minWidth = '300px';
    alert.style.maxWidth = '500px';
    
    alert.innerHTML = `
        <div class="d-flex align-items-center">
            <div>
                ${getAlertIcon(type)}
                <span class="ml-2">${message.replace(/\n/g, '<br>')}</span>
            </div>
            <button type="button" class="close ml-auto" data-dismiss="alert">
                <span>&times;</span>
            </button>
        </div>
    `;
    
    document.body.appendChild(alert);
    
    // Auto-remove after duration
    if (duration > 0) {
        setTimeout(() => {
            if (alert.parentNode) {
                alert.remove();
            }
        }, duration);
    }
}

function getAlertIcon(type) {
    const icons = {
        success: '<i class="fa fa-check-circle"></i>',
        danger: '<i class="fa fa-exclamation-triangle"></i>',
        warning: '<i class="fa fa-exclamation-circle"></i>',
        info: '<i class="fa fa-info-circle"></i>'
    };
    return icons[type] || icons.info;
}

function resetForm() {
    currentCardType = null;
    isJsonPreviewVisible = false;
    
    // Reset file input
    const fileInput = document.getElementById('json-file-input');
    if (fileInput) {
        fileInput.value = '';
        document.querySelector('.custom-file-label').textContent = 'Choose file...';
    }
    
    // Hide preview
    hideFilePreview();
    
    // Reset buttons
    document.getElementById('load-file-btn').disabled = true;
    
    // Clear uploaded data
    window.uploadedJsonData = null;
    window.detectedCardType = null;
    window.uploadedFileFormat = null;
}

// File format detection
function detectFileFormat(fileName, jsonData) {
    if (fileName.toLowerCase().endsWith('.txt')) {
        return 'txt';
    } else if (fileName.toLowerCase().endsWith('.json')) {
        return 'json';
    }
    
    // Detect based on content structure
    if (jsonData.model_name || jsonData.dataset_name) {
        return 'txt'; // TXT format has these field names
    } else if (jsonData.Model || jsonData.Dataset) {
        return 'json'; // JSON format has these sections
    }
    
    return 'json'; // Default to JSON
}

// Convert TXT format to ROADMAP format
function convertTxtToRoadmapFormat(txtData, cardType) {
    if (cardType === 'model') {
        return convertTxtModelToRoadmap(txtData);
    } else if (cardType === 'dataset') {
        return convertTxtDatasetToRoadmap(txtData);
    }
    return txtData;
}

// Convert TXT model format to ROADMAP - COMPREHENSIVE MAPPING
function convertTxtModelToRoadmap(txtData) {
    const roadmapData = {
        // Basic Information
        Name: txtData.model_name || "",
        
        // Indexing and Content Codes
        "Indexing code": {
            Content: txtData.content_code || []
        },
        
        // Dates
        Date: {
            Created: txtData.date_created || ""
        },
        
        // License and Legal
        License: {
            Text: txtData.license || ""
        },
        
        // Funding
        Funding: txtData.funding || "",
        
        // Comments and Description
        Comments: [
            txtData.medical_task,
            txtData.model_architecture,
            txtData.model_code_availability ? `Code Availability: ${txtData.model_code_availability}` : null,
            txtData.sustainability ? `Sustainability: ${txtData.sustainability}` : null,
            txtData.time_to_train ? `Training Time: ${txtData.time_to_train}` : null,
            txtData.time_to_inference ? `Inference Time: ${txtData.time_to_inference}` : null,
            txtData.hardware_requirements ? `Hardware: ${txtData.hardware_requirements}` : null
        ].filter(Boolean).join('\n\n'),
        
        // Input/Output
        Input: txtData.model_architecture || "",
        Output: txtData.model_architecture || "",
        
        // Use Cases
        Use: {
            Intended: txtData.use_case || []
        },
        
        // Users
        User: {
            Intended: txtData.users || []
        },
        
        // Results - Comprehensive mapping
        Results: (txtData.results || []).map(result => ({
            "Result Information": result.result_description || result.result_name || "",
            Metric: Array.isArray(result.result_metric) ? result.result_metric : [result.result_metric || ""],
            Value: result.result_value || "",
            "Decision Threshold": result.result_decision_threshold || "",
            Subset: result.result_subset_data || ""
        })),
        
        // Limitations and Caveats
        Limitations: txtData.caveats || "",
        
        // Additional Technical Details (stored in Comments if no direct mapping)
        "Technical Details": {
            "Code Availability": txtData.model_code_availability || "NA",
            "Sustainability": txtData.sustainability || "NA", 
            "Training Time": txtData.time_to_train || "NA",
            "Inference Time": txtData.time_to_inference || "NA",
            "Hardware Requirements": txtData.hardware_requirements || "NA"
        }
    };
    
    // Remove empty technical details
    if (Object.values(roadmapData["Technical Details"]).every(v => v === "NA" || !v)) {
        delete roadmapData["Technical Details"];
    }
    
    return roadmapData;
}

// Convert TXT dataset format to ROADMAP - COMPREHENSIVE MAPPING
function convertTxtDatasetToRoadmap(txtData) {
    const roadmapData = {
        // Basic Information
        Name: txtData.dataset_name || "",
        
        // Indexing and Content Codes
        "Indexing code": {
            Content: extractContentCodesFromDataset(txtData)
        },
        
        // Composition - comprehensive mapping
        Composition: {
            "Number of instances": txtData.number_of_instances ? parseInt(txtData.number_of_instances) : 0,
            "Data type": ["Image"], // Default, could be inferred from imaging_details
            "Sample Size Calculation": txtData.representativeness || "",
            "Representativeness": {
                "Sample type": txtData.representativeness || "",
                "Population": txtData.subpopulations || "",
                "Verification": txtData.verification || ""
            }
        },
        
        // Imaging Details - comprehensive mapping
        Imaging: {
            "File format": txtData.file_format || ["DICOM"],
            "Resolution": txtData.resolution || "",
            "Burned-in PHI": txtData.burned_in_phi || "Unknown",
            "Pre-processing": txtData.imaging_details ? (Array.isArray(txtData.imaging_details) ? txtData.imaging_details.join('; ') : txtData.imaging_details) : ""
        },
        
        // Collection and Processing
        "Collection process": [
            txtData.collection_process,
            txtData.composition ? `Composition: ${txtData.composition}` : null,
            txtData.partioning_scheme ? `Partitioning: ${txtData.partioning_scheme}` : null
        ].filter(Boolean).join('\n\n'),
        
        // Data Quality and Issues
        Labeling: [
            txtData.labeling,
            txtData.missing_information ? `Missing Information: ${txtData.missing_information}` : null,
            txtData.noise ? `Noise Issues: ${txtData.noise}` : null,
            txtData.relationships_between_instances ? `Instance Relationships: ${txtData.relationships_between_instances}` : null
        ].filter(Boolean).join('\n\n'),
        
        // Privacy and Ethics
        "Ethical review": txtData.confidentiality || "",
        Confidentiality: [
            txtData.confidentiality,
            txtData.re_identification ? `Re-identification: ${txtData.re_identification}` : null
        ].filter(Boolean).join('\n\n'),
        
        // Research Context
        Comments: [
            txtData.motivation ? `Motivation: ${txtData.motivation}` : null,
            txtData.purpose ? `Purpose: ${txtData.purpose}` : null,
            txtData.external_data ? `External Data: ${txtData.external_data}` : null,
            txtData.dataset_availability ? `Availability: ${txtData.dataset_availability}` : null
        ].filter(Boolean).join('\n\n'),
        
        // License
        License: {
            Text: txtData.dataset_license || "Not specified"
        },
        
        // Partitions/Subsets - comprehensive mapping
        Subsets: (txtData.partitions || []).map(partition => ({
            "Subset name": partition.subset_name || "",
            "Subset description": partition.subset_description || "",
            "Number of instances": partition.number_instances || partition.patient_count || "",
            "Site count": partition.site_count || "",
            "Patient count": partition.patient_count || "",
            "Age": partition.age || "Not specified",
            "Sex": partition.sex || "Not specified", 
            "Demographic": partition.demographic || "",
            "Criterion": partition.criterion || ""
        }))
    };
    
    // Remove empty subsets if none exist
    if (!roadmapData.Subsets || roadmapData.Subsets.length === 0) {
        delete roadmapData.Subsets;
    }
    
    return roadmapData;
}

// Extract content codes from dataset TXT format
function extractContentCodesFromDataset(txtData) {
    // Try to infer content codes from imaging details or other fields
    const codes = [];
    
    if (txtData.imaging_details) {
        const details = Array.isArray(txtData.imaging_details) ? txtData.imaging_details.join(' ') : txtData.imaging_details;
        if (details.includes('CT') || details.includes('computed tomography')) {
            codes.push('CT - Computed Tomography');
        }
        if (details.includes('MRI') || details.includes('magnetic resonance')) {
            codes.push('MR - Magnetic Resonance');
        }
    }
    
    return codes.length > 0 ? codes : ['OT - Other'];
}

// Download TXT format
function downloadTXT() {
    if (!editor) {
        showAlert('Editor not ready yet. Please wait and try again.', 'warning');
        return;
    }
    
    try {
        const editorData = editor.getValue();
        
        // Convert to TXT format
        let txtData;
        if (currentCardType === 'model') {
            txtData = convertRoadmapToTxtModel(editorData);
        } else if (currentCardType === 'dataset') {
            txtData = convertRoadmapToTxtDataset(editorData);
        }
        
        // Create and download file
        const txtString = JSON.stringify(txtData, null, 0);
        const blob = new Blob([txtString], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `roadmap-${currentCardType}-${new Date().toISOString().split('T')[0]}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showAlert('✅ TXT file downloaded successfully!', 'success');
        
    } catch (error) {
        console.error('Download error:', error);
        showAlert('Error creating download file: ' + error.message, 'danger');
    }
}

// Convert ROADMAP model to TXT format - COMPREHENSIVE REVERSE MAPPING
function convertRoadmapToTxtModel(roadmapData) {
    // Extract technical details from Comments or Technical Details field
    const comments = roadmapData.Comments || "";
    const technicalDetails = roadmapData["Technical Details"] || {};
    
    const extractFromComments = (keyword) => {
        const match = comments.match(new RegExp(`${keyword}:\\s*([^\\n]+)`, 'i'));
        return match ? match[1].trim() : "NA";
    };
    
    return {
        model_name: roadmapData.Name || "",
        content_code: roadmapData["Indexing code"]?.Content || [],
        medical_task: roadmapData.Comments?.split('\n\n')[0] || roadmapData.Input || "",
        date_created: roadmapData.Date?.Created || "",
        license: roadmapData.License?.Text || "",
        funding: roadmapData.Funding || "",
        use_case: roadmapData.Use?.Intended || [],
        users: roadmapData.User?.Intended || [],
        results: (roadmapData.Results || []).map(result => ({
            result_name: result["Result Information"] || "",
            result_metric: Array.isArray(result.Metric) ? result.Metric[0] : result.Metric || "",
            result_value: result.Value || "",
            result_decision_threshold: result["Decision Threshold"] || "",
            result_description: result["Result Information"] || "",
            result_subset_data: result.Subset || ""
        })),
        caveats: roadmapData.Limitations || "",
        model_code_availability: technicalDetails["Code Availability"] || extractFromComments("Code Availability") || "NA",
        sustainability: technicalDetails["Sustainability"] || extractFromComments("Sustainability") || "NA",
        time_to_train: technicalDetails["Training Time"] || extractFromComments("Training Time") || "NA",
        time_to_inference: technicalDetails["Inference Time"] || extractFromComments("Inference Time") || "NA",
        hardware_requirements: technicalDetails["Hardware Requirements"] || extractFromComments("Hardware") || "NA",
        model_architecture: roadmapData.Input || roadmapData.Output || ""
    };
}

// Convert ROADMAP dataset to TXT format - COMPREHENSIVE REVERSE MAPPING  
function convertRoadmapToTxtDataset(roadmapData) {
    // Extract details from combined text fields
    const extractFromText = (text, keyword) => {
        if (!text) return "";
        const match = text.match(new RegExp(`${keyword}:\\s*([^\\n]+)`, 'i'));
        return match ? match[1].trim() : "";
    };
    
    const collectionText = roadmapData["Collection process"] || "";
    const labelingText = roadmapData.Labeling || "";
    const commentsText = roadmapData.Comments || "";
    const confidentialityText = roadmapData.Confidentiality || "";
    
    return {
        dataset_name: roadmapData.Name || "",
        imaging_details: roadmapData.Imaging?.["Pre-processing"] ? 
            roadmapData.Imaging["Pre-processing"].split('; ') : ["Image data"],
        file_format: roadmapData.Imaging?.["File format"] || ["DICOM"],
        resolution: roadmapData.Imaging?.Resolution || "",
        burned_in_phi: roadmapData.Imaging?.["Burned-in PHI"] || "Unknown",
        
        // Extract from combined labeling text
        labeling: labelingText.split('\n\n')[0] || "",
        missing_information: extractFromText(labelingText, "Missing Information"),
        relationships_between_instances: extractFromText(labelingText, "Instance Relationships"),
        noise: extractFromText(labelingText, "Noise Issues"),
        
        // Extract from comments
        external_data: extractFromText(commentsText, "External Data"),
        motivation: extractFromText(commentsText, "Motivation"),
        purpose: extractFromText(commentsText, "Purpose"),
        dataset_availability: extractFromText(commentsText, "Availability"),
        
        // Extract from confidentiality
        confidentiality: confidentialityText.split('\n\n')[0] || "",
        re_identification: extractFromText(confidentialityText, "Re-identification"),
        
        // Extract from collection process
        collection_process: collectionText.split('\n\n')[0] || "",
        composition: extractFromText(collectionText, "Composition"),
        partioning_scheme: extractFromText(collectionText, "Partitioning"),
        
        // From composition object
        subpopulations: roadmapData.Composition?.Representativeness?.Population || "",
        number_of_instances: roadmapData.Composition?.["Number of instances"] || 0,
        representativeness: roadmapData.Composition?.Representativeness?.["Sample type"] || 
                          roadmapData.Composition?.["Sample Size Calculation"] || "",
        verification: roadmapData.Composition?.Representativeness?.Verification || "",
        
        // License
        dataset_license: roadmapData.License?.Text || "Not specified",
        
        // Convert subsets back to partitions
        partitions: (roadmapData.Subsets || []).map(subset => ({
            subset_name: subset["Subset name"] || "",
            subset_description: subset["Subset description"] || "",
            site_count: subset["Site count"] || "1",
            patient_count: subset["Patient count"] || subset["Number of instances"] || "",
            number_instances: subset["Number of instances"] || subset["Patient count"] || "",
            age: subset.Age || "Not specified",
            sex: subset.Sex || "Not specified",
            demographic: subset.Demographic || "",
            criterion: subset.Criterion || ""
        }))
    };
}

// Schema management functions
function updateSchemaInfo() {
    if (!schemaProcessor || !currentCardType) return;
    
    const info = schemaProcessor.getSchemaInfo(currentCardType);
    const sourceElement = document.getElementById('schema-source');
    const versionElement = document.getElementById('schema-version');
    
    if (sourceElement && versionElement) {
        sourceElement.textContent = info.source;
        versionElement.textContent = info.version;
        
        // Add visual indicator for custom schemas
        if (info.isCustom) {
            sourceElement.innerHTML = '<i class="fa fa-cloud text-info mr-1"></i>' + info.source;
        } else {
            sourceElement.innerHTML = '<i class="fa fa-file text-success mr-1"></i>' + info.source;
        }
    }
}

async function loadCustomSchema() {
    const urlInput = document.getElementById('custom-schema-url');
    const customUrl = urlInput.value.trim();
    
    if (!customUrl) {
        showAlert('Please enter a schema URL', 'warning');
        return;
    }
    
    if (!currentCardType) {
        showAlert('Please select a card type first', 'warning');
        return;
    }
    
    // Show loading state
    showAlert('Loading custom schema...', 'info', 2000);
    
    try {
        // Reload editor with custom schema
        await initializeEditor();
        showAlert('✅ Custom schema loaded successfully!', 'success');
    } catch (error) {
        showAlert('Failed to load custom schema: ' + error.message, 'danger');
    }
}

function resetToBaseSchema() {
    if (!schemaProcessor || !currentCardType) return;
    
    // Clear custom URL
    const urlInput = document.getElementById('custom-schema-url');
    if (urlInput) urlInput.value = '';
    
    // Reset to base schema
    schemaProcessor.resetToBase(currentCardType);
    
    // Reload editor
    initializeEditor();
    showAlert('Reset to base schema', 'info');
}

// Fix dropdown overlap issues - Enhanced approach
function fixDropdownOverlapIssues() {
    setTimeout(() => {
        const editorContainer = document.getElementById('editor-holder');
        if (!editorContainer) return;
        
        // Apply comprehensive fixes
        applyDropdownContainerFixes(editorContainer);
        fixPropertyNameOverlap(editorContainer);
        handleSelectFocusEvents(editorContainer);
        
    }, 500);
    
    // Re-apply fixes when editor content changes
    setTimeout(() => {
        if (editor && editor.on) {
            editor.on('change', function() {
                setTimeout(() => fixDropdownOverlapIssues(), 100);
            });
        }
    }, 1000);
}

function applyDropdownContainerFixes(container) {
    // Force all containers to allow overflow
    const objectContainers = container.querySelectorAll('.well, .json-editor-object, .form-group, [data-schemapath]');
    objectContainers.forEach(element => {
        element.style.overflow = 'visible';
        element.style.position = 'relative';
        element.style.zIndex = 'auto';
    });
}

function fixPropertyNameOverlap(container) {
    // Find property name inputs and physically reorder them
    const propertyInputs = container.querySelectorAll('input[placeholder*="Property name"], .property-selector');
    propertyInputs.forEach(input => {
        const parentContainer = input.closest('.well, .json-editor-object, .form-group');
        if (parentContainer) {
            const selects = parentContainer.querySelectorAll('select');
            if (selects.length > 0) {
                // Create separator div to provide visual space
                let separator = input.parentNode.querySelector('.dropdown-separator');
                if (!separator) {
                    separator = document.createElement('div');
                    separator.className = 'dropdown-separator';
                    separator.style.cssText = 'height: 25px; clear: both; border-top: 1px solid #e9ecef; margin: 15px 0; background: #f8f9fa;';
                }
                
                // Move the input after selects
                const inputParent = input.parentNode;
                const lastSelect = selects[selects.length - 1];
                const selectParent = lastSelect.closest('.form-group') || lastSelect.parentNode;
                
                // Insert separator and then input
                selectParent.parentNode.insertBefore(separator, selectParent.nextSibling);
                selectParent.parentNode.insertBefore(inputParent, separator.nextSibling);
                
                // Style adjustments
                input.style.marginTop = '10px';
                input.style.position = 'relative';
                input.style.zIndex = '999';
                
                // Ensure select dropdowns have higher z-index
                selects.forEach(select => {
                    select.style.zIndex = '1050';
                    select.style.position = 'relative';
                    select.style.marginBottom = '15px';
                });
            }
        }
    });
}

function handleSelectFocusEvents(container) {
    const selectElements = container.querySelectorAll('select');
    
    selectElements.forEach(select => {
        // Remove any existing event listeners to avoid duplicates
        select.removeEventListener('focus', handleDropdownFocus);
        select.removeEventListener('blur', handleDropdownBlur);
        
        // Add enhanced event listeners
        select.addEventListener('focus', function() {
            handleDropdownFocus(this);
        });
        
        select.addEventListener('blur', function() {
            handleDropdownBlur(this);
        });
        
        // For Edge browser specifically - set explicit size for large dropdowns
        if (select.options.length > 8) {
            select.setAttribute('size', '1'); // Keep as dropdown, not listbox
            select.style.maxHeight = 'none'; // Let browser handle
        }
    });
}

function handleDropdownFocus(selectElement) {
    try {
        // Temporarily increase z-index during focus
        selectElement.style.zIndex = '2000';
        selectElement.style.position = 'relative';
        
        // Find and temporarily hide property name inputs in the same container
        const container = selectElement.closest('.well, .json-editor-object, .form-group');
        if (container) {
            const propertyInputs = container.querySelectorAll('input[placeholder*="Property name"], .property-selector');
            propertyInputs.forEach(input => {
                input.style.visibility = 'hidden';
                input.setAttribute('data-hidden-for-dropdown', 'true');
            });
        }
    } catch (error) {
        console.log('Dropdown focus handling failed:', error);
    }
}

function handleDropdownBlur(selectElement) {
    try {
        // Reset z-index after blur
        setTimeout(() => {
            selectElement.style.zIndex = '1050';
            
            // Restore visibility of property name inputs
            const container = selectElement.closest('.well, .json-editor-object, .form-group');
            if (container) {
                const hiddenInputs = container.querySelectorAll('input[data-hidden-for-dropdown="true"]');
                hiddenInputs.forEach(input => {
                    input.style.visibility = 'visible';
                    input.removeAttribute('data-hidden-for-dropdown');
                });
            }
        }, 150); // Small delay to allow dropdown to close
    } catch (error) {
        console.log('Dropdown blur handling failed:', error);
    }
}

// Add examples to form fields
function addExamplesToFields() {
    const editorContainer = document.getElementById('editor-holder');
    if (!editorContainer || !editor) {
        console.log('Editor container or editor not ready yet');
        setTimeout(() => addExamplesToFields(), 1000);
        return;
    }
    
    // Wait for actual form fields to be generated (not just structural elements)
    const checkForRealFields = () => {
        const realFields = editorContainer.querySelectorAll('[data-schemapath*="Name"], [data-schemapath*="Method"], [data-schemapath*="Version"], [data-schemapath*="License"]');
        
        if (realFields.length === 0) {
            console.log('Waiting for actual form fields to be generated...');
            setTimeout(checkForRealFields, 500);
            return;
        }
        
        console.log('=== Adding examples to fields ===');
        console.log(`Found ${realFields.length} actual form fields generated`);
        
        // Find all input fields with meaningful schema paths
        const meaningfulInputs = editorContainer.querySelectorAll('input[data-schemapath]:not([data-schemapath="root"]), textarea[data-schemapath]:not([data-schemapath="root"])');
        console.log(`Found ${meaningfulInputs.length} inputs with meaningful schema paths`);
        
        // Also find inputs within labeled containers (for nested objects)
        const containerInputs = editorContainer.querySelectorAll('[data-schemapath*="."] input, [data-schemapath*="."] textarea');
        console.log(`Found ${containerInputs.length} inputs in nested containers`);
        
        let examplesAdded = 0;
        
        // Combine all potential inputs
        const allInputs = [...meaningfulInputs, ...containerInputs];
        const uniqueInputs = [...new Set(allInputs)]; // Remove duplicates
        
        console.log(`Processing ${uniqueInputs.length} unique input fields`);
        
        uniqueInputs.forEach((input, index) => {
            const pathElement = input.closest('[data-schemapath]');
            const schemaPath = pathElement?.getAttribute('data-schemapath');
            console.log(`Input ${index}: type=${input.type}, path=${schemaPath}`);
            
            if (addExampleToField(input)) {
                examplesAdded++;
            }
        });
        
        console.log(`✅ Added examples to ${examplesAdded} fields`);
        
        // Handle array items that get added dynamically
        const addButtons = editorContainer.querySelectorAll('button[title*="Add"], .json-editor-btn-add, button[class*="add"]');
        console.log(`Found ${addButtons.length} add buttons for dynamic content`);
        
        addButtons.forEach(button => {
            // Remove existing listener to avoid duplicates
            button.removeEventListener('click', handleAddButtonClick);
            button.addEventListener('click', handleAddButtonClick);
        });
        
        // Also periodically re-check for new fields
        setTimeout(() => {
            console.log('Re-checking for new fields that need examples...');
            const newInputs = editorContainer.querySelectorAll('input[type="text"], input[type="url"], input[type="email"], textarea');
            let newExamples = 0;
            newInputs.forEach(input => {
                if (!input.parentNode.querySelector('.field-examples') && addExampleToField(input)) {
                    newExamples++;
                }
            });
            if (newExamples > 0) {
                console.log(`✅ Added examples to ${newExamples} additional fields`);
            }
        }, 2000);
        
    };
    
    // Start checking for real fields
    checkForRealFields();
}

function handleAddButtonClick() {
    setTimeout(() => {
        console.log('Array item added, re-adding examples...');
        addExamplesToFields();
    }, 1000);
}

function addExampleToField(inputElement) {
    try {
        // Skip if already has examples
        if (inputElement.parentNode.querySelector('.field-examples')) return false;
        
        // Get the JSON Editor path from the input's data attributes or parent structure
        const pathElement = inputElement.closest('[data-schemapath]');
        if (!pathElement) {
            // Try alternative methods to get schema path
            const labelElement = inputElement.closest('.form-group')?.querySelector('label');
            if (labelElement) {
                console.log('No direct schema path, trying label:', labelElement.textContent);
            }
            return false;
        }
        
        const schemaPath = pathElement.getAttribute('data-schemapath');
        console.log('Processing field with schema path:', schemaPath);
        
        const examples = getExamplesFromSchema(schemaPath);
        
        if (examples && examples.length > 0) {
            console.log('✅ Found examples for field at', schemaPath, ':', examples);
            // Create examples container
            let examplesContainer = inputElement.parentNode.querySelector('.field-examples');
            if (!examplesContainer) {
                examplesContainer = document.createElement('div');
                examplesContainer.className = 'field-examples';
                examplesContainer.style.cssText = `
                    margin-top: 5px;
                    padding: 8px 12px;
                    background: #f8f9fa;
                    border: 1px solid #e9ecef;
                    border-radius: 4px;
                    font-size: 12px;
                    color: #6c757d;
                `;
                
                // Add examples content
                const examplesList = examples.slice(0, 3).map(ex => `<code style="background: white; padding: 1px 4px; border-radius: 3px; font-size: 11px;">${ex}</code>`).join('<br>');
                examplesContainer.innerHTML = `
                    <strong style="color: #495057;">Examples:</strong><br>
                    ${examplesList}
                    ${examples.length > 3 ? `<br><em>...and ${examples.length - 3} more</em>` : ''}
                `;
                
                // Make examples clickable to fill the field
                const codeElements = examplesContainer.querySelectorAll('code');
                codeElements.forEach((code, index) => {
                    code.style.cursor = 'pointer';
                    code.style.transition = 'background-color 0.2s';
                    code.addEventListener('mouseenter', () => code.style.backgroundColor = '#e9ecef');
                    code.addEventListener('mouseleave', () => code.style.backgroundColor = 'white');
                    code.addEventListener('click', () => {
                        inputElement.value = examples[index];
                        inputElement.dispatchEvent(new Event('input', { bubbles: true }));
                        inputElement.dispatchEvent(new Event('change', { bubbles: true }));
                    });
                });
                
                inputElement.parentNode.appendChild(examplesContainer);
                return true;
            }
        } else {
            console.log('No examples found for field at path:', schemaPath);
        }
        
        return false;
    } catch (error) {
        console.log('Could not add examples to field:', error);
        return false;
    }
}

function getExamplesFromSchema(schemaPath) {
    if (!schemaProcessor || !currentCardType) return null;
    
    try {
        // Get both the processed schema (used by JSON Editor) and the original ROADMAP schema
        const processedSchema = schemaProcessor.loadedSchemas[currentCardType];
        const originalSchema = schemaProcessor.baseSchemas[currentCardType] || schemaProcessor.loadedSchemas[currentCardType];
        
        if (!processedSchema || !originalSchema) return null;
        
        console.log('Looking for examples in schema path:', schemaPath);
        
        // Try to find examples in the original ROADMAP schema structure
        const examples = findExamplesInOriginalSchema(originalSchema, schemaPath, currentCardType);
        if (examples) {
            console.log('Found examples:', examples);
            return examples;
        }
        
        return null;
    } catch (error) {
        console.log('Error getting examples from schema:', error);
        return null;
    }
}

function findExamplesInOriginalSchema(schema, schemaPath, cardType) {
    try {
        console.log(`=== Finding examples for path: ${schemaPath} ===`);
        
        // For ROADMAP schemas, look in the $defs section
        const sectionName = cardType.toLowerCase();
        const sectionDef = schema.$defs?.[sectionName];
        
        if (!sectionDef || !sectionDef.properties) {
            console.log(`No section definition found for ${sectionName}`);
            return null;
        }
        
        // Extract field name from schema path (e.g., "root.Method.0" -> "Method")
        const pathParts = schemaPath.replace('root.', '').split('.');
        const fieldName = pathParts[0];
        console.log('Looking for field:', fieldName, 'in path parts:', pathParts);
        
        // Look for the field in the section properties
        let fieldDef = sectionDef.properties[fieldName];
        if (!fieldDef) {
            console.log(`Field ${fieldName} not found in main properties, checking nested...`);
            
            // Try to find in nested structures or $defs
            fieldDef = findNestedField(schema, fieldName);
            if (!fieldDef) {
                console.log(`Field ${fieldName} not found anywhere. Available properties:`, Object.keys(sectionDef.properties));
                return null;
            }
        }
        
        console.log('Found field definition for', fieldName, ':', fieldDef);
        
        // Check for examples in various locations
        const examples = extractExamplesFromFieldDef(fieldDef, schema, fieldName);
        
        if (examples && examples.length > 0) {
            console.log('✅ Found examples for', fieldName, ':', examples);
            return examples;
        }
        
        console.log('No examples found for field:', fieldName);
        return null;
    } catch (error) {
        console.log('Error finding examples in original schema:', error);
        return null;
    }
}

function findNestedField(schema, fieldName) {
    // Search in all $defs for the field
    if (schema.$defs) {
        for (const [defName, defValue] of Object.entries(schema.$defs)) {
            if (defValue.properties && defValue.properties[fieldName]) {
                console.log(`Found ${fieldName} in $defs.${defName}`);
                return defValue.properties[fieldName];
            }
        }
    }
    return null;
}

function extractExamplesFromFieldDef(fieldDef, schema, fieldName) {
    // Direct examples
    if (fieldDef.examples) {
        return fieldDef.examples;
    }
    
    // Array items examples
    if (fieldDef.type === 'array' && fieldDef.items) {
        if (fieldDef.items.examples) {
            return fieldDef.items.examples;
        }
        
        // Handle $ref in array items
        if (fieldDef.items.$ref) {
            const refPath = fieldDef.items.$ref.replace('#/$defs/', '');
            const refDef = schema.$defs?.[refPath];
            if (refDef && refDef.examples) {
                return refDef.examples;
            }
        }
        
        // Handle enum in array items (treat as examples)
        if (fieldDef.items.enum) {
            return fieldDef.items.enum.slice(0, 5); // Take first 5 as examples
        }
    }
    
    // Object properties examples
    if (fieldDef.type === 'object' && fieldDef.properties) {
        // Look for examples in object properties
        const objectExamples = [];
        for (const [propName, propDef] of Object.entries(fieldDef.properties)) {
            if (propDef.examples) {
                objectExamples.push(`${propName}: ${propDef.examples[0]}`);
            }
        }
        if (objectExamples.length > 0) {
            return objectExamples;
        }
    }
    
    // Handle $ref at field level
    if (fieldDef.$ref) {
        const refPath = fieldDef.$ref.replace('#/$defs/', '');
        const refDef = schema.$defs?.[refPath];
        return extractExamplesFromFieldDef(refDef, schema, fieldName);
    }
    
    // Handle enum (treat as examples)
    if (fieldDef.enum) {
        return fieldDef.enum.slice(0, 5); // Take first 5 as examples
    }
    
    return null;
}


// Debug function to manually trigger examples (available in console)
window.debugExamples = function() {
    console.log('=== Manual Examples Debug ===');
    const container = document.getElementById('editor-holder');
    if (!container) {
        console.log('No editor container found');
        return;
    }
    
    // Show all elements with data-schemapath
    const pathElements = container.querySelectorAll('[data-schemapath]');
    console.log('All elements with schema paths:');
    pathElements.forEach((el, i) => {
        console.log(`${i}: ${el.getAttribute('data-schemapath')} -> ${el.tagName} ${el.className}`);
    });
    
    const inputs = container.querySelectorAll('input[type="text"], input[type="url"], input[type="email"], textarea');
    console.log('Found', inputs.length, 'total input fields');
    
    inputs.forEach((input, i) => {
        const pathElement = input.closest('[data-schemapath]');
        const schemaPath = pathElement?.getAttribute('data-schemapath');
        const hasExamples = !!input.parentNode.querySelector('.field-examples');
        const isInWell = !!input.closest('.well');
        
        console.log(`Input ${i}:`, {
            type: input.type,
            schemaPath: schemaPath,
            hasExamples: hasExamples,
            placeholder: input.placeholder,
            inWell: isInWell,
            className: input.className,
            parentClasses: input.parentNode?.className
        });
        
        if (schemaPath && schemaPath !== 'root' && !hasExamples) {
            console.log(`  -> Trying to find examples for ${schemaPath}...`);
            const examples = getExamplesFromSchema(schemaPath);
            if (examples) {
                console.log(`  -> Found examples:`, examples);
            } else {
                console.log(`  -> No examples found`);
            }
        }
    });
    
    // Force re-add examples
    console.log('Force re-adding examples...');
    addExamplesToFields();
};

// PDF Upload Handler
async function handlePdfUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
        showAlert('Please select a valid PDF file.', 'danger');
        return;
    }

    // Validate file size (10MB limit)
    const maxSizeInMB = 10;
    if (file.size > maxSizeInMB * 1024 * 1024) {
        showAlert(`File size exceeds ${maxSizeInMB}MB limit. Please select a smaller PDF file.`, 'danger');
        return;
    }

    // Show a loading indicator
    showAlert('Processing PDF... This may take a moment.', 'info', 0); // 0 duration = sticky

    const formData = new FormData();
    formData.append('pdf', file);

    try {
        // Send the file to your new serverless function
        const response = await fetch('/api/process-pdf', {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Unknown error occurred' }));
            throw new Error(errorData.error || `Server error: ${response.status}`);
        }

        const structuredJson = await response.json();

        // Hide the loading indicator
        document.querySelector('.alert.custom-alert')?.remove();

        // Validate the response structure
        if (!structuredJson || (typeof structuredJson !== 'object')) {
            throw new Error('Invalid response format from PDF processing');
        }

        // Determine the card type from the LLM's output
        let cardType = 'unknown';
        let editorData = {};

        if (structuredJson.Model) {
            cardType = 'model';
            editorData = structuredJson.Model;
        } else if (structuredJson.Dataset) {
            cardType = 'dataset';
            editorData = structuredJson.Dataset;
        } else {
            // Try to infer from the structure
            if (structuredJson.Name || structuredJson.Input || structuredJson.Output || structuredJson.Results) {
                cardType = 'model';
                editorData = structuredJson;
            } else if (structuredJson.Composition || structuredJson.Imaging || structuredJson.Labeling) {
                cardType = 'dataset';
                editorData = structuredJson;
            } else {
                throw new Error('Could not determine if this describes a model or dataset from the PDF content');
            }
        }

        // Show success message
        showAlert(`✅ Successfully extracted ${cardType} information from PDF!`, 'success');

        // Start the editor with the pre-filled data
        currentCardType = cardType;
        document.getElementById('initial-screen').style.display = 'none';
        document.getElementById('editor-section').style.display = 'block';
        updateEditorUI(cardType);
        
        // Initialize editor with the extracted data
        initializeEditor(editorData);

        // Clear the file input for next use
        event.target.value = '';

    } catch (error) {
        console.error('PDF Upload Error:', error);
        
        // Hide the loading indicator
        document.querySelector('.alert.custom-alert')?.remove();
        
        // Show error message
        let errorMessage = 'Error processing PDF: ' + error.message;
        
        if (error.message.includes('API key')) {
            errorMessage = 'PDF processing is not configured. Please contact your administrator.';
        } else if (error.message.includes('Failed to fetch')) {
            errorMessage = 'Network error. Please check your connection and try again.';
        }
        
        showAlert(errorMessage, 'danger');
        
        // Clear the file input
        event.target.value = '';
    }
}

// Error handling
window.addEventListener('error', function(e) {
    console.error('Global error:', e.error);
});

window.addEventListener('unhandledrejection', function(e) {
    console.error('Unhandled promise rejection:', e.reason);
});