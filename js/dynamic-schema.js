// Dynamic Schema Processor - Loads schemas from local files or custom URLs
// VERSION: v41 (Fixed: Convert prefixItems to items array for JSON Editor compatibility)
class DynamicSchemaProcessor {
    constructor() {
        console.log('🔧 DynamicSchemaProcessor v41 loaded (Fixed: prefixItems → items array conversion)');
        this.baseSchemas = {
            model: null,
            dataset: null
        };
        this.loadedSchemas = {
            model: null,
            dataset: null
        };
        this.currentSchemaSource = {
            model: 'local',
            dataset: 'local'
        };
        this.schemaCache = null;
        this.schemaCacheTime = null;
        this.CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
    }

    // Local schema file paths (loaded from schemas directory)
    get LOCAL_SCHEMAS() {
        return {
            model: 'schemas/model.json',
            dataset: 'schemas/dataset.json'
        };
    }

    // Cache for external schema files
    externalSchemaCache = new Map();

    // Fetch external ROADMAP schema file
    async fetchExternalSchema(filename) {
        // Check cache first
        if (this.externalSchemaCache.has(filename)) {
            console.log(`  📦 Using cached: ${filename}`);
            return this.externalSchemaCache.get(filename);
        }

        try {
            const url = `https://raw.githubusercontent.com/cekahn/ROADMAP/main/Schema%20component%20files/${filename}`;
            console.log(`  🌐 Fetching: ${filename}`);

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const externalSchema = await response.json();
            this.externalSchemaCache.set(filename, externalSchema);
            return externalSchema;
        } catch (error) {
            console.warn(`  ⚠️ Failed to fetch ${filename}:`, error.message);
            return null;
        }
    }

    // Resolve all external $ref in schema
    async resolveExternalRefs(schema) {
        console.log('🔗 Resolving external schema references...');

        // Recursively find and resolve all external $ref
        const resolveRefs = async (obj, visited = new Set()) => {
            if (!obj || typeof obj !== 'object' || visited.has(obj)) return obj;
            visited.add(obj);

            if (Array.isArray(obj)) {
                for (let i = 0; i < obj.length; i++) {
                    obj[i] = await resolveRefs(obj[i], visited);
                }
                return obj;
            }

            // Check if this object has an external $ref
            if (obj.$ref && !obj.$ref.startsWith('#')) {
                const filename = obj.$ref;
                const externalSchema = await this.fetchExternalSchema(filename);

                if (externalSchema) {
                    // Replace $ref with actual schema content
                    // Keep other properties and merge with fetched schema
                    const resolved = { ...externalSchema };
                    for (const key in obj) {
                        if (key !== '$ref') {
                            resolved[key] = obj[key];
                        }
                    }
                    return await resolveRefs(resolved, visited);
                }
            }

            // Recursively process all properties
            for (const key in obj) {
                if (obj.hasOwnProperty(key)) {
                    obj[key] = await resolveRefs(obj[key], visited);
                }
            }

            return obj;
        };

        const resolved = await resolveRefs(JSON.parse(JSON.stringify(schema)));
        console.log('✅ External references resolved');
        return resolved;
    }

    // Load base schemas from local files (with caching and external ref resolution)
    async loadBaseSchemas() {
        try {
            // Check if we have a valid cached copy
            if (this.schemaCache && this.schemaCacheTime && (Date.now() - this.schemaCacheTime < this.CACHE_DURATION_MS)) {
                console.log('📦 Using cached schemas');
                this.baseSchemas.model = this.schemaCache.model;
                this.baseSchemas.dataset = this.schemaCache.dataset;
                return true;
            }

            console.log('📂 Loading schemas from local files...');
            console.log('  Model:', this.LOCAL_SCHEMAS.model);
            console.log('  Dataset:', this.LOCAL_SCHEMAS.dataset);

            const [modelResponse, datasetResponse] = await Promise.all([
                fetch(this.LOCAL_SCHEMAS.model),
                fetch(this.LOCAL_SCHEMAS.dataset)
            ]);

            if (!modelResponse.ok) {
                throw new Error(`Failed to fetch model schema: ${modelResponse.status} ${modelResponse.statusText}`);
            }
            if (!datasetResponse.ok) {
                throw new Error(`Failed to fetch dataset schema: ${datasetResponse.status} ${datasetResponse.statusText}`);
            }

            let modelSchema = await modelResponse.json();
            let datasetSchema = await datasetResponse.json();

            // Resolve external references in both schemas
            console.log('🔗 Resolving external references in schemas...');
            modelSchema = await this.resolveExternalRefs(modelSchema);
            datasetSchema = await this.resolveExternalRefs(datasetSchema);

            this.baseSchemas.model = modelSchema;
            this.baseSchemas.dataset = datasetSchema;

            // Cache the results
            this.schemaCache = {
                model: this.baseSchemas.model,
                dataset: this.baseSchemas.dataset
            };
            this.schemaCacheTime = Date.now();

            console.log('✅ Base schemas loaded from local files successfully');
            console.log('   Cache will expire in 5 minutes');
            return true;
        } catch (error) {
            console.error('❌ Failed to load schemas from local files:', error);
            return false;
        }
    }

