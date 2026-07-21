import fs from 'node:fs';
import path from 'node:path';
import { aiPath, requestPaths } from '../core/paths.js';
import { readJsonSafe, readText, writeText } from '../core/fs.js';
import { nowIso, bullet } from '../core/format.js';
import { listBacklog } from '../core/state.js';
import { analyzeAsk } from './intake-engine.js';
import { runIntakeProvider, resolveIntakeProviderConfig, brainDoctor as providerBrainDoctor } from './ai-intake-provider.js';
import { validateBrainDecision } from './intake-schema.js';
import { listConstraints } from './constraint-engine.js';
import { checkBudgetBeforeCall, checkReqBudgetBeforeCall, estimateAiCostUsd, estimateTokensFromChars, recordUsage, readUsageSummary } from './usage-budget.js';
import { buildBrainRoute, finalizeRouteTokens, estimateRouteDifficulty, escalateDepth, escalationConfig } from './brain-router.js';
import { sanitizeBrainContext } from './brain-context-sanitizer.js';
import { clip } from '../core/json-utils.js';
import { buildRoutedBrainContext, buildStageTrace } from './context-router.js';

export async function analyzeAskWithBrain(root, rawUserAsk, requestId, config = {}, options = {}) {
  const heuristicBase = analyzeAsk(rawUserAsk, requestId, config);
  const heuristic = { ...heuristicBase, difficulty: heuristicBase.difficulty || estimateRouteDifficulty(rawUserAsk, heuristicBase.work_type) };
  const route = buildBrainRoute(root, rawUserAsk, heuristic, config, parseBrainOptions(options));
  const providerConfig = resolveIntakeProviderConfig(config, route);
  const rawBrainContext = buildRoutedBrainContext(root, rawUserAsk, requestId, heuristic, config, route);
  const { context: brainContext, max_prompt_chars: maxPromptChars } = sanitizeBrainContext(rawBrainContext, route, config);

  if (!providerConfig.enabled || !route.use_external_brain || route.provider === 'heuristic') {
    const intake = withBrainMetadata(enrichFallbackIntake(heuristic, route), {
      source: route.provider === 'heuristic' ? 'heuristic-routed' : 'heuristic',
      provider: 'heuristic',
      model: 'local-rules',
      fallback_reason: route.routing_reason,
      route
    });
    writeBrainArtifacts(root, requestId, intake, { status: 'heuristic', reason: intake.brain.fallback_reason, route }, brainContext, route);
    return intake;
  }

  // v5.4 senior cascade: one attempt at the routed (cheap) tier; if the cheap
  // model errs OR isn't confident enough OR flags high risk from a low tier,
  // ONE escalation up the ladder before ever falling back to heuristics.
  // Cheap thinks first; expensive thinks only when thinking is actually hard.
  const runAttempt = async (activeRoute) => {
    const activeProviderConfig = resolveIntakeProviderConfig(config, activeRoute);
    const activeContextRaw = activeRoute === route ? rawBrainContext : buildRoutedBrainContext(root, rawUserAsk, requestId, heuristic, config, activeRoute);
    const sanitized = activeRoute === route ? { context: brainContext, max_prompt_chars: maxPromptChars } : sanitizeBrainContext(activeContextRaw, activeRoute, config);
    let prompt = buildBrainPrompt(sanitized.context, activeRoute);
    prompt = clip(prompt, sanitized.max_prompt_chars);
    const finalizedRoute = finalizeRouteTokens(activeRoute, prompt);
    const projectedInputTokens = finalizedRoute.token_policy.estimated_input_tokens;
    const projectedOutputTokens = finalizedRoute.projected_output_tokens;
    const projectedCost = activeProviderConfig.provider === 'openai' || finalizedRoute.fallback_chain.includes('openai')
      ? estimateAiCostUsd(config, activeProviderConfig.model, projectedInputTokens, projectedOutputTokens)
      : 0;
    const budgetCheck = checkBudgetBeforeCall(root, config, projectedCost);
    if (!budgetCheck.allowed) throw new Error(`AI intake budget guard: ${budgetCheck.reason}`);
    const reqBudgetCheck = checkReqBudgetBeforeCall(root, config, requestId, projectedCost);
    if (!reqBudgetCheck.allowed) throw new Error(`AI intake budget guard: ${reqBudgetCheck.reason}`);
    const providerResult = await runIntakeProvider(prompt, config, { ...options, route: finalizedRoute, providerChain: finalizedRoute.fallback_chain, traceDir: aiPath(root, 'reasoning', 'brain', 'raw', requestId) });
    if (providerResult.usage) {
      recordUsage(root, {
        kind: 'ai_intake',
        request_id: requestId,
        provider: providerResult.provider,
        model: providerResult.model,
        input_tokens: providerResult.usage.input_tokens,
        output_tokens: providerResult.usage.output_tokens,
        estimated_cost_usd: providerResult.usage.estimated_cost_usd,
        difficulty: finalizedRoute.difficulty,
        depth: finalizedRoute.depth,
        strategy: finalizedRoute.reasoning_strategy
      });
    }
    const validated = validateBrainDecision(providerResult.parsed);
    if (!validated.ok) throw new Error(`AI intake JSON failed schema validation: ${validated.errors.join('; ')}`);
    if (validated.value.confidence < activeProviderConfig.confidence_threshold) throw new Error(`AI confidence ${validated.value.confidence} below threshold ${activeProviderConfig.confidence_threshold}`);
    return { providerResult, value: validated.value, finalizedRoute };
  };

  try {
    const esc = escalationConfig(config);
    let outcome = null;
    let escalation = null;
    try {
      outcome = await runAttempt(route);
    } catch (firstError) {
      const nextDepth = esc.enabled ? escalateDepth(route.depth) : null;
      if (!nextDepth) throw firstError;
      const escalatedRoute = buildBrainRoute(root, rawUserAsk, heuristic, config, { ...parseBrainOptions(options), depth: nextDepth });
      outcome = await runAttempt(escalatedRoute);
      escalation = { from: route.depth, to: nextDepth, reason: `cheap tier failed: ${String(firstError.message || firstError).slice(0, 140)}`, models: { from: route.model || 'cli-default', to: escalatedRoute.model || 'cli-default' } };
    }
    if (!escalation && esc.enabled) {
      const lowConfidence = outcome.value.confidence < esc.min_confidence;
      const riskAboveTier = outcome.value.risk === 'high' && ['fast', esc.escalate_high_risk_from].includes(route.depth);
      const nextDepth = (lowConfidence || riskAboveTier) ? escalateDepth(route.depth) : null;
      if (nextDepth) {
        try {
          const escalatedRoute = buildBrainRoute(root, rawUserAsk, heuristic, config, { ...parseBrainOptions(options), depth: nextDepth });
          const better = await runAttempt(escalatedRoute);
          if (better.value.confidence >= outcome.value.confidence) {
            escalation = { from: route.depth, to: nextDepth, reason: lowConfidence ? `confidence ${outcome.value.confidence} < ${esc.min_confidence}` : 'high risk flagged from a low tier', models: { from: route.model || 'cli-default', to: escalatedRoute.model || 'cli-default' }, confidence_before: outcome.value.confidence, confidence_after: better.value.confidence };
            outcome = better;
          }
        } catch { /* keep the confident-enough cheap answer; escalation is best-effort */ }
      }
    }
    const { providerResult, value, finalizedRoute } = outcome;
    const intake = withBrainMetadata(mergeAiDecisionWithHeuristic(heuristic, value, finalizedRoute), {
      source: providerResult.used_mock ? 'mock-ai' : 'ai',
      provider: providerResult.provider,
      model: providerResult.model,
      escalation,
      fallback_reason: null,
      route: finalizedRoute,
      provider_trace: providerResult.provider_trace || []
    });
    writeBrainArtifacts(root, requestId, intake, { status: 'ai', provider: providerResult.provider, model: providerResult.model, escalation, provider_trace: providerResult.provider_trace || [], route: finalizedRoute }, brainContext, finalizedRoute);
    return intake;
  } catch (error) {
    if (!providerConfig.fallback_on_error) throw error;
    const requireBrain = config.brain_routing?.require_brain_for_implementation !== false;
    const isImplementing = ['frontend_visual', 'backend_api', 'fullstack_feature', 'small_change', 'bugfix', 'refactor'].includes(heuristic.work_type);
    const brainDegraded = requireBrain && isImplementing && route.use_external_brain;
    const intake = withBrainMetadata(enrichFallbackIntake(heuristic, route), {
      source: 'heuristic-fallback',
      provider: route.provider,
      model: providerConfig.model,
      fallback_reason: error.message || String(error),
      brain_degraded: brainDegraded,
      degraded_note: brainDegraded
        ? 'The external thinking brain (Claude) was unavailable and a deterministic heuristic produced this decision. Quality is lower than a real brain pass. Fix the brain (run brain-doctor) and re-run ask before implementing.'
        : null,
      route,
      provider_trace: error.provider_trace || []
    });
    // When a real brain is required for implementation but unavailable, do not
    // silently green-light execution: hold the request for a brain pass.
    if (brainDegraded) {
      intake.should_implement_now = false;
      intake.brain_required_but_unavailable = true;
      if (!intake.blocking_missing_info.includes('thinking brain (Claude) pass before implementation')) {
        intake.blocking_missing_info = [...intake.blocking_missing_info, 'thinking brain (Claude) pass before implementation'];
      }
      intake.next_best_action = 'run brain-doctor, restore Claude, then re-run ask';
    }
    writeBrainArtifacts(root, requestId, intake, { status: 'fallback', reason: intake.brain.fallback_reason, brain_degraded: brainDegraded, provider_trace: error.provider_trace || [], route }, brainContext, route);
    return intake;
  }
}

