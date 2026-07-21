import { aiPath } from './paths.js';
import { appendNdjson, readNdjson } from './fs.js';
import { nowIso } from './format.js';

export const EVENT_TYPES = [
  'ASK_CREATED', 'INTAKE_COMPLETED', 'QUESTION_CREATED', 'QUESTION_ANSWERED',
  'WORKFLOW_SELECTED', 'DESIGN_REQUIRED', 'DESIGN_GENERATED', 'DESIGN_IMPORTED',
  'DESIGN_APPROVED', 'PLAN_CREATED', 'EXECUTION_STARTED', 'EXECUTION_FINISHED',
  'VALIDATION_STARTED', 'VALIDATION_FINISHED', 'GATES_EVALUATED', 'GATE_PASSED',
  'GATE_FAILED', 'VISUAL_ACCEPTED', 'EVIDENCE_CREATED', 'REQ_CLOSED',
  'LEARNING_CREATED', 'FEEDBACK_RECORDED', 'CONSTRAINT_LOCKED',
  'AUTO_ITERATION_ROUND', 'EXPERIMENT_RECORDED', 'IMPROVEMENT_PROPOSED',
  'AUTONOMY_CHANGED', 'SESSION_NOTE'
];

function eventsFile(root) { return aiPath(root, 'events', 'events.ndjson'); }
function timelineFile(root) { return aiPath(root, 'history', 'timeline.ndjson'); }

export function appendEvent(root, type, payload = {}) {
  const event = {
    id: `EVT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    at: nowIso(),
    request_id: payload.request_id || null,
    payload
  };
  appendNdjson(eventsFile(root), event);
  appendNdjson(timelineFile(root), event);
  return event;
}

export function readEvents(root, filter = {}) {
  let events = readNdjson(eventsFile(root));
  if (filter.request_id) events = events.filter((e) => e.request_id === filter.request_id);
  if (filter.type) events = events.filter((e) => e.type === filter.type);
  if (filter.types) events = events.filter((e) => filter.types.includes(e.type));
  if (filter.limit) events = events.slice(-filter.limit);
  return events;
}

// Derive current state from the append-only event log.
// Used by state-doctor to cross-check backlog files against history.
export function deriveStateFromEvents(root) {
  const events = readEvents(root);
  const requests = {};
  for (const e of events) {
    if (!e.request_id) continue;
    const r = requests[e.request_id] || (requests[e.request_id] = {
      request_id: e.request_id,
      created_at: null, closed: false, design_approved: null,
      executions: 0, failures: 0, visual_accepted: false, last_event: null
    });
    if (e.type === 'ASK_CREATED') r.created_at = e.at;
    if (e.type === 'DESIGN_APPROVED') r.design_approved = e.payload?.approved_design || true;
    if (e.type === 'EXECUTION_FINISHED') {
      r.executions += 1;
      if (e.payload?.status && e.payload.status !== 'success' && e.payload.status !== 'dry_run') r.failures += 1;
    }
    if (e.type === 'VALIDATION_FINISHED' && e.payload?.status === 'failed') r.failures += 1;
    if (e.type === 'VISUAL_ACCEPTED') r.visual_accepted = true;
    if (e.type === 'REQ_CLOSED') r.closed = true;
    r.last_event = { type: e.type, at: e.at };
  }
  return { requests, total_events: events.length };
}
