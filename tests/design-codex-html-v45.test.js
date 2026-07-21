import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempProject, cleanup, createRequest } from './helpers.js';
import {
  generateDesignPromptPack,
  validateDesignArtifact,
  resolveOptionArtifact,
  detectHtmlRenderer,
  designDoctor,
  approveDesign
} from '../src/engines/design-engine.js';
import { loadConfig } from '../src/core/state.js';
import { requestPaths } from '../src/core/paths.js';
import { readJson } from '../src/core/fs.js';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const VALID_PNG = Buffer.concat([PNG_HEADER, Buffer.alloc(8192, 0x20)]);
const VALID_HTML = `<!doctype html><html><head><style>body{font-family:sans-serif}</style></head><body><main><h1>Hero</h1><section>${'x'.repeat(900)}</section></main></body></html>`;

function writeMockCodex(root, mode) {
  const mock = path.join(root, `mock-codex-${mode}.js`);
  const body = mode === 'html'
    ? `
const fs=require('node:fs');const path=require('node:path');
const root=process.cwd();
const prompts=path.join(root,'.ai','designs','prompts');
const jobFile=fs.readdirSync(prompts).find(n=>n.includes('-codex-design-job-option-')&&n.endsWith('.json'));
const job=JSON.parse(fs.readFileSync(path.join(prompts,jobFile),'utf8'));
const html=${JSON.stringify(VALID_HTML)};
for(const t of Object.values(job.html_targets||{})){for(const rel of [t.desktop,t.mobile]){const abs=path.join(root,rel);fs.mkdirSync(path.dirname(abs),{recursive:true});fs.writeFileSync(abs,html);}}
console.log('mock codex wrote html mockups');
`
    : `
const fs=require('node:fs');const path=require('node:path');
const root=process.cwd();
const prompts=path.join(root,'.ai','designs','prompts');
const jobFile=fs.readdirSync(prompts).find(n=>n.includes('-codex-design-job-option-')&&n.endsWith('.json'));
const job=JSON.parse(fs.readFileSync(path.join(prompts,jobFile),'utf8'));
// Simulate a code agent that cannot create images: writes nothing usable.
console.log('codex: no image tooling available');
`;
  fs.writeFileSync(mock, body);
  return mock;
}

test('validateDesignArtifact rejects empty/undersized files and bad signatures', () => {
  const root = makeTempProject();
  try {
    const tiny = path.join(root, 'tiny.png');
    fs.writeFileSync(tiny, PNG_HEADER); // 8 bytes, below threshold
    assert.equal(validateDesignArtifact(tiny).valid, false);

    const big = path.join(root, 'big.png');
    fs.writeFileSync(big, VALID_PNG);
    assert.equal(validateDesignArtifact(big).valid, true);

    const fakePng = path.join(root, 'fake.png');
    fs.writeFileSync(fakePng, Buffer.alloc(9000, 0x41)); // big but no PNG signature
    assert.equal(validateDesignArtifact(fakePng).valid, false);

    const html = path.join(root, 'm.html');
    fs.writeFileSync(html, VALID_HTML);
    assert.equal(validateDesignArtifact(html).valid, true);

    const emptyHtml = path.join(root, 'empty.html');
    fs.writeFileSync(emptyHtml, '<div>hi</div>');
    assert.equal(validateDesignArtifact(emptyHtml).valid, false);
  } finally { cleanup(root); }
});

test('resolveOptionArtifact finds HTML when planned path was PNG', () => {
  const root = makeTempProject();
  try {
    const rel = '.ai/designs/generated/REQ-001-option-a-desktop.png';
    const htmlAbs = path.join(root, rel.replace(/\.png$/, '.html'));
    fs.mkdirSync(path.dirname(htmlAbs), { recursive: true });
    fs.writeFileSync(htmlAbs, VALID_HTML);
    const resolved = resolveOptionArtifact(root, rel);
    assert.equal(resolved.valid, true);
    assert.equal(resolved.kind, 'html');
    assert.ok(resolved.rel.endsWith('.html'));
  } finally { cleanup(root); }
});

test('codex html-first: HTML mockups are accepted as valid artifacts (no renderer needed)', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const mock = writeMockCodex(root, 'html');
    config.design.default_provider = 'gpt-image';
    config.design.providers['gpt-image'].kind = 'gpt-image-codex';
    config.design.providers['gpt-image'].codex = { command: process.execPath, args: [mock] };
    config.design.rasterize_html = false; // force the no-browser path
    const { requestId } = createRequest(root, 'Landing premium para FAS Propiedades con hero y before/after', config);
    const result = generateDesignPromptPack(root, requestId, config, { noFallback: true });
    assert.ok(['design_ready', 'generated'].includes(result.manifest.status), `status was ${result.manifest.status}`);
    const ready = result.manifest.options.filter((o) => o.artifacts_exist);
    assert.ok(ready.length >= 1, 'at least one option should have valid HTML artifacts');
    assert.equal(ready[0].artifact_kind, 'html');
    // An HTML-backed option must be approvable (the original bug blocked this).
    const approved = approveDesign(root, requestId, ready[0].id);
    assert.equal(approved.approved.approved_design, ready[0].id);
  } finally { cleanup(root); }
});

test('fallback chain: failed codex falls back to wireframe-mock automatically', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const mock = writeMockCodex(root, 'fail');
    config.design.default_provider = 'gpt-image';
    config.design.providers['gpt-image'].kind = 'gpt-image-codex';
    config.design.providers['gpt-image'].codex = { command: process.execPath, args: [mock] };
    const { requestId } = createRequest(root, 'Landing premium para inmobiliaria', config);
    const result = generateDesignPromptPack(root, requestId, config);
    assert.ok(result.manifest.options.some((o) => o.artifacts_exist), 'fallback should produce artifacts');
    assert.equal(result.manifest.fallback_from, 'gpt-image');
    assert.match(result.manifest.note, /fell back to wireframe-mock/i);
  } finally { cleanup(root); }
});

test('--no-fallback keeps a failed codex run honest (no silent wireframes)', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const mock = writeMockCodex(root, 'fail');
    config.design.default_provider = 'gpt-image';
    config.design.providers['gpt-image'].kind = 'gpt-image-codex';
    config.design.providers['gpt-image'].codex = { command: process.execPath, args: [mock] };
    const { requestId } = createRequest(root, 'Landing premium para inmobiliaria', config);
    const result = generateDesignPromptPack(root, requestId, config, { noFallback: true });
    assert.equal(result.manifest.status, 'prompt_pack_ready');
    assert.ok(!result.manifest.options.some((o) => o.artifacts_exist));
  } finally { cleanup(root); }
});

test('designDoctor reports provider, strategy and predicted behavior', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const report = designDoctor(root, config);
    assert.ok(report.status === 'ok' || report.status === 'attention_required');
    assert.equal(report.strategy, 'html-first');
    assert.ok(Array.isArray(report.checks) && report.checks.length >= 5);
    assert.ok(typeof report.predicted_behavior === 'string' && report.predicted_behavior.length > 0);
    assert.ok(report.fallback_chain.includes('wireframe-mock'));
  } finally { cleanup(root); }
});

test('detectHtmlRenderer never throws and returns a structured result', () => {
  const result = detectHtmlRenderer({});
  assert.equal(typeof result.available, 'boolean');
  assert.ok('command' in result);
});
