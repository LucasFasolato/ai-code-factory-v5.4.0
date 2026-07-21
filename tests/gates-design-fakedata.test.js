import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempProject, cleanup, createRequest, writeFakePng } from './helpers.js';
import { evaluateGates } from '../src/engines/gate-engine.js';
import { importDesign, approveDesign, generateDesignPromptPack, normalizeDesignOptionId } from '../src/engines/design-engine.js';
import { scanFakeData } from '../src/engines/fake-data-scanner.js';
import { loadConfig } from '../src/core/state.js';
import { requestPaths } from '../src/core/paths.js';
import { readJson } from '../src/core/fs.js';

test('design-first blocks close until approved design + visual acceptance (KF-003)', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Landing premium para inmobiliaria FAS Propiedades', config);
    const gates = evaluateGates(root, requestId, config);
    assert.equal(gates.close_allowed, false);
    assert.ok(gates.close_blockers.some((b) => /approved design/i.test(b)));
  } finally { cleanup(root); }
});

test('design-approve "option-b-desktop" resolves option-b, never falls back to recommended (KF-001)', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Landing premium para inmobiliaria', config);
    const png = writeFakePng(root);
    importDesign(root, requestId, png); // creates option-imported-a, recommended
    // Add an option-b manually to the manifest with real artifact
    const manifestFile = requestPaths(root, requestId).designManifest;
    const manifest = readJson(manifestFile, null);
    const optionB = { id: `${requestId}-option-b`, label: 'Option B', desktop_image: manifest.options[0].desktop_image, artifacts_exist: true };
    manifest.options.push(optionB);
    manifest.recommended_option = manifest.options[0].id; // recommended = option A
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

    const result = approveDesign(root, requestId, 'option-b-desktop');
    assert.equal(result.approved.approved_design, `${requestId}-option-b`);
    assert.notEqual(result.approved.approved_design, manifest.recommended_option);
  } finally { cleanup(root); }
});

test('normalizeDesignOptionId handles uppercase, file paths and device suffixes', () => {
  const manifest = { options: [{ id: 'REQ-001-option-b', label: 'Option B', desktop_image: '.ai/designs/generated/REQ-001-option-b-desktop.png' }] };
  for (const raw of ['option-b', 'OPTION-B', 'option-b-desktop', 'REQ-001-option-b', '.ai/designs/generated/REQ-001-option-b-desktop.png']) {
    const result = normalizeDesignOptionId(raw, 'REQ-001', manifest);
    assert.equal(result.ok, true, `failed for: ${raw}`);
    assert.equal(result.option.id, 'REQ-001-option-b');
  }
});

test('approve rejects options without real artifacts (prompt-pack placeholders)', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    // Test isolation: never let a unit test reach a real installed codex CLI.
    // Without this, on machines where codex IS installed the engine spawns a
    // real design job (minutes of wall time + real plan tokens burned).
    process.env.ACF_DESIGN_CODEX_COMMAND = 'acf-missing-codex-for-tests';
    const { requestId } = createRequest(root, 'Landing premium para portfolio', config);
    generateDesignPromptPack(root, requestId, config, { noFallback: true }); // creates options with artifacts_exist:false
    assert.throws(() => approveDesign(root, requestId, 'option-a'), /artifacts missing/i);
  } finally { delete process.env.ACF_DESIGN_CODEX_COMMAND; cleanup(root); }
});

test('fake data scanner detects invented phone/email/metrics and blocks gate (KF-002)', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const srcDir = path.join(root, 'app');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'page.tsx'),
      `export default function P(){return <footer>Tel: +54 11 4444-5555 — contacto@fasprop.com — 15 años de experiencia — Buenos Aires</footer>}`);
    const scan = scanFakeData(root, config);
    assert.equal(scan.status, 'failed');
    const patterns = scan.findings.map((f) => f.pattern);
    assert.ok(patterns.includes('arg-phone'));
    assert.ok(patterns.includes('email'));
    assert.ok(patterns.includes('location-ba'));
    assert.ok(patterns.includes('years-experience'));

    const { requestId } = createRequest(root, 'Landing para inmobiliaria', config);
    const gates = evaluateGates(root, requestId, config);
    assert.equal(gates.gates.fake_data.status, 'failed');
    assert.ok(gates.close_blockers.some((b) => /fake_data/i.test(b)));
  } finally { cleanup(root); }
});

test('explicit placeholders pass the fake data scanner', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const srcDir = path.join(root, 'app');
    fs.mkdirSync(srcDir, { recursive: true });
    fs.writeFileSync(path.join(srcDir, 'page.tsx'),
      `export default function P(){return <footer>Email pendiente — Teléfono pendiente — <a href="#contacto">Contacto</a></footer>}`);
    const scan = scanFakeData(root, config);
    assert.equal(scan.status, 'passed');
  } finally { cleanup(root); }
});
