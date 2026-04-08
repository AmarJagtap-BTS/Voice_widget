/**
 * Voice Bot Widget — Server
 * ─────────────────────────
 * Express server that provides:
 *   • Static hosting for the widget JS
 *   • POST /api/chat  — send a message, get an AI response
 *   • GET  /api/kb/reload — hot-reload the knowledge base
 *   • GET  /api/health — health check
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const { processKnowledgeBase } = require('./services/kb-processor');
const VectorStore = require('./services/vector-store');
const AIService = require('./services/ai-service');
const AgentManager = require('./agents/agent-manager');
const ApiAgent = require('./agents/api-agent');
const DbAgent = require('./agents/db-agent');
const GrowwAuth = require('./services/groww-auth');
const TenantManager = require('./services/tenant-manager');
const BREEngine = require('./services/bre-engine');
const { processExcelFile, ROW_THRESHOLD } = require('./services/excel-processor');

/* ─── Config ─── */

const PORT = process.env.PORT || 3800;
const KB_DIR = path.resolve(process.env.KB_DIR || path.join(__dirname, 'knowledge-base'));
const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY || '';
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || '';
const AZURE_OPENAI_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2024-12-01-preview';
const LLM_MODEL = process.env.LLM_MODEL || 'gpt-4o-mini';
const SYSTEM_PROMPT = process.env.SYSTEM_PROMPT ||
  'You are Vedaa, a friendly and helpful voice assistant. Your name is Vedaa. Answer questions concisely and conversationally. ' +
  'You can take notes for the user. If they want to save a note, tell them to say "take a note" followed by what they want to remember. ' +
  'They can also say "read my notes" to see saved notes, or "delete all notes" to clear them.';

/* ─── Initialise services ─── */

const vectorStore = new VectorStore();           // Global (default) vector store
const tenantVectorStores = {};                   // tenantId → VectorStore
let aiService = null;
let agentManager = null;
let growwAuth = null;
let tenantManager = null;
let codeAgentRef = null;                         // kept for AI service repo prompt

