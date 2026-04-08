/**
 * Database Agent
 * ──────────────
 * Allows Vedaa to interact with databases.
 *
 * Supports:
 *   • SQLite (built-in via better-sqlite3 — zero config)
 *   • MySQL  (if mysql2 is installed)
 *   • PostgreSQL (if pg is installed)
 *
 * The LLM gets tools to:
 *   1. list_tables   — show all tables in the database
 *   2. describe_table — show columns/types for a table
 *   3. query_database — run a SELECT query (read-only by default)
 *   4. execute_database — run INSERT/UPDATE/DELETE (if write enabled)
 *
 * Config example (in agent-config.json → databases):
 *   {
 *     "name": "mydb",
 *     "type": "sqlite",
 *     "path": "./server/data/app.db",
 *     "readOnly": false,
 *     "description": "Main application database with users, orders, products"
 *   }
 */

const path = require('path');
const fs = require('fs');

class DbAgent {
  /**
   * @param {object[]} dbConfigs — array of database configs
   */
  constructor(dbConfigs = []) {
    this.databases = new Map();

    for (const config of dbConfigs) {
      try {
        const conn = this._connect(config);
        if (conn) {
          this.databases.set(config.name, { config, conn });
          console.log(`   💾  Database connected: ${config.name} (${config.type})`);
        }
      } catch (err) {
        console.error(`   ❌  Database "${config.name}" failed:`, err.message);
      }
    }
  }

  /**
   * Connect to a database based on its config.
   */
  _connect(config) {
    switch (config.type) {
      case 'sqlite': {
        const Database = require('better-sqlite3');
        const dbPath = path.resolve(config.path || './server/data/app.db');
        // Ensure directory exists
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('foreign_keys = ON');
        return db;
      }

      // Future: MySQL, Postgres, etc.
      // case 'mysql': { ... }
      // case 'postgres': { ... }

      default:
        console.warn(`   ⚠️  Unsupported database type: ${config.type}`);
        return null;
    }
  }

