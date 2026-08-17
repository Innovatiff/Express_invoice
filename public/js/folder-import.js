// ---------------------------------------------------------------------------
// Folder import: thousands of files, one record each.
//
// Express Invoice does not keep one big file per list. It keeps a folder per
// list and a small .dat file per record — one file per customer, one per
// invoice — so a ten-year-old shop has thousands of them. This module turns a
// folder of those files into the same rows-and-headers shape a CSV would have
// produced, and everything downstream — column mapping, preview, customer
// matching, duplicate handling — carries on unchanged.
//
// What is inside a single .dat is not documented, and varies by version. So
// rather than assume, a sample of the folder is examined and the shape is
// worked out: key/value lines, one delimited line per file, XML, or JSON. If
// the files turn out to be a binary format, no guess is made — instead the
// folder is profiled across many files, which is far more informative than any
// single file could be, and the profile can be downloaded and sent on.
// ---------------------------------------------------------------------------

const SAMPLE_SIZE = 24;
const MAX_FILES = 20000;
const READ_CONCURRENCY = 24;

/** Files that are noise in any folder, not records. */
function isNoise(file) {
  const name = (file.name || '').toLowerCase();
  return name.startsWith('.')
    || name === 'thumbs.db'
    || name === 'desktop.ini'
    || name.endsWith('.lnk')
    || name.endsWith('.log')
    || name.endsWith('.bak')
    || file.size === 0;
}

// ===========================================================================
// Per-file parsers, one per shape the files might take
// ===========================================================================

/**
 * "Name=John Perez" or "Name: John Perez", one field per line. The most common
 * way a desktop application writes a single record to its own file.
 */
export function parseKeyValue(text) {
  const record = {};
  const order = [];
  let repeated = false;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    if (line.startsWith('[') && line.endsWith(']')) continue; // INI section header

    const eq = line.indexOf('=');
    const colon = line.indexOf(':');
    let cut = -1;
    if (eq > 0 && (colon < 0 || eq < colon)) cut = eq;
    else if (colon > 0) cut = colon;
    if (cut <= 0) continue;

    const key = line.slice(0, cut).trim();
    const value = line.slice(cut + 1).trim();
    if (!key) continue;

    if (record[key] === undefined) {
      record[key] = value;
      order.push(key);
    } else {
      // A key that appears twice is usually a repeating block — an invoice's
      // line items. Keep both halves rather than silently dropping one.
      record[key] += '\n' + value;
      repeated = true;
    }
  }

  return order.length ? { record, order, repeated } : null;
}

/** One delimited line holding the whole record, with no header row anywhere. */
export function parseSingleLine(text, delimiter) {
  const line = text.split(/\r?\n/).find((l) => l.trim());
  if (!line) return null;
  const parts = line.split(delimiter);
  if (parts.length < 2) return null;
  const record = {};
  const order = [];
  parts.forEach((value, i) => {
    const key = `Field ${i + 1}`;
    record[key] = value.trim();
    order.push(key);
  });
  return { record, order, repeated: false };
}

/**
 * Every line is its own record — the file holds a slice of a table rather than
 * a single record. Returns an array, not one record.
 */
export function parseMultiRow(text, delimiter) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return null;
  const out = [];
  for (const line of lines) {
    const parts = line.split(delimiter);
    if (parts.length < 2) return null;
    const record = {};
    const order = [];
    parts.forEach((value, i) => {
      const key = `Field ${i + 1}`;
      record[key] = value.trim();
      order.push(key);
    });
    out.push({ record, order, repeated: false });
  }
  return out;
}

/**
 * Bare values, one per line — no keys, no delimiters. An old desktop program
 * writing a record in a fixed field order needs nothing else, so the meaning of
 * each line is carried entirely by its position.
 */
export function parseLines(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l);
  if (lines.length < 2) return null;
  const record = {};
  const order = [];
  lines.forEach((value, i) => {
    const key = `Line ${i + 1}`;
    record[key] = value;
    order.push(key);
  });
  return { record, order, repeated: false };
}

