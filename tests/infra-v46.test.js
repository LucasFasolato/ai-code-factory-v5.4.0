import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { makeTempProject, cleanup, createRequest } from './helpers.js';
import { withLock } from '../src/core/lock.js';
import { nextRequestId, ensureAiWorkspace } from '../src/core/state.js';
import { runExecutor } from '../src/engines/executor-orchestrator.js';
import { runSystemDoctor } from '../src/engines/system-doctor.js';
import { evaluateGates } from '../src/engines/gate-engine.js';
import { loadConfig } from '../src/core/state.js';
import { requestPaths } from '../src/core/paths.js';
import { readJson } from '../src/core/fs.js';

test('withLock serializes access and releases the lock', () => {
  const root = makeTempProject();
  try {
    const target = path.join(root, '.ai', 'counter.json');
    fs.writeFileSync(target, JSON.stringify({ n: 0 }));
    for (let i = 0; i < 5; i += 1) {
      withLock(target, () => {
        const data = JSON.parse(fs.readFileSync(target, 'utf8'));
        data.n += 1;
        fs.writeFileSync(target, JSON.stringify(data));
      });
      // Lock dir must not linger after the critical section.
      assert.equal(fs.existsSync(`${target}.lock`), false);
    }
    assert.equal(JSON.parse(fs.readFileSync(target, 'utf8')).n, 5);
  } finally { cleanup(root); }
});

test('withLock breaks a stale lock left by a crashed process', () => {
  const root = makeTempProject();
  try {
    const target = path.join(root, '.ai', 'x.json');
    fs.mkdirSync(`${target}.lock`, { recursive: true });
    // Backdate the lock so it counts as stale.
    const old = new Date(Date.now() - 60000);
    fs.utimesSync(`${target}.lock`, old, old);
    let ran = false;
    withLock(target, () => { ran = true; }, { staleMs: 1000, retries: 3 });
    assert.equal(ran, true);
  } finally { cleanup(root); }
});

test('nextRequestId yields unique IDs across concurrent processes', async () => {
  const root = makeTempProject();
  try {
    const childFile = path.join(os.tmpdir(), `acf-lock-child-${Date.now()}.mjs`);
    // Windows ESM requires file:// URLs for absolute-path imports; a raw 'C:\\...' path throws ERR_UNSUPPORTED_ESM_URL_SCHEME.
    fs.writeFileSync(childFile, `import { nextRequestId } from '${pathToFileURL(path.resolve('src/core/state.js')).href}';process.stdout.write(nextRequestId(process.argv[2]));`);
    const N = 10;
    const ids = await Promise.all(Array.from({ length: N }, () => new Promise((res) => {
      const p = spawn(process.execPath, [childFile, root], { stdio: ['ignore', 'pipe', 'inherit'] });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.on('exit', () => res(out.trim()));
    })));
    fs.rmSync(childFile, { force: true });
    const unique = new Set(ids.filter(Boolean));
    assert.equal(unique.size, N, `expected ${N} unique IDs, got ${unique.size}: ${ids.join(',')}`);
  } finally { cleanup(root); }
});

test('honest-success guard downgrades exit-0-but-no-files to no_op', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    // Make the executor a command that exits 0 and touches nothing.
    config.execution = { ...config.execution, enabled: true, primary: 'true', dry_run_when_missing_executor: true };
    const { requestId } = createRequest(root, 'Arreglar el endpoint de login en el backend NestJS', config);
    // Force an implementing work type expectation by ensuring intake says implement.
    const intakePath = requestPaths(root, requestId).intake;
    const intake = readJson(intakePath, {});
    intake.should_implement_now = true;
    intake.work_type = intake.work_type === 'general' ? 'small_change' : intake.work_type;
    intake.requires_decomposition = false;
    fs.writeFileSync(intakePath, JSON.stringify(intake, null, 2));

    const result = runExecutor(root, requestId, config, {});
    // git is unavailable in temp dirs (files_touched === null) → guard must NOT misfire.
    if (result.files_touched === null) {
      assert.notEqual(result.status, 'no_op', 'guard must not fire when git is unavailable');
    } else if (result.files_touched.length === 0 && result.status !== 'dry_run') {
      assert.equal(result.status, 'no_op');
    }
  } finally { cleanup(root); }
});

test('runSystemDoctor aggregates sections and detects version drift', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    // Introduce drift.
    const cfgPath = path.join(root, '.ai', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    cfg.version = '0.0.0-test-drift';
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

    const report = runSystemDoctor(root, config);
    assert.ok(['ok', 'warnings', 'attention_required'].includes(report.status));
    const names = report.sections.map((s) => s.name);
    for (const expected of ['version', 'executors', 'brain', 'design', 'state', 'mcp']) {
      assert.ok(names.includes(expected), `missing section: ${expected}`);
    }
    const versionChecks = report.sections.find((s) => s.name === 'version').checks;
    assert.ok(versionChecks.some((c) => c.id === 'config_version_drift' && c.status === 'warning'));
  } finally { cleanup(root); }
});
