import { writeText, readText } from '../core/fs.js';
import { requestPaths } from '../core/paths.js';
import { nowIso } from '../core/format.js';
import { appendEvent } from '../core/events.js';

export function runVisualReview(root, requestId, options = {}) {
  const paths = requestPaths(root, requestId);
  const acceptedLine = options.accept ? '\n\nVisual acceptance: accepted\n' : '\n\nVisual acceptance: pending\n';
  const md = `# Visual Review — ${requestId}\n\nGenerated at: ${nowIso()}\n\n` +
    `## Review\n\nThis automated v1 review records the need for visual evidence. Use Playwright/manual screenshot import for stronger validation.\n\n` +
    `## Screenshot\n\n${options.screenshot ? options.screenshot : 'No screenshot attached.'}\n` +
    acceptedLine;
  writeText(paths.visualReview, md);
  return { request_id: requestId, accepted: Boolean(options.accept), markdown: md };
}

export function acceptVisual(root, requestId) {
  const paths = requestPaths(root, requestId);
  const existing = readText(paths.visualReview, `# Visual Review — ${requestId}\n\n`);
  const next = existing.replace(/Visual acceptance:\s*pending/i, '').replace(/Visual acceptance:\s*accepted/i, '') + `\n\nVisual acceptance: accepted\nAccepted at: ${nowIso()}\n`;
  writeText(paths.visualReview, next);
  appendEvent(root, 'VISUAL_ACCEPTED', { request_id: requestId });
  return { request_id: requestId, accepted: true };
}
