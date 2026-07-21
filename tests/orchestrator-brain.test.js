import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeTempProject, cleanup, createRequest } from './helpers.js';
import { analyzeAskWithBrain } from '../src/engines/ai-intake-brain.js';
import { saveContextPack } from '../src/engines/context-pack-engine.js';
import { evaluateGates } from '../src/engines/gate-engine.js';
import { loadConfig } from '../src/core/state.js';
import { aiPath, requestPaths } from '../src/core/paths.js';
import { appendText, readText, writeJson } from '../src/core/fs.js';

function mockEpicDecision() {
  return {
    intent: 'Crear marketplace C2C tipo Vinted para tesis',
    interpreted_intent: 'Planificar y descomponer un marketplace C2C tipo Vinted antes de implementar',
    project_type: 'next-nest-fullstack',
    work_type: 'product_epic',
    difficulty: 'epic',
    scope: 'product_epic',
    risk: 'high',
    confidence: 0.91,
    should_implement_now: false,
    requires_questions: true,
    requires_decomposition: true,
    design_first_required: true,
    requires_research: false,
    requires_human_approval: true,
    needs_visual_acceptance: true,
    missing_info: ['pagos simulados o sandbox', 'chat realtime o polling'],
    blocking_missing_info: ['epic decomposition before implementation'],
    questions: [
      { id: 'payments-scope', text: '¿Pagos simulados o Mercado Pago sandbox?', priority: 'blocking', default_action: 'Use simulated payments for thesis MVP.' }
    ],
    decisions: [
      { decision: 'Create epic roadmap before implementation', why: 'The ask contains multiple modules and high-risk flows.', confidence: 0.92 }
    ],
    suggested_workflow: 'product-epic-decomposition',
    next_best_action: 'answer critical questions, then create first child REQ',
    tools_needed: ['filesystem', 'epic-decomposer', 'human-approval'],
    suggested_reqs: [
      { title: 'Scaffold monorepo Next + Nest + Postgres', reason: 'Base verifiable first slice.', risk: 'medium', depends_on: [] },
      { title: 'Auth and public/private profile', reason: 'Identity is foundational.', risk: 'high', depends_on: ['Scaffold monorepo Next + Nest + Postgres'] }
    ],
    acceptance_criteria_draft: ['Epic roadmap is created without source-code implementation.'],
    must_not_do: ['Do not implement the full epic in one execution.'],
    assumptions_allowed: ['Use thesis MVP assumptions explicitly.'],
    allowed_files_strategy: 'Only .ai planning artifacts until a child REQ is approved.',
    allowed_files: ['.ai/**'],
    blockers: [],
    brain_summary: 'This is an epic, not a single REQ.'
  };
}



function mockSmallVisualOvercautiousDecision() {
  return {
    intent: 'Add status section',
    interpreted_intent: "Insert a minimal section on the home page displaying 'AI Code Factory v4.7 activo'.",
    project_type: 'next-web-app',
    work_type: 'small_change',
    difficulty: 'trivial',
    scope: 'single_file',
    risk: 'medium',
    confidence: 0.97,
    should_implement_now: true,
    requires_questions: true,
    requires_decomposition: false,
    design_first_required: false,
    requires_research: false,
    requires_human_approval: false,
    needs_visual_acceptance: true,
    missing_info: ['logo or brand assets', 'approved visual design', 'real contact data'],
    blocking_missing_info: ['approved visual design before implementation'],
    questions: [],
    decisions: [],
    suggested_workflow: 'direct-patch-with-validation',
    next_best_action: 'patch home page',
    tools_needed: ['filesystem'],
    suggested_reqs: [],
    acceptance_criteria_draft: ['Text appears on home page.'],
    must_not_do: ['do not implement frontend visual work without approved design'],
    assumptions_allowed: [],
    allowed_files_strategy: 'single_file_touch',
    allowed_files: ['src/app/page.tsx'],
    blockers: [],
    brain_summary: 'Small change with overcautious visual metadata.'
  };
}

