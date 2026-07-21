import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeTempProject, cleanup } from './helpers.js';
import { runDeterministicGates, diffFiles } from '../src/engines/deterministic-gates.js';

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r;
}

function initRepo(root) {
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@acf.dev']);
  git(root, ['config', 'user.name', 'ACF Test']);
  fs.writeFileSync(path.join(root, 'README.md'), '# test\n');
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'init', '--no-gpg-sign']);
}

test('migration gate fails when an entity changes without a migration, passes with one', () => {
  const root = makeTempProject();
  try {
    initRepo(root);
    fs.mkdirSync(path.join(root, 'src'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'reservation.entity.ts'), 'export class Reservation { id: string; status: string; }\n');
    let result = runDeterministicGates(root, 'REQ-001', {});
    const migration = result.checks.find((c) => c.id === 'database_migration');
    assert.equal(migration.passed, false, 'entity change without migration must fail');
    assert.equal(result.passed, false);

    fs.mkdirSync(path.join(root, 'migrations'), { recursive: true });
    fs.writeFileSync(path.join(root, 'migrations', '001-add-reservation.ts'), 'export class AddReservation {}\n');
    result = runDeterministicGates(root, 'REQ-001', {});
    const migration2 = result.checks.find((c) => c.id === 'database_migration');
    assert.equal(migration2.passed, true, 'entity change with migration must pass');
  } finally { cleanup(root); }
});

test('executable standards rules block forbidden patterns only in changed files', () => {
  const root = makeTempProject();
  try {
    initRepo(root);
    // Pre-existing violation committed to base: must NOT be flagged (diff-scoped).
    fs.mkdirSync(path.join(root, 'src', 'legacy'), { recursive: true });
    fs.writeFileSync(path.join(root, 'src', 'legacy', 'old.controller.ts'), 'import { Repository } from "typeorm";\n');
    git(root, ['add', '.']);
    git(root, ['commit', '-m', 'legacy', '--no-gpg-sign']);
    git(root, ['checkout', '-b', 'acf/req-002']);

    fs.mkdirSync(path.join(root, '.ai', 'standards'), { recursive: true });
    fs.writeFileSync(path.join(root, '.ai', 'standards', 'rules.json'), JSON.stringify([
      { id: 'no-db-in-controllers', description: 'Controllers must not access the database layer directly', files: ['.controller.ts'], forbidden_pattern: 'from .typeorm.', severity: 'error' }
    ]));

    // New violation on the branch: must be flagged.
    fs.writeFileSync(path.join(root, 'src', 'bad.controller.ts'), 'import { Repository } from \'typeorm\';\nexport class BadController {}\n');
    const result = runDeterministicGates(root, 'REQ-002', {}, { base: 'main' });
    const rule = result.checks.find((c) => c.id === 'rule:no-db-in-controllers');
    assert.equal(rule.passed, false);
    assert.ok(rule.violations.includes('src/bad.controller.ts'));
    assert.ok(!rule.violations.includes('src/legacy/old.controller.ts'), 'pre-existing violations outside the diff must not be flagged');

    // Fix the file: rule passes.
    fs.writeFileSync(path.join(root, 'src', 'bad.controller.ts'), 'export class BadController { constructor(private readonly service: GoodService) {} }\n');
    const fixed = runDeterministicGates(root, 'REQ-002', {}, { base: 'main' });
    assert.equal(fixed.checks.find((c) => c.id === 'rule:no-db-in-controllers').passed, true);
  } finally { cleanup(root); }
});

test('diffFiles excludes .ai noise and reports base branch', () => {
  const root = makeTempProject();
  try {
    initRepo(root);
    fs.writeFileSync(path.join(root, 'feature.ts'), 'export const x = 1;\n');
    fs.mkdirSync(path.join(root, '.ai', 'events'), { recursive: true });
    fs.writeFileSync(path.join(root, '.ai', 'events', 'noise.json'), '{}');
    const diff = diffFiles(root);
    assert.equal(diff.available, true);
    assert.ok(diff.files.includes('feature.ts'));
    assert.ok(diff.files.every((f) => !f.startsWith('.ai/')), '.ai runtime files must not pollute review scope');
  } finally { cleanup(root); }
});
