import fs from 'node:fs';
import path from 'node:path';
import { aiPath } from '../core/paths.js';
import { readJson, readText, writeText } from '../core/fs.js';
import { nowIso } from '../core/format.js';
import { evolutionSummary } from './history-engine.js';

// compile-memory: takes history/memory/evidence/reviews and produces
// consolidated knowledge in .ai/knowledge/compiled-knowledge.md
export function compileMemory(root) {
  const evolution = evolutionSummary(root);
  const knownFailures = readJson(aiPath(root, 'memory', 'mistakes', 'known-failures.json'), []) || [];
  const learnings = readDirTexts(aiPath(root, 'memory', 'learnings'));
  const feedback = readJson(aiPath(root, 'feedback', 'feedback-log.json'), []) || [];
  const preferences = readJson(aiPath(root, 'knowledge', 'user-preferences.json'), {}) || {};
  const failureCounts = countFailureClasses(root);

  const md = `# Compiled Knowledge\n\nGenerated at: ${nowIso()}\n\n` +
    `## Usage so far\n\n- Events: ${evolution.total_events}\n- Requests: ${evolution.total_requests} (${evolution.closed_requests} closed)\n- Executions: ${evolution.total_executions} (success rate: ${evolution.execution_success_rate ?? 'n/a'}%)\n\n` +
    `## Failure classes observed\n\n${Object.keys(failureCounts).length ? Object.entries(failureCounts).map(([c, n]) => `- ${c}: ${n}`).join('\n') : '- None recorded yet.'}\n\n` +
    `## Known failures (prevention rules)\n\n${knownFailures.map((f) => `- ${f.name}: ${f.prevention}`).join('\n') || '- None.'}\n\n` +
    `## Learned user rules\n\n${(preferences.learned_rules || []).map((r) => `- ${typeof r === 'string' ? r : r.rule}`).join('\n') || '- None yet. Use feedback + mine-feedback to add rules.'}\n\n` +
    `## Recent human feedback\n\n${feedback.slice(-10).map((f) => `- ${f.at}: ${f.text}`).join('\n') || '- None recorded.'}\n\n` +
    `## Per-REQ learnings (latest)\n\n${learnings.slice(-5).map((l) => `### ${l.name}\n\n${firstLines(l.content, 8)}\n`).join('\n') || 'No per-REQ learnings yet.'}\n\n` +
    `## How this file is used\n\nThis knowledge is appended to context packs as a short summary and consulted by suggest-next, calibrate-autonomy and playbook-upgrade.\n`;

  const target = aiPath(root, 'knowledge', 'compiled-knowledge.md');
  writeText(target, md);
  return { path: target, markdown: md, failure_counts: failureCounts };
}

export function countFailureClasses(root) {
  const dir = aiPath(root, 'history', 'failures');
  const counts = {};
  if (!fs.existsSync(dir)) return counts;
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith('.json'))) {
    const data = readJson(path.join(dir, name), null);
    for (const c of data?.classes || []) counts[c.class] = (counts[c.class] || 0) + 1;
  }
  return counts;
}

function readDirTexts(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith('.md'))
    .sort()
    .map((name) => ({ name, content: readText(path.join(dir, name), '') }));
}

function firstLines(text, n) {
  return text.split('\n').filter(Boolean).slice(0, n).join('\n');
}
