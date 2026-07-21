import { nowIso } from '../core/format.js';

// Strong type signals decide work_type. Module/scale words (usuarios, pagos,
// chat, ...) intentionally do NOT live here — they inflate difficulty, not type,
// so a single backend endpoint that merely mentions "usuarios" is not misread
// as a fullstack feature. See estimateDifficulty for the scale signals.
const VISUAL_RE = /\b(landing|homepage|home page|home|frontend|ui|ux|visual|diseñ|disen|portfolio|dashboard|marketing|hero|cta|página|pagina|interfaz|responsive|before\/after|before-after|catálogo|catalogo|pantalla|maqueta|mockup|estilos?|css|tailwind)\b/i;
const BACKEND_RE = /\b(api|backend|endpoint|nest|nestjs|express|fastify|postgres|postgresql|database|base de datos|\bdb\b|schema|modelo|entity|entidad|controller|service|repository|dto|crud|migration|migración|migracion|webhook|cron|queue|cola|integrar|integración|integracion|checkout|pasarela|gateway)\b/i;
const PAYMENTS_RE = /\b(mercado\s?pago|mercadopago|stripe|paypal|payment|pago|pagos|checkout|webhook|cobro|suscripci[oó]n|subscription|facturaci[oó]n)\b/i;
// Fullstack requires an explicit whole-product signal, not just a module noun.
const FULLSTACK_RE = /\b(fullstack|full-stack|plataforma|sistema completo|app completa|aplicaci[oó]n completa|flujo completo|panel de administraci[oó]n|end-to-end|punta a punta|monorepo)\b/i;
const BUGFIX_RE = /\b(bug|fix|arregl|error|falla|rompe|crash|failed|no funciona|problema|regresión|regresion)\b/i;
const REFACTOR_RE = /\b(refactor|refactorizar|limpiar|reorganizar|simplificar|deuda técnica|deuda tecnica|arquitectura interna)\b/i;
const RESEARCH_RE = /\b(research|investig|comparar|benchmark|referencias|analizar mercado|buscar)\b/i;
const HIGH_RISK_RE = /\b(auth|autenticación|autenticacion|permisos|roles|payment|payments|pago|pagos|mercado\s?pago|mercadopago|stripe|paypal|seguridad|security|deploy|producción|produccion|delete|eliminar|migración|migracion|schema|database|\bdb\b|base de datos|postgres|postgresql|webhook|transacción|transaccion|checkout|devoluci[oó]n|reembolso|refund)\b/i;
const SMALL_CHANGE_RE = /\b(cambiar texto|copy|typo|color|label|placeholder|botón|boton|renombrar|microcopy|agreg[aáe]?r? una secci[oó]n simple|secci[oó]n(?:\s+\S+){0,3}\s+simple|formulario(?:\s+\S+){0,3}\s+simple|texto simple|status indicator|indicador|badge simple|banner simple|mensaje simple)\b/i;
// Module nouns: count toward scale/difficulty and signal a multi-module product,
// but never by themselves decide backend-vs-fullstack-vs-frontend.
const MODULE_WORDS = ['auth', 'login', 'registro', 'usuarios', 'perfiles', 'publicaciones', 'listing', 'listings', 'chat', 'mensajería', 'mensajeria', 'pagos', 'payment', 'reviews', 'reseñas', 'resenas', 'dashboard', 'admin', 'ofertas', 'transacciones', 'upload', 'subida', 'notificaciones', 'roles', 'búsqueda', 'busqueda', 'catálogo', 'catalogo'];

function moduleCount(text) {
  return MODULE_WORDS.filter((w) => text.includes(w)).length;
}

