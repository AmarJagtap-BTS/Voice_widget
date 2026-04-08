/**
 * Excel Processor
 * ───────────────
 * Smart extraction of Excel files (.xlsx, .xls) for the knowledge base
 * and SQLite import. Handles messy/complex spreadsheets gracefully.
 *
 * Two modes:
 *   1. KB mode  — converts rows to natural-language sentences for vector search
 *   2. DB mode  — imports rows into SQLite for SQL-powered querying
 *
 * Auto-detects which mode to use based on row count:
 *   ≤ ROW_THRESHOLD → KB mode (text chunks)
 *   > ROW_THRESHOLD → DB mode (SQLite table)
 */

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');

const ROW_THRESHOLD = 5000;       // Above this → use DB mode
const ROWS_PER_CHUNK = 8;         // Group N rows per KB chunk
const MAX_EMPTY_RATIO = 0.7;      // Skip rows where > 70% cells are empty
const EXCEL_EPOCH = new Date(1899, 11, 30); // Excel serial date epoch

/* ═══════════════════════════════════════════════
   Derived-column helpers (for Excel formula columns)
   ═══════════════════════════════════════════════
   The xlsx library does NOT evaluate formulas. Columns like
   Week, Day, Month that are computed via =WEEKNUM(D2) etc.
   arrive as `undefined`. We derive them from the Date column.
   ═══════════════════════════════════════════════ */

const MONTH_MAP = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/**
 * Parse a date value that might be a JS Date, Excel serial number,
 * or a formatted string like "1-Mar-26" / "01-Mar-2026".
 * Returns a JS Date or null.
 */
function parseDateValue(val) {
  if (!val) return null;
  if (val instanceof Date && !isNaN(val)) return val;

  // Excel serial number
  if (typeof val === 'number') {
    const d = new Date(EXCEL_EPOCH.getTime() + val * 86400000);
    return isNaN(d) ? null : d;
  }

  // String like "1-Mar-26", "01-Mar-2026", "2026-03-01"
  const s = String(val).trim();

  // Try d-MMM-yy(yy) format
  const m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
  if (m) {
    const day = parseInt(m[1], 10);
    const mon = MONTH_MAP[m[2].toLowerCase()];
    let yr = parseInt(m[3], 10);
    if (yr < 100) yr += 2000;
    if (mon !== undefined) return new Date(yr, mon, day);
  }

  // Fallback: native Date parse
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

/**
 * Get ISO week number (1-53) for a date.
 */
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Given a row's values array, column name list, and a parsed Date,
 * fill in blank formula-derived columns (week, day, month).
 */
function fillDerivedColumns(rowValues, sqlColumns, dateObj) {
  if (!dateObj) return;
  for (let i = 0; i < sqlColumns.length; i++) {
    if (rowValues[i] && String(rowValues[i]).trim() !== '') continue; // already has a value
    const col = sqlColumns[i];
    if (col === 'week') {
      rowValues[i] = String(getISOWeek(dateObj));
    } else if (col === 'day') {
      rowValues[i] = DAY_NAMES[dateObj.getDay()];
    } else if (col === 'month') {
      rowValues[i] = MONTH_NAMES[dateObj.getMonth()];
    }
  }
}

/* ═══════════════════════════════════════════════
   Helpers
   ═══════════════════════════════════════════════ */

/**
 * Detect the actual header row — skip title/logo rows that are mostly empty.
 * Returns the 0-based index of the first row with ≥ 3 non-empty cells.
 */
function detectHeaderRow(sheet) {
  const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  for (let r = range.s.r; r <= Math.min(range.s.r + 15, range.e.r); r++) {
    let nonEmpty = 0;
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (cell && cell.v !== undefined && cell.v !== null && String(cell.v).trim() !== '') {
        nonEmpty++;
      }
    }
    if (nonEmpty >= 3) return r;
  }
  return 0; // fallback: first row
}

/**
 * Format a cell value for human-readable output (KB mode).
 * Handles Excel serial dates, numbers, booleans.
 */
