// Dynamic Schema Processor - Loads schemas from GitHub or custom URLs
class DynamicSchemaProcessor {
    constructor() {
        this.baseSchemas = {
            model: null,
            dataset: null
        };
        this.loadedSchemas = {
            model: null,
            dataset: null
        };
        this.currentSchemaSource = {
            model: 'github',
            dataset: 'github'
        };
        this.schemaCache = null;
        this.schemaCacheTime = null;
        this.CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes
    }

    // GitHub URLs for latest ROADMAP schemas (same as backend)
    get GITHUB_SCHEMAS() {
        return {
            model: 'https://raw.githubusercontent.com/cekahn/ROADMAP/main/ROADMAP.model.json',
            dataset: 'https://raw.githubusercontent.com/cekahn/ROADMAP/main/ROADMAP.dataset.json'
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
            const url = `https://raw.githubusercontent.com/cekahn/ROADMAP/main/${filename}`;
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

    // Load base schemas from GitHub (with caching and external ref resolution)
    async loadBaseSchemas() {
        try {
            // Check if we have a valid cached copy
            if (this.schemaCache && this.schemaCacheTime && (Date.now() - this.schemaCacheTime < this.CACHE_DURATION_MS)) {
                console.log('📦 Using cached schemas from GitHub');
                this.baseSchemas.model = this.schemaCache.model;
                this.baseSchemas.dataset = this.schemaCache.dataset;
                return true;
            }

            console.log('🌐 Fetching schemas from GitHub...');
            console.log('  Model:', this.GITHUB_SCHEMAS.model);
            console.log('  Dataset:', this.GITHUB_SCHEMAS.dataset);

            const [modelResponse, datasetResponse] = await Promise.all([
                fetch(this.GITHUB_SCHEMAS.model),
                fetch(this.GITHUB_SCHEMAS.dataset)
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

            console.log('✅ Base schemas loaded from GitHub successfully');
            console.log('   Cache will expire in 5 minutes');
            return true;
        } catch (error) {
            console.error('❌ Failed to load schemas from GitHub:', error);
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
            this.currentSchemaSource[cardType] = 'github';
            console.log(`✅ Using GitHub schema for ${cardType}`);
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

        // Strategy 1: Try properties.Dataset or properties.Model (GitHub/new format)
        if (schema.properties?.[capitalizedType]?.properties) {
            console.log(`✅ Found properties at: properties.${capitalizedType} (GitHub format)`);
            return {
                properties: schema.properties[capitalizedType].properties,
                defs: schema.$defs || {},
                source: `properties.${capitalizedType}`
            };
        }

        // Strategy 2: Try $defs.dataset or $defs.model (old local format)
        if (schema.$defs?.[lowercaseType]?.properties) {
            console.log(`✅ Found properties at: $defs.${lowercaseType} (legacy format)`);
            return {
                properties: schema.$defs[lowercaseType].properties,
                defs: schema.$defs,
                source: `$defs.${lowercaseType}`
            };
        }

        // Strategy 3: Fallback to root properties (generic)
        if (schema.properties) {
            console.log(`⚠️ Using root properties as fallback`);
            return {
                properties: schema.properties,
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

            // Use categorization to build tabs dynamically (schema-agnostic!)
            const categories = this.categorizeProperties(allProcessedProps, cardType);

            const jsonEditorSchema = {
                type: "object",
                title: sectionName,
                format: "tabs", // Enable the tabbed interface
                properties: {}
            };

            // Build tabs from categories (no hardcoding!)
            Object.entries(categories).forEach(([categoryName, propertyKeys]) => {
                const tabKey = categoryName.toLowerCase().replace(/\s/g, '_').replace(/&/g, 'and');
                const tabProperties = {};

                propertyKeys.forEach(propKey => {
                    if (allProcessedProps[propKey]) {
                        tabProperties[propKey] = allProcessedProps[propKey];
                    }
                });

                if (Object.keys(tabProperties).length > 0) {
                    jsonEditorSchema.properties[tabKey] = {
                        title: categoryName,
                        type: 'object',
                        properties: tabProperties
                    };
                }
            });

            console.log(`✅ Schema converted for ${cardType} with ${Object.keys(categories).length} dynamic tabs`);
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
        const maxDepth = 10; // Prevent infinite recursion

        if (depth > maxDepth) {
            console.warn(`Maximum depth ${maxDepth} exceeded, stopping recursion`);
            return processed;
        }

        for (const [key, prop] of Object.entries(properties)) {
            processed[key] = this.processProperty(prop, defs, visited, depth + 1);
        }

        return processed;
    }

    // Process individual property
    processProperty(prop, defs, visited = new Set(), depth = 0) {
        // Handle $ref references
        if (prop.$ref) {
            const refPath = prop.$ref.replace('#/$defs/', '');
            
            if (visited.has(refPath)) {
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
                const newVisited = new Set(visited);
                newVisited.add(refPath);
                return this.processProperty(refDef, defs, newVisited, depth + 1);
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
            processed.items = this.processProperty(prop.items, defs, visited, depth);

            // Check if this is a simple object array that should use table format
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

            // Checkbox format for enum arrays with many options
            if (prop.items.enum && prop.items.enum.length > 5) {
                processed.format = 'checkbox';
                processed.uniqueItems = true;
            }
        }

        if (prop.type === 'object' && prop.properties) {
            processed.properties = this.processProperties(prop.properties, defs, visited, depth);
        }

        if (!processed.default) {
            if (prop.type === 'string') processed.default = '';
            if (prop.type === 'array') processed.default = [];
            if (prop.type === 'object') processed.default = {};
        }

        if (prop.format === 'email') processed.format = 'email';
        if (prop.format === 'date') processed.format = 'date';
        if (prop.format === 'uri') processed.format = 'uri';

        return processed;
    }

    // Check if property is too complex for JSON Editor
    isComplexProperty(prop) {
        // Skip properties with deep nesting
        if (prop.anyOf || prop.oneOf || prop.allOf) return true;
        
        // Skip properties with complex conditional logic
        if (prop.if || prop.then || prop.else) return true;
        
        // Skip properties with pattern properties
        if (prop.patternProperties) return true;
        
        // Skip properties with additional properties of complex type
        if (prop.additionalProperties && typeof prop.additionalProperties === 'object') return true;
        
        return false;
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
            displaySource = 'Local Files';
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