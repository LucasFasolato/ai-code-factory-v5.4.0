import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const WINDOWS_COMMAND_SHIMS = new Map([
  ['npm', 'npm.cmd'],
  ['npx', 'npx.cmd'],
  ['yarn', 'yarn.cmd'],
  ['pnpm', 'pnpm.cmd']
]);

export function isWindowsCommandScript(command, platform = os.platform()) {
  return platform === 'win32' && /\.(cmd|bat)$/i.test(String(command || ''));
}

export function quoteWindowsArg(value) {
  const s = String(value ?? '');
  if (!s) return '""';
  if (!/[\s"&()^<>|]/.test(s)) return s;
  return `"${s.replace(/"/g, '\"')}"`;
}

export function buildWindowsCommandLine(command, args = []) {
  return [quoteWindowsArg(command), ...args.map(quoteWindowsArg)].join(' ');
}

export function normalizeWindowsCommand(command, platform = os.platform()) {
  const s = String(command || '');
  if (platform !== 'win32') return s;
  if (!s) return s;

  // Absolute and relative command scripts must be preserved except for path
  // normalization. They are handled by the cmd.exe wrapper below.
  if (/^[A-Za-z]:[\\/]/.test(s) || /[\\/]/.test(s)) return path.normalize(s);

  return WINDOWS_COMMAND_SHIMS.get(s.toLowerCase()) || s;
}

// v5.0.2: generalized shim resolution. npm-installed CLIs on Windows (claude,
// codex, tsc, ...) are `.cmd` shims that CreateProcess cannot spawn with
// shell:false — the exact bug v4.7 fixed for npm/npx, but for EVERY command.
// Bare names not in the static map are resolved through `where` (cached): the
// first PATH match is what the shell would run. A `.cmd`/`.bat` result routes
// through the cmd.exe wrapper; a `.exe` (native installs) spawns directly, so
// both install styles work without config.
const whereCache = new Map();

export function defaultWindowsWhereLookup(command) {
  const result = spawnSync('where', [command], { encoding: 'utf8', shell: false, timeout: 10000 });
  if (result.status !== 0) return [];
  return String(result.stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

export function resolveWindowsCommand(command, platform = os.platform(), lookup = defaultWindowsWhereLookup) {
  const normalized = normalizeWindowsCommand(command, platform);
  if (platform !== 'win32') return normalized;
  if (normalized !== command) return normalized; // static shim already applied
  if (/[\\/]/.test(normalized) || /\.[a-z0-9]+$/i.test(normalized)) return normalized; // path or explicit extension
  if (whereCache.has(normalized)) return whereCache.get(normalized);
  let resolved = normalized;
  try {
    // `where` can return SEVERAL matches: npm shims install `claude` (sh,
    // extensionless — first in the listing), `claude.cmd` and `claude.ps1`.
    // Taking the first line blindly picks the sh shim, which Windows cannot
    // spawn — the .cmd must be preferred across ALL candidates.
    const found = lookup(normalized);
    const candidates = Array.isArray(found) ? found : (found ? [found] : []);
    const cmdShim = candidates.find((c) => /\.(cmd|bat)$/i.test(c));
    const exe = candidates.find((c) => /\.exe$/i.test(c));
    if (cmdShim && !exe) resolved = cmdShim; // npm shim install → route via cmd.exe wrapper
    else if (cmdShim && exe) resolved = candidates.indexOf(exe) < candidates.indexOf(cmdShim) ? normalized : cmdShim; // respect PATH order
    // exe-only or nothing usable → keep bare name (CreateProcess handles .exe; ENOENT stays honest)
  } catch { /* resolution is best-effort; ENOENT surfaces as before */ }
  whereCache.set(normalized, resolved);
  return resolved;
}

export function buildPortableSpawn(command, args = [], options = {}, platform = os.platform(), lookup = defaultWindowsWhereLookup) {
  const portableCommand = resolveWindowsCommand(command, platform, lookup);
  if (isWindowsCommandScript(portableCommand, platform)) {
    const cmdLine = buildWindowsCommandLine(portableCommand, args);
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', cmdLine],
      options: {
        ...options,
        shell: false
      }
    };
  }

  return {
    command: portableCommand,
    args,
    options: {
      ...options,
      shell: options.shell ?? false
    }
  };
}

export function spawnSyncPortable(command, args = [], options = {}) {
  const plan = buildPortableSpawn(command, args, options);
  return spawnSync(plan.command, plan.args, plan.options);
}
