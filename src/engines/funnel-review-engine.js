import { readText, writeText } from '../core/fs.js';
import { requestPaths } from '../core/paths.js';

export function runFunnelReview(root, requestId) {
  const paths = requestPaths(root, requestId);
  const text = [
    readText(`${root}/src/app/page.tsx`, ''),
    readText(`${root}/src/pages/index.tsx`, ''),
    readText(`${root}/pages/index.tsx`, ''),
    readText(`${root}/app/page.tsx`, '')
  ].join('\n');
  const checks = [
    check('Value clarity', /transform|valor|renov|recic|refacci|premium|propiedad|beneficio|soluci/i.test(text), 'Hero/value language found.'),
    check('CTA clarity', /contact|contacto|consulta|evaluar|cotizar|agenda|button|cta/i.test(text), 'CTA/contact marker found.'),
    check('Visual proof', /before|after|antes|despu[eé]s|galer|caso|portfolio/i.test(text), 'Before/after or gallery marker found.'),
    check('Trust signals', /confianza|proceso|criterio|experiencia|testimonio|garant/i.test(text), 'Trust/process marker found.'),
    check('Mobile usability', /responsive|mobile|sm:|md:|lg:|@media/i.test(text), 'Responsive marker found.')
  ];
  const passed = checks.filter((c) => c.passed).length;
  const md = `# Funnel Review — ${requestId}\n\nScore: ${passed}/${checks.length}\n\n` +
    checks.map((c) => `- ${c.passed ? 'passed' : 'warning'} — ${c.name}: ${c.reason}`).join('\n') +
    `\n\n## Recommendation\n\n${passed >= 4 ? 'Funnel basics look acceptable; validate visually.' : 'Improve value clarity, proof and CTA before closing.'}\n`;
  const file = `${paths.productReview.replace('-product-review.md', '-funnel-review.md')}`;
  writeText(file, md);
  return { request_id: requestId, score: passed, max_score: checks.length, checks, markdown: md };
}

function check(name, passed, reason) { return { name, passed: Boolean(passed), reason: passed ? reason : `${name} not clearly detected.` }; }
