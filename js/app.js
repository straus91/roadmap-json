// ROADMAP Model Card Editor - Production Version

// ==============================================================================
// CONFIGURATION & CONSTANTS
// ==============================================================================

// Schema URLs
const GITHUB_SCHEMAS = {
    model: 'https://raw.githubusercontent.com/cekahn/ROADMAP/main/ROADMAP.model.json',
    dataset: 'https://raw.githubusercontent.com/cekahn/ROADMAP/main/ROADMAP.dataset.json'
};

// UI Timing Constants
const FORM_RENDER_DELAY_MS = 1500;     // Wait for JSON Editor to fully render
const ALERT_AUTO_DISMISS_MS = 5000;    // Default alert auto-dismiss duration
const DEBOUNCE_DELAY_MS = 300;         // Input debounce delay

// Processing Limits
const MAX_PROMPT_TEXT_LENGTH = 15000;  // Character limit for AI prompts
const MAX_PDF_SIZE_MB = 10;            // Maximum PDF file size
const MAX_SCHEMA_DEPTH = 10;           // Maximum recursion depth for schema processing

// Schema Sources
const SCHEMA_SOURCES = {
    GITHUB: 'github',
    CUSTOM: 'custom'
};

// Processing Modes
const PROCESSING_MODES = {
    MULTIMODAL: 'multimodal',
    TEXT_ONLY: 'text-only'
};

// Card Types
const CARD_TYPES = {
    MODEL: 'model',
    DATASET: 'dataset'
};

// ==============================================================================
// STATE MANAGEMENT
// ==============================================================================

// Global variables
let editor = null;
let currentCardType = null;
let isJsonPreviewVisible = false;
let schemaProcessor = null;
let showEmptyOptionalFields = false;  // Track show_opt_in setting

// PDF processing state (consolidated structure)
const pdfState = {
    processingMode: PROCESSING_MODES.MULTIMODAL,
    cardType: CARD_TYPES.MODEL,
    schemaSource: SCHEMA_SOURCES.GITHUB,
    schemaUrl: null,
    detectedType: CARD_TYPES.MODEL
};

// Store selected PDF file globally (for 2-step upload/process workflow)
let selectedPdfFile = null;

// ==============================================================================
// PDF SELECT/PROCESS FUNCTIONS (2-step workflow)
// ==============================================================================

// PDF Selection Handler (Step 1: Select file)
function handlePdfSelect(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
        showAlert('Please select a valid PDF file.', 'danger');
        return;
    }

    // Validate file size (50MB limit for client-side processing)
    const maxSizeInMB = 50;
    if (file.size > maxSizeInMB * 1024 * 1024) {
        showAlert('File size exceeds ' + maxSizeInMB + 'MB limit.', 'danger');
        return;
    }

    // Store the selected file
    selectedPdfFile = file;

    // Update UI to show file is selected
    const filenameDiv = document.getElementById('pdf-selected-filename');
    filenameDiv.textContent = 'Selected: ' + file.name + ' (' + (file.size / 1024 / 1024).toFixed(2) + ' MB)';
    filenameDiv.style.display = 'block';

    // Enable the "Process PDF" button
    document.getElementById('process-pdf-btn').disabled = false;

    showAlert('PDF selected. Click Process PDF to continue.', 'success', 3000);
}

// PDF Processing Handler (Step 2: Process the selected file)
async function processPdfFile() {
    if (!selectedPdfFile) {
        showAlert('Please select a PDF file first.', 'danger');
        return;
    }

    // Call the original handlePdfUpload with the selected file
    await handlePdfUpload({target: {files: [selectedPdfFile], value: ''}});

    // Reset for next use
    selectedPdfFile = null;
    document.getElementById('pdf-file-input').value = '';
    document.getElementById('pdf-selected-filename').style.display = 'none';
    document.getElementById('process-pdf-btn').disabled = true;
}

// ==============================================================================
// END PDF SELECT/PROCESS FUNCTIONS
// ==============================================================================

