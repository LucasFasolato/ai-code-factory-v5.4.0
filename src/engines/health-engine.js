import fs from 'node:fs';
import path from 'node:path';
import { aiPath } from '../core/paths.js';
import { exists, readJson } from '../core/fs.js';
import { listBacklog } from '../core/state.js';
import { commandExists, runCommand } from '../core/command-runner.js';

export function projectHealth(root) {
  const checks = [];
  checks.push(check('ai-workspace', exists(aiPath(root, 'config.json')), '.ai/config.json exists'));
  checks.push(check('state', exists(aiPath(root, 'state.json')), '.ai/state.json exists'));
  checks.push(check('events', exists(aiPath(root, 'events', 'events.ndjson')), 'Event log exists'));
  checks.push(check('codex', commandExists('codex'), 'Codex CLI available'));
  checks.push(check('claude', commandExists('claude'), 'Claude CLI available'));
  checks.push(check('mcp-registry', exists(aiPath(root, 'mcp', 'registry.json')), 'MCP registry exists'));
  checks.push(check('project-dna', exists(aiPath(root, 'project-dna.json')), 'Project DNA exists'));
  const backlog = listBacklog(root);
  checks.push(check('backlog', backlog.length >= 0, `${backlog.length} backlog items`));
  const active = readJson(aiPath(root, 'state.json'), {})?.active_request_id;
  if (active) {
    checks.push(check('active-request', exists(aiPath(root, 'backlog', `${active}.json`)), `Active request ${active} exists`));
    checks.push(check('active-gates', exists(aiPath(root, 'reasoning', 'gates', `${active}-gates.json`)), `Gates exist for ${active}`));
  }
  const git = gitStatus(root);
  if (git.available) checks.push(check('git-status', git.clean, git.clean ? 'Git working tree clean' : 'Git has uncommitted changes'));
  const score = Math.max(0, Math.round((checks.filter((c) => c.ok).length / Math.max(checks.length, 1)) * 100));
  return { score, checks, active_request_id: active || null, git };
}

function check(id, ok, message) { return { id, ok: Boolean(ok), message }; }

function gitStatus(root) {
  if (!fs.existsSync(path.join(root, '.git'))) return { available: false, clean: null, output: '' };
  const result = runCommand('git', ['status', '--short'], { cwd: root, timeout: 30000 });
  return { available: result.success, clean: result.success && result.stdout.trim() === '', output: result.stdout || result.stderr };
}
