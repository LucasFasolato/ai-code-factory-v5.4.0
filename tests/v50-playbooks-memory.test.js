import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempProject, cleanup, createRequest } from './helpers.js';
import { requestPaths } from '../src/core/paths.js';
import { writeJson } from '../src/core/fs.js';
import { recordPlaybook, matchPlaybook, playbookContextBlock } from '../src/engines/playbook-engine.js';
import { syncAgentsMd } from '../src/engines/agents-md-engine.js';
import { applyGitPolicy, gitPolicyStatus } from '../src/engines/git-policy.js';
import { seedGoldenSet, runBrainEval } from '../src/engines/brain-eval.js';
import { saveRepoMap } from '../src/engines/repo-map-engine.js';
import { evaluateGates } from '../src/engines/gate-engine.js';
import { runDeterministicGates } from '../src/engines/deterministic-gates.js';

test('playbooks graduate from a closed REQ and match similar asks', () => {
  const root = makeTempProject();
  try {
    const { requestId } = createRequest(root, 'Agregá cancelación de reservas con devolución parcial en el backend');
    const paths = requestPaths(root, requestId);
    writeJson(paths.executionStatus, { files_changed: ['src/reservations/reservations.service.ts', 'src/reservations/cancel.dto.ts'] });
    writeJson(paths.validation, { results: { lint: { ok: true }, test: { ok: true } } });
    writeJson(paths.gates, { close_allowed: true });
    const pb = recordPlaybook(root, requestId);
    assert.ok(pb.keywords.includes('reservas') || pb.keywords.includes('cancelación'));

    const match = matchPlaybook(root, 'necesito cancelación de reservas con devolución para el admin');
    assert.equal(match.matched, true);
    assert.equal(match.best.playbook.source_request, requestId);

    const block = playbookContextBlock(root, 'cancelación de reservas con devolución');
    assert.match(block, /Proven playbook match/);
    assert.match(block, /reservations\.service\.ts/);

    const noMatch = matchPlaybook(root, 'diseñá un logo animado con partículas para la home');
    assert.equal(noMatch.matched, false, 'unrelated asks must not match');
  } finally { cleanup(root); }
});

test('recordPlaybook refuses to distill from unproven work', () => {
  const root = makeTempProject();
  try {
    const { requestId } = createRequest(root, 'feature sin cerrar');
    assert.throws(() => recordPlaybook(root, requestId), /not close_allowed/);
  } finally { cleanup(root); }
});

test('agents-md sync writes managed blocks and preserves custom content', () => {
  const root = makeTempProject();
  try {
    fs.writeFileSync(path.join(root, 'AGENTS.md'), '# My custom rules\n\nAlways use pnpm.\n');
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0' } }));
    saveRepoMap(root);
    syncAgentsMd(root);
    const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    assert.match(agents, /Always use pnpm/, 'custom content preserved');
    assert.match(agents, /acf:managed:start/);
    assert.match(agents, /own `acf\/req-\*` branch/);
    // Second sync must not duplicate the block.
    syncAgentsMd(root);
    const again = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
    assert.equal(again.split('acf:managed:start').length, 2, 'exactly one managed block');
    assert.ok(fs.existsSync(path.join(root, 'CLAUDE.md')));
  } finally { cleanup(root); }
});

test('git policy applies hybrid ignore block idempotently', () => {
  const root = makeTempProject();
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
    applyGitPolicy(root, {});
    let content = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    assert.match(content, /node_modules/);
    assert.match(content, /\.ai\/events\//);
    assert.match(content, /\.ai\/reasoning\/brain\/raw\//);
    applyGitPolicy(root, {});
    content = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
    assert.equal(content.split('acf:git-policy:start').length, 2, 'idempotent managed block');
    assert.equal(gitPolicyStatus(root, {}).managed_block_present, true);
  } finally { cleanup(root); }
});

test('brain-eval runs the golden set on the zero-cost heuristic layer', async () => {
  const root = makeTempProject();
  try {
    seedGoldenSet(root);
    const report = await runBrainEval(root, {});
    assert.ok(report.total >= 6, `expected at least 6 golden cases, got ${report.total}`);
    assert.equal(report.accuracy, 1, `golden set must be 100% green: ${JSON.stringify(report.results.filter((r) => !r.passed))}`);
    assert.equal(report.mode, 'heuristic');
    assert.ok(report.accuracy >= 0 && report.accuracy <= 1);
    assert.ok(fs.existsSync(path.join(root, '.ai', 'history', 'scores', 'brain-eval-latest.json')));
  } finally { cleanup(root); }
});

test('gate-engine picks up deterministic results without breaking legacy flows', () => {
  const root = makeTempProject();
  try {
    const { requestId } = createRequest(root, 'pequeño cambio de texto');
    // Legacy path: no deterministic run → not_required, non-blocking.
    let gates = evaluateGates(root, requestId, {}, { skipFakeScan: true });
    assert.equal(gates.gates.deterministic_quality.status, 'not_required');
    // With a failing deterministic run → the gate blocks close.
    runDeterministicGates(root, requestId, {});
    writeJson(path.join(root, '.ai', 'reasoning', 'gates', `${requestId}-deterministic.json`), {
      request_id: requestId, passed: false, failed_count: 1, warning_count: 0,
      files_reviewed: ['src/x.entity.ts'],
      checks: [{ id: 'database_migration', passed: false, severity: 'error', detail: 'entity without migration' }]
    });
    gates = evaluateGates(root, requestId, {}, { skipFakeScan: true });
    assert.equal(gates.gates.deterministic_quality.status, 'failed');
    assert.ok(gates.close_blockers.some((b) => b.startsWith('deterministic_quality')));
  } finally { cleanup(root); }
});
