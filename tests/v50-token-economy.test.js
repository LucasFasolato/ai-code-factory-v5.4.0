import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempProject, cleanup } from './helpers.js';
import { recordUsage, checkReqBudgetBeforeCall, reqUsageSummary } from '../src/engines/usage-budget.js';
import { modelForDepth, buildBrainRoute } from '../src/engines/brain-router.js';
import { buildCostReport } from '../src/engines/cost-report-engine.js';
import { saveRepoMap, readRepoMapMd } from '../src/engines/repo-map-engine.js';

test('per-REQ circuit breaker trips on call count before cost', () => {
  const root = makeTempProject();
  try {
    const config = { usage_budget: { max_brain_calls_per_req: 3, per_req_hard_usd: 100 } };
    for (let i = 0; i < 3; i += 1) recordUsage(root, { kind: 'ai_intake', request_id: 'REQ-009', input_tokens: 10, output_tokens: 10, estimated_cost_usd: 0.01 });
    const check = checkReqBudgetBeforeCall(root, config, 'REQ-009', 0.01);
    assert.equal(check.allowed, false);
    assert.match(check.reason, /Circuit breaker/);
    // Another REQ is unaffected — the breaker is per request, not global.
    assert.equal(checkReqBudgetBeforeCall(root, config, 'REQ-010', 0.01).allowed, true);
  } finally { cleanup(root); }
});

test('per-REQ hard budget blocks projected overspend', () => {
  const root = makeTempProject();
  try {
    const config = { usage_budget: { per_req_hard_usd: 0.5, max_brain_calls_per_req: 100 } };
    recordUsage(root, { kind: 'ai_intake', request_id: 'REQ-011', input_tokens: 100, output_tokens: 100, estimated_cost_usd: 0.45 });
    const check = checkReqBudgetBeforeCall(root, config, 'REQ-011', 0.2);
    assert.equal(check.allowed, false);
    assert.match(check.reason, /Per-REQ budget/);
  } finally { cleanup(root); }
});

test('model cascade: senior defaults out of the box, overrides and cli opt-out respected', () => {
  // v5.4: cheap thinks the cheap OUT OF THE BOX (version-proof aliases).
  assert.equal(modelForDepth('fast', {}), 'haiku');
  assert.equal(modelForDepth('standard', {}), 'sonnet');
  assert.equal(modelForDepth('architect', {}), 'opus');
  // Per-tier override wins; unmapped tiers keep the senior default.
  const config = { brain_routing: { tier_models: { fast: 'claude-haiku-4-5', architect: 'claude-opus-4-8' } } };
  assert.equal(modelForDepth('fast', config), 'claude-haiku-4-5');
  assert.equal(modelForDepth('architect', config), 'claude-opus-4-8');
  assert.equal(modelForDepth('deep', config), 'sonnet', 'unmapped tiers use senior defaults');
  // Opt-out: inherit the CLI-configured model, per tier or globally.
  assert.equal(modelForDepth('fast', { brain_routing: { tier_models: { fast: 'cli' } } }), null);
  assert.equal(modelForDepth('deep', { brain_routing: { tier_models: 'cli' } }), null);
  const route = buildBrainRoute(process.cwd(), 'quick tweak', { difficulty: 'trivial', risk: 'low', work_type: 'small_change' }, config, { depth: 'fast' });
  assert.equal(route.model, 'claude-haiku-4-5');
});

test('cost report aggregates per-stage usage for a REQ', () => {
  const root = makeTempProject();
  try {
    recordUsage(root, { kind: 'ai_intake', request_id: 'REQ-020', input_tokens: 1000, output_tokens: 200, estimated_cost_usd: 0.05 });
    recordUsage(root, { kind: 'feature_review', request_id: 'REQ-020', input_tokens: 500, output_tokens: 100, estimated_cost_usd: 0.02 });
    recordUsage(root, { kind: 'ai_intake', request_id: 'REQ-999', input_tokens: 999, output_tokens: 999, estimated_cost_usd: 9 });
    const report = buildCostReport(root, 'REQ-020', {});
    assert.equal(report.summary.calls, 2, 'other REQs must not leak into the report');
    assert.match(report.markdown, /ai_intake: 1 call/);
    assert.match(report.markdown, /feature_review: 1 call/);
    assert.ok(fs.existsSync(report.file));
    const summary = reqUsageSummary(root, 'REQ-020');
    assert.equal(summary.input_tokens, 1500);
  } finally { cleanup(root); }
});

test('repo map builds a compact NestJS-aware skeleton', () => {
  const root = makeTempProject();
  try {
    fs.mkdirSync(path.join(root, 'src', 'reservations'), { recursive: true });
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { '@nestjs/core': '10.0.0', typeorm: '0.3.0' } }));
    fs.writeFileSync(path.join(root, 'src', 'reservations', 'reservations.controller.ts'), `
import { Controller, Get, Post } from '@nestjs/common';
@Controller('reservations')
export class ReservationsController {
  constructor(private readonly service: ReservationsService) {}
  @Get(':id')
  findOne(id: string) { return this.service.findOne(id); }
  @Post(':id/cancel')
  cancel(id: string, body: CancelDto) { return this.service.cancel(id, body); }
}
`);
    fs.writeFileSync(path.join(root, 'src', 'reservations', 'reservation.entity.ts'), `
import { Entity, Column } from 'typeorm';
@Entity()
export class Reservation { id: string; status: string; }
`);
    const { map, estimated_tokens } = saveRepoMap(root);
    assert.deepEqual(map.framework, ['nestjs', 'typeorm']);
    assert.equal(map.stats.controllers, 1);
    assert.equal(map.stats.entities, 1);
    assert.equal(map.stats.routes, 2);
    assert.ok(estimated_tokens < 500, 'skeleton must stay tiny');
    const md = readRepoMapMd(root);
    assert.match(md, /GET :id/);
    assert.match(md, /POST :id\/cancel/);
    assert.match(md, /class Reservation/);
  } finally { cleanup(root); }
});
