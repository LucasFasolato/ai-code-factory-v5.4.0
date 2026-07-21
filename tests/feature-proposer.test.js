import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempProject, cleanup } from './helpers.js';
import { scanCodeInsights, insightsDigest } from '../src/engines/code-insight-engine.js';
import { proposeFeaturesWithBrain } from '../src/engines/feature-proposer-engine.js';
import { loadConfig } from '../src/core/state.js';

function seedProject(root) {
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'demo', version: '1.0.0',
    dependencies: { next: '14', '@nestjs/core': '10', typeorm: '0.3', pg: '8' },
    scripts: { dev: 'next dev' }
  }));
  let big = '// TODO: refactor\nexport function h(x: any): any { return x; }\n';
  for (let i = 0; i < 420; i += 1) big += `// line ${i}\n`;
  fs.writeFileSync(path.join(root, 'src', 'big.ts'), big);
}

test('scanCodeInsights detects stack, weaknesses and signals from real files', () => {
  const root = makeTempProject();
  try {
    seedProject(root);
    const s = scanCodeInsights(root);
    assert.match(s.detected_stack, /NestJS/);
    assert.match(s.detected_stack, /Next/);
    assert.equal(s.has_tests, false);
    assert.ok(s.files_using_any.length >= 1);
    assert.ok(s.largest_files[0].lines > 400);
    assert.ok(s.missing_quality_scripts.includes('test'));
    assert.ok(s.deterministic_weaknesses.length >= 3);
    assert.ok(s.todo_total >= 1);
  } finally { cleanup(root); }
});

test('insightsDigest is bounded and human-readable', () => {
  const root = makeTempProject();
  try {
    seedProject(root);
    const digest = insightsDigest(scanCodeInsights(root), 2000);
    assert.ok(digest.length <= 2100);
    assert.match(digest, /Stack:/);
    assert.match(digest, /Deterministic weaknesses/);
  } finally { cleanup(root); }
});

test('proposeFeaturesWithBrain falls back to evidence-based deterministic proposals when brain is down', async () => {
  const root = makeTempProject();
  try {
    seedProject(root);
    const config = loadConfig(root);
    process.env.ACF_CLAUDE_CODE_COMMAND = 'definitely-not-real-xyz';
    config.ai_intake = { ...config.ai_intake, fallback_chain: ['claude-code', 'heuristic'] };
    const payload = await proposeFeaturesWithBrain(root, config, {});
    delete process.env.ACF_CLAUDE_CODE_COMMAND;
    assert.equal(payload.source, 'deterministic-fallback');
    assert.ok(payload.proposals.length >= 3);
    // Every proposal must cite evidence (no hardcoded fluff).
    assert.ok(payload.proposals.every((p) => p.evidence && p.rationale));
    // Must surface the real measured weaknesses.
    assert.ok(payload.proposals.some((p) => /test/i.test(p.title)));
    assert.ok(fs.existsSync(path.join(root, '.ai', 'autonomy', 'proposals', 'feature-proposals.json')));
  } finally { cleanup(root); }
});

test('proposeFeaturesWithBrain uses the brain when available (mock provider)', async () => {
  const root = makeTempProject();
  try {
    seedProject(root);
    const config = loadConfig(root);
    // Mock claude CLI that returns valid proposal JSON. Node script invoked via
    // process.execPath so it runs identically on Windows and Unix (a bash mock
    // silently fails to spawn on Windows and masks the real assertion).
    const claude = path.join(root, 'mock-claude.cjs');
    fs.writeFileSync(claude, `try { require('node:fs').readFileSync(0, 'utf8'); } catch {}\nconsole.log(JSON.stringify({ summary: 'ok', proposals: [{ id: 'PROP-001', title: 'Add health endpoint', kind: 'feature', value: 'high', effort: 'low', risk: 'low', rationale: 'prod readiness', evidence: 'NestJS detected', suggested_workflow: 'backend-contract-first' }] }));\n`);
    config.ai_intake = { ...config.ai_intake, fallback_chain: ['claude-code', 'heuristic'], claude_code: { ...(config.ai_intake?.claude_code || {}), command: process.execPath, args: [claude], prompt_mode: 'stdin' } };
    const payload = await proposeFeaturesWithBrain(root, config, {});
    assert.equal(payload.source, 'brain');
    assert.equal(payload.proposals[0].title, 'Add health endpoint');
    assert.equal(payload.proposals[0].kind, 'feature');
  } finally { cleanup(root); }
});
