import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProviderJson, clip } from '../src/core/json-utils.js';

// The brain's robustness depends on tolerating real-model output quirks.
// These cases mirror what GPT/Claude actually emit.

test('parses clean JSON', () => {
  assert.equal(parseProviderJson('{"a":1}').parsed.a, 1);
});

test('strips markdown fences', () => {
  assert.equal(parseProviderJson('```json\n{"a":1}\n```').parsed.a, 1);
});

test('ignores preamble and trailing prose', () => {
  assert.equal(parseProviderJson('Here is the decision:\n{"a":1}\n\nLet me know.').parsed.a, 1);
});

test('repairs trailing commas (common LLM quirk)', () => {
  const r = parseProviderJson('{"a":1,"b":2,}');
  assert.equal(r.parsed.b, 2);
  assert.equal(r.repaired, true);
});

test('normalizes smart quotes', () => {
  assert.equal(parseProviderJson('{\u201Ca\u201D:\u201Cx\u201D}').parsed.a, 'x');
});

test('does not corrupt brace/comma characters inside string values', () => {
  const r = parseProviderJson('{"note":"use {x}, then [y],","a":1}');
  assert.equal(r.parsed.note, 'use {x}, then [y],');
  assert.equal(r.parsed.a, 1);
});

test('extracts the first complete object when braces are nested', () => {
  assert.deepEqual(parseProviderJson('{"o":{"n":1},"a":2}').parsed, { o: { n: 1 }, a: 2 });
});

test('throws on genuinely empty output', () => {
  assert.throws(() => parseProviderJson('   '));
});

test('clip truncates only beyond the limit', () => {
  assert.equal(clip('short', 100), 'short');
  assert.match(clip('x'.repeat(50), 10), /TRUNCATED TO 10 CHARS/);
});
