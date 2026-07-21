import fs from 'node:fs';
import path from 'node:path';
import { aiPath, requestPaths } from '../core/paths.js';
import { exists, readJson, readText, writeText } from '../core/fs.js';
import { nowIso } from '../core/format.js';

// distill-skill REQ-001: converts a successful solution into a reusable skill
// inside .ai/skills/. Requires the REQ to have meaningful evidence.
export function distillSkill(root, requestId) {
  const paths = requestPaths(root, requestId);
  const intake = readJson(paths.intake, null);
  if (!intake) throw new Error(`Missing intake for ${requestId}`);
  const gates = readJson(paths.gates, null);
  const execution = readJson(paths.executionStatus, null);
  const spec = readText(paths.spec, '');

  const md = `# Skill — ${requestId}: ${intake.work_type}\n\nDistilled at: ${nowIso()}\n\n` +
    `## When to use\n\nRequests similar to: "${intake.raw_user_ask.slice(0, 140)}"\n- Work type: ${intake.work_type}\n- Workflow: ${intake.recommended_workflow}\n\n` +
    `## Proven flow\n\n${provenFlow(intake, gates)}\n\n` +
    `## Key constraints honored\n\n${(intake.must_not_do || []).map((m) => `- ${m}`).join('\n')}\n\n` +
    `## Acceptance bar\n\n${extractCriteria(spec)}\n\n` +
    `## Execution notes\n\n${execution ? `- Executor: ${execution.executor} (${execution.status})\n- Files touched: ${(execution.files_touched || []).slice(0, 15).map((f) => `\n  - ${f}`).join('') || ' none recorded'}` : '- No execution recorded.'}\n\n` +
    `## Outcome\n\n- Close allowed: ${gates?.close_allowed ? 'yes' : 'no'}\n${gates?.close_allowed ? '- This flow led to a clean close and can be reused as-is.' : '- Skill distilled from a partially complete REQ; reuse the flow but expect the listed blockers.'}\n`;
  writeText(paths.skill, md);
  return { request_id: requestId, path: paths.skill, markdown: md };
}

function provenFlow(intake, gates) {
  const steps = intake.recommended_workflow === 'design-first'
    ? ['intake', 'design brief', 'design generate/import', 'design approve (explicit option, never fallback)', 'execution contract', 'execute', 'technical validation', 'fake data scan', 'visual review + acceptance', 'evidence', 'close']
    : ['intake', 'questions if blocking', 'improved spec', 'execution contract', 'execute', 'technical validation', 'evidence', 'close'];
  return steps.map((s, i) => `${i + 1}. ${s}`).join('\n');
}

function extractCriteria(spec) {
  const lines = spec.split('\n');
  const start = lines.findIndex((l) => /## Acceptance Criteria/.test(l));
  if (start < 0) return '- See improved spec.';
  return lines.slice(start + 1).filter((l) => l.startsWith('- ')).slice(0, 10).join('\n') || '- See improved spec.';
}

export function listSkills(root) {
  const dir = aiPath(root, 'skills');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort();
}

// Pattern Library: extracts reusable patterns from successful REQs grouped by
// work type. Patterns live in .ai/patterns/<work_type>.md
export function buildPatterns(root) {
  const backlogDir = aiPath(root, 'backlog');
  if (!fs.existsSync(backlogDir)) return { patterns: [] };
  const byType = {};
  for (const name of fs.readdirSync(backlogDir).filter((n) => n.endsWith('.json'))) {
    const req = readJson(path.join(backlogDir, name), null);
    if (!req) continue;
    const paths = requestPaths(root, req.id);
    const gates = exists(paths.gates) ? readJson(paths.gates, null) : null;
    const entry = {
      id: req.id,
      title: req.title,
      workflow: req.workflow,
      closed_clean: req.status === 'done' && Boolean(gates?.close_allowed)
    };
    (byType[req.work_type || 'general'] = byType[req.work_type || 'general'] || []).push(entry);
  }
  const written = [];
  for (const [workType, entries] of Object.entries(byType)) {
    const good = entries.filter((e) => e.closed_clean);
    const md = `# Patterns — ${workType}\n\nUpdated at: ${nowIso()}\n\n` +
      `## Successful flows\n\n${good.map((e) => `- ${e.id}: ${e.title} (workflow: ${e.workflow})`).join('\n') || '- None closed cleanly yet.'}\n\n` +
      `## Observed requests of this type\n\n${entries.map((e) => `- ${e.id}: ${e.title}`).join('\n')}\n\n` +
      `## Guidance\n\n${guidanceFor(workType)}\n`;
    const file = aiPath(root, 'patterns', `${workType}.md`);
    writeText(file, md);
    written.push(file);
  }
  return { patterns: written };
}

function guidanceFor(workType) {
  const map = {
    frontend_visual: '- Always design-first for visual work.\n- Capture visual evidence before requesting close.\n- Use explicit placeholders; never invent business data.',
    backend_api: '- Define the contract before implementation.\n- Cover error cases with tests proportional to risk.',
    fullstack_feature: '- Split into frontend/backend/contract slices.\n- Smoke-test the main flow end to end.',
    bugfix: '- Reproduce first; keep the fix minimal; add a regression test.',
    refactor: '- State preserved behavior explicitly; refactor incrementally.'
  };
  return map[workType] || '- Keep scope small and evidence-driven.';
}
