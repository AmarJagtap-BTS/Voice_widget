/**
 * Tenant Manager
 * ──────────────
 * Multi-tenant isolation layer. Each tenant (client / platform integration)
 * gets its own API key and scoped access to:
 *   • Knowledge-base folders
 *   • Database tables
 *   • Git repositories
 *   • API tools
 *   • System prompt override
 *
 * Usage:
 *   const tm = new TenantManager();
 *   const tenant = tm.resolve(apiKey);       // returns tenant context or null
 *   const tools  = tm.filterTools(tenant, allTools);
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TENANTS_FILE = path.join(__dirname, '..', 'tenants.json');

class TenantManager {
  constructor() {
    this.tenants = {};       // tenantId → config
    this.keyIndex = {};      // apiKey → tenantId  (fast lookup)
    this.adminKey = null;
    this.settings = { requireApiKey: true, allowNoKeyInDev: true, defaultTenantId: 'default' };
    this.rateLimitCounters = {}; // tenantId → { minute: { ts, count }, day: { ts, count } }

    this._load();
  }

  /* ─── Load / Save ─── */

  _load() {
    try {
      const raw = JSON.parse(fs.readFileSync(TENANTS_FILE, 'utf8'));
      this.tenants = raw.tenants || {};
      this.adminKey = raw.admin?.apiKey || null;
      this.settings = { ...this.settings, ...(raw.settings || {}) };

      // Build key → tenantId index
      this.keyIndex = {};
      for (const [id, cfg] of Object.entries(this.tenants)) {
        if (cfg.apiKey) {
          this.keyIndex[cfg.apiKey] = id;
        }
      }
      console.log(`   🔐  Tenant Manager: ${Object.keys(this.tenants).length} tenant(s) loaded`);
    } catch (err) {
      console.warn(`   ⚠️  Tenant config not found or invalid (${err.message}). Multi-tenancy disabled.`);
      this.tenants = {};
      this.settings.requireApiKey = false;
    }
  }

  _save() {
    const raw = {
      _doc: 'Multi-tenant configuration. Each tenant gets a unique API key and scoped access to resources.',
      tenants: this.tenants,
      admin: { apiKey: this.adminKey },
      settings: this.settings,
    };
    fs.writeFileSync(TENANTS_FILE, JSON.stringify(raw, null, 2));
  }

  /* ─── Resolution ─── */

  /**
   * Resolve a tenant from an API key.
   * @param {string|null} apiKey
   * @returns {{ id, name, kbFolders, databases, allowedTables, repos, apis, systemPrompt, rateLimit } | null}
   */
  resolve(apiKey) {
    // If key provided, look it up
    if (apiKey) {
      const tenantId = this.keyIndex[apiKey];
      if (!tenantId) return null; // Invalid key
      const cfg = this.tenants[tenantId];
      if (!cfg || !cfg.enabled) return null; // Disabled tenant
      return { id: tenantId, ...cfg };
    }

    // No key provided
    if (!this.settings.requireApiKey || this.settings.allowNoKeyInDev) {
      // Fall back to default tenant
      const defaultId = this.settings.defaultTenantId;
      const cfg = this.tenants[defaultId];
      if (cfg && cfg.enabled) return { id: defaultId, ...cfg };
    }

    return null; // No access
  }

  /** Check if a key is the admin key */
  isAdmin(apiKey) {
    return !!this.adminKey && apiKey === this.adminKey;
  }

  /* ─── Rate Limiting ─── */

  /**
   * Check and increment rate limit for a tenant.
   * @returns {{ allowed: boolean, retryAfter?: number }}
   */
  checkRateLimit(tenantId) {
    const cfg = this.tenants[tenantId];
    if (!cfg?.rateLimit) return { allowed: true };

    const now = Date.now();
    if (!this.rateLimitCounters[tenantId]) {
      this.rateLimitCounters[tenantId] = {
        minute: { ts: now, count: 0 },
        day: { ts: now, count: 0 },
      };
    }
    const c = this.rateLimitCounters[tenantId];

    // Reset minute window
    if (now - c.minute.ts > 60_000) {
      c.minute = { ts: now, count: 0 };
    }
    // Reset day window
    if (now - c.day.ts > 86_400_000) {
      c.day = { ts: now, count: 0 };
    }

    // Check limits
    if (cfg.rateLimit.maxPerMinute && c.minute.count >= cfg.rateLimit.maxPerMinute) {
      return { allowed: false, retryAfter: Math.ceil((60_000 - (now - c.minute.ts)) / 1000) };
    }
    if (cfg.rateLimit.maxPerDay && c.day.count >= cfg.rateLimit.maxPerDay) {
      return { allowed: false, retryAfter: Math.ceil((86_400_000 - (now - c.day.ts)) / 1000) };
    }

    c.minute.count++;
    c.day.count++;
    return { allowed: true };
  }

  /* ─── Tool Filtering ─── */

  /**
   * Filter tool definitions to only include tools the tenant has access to.
   * @param {{ apis: string[], databases: string[], repos: string[] }} tenant
   * @param {Array} allToolDefs - Array of OpenAI tool definitions
   * @returns {Array} filtered tool definitions
   */
  filterToolDefinitions(tenant, allToolDefs) {
    if (!tenant) return allToolDefs;

    return allToolDefs.filter(toolDef => {
      const name = toolDef.function?.name || '';

      // API tools: check against tenant.apis
      if (tenant.apis && !tenant.apis.includes('*')) {
        // DB tools are always allowed if tenant has databases
        const dbTools = ['list_tables', 'describe_table', 'get_full_schema', 'query_database', 'query_all_tables', 'execute_database'];
        const codeTools = ['clone_repo', 'list_repo_files', 'read_code_file', 'search_code', 'analyze_structure'];
        const workflowTools = ['start_training', 'record_step', 'finish_training', 'list_workflows', 'find_workflow', 'get_workflow', 'suggest_next_step', 'validate_current_page'];

        if (dbTools.includes(name)) {
          return tenant.databases && tenant.databases.length > 0;
        }
        if (codeTools.includes(name)) {
          return tenant.repos && tenant.repos.length > 0;
        }
        if (workflowTools.includes(name)) {
          return true; // Workflows are always available
        }

        // API tools — must be in tenant's allowed list
        return tenant.apis.includes(name);
      }

      return true; // Wildcard '*' = all tools allowed
    });
  }

  /**
   * Create a scoped tool executor that enforces tenant boundaries.
   * Wraps the agent manager's executeTool to inject tenant restrictions.
   */
  createScopedExecutor(tenant, agentManager) {
    const original = agentManager.executeTool.bind(agentManager);

    return async (name, argsJson) => {
      const args = typeof argsJson === 'string' ? JSON.parse(argsJson) : argsJson;

      // Scope: Code tools — only allow tenant's repos
      const codeTools = ['list_repo_files', 'read_code_file', 'search_code', 'analyze_structure'];
      if (codeTools.includes(name) && tenant.repos && !tenant.repos.includes('*')) {
        const repoKey = args.repo_key;
        if (repoKey && !tenant.repos.includes(repoKey)) {
          const err = JSON.stringify({ error: `Access denied: repository "${repoKey}" is not available for your account.` });
          return { text: err, rawData: null };
        }
      }

      // Scope: clone_repo — only allow if tenant has repo access
      if (name === 'clone_repo' && tenant.repos && tenant.repos.length === 0) {
        const err = JSON.stringify({ error: 'Access denied: repository access is not enabled for your account.' });
        return { text: err, rawData: null };
      }

      // Scope: DB tools — only allow tenant's databases/tables
      if (name === 'query_database' || name === 'execute_database') {
        if (tenant.allowedTables && tenant.allowedTables.length > 0) {
          // Check if query references only allowed tables
          const sql = (args.sql || args.query || '').toLowerCase();
          const allTables = this._extractTableNames(sql);
          const blocked = allTables.filter(t => !tenant.allowedTables.includes(t));
          if (blocked.length > 0) {
            const err = JSON.stringify({ error: `Access denied: table(s) "${blocked.join(', ')}" are not available for your account.` });
            return { text: err, rawData: null };
          }
        }
      }

      return original(name, typeof argsJson === 'string' ? argsJson : JSON.stringify(argsJson));
    };
  }

  /** Simple SQL table name extractor (for access control) */
  _extractTableNames(sql) {
    const tables = new Set();
    // Match FROM/JOIN table names
    const regex = /(?:from|join)\s+[`"']?(\w+)[`"']?/gi;
    let match;
    while ((match = regex.exec(sql)) !== null) {
      tables.add(match[1].toLowerCase());
    }
    return Array.from(tables);
  }

  /* ─── Admin Operations ─── */

  /** List all tenants (admin only, no API keys exposed) */
  listTenants() {
    return Object.entries(this.tenants).map(([id, cfg]) => ({
      id,
      name: cfg.name,
      enabled: cfg.enabled,
      kbFolders: cfg.kbFolders,
      databases: cfg.databases,
      repos: cfg.repos,
      apis: cfg.apis,
      rateLimit: cfg.rateLimit,
      hasCustomPrompt: !!cfg.systemPrompt,
    }));
  }

  /** Create a new tenant */
  createTenant(tenantId, config) {
    if (this.tenants[tenantId]) {
      throw new Error(`Tenant "${tenantId}" already exists`);
    }

    const apiKey = `vb_${tenantId.slice(0, 6)}_${crypto.randomBytes(8).toString('hex')}`;
    this.tenants[tenantId] = {
      name: config.name || tenantId,
      apiKey,
      enabled: true,
      kbFolders: config.kbFolders || [],
      databases: config.databases || [],
      allowedTables: config.allowedTables || [],
      repos: config.repos || [],
      apis: config.apis || [],
      systemPrompt: config.systemPrompt || '',
      rateLimit: config.rateLimit || { maxPerMinute: 30, maxPerDay: 1000 },
    };
    this.keyIndex[apiKey] = tenantId;
    this._save();

    return { tenantId, apiKey, message: `Tenant "${tenantId}" created. Store the API key securely — it won't be shown again.` };
  }

  /** Update a tenant's config (does NOT change API key) */
  updateTenant(tenantId, updates) {
    if (!this.tenants[tenantId]) {
      throw new Error(`Tenant "${tenantId}" not found`);
    }
    const safe = { ...updates };
    delete safe.apiKey; // Never overwrite key via update
    Object.assign(this.tenants[tenantId], safe);
    this._save();
    return { tenantId, message: 'Updated' };
  }

  /** Rotate a tenant's API key */
  rotateKey(tenantId) {
    if (!this.tenants[tenantId]) {
      throw new Error(`Tenant "${tenantId}" not found`);
    }
    const oldKey = this.tenants[tenantId].apiKey;
    delete this.keyIndex[oldKey];

    const newKey = `vb_${tenantId.slice(0, 6)}_${crypto.randomBytes(8).toString('hex')}`;
    this.tenants[tenantId].apiKey = newKey;
    this.keyIndex[newKey] = tenantId;
    this._save();

    return { tenantId, apiKey: newKey, message: 'API key rotated. Update all client integrations.' };
  }

  /** Delete a tenant */
  deleteTenant(tenantId) {
    if (!this.tenants[tenantId]) {
      throw new Error(`Tenant "${tenantId}" not found`);
    }
    const key = this.tenants[tenantId].apiKey;
    delete this.keyIndex[key];
    delete this.tenants[tenantId];
    this._save();
    return { tenantId, message: 'Deleted' };
  }
}

module.exports = TenantManager;