export function analyzeAsk(rawUserAsk, requestId, config = {}) {
  const ask = String(rawUserAsk || '').trim();
  if (!ask) throw new Error('ask is required');
  const lower = ask.toLowerCase();

  const hasVisual = VISUAL_RE.test(ask);
  const hasBackend = BACKEND_RE.test(ask) || PAYMENTS_RE.test(ask);
  const hasPayments = PAYMENTS_RE.test(ask);
  const mods = moduleCount(lower);
  // Fullstack only when an explicit whole-product signal appears, OR both layers
  // are clearly present, OR several modules are requested together.
  const hasFullstack = FULLSTACK_RE.test(ask) || (hasVisual && hasBackend) || mods >= 3;
  const isBugfix = BUGFIX_RE.test(ask);
  const isRefactor = REFACTOR_RE.test(ask);
  const isResearch = RESEARCH_RE.test(ask) && !hasVisual && !hasBackend;
  const isSmallChange = SMALL_CHANGE_RE.test(ask) && !HIGH_RISK_RE.test(ask);
  const difficulty = estimateDifficulty(ask, { hasVisual, hasBackend, hasFullstack, isBugfix, isRefactor, isSmallChange });
  const isProductEpic = difficulty === 'epic';

  let workType = 'general';
  if (isBugfix) workType = 'bugfix';
  else if (isRefactor) workType = 'refactor';
  else if (isProductEpic) workType = 'product_epic';
  else if (isSmallChange) workType = 'small_change';
  else if (hasFullstack) workType = 'fullstack_feature';
  else if (hasBackend) workType = 'backend_api';
  else if (hasVisual) workType = 'frontend_visual';
  else if (isResearch) workType = 'research';

  let projectType = 'unknown';
  if (workType === 'frontend_visual') projectType = /landing|marketing|hero|cta/i.test(ask) ? 'next-landing' : 'next-web-app';
  if (workType === 'backend_api') projectType = 'nest-api';
  if (workType === 'fullstack_feature' || workType === 'product_epic') projectType = 'next-nest-fullstack';
  if (workType === 'bugfix' || workType === 'refactor' || workType === 'small_change') projectType = 'existing-project';
  if (workType === 'research') projectType = 'research';

  const designFirstRequired = (workType === 'frontend_visual' || (workType === 'product_epic' && /cat[aá]logo|home|landing|dashboard|pantalla|ui|visual|premium/i.test(ask))) && /landing|homepage|home|marketing|portfolio|dashboard|ui|visual|premium|página|pagina|cat[aá]logo|pantalla/i.test(ask);
  const highRisk = HIGH_RISK_RE.test(ask);
  const risk = riskFor(workType, highRisk, difficulty);

  const missingInfo = detectMissingInfo(ask, workType, designFirstRequired);
  const blockingMissingInfo = detectBlockingMissingInfo(ask, workType, designFirstRequired, highRisk);
  const confidence = estimateConfidence(ask, workType, missingInfo, blockingMissingInfo, difficulty);
  const requiresDecomposition = workType === 'product_epic';
  const recommendedWorkflow = routeWorkflow(workType, designFirstRequired, requiresDecomposition);

  return {
    request_id: requestId,
    raw_user_ask: ask,
    intent: interpretIntent(ask, workType),
    interpreted_intent: interpretIntent(ask, workType),
    project_type: projectType,
    work_type: workType,
    difficulty,
    scope: scopeFor(workType),
    risk,
    confidence,
    design_first_required: designFirstRequired,
    needs_user_questions: missingInfo.length > 0 || blockingMissingInfo.length > 0,
    needs_references: workType === 'frontend_visual' || /referencias|inspiración|inspiracion|benchmark|competidor/i.test(ask),
    needs_design_provider: designFirstRequired,
    needs_visual_acceptance: workType === 'frontend_visual' || designFirstRequired,
    needs_mcp_tools: recommendTools(workType, designFirstRequired, highRisk, requiresDecomposition),
    missing_info: missingInfo,
    blocking_missing_info: blockingMissingInfo,
    assumptions_allowed: assumptionsAllowed(workType),
    must_not_do: mustNotDo(workType, designFirstRequired),
    recommended_workflow: recommendedWorkflow,
    next_best_action: nextBestAction(workType, designFirstRequired, blockingMissingInfo, requiresDecomposition),
    requires_decomposition: requiresDecomposition,
    requires_questions: missingInfo.length > 0 || blockingMissingInfo.length > 0,
    requires_research: workType === 'research' || /referencias|research|investig/i.test(ask),
    requires_human_approval: risk === 'high' || risk === 'critical' || designFirstRequired || requiresDecomposition,
    should_implement_now: !requiresDecomposition && !designFirstRequired && blockingMissingInfo.length === 0,
    questions: [],
    decisions: [],
    suggested_reqs: [],
    acceptance_criteria_draft: [],
    allowed_files_strategy: requiresDecomposition ? 'Only .ai planning artifacts until a child REQ is approved.' : 'files directly related to the request only',
    allowed_files: requiresDecomposition ? ['.ai/**'] : [],
    blockers: [],
    brain_summary: 'Heuristic pre-analysis generated locally.',
    created_at: nowIso()
  };
}

