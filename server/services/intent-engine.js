/**
 * Intent Engine — Pre-LLM Intent Understanding Layer
 * ─────────────────────────────────────────────────────
 * Runs BEFORE the LLM call to:
 *   1. Classify the user's intent into a domain + action
 *   2. Extract named entities (numbers, dates, names, comparisons, etc.)
 *   3. Resolve pronouns & references from conversation history ("that", "it", "the same")
 *   4. Rewrite vague/colloquial queries into precise ones
 *   5. Detect ambiguity and generate clarification hints
 *   6. Compute a confidence score so the LLM knows how to behave
 *   7. Track multi-turn context (follow-up detection, topic continuity)
 *
 * The engine is zero-dependency (no external NLP libs) — it uses pattern
 * matching, heuristics, and conversation context. It enriches the prompt
 * that the LLM receives so the LLM can make better tool-calling decisions.
 */

/* ═══════════════════════════════════════════════════
   §1  INTENT TAXONOMY
   ═══════════════════════════════════════════════════ */

const DOMAINS = {
  DATABASE:     'database',
  API:          'api',
  WORKFLOW:     'workflow',
  CODE:         'code',
  NOTES:        'notes',
  GENERAL:      'general',
  GREETING:     'greeting',
  META:         'meta',       // questions about Vedaa itself
  COMPARISON:   'comparison', // compare X vs Y
  AGGREGATION:  'aggregation',// sum, avg, top-N, ranking
  TREND:        'trend',      // over time, growth, decline
  EXPORT:       'export',     // download, export, CSV
  TRADING:      'trading',    // stock trading, portfolio, broker buddy
};

const ACTIONS = {
  QUERY:        'query',
  LIST:         'list',
  DESCRIBE:     'describe',
  CREATE:       'create',
  UPDATE:       'update',
  DELETE:       'delete',
  ANALYZE:      'analyze',
  COMPARE:      'compare',
  RANK:         'rank',
  AGGREGATE:    'aggregate',
  FILTER:       'filter',
  EXPLAIN:      'explain',
  NAVIGATE:     'navigate',
  GREET:        'greet',
  CLARIFY:      'clarify',
};

/* ═══════════════════════════════════════════════════
   §2  PATTERN LIBRARIES
   ═══════════════════════════════════════════════════ */

/**
 * Domain detection patterns — order matters (most specific first).
 * Each entry: { pattern: RegExp, domain: string, action: string, priority: number }
 */
