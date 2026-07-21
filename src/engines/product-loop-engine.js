import path from 'node:path';
import { aiPath, requestPaths } from '../core/paths.js';
import { listBacklog, loadRequest, updateRequest, nextRequestId, saveRequest } from '../core/state.js';
import { readJsonSafe, writeJson, writeText, readText, listFilesRecursive } from '../core/fs.js';
import { nowIso } from '../core/format.js';
import { appendEvent } from '../core/events.js';
import { generateEvidencePack } from './evidence-pack-engine.js';
import { compileMemory } from './memory-compiler.js';

export function productScan(root) {
  const backlog = listBacklog(root);
  const open = backlog.filter((r) => r.status !== 'done');
  const files = listFilesRecursive(path.join(root, 'src'), { extensions: ['.ts', '.tsx', '.js', '.jsx'], ignoreDirs: ['node_modules', '.next', '.ai'] });
  const scan = {
    generated_at: nowIso(),
    backlog_total: backlog.length,
    open_requests: open.map((r) => ({ id: r.id, status: r.status, workflow: r.workflow, next: r.next_best_action })),
    source_files: files.length,
    design_blockers: backlog.filter((r) => r.workflow === 'design-first' && !readJsonSafe(requestPaths(root, r.id).approvedDesign, null)).map((r) => r.id),
    validation_ready: backlog.filter((r) => ['implementation_ready', 'validated_technically'].includes(r.status)).map((r) => r.id),
    next_recommendation: recommendNext(backlog)
  };
  writeJson(aiPath(root, 'autonomy', 'last-product-scan.json'), scan);
  return scan;
}

export function proposeFeatures(root, config = {}) {
  const scan = productScan(root);
  const proposals = [];
  const hasLanding = scan.open_requests.some((r) => /design|landing|frontend/i.test(`${r.workflow} ${r.next}`));
  if (scan.design_blockers.length) proposals.push(proposal('PROP-001', 'Approve or regenerate the current visual design', 'high', 'low', 'Current visual work is blocked by design approval.', ['design-preview', 'design-approve']));
  if (hasLanding || scan.backlog_total === 0) {
    proposals.push(proposal('PROP-002', 'Interactive before/after gallery', 'high', 'medium', 'Core engagement mechanism for renovation/real-estate value proposition.', ['approved landing design']));
    proposals.push(proposal('PROP-003', 'Conversion-ready contact CTA/form', 'high', 'low', 'Landing needs a clear conversion path with validation and placeholders until real data exists.', ['landing page']));
    proposals.push(proposal('PROP-004', 'Mobile sticky CTA and performance pass', 'medium', 'low', 'Improves mobile conversion and production quality.', ['implemented landing']));
  }
  proposals.push(proposal('PROP-005', 'Senior quality review pass', 'medium', 'low', 'Run frontend/backend/product/security reviews and close gaps before production.', ['implemented feature']));
  const payload = { generated_at: nowIso(), proposals };
  writeJson(aiPath(root, 'autonomy', 'proposals', 'feature-proposals.json'), payload);
  writeText(aiPath(root, 'autonomy', 'proposals', 'feature-proposals.md'), renderProposals(payload));
  return payload;
}

export function createReqFromProposal(root, proposalId) {
  const payload = readJsonSafe(aiPath(root, 'autonomy', 'proposals', 'feature-proposals.json'), null) || proposeFeatures(root);
  const item = payload.proposals.find((p) => p.id === proposalId);
  if (!item) throw new Error(`Proposal not found: ${proposalId}. Run propose-features first.`);
  const requestId = nextRequestId(root);
  const req = {
    id: requestId,
    title: item.title,
    raw_user_ask: item.title,
    interpreted_intent: item.why,
    work_type: inferWorkType(item.title),
    project_type: 'current-project',
    risk: item.risk,
    workflow: item.title.toLowerCase().includes('before/after') || item.title.toLowerCase().includes('cta') ? 'design-first' : 'contract-first',
    status: 'proposed',
    next_best_action: 'run ask/intake or preview proposal',
    created_from_proposal: proposalId,
    created_at: nowIso(),
    updated_at: nowIso()
  };
  saveRequest(root, req);
  appendEvent(root, 'REQ_CREATED_FROM_PROPOSAL', { request_id: requestId, proposal_id: proposalId });
  return req;
}

export function autonomousCycle(root, config = {}, options = {}) {
  const mode = options.mode || config.autonomous_loop?.mode || 'supervised';
  const cycleId = `CYCLE-${String(Date.now()).slice(-8)}`;
  const scan = productScan(root);
  const actions = ['product_scan'];
  let status = 'completed';
  let next_action = scan.next_recommendation || 'inspect status';
  const selected = [];
  const open = listBacklog(root).filter((r) => r.status !== 'done');
  const active = open[0] || null;
  if (!active) {
    const proposals = proposeFeatures(root, config);
    actions.push('propose_features');
    status = 'waiting_user';
    next_action = 'review feature proposals and create a REQ';
  } else {
    selected.push(active.id);
    if (active.workflow === 'design-first' && !readJsonSafe(requestPaths(root, active.id).approvedDesign, null)) {
      actions.push('blocked_by_design_gate');
      status = 'blocked_waiting_user';
      next_action = `npm run ai -- design-preview ${active.id} then design-approve`;
    } else if (['implementation_ready', 'design_approved'].includes(active.status)) {
      actions.push('ready_for_execution_but_supervised');
      status = mode === 'full' ? 'ready_to_execute' : 'blocked_waiting_user';
      next_action = mode === 'full' ? `npm run ai -- approve ${active.id}` : `review preview then npm run ai -- approve ${active.id}`;
    } else {
      actions.push('recommend_next_step');
      status = 'waiting_user';
      next_action = active.next_best_action || 'next';
    }
  }
  const cycle = { cycle_id: cycleId, started_at: nowIso(), mode, selected_reqs: selected, actions, status, next_action, scan };
  writeJson(aiPath(root, 'autonomy', 'cycles', `${cycleId}.json`), cycle);
  writeText(aiPath(root, 'autonomy', 'decision-log.md'), renderCycle(cycle));
  appendEvent(root, 'AUTONOMOUS_CYCLE', { cycle_id: cycleId, status, actions });
  return cycle;
}

function recommendNext(backlog) {
  const open = backlog.find((r) => r.status !== 'done');
  if (!open) return 'propose-features';
  if (open.next_best_action) return open.next_best_action;
  return `inspect ${open.id}`;
}

function proposal(id, title, value, risk, why, dependencies) { return { id, title, value, risk, why, dependencies, status: 'proposal' }; }
function inferWorkType(title) { return /form|cta|gallery|landing|mobile/i.test(title) ? 'frontend_visual' : 'feature'; }
function renderProposals(payload) { return [`# Feature Proposals`, '', `Generated at: ${payload.generated_at}`, '', ...payload.proposals.map((p) => `## ${p.id} — ${p.title}\n\n- Value: ${p.value}\n- Risk: ${p.risk}\n- Why: ${p.why}\n- Dependencies: ${p.dependencies.join(', ')}\n`)].join('\n'); }
function renderCycle(cycle) { return [`# Autonomous Cycle — ${cycle.cycle_id}`, '', `Mode: ${cycle.mode}`, `Status: ${cycle.status}`, `Next action: ${cycle.next_action}`, '', '## Actions', '', ...cycle.actions.map((a) => `- ${a}`)].join('\n'); }
