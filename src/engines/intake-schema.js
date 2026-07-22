export const WORK_TYPES = [
  'small_change',
  'frontend_visual',
  'backend_api',
  'fullstack_feature',
  'product_epic',
  'bugfix',
  'refactor',
  'infra',
  'docs',
  'research',
  'general'
];

export const PROJECT_TYPES = [
  'next-landing',
  'next-web-app',
  'nest-api',
  'next-nest-fullstack',
  'internal-tool',
  'existing-project',
  'research',
  'unknown'
];

const PROJECT_TYPE_ALIASES = new Map([
  ['node-typescript-cli', 'internal-tool'],
  ['typescript-cli', 'internal-tool'],
  ['node-cli', 'internal-tool'],
  ['cli-tool', 'internal-tool']
]);

export const DIFFICULTIES = ['trivial', 'simple', 'medium', 'complex', 'epic'];
export const SCOPES = ['single_file', 'single_feature', 'multi_file', 'backend_slice', 'frontend_slice', 'fullstack_slice', 'product_epic', 'unknown'];
export const RISKS = ['low', 'medium', 'high', 'critical'];
export const BRAIN_DEPTHS = ['fast', 'standard', 'deep', 'architect'];
export const REASONING_STRATEGIES = ['direct', 'deliberate', 'tree'];

export const AI_INTAKE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    intent: { type: 'string' },
    interpreted_intent: { type: 'string' },
    project_type: { type: 'string', enum: PROJECT_TYPES },
    work_type: { type: 'string', enum: WORK_TYPES },
    difficulty: { type: 'string', enum: DIFFICULTIES },
    scope: { type: 'string', enum: SCOPES },
    risk: { type: 'string', enum: RISKS },
    brain_depth: { type: 'string', enum: BRAIN_DEPTHS },
    reasoning_strategy: { type: 'string', enum: REASONING_STRATEGIES },
    confidence: { type: 'number' },
    should_implement_now: { type: 'boolean' },
    requires_questions: { type: 'boolean' },
    requires_decomposition: { type: 'boolean' },
    design_first_required: { type: 'boolean' },
    requires_research: { type: 'boolean' },
    requires_human_approval: { type: 'boolean' },
    needs_visual_acceptance: { type: 'boolean' },
    missing_info: { type: 'array', items: { type: 'string' } },
    blocking_missing_info: { type: 'array', items: { type: 'string' } },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          text: { type: 'string' },
          priority: { type: 'string', enum: ['non_blocking', 'important', 'blocking', 'blocking_if_auth_related', 'blocking_if_db_related'] },
          default_action: { type: 'string' }
        },
        required: ['id', 'text', 'priority', 'default_action']
      }
    },
    decisions: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          decision: { type: 'string' },
          why: { type: 'string' },
          confidence: { type: 'number' }
        },
        required: ['decision', 'why', 'confidence']
      }
    },
    suggested_workflow: { type: 'string' },
    next_best_action: { type: 'string' },
    tools_needed: { type: 'array', items: { type: 'string' } },
    suggested_reqs: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string' },
          reason: { type: 'string' },
          risk: { type: 'string', enum: RISKS },
          depends_on: { type: 'array', items: { type: 'string' } }
        },
        required: ['title', 'reason', 'risk', 'depends_on']
      }
    },
    acceptance_criteria_draft: { type: 'array', items: { type: 'string' } },
    must_not_do: { type: 'array', items: { type: 'string' } },
    assumptions_allowed: { type: 'array', items: { type: 'string' } },
    allowed_files_strategy: { type: 'string' },
    allowed_files: { type: 'array', items: { type: 'string' } },
    blockers: { type: 'array', items: { type: 'string' } },
    brain_summary: { type: 'string' }
  },
  required: [
    'intent',
    'interpreted_intent',
    'project_type',
    'work_type',
    'difficulty',
    'scope',
    'risk',
    'confidence',
    'should_implement_now',
    'requires_questions',
    'requires_decomposition',
    'design_first_required',
    'requires_research',
    'requires_human_approval',
    'needs_visual_acceptance',
    'missing_info',
    'blocking_missing_info',
    'questions',
    'decisions',
    'suggested_workflow',
    'next_best_action',
    'tools_needed',
    'suggested_reqs',
    'acceptance_criteria_draft',
    'must_not_do',
    'assumptions_allowed',
    'allowed_files_strategy',
    'allowed_files',
    'blockers',
    'brain_summary'
  ]
};

export function validateBrainDecision(value) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, errors: ['decision must be an object'], value: null };
  }
  const normalized = normalizeBrainDecision(value, errors);
  return { ok: errors.length === 0, errors, value: normalized };
}