function formatCellValue(cell) {
  if (!cell || cell.v === undefined || cell.v === null) return '';

  // Date: if the cell has a date type or format
  if (cell.t === 'd' || (cell.t === 'n' && cell.z && /[dmy]/i.test(cell.z))) {
    try {
      const date = XLSX.SSF.parse_date_code(cell.v);
      if (date) {
        const d = new Date(date.y, date.m - 1, date.d);
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
      }
    } catch { /* fall through */ }
  }

  // Formatted string if available
  if (cell.w) return cell.w.trim();

  // Boolean
  if (cell.t === 'b') return cell.v ? 'Yes' : 'No';

  // Number: format with Indian locale
  if (cell.t === 'n') {
    // Currency-ish large numbers
    if (Math.abs(cell.v) >= 1000) {
      return cell.v.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    }
    return String(cell.v);
  }

  return String(cell.v).trim();
}

/**
 * Format a cell value for SQLite storage (DB mode).
 * Numbers stay as plain numbers (no commas/locale formatting).
 * Dates become ISO strings (YYYY-MM-DD) for easy SQL filtering.
 * Text stays as-is.
 */
function formatCellValueForDB(cell) {
  if (!cell || cell.v === undefined || cell.v === null) return '';

  // Date: if the cell has a date type or format → store as ISO YYYY-MM-DD
  if (cell.t === 'd' || (cell.t === 'n' && cell.z && /[dmy]/i.test(cell.z))) {
    try {
      const date = XLSX.SSF.parse_date_code(cell.v);
      if (date) {
        const d = new Date(date.y, date.m - 1, date.d);
        const yyyy = d.getFullYear();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        const dd = String(d.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
      }
    } catch { /* fall through */ }
  }

  // Date: if cell value is a JS Date object (cellDates: true)
  if (cell.v instanceof Date && !isNaN(cell.v)) {
    const d = cell.v;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  // Boolean
  if (cell.t === 'b') return cell.v ? '1' : '0';

  // Number: return RAW numeric value (no commas, no locale formatting)
  if (cell.t === 'n') {
    return String(cell.v);
  }

  // Formatted string (for text cells) — but strip commas from numbers that Excel
  // may have formatted as text
  if (cell.w) {
    const trimmed = cell.w.trim();
    // If it looks like a comma-formatted number, strip commas
    if (/^[\d,]+\.?\d*$/.test(trimmed)) {
      return trimmed.replace(/,/g, '');
    }
    return trimmed;
  }

  return String(cell.v).trim();
}

/**
 * Check if a row is mostly empty / junk.
 */
function isJunkRow(rowValues, totalCols) {
  const emptyCount = rowValues.filter(v => !v || v.trim() === '').length;
  return emptyCount / totalCols > MAX_EMPTY_RATIO;
}

/* ═══════════════════════════════════════════════
   Column-type inference for typed SQLite schema
   ═══════════════════════════════════════════════
   Scans sample data rows to decide the best SQLite type
   for each column: INTEGER, REAL, or TEXT.
   Date columns stay TEXT (ISO YYYY-MM-DD strings).
   ═══════════════════════════════════════════════ */

const TYPE_SAMPLE_ROWS = 40; // scan up to this many rows for inference

/**
 * Infer SQLite column types from sample cell values.
 *
 * @param {object} sheet     — xlsx sheet object
 * @param {number} headerRow — 0-based header row index
 * @param {object} range     — decoded sheet range
 * @param {string[]} sqlCols — sanitised column names
 * @returns {string[]}       — parallel array of 'INTEGER' | 'REAL' | 'TEXT'
 */
function inferColumnTypes(sheet, headerRow, range, sqlCols) {
  const types = sqlCols.map(() => null); // null = unknown yet
  const sampleEnd = Math.min(headerRow + 1 + TYPE_SAMPLE_ROWS, range.e.r + 1);

  for (let r = headerRow + 1; r < sampleEnd; r++) {
    for (let c = range.s.c; c <= range.e.c; c++) {
      const idx = c - range.s.c;
      if (types[idx] === 'TEXT') continue; // already downgraded — skip

      const addr = XLSX.utils.encode_cell({ r, c });
      const cell = sheet[addr];
      if (!cell || cell.v === undefined || cell.v === null) continue;

      // Date columns → keep as TEXT (they store ISO strings)
      if (cell.t === 'd' || (cell.t === 'n' && cell.z && /[dmy]/i.test(cell.z))) {
        types[idx] = 'TEXT';
        continue;
      }
      if (cell.v instanceof Date) {
        types[idx] = 'TEXT';
        continue;
      }

      // Numeric cell
      if (cell.t === 'n') {
        const v = cell.v;
        if (types[idx] === null || types[idx] === 'INTEGER') {
          types[idx] = Number.isInteger(v) ? (types[idx] || 'INTEGER') : 'REAL';
        }
        // if already REAL, stays REAL
        continue;
      }

      // String cell — check if the string looks like a pure number
      if (cell.t === 's' || cell.t === undefined) {
        const s = String(cell.v).trim().replace(/,/g, '');
        if (s === '') continue; // blank — skip
        if (/^-?\d+$/.test(s)) {
          if (types[idx] === null) types[idx] = 'INTEGER';
          else if (types[idx] === 'REAL') { /* keep REAL */ }
          else if (types[idx] !== 'INTEGER') types[idx] = 'TEXT';
        } else if (/^-?\d+\.\d+$/.test(s)) {
          if (types[idx] === null || types[idx] === 'INTEGER') types[idx] = 'REAL';
          else if (types[idx] !== 'REAL') types[idx] = 'TEXT';
        } else {
          types[idx] = 'TEXT'; // non-numeric string → TEXT
        }
        continue;
      }

      // Boolean — store as INTEGER (0/1)
      if (cell.t === 'b') {
        if (types[idx] === null) types[idx] = 'INTEGER';
        continue;
      }

      // Anything else → TEXT
      types[idx] = 'TEXT';
    }
  }

  // Columns that are all-null default to TEXT (safest fallback).
  // No hardcoded column-name overrides — type inference is purely data-driven.
  return types.map(t => (t === null ? 'TEXT' : t));
}

/**
 * Convert a formatted-for-DB string value into its native JS type
 * for binding to a typed SQLite column.
 *
 * @param {string} val      — the string from formatCellValueForDB
 * @param {string} colType  — 'INTEGER' | 'REAL' | 'TEXT'
 * @returns {number|string|null}
 */
function coerceValue(val, colType) {
  if (val === '' || val === null || val === undefined) return null;
  if (colType === 'INTEGER') {
    const n = parseInt(val, 10);
    return isNaN(n) ? null : n;
  }
  if (colType === 'REAL') {
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
  }
  return val; // TEXT
}

/**
 * Sanitise a string for use as a SQLite column name.
 */
function sanitiseColumnName(name) {
  if (!name || typeof name !== 'string') return 'col_unknown';
  let clean = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')  // replace non-alphanum with _
    .replace(/_+/g, '_')           // collapse multiple _
    .replace(/^_|_$/g, '');        // strip leading/trailing _
  if (!clean) clean = 'col_unknown';
  if (/^\d/.test(clean)) clean = 'col_' + clean; // can't start with digit
  return clean;
}

/* ═══════════════════════════════════════════════
   KB Mode — convert rows to natural-language chunks
   ═══════════════════════════════════════════════ */

/**
 * Convert a single row to a natural-language sentence.
 * e.g. "Employee Rahul Sharma, Department: Engineering, Salary: ₹12,00,000"
 */
function rowToSentence(headers, rowValues) {
  const parts = [];
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i];
    const value = rowValues[i];
    if (!header || !value || value.trim() === '') continue;
    parts.push(`${header}: ${value}`);
  }
  return parts.join(', ');
}

