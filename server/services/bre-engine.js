/**
 * Business Rules Engine (BRE)
 * ───────────────────────────
 * Loads, validates, and queries business rules defined in business-rules.json.
 *
 * Provides:
 *   • Table purpose and metadata look-ups
 *   • Column descriptions, formulas, and derivation logic
 *   • Inter-table relationship information
 *   • KPI definitions and targets
 *   • Glossary term look-ups
 *   • LLM-ready context generation (injected into DB Agent prompts)
 *   • Tool definitions for the Agent Manager so users can ask
 *     "what does this table mean?" or "how is scrap rate calculated?"
 */

const path = require('path');
const fs = require('fs');

const DEFAULT_RULES_PATH = path.resolve(__dirname, '..', 'data', 'business-rules.json');

class BREEngine {
  /**
   * @param {string} [rulesPath] — path to business-rules.json (auto-detected if omitted)
   */
  constructor(rulesPath) {
    this.rulesPath = rulesPath || DEFAULT_RULES_PATH;
    this.rules = null;
    this.load();
  }

  /* ═══════════════════════════════════════════
     Loading & validation
     ═══════════════════════════════════════════ */

  /** Load (or reload) the rules file. */
  load() {
    if (!fs.existsSync(this.rulesPath)) {
      console.warn(`   ⚠️  BRE: rules file not found at ${this.rulesPath}`);
      this.rules = { tables: {}, relationships: [], glossary: {} };
      return;
    }

    try {
      const raw = fs.readFileSync(this.rulesPath, 'utf-8');
      this.rules = JSON.parse(raw);
      const tableCount = Object.keys(this.rules.tables || {}).length;
      const glossaryCount = Object.keys(this.rules.glossary || {}).length;
      console.log(`   📘  BRE: loaded ${tableCount} table(s), ${glossaryCount} glossary term(s)`);
    } catch (err) {
      console.error(`   ❌  BRE: failed to parse rules file:`, err.message);
      this.rules = { tables: {}, relationships: [], glossary: {} };
    }
  }

  /** Hot-reload — re-read the file from disk. */
  reload() {
    console.log('   🔄  BRE: reloading rules…');
    this.load();
    return { success: true, tables: Object.keys(this.rules.tables || {}) };
  }

  /* ═══════════════════════════════════════════
     Query helpers
     ═══════════════════════════════════════════ */

  /** List all tables that have business rules defined. */
  listTables() {
    const tables = this.rules.tables || {};
    return Object.entries(tables).map(([name, info]) => ({
      table: name,
      purpose: info.purpose,
      domain: info.domain,
      granularity: info.granularity,
      columnCount: Object.keys(info.columns || {}).length,
      kpiCount: (info.kpis || []).length,
      ruleCount: (info.businessRules || []).length,
    }));
  }

  /** Get detailed info about a specific table. */
  getTable(tableName) {
    const t = (this.rules.tables || {})[tableName];
    if (!t) return { error: `No business rules defined for table "${tableName}".` };
    return {
      table: tableName,
      purpose: t.purpose,
      domain: t.domain,
      granularity: t.granularity,
      primaryIdentifiers: t.primaryIdentifiers,
      tags: t.tags,
      columnCount: Object.keys(t.columns || {}).length,
      columns: Object.entries(t.columns || {}).map(([col, info]) => ({
        name: col,
        businessName: info.businessName,
        category: info.category,
        description: info.description,
        hasFormula: !!info.formula,
      })),
      kpis: t.kpis || [],
      businessRules: t.businessRules || [],
    };
  }

  /** Get detailed info about a specific column. */
  getColumn(tableName, columnName) {
    const t = (this.rules.tables || {})[tableName];
    if (!t) return { error: `No business rules defined for table "${tableName}".` };
    const col = (t.columns || {})[columnName];
    if (!col) return { error: `No rule defined for column "${columnName}" in table "${tableName}".` };
    return {
      table: tableName,
      column: columnName,
      ...col,
    };
  }

  /** Get all formulas / derived columns for a table. */
  getFormulas(tableName) {
    const t = (this.rules.tables || {})[tableName];
    if (!t) return { error: `No business rules defined for table "${tableName}".` };

    const formulas = [];
    for (const [col, info] of Object.entries(t.columns || {})) {
      if (info.formula) {
        formulas.push({
          column: col,
          businessName: info.businessName,
          expression: info.formula.expression,
          sql: info.formula.sql || null,
          description: info.formula.description,
          dependencies: info.formula.dependencies || [],
          outputFormat: info.formula.outputFormat || null,
        });
      }
    }
    return { table: tableName, formulaCount: formulas.length, formulas };
  }

