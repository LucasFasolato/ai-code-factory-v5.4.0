export function nowIso() {
  return new Date().toISOString();
}

export function titleCase(input) {
  return String(input || '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export function truncate(input, max = 1000) {
  const s = String(input || '');
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n...[truncated ${s.length - max} chars]`;
}

export function bullet(items) {
  const arr = Array.isArray(items) ? items : [];
  if (arr.length === 0) return '- none';
  return arr.map((item) => `- ${item}`).join('\n');
}

export function table(rows) {
  if (!rows || rows.length === 0) return '';
  return rows.map((row) => row.join(' | ')).join('\n');
}

export function statusIcon(status) {
  if (status === 'passed' || status === 'success' || status === true) return '✓';
  if (status === 'failed' || status === 'blocked' || status === false) return '✕';
  if (status === 'warning') return '!';
  return '…';
}
