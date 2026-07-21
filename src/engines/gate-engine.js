import fs from 'node:fs';
import { exists, readJson, readJsonSafe, writeJson } from '../core/fs.js';
import { requestPaths } from '../core/paths.js';
import { nowIso } from '../core/format.js';
import { scanFakeData } from './fake-data-scanner.js';
import { checkConstraints } from './constraint-engine.js';
import { evaluateScopeGate } from './scope-gate-engine.js';
import { readDeterministicGates } from './deterministic-gates.js';

export function evaluateGates(root, requestId, config = {}, options = {}) {
  const paths = requestPaths(root, requestId);
  const intake = readJson(paths.intake, null);
  if (!intake) throw new Error(`Missing intake for ${requestId}`);
  const request = readJsonSafe(paths.backlog, null) || {};
  const approvedDesign = exists(paths.approvedDesign) ? readJsonSafe(paths.approvedDesign, null) : null;
  const validation = exists(paths.validation) ? readJsonSafe(paths.validation, null) : null;
  const acceptance = exists(paths.acceptance) ? readJsonSafe(paths.acceptance, null) : null;
  const execution = exists(paths.executionStatus) ? readJsonSafe(paths.executionStatus, null) : null;
  const visualAccepted = exists(paths.visualReview) && /visual acceptance:\s*accepted/i.test(readTextSafe(paths.visualReview));
  const fakeScan = options.skipFakeScan ? null : scanFakeData(root, config, { requestId });
  const constraints = options.skipFakeScan ? null : checkConstraints(root, config);
  const scope = evaluateScopeGate(root, requestId);

  const gates = {
    understanding: gate(intake.confidence >= 0.5 ? 'passed' : 'needs_input', `Confidence ${intake.confidence}`, [paths.intake]),
    brain_quality: brainQualityGate(intake, paths),
    work_type: gate(intake.work_type && intake.work_type !== 'general' ? 'passed' : 'warning', `Classified as ${intake.work_type}`, [paths.intake]),
    missing_info: gate((intake.blocking_missing_info || []).length ? 'warning' : 'passed', missingReason(intake), [paths.questionsMd]),
    design_first: gate(intake.design_first_required ? 'passed' : 'not_required', intake.design_first_required ? 'Design-first required.' : 'Design-first not required.', [paths.intake]),
    approved_design: approvedDesignGate(intake, approvedDesign, paths),
    fake_data: fakeDataGate(fakeScan),
    locked_constraints: constraintsGate(constraints),
    technical_validation: validationGate(validation),
    acceptance_criteria: acceptanceGate(acceptance),
    visual_evidence: visualGate(intake, approvedDesign, visualAccepted, paths),
    executor_status: executorGate(execution),
    scope: scopeGate(scope),
    deterministic_quality: deterministicQualityGate(root, requestId)
  };

  const blockers = closeBlockers(intake, gates);
  const closeAllowed = blockers.length === 0;
  const result = {
    request_id: requestId,
    status: closeAllowed ? 'close_allowed' : 'blocked',
    request_status: request.status || 'unknown',
    gates,
    close_allowed: closeAllowed,
    close_blockers: blockers,
    updated_at: nowIso()
  };
  writeJson(paths.gates, result);
  return result;
}

// v5.0: zero-token tooling verdicts (migration gate, executable standards
// rules, semgrep/ast-grep). Only enforced when the REQ actually ran them, so
// existing flows keep working untouched.
function deterministicQualityGate(root, requestId) {
  const det = readDeterministicGates(root, requestId);
  if (!det) return gate('not_required', 'Deterministic gates not run for this REQ (npm run ai -- det-gates <REQ>).');
  if (det.passed && det.warning_count === 0) return gate('passed', `All ${det.checks.length} deterministic checks passed on ${det.files_reviewed.length} changed file(s).`);
  if (det.passed) return gate('warning', `${det.warning_count} warning(s) from deterministic checks.`, [], 'Review the deterministic gate report.');
  const failed = det.checks.filter((c) => !c.passed && c.severity === 'error').map((c) => c.id).join(', ');
  return gate('failed', `Deterministic checks failed: ${failed}.`, [], 'Fix the findings and re-run det-gates before closing.');
}