export async function previewAskWithBrain(root, rawUserAsk, config = {}, options = {}) {
  const requestId = options.requestId || 'REQ-PREVIEW';
  const heuristicBase = analyzeAsk(rawUserAsk, requestId, config);
  const heuristic = { ...heuristicBase, difficulty: heuristicBase.difficulty || estimateRouteDifficulty(rawUserAsk, heuristicBase.work_type) };
  const route = buildBrainRoute(root, rawUserAsk, heuristic, config, parseBrainOptions(options));
  return { request_id: requestId, ask: rawUserAsk, heuristic, route, would_call_external_brain: route.use_external_brain && route.provider !== 'heuristic' };
}

export function brainStatus(root, config = {}) {
  const provider = resolveIntakeProviderConfig(config);
  const usage = readUsageSummary(root);
  return {
    enabled: provider.enabled,
    mode: provider.mode,
    provider: provider.provider,
    model: provider.model,
    fallback_chain: provider.fallback_chain,
    api_key_env: provider.api_key_env,
    api_key_present: provider.api_key_present,
    claude_code_command: provider.claude_code.command,
    claude_code_args: provider.claude_code.args,
    claude_code_prompt_mode: provider.claude_code.prompt_mode,
    config_file: aiPath(root, 'config.json'),
    local_config_file: aiPath(root, 'config.local.json'),
    env_file: path.join(root, '.env'),
    usage_month: usage.month,
    usage_calls: usage.calls,
    usage_estimated_cost_usd: usage.estimated_cost_usd
  };
}