    // Load schema from custom URL
    async loadCustomSchema(cardType, customUrl) {
        try {
            console.log(`Loading custom ${cardType} schema from:`, customUrl);
            
            const response = await fetch(customUrl);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const customSchema = await response.json();
            
            // Validate that it's a proper ROADMAP schema
            if (!this.validateSchema(customSchema, cardType)) {
                throw new Error('Invalid ROADMAP schema structure');
            }

            this.loadedSchemas[cardType] = customSchema;
            this.currentSchemaSource[cardType] = customUrl;
            
            console.log(`✅ Custom ${cardType} schema loaded from URL`);
            return customSchema;
            
        } catch (error) {
            console.warn(`⚠️ Failed to load custom schema, falling back to base:`, error);
            
            // Fallback to base schema
            this.loadedSchemas[cardType] = this.baseSchemas[cardType];
            this.currentSchemaSource[cardType] = 'base';
            
            return this.baseSchemas[cardType];
        }
    }

    // Get schema (base or custom)
    async getSchema(cardType, customUrl = null) {
        // Load base schemas if not already loaded
        if (!this.baseSchemas.model || !this.baseSchemas.dataset) {
            const success = await this.loadBaseSchemas();
            if (!success) {
                throw new Error('Cannot load base schemas');
            }
        }

        let schema;

        if (customUrl) {
            schema = await this.loadCustomSchema(cardType, customUrl);
        } else {
            schema = this.baseSchemas[cardType];
            this.loadedSchemas[cardType] = schema;
            // FIXED v27: Detect actual source instead of always saying "github"
            // baseSchemas are loaded from local paths (schemas/*.json) via app.js FETCH_SCHEMA_URLS
            this.currentSchemaSource[cardType] = 'local';
            console.log(`✅ Using local schema for ${cardType} (from schemas/${cardType}.json)`);
        }

        // Convert to JSON Editor format
        return this.convertToJsonEditorSchema(schema, cardType);
    }

    // Validate schema structure
    validateSchema(schema, cardType) {
        if (!schema || typeof schema !== 'object') return false;
        
        // Check for required ROADMAP structure
        const expectedSection = cardType.charAt(0).toUpperCase() + cardType.slice(1);
        
        return (
            schema.$defs &&
            schema.properties &&
            schema.properties[expectedSection] &&
            schema.$defs[cardType.toLowerCase()]
        );
    }

