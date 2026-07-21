import { writeText } from '../core/fs.js';
import { requestPaths } from '../core/paths.js';

export function buildRiskRegister(intake) {
  const risks = [];
  risks.push(row('Invented business data', intake.work_type === 'frontend_visual' ? 'high' : 'medium', 'Run fake data scanner and use explicit placeholders.'));
  if (intake.design_first_required) risks.push(row('Poor visual quality', 'high', 'Design-first, approved design gate and visual acceptance.'));
  if (intake.design_first_required) risks.push(row('Wrong approved design', 'high', 'Normalize design IDs and never fallback to recommended option if explicit user ID was supplied.'));
  if (intake.needs_references) risks.push(row('Weak references/context', 'medium', 'Use context pack and limited references.'));
  if (intake.risk === 'high' || intake.risk === 'critical') risks.push(row('High-risk technical change', intake.risk, 'Require human approval and execution contract.'));
  if (intake.requires_decomposition || intake.work_type === 'product_epic') risks.push(row('Oversized product epic', 'high', 'Decompose into child REQs before implementation.'));
  risks.push(row('Token overuse', 'medium', 'Prefer context pack, summarize logs and avoid whole repo prompts.'));
  return { request_id: intake.request_id, risks };
}

export function saveRiskRegister(root, intake) {
  const result = buildRiskRegister(intake);
  const md = `# Risk Register — ${intake.request_id}\n\n| Risk | Level | Mitigation |\n|---|---:|---|\n` +
    result.risks.map((r) => `| ${r.risk} | ${r.level} | ${r.mitigation} |`).join('\n') + '\n';
  writeText(requestPaths(root, intake.request_id).risks, md);
  return result;
}

function row(risk, level, mitigation) { return { risk, level, mitigation }; }
