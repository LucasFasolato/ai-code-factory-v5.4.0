import { writeJson } from '../core/fs.js';
import { requestPaths } from '../core/paths.js';
import { nowIso } from '../core/format.js';

export function buildJudgment(intake, config = {}) {
  const highRisk = intake.risk === 'high';
  const blocking = intake.blocking_missing_info || [];
  const shouldSplit = intake.requires_decomposition || intake.work_type === 'product_epic' || intake.work_type === 'fullstack_feature' || /(pagos|ranking|admin|reservas|login).*(pagos|ranking|admin|reservas|login)/i.test(intake.raw_user_ask);
  const canProceed = blocking.length === 0 || onlySafeBlocking(blocking);
  const proceedMode = canProceed ? (blocking.length ? 'proceed_with_assumptions_until_gate' : 'proceed') : 'needs_input';
  const humanApprovalRequired = highRisk || intake.design_first_required || shouldSplit || intake.requires_human_approval;
  const level = config?.autonomy?.default_level ?? 3;
  const shouldAutoIterate = Boolean(config?.autonomy?.allow_auto_iteration) && level >= 3;

  return {
    request_id: intake.request_id,
    can_proceed: canProceed,
    proceed_mode: proceedMode,
    decision_confidence: intake.confidence,
    autonomy_level: level,
    should_split: shouldSplit,
    should_research: intake.needs_references,
    should_design_first: intake.design_first_required,
    should_auto_iterate: shouldAutoIterate,
    human_approval_required: humanApprovalRequired,
    human_approval_reasons: approvalReasons(intake, highRisk, shouldSplit),
    reason: reasonText(intake, blocking, highRisk, shouldSplit),
    created_at: nowIso()
  };
}

export function saveJudgment(root, intake, config) {
  const judgment = buildJudgment(intake, config);
  writeJson(requestPaths(root, intake.request_id).judgment, judgment);
  return judgment;
}

function onlySafeBlocking(blocking) {
  return blocking.every((item) => /approved visual design/.test(item));
}

function approvalReasons(intake, highRisk, shouldSplit) {
  const reasons = [];
  if (intake.design_first_required) reasons.push('visual_design');
  if (highRisk && /database|schema|db/i.test(intake.raw_user_ask)) reasons.push('database_schema');
  if (highRisk && /auth|permiso|security|seguridad/i.test(intake.raw_user_ask)) reasons.push('auth');
  if (highRisk && /payment|pago/i.test(intake.raw_user_ask)) reasons.push('payments');
  if (shouldSplit) reasons.push(intake.work_type === 'product_epic' ? 'product_epic_decomposition' : 'large_scope_split');
  return reasons;
}

function reasonText(intake, blocking, highRisk, shouldSplit) {
  const parts = [`The request is classified as ${intake.work_type}.`];
  if (intake.design_first_required) parts.push('Design-first is required before implementation.');
  if (blocking.length) parts.push(`Blocking or gate-controlled items: ${blocking.join(', ')}.`);
  if (highRisk) parts.push('High-risk area requires human approval.');
  if (shouldSplit) parts.push('The request may need splitting into smaller work items.');
  return parts.join(' ');
}
