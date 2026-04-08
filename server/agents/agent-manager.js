/**
 * Agent Manager — Agentic Orchestrator
 * ─────────────────────────────────────
 * Uses OpenAI function-calling (tools) to route user intents
 * to specialised agents (API Agent, DB Agent, etc.)
 *
 * Flow:
 *   1. User message → LLM with tools declared
 *   2. LLM decides to call a tool → Agent Manager executes it
 *   3. Tool result → back to LLM for final natural-language response
 *   4. Repeat until LLM produces a text response (multi-step supported)
 */

const MAX_TOOL_ROUNDS = 5; // Safety: max tool-call loops before forcing a text reply

/* ═══════════════════════════════════════════════
   Intent-domain → tool groups mapping
   ═══════════════════════════════════════════════
   Each domain maps to an array of tool-group keys.
   When the user's intent falls in a domain, only
   tools from the listed groups are sent to the LLM,
   dramatically reducing prompt token count.
   ═══════════════════════════════════════════════ */

const TOOL_GROUPS = {
  db:       ['list_tables', 'describe_table', 'get_full_schema', 'query_database', 'query_all_tables', 'execute_database'],
  bre:      ['explain_table', 'explain_column', 'list_formulas', 'list_business_rules', 'list_kpis', 'list_relationships', 'lookup_glossary', 'reload_business_rules'],
  code:     ['clone_repo', 'list_repo_files', 'read_code_file', 'search_code', 'analyze_structure'],
  workflow: ['start_training', 'record_step', 'finish_training', 'list_workflows', 'find_workflow', 'get_workflow', 'suggest_next_step', 'validate_current_page'],
  api:      ['get_random_joke', 'get_weather', 'http_request'],
  groww:    ['groww_place_order', 'groww_modify_order', 'groww_cancel_order', 'groww_get_order_list', 'groww_get_order_status', 'groww_get_order_detail', 'groww_get_holdings', 'groww_get_positions', 'groww_get_ltp', 'groww_get_quote', 'groww_get_margin', 'groww_calculate_margin'],
  bajaj:    ['bajaj_get_profile', 'bajaj_get_funds', 'bajaj_get_holdings', 'bajaj_get_positions', 'bajaj_get_orderbook', 'bajaj_get_order_by_id', 'bajaj_get_tradebook', 'bajaj_place_order', 'bajaj_modify_order', 'bajaj_cancel_order', 'bajaj_get_stock_quote', 'bajaj_get_index_data', 'bajaj_get_stock_news'],
};

/**
 * Maps an intent domain to the tool groups it needs.
 * Domains not listed here get ALL tools (safe fallback).
 */
const DOMAIN_TOOL_MAP = {
  // Data queries — need DB + BRE (for formulas/KPIs), no code/workflow/API
  database:    ['db', 'bre'],
  aggregation: ['db', 'bre'],
  comparison:  ['db', 'bre'],
  trend:       ['db', 'bre'],
  export:      ['db', 'bre'],

  // Code questions — only code tools
  code:        ['code'],

  // Workflow actions — only workflow tools
  workflow:    ['workflow'],

  // API / external data
  api:         ['api', 'groww'],

  // Trading / Broker Buddy
  trading:     ['bajaj'],

  // Greeting / meta / notes — no tools needed
  greeting:    [],
  meta:        [],
  notes:       [],
};

/**
 * Retry wrapper for OpenAI API calls — handles transient connection errors.
 */
async function callWithRetry(fn, retries = 2) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isRetryable = err.message?.includes('Connection error') ||
                          err.message?.includes('ECONNRESET') ||
                          err.message?.includes('ETIMEDOUT') ||
                          err.message?.includes('fetch failed') ||
                          err.status === 429 || err.status === 500 || err.status === 503;
      if (isRetryable && attempt < retries) {
        console.warn(`   🔄  API call failed (attempt ${attempt}/${retries}): ${err.message}. Retrying in ${attempt * 2}s...`);
        await new Promise(r => setTimeout(r, attempt * 2000));
        continue;
      }
      throw err;
    }
  }
}

class AgentManager {
  constructor() {
    /** @type {Map<string, { definition: object, handler: Function }>} */
    this.tools = new Map();
  }

  /**
   * Register a tool that the LLM can call.
   * @param {object}   definition  — OpenAI function tool schema
   * @param {Function} handler     — async (args) => result
   */
  registerTool(definition, handler) {
    const name = definition.function.name;
    this.tools.set(name, { definition, handler });
    console.log(`   🔧  Tool registered: ${name}`);
  }