function detectMissingInfo(ask, workType, designFirstRequired) {
  const missing = [];
  if (workType === 'frontend_visual') {
    if (!/logo|marca|brand/i.test(ask)) missing.push('logo or brand assets');
    if (!/foto|imagen|asset|screenshot|captura/i.test(ask)) missing.push('real images or visual assets');
    if (!/tel[eé]fono|email|contacto|direcci[oó]n|ubicaci[oó]n/i.test(ask)) missing.push('real contact data');
    if (!/referencia|estilo|inspiraci[oó]n|figma|stitch|diseño aprobado|design approved/i.test(ask)) missing.push('visual references or approved design');
    if (designFirstRequired) missing.push('approved visual design');
  }
  if (workType === 'backend_api') {
    if (!/contrato|endpoint|schema|dto|request|response/i.test(ask)) missing.push('API contract');
    if (!/validaci[oó]n|errores|error cases/i.test(ask)) missing.push('validation and error cases');
    if (!/permiso|auth|roles|público|publico/i.test(ask)) missing.push('permissions/auth requirements');
    if (!/persist|postgres|db|database|memoria/i.test(ask)) missing.push('persistence requirements');
  }
  if (workType === 'fullstack_feature') {
    missing.push('user flow');
    missing.push('frontend screens');
    missing.push('API contracts');
    missing.push('data model');
    if (/pago|payment/i.test(ask)) missing.push('payment provider and risk policy');
  }
  if (workType === 'product_epic') {
    missing.push('product scope / MVP boundary');
    missing.push('module priorities');
    missing.push('data model boundaries');
    missing.push('auth/payment/storage policy if applicable');
  }
  if (workType === 'refactor') {
    missing.push('behavior that must be preserved');
    missing.push('tests protecting the refactor');
  }
  return [...new Set(missing)];
}

function detectBlockingMissingInfo(ask, workType, designFirstRequired, highRisk) {
  const blocking = [];
  if (designFirstRequired) blocking.push('approved visual design before implementation');
  if (highRisk && /db|database|schema|migraci/i.test(ask)) blocking.push('database/schema approval');
  if (highRisk && /auth|permiso|seguridad|security/i.test(ask)) blocking.push('auth/security approval');
  if (highRisk && /pago|payment|webhook|transacci/i.test(ask)) blocking.push('payment/transaction approval');
  if (workType === 'backend_api' && !/endpoint|api|contract|contrato/i.test(ask)) blocking.push('minimum API contract');
  if (workType === 'product_epic') blocking.push('epic decomposition before implementation');
  return [...new Set(blocking)];
}

function estimateConfidence(ask, workType, missing, blocking, difficulty) {
  let score = 0.82;
  if (workType === 'general') score -= 0.25;
  if (difficulty === 'epic') score += 0.04;
  score -= Math.min(missing.length * 0.03, 0.18);
  score -= Math.min(blocking.length * 0.07, 0.28);
  if (ask.length < 30) score -= 0.15;
  return Number(Math.max(0.2, Math.min(0.97, score)).toFixed(2));
}

function routeWorkflow(workType, designFirstRequired, requiresDecomposition = false) {
  if (requiresDecomposition || workType === 'product_epic') return 'product-epic-decomposition';
  if (designFirstRequired) return 'design-first';
  if (workType === 'backend_api') return 'backend-contract-first';
  if (workType === 'fullstack_feature') return 'split-contract-first';
  if (workType === 'bugfix') return 'diagnose-fix-validate';
  if (workType === 'refactor') return 'behavior-preserving-refactor';
  if (workType === 'research') return 'research-brief';
  if (workType === 'small_change') return 'direct-patch-with-validation';
  return 'standard-intake';
}

