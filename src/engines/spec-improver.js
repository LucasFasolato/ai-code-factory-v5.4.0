import { writeJson, writeText } from '../core/fs.js';
import { requestPaths } from '../core/paths.js';
import { bullet } from '../core/format.js';

export function buildAcceptanceCriteria(intake) {
  const base = [
    'The implementation matches the interpreted user intent.',
    'No fake real-world data, metrics, contact data or legal claims are introduced.',
    'Required validation commands are executed or explicitly marked skipped with reason.',
    'An evidence pack explains close status.'
  ];
  if (intake.work_type === 'frontend_visual') {
    base.push('Hero communicates value clearly in under 5 seconds.');
    base.push('Primary CTA is visible and understandable.');
    base.push('Layout is responsive and mobile usable.');
    base.push('Approved visual design is respected if design-first is required.');
    base.push('Visual evidence or visual acceptance exists before closing.');
    if (/before|after|galer/i.test(intake.raw_user_ask)) base.push('Before/after gallery has 6 to 8 comparison cases or an explicit accepted deviation.');
  }
  if (intake.work_type === 'backend_api') {
    base.push('API contract is documented.');
    base.push('Input validation and expected errors are handled.');
    base.push('Permissions/auth assumptions are explicit.');
    base.push('Relevant tests cover success and failure paths.');
  }
  if (intake.work_type === 'fullstack_feature') {
    base.push('User flow is split into frontend, backend and data responsibilities.');
    base.push('API contract between frontend/backend is explicit.');
    base.push('Smoke validation covers the main flow when possible.');
  }
  if (intake.work_type === 'product_epic') {
    base.push('The ask is decomposed into a roadmap before any implementation.');
    base.push('No executor run implements the whole epic as one change.');
    base.push('Critical questions are captured before child REQs are approved.');
  }
  if (intake.work_type === 'bugfix') {
    base.push('Root cause is documented or clearly inferred.');
    base.push('Regression coverage is added or explicitly waived.');
  }
  if (intake.work_type === 'refactor') {
    base.push('Observable behavior is preserved.');
    base.push('Scope remains limited to the refactor objective.');
  }
  return [...new Set([...base, ...(intake.acceptance_criteria_draft || [])])];
}

export function buildImprovedSpec(intake) {
  const criteria = buildAcceptanceCriteria(intake);
  return {
    request_id: intake.request_id,
    criteria,
    markdown: `# Improved Spec — ${intake.request_id}\n\n` +
      `## Original Ask\n\n${intake.raw_user_ask}\n\n` +
      `## Interpreted Intent\n\n${intake.interpreted_intent}\n\n` +
      `## Work Type\n\n${intake.work_type} / ${intake.project_type}\n\n` +
      `## Scope\n\nDeliver the smallest professional slice that satisfies the intent and respects gates.\n\n` +
      `## Out of Scope\n\n- Unapproved high-risk changes.\n- Fake real-world claims.\n- Large architecture changes not requested.\n\n` +
      `## Acceptance Criteria\n\n${criteria.map((item) => `- ${item}`).join('\n')}\n\n` +
      `## Constraints\n\n${bullet(intake.must_not_do)}\n\n` +
      `## Required Evidence\n\n- Gates report.\n- Validation status.\n- Acceptance evaluation.\n- Evidence pack.\n`
  };
}

export function saveImprovedSpec(root, intake) {
  const paths = requestPaths(root, intake.request_id);
  const spec = buildImprovedSpec(intake);
  writeText(paths.spec, spec.markdown);
  writeJson(paths.specJson, { request_id: intake.request_id, criteria: spec.criteria });
  return spec;
}
