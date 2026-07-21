import fs from 'node:fs';
import { aiPath } from '../core/paths.js';
import { ensureDir, readText } from '../core/fs.js';
import { nowIso } from '../core/format.js';

// v5.2 Progress File — the key insight from Anthropic's long-running-agent
// research: an agent starting with a fresh context must be able to understand
// the state of work in seconds. Every cycle stage appends here; the executor
// contract embeds it, so a Codex run that resumes after a timeout knows what
// is already done instead of starting from zero (or worse, redoing it).

export function progressFile(root, requestId) {
  return aiPath(root, 'progress', `${requestId}.md`);
}

export function appendProgress(root, requestId, stage, detail = {}) {
  try {
    ensureDir(aiPath(root, 'progress'));
    const file = progressFile(root, requestId);
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, `# Progress — ${requestId}\n\nThis file is the source of truth for what is ALREADY DONE in this requirement.\nAgents resuming work MUST read it first and MUST NOT redo completed stages.\n\n`, 'utf8');
    }
    const summary = summarizeDetail(detail);
    fs.appendFileSync(file, `- [${nowIso()}] **${stage}**${summary ? ` — ${summary}` : ''}\n`, 'utf8');
  } catch { /* progress must never break the cycle */ }
}

export function readProgress(root, requestId, maxChars = 3000) {
  const text = readText(progressFile(root, requestId), '');
  if (!text) return '';
  if (text.length <= maxChars) return text;
  // Keep header + most recent entries (the tail is what a resuming agent needs).
  const head = text.slice(0, 400);
  const tail = text.slice(-(maxChars - 450));
  return `${head}\n[...older entries truncated...]\n${tail}`;
}

function summarizeDetail(detail) {
  if (!detail || typeof detail !== 'object') return String(detail || '');
  const parts = [];
  if (detail.status) parts.push(`status: ${detail.status}`);
  if (detail.branch) parts.push(`branch: ${detail.branch}`);
  if (Array.isArray(detail.files) && detail.files.length) parts.push(`files: ${detail.files.slice(0, 8).join(', ')}`);
  if (Array.isArray(detail.blockers) && detail.blockers.length) parts.push(`blockers: ${detail.blockers.join('; ')}`);
  if (detail.close_allowed !== undefined) parts.push(`close_allowed: ${detail.close_allowed}`);
  if (detail.reason) parts.push(String(detail.reason).slice(0, 160));
  if (!parts.length) {
    try { return JSON.stringify(detail).slice(0, 160); } catch { return ''; }
  }
  return parts.join(' | ');
}
