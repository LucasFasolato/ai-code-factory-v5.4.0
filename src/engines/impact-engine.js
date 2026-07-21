import { writeText } from '../core/fs.js';
import { requestPaths } from '../core/paths.js';
import { bullet } from '../core/format.js';

export function likelyFilesFor(intake) {
  if (intake.work_type === 'frontend_visual') return ['src/app/page.tsx', 'src/app/globals.css', 'src/app/layout.tsx', 'tests/home.test.tsx', 'public/'];
  if (intake.work_type === 'backend_api') return ['src/**/*.controller.ts', 'src/**/*.service.ts', 'src/**/*.dto.ts', 'src/**/*.spec.ts'];
  if (intake.work_type === 'fullstack_feature') return ['apps/web/**', 'apps/api/**', 'packages/**', 'tests/**'];
  if (intake.work_type === 'product_epic') return ['.ai/epics/**', '.ai/reasoning/**', '.ai/backlog/**'];
  if (intake.work_type === 'bugfix') return ['files related to failing behavior', 'tests covering regression'];
  return ['project files related to request'];
}

export function saveImpactAnalysis(root, intake) {
  const files = likelyFilesFor(intake);
  const md = `# Impact Analysis — ${intake.request_id}\n\n` +
    `## Files likely affected\n\n${bullet(files)}\n\n` +
    `## Risk\n\n${intake.risk}\n\n` +
    `## Could break\n\n${bullet(couldBreak(intake))}\n\n` +
    `## Required validation\n\n${bullet(requiredValidation(intake))}\n`;
  writeText(requestPaths(root, intake.request_id).impact, md);
  return { request_id: intake.request_id, files, risk: intake.risk };
}

function couldBreak(intake) {
  if (intake.work_type === 'frontend_visual') return ['rendering', 'responsive layout', 'metadata', 'existing tests'];
  if (intake.work_type === 'backend_api') return ['API contract', 'validation', 'persistence', 'permissions'];
  if (intake.work_type === 'fullstack_feature') return ['frontend flow', 'API contract', 'data model', 'integration'];
  if (intake.work_type === 'product_epic') return ['roadmap correctness', 'scope boundaries', 'dependency ordering'];
  return ['related behavior'];
}

function requiredValidation(intake) {
  const base = ['npm run lint', 'npm run typecheck', 'npm test', 'npm run build'];
  if (intake.work_type === 'frontend_visual') base.push('visual review', 'fake data scanner', 'visual acceptance');
  if (intake.work_type === 'backend_api') base.push('contract/error tests');
  if (intake.work_type === 'product_epic') base.push('epic decomposition review', 'critical questions answered');
  return base;
}
