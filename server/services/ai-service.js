/**
 * AI Service
 * ──────────
 * Wraps the Azure OpenAI Chat Completions API and assembles prompts
 * with knowledge-base context. Now supports agentic tool-calling
 * via the AgentManager and intent-aware query processing via IntentEngine.
 */

const { AzureOpenAI } = require('openai');
const IntentEngine = require('./intent-engine');

class AIService {
  /**
   * @param {object}      opts
   * @param {string}      opts.apiKey
   * @param {string}      opts.endpoint
   * @param {string}      opts.apiVersion
   * @param {string}      opts.model
   * @param {string}      opts.systemPrompt
   * @param {import('./vector-store')} opts.vectorStore
   * @param {import('../agents/agent-manager')} [opts.agentManager]
   */
  constructor({ apiKey, endpoint, apiVersion, model, systemPrompt, vectorStore, agentManager, codeAgent, tenantManager, tenantVectorStores, breEngine, dbAgent }) {
    this.client = new AzureOpenAI({
      apiKey,
      endpoint,
      apiVersion: apiVersion || '2024-12-01-preview',
    });
    this.model = model || 'gpt-4o-mini';
    this.systemPrompt = systemPrompt;
    this.vectorStore = vectorStore;
    this.agentManager = agentManager || null;
    this.codeAgent = codeAgent || null;
    this.tenantManager = tenantManager || null;
    this.tenantVectorStores = tenantVectorStores || {};
    this.breEngine = breEngine || null;
    this.dbAgent = dbAgent || null;
    this.intentEngine = new IntentEngine();

    // Pre-cache schema snapshot at startup (0ms per request)
    this._cachedSchemaPrompt = this.dbAgent ? this.dbAgent.getSchemaSnapshot() : '';
  }

  /**
   * Build a prompt snippet listing already-cloned repos so the LLM knows
   * it can directly use list_repo_files / search_code / read_code_file / analyze_structure
   * without needing the user to provide a Git URL.
   * @param {object|null} tenant — if provided, only list repos the tenant has access to
   */
  _getLoadedReposPrompt(tenant) {
    if (!this.codeAgent || typeof this.codeAgent.getLoadedReposSummary !== 'function') return '';
    let repos = this.codeAgent.getLoadedReposSummary();

    // Filter to tenant's allowed repos
    if (tenant && tenant.repos && !tenant.repos.includes('*')) {
      repos = repos.filter(r => tenant.repos.includes(r.repoKey));
    }

    if (repos.length === 0) return '';
    const lines = repos.map(r => `    - repo_key: "${r.repoKey}" (${r.fileCount} files)`).join('\n');
    return (
      '  ALREADY CLONED REPOSITORIES (available NOW — no need to call clone_repo):\n' +
      lines + '\n' +
      '  • When the user asks about code, a repo, a project, a file, a class, or a function — ALWAYS use the code tools. NEVER say "I don\'t have access" or "I can\'t retrieve".\n' +
      '  • Use the repo_key directly with list_repo_files, search_code, read_code_file, or analyze_structure.\n' +
      '  • If the user asks for a code snippet or file content, call search_code to find it, then read_code_file to get the full content. ALWAYS return the actual code.\n' +
      '  • Only call clone_repo if the repo is NOT in the list above.\n'
    );
  }

  /* ═══════════════════════════════════════════════
     Domain-specific system prompt sections
     ═══════════════════════════════════════════════
     Only include the strategy blocks relevant to the
     detected intent domain. Saves 500-2000 tokens
     per request by omitting unrelated instructions.
     ═══════════════════════════════════════════════ */

  /** @private */
  _getDomainStrategy(domain, tenant) {
    // Which strategy groups this domain needs
    const DATA_DOMAINS  = new Set(['database', 'aggregation', 'comparison', 'trend', 'export', 'general']);
    const needsDb       = DATA_DOMAINS.has(domain);
    const needsCode     = domain === 'code' || domain === 'general';
    const needsWorkflow = domain === 'workflow' || domain === 'general';
    const needsApi      = domain === 'api' || domain === 'general';

    let prompt = '';

    // ── DATABASE + BRE + SCHEMA ──
    if (needsDb) {
      prompt +=
        'DATABASE STRATEGY:\n' +
        (this._cachedSchemaPrompt
          ? '  • The COMPLETE database schema is provided below — do NOT call get_full_schema or describe_table; you already have all table names, column names, types, and sample values.\n'
          : '  • ALWAYS call get_full_schema FIRST before writing ANY SQL query — it gives you every table, column, type, and foreign key in ONE call.\n') +
        '  • When data spans multiple tables, write a single SQL JOIN query instead of querying each table separately.\n' +
        '  • Use query_all_tables only when the user wants a broad preview of all data (e.g. "show me everything").\n' +
        '  • Use query_database with JOINs, sub-queries, GROUP BY, aggregates, UNION, or CTEs for analytical or cross-table questions.\n' +
        '  • Never guess table or column names — always get the schema first.\n' +
        '  SQL TIPS (CRITICAL):\n' +
        '  • Columns are properly typed (INTEGER, REAL, TEXT). You can use SUM(), AVG(), MAX(), MIN() directly on numeric columns without CAST.\n' +
        '  • For ratio/percentage calculations use: ROUND(100.0 * numerator / denominator, 2). The 100.0 ensures REAL division.\n' +
        '  • Column names are lowercase with underscores — refer to the schema below for exact names.\n' +
        '  • Use ROUND() for clean display of calculated values.\n' +
        '  • Dimension columns with exact allowed values are listed in the schema — use case-sensitive exact match in WHERE clauses.\n' +
        '  • DATE FORMAT: Dates are stored as ISO YYYY-MM-DD (e.g. "2026-03-10"). ALWAYS use this format in WHERE clauses. NEVER use "10-Mar-26" or "March 10, 2026" in SQL.\n' +
        '  • If a query returns 0 rows, double-check filter values (case-sensitive!) and column names against the schema.\n' +
        '  • For ranking queries, use ORDER BY + LIMIT.\n' +
        '  • NEVER refuse a question without first attempting to query the database.\n' +
        'BUSINESS RULES ENGINE (BRE) STRATEGY:\n' +
        '  • You have a BRE that knows table purposes, column meanings, formulas, KPIs, and business rules.\n' +
        '  • When the user asks "what does this table mean?", "how is X calculated?", "what are the KPIs?", "what is FPY?" — use BRE tools.\n' +
        '  • When writing SQL, consult BRE formulas for the correct calculation logic — do NOT guess formulas.\n' +
        '  • You MAY use business names from the BRE glossary in your responses.\n' +
        (this.breEngine ? '\n' + this.breEngine.buildLLMContext() + '\n' : '') +
        (this._cachedSchemaPrompt ? '\n' + this._cachedSchemaPrompt + '\n' : '') +
        'RESPONSE FORMAT FOR DATA:\n' +
        '  • When a tool returns 2+ rows, format as a MARKDOWN PIPE TABLE (header + separator + data rows).\n' +
        '  • Include ALL rows — do NOT summarise. For single values, use a natural sentence.\n' +
        'CHART / GRAPH GENERATION:\n' +
        '  • WHENEVER your response contains a pipe table with 2+ data rows, ALSO include a <<<CHART_JSON>>> block at the END.\n' +
        '  • Format: <<<CHART_JSON>>>{"type":"bar","title":"...","labels":[...],"datasets":[{"label":"...","data":[...]}]}<<<END_CHART>>>\n' +
        '  • Supported types: bar, line, pie, doughnut, polarArea, radar, horizontalBar.\n' +
        '  • Auto-pick: categories→bar, time→line, proportions→pie/doughnut, multi-metric→radar.\n' +
        '  • Values must be pure numbers. Include BOTH table AND chart.\n';
    }

    // ── CODE REPOSITORY ──
    if (needsCode) {
      prompt +=
        'CODE REPOSITORY STRATEGY:\n' +
        '  • You have FULL ACCESS to all listed repositories via tools. NEVER say you cannot access a repo or file — USE THE TOOLS.\n' +
        '  • For code snippets: search_code → read_code_file → return the actual code.\n' +
        '  • For Git URLs: clone_repo → analyze_structure → explain findings.\n' +
        '  • Use list_repo_files (filter by extension), search_code, read_code_file.\n' +
        this._getLoadedReposPrompt(tenant);
    }

    // ── WORKFLOW ──
    if (needsWorkflow) {
      prompt +=
        'WORKFLOW GUIDANCE STRATEGY:\n' +
        '  • "train workflow" / "start recording" → call start_training. "stop" / "finish" → call finish_training.\n' +
        '  • "how do I..." → call find_workflow. Use suggest_next_step for step-by-step guidance.\n' +
        '  • Format: "Step 1 of 5: Go to /invoices/new. Step 2: Fill in customer name (required)."\n';
    }

    // ── API ──
    if (needsApi) {
      prompt +=
        'API STRATEGY:\n' +
        '  • Use the specific API tool (e.g. groww_get_holdings, get_weather) when available.\n' +
        '  • Use http_request for ad-hoc URLs not covered by specific tools.\n';
    }

    // ── TRADING / BROKER BUDDY ──
    const needsTrading = domain === 'trading' || domain === 'general';
    if (needsTrading) {
      prompt +=
        'TRADING / BROKER BUDDY STRATEGY:\n' +
        '  • You are acting as Broker Buddy — a stock trading assistant for Bajaj Broking.\n' +
        '  • Use bajaj_* tools to fetch user profile, funds, holdings, positions, orderbook, tradebook, and market data.\n' +
        '  • RESPONSE FORMAT:\n' +
        '    - Start with a SHORT conversational summary (1-2 sentences) for the voice output.\n' +
        '    - Then show the FULL data as a MARKDOWN PIPE TABLE (header + separator + data rows) so the user can see details on screen.\n' +
        '    - Include ALL rows from the API response in the table — do NOT truncate or summarise the table.\n' +
        '    - Use "₹" symbol and proper number formatting in tables.\n' +
        '  • CHART / GRAPH GENERATION (important):\n' +
        '    - WHENEVER your response contains a pipe table with 2+ data rows, ALSO include a <<<CHART_JSON>>> block at the END.\n' +
        '    - Format: <<<CHART_JSON>>>{"type":"bar","title":"...","labels":[...],"datasets":[{"label":"...","data":[...]}]}<<<END_CHART>>>\n' +
        '    - Supported types: bar, line, pie, doughnut, polarArea, radar, horizontalBar.\n' +
        '    - Auto-pick chart type: holdings by value→pie/doughnut, P&L by stock→bar, positions→horizontalBar, index performance→line, sector split→pie.\n' +
        '    - Values must be pure numbers. Include BOTH table AND chart.\n' +
        '  • ORDER SAFETY (mandatory):\n' +
        '    - Before placing ANY order (bajaj_place_order), ALWAYS confirm: repeat symbol, qty, price, order type, and ask "Shall I go ahead?".\n' +
        '    - Before modifying or cancelling, confirm the order ID and changes with the user.\n' +
        '    - If the user gives incomplete order details, ask for the missing fields.\n' +
        '  • MARKET DATA:\n' +
        '    - Use bajaj_get_stock_quote to fetch the current/live price (LTP) of any stock. Pass the NSE trading symbol.\n' +
        '    - COMMON SYMBOL MAPPINGS: Vi/Vodafone Idea=IDEA, Google/Alphabet=GOOGL, Infosys=INFY, Reliance=RELIANCE, TCS=TCS, HDFC Bank=HDFCBANK, SBI=SBIN, Wipro=WIPRO, Tata Motors=TATAMOTORS, ITC=ITC, Bajaj Finance=BAJFINANCE, Adani Enterprises=ADANIENT.\n' +
        '    - For multiple stocks, call bajaj_get_stock_quote IN PARALLEL (one call per stock) — do NOT call sequentially.\n' +
        '    - Use bajaj_get_index_data for Nifty/Sensex/BankNifty overviews.\n' +
        '    - Use bajaj_get_stock_news for latest news about a specific stock.\n';
    }

    return prompt;
  }

  /**
   * Generate a response for a user message.
   * @param {string} userMessage
   * @param {{ role: string, content: string }[]} conversationHistory
   * @param {string} lang - Language code (e.g. 'en-IN', 'hi-IN')
   * @returns {Promise<string>}
   */
  async chat(userMessage, conversationHistory = [], lang = 'en-IN', sessionId = 'default', tenant = null) {
    // 0. Run Intent Engine — classify, extract entities, resolve references, rewrite
    const intentResult = this.intentEngine.analyze(userMessage, conversationHistory, { sessionId, lang });
    const processedMessage = intentResult.processedMessage || userMessage;

    console.log(`   🧠  Intent: ${intentResult.domain}/${intentResult.action} (${(intentResult.confidence * 100).toFixed(0)}% conf)${intentResult.isFollowUp ? ' [follow-up]' : ''}${intentResult.entities.length > 0 ? ` entities: ${intentResult.entities.map(e => e.type).join(',')}` : ''}`);
    if (intentResult.processedMessage !== userMessage) {
      console.log(`   🔄  Rewritten: "${userMessage}" → "${processedMessage}"`);
    }

    // 1. Search knowledge base — use tenant-scoped vector store if available
    const activeVectorStore = (tenant && this.tenantVectorStores[tenant.id])
      ? this.tenantVectorStores[tenant.id]
      : this.vectorStore;
    const kbResults = activeVectorStore.search(processedMessage, 3);
    let kbContext = '';

    if (kbResults.length > 0) {
      kbContext = '\n\n--- KNOWLEDGE BASE CONTEXT ---\n';
      kbContext += kbResults.map((r, i) =>
        `[Source: ${r.source} | Relevance: ${(r.score * 100).toFixed(0)}%]\n${r.text}`
      ).join('\n\n');
      kbContext += '\n--- END CONTEXT ---\n';
    }

    // 2. Build messages array
    const langInstruction = lang.startsWith('hi')
      ? '\n\nLANGUAGE: The user is speaking Hindi. You MUST respond entirely in Hindi (Devanagari script). Do NOT mix English unless the user does. Speak naturally in Hindi as a native speaker would.'
      : '\n\nLANGUAGE: The user is speaking English (Indian English). Respond in clear, natural English.';

    const hasToolsRegistered = !!(this.agentManager && this.agentManager.getToolDefinitions().length > 0);

    // ── Intent-based tool pre-filtering (compute early for prompt optimisation) ──
    let intentFilteredTools = null; // { toolDefs, filtered, reason }
    if (hasToolsRegistered) {
      intentFilteredTools = this.agentManager.getToolsForDomain(intentResult.domain, intentResult.confidence);
    }
    const effectiveToolCount = intentFilteredTools ? intentFilteredTools.toolDefs.length : 0;
    const hasTools = effectiveToolCount > 0;

    const agentInstruction = hasTools
      ? '\n\nAGENT CAPABILITIES: You have access to tools. When the user asks for data, information from external services, database operations, or code analysis, YOU MUST use the available tools.\n' +
        '  • Issue PARALLEL tool calls in a single round when you need multiple independent operations.\n' +
        this._getDomainStrategy(intentResult.domain, tenant)
      : '';

    // Grounding / guardrail instruction: enforce strict use of KB, tools, or DB only
    const guardrailInstruction = '\n\nGROUNDING RULES (READ CAREFULLY):\n' +
      '1) You MUST only provide information that is present in the provided KNOWLEDGE BASE CONTEXT, the outputs from the available tools/APIs, or the database queries.\n' +
      '2) Do NOT use outside knowledge, web browsing, or make up facts. If the answer is not available from the KB, tools, or DB, respond exactly: "I don\'t have that information in my knowledge base or available tools."\n' +
      '3) Do NOT attempt to infer or hallucinate missing details (for example numerical values, timestamps, or identifiers) — respond with the refusal phrase above.\n' +
      '4) When using tool outputs, cite the source in square brackets at the end of the response (for example: [source: holdings API]).\n' +
      '5) Keep language natural and concise for voice playback. Pipe tables (| col |) are allowed and encouraged for multi-row data. Avoid code blocks.\n' +
      '6) NEVER refuse a data question without first querying the database. If you have database tools, call query_database directly (the schema is already provided in the prompt) before deciding you cannot answer.\n' +
      '7) If a query returns 0 rows, investigate by querying DISTINCT values of the filter column to find the correct value, then retry with the correct value. NEVER include intermediate investigation data (like lists of DISTINCT values) in your final response — only include the FINAL answer.\n';

    // Build intent context block for the LLM
    const intentContextBlock = intentResult.enrichedContext
      ? `\n\n${intentResult.enrichedContext}\n`
      : '';

    // Use tenant's custom system prompt if provided, otherwise global
    const effectiveSystemPrompt = (tenant && tenant.systemPrompt)
      ? tenant.systemPrompt
      : this.systemPrompt;

    const messages = [
      {
        role: 'system',
        content:
          effectiveSystemPrompt + kbContext + guardrailInstruction +
          '\n\nIMPORTANT: You are Vedaa (वेदा), a VOICE assistant. Your name is Vedaa. Keep responses natural, conversational, and concise. ' +
          'Avoid markdown formatting, bullet points, or numbered lists in your responses — speak naturally ' +
          'as if you were talking to someone. Do not use symbols or special characters.' +
          langInstruction + agentInstruction + intentContextBlock
      },
      ...conversationHistory.slice(-10), // Keep last 10 messages for context
      { role: 'user', content: processedMessage }
    ];

    // 3. Programmatic guardrail — if NO KB context AND NO tools, refuse immediately
    //    (don't waste an LLM call that can only hallucinate)
    //    Exception: greetings, meta, and general domains always pass through
    const hasKB = kbResults.length > 0;
    const noToolDomains = new Set(['greeting', 'meta', 'general']);
    if (!hasKB && !hasTools && !noToolDomains.has(intentResult.domain)) {
      console.log('   🛑  Guardrail: no KB match & no tools — refusing');
      const refusal = lang.startsWith('hi')
        ? 'मुझे इसकी जानकारी अपने ज्ञानकोष या उपलब्ध टूल्स में नहीं मिली।'
        : 'I don\'t have that information in my knowledge base or available tools.';
      return { reply: refusal, tables: [], toolCalls: [] };
    }

    // 4. If agent manager has tools, use the agentic loop; otherwise simple completion
    const maxRetries = 2;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        let result;
        if (hasTools) {
          // Use pre-computed intent-filtered tools, then apply tenant scope
          let scopedToolDefs = intentFilteredTools.toolDefs;

          // Apply tenant-level filtering on top of intent-based filtering
          if (tenant && this.tenantManager) {
            scopedToolDefs = this.tenantManager.filterToolDefinitions(tenant, scopedToolDefs);
          }

          const totalTools = this.agentManager.getToolDefinitions().length;
          console.log(`   🔧  Tools: ${scopedToolDefs.length}/${totalTools} sent to LLM (${intentFilteredTools.filtered ? intentFilteredTools.reason : 'all — ' + intentFilteredTools.reason})`);

          const scopedExecutor = (tenant && this.tenantManager)
            ? this.tenantManager.createScopedExecutor(tenant, this.agentManager)
            : undefined;

          // runAgentLoop returns { reply, tables }
          result = await this.agentManager.runAgentLoop(this.client, this.model, messages, {
            toolDefs: scopedToolDefs,
            executeToolFn: scopedExecutor,
          });
        } else {
          // Fallback: simple chat completion (KB context available, but no tools)
          const llmStart = Date.now();
          const completion = await this.client.chat.completions.create({
            model: this.model,
            messages,
            max_tokens: 300,
            temperature: 0.3, // lower temperature for stricter grounding
          });
          const llmMs = Date.now() - llmStart;

          const reply = completion.choices[0]?.message?.content?.trim() || 'I\'m sorry, I couldn\'t generate a response.';
          result = { reply, tables: [], toolCalls: [], timing: { totalMs: llmMs, llmMs, toolMs: 0, rounds: 1 } };
        }

        // Update intent session with the response (for multi-turn context tracking)
        if (result.reply) {
          this.intentEngine.updateWithResponse(sessionId, result.reply);
        }

        // Attach intent metadata for downstream consumers
        result.intent = {
          domain: intentResult.domain,
          action: intentResult.action,
          confidence: intentResult.confidence,
          entities: intentResult.entities,
          isFollowUp: intentResult.isFollowUp,
          wasRewritten: intentResult.processedMessage !== userMessage,
        };

        return result;
      } catch (err) {
        const isRetryable = err.message?.includes('Connection error') ||
                            err.message?.includes('ECONNRESET') ||
                            err.message?.includes('ETIMEDOUT') ||
                            err.message?.includes('fetch failed') ||
                            err.status === 429 ||
                            err.status === 500 ||
                            err.status === 503;

        console.error(`OpenAI API error (attempt ${attempt}/${maxRetries}):`, err.message);

        if (isRetryable && attempt < maxRetries) {
          const delay = attempt * 2000; // 2s, 4s
          console.log(`   🔄  Retrying in ${delay / 1000}s...`);
          await new Promise(r => setTimeout(r, delay));
          continue;
        }

        if (err.status === 401) throw new Error('Invalid Azure OpenAI API key. Please check your .env file.');
        if (err.status === 404) throw new Error('Azure OpenAI deployment not found. Check your LLM_MODEL and AZURE_OPENAI_ENDPOINT.');
        if (err.status === 429) throw new Error('Rate limit exceeded. Please try again in a moment.');
        if (err.status === 503) throw new Error('Azure OpenAI service is temporarily unavailable. Please try again.');
        throw new Error(`Failed to generate response: ${err.message || 'Connection error'}. Please try again.`);
      }
    }
  }
}

module.exports = AIService;