    // Categorize properties into logical groups (generic approach)
    categorizeProperties(properties, cardType) {
        const categories = {};

        // Define common property patterns for categorization
        const coreKeywords = ['name', 'title', 'description', 'summary', 'overview'];
        const metadataKeywords = ['author', 'publication', 'date', 'version', 'license', 'doi', 'reference'];
        const technicalKeywords = ['imaging', 'modality', 'architecture', 'algorithm', 'training', 'input', 'output'];
        const dataKeywords = ['dataset', 'data', 'subset', 'partition', 'sample', 'subject', 'patient'];
        const performanceKeywords = ['performance', 'metric', 'accuracy', 'evaluation', 'validation'];
        const detailsKeywords = ['detail', 'specification', 'parameter', 'configuration', 'setting'];

        // Categorize each property
        for (const [propKey, propValue] of Object.entries(properties)) {
            const keyLower = propKey.toLowerCase();
            const title = propValue.title?.toLowerCase() || '';
            const description = propValue.description?.toLowerCase() || '';
            const combined = `${keyLower} ${title} ${description}`;

            let category = 'Other';

            // Check against keyword patterns
            if (coreKeywords.some(kw => combined.includes(kw))) {
                category = 'Core Information';
            } else if (metadataKeywords.some(kw => combined.includes(kw))) {
                category = 'Metadata & Attribution';
            } else if (technicalKeywords.some(kw => combined.includes(kw))) {
                category = cardType === 'model' ? 'Technical Details' : 'Imaging Details';
            } else if (dataKeywords.some(kw => combined.includes(kw))) {
                category = 'Data & Subsets';
            } else if (performanceKeywords.some(kw => combined.includes(kw))) {
                category = 'Performance & Evaluation';
            } else if (detailsKeywords.some(kw => combined.includes(kw))) {
                category = 'Additional Details';
            }

            // Initialize category array if needed
            if (!categories[category]) {
                categories[category] = [];
            }

            // Add property key to category
            categories[category].push(propKey);
        }

        // Remove empty categories and single-item "Other" category
        if (categories['Other'] && categories['Other'].length === 1 && Object.keys(categories).length > 1) {
            // Move single "Other" item to largest category
            const largestCategory = Object.entries(categories)
                .filter(([cat]) => cat !== 'Other')
                .sort((a, b) => b[1].length - a[1].length)[0];

            if (largestCategory) {
                largestCategory[1].push(...categories['Other']);
                delete categories['Other'];
            }
        }

        // Sort categories by priority
        const categoryOrder = [
            'Core Information',
            'Metadata & Attribution',
            'Technical Details',
            'Imaging Details',
            'Data & Subsets',
            'Performance & Evaluation',
            'Additional Details',
            'Other'
        ];

        const sortedCategories = {};
        categoryOrder.forEach(cat => {
            if (categories[cat]) {
                sortedCategories[cat] = categories[cat];
            }
        });

        return sortedCategories;
    }

    // Dynamically find properties in schema (handles different schema structures)
    findSchemaProperties(schema, cardType) {
        const capitalizedType = cardType.charAt(0).toUpperCase() + cardType.slice(1);
        const lowercaseType = cardType.toLowerCase();

        // Strategy 0: Check if properties.Model/Dataset has $ref, resolve it (2025-11 format)
        if (schema.properties?.[capitalizedType]?.$ref) {
            const refPath = schema.properties[capitalizedType].$ref.replace('#/$defs/', '');
            if (schema.$defs?.[refPath]?.properties) {
                console.log(`✅ Found properties via $ref: $defs.${refPath} (2025-11 format)`);
                return {
                    properties: schema.$defs[refPath].properties,
                    required: schema.$defs[refPath].required || [],
                    defs: schema.$defs,
                    source: `$defs.${refPath} (via $ref)`
                };
            }
        }

        // Strategy 1: Try properties.Dataset or properties.Model with direct properties (old GitHub format)
        if (schema.properties?.[capitalizedType]?.properties) {
            console.log(`✅ Found properties at: properties.${capitalizedType} (old GitHub format)`);
            return {
                properties: schema.properties[capitalizedType].properties,
                required: schema.properties[capitalizedType].required || [],
                defs: schema.$defs || {},
                source: `properties.${capitalizedType}`
            };
        }

        // Strategy 2: Try $defs with both capitalized and lowercase (handle case variations)
        const defKey = schema.$defs?.[capitalizedType] ? capitalizedType : lowercaseType;
        if (schema.$defs?.[defKey]?.properties) {
            console.log(`✅ Found properties at: $defs.${defKey} (legacy format)`);
            return {
                properties: schema.$defs[defKey].properties,
                required: schema.$defs[defKey].required || [],
                defs: schema.$defs,
                source: `$defs.${defKey}`
            };
        }

        // Strategy 3: Fallback to root properties (generic)
        if (schema.properties) {
            console.log(`⚠️ Using root properties as fallback`);
            return {
                properties: schema.properties,
                required: schema.required || [],
                defs: schema.$defs || {},
                source: 'root'
            };
        }

        return null;
    }

