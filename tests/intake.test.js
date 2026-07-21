import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeAsk } from '../src/engines/intake-engine.js';

test('landing ask is classified as frontend_visual with design-first', () => {
  const intake = analyzeAsk('Quiero una landing page premium para una inmobiliaria', 'REQ-001');
  assert.equal(intake.work_type, 'frontend_visual');
  assert.equal(intake.design_first_required, true);
  assert.equal(intake.recommended_workflow, 'design-first');
  assert.ok(intake.blocking_missing_info.includes('approved visual design before implementation'));
  assert.ok(intake.must_not_do.some((r) => /invent phone/.test(r)));
});

test('backend ask routes to contract-first', () => {
  const intake = analyzeAsk('Crear endpoint NestJS para gestionar propiedades en PostgreSQL', 'REQ-002');
  assert.equal(intake.work_type, 'backend_api');
  assert.equal(intake.recommended_workflow, 'backend-contract-first');
  assert.equal(intake.risk, 'high'); // database mention
});

test('bugfix ask routes to diagnose-fix-validate', () => {
  const intake = analyzeAsk('Hay un bug: el formulario rompe al enviar', 'REQ-003');
  assert.equal(intake.work_type, 'bugfix');
  assert.equal(intake.recommended_workflow, 'diagnose-fix-validate');
});

test('short ambiguous ask lowers confidence', () => {
  const intake = analyzeAsk('mejorar algo', 'REQ-004');
  assert.ok(intake.confidence < 0.6);
});

test('intake never invents data: assumptions require explicit placeholders', () => {
  const intake = analyzeAsk('Landing para FAS Propiedades', 'REQ-005');
  assert.ok(intake.assumptions_allowed.some((a) => /placeholder/i.test(a)));
});


test('simple home section is small_change and does not require design-first', () => {
  const intake = analyzeAsk("Agregá una sección simple en la home que diga 'AI Code Factory v4.7 activo', sin cambiar arquitectura.", 'REQ-006');
  assert.equal(intake.work_type, 'small_change');
  assert.equal(intake.design_first_required, false);
  assert.equal(intake.should_implement_now, true);
  assert.equal(intake.recommended_workflow, 'direct-patch-with-validation');
  assert.deepEqual(intake.blocking_missing_info, []);
  assert.equal(intake.needs_visual_acceptance, false);
});