  /** Get KPIs for a table. */
  getKPIs(tableName) {
    const t = (this.rules.tables || {})[tableName];
    if (!t) return { error: `No business rules defined for table "${tableName}".` };
    return { table: tableName, kpis: t.kpis || [] };
  }

  /** Get business rules / validations for a table. */
  getBusinessRules(tableName) {
    const t = (this.rules.tables || {})[tableName];
    if (!t) return { error: `No business rules defined for table "${tableName}".` };
    return { table: tableName, rules: t.businessRules || [] };
  }

  /** Get all relationships. */
  getRelationships() {
    return { relationships: this.rules.relationships || [] };
  }

  /** Look up a glossary term. */
  lookupGlossary(term) {
    const glossary = this.rules.glossary || {};
    // Try exact match first
    if (glossary[term]) return { term, definition: glossary[term] };
    // Case-insensitive search
    const lower = term.toLowerCase();
    for (const [key, val] of Object.entries(glossary)) {
      if (key.toLowerCase() === lower) return { term: key, definition: val };
    }
    // Partial match
    const matches = Object.entries(glossary)
      .filter(([key]) => key.toLowerCase().includes(lower))
      .map(([key, val]) => ({ term: key, definition: val }));
    if (matches.length > 0) return { matches };
    return { error: `No glossary entry found for "${term}".` };
  }

  /** Get the full glossary. */
  getFullGlossary() {
    return { glossary: this.rules.glossary || {} };
  }

  /* ═══════════════════════════════════════════
     LLM context generation
     ═══════════════════════════════════════════ */

  /**
   * Build a compact text block summarising ALL business rules, suitable for
   * injection into the LLM system prompt. This gives the LLM context about
   * what each table/column means and how values are calculated, so it can
   * answer user questions accurately without needing a tool call.
   *
   * @param {string[]} [tableNames] — limit to specific tables (default: all)
   * @returns {string}
   */
  buildLLMContext(tableNames) {
    const tables = this.rules.tables || {};
    const names = tableNames || Object.keys(tables);
    if (names.length === 0) return '';

    const lines = ['BUSINESS RULES CONTEXT (from BRE):'];

    for (const tName of names) {
      const t = tables[tName];
      if (!t) continue;

      lines.push(`\n■ TABLE: ${tName}`);
      lines.push(`  Purpose: ${t.purpose}`);
      lines.push(`  Granularity: ${t.granularity}`);
      if (t.primaryIdentifiers) lines.push(`  Key columns: ${t.primaryIdentifiers.join(', ')}`);

      // Summarise columns with formulas
      const formulaCols = Object.entries(t.columns || {}).filter(([, info]) => info.formula);
      if (formulaCols.length > 0) {
        lines.push('  Derived columns (formulas):');
        for (const [col, info] of formulaCols) {
          const f = info.formula;
          lines.push(`    • ${col} (${info.businessName}): ${f.expression}${f.sql ? ` [SQL: ${f.sql}]` : ''} — ${f.description}`);
        }
      }

      // KPIs
      if (t.kpis?.length > 0) {
        lines.push('  KPIs:');
        for (const kpi of t.kpis) {
          lines.push(`    • ${kpi.name}: ${kpi.formula} (target: ${kpi.target}) — ${kpi.description}`);
        }
      }

      // Business rules
      if (t.businessRules?.length > 0) {
        lines.push('  Business rules:');
        for (const br of t.businessRules) {
          lines.push(`    • [${br.id}] ${br.name}: ${br.description}`);
        }
      }
    }

    // Glossary
    const glossary = this.rules.glossary || {};
    const glossaryEntries = Object.entries(glossary);
    if (glossaryEntries.length > 0) {
      lines.push('\n■ GLOSSARY:');
      for (const [term, def] of glossaryEntries) {
        lines.push(`  • ${term}: ${def}`);
      }
    }

    return lines.join('\n');
  }

  /* ═══════════════════════════════════════════
     Agent tools — registered with AgentManager
     ═══════════════════════════════════════════ */