/** XML, flattened to one entry per leaf element. */
export function parseXmlRecord(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) return null;
  const record = {};
  const order = [];
  const walk = (node, prefix) => {
    for (const child of node.children) {
      const name = prefix ? `${prefix}.${child.tagName}` : child.tagName;
      if (child.children.length) {
        walk(child, name);
      } else {
        const value = (child.textContent || '').trim();
        if (record[name] === undefined) { record[name] = value; order.push(name); }
        else record[name] += '\n' + value;
      }
    }
    for (const attr of node.attributes || []) {
      const name = prefix ? `${prefix}@${attr.name}` : `@${attr.name}`;
      if (record[name] === undefined) { record[name] = attr.value; order.push(name); }
    }
  };
  walk(doc.documentElement, '');
  return order.length ? { record, order, repeated: false } : null;
}

/** JSON, flattened one level. */
export function parseJsonRecord(text) {
  let value;
  try { value = JSON.parse(text); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = {};
  const order = [];
  for (const [k, v] of Object.entries(value)) {
    record[k] = v === null || v === undefined ? ''
      : typeof v === 'object' ? JSON.stringify(v) : String(v);
    order.push(k);
  }
  return order.length ? { record, order, repeated: false } : null;
}

// ===========================================================================
// Working out which shape the folder is in
// ===========================================================================

const DELIMITERS = ['\t', '|', ';', ','];

function looksBinary(bytes) {
  const sample = bytes.slice(0, 8192);
  let odd = 0;
  for (const b of sample) {
    if (b === 0) odd += 8;
    else if (b < 32 && b !== 9 && b !== 10 && b !== 13) odd += 1;
  }
  return sample.length > 0 && odd / sample.length > 0.02;
}

function decode(buffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer);
  let text = new TextDecoder('utf-8').decode(buffer);
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buffer);
  return text.replace(/^﻿/, '');
}

/**
 * Decides the shape from a sample. A shape has to work for most of the sample,
 * not just the first file — one unusual record should not set the strategy for
 * three thousand.
 */
const DELIMITER_NAMES = { '\t': 'tab', '|': 'pipe', ';': 'semicolon', ',': 'comma' };

