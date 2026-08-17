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
export function detectShape(samples) {
  const texts = [];
  for (const { buffer } of samples) {
    if (looksBinary(new Uint8Array(buffer))) return { kind: 'binary' };
    texts.push(decode(buffer));
  }
  if (!texts.length) return { kind: 'empty' };

  const majority = Math.max(1, Math.ceil(texts.length * 0.6));
  const count = (fn) => texts.filter((t) => { try { return !!fn(t); } catch { return false; } }).length;

  if (count((t) => t.trimStart().startsWith('<?xml') || t.trimStart().startsWith('<')) >= majority
      && count(parseXmlRecord) >= majority) {
    return { kind: 'xml' };
  }
  if (count(parseJsonRecord) >= majority) return { kind: 'json' };
  if (count((t) => { const r = parseKeyValue(t); return r && r.order.length >= 2; }) >= majority) {
    return { kind: 'keyvalue' };
  }

  // A single delimited line per file, if the field count is stable across the
  // sample. An unstable count means the delimiter is really punctuation.
  for (const delimiter of DELIMITERS) {
    const counts = texts
      .map((t) => (t.split(/\r?\n/).find((l) => l.trim()) || '').split(delimiter).length)
      .filter((n) => n > 1);
    if (counts.length >= majority && new Set(counts).size === 1) {
      return { kind: 'delimited', delimiter };
    }
  }

  return { kind: 'unknown' };
}

// ===========================================================================
// Profiling a binary folder
//
// One file tells you very little. Three thousand files of the same record type
// tell you a great deal: what every file starts with, whether the size is
// fixed, and which byte positions hold data rather than structure.
// ===========================================================================

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

  const hex = (a, n = 160) => {
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
  };

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
    lines.push(`SAMPLE ${i + 1} — ${s.name}`, hex(arrays[i]), '');
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
    const profile = shape.kind === 'binary' ? profileBinary(samples, capped.length) : null;
    return {
      kind: shape.kind,
      headers: [],
      rows: [],
      profile,
      stats: { total: capped.length, truncated, sampled: samples.length },
    };
  }

  // ---- Read the rest, in bounded batches ----
  const parseOne = (text) => {
    if (shape.kind === 'keyvalue') return parseKeyValue(text);
    if (shape.kind === 'xml') return parseXmlRecord(text);
    if (shape.kind === 'json') return parseJsonRecord(text);
    return parseSingleLine(text, shape.delimiter);
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
      if (!parsed) { unreadable += 1; return; }
      if (parsed.repeated) repeatedKeys += 1;
      parsed.record.__file = batch[j].name;
      for (const key of parsed.order) {
        if (!seenKeys.has(key)) { seenKeys.add(key); keyOrder.push(key); }
      }
      records.push(parsed.record);
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