export function brainDoctor(root, config = {}) {
  const status = providerBrainDoctor(config);
  const usage = readUsageSummary(root);
  return { ...status, usage };
}

function parseBrainOptions(options = {}) {
  return {
    provider: options.provider || null,
    depth: options.depth || null,
    strategy: options.strategy || null
  };
}

function collectBrainContext(root, rawUserAsk, requestId, heuristic, config, route) {
  const backlog = listBacklog(root).slice(-16).map((r) => ({ id: r.id, title: r.title, status: r.status, work_type: r.work_type, risk: r.risk }));
  const projectDna = readJsonSafe(aiPath(root, 'project-dna.json'), null);
  const preferences = readJsonSafe(aiPath(root, 'knowledge', 'user-preferences.json'), null);
  const constraints = listConstraints(root);
  const compiledKnowledge = readText(aiPath(root, 'knowledge', 'compiled-knowledge.md'), '');
  const designTaste = readText(aiPath(root, 'knowledge', 'design-taste.md'), '');
  const engineeringTaste = readText(aiPath(root, 'knowledge', 'engineering-taste.md'), '');
  const projectMap = collectProjectMap(root, projectDna);
  const patterns = readDirNames(aiPath(root, 'patterns')).slice(0, 30);
  const skills = readDirNames(aiPath(root, 'skills')).slice(0, 30);
  return {
    request_id: requestId,
    ask: String(rawUserAsk || '').trim(),
    generated_at: nowIso(),
    heuristic_preanalysis: heuristic,
    brain_route: route,
    project_dna: projectDna,
    user_preferences: preferences,
    locked_constraints: constraints,
    compiled_knowledge: compiledKnowledge,
    design_taste: designTaste,
    engineering_taste: engineeringTaste,
    backlog,
    project_map: projectMap,
    patterns,
    skills,
    supported_workflows: ['design-first', 'backend-contract-first', 'split-contract-first', 'product-epic-decomposition', 'diagnose-fix-validate', 'behavior-preserving-refactor', 'research-brief', 'direct-patch-with-validation', 'standard-intake'],
    hard_rules: [
      'The Brain may decide workflow, difficulty, questions, roadmap and next action.',
      'The Brain must not execute code, approve changes, close requests, delete locked constraints or bypass gates.',
      'Frontend visual work requires design-first when public/important and cannot close without visual acceptance.',
      'High-risk database/auth/payment/deploy changes require explicit approval.',
      'Never invent phone numbers, emails, addresses, metrics, clients, years of experience or legal claims.',
      'Large product asks must be decomposed into small closable REQs instead of implemented as one request.',
      'Do not reveal private chain-of-thought; return concise auditable decisions only.'
    ],
    config_summary: {
      autonomy: config.autonomy,
      token_budget: config.token_budget,
      ai_intake: { ...config.ai_intake, api_key: undefined }
    }
  };
}

