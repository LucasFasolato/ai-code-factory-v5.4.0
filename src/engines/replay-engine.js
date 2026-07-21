import { exists, readJson, readText, writeJson, writeText } from '../core/fs.js';
import { requestPaths } from '../core/paths.js';
import { nowIso, bullet } from '../core/format.js';
import { readEvents } from '../core/events.js';
import { FAILURE_CLASSES } from '../defaults.js';

// ---------------------------------------------------------------------------
// Failure Classifier — classes: technical, visual, product, planning, context,
// tool, executor, decision, user_input_gap
// ---------------------------------------------------------------------------
export function classifyFailures(root, requestId) {
  const paths = requestPaths(root, requestId);
  const validation = exists(paths.validation) ? readJson(paths.validation, null) : null;
  const acceptance = exists(paths.acceptance) ? readJson(paths.acceptance, null) : null;
  const gates = exists(paths.gates) ? readJson(paths.gates, null) : null;
  const execution = exists(paths.executionStatus) ? readJson(paths.executionStatus, null) : null;
  const intake = exists(paths.intake) ? readJson(paths.intake, null) : null;
  const classes = [];

  if (validation?.status === 'failed') classes.push(cls('technical', 'Technical validation failed (lint/typecheck/test/build).'));
  if (gates?.gates?.visual_evidence?.status === 'failed') classes.push(cls('visual', 'Visual evidence gate failed.'));
  if (gates?.gates?.fake_data?.status === 'failed') classes.push(cls('product', 'Fake data findings block product trust.'));
  if (acceptance && !acceptance.close_allowed) {
    const failed = (acceptance.criteria || []).filter((c) => c.status === 'failed');
    if (failed.length) classes.push(cls('product', `Acceptance criteria failed: ${failed.map((f) => f.text).slice(0, 3).join('; ')}`));
  }
  if (execution?.timed_out) classes.push(cls('executor', 'Executor timed out.'));
  else if (execution && execution.status === 'failed') classes.push(cls('executor', execution.reason || 'Executor failed.'));
  if (intake && (intake.blocking_missing_info || []).length) classes.push(cls('user_input_gap', `Blocking info missing: ${intake.blocking_missing_info.join(', ')}`));
  if (intake && intake.confidence < 0.5) classes.push(cls('planning', `Low intake confidence (${intake.confidence}); classification may have been wrong.`));
  if (gates?.gates?.locked_constraints?.status === 'failed') classes.push(cls('decision', 'A locked constraint was violated.'));
  if (!exists(paths.contextPack)) classes.push(cls('context', 'Context pack missing at execution time.'));

  const valid = classes.filter((c) => FAILURE_CLASSES.includes(c.class));
  const result = { request_id: requestId, classes: valid, generated_at: nowIso() };
  writeJson(paths.failureClass, result);
  return result;
}

function cls(klass, reason) { return { class: klass, reason }; }

// ---------------------------------------------------------------------------
// Experience Replay — what happened, what was decided, what failed
// ---------------------------------------------------------------------------
export function replayRequest(root, requestId) {
  const paths = requestPaths(root, requestId);
  const intake = readJson(paths.intake, null);
  const judgment = readJson(paths.judgment, null);
  const gates = readJson(paths.gates, null);
  const execution = readJson(paths.executionStatus, null);
  const events = readEvents(root, { request_id: requestId });
  const classification = classifyFailures(root, requestId);

  const md = `# Replay — ${requestId}\n\nGenerated at: ${nowIso()}\n\n` +
    `## Timeline (${events.length} events)\n\n${events.map((e) => `- ${e.at} — ${e.type}${e.payload?.status ? ` (${e.payload.status})` : ''}`).join('\n') || '- No events recorded.'}\n\n` +
    `## What the harness understood\n\n${intake ? `- Intent: ${intake.interpreted_intent}\n- Work type: ${intake.work_type}\n- Workflow: ${intake.recommended_workflow}\n- Risk: ${intake.risk} | Confidence: ${intake.confidence}` : '- Intake missing.'}\n\n` +
    `## What it decided\n\n${judgment ? `- Proceed mode: ${judgment.proceed_mode}\n- Human approval: ${judgment.human_approval_required}\n- Reason: ${judgment.reason}` : '- Judgment missing.'}\n\n` +
    `## What failed\n\n${classification.classes.length ? classification.classes.map((c) => `- ${c.class}: ${c.reason}`).join('\n') : '- Nothing classified as failed.'}\n\n` +
    `## Execution\n\n${execution ? `- Executor: ${execution.executor} | Status: ${execution.status}${execution.timed_out ? ' (timed out)' : ''}\n- Files touched: ${(execution.files_touched || []).length}` : '- Executor not run.'}\n\n` +
    `## Close state\n\n${gates ? `- Close allowed: ${gates.close_allowed ? 'yes' : 'no'}\n${bullet(gates.close_blockers || [])}` : '- Gates missing.'}\n\n` +
    `## What should improve next time\n\n${improveHints(classification, intake)}\n`;
  writeText(paths.replay, md);
  return { request_id: requestId, events: events.length, classification, markdown: md };
}

function improveHints(classification, intake) {
  const hints = [];
  for (const c of classification.classes) {
    if (c.class === 'technical') hints.push('Run auto-iterate earlier on safe technical blockers.');
    if (c.class === 'visual') hints.push('Capture visual evidence (screenshot-import) right after implementation.');
    if (c.class === 'product') hints.push('Tighten acceptance criteria and re-check fake data before approve.');
    if (c.class === 'user_input_gap') hints.push('Ask blocking questions before execution, not after.');
    if (c.class === 'executor') hints.push('Check executor logs/timeout and consider fallback or smaller contract.');
    if (c.class === 'planning') hints.push('Improve the ask or answer questions to raise intake confidence.');
    if (c.class === 'context') hints.push('Always regenerate the context pack before execution.');
    if (c.class === 'decision') hints.push('Review locked constraints before contract generation.');
  }
  if (intake?.design_first_required) hints.push('Keep design-first: never implement visual UI without an approved design.');
  return hints.length ? [...new Set(hints)].map((h) => `- ${h}`).join('\n') : '- Keep the current flow; nothing notable to change.';
}

