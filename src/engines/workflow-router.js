import { writeText } from '../core/fs.js';
import { requestPaths } from '../core/paths.js';

export function workflowSteps(intake) {
  if (intake.recommended_workflow === 'product-epic-decomposition' || intake.work_type === 'product_epic') {
    return ['intake', 'brain decision', 'epic roadmap', 'critical questions', 'child REQ creation', 'preview child REQ', 'execute child REQ', 'evidence'];
  }
  if (intake.recommended_workflow === 'design-first') {
    return ['intake', 'questions/context', 'design brief', 'design generate/import', 'design approve', 'implementation preview', 'execute', 'technical validation', 'visual review', 'visual acceptance', 'evidence', 'done'];
  }
  if (intake.work_type === 'backend_api') return ['intake', 'contract', 'plan', 'execute', 'tests', 'validation', 'evidence', 'done'];
  if (intake.work_type === 'fullstack_feature') return ['intake', 'split', 'contracts', 'plan', 'execute', 'e2e/smoke', 'evidence', 'done'];
  if (intake.work_type === 'bugfix') return ['intake', 'diagnose', 'fix', 'regression', 'validation', 'evidence', 'done'];
  if (intake.work_type === 'refactor') return ['intake', 'behavior contract', 'tests', 'refactor', 'validation', 'evidence', 'done'];
  return ['intake', 'plan', 'execute', 'validation', 'evidence', 'done'];
}

export function initialStatusFor(intake) {
  if (intake.requires_decomposition || intake.work_type === 'product_epic') return (intake.missing_info?.length || intake.blocking_missing_info?.length) ? 'needs_input' : 'epic_ready';
  if (intake.design_first_required) return 'intake_ready';
  if (intake.blocking_missing_info?.length) return 'needs_input';
  if (intake.work_type === 'research') return 'intake_ready';
  return 'implementation_ready';
}

export function saveRoutingDecision(root, intake, judgment = null) {
  const paths = requestPaths(root, intake.request_id);
  const steps = workflowSteps(intake);
  const blockers = intake.blocking_missing_info || [];
  const md = `# Routing Decision — ${intake.request_id}\n\n` +
    `## Decision\n\nUse workflow: **${intake.recommended_workflow}**.\n\n` +
    `## Why\n\nWork type is **${intake.work_type}** with difficulty **${intake.difficulty || 'unknown'}**, scope **${intake.scope || 'unknown'}**, risk **${intake.risk}** and confidence **${intake.confidence}**.\n\n` +
    `## Steps\n\n${steps.map((step, i) => `${i + 1}. ${step}`).join('\n')}\n\n` +
    `## Blockers\n\n${blockers.length ? blockers.map((b) => `- ${b}`).join('\n') : '- none'}\n\n` +
    `## Orchestrator Decisions\n\n${(intake.decisions || []).length ? intake.decisions.map((d) => `- ${d.decision}: ${d.why}`).join('\n') : '- none'}\n\n` +
    `## Suggested REQs\n\n${(intake.suggested_reqs || []).length ? intake.suggested_reqs.map((r, i) => `${i + 1}. ${r.title} (${r.risk}) — ${r.reason}`).join('\n') : '- none'}\n\n` +
    `## Judgment\n\n${judgment ? judgment.reason : 'Judgment not generated yet.'}\n`;
  writeText(paths.decision, md);
  return { steps, markdown: md };
}