function buildBrainPrompt(ctx, route) {
  return `# AI Code Factory — Orchestrator Brain Intake\n\n` +
    `You are the thinking brain of the development harness. Analyze the user's ask with product, technical, design and QA judgment.\n\n` +
    `You do not implement code. You decide the safe next workflow and produce a structured operational decision.\n\n` +
    `## User ask\n${ctx.ask}\n\n` +
    `## Adaptive Brain Route\n` +
    `- Depth: ${route.depth}\n` +
    `- Internal reasoning strategy: ${route.reasoning_strategy}\n` +
    `- Difficulty pre-analysis: ${route.difficulty}\n` +
    `- Risk pre-analysis: ${route.risk}\n` +
    `- Token policy: keep the output compact and complete.\n\n` +
    `## Required behavior\n` +
    `- Decide difficulty: trivial/simple/medium/complex/epic.\n` +
    `- Decide if this is one REQ, a fullstack slice, or a product epic needing decomposition.\n` +
    `- Detect risk, missing information, tools needed, blockers and human approval needs.\n` +
    `- Generate high-quality questions only when they materially change implementation.\n` +
    `- Generate suggested REQs only when decomposition is needed.\n` +
    `- Be decisive: choose a workflow and next action.\n` +
    `- Preserve deterministic hard rules and locked constraints.\n` +
    `- Use internal reasoning privately; do NOT expose chain-of-thought. Put only concise reasons in decisions[].\n` +
    `- Return JSON only, without markdown fences.\n\n` +
    `## JSON output contract\n` +
    `Return an object with: intent, interpreted_intent, project_type, work_type, difficulty, scope, risk, brain_depth, reasoning_strategy, confidence, should_implement_now, requires_questions, requires_decomposition, design_first_required, requires_research, requires_human_approval, needs_visual_acceptance, missing_info, blocking_missing_info, questions, decisions, suggested_workflow, next_best_action, tools_needed, suggested_reqs, acceptance_criteria_draft, must_not_do, assumptions_allowed, allowed_files_strategy, allowed_files, blockers, brain_summary.\n\n` +
    `Allowed work_type values: small_change, frontend_visual, backend_api, fullstack_feature, product_epic, bugfix, refactor, infra, docs, research, general.\n` +
    `Allowed difficulty values: trivial, simple, medium, complex, epic.\n` +
    `Allowed scope values: single_file, single_feature, multi_file, backend_slice, frontend_slice, fullstack_slice, product_epic, unknown.\n` +
    `Allowed risk values: low, medium, high, critical.\n` +
    `Allowed reasoning_strategy values: direct, deliberate, tree.\n` +
    `Allowed brain_depth values: fast, standard, deep, architect.\n\n` +
    `## Token-efficient routed context JSON\n${JSON.stringify(ctx, null, 2)}\n`;
}