const DOMAIN_PATTERNS = [
  // ── Greetings ──
  { pattern: /^(hi|hello|hey|good\s*(morning|afternoon|evening)|what'?s?\s*up|howdy|namaste|namaskar)\b/i,
    domain: DOMAINS.GREETING, action: ACTIONS.GREET, priority: 100 },

  // ── Meta (about Vedaa) ──
  { pattern: /\b(who\s+are\s+you|what\s+(?:are|can)\s+you|your\s+name|what\s+do\s+you\s+do|help\s+me|what\s+can\s+i\s+ask)\b/i,
    domain: DOMAINS.META, action: ACTIONS.EXPLAIN, priority: 95 },

  // ── Notes ──
  { pattern: /\b(take\s+a?\s*note|save\s+(?:a?\s*)?note|my\s+notes?|read\s+(?:my\s+)?notes?|show\s+notes?|delete\s+(?:all\s+)?notes?|clear\s+notes?|jot\s+down|write\s+down|remember\s+(?:this|that))\b/i,
    domain: DOMAINS.NOTES, action: ACTIONS.CREATE, priority: 90 },

  // ── Workflow / Training ──
  { pattern: /\b(start\s+(?:training|recording)|stop\s+(?:training|recording)|finish\s+(?:training|workflow)|record\s+workflow|how\s+(?:do\s+i|to)\s+.{5,}|guide\s+me|walk\s+me\s+through|step\s+by\s+step)\b/i,
    domain: DOMAINS.WORKFLOW, action: ACTIONS.NAVIGATE, priority: 85 },

  // ── Code / Repository ──
  { pattern: /\b(github\.com|gitlab\.com|bitbucket\.org|clone\s+repo|analyze\s+(?:code|repo|repository)|code\s+review|source\s+code|git\s+(?:repo|repository)|pull\s+request|commit\s+history)\b/i,
    domain: DOMAINS.CODE, action: ACTIONS.ANALYZE, priority: 85 },

  // ── Export ──
  { pattern: /\b(export|download|csv|excel|pdf|save\s+(?:as|to)\s+(?:file|csv|excel|pdf))\b/i,
    domain: DOMAINS.EXPORT, action: ACTIONS.CREATE, priority: 80 },

  // ── Comparison ──
  { pattern: /\b(compar(?:e|ing|ison)|versus|vs\.?|differ(?:ence|ent)|between\s+.+\s+and\s+|which\s+(?:one|is\s+(?:better|worse|higher|lower|more|less)))\b/i,
    domain: DOMAINS.COMPARISON, action: ACTIONS.COMPARE, priority: 78 },

  // ── Trend / Time-series ──
  { pattern: /\b(trend|over\s+time|month[\s-]over[\s-]month|year[\s-]over[\s-]year|growth|decline|increase|decrease|progress|trajectory|historical|timeline|last\s+(?:\d+\s+)?(?:days?|weeks?|months?|years?|quarters?))\b/i,
    domain: DOMAINS.TREND, action: ACTIONS.ANALYZE, priority: 76 },

  // ── Aggregation / Ranking ──
  { pattern: /\b(top\s+\d+|bottom\s+\d+|best\s+\d+|worst\s+\d+|highest|lowest|maximum|minimum|rank(?:ing)?|leader\s*board|most|least|average|total|sum\s+of|count\s+of|how\s+many|how\s+much)\b/i,
    domain: DOMAINS.AGGREGATION, action: ACTIONS.AGGREGATE, priority: 75 },

  // ── Database ──
  { pattern: /\b(?:show\s+(?:me\s+)?(?:all\s+)?(?:the\s+)?(?:tables?|data|records?|rows?|entries|columns?|schema|database|fields?)|(?:select|insert|update|delete|drop|alter|create\s+table)\s+)/i,
    domain: DOMAINS.DATABASE, action: ACTIONS.QUERY, priority: 70 },
  { pattern: /\b(?:query|fetch|retrieve|look\s*up|search\s+(?:for|in)|find\s+(?:all|the|me)?|get\s+(?:me\s+)?(?:all|the)?|list\s+(?:all|the)?|what\s+(?:is|are)\s+(?:the|all))\b/i,
    domain: DOMAINS.DATABASE, action: ACTIONS.QUERY, priority: 65 },
  { pattern: /\b(?:defects?|batch(?:es)?|process(?:es)?|production|quality|scrap(?:ped)?|yield|units?|inspection|assembl(?:y|ies)|employee|department|salary|report|revenue|sales|orders?|customers?|products?|inventory|transactions?|invoices?|expenses?|payments?|accounts?|records?|entries|metrics?|status|category)\b/i,
    domain: DOMAINS.DATABASE, action: ACTIONS.QUERY, priority: 60 },

  // ── Trading / Broker Buddy ──
  { pattern: /\b(portfolio|holdings?|nifty|sensex|bank\s*nifty|finnifty|stop[\s-]?loss|market\s*(?:quote|chart)|positions?|order[\s-]?book|trade[\s-]?book|broker\s*buddy|my\s+(?:funds?|stocks?|shares?|investments?)|rebalance|sector\s*(?:impact|analysis)|index\s+(?:data|performance)|stock\s+(?:analysis|news|price)|(?:current|latest|live|share)\s*price|price\s+of\s+\w+|ltp\b|p\s*(?:&|and)\s*l\b|pnl)\b/i,
    domain: DOMAINS.TRADING, action: ACTIONS.QUERY, priority: 88 },
  { pattern: /\b(buy|sell|place\s+order|modify\s+order|cancel\s+order)\b.*\b(\d+)\s*(?:shares?|lots?|qty|quantity)\b/i,
    domain: DOMAINS.TRADING, action: ACTIONS.CREATE, priority: 87 },
  { pattern: /\b(bajaj\s*(?:broking)?|zerodha|kite|broker)\b/i,
    domain: DOMAINS.TRADING, action: ACTIONS.QUERY, priority: 86 },

  // ── API / External Data ──
  { pattern: /\b(weather|joke|stock|portfolio|holdings?|order|trade|buy|sell|market|price|groww|api\s+call)\b/i,
    domain: DOMAINS.API, action: ACTIONS.QUERY, priority: 68 },
];

/* ═══════════════════════════════════════════════════
   §3  ENTITY EXTRACTORS
   ═══════════════════════════════════════════════════ */

const ENTITY_EXTRACTORS = {
  /**
   * Numbers & quantities: "top 5", "last 3 months", "batch 42", "100 units"
   */
  numbers(text) {
    const entities = [];
    // "top/bottom N"
    const topN = text.match(/\b(top|bottom|best|worst|first|last)\s+(\d+)\b/i);
    if (topN) entities.push({ type: 'limit', value: parseInt(topN[2]), qualifier: topN[1].toLowerCase() });

    // Standalone numbers with context
    const numContexts = [...text.matchAll(/\b(\d+(?:\.\d+)?)\s*(units?|rows?|records?|items?|batches?|%|percent|days?|months?|years?|hours?|minutes?|crore|lakh|thousand|million|billion)?\b/gi)];
    for (const m of numContexts) {
      if (m[2]) {
        entities.push({ type: 'quantity', value: parseFloat(m[1]), unit: m[2].toLowerCase() });
      }
    }

    return entities;
  },

  /**
   * Date / Time references: "today", "yesterday", "last week", "March 2024", "Q3"
   */
  dates(text) {
    const entities = [];
    const now = new Date();

    // Relative dates
    if (/\btoday\b/i.test(text)) entities.push({ type: 'date', value: 'today', resolved: now.toISOString().split('T')[0] });
    if (/\byesterday\b/i.test(text)) {
      const y = new Date(now); y.setDate(y.getDate() - 1);
      entities.push({ type: 'date', value: 'yesterday', resolved: y.toISOString().split('T')[0] });
    }
    if (/\bthis\s+week\b/i.test(text)) entities.push({ type: 'date_range', value: 'this_week' });
    if (/\blast\s+week\b/i.test(text)) entities.push({ type: 'date_range', value: 'last_week' });
    if (/\bthis\s+month\b/i.test(text)) entities.push({ type: 'date_range', value: 'this_month' });
    if (/\blast\s+month\b/i.test(text)) entities.push({ type: 'date_range', value: 'last_month' });
    if (/\bthis\s+year\b/i.test(text)) entities.push({ type: 'date_range', value: 'this_year' });
    if (/\blast\s+year\b/i.test(text)) entities.push({ type: 'date_range', value: 'last_year' });

    // "last N days/months/years"
    const lastN = text.match(/\blast\s+(\d+)\s+(days?|weeks?|months?|years?|quarters?)\b/i);
    if (lastN) entities.push({ type: 'date_range', value: `last_${lastN[1]}_${lastN[2].toLowerCase()}` });

    // Quarter references
    const quarter = text.match(/\b[Qq]([1-4])\b/);
    if (quarter) entities.push({ type: 'quarter', value: `Q${quarter[1]}` });

    // Month names
    const months = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i);
    if (months) entities.push({ type: 'month', value: months[1].toLowerCase() });

    // Year
    const year = text.match(/\b(20[12]\d)\b/);
    if (year) entities.push({ type: 'year', value: parseInt(year[1]) });

    return entities;
  },

  /**
   * Comparison entities: "X vs Y", "compare A and B", "difference between A and B"
   */
  comparisons(text) {
    const entities = [];

    // "X vs Y" or "X versus Y" — strip leading "compare/comparing" prefix
    const vsMatch = text.match(/\b(?:compar(?:e|ing)\s+)?(.+?)\s+(?:vs\.?|versus)\s+(.+?)(?:\s|$)/i);
    if (vsMatch) {
      entities.push({ type: 'comparison', left: vsMatch[1].trim(), right: vsMatch[2].trim() });
    }

    // "compare A and B"
    const compareMatch = text.match(/\bcompar(?:e|ing)\s+(.+?)\s+(?:and|with|to|against)\s+(.+?)(?:\s*$|\s+(?:in|on|for|by)\b)/i);
    if (compareMatch) {
      entities.push({ type: 'comparison', left: compareMatch[1].trim(), right: compareMatch[2].trim() });
    }

    // "difference between A and B"
    const diffMatch = text.match(/\bdifference\s+between\s+(.+?)\s+and\s+(.+?)(?:\s*$|\s+(?:in|on|for|by)\b)/i);
    if (diffMatch) {
      entities.push({ type: 'comparison', left: diffMatch[1].trim(), right: diffMatch[2].trim() });
    }

    return entities;
  },

  /**
   * Sort / Order: "sorted by", "order by", "ascending", "descending"
   */
  sorting(text) {
    const entities = [];

    const sortMatch = text.match(/\b(?:sort(?:ed)?|order(?:ed)?|arrange(?:d)?)\s+by\s+(.+?)(?:\s+(asc|desc|ascending|descending))?\s*$/i);
    if (sortMatch) {
      entities.push({
        type: 'sort',
        field: sortMatch[1].trim(),
        direction: (sortMatch[2] && /desc/i.test(sortMatch[2])) ? 'DESC' : 'ASC',
      });
    }

    if (/\b(highest|largest|most|maximum|best)\b/i.test(text) && !sortMatch) {
      entities.push({ type: 'sort', direction: 'DESC', implicit: true });
    }
    if (/\b(lowest|smallest|least|minimum|worst)\b/i.test(text) && !sortMatch) {
      entities.push({ type: 'sort', direction: 'ASC', implicit: true });
    }

    return entities;
  },

  /**
   * Filter conditions: "where X > 10", "with status active", "for department engineering"
   */
  filters(text) {
    const entities = [];

    // "where/with/for <field> <op> <value>"
    const filterPatterns = [
      /\b(?:where|with|for|having|whose)\s+(\w+)\s*(=|>|<|>=|<=|!=|is|equals?|greater|less|more|above|below|over|under)\s*(\S+)/gi,
      /\b(\w+)\s+(?:is|are|equals?)\s+['"]?([^'"]+?)['"]?\s*$/gi,
    ];

    for (const pat of filterPatterns) {
      const matches = [...text.matchAll(pat)];
      for (const m of matches) {
        entities.push({
          type: 'filter',
          field: m[1]?.trim(),
          operator: m[2]?.trim(),
          value: m[3]?.trim() || m[2]?.trim(),
        });
      }
    }

    return entities;
  },

  /**
   * Named values: quoted strings and specific identifiers
   */
  namedValues(text) {
    const entities = [];

    // Quoted strings (captures any user-specified filter values)
    const quoted = [...text.matchAll(/['"]([^'"]+)['"]/g)];
    for (const m of quoted) {
      entities.push({ type: 'quoted_value', value: m[1] });
    }

    return entities;
  },
};

