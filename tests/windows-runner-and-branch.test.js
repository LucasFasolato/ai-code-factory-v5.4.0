import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { makeTempProject, cleanup, createRequest } from './helpers.js';
import { buildPortableSpawn, normalizeWindowsCommand } from '../src/core/spawn-portable.js';
import { runTechnicalValidation, buildExecutorCommand } from '../src/engines/executor-orchestrator.js';
import { bootstrapProject } from '../src/engines/project-bootstrap.js';
import { ensureRequestBranch, finalizeRequestBranch, gitWorkflowStatus } from '../src/engines/git-workflow.js';
import { loadConfig } from '../src/core/state.js';

test('portable spawn maps npm/npx to .cmd wrappers on Windows without shell:true', () => {
  assert.equal(normalizeWindowsCommand('npm', 'win32'), 'npm.cmd');
  assert.equal(normalizeWindowsCommand('npx', 'win32'), 'npx.cmd');
  assert.equal(normalizeWindowsCommand('npm', 'linux'), 'npm');
  const plan = buildPortableSpawn('npm', ['run', 'lint'], { cwd: 'C:/repo' }, 'win32');
  assert.equal(plan.command, 'cmd.exe');
  assert.deepEqual(plan.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.match(plan.args[3], /npm\.cmd run lint/);
  assert.equal(plan.options.shell, false);
});

test('validation runner executes npm scripts through portable runner', () => {
  const root = makeTempProject();
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
      name: 'demo',
      version: '1.0.0',
      scripts: {
        lint: 'node -e "process.exit(0)"',
        typecheck: 'node -e "process.exit(0)"',
        test: 'node -e "process.exit(0)"',
        build: 'node -e "process.exit(0)"'
      }
    }, null, 2));
    const config = loadConfig(root);
    const result = runTechnicalValidation(root, 'REQ-001', config);
    assert.equal(result.status, 'passed');
    assert.equal(result.commands.every((c) => c.exit_code === 0 && c.success), true);
  } finally { cleanup(root); }
});

test('codex executor command always includes skip-git-repo-check for automation', () => {
  const built = buildExecutorCommand('codex', { execution: { codex: { command: 'codex', args: ['exec', '--sandbox', 'workspace-write', '-C'] } } }, 'C:/repo', 'do it');
  assert.ok(built.args.includes('--skip-git-repo-check'));
  assert.equal(built.shell, false);
});

test('project bootstrap adds missing validation scripts', () => {
  const root = makeTempProject();
  try {
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'demo', version: '1.0.0', scripts: { build: 'echo build' } }, null, 2));
    const result = bootstrapProject(root, loadConfig(root), { dryRun: false });
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.typecheck, 'tsc --noEmit');
    assert.ok(pkg.scripts.test);
    assert.ok(result.changed.includes('package.json:scripts.typecheck'));
  } finally { cleanup(root); }
});

test('git workflow creates request branch and merges it back to base', { skip: !hasGit() }, () => {
  const root = makeTempProject();
  try {
    execFileSync('git', ['init', '-q'], { cwd: root });
    fs.writeFileSync(path.join(root, 'README.md'), '# demo\n');
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.local', 'add', '-A'], { cwd: root });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.local', 'commit', '-m', 'initial'], { cwd: root, stdio: 'ignore' });
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'agregar health check', config);
    const branch = ensureRequestBranch(root, requestId, config);
    assert.equal(branch.status, 'on_request_branch');
    assert.match(branch.branch, /^acf\/req-\d{3}/);
    fs.writeFileSync(path.join(root, 'src-created.txt'), 'ok\n');
    const merged = finalizeRequestBranch(root, requestId, config);
    assert.equal(merged.status, 'merged');
    assert.equal(gitWorkflowStatus(root).current_branch, merged.merged_to);
    assert.equal(fs.existsSync(path.join(root, 'src-created.txt')), true);
  } finally { cleanup(root); }
});

function hasGit() {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
