import { estimateTokensFromChars } from './usage-budget.js';

const DIFFICULTY_RANK = { trivial: 0, simple: 1, medium: 2, complex: 3, epic: 4 };

export function buildBrainRoute(root, rawAsk, heuristic, config = {}, options = {}) {
  const routing = config.brain_routing || {};
  const env = process.env;
  const difficulty = heuristic.difficulty || estimateRouteDifficulty(rawAsk, heuristic.work_type);
  const risk = heuristic.risk || 'medium';
  const forcedProvider = options.provider || flagEnv(env.ACF_BRAIN_FORCE_PROVIDER) || null;
  const configuredDepth = options.depth || env.ACF_BRAIN_DEPTH || routing.default_depth;
  const depth = normalizeDepth(configuredDepth && configuredDepth !== 'auto' ? configuredDepth : depthFor(difficulty, risk));
  const reasoningStrategy = normalizeStrategy(options.strategy || env.ACF_BRAIN_REASONING_STRATEGY || strategyFor(difficulty, risk));
  const externalMinimum = env.ACF_BRAIN_EXTERNAL_MIN_DIFFICULTY || routing.external_min_difficulty || 'medium';
  const useExternal = forcedProvider
    ? forcedProvider !== 'heuristic'
    : DIFFICULTY_RANK[difficulty] >= DIFFICULTY_RANK[externalMinimum];

  const defaultProvider = env.ACF_AI_INTAKE_PROVIDER || config.ai_intake?.provider || 'claude-code';
  const fallbackChain = parseChain(env.ACF_AI_INTAKE_FALLBACK_CHAIN || config.ai_intake?.fallback_chain || `${defaultProvider},openai,heuristic`);
  const provider = useExternal ? (forcedProvider || defaultProvider) : 'heuristic';
  const effectiveChain = provider === 'heuristic'
    ? ['heuristic']
    : unique([provider, ...fallbackChain, 'heuristic']);
  const mode = env.ACF_AI_INTAKE_MODE || config.ai_intake?.mode || 'hybrid';
  const maxPromptChars = maxPromptForDepth(depth, config);
  return {
    enabled: mode !== 'heuristic' && mode !== 'off' && mode !== 'disabled',
    mode,
    provider,
    fallback_chain: effectiveChain,
    difficulty,
    risk,
    depth,
    model: modelForDepth(depth, config),
    reasoning_strategy: reasoningStrategy,
    use_external_brain: useExternal && mode !== 'heuristic' && mode !== 'off' && mode !== 'disabled',
    external_min_difficulty: externalMinimum,
    max_prompt_chars: maxPromptChars,
    projected_output_tokens: outputTokensFor(depth),
    routing_reason: routeReason(difficulty, risk, provider, useExternal, externalMinimum),
    token_policy: {
      simple_asks_skip_external: true,
      max_prompt_chars: maxPromptChars,
      projected_output_tokens: outputTokensFor(depth),
      estimated_input_tokens: null
    }
  };
}

export function finalizeRouteTokens(route, prompt) {
  return {
    ...route,
    token_policy: {
      ...route.token_policy,
      estimated_input_tokens: estimateTokensFromChars(prompt),
      estimated_output_tokens: route.projected_output_tokens
    }
  };
}

export function estimateRouteDifficulty(ask, workType = 'general') {
  const text = String(ask || '').toLowerCase();
  const moduleWords = ['auth', 'login', 'registro', 'usuarios', 'publicaciones', 'listing', 'chat', 'pagos', 'payment', 'reviews', 'dashboard', 'admin', 'ofertas', 'transacciones', 'upload', 'notificaciones', 'roles'];
  const moduleCount = moduleWords.filter((word) => text.includes(word)).length;
  if (/app completa|plataforma|marketplace|tipo vinted|sistema completo|tesis|erp|crm/.test(text) || moduleCount >= 4) return 'epic';
  if (workType === 'fullstack_feature' || moduleCount >= 3 || /integraci[oó]n|migraci[oó]n|refactor grande/.test(text)) return 'complex';
  if (workType === 'backend_api' || workType === 'frontend_visual' || /endpoint|pantalla|formulario|crud|auth|jwt|webhook|checkout|pago/.test(text)) return 'medium';
  if (/cambiar|texto|copy|typo|color|clase|label|bot[oó]n/.test(text)) return 'simple';
  if (text.length < 30) return 'trivial';
  return 'medium';
}

