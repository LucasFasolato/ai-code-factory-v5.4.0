import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempProject, cleanup, createRequest } from './helpers.js';
import { loadConfig } from '../src/core/state.js';
import { initStandards, standardsStatus, setQualityProfile } from '../src/engines/standards-engine.js';
import { designCostPreview, generateDesignPromptPack } from '../src/engines/design-engine.js';
import { productScan, proposeFeatures, autonomousCycle, createReqFromProposal } from '../src/engines/product-loop-engine.js';
import { runFrontendReview, runSecurityReview } from '../src/engines/senior-review-engine.js';
import { generateApiContract, generateAdr } from '../src/engines/contract-adr-engine.js';
import { readJson, readText } from '../src/core/fs.js';
import { requestPaths } from '../src/core/paths.js';

test('standards init and quality profile create senior convention artifacts', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const result = initStandards(root, config, 'production');
    assert.equal(result.profile, 'production');
    const status = standardsStatus(root);
    assert.equal(status.exists, true);
    assert.ok(status.files.every((f) => f.exists));
    const ent = setQualityProfile(root, 'enterprise', config);
    assert.equal(ent.profile, 'enterprise');
  } finally { cleanup(root); }
});

test('gpt-image provider uses Codex as design provider and verifies generated artifacts', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const mock = path.join(root, 'mock-codex-design-provider.js');
    fs.writeFileSync(mock, `
const fs = require('node:fs');
const path = require('node:path');
const root = process.cwd();
const prompts = path.join(root, '.ai', 'designs', 'prompts');
const jobFile = fs.readdirSync(prompts).find((name) => name.includes('-codex-design-job-option-') && name.endsWith('.json'));
const job = JSON.parse(fs.readFileSync(path.join(prompts, jobFile), 'utf8'));
const pngHeader = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]);
const validPng = Buffer.concat([pngHeader, Buffer.alloc(8192, 0x20)]);
for (const pair of Object.values(job.output_targets)) {
  for (const rel of [pair.desktop, pair.mobile]) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, validPng);
  }
}
const sheet = path.join(root, job.contact_sheet || '.ai/designs/generated/contact-sheet.png');
fs.mkdirSync(path.dirname(sheet), { recursive: true });
fs.writeFileSync(sheet, validPng);
console.log('mock codex generated staged option artifacts');
`);
    config.design.default_provider = 'gpt-image';
    config.design.providers['gpt-image'].kind = 'gpt-image-codex';
    config.design.providers['gpt-image'].codex = { command: process.execPath, args: [mock] };
    const { requestId } = createRequest(root, 'Landing premium para FAS Propiedades con hero y before/after', config);
    const result = generateDesignPromptPack(root, requestId, config, { noFallback: true });
    assert.equal(result.manifest.status, 'design_ready');
    assert.ok(result.manifest.options.some((option) => option.artifacts_exist));
    assert.match(result.manifest.note, /generated 1\/3 option/);
    const preview = designCostPreview(config, 6);
    assert.equal(preview.provider, 'gpt-image');
  } finally { cleanup(root); }
});

test('product loop proposes features and supervised cycle blocks on design approval', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Landing visual para FAS Propiedades', config);
    const scan = productScan(root);
    assert.ok(scan.design_blockers.includes(requestId));
    const proposals = proposeFeatures(root, config);
    assert.ok(proposals.proposals.length >= 1);
    const cycle = autonomousCycle(root, config, { mode: 'supervised' });
    assert.equal(cycle.status, 'blocked_waiting_user');
  } finally { cleanup(root); }
});

test('create request from proposal and generate API contract/ADR', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    proposeFeatures(root, config);
    const req = createReqFromProposal(root, 'PROP-003');
    assert.match(req.id, /^REQ-/);
    const { requestId } = createRequest(root, 'Crear endpoint GET /properties con filtros', config);
    const api = generateApiContract(root, requestId);
    assert.equal(api.contract.method, 'GET');
    assert.match(api.contract.path, /properties/);
    const adr = generateAdr(root, 'Use DTO validation', 'All external input must be validated.');
    assert.match(readText(adr.path, ''), /Use DTO validation/);
  } finally { cleanup(root); }
});

test('senior reviews generate artifacts and scores', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Landing visual para FAS Propiedades', config);
    const front = runFrontendReview(root, requestId);
    const sec = runSecurityReview(root, requestId);
    assert.match(front.markdown, /Frontend Senior Review/);
    assert.match(sec.markdown, /Security Review/);
    assert.equal(typeof front.score, 'number');
  } finally { cleanup(root); }
});
