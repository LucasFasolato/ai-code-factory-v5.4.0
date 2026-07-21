import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempProject, cleanup, createRequest } from './helpers.js';
import { appendEvent, readEvents, deriveStateFromEvents } from '../src/core/events.js';
import { recordFeedback, mineFeedback } from '../src/engines/feedback-engine.js';
import { decisionQuality } from '../src/engines/decision-quality-engine.js';
import { lockConstraint, listConstraints } from '../src/engines/constraint-engine.js';
import { evaluateGates } from '../src/engines/gate-engine.js';
import { suggestNext } from '../src/engines/backlog-curator.js';
import { replayRequest, classifyFailures, rootCauseAnalysis } from '../src/engines/replay-engine.js';
import { findTestGaps } from '../src/engines/test-gap-finder.js';
import { compileMemory } from '../src/engines/memory-compiler.js';
import { detectArchitectureDrift } from '../src/engines/architecture-drift.js';
import { loadConfig } from '../src/core/state.js';
import { aiPath, requestPaths } from '../src/core/paths.js';
import { readJson, writeJson } from '../src/core/fs.js';

test('events append to both event log and timeline, and derive request state', () => {
  const root = makeTempProject();
  try {
    appendEvent(root, 'ASK_CREATED', { request_id: 'REQ-001', ask: 'test' });
    appendEvent(root, 'EXECUTION_FINISHED', { request_id: 'REQ-001', status: 'success' });
    appendEvent(root, 'REQ_CLOSED', { request_id: 'REQ-001' });
    const events = readEvents(root, { request_id: 'REQ-001' });
    assert.equal(events.length, 3);
    assert.ok(fs.existsSync(aiPath(root, 'history', 'timeline.ndjson')));
    const derived = deriveStateFromEvents(root);
    assert.equal(derived.requests['REQ-001'].closed, true);
    assert.equal(derived.requests['REQ-001'].executions, 1);
    assert.equal(derived.requests['REQ-001'].failures, 0);
  } finally { cleanup(root); }
});

test('feedback + mine-feedback creates learned rules and a proposal', () => {
  const root = makeTempProject();
  try {
    recordFeedback(root, 'no me gustan los degradados en el hero');
    recordFeedback(root, 'nunca cerrar sin evidencia visual');
    const result = mineFeedback(root);
    assert.equal(result.mined, 2);
    assert.ok(fs.existsSync(result.proposal));
    const preferences = readJson(aiPath(root, 'knowledge', 'user-preferences.json'), null);
    assert.ok(preferences.learned_rules.length >= 1); // design feedback → preference rule
    // Second run mines nothing
    assert.equal(mineFeedback(root).mined, 0);
  } finally { cleanup(root); }
});

test('decision-quality scores a request with explained dimensions', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Crear endpoint API para listar propiedades', config);
    const result = decisionQuality(root, requestId);
    assert.ok(result.score >= 0 && result.score <= 10);
    assert.ok(result.dimensions.length >= 5);
    assert.ok(result.dimensions.every((d) => d.reason));
    assert.ok(fs.existsSync(requestPaths(root, requestId).decisionQuality));
  } finally { cleanup(root); }
});

test('locked constraints with pattern block close via gates', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    lockConstraint(root, 'Never use gradient backgrounds in the hero', { pattern: 'linear-gradient' });
    assert.equal(listConstraints(root).length, 1);
    const srcDir = path.join(root, 'app');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'hero.css'), '.hero { background: linear-gradient(red, blue); }');
    const { requestId } = createRequest(root, 'Crear endpoint API para propiedades', config);
    const gates = evaluateGates(root, requestId, config);
    assert.equal(gates.gates.locked_constraints.status, 'failed');
    assert.ok(gates.close_blockers.some((b) => /locked_constraints/i.test(b)));
  } finally { cleanup(root); }
});

test('suggest-next proposes unblocking open work first', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Landing premium inmobiliaria', config);
    evaluateGates(root, requestId, config);
    const result = suggestNext(root);
    assert.ok(result.suggestions.length > 0);
    assert.ok(result.suggestions.some((s) => s.kind === 'unblock' && s.title.includes(requestId)));
  } finally { cleanup(root); }
});

test('replay + failure classification + root cause produce coherent artifacts', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Landing premium inmobiliaria', config);
    // Simulate a failed validation
    writeJson(requestPaths(root, requestId).validation, { request_id: requestId, status: 'failed', commands: [] });
    appendEvent(root, 'VALIDATION_FINISHED', { request_id: requestId, status: 'failed' });
    const classification = classifyFailures(root, requestId);
    assert.ok(classification.classes.some((c) => c.class === 'technical'));
    assert.ok(classification.classes.some((c) => c.class === 'user_input_gap')); // design pending
    const replay = replayRequest(root, requestId);
    assert.ok(replay.markdown.includes('What failed'));
    assert.ok(replay.events >= 1);
    const rca = rootCauseAnalysis(root, requestId);
    assert.ok(rca.causes.every((c) => c.prevention));
    assert.ok(fs.existsSync(requestPaths(root, requestId).rootCause));
  } finally { cleanup(root); }
});

test('test-gaps detects source files without test references', () => {
  const root = makeTempProject();
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'covered.js'), 'export const a = 1;');
    fs.writeFileSync(path.join(root, 'src', 'uncovered.js'), 'export const b = 2;');
    fs.writeFileSync(path.join(root, 'tests', 'covered.test.js'), "import { a } from '../src/covered.js';");
    const result = findTestGaps(root);
    assert.equal(result.status, 'gaps_found');
    assert.ok(result.gaps.some((g) => g.includes('uncovered.js')));
    assert.ok(!result.gaps.some((g) => g.includes('covered.js') && !g.includes('uncovered')));
  } finally { cleanup(root); }
});

test('compile-memory consolidates events, failures and feedback into knowledge', () => {
  const root = makeTempProject();
  try {
    appendEvent(root, 'ASK_CREATED', { request_id: 'REQ-001', ask: 'x' });
    recordFeedback(root, 'prefiero footers sobrios');
    const result = compileMemory(root);
    assert.ok(fs.existsSync(result.path));
    assert.ok(result.markdown.includes('Compiled Knowledge'));
    assert.ok(result.markdown.includes('prefiero footers sobrios'));
  } finally { cleanup(root); }
});

test('architecture-drift flags YAML config when DNA requires JSON', () => {
  const root = makeTempProject();
  try {
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'index.js'), 'export const x = 1;');
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'config.yaml'), 'key: value');
    const result = detectArchitectureDrift(root);
    assert.equal(result.status, 'drift_detected');
    assert.ok(result.issues.some((i) => i.id === 'yaml-config'));
  } finally { cleanup(root); }
});