export function detectShape(samples) {
  const texts = [];
  for (const { buffer } of samples) {
    if (looksBinary(new Uint8Array(buffer))) return { kind: 'binary', diagnostics: [] };
    texts.push(decode(buffer));
  }
  if (!texts.length) return { kind: 'empty', diagnostics: [] };

  const total = texts.length;
  const majority = Math.max(1, Math.ceil(total * 0.6));
  const count = (fn) => texts.filter((t) => { try { return !!fn(t); } catch { return false; } }).length;

  const lineCounts = texts.map((t) => t.split(/\r?\n/).filter((l) => l.trim()).length);
  const oneLine = lineCounts.filter((n) => n === 1).length;
  const stableLineCount = new Set(lineCounts).size === 1;

  const xml = count((t) => t.trimStart().startsWith('<') && parseXmlRecord(t));
  const json = count(parseJsonRecord);
  const keyvalue = count((t) => { const r = parseKeyValue(t); return r && r.order.length >= 2; });

  // For each candidate delimiter, two questions: is the first line's field count
  // the same in every file, and is every line in every file the same width?
  const firstLine = {};
  const everyLine = {};
  for (const d of DELIMITERS) {
    firstLine[d] = texts.map((t) => (t.split(/\r?\n/).find((l) => l.trim()) || '').split(d).length);
    everyLine[d] = texts.map((t) => {
      const ls = t.split(/\r?\n/).filter((l) => l.trim());
      const widths = new Set(ls.map((l) => l.split(d).length));
      return ls.length && widths.size === 1 ? [...widths][0] : 0; // 0 = ragged within the file
    });
  }
  const stable = (ns) => { const kept = ns.filter((n) => n > 1); return kept.length >= majority && new Set(kept).size === 1; };

  // Everything that was tried, whether or not it won. When nothing matches,
  // this is the most useful thing on the screen: it says which reader was close.
  const diagnostics = [
    `files examined         ${total}`,
    `lines per file         ${stableLineCount ? `always ${lineCounts[0]}` : `${Math.min(...lineCounts)}–${Math.max(...lineCounts)}`}`,
    `parses as XML          ${xml} of ${total}`,
    `parses as JSON         ${json} of ${total}`,
    `has key=value lines    ${keyvalue} of ${total}`,
    `single-line files      ${oneLine} of ${total}`,
    ...DELIMITERS.map((d) => {
      const first = firstLine[d].filter((n) => n > 1);
      const widths = [...new Set(first)].sort((a, b) => a - b);
      return `${DELIMITER_NAMES[d].padEnd(10)} fields    `
        + (widths.length ? `${widths.join(', ')}` : 'none')
        + (stable(everyLine[d]) ? '  (same on every line)' : '');
    }),
    `needed to agree        ${majority} of ${total}`,
  ];

  if (xml >= majority) return { kind: 'xml', diagnostics };
  if (json >= majority) return { kind: 'json', diagnostics };
  if (keyvalue >= majority) return { kind: 'keyvalue', diagnostics };

  // One delimited line per file. Only when the files really are one line —
  // otherwise everything after the first line would be silently dropped.
  if (oneLine >= majority) {
    for (const d of DELIMITERS) {
      if (stable(firstLine[d])) return { kind: 'delimited', delimiter: d, diagnostics };
    }
  }

  // Many delimited lines per file: each line is a record of its own.
  for (const d of DELIMITERS) {
    if (stable(everyLine[d])) return { kind: 'multirow', delimiter: d, diagnostics };
  }

  // Bare values one per line. Only trusted when every file has the same number
  // of lines — that is what makes position meaningful rather than accidental.
  if (stableLineCount && lineCounts[0] >= 2
      && DELIMITERS.every((d) => firstLine[d].every((n) => n === 1))) {
    return { kind: 'lines', diagnostics };
  }

  return { kind: 'unknown', diagnostics };
}

// ===========================================================================
// Profiling a binary folder
//
// One file tells you very little. Three thousand files of the same record type
// tell you a great deal: what every file starts with, whether the size is
// fixed, and which byte positions hold data rather than structure.
// ===========================================================================

function hexDump(a, n = 160) {
  const out = [];
  for (let i = 0; i < Math.min(a.length, n); i += 16) {
    const chunk = Array.from(a.slice(i, i + 16));
    out.push(
      String(i).padStart(4, '0') + '  '
      + chunk.map((b) => b.toString(16).padStart(2, '0')).join(' ').padEnd(47, ' ') + '  '
      + chunk.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join(''),
    );
  }
  return out.join('\n');
}

/** How many files of each extension — a folder of mixed kinds shows up here. */
function extensionTally(samples) {
  const tally = {};
  for (const s of samples) {
    const m = /\.([a-z0-9]+)$/i.exec(s.name);
    const ext = m ? `.${m[1].toLowerCase()}` : '(none)';
    tally[ext] = (tally[ext] || 0) + 1;
  }
  return Object.entries(tally).sort((a, b) => b[1] - a[1]);
}

/**
 * The folder is readable text in a layout none of the readers know. Nothing can
 * be guessed from that safely, so the profile shows the text itself: the actual
 * opening lines of real files, with tabs and line endings made visible, plus a
 * hex dump of the first sample in case a separator is a byte that does not
 * print. That is enough to write a reader from.
 */