/**
 * Process an Excel file into KB-ready text chunks.
 * @param {string} filePath — path to .xlsx / .xls file
 * @returns {{ chunks: { text: string, source: string }[], totalRows: number, sheets: string[] }}
 */
function excelToKBChunks(filePath, sourceName) {
  const workbook = XLSX.readFile(filePath, { cellDates: true, cellNF: true, cellStyles: false });
  const allChunks = [];
  let totalRows = 0;
  const sheets = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet['!ref']) continue; // empty sheet

    sheets.push(sheetName);
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const headerRowIdx = detectHeaderRow(sheet);

    // Extract headers
    const headers = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: headerRowIdx, c });
      const cell = sheet[addr];
      headers.push(cell ? String(cell.v).trim() : `Column ${c + 1}`);
    }

    // Extract data rows
    const sentences = [];
    for (let r = headerRowIdx + 1; r <= range.e.r; r++) {
      const rowValues = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        rowValues.push(formatCellValue(sheet[addr]));
      }

      if (isJunkRow(rowValues, headers.length)) continue;

      const sentence = rowToSentence(headers, rowValues);
      if (sentence) {
        sentences.push(sentence);
        totalRows++;
      }
    }

    // Group sentences into chunks (ROWS_PER_CHUNK rows each)
    const source = sourceName
      ? `${sourceName} [Sheet: ${sheetName}]`
      : `${path.basename(filePath)} [Sheet: ${sheetName}]`;

    const headerLine = `Data from ${source}. Columns: ${headers.filter(Boolean).join(', ')}.\n`;

    for (let i = 0; i < sentences.length; i += ROWS_PER_CHUNK) {
      const batch = sentences.slice(i, i + ROWS_PER_CHUNK);
      const text = headerLine + batch.map((s, idx) => `Row ${i + idx + 1}: ${s}`).join('\n');
      allChunks.push({ text, source });
    }
  }

  return { chunks: allChunks, totalRows, sheets };
}

