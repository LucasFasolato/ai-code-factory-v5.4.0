import { exists, readJson, writeJson, writeText } from '../core/fs.js';
import { aiPath, requestPaths } from '../core/paths.js';
import { nowIso } from '../core/format.js';
import { appendEvent } from '../core/events.js';
import { runExecutor, runTechnicalValidation } from './executor-orchestrator.js';
import { evaluateAcceptance } from './acceptance-evaluator.js';
import { evaluateGates } from './gate-engine.js';
import { runSelfReview } from './self-review-engine.js';

const HUMAN_ONLY_BLOCKERS = /database|auth|payment|security|deploy|approved_design|visual_evidence|destructive|migration/i;

export function autoIterate(root, requestId, config = {}) {
  const maxRounds = config.autonomy?.max_auto_iterations ?? config.auto_iteration?.max_rounds ?? 3;
  const history = [];
  for (let round = 1; round <= maxRounds; round++) {
    const gates = exists(requestPaths(root, requestId).gates)
      ? readJson(requestPaths(root, requestId).gates, null)
      : evaluateGates(root, requestId, config);
    if (gates?.close_allowed) {
      history.push({ round, action: 'stop', reason: 'Close already allowed.', at: nowIso() });
      break;
    }
    const safe = safeToAutoFix(gates);
    if (!safe.can_fix) {
      history.push({ round, action: 'stop', reason: safe.reason, at: nowIso() });
      appendEvent(root, 'AUTO_ITERATION_ROUND', { request_id: requestId, round, action: 'stop', reason: safe.reason });
      break;
    }
    writeText(aiPath(root, 'execution', 'contracts', `${requestId}-auto-iteration-${round}.md`), buildAutoIterationPrompt(requestId, gates, round));
    const exec = runExecutor(root, requestId, config, { dryRun: !config.autonomy?.allow_auto_fix });
    const validation = runTechnicalValidation(root, requestId, config);
    const acceptance = evaluateAcceptance(root, requestId);
    runSelfReview(root, requestId);
    const updatedGates = evaluateGates(root, requestId, config);
    const entry = {
      round,
      action: 'auto-iteration',
      exec_status: exec.status,
      validation: validation.status,
      acceptance: acceptance.summary,
      close_allowed: updatedGates.close_allowed,
      at: nowIso()
    };
    history.push(entry);
    appendEvent(root, 'AUTO_ITERATION_ROUND', { request_id: requestId, ...entry });
    if (updatedGates.close_allowed) break;
  }
  const result = { request_id: requestId, max_rounds: maxRounds, rounds_used: history.filter((h) => h.action === 'auto-iteration').length, history, generated_at: nowIso() };
  writeJson(aiPath(root, 'execution', 'status', `${requestId}-auto-iteration.json`), result);
  return result;
}

export function safeToAutoFix(gates) {
  if (!gates) return { can_fix: true, reason: 'No gates yet.' };
  const blockers = gates.close_blockers || [];
  if (blockers.some((item) => HUMAN_ONLY_BLOCKERS.test(item))) {
    return { can_fix: false, reason: 'Blocker requires human approval or visual/design action.' };
  }
  if (blockers.some((item) => /fake_data/i.test(item))) {
    return { can_fix: false, reason: 'Fake data requires removal or explicit user confirmation.' };
  }
  if (blockers.some((item) => /locked_constraints/i.test(item))) {
    return { can_fix: false, reason: 'A locked constraint is violated; human review required.' };
  }
  return { can_fix: true, reason: 'Only safe/technical blockers detected.' };
}

function buildAutoIterationPrompt(requestId, gates, round) {
  return `# Auto Iteration ${round} — ${requestId}\n\n` +
    `Fix only safe blockers (lint, typecheck, build, clear test failures, missing placeholders, minor criteria).\n` +
    `Do not touch database, auth, payments, deploy, real business data, locked constraints or approved design.\n\n` +
    `Current blockers:\n${(gates?.close_blockers || []).map((b) => `- ${b}`).join('\n') || '- none recorded'}\n`;
}
