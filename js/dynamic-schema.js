// Dynamic Schema Processor - Loads schemas from base files or custom URLs
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
            model: 'base',
            dataset: 'base'
        };
    }

    // Load base schemas from local files
    async loadBaseSchemas() {
        try {
            const [modelResponse, datasetResponse] = await Promise.all([
                fetch('schemas/base-model-schema.json'),
                fetch('schemas/base-dataset-schema.json')
            ]);

            if (!modelResponse.ok || !datasetResponse.ok) {
                throw new Error('Failed to load base schemas');
            }

            this.baseSchemas.model = await modelResponse.json();
            this.baseSchemas.dataset = await datasetResponse.json();

            console.log('✅ Base schemas loaded successfully');
            return true;
        } catch (error) {
            console.error('❌ Failed to load base schemas:', error);
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
            this.currentSchemaSource[cardType] = 'base';
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

    // Convert ROADMAP JSON Schema to JSON Editor compatible format
    convertToJsonEditorSchema(roadmapSchema, cardType) {
        try {
            const sectionName = cardType.charAt(0).toUpperCase() + cardType.slice(1);
            const sectionDef = roadmapSchema.$defs[cardType.toLowerCase()];
            
            if (!sectionDef) {
                throw new Error(`No ${cardType} definition found in schema`);
            }

            // Extract the properties for the form
            const jsonEditorSchema = {
                type: "object",
                title: `${sectionName} Information`,
                properties: this.processProperties(sectionDef.properties || {}, roadmapSchema.$defs, new Set(), 0),
                required: sectionDef.required || []
            };

            console.log(`✅ Schema converted for ${cardType}`);
            return jsonEditorSchema;
            
        } catch (error) {
            console.error('❌ Schema conversion failed:', error);
            // Return a minimal fallback schema
            return {
                type: "object",
                title: `${cardType.charAt(0).toUpperCase() + cardType.slice(1)} Information`,
                properties: {
                    "Name": {
                        type: "string",
                        title: `${cardType.charAt(0).toUpperCase() + cardType.slice(1)} Name`,
                        description: `Enter the name of your ${cardType}`,
                        default: ""
                    }
                },
                required: ["Name"]
            };
        }
    }

    // Process schema properties recursively
    processProperties(properties, defs, visited = new Set(), depth = 0) {
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
            
            // Prevent circular references
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

        // Skip overly complex properties that cause issues
        if (this.isComplexProperty(prop)) {
            return {
                type: "string", 
                title: prop.title || "Complex Field",
                description: prop.description || "This field has been simplified for form display",
                default: ""
            };
        }

        // Process based on type
        const processed = { ...prop };

        // Handle arrays
        if (prop.type === 'array' && prop.items) {
            processed.items = this.processProperty(prop.items, defs, visited, depth);
            
            // Convert enum arrays to checkbox format for better UX
            if (prop.items.enum && prop.items.enum.length > 5) {
                processed.format = 'checkbox';
                processed.uniqueItems = true;
            }
        }

        // Handle objects
        if (prop.type === 'object' && prop.properties) {
            processed.properties = this.processProperties(prop.properties, defs, visited, depth);
        }

        // Add default values where missing
        if (!processed.default) {
            if (prop.type === 'string') processed.default = '';
            if (prop.type === 'array') processed.default = [];
            if (prop.type === 'object') processed.default = {};
        }

        // Handle special formats
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

    // Get current schema info
    getSchemaInfo(cardType) {
        const source = this.currentSchemaSource[cardType];
        const schema = this.loadedSchemas[cardType];
        
        return {
            source: source === 'base' ? 'Base Schema' : source,
            version: schema?.$id || 'Unknown',
            description: schema?.description || '',
            isCustom: source !== 'base'
        };
    }

    // Reset to base schemas
    resetToBase(cardType = null) {
        if (cardType) {
            this.loadedSchemas[cardType] = this.baseSchemas[cardType];
            this.currentSchemaSource[cardType] = 'base';
        } else {
            this.loadedSchemas.model = this.baseSchemas.model;
            this.loadedSchemas.dataset = this.baseSchemas.dataset;
            this.currentSchemaSource.model = 'base';
            this.currentSchemaSource.dataset = 'base';
        }
    }
}

// Make it available globally
window.DynamicSchemaProcessor = DynamicSchemaProcessor;