/* ═══════════════════════════════════════════════
   DB Mode — import rows into SQLite
   ═══════════════════════════════════════════════ */

/**
 * Import an Excel file into a SQLite database.
 * Creates one table per sheet. Returns metadata about what was created.
 *
 * @param {string}  filePath — path to .xlsx / .xls
 * @param {object}  db       — better-sqlite3 database instance
 * @param {string}  [tablePrefix] — prefix for table names (default: filename)
 * @returns {{ tables: { name: string, rows: number, columns: string[] }[], totalRows: number }}
 */
function excelToSQLite(filePath, db, tablePrefix) {
  const workbook = XLSX.readFile(filePath, { cellDates: true, cellNF: true, cellStyles: false });
  // Always derive a clean prefix from the filename (ignore path / relative name)
  const prefix = path.basename(filePath, path.extname(filePath))
    .toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');

  const tablesCreated = [];
  let totalRows = 0;

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet['!ref']) continue;

    const range = XLSX.utils.decode_range(sheet['!ref']);
    const headerRowIdx = detectHeaderRow(sheet);

    // Extract and sanitise headers
    const rawHeaders = [];
    const sqlColumns = [];
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r: headerRowIdx, c });
      const cell = sheet[addr];
      const raw = cell ? String(cell.v).trim() : `Column_${c + 1}`;
      rawHeaders.push(raw);
      let colName = sanitiseColumnName(raw);
      // Deduplicate column names
      let suffix = 2;
      const baseName = colName;
      while (sqlColumns.includes(colName)) {
        colName = `${baseName}_${suffix++}`;
      }
      sqlColumns.push(colName);
    }

    // Build table name — always include sheet name for clarity
    const sheetClean = sanitiseColumnName(sheetName) || 'sheet';
    const tableName = `${prefix}_${sheetClean}`;

    // ── Infer column types from sample data ──
    const colTypes = inferColumnTypes(sheet, headerRowIdx, range, sqlColumns);

    // Drop if exists, then create with proper types
    db.exec(`DROP TABLE IF EXISTS "${tableName}"`);
    const colDefs = sqlColumns.map((col, i) => `"${col}" ${colTypes[i]}`).join(', ');
    db.exec(`CREATE TABLE "${tableName}" (id INTEGER PRIMARY KEY AUTOINCREMENT, ${colDefs})`);

    // Log type summary
    const typeCounts = { INTEGER: 0, REAL: 0, TEXT: 0 };
    colTypes.forEach(t => typeCounts[t]++);
    console.log(`   🔢  Column types: ${typeCounts.INTEGER} INTEGER, ${typeCounts.REAL} REAL, ${typeCounts.TEXT} TEXT`);

    // Bulk insert rows
    const placeholders = sqlColumns.map(() => '?').join(', ');
    const insertStmt = db.prepare(`INSERT INTO "${tableName}" (${sqlColumns.map(c => `"${c}"`).join(', ')}) VALUES (${placeholders})`);

    const insertMany = db.transaction((rows) => {
      for (const row of rows) {
        insertStmt.run(...row);
      }
    });

    const rows = [];
    // Find the date column index so we can derive week/day/month
    const dateColIdx = sqlColumns.findIndex(c => c === 'date');

    for (let r = headerRowIdx + 1; r <= range.e.r; r++) {
      const rowValues = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        rowValues.push(formatCellValueForDB(sheet[addr]));
      }

      if (isJunkRow(rowValues, sqlColumns.length)) continue;

      // Derive formula-based columns (week, day, month) from the date column
      if (dateColIdx !== -1) {
        const dateAddr = XLSX.utils.encode_cell({ r, c: range.s.c + dateColIdx });
        const dateCell = sheet[dateAddr];
        const dateVal = dateCell ? (dateCell.v || dateCell.w) : null;
        const dateObj = parseDateValue(dateVal);
        fillDerivedColumns(rowValues, sqlColumns, dateObj);
      }

      // Coerce string values into native JS types for typed binding
      const typedRow = rowValues.map((v, i) => coerceValue(v, colTypes[i]));
      rows.push(typedRow);
    }

    insertMany(rows);
    totalRows += rows.length;

    tablesCreated.push({
      name: tableName,
      rows: rows.length,
      columns: sqlColumns,
      originalHeaders: rawHeaders,
    });

    console.log(`   📊  Excel → SQLite: "${tableName}" (${rows.length} rows, ${sqlColumns.length} cols)`);
  }

  return { tables: tablesCreated, totalRows };
}

