// Database manager for schema storage using better-sqlite3
import Database from 'better-sqlite3';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class SchemaDatabase {
  constructor() {
    this.db = null;
    this.dbPath = path.join(__dirname, 'saved-schemas', 'metadata.db');
    this.schemasDir = path.join(__dirname, 'saved-schemas');
  }

  async initialize() {
    try {
      // Create directories if they don't exist
      await this.ensureDirectories();
      
      // Open database connection
      this.db = new Database(this.dbPath);
      
      // Create tables
      await this.createTables();
      
      console.log('✅ Schema database initialized');
      return true;
    } catch (error) {
      console.error('❌ Database initialization error:', error);
      return false;
    }
  }

  async ensureDirectories() {
    const dirs = [
      this.schemasDir,
      path.join(this.schemasDir, 'by-doi'),
      path.join(this.schemasDir, 'archived')
    ];

    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        if (error.code !== 'EEXIST') {
          throw error;
        }
      }
    }
  }

  async createTables() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS schemas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doi TEXT UNIQUE NOT NULL,
        sanitized_doi TEXT NOT NULL,
        title TEXT,
        authors TEXT,
        journal TEXT,
        publication_year INTEGER,
        abstract TEXT,
        schema_type TEXT NOT NULL, -- 'model' or 'dataset'
        extraction_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        file_path TEXT NOT NULL,
        version_count INTEGER DEFAULT 1,
        last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_doi ON schemas(doi);
      CREATE INDEX IF NOT EXISTS idx_schema_type ON schemas(schema_type);
      CREATE INDEX IF NOT EXISTS idx_extraction_date ON schemas(extraction_date);
    `;

    this.db.exec(createTableSQL);
  }

  async saveSchema(schemaData, metadata, doi, sanitizedDoi) {
    try {
      // Check if DOI already exists
      const existing = await this.getSchemaByDoi(doi);
      
      if (existing) {
        return await this.updateExistingSchema(existing, schemaData, metadata, doi, sanitizedDoi);
      } else {
        return await this.createNewSchema(schemaData, metadata, doi, sanitizedDoi);
      }
    } catch (error) {
      console.error('❌ Error saving schema:', error);
      throw error;
    }
  }

  async createNewSchema(schemaData, metadata, doi, sanitizedDoi) {
    const fileName = `${sanitizedDoi}.json`;
    const filePath = path.join(this.schemasDir, 'by-doi', fileName);
    
    // Save JSON file
    await fs.writeFile(filePath, JSON.stringify(schemaData, null, 2));
    
    // Save metadata to database
    const insertSQL = `
      INSERT INTO schemas (
        doi, sanitized_doi, title, authors, journal, publication_year, 
        abstract, schema_type, file_path
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    
    const schemaType = schemaData.Model ? 'model' : 'dataset';
    const authorsJson = metadata.authors ? JSON.stringify(metadata.authors) : null;
    
    const stmt = this.db.prepare(insertSQL);
    const result = stmt.run(
      doi,
      sanitizedDoi,
      metadata.title,
      authorsJson,
      metadata.journal,
      metadata.year,
      metadata.abstract,
      schemaType,
      fileName
    );
    
    console.log('✅ New schema saved:', doi);
    return {
      id: result.lastInsertRowid,
      doi: doi,
      title: metadata.title,
      type: schemaType,
      isNew: true
    };
  }

  async updateExistingSchema(existing, schemaData, metadata, doi, sanitizedDoi) {
    // Archive the old schema
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archiveFileName = `${sanitizedDoi}_archived_${timestamp}.json`;
    const archivePath = path.join(this.schemasDir, 'archived', archiveFileName);
    
    // Copy current schema to archive
    const currentPath = path.join(this.schemasDir, 'by-doi', existing.file_path);
    try {
      const currentData = await fs.readFile(currentPath, 'utf8');
      await fs.writeFile(archivePath, currentData);
    } catch (error) {
      console.warn('⚠️ Could not archive existing schema:', error.message);
    }
    
    // Update with new schema
    const filePath = path.join(this.schemasDir, 'by-doi', existing.file_path);
    await fs.writeFile(filePath, JSON.stringify(schemaData, null, 2));
    
    // Update database record
    const updateSQL = `
      UPDATE schemas 
      SET title = ?, authors = ?, journal = ?, publication_year = ?, 
          abstract = ?, version_count = version_count + 1, 
          last_updated = CURRENT_TIMESTAMP
      WHERE doi = ?
    `;
    
    const authorsJson = metadata.authors ? JSON.stringify(metadata.authors) : null;
    
    const stmt = this.db.prepare(updateSQL);
    stmt.run(
      metadata.title,
      authorsJson,
      metadata.journal,
      metadata.year,
      metadata.abstract,
      doi
    );
    
    console.log('✅ Schema updated:', doi);
    return {
      id: existing.id,
      doi: doi,
      title: metadata.title,
      type: existing.schema_type,
      isNew: false,
      versionCount: existing.version_count + 1
    };
  }

  async getSchemaByDoi(doi) {
    const selectSQL = 'SELECT * FROM schemas WHERE doi = ?';
    const stmt = this.db.prepare(selectSQL);
    return stmt.get(doi);
  }

  async getAllSchemas(filters = {}) {
    let selectSQL = 'SELECT * FROM schemas';
    const params = [];
    const conditions = [];

    // Apply filters
    if (filters.type) {
      conditions.push('schema_type = ?');
      params.push(filters.type);
    }
    
    if (filters.year) {
      conditions.push('publication_year = ?');
      params.push(filters.year);
    }
    
    if (filters.search) {
      conditions.push('(title LIKE ? OR authors LIKE ? OR journal LIKE ?)');
      const searchTerm = `%${filters.search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (conditions.length > 0) {
      selectSQL += ' WHERE ' + conditions.join(' AND ');
    }

    selectSQL += ' ORDER BY extraction_date DESC';

    const stmt = this.db.prepare(selectSQL);
    const rows = stmt.all(...params);
    
    // Parse authors JSON back to array
    return rows.map(row => ({
      ...row,
      authors: row.authors ? JSON.parse(row.authors) : []
    }));
  }

  async getSchemaContent(doi) {
    try {
      const metadata = await this.getSchemaByDoi(doi);
      if (!metadata) {
        throw new Error('Schema not found');
      }

      const filePath = path.join(this.schemasDir, 'by-doi', metadata.file_path);
      const content = await fs.readFile(filePath, 'utf8');
      
      return {
        metadata,
        schema: JSON.parse(content)
      };
    } catch (error) {
      console.error('❌ Error reading schema content:', error);
      throw error;
    }
  }

  async deleteSchema(doi) {
    try {
      const existing = await this.getSchemaByDoi(doi);
      if (!existing) {
        throw new Error('Schema not found');
      }

      // Delete file
      const filePath = path.join(this.schemasDir, 'by-doi', existing.file_path);
      await fs.unlink(filePath);

      // Delete from database
      const deleteSQL = 'DELETE FROM schemas WHERE doi = ?';
      const stmt = this.db.prepare(deleteSQL);
      stmt.run(doi);
      
      console.log('✅ Schema deleted:', doi);
      return { deleted: true, doi: doi };
    } catch (error) {
      console.error('❌ Error deleting schema:', error);
      throw error;
    }
  }

  async getStatistics() {
    const statsSQL = `
      SELECT 
        COUNT(*) as total_schemas,
        SUM(CASE WHEN schema_type = 'model' THEN 1 ELSE 0 END) as model_count,
        SUM(CASE WHEN schema_type = 'dataset' THEN 1 ELSE 0 END) as dataset_count,
        AVG(version_count) as avg_versions,
        MIN(extraction_date) as first_extraction,
        MAX(extraction_date) as latest_extraction
      FROM schemas
    `;
    
    const stmt = this.db.prepare(statsSQL);
    return stmt.get();
  }

  async close() {
    if (this.db) {
      this.db.close();
      console.log('✅ Database connection closed');
    }
  }
}

// Export singleton instance
export const schemaDB = new SchemaDatabase();