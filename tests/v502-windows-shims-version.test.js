import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildPortableSpawn, resolveWindowsCommand } from '../src/core/spawn-portable.js';
import { VERSION } from '../src/defaults.js';

// v5.0.2 regression suite for the two bugs found on the first real Windows run:
// `spawnSync claude ENOENT` (npm .cmd shims beyond npm/npx) and a doctor that
// still announced v4.7.1.

test('bare npm-shim commands (claude, codex) resolve to .cmd and route through cmd.exe on win32', () => {
  // Real `where claude` output shape: the extensionless sh shim lists FIRST.
  // v5.0.2 took the first line and kept ENOENT alive; the .cmd must win.
  const lookup = (cmd) => [
    `C:\\Users\\dev\\AppData\\Roaming\\npm\\${cmd}`,
    `C:\\Users\\dev\\AppData\\Roaming\\npm\\${cmd}.cmd`,
    `C:\\Users\\dev\\AppData\\Roaming\\npm\\${cmd}.ps1`
  ];
  const plan = buildPortableSpawn('claude', ['-p', '--output-format', 'json'], {}, 'win32', lookup);
  assert.equal(plan.command, 'cmd.exe', '.cmd shims must run through the cmd.exe wrapper');
  assert.ok(plan.args.join(' ').includes('claude.cmd'));
  assert.ok(plan.args.join(' ').includes('--output-format'));
  assert.equal(plan.options.shell, false);
});

test('native .exe installs keep the bare name (CreateProcess resolves .exe itself)', () => {
  const lookup = () => ['C:\\Program Files\\Claude\\claude.exe'];
  const resolved = resolveWindowsCommand('claude-native-test', 'win32', lookup);
  assert.equal(resolved, 'claude-native-test', 'only .cmd/.bat need overriding');
});

test('exe earlier in PATH order beats a later .cmd shim (mirrors shell resolution)', () => {
  const lookup = () => ['C:\\Tools\\mytool.exe', 'C:\\npm\\mytool.cmd'];
  const resolved = resolveWindowsCommand('acf-order-probe', 'win32', lookup);
  assert.equal(resolved, 'acf-order-probe', 'PATH-first exe wins → bare spawn');
});

test('missing commands stay untouched so ENOENT surfaces honestly', () => {
  const resolved = resolveWindowsCommand('acf-no-such-tool', 'win32', () => null);
  assert.equal(resolved, 'acf-no-such-tool');
});

test('resolution result is cached (where runs once per command name)', () => {
  let calls = 0;
  const lookup = (cmd) => { calls += 1; return [`C:\\npm\\${cmd}.cmd`]; };
  resolveWindowsCommand('acf-cache-probe', 'win32', lookup);
  resolveWindowsCommand('acf-cache-probe', 'win32', lookup);
  assert.equal(calls, 1);
});

test('static shims and explicit paths never hit where', () => {
  const explode = () => { throw new Error('where must not be called'); };
  assert.equal(resolveWindowsCommand('npm', 'win32', explode), 'npm.cmd');
  assert.equal(resolveWindowsCommand('C:\\tools\\claude.cmd', 'win32', explode), 'C:\\tools\\claude.cmd');
  assert.equal(resolveWindowsCommand('node.exe', 'win32', explode), 'node.exe');
  assert.equal(resolveWindowsCommand('claude', 'linux', explode), 'claude');
});

test('VERSION is single-sourced from package.json (no more doctor drift)', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
});

test('setup command onboards an existing project end-to-end (init→bootstrap→map→agents→policy→golden)', async () => {
  const { execFileSync } = await import('node:child_process');
  const os = await import('node:os');
  const root = fs.mkdtempSync(`${os.tmpdir()}/acf-setup-`);
  try {
    execFileSync('git', ['init', '-qb', 'main'], { cwd: root });
    fs.mkdirSync(`${root}/src`, { recursive: true });
    fs.writeFileSync(`${root}/package.json`, JSON.stringify({ name: 'setup-demo', dependencies: { next: '15.0.0' } }));
    fs.writeFileSync(`${root}/src/index.ts`, 'export const x = 1;\n');
    const { fileURLToPath } = await import('node:url');
    // URL.pathname on Windows yields "/C:/..." which node reads as "C:\C:\..." — fileURLToPath is mandatory.
    const out = execFileSync(process.execPath, [fileURLToPath(new URL('../src/cli.js', import.meta.url)), 'setup'], { cwd: root, encoding: 'utf8' });
    assert.match(out, /EXISTING project \(setup-demo\)/);
    assert.match(out, /Setup complete/);
    assert.ok(fs.existsSync(`${root}/.ai/config.json`));
    assert.ok(fs.existsSync(`${root}/.ai/project-map.json`));
    assert.ok(fs.existsSync(`${root}/AGENTS.md`));
    assert.ok(fs.existsSync(`${root}/CLAUDE.md`));
    assert.match(fs.readFileSync(`${root}/.gitignore`, 'utf8'), /acf:git-policy:start/);
    assert.ok(fs.readdirSync(`${root}/.ai/golden`).length >= 6);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
