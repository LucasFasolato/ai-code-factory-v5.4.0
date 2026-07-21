import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempProject, cleanup, createRequest } from './helpers.js';
import { evaluateScopeGate } from '../src/engines/scope-gate-engine.js';
import { runSelfReview } from '../src/engines/self-review-engine.js';
import { projectHealth } from '../src/engines/health-engine.js';
import { generateLearning } from '../src/engines/learning-engine.js';
import { loadConfig } from '../src/core/state.js';
import { requestPaths } from '../src/core/paths.js';
import { writeJson, readJson } from '../src/core/fs.js';

function setExecution(root, requestId, filesTouched) {
  writeJson(requestPaths(root, requestId).executionStatus, {
    request_id: requestId,
    executor: 'codex',
    status: 'success',
    files_touched: filesTouched
  });
}

test('scope-gate passes files inside allowed glob and flags out-of-scope writes', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Landing visual para inmobiliaria con hero y servicios', config);
    // frontend_visual allows src/components/**, src/app/page.tsx, public/**, tests/**
    setExecution(root, requestId, ['src/components/Hero.tsx', 'src/app/page.tsx']);
    const inScope = evaluateScopeGate(root, requestId);
    assert.equal(inScope.status, 'passed', inScope.reason);

    setExecution(root, requestId, ['src/components/Hero.tsx', 'prisma/schema.prisma', '../../etc/passwd']);
    const outScope = evaluateScopeGate(root, requestId);
    assert.equal(outScope.status, 'failed');
    assert.ok(outScope.violations.includes('prisma/schema.prisma'));
    assert.ok(outScope.violations.some((v) => v.includes('etc/passwd')));
  } finally { cleanup(root); }
});

test('scope-gate stays pending before the executor runs', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Backend API para usuarios en NestJS', config);
    const result = evaluateScopeGate(root, requestId);
    assert.equal(result.status, 'pending');
  } finally { cleanup(root); }
});

test('self-review blocks close when validation/acceptance are not passed', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Backend API para autenticación', config);
    const review = runSelfReview(root, requestId);
    assert.ok(review.problems.length >= 1);
    assert.match(review.recommended_action, /Do not close/i);
  } finally { cleanup(root); }
});

test('self-review clears when validation and acceptance pass', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Refactor menor en util de fechas', config);
    const paths = requestPaths(root, requestId);
    writeJson(paths.validation, { request_id: requestId, status: 'passed', commands: [] });
    writeJson(paths.acceptance, { request_id: requestId, close_allowed: true, summary: 'All acceptance criteria passed.' });
    // Clear visual requirement for this non-visual work type if present.
    const intake = readJson(paths.intake, {});
    intake.needs_visual_acceptance = false;
    fs.writeFileSync(paths.intake, JSON.stringify(intake, null, 2));
    const review = runSelfReview(root, requestId);
    assert.equal(review.problems.length, 0, review.problems.join('; '));
    assert.match(review.recommended_action, /can proceed/i);
  } finally { cleanup(root); }
});

test('projectHealth returns a 0-100 score and structured checks', () => {
  const root = makeTempProject();
  try {
    const health = projectHealth(root);
    assert.ok(typeof health.score === 'number' && health.score >= 0 && health.score <= 100);
    assert.ok(Array.isArray(health.checks) && health.checks.length > 0);
    assert.ok(health.checks.every((c) => typeof c.ok === 'boolean' && c.id && c.message));
  } finally { cleanup(root); }
});

test('generateLearning writes an auditable learning artifact and emits an event', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Bugfix en el endpoint de pagos', config);
    const result = generateLearning(root, requestId);
    assert.ok(result.markdown.includes('Learning'));
    assert.ok(fs.existsSync(requestPaths(root, requestId).learning));
    const events = fs.readFileSync(path.join(root, '.ai', 'events', 'events.ndjson'), 'utf8');
    assert.match(events, /LEARNING_CREATED/);
  } finally { cleanup(root); }
});