  /**
   * Register all tools from an agent instance.
   * Each agent must expose `.getTools()` returning [{ definition, handler }]
   */
  registerAgent(agent) {
    const tools = agent.getTools();
    for (const { definition, handler } of tools) {
      this.registerTool(definition, handler);
    }
  }

  /** Get all tool definitions for the OpenAI API */
  getToolDefinitions() {
    return Array.from(this.tools.values()).map(t => t.definition);
  }

  /**
   * Get tool definitions filtered by intent domain.
   * Returns only the tools relevant to the detected domain,
   * saving prompt tokens and reducing LLM confusion.
   *
   * @param {string} domain — intent domain (e.g. 'database', 'code', 'api')
   * @param {number} confidence — intent confidence (0–1)
   * @returns {{ toolDefs: object[], filtered: boolean, reason: string }}
   */
  getToolsForDomain(domain, confidence = 0) {
    const allDefs = this.getToolDefinitions();

    // Low confidence → send all tools (let LLM decide)
    if (confidence < 0.5) {
      return { toolDefs: allDefs, filtered: false, reason: `low confidence (${(confidence * 100).toFixed(0)}%)` };
    }

    // Unknown domain → send all tools
    const groups = DOMAIN_TOOL_MAP[domain];
    if (groups === undefined) {
      return { toolDefs: allDefs, filtered: false, reason: `unknown domain "${domain}"` };
    }

    // Greeting/meta/notes → zero tools
    if (groups.length === 0) {
      return { toolDefs: [], filtered: true, reason: `${domain} needs no tools` };
    }

    // Build allowed tool name set from the mapped groups
    const allowedNames = new Set();
    for (const groupKey of groups) {
      const names = TOOL_GROUPS[groupKey];
      if (names) names.forEach(n => allowedNames.add(n));
    }

    const filtered = allDefs.filter(def => allowedNames.has(def.function?.name));

    return { toolDefs: filtered, filtered: true, reason: `domain="${domain}"` };
  }

  /**
   * Execute a tool call returned by the LLM.
   * @param {string} name — tool/function name
   * @param {string} argsJson — JSON string of arguments
   * @returns {Promise<string>} — result as string
   */
  async executeTool(name, argsJson) {
    const tool = this.tools.get(name);
    if (!tool) {
      return JSON.stringify({ error: `Unknown tool: ${name}` });
    }

    let args;
    try {
      args = typeof argsJson === 'string' ? JSON.parse(argsJson) : argsJson;
    } catch {
      return JSON.stringify({ error: `Invalid JSON arguments for ${name}` });
    }

    console.log(`   ⚡  Calling tool: ${name}(${JSON.stringify(args).slice(0, 200)})`);

    try {
      const result = await tool.handler(args);

      // Handle truncated API responses — keep full data for table extraction
      let text;
      let rawData;
      if (result && typeof result === 'object' && result._rawData !== undefined) {
        // Truncated API response — use truncated text for LLM, full data for tables
        text = result._truncated;
        rawData = result._rawData;
      } else {
        text = typeof result === 'string' ? result : JSON.stringify(result);
        rawData = result;
      }

      console.log(`   ✅  Tool result: ${text.slice(0, 200)}${text.length > 200 ? '…' : ''}`);
      return { text, rawData };
    } catch (err) {
      console.error(`   ❌  Tool error (${name}):`, err.message);
      const errStr = JSON.stringify({ error: err.message });
      return { text: errStr, rawData: null };
    }
  }