function mergeAiDecisionWithHeuristic(heuristic, decision, route = {}) {
  const workType = decision.work_type || heuristic.work_type;
  // Small visual edits (for example: adding a simple banner/label/status section)
  // are intentionally not design-first. Claude may still list generic visual
  // assets/design references as missing info; those must not block a trivial,
  // single-file patch. Reserve design-first for frontend_visual work.
  const isSmallChange = workType === 'small_change';
  const designFirst = isSmallChange ? false : Boolean(decision.design_first_required || (heuristic.design_first_required && workType === 'frontend_visual'));
  const risk = maxRisk(heuristic.risk, decision.risk);
  const missingInfo = sanitizeSmallChangeVisualInfo(workType, unique([...(heuristic.missing_info || []), ...(decision.missing_info || [])]));
  const blockingMissing = sanitizeSmallChangeVisualInfo(workType, unique([...(heuristic.blocking_missing_info || []), ...(decision.blocking_missing_info || []), ...(decision.blockers || [])]));
  const mustNotDo = sanitizeSmallChangeVisualInfo(workType, unique([...(heuristic.must_not_do || []), ...(decision.must_not_do || []), ...hardMustNotDo(workType, designFirst)]));
  const assumptions = unique([...(heuristic.assumptions_allowed || []), ...(decision.assumptions_allowed || [])]);
  const tools = unique([...(heuristic.needs_mcp_tools || []), ...(decision.tools_needed || [])]);
  const requiresDecomposition = Boolean(decision.requires_decomposition || workType === 'product_epic' || decision.difficulty === 'epic');
  const recommendedWorkflow = normalizeWorkflow(decision.suggested_workflow, workType, designFirst, requiresDecomposition, heuristic.recommended_workflow);
  return {
    ...heuristic,
    interpreted_intent: decision.interpreted_intent || decision.intent || heuristic.interpreted_intent,
    intent: decision.intent || heuristic.interpreted_intent,
    project_type: decision.project_type || heuristic.project_type,
    work_type: workType,
    difficulty: decision.difficulty || route.difficulty,
    scope: decision.scope,
    risk,
    confidence: Math.max(heuristic.confidence || 0.5, decision.confidence || 0.5),
    design_first_required: designFirst,
    needs_user_questions: Boolean(decision.requires_questions || missingInfo.length || blockingMissing.length),
    needs_references: Boolean(decision.requires_research || heuristic.needs_references),
    needs_design_provider: designFirst,
    needs_visual_acceptance: isSmallChange ? false : Boolean(decision.needs_visual_acceptance || designFirst || workType === 'frontend_visual'),
    needs_mcp_tools: tools,
    missing_info: missingInfo,
    blocking_missing_info: blockingMissing,
    assumptions_allowed: assumptions,
    must_not_do: mustNotDo,
    recommended_workflow: recommendedWorkflow,
    next_best_action: decision.next_best_action || nextBestActionForDecision(workType, designFirst, requiresDecomposition, blockingMissing),
    should_implement_now: Boolean((decision.should_implement_now || isSmallChange) && !requiresDecomposition && blockingMissing.length === 0 && !designFirst),
    requires_questions: Boolean(!isSmallChange && decision.requires_questions),
    requires_decomposition: requiresDecomposition,
    requires_research: Boolean(decision.requires_research),
    requires_human_approval: Boolean(!isSmallChange && (decision.requires_human_approval || risk === 'high' || risk === 'critical' || designFirst || requiresDecomposition)),
    questions: decision.questions || [],
    decisions: decision.decisions || [],
    suggested_reqs: decision.suggested_reqs || [],
    acceptance_criteria_draft: decision.acceptance_criteria_draft || [],
    allowed_files_strategy: decision.allowed_files_strategy || 'files directly related to the request only',
    allowed_files: decision.allowed_files || [],
    blockers: decision.blockers || [],
    brain_summary: decision.brain_summary || decision.interpreted_intent || decision.intent,
    brain_depth: decision.brain_depth || route.depth,
    reasoning_strategy: decision.reasoning_strategy || route.reasoning_strategy,
    created_at: heuristic.created_at || nowIso()
  };
}

