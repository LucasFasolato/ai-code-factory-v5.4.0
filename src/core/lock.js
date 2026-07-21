import fs from 'node:fs';
import path from 'node:path';

// Advisory lock built on the atomicity of mkdir (POSIX + Windows). No deps.
// Used to serialize read-modify-write on shared state (e.g. request counter)
// so two concurrent `ask` runs cannot mint the same REQ id.

function lockDir(target) {
  return `${target}.lock`;
}

export function withLock(target, fn, { retries = 50, intervalMs = 100, staleMs = 30000 } = {}) {
  const dir = lockDir(target);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let acquired = false;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      fs.mkdirSync(dir);
      acquired = true;
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Break a stale lock left behind by a crashed process.
      try {
        const age = Date.now() - fs.statSync(dir).mtimeMs;
        if (age > staleMs) {
          fs.rmSync(dir, { recursive: true, force: true });
          continue;
        }
      } catch { /* lock vanished between checks; retry */ }
      sleepSync(intervalMs);
    }
  }
  if (!acquired) throw new Error(`Could not acquire lock for ${target} after ${retries} attempts`);
  try {
    return fn();
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// Synchronous sleep without busy-spinning the CPU hot. Atomics.wait on a
// throwaway buffer blocks the thread cleanly for the interval.
function sleepSync(ms) {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}