    // Convert ROADMAP JSON Schema to JSON Editor compatible format with tabs
    convertToJsonEditorSchema(roadmapSchema, cardType) {
        try {
            const sectionName = cardType.charAt(0).toUpperCase() + cardType.slice(1);

            // Dynamically find properties regardless of schema structure
            const schemaInfo = this.findSchemaProperties(roadmapSchema, cardType);

            if (!schemaInfo || !schemaInfo.properties) {
                console.error('❌ Schema structure:', {
                    hasProperties: !!roadmapSchema.properties,
                    propertiesKeys: roadmapSchema.properties ? Object.keys(roadmapSchema.properties) : [],
                    hasDefs: !!roadmapSchema.$defs,
                    defsKeys: roadmapSchema.$defs ? Object.keys(roadmapSchema.$defs) : []
                });
                throw new Error(`No ${cardType} properties found in schema. Tried: properties.${sectionName}, $defs.${cardType.toLowerCase()}, and root properties.`);
            }

            console.log(`📋 Processing schema properties from: ${schemaInfo.source}`);

            // Process all properties first
            const allProcessedProps = this.processProperties(
                schemaInfo.properties,
                schemaInfo.defs,
                new Set(),
                0
            );

            // Use GitHub schema structure AS-IS (no re-categorization)
            // This respects the natural hierarchy defined in the ROADMAP schema
            const jsonEditorSchema = {
                type: "object",
                title: sectionName,
                properties: allProcessedProps,  // Use schema structure directly
                required: schemaInfo.required || []  // Preserve required fields from original schema
            };

            console.log(`✅ Schema converted for ${cardType} with ${Object.keys(allProcessedProps).length} properties (GitHub structure preserved)`);
            if (schemaInfo.required && schemaInfo.required.length > 0) {
                console.log(`📋 Required fields: ${schemaInfo.required.join(', ')}`);
            }
            return jsonEditorSchema;

        } catch (error) {
            console.error(`❌ Schema conversion failed for ${cardType}:`, error);
            return {
                type: "object",
                title: "Error",
                properties: {
                    "message": {
                        type: "string",
                        default: `Failed to process schema: ${error.message}`
                    }
                }
            };
        }
    }

    // Process schema properties recursively
    processProperties(properties, defs, visited = new Set(), depth = 0) {
        if (!properties || typeof properties !== 'object') return {};
        const processed = {};
        const maxDepth = 15; // Increased from 10 for deeply nested schemas like Partitions

        if (depth > maxDepth) {
            console.warn(`Maximum depth ${maxDepth} exceeded, stopping recursion`);
            return processed;
        }

        for (const [key, prop] of Object.entries(properties)) {
            // Skip References field - disabled per user request
            if (key === 'References') {
                console.log('⚠️ Skipping References field (disabled)');
                continue;
            }
            processed[key] = this.processProperty(prop, defs, visited, depth + 1);
        }

        return processed;
    }