export function normalizeBrainDecision(value, errors = []) {
  const out = { ...value };
  out.intent = asString(out.intent);
  out.interpreted_intent = asString(out.interpreted_intent || out.intent);
  out.project_type = enumValue(normalizeProjectType(out.project_type), PROJECT_TYPES, 'unknown', errors, 'project_type');
  out.work_type = enumValue(out.work_type, WORK_TYPES, 'general', errors, 'work_type');
  out.difficulty = enumValue(out.difficulty, DIFFICULTIES, 'medium', errors, 'difficulty');
  out.scope = enumValue(out.scope, SCOPES, 'unknown', errors, 'scope');
  out.risk = enumValue(out.risk, RISKS, 'medium', errors, 'risk');
  out.brain_depth = enumValue(out.brain_depth, BRAIN_DEPTHS, 'standard', errors, 'brain_depth');
  out.reasoning_strategy = enumValue(out.reasoning_strategy, REASONING_STRATEGIES, 'deliberate', errors, 'reasoning_strategy');
  out.confidence = numberBetween(out.confidence, 0, 1, 0.5, errors, 'confidence');
  out.should_implement_now = Boolean(out.should_implement_now);
  out.requires_questions = Boolean(out.requires_questions);
  out.requires_decomposition = Boolean(out.requires_decomposition);
  out.design_first_required = Boolean(out.design_first_required);
  out.requires_research = Boolean(out.requires_research);
  out.requires_human_approval = Boolean(out.requires_human_approval);
  out.needs_visual_acceptance = Boolean(out.needs_visual_acceptance);
  out.missing_info = stringArray(out.missing_info);
  out.blocking_missing_info = stringArray(out.blocking_missing_info);
  out.tools_needed = stringArray(out.tools_needed);
  out.acceptance_criteria_draft = stringArray(out.acceptance_criteria_draft);
  out.must_not_do = stringArray(out.must_not_do);
  out.assumptions_allowed = stringArray(out.assumptions_allowed);
  out.allowed_files = stringArray(out.allowed_files);
  out.blockers = stringArray(out.blockers);
  out.allowed_files_strategy = asString(out.allowed_files_strategy || 'files directly related to the request only');
  out.suggested_workflow = asString(out.suggested_workflow || 'standard-intake');
  out.next_best_action = asString(out.next_best_action || 'continue workflow');
  out.brain_summary = asString(out.brain_summary || out.interpreted_intent);
  out.questions = normalizeQuestions(out.questions);
  out.decisions = normalizeDecisions(out.decisions);
  out.suggested_reqs = normalizeSuggestedReqs(out.suggested_reqs);
  if (!out.intent) errors.push('intent is required');
  if (!out.interpreted_intent) errors.push('interpreted_intent is required');
  return out;
}

function normalizeProjectType(value) {
  return PROJECT_TYPE_ALIASES.get(value) || value;
}

function normalizeQuestions(items) {
  return Array.isArray(items) ? items.map((item, index) => ({
    id: asString(item?.id || `q-${index + 1}`),
    text: asString(item?.text),
    priority: ['non_blocking', 'important', 'blocking', 'blocking_if_auth_related', 'blocking_if_db_related'].includes(item?.priority) ? item.priority : 'important',
    default_action: asString(item?.default_action || '')
  })).filter((q) => q.text) : [];
}

function normalizeDecisions(items) {
  return Array.isArray(items) ? items.map((item) => ({
    decision: asString(item?.decision),
    why: asString(item?.why),
    confidence: numberBetween(item?.confidence, 0, 1, 0.5)
  })).filter((d) => d.decision || d.why) : [];
}

function normalizeSuggestedReqs(items) {
  return Array.isArray(items) ? items.map((item) => ({
    title: asString(item?.title),
    reason: asString(item?.reason),
    risk: RISKS.includes(item?.risk) ? item.risk : 'medium',
    depends_on: stringArray(item?.depends_on)
  })).filter((r) => r.title) : [];
}

function enumValue(value, allowed, fallback, errors, key) {
  if (allowed.includes(value)) return value;
  if (value !== undefined && value !== null && value !== '') errors.push(`${key} has invalid value: ${value}`);
  return fallback;
}

function numberBetween(value, min, max, fallback, errors = null, key = 'number') {
  const n = Number(value);
  if (Number.isFinite(n) && n >= min && n <= max) return Number(n.toFixed(2));
  if (errors && value !== undefined && value !== null) errors.push(`${key} must be between ${min} and ${max}`);
  return fallback;
}

function stringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(asString).filter(Boolean);
}

function asString(value) {
  // Brains sometimes return { question, why } objects inside string arrays —
  // String() turns those into "[object Object]" in user-facing gate output.
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const candidate = value.question || value.text || value.info || value.description || value.item || value.name;
    if (candidate) return String(candidate).trim();
    try { return JSON.stringify(value); } catch { return ''; }
  }
  return String(value ?? '').trim();
}