// Debug processing state (consolidated structure)
const debugState = {
    processingMode: PROCESSING_MODES.MULTIMODAL,
    cardType: CARD_TYPES.MODEL,
    schemaSource: SCHEMA_SOURCES.GITHUB,
    schemaUrl: null,
    detectedType: CARD_TYPES.MODEL
};

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

        // *** Normalize initial data to match schema field names (case-insensitive) ***
        let normalizedData = initialData || {};
        if (initialData && Object.keys(initialData).length > 0) {
            console.log('🔄 Starting normalization of initial data...');
            normalizedData = normalizeJsonToSchema(initialData, schema);
            console.log('📝 Normalized data keys:', normalizedData ? Object.keys(normalizedData) : 'null');
        }

        // Update schema info display
        updateSchemaInfo();

        // Clear loading indicator
        editorHolder.innerHTML = '';

        // Initialize JSON Editor with normalized data
        editor = new JSONEditor(editorHolder, {
            schema: schema,
            startval: normalizedData,
            theme: 'bootstrap4',
            iconlib: 'fontawesome4',
            show_errors: 'interaction',
            required_by_default: false,
            keep_oneof_values: false,
            prompt_before_delete: true,
            no_additional_properties: false,
            disable_edit_json: true,
            disable_properties: false,
            show_opt_in: showEmptyOptionalFields,
            compact: true,
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
            }, FORM_RENDER_DELAY_MS);

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
        if (cardType === CARD_TYPES.MODEL && jsonData.Model) {
            editorData = jsonData.Model;
        } else if (cardType === CARD_TYPES.DATASET && jsonData.Dataset) {
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

function toggleEmptyFields() {
    if (!editor) {
        showAlert('Editor not initialized yet', 'warning');
        return;
    }

    // Toggle the state
    showEmptyOptionalFields = !showEmptyOptionalFields;

    // Update button text
    const buttonText = document.getElementById('toggle-empty-fields-text');
    const buttonIcon = document.querySelector('#toggle-empty-fields-btn i');

    if (showEmptyOptionalFields) {
        buttonText.textContent = 'Hide Empty Optional Fields';
        buttonIcon.className = 'fa fa-eye mr-2';
    } else {
        buttonText.textContent = 'Show Empty Optional Fields';
        buttonIcon.className = 'fa fa-eye-slash mr-2';
    }

    // Save current editor data before reinitializing
    const currentData = editor.getValue();

    // Destroy current editor
    editor.destroy();

    // Reinitialize editor with new show_opt_in setting
    console.log('🔄 Reinitializing editor with show_opt_in:', showEmptyOptionalFields);
    initializeEditor(currentData);

    // Show feedback to user
    const message = showEmptyOptionalFields
        ? 'Now showing all optional fields (including empty ones)'
        : 'Now hiding empty optional fields for cleaner view';
    showAlert(message, 'info');
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

    // Validate before download (non-blocking warning)
    const isValid = validateForm(false);  // Silent validation
    if (!isValid) {
        const proceed = confirm('⚠️ Validation errors detected in your data.\n\nThe JSON may not be fully compliant with the ROADMAP schema.\n\nDo you want to download anyway?');
        if (!proceed) {
            showAlert('Download cancelled. Please fix validation errors and try again.', 'info');
            return;
        }
    }

    try {
        const editorData = editor.getValue();

        // Construct the complete ROADMAP JSON structure
        const roadmapData = {
            $schema: `ROADMAP-${currentCardType}-2025-05.json`
        };

        // Add the appropriate section
        if (currentCardType === CARD_TYPES.MODEL) {
            roadmapData.Model = editorData;
        } else if (currentCardType === CARD_TYPES.DATASET) {
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
function showAlert(message, type = 'info', duration = ALERT_AUTO_DISMISS_MS) {
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

/**
 * Resolves a $ref pointer in the schema.
 *
 * @param {string} ref - The $ref string (e.g., "#/$defs/person")
 * @param {object} schema - The root schema object
 * @returns {object|null} The resolved schema object or null
 */
function resolveSchemaRef(ref, schema) {
  if (!ref || !ref.startsWith('#/')) {
    return null;
  }

  const path = ref.substring(2).split('/'); // Remove '#/' and split
  let current = schema;

  for (const part of path) {
    if (current && typeof current === 'object' && current[part]) {
      current = current[part];
    } else {
      return null;
    }
  }

  return current;
}

/**
 * Normalizes JSON data to match schema field names (case-insensitive).
 * Prevents "item 1/2/3" fallback by ensuring all fields match schema expectations.
 *
 * @param {object} data - The JSON data to normalize
 * @param {object} schema - The JSON schema to match against
 * @returns {object} Normalized JSON data with corrected field names
 */
function normalizeJsonToSchema(data, schema) {
  // Guard against null/undefined/non-objects
  if (data === null || data === undefined) {
    console.warn('⚠️ Normalization received null/undefined data');
    return data;
  }

  if (typeof data !== 'object' || !schema || typeof schema !== 'object') {
    return data;
  }

  console.log('🔄 Normalizing JSON data to match schema...');
  console.log('📥 Input data keys:', Object.keys(data));

  // Check if schema has a wrapper structure (Dataset/Model/Card)
  const schemaProps = schema.properties || {};
  let targetSchema = null;
  let wrapperKey = null;

  // Detect ROADMAP wrapper structure: Dataset or Model
  // GitHub format: properties.Dataset.properties (direct properties)
  // Old format: properties.Dataset.$ref (needs resolving)
  if (schemaProps.Dataset) {
    wrapperKey = 'Dataset';
    if (schemaProps.Dataset.properties) {
      // GitHub format - properties directly available
      targetSchema = schemaProps.Dataset;
      console.log('📦 Detected Dataset wrapper (GitHub format)');
    } else if (schemaProps.Dataset.$ref) {
      // Old format - need to resolve $ref
      targetSchema = resolveSchemaRef(schemaProps.Dataset.$ref, schema);
      console.log('📦 Detected Dataset wrapper, resolving $ref:', schemaProps.Dataset.$ref);
    }
  } else if (schemaProps.Model) {
    wrapperKey = 'Model';
    if (schemaProps.Model.properties) {
      // GitHub format - properties directly available
      targetSchema = schemaProps.Model;
      console.log('📦 Detected Model wrapper (GitHub format)');
    } else if (schemaProps.Model.$ref) {
      // Old format - need to resolve $ref
      targetSchema = resolveSchemaRef(schemaProps.Model.$ref, schema);
      console.log('📦 Detected Model wrapper, resolving $ref:', schemaProps.Model.$ref);
    }
  }

  // If we found a wrapper with resolved schema, normalize against it
  if (targetSchema && targetSchema.properties && wrapperKey) {
    console.log('✅ Using resolved schema properties for normalization');

    // Check if data is already wrapped
    const dataHasWrapper = data.hasOwnProperty(wrapperKey) ||
                          data.hasOwnProperty(wrapperKey.toLowerCase());

    if (dataHasWrapper) {
      console.log(`📦 Data already has "${wrapperKey}" wrapper`);
      // Data is wrapped, normalize the inner content
      const innerData = data[wrapperKey] || data[wrapperKey.toLowerCase()];

      if (!innerData || typeof innerData !== 'object') {
        console.warn('⚠️ Wrapper exists but inner data is invalid');
        return data;
      }

      // Create case-insensitive lookup map
      const fieldMap = {};
      for (const key in targetSchema.properties) {
        if (targetSchema.properties.hasOwnProperty(key)) {
          fieldMap[key.toLowerCase()] = key;
        }
      }

      const normalized = normalizeObject(innerData, targetSchema.properties, fieldMap, schema);
      const result = {};
      result[wrapperKey] = normalized;
      console.log('✅ JSON normalization complete (already wrapped)');
      return result;
    } else {
      console.log(`📦 Data is unwrapped, will wrap in "${wrapperKey}"`);
      // Data is unwrapped, normalize then wrap

      // Create case-insensitive lookup map
      const fieldMap = {};
      for (const key in targetSchema.properties) {
        if (targetSchema.properties.hasOwnProperty(key)) {
          fieldMap[key.toLowerCase()] = key;
        }
      }

      const normalized = normalizeObject(data, targetSchema.properties, fieldMap, schema);
      const result = {};
      result[wrapperKey] = normalized;
      console.log('✅ JSON normalization complete (wrapped)');
      return result;
    }
  }

  // Fallback: No wrapper detected, normalize against root properties
  console.log('⚠️ No wrapper structure detected, using root properties');
  const schemaFieldMap = {};
  for (const key in schemaProps) {
    if (schemaProps.hasOwnProperty(key)) {
      schemaFieldMap[key.toLowerCase()] = key;
    }
  }

  const normalized = normalizeObject(data, schemaProps, schemaFieldMap, schema);

  console.log('✅ JSON normalization complete (no wrapper)');
  return normalized;
}

/**
 * Recursively normalizes an object's field names to match schema.
 *
 * @param {object} obj - Object to normalize
 * @param {object} schemaProps - Schema properties for this level
 * @param {object} fieldMap - Case-insensitive field name lookup
 * @param {object} rootSchema - Root schema for $ref resolution
 * @returns {object} Normalized object
 */
function normalizeObject(obj, schemaProps, fieldMap, rootSchema) {
  // Handle null/undefined
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Handle non-objects (primitives, functions, etc.)
  if (typeof obj !== 'object') {
    return obj;
  }

  // Handle arrays - DON'T recurse without proper schema context
  // Arrays should be handled by the parent's schema definition
  if (Array.isArray(obj)) {
    console.warn('⚠️ normalizeObject called on array - this should be handled by parent schema');
    // Return as-is; parent should handle array item normalization
    return obj;
  }

  // Normalize object properties
  const normalizedObj = {};

  for (const key in obj) {
    if (!obj.hasOwnProperty(key)) continue;

    const value = obj[key];

    // Handle null/undefined values
    if (value === null || value === undefined) {
      normalizedObj[key] = value;
      continue;
    }

    const lowerKey = key.toLowerCase();
    const correctKey = fieldMap[lowerKey]; // Use schema key if found

    // If field not found in schema
    if (!correctKey) {
      console.warn(`⚠️ Field "${key}" not found in schema - keeping original key`);
      normalizedObj[key] = value;
      continue;
    }

    // Check if this field has a schema definition
    const schemaProp = schemaProps[correctKey];

    if (schemaProp) {
      // Recursively normalize based on schema type
      if (schemaProp.type === 'object' && schemaProp.properties) {
        // Create field map for nested object
        const nestedFieldMap = {};
        for (const nestedKey in schemaProp.properties) {
          if (schemaProp.properties.hasOwnProperty(nestedKey)) {
            nestedFieldMap[nestedKey.toLowerCase()] = nestedKey;
          }
        }
        normalizedObj[correctKey] = normalizeObject(value, schemaProp.properties, nestedFieldMap, rootSchema);
      } else if (schemaProp.type === 'array' && schemaProp.items) {
        // Handle arrays
        if (Array.isArray(value)) {
          if (schemaProp.items.type === 'object' && schemaProp.items.properties) {
            // Array of objects - normalize each item
            const itemFieldMap = {};
            for (const itemKey in schemaProp.items.properties) {
              if (schemaProp.items.properties.hasOwnProperty(itemKey)) {
                itemFieldMap[itemKey.toLowerCase()] = itemKey;
              }
            }
            normalizedObj[correctKey] = value.map(item =>
              normalizeObject(item, schemaProp.items.properties, itemFieldMap, rootSchema)
            );
          } else if (schemaProp.items.$ref) {
            // Handle $ref - resolve reference and normalize
            const resolvedSchema = resolveSchemaRef(schemaProp.items.$ref, rootSchema);
            if (resolvedSchema && resolvedSchema.properties) {
              // Create field map from resolved schema
              const refFieldMap = {};
              for (const refKey in resolvedSchema.properties) {
                if (resolvedSchema.properties.hasOwnProperty(refKey)) {
                  refFieldMap[refKey.toLowerCase()] = refKey;
                }
              }
              normalizedObj[correctKey] = value.map(item => {
                if (typeof item === 'object' && !Array.isArray(item)) {
                  return normalizeObject(item, resolvedSchema.properties, refFieldMap, rootSchema);
                }
                return item;
              });
            } else {
              // Couldn't resolve $ref - keep as is
              console.warn(`⚠️ Could not resolve $ref: ${schemaProp.items.$ref}`);
              normalizedObj[correctKey] = value;
            }
          } else {
            // Array of primitives - keep as is
            normalizedObj[correctKey] = value;
          }
        } else {
          normalizedObj[correctKey] = value;
        }
      } else {
        // Simple type - keep value as is
        normalizedObj[correctKey] = value;
      }
    } else {
      // schemaProp doesn't exist but correctKey was found - unusual case
      console.warn(`⚠️ Field "${correctKey}" found in field map but not in schema properties`);
      normalizedObj[correctKey] = value;
    }
  }

  return normalizedObj;
}

/**
 * Master function to enhance any JSON schema with UI improvements.
 * This is the single source of truth for all dynamic schema modifications.
 * Processes schemas in-memory without modifying source files.
 *
 * Enhancements applied:
 * 1. Dynamic headerTemplates for intuitive array item titles
 * 2. Disabled additional properties to prevent confusing "item 1" fields
 *
 * @param {object} schema - The JSON schema object to enhance
 */
function enhanceSchemaForUI(schema) {
  if (!schema || typeof schema !== 'object') {
    return;
  }

  console.log('🔧 Enhancing schema for UI...');

  // Apply all enhancements
  addDynamicHeaderTemplates(schema);
  disableAdditionalProperties(schema);

  console.log('✅ Schema enhancement complete');
}

/**
 * Recursively adds dynamic headerTemplates to array items.
 * Makes array items show meaningful titles instead of generic "item 1".
 *
 * @param {object} schema - The JSON schema object to process
 */
function addDynamicHeaderTemplates(schema, path = 'root', depth = 0) {
  if (!schema || typeof schema !== 'object') {
    return;
  }

  const indent = '  '.repeat(depth);
  console.log(`${indent}📍 addDynamicHeaderTemplates at: ${path}`);

  // Check if this node has properties to iterate
  if (!schema.properties) {
    console.log(`${indent}⚠️ No properties found at ${path}`);
    return;
  }

  // Iterate over all properties of the current schema object
  for (const key in schema.properties) {
    if (schema.properties.hasOwnProperty(key)) {
      const prop = schema.properties[key];
      const currentPath = `${path}.${key}`;

      console.log(`${indent}  🔍 Checking: ${currentPath} (type: ${prop.type})`);

      // Handle ALL arrays, not just arrays of objects
      if (prop.type === 'array' && prop.items) {
        // If array contains objects, add headerTemplate
        if (prop.items.type === 'object') {
          // Only add a template if one isn't already defined in the schema
          if (!prop.items.headerTemplate) {
            const itemProps = prop.items.properties || {};
            let titleProp = null;

            // Heuristic: Intelligently find the best property for the title
            // by checking for common, descriptive property names.
            const potentialTitleProps = ['Name', 'Title', 'Label', 'Description', 'ID', 'Result Information'];
            for (const p of potentialTitleProps) {
              if (itemProps[p] && itemProps[p].type === 'string') {
                titleProp = p;
                break; // Use the first one found
              }
            }

            // If a good title property was found, inject the dynamic headerTemplate rule
            if (titleProp) {
              const fallbackTitle = prop.items.title || 'Item';
              // Use bracket notation for properties that might contain spaces
              // Use i1 for 1-based index (JSON Editor's template variable)
              prop.items.headerTemplate = `{{self['${titleProp}'] || '${fallbackTitle} ' + i1}}`;
              console.log(`${indent}  ✅ Added headerTemplate to ${currentPath} using "${titleProp}"`);
            } else {
              console.log(`${indent}  ⚠️ No title property found for ${currentPath}`);
            }
          } else {
            console.log(`${indent}  ℹ️ ${currentPath} already has headerTemplate`);
          }

          // Recurse into array items to handle nested structures
          console.log(`${indent}  ↓ Recursing into object array items of ${currentPath}`);
          addDynamicHeaderTemplates(prop.items, `${currentPath}[items]`, depth + 1);
        } else {
          // Array of simple types (string, number, etc.) - use {{self}} to show the value
          if (!prop.items.headerTemplate) {
            prop.items.headerTemplate = "{{self}}";
            console.log(`${indent}  ✅ Added headerTemplate {{self}} to ${currentPath} (${prop.items.type} array)`);
          } else {
            console.log(`${indent}  ℹ️ ${currentPath} already has headerTemplate`);
          }
        }
      }
      // If we find a nested object, recurse into it
      else if (prop.type === 'object') {
        console.log(`${indent}  ↓ Recursing into object ${currentPath}`);
        addDynamicHeaderTemplates(prop, currentPath, depth + 1);
      }
    }
  }
}

/**
 * Recursively disables additional properties on all object items in arrays.
 * Prevents confusing "Add Property" buttons and "item 1" fields in the UI.
 *
 * @param {object} schema - The JSON schema object to process
 */
function disableAdditionalProperties(schema, path = 'root', depth = 0) {
  if (!schema || typeof schema !== 'object') {
    return;
  }

  const indent = '  '.repeat(depth);
  console.log(`${indent}📍 disableAdditionalProperties at: ${path}`);

  // Check if this node has properties to iterate
  if (!schema.properties) {
    console.log(`${indent}⚠️ No properties found at ${path}`);
    return;
  }

  // Iterate over all properties
  for (const key in schema.properties) {
    if (schema.properties.hasOwnProperty(key)) {
      const prop = schema.properties[key];
      const currentPath = `${path}.${key}`;

      // Handle ALL arrays, not just arrays of objects
      if (prop.type === 'array' && prop.items) {
        console.log(`${indent}  🔍 Checking array: ${currentPath} (item type: ${prop.items.type})`);

        // If array contains objects, disable additionalProperties
        if (prop.items.type === 'object') {
          // Only set if not already explicitly defined
          if (prop.items.additionalProperties === undefined) {
            prop.items.additionalProperties = false;
            console.log(`${indent}  ✅ Disabled additionalProperties for ${currentPath}[items]`);
          } else {
            console.log(`${indent}  ℹ️ ${currentPath}[items] already has additionalProperties set`);
          }

          // *** CRITICAL FIX: Recurse into array items to handle nested structures ***
          console.log(`${indent}  ↓ Recursing into object array items of ${currentPath}`);
          disableAdditionalProperties(prop.items, `${currentPath}[items]`, depth + 1);
        } else {
          // Array of simple types (string, number, etc.) - no additionalProperties needed
          console.log(`${indent}  ℹ️ ${currentPath} is array of ${prop.items.type} (no additionalProperties needed)`);
        }
      }
      // If we find a nested object, recurse into it
      else if (prop.type === 'object') {
        console.log(`${indent}  ↓ Recursing into object ${currentPath}`);
        disableAdditionalProperties(prop, currentPath, depth + 1);
      }
    }
  }
}

/**
 * Fixes "item 1", "item 2" labels in array items for fields not in schema.
 * This is a fallback for when PDF extraction uses field names that don't match the schema.
 * Runs after the editor renders and replaces generic labels with actual array values.
 */
function fixDynamicArrayLabels() {
  console.log('🔧 Fixing dynamic array labels...');

  try {
    if (!editor) {
      console.warn('⚠️ Editor not available for label fixing');
      return;
    }

    // Get the current editor data
    const editorData = editor.getValue();
    console.log('📊 Editor data:', editorData);

    // Find all elements with "item" labels in the DOM
    const editorHolder = document.getElementById('editor-holder');
    if (!editorHolder) {
      console.warn('⚠️ Editor holder not found');
      return;
    }

    // Cast a wider net - search for ANY element containing "item N" pattern
    const allElements = editorHolder.querySelectorAll('*');
    console.log(`🔍 Scanning ${allElements.length} elements for "item" labels...`);

    let fixedCount = 0;
    let foundItemLabels = 0;

    allElements.forEach(element => {
      // Only process text nodes, not input values
      if (element.children.length === 0 || element.tagName === 'SPAN' || element.tagName === 'H3' || element.tagName === 'DIV') {
        const text = element.textContent?.trim() || '';

        // Check if it's a generic "item 1", "item 2", etc. label (and ONLY that)
        const itemMatch = text.match(/^item\s+(\d+)$/i);
        if (itemMatch && element.textContent === text) {
          foundItemLabels++;
          console.log(`🎯 Found "item ${itemMatch[1]}" in <${element.tagName}>`);

          // Find the closest parent with a text input containing actual value
          const parentContainer = element.closest('.well, [data-schemapath]');
          if (parentContainer) {
            // Look for input or textarea with actual value
            const valueInput = parentContainer.querySelector('input[type="text"], textarea');
            if (valueInput && valueInput.value && valueInput.value.trim()) {
              const actualValue = valueInput.value.trim();
              element.textContent = actualValue;
              console.log(`✅ Fixed label: "item ${itemMatch[1]}" → "${actualValue}"`);
              fixedCount++;
            } else {
              console.log(`⚠️ No value input found for "item ${itemMatch[1]}"`);
            }
          }
        }
      }
    });

    console.log(`📈 Found ${foundItemLabels} "item" labels, fixed ${fixedCount}`);

    if (fixedCount > 0) {
      console.log(`✅ Fixed ${fixedCount} dynamic array labels`);
    } else if (foundItemLabels > 0) {
      console.warn(`⚠️ Found ${foundItemLabels} "item" labels but couldn't fix them`);
    } else {
      console.log('ℹ️ No dynamic array labels found');
    }

  } catch (error) {
    console.error('❌ Error fixing dynamic array labels:', error);
  }
}

/**
 * Helper function to get a value from nested object using a path string.
 * Path format: "root.tab_name.field_name.0" (where 0 is array index)
 */
function getValueFromPath(obj, path) {
  if (!path || !obj) return null;

  // Remove "root." prefix if present
  path = path.replace(/^root\./, '');

  // Split path and traverse
  const parts = path.split('.');
  let current = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return null;

    // Check if it's an array index
    const arrayIndex = parseInt(part);
    if (!isNaN(arrayIndex)) {
      if (Array.isArray(current)) {
        current = current[arrayIndex];
      } else {
        return null;
      }
    } else {
      current = current[part];
    }
  }

  return current;
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
    if (cardType === CARD_TYPES.MODEL) {
        return convertTxtModelToRoadmap(txtData);
    } else if (cardType === CARD_TYPES.DATASET) {
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

    // Validate before download (non-blocking warning)
    const isValid = validateForm(false);  // Silent validation
    if (!isValid) {
        const proceed = confirm('⚠️ Validation errors detected in your data.\n\nThe TXT file may not be fully compliant with the ROADMAP schema.\n\nDo you want to download anyway?');
        if (!proceed) {
            showAlert('Download cancelled. Please fix validation errors and try again.', 'info');
            return;
        }
    }

    try {
        const editorData = editor.getValue();

        // Convert to TXT format
        let txtData;
        if (currentCardType === CARD_TYPES.MODEL) {
            txtData = convertRoadmapToTxtModel(editorData);
        } else if (currentCardType === CARD_TYPES.DATASET) {
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
        // Add visual indicator based on source type
        let icon = '';
        let displayText = info.source;

        if (info.isCustom) {
            icon = '<i class="fa fa-cloud text-info mr-1"></i>';
        } else if (info.source.includes('GitHub')) {
            icon = '<i class="fa fa-github text-success mr-1"></i>';
        } else {
            icon = '<i class="fa fa-file text-warning mr-1"></i>';
        }

        // Add URL as tooltip if available
        if (info.sourceUrl) {
            sourceElement.innerHTML = `${icon}<a href="${info.sourceUrl}" target="_blank" title="${info.sourceUrl}">${displayText}</a>`;
        } else {
            sourceElement.innerHTML = `${icon}${displayText}`;
        }

        versionElement.textContent = info.version;

        // Log schema info for debugging
        console.log('📋 Schema Info:', {
            cardType: currentCardType,
            source: info.source,
            url: info.sourceUrl,
            version: info.version,
            isCustom: info.isCustom,
            cacheExpiry: info.cacheExpiry
        });

        // Show cache expiry if available
        if (info.cacheExpiry && !info.isCustom) {
            const expiryTime = info.cacheExpiry.toLocaleTimeString();
            console.log(`   Cache expires at: ${expiryTime}`);
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

// Processing mode functions
function setPdfProcessingMode(mode) {
    pdfState.processingMode = mode;
    
    // Update button states
    const multimodalBtn = document.getElementById('pdf-multimodal-btn');
    const textOnlyBtn = document.getElementById('pdf-text-only-btn');
    
    if (mode === PROCESSING_MODES.MULTIMODAL) {
        multimodalBtn.classList.add('active');
        textOnlyBtn.classList.remove('active');
    } else {
        multimodalBtn.classList.remove('active');
        textOnlyBtn.classList.add('active');
    }
}

function setDebugProcessingMode(mode) {
    debugState.processingMode = mode;

    // Update button states
    const multimodalBtn = document.getElementById('debug-multimodal-btn');
    const textOnlyBtn = document.getElementById('debug-text-only-btn');

    if (mode === PROCESSING_MODES.MULTIMODAL) {
        multimodalBtn.classList.add('active');
        textOnlyBtn.classList.remove('active');
    } else {
        multimodalBtn.classList.remove('active');
        textOnlyBtn.classList.add('active');
    }
}

// Card type selection functions
function setPdfCardType(cardType) {
    pdfState.cardType = cardType;
    
    // Update button states
    const modelBtn = document.getElementById('pdf-model-btn');
    const datasetBtn = document.getElementById('pdf-dataset-btn');
    
    if (cardType === CARD_TYPES.MODEL) {
        modelBtn.classList.add('active');
        datasetBtn.classList.remove('active');
    } else {
        modelBtn.classList.remove('active');
        datasetBtn.classList.add('active');
    }
}

function setDebugCardType(cardType) {
    debugState.cardType = cardType;

    // Update button states
    const modelBtn = document.getElementById('debug-model-btn');
    const datasetBtn = document.getElementById('debug-dataset-btn');

    if (cardType === CARD_TYPES.MODEL) {
        modelBtn.classList.add('active');
        datasetBtn.classList.remove('active');
    } else {
        modelBtn.classList.remove('active');
        datasetBtn.classList.add('active');
    }
}

// Schema source toggle functions
function setPdfSchemaSource(source) {
    pdfState.schemaSource = source;

    const githubBtn = document.getElementById('pdf-github-schema-btn');
    const customBtn = document.getElementById('pdf-custom-schema-btn');
    const customInput = document.getElementById('pdf-custom-schema-url');

    if (source === SCHEMA_SOURCES.GITHUB) {
        githubBtn.classList.add('active');
        customBtn.classList.remove('active');
        customInput.style.display = 'none';
    } else {
        githubBtn.classList.remove('active');
        customBtn.classList.add('active');
        customInput.style.display = 'block';
    }
}

function setDebugSchemaSource(source) {
    debugState.schemaSource = source;

    const githubBtn = document.getElementById('debug-github-schema-btn');
    const customBtn = document.getElementById('debug-custom-schema-btn');
    const customInput = document.getElementById('debug-custom-schema-url');

    if (source === SCHEMA_SOURCES.GITHUB) {
        githubBtn.classList.add('active');
        customBtn.classList.remove('active');
        customInput.style.display = 'none';
    } else {
        githubBtn.classList.remove('active');
        customBtn.classList.add('active');
        customInput.style.display = 'block';
    }
}

// PDF analysis and schema detection
async function analyzeAndSelectSchema(file) {
    try {
        console.log('🔍 Analyzing PDF content for schema detection...');

        // Read PDF file as ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();

        // Load PDF using PDF.js
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

        // Extract text from first page
        const firstPage = await pdf.getPage(1);
        const textContent = await firstPage.getTextContent();
        const text = textContent.items.map(item => item.str).join(' ').toLowerCase();

        console.log('📄 Extracted text sample:', text.substring(0, 200));

        // Keywords for model detection
        const modelKeywords = ['model', 'algorithm', 'neural network', 'training', 'architecture',
                              'deep learning', 'machine learning', 'prediction', 'classifier',
                              'convolutional', 'transformer', 'weights', 'layers'];

        // Keywords for dataset detection
        const datasetKeywords = ['dataset', 'cohort', 'patients', 'subjects', 'collection',
                                'imaging data', 'data collection', 'retrospective', 'prospective',
                                'inclusion criteria', 'exclusion criteria', 'annotations'];

        // Count keyword matches
        let modelScore = 0;
        let datasetScore = 0;

        modelKeywords.forEach(keyword => {
            const matches = (text.match(new RegExp(keyword, 'gi')) || []).length;
            modelScore += matches;
        });

        datasetKeywords.forEach(keyword => {
            const matches = (text.match(new RegExp(keyword, 'gi')) || []).length;
            datasetScore += matches;
        });

        console.log('📊 Scores - Model:', modelScore, 'Dataset:', datasetScore);

        // Determine type
        const detectedType = datasetScore > modelScore ? 'dataset' : 'model';
        console.log('✅ Detected type:', detectedType);

        return detectedType;

    } catch (error) {
        console.error('❌ Error analyzing PDF:', error);
        // Default to model on error
        return 'model';
    }
}

// Get schema URL based on source and card type
function getSchemaUrl(cardType, source, customUrl) {
    if (source === 'custom' && customUrl && customUrl.trim()) {
        return customUrl.trim();
    }
    return GITHUB_SCHEMAS[cardType];
}

// Resolve external $ref references in schema
async function resolveSchemaRefs(schema, baseUrl) {
    try {
        console.log('🔗 Resolving external schema references...');

        // Extract base path from URL
        const urlParts = baseUrl.split('/');
        urlParts.pop(); // Remove filename
        const basePath = urlParts.join('/');

        // Find all external $ref patterns
        const externalRefs = new Set();
        const findExternalRefs = (obj) => {
            if (!obj || typeof obj !== 'object') return;

            if (obj.$ref && typeof obj.$ref === 'string') {
                // Check if it's an external reference (contains .json)
                if (obj.$ref.includes('.json')) {
                    // Extract just the filename
                    const match = obj.$ref.match(/([^\/]+\.json)/);
                    if (match) {
                        externalRefs.add(match[1]);
                    }
                }
            }

            // Recursively search
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    findExternalRefs(obj[key]);
                }
            }
        };

        findExternalRefs(schema);

        if (externalRefs.size === 0) {
            console.log('✅ No external references found, schema is self-contained');
            return schema;
        }

        console.log(`📦 Found ${externalRefs.size} external references:`, Array.from(externalRefs));

        // Fetch all referenced schemas
        const referencedSchemas = {};
        await Promise.all(
            Array.from(externalRefs).map(async (filename) => {
                try {
                    const refUrl = `${basePath}/${filename}`;
                    console.log(`  Fetching: ${filename}`);
                    const response = await fetch(refUrl);
                    if (response.ok) {
                        referencedSchemas[filename] = await response.json();
                    } else {
                        console.warn(`⚠️ Could not fetch ${filename}: ${response.status}`);
                    }
                } catch (error) {
                    console.warn(`⚠️ Error fetching ${filename}:`, error.message);
                }
            })
        );

        console.log(`✅ Fetched ${Object.keys(referencedSchemas).length} referenced schemas`);

        // Resolve references by inlining
        const resolveRefs = (obj, visited = new Set()) => {
            if (!obj || typeof obj !== 'object') return obj;

            // Prevent circular reference infinite loops
            if (visited.has(obj)) return obj;
            visited.add(obj);

            if (obj.$ref && typeof obj.$ref === 'string') {
                // Check if it's an external reference
                if (obj.$ref.includes('.json')) {
                    const match = obj.$ref.match(/([^\/]+\.json)(#.*)?/);
                    if (match) {
                        const [, filename, pointer] = match;
                        const refSchema = referencedSchemas[filename];

                        if (refSchema) {
                            // If there's a JSON pointer, navigate to it
                            if (pointer) {
                                const path = pointer.replace('#/', '').split('/');
                                let resolved = refSchema;
                                for (const segment of path) {
                                    if (resolved && resolved[segment]) {
                                        resolved = resolved[segment];
                                    } else {
                                        console.warn(`⚠️ Could not resolve pointer ${pointer} in ${filename}`);
                                        return obj; // Return original if can't resolve
                                    }
                                }
                                return resolveRefs(resolved, visited);
                            } else {
                                // No pointer, use whole schema
                                return resolveRefs(refSchema, visited);
                            }
                        } else {
                            console.warn(`⚠️ Referenced schema ${filename} not available`);
                            return obj; // Keep original ref if not available
                        }
                    }
                }
                // Internal reference, keep as-is
                return obj;
            }

            // Recursively resolve in arrays and objects
            if (Array.isArray(obj)) {
                return obj.map(item => resolveRefs(item, visited));
            }

            const resolved = {};
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    resolved[key] = resolveRefs(obj[key], visited);
                }
            }
            return resolved;
        };

        const resolvedSchema = resolveRefs(schema);
        console.log('✅ Schema references resolved');

        return resolvedSchema;

    } catch (error) {
        console.error('❌ Error resolving schema references:', error);
        // Return original schema if resolution fails
        return schema;
    }
}

// Fetch and cache schema
async function fetchAndCacheSchema(url) {
    try {
        // Check sessionStorage cache for resolved schema
        const resolvedCacheKey = `schema_resolved_${url}`;
        const cachedResolved = sessionStorage.getItem(resolvedCacheKey);

        if (cachedResolved) {
            console.log('✅ Using cached resolved schema from:', url);
            return JSON.parse(cachedResolved);
        }

        console.log('🌐 Fetching schema from:', url);
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Failed to fetch schema: ${response.status}`);
        }

        const schema = await response.json();
        console.log('✅ Schema fetched');

        // Resolve external references
        const resolvedSchema = await resolveSchemaRefs(schema, url);

        // Cache the resolved version
        sessionStorage.setItem(resolvedCacheKey, JSON.stringify(resolvedSchema));
        console.log('✅ Resolved schema cached');

        return resolvedSchema;

    } catch (error) {
        console.error('❌ Error fetching schema:', error);
        throw error;
    }
}

// Toggle detection between model and dataset
function togglePdfDetection(event) {
    event.preventDefault();

    // Toggle between model and dataset
    pdfState.cardType = pdfState.cardType === CARD_TYPES.MODEL ? CARD_TYPES.DATASET : CARD_TYPES.MODEL;

    // Update button states
    setPdfCardType(pdfState.cardType);

    // Update detection display
    updatePdfDetectionDisplay();
}

function toggleDebugDetection(event) {
    event.preventDefault();

    // Toggle between model and dataset
    debugState.cardType = debugState.cardType === CARD_TYPES.MODEL ? CARD_TYPES.DATASET : CARD_TYPES.MODEL;

    // Update button states
    setDebugCardType(debugState.cardType);

    // Update detection display
    updateDebugDetectionDisplay();
}

function updatePdfDetectionDisplay() {
    const detectionDiv = document.getElementById('pdf-schema-detection');
    const detectedTypeSpan = document.getElementById('pdf-detected-type');
    const toggleLink = document.getElementById('pdf-toggle-detection');

    detectedTypeSpan.textContent = pdfState.cardType === CARD_TYPES.MODEL ? 'Model Card' : 'Dataset Card';
    toggleLink.textContent = `[Switch to ${pdfState.cardType === CARD_TYPES.MODEL ? 'Dataset' : 'Model'}]`;
    detectionDiv.style.display = 'block';
}

function updateDebugDetectionDisplay() {
    const detectionDiv = document.getElementById('debug-schema-detection');
    const detectedTypeSpan = document.getElementById('debug-detected-type');
    const toggleLink = document.getElementById('debug-toggle-detection');

    detectedTypeSpan.textContent = debugState.cardType === CARD_TYPES.MODEL ? 'Model Card' : 'Dataset Card';
    toggleLink.textContent = `[Switch to ${debugState.cardType === CARD_TYPES.MODEL ? 'Dataset' : 'Model'}]`;
    detectionDiv.style.display = 'block';
}

// PDF Upload Handler
async function handlePdfUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.type.includes('pdf') && !file.name.toLowerCase().endsWith('.pdf')) {
        showAlert('Please select a valid PDF file.', 'danger');
        return;
    }

    // Validate file size (50MB limit for client-side processing)
    const maxSizeInMB = 50;
    if (file.size > maxSizeInMB * 1024 * 1024) {
        showAlert(`File size exceeds ${maxSizeInMB}MB limit. Please select a smaller PDF file.`, 'danger');
        return;
    }

    // Step 1: Use manually selected card type (auto-detection disabled)
    console.log('✅ Using manually selected card type:', pdfState.cardType);
    // Auto-detection disabled - using manual selection from buttons
    // showAlert('Analyzing PDF content...', 'info', 0);
    // try {
    //     pdfState.detectedType = await analyzeAndSelectSchema(file);
    //     pdfState.cardType = pdfState.detectedType;
    //
    //     // Update UI to show detection
    //     setPdfCardType(pdfState.cardType);
    //     updatePdfDetectionDisplay();
    //
    //     console.log('✅ Auto-detected card type:', pdfState.cardType);
    // } catch (error) {
    //     console.error('Error during PDF analysis:', error);
    //     // Continue with current selection if analysis fails
    // }

    // Step 2: Fetch the schema
    showAlert('Fetching schema...', 'info', 0);
    let customSchema = null;

    try {
        const customUrl = document.getElementById('pdf-custom-schema-url').value;
        const schemaUrl = getSchemaUrl(pdfState.cardType, pdfState.schemaSource, customUrl);
        pdfState.schemaUrl = schemaUrl;

        customSchema = await fetchAndCacheSchema(schemaUrl);
        console.log('✅ Schema loaded from:', schemaUrl);
    } catch (error) {
        console.error('Error fetching schema:', error);
        showAlert('Error: Could not fetch custom schema from URL', 'error', 5000);
        return; // Cannot proceed without schema
    }

    // Step 3: Process PDF with client-side extraction + Gemini AI
    console.log('🔍 DEBUG: Processing configuration:', {
        mode: pdfState.processingMode,
        cardType: pdfState.cardType,
        schemaSource: pdfState.schemaSource,
        schemaUrl: pdfState.schemaUrl,
        hasCustomSchema: !!customSchema
    });

    try {
        // ========== NEW CLIENT-SIDE PROCESSING ==========

        // Note: No API key validation needed - using secure AWS backend
        // All Gemini API calls are routed through Lambda which handles authentication

        // Step 3a: Extract PDF data using PDF.js (client-side)
        showAlert('Extracting text from PDF...', 'info', 0);

        const pdfData = await extractPdfData(file, (progress) => {
            // Update UI with extraction progress
            if (progress.stage === 'extracting') {
                showAlert(progress.message, 'info', 0);
            }
        });

        console.log('✅ PDF extraction complete');
        console.log('📝 Text length:', pdfData.text.length, 'characters');
        console.log('📋 Tables found:', pdfData.tables.length);

        // Step 3b: Process with Gemini AI (async job processing)
        showAlert('Submitting PDF for processing... This may take 30-60 seconds.', 'info', 0);

        // Progress callback for async processing
        const progressCallback = (progress) => {
            let message = 'Processing PDF...';
            if (progress.status === 'submitting') {
                message = 'Submitting PDF for processing...';
            } else if (progress.status === 'polling') {
                message = `Processing PDF... (${progress.progress || 0}% complete)`;
            } else if (progress.status === 'processing') {
                message = `Processing PDF with Gemini AI... (${progress.progress || 50}%)`;
            }
            showAlert(message, 'info', 0);
        };

        const structuredJson = await processPdfAsync(
            pdfData,
            customSchema,           // Schema fetched earlier
            pdfState.cardType,      // 'model' or 'dataset'
            pdfState.processingMode, // 'text-only' or 'multimodal'
            progressCallback        // Progress updates
        );

        console.log('✅ Async PDF processing complete');

        // Store PDF metadata for potential saving
        if (structuredJson._metadata) {
            currentPdfMetadata = structuredJson._metadata;
            console.log('📋 PDF metadata stored:', currentPdfMetadata);
            // Remove metadata from schema data before processing
            delete structuredJson._metadata;
        }

        // Hide the loading indicator
        document.querySelector('.alert.custom-alert')?.remove();

        // Validate the response structure
        if (!structuredJson || (typeof structuredJson !== 'object')) {
            throw new Error('Invalid response format from PDF processing');
        }

        // Use the user-selected card type instead of trying to detect from response
        const cardType = pdfState.cardType;
        let editorData = {};

        // Extract data based on user selection
        if (cardType === CARD_TYPES.MODEL) {
            if (structuredJson.Model) {
                editorData = structuredJson.Model;
            } else {
                // Fallback: use root level data if no nested Model key
                editorData = structuredJson;
            }
        } else if (cardType === CARD_TYPES.DATASET) {
            if (structuredJson.Dataset) {
                editorData = structuredJson.Dataset;
            } else {
                // Fallback: use root level data if no nested Dataset key
                editorData = structuredJson;
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
        console.error('PDF Processing Error:', error);

        // Hide the loading indicator
        document.querySelector('.alert.custom-alert')?.remove();

        // Try to parse backend error details for more specific error messages
        let backendError = null;
        try {
            // Check if error.message contains backend JSON error details
            if (error.message && error.message.includes('{')) {
                const jsonStart = error.message.indexOf('{');
                const jsonStr = error.message.substring(jsonStart);
                backendError = JSON.parse(jsonStr);
            }
        } catch (parseError) {
            // Ignore parsing errors
        }

        // Enhanced error messages with backend error details
        let errorMessage = error.message;
        let errorDetails = '';

        // Check for specific error types from backend
        if (backendError?.errorType) {
            switch (backendError.errorType) {
                case 'SERVICE_UNAVAILABLE':
                    errorMessage = '⚠️ Gemini API Overloaded';
                    errorDetails = 'Google\'s Gemini servers are currently overloaded or experiencing high traffic. This is temporary and not a problem with your setup.';
                    if (backendError.geminiError?.message) {
                        errorDetails += `\n\nGoogle says: "${backendError.geminiError.message}"`;
                    }
                    errorDetails += '\n\n💡 What to do: Wait 1-2 minutes and try again.';
                    break;

                case 'TIMEOUT':
                    errorMessage = '⏱️ Request Timeout';
                    errorDetails = 'The Gemini API took longer than 30 seconds to respond. This can happen with complex PDFs or during high server load.';
                    errorDetails += '\n\n💡 What to do:\n• Wait a minute and try again\n• Try a shorter or simpler PDF\n• If it persists, Gemini may be experiencing delays';
                    break;

                case 'RATE_LIMIT':
                    errorMessage = '🚦 Rate Limit Exceeded';
                    errorDetails = 'You\'ve made too many requests to the Gemini API in a short time.';
                    errorDetails += '\n\n💡 What to do: Wait 60 seconds before trying again.';
                    break;

                case 'INVALID_REQUEST':
                    errorMessage = '❌ Invalid Request';
                    errorDetails = 'The request to Gemini API was invalid.';
                    if (backendError.geminiError?.message) {
                        errorDetails += `\n\nDetails: ${backendError.geminiError.message}`;
                    }
                    break;

                case 'API_KEY_ERROR':
                    errorMessage = '🔑 API Key Issue';
                    errorDetails = 'There\'s a problem with the API key configuration on the backend.';
                    errorDetails += '\n\n💡 Contact support if this persists.';
                    break;

                default:
                    if (backendError.error) {
                        errorMessage = '❌ Backend Error';
                        errorDetails = backendError.error;
                        if (backendError.geminiError?.message) {
                            errorDetails += `\n\nGemini API: ${backendError.geminiError.message}`;
                        }
                    }
            }
        }
        // Fallback to message-based detection for other errors
        else if (error.message.includes('API key') || error.message.includes('not configured')) {
            errorMessage = '🔑 API Key Required';
            errorDetails = 'API key configuration issue. Please contact support.';
        } else if (error.message.includes('quota') || error.message.includes('RESOURCE_EXHAUSTED')) {
            errorMessage = '⚠️ API Quota Exceeded';
            errorDetails = 'You have reached your Gemini API usage limits.\n\n💡 Check your quota at https://aistudio.google.com/';
        } else if (error.message.includes('SAFETY') || error.message.includes('safety filter')) {
            errorMessage = '🚫 Content Blocked';
            errorDetails = 'The PDF content was blocked by Gemini safety filters.\n\n💡 Try a different PDF or check the content.';
        } else if (error.message.includes('PDF') || error.message.includes('extraction')) {
            errorMessage = '📄 PDF Processing Error';
            errorDetails = error.message;
        } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
            errorMessage = '🌐 Network Error';
            errorDetails = 'Please check your internet connection and try again.';
        } else if (!errorDetails) {
            errorMessage = '❌ Processing Error';
            errorDetails = error.message;
        }

        // Add request ID if available for debugging
        if (backendError?.requestId) {
            errorDetails += `\n\n🔍 Request ID: ${backendError.requestId}`;
        }

        // Combine message and details
        const fullMessage = errorDetails ? `${errorMessage}\n\n${errorDetails}` : errorMessage;

        // Log full error details to console for debugging
        console.error('📊 Full error details:', {
            message: errorMessage,
            details: errorDetails,
            backendError: backendError,
            originalError: error
        });

        showAlert(fullMessage, 'danger');

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

// Schema Storage Functions

// Global variable to store PDF metadata for saving
let currentPdfMetadata = null;

async function saveToServer() {
    if (!editor) {
        showAlert('Editor not ready yet. Please wait a moment and try again.', 'warning');
        return;
    }

    try {
        const schemaData = editor.getValue();
        
        // Check if we have DOI from PDF processing
        if (!currentPdfMetadata || !currentPdfMetadata.doi) {
            // Try to extract DOI from the schema data or ask user
            const doi = prompt('Please enter the DOI for this paper (required for saving):');
            if (!doi || doi.trim() === '') {
                showAlert('DOI is required to save schemas to the server.', 'warning');
                return;
            }
            currentPdfMetadata = { doi: doi.trim() };
        }

        const saveButton = document.getElementById('save-to-server-btn');
        saveButton.disabled = true;
        saveButton.innerHTML = '<i class="fa fa-spinner fa-spin mr-1"></i>Saving...';

        const response = await fetch('/api/save-schema', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                schema: schemaData,
                doi: currentPdfMetadata.doi,
                paperMetadata: currentPdfMetadata
            })
        });

        const result = await response.json();

        if (result.success) {
            showAlert(`✅ ${result.message} for DOI: ${currentPdfMetadata.doi}`, 'success');
        } else {
            throw new Error(result.error || 'Failed to save schema');
        }

    } catch (error) {
        console.error('Save to server error:', error);
        showAlert('Failed to save schema: ' + error.message, 'danger');
    } finally {
        const saveButton = document.getElementById('save-to-server-btn');
        saveButton.disabled = false;
        saveButton.innerHTML = '<i class="fa fa-save mr-1"></i>Save to Server';
    }
}

async function browseSchemas() {
    // Show the modal
    $('#browseSchemasModal').modal('show');
    
    // Load schemas and statistics
    await Promise.all([
        loadSchemas(),
        loadStatistics()
    ]);
}

async function loadSchemas(filters = {}) {
    try {
        const schemasList = document.getElementById('schemas-list');
        schemasList.innerHTML = '<div class="text-center p-4"><i class="fa fa-spinner fa-spin fa-2x mb-2"></i><p>Loading schemas...</p></div>';

        const queryParams = new URLSearchParams();
        if (filters.type) queryParams.append('type', filters.type);
        if (filters.year) queryParams.append('year', filters.year);
        if (filters.search) queryParams.append('search', filters.search);

        const response = await fetch(`/api/schemas?${queryParams}`);
        const result = await response.json();

        if (result.success) {
            displaySchemas(result.schemas);
        } else {
            throw new Error(result.error || 'Failed to load schemas');
        }

    } catch (error) {
        console.error('Error loading schemas:', error);
        document.getElementById('schemas-list').innerHTML = 
            '<div class="alert alert-danger">Error loading schemas: ' + error.message + '</div>';
    }
}

function displaySchemas(schemas) {
    const schemasList = document.getElementById('schemas-list');
    
    if (schemas.length === 0) {
        schemasList.innerHTML = '<div class="text-center p-4"><i class="fa fa-folder-open fa-3x text-muted mb-3"></i><p class="text-muted">No schemas found</p></div>';
        return;
    }

    let html = '<div class="row">';
    
    schemas.forEach(schema => {
        const authors = schema.authors && schema.authors.length > 0 ? schema.authors.slice(0, 3).join(', ') + (schema.authors.length > 3 ? ', et al.' : '') : 'Unknown Authors';
        const typeColor = schema.schema_type === CARD_TYPES.MODEL ? 'primary' : 'success';
        const typeIcon = schema.schema_type === CARD_TYPES.MODEL ? 'brain' : 'database';
        
        html += `
        <div class="col-md-6 mb-3">
            <div class="card h-100">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <span class="badge badge-${typeColor}">
                        <i class="fa fa-${typeIcon} mr-1"></i>${schema.schema_type.toUpperCase()}
                    </span>
                    <small class="text-muted">${new Date(schema.extraction_date).toLocaleDateString()}</small>
                </div>
                <div class="card-body">
                    <h6 class="card-title" title="${schema.title}">
                        ${schema.title ? schema.title.substring(0, 100) + (schema.title.length > 100 ? '...' : '') : 'Untitled'}
                    </h6>
                    <p class="card-text small text-muted mb-1">
                        <strong>Authors:</strong> ${authors}
                    </p>
                    ${schema.journal ? `<p class="card-text small text-muted mb-1"><strong>Journal:</strong> ${schema.journal}</p>` : ''}
                    ${schema.publication_year ? `<p class="card-text small text-muted mb-1"><strong>Year:</strong> ${schema.publication_year}</p>` : ''}
                    <p class="card-text small">
                        <strong>DOI:</strong> <code class="small">${schema.doi}</code>
                    </p>
                    ${schema.version_count > 1 ? `<p class="card-text small text-info"><i class="fa fa-history mr-1"></i>Version ${schema.version_count}</p>` : ''}
                </div>
                <div class="card-footer">
                    <div class="btn-group btn-group-sm w-100" role="group">
                        <button class="btn btn-primary" onclick="loadSchema('${encodeURIComponent(schema.doi)}')">Load</button>
                        <button class="btn btn-outline-secondary" onclick="viewSchemaDetails('${encodeURIComponent(schema.doi)}')">Details</button>
                        <button class="btn btn-outline-danger" onclick="confirmDeleteSchema('${encodeURIComponent(schema.doi)}', '${schema.title ? schema.title.replace(/'/g, "\\'"): 'Untitled'}')">Delete</button>
                    </div>
                </div>
            </div>
        </div>`;
    });
    
    html += '</div>';
    schemasList.innerHTML = html;
}

async function loadStatistics() {
    try {
        const response = await fetch('/api/statistics');
        const result = await response.json();

        if (result.success) {
            const stats = result.statistics;
            document.getElementById('schema-statistics').innerHTML = `
                <strong>Database Statistics:</strong> 
                ${stats.total_schemas} total schemas • 
                ${stats.model_count} models • 
                ${stats.dataset_count} datasets • 
                Average ${stats.avg_versions ? parseFloat(stats.avg_versions).toFixed(1) : '1.0'} versions per schema
            `;
        }
    } catch (error) {
        console.error('Error loading statistics:', error);
        document.getElementById('schema-statistics').innerHTML = 
            '<span class="text-warning">Statistics unavailable</span>';
    }
}

async function loadSchema(encodedDoi) {
    try {
        const doi = decodeURIComponent(encodedDoi);
        
        showAlert('Loading schema...', 'info', 0);
        
        const response = await fetch(`/api/schema/${encodedDoi}`);
        const result = await response.json();
        
        document.querySelector('.alert.custom-alert')?.remove();
        
        if (result.success) {
            // Close the modal
            $('#browseSchemasModal').modal('hide');
            
            // Set the current metadata for potential saving
            currentPdfMetadata = {
                doi: doi,
                ...result.metadata
            };
            
            // Determine card type and switch to editor
            const cardType = result.schema.Model ? 'model' : 'dataset';
            const editorData = result.schema.Model || result.schema.Dataset;
            
            currentCardType = cardType;
            document.getElementById('initial-screen').style.display = 'none';
            document.getElementById('editor-section').style.display = 'block';
            updateEditorUI(cardType);
            
            // Initialize editor with loaded data
            initializeEditor(editorData);
            
            showAlert(`✅ Loaded schema for: ${result.metadata.title || doi}`, 'success');
        } else {
            throw new Error(result.error || 'Failed to load schema');
        }
    } catch (error) {
        console.error('Error loading schema:', error);
        document.querySelector('.alert.custom-alert')?.remove();
        showAlert('Failed to load schema: ' + error.message, 'danger');
    }
}

function viewSchemaDetails(encodedDoi) {
    const doi = decodeURIComponent(encodedDoi);
    alert(`Schema Details:\n\nDOI: ${doi}\n\nFull details viewer coming soon!`);
}

function confirmDeleteSchema(encodedDoi, title) {
    if (confirm(`Are you sure you want to delete the schema for:\n\n"${title}"\n\nThis action cannot be undone.`)) {
        deleteSchema(encodedDoi);
    }
}

async function deleteSchema(encodedDoi) {
    try {
        const doi = decodeURIComponent(encodedDoi);
        
        const response = await fetch(`/api/schema/${encodedDoi}`, {
            method: 'DELETE'
        });
        
        const result = await response.json();
        
        if (result.success) {
            showAlert(`✅ Schema deleted: ${doi}`, 'success');
            // Refresh the schemas list
            await loadSchemas();
            await loadStatistics();
        } else {
            throw new Error(result.error || 'Failed to delete schema');
        }
    } catch (error) {
        console.error('Error deleting schema:', error);
        showAlert('Failed to delete schema: ' + error.message, 'danger');
    }
}

async function searchSchemas() {
    const filters = {
        search: document.getElementById('schema-search').value,
        type: document.getElementById('schema-type-filter').value,
        year: document.getElementById('schema-year-filter').value
    };
    
    await loadSchemas(filters);
}

async function refreshSchemas() {
    // Clear filters
    document.getElementById('schema-search').value = '';
    document.getElementById('schema-type-filter').value = '';
    document.getElementById('schema-year-filter').value = '';
    
    await Promise.all([
        loadSchemas(),
        loadStatistics()
    ]);
}

// Update the PDF upload handler to store metadata
const originalHandlePdfUpload = handlePdfUpload;

handlePdfUpload = async function(event) {
    // Call the original function
    await originalHandlePdfUpload(event);
    
    // The original function should have set currentPdfMetadata if processing was successful
    // This happens in the PDF processing response handling
};

// Update editor button states to include save button
function updateEditorButtons() {
    const downloadJsonBtn = document.getElementById('download-json-btn');
    const downloadTxtBtn = document.getElementById('download-txt-btn');
    const saveToServerBtn = document.getElementById('save-to-server-btn');
    
    const hasData = editor && editor.getValue();
    
    if (downloadJsonBtn) downloadJsonBtn.disabled = !hasData;
    if (downloadTxtBtn) downloadTxtBtn.disabled = !hasData;
    if (saveToServerBtn) saveToServerBtn.disabled = !hasData;
}

// Update the PDF upload success handler to store metadata
const originalInitializeEditor = initializeEditor;
initializeEditor = function(data) {
    originalInitializeEditor(data);
    
    // Update button states after editor is initialized
    setTimeout(updateEditorButtons, 100);
};

// Navigation functions
function showInitialScreen() {
    document.getElementById('initial-screen').style.display = 'block';
    document.getElementById('debug-screen').style.display = 'none';
    document.getElementById('card-type-selection').style.display = 'none';
    document.getElementById('editor-screen').style.display = 'none';
}

// Debug PDF processing functions
function showDebugScreen() {
    document.getElementById('initial-screen').style.display = 'none';
    document.getElementById('debug-screen').style.display = 'block';
}

async function handleDebugPdfUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    console.log('🔍 Debug: Starting PDF analysis for', file.name);

    // Show debug screen and processing steps
    showDebugScreen();
    document.getElementById('debug-steps').style.display = 'block';

    // Step 1: Analyze PDF and auto-detect schema type
    document.getElementById('debug-status').innerHTML = `
        <div class="alert alert-info">
            <i class="fa fa-spinner fa-spin mr-2"></i>Analyzing PDF content...
        </div>
    `;

    try {
        debugState.detectedType = await analyzeAndSelectSchema(file);
        debugState.cardType = debugState.detectedType;

        // Update UI to show detection
        setDebugCardType(debugState.cardType);
        updateDebugDetectionDisplay();

        console.log('✅ Auto-detected card type:', debugState.cardType);
    } catch (error) {
        console.error('Error during PDF analysis:', error);
        // Continue with current selection if analysis fails
    }

    // Step 2: Fetch the schema
    let customSchema = null;

    try {
        const customUrl = document.getElementById('debug-custom-schema-url').value;
        const schemaUrl = getSchemaUrl(debugState.cardType, debugState.schemaSource, customUrl);
        debugState.schemaUrl = schemaUrl;

        customSchema = await fetchAndCacheSchema(schemaUrl);
        console.log('✅ Schema loaded from:', schemaUrl);
    } catch (error) {
        console.error('Error fetching custom schema:', error);
        showAlert('Warning: Could not fetch custom schema, using GitHub default', 'warning', 4000);
    }

    // Step 3: Process PDF
    // Update status
    document.getElementById('debug-status').innerHTML = `
        <div class="alert alert-primary">
            <i class="fa fa-spinner fa-spin mr-2"></i>Processing: ${file.name} (${Math.round(file.size / 1024)} KB)
        </div>
    `;

    // Reset all preview areas
    document.getElementById('debug-text-preview').textContent = 'Processing...';
    document.getElementById('debug-tables-preview').textContent = 'Processing...';
    document.getElementById('debug-images-preview').textContent = 'Processing...';
    document.getElementById('debug-results-preview').textContent = 'Waiting for processing...';

    try {
        console.log('🔍 DEBUG: Processing configuration:', {
            mode: debugState.processingMode,
            cardType: debugState.cardType,
            schemaSource: debugState.schemaSource,
            schemaUrl: debugState.schemaUrl,
            hasCustomSchema: !!customSchema
        });

        // Step 3a: Extract PDF data using PDF.js (client-side)
        document.getElementById('debug-status').innerHTML = `
            <div class="alert alert-info">
                <i class="fa fa-spinner fa-spin mr-2"></i>Extracting PDF data...
            </div>
        `;

        const pdfData = await extractPdfData(file, (progress) => {
            if (progress.stage === 'extracting') {
                document.getElementById('debug-status').innerHTML = `
                    <div class="alert alert-info">
                        <i class="fa fa-spinner fa-spin mr-2"></i>${progress.message}
                    </div>
                `;
            }
        });

        console.log('✅ PDF extraction complete for debug mode');
        console.log('📝 Text length:', pdfData.text.length, 'characters');
        console.log('📋 Tables found:', pdfData.tables.length);
        console.log('🖼️ Images found:', pdfData.images.length);

        // Display client-side extraction results immediately
        const debugDataClientSide = {
            extractedText: pdfData.text,
            extractedTables: pdfData.tables,
            allImagesFound: pdfData.images,
            referencedImages: pdfData.images.slice(0, 10), // First 10 images
            figureReferences: [],
            metadata: {
                textLength: pdfData.text.length,
                tableCount: pdfData.tables.length,
                imageCount: pdfData.images.length
            }
        };

        // Show immediate extraction results
        updateDebugDisplays(debugDataClientSide);

        // Step 3b: Process with Gemini AI via async API
        document.getElementById('debug-status').innerHTML = `
            <div class="alert alert-primary">
                <i class="fa fa-spinner fa-spin mr-2"></i>Submitting to Gemini AI... (this may take 30-60 seconds)
            </div>
        `;

        // Progress callback for async processing
        const progressCallback = (progress) => {
            let message = 'Processing...';
            if (progress.status === 'submitting') {
                message = 'Submitting PDF for processing...';
            } else if (progress.status === 'polling') {
                message = `Processing with Gemini AI... (${progress.progress || 0}% complete)`;
            } else if (progress.status === 'processing') {
                message = `Processing with Gemini AI... (${progress.progress || 50}%)`;
            }

            document.getElementById('debug-status').innerHTML = `
                <div class="alert alert-primary">
                    <i class="fa fa-spinner fa-spin mr-2"></i>${message}
                </div>
            `;
        };

        const structuredJson = await processPdfAsync(
            pdfData,
            customSchema,
            debugState.cardType,
            debugState.processingMode,
            progressCallback
        );

        console.log('✅ Debug async processing complete');

        // Update with final AI results
        const debugDataFinal = {
            ...debugDataClientSide,
            gemini_result: structuredJson,
            processing_summary: {
                status: 'completed',
                cardType: debugState.cardType,
                processingMode: debugState.processingMode
            }
        };

        updateDebugDisplays(debugDataFinal);

        document.getElementById('debug-status').innerHTML = `
            <div class="alert alert-success">
                <i class="fa fa-check-circle mr-2"></i>Debug processing complete!
            </div>
        `;

    } catch (error) {
        console.error('Debug processing error:', error);
        document.getElementById('debug-status').innerHTML = `
            <div class="alert alert-danger">
                <i class="fa fa-exclamation-circle mr-2"></i>Error: ${error.message}
            </div>
        `;
    }
}

function updateDebugDisplays(debugData) {
    // Update Document AI section with detailed stats
    const summary = debugData.processing_summary || {};
    const metadata = debugData.metadata || {};

    document.getElementById('docai-status').innerHTML = '<span class="badge badge-success">Complete</span>';

    // Enhanced text preview with statistics
    const textLength = debugData.extractedText?.length || 0;
    const textPreview = debugData.extractedText
        ? `=== EXTRACTED TEXT (${textLength.toLocaleString()} chars) ===\n\n${debugData.extractedText.substring(0, 3000)}${textLength > 3000 ? '\n\n... [text continues - showing first 3000 chars]' : ''}`
        : 'No text extracted';
    document.getElementById('debug-text-preview').textContent = textPreview;

    // Enhanced tables preview with detailed formatting
    const tablesText = debugData.extractedTables && debugData.extractedTables.length > 0
        ? `=== EXTRACTED TABLES (${debugData.extractedTables.length} found) ===\n\n` +
          debugData.extractedTables.map((table, idx) =>
            `TABLE ${idx + 1} (Page ${table.page}):\n` +
            `Headers: ${JSON.stringify(table.headers)}\n` +
            `Rows (${table.rows.length}):\n${JSON.stringify(table.rows, null, 2)}`
          ).join('\n\n---\n\n')
        : 'No tables found';
    document.getElementById('debug-tables-preview').textContent = tablesText;

    // Enhanced images preview with all images info
    const totalImages = debugData.allImagesFound?.length || 0;
    const selectedImages = debugData.referencedImages?.length || 0;
    const figureRefs = debugData.figureReferences || [];

    const imagesText = `=== IMAGE ANALYSIS ===\n\n` +
        `Total images found: ${totalImages}\n` +
        `Selected for AI: ${selectedImages}\n` +
        `Figure references in text: ${figureRefs.length > 0 ? figureRefs.join(', ') : 'none'}\n\n` +
        (debugData.referencedImages && debugData.referencedImages.length > 0
            ? `SELECTED IMAGES:\n` + debugData.referencedImages.map(img =>
                `• Figure ${img.figureNumber} (Page ${img.page}) - ${img.referenced ? 'Referenced in text ✓' : 'Not referenced'}`
              ).join('\n')
            : 'No images selected for AI processing');
    document.getElementById('debug-images-preview').textContent = imagesText;

    // Enhanced single-step prompt preview with full details
    if (debugData.enhanced_prompt) {
        const promptLength = debugData.enhanced_prompt.length;
        document.getElementById('extraction-status').innerHTML = `<span class="badge badge-success">Complete (${promptLength.toLocaleString()} chars)</span>`;

        // Show comprehensive prompt with metadata
        const promptDisplay = `=== AI EXTRACTION PROMPT ===\n\n` +
            `Prompt Type: Enhanced Single-Step Extraction\n` +
            `Card Type: ${summary.card_type || 'unknown'}\n` +
            `Processing Mode: ${summary.processing_mode || 'unknown'}\n` +
            `Prompt Length: ${promptLength.toLocaleString()} characters\n` +
            `Schema Source: ${debugState.schemaSource || 'unknown'}\n` +
            `Schema URL: ${debugState.schemaUrl || 'none'}\n\n` +
            `--- FULL PROMPT SENT TO GEMINI AI ---\n\n` +
            debugData.enhanced_prompt;

        document.getElementById('debug-extraction-prompt').textContent = promptDisplay;

        // Update step 2 to show it's single-step process
        document.getElementById('formatting-status').innerHTML = '<span class="badge badge-secondary">N/A (Single-Step)</span>';
        document.getElementById('debug-formatting-prompt').textContent =
            '=== WORKFLOW INFORMATION ===\n\n' +
            'This system uses a SINGLE-STEP enhanced prompt that:\n' +
            '• Extracts structured information from the PDF\n' +
            '• Formats it directly into ROADMAP JSON schema\n' +
            '• Includes strict schema enforcement rules\n' +
            '• Maps fields correctly to avoid schema mismatches\n\n' +
            'Previously used two-step approach (extraction → formatting) has been deprecated.\n' +
            'The single enhanced prompt shown above is sent directly to Gemini AI.';
    }

    // Results preview (if AI has been called)
    const aiResults = debugData.gemini_result || debugData.roadmapResults;
    if (aiResults) {
        document.getElementById('results-status').innerHTML = '<span class="badge badge-success">Complete</span>';
        const resultsDisplay = `=== AI EXTRACTION RESULTS ===\n\n` +
            `Card Type: ${summary.cardType || summary.card_type || 'unknown'}\n` +
            `Processing Mode: ${summary.processingMode || summary.processing_mode || 'unknown'}\n` +
            `Result Length: ${JSON.stringify(aiResults).length.toLocaleString()} chars\n\n` +
            `--- EXTRACTED JSON ---\n\n` +
            JSON.stringify(aiResults, null, 2);
        document.getElementById('debug-results-preview').textContent = resultsDisplay;
    } else {
        document.getElementById('results-status').innerHTML = '<span class="badge badge-info">Extracting...</span>';
        document.getElementById('debug-results-preview').textContent =
            '=== EXTRACTION IN PROGRESS ===\n\n' +
            'Waiting for Gemini AI to process the PDF...\n\n' +
            'Results will appear here when processing is complete.';
    }

    // Update overall status with comprehensive processing info
    document.getElementById('debug-status').innerHTML = `
        <div class="alert alert-success">
            <i class="fa fa-check-circle mr-2"></i><strong>Debug Processing Complete</strong><br>
            <small>
                <strong>Document Analysis:</strong><br>
                • Pages processed: ${summary.pages_processed || 0}<br>
                • Text extracted: ${textLength.toLocaleString()} characters<br>
                • Tables found: ${debugData.extractedTables?.length || 0}<br>
                • Total images found: ${totalImages}<br>
                • Images selected for AI: ${selectedImages}<br>
                <br>
                <strong>AI Configuration:</strong><br>
                • Card type: ${summary.card_type || 'unknown'}<br>
                • Processing mode: ${summary.processing_mode || 'unknown'}<br>
                • Schema source: ${debugState.schemaSource}<br>
                • Workflow: ${summary.workflow_type || 'enhanced_single_step_extraction'}<br>
                • Prompt length: ${(summary.enhanced_prompt_length || 0).toLocaleString()} chars<br>
            </small>
        </div>
    `;

    // Log comprehensive extraction details to console
    console.log('🔍 ===== DEBUG EXTRACTION COMPLETE =====');
    console.log('📄 Document:', {
        filename: metadata.filename,
        textLength: textLength,
        tablesCount: debugData.extractedTables?.length || 0,
        imagesTotal: totalImages,
        imagesSelected: selectedImages,
        pagesProcessed: summary.pages_processed
    });
    console.log('🤖 AI Configuration:', {
        cardType: summary.card_type,
        processingMode: summary.processing_mode,
        schemaSource: debugState.schemaSource,
        schemaUrl: debugState.schemaUrl,
        workflowType: summary.workflow_type,
        promptLength: summary.enhanced_prompt_length
    });
    console.log('📋 Full prompt available in "AI Extraction Step 1" section');
    console.log('=======================================');
}
