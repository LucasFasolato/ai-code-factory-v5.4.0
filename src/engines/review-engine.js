import { spawnSyncPortable } from '../core/spawn-portable.js';
import { requestPaths } from '../core/paths.js';
import { exists, readJson } from '../core/fs.js';
import { loadRequest } from '../core/state.js';
import { detectBaseBranch, currentBranch } from './git-workflow.js';
import { reqUsageSummary } from './usage-budget.js';
import { readDeterministicGates } from './deterministic-gates.js';

// v5.3 Review — everything a human needs to decide "merge or not" in ONE view.
// Approving from scattered artifacts is how bad merges happen; this assembles
// intent, real diff, gates, acceptance, cost and risk into a decision packet.
// Read-only, zero tokens.

export function buildReviewPacket(root, requestId, config = {}) {
  const req = loadRequest(root, requestId) || {};
  const paths = requestPaths(root, requestId);
  const intake = readJson(paths.intake, {}) || {};
  const execution = readJson(paths.executionStatus, null);
  const validation = readJson(paths.validation, null);
  const acceptance = readJson(paths.acceptance, null);
  const gates = exists(paths.gates) ? readJson(paths.gates, null) : null;
  const det = readDeterministicGates(root, requestId);
  const usage = reqUsageSummary(root, requestId);
  const diff = gitDiffStat(root);

  return {
    request_id: requestId,
    title: req.title || intake.interpreted_intent || requestId,
    intent: intake.interpreted_intent || '',
    work_type: intake.work_type,
    risk: intake.risk,
    workflow: intake.recommended_workflow,
    branch: safeBranch(root),
    base: safeBase(root),
    diff_stat: diff,
    files_touched: execution?.files_touched || [],
    execution_status: execution?.status || 'not_run',
    validation_status: validation?.status || 'not_run',
    acceptance: acceptance ? { close_allowed: acceptance.close_allowed, summary: acceptance.summary || null } : null,
    deterministic: det ? { passed: det.passed, failed: det.failed_count, warnings: det.warning_count } : null,
    gate_blockers: gates?.close_blockers || [],
    close_allowed: gates?.close_allowed ?? null,
    cost: { calls: usage.calls, input_tokens: usage.input_tokens, output_tokens: usage.output_tokens, estimated_cost_usd: usage.estimated_cost_usd }
  };
}

export function renderReviewPacket(p) {
  const lines = [
    `# Review — ${p.request_id}`,
    '',
    `**${p.title}**`,
    p.intent && p.intent !== p.title ? `Intent: ${p.intent}` : null,
    `Type: ${p.work_type || '?'} · Risk: ${(p.risk || '?').toUpperCase()} · Workflow: ${p.workflow || '?'}`,
    `Branch: ${p.branch || '?'} → ${p.base || '?'}`,
    '',
    '## The change',
    p.diff_stat || (p.close_allowed === true ? '(already merged — see `git log` on the base branch)' : '(no diff yet — nothing implemented or not a git repo)'),
    p.files_touched.length ? `Executor touched: ${p.files_touched.join(', ')}` : null,
    '',
    '## Quality signals',
    `- Execution: ${mark(p.execution_status === 'success')} ${p.execution_status}`,
    `- Technical validation: ${mark(p.validation_status === 'passed')} ${p.validation_status}`,
    p.acceptance ? `- Acceptance: ${mark(p.acceptance.close_allowed)} ${p.acceptance.close_allowed ? 'criteria met' : 'pending items'}` : '- Acceptance: not evaluated',
    p.deterministic ? `- Deterministic gates: ${mark(p.deterministic.passed)} ${p.deterministic.failed} error(s), ${p.deterministic.warnings} warning(s)` : '- Deterministic gates: not run (npm run ai -- det-gates)',
    '',
    '## Close',
    p.close_allowed === true ? '✅ All gates green — safe to merge.' : (p.gate_blockers.length ? `🚧 Blocked by:\n${p.gate_blockers.map((b) => `   ✕ ${b}`).join('\n')}` : 'Gates not evaluated yet (npm run ai -- gate-check).'),
    '',
    `## Cost`,
    `${p.cost.calls} brain call(s) · ${p.cost.input_tokens} in / ${p.cost.output_tokens} out · $${Number(p.cost.estimated_cost_usd || 0).toFixed(4)}`,
    '',
    `To merge: npm run ai -- continue${p.risk === 'high' ? ' --approved' : ''}`
  ];
  return lines.filter((l) => l !== null).join('\n');
}

function gitDiffStat(root) {
  try {
    const base = detectBaseBranch(root);
    const result = spawnSyncPortable('git', ['diff', '--stat', `${base}...HEAD`], { cwd: root, encoding: 'utf8', timeout: 15000 });
    return String(result.stdout || '').trim();
  } catch { return ''; }
}

function safeBranch(root) {
  try { return currentBranch(root); } catch { return null; }
}

function safeBase(root) {
  try { return detectBaseBranch(root); } catch { return null; }
}

function mark(ok) {
  return ok ? '✅' : '✕';
}