function enrichFallbackIntake(heuristic, route = {}) {
  const difficulty = route.difficulty || estimateRouteDifficulty(heuristic.raw_user_ask, heuristic.work_type);
  const requiresDecomposition = difficulty === 'epic' || heuristic.work_type === 'fullstack_feature' && /\b(app completa|plataforma|marketplace|tipo vinted|sistema completo|usuarios.*pagos|chat.*pagos)\b/i.test(heuristic.raw_user_ask);
  const workType = requiresDecomposition ? 'product_epic' : heuristic.work_type;
  const suggestedReqs = requiresDecomposition ? fallbackRoadmap(heuristic.raw_user_ask) : [];
  const decisions = [
    { decision: requiresDecomposition ? 'Create an epic and roadmap before implementation' : 'Create a direct request workflow', why: requiresDecomposition ? 'The ask contains multiple product modules and cannot be safely closed as one execution.' : 'The ask appears small enough to handle as a closable request after gates.', confidence: heuristic.confidence }
  ];
  return {
    ...heuristic,
    work_type: workType,
    project_type: requiresDecomposition ? 'next-nest-fullstack' : heuristic.project_type,
    difficulty,
    scope: requiresDecomposition ? 'product_epic' : scopeFor(heuristic.work_type),
    requires_decomposition: requiresDecomposition,
    requires_questions: heuristic.needs_user_questions,
    requires_research: heuristic.needs_references,
    requires_human_approval: heuristic.risk === 'high' || heuristic.design_first_required || requiresDecomposition,
    should_implement_now: !requiresDecomposition && !heuristic.design_first_required && !(heuristic.blocking_missing_info || []).length,
    questions: [],
    decisions,
    suggested_reqs: suggestedReqs,
    acceptance_criteria_draft: [],
    allowed_files_strategy: requiresDecomposition ? 'Only .ai planning artifacts until a child REQ is approved.' : 'files directly related to the request only',
    allowed_files: requiresDecomposition ? ['.ai/**'] : [],
    blockers: [],
    brain_depth: route.depth || 'fast',
    reasoning_strategy: route.reasoning_strategy || 'direct',
    brain_summary: requiresDecomposition ? 'Fallback brain detected a product epic and proposed decomposition.' : 'Fallback brain produced a heuristic orchestration decision.'
  };
}


function sanitizeSmallChangeVisualInfo(workType, items) {
  if (workType !== 'small_change') return items;
  return (items || []).filter((item) => !/approved visual design|approved design|visual design|design-first|diseño aprobado|referencias? visual|visual references?|logo|brand assets?|real images?|visual assets?|contact data|real contact|frontend visual work without approved design/i.test(String(item || '')));
}

