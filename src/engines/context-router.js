import { aiPath } from '../core/paths.js';
import { readJsonSafe, readText, writeJson } from '../core/fs.js';
import { nowIso } from '../core/format.js';
import { ensureContextCache, readCachedSummary } from './context-cache.js';

export function buildRoutedBrainContext(root, rawUserAsk, requestId, heuristic, config = {}, route = {}) {
  const cacheIndex = ensureContextCache(root, config);
  const selected = selectContextNames(heuristic);
  const summaries = Object.fromEntries(selected.map((name) => [name, readCachedSummary(root, name, '')]));
  const constraints = readJsonSafe(aiPath(root, 'constraints.json'), { locked_constraints: [] });
  const standardsProfile = readJsonSafe(aiPath(root, 'standards', 'project-standards.json'), null)?.profile || 'unknown';
  const ctx = {
    request_id: requestId,
    ask: String(rawUserAsk || '').trim(),
    generated_at: nowIso(),
    mode: 'token-efficient-routed-context',
    heuristic_preanalysis: compactHeuristic(heuristic),
    brain_route: route,
    selected_context: selected,
    summaries,
    locked_constraints: constraints.locked_constraints || [],
    standards_profile: standardsProfile,
    supported_workflows: ['design-first', 'backend-contract-first', 'split-contract-first', 'product-epic-decomposition', 'diagnose-fix-validate', 'behavior-preserving-refactor', 'research-brief', 'direct-patch-with-validation', 'standard-intake'],
    hard_rules: [
      'Brain decides workflow, risk, questions, decomposition and next action only.',
      'Brain never executes code, approves changes, closes requests or bypasses gates.',
      'Frontend visual work requires design-first and cannot close without visual acceptance.',
      'High-risk database/auth/payment/deploy/destructive changes require explicit approval.',
      'Synthetic/demo content is allowed only when explicitly labelled; never invent real claims.',
      'Large product asks must be decomposed into closable REQs.'
    ],
    cache_index: cacheIndex
  };
  writeJson(aiPath(root, 'reasoning', 'brain', `${requestId}-context-route.json`), { request_id: requestId, generated_at: nowIso(), selected_context: selected, reason: reasonForSelection(heuristic), cache_index: cacheIndex });
  return ctx;
}

export function buildStageTrace({ requestId, route, context, providerResult = null, fallbackReason = null }) {
  const estimatedChars = JSON.stringify(context).length;
  const stages = [
    { name: 'local_triage', provider: 'local', prompt_chars: 0, result: `${context.heuristic_preanalysis.work_type}/${context.heuristic_preanalysis.difficulty}/${context.heuristic_preanalysis.risk}` },
    { name: 'context_router', provider: 'local', prompt_chars: 0, result: context.selected_context.join(', ') },
    { name: specialistStageName(context.heuristic_preanalysis.work_type), provider: route.provider || 'heuristic', prompt_chars: estimatedChars, max_prompt_chars: route.max_prompt_chars, result: providerResult?.status || (fallbackReason ? 'fallback' : 'planned') }
  ];
  return { request_id: requestId, mode: 'multi_step_token_efficient', generated_at: nowIso(), stages, selected_context: context.selected_context, total_external_calls: providerResult?.status === 'ai' ? 1 : 0, fallback_reason: fallbackReason || null, estimated_prompt_chars: estimatedChars };
}

function selectContextNames(heuristic) {
  const work = heuristic.work_type;
  if (work === 'frontend_visual') return ['project-summary.md', 'product-summary.md', 'design-summary.md', 'frontend-summary.md'];
  if (work === 'backend_api') return ['project-summary.md', 'backend-summary.md', 'security-summary.md', 'testing-summary.md'];
  if (work === 'fullstack_feature' || work === 'product_epic') return ['project-summary.md', 'product-summary.md', 'frontend-summary.md', 'backend-summary.md', 'security-summary.md', 'testing-summary.md'];
  if (work === 'bugfix' || work === 'refactor') return ['project-summary.md', 'testing-summary.md', 'backend-summary.md', 'frontend-summary.md'];
  return ['project-summary.md', 'product-summary.md'];
}

function compactHeuristic(h) {
  return {
    request_id: h.request_id,
    raw_user_ask: h.raw_user_ask,
    interpreted_intent: h.interpreted_intent,
    work_type: h.work_type,
    project_type: h.project_type,
    difficulty: h.difficulty,
    risk: h.risk,
    confidence: h.confidence,
    design_first_required: h.design_first_required,
    recommended_workflow: h.recommended_workflow,
    missing_info: h.missing_info,
    blocking_missing_info: h.blocking_missing_info,
    must_not_do: h.must_not_do,
    assumptions_allowed: h.assumptions_allowed
  };
}

function reasonForSelection(heuristic) {
  if (heuristic.work_type === 'frontend_visual') return 'Frontend visual ask: selected project, product, design and frontend summaries only.';
  if (heuristic.work_type === 'backend_api') return 'Backend ask: selected project, backend, security and testing summaries only.';
  if (heuristic.work_type === 'fullstack_feature' || heuristic.work_type === 'product_epic') return 'Fullstack/product ask: selected balanced frontend/backend/security/testing summaries.';
  return 'General ask: selected minimal project/product summaries.';
}

function specialistStageName(workType) {
  if (workType === 'frontend_visual') return 'design_intake_brain';
  if (workType === 'backend_api') return 'backend_intake_brain';
  if (workType === 'fullstack_feature') return 'fullstack_intake_brain';
  if (workType === 'product_epic') return 'product_planning_brain';
  return 'specialist_intake_brain';
}
