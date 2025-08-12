// ROADMAP Model Card Editor - Production Version

// Global variables
let editor = null;
let currentCardType = null;
let isJsonPreviewVisible = false;
let schemaProcessor = null;

// Application initialization
document.addEventListener('DOMContentLoaded', function() {
    console.log('ROADMAP Model Card Editor initialized');
    
    // Initialize schema processor
    schemaProcessor = new SchemaProcessor();
    
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

function initializeEditor(initialData = null) {
    const editorHolder = document.getElementById('editor-holder');
    editorHolder.innerHTML = '';
    
    console.log(`Initializing editor for ${currentCardType}`);
    
    // Get schema
    const schema = schemaProcessor.getSchema(currentCardType);
    
    if (!schema) {
        showAlert('Schema not available for ' + currentCardType + ' cards.', 'danger');
        return;
    }
    
    try {
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
            object_layout: 'normal'
        });
        
        // Editor event listeners
        editor.on('ready', function() {
            console.log('✅ Editor ready for', currentCardType);
            enableEditorControls();
            
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
        console.error('Error initializing editor:', error);
        showAlert('Error initializing the editor: ' + error.message, 'danger');
    }
}

function enableEditorControls() {
    document.getElementById('validate-btn').disabled = false;
    document.getElementById('download-btn').disabled = false;
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
                    const jsonData = JSON.parse(e.target.result);
                    displayFilePreview(jsonData);
                    loadBtn.disabled = false;
                } catch (error) {
                    showAlert('Invalid JSON file. Please select a valid ROADMAP JSON file.', 'danger');
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

function displayFilePreview(jsonData) {
    const preview = document.getElementById('file-preview');
    const content = document.getElementById('file-content-preview');
    
    // Determine card type from JSON structure
    let detectedType = 'unknown';
    if (jsonData.Model) {
        detectedType = 'model';
    } else if (jsonData.Dataset) {
        detectedType = 'dataset';
    }
    
    content.innerHTML = `
        <strong>Type:</strong> ${detectedType.charAt(0).toUpperCase() + detectedType.slice(1)} Card<br>
        <strong>Size:</strong> ${JSON.stringify(jsonData).length} characters<br>
        <strong>Schema:</strong> ${jsonData.$schema || 'Not specified'}
    `;
    
    preview.style.display = 'block';
    window.uploadedJsonData = jsonData;
    window.detectedCardType = detectedType;
}

function hideFilePreview() {
    document.getElementById('file-preview').style.display = 'none';
    window.uploadedJsonData = null;
    window.detectedCardType = null;
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
    if (cardType === 'model' && jsonData.Model) {
        editorData = jsonData.Model;
    } else if (cardType === 'dataset' && jsonData.Dataset) {
        editorData = jsonData.Dataset;
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
}

// Error handling
window.addEventListener('error', function(e) {
    console.error('Global error:', e.error);
});

window.addEventListener('unhandledrejection', function(e) {
    console.error('Unhandled promise rejection:', e.reason);
});