  /**
   * Run the full agentic chat loop.
   * Sends the user message with tools, handles tool calls in a loop,
   * and returns the final text response.
   *
   * @param {object}   client  — AzureOpenAI client
   * @param {string}   model
   * @param {object[]} messages — full messages array (system + history + user)
   * @param {object}   [opts]  — optional overrides
   * @param {object[]} [opts.toolDefs]      — filtered tool definitions (for multi-tenant)
   * @param {Function} [opts.executeToolFn] — scoped tool executor (for multi-tenant access control)
   * @returns {Promise<string>} — final assistant text response
   */
  async runAgentLoop(client, model, messages, opts = {}) {
    const toolDefs = opts.toolDefs || this.getToolDefinitions();
    const executeToolFn = opts.executeToolFn || this.executeTool.bind(this);
    let rounds = 0;
    const toolsUsed = new Set(); // Track which tools were called for citation
    const tables = [];           // Collect tabular data from tool results
    const toolCalls = [];        // Collect tool call details (name + args) for UI drill-down
    const startTime = Date.now();
    let totalLlmMs = 0;         // Accumulated LLM call time
    let totalToolMs = 0;        // Accumulated tool execution time

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;
      const roundStart = Date.now();
      console.log(`   🔁  Agent round ${rounds}/${MAX_TOOL_ROUNDS}`);

      const completionParams = {
        model,
        messages,
        max_tokens: 800,
        temperature: 0.3, // lower temp for stricter grounding
      };

      // Only include tools if we have any registered
      if (toolDefs.length > 0) {
        completionParams.tools = toolDefs;
        completionParams.tool_choice = 'auto';
      }

      const llmStart = Date.now();
      const completion = await callWithRetry(() => client.chat.completions.create(completionParams));
      const llmElapsed = Date.now() - llmStart;
      totalLlmMs += llmElapsed;
      const choice = completion.choices[0];
      console.log(`   ⏱  LLM call: ${llmElapsed}ms (tokens: ${completion.usage?.total_tokens || '?'})`);

      // If LLM produced a text response (no tool calls), we're done
      if (choice.finish_reason === 'stop' || !choice.message.tool_calls?.length) {
        let reply = choice.message.content?.trim() || 'I completed the task but have nothing to add.';
        // Append source citations if tools were used and reply doesn't already cite them
        if (toolsUsed.size > 0 && !reply.includes('[source:')) {
          const sources = Array.from(toolsUsed).map(t => t.replace(/^groww_/, '')).join(', ');
          reply += ` [source: ${sources}]`;
        }
        const elapsed = Date.now() - startTime;
        console.log(`   ✅  Agent loop complete: ${rounds} round(s), ${toolsUsed.size} tool(s), ${tables.length} table(s), ${elapsed}ms`);
        const timing = { totalMs: elapsed, llmMs: totalLlmMs, toolMs: totalToolMs, rounds };
        return { reply, tables, toolCalls, timing };
      }

      // LLM wants to call tools — execute them ALL IN PARALLEL
      messages.push(choice.message); // Add assistant message with tool_calls

      const toolCallEntries = choice.message.tool_calls.map(toolCall => {
        toolsUsed.add(toolCall.function.name);

        // Capture tool call details for client-side "show query" feature
        let parsedArgs = {};
        try { parsedArgs = JSON.parse(toolCall.function.arguments); } catch (_) {}
        toolCalls.push({
          tool: toolCall.function.name,
          arguments: parsedArgs,
          timestamp: Date.now(),
        });

        // Fire all API calls simultaneously
        const resultPromise = executeToolFn(
          toolCall.function.name,
          toolCall.function.arguments
        );

        return { toolCall, resultPromise };
      });

      // Await all tool results in parallel
      const toolStart = Date.now();
      const results = await Promise.all(
        toolCallEntries.map(async ({ toolCall, resultPromise }) => {
          const result = await resultPromise;
          return { toolCall, result };
        })
      );
      const toolElapsed = Date.now() - toolStart;
      totalToolMs += toolElapsed;
      console.log(`   ⏱  ${results.length} tool(s) executed in parallel: ${toolElapsed}ms`);
      console.log(`   ⏱  Round ${rounds} total: ${Date.now() - roundStart}ms`);

      // Process results and push tool messages
      for (const { toolCall, result } of results) {
        // result is { text, rawData } from executeTool
        const resultText = result.text;
        const rawData = result.rawData;

        // Extract tabular data from tool results for client-side rendering
        try {
          const parsed = rawData && typeof rawData === 'object'
            ? rawData
            : JSON.parse(typeof rawData === 'string' ? rawData : resultText);

          // Format 1: DB Agent rows — { rows: [...], rowCount }
          if (parsed.rows && Array.isArray(parsed.rows) && parsed.rows.length > 0) {
            tables.push({
              tool: toolCall.function.name,
              columns: Object.keys(parsed.rows[0]),
              rows: parsed.rows.slice(0, 100),
              rowCount: parsed.rowCount || parsed.rows.length,
            });
          }
          // Format 2: query_all_tables — { tables: [{ sampleRows, ... }] }
          if (parsed.tables && Array.isArray(parsed.tables)) {
            for (const t of parsed.tables) {
              if (t.sampleRows && t.sampleRows.length > 0) {
                tables.push({
                  tool: toolCall.function.name,
                  tableName: t.name,
                  columns: t.columns ? t.columns.map(c => c.name) : Object.keys(t.sampleRows[0]),
                  rows: t.sampleRows,
                  rowCount: t.totalRows || t.sampleRows.length,
                });
              }
            }
          }

          // Format 3: API responses — direct array of objects (e.g. Bajaj holdings, positions)
          if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
            // Filter out columns whose values are nested objects/arrays (e.g. nse_sec_info, bse_sec_info)
            const allCols = Object.keys(parsed[0]);
            const flatCols = allCols.filter(c => {
              const v = parsed[0][c];
              return v === null || v === undefined || typeof v !== 'object';
            });
            const flatRows = parsed.slice(0, 100).map(row => {
              const flat = {};
              for (const c of flatCols) flat[c] = row[c];
              return flat;
            });
            tables.push({
              tool: toolCall.function.name,
              tableName: toolCall.function.name.replace(/^bajaj_get_/, '').replace(/_/g, ' '),
              columns: flatCols,
              rows: flatRows,
              rowCount: parsed.length,
            });
          }

          // Format 4: API response with a data/result key wrapping an array
          // e.g. { data: [...] } or { result: [...] } or { holdings: [...] } or { Success: [...] }
          // Also searches ONE level deeper for nested arrays (e.g. payload.stockDetailsList)
          if (!Array.isArray(parsed) && typeof parsed === 'object') {
            // Helper: filter out nested object/array columns from rows
            const _flattenArr = (arr) => {
              const allCols = Object.keys(arr[0]);
              const flatCols = allCols.filter(c => {
                const v = arr[0][c];
                return v === null || v === undefined || typeof v !== 'object';
              });
              const flatRows = arr.slice(0, 100).map(row => {
                const flat = {};
                for (const c of flatCols) flat[c] = row[c];
                return flat;
              });
              return { flatCols, flatRows };
            };
            let found = false;
            for (const key of Object.keys(parsed)) {
              const val = parsed[key];
              // Direct array at level 1
              if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object') {
                const { flatCols, flatRows } = _flattenArr(val);
                tables.push({
                  tool: toolCall.function.name,
                  tableName: key.replace(/_/g, ' '),
                  columns: flatCols,
                  rows: flatRows,
                  rowCount: val.length,
                });
                found = true;
                break;
              }
              // Level 2: nested object containing an array (e.g. { payload: { stockDetailsList: [...] } })
              if (!found && val && typeof val === 'object' && !Array.isArray(val)) {
                for (const subKey of Object.keys(val)) {
                  const subVal = val[subKey];
                  if (Array.isArray(subVal) && subVal.length > 0 && typeof subVal[0] === 'object') {
                    const { flatCols, flatRows } = _flattenArr(subVal);
                    tables.push({
                      tool: toolCall.function.name,
                      tableName: subKey.replace(/_/g, ' '),
                      columns: flatCols,
                      rows: flatRows,
                      rowCount: subVal.length,
                    });
                    found = true;
                    break;
                  }
                }
                if (found) break;
              }
            }

            // Format 5: Single data object as a 1-row table (e.g. funds: { buypwr: 118, cashAvailable: 118 })
            // Only if no array-based table was found and there's a "data" key with a plain object
            if (!found && parsed.data && typeof parsed.data === 'object' && !Array.isArray(parsed.data)) {
              const obj = parsed.data;
              const keys = Object.keys(obj).filter(k => typeof obj[k] !== 'object');
              if (keys.length >= 2) {
                tables.push({
                  tool: toolCall.function.name,
                  tableName: toolCall.function.name.replace(/^bajaj_get_|^groww_get_/g, '').replace(/_/g, ' '),
                  columns: keys,
                  rows: [Object.fromEntries(keys.map(k => [k, obj[k]]))],
                  rowCount: 1,
                });
              }
            }
          }
        } catch (_) { /* not JSON or no rows — skip */ }

        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: resultText,
        });
      }

      // Loop back — LLM will see tool results and either call more tools or respond
    }

    // Safety: if we hit max rounds, force a response
    console.warn(`   ⚠️  Agent loop hit max rounds (${MAX_TOOL_ROUNDS})`);
    const finalLlmStart = Date.now();
    const final = await callWithRetry(() => client.chat.completions.create({
      model,
      messages,
      max_tokens: 300,
      temperature: 0.3,
    }));
    totalLlmMs += Date.now() - finalLlmStart;
    let reply = final.choices[0]?.message?.content?.trim() || 'I\'m sorry, I had trouble completing that task.';
    if (toolsUsed.size > 0 && !reply.includes('[source:')) {
      const sources = Array.from(toolsUsed).map(t => t.replace(/^groww_/, '')).join(', ');
      reply += ` [source: ${sources}]`;
    }
    const elapsed = Date.now() - startTime;
    const timing = { totalMs: elapsed, llmMs: totalLlmMs, toolMs: totalToolMs, rounds };
    return { reply, tables, toolCalls, timing };
  }
}

module.exports = AgentManager;