test('AI small_change decisions cannot be blocked by generic visual-design missing info', async () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const intake = await analyzeAskWithBrain(root, "Agregá una sección simple en la home que diga 'AI Code Factory v4.7 activo', sin cambiar arquitectura.", 'REQ-009', config, { mockDecision: mockSmallVisualOvercautiousDecision() });
    assert.equal(intake.brain.source, 'mock-ai');
    assert.equal(intake.work_type, 'small_change');
    assert.equal(intake.design_first_required, false);
    assert.equal(intake.needs_visual_acceptance, false);
    assert.equal(intake.should_implement_now, true);
    assert.deepEqual(intake.blocking_missing_info, []);
    assert.equal(intake.must_not_do.some((r) => /approved design|frontend visual work/i.test(r)), false);
  } finally { cleanup(root); }
});

test('AI Intake Brain consumes structured AI decision and writes brain artifacts', async () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const intake = await analyzeAskWithBrain(root, 'App tipo Vinted para tesis con usuarios, publicaciones, ofertas, chat y pagos simulados', 'REQ-001', config, { mockDecision: mockEpicDecision() });
    assert.equal(intake.brain.source, 'mock-ai');
    assert.equal(intake.work_type, 'product_epic');
    assert.equal(intake.difficulty, 'epic');
    assert.equal(intake.requires_decomposition, true);
    assert.equal(intake.should_implement_now, false);
    assert.ok(intake.suggested_reqs.length >= 2);
    assert.ok(fs.existsSync(requestPaths(root, 'REQ-001').brainSummary));
    assert.ok(readText(requestPaths(root, 'REQ-001').brainDecisionLog).includes('Create epic roadmap'));
  } finally { cleanup(root); }
});

test('AI Intake Brain has deterministic fallback when AI mode is disabled', async () => {
  const root = makeTempProject();
  try {
    const config = { ...loadConfig(root), ai_intake: { mode: 'heuristic', enabled: false } };
    const intake = await analyzeAskWithBrain(root, 'Crear endpoint NestJS GET /properties con filtros', 'REQ-001', config);
    assert.equal(intake.brain.source, 'heuristic');
    assert.equal(intake.work_type, 'backend_api');
    assert.ok(fs.existsSync(requestPaths(root, 'REQ-001').brainSummary));
  } finally { cleanup(root); }
});

test('answers and learned memory are injected into the context pack', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Crear endpoint API propiedades', config);
    appendText(requestPaths(root, requestId).answersMd, '\n## Answer\n\nContrato: GET /properties devuelve {data,total}. Público sin auth.\n');
    writeJson(aiPath(root, 'knowledge', 'user-preferences.json'), { learned_rules: [{ rule: 'Prefer DTOs with class-validator.' }] });
    const pack = saveContextPack(root, requestId);
    assert.ok(pack.markdown.includes('User Answers / Clarifications'));
    assert.ok(pack.markdown.includes('GET /properties devuelve'));
    assert.ok(pack.markdown.includes('Prefer DTOs with class-validator'));
  } finally { cleanup(root); }
});

test('dry-run executor status is a hard close blocker', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Crear endpoint API propiedades', config);
    writeJson(requestPaths(root, requestId).executionStatus, { request_id: requestId, status: 'dry_run', reason: 'dry run requested', files_touched: [] });
    writeJson(requestPaths(root, requestId).validation, { request_id: requestId, status: 'passed', commands: [] });
    writeJson(requestPaths(root, requestId).acceptance, { request_id: requestId, close_allowed: true, summary: 'ok', criteria: [] });
    const gates = evaluateGates(root, requestId, config);
    assert.equal(gates.close_allowed, false);
    assert.equal(gates.gates.executor_status.status, 'failed');
    assert.ok(gates.close_blockers.some((b) => /executor_status/i.test(b)));
  } finally { cleanup(root); }
});

test('scope gate blocks files touched outside the execution contract', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Crear endpoint API propiedades', config);
    writeJson(requestPaths(root, requestId).executionStatus, { request_id: requestId, status: 'success', reason: 'ok', files_touched: ['package.json'] });
    writeJson(requestPaths(root, requestId).validation, { request_id: requestId, status: 'passed', commands: [] });
    writeJson(requestPaths(root, requestId).acceptance, { request_id: requestId, close_allowed: true, summary: 'ok', criteria: [] });
    const gates = evaluateGates(root, requestId, config);
    assert.equal(gates.gates.scope.status, 'failed');
    assert.equal(gates.close_allowed, false);
    assert.ok(gates.close_blockers.some((b) => /scope/i.test(b)));
  } finally { cleanup(root); }
});
