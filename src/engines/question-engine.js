import { writeJson, writeText } from '../core/fs.js';
import { requestPaths } from '../core/paths.js';
import { nowIso, bullet } from '../core/format.js';

export function buildQuestions(intake) {
  const brainQuestions = normalizeBrainQuestions(intake.questions);
  if (brainQuestions.length) {
    return {
      request_id: intake.request_id,
      generated_at: nowIso(),
      questions: brainQuestions,
      defaults: intake.assumptions_allowed || [],
      blocking_missing_info: intake.blocking_missing_info || []
    };
  }
  const questions = [];
  if (intake.work_type === 'frontend_visual') {
    questions.push(q('brand-assets', '¿Hay logo real o uso marca textual?', 'non_blocking', 'Use brand text if missing.'));
    questions.push(q('visual-assets', '¿Hay fotos reales o uso placeholders/imágenes de referencia?', 'non_blocking', 'Use explicit placeholders if missing.'));
    questions.push(q('contact-data', '¿Hay datos reales de contacto o deben quedar como placeholders?', 'non_blocking', 'Use Email pendiente / Teléfono pendiente / Ubicación pendiente.'));
    questions.push(q('design-source', '¿Querés generar diseño, importar desde Stitch/Figma/Claude o usar manual-import?', intake.design_first_required ? 'important' : 'non_blocking', 'Generate a design brief/prompt pack if provider is not configured.'));
    questions.push(q('visual-contract', '¿El diseño aprobado debe bloquearse como contrato visual estricto?', 'important', 'Yes for frontend visual work.'));
  } else if (intake.work_type === 'backend_api') {
    questions.push(q('api-contract', '¿Cuál es el contrato request/response esperado?', 'blocking', null));
    questions.push(q('validation', '¿Qué validaciones y errores esperados debe manejar?', 'important', null));
    questions.push(q('permissions', '¿Qué permisos/auth aplican?', 'blocking_if_auth_related', null));
    questions.push(q('persistence', '¿Qué persistencia o tablas/modelos aplica?', 'important', null));
  } else if (intake.work_type === 'fullstack_feature') {
    questions.push(q('user-flow', '¿Cuál es el flujo usuario completo?', 'important', null));
    questions.push(q('screens', '¿Qué pantallas incluye?', 'important', null));
    questions.push(q('endpoints', '¿Qué endpoints/API contracts hacen falta?', 'important', null));
    questions.push(q('data-model', '¿Qué esquema de datos se necesita?', 'blocking_if_db_related', null));
  } else if (intake.work_type === 'refactor') {
    questions.push(q('preserve-behavior', '¿Qué comportamiento debe preservarse?', 'blocking', null));
    questions.push(q('tests', '¿Qué tests protegen el cambio?', 'important', null));
    questions.push(q('scope', '¿Cuál es el límite del refactor?', 'important', null));
  }
  return {
    request_id: intake.request_id,
    generated_at: nowIso(),
    questions,
    defaults: intake.assumptions_allowed || [],
    blocking_missing_info: intake.blocking_missing_info || []
  };
}

export function saveQuestions(root, intake) {
  const paths = requestPaths(root, intake.request_id);
  const result = buildQuestions(intake);
  writeJson(paths.questionsJson, result);
  writeText(paths.questionsMd, renderQuestionsMarkdown(result));
  return result;
}

export function renderQuestionsMarkdown(result) {
  return `# Questions — ${result.request_id}\n\n` +
    `## Pending questions\n\n` +
    result.questions.map((item, index) => `${index + 1}. **${item.priority}** — ${item.text}${item.default_action ? `\n   - Default: ${item.default_action}` : ''}`).join('\n') +
    `\n\n## Blocking missing information\n\n${bullet(result.blocking_missing_info)}\n\n` +
    `## Allowed assumptions\n\n${bullet(result.defaults)}\n`;
}

function q(id, text, priority, defaultAction) {
  return { id, text, priority, default_action: defaultAction, answered: false };
}

function normalizeBrainQuestions(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item, index) => q(
    item.id || `brain-q-${index + 1}`,
    item.text,
    item.priority || 'important',
    item.default_action || null
  )).filter((item) => item.text);
}