export function profileText(samples, totalFiles, diagnostics = []) {
  const sizes = samples.map((s) => s.buffer.byteLength);
  const texts = samples.map((s) => decode(s.buffer));

  // Tabs and trailing whitespace are invisible on screen and are exactly what
  // decides how a line should be split, so they are spelled out.
  const visible = (line) => line
    .replace(/\t/g, '→')
    .replace(/ +$/, (sp) => '·'.repeat(sp.length));

  const lines = [
    'EXPRESS INVOICE FOLDER PROFILE (readable text, layout not recognised)',
    '',
    `files in folder      ${totalFiles}`,
    `files sampled        ${samples.length}`,
    `size                 ${Math.min(...sizes)}–${Math.max(...sizes)} bytes`,
    `line endings         ${texts.some((t) => t.includes('\r\n')) ? 'CRLF (Windows)' : 'LF'}`,
    `file types           ${extensionTally(samples).map(([e, n]) => `${e} × ${n}`).join(', ')}`,
    '',
    'WHAT WAS TRIED',
    ...diagnostics.map((d) => `  ${d}`),
    '',
    'FILE NAMES',
    ...samples.slice(0, 10).map((s) => `  ${s.name}  (${s.buffer.byteLength} bytes)`),
    '',
    'LEGEND   → tab    · trailing space',
    '',
  ];

  samples.slice(0, 3).forEach((s, i) => {
    const body = texts[i].split(/\r?\n/).slice(0, 40).map((l, n) =>
      `${String(n + 1).padStart(3, ' ')} | ${visible(l)}`);
    lines.push(`SAMPLE ${i + 1} — ${s.name}`, ...body,
      texts[i].split(/\r?\n/).length > 40 ? '    | …' : '', '');
  });

  lines.push('FIRST BYTES OF SAMPLE 1', hexDump(new Uint8Array(samples[0].buffer), 256));

  return { text: lines.filter((l) => l !== '').join('\n'), sampleText: texts[0] };
}

export function profileBinary(samples, totalFiles) {
  const sizes = samples.map((s) => s.buffer.byteLength);
  const arrays = samples.map((s) => new Uint8Array(s.buffer));

  // Longest run of bytes every sampled file opens with.
  let shared = 0;
  const shortest = Math.min(...arrays.map((a) => a.length), 64);
  outer: for (let i = 0; i < shortest; i++) {
    const b = arrays[0][i];
    for (const a of arrays) if (a[i] !== b) break outer;
    shared = i + 1;
  }

  const uniqueSizes = [...new Set(sizes)];
  const fixedSize = uniqueSizes.length === 1;

  // For fixed-size records, which offsets never change across files? Those are
  // structure; the rest is the data.
  let constantOffsets = [];
  if (fixedSize && arrays.length > 2) {
    for (let i = 0; i < Math.min(sizes[0], 512); i++) {
      const b = arrays[0][i];
      if (arrays.every((a) => a[i] === b)) constantOffsets.push(i);
    }
  }

  const lines = [
    'EXPRESS INVOICE FOLDER PROFILE',
    '',
    `files in folder      ${totalFiles}`,
    `files sampled        ${samples.length}`,
    `size                 ${fixedSize ? `fixed, ${sizes[0]} bytes` : `varies, ${Math.min(...sizes)}–${Math.max(...sizes)} bytes`}`,
    `distinct sizes       ${uniqueSizes.length}`,
    `shared opening bytes ${shared}`,
    fixedSize ? `unchanging offsets   ${constantOffsets.length} of first ${Math.min(sizes[0], 512)}` : '',
    '',
    'FILE NAMES',
    ...samples.slice(0, 8).map((s) => `  ${s.name}  (${s.buffer.byteLength} bytes)`),
    '',
  ];

  samples.slice(0, 3).forEach((s, i) => {
    lines.push(`SAMPLE ${i + 1} — ${s.name}`, hexDump(arrays[i]), '');
  });

  return { text: lines.filter((l) => l !== '').join('\n'), fixedSize, sharedPrefix: shared };
}

// ===========================================================================
// The main entry point
// ===========================================================================

/**
 * Turns a folder's files into { headers, rows } — the same shape parseCSV
 * produces — or reports why it could not.
 *
 * onProgress({ read, total, phase }) is called as it goes; a folder of three
 * thousand files takes a moment and silence would look like a hang.
 */