// ---------------------------------------------------------------------------
// Counterfactual Review — what would have happened with different choices
// ---------------------------------------------------------------------------
export function counterfactualReview(root, requestId) {
  const paths = requestPaths(root, requestId);
  const intake = readJson(paths.intake, null);
  if (!intake) throw new Error(`Missing intake for ${requestId}`);
  const classification = exists(paths.failureClass) ? readJson(paths.failureClass, null) : classifyFailures(root, requestId);
  const scenarios = [];

  if (intake.recommended_workflow === 'design-first') {
    scenarios.push(scenario('Skip design-first', 'Implementation would likely repeat the FAS lesson: green build, poor visual quality, rework. Worse outcome.', 'rejected'));
  } else if (intake.work_type === 'frontend_visual') {
    scenarios.push(scenario('Use design-first', 'An approved design contract would reduce visual rework risk. Likely better outcome.', 'worth-considering'));
  }
  if ((classification?.classes || []).some((c) => c.class === 'executor')) {
    scenarios.push(scenario('Use fallback executor', 'If the primary executor failed/timed out, the fallback with the same contract might have completed. Better outcome if failure was executor-specific.', 'worth-considering'));
    scenarios.push(scenario('Smaller execution contract', 'Splitting the contract reduces timeout risk and improves traceability of failures.', 'worth-considering'));
  }
  if ((classification?.classes || []).some((c) => c.class === 'user_input_gap')) {
    scenarios.push(scenario('Block on questions first', 'Answering blocking questions before execution avoids wasted executor runs.', 'worth-considering'));
  }
  if ((classification?.classes || []).some((c) => c.class === 'context')) {
    scenarios.push(scenario('Deeper context pack', 'Including the missing artifacts in the context pack would have prevented context-class failures.', 'worth-considering'));
  }
  if (!scenarios.length) scenarios.push(scenario('No change', 'The chosen workflow/context/executor look adequate for this REQ.', 'keep'));

  const md = `# Counterfactual Review — ${requestId}\n\nGenerated at: ${nowIso()}\n\n` +
    scenarios.map((s) => `## ${s.name}\n\n- Verdict: ${s.verdict}\n- Expected effect: ${s.effect}\n`).join('\n');
  writeText(paths.counterfactual, md);
  return { request_id: requestId, scenarios, markdown: md };
}

function scenario(name, effect, verdict) { return { name, effect, verdict }; }

// ---------------------------------------------------------------------------
// Causal Analysis — direct cause, systemic cause, prevention
// ---------------------------------------------------------------------------
export function rootCauseAnalysis(root, requestId) {
  const paths = requestPaths(root, requestId);
  const classification = exists(paths.failureClass) ? readJson(paths.failureClass, null) : classifyFailures(root, requestId);
  const rows = (classification?.classes || []).map((c) => ({
    class: c.class,
    direct_cause: c.reason,
    systemic_cause: systemicCauseFor(c.class),
    prevention: preventionFor(c.class)
  }));
  const md = `# Root Cause Analysis — ${requestId}\n\nGenerated at: ${nowIso()}\n\n` +
    (rows.length
      ? rows.map((r) => `## ${r.class}\n\n- Direct cause: ${r.direct_cause}\n- Systemic cause: ${r.systemic_cause}\n- Prevention: ${r.prevention}\n`).join('\n')
      : 'No failures to analyze. The REQ has no classified failures.\n');
  writeText(paths.rootCause, md);
  return { request_id: requestId, causes: rows, markdown: md };
}

function systemicCauseFor(klass) {
  const map = {
    technical: 'Validation runs after execution instead of incrementally; no pre-execution smoke check.',
    visual: 'Visual evidence is optional in the moment-to-moment flow even though the gate requires it.',
    product: 'Acceptance criteria are derived heuristically and may not match the real bar.',
    planning: 'Intake classification is keyword-based; ambiguous asks lower confidence.',
    context: 'Context pack regeneration is not enforced before every execution.',
    tool: 'Tool registry has tools disabled or unconfigured.',
    executor: 'Single-executor dependency with coarse-grained contracts.',
    decision: 'Constraints are checked at gate time, not at decision time.',
    user_input_gap: 'Flow allows advancing with blocking info pending behind a gate.'
  };
  return map[klass] || 'Unknown systemic factor.';
}

function preventionFor(klass) {
  const map = {
    technical: 'Auto-iterate on safe blockers; keep validation commands fast and proportional.',
    visual: 'Make screenshot-import + visual-review a standard step in the design-first workflow.',
    product: 'Review acceptance criteria after answering questions; tighten with feedback/mine-feedback.',
    planning: 'Answer questions to raise confidence; use fix-intake when the ask changes.',
    context: 'Regenerate context pack on preview/approve (already enforced); keep it small and current.',
    tool: 'Enable/configure the needed tool in .ai/mcp/registry.json before executing.',
    executor: 'Use fallback executors, shorter contracts, and check timeout settings.',
    decision: 'Lock critical constraints early with lock-constraint so contracts include them.',
    user_input_gap: 'Answer blocking questions before approve; the gate reports them explicitly.'
  };
  return map[klass] || 'Add a regression test and a playbook rule.';
}
