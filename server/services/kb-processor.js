/**
 * Knowledge-Base Processor
 * ────────────────────────
 * Reads PDF, DOCX, Markdown and Excel files from the KB directory,
 * extracts plain text, and splits it into searchable chunks.
 *
 * Excel files (≤ 5 000 rows) are converted to natural-language
 * sentences. Larger Excel files are auto-imported into SQLite
 * via the Excel Processor (DB mode).
 */

const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');

const CHUNK_SIZE = 600;   // characters per chunk
const CHUNK_OVERLAP = 100; // overlap between chunks

/**
 * Recursively find all supported files in a directory.
 */
function findFiles(dir, exts = ['.pdf', '.docx', '.md', '.xlsx', '.xls']) {
  let results = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findFiles(fullPath, exts));
    } else if (exts.includes(path.extname(entry.name).toLowerCase())) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Extract plain text from a single file.
 * For Excel files, returns null — they use a dedicated chunking path.
 */
async function extractText(filePath) {
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.pdf': {
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      return data.text;
    }
    case '.docx': {
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    }
    case '.md': {
      return fs.readFileSync(filePath, 'utf-8');
    }
    case '.xlsx':
    case '.xls':
      return null; // handled separately via excelToKBChunks
    default:
      return '';
  }
}

/**
 * Split text into overlapping chunks.
 */
function chunkText(text, source, chunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  const clean = text.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

  if (clean.length <= chunkSize) {
    chunks.push({ text: clean, source });
    return chunks;
  }

  let start = 0;
  while (start < clean.length) {
    const end = Math.min(start + chunkSize, clean.length);
    chunks.push({ text: clean.slice(start, end), source });
    start += chunkSize - overlap;
  }
  return chunks;
}

/**
 * Process the entire knowledge-base directory.
 * Returns an array of { text, source } chunks.
 */
async function processKnowledgeBase(kbDir) {
  const files = findFiles(kbDir);
  console.log(`📚  Found ${files.length} knowledge-base file(s)`);

  const allChunks = [];

  for (const filePath of files) {
    try {
      const ext = path.extname(filePath).toLowerCase();
      const relPath = path.relative(kbDir, filePath);

      // Excel files are always imported into SQLite — skip KB chunking
      if (ext === '.xlsx' || ext === '.xls') {
        console.log(`   ⏭  ${relPath} — Excel file (will be imported into SQLite separately)`);
        continue;
      }

      // All other file types: extract text and chunk
      const text = await extractText(filePath);
      if (!text) continue;
      const chunks = chunkText(text, relPath);
      allChunks.push(...chunks);
      console.log(`   ✓ ${relPath} → ${chunks.length} chunk(s)`);
    } catch (err) {
      console.error(`   ✗ Error processing ${filePath}:`, err.message);
    }
  }

  console.log(`📚  Total chunks: ${allChunks.length}`);
  return allChunks;
}

module.exports = { processKnowledgeBase, chunkText, extractText, findFiles };
