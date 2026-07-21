import { aiPath } from '../core/paths.js';
import { ensureDir, readJsonSafe, writeJson, writeText, readText } from '../core/fs.js';
import { nowIso } from '../core/format.js';

export function initStandards(root, config = {}, profile = null) {
  ensureDir(aiPath(root, 'standards'));
  const selectedProfile = profile || config.standards?.quality_profile || 'production';
  const standards = buildStandards(config, selectedProfile);
  writeJson(aiPath(root, 'standards', 'project-standards.json'), standards);
  writeText(aiPath(root, 'standards', 'frontend-conventions.md'), frontendConventions(selectedProfile));
  writeText(aiPath(root, 'standards', 'backend-conventions.md'), backendConventions(selectedProfile));
  writeText(aiPath(root, 'standards', 'testing-conventions.md'), testingConventions(selectedProfile));
  writeText(aiPath(root, 'standards', 'security-conventions.md'), securityConventions(selectedProfile));
  writeText(aiPath(root, 'standards', 'folder-structure.md'), folderStructure(selectedProfile));
  writeJson(aiPath(root, 'standards', 'dependency-policy.json'), dependencyPolicy(selectedProfile));
  return { profile: selectedProfile, standards };
}

export function standardsStatus(root) {
  const standards = readJsonSafe(aiPath(root, 'standards', 'project-standards.json'), null);
  return {
    exists: Boolean(standards),
    profile: standards?.quality_profile || 'not_initialized',
    files: [
      'project-standards.json',
      'frontend-conventions.md',
      'backend-conventions.md',
      'testing-conventions.md',
      'security-conventions.md',
      'folder-structure.md',
      'dependency-policy.json'
    ].map((name) => ({ name, exists: Boolean(readText(aiPath(root, 'standards', name), '').trim()) }))
  };
}

export function setQualityProfile(root, profile, config = {}) {
  const allowed = ['prototype', 'mvp', 'production', 'enterprise'];
  if (!allowed.includes(profile)) throw new Error(`Unknown quality profile: ${profile}. Use ${allowed.join(', ')}`);
  return initStandards(root, config, profile);
}

export function readProjectStandards(root) {
  return readJsonSafe(aiPath(root, 'standards', 'project-standards.json'), null) || initStandards(root, {}).standards;
}

function buildStandards(config, profile) {
  return {
    generated_at: nowIso(),
    quality_profile: profile,
    principle: 'Senior product engineering: simple outside, intelligent inside, auditable always.',
    frontend: {
      framework: 'Next.js App Router',
      target: config.standards?.frontend_target || 'WCAG 2.2 AA, Core Web Vitals conscious, production UI',
      structure: ['src/app', 'src/components/sections', 'src/components/ui', 'src/content', 'src/lib', 'src/styles'],
      rules: [
        'page.tsx orchestrates sections, it does not become a giant component',
        'prefer server components by default; client components only for interaction',
        'motion must respect prefers-reduced-motion',
        'visual work requires approved design and visual evidence',
        'no fake real-world claims; synthetic assets must be declared'
      ]
    },
    backend: {
      framework: 'NestJS',
      target: config.standards?.backend_target || 'Modular architecture, DTO validation, security baseline, proportional tests',
      structure: ['apps/api/src/modules/<feature>', 'dto', 'entities', 'repositories', 'guards', 'policies'],
      rules: [
        'controllers handle transport only',
        'services coordinate use-cases',
        'repositories encapsulate persistence',
        'external input requires DTO/schema validation',
        'auth/permissions/database/payments require explicit approval'
      ]
    },
    security: {
      baseline: 'OWASP-inspired pragmatic baseline',
      rules: ['no secrets hardcoded', 'validate input', 'safe errors', 'least privilege', 'no sensitive data in logs']
    },
    testing: {
      risk_based: true,
      matrix: {
        low: ['smoke or unit'],
        medium: ['happy path', 'validation/error case'],
        high: ['unit', 'integration', 'authorization', 'edge cases'],
        critical: ['security review', 'idempotency/failure cases', 'rollback strategy']
      }
    }
  };
}

function frontendConventions(profile) {
  return `# Frontend Conventions — ${profile}\n\n## Structure\n- src/app: routes and composition only.\n- src/components/sections: page sections.\n- src/components/ui: reusable primitives.\n- src/content: editable/mock/demo content.\n- src/lib: utilities.\n\n## Senior UI rules\n- Production mockups drive implementation.\n- Accessibility is not optional.\n- No all-client pages unless interaction requires it.\n- Animation must be subtle, purposeful and reduced-motion aware.\n- Use explicit placeholders or synthetic asset manifest for missing data.\n`;
}

function backendConventions(profile) {
  return `# Backend Conventions — ${profile}\n\n## NestJS structure\n- modules/<feature>/<feature>.module.ts\n- modules/<feature>/<feature>.controller.ts\n- modules/<feature>/<feature>.service.ts\n- modules/<feature>/dto\n- modules/<feature>/entities\n- modules/<feature>/repositories\n\n## Senior backend rules\n- Contract first for API work.\n- DTO/schema validation for all external input.\n- Consistent safe error shapes.\n- Permissions explicit, never implicit.\n- Tests proportional to risk.\n`;
}

function testingConventions(profile) {
  return `# Testing Conventions — ${profile}\n\n- Low risk: smoke/unit.\n- Medium risk: happy path + validation/error.\n- High risk: integration + authorization + edge cases.\n- Critical: security + idempotency + failure modes.\n- Frontend visual: technical validation plus visual evidence and acceptance.\n`;
}

function securityConventions(profile) {
  return `# Security Conventions — ${profile}\n\n- Never hardcode secrets.\n- Validate all input at boundaries.\n- Do not leak internals in errors.\n- Treat auth, payments, DB schema and destructive changes as human-approval gates.\n- Do not log credentials, tokens or private user data.\n`;
}

function folderStructure(profile) {
  return `# Folder Structure — ${profile}\n\n## Frontend\n\nsrc/app\nsrc/components/sections\nsrc/components/ui\nsrc/content\nsrc/lib\nsrc/styles\n\n## Backend\n\napps/api/src/modules/<feature>\napps/api/src/modules/<feature>/dto\napps/api/src/modules/<feature>/entities\napps/api/src/modules/<feature>/repositories\n\n## Contracts\n\n.ai/contracts/api\n.ai/contracts/ui\n.ai/contracts/fullstack\n`;
}

function dependencyPolicy(profile) {
  return {
    profile,
    require_approval_for: ['animation libraries', 'large UI kits', 'ORM/migration tools', 'auth/payment/security packages', 'state management frameworks'],
    prefer: ['platform APIs', 'small focused libraries', 'CSS-first motion when enough'],
    never: ['hardcoded secrets', 'unreviewed telemetry', 'unnecessary heavy dependencies']
  };
}