    // Process individual property
    processProperty(prop, defs, visited = new Set(), depth = 0) {
        // Handle $ref references
        if (prop.$ref) {
            const refPath = prop.$ref.replace('#/$defs/', '');

            // Only flag as circular if this ref is CURRENTLY in the call stack
            // (true recursion), not if we've just seen it before in a sibling property
            if (visited.has(refPath)) {
                // This is a true circular reference (Subset -> Subset)
                console.warn(`Circular reference detected: ${refPath}`);
                return {
                    type: "string",
                    title: refPath,
                    description: `Reference to ${refPath} (circular reference avoided)`,
                    default: ""
                };
            }

            const refDef = defs[refPath];
            if (refDef) {
                // Add to visited for THIS branch of recursion only
                const newVisited = new Set(visited);
                newVisited.add(refPath);
                // Increment depth to allow maxDepth protection
                // (prevents infinite recursion when $refs have circular structures)
                const result = this.processProperty(refDef, defs, newVisited, depth + 1);
                // Note: We don't remove from visited because newVisited is a copy
                // This allows the same $ref to be used in sibling properties
                return result;
            }
        }

        // FIX: Convert prefixItems (JSON Schema 2020-12) to items array (draft-04)
        // JSON Editor 2.8.0 only supports draft-03/04, doesn't recognize prefixItems
        // This caused Age range integers to convert to null (issue found 2025-01-06)
        if (prop.type === 'array' && prop.items && typeof prop.items === 'object') {
            // Check for nested array with prefixItems (e.g., Age range structure)
            if (prop.items.type === 'array' && prop.items.prefixItems) {
                console.log(`🔄 Converting prefixItems to items array for: ${prop.title || 'nested array'}`);

                const prefixItems = prop.items.prefixItems;
                const additionalItems = prop.items.items;

                // Build draft-04 compatible tuple: [type1, type2, ...]
                const draft04Items = [...prefixItems];
                if (additionalItems) {
                    draft04Items.push(additionalItems);
                }

                // Replace prefixItems with items array
                prop.items.items = draft04Items;
                delete prop.items.prefixItems;

                console.log(`  ✅ Converted to ${draft04Items.length}-element tuple: [${draft04Items.map(i => i.type || 'unknown').join(', ')}]`);
            }
        }

        // Try to flatten anyOf before marking as complex
        if (prop.anyOf) {
            const flattened = this.flattenAnyOf(prop, defs, visited);
            if (flattened) {
                // Successfully flattened - use the flattened version
                prop = flattened;
            }
        }

        if (this.isComplexProperty(prop)) {
            return {
                type: "string",
                title: prop.title || "Complex Field",
                description: prop.description || "This field has been simplified for form display",
                default: ""
            };
        }

        const processed = { ...prop };

        if (prop.type === 'array' && prop.items) {
            // Array items are TEMPLATES reused for each element
            // Pass visited Set to allow efficient ref reuse (siblings can share same $ref without re-processing)
            // Depth parameter + visited Set together prevent both false positives and infinite recursion
            processed.items = this.processProperty(prop.items, defs, visited, depth);

            // Check for enum arrays FIRST (checkboxes for Content, Metrics, etc.)
            // Use processed.items.enum since items have been recursively processed
            if (processed.items.enum && processed.items.enum.length > 5) {
                processed.format = 'checkbox';
                processed.uniqueItems = true;
                console.log(`✅ Using checkbox format for enum array: ${prop.title || 'unnamed'} (${processed.items.enum.length} options)`);
            }
            // THEN check if this is a simple object array that should use table format
            else {
                const isSimpleObjectArray =
                    processed.items.type === 'object' &&
                    processed.items.properties &&
                    Object.keys(processed.items.properties).length <= 6 && // Not too many columns
                    Object.values(processed.items.properties).every(p =>
                        ['string', 'number', 'integer', 'boolean'].includes(p.type)
                    );

                if (isSimpleObjectArray) {
                    // Use table format for simple, flat structures
                    processed.format = 'table';
                    console.log(`📊 Using table format for array: ${prop.title || 'unnamed'}`);
                } else {
                    // Use intelligent header template for more complex arrays
                    if (processed.items.type === 'object' && processed.items.properties) {
                        const props = processed.items.properties;
                        if (props.Name) {
                            processed.items.headerTemplate = "{{self.Name}}";
                        } else if (props['Partition name']) {
                            processed.items.headerTemplate = "{{self['Partition name']}}";
                        } else if (props.Category) {
                            processed.items.headerTemplate = "{{self.Category}}";
                        } else {
                            const titleCandidates = ['Criterion', 'Sex', 'Demographic', 'Title', 'Type'];
                            const titleProps = titleCandidates.filter(p => props[p]);
                            if (titleProps.length > 0) {
                                processed.items.headerTemplate = titleProps.map(p => `{{self.${p}}}`).join(' - ');
                            }
                        }
                    }
                }
            }
        }

        if (prop.type === 'object' && prop.properties) {
            processed.properties = this.processProperties(prop.properties, defs, visited, depth);
        }

        // Handle const constraints (e.g., $schema field)
        if (prop.const !== undefined) {
            processed.enum = [prop.const];
            processed.default = prop.const;
            processed.options = processed.options || {};
            processed.options.hidden = true;  // Hide from UI since it's fixed
        }

        if (!processed.default) {
            // Don't set default for date fields (empty string violates format)
            if (prop.type === 'string' && prop.format !== 'date') {
                processed.default = '';
            }
            // DISABLED: Don't set default empty arrays/objects as they cause validation issues
            // Empty Date objects get filled with empty strings, empty License objects violate minProperties
            // if (prop.type === 'array') processed.default = [];
            // if (prop.type === 'object') processed.default = {};
        }

        if (prop.format === 'email') processed.format = 'email';
        if (prop.format === 'date') processed.format = 'date';
        if (prop.format === 'uri') processed.format = 'uri';

        return processed;
    }

    // Check if property is too complex for JSON Editor
    isComplexProperty(prop) {
        // anyOf is now handled by flattenAnyOf, so don't block it here
        // Still block oneOf and allOf as they're truly complex
        if (prop.oneOf || prop.allOf) return true;

        // Skip properties with complex conditional logic
        if (prop.if || prop.then || prop.else) return true;

        // Skip properties with pattern properties
        if (prop.patternProperties) return true;

        // Skip properties with additional properties of complex type
        if (prop.additionalProperties && typeof prop.additionalProperties === 'object') return true;

        return false;
    }