export function routeReason(difficulty, risk, provider, useExternal, minDifficulty) {
  if (!useExternal) return `Difficulty ${difficulty} is below external Brain threshold ${minDifficulty}; using heuristic to avoid unnecessary provider consumption.`;
  return `Difficulty ${difficulty} and risk ${risk} justify external Brain provider ${provider}.`;
}

function depthFor(difficulty, risk) {
  if (difficulty === 'epic' || risk === 'critical') return 'architect';
  if (difficulty === 'complex' || risk === 'high') return 'deep';
  if (difficulty === 'medium') return 'standard';
  return 'fast';
}

function strategyFor(difficulty, risk) {
  if (difficulty === 'epic' || risk === 'critical') return 'tree';
  if (difficulty === 'complex' || risk === 'high') return 'deliberate';
  return 'direct';
}

function maxPromptForDepth(depth, config = {}) {
  const fromConfig = config.brain_routing?.depth_prompt_chars || {};
  const defaults = { fast: 10000, standard: 18000, deep: 28000, architect: 42000 };
  return Number(fromConfig[depth] || defaults[depth] || 18000);
}

// v5.4 model cascade with senior defaults: cheap models think about cheap
// problems, OUT OF THE BOX. Version-proof aliases (haiku/sonnet/opus) resolve
// to the CLI's current generation. Opt-out: tier_models: "cli" (or any tier
// set to "cli") inherits whatever the Claude CLI has configured.
const DEFAULT_TIER_MODELS = { fast: 'haiku', standard: 'sonnet', deep: 'sonnet', architect: 'opus' };
const DEPTH_ORDER = ['fast', 'standard', 'deep', 'architect'];

export function modelForDepth(depth, config = {}) {
  const tiers = config.brain_routing?.tier_models;
  if (tiers === false || tiers === 'cli') return null;
  const merged = { ...DEFAULT_TIER_MODELS, ...(tiers && typeof tiers === 'object' ? tiers : {}) };
  const value = merged[depth] ?? merged.default ?? null;
  return value === 'cli' ? null : value;
}

// One step up the ladder. The escalation policy (when to climb) lives in the
// brain; the ladder itself lives here.
export function escalateDepth(depth) {
  const i = DEPTH_ORDER.indexOf(depth);
  return i >= 0 && i < DEPTH_ORDER.length - 1 ? DEPTH_ORDER[i + 1] : null;
}

export function escalationConfig(config = {}) {
  const cfg = config.brain_routing?.escalation || {};
  return {
    enabled: cfg.enabled !== false,
    min_confidence: Number(cfg.min_confidence ?? 0.75),
    escalate_high_risk_from: cfg.escalate_high_risk_from || 'standard'
  };
}

function outputTokensFor(depth) {
  return ({ fast: 1800, standard: 3000, deep: 4500, architect: 6500 })[depth] || 3000;
}

function parseChain(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  return unique(raw.map((x) => String(x || '').trim()).filter(Boolean));
}

function unique(items) {
  return [...new Set(items)];
}

function normalizeDepth(value) {
  return ['fast', 'standard', 'deep', 'architect'].includes(value) ? value : 'standard';
}

function normalizeStrategy(value) {
  return ['direct', 'deliberate', 'tree'].includes(value) ? value : 'deliberate';
}

function flagEnv(value) {
  const v = String(value || '').trim();
  return v || null;
}