function nextBestAction(workType, designFirstRequired, blocking, requiresDecomposition = false) {
  if (requiresDecomposition || workType === 'product_epic') return 'review roadmap and answer critical questions';
  if (designFirstRequired) return 'generate_design_brief';
  if (blocking.length > 0) return 'answer_blocking_questions';
  if (workType === 'backend_api') return 'define_api_contract';
  if (workType === 'fullstack_feature') return 'split_into_epics_or_slices';
  if (workType === 'bugfix') return 'diagnose_and_prepare_fix';
  if (workType === 'refactor') return 'capture_behavior_contract';
  return 'prepare_execution_contract';
}

function assumptionsAllowed(workType) {
  const base = ['state assumptions explicitly', 'prefer safe defaults', 'do not invent real-world claims'];
  if (workType === 'frontend_visual') base.push('use explicit placeholders for missing contact data', 'use placeholder images when real images are missing');
  if (workType === 'backend_api') base.push('create minimal contract proposal if missing but do not implement risky auth/db changes without approval');
  if (workType === 'product_epic') base.push('create roadmap proposals only; do not implement the full epic as one change');
  return base;
}

function mustNotDo(workType, designFirstRequired) {
  const rules = [
    'do not invent phone numbers',
    'do not invent emails',
    'do not invent addresses',
    'do not invent social links',
    'do not invent metrics, clients, years of experience or legal claims',
    'do not close without evidence',
    'do not bypass deterministic gates'
  ];
  if (designFirstRequired) rules.push('do not implement frontend visual work without approved design');
  if (workType === 'backend_api' || workType === 'fullstack_feature' || workType === 'product_epic') rules.push('do not change database/auth/payment behavior without approval');
  if (workType === 'product_epic') rules.push('do not implement a product epic in a single executor run');
  return rules;
}

function recommendTools(workType, designFirstRequired, highRisk, requiresDecomposition) {
  const tools = ['filesystem'];
  if (designFirstRequired) tools.push('design-provider', 'playwright');
  if (workType === 'frontend_visual') tools.push('browser-search');
  if (workType === 'backend_api' || workType === 'fullstack_feature' || workType === 'product_epic') tools.push('docs-search');
  if (requiresDecomposition) tools.push('epic-decomposer');
  if (highRisk) tools.push('human-approval');
  return [...new Set(tools)];
}

function interpretIntent(ask, workType) {
  const normalized = ask.replace(/\s+/g, ' ').trim();
  if (workType === 'product_epic') return `Plan and decompose a product epic before implementation: ${normalized}`;
  if (workType === 'frontend_visual') return `Create or improve a professional visual frontend experience: ${normalized}`;
  if (workType === 'backend_api') return `Build or modify backend/API behavior: ${normalized}`;
  if (workType === 'fullstack_feature') return `Build a fullstack product feature: ${normalized}`;
  if (workType === 'bugfix') return `Diagnose and fix a reported problem: ${normalized}`;
  if (workType === 'refactor') return `Refactor while preserving behavior: ${normalized}`;
  if (workType === 'research') return `Research and produce a decision-ready brief: ${normalized}`;
  if (workType === 'small_change') return `Make a small controlled change: ${normalized}`;
  return normalized;
}

function estimateDifficulty(ask, signals) {
  const text = ask.toLowerCase();
  const modules = MODULE_WORDS.filter((w) => text.includes(w));
  if (/app completa|plataforma|marketplace|tipo vinted|sistema completo|tesis|erp|crm/.test(text) || modules.length >= 4) return 'epic';
  if (signals.hasFullstack || modules.length >= 3) return 'complex';
  if (signals.hasBackend || signals.hasVisual) return 'medium';
  if (signals.isSmallChange) return 'simple';
  if (text.length < 30) return 'trivial';
  return 'medium';
}

function riskFor(workType, highRisk, difficulty) {
  if (difficulty === 'epic') return 'high';
  if (highRisk) return 'high';
  if (workType === 'frontend_visual' || workType === 'fullstack_feature' || workType === 'product_epic' || workType === 'backend_api') return 'medium';
  if (difficulty === 'complex') return 'medium';
  return 'low';
}

function scopeFor(workType) {
  if (workType === 'product_epic') return 'product_epic';
  if (workType === 'frontend_visual') return 'frontend_slice';
  if (workType === 'backend_api') return 'backend_slice';
  if (workType === 'fullstack_feature') return 'fullstack_slice';
  if (workType === 'small_change') return 'single_file';
  if (workType === 'bugfix' || workType === 'refactor') return 'multi_file';
  return 'single_feature';
}