function readTextSafe(file) {
  try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function gate(status, reason, evidence = [], resolution = null) {
  return { status, reason, evidence, resolution };
}

function missingReason(intake) {
  const blocking = intake.blocking_missing_info || [];
  if (blocking.length) return `Blocking/gate-controlled info: ${blocking.join(', ')}`;
  const missing = intake.missing_info || [];
  if (missing.length) return `Non-blocking missing info can use assumptions/placeholders: ${missing.join(', ')}`;
  return 'No missing info detected.';
}

function brainQualityGate(intake, paths) {
  if (intake.brain?.source === 'ai' || intake.brain?.source === 'mock-ai') {
    return gate('passed', `Decision produced by thinking brain (${intake.brain.provider}).`, [paths.intake]);
  }
  if (intake.brain_required_but_unavailable || intake.brain?.brain_degraded) {
    return gate('failed', 'Thinking brain (Claude) was required but unavailable; decision is heuristic-only.', [paths.intake], 'Run brain-doctor, restore Claude, then re-run ask before implementing.');
  }
  const implementing = ['frontend_visual', 'backend_api', 'fullstack_feature', 'small_change', 'bugfix', 'refactor'].includes(intake.work_type);
  if (intake.brain?.source?.startsWith('heuristic') && implementing) {
    return gate('warning', 'Decision is heuristic-only (brain not engaged for this ask).', [paths.intake], 'Consider re-running with the external brain for implementing work.');
  }
  return gate('not_required', 'Brain quality gate not applicable to this work type.');
}

function approvedDesignGate(intake, approvedDesign, paths) {
  if (!intake.design_first_required) return gate('not_required', 'This work type does not require approved design.');
  if (!approvedDesign) return gate('pending', 'Design-first requires an approved design before implementation.', [paths.approvedDesign], 'Run design-generate/design-import and design-approve.');
  return gate('passed', `Approved design: ${approvedDesign.approved_design}`, [paths.approvedDesign]);
}

function fakeDataGate(fakeScan) {
  if (!fakeScan) return gate('pending', 'Fake data scanner not run yet.');
  if (fakeScan.status === 'failed') return gate('failed', `${fakeScan.findings.length} unconfirmed real-data findings.`, [], 'Replace with explicit placeholders or confirm real data.');
  if (fakeScan.status === 'warning') return gate('warning', `${fakeScan.findings.length} suspicious findings.`, [], 'Review scanner output.');
  return gate('passed', `Scanned ${fakeScan.scanned_files} files with no fake data findings.`);
}

function constraintsGate(constraints) {
  if (!constraints) return gate('pending', 'Locked constraints not checked yet.');
  if (constraints.status === 'not_required') return gate('not_required', 'No locked constraints defined.');
  if (constraints.status === 'failed') return gate('failed', `${constraints.violations.length} locked constraint violation(s).`, constraints.violations.map((v) => `${v.constraint_id} in ${v.file}`), 'Remove the violating content or unlock the constraint explicitly.');
  return gate('passed', `${constraints.total} locked constraint(s) respected.`);
}

function validationGate(validation) {
  if (!validation) return gate('pending', 'Technical validation has not run yet.', [], 'Run approve/validate.');
  if (validation.status === 'passed') return gate('passed', 'Technical validation passed.', validation.commands?.map((c) => c.command_line) || []);
  if (validation.status === 'skipped') return gate('warning', 'Technical validation skipped.', [], 'Run validation commands when scripts exist.');
  return gate('failed', 'Technical validation failed.', [], 'Fix validation errors.');
}

function acceptanceGate(acceptance) {
  if (!acceptance) return gate('pending', 'Acceptance criteria have not been evaluated yet.');
  if (acceptance.close_allowed) return gate('passed', acceptance.summary || 'Acceptance criteria passed.');
  return gate('failed', acceptance.summary || 'Acceptance criteria failed.', [], 'Fix failed criteria or explicitly waive with reason.');
}

function visualGate(intake, approvedDesign, visualAccepted, paths) {
  if (!intake.needs_visual_acceptance) return gate('not_required', 'Visual acceptance is not required for this work type.');
  if (visualAccepted) return gate('passed', 'Visual acceptance recorded.', [paths.visualReview]);
  if (approvedDesign) return gate('pending', 'Approved design exists but visual acceptance is still pending.', [paths.approvedDesign], 'Run visual-review then visual-accept.');
  return gate('pending', 'No approved design or visual acceptance yet.', [], 'Approve design first.');
}

function executorGate(execution) {
  if (!execution) return gate('pending', 'Executor has not run yet.');
  if (execution.status === 'success') return gate('passed', 'Executor completed successfully.');
  if (execution.status === 'no_op') return gate('failed', execution.reason || 'Executor exited cleanly but changed nothing.', [], 'Re-run the executor, check sandbox/auth, or keep the REQ as planning-only if no code change was intended.');
  if (execution.status === 'dry_run') return gate('failed', execution.reason || 'Executor dry-run is not an implementation.', [], 'Run a real executor or keep the REQ in planning only.');
  if (execution.status === 'skipped_executor_missing' || /executor missing/i.test(execution.reason || '')) return gate('failed', execution.reason || 'Executor missing/skipped.', [], 'Install/configure an executor or explicitly keep as planning-only.');
  return gate('failed', execution.reason || 'Executor failed.');
}

function scopeGate(scope) {
  if (!scope) return gate('pending', 'Scope gate not evaluated.');
  return gate(scope.status, scope.reason, scope.violations || [], scope.status === 'failed' ? 'Revert or approve the out-of-scope files explicitly.' : null);
}


function closeBlockers(intake, gates) {
  const blockers = [];
  for (const [name, g] of Object.entries(gates)) {
    if (['failed', 'needs_input'].includes(g.status)) blockers.push(`${name}: ${g.reason}`);
  }
  if (gates.technical_validation.status !== 'passed') blockers.push(`technical_validation: ${gates.technical_validation.reason}`);
  if (gates.fake_data.status === 'failed') blockers.push(`fake_data: ${gates.fake_data.reason}`);
  if (intake.design_first_required && gates.approved_design.status !== 'passed') blockers.push(`approved_design: ${gates.approved_design.reason}`);
  if (intake.needs_visual_acceptance && gates.visual_evidence.status !== 'passed') blockers.push(`visual_evidence: ${gates.visual_evidence.reason}`);
  if (gates.acceptance_criteria.status !== 'passed') blockers.push(`acceptance_criteria: ${gates.acceptance_criteria.reason}`);
  if (gates.executor_status.status !== 'passed') blockers.push(`executor_status: ${gates.executor_status.reason}`);
  if (gates.scope.status === 'failed') blockers.push(`scope: ${gates.scope.reason}`);
  return [...new Set(blockers)];
}