/* ═══════════════════════════════════════════════
   Auto-detect: KB vs DB based on row count
   ═══════════════════════════════════════════════ */

/**
 * Process an Excel file — ALWAYS imports into SQLite (one table per sheet).
 *
 * @param {string} filePath
 * @param {object} db          — better-sqlite3 instance (required)
 * @param {string} [sourceName] — display name
 * @returns {{ mode: 'db', tables: object[], totalRows: number, sheets: string[] }}
 */
function processExcelFile(filePath, db, sourceName) {
  if (!db) {
    throw new Error('SQLite database instance is required for Excel import');
  }

  // Quick summary for logging
  const workbook = XLSX.readFile(filePath, { cellDates: false, cellNF: false, cellStyles: false });
  let quickRowCount = 0;
  const sheets = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet['!ref']) continue;
    sheets.push(sheetName);
    const range = XLSX.utils.decode_range(sheet['!ref']);
    quickRowCount += (range.e.r - range.s.r);
  }

  console.log(`   📋  Excel "${path.basename(filePath)}": ~${quickRowCount} rows across ${sheets.length} sheet(s)`);
  console.log(`   📊  Importing to SQLite (DB mode) — one table per sheet`);

  const result = excelToSQLite(filePath, db, sourceName);
  return { mode: 'db', tables: result.tables, totalRows: result.totalRows, sheets };
}

module.exports = {
  excelToKBChunks,
  excelToSQLite,
  processExcelFile,
  formatCellValue,
  formatCellValueForDB,
  sanitiseColumnName,
  detectHeaderRow,
  ROW_THRESHOLD,
};