export async function readFolder(fileList, { onProgress = () => {} } = {}) {
  const all = Array.from(fileList).filter((f) => !isNoise(f));
  if (!all.length) return { kind: 'empty', headers: [], rows: [], stats: { total: 0 } };

  const capped = all.slice(0, MAX_FILES);
  const truncated = all.length - capped.length;

  // ---- Sample first, so the whole folder is not read for nothing ----
  onProgress({ read: 0, total: capped.length, phase: 'sampling' });
  const sampleFiles = capped.slice(0, SAMPLE_SIZE);
  const samples = [];
  for (const file of sampleFiles) {
    samples.push({ name: file.name, path: file.webkitRelativePath || file.name, buffer: await file.arrayBuffer() });
  }

  const shape = detectShape(samples);

  if (shape.kind === 'binary' || shape.kind === 'unknown' || shape.kind === 'empty') {
    // Both dead ends carry a profile. "Readable text in a layout I do not know"
    // is the more recoverable of the two — the text itself says what the layout
    // is — so it would be perverse to be the one case that shows no evidence.
    let profile = null;
    if (shape.kind === 'binary') profile = profileBinary(samples, capped.length);
    else if (shape.kind === 'unknown') profile = profileText(samples, capped.length, shape.diagnostics);
    return {
      kind: shape.kind,
      headers: [],
      rows: [],
      profile,
      diagnostics: shape.diagnostics,
      stats: { total: capped.length, truncated, sampled: samples.length },
    };
  }

  // ---- Read the rest, in bounded batches ----
  // Every parser returns an array, since one file does not always hold exactly
  // one record — a file can be a slice of a table.
  const parseOne = (text) => {
    let out;
    if (shape.kind === 'keyvalue') out = parseKeyValue(text);
    else if (shape.kind === 'xml') out = parseXmlRecord(text);
    else if (shape.kind === 'json') out = parseJsonRecord(text);
    else if (shape.kind === 'lines') out = parseLines(text);
    else if (shape.kind === 'multirow') out = parseMultiRow(text, shape.delimiter);
    else out = parseSingleLine(text, shape.delimiter);
    if (!out) return null;
    return Array.isArray(out) ? out : [out];
  };

  const records = [];
  const keyOrder = [];
  const seenKeys = new Set();
  let unreadable = 0;
  let repeatedKeys = 0;

  for (let i = 0; i < capped.length; i += READ_CONCURRENCY) {
    const batch = capped.slice(i, i + READ_CONCURRENCY);
    const buffers = await Promise.all(batch.map((f) => f.arrayBuffer().catch(() => null)));

    buffers.forEach((buffer, j) => {
      if (!buffer) { unreadable += 1; return; }
      let parsed = null;
      try { parsed = parseOne(decode(buffer)); } catch { parsed = null; }
      if (!parsed || !parsed.length) { unreadable += 1; return; }
      for (const one of parsed) {
        if (one.repeated) repeatedKeys += 1;
        one.record.__file = batch[j].name;
        for (const key of one.order) {
          if (!seenKeys.has(key)) { seenKeys.add(key); keyOrder.push(key); }
        }
        records.push(one.record);
      }
    });

    onProgress({ read: Math.min(i + READ_CONCURRENCY, capped.length), total: capped.length, phase: 'reading' });
    // Let the browser paint between batches.
    await new Promise((r) => setTimeout(r, 0));
  }

  // The file name is often the record's own number, so it is offered as a
  // mappable column rather than thrown away.
  const headers = [...keyOrder, 'File name'];
  const rows = records.map((record) => headers.map((key) => (
    key === 'File name' ? (record.__file || '') : (record[key] ?? '')
  )));

  return {
    kind: shape.kind,
    delimiter: shape.delimiter,
    headers,
    rows,
    stats: {
      total: capped.length,
      parsed: records.length,
      unreadable,
      repeatedKeys,
      truncated,
      fields: keyOrder.length,
    },
  };
}

export { MAX_FILES };
