/* AI Code Factory Command Center — vanilla JS, no dependencies. */
const state = { activeRequestId: null };

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, options) {
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

// ---------------------------------------------------------------- tabs
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('active', p.id === `tab-${btn.dataset.tab}`));
    if (btn.dataset.tab === 'history') loadHistory();
    if (btn.dataset.tab === 'knowledge') loadKnowledge();
  });
});

// ---------------------------------------------------------------- overview
async function loadOverview() {
  try {
    const data = await api('/api/overview');
    $('health-pill').textContent = `health ${data.health.score}/100`;
    $('health-pill').className = `pill ${data.health.score >= 80 ? 'ok' : data.health.score >= 50 ? 'warn' : 'bad'}`;
    $('active-pill').textContent = `active: ${data.state.active_request_id || 'none'}`;

    $('backlog-list').innerHTML = data.backlog.length
      ? data.backlog.map((r) => `
        <button class="item req" data-id="${esc(r.id)}">
          <span class="badge ${esc(r.status)}">${esc(r.status)}</span>
          <strong>${esc(r.id)}</strong> ${esc(r.title)}
          <span class="dim">${esc(r.work_type)} · ${esc(r.workflow)}</span>
        </button>`).join('')
      : '<div class="dim">No requests yet. Run: npm run ai -- ask "..."</div>';
    document.querySelectorAll('.item.req').forEach((el) => el.addEventListener('click', () => openRequest(el.dataset.id)));

    $('health-list').innerHTML = data.health.checks.map((c) => `<div class="item">${c.ok ? '✓' : '✕'} ${esc(c.message)}</div>`).join('');

    const sug = await api('/api/suggest-next');
    $('suggest-list').innerHTML = sug.suggestions.map((s) => `
      <div class="item"><span class="badge ${esc(s.priority)}">${esc(s.priority)}</span> <strong>${esc(s.title)}</strong><span class="dim">${esc(s.detail)}</span></div>`).join('');
  } catch (error) {
    $('backlog-list').innerHTML = `<div class="msg bad">${esc(error.message)}</div>`;
  }
}

// ---------------------------------------------------------------- request
async function openRequest(id) {
  state.activeRequestId = id;
  document.querySelector('[data-tab="request"]').click();
  try {
    const data = await api(`/api/request?id=${encodeURIComponent(id)}`);
    $('request-title').textContent = `${data.request.id} — ${data.request.title}`;
    $('request-meta').innerHTML = `
      <span class="badge ${esc(data.request.status)}">${esc(data.request.status)}</span>
      <span>type: ${esc(data.request.work_type)}</span>
      <span>workflow: ${esc(data.request.workflow)}</span>
      <span>risk: ${esc(data.request.risk)}</span>
      <span>next: ${esc(data.request.next_best_action || '—')}</span>`;
    const gates = data.gates;
    $('gates-list').innerHTML = gates
      ? Object.entries(gates.gates).map(([name, g]) => `<div class="item">${g.status === 'passed' ? '✓' : g.status === 'pending' ? '…' : '✕'} <strong>${esc(name)}</strong> <span class="dim">${esc(g.reason)}</span></div>`).join('') +
        `<div class="item"><strong>Close allowed:</strong> ${gates.close_allowed ? 'yes' : 'no'}</div>`
      : '<div class="dim">No gates yet.</div>';
    $('request-questions').textContent = data.questions || 'No questions.';
    $('request-evidence').textContent = data.evidence || 'No evidence pack yet.';
    const design = data.design;
    $('design-info').innerHTML = design && design.options?.length
      ? design.options.map((o) => `<span class="badge">${esc(o.id)}${o.recommended ? ' ★' : ''}</span>`).join(' ') + (design.approved ? ` <span class="badge done">approved: ${esc(design.approved)}</span>` : '')
      : '<span class="dim">No design options yet.</span>';
  } catch (error) {
    $('request-msg').textContent = error.message;
  }
}

$('answer-btn').addEventListener('click', () => postAction('/api/answer', { request_id: state.activeRequestId, answer: $('answer-input').value }, 'Answer recorded.'));
$('design-approve-btn').addEventListener('click', () => postAction('/api/design-approve', { request_id: state.activeRequestId, option: $('design-option-input').value }, 'Design approved.'));
$('visual-accept-btn').addEventListener('click', () => postAction('/api/visual-accept', { request_id: state.activeRequestId }, 'Visual accepted.'));
$('feedback-btn').addEventListener('click', () => postAction('/api/feedback', { request_id: state.activeRequestId, text: $('feedback-input').value }, 'Feedback recorded.'));

async function postAction(path, body, okMsg) {
  const msg = $('request-msg');
  msg.className = 'msg';
  if (!state.activeRequestId && path !== '/api/feedback') { msg.textContent = 'Select a request first.'; return; }
  try {
    await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    msg.textContent = okMsg;
    msg.className = 'msg ok';
    if (state.activeRequestId) openRequest(state.activeRequestId);
    loadOverview();
  } catch (error) {
    msg.textContent = error.message;
    msg.className = 'msg bad';
  }
}

// ---------------------------------------------------------------- history
async function loadHistory() {
  try {
    const history = await api('/api/history?limit=150');
    $('history-list').innerHTML = history.lines?.length
      ? history.lines.slice().reverse().map((l) => `<div class="item">${esc(l)}</div>`).join('')
      : '<div class="dim">No events yet.</div>';
    const evo = await api('/api/evolution');
    $('evolution-summary').innerHTML = `
      <span>events: ${evo.total_events}</span>
      <span>requests: ${evo.total_requests} (${evo.closed_requests} closed)</span>
      <span>executions: ${evo.total_executions}</span>
      <span>success: ${evo.execution_success_rate ?? '—'}%</span>`;
    $('evolution-requests').innerHTML = evo.requests.map((r) => `
      <div class="item"><strong>${esc(r.request_id)}</strong> ${r.closed ? '✓ closed' : 'open'} · exec ${r.executions} · fail ${r.failures}${r.visual_accepted ? ' · visual ok' : ''}</div>`).join('');
  } catch (error) {
    $('history-list').innerHTML = `<div class="msg bad">${esc(error.message)}</div>`;
  }
}

// ---------------------------------------------------------------- knowledge
async function loadKnowledge() {
  try {
    const k = await api('/api/knowledge');
    $('knowledge-compiled').textContent = k.compiled || 'Run: npm run ai -- compile-memory';
    const rules = k.preferences?.learned_rules || [];
    $('learned-rules').innerHTML = rules.length
      ? rules.map((r) => `<div class="item">• ${esc(typeof r === 'string' ? r : r.rule)}</div>`).join('')
      : '<div class="dim">No learned rules yet. Use feedback + mine-feedback.</div>';
    $('design-taste').textContent = k.design_taste || '';
  } catch (error) {
    $('knowledge-compiled').textContent = error.message;
  }
}

loadOverview();
setInterval(loadOverview, 15000);
