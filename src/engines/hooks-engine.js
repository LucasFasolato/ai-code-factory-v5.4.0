import fs from 'node:fs';
import path from 'node:path';
import { aiPath } from '../core/paths.js';
import { spawnSyncPortable } from '../core/spawn-portable.js';

// v5.2 Hooks — the Claude Code pattern: a Skill teaches the how, a HOOK
// enforces the rule with code. Deterministic, zero tokens, user-owned.
//
// Two ways to define a hook (both optional; absence = silent no-op):
//   1. Script file:  .ai/hooks/<name>.{js,cjs,mjs}  → run with node
//   2. Config:       config.hooks[name] = ["cmd", "arg1", ...]
//
// Payload arrives as JSON on stdin AND in env ACF_HOOK_PAYLOAD.
// Semantics (mirrors Claude Code exit-code convention):
//   - pre_* hooks: non-zero exit BLOCKS the stage; stderr becomes the reason.
//   - post_* hooks: never block; failures are recorded and the cycle continues.
// Supported points: pre_execute, post_execute, post_validate, pre_merge.

export const HOOK_POINTS = ['pre_execute', 'post_execute', 'post_validate', 'pre_merge'];

export function hooksDir(root) {
  return aiPath(root, 'hooks');
}

export function listHooks(root, config = {}) {
  const found = [];
  const dir = hooksDir(root);
  for (const name of HOOK_POINTS) {
    const script = findHookScript(dir, name);
    const configured = Array.isArray(config.hooks?.[name]) && config.hooks[name].length;
    if (script || configured) found.push({ name, script: script || null, configured: Boolean(configured) });
  }
  return found;
}

export function runHook(root, name, payload = {}, config = {}) {
  const result = { name, ran: false, blocked: false, exit_code: null, output: '', error: null };
  const invocation = resolveInvocation(root, name, config);
  if (!invocation) return result; // no hook defined → no-op

  try {
    const json = JSON.stringify(payload);
    const spawn = spawnSyncPortable(invocation.command, invocation.args, {
      cwd: root,
      input: json,
      encoding: 'utf8',
      timeout: Number(config.hooks?.timeout_ms || 60000),
      env: { ...process.env, ACF_HOOK_NAME: name, ACF_HOOK_PAYLOAD: json },
      maxBuffer: 5 * 1024 * 1024
    });
    result.ran = true;
    result.exit_code = spawn.status;
    result.output = `${String(spawn.stdout || '').trim()}${spawn.stderr ? `\n${String(spawn.stderr).trim()}` : ''}`.trim().slice(0, 2000);
    if (spawn.error) result.error = String(spawn.error.message || spawn.error);
    if (name.startsWith('pre_') && (spawn.status !== 0 || spawn.error)) {
      result.blocked = true;
    }
  } catch (error) {
    result.error = String(error.message || error);
    if (name.startsWith('pre_')) result.blocked = true;
  }
  return result;
}

function resolveInvocation(root, name, config = {}) {
  const configured = config.hooks?.[name];
  if (Array.isArray(configured) && configured.length) {
    return { command: configured[0], args: configured.slice(1) };
  }
  const script = findHookScript(hooksDir(root), name);
  if (script) return { command: process.execPath, args: [script] };
  return null;
}

function findHookScript(dir, name) {
  if (!fs.existsSync(dir)) return null;
  for (const ext of ['.js', '.cjs', '.mjs']) {
    const candidate = path.join(dir, `${name}${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// `hooks init` scaffolding: a working, commented example the user edits.
export function scaffoldHooks(root) {
  const dir = hooksDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const sample = path.join(dir, 'pre_merge.example.js');
  if (!fs.existsSync(sample)) {
    fs.writeFileSync(sample, [
      '#!/usr/bin/env node',
      '// AI Code Factory hook example. Rename to pre_merge.js to activate.',
      '// Payload: JSON on stdin and in process.env.ACF_HOOK_PAYLOAD.',
      '// pre_* hooks: process.exit(1) BLOCKS the stage (stderr = reason shown to the user).',
      '// post_* hooks: exit code is recorded but never blocks.',
      '',
      "const payload = JSON.parse(process.env.ACF_HOOK_PAYLOAD || '{}');",
      '',
      '// Example: block merges of high-risk work outside working hours.',
      "// if (payload.risk === 'high' && new Date().getHours() >= 18) {",
      "//   console.error('High-risk merges are not allowed after 18:00. Merge tomorrow with fresh eyes.');",
      '//   process.exit(1);',
      '// }',
      '',
      "// Example: run npm audit and block on high vulnerabilities (uncomment):",
      "// const { execSync } = require('node:child_process');",
      "// try { execSync('npm audit --audit-level=high', { stdio: 'inherit' }); }",
      "// catch { console.error('npm audit found high-severity vulnerabilities.'); process.exit(1); }",
      '',
      'process.exit(0);',
      ''
    ].join('\n'), 'utf8');
  }
  return { dir, sample, points: HOOK_POINTS };
}