  /**
   * Build OpenAI tool definitions + handlers.
   * @returns {{ definition: object, handler: Function }[]}
   */
  getTools() {
    const tools = [];
    const dbNames = Array.from(this.databases.keys());

    if (dbNames.length === 0) return tools;

    const dbDescriptions = dbNames.map(name => {
      const { config } = this.databases.get(name);
      return `"${name}" — ${config.description || config.type}`;
    }).join(', ');

    // 1. List tables
    tools.push({
      definition: {
        type: 'function',
        function: {
          name: 'list_tables',
          description: `List all tables in a database. Available databases: ${dbDescriptions}`,
          parameters: {
            type: 'object',
            properties: {
              database: {
                type: 'string',
                enum: dbNames,
                description: 'Which database to list tables from',
              },
            },
            required: ['database'],
          },
        },
      },
      handler: async (args) => this._listTables(args.database),
    });

    // 2. Describe table
    tools.push({
      definition: {
        type: 'function',
        function: {
          name: 'describe_table',
          description: 'Get column names, types, and constraints for a specific table.',
          parameters: {
            type: 'object',
            properties: {
              database: { type: 'string', enum: dbNames, description: 'Database name' },
              table:    { type: 'string', description: 'Table name to describe' },
            },
            required: ['database', 'table'],
          },
        },
      },
      handler: async (args) => this._describeTable(args.database, args.table),
    });

    // 2b. Full schema — all tables + columns in ONE call (enables JOINs)
    tools.push({
      definition: {
        type: 'function',
        function: {
          name: 'get_full_schema',
          description:
            'Get the COMPLETE schema of ALL tables in a database in a single call. ' +
            'Returns every table with its columns, types, primary keys, and foreign keys. ' +
            'ALWAYS call this FIRST when the user asks anything about the database, ' +
            'especially before writing JOIN queries across multiple tables. ' +
            'This is much more efficient than calling describe_table for each table separately.',
          parameters: {
            type: 'object',
            properties: {
              database: { type: 'string', enum: dbNames, description: 'Database name' },
            },
            required: ['database'],
          },
        },
      },
      handler: async (args) => this._getFullSchema(args.database),
    });

    // 3. Query (SELECT — read-only)
    tools.push({
      definition: {
        type: 'function',
        function: {
          name: 'query_database',
          description:
            'Run a read-only SQL SELECT query on a database. Returns rows as JSON. ' +
            'Supports full SQL including JOINs across tables, sub-queries, GROUP BY, ' +
            'aggregate functions (COUNT, SUM, AVG, MIN, MAX), CASE expressions, UNION, ' +
            'and Common Table Expressions (WITH ... AS). ' +
            'ALWAYS prefer a single JOIN query over multiple separate queries when data spans multiple tables. ' +
            'The database schema is already in the system prompt — use column names from there directly.',
          parameters: {
            type: 'object',
            properties: {
              database: { type: 'string', enum: dbNames, description: 'Database name' },
              sql:      { type: 'string', description: 'SQL SELECT query. Supports JOINs, sub-queries, CTEs (WITH), GROUP BY, aggregates, UNION, etc.' },
            },
            required: ['database', 'sql'],
          },
        },
      },
      handler: async (args) => this._query(args.database, args.sql),
    });

    // 4. Query ALL tables (bulk — avoids multi-round loops)
    tools.push({
      definition: {
        type: 'function',
        function: {
          name: 'query_all_tables',
          description:
            'Fetch a summary preview of EVERY table in a database in a SINGLE call. ' +
            'Returns each table\'s column schema plus the first N sample rows. ' +
            'Use this when the user asks to "show all data", "get everything", or asks a question that spans multiple tables. ' +
            'Prefer this over calling query_database many times.',
          parameters: {
            type: 'object',
            properties: {
              database: { type: 'string', enum: dbNames, description: 'Database name' },
              limit:    { type: 'number', description: 'Max rows per table (default 20, max 100)' },
            },
            required: ['database'],
          },
        },
      },
      handler: async (args) => this._queryAllTables(args.database, args.limit),
    });

    // 5. Execute (INSERT/UPDATE/DELETE — only if write enabled)
    const writableDbs = dbNames.filter(name => {
      const { config } = this.databases.get(name);
      return config.readOnly !== true;
    });

    if (writableDbs.length > 0) {
      tools.push({
        definition: {
          type: 'function',
          function: {
            name: 'execute_database',
            description: 'Run an INSERT, UPDATE, DELETE, or CREATE TABLE SQL statement. Use this to modify data. Writable databases: ' + writableDbs.join(', '),
            parameters: {
              type: 'object',
              properties: {
                database: { type: 'string', enum: writableDbs, description: 'Database name' },
                sql:      { type: 'string', description: 'SQL statement to execute (INSERT, UPDATE, DELETE, CREATE TABLE, etc.)' },
              },
              required: ['database', 'sql'],
            },
          },
        },
        handler: async (args) => this._execute(args.database, args.sql),
      });
    }

    return tools;
  }

  /* ── Implementations ── */

  _listTables(dbName) {
    const db = this._getDb(dbName);
    const { config } = this.databases.get(dbName);

    if (config.type === 'sqlite') {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all();
      return { database: dbName, tables: tables.map(t => t.name) };
    }

    return { error: `list_tables not implemented for ${config.type}` };
  }

  _describeTable(dbName, tableName) {
    const db = this._getDb(dbName);
    const { config } = this.databases.get(dbName);

    if (config.type === 'sqlite') {
      const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
      if (columns.length === 0) return { error: `Table "${tableName}" not found` };

      return {
        database: dbName,
        table: tableName,
        columns: columns.map(c => ({
          name: c.name,
          type: c.type,
          nullable: !c.notnull,
          primaryKey: !!c.pk,
          defaultValue: c.dflt_value,
        })),
      };
    }

    return { error: `describe_table not implemented for ${config.type}` };
  }

  _query(dbName, sql) {
    const db = this._getDb(dbName);

    // Safety: only allow SELECT
    const trimmed = sql.trim().toUpperCase();
    if (!trimmed.startsWith('SELECT') && !trimmed.startsWith('WITH') && !trimmed.startsWith('PRAGMA')) {
      return { error: 'Only SELECT queries are allowed. Use execute_database for modifications.' };
    }

    try {
      const rows = db.prepare(sql).all();
      // Limit response size
      if (rows.length > 50) {
        return {
          rowCount: rows.length,
          rows: rows.slice(0, 50),
          note: `Showing first 50 of ${rows.length} rows. Add LIMIT to your query for better results.`,
        };
      }
      return { rowCount: rows.length, rows };
    } catch (err) {
      return { error: err.message };
    }
  }

