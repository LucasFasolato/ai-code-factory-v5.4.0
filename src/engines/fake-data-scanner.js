import path from 'node:path';
import { exists, listFilesRecursive, readText, safeRel, writeJson } from '../core/fs.js';
import { aiPath } from '../core/paths.js';
import { nowIso } from '../core/format.js';

const DANGEROUS_PATTERNS = [
  { id: 'tel-link', label: 'telephone link', regex: /tel:/i },
  { id: 'mailto-link', label: 'email link', regex: /mailto:/i },
  { id: 'arg-phone', label: 'Argentina-like phone code', regex: /\+\s*54|\+5411|\+54\s*11/i },
  { id: 'fas-email', label: 'FAS-like email/domain', regex: /[\w.-]+@fas[\w.-]*/i },
  { id: 'email', label: 'email address', regex: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i },
  { id: 'location-ba', label: 'Buenos Aires location', regex: /Buenos Aires|Argentina/i },
  { id: 'social-instagram', label: 'Instagram social link/name', regex: /Instagram/i },
  { id: 'social-facebook', label: 'Facebook social link/name', regex: /Facebook/i },
  { id: 'social-linkedin', label: 'LinkedIn social link/name', regex: /LinkedIn/i },
  { id: 'years-2024-2025', label: 'legal/current year claim', regex: /\b2024\b|\b2025\b|\b2026\b/i },
  { id: 'years-experience', label: 'years of experience claim', regex: /\+\s*15|15\+|años de experiencia|anios de experiencia/i },
  { id: 'projects-count', label: 'projects/clients count claim', regex: /\+\s*250|250\+|proyectos realizados|clientes/i },
  { id: 'rating', label: 'rating/satisfaction claim', regex: /4[,.]9|satisfacci[oó]n/i },
  { id: 'licensed-pros', label: 'licensed professional claim', regex: /matriculad/i }
];

export function scanFakeData(root, config = {}, options = {}) {
  const fakeConfig = config.fake_data || {};
  const scanDirs = options.files ? [] : (fakeConfig.scan_dirs || ['src', 'app', 'pages', 'components', 'public']);
  const ignoreDirs = fakeConfig.ignore_dirs || ['node_modules', '.git', '.ai', 'dist', 'build', '.next'];
  const extensions = fakeConfig.scan_extensions || ['.tsx', '.ts', '.jsx', '.js', '.html', '.css', '.md'];
  const files = options.files || scanDirs.flatMap((dir) => listFilesRecursive(path.join(root, dir), { ignoreDirs, extensions }));
  const allowedPlaceholders = fakeConfig.allowed_placeholders || [];
  const confirmed = fakeConfig.confirmed_real_data_patterns || [];
  const findings = [];

  for (const file of files) {
    if (!exists(file)) continue;
    const rel = safeRel(root, file);
    const content = readText(file, '');
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (isAllowedPlaceholderLine(line, allowedPlaceholders)) continue;
      if (isConfirmedLine(line, confirmed)) continue;
      for (const pattern of DANGEROUS_PATTERNS) {
        if (pattern.regex.test(line)) {
          findings.push({
            pattern: pattern.id,
            label: pattern.label,
            file: rel,
            line: index + 1,
            preview: line.trim().slice(0, 240),
            severity: severityFor(pattern.id)
          });
        }
      }
    }
  }

  const failed = findings.some((f) => f.severity === 'error') && fakeConfig.block_on_unconfirmed_real_data !== false;
  const result = {
    status: failed ? 'failed' : (findings.length ? 'warning' : 'passed'),
    scanned_files: files.length,
    findings,
    generated_at: nowIso()
  };
  if (options.requestId) writeJson(aiPath(root, 'reasoning', 'gates', `${options.requestId}-fake-data-scan.json`), result);
  return result;
}

export function dangerousPatterns() {
  return DANGEROUS_PATTERNS;
}

function isAllowedPlaceholderLine(line, placeholders) {
  return placeholders.some((placeholder) => line.includes(placeholder));
}

function isConfirmedLine(line, confirmedPatterns) {
  return confirmedPatterns.some((pattern) => {
    try { return new RegExp(pattern, 'i').test(line); }
    catch { return String(line).includes(String(pattern)); }
  });
}

function severityFor(id) {
  if (['tel-link', 'mailto-link', 'arg-phone', 'fas-email', 'email', 'years-experience', 'projects-count', 'rating', 'licensed-pros'].includes(id)) return 'error';
  return 'warning';
}