async function initServices() {
  // 0. Load Tenant Manager
  tenantManager = new TenantManager();

  // 1. Process Knowledge Base — build a VectorStore per tenant
  console.log(`\n📂  KB directory: ${KB_DIR}`);
  const allChunks = await processKnowledgeBase(KB_DIR);
  vectorStore.index(allChunks);                    // Global fallback

  // Build per-tenant vector stores from their allowed KB folders
  for (const [tenantId, cfg] of Object.entries(tenantManager.tenants)) {
    if (!cfg.kbFolders || cfg.kbFolders.length === 0) continue;
    const tenantChunks = allChunks.filter(chunk => {
      // chunk.source is the relative path inside KB_DIR
      const src = (chunk.source || '').replace(/\\/g, '/');
      return cfg.kbFolders.some(folder => src.startsWith(folder + '/') || src === folder);
    });
    if (tenantChunks.length > 0) {
      tenantVectorStores[tenantId] = new VectorStore();
      tenantVectorStores[tenantId].index(tenantChunks);
      console.log(`   📚  Tenant "${tenantId}": ${tenantChunks.length} KB chunk(s) indexed`);
    }
  }

  // 2. Initialise Agent Manager + Agents
  console.log('\n🤖  Initialising agents…');
  agentManager = new AgentManager();

  // Initialise Groww authentication (if configured)
  growwAuth = new GrowwAuth();
  await growwAuth.init();

  // Load agent config
  let agentConfig = { apis: [], databases: [] };
  try {
    agentConfig = require('./agents/agent-config.json');
    console.log('   📄  Agent config loaded');
  } catch (err) {
    console.warn('   ⚠️  No agent-config.json found — agents disabled');
  }

  // Register API Agent
  if (agentConfig.apis?.length > 0) {
    const apiAgent = new ApiAgent(agentConfig.apis);
    agentManager.registerAgent(apiAgent);
    console.log(`   🌐  API Agent: ${agentConfig.apis.length} API(s) configured`);
  }

  // Register DB Agent
  let dbAgent = null;
  if (agentConfig.databases?.length > 0) {
    dbAgent = new DbAgent(agentConfig.databases);
    agentManager.registerAgent(dbAgent);
    console.log(`   💾  DB Agent: ${agentConfig.databases.length} database(s) configured`);
  }

  // Register Code Agent
  const CodeAgent = require('./agents/code-agent');
  const codeAgent = new CodeAgent();
  codeAgentRef = codeAgent;
  agentManager.registerAgent(codeAgent);
  const loadedRepos = codeAgent.getLoadedReposSummary();
  console.log(`   📂  Code Agent: Ready to analyze Git repositories (${loadedRepos.length} repo(s) pre-loaded: ${loadedRepos.map(r => r.repoKey).join(', ') || 'none'})`);

  // Register Workflow Agent
  const WorkflowAgent = require('./agents/workflow-agent');
  const workflowAgent = new WorkflowAgent();
  agentManager.registerAgent(workflowAgent);
  console.log(`   🎯  Workflow Agent: Ready to record and guide workflows`);

  // Register Business Rules Engine (BRE)
  const breEngine = new BREEngine();
  agentManager.registerAgent(breEngine);
  const breTableCount = breEngine.listTables().length;
  console.log(`   📘  BRE Agent: ${breTableCount} table(s) with business rules, formulas & KPIs`);

  // Auto-import ALL Excel files from KB into SQLite (one table per sheet)
  try {
    const { findFiles } = require('./services/kb-processor');
    const excelFiles = findFiles(KB_DIR, ['.xlsx', '.xls']);
    if (excelFiles.length > 0 && dbAgent) {
      // Get the SQLite connection from the first configured DB
      const firstDb = dbAgent.databases.values().next().value;
      if (firstDb?.conn) {
        for (const xlFile of excelFiles) {
          const relName = path.relative(KB_DIR, xlFile);
          const result = processExcelFile(xlFile, firstDb.conn, relName);
          console.log(`   📊  Excel "${path.basename(xlFile)}" → SQLite (${result.totalRows} rows, tables: ${result.tables.map(t => t.name).join(', ')})`);
        }
      } else {
        console.warn('   ⚠️  No SQLite connection available — Excel files not imported');
      }
    }
  } catch (err) {
    console.warn('   ⚠️  Excel→SQLite import failed:', err.message);
  }

  const toolCount = agentManager.getToolDefinitions().length;
  console.log(`   🧩  Total tools available: ${toolCount}`);

  // 3. Initialise AI Service
  if (!AZURE_OPENAI_API_KEY || !AZURE_OPENAI_ENDPOINT || AZURE_OPENAI_ENDPOINT.includes('YOUR-RESOURCE-NAME')) {
    console.warn('\n⚠️   Azure OpenAI not configured. The bot will echo KB search results but cannot generate AI responses.');
    console.warn('    Set AZURE_OPENAI_API_KEY and AZURE_OPENAI_ENDPOINT in your .env file to enable AI chat.\n');
  } else {
    aiService = new AIService({
      apiKey: AZURE_OPENAI_API_KEY,
      endpoint: AZURE_OPENAI_ENDPOINT,
      apiVersion: AZURE_OPENAI_API_VERSION,
      model: LLM_MODEL,
      systemPrompt: SYSTEM_PROMPT,
      vectorStore,
      agentManager,
      codeAgent: codeAgentRef,
      tenantManager,
      tenantVectorStores,
      breEngine,
      dbAgent,
    });
    console.log(`🤖  AI service ready (model: ${LLM_MODEL})`);
  }
}

/* ─── Express App ─── */

const app = express();

app.use(cors());
app.use(express.json());

// Serve widget files
app.use('/widget', express.static(path.join(__dirname, '..', 'public', 'widget')));

// Serve demo page
app.use(express.static(path.join(__dirname, '..', 'public')));

/* ─── Tenant Auth Middleware ─── */

/**
 * Extracts API key from x-api-key header and resolves tenant context.
 * Attaches req.tenant = { id, name, kbFolders, databases, repos, apis, ... } or null.
 */
function tenantAuth(req, res, next) {
  const apiKey = req.headers['x-api-key'] || req.query.apiKey || null;
  if (tenantManager) {
    const tenant = tenantManager.resolve(apiKey);

    // If keys are required and none resolved, reject
    if (!tenant && tenantManager.settings.requireApiKey && !tenantManager.settings.allowNoKeyInDev) {
      return res.status(401).json({ error: 'Invalid or missing API key. Include x-api-key header.' });
    }

    // Rate limit check
    if (tenant) {
      const rl = tenantManager.checkRateLimit(tenant.id);
      if (!rl.allowed) {
        return res.status(429).json({ error: 'Rate limit exceeded.', retryAfter: rl.retryAfter });
      }
    }

    req.tenant = tenant;
    req.isAdmin = tenantManager.isAdmin(apiKey);
  } else {
    req.tenant = null;
    req.isAdmin = false;
  }
  next();
}

// Apply tenant auth to all /api routes
app.use('/api', tenantAuth);

/* ─── Routes ─── */

// Deepgram API key proxy — keeps the key server-side
app.get('/api/deepgram/token', (_req, res) => {
  const key = process.env.DEEPGRAM_API_KEY || '';
  if (!key) {
    return res.status(500).json({ error: 'DEEPGRAM_API_KEY not configured on server' });
  }
  res.json({ key });
});