  _execute(dbName, sql) {
    const db = this._getDb(dbName);
    const { config } = this.databases.get(dbName);

    if (config.readOnly) {
      return { error: `Database "${dbName}" is read-only.` };
    }

    // Block destructive operations
    const trimmed = sql.trim().toUpperCase();
    if (trimmed.startsWith('DROP') || trimmed.startsWith('ALTER')) {
      return { error: 'DROP and ALTER operations are not allowed for safety.' };
    }

    try {
      const result = db.prepare(sql).run();
      return {
        success: true,
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid?.toString(),
      };
    } catch (err) {
      return { error: err.message };
    }
  }

  _queryAllTables(dbName, limit = 20) {
    const db = this._getDb(dbName);
    const { config } = this.databases.get(dbName);
    const perTable = Math.min(Math.max(limit || 20, 1), 100); // clamp 1..100

    if (config.type === 'sqlite') {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all().map(t => t.name);

      const result = { database: dbName, tableCount: tables.length, tables: [] };

      for (const tableName of tables) {
        try {
          const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
          const totalRows = db.prepare(`SELECT COUNT(*) as cnt FROM "${tableName}"`).get().cnt;
          const sampleRows = db.prepare(`SELECT * FROM "${tableName}" LIMIT ${perTable}`).all();

          result.tables.push({
            name: tableName,
            totalRows,
            columns: columns.map(c => ({ name: c.name, type: c.type })),
            sampleRows,
            note: totalRows > perTable
              ? `Showing ${perTable} of ${totalRows} rows. Use query_database for filtered/full results.`
              : undefined,
          });
        } catch (err) {
          result.tables.push({ name: tableName, error: err.message });
        }
      }

      return result;
    }

    return { error: `query_all_tables not implemented for ${config.type}` };
  }

  /**
   * Full schema — returns all tables with columns, types, PKs, and FKs in one shot.
   * Enables the LLM to build JOIN queries without multiple round-trips.
   */
  _getFullSchema(dbName) {
    const db = this._getDb(dbName);
    const { config } = this.databases.get(dbName);

    if (config.type === 'sqlite') {
      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all().map(t => t.name);

      const schema = { database: dbName, tableCount: tables.length, tables: [] };

      for (const tableName of tables) {
        try {
          // Columns
          const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
          // Foreign keys
          const fks = db.prepare(`PRAGMA foreign_key_list("${tableName}")`).all();
          // Row count
          const rowCount = db.prepare(`SELECT COUNT(*) as cnt FROM "${tableName}"`).get().cnt;

          const tableInfo = {
            name: tableName,
            rowCount,
            columns: columns.map(c => ({
              name: c.name,
              type: c.type || 'TEXT',
              primaryKey: !!c.pk,
              nullable: !c.notnull,
              defaultValue: c.dflt_value,
            })),
          };

          // Add foreign key relationships if any
          if (fks.length > 0) {
            tableInfo.foreignKeys = fks.map(fk => ({
              column: fk.from,
              referencesTable: fk.table,
              referencesColumn: fk.to,
            }));
          }

          schema.tables.push(tableInfo);
        } catch (err) {
          schema.tables.push({ name: tableName, error: err.message });
        }
      }

      // Add a helpful hint for the LLM
      schema.hint =
        'Use JOIN queries to combine data across tables. ' +
        'Look for matching column names or foreign keys to determine join conditions. ' +
        'Example: SELECT a.*, b.col FROM table_a a JOIN table_b b ON a.id = b.a_id';

      return schema;
    }

    return { error: `get_full_schema not implemented for ${config.type}` };
  }

  _getDb(dbName) {
    const entry = this.databases.get(dbName);
    if (!entry) throw new Error(`Database "${dbName}" not found`);
    return entry.conn;
  }