/* ═══════════════════════════════════════════════════
   §4  FOLLOW-UP & PRONOUN RESOLUTION
   ═══════════════════════════════════════════════════ */

/**
 * Patterns indicating the message is a follow-up to the previous turn.
 */
const FOLLOW_UP_PATTERNS = [
  /^(and\s+)?(what\s+about|how\s+about|same\s+(?:for|but|thing)|also\s+(?:show|get|find))\b/i,
  /^(and|but|also|now|then|ok\s+(?:now|and|then))\s+/i,
  /^(?:can\s+you\s+)?(?:also|additionally|furthermore|moreover)\b/i,
  /^(?:what|how)\s+(?:about|if)\b/i,
  /^(?:show|get|find|list)\s+(?:me\s+)?(?:the\s+)?(?:same|that|those|it)\b/i,
  /^(?:do\s+(?:the|that)\s+(?:same|again))\b/i,
  /^(?:for|in|with|by)\s+\w+\s*\??$/i,   // Short prepositional follow-up like "for Sales?"
  /^(?:only|just)\s+/i,
];

/**
 * Pronouns / references that need resolution from conversation history.
 */
const PRONOUN_PATTERNS = [
  { pattern: /\b(that|those|these|it|them|the\s+same|this\s+(?:one|data|table|result))\b/i, type: 'anaphora' },
  { pattern: /\b(the\s+(?:above|previous|last|earlier)\s+(?:data|table|result|query|answer|response))\b/i, type: 'anaphora' },
  { pattern: /\b((?:more|less|fewer|additional)\s+(?:details?|info|information|data|rows?))\b/i, type: 'elaboration' },
  { pattern: /\b(can\s+you\s+(?:explain|elaborate|clarify|expand))\b/i, type: 'elaboration' },
  { pattern: /\b(why|how\s+come|what\s+(?:caused|led\s+to|explains?))\b/i, type: 'causal' },
];

