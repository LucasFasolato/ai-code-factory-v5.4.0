import fs from 'node:fs';
import path from 'node:path';
import { aiPath, requestPaths } from '../core/paths.js';
import { readJsonSafe, writeJson, ensureDir, readText } from '../core/fs.js';
import { nowIso } from '../core/format.js';

// v5.0 Playbooks — the most expensive token is the one spent rediscovering a
// plan that already worked. After a REQ closes successfully, its plan (files
// touched, workflow, validation commands) is distilled into a playbook. New
// asks are matched against playbooks with zero-cost keyword scoring; a strong
// match means the brain gets a proven plan in context instead of exploring
// from scratch.

const STOPWORDS = new Set(['para', 'con', 'una', 'los', 'las', 'del', 'que', 'the', 'and', 'for', 'with', 'una', 'este', 'esta', 'add', 'agrega', 'agregar', 'crear', 'create', 'hacer', 'make', 'nueva', 'nuevo', 'new']);

export function playbooksDir(root) {
  return aiPath(root, 'playbooks');
}

export function listPlaybooks(root) {
  const dir = playbooksDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJsonSafe(path.join(dir, f), null))
    .filter(Boolean);
}

export function recordPlaybook(root, requestId, options = {}) {
  const paths = requestPaths(root, requestId);
  const intake = readJsonSafe(paths.intake, null);
  if (!intake) throw new Error(`Missing intake for ${requestId}; cannot record a playbook.`);
  const execution = readJsonSafe(paths.executionStatus, {}) || {};
  const validation = readJsonSafe(paths.validation, {}) || {};
  const gates = readJsonSafe(paths.gates, {}) || {};
  if (options.requireClosed !== false && gates.close_allowed !== true) {
    throw new Error(`${requestId} is not close_allowed yet. Playbooks are distilled only from proven successes (use --force to override).`);
  }
  const id = slug(intake.interpreted_intent || intake.raw_user_ask || requestId);
  const playbook = {
    id,
    source_request: requestId,
    created_at: nowIso(),
    ask_summary: (intake.interpreted_intent || intake.raw_user_ask || '').slice(0, 300),
    keywords: extractKeywords(`${intake.raw_user_ask || ''} ${intake.interpreted_intent || ''}`),
    work_type: intake.work_type,
    project_type: intake.project_type,
    workflow: intake.recommended_workflow,
    risk: intake.risk,
    files_touched: execution.files_changed || execution.files_touched || [],
    validation_commands: Object.keys(validation.results || validation.commands || {}),
    lessons: readText(paths.learning, '').slice(0, 1500),
    uses: 0
  };
  ensureDir(playbooksDir(root));
  writeJson(path.join(playbooksDir(root), `${id}.json`), playbook);
  return playbook;
}

export function matchPlaybook(root, ask, options = {}) {
  const playbooks = listPlaybooks(root);
  if (!playbooks.length) return { matched: false, candidates: [] };
  const askKeywords = extractKeywords(ask);
  const scored = playbooks.map((pb) => {
    const overlap = (pb.keywords || []).filter((k) => askKeywords.some((a) => stemMatch(a, k)));
    const score = overlap.length / Math.max(3, Math.min((pb.keywords || []).length, askKeywords.length));
    return { playbook: pb, score: Number(score.toFixed(3)), overlap };
  }).sort((a, b) => b.score - a.score);
  const threshold = options.threshold ?? 0.45;
  const best = scored[0];
  const matched = best && best.score >= threshold;
  if (matched && options.recordUse !== false) bumpUses(root, best.playbook.id);
  return {
    matched,
    best: matched ? best : null,
    candidates: scored.slice(0, 3).map((s) => ({ id: s.playbook.id, score: s.score, work_type: s.playbook.work_type }))
  };
}

// Compact context block for the brain prompt: a proven plan costs a few
// hundred tokens and can save thousands of exploration tokens.
export function playbookContextBlock(root, ask) {
  const match = matchPlaybook(root, ask);
  if (!match.matched) return '';
  const pb = match.best.playbook;
  return [
    `## Proven playbook match (score ${match.best.score})`,
    `A very similar request was implemented successfully before (${pb.source_request}).`,
    `Work type: ${pb.work_type} | workflow: ${pb.workflow} | risk: ${pb.risk}`,
    pb.files_touched.length ? `Files touched last time: ${pb.files_touched.slice(0, 15).join(', ')}` : '',
    pb.validation_commands.length ? `Validation that proved it: ${pb.validation_commands.join(', ')}` : '',
    pb.lessons ? `Lessons learned:\n${pb.lessons}` : '',
    'Prefer this proven plan over exploring from scratch unless the new ask clearly differs.'
  ].filter(Boolean).join('\n');
}

function bumpUses(root, id) {
  const file = path.join(playbooksDir(root), `${id}.json`);
  const pb = readJsonSafe(file, null);
  if (!pb) return;
  pb.uses = Number(pb.uses || 0) + 1;
  pb.last_used_at = nowIso();
  writeJson(file, pb);
}

function extractKeywords(text) {
  return [...new Set(deaccent(String(text || '').toLowerCase())
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w)))].slice(0, 25);
}

// Spanish/English morphology-tolerant match: "cancelar" ↔ "cancelacion",
// "reserva" ↔ "reservas". Prefix match with a 5-char stem beats exact-match
// keywords without dragging in an NLP dependency.
function stemMatch(a, b) {
  if (a === b) return true;
  const stem = Math.min(Math.max(a.length, b.length) - 2, 5);
  if (stem < 4) return false;
  return a.slice(0, stem) === b.slice(0, stem);
}

function deaccent(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function slug(text) {
  return deaccent(String(text || 'playbook').toLowerCase()).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'playbook';
}