  /**
   * Return tool definitions + handlers for the Agent Manager.
   * @returns {{ definition: object, handler: Function }[]}
   */
  getTools() {
    const tools = [];

    // 1. explain_table — full table purpose and overview
    tools.push({
      definition: {
        type: 'function',
        function: {
          name: 'explain_table',
          description:
            'Explain the purpose, domain, granularity, KPIs, and business rules for a database table. ' +
            'Use this when the user asks "what is this table for?", "what does table X contain?", ' +
            '"what are the KPIs?", or wants to understand the business meaning of a table.',
          parameters: {
            type: 'object',
            properties: {
              table: { type: 'string', description: 'Table name (use the actual table name from the schema)' },
            },
            required: ['table'],
          },
        },
      },
      handler: async (args) => this.getTable(args.table),
    });

    // 2. explain_column — detailed column info including formula
    tools.push({
      definition: {
        type: 'function',
        function: {
          name: 'explain_column',
          description:
            'Explain a specific column — its business meaning, how its value is calculated (formula), ' +
            'allowed values, data type, and dependencies. Use when the user asks "what does column X mean?", ' +
            '"how is X calculated?", "what is the formula for X?".',
          parameters: {
            type: 'object',
            properties: {
              table:  { type: 'string', description: 'Table name' },
              column: { type: 'string', description: 'Column name (use the actual column name from the schema)' },
            },
            required: ['table', 'column'],
          },
        },
      },
      handler: async (args) => this.getColumn(args.table, args.column),
    });

    // 3. list_formulas — all derived/calculated columns for a table
    tools.push({
      definition: {
        type: 'function',
        function: {
          name: 'list_formulas',
          description:
            'List ALL formulas and derived columns in a table — shows how each calculated value is computed, ' +
            'its SQL expression, and dependencies. Use when the user asks "show me all formulas", ' +
            '"how are values calculated?", "what columns are derived?".',
          parameters: {
            type: 'object',
            properties: {
              table: { type: 'string', description: 'Table name' },
            },
            required: ['table'],
          },
        },
      },
      handler: async (args) => this.getFormulas(args.table),
    });

    // 4. list_business_rules — validation rules and process logic
    tools.push({
      definition: {
        type: 'function',
        function: {
          name: 'list_business_rules',
          description:
            'List all business rules, validations, and process logic for a table. ' +
            'Use when the user asks "what are the business rules?", "how does the process work?", ' +
            '"what validations exist?".',
          parameters: {
            type: 'object',
            properties: {
              table: { type: 'string', description: 'Table name' },
            },
            required: ['table'],
          },
        },
      },
      handler: async (args) => this.getBusinessRules(args.table),
    });

    // 5. list_kpis — KPI definitions and targets
    tools.push({
      definition: {
        type: 'function',
        function: {
          name: 'list_kpis',
          description:
            'List all Key Performance Indicators (KPIs) for a table with their formulas, targets, and descriptions. ' +
            'Use when the user asks "what KPIs are tracked?", "what are the targets?", "what should I monitor?".',
          parameters: {
            type: 'object',
            properties: {
              table: { type: 'string', description: 'Table name' },
            },
            required: ['table'],
          },
        },
      },
      handler: async (args) => this.getKPIs(args.table),
    });

    // 6. list_relationships — inter-table relationships
    tools.push({
      definition: {
        type: 'function',
        function: {
          name: 'list_relationships',
          description:
            'List all relationships between database tables — how they connect, join conditions, and relationship types. ' +
            'Use when the user asks "how are the tables related?", "what joins exist?", "what is the data model?".',
          parameters: { type: 'object', properties: {} },
        },
      },
      handler: async () => this.getRelationships(),
    });

    // 7. lookup_glossary — business term definitions
    tools.push({
      definition: {
        type: 'function',
        function: {
          name: 'lookup_glossary',
          description:
            'Look up the definition of a business term (e.g. FPY, Scrap, Rework, KPI, P0 Critical). ' +
            'Use when the user asks "what does X mean?", "define X", "what is FPY?".',
          parameters: {
            type: 'object',
            properties: {
              term: { type: 'string', description: 'Business term to look up' },
            },
            required: ['term'],
          },
        },
      },
      handler: async (args) => this.lookupGlossary(args.term),
    });

    // 8. reload_business_rules — hot-reload the rules file
    tools.push({
      definition: {
        type: 'function',
        function: {
          name: 'reload_business_rules',
          description:
            'Reload the business rules from disk. Use after the rules file has been edited.',
          parameters: { type: 'object', properties: {} },
        },
      },
      handler: async () => this.reload(),
    });

    return tools;
  }
}

module.exports = BREEngine;
