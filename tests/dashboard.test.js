import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { makeTempProject, cleanup, createRequest } from './helpers.js';
import { startDashboard } from '../src/dashboard/server.js';
import { loadConfig } from '../src/core/state.js';
import { recordFeedback } from '../src/engines/feedback-engine.js';

async function withServer(root, fn) {
  const server = startDashboard(root, { port: 0 });
  await new Promise((resolve) => server.once('listening', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try { await fn(base); } finally { await new Promise((resolve) => server.close(resolve)); }
}

test('dashboard serves overview and request APIs', async () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Landing premium inmobiliaria', config);
    await withServer(root, async (base) => {
      const overview = await (await fetch(`${base}/api/overview`)).json();
      assert.ok(overview.backlog.some((r) => r.id === requestId));
      assert.ok(typeof overview.health.score === 'number');

      const req = await (await fetch(`${base}/api/request?id=${requestId}`)).json();
      assert.equal(req.request.id, requestId);
      assert.ok(req.intake);

      const bad = await fetch(`${base}/api/request?id=../../etc/passwd`);
      assert.equal(bad.status, 400);
    });
  } finally { cleanup(root); }
});

test('dashboard blocks path traversal on static files (security regression)', async () => {
  const root = makeTempProject();
  try {
    await withServer(root, async (base) => {
      const { port } = new URL(base);
      // fetch() normalizes dot segments, so send raw HTTP request lines.
      for (const attack of [
        '/../../../../etc/passwd',
        '/..%2f..%2f..%2fetc%2fpasswd',
        '/%2e%2e/%2e%2e/etc/passwd',
        '/..%5c..%5cwindows%5cwin.ini',
        '/public-evil/secret.txt'
      ]) {
        const raw = await rawHttpGet(Number(port), attack);
        const status = Number(raw.split(' ')[1]);
        assert.ok([400, 403, 404].includes(status), `attack not blocked: ${attack} → ${status}`);
        assert.ok(!raw.includes('root:'), `leaked /etc/passwd via ${attack}`);
      }
      const index = await fetch(`${base}/`);
      assert.equal(index.status, 200);
    });
  } finally { cleanup(root); }
});

function rawHttpGet(port, path) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`GET ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    socket.on('data', (chunk) => { data += chunk.toString('utf8'); });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

test('dashboard POST endpoints: answer, feedback, body validation', async () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Crear endpoint API propiedades', config);
    await withServer(root, async (base) => {
      const ok = await fetch(`${base}/api/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId, answer: 'Contrato: GET /properties devuelve lista paginada' })
      });
      assert.equal(ok.status, 200);

      const invalidJson = await fetch(`${base}/api/answer`, { method: 'POST', body: '{not json' });
      assert.equal(invalidJson.status, 400);

      const missingFields = await fetch(`${base}/api/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: requestId })
      });
      assert.equal(missingFields.status, 400);

      const fb = await fetch(`${base}/api/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: 'me gusta el dashboard sobrio' })
      });
      assert.equal(fb.status, 200);

      const history = await (await fetch(`${base}/api/history`)).json();
      assert.ok(history.events.some((e) => e.type === 'QUESTION_ANSWERED'));
      assert.ok(history.events.some((e) => e.type === 'FEEDBACK_RECORDED'));
    });
  } finally { cleanup(root); }
});
