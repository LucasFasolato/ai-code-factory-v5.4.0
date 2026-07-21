import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { readJson } from './fs.js';
import { spawnSyncPortable } from './spawn-portable.js';
import { truncate } from './format.js';

export function commandExists(command) {
  // Absolute or relative paths (e.g. process.execPath = "C:\\Program Files\\nodejs\\node.exe")
  // are not PATH lookups: Windows `where` fails on them, reporting a real
  // executable as missing. Paths are checked on the filesystem directly.
  if (String(command).includes('/') || String(command).includes('\\')) return fs.existsSync(command);
  const checker = os.platform() === 'win32' ? 'where' : 'which';
  const result = spawnSyncPortable(checker, [command], { encoding: 'utf8', shell: false });
  return result.status === 0;
}

export function runCommand(command, args = [], options = {}) {
  const startedAt = new Date().toISOString();
  const result = spawnSyncPortable(command, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    shell: false,
    timeout: options.timeout ?? 300000,
    maxBuffer: options.maxBuffer ?? Number(process.env.ACF_COMMAND_MAX_BUFFER_BYTES || 100 * 1024 * 1024),
    input: options.input,
    env: options.env || process.env
  });
  const endedAt = new Date().toISOString();
  const timedOut = Boolean(result.error && /ETIMEDOUT/i.test(String(result.error.code || result.error.message)));
  return {
    command,
    args,
    cwd: options.cwd || process.cwd(),
    status: result.status,
    signal: result.signal,
    timed_out: timedOut,
    error: result.error ? String(result.error.message || result.error) : null,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    stdout_preview: truncate(result.stdout || '', 4000),
    stderr_preview: truncate(result.stderr || '', 4000),
    started_at: startedAt,
    ended_at: endedAt,
    success: result.status === 0
  };
}

export function parseShellLikeCommand(commandLine) {
  // Small parser for validation commands controlled by config. Avoids shell:true.
  const parts = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < commandLine.length; i++) {
    const ch = commandLine[i];
    if ((ch === '"' || ch === "'") && !quote) {
      quote = ch;
      continue;
    }
    if (quote && ch === quote) {
      quote = null;
      continue;
    }
    if (!quote && /\s/.test(ch)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (current) parts.push(current);
  return { command: parts[0], args: parts.slice(1) };
}

export function packageHasScript(root, scriptName) {
  const packageJson = readJson(path.join(root, 'package.json'), null);
  return Boolean(packageJson?.scripts?.[scriptName]);
}

export function shouldSkipNpmRun(root, commandLine, skipMissingScripts = true) {
  if (!skipMissingScripts) return false;
  const parsed = parseShellLikeCommand(commandLine);
  if (parsed.command !== 'npm') return false;
  if (parsed.args[0] === 'test') return !packageHasScript(root, 'test');
  if (parsed.args[0] === 'run' && parsed.args[1]) return !packageHasScript(root, parsed.args[1]);
  return false;
}

export function gitChangedFiles(root) {
  const result = runCommand('git', ['status', '--porcelain'], { cwd: root, timeout: 30000 });
  if (!result.success) return null;
  return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim());
}