function writeBrainArtifacts(root, requestId, intake, providerResult, ctx, route = {}) {
  const paths = requestPaths(root, requestId);
  const source = intake.brain?.source || providerResult.status || 'unknown';
  const stageTrace = buildStageTrace({ requestId, route, context: ctx, providerResult, fallbackReason: intake.brain?.fallback_reason || null });
  const summary = `# Orchestrator Brain Summary — ${requestId}\n\n` +
    `Generated at: ${nowIso()}\n\n` +
    `Source: ${source}\n` +
    `Provider: ${intake.brain?.provider || 'n/a'}\n` +
    `Model: ${intake.brain?.model || 'n/a'}\n` +
    `${intake.brain?.fallback_reason ? `Fallback reason: ${intake.brain.fallback_reason}\n` : ''}\n` +
    `## Token-efficient Brain Router\n\n` +
    `- Mode: multi-step routed context\n` +
    `- Selected context: ${(ctx.selected_context || []).join(', ') || 'n/a'}\n` +
    `- Estimated routed context chars: ${JSON.stringify(ctx).length}\n\n` +
    `## Adaptive route\n\n` +
    `- Provider route: ${(route.fallback_chain || []).join(' → ') || intake.brain?.provider || 'heuristic'}\n` +
    `- Depth: ${intake.brain_depth || route.depth || 'n/a'}\n` +
    `- Strategy: ${intake.reasoning_strategy || route.reasoning_strategy || 'n/a'}\n` +
    `- Routing reason: ${route.routing_reason || 'n/a'}\n` +
    `- External Brain used: ${route.use_external_brain ? 'yes' : 'no'}\n\n` +
    `## Decision\n\n` +
    `- Intent: ${intake.interpreted_intent}\n` +
    `- Work type: ${intake.work_type}\n` +
    `- Difficulty: ${intake.difficulty}\n` +
    `- Scope: ${intake.scope}\n` +
    `- Risk: ${intake.risk}\n` +
    `- Workflow: ${intake.recommended_workflow}\n` +
    `- Implement now: ${intake.should_implement_now ? 'yes' : 'no'}\n` +
    `- Decompose: ${intake.requires_decomposition ? 'yes' : 'no'}\n\n` +
    `## Brain summary\n\n${intake.brain_summary || 'No summary.'}\n\n` +
    `## Next action\n\n${intake.next_best_action}\n`;
  const decisions = `# Orchestrator Brain Decision Log — ${requestId}\n\n` +
    `## Decisions\n\n${(intake.decisions || []).length ? (intake.decisions || []).map((d) => `- **${d.decision}** — ${d.why} (confidence ${d.confidence})`).join('\n') : '- none'}\n\n` +
    `## Questions\n\n${(intake.questions || []).length ? (intake.questions || []).map((q) => `- [${q.priority}] ${q.text}`).join('\n') : '- none'}\n\n` +
    `## Missing info\n\n${bullet(intake.missing_info || [])}\n\n` +
    `## Suggested REQs\n\n${(intake.suggested_reqs || []).length ? intake.suggested_reqs.map((r, i) => `${i + 1}. ${r.title} (${r.risk}) — ${r.reason}`).join('\n') : '- none'}\n\n` +
    `## Provider result\n\n${JSON.stringify(providerResult, null, 2).slice(0, 3000)}\n`;
  writeText(paths.brainSummary, summary);
  writeText(paths.brainDecisionLog, decisions);
  writeText(paths.brainContext, JSON.stringify(ctx, null, 2));
  if (paths.brainProviderTrace) writeText(paths.brainProviderTrace, JSON.stringify({ route, provider_result: providerResult, brain: intake.brain }, null, 2));
  writeText(aiPath(root, 'reasoning', 'brain', `${requestId}-stage-trace.json`), JSON.stringify(stageTrace, null, 2));
}


function withBrainMetadata(intake, brain) {
  return {
    ...intake,
    brain: {
      ...brain,
      generated_at: nowIso()
    }
  };
}

function collectProjectMap(root, dna) {
  const names = ['package.json', 'src', 'app', 'pages', 'components', 'apps', 'packages', 'tests', 'test', 'public'];
  const existing = [];
  for (const name of names) if (fs.existsSync(path.join(root, name))) existing.push(name);
  const expected = dna?.expected_architecture?.source_dirs || [];
  return { existing_top_level: existing, expected_source_dirs: expected, detected_files: sampleFiles(root) };
}

function sampleFiles(root) {
  const out = [];
  const ignore = new Set(['node_modules', '.git', '.ai', 'dist', 'build', '.next']);
  function walk(dir, rel = '') {
    if (out.length >= 160) return;
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (out.length >= 160) return;
      if (ignore.has(entry.name)) continue;
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs, childRel);
      else if (entry.isFile()) out.push(childRel);
    }
  }
  walk(root);
  return out;
}