/* ═══════════════════════════════════════════════════
   §5  QUERY REWRITER — COLLOQUIAL → PRECISE
   ═══════════════════════════════════════════════════ */

/**
 * Common voice/colloquial patterns rewritten to more precise queries.
 * { match: RegExp, rewrite: string | Function }
 */
const REWRITE_RULES = [
  // "show me everything" → "show all tables and data"
  { match: /^show\s+(?:me\s+)?every\s*thing$/i, rewrite: 'Show all tables with their data' },
  // "what do we have" → "list all tables"
  { match: /^what\s+(?:do\s+we|data\s+do\s+(?:we|you))\s+have\??$/i, rewrite: 'List all available tables and their row counts' },
  // "give me a summary" → structured request
  { match: /^(?:give\s+me\s+)?(?:a\s+)?summary(?:\s+of\s+(?:the\s+)?data)?$/i, rewrite: 'Provide a summary of all tables with key statistics (row counts, column counts, sample data)' },
  // "what's wrong" / "any issues" → quality analysis
  { match: /^(?:what'?s?\s+wrong|any\s+(?:issues?|problems?|errors?|defects?))\??$/i, rewrite: 'Query the database for any defects, errors, or quality issues in the data' },
  // "break it down" → detailed breakdown
  { match: /^break\s+(?:it|that|this)\s+down/i, rewrite: (ctx) => ctx.lastTopic ? `Break down the ${ctx.lastTopic} data by each category with detailed numbers` : 'Provide a detailed breakdown of the data by category' },
  // "zoom in on X" → filter to X
  { match: /^zoom\s+(?:in\s+)?(?:on|into)\s+(.+)/i, rewrite: (m) => `Show detailed data filtered to ${m[1]}` },
  // "drill down" → more detail
  { match: /^drill\s+(?:down\s+)?(?:into\s+)?(.+)$/i, rewrite: (m, ctx) => m[1] ? `Show detailed breakdown of ${m[1].trim()}` : ctx.lastTopic ? `Show detailed breakdown of ${ctx.lastTopic}` : 'Show more detailed data' },
  { match: /^drill\s+down\s*$/i, rewrite: (m, ctx) => ctx.lastTopic ? `Show detailed breakdown of ${ctx.lastTopic}` : 'Show more detailed data' },
  // "what happened" → recent events/changes
  { match: /^what\s+happened\??$/i, rewrite: (m, ctx) => ctx.lastTopic ? `What are the recent changes or events related to ${ctx.lastTopic}?` : 'What are the most recent events or changes in the data?' },
];

/* ═══════════════════════════════════════════════════
   §6  AMBIGUITY DETECTOR
   ═══════════════════════════════════════════════════ */

/**
 * Detects vague or ambiguous messages that may benefit from clarification.
 * Returns { isAmbiguous, reason, suggestions[] } or null.
 */
function detectAmbiguity(text, context) {
  const lower = text.toLowerCase().trim();
  const wordCount = lower.split(/\s+/).length;

  // Very short messages (1-2 words) that aren't greetings
  if (wordCount <= 2 && !/^(hi|hello|hey|yes|no|ok|thanks|bye|help)$/i.test(lower)) {
    // Could be a follow-up — only flag if no conversation context
    if (!context.lastAssistantMessage) {
      return {
        isAmbiguous: true,
        reason: 'very_short',
        hint: `The query "${text}" is very brief. Consider asking the LLM to interpret it broadly or ask for clarification.`,
        suggestions: [
          `Did you mean: "Show ${text} data from the database"?`,
          `Did you mean: "Search for ${text}"?`,
        ],
      };
    }
  }

  // Pronoun-heavy with no context
  const pronounCount = (lower.match(/\b(it|that|those|these|them|this)\b/g) || []).length;
  if (pronounCount >= 2 && !context.lastAssistantMessage) {
    return {
      isAmbiguous: true,
      reason: 'unresolved_pronouns',
      hint: 'Multiple pronouns with no prior context to resolve them.',
    };
  }

  // "Show me the data" without specifying which data
  if (/^show\s+(?:me\s+)?(?:the\s+)?data\s*\??$/i.test(lower) && !context.lastTopic) {
    return {
      isAmbiguous: true,
      reason: 'vague_data_request',
      hint: 'User asked for "the data" without specifying which table or domain.',
      suggestions: ['Which table or dataset would you like to see?'],
    };
  }

  return null;
}

/* ═══════════════════════════════════════════════════
   §7  INTENT ENGINE CLASS
   ═══════════════════════════════════════════════════ */

class IntentEngine {
  constructor() {
    // Multi-turn context tracker
    this.sessions = new Map(); // sessionId → { lastTopic, lastDomain, lastEntities, lastQuery, turns }
    this.SESSION_TTL = 30 * 60 * 1000; // 30 min
  }

  /**
   * Get or create a session context.
   * @param {string} sessionId
   * @returns {object}
   */
  _getSession(sessionId = 'default') {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        lastTopic: null,
        lastDomain: null,
        lastAction: null,
        lastEntities: [],
        lastQuery: null,
        lastAssistantMessage: null,
        turns: 0,
        createdAt: Date.now(),
      });
    }
    const session = this.sessions.get(sessionId);
    // Expire old sessions
    if (Date.now() - session.createdAt > this.SESSION_TTL) {
      this.sessions.delete(sessionId);
      return this._getSession(sessionId);
    }
    return session;
  }

  /**
   * Main analysis entry point.
   *
   * @param {string}   userMessage          — raw user input
   * @param {object[]} conversationHistory  — [{role, content}]
   * @param {object}   [options]
   * @param {string}   [options.sessionId]  — for multi-turn tracking
   * @param {string}   [options.lang]       — language code
   * @returns {object} — intent analysis result
   */
  analyze(userMessage, conversationHistory = [], options = {}) {
    const sessionId = options.sessionId || 'default';
    const ctx = this._getSession(sessionId);
    ctx.turns++;

    const text = userMessage.trim();
    const lower = text.toLowerCase();

    // ── 1. Classify domain + action ──
    const classification = this._classifyDomain(text);

    // ── 2. Extract entities ──
    const entities = this._extractEntities(text);

    // ── 3. Detect follow-up ──
    const followUp = this._detectFollowUp(text, ctx, conversationHistory);

    // ── 4. Resolve pronouns / references ──
    const resolved = this._resolveReferences(text, ctx, conversationHistory);

    // ── 5. Rewrite query if needed ──
    const rewritten = this._rewriteQuery(text, resolved.resolvedText, ctx);

    // ── 6. Detect ambiguity ──
    const ambiguity = detectAmbiguity(text, ctx);

    // ── 7. Compute confidence score ──
    const confidence = this._computeConfidence(classification, entities, followUp, ambiguity);

    // ── 8. Generate tool hints (which tools should the LLM prefer) ──
    const toolHints = this._generateToolHints(classification, entities, followUp, ctx);

    // ── 9. Build enriched context string for the LLM ──
    const enrichedContext = this._buildEnrichedContext({
      classification, entities, followUp, resolved, rewritten, ambiguity, confidence, toolHints, ctx
    });

    // ── 10. Update session state ──
    this._updateSession(ctx, classification, entities, text, rewritten.finalQuery);

    return {
      // Original input
      originalMessage: text,
      // Rewritten / enriched query
      processedMessage: rewritten.finalQuery,
      // Domain classification
      domain: classification.domain,
      action: classification.action,
      domainConfidence: classification.confidence,
      // Extracted entities
      entities,
      // Follow-up info
      isFollowUp: followUp.isFollowUp,
      followUpType: followUp.type,
      // Reference resolution
      resolvedReferences: resolved.resolutions,
      // Ambiguity
      ambiguity: ambiguity,
      // Overall confidence
      confidence,
      // Tool routing hints
      toolHints,
      // Enriched context block to inject into system prompt
      enrichedContext,
      // Session metadata
      sessionTurns: ctx.turns,
    };
  }

  /* ── Domain Classification ── */

  _classifyDomain(text) {
    let bestMatch = { domain: DOMAINS.GENERAL, action: ACTIONS.QUERY, confidence: 0.3, matchedPattern: null };

    for (const rule of DOMAIN_PATTERNS) {
      if (rule.pattern.test(text)) {
        const conf = rule.priority / 100;
        if (conf > bestMatch.confidence) {
          bestMatch = { domain: rule.domain, action: rule.action, confidence: conf, matchedPattern: rule.pattern.source };
        }
      }
    }

    // Boost confidence if multiple patterns match the same domain
    const domainMatches = DOMAIN_PATTERNS.filter(r => r.pattern.test(text));
    const domainCounts = {};
    for (const m of domainMatches) {
      domainCounts[m.domain] = (domainCounts[m.domain] || 0) + 1;
    }
    if (domainCounts[bestMatch.domain] > 1) {
      bestMatch.confidence = Math.min(1.0, bestMatch.confidence + 0.1);
    }

    return bestMatch;
  }

  /* ── Entity Extraction ── */

  _extractEntities(text) {
    const all = [];
    for (const [name, extractor] of Object.entries(ENTITY_EXTRACTORS)) {
      const found = extractor(text);
      all.push(...found);
    }
    return all;
  }

  /* ── Follow-Up Detection ── */

  _detectFollowUp(text, ctx, history) {
    // No follow-up possible if this is the first turn
    if (ctx.turns <= 1 && history.length === 0) {
      return { isFollowUp: false, type: null };
    }

    for (const pat of FOLLOW_UP_PATTERNS) {
      if (pat.test(text)) {
        return { isFollowUp: true, type: 'continuation', matchedPattern: pat.source };
      }
    }

    // Short messages after a conversation are likely follow-ups
    const wordCount = text.split(/\s+/).length;
    if (wordCount <= 4 && ctx.lastQuery && history.length > 0) {
      // Check if it looks like a filter/modifier rather than a new question
      if (/^(?:for|in|with|by|only|just|but|and|except|without)\b/i.test(text)) {
        return { isFollowUp: true, type: 'refinement' };
      }
    }

    // Check for pronoun references
    for (const { pattern, type } of PRONOUN_PATTERNS) {
      if (pattern.test(text)) {
        return { isFollowUp: true, type };
      }
    }

    return { isFollowUp: false, type: null };
  }

  /* ── Pronoun / Reference Resolution ── */

  _resolveReferences(text, ctx, history) {
    const resolutions = [];
    let resolvedText = text;

    // Find the last assistant message for context
    const lastAssistant = this._getLastAssistantMessage(history);
    const lastUser = this._getLastUserMessage(history);

    // Replace "that data" / "those results" / "the same" with what was last discussed
    if (ctx.lastTopic) {
      const replacements = [
        { pattern: /\b(that|those|the)\s+(data|results?|table|information|numbers?|values?|records?)\b/gi,
          replacement: `the ${ctx.lastTopic} $2` },
        { pattern: /\b(the\s+same)\b/gi,
          replacement: `the same ${ctx.lastTopic} data` },
        { pattern: /\bit\b(?!\s+(?:is|was|has|had|will|would|could|should|can|may|might))/gi,
          replacement: ctx.lastTopic },
      ];

      for (const r of replacements) {
        if (r.pattern.test(resolvedText)) {
          const before = resolvedText;
          resolvedText = resolvedText.replace(r.pattern, r.replacement);
          if (before !== resolvedText) {
            resolutions.push({ original: before, resolved: resolvedText, reason: `Resolved reference to "${ctx.lastTopic}"` });
          }
        }
      }
    }

    // Resolve "more" / "fewer" in aggregation context
    if (/\b(more|additional|extra)\b/i.test(text) && ctx.lastQuery) {
      resolutions.push({ type: 'elaboration', context: `User wants more detail on: ${ctx.lastQuery}` });
    }

    return { resolvedText, resolutions };
  }

  /* ── Query Rewriter ── */

  _rewriteQuery(originalText, resolvedText, ctx) {
    let finalQuery = resolvedText || originalText;
    let wasRewritten = false;
    let rewriteRule = null;

    for (const rule of REWRITE_RULES) {
      const match = finalQuery.match(rule.match);
      if (match) {
        if (typeof rule.rewrite === 'function') {
          finalQuery = rule.rewrite(match, ctx);
        } else {
          finalQuery = rule.rewrite;
        }
        wasRewritten = true;
        rewriteRule = rule.match.source;
        break;
      }
    }

    return { finalQuery, wasRewritten, rewriteRule, originalText };
  }

  /* ── Confidence Scoring ── */

  _computeConfidence(classification, entities, followUp, ambiguity) {
    let score = classification.confidence;

    // Boost for extracted entities (more specific = more confident)
    if (entities.length > 0) score += 0.05 * Math.min(entities.length, 4);

    // Slight penalty for follow-ups (might need context we don't have)
    if (followUp.isFollowUp) score -= 0.05;

    // Penalty for ambiguity
    if (ambiguity?.isAmbiguous) score -= 0.15;

    return Math.max(0, Math.min(1.0, parseFloat(score.toFixed(2))));
  }

  /* ── Tool Hints ── */

  _generateToolHints(classification, entities, followUp, ctx) {
    const hints = [];

    switch (classification.domain) {
      case DOMAINS.DATABASE:
      case DOMAINS.AGGREGATION:
      case DOMAINS.COMPARISON:
      case DOMAINS.TREND:
        hints.push('MUST call get_full_schema first, then query_database');
        if (entities.some(e => e.type === 'limit')) {
          const limit = entities.find(e => e.type === 'limit');
          hints.push(`Use ORDER BY + LIMIT ${limit.value} for ranking`);
        }
        if (entities.some(e => e.type === 'comparison')) {
          const comp = entities.find(e => e.type === 'comparison');
          hints.push(`Compare "${comp.left}" vs "${comp.right}" — use a single query with WHERE IN or CASE`);
        }
        if (classification.domain === DOMAINS.TREND) {
          hints.push('Use GROUP BY on date/time column + ORDER BY for trend data');
        }
        break;

      case DOMAINS.API:
        hints.push('Call the relevant API tool directly');
        break;

      case DOMAINS.CODE:
        hints.push('Start with clone_repo, then analyze_structure');
        break;

      case DOMAINS.WORKFLOW:
        hints.push('Use workflow tools (find_workflow, suggest_next_step)');
        break;

      case DOMAINS.GREETING:
        hints.push('No tools needed — respond conversationally');
        break;

      case DOMAINS.META:
        hints.push('No tools needed — explain Vedaa capabilities');
        break;
    }

    // Follow-up hints
    if (followUp.isFollowUp && ctx.lastDomain) {
      hints.push(`This is a follow-up to a ${ctx.lastDomain} query. Reuse context from the previous turn.`);
      if (ctx.lastQuery) {
        hints.push(`Previous query context: "${ctx.lastQuery}"`);
      }
    }

    return hints;
  }

  /* ── Enriched Context Builder ── */

  _buildEnrichedContext({ classification, entities, followUp, resolved, rewritten, ambiguity, confidence, toolHints, ctx }) {
    const parts = [];

    parts.push('── INTENT ANALYSIS (auto-generated, not from user) ──');
    parts.push(`Domain: ${classification.domain} | Action: ${classification.action} | Confidence: ${confidence}`);

    if (entities.length > 0) {
      const entitySummary = entities.map(e => {
        if (e.type === 'limit') return `Limit: ${e.qualifier} ${e.value}`;
        if (e.type === 'comparison') return `Compare: "${e.left}" vs "${e.right}"`;
        if (e.type === 'date' || e.type === 'date_range') return `Time: ${e.value}`;
        if (e.type === 'process_step') return `Process: ${e.value}`;
        if (e.type === 'batch_id') return `Batch: ${e.value}`;
        if (e.type === 'sort') return `Sort: ${e.field || 'auto'} ${e.direction}`;
        if (e.type === 'filter') return `Filter: ${e.field} ${e.operator} ${e.value}`;
        if (e.type === 'quantity') return `Quantity: ${e.value} ${e.unit}`;
        if (e.type === 'quoted_value') return `Value: "${e.value}"`;
        return `${e.type}: ${e.value}`;
      }).join(', ');
      parts.push(`Entities: ${entitySummary}`);
    }

    if (followUp.isFollowUp) {
      parts.push(`Follow-up: YES (${followUp.type})${ctx.lastTopic ? ` — previous topic: "${ctx.lastTopic}"` : ''}`);
    }

    if (resolved.resolutions.length > 0) {
      parts.push(`References resolved: ${resolved.resolutions.map(r => r.reason || r.context || r.resolved).join('; ')}`);
    }

    if (rewritten.wasRewritten) {
      parts.push(`Query rewritten: "${rewritten.originalText}" → "${rewritten.finalQuery}"`);
    }

    if (ambiguity) {
      parts.push(`⚠ Ambiguity detected: ${ambiguity.reason}. ${ambiguity.hint || ''}`);
    }

    if (toolHints.length > 0) {
      parts.push(`Tool strategy: ${toolHints.join(' | ')}`);
    }

    parts.push('── END INTENT ANALYSIS ──');

    return parts.join('\n');
  }

  /* ── Session Management ── */

  _updateSession(ctx, classification, entities, originalText, processedQuery) {
    ctx.lastDomain = classification.domain;
    ctx.lastAction = classification.action;
    ctx.lastEntities = entities;
    ctx.lastQuery = processedQuery || originalText;

    // Extract a "topic" from the query for pronoun resolution
    // Try to find the most meaningful noun phrase
    const topicMatch = originalText.match(/(?:about|for|of|in|from|show|get|find|list|query)\s+(?:me\s+)?(?:the\s+)?(.{3,40}?)(?:\s+(?:data|table|info|details|records|where|sorted|with|from|in|for|by)\b|\s*[\?!.]?\s*$)/i);
    if (topicMatch) {
      ctx.lastTopic = topicMatch[1].trim();
    } else if (entities.some(e => e.type === 'process_step')) {
      ctx.lastTopic = entities.find(e => e.type === 'process_step').value;
    } else if (classification.domain !== DOMAINS.GREETING && classification.domain !== DOMAINS.META) {
      // Use the whole query as topic for short queries
      if (originalText.split(/\s+/).length <= 6) {
        ctx.lastTopic = originalText;
      }
    }
  }

  /* ── Helpers ── */

  _getLastAssistantMessage(history) {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'assistant') return history[i].content;
    }
    return null;
  }

  _getLastUserMessage(history) {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].role === 'user') return history[i].content;
    }
    return null;
  }

  /**
   * Update session with the assistant's response (call after LLM responds).
   */
  updateWithResponse(sessionId, assistantMessage) {
    const ctx = this._getSession(sessionId);
    ctx.lastAssistantMessage = assistantMessage;
  }

  /**
   * Clean up expired sessions.
   */
  cleanup() {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.createdAt > this.SESSION_TTL) {
        this.sessions.delete(id);
      }
    }
  }
}

module.exports = IntentEngine;
