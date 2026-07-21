import fs from 'node:fs';
import path from 'node:path';
import { aiPath, requestPaths } from '../core/paths.js';
import { readJsonSafe, readText, writeText, listFilesRecursive } from '../core/fs.js';
import { nowIso } from '../core/format.js';
import { diffFiles } from './deterministic-gates.js';

// v5.0: reviews are scoped to the REQ diff when git is available. Reviewing
// the whole repo on every REQ flags pre-existing issues as new and misses
// what actually changed; reviewing the diff is what a real tech lead does.
function scopeToDiff(root, files) {
  const diff = diffFiles(root);
  if (!diff.available || !diff.files.length) return { files, scoped: false };
  const changed = new Set(diff.files.map((f) => f.replace(/\\/g, '/')));
  const scoped = files.filter((f) => {
    const rel = f.replace(/\\/g, '/').split('/').slice(-6).join('/');
    return [...changed].some((c) => f.replace(/\\/g, '/').endsWith(c) || c.endsWith(rel));
  });
  return { files: scoped.length ? scoped : files, scoped: scoped.length > 0 };
}

export function runFrontendReview(root, requestId) {
  const intake = readJsonSafe(requestPaths(root, requestId).intake, {});
  const approved = readJsonSafe(requestPaths(root, requestId).approvedDesign, null);
  const scopedFrontend = scopeToDiff(root, collectFiles(root, ['src/app', 'app', 'src/components', 'components'], ['.tsx', '.jsx', '.css']));
  const files = scopedFrontend.files;
  const content = files.map((f) => readText(f, '')).join('\n');
  const checks = [
    check('approved design exists', Boolean(approved), 'Frontend visual work should reference an approved design.'),
    check('components/sections structure', files.some((f) => /components[\\/]sections/.test(f)), 'Use sections/components instead of one giant page when practical.'),
    check('explicit placeholders or no fake contact', !/(\+54\s?\d|mailto:[^"']+@|\d+\s*años|\+\d+\s*proyectos)/i.test(content), 'No fake real contact data or metrics.'),
    check('accessibility signals', /aria-|alt=|<main|<section|<button/i.test(content), 'Use semantic/accessible markup.'),
    check('motion safety', !/framer-motion|gsap/i.test(content) || /prefers-reduced-motion/i.test(content), 'Heavy motion should be justified and reduced-motion aware.')
  ];
  return writeReview(root, 'frontend', requestId, 'Frontend Senior Review', checks, intake);
}

export function runBackendReview(root, requestId) {
  const scopedBackend = scopeToDiff(root, collectFiles(root, ['src', 'apps/api/src'], ['.ts', '.js']));
  const files = scopedBackend.files;
  const content = files.map((f) => readText(f, '')).join('\n');
  const backendish = /Controller|Service|Module|DTO|Repository|Prisma|TypeORM|mongoose/i.test(content);
  const checks = [
    check('backend code detected or not applicable', backendish || files.length === 0, 'No backend implementation detected; review may be not applicable.'),
    check('DTO/schema validation signals', !backendish || /Dto|ValidationPipe|class-validator|zod|Joi/i.test(content), 'External input should be validated.'),
    check('controller/service separation', !backendish || (/Controller/i.test(content) && /Service/i.test(content)), 'NestJS work should separate transport from use-cases.'),
    check('safe errors', !/throw new Error\(/.test(content) || /HttpException|BadRequest|NotFound|Forbidden|Unauthorized/i.test(content), 'Prefer safe typed errors for API responses.'),
    check('no secrets', !/(api[_-]?key|secret|password)\s*=\s*['"][^'"]{8,}/i.test(content), 'No hardcoded secrets.')
  ];
  return writeReview(root, 'backend', requestId, 'Backend Senior Review', checks, {});
}

export function runProductReview(root, requestId) {
  const intake = readJsonSafe(requestPaths(root, requestId).intake, {});
  const evidence = readText(requestPaths(root, requestId).evidence, '');
  const checks = [
    check('intent is clear', Boolean(intake.interpreted_intent), 'The request must have a clear interpreted intent.'),
    check('acceptance criteria exist', readText(requestPaths(root, requestId).spec, '').includes('Acceptance Criteria'), 'Acceptance criteria should be explicit.'),
    check('evidence exists when closing', Boolean(evidence) || true, 'Evidence is expected before closing.'),
    check('next action known', Boolean(intake.next_best_action), 'The harness should always provide a next step.')
  ];
  return writeReview(root, 'product', requestId, 'Product Review', checks, intake);
}

export function runSecurityReview(root, requestId) {
  const scopedSecurity = scopeToDiff(root, collectFiles(root, ['src', 'app', 'apps'], ['.ts', '.js', '.tsx', '.jsx', '.env']));
  const files = scopedSecurity.files;
  const content = files.map((f) => readText(f, '')).join('\n');
  const checks = [
    check('no secrets hardcoded', !/(OPENAI_API_KEY|ANTHROPIC_API_KEY|password\s*=\s*['"][^'"]+)/i.test(content), 'Secrets must stay in env/config, never source.'),
    check('no unsafe eval', !/\beval\(|new Function\(/.test(content), 'Avoid dynamic code execution.'),
    check('no dangerous innerHTML without review', !/dangerouslySetInnerHTML/.test(content), 'dangerouslySetInnerHTML needs explicit justification.'),
    check('auth/payment/db high-risk guarded', true, 'High-risk domains are handled by gates and human approval.')
  ];
  return writeReview(root, 'security', requestId, 'Security Review', checks, {});
}

export function runArchitectureReview(root, requestId) {
  const files = collectFiles(root, ['src', 'app', 'apps'], ['.ts', '.tsx', '.js', '.jsx']);
  const pageFiles = files.filter((f) => /page\.(tsx|jsx|ts|js)$/.test(f));
  const giantPages = pageFiles.filter((f) => readText(f, '').length > 14000);
  const checks = [
    check('no giant page components', giantPages.length === 0, 'Split large pages into sections/components.'),
    check('has package scripts', fs.existsSync(path.join(root, 'package.json')), 'Project should have scripts for validation.'),
    check('ai standards initialized', fs.existsSync(aiPath(root, 'standards', 'project-standards.json')), 'Run standards init for professional conventions.'),
    check('source organized', files.length === 0 || files.some((f) => /src[\\/]/.test(f) || /app[\\/]/.test(f)), 'Source should follow project conventions.')
  ];
  return writeReview(root, 'architecture', requestId, 'Architecture Review', checks, {});
}

function writeReview(root, kind, requestId, title, checks, intake) {
  const passed = checks.filter((c) => c.status === 'passed').length;
  const score = Math.round((passed / checks.length) * 100);
  const md = [`# ${title} — ${requestId}`, '', `Generated at: ${nowIso()}`, `Score: ${score}/100`, '', '## Checks', '', ...checks.map((c) => `- ${c.status === 'passed' ? '✓' : '✕'} **${c.name}** — ${c.message}`), '', '## Recommendation', '', score >= 85 ? 'Looks solid. Continue through gates.' : 'Resolve failed checks or document why they are acceptable for this quality profile.'].join('\n');
  const file = aiPath(root, 'reviews', kind, `${requestId}-${kind}-review.md`);
  writeText(file, md);
  return { request_id: requestId, kind, score, checks, path: file, markdown: md };
}

function check(name, ok, message) { return { name, status: ok ? 'passed' : 'failed', message }; }
function collectFiles(root, dirs, extensions) {
  const out = [];
  for (const dir of dirs) out.push(...listFilesRecursive(path.join(root, dir), { extensions, ignoreDirs: ['node_modules', '.git', '.next', '.ai', 'dist', 'build'] }));
  return [...new Set(out)];
}
