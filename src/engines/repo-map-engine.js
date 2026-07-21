import fs from 'node:fs';
import path from 'node:path';
import { aiPath } from '../core/paths.js';
import { ensureDir, writeJson, writeText, readJsonSafe } from '../core/fs.js';
import { nowIso } from '../core/format.js';

// v5.0 Repo Map — the Aider pattern, dependency-free.
// Instead of feeding whole files to the brain, we feed a signature skeleton:
// exports, classes, functions, NestJS decorators, entities and routes.
// A 40-file NestJS project collapses from ~60k tokens to ~2-3k.

const SOURCE_DIRS = ['src', 'app', 'apps', 'lib', 'packages', 'pages', 'components'];
const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs'];
const IGNORE = ['node_modules', '.next', 'dist', 'build', '.git', 'coverage', '.ai', '.turbo'];
const MAX_FILES = 400;

export function buildRepoMap(root) {
  const files = collectSourceFiles(root);
  const modules = [];
  const stats = { files: files.length, entities: 0, controllers: 0, services: 0, routes: 0, components: 0 };
  for (const file of files) {
    const rel = path.relative(root, file).replace(/\\/g, '/');
    let content = '';
    try { content = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const skeleton = extractSkeleton(content);
    if (!skeleton.symbols.length && !skeleton.routes.length) continue;
    if (skeleton.kind === 'entity') stats.entities += 1;
    if (skeleton.kind === 'controller') stats.controllers += 1;
    if (skeleton.kind === 'service') stats.services += 1;
    if (skeleton.kind === 'component') stats.components += 1;
    stats.routes += skeleton.routes.length;
    modules.push({ file: rel, kind: skeleton.kind, symbols: skeleton.symbols, routes: skeleton.routes, imports_internal: skeleton.importsInternal });
  }
  const framework = detectFramework(root);
  const map = { generated_at: nowIso(), framework, stats, modules };
  return map;
}

export function saveRepoMap(root) {
  const map = buildRepoMap(root);
  ensureDir(aiPath(root, 'context-cache'));
  writeJson(aiPath(root, 'project-map.json'), map);
  const md = renderRepoMapMd(map);
  writeText(aiPath(root, 'context-cache', 'repo-map.md'), md);
  return { map, markdown_chars: md.length, estimated_tokens: Math.ceil(md.length / 4) };
}

export function readRepoMapMd(root, maxChars = 6000) {
  const file = aiPath(root, 'context-cache', 'repo-map.md');
  if (!fs.existsSync(file)) return '';
  const text = fs.readFileSync(file, 'utf8');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[repo map truncated]` : text;
}

export function readProjectMap(root) {
  return readJsonSafe(aiPath(root, 'project-map.json'), null);
}

function collectSourceFiles(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (out.length >= MAX_FILES || depth > 6) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (out.length >= MAX_FILES) return;
      if (IGNORE.includes(entry.name) || entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (EXTENSIONS.includes(path.extname(entry.name)) && !entry.name.includes('.test.') && !entry.name.includes('.spec.')) out.push(full);
    }
  };
  for (const dir of SOURCE_DIRS) {
    const full = path.join(root, dir);
    if (fs.existsSync(full)) walk(full, 0);
  }
  return out;
}

function extractSkeleton(content) {
  const symbols = [];
  const routes = [];
  const importsInternal = [];
  let kind = 'module';

  if (/@Entity\s*\(/.test(content)) kind = 'entity';
  else if (/@Controller\s*\(/.test(content)) kind = 'controller';
  else if (/@Injectable\s*\(/.test(content) && /Service/.test(content)) kind = 'service';
  else if (/@Module\s*\(/.test(content)) kind = 'nest-module';
  else if (/from ['"]react['"]|export default function [A-Z]/.test(content)) kind = 'component';

  const lines = content.split('\n');
  for (const line of lines) {
    const imp = line.match(/from ['"](\.[^'"]+)['"]/);
    if (imp) importsInternal.push(imp[1]);
    const cls = line.match(/^export\s+(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?/);
    if (cls) { symbols.push(`class ${cls[1]}${cls[2] ? ` extends ${cls[2]}` : ''}`); continue; }
    const fn = line.match(/^export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
    if (fn) { symbols.push(`fn ${fn[1]}(${compressParams(fn[2])})`); continue; }
    const constExp = line.match(/^export\s+const\s+(\w+)\s*[:=]/);
    if (constExp) { symbols.push(`const ${constExp[1]}`); continue; }
    const iface = line.match(/^export\s+(?:interface|type)\s+(\w+)/);
    if (iface) { symbols.push(`type ${iface[1]}`); continue; }
    const method = line.match(/^\s+(?:public\s+|private\s+|protected\s+)?(?:async\s+)?(\w+)\s*\(([^)]*)\)\s*[:{]/);
    if (method && kind !== 'component' && !['if', 'for', 'while', 'switch', 'catch', 'constructor', 'return'].includes(method[1])) {
      symbols.push(`  .${method[1]}(${compressParams(method[2])})`);
    }
    const route = line.match(/@(Get|Post|Put|Patch|Delete)\s*\(\s*['"]?([^'")]*)['"]?\s*\)/);
    if (route) routes.push(`${route[1].toUpperCase()} ${route[2] || '/'}`);
  }
  return { kind, symbols: symbols.slice(0, 40), routes, importsInternal: [...new Set(importsInternal)].slice(0, 15) };
}

function compressParams(params) {
  return String(params || '').split(',').map((p) => p.split(':')[0].trim()).filter(Boolean).join(', ');
}

function detectFramework(root) {
  const pkg = readJsonSafe(path.join(root, 'package.json'), {});
  const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
  const detected = [];
  if (deps['@nestjs/core']) detected.push('nestjs');
  if (deps.next) detected.push('nextjs');
  if (deps.react && !deps.next) detected.push('react');
  if (deps.typeorm) detected.push('typeorm');
  if (deps.prisma || deps['@prisma/client']) detected.push('prisma');
  if (deps.express && !deps['@nestjs/core']) detected.push('express');
  return detected;
}

function renderRepoMapMd(map) {
  const lines = [`# Repo Map`, '', `Frameworks: ${map.framework.join(', ') || 'unknown'}`, `Files mapped: ${map.stats.files} | entities: ${map.stats.entities} | controllers: ${map.stats.controllers} | services: ${map.stats.services} | routes: ${map.stats.routes}`, ''];
  for (const mod of map.modules) {
    lines.push(`## ${mod.file} (${mod.kind})`);
    if (mod.routes.length) lines.push(`Routes: ${mod.routes.join(' | ')}`);
    for (const sym of mod.symbols) lines.push(`- ${sym}`);
    lines.push('');
  }
  return lines.join('\n');
}