// Health check
app.get('/api/health', (_req, res) => {
  const tenant = _req.tenant;
  res.json({
    status: 'ok',
    tenant: tenant ? { id: tenant.id, name: tenant.name } : null,
    kbSize: tenant && tenantVectorStores[tenant.id]
      ? tenantVectorStores[tenant.id].size
      : vectorStore.size,
    aiEnabled: !!aiService,
    model: LLM_MODEL,
    agents: {
      toolCount: agentManager ? agentManager.getToolDefinitions().length : 0,
      tools: agentManager
        ? (tenant && tenantManager
          ? tenantManager.filterToolDefinitions(tenant, agentManager.getToolDefinitions()).map(t => t.function.name)
          : agentManager.getToolDefinitions().map(t => t.function.name))
        : [],
    },
    groww: {
      authenticated: growwAuth?.isAuthenticated || false,
      configured: !!process.env.GROWW_API_KEY || !!process.env.GROWW_ACCESS_TOKEN,
    },
  });
});

// Chat endpoint
app.post('/api/chat', async (req, res) => {
  try {
    const { message, conversationHistory = [], lang = 'en-IN', sessionId = 'default' } = req.body;
    const tenant = req.tenant;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    console.log(`💬  User (${lang})${tenant ? ` [${tenant.id}]` : ''}: ${message}`);

    // If AI service is available, use it
    if (aiService) {
      const result = await aiService.chat(message, conversationHistory, lang, sessionId, tenant);
      // result is { reply, tables, toolCalls, intent, timing } from the agentic loop
      let response = result.reply || result;
      const tables = result.tables || [];
      const toolCalls = result.toolCalls || [];
      const intent = result.intent || null;
      const timing = result.timing || null;

      // Extract chart JSON if LLM included <<<CHART_JSON>>>...<<<END_CHART>>>
      let charts = [];
      const chartRegex = /<<<CHART_JSON>>>([\s\S]*?)<<<END_CHART>>>/g;
      let chartMatch;
      while ((chartMatch = chartRegex.exec(response)) !== null) {
        try {
          const chartData = JSON.parse(chartMatch[1].trim());
          charts.push(chartData);
        } catch (e) {
          console.warn('⚠️  Failed to parse chart JSON:', e.message);
        }
      }
      // Strip chart blocks from the text response
      response = response.replace(/<<<CHART_JSON>>>[\s\S]*?<<<END_CHART>>>/g, '').trim();

      console.log(`🤖  Bot: ${typeof response === 'string' ? response.slice(0, 200) : response}`);
      if (charts.length > 0) console.log(`📊  Charts: ${charts.length} chart(s) generated`);
      if (intent) console.log(`🧠  Intent: ${intent.domain}/${intent.action} (${(intent.confidence * 100).toFixed(0)}%)${intent.isFollowUp ? ' [follow-up]' : ''}${intent.wasRewritten ? ' [rewritten]' : ''}`);
      if (toolCalls.length > 0) console.log(`🔧  Tool calls: ${toolCalls.length} call(s) — ${toolCalls.map(t => t.tool).join(', ')}`);
      if (timing) console.log(`⏱  Timing: total=${timing.totalMs}ms, llm=${timing.llmMs}ms, tools=${timing.toolMs}ms, rounds=${timing.rounds}`);
      return res.json({ response, tables, charts, toolCalls, intent, timing });
    }

    // Fallback: return KB search results as plain text
    const results = vectorStore.search(message, 2);
    if (results.length > 0) {
      const response = `Based on our knowledge base: ${results[0].text.slice(0, 300)}`;
      return res.json({ response });
    }

    return res.json({
      response: 'I don\'t have enough information to answer that. Please configure an OpenAI API key for full AI capabilities.',
    });
  } catch (err) {
    console.error('Chat error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Reload knowledge base
app.get('/api/kb/reload', async (_req, res) => {
  try {
    const chunks = await processKnowledgeBase(KB_DIR);
    vectorStore.index(chunks);
    res.json({ status: 'ok', chunks: vectorStore.size });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ─── Notes Storage ─── */

const NOTES_DIR = path.resolve(__dirname, 'data');
const NOTES_FILE = path.join(NOTES_DIR, 'notes.json');

function loadNotes() {
  try {
    if (!fs.existsSync(NOTES_FILE)) return [];
    return JSON.parse(fs.readFileSync(NOTES_FILE, 'utf-8'));
  } catch { return []; }
}

function saveNotes(notes) {
  if (!fs.existsSync(NOTES_DIR)) fs.mkdirSync(NOTES_DIR, { recursive: true });
  fs.writeFileSync(NOTES_FILE, JSON.stringify(notes, null, 2));
}

// List notes (optionally filter by source page)
app.get('/api/notes', (req, res) => {
  const notes = loadNotes();
  const { source } = req.query;
  const filtered = source ? notes.filter(n => n.source === source) : notes;
  res.json({ notes: filtered });
});

// Save a note
app.post('/api/notes', (req, res) => {
  const { text, source, tags } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Note text is required' });
  }

  const notes = loadNotes();
  const note = {
    id: Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
    text: text.trim(),
    source: source || 'unknown',
    tags: tags || [],
    createdAt: new Date().toISOString(),
  };
  notes.push(note);
  saveNotes(notes);

  console.log(`📝  Note saved: "${note.text.slice(0, 60)}${note.text.length > 60 ? '…' : ''}"`);
  res.json({ status: 'ok', note });
});

// Delete a note
app.delete('/api/notes/:id', (req, res) => {
  const notes = loadNotes();
  const idx = notes.findIndex(n => n.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Note not found' });

  const [removed] = notes.splice(idx, 1);
  saveNotes(notes);
  console.log(`🗑️  Note deleted: "${removed.text.slice(0, 40)}…"`);
  res.json({ status: 'ok' });
});

// Summarize text into a concise note (used when user says "note that down")
app.post('/api/notes/summarize', async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== 'string') {
    return res.status(400).json({ error: 'Text is required' });
  }

  // If AI is available, use it to create a crisp summary
  if (aiService) {
    try {
      const completion = await aiService.client.chat.completions.create({
        model: aiService.model,
        messages: [
          {
            role: 'system',
            content:
              'You are a note-taking assistant. The user heard some information and wants to save it as a note. ' +
              'Summarize the following text into a short, clear, and self-contained note (1-2 sentences max). ' +
              'Write it as a factual note, not as a conversation. Do not start with "Note:" or any prefix. ' +
              'Just the key information, concisely.'
          },
          { role: 'user', content: text }
        ],
        max_tokens: 100,
        temperature: 0.3,
      });
      const summary = completion.choices[0]?.message?.content?.trim();
      if (summary) {
        console.log(`📋  Summarized: "${text.slice(0, 50)}…" → "${summary}"`);
        return res.json({ summary });
      }
    } catch (err) {
      console.error('Summarize error:', err.message);
    }
  }

  // Fallback: truncate to first sentence or 120 chars
  const firstSentence = text.match(/^[^.!?]+[.!?]/);
  const summary = firstSentence ? firstSentence[0].trim() : text.slice(0, 120).trim();
  res.json({ summary });
});

/* ─── Groww Auth ─── */

// Manually trigger Groww token refresh
app.post('/api/groww/auth', async (_req, res) => {
  if (!growwAuth) return res.status(500).json({ error: 'Groww auth not initialised' });

  try {
    const token = await growwAuth.getAccessToken();
    res.json({
      status: token ? 'ok' : 'failed',
      authenticated: !!token,
      expiry: growwAuth._tokenExpiry || null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Check Groww auth status
app.get('/api/groww/auth', (_req, res) => {
  res.json({
    authenticated: growwAuth?.isAuthenticated || false,
    hasApiKey: !!process.env.GROWW_API_KEY,
    hasSecret: !!process.env.GROWW_API_SECRET,
    hasToken: !!process.env.GROWW_ACCESS_TOKEN,
  });
});

/* ─── Tenant Admin API ─── */

function requireAdmin(req, res, next) {
  if (!req.isAdmin) {
    return res.status(403).json({ error: 'Admin access required. Provide the admin API key in x-api-key header.' });
  }
  next();
}

// List all tenants (admin only)
app.get('/api/admin/tenants', requireAdmin, (_req, res) => {
  res.json({ tenants: tenantManager.listTenants() });
});

// Create a new tenant
app.post('/api/admin/tenants', requireAdmin, (req, res) => {
  try {
    const { tenantId, ...config } = req.body;
    if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });
    const result = tenantManager.createTenant(tenantId, config);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Update a tenant
app.patch('/api/admin/tenants/:id', requireAdmin, (req, res) => {
  try {
    const result = tenantManager.updateTenant(req.params.id, req.body);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Rotate a tenant's API key
app.post('/api/admin/tenants/:id/rotate-key', requireAdmin, (req, res) => {
  try {
    const result = tenantManager.rotateKey(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Delete a tenant
app.delete('/api/admin/tenants/:id', requireAdmin, (req, res) => {
  try {
    const result = tenantManager.deleteTenant(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/* ─── Start ─── */

async function start() {
  await initServices();

  app.listen(PORT, () => {
    console.log(`\n🚀  Voice Bot server running at http://localhost:${PORT}`);
    console.log(`   Widget JS:  http://localhost:${PORT}/widget/voice-bot.js`);
    console.log(`   Demo page:  http://localhost:${PORT}/`);
    console.log(`   API health: http://localhost:${PORT}/api/health\n`);
  });
}

start().catch(err => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
