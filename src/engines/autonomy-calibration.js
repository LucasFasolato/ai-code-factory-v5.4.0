import { aiPath } from '../core/paths.js';
import { readJson, writeJson } from '../core/fs.js';
import { nowIso } from '../core/format.js';
import { deriveStateFromEvents, appendEvent } from '../core/events.js';
import { loadState, saveState } from '../core/state.js';

// calibrate-autonomy: adjusts the recommended autonomy level based on the real
// history of successes/failures. Never raises above 5 and never applies a
// change without --apply (proposal-first philosophy).
export function calibrateAutonomy(root, options = {}) {
  const derived = deriveStateFromEvents(root);
  const requests = Object.values(derived.requests);
  const executed = requests.filter((r) => r.executions > 0);
  const state = loadState(root);
  const current = state.autonomy_level ?? 3;

  if (executed.length < 3) {
    return {
      status: 'insufficient_data',
      current_level: current,
      recommended_level: current,
      message: `Only ${executed.length} executed requests; need at least 3 to calibrate. Keeping level ${current}.`
    };
  }

  const totalExec = executed.reduce((a, r) => a + r.executions, 0);
  const totalFail = executed.reduce((a, r) => a + r.failures, 0);
  const successRate = (totalExec - totalFail) / totalExec;

  let recommended = current;
  let reason;
  if (successRate >= 0.9) {
    recommended = Math.min(current + 1, 5);
    reason = `Success rate ${(successRate * 100).toFixed(0)}% — the harness earned more autonomy for safe tasks.`;
  } else if (successRate < 0.6) {
    recommended = Math.max(current - 1, 1);
    reason = `Success rate ${(successRate * 100).toFixed(0)}% — reduce autonomy and require more approvals until quality recovers.`;
  } else {
    reason = `Success rate ${(successRate * 100).toFixed(0)}% — current level ${current} is appropriate.`;
  }

  const result = {
    status: 'ok',
    current_level: current,
    recommended_level: recommended,
    success_rate: Number(successRate.toFixed(2)),
    executed_requests: executed.length,
    total_executions: totalExec,
    total_failures: totalFail,
    reason,
    applied: false,
    generated_at: nowIso()
  };

  if (options.apply && recommended !== current) {
    state.autonomy_level = recommended;
    saveState(root, state);
    result.applied = true;
    appendEvent(root, 'AUTONOMY_CHANGED', { from: current, to: recommended, reason });
  }
  writeJson(aiPath(root, 'history', 'scores', 'autonomy-calibration.json'), result);
  return result;
}

export function setAutonomyPreset(root, preset) {
  const levels = { safe: 2, balanced: 3, autonomous: 5 };
  const level = levels[preset];
  if (level === undefined) throw new Error(`Unknown autonomy preset: ${preset}. Use safe | balanced | autonomous.`);
  const state = loadState(root);
  const from = state.autonomy_level;
  state.autonomy_level = level;
  saveState(root, state);
  appendEvent(root, 'AUTONOMY_CHANGED', { from, to: level, preset });
  return { preset, level };
}
