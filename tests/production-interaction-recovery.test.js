import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempProject, cleanup, createRequest } from './helpers.js';
import { loadConfig } from '../src/core/state.js';
import { saveExecutionContract } from '../src/engines/execution-contract-engine.js';
import { evaluateAcceptance } from '../src/engines/acceptance-evaluator.js';
import { readText } from '../src/core/fs.js';

test('frontend visual contract requires real before/after interaction and component architecture', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Landing premium con before/after interactivo y CTA', config);
    const approvedDir = path.join(root, '.ai/designs/approved');
    fs.mkdirSync(approvedDir, { recursive: true });
    fs.writeFileSync(path.join(approvedDir, `${requestId}-approved-design.json`), JSON.stringify({ request_id: requestId, approved_design: `${requestId}-option-a`, desktop_image: '.ai/designs/generated/a.png', mobile_image: '.ai/designs/generated/m.png' }, null, 2));
    const result = saveExecutionContract(root, requestId);
    assert.match(result.markdown, /Production Design Fidelity Requirements/);
    assert.match(result.markdown, /BeforeAfterSlider/);
    assert.match(result.markdown, /Component Architecture/);
  } finally { cleanup(root); }
});

test('acceptance fails decorative before/after without interactive slider logic', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Landing con before/after gallery', config);
    const appDir = path.join(root, 'src/app');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'page.tsx'), `export default function P(){return <div><button className="compare-control">&lt;&gt;</button><p>antes despues before after gallery card</p></div>}`);
    const result = evaluateAcceptance(root, requestId);
    assert.ok(result.criteria.some((c) => /decorative only|no explicit slider|slider/i.test(c.evidence) && c.status === 'failed'));
  } finally { cleanup(root); }
});

test('acceptance passes before/after slider with pointer logic', () => {
  const root = makeTempProject();
  try {
    const config = loadConfig(root);
    const { requestId } = createRequest(root, 'Landing con before/after gallery', config);
    const appDir = path.join(root, 'src/app');
    fs.mkdirSync(appDir, { recursive: true });
    fs.writeFileSync(path.join(appDir, 'page.tsx'), `import Image from 'next/image'; function BeforeAfterSlider(){ const [position,setPosition]=useState(50); function onPointerMove(e){ setPosition(e.clientX); } return <div onPointerMove={onPointerMove} role="slider" style={{'--split': position + '%'}}><Image src="/before.png" alt="antes" fill/><div style={{width: position + '%', clipPath:'inset(0 50% 0 0)'}}><Image src="/after.png" alt="despues" fill/></div></div>} export default function P(){return <><BeforeAfterSlider/><p>antes despues before after gallery card card card</p></>}`);
    const result = evaluateAcceptance(root, requestId);
    assert.ok(result.criteria.some((c) => /Before\/after/i.test(c.text) && c.status === 'passed'));
  } finally { cleanup(root); }
});
