/**
 * Vector Store (TF-IDF based)
 * ───────────────────────────
 * Lightweight, zero-dependency vector store that uses TF-IDF
 * for similarity search — no external embedding API required.
 */

class VectorStore {
  constructor() {
    /** @type {{ text: string, source: string, tfidf: Map<string, number> }[]} */
    this.documents = [];
    /** @type {Map<string, number>} */
    this.idf = new Map();
    this.totalDocs = 0;
  }

  /* ─── Tokenisation ─── */

  static tokenize(text) {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 1);
  }

  static termFrequency(tokens) {
    const tf = new Map();
    for (const t of tokens) {
      tf.set(t, (tf.get(t) || 0) + 1);
    }
    // Normalise
    const max = Math.max(...tf.values());
    for (const [k, v] of tf) tf.set(k, v / max);
    return tf;
  }

  /* ─── Indexing ─── */

  /**
   * Load chunks from the knowledge base processor.
   * @param {{ text: string, source: string }[]} chunks
   */
  index(chunks) {
    // Build document frequency
    const df = new Map();
    const docs = [];

    for (const chunk of chunks) {
      const tokens = VectorStore.tokenize(chunk.text);
      const tf = VectorStore.termFrequency(tokens);
      const uniqueTerms = new Set(tokens);
      for (const t of uniqueTerms) {
        df.set(t, (df.get(t) || 0) + 1);
      }
      docs.push({ text: chunk.text, source: chunk.source, tf });
    }

    this.totalDocs = docs.length;

    // Compute IDF
    this.idf = new Map();
    for (const [term, count] of df) {
      this.idf.set(term, Math.log((this.totalDocs + 1) / (count + 1)) + 1);
    }

    // Compute TF-IDF vectors
    this.documents = docs.map(doc => {
      const tfidf = new Map();
      for (const [term, tfVal] of doc.tf) {
        tfidf.set(term, tfVal * (this.idf.get(term) || 1));
      }
      return { text: doc.text, source: doc.source, tfidf };
    });

    console.log(`🔍  Indexed ${this.documents.length} document(s), ${this.idf.size} unique terms`);
  }

  /* ─── Search ─── */

  /**
   * Search for the most relevant chunks.
   * @param {string} query
   * @param {number} topK
   * @returns {{ text: string, source: string, score: number }[]}
   */
  search(query, topK = 3) {
    if (this.documents.length === 0) return [];

    const qTokens = VectorStore.tokenize(query);
    const qTf = VectorStore.termFrequency(qTokens);
    const qVec = new Map();
    for (const [term, tfVal] of qTf) {
      qVec.set(term, tfVal * (this.idf.get(term) || 1));
    }

    const results = this.documents.map(doc => ({
      text: doc.text,
      source: doc.source,
      score: VectorStore.cosineSimilarity(qVec, doc.tfidf),
    }));

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, topK).filter(r => r.score > 0.01);
  }

  /* ─── Cosine Similarity ─── */

  static cosineSimilarity(a, b) {
    let dot = 0, magA = 0, magB = 0;

    for (const [term, val] of a) {
      magA += val * val;
      if (b.has(term)) dot += val * b.get(term);
    }
    for (const [, val] of b) magB += val * val;

    if (magA === 0 || magB === 0) return 0;
    return dot / (Math.sqrt(magA) * Math.sqrt(magB));
  }

  get size() {
    return this.documents.length;
  }
}

module.exports = VectorStore;