function readDirNames(dir) {
  try { return fs.readdirSync(dir).sort(); } catch { return []; }
}

function unique(items) {
  return [...new Set((items || []).map((x) => String(x || '').trim()).filter(Boolean))];
}

function maxRisk(a, b) {
  const rank = { low: 1, medium: 2, high: 3, critical: 4 };
  return (rank[b] || 0) > (rank[a] || 0) ? b : a;
}

function normalizeWorkflow(workflow, workType, designFirst, requiresDecomposition, fallback) {
  if (requiresDecomposition || workType === 'product_epic') return 'product-epic-decomposition';
  if (designFirst) return 'design-first';
  if (workflow) return workflow;
  return fallback || 'standard-intake';
}

function nextBestActionForDecision(workType, designFirst, requiresDecomposition, blockingMissing) {
  if (requiresDecomposition || workType === 'product_epic') return 'answer critical questions, then create first child REQ';
  if (designFirst) return 'generate_design_brief';
  if (blockingMissing.length) return 'answer_blocking_questions';
  return 'preview then approve execution';
}

function hardMustNotDo(workType, designFirst) {
  const rules = [
    'do not invent phone numbers',
    'do not invent emails',
    'do not invent addresses',
    'do not invent social links',
    'do not invent metrics, clients, years of experience or legal claims',
    'do not close without evidence',
    'do not bypass deterministic gates'
  ];
  if (designFirst) rules.push('do not implement frontend visual work without approved design');
  if (workType === 'backend_api' || workType === 'fullstack_feature' || workType === 'product_epic') rules.push('do not change database/auth/payment behavior without approval');
  return rules;
}

function scopeFor(workType) {
  if (workType === 'frontend_visual') return 'frontend_slice';
  if (workType === 'backend_api') return 'backend_slice';
  if (workType === 'fullstack_feature') return 'fullstack_slice';
  if (workType === 'bugfix' || workType === 'refactor') return 'multi_file';
  return 'single_feature';
}

function fallbackRoadmap(ask) {
  const isMarketplace = /vinted|marketplace|prenda|ropa|c2c/i.test(ask);
  if (isMarketplace) return [
    { title: 'Scaffold monorepo Next + Nest + PostgreSQL', reason: 'Base técnica verificable antes de producto.', risk: 'medium', depends_on: [] },
    { title: 'Auth y perfiles de usuario', reason: 'Identidad y confianza son base del marketplace.', risk: 'high', depends_on: ['Scaffold monorepo Next + Nest + PostgreSQL'] },
    { title: 'Entidades User, Listing y Category', reason: 'Modelo mínimo de publicaciones.', risk: 'high', depends_on: ['Auth y perfiles de usuario'] },
    { title: 'API de publicaciones y búsqueda', reason: 'Primer slice backend usable.', risk: 'medium', depends_on: ['Entidades User, Listing y Category'] },
    { title: 'UI de catálogo y detalle', reason: 'Cara pública del producto; requiere criterio visual.', risk: 'medium', depends_on: ['API de publicaciones y búsqueda'] },
    { title: 'Ofertas y transacciones simuladas', reason: 'Flujo comercial central.', risk: 'high', depends_on: ['UI de catálogo y detalle'] },
    { title: 'Chat y reviews', reason: 'Confianza post-transacción.', risk: 'medium', depends_on: ['Ofertas y transacciones simuladas'] },
    { title: 'E2E demo tesis', reason: 'Evidencia final punta a punta.', risk: 'medium', depends_on: ['Chat y reviews'] }
  ];
  return [
    { title: 'Define product scope and architecture', reason: 'Large asks need explicit product boundaries before code.', risk: 'medium', depends_on: [] },
    { title: 'Implement first vertical slice', reason: 'Smallest demonstrable feature reduces execution risk.', risk: 'medium', depends_on: ['Define product scope and architecture'] },
    { title: 'Add validation and evidence', reason: 'Close only with tests/gates/evidence.', risk: 'low', depends_on: ['Implement first vertical slice'] }
  ];
}