    // Flatten anyOf to extract validation rules from the first string option
    flattenAnyOf(prop, defs, visited) {
        // Only process if anyOf exists
        if (!prop.anyOf || !Array.isArray(prop.anyOf) || prop.anyOf.length === 0) {
            return null;
        }

        // Strategy: Find first string option and extract its validation rules
        const stringOption = prop.anyOf.find(opt => opt.type === 'string');

        if (!stringOption) {
            // No string option found - can't flatten to simple input
            // Fall back to complex field behavior
            return null;
        }

        // Create flattened schema based on string option
        const flattened = {
            type: 'string',
            title: prop.title || stringOption.title || 'Field',
            description: prop.description || stringOption.description || ''
        };

        // Preserve all validation rules from the string option
        if (stringOption.pattern) flattened.pattern = stringOption.pattern;
        if (stringOption.maxLength) flattened.maxLength = stringOption.maxLength;
        if (stringOption.minLength) flattened.minLength = stringOption.minLength;
        if (stringOption.format) flattened.format = stringOption.format;
        if (stringOption.enum) flattened.enum = stringOption.enum;
        if (stringOption.examples) flattened.examples = stringOption.examples;

        // Set default
        if (!flattened.default) {
            flattened.default = '';
        }

        console.log(`📋 Flattened anyOf for "${flattened.title}": preserved pattern=${!!flattened.pattern}, format=${!!flattened.format}`);

        return flattened;
    }

    // Helper method to generate intelligent headerTemplate for array objects
    getArrayHeaderTemplate(itemSchema, defs, visited = new Set()) {
        // Handle $ref references
        if (itemSchema.$ref) {
            const refPath = itemSchema.$ref.replace('#/$defs/', '');
            
            // Prevent circular references
            if (visited.has(refPath)) {
                return null;
            }
            
            const refDef = defs[refPath];
            if (refDef) {
                const newVisited = new Set(visited);
                newVisited.add(refPath);
                return this.getArrayHeaderTemplate(refDef, defs, newVisited);
            }
            return null;
        }
        
        // Check if the object has properties
        if (itemSchema.type === 'object' && itemSchema.properties) {
            const properties = itemSchema.properties;
            
            // First check for Name property (most common)
            if (properties.Name || properties.name) {
                return '{{self.Name}}';
            }
            
            // Special case for Partition arrays
            if (properties['Partition name']) {
                return '{{self.Partition name}}';
            }
            
            // For other cases, look for common descriptive properties
            const titleCandidates = ['Criterion', 'Sex', 'Demographic', 'Title'];
            const foundCandidates = [];
            
            for (const candidate of titleCandidates) {
                if (properties[candidate]) {
                    foundCandidates.push(`{{self.${candidate}}}`);
                }
            }
            
            // If we found descriptive properties, combine them
            if (foundCandidates.length > 0) {
                return foundCandidates.join(' - ');
            }
            
            // Fallback: use the first string property we can find
            for (const [propName, propDef] of Object.entries(properties)) {
                if (propDef.type === 'string') {
                    return `{{self.${propName}}}`;
                }
            }
        }
        
        return null;
    }

    // Get current schema info
    getSchemaInfo(cardType) {
        const source = this.currentSchemaSource[cardType];
        const schema = this.loadedSchemas[cardType];

        // Determine display source
        let displaySource = source;
        let sourceUrl = null;

        if (source === 'github') {
            displaySource = 'GitHub (Latest)';
            sourceUrl = this.GITHUB_SCHEMAS[cardType];
        } else if (source === 'base') {
            displaySource = 'GitHub (Base)';
            sourceUrl = this.GITHUB_SCHEMAS[cardType];
        } else {
            displaySource = 'Custom URL';
            sourceUrl = source;
        }

        return {
            source: displaySource,
            sourceUrl: sourceUrl,
            version: schema?.$id || 'Unknown',
            description: schema?.description || '',
            isCustom: source !== 'github' && source !== 'base',
            cacheExpiry: this.schemaCacheTime ? new Date(this.schemaCacheTime + this.CACHE_DURATION_MS) : null
        };
    }

    // Reset to base schemas (GitHub)
    resetToBase(cardType = null) {
        if (cardType) {
            this.loadedSchemas[cardType] = this.baseSchemas[cardType];
            this.currentSchemaSource[cardType] = 'github';
            console.log(`🔄 Reset to GitHub schema for ${cardType}`);
        } else {
            this.loadedSchemas.model = this.baseSchemas.model;
            this.loadedSchemas.dataset = this.baseSchemas.dataset;
            this.currentSchemaSource.model = 'github';
            this.currentSchemaSource.dataset = 'github';
            console.log('🔄 Reset to GitHub schemas for all card types');
        }
    }
}

// Make it available globally
window.DynamicSchemaProcessor = DynamicSchemaProcessor;