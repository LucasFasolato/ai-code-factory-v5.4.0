import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { aiPath, requestPaths } from '../core/paths.js';
import { exists, readJson, readText, appendText } from '../core/fs.js';
import { loadConfig, loadState, listBacklog, loadRequest, updateRequest } from '../core/state.js';
import { nowIso } from '../core/format.js';
import { appendEvent } from '../core/events.js';
import { evaluateGates } from '../engines/gate-engine.js';
import { projectHealth } from '../engines/health-engine.js';
import { approveDesign, designPreview } from '../engines/design-engine.js';
import { acceptVisual } from '../engines/visual-engine.js';
import { historyTimeline, evolutionSummary } from '../engines/history-engine.js';
import { suggestNext } from '../engines/backlog-curator.js';
import { recordFeedback } from '../engines/feedback-engine.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
const MAX_BODY_BYTES = 1024 * 1024; // 1MB — local tool, small payloads only
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

export function startDashboard(root, options = {}) {
  const config = loadConfig(root);
  const host = config.dashboard?.local_only === false ? (config.dashboard?.host || '127.0.0.1') : '127.0.0.1';
  const port = options.port !== undefined ? Number(options.port) : Number(config.dashboard?.port || 3333);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) return await handleApi(root, config, req, res, url);
      return serveStatic(res, url.pathname);
    } catch (error) {
      sendJson(res, 500, { error: String(error.message || error) });
    }
  });

  server.listen(port, host, () => {
    const address = server.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    console.log(`AI Code Factory Command Center: http://${host}:${actualPort}`);
    console.log('Local-only dashboard. Press Ctrl+C to stop.');
  });
  return server;
}

// ---------------------------------------------------------------------------
// Static files — SECURITY: path traversal protection.
// The previous implementation joined the raw URL path and checked
// startsWith(publicDir), which is bypassable with sibling-directory prefixes
// (e.g. /public-evil) and crafted encodings. Here we resolve and verify with
// path.relative: the resolved target must stay inside PUBLIC_DIR.
// ---------------------------------------------------------------------------
function serveStatic(res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return sendJson(res, 400, { error: 'Bad request path' });
  }
  if (decoded.includes('\0')) return sendJson(res, 400, { error: 'Bad request path' });
  const requested = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const resolved = path.resolve(PUBLIC_DIR, requested);
  const relative = path.relative(PUBLIC_DIR, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return sendJson(res, 403, { error: 'Forbidden' });
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return sendJson(res, 404, { error: 'Not found' });
  }
  const ext = path.extname(resolved).toLowerCase();
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(resolved).pipe(res);
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------
async function handleApi(root, config, req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  // --- GET routes ---
  if (route === 'GET /api/overview') {
    const state = loadState(root);
    const backlog = listBacklog(root);
    const health = projectHealth(root);
    return sendJson(res, 200, { state, backlog, health, generated_at: nowIso() });
  }
  if (route === 'GET /api/request') {
    const id = url.searchParams.get('id');
    if (!id || !isRequestId(id)) return sendJson(res, 400, { error: 'Valid id required (REQ-XXX)' });
    const request = loadRequest(root, id);
    if (!request) return sendJson(res, 404, { error: `Request not found: ${id}` });
    const paths = requestPaths(root, id);
    return sendJson(res, 200, {
      request,
      intake: readJson(paths.intake, null),
      gates: readJson(paths.gates, null),
      questions: readText(paths.questionsMd, ''),
      answers: readText(paths.answersMd, ''),
      evidence: readText(paths.evidence, ''),
      execution: readJson(paths.executionStatus, null),
      validation: readJson(paths.validation, null),
      design: safeDesignPreview(root, id)
    });
  }
  if (route === 'GET /api/history') {
    const limit = Math.min(Number(url.searchParams.get('limit') || 100), 500);
    return sendJson(res, 200, historyTimeline(root, { limit }));
  }
  if (route === 'GET /api/evolution') return sendJson(res, 200, evolutionSummary(root));
  if (route === 'GET /api/knowledge') {
    return sendJson(res, 200, {
      compiled: readText(aiPath(root, 'knowledge', 'compiled-knowledge.md'), ''),
      preferences: readJson(aiPath(root, 'knowledge', 'user-preferences.json'), null),
      design_taste: readText(aiPath(root, 'knowledge', 'design-taste.md'), ''),
      engineering_taste: readText(aiPath(root, 'knowledge', 'engineering-taste.md'), '')
    });
  }
  if (route === 'GET /api/suggest-next') return sendJson(res, 200, suggestNext(root));

  // --- POST routes ---
  if (req.method === 'POST') {
    const body = await readBody(req);
    if (body === null) return sendJson(res, 413, { error: 'Body too large (max 1MB)' });
    let data;
    try { data = body ? JSON.parse(body) : {}; } catch { return sendJson(res, 400, { error: 'Invalid JSON body' }); }

    if (url.pathname === '/api/answer') {
      const { request_id: requestId, answer } = data;
      if (!isRequestId(requestId) || !String(answer || '').trim()) return sendJson(res, 400, { error: 'request_id and answer required' });
      if (!loadRequest(root, requestId)) return sendJson(res, 404, { error: `Request not found: ${requestId}` });
      appendText(requestPaths(root, requestId).answersMd, `\n## Answer (dashboard) — ${nowIso()}\n\n${String(answer).trim()}\n`);
      updateRequest(root, requestId, { status: 'intake_ready', next_best_action: 'continue workflow' });
      appendEvent(root, 'QUESTION_ANSWERED', { request_id: requestId, answer: String(answer).slice(0, 200), via: 'dashboard' });
      return sendJson(res, 200, { ok: true });
    }
    if (url.pathname === '/api/design-approve') {
      const { request_id: requestId, option } = data;
      if (!isRequestId(requestId) || !option) return sendJson(res, 400, { error: 'request_id and option required' });
      try {
        const result = approveDesign(root, requestId, String(option));
        evaluateGates(root, requestId, config);
        return sendJson(res, 200, { ok: true, approved: result.approved.approved_design, normalized_from: result.normalized_from });
      } catch (error) {
        return sendJson(res, 422, { error: String(error.message || error) });
      }
    }
    if (url.pathname === '/api/visual-accept') {
      const { request_id: requestId } = data;
      if (!isRequestId(requestId)) return sendJson(res, 400, { error: 'request_id required' });
      if (!loadRequest(root, requestId)) return sendJson(res, 404, { error: `Request not found: ${requestId}` });
      acceptVisual(root, requestId);
      const gates = evaluateGates(root, requestId, config);
      if (gates.close_allowed) {
        updateRequest(root, requestId, { status: 'done', next_best_action: 'learn' });
        appendEvent(root, 'REQ_CLOSED', { request_id: requestId, via: 'dashboard' });
      }
      return sendJson(res, 200, { ok: true, close_allowed: gates.close_allowed, blockers: gates.close_blockers });
    }
    if (url.pathname === '/api/feedback') {
      const { text, request_id: requestId } = data;
      try {
        const entry = recordFeedback(root, text, { requestId: isRequestId(requestId) ? requestId : null });
        return sendJson(res, 200, { ok: true, id: entry.id });
      } catch (error) {
        return sendJson(res, 400, { error: String(error.message || error) });
      }
    }
  }

  return sendJson(res, 404, { error: `Unknown API route: ${route}` });
}

function safeDesignPreview(root, requestId) {
  try { return designPreview(root, requestId); } catch { return null; }
}

function isRequestId(value) {
  return typeof value === 'string' && /^REQ-\d{3,}$/.test(value);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.destroy();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, payload) {
  if (res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(payload, null, 2));
}
