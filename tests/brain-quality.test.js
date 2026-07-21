import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAsk } from '../src/engines/intake-engine.js';
import { estimateRouteDifficulty, buildBrainRoute } from '../src/engines/brain-router.js';
import { previewAskWithBrain } from '../src/engines/ai-intake-brain.js';
import { makeTempProject, cleanup } from './helpers.js';
import { loadConfig } from '../src/core/state.js';

// These tests lock in classification *criterion*, not just plumbing. They are
// the regression guard for the brain's judgment quality.

test('payment/integration work is backend + high risk, never "general"', () => {
  const intake = analyzeAsk('integrar mercado pago con webhooks en el checkout', 'REQ-001');
  assert.equal(intake.work_type, 'backend_api');
  assert.equal(intake.risk, 'high');
  assert.notEqual(intake.recommended_workflow, 'standard-intake');
  assert.ok(intake.blocking_missing_info.some((b) => /payment\/transaction approval/i.test(b)));
});

test('a single backend endpoint that mentions "usuarios" stays backend_api, not fullstack', () => {
  const intake = analyzeAsk('endpoint para crear usuarios en NestJS con validación', 'REQ-002');
  assert.equal(intake.work_type, 'backend_api');
  assert.equal(intake.difficulty, 'medium');
  assert.equal(intake.scope, 'backend_slice');
});

test('a multi-module product ask is escalated to epic with decomposition', () => {
  const intake = analyzeAsk('app tipo Vinted con usuarios, publicaciones, ofertas, chat y pagos', 'REQ-003');
  assert.equal(intake.work_type, 'product_epic');
  assert.equal(intake.difficulty, 'epic');
  assert.equal(intake.requires_decomposition, true);
  assert.equal(intake.recommended_workflow, 'product-epic-decomposition');
  assert.equal(intake.should_implement_now, false);
});

test('explicit fullstack signal classifies as fullstack_feature', () => {
  const intake = analyzeAsk('feature fullstack: pantalla de reservas conectada a la API de disponibilidad', 'REQ-004');
  assert.equal(intake.work_type, 'fullstack_feature');
});

test('trivial copy change stays small_change/simple and is low risk', () => {
  const intake = analyzeAsk('cambiar el texto del botón a "Enviar"', 'REQ-005');
  assert.equal(intake.work_type, 'small_change');
  assert.equal(intake.risk, 'low');
});

test('backend_api carries at least medium risk (touches data/contracts)', () => {
  const intake = analyzeAsk('CRUD de productos con su API REST', 'REQ-006');
  assert.equal(intake.work_type, 'backend_api');
  assert.ok(['medium', 'high'].includes(intake.risk));
});

test('route difficulty agrees with intake on scale (modules>=3 → complex/epic)', () => {
  assert.equal(estimateRouteDifficulty('cambiar color del botón', 'small_change'), 'simple');
  assert.equal(estimateRouteDifficulty('integrar checkout de pagos', 'general'), 'medium');
  assert.ok(['complex', 'epic'].includes(estimateRouteDifficulty('plataforma con usuarios, pagos y chat', 'fullstack_feature')));
});

test('router skips the external brain only on trivial asks (cost discipline)', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const heuristic = analyzeAsk('ok', 'REQ-007');
    const route = buildBrainRoute(root, 'ok', heuristic, config, {});
    assert.equal(route.difficulty, 'trivial');
    assert.equal(route.use_external_brain, false);
    assert.match(route.routing_reason, /below external Brain threshold/i);
  } finally { cleanup(root); }
});

test('router engages the external brain on complex/epic asks', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const ask = 'app tipo Vinted con usuarios, publicaciones, ofertas, chat y pagos';
    const heuristic = analyzeAsk(ask, 'REQ-008');
    const route = buildBrainRoute(root, ask, heuristic, config, {});
    assert.equal(route.use_external_brain, true);
    assert.equal(route.depth, 'architect');
    assert.equal(route.reasoning_strategy, 'tree');
  } finally { cleanup(root); }
});

test('previewAskWithBrain predicts external-brain usage without calling it', async () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const preview = await previewAskWithBrain(root, 'cambiar un texto', config, {});
    assert.equal(preview.would_call_external_brain, false);
    const heavy = await previewAskWithBrain(root, 'plataforma marketplace completa con pagos y chat', config, {});
    assert.equal(heavy.would_call_external_brain, true);
  } finally { cleanup(root); }
});

test('hard rules override an unsafe AI decision (defense-in-depth)', async () => {
  const { analyzeAskWithBrain } = await import('../src/engines/ai-intake-brain.js');
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    // Mock AI tries to bypass safety on a payments-scale ask.
    const mockDecision = {
      intent: 'x', interpreted_intent: 'Build payments now', project_type: 'next-nest-fullstack',
      work_type: 'fullstack_feature', difficulty: 'epic', scope: 'fullstack_slice', risk: 'low',
      confidence: 0.95, should_implement_now: true, requires_questions: false,
      requires_decomposition: false, design_first_required: false, requires_research: false,
      requires_human_approval: false, needs_visual_acceptance: false,
      missing_info: [], blocking_missing_info: [], questions: [], decisions: [],
      suggested_workflow: 'direct-patch-with-validation', next_best_action: 'go',
      tools_needed: [], suggested_reqs: [], acceptance_criteria_draft: [],
      must_not_do: [], assumptions_allowed: [], allowed_files_strategy: 'all', allowed_files: [],
      blockers: [], brain_summary: 'go'
    };
    const intake = await analyzeAskWithBrain(root, 'plataforma de pagos con mercado pago, usuarios y suscripciones', 'REQ-009', config, { mockDecision });
    assert.notEqual(intake.risk, 'low', 'payments must not be low risk');
    assert.equal(intake.requires_decomposition, true, 'epic-scale must require decomposition');
    assert.equal(intake.should_implement_now, false, 'must not implement an epic immediately');
    assert.equal(intake.requires_human_approval, true, 'high-risk must require approval');
  } finally { cleanup(root); }
});
