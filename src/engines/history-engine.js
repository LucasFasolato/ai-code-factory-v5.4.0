import { aiPath } from '../core/paths.js';
import { readNdjson, readText } from '../core/fs.js';
import { nowIso } from '../core/format.js';
import { deriveStateFromEvents } from '../core/events.js';

export function historyTimeline(root, options = {}) {
  const limit = options.limit || 50;
  const events = readNdjson(aiPath(root, 'history', 'timeline.ndjson')).slice(-limit);
  const lines = events.map((e) => `${e.at} | ${e.type}${e.request_id ? ` | ${e.request_id}` : ''}${summaryFor(e)}`);
  return { count: events.length, events, lines };
}

function summaryFor(e) {
  const p = e.payload || {};
  if (e.type === 'ASK_CREATED') return ` | ${String(p.ask || '').slice(0, 60)}`;
  if (e.type === 'DESIGN_APPROVED') return ` | ${p.approved_design || ''}`;
  if (e.type === 'EXECUTION_FINISHED') return ` | ${p.executor || ''} ${p.status || ''}`;
  if (e.type === 'VALIDATION_FINISHED') return ` | ${p.status || ''}`;
  if (e.type === 'FEEDBACK_RECORDED') return ` | ${String(p.text || '').slice(0, 60)}`;
  if (e.type === 'CONSTRAINT_LOCKED') return ` | ${String(p.text || '').slice(0, 60)}`;
  return '';
}

export function lessonsSummary(root) {
  const lessons = readText(aiPath(root, 'memory', 'project-lessons.md'), '# Project Lessons\n\nNo consolidated lessons yet.\n');
  const compiled = readText(aiPath(root, 'knowledge', 'compiled-knowledge.md'), '');
  return { lessons, compiled };
}

export function evolutionSummary(root) {
  const derived = deriveStateFromEvents(root);
  const requests = Object.values(derived.requests);
  const closed = requests.filter((r) => r.closed).length;
  const withFailures = requests.filter((r) => r.failures > 0).length;
  const totalExecutions = requests.reduce((a, r) => a + r.executions, 0);
  const totalFailures = requests.reduce((a, r) => a + r.failures, 0);
  const successRate = totalExecutions ? Math.round(((totalExecutions - totalFailures) / totalExecutions) * 100) : null;
  return {
    generated_at: nowIso(),
    total_events: derived.total_events,
    total_requests: requests.length,
    closed_requests: closed,
    requests_with_failures: withFailures,
    total_executions: totalExecutions,
    total_failures: totalFailures,
    execution_success_rate: successRate,
    requests
  };
}
