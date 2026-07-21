import fs from 'node:fs';
import path from 'node:path';

export function exists(p) {
  return fs.existsSync(p);
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function readText(file, fallback = '') {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export function writeText(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content, 'utf8');
}

export function appendText(file, content) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, content, 'utf8');
}

export function readJson(file, fallback = null) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    if (error instanceof SyntaxError) {
      error.message = `Invalid JSON in ${file}: ${error.message}`;
    }
    throw error;
  }
}

export function readJsonSafe(file, fallback = null) {
  try {
    return readJson(file, fallback);
  } catch {
    return fallback;
  }
}

export function writeJson(file, value) {
  ensureDir(path.dirname(file));
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmp, file);
}

export function appendNdjson(file, value) {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, `${JSON.stringify(value)}\n`, 'utf8');
}

export function readNdjson(file) {
  const raw = readText(file, '');
  if (!raw.trim()) return [];
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* skip corrupt line, keep log resilient */ }
  }
  return out;
}

export function copyFileSafe(from, to) {
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
}

export function listFilesRecursive(startDir, options = {}) {
  const files = [];
  const ignoreDirs = new Set(options.ignoreDirs || []);
  const extensions = options.extensions ? new Set(options.extensions) : null;
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (ignoreDirs.has(entry.name)) continue;
        walk(abs);
      } else if (entry.isFile()) {
        if (!extensions || extensions.has(path.extname(entry.name))) files.push(abs);
      }
    }
  }
  walk(startDir);
  return files;
}

export function safeRel(root, file) {
  return path.relative(root, file).split(path.sep).join('/');
}

export function sanitizeFilePart(input) {
  return String(input || '')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
}

export function tryStat(file) {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
}
