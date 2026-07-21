import { exists, readJson, writeJson } from '../core/fs.js';
import { aiPath, requestPaths } from '../core/paths.js';
import { nowIso } from '../core/format.js';
import { readEvents, deriveStateFromEvents } from '../core/events.js';

// decision-quality REQ-001: scores workflow, context, risks, questions,
// executor and gates with concrete evidence from artifacts.
export function decisionQuality(root, requestId) {
  const paths = requestPaths(root, requestId);
  const intake = readJson(paths.intake, null);
  if (!intake) throw new Error(`Missing intake for ${requestId}`);
  const gates = readJson(paths.gates, null);
  const execution = readJson(paths.executionStatus, null);
  const validation = readJson(paths.validation, null);
  const iterations = readJson(aiPath(root, 'execution', 'status', `${requestId}-auto-iteration.json`), null);

  const dims = [];
  dims.push(dim('workflow', scoreWorkflow(intake), 'Workflow matches work type and design-first policy.'));
  dims.push(dim('context', exists(paths.contextPack) ? 10 : 2, exists(paths.contextPack) ? 'Context pack generated.' : 'Context pack missing.'));
  dims.push(dim('risk_management', exists(paths.risks) ? 9 : 4, exists(paths.risks) ? 'Risk register exists.' : 'Risk register missing.'));
  dims.push(dim('questions', scoreQuestions(intake, paths), questionReason(intake, paths)));
  dims.push(dim('executor', scoreExecutor(execution), executorReason(execution)));
  dims.push(dim('gates', scoreGates(gates), gates ? `Close ${gates.close_allowed ? 'allowed' : 'blocked'}; ${(gates.close_blockers || []).length} blockers.` : 'Gates never evaluated.'));
  dims.push(dim('validation', scoreValidation(validation), validation ? `Validation ${validation.status}.` : 'Validation never run.'));
  if (iterations) dims.push(dim('iteration_efficiency', Math.max(2, 10 - (iterations.rounds_used || 0) * 2), `${iterations.rounds_used || 0} auto-iteration rounds used.`));

  const score = Number((dims.reduce((a, d) => a + d.score, 0) / dims.length).toFixed(1));
  const result = { request_id: requestId, score, max: 10, dimensions: dims, generated_at: nowIso() };
  writeJson(paths.decisionQuality, result);
  return result;
}

function dim(name, score, reason) { return { name, score: clamp(score), reason }; }
function clamp(n) { return Math.max(0, Math.min(10, Math.round(n))); }

function scoreWorkflow(intake) {
  if (intake.work_type === 'frontend_visual' && intake.design_first_required && intake.recommended_workflow === 'design-first') return 10;
  if (intake.work_type === 'frontend_visual' && !intake.design_first_required) return 6;
  if (intake.recommended_workflow && intake.recommended_workflow !== 'standard-intake') return 9;
  return 5;
}

function scoreQuestions(intake, paths) {
  const blocking = (intake.blocking_missing_info || []).length;
  const answered = exists(paths.answersMd);
  if (!blocking) return 9;
  return answered ? 9 : 4;
}

function questionReason(intake, paths) {
  const blocking = (intake.blocking_missing_info || []).length;
  if (!blocking) return 'No blocking questions were needed.';
  return exists(paths.answersMd) ? 'Blocking questions were answered.' : `Blocking info pending: ${intake.blocking_missing_info.join(', ')}`;
}

function scoreExecutor(execution) {
  if (!execution) return 5;
  if (execution.status === 'success') return 10;
  if (execution.status === 'dry_run') return 7;
  if (execution.timed_out) return 2;
  return 3;
}

function executorReason(execution) {
  if (!execution) return 'Executor not run yet.';
  return `Executor ${execution.executor} finished with ${execution.status}${execution.timed_out ? ' (timed out)' : ''}.`;
}

function scoreGates(gates) {
  if (!gates) return 3;
  if (gates.close_allowed) return 10;
  const blockers = (gates.close_blockers || []).length;
  return Math.max(3, 9 - blockers);
}

function scoreValidation(validation) {
  if (!validation) return 4;
  if (validation.status === 'passed') return 10;
  if (validation.status === 'skipped') return 6;
  return 2;
}

// ---------------------------------------------------------------------------
// Confidence Calibration — compares intake confidence against real outcomes.
// Overconfident = high confidence but failures; underconfident = the reverse.
// ---------------------------------------------------------------------------
export function calibrateConfidence(root) {
  const derived = deriveStateFromEvents(root);
  const samples = [];
  for (const [requestId, r] of Object.entries(derived.requests)) {
    const intake = readJson(requestPaths(root, requestId).intake, null);
    if (!intake || !r.executions) continue;
    const failed = r.failures > 0;
    samples.push({ request_id: requestId, confidence: intake.confidence, failed });
  }
  if (!samples.length) {
    return { status: 'insufficient_data', samples: 0, message: 'No executed requests to calibrate against yet.' };
  }
  const highConf = samples.filter((s) => s.confidence >= 0.75);
  const highConfFailures = highConf.filter((s) => s.failed).length;
  const overconfidenceRate = highConf.length ? Number((highConfFailures / highConf.length).toFixed(2)) : 0;
  const verdict = overconfidenceRate > 0.4 ? 'overconfident' : overconfidenceRate > 0.2 ? 'slightly_overconfident' : 'calibrated';
  const recommendation = verdict === 'calibrated'
    ? 'Confidence estimates match outcomes; no adjustment needed.'
    : 'Lower effective confidence for similar asks: ask more blocking questions and prefer smaller execution contracts.';
  const result = { status: verdict, samples: samples.length, high_confidence_samples: highConf.length, overconfidence_rate: overconfidenceRate, recommendation, details: samples, generated_at: nowIso() };
  writeJson(aiPath(root, 'history', 'scores', 'confidence-calibration.json'), result);
  return result;
}