  /* ═══════════════════════════════════════════
     Schema Cache — pre-built at startup
     ═══════════════════════════════════════════ */

  /**
   * Build a compact, LLM-ready schema string for all databases.
   * Called once at startup and cached. The result is injected directly
   * into the system prompt so the LLM never needs to call get_full_schema,
   * saving one full tool-calling round (~1-3 seconds) per data query.
   *
   * @returns {string} — multi-line schema description ready for prompt injection
   */
  getSchemaSnapshot() {
    if (this._schemaCache) return this._schemaCache;
    this._schemaCache = this._buildSchemaSnapshot();
    return this._schemaCache;
  }

  /** Invalidate cache (call after DDL changes like CREATE TABLE). */
  invalidateSchemaCache() {
    this._schemaCache = null;
  }

  _buildSchemaSnapshot() {
    const lines = ['DATABASE SCHEMA (pre-loaded — do NOT call get_full_schema):'];

    for (const [dbName, { config, conn }] of this.databases) {
      if (config.type !== 'sqlite') continue;

      const tables = conn.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all().map(t => t.name);

      lines.push(`\n  Database: "${dbName}" (${config.type}, ${tables.length} table(s))`);

      for (const tableName of tables) {
        try {
          const columns = conn.prepare(`PRAGMA table_info("${tableName}")`).all();
          const rowCount = conn.prepare(`SELECT COUNT(*) as cnt FROM "${tableName}"`).get().cnt;
          const fks = conn.prepare(`PRAGMA foreign_key_list("${tableName}")`).all();

          // Compact column list: name(TYPE, PK?) separated by commas
          const colList = columns.map(c => {
            let desc = `${c.name}`;
            const parts = [];
            if (c.type && c.type !== 'TEXT') parts.push(c.type);
            if (c.pk) parts.push('PK');
            if (parts.length > 0) desc += `(${parts.join(',')})`;
            return desc;
          }).join(', ');

          lines.push(`  ■ ${tableName} [${rowCount} rows]: ${colList}`);

          // Foreign keys (if any)
          if (fks.length > 0) {
            const fkDescs = fks.map(fk => `${fk.from} → ${fk.table}.${fk.to}`).join(', ');
            lines.push(`    FK: ${fkDescs}`);
          }

          // Sample distinct values for key dimension columns (helps LLM write correct WHERE clauses)
          const dimensionHints = this._getDimensionHints(conn, tableName, columns);
          if (dimensionHints) {
            lines.push(`    ${dimensionHints}`);
          }
        } catch (err) {
          lines.push(`  ■ ${tableName}: [error reading schema: ${err.message}]`);
        }
      }
    }

    const snapshot = lines.join('\n');
    console.log(`   📋  Schema snapshot cached (${snapshot.length} chars, ~${Math.ceil(snapshot.length / 4)} tokens)`);
    return snapshot;
  }

  /**
   * For key dimension/category columns, fetch distinct values so the LLM
   * knows the exact allowed values (avoids wrong WHERE filters).
   * Only includes columns with ≤ 20 distinct values (true dimensions).
   */
  _getDimensionHints(conn, tableName, columns) {
    const hints = [];
    // Auto-detect dimensions: any TEXT column with ≤ 20 distinct non-null values
    for (const col of columns) {
      if (col.type && col.type.toUpperCase() !== 'TEXT') continue; // skip numeric columns
      try {
        const distinct = conn.prepare(
          `SELECT DISTINCT "${col.name}" FROM "${tableName}" WHERE "${col.name}" IS NOT NULL ORDER BY "${col.name}" LIMIT 25`
        ).all().map(r => r[col.name]);
        if (distinct.length > 0 && distinct.length <= 20) {
          hints.push(`${col.name}=[${distinct.join('|')}]`);
        }
      } catch (_) {}
    }

    return hints.length > 0 ? `Values: ${hints.join(', ')}` : '';
  }

  /** Cleanup on shutdown */
  close() {
    for (const [name, { conn, config }] of this.databases) {
      try {
        if (config.type === 'sqlite' && conn) conn.close();
        console.log(`   💾  Database closed: ${name}`);
      } catch (_) {}
    }
  }
}

module.exports = DbAgent;
