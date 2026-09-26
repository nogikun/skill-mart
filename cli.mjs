#!/usr/bin/env node
// Finds <plugin>/skills/<skill>/SKILL.md in a repo and writes marketplace catalogs for
// Claude Code (.claude-plugin/marketplace.json) and Codex / ChatGPT (.agents/plugins/marketplace.json),
// plus a portable <plugin>/plugin.json (agent-plugins.org), the manifest OpenAI documents for ChatGPT.
// A plugin is the directory that contains `skills/`; every client auto-loads that folder.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';

const USAGE = `Usage: skill-mart [dir] [--version X.Y.Z] [--owner NAME] [--dry-run]

  dir         repository root to scan (default: .)
  --version   plugin version to set, e.g. v1.2.0 from a release tag (default: keep existing)
  --owner     marketplace owner name (default: existing owner, then git remote owner)
  --dry-run   validate and print the catalogs without writing`;

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    version: { type: 'string' },
    owner: { type: 'string' },
    'dry-run': { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  },
});
if (opts.help) {
  console.log(USAGE);
  process.exit(0);
}

const root = resolve(positionals[0] ?? '.');
const errors = [];
const die = (msg) => {
  console.error(`error: ${msg}`);
  process.exit(1);
};

const CLAUDE_PATH = '.claude-plugin/marketplace.json';
const CODEX_PATH = '.agents/plugins/marketplace.json';
const PORTABLE_SCHEMA = 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json';
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
const dirs = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort(); // stable output across OSes, so CI does not churn the diff

// Dot-dirs (.git, .claude/skills = the repo's own dev skills) and node_modules are never published.
function findPlugins(dir, rel) {
  const found = [];
  for (const name of dirs(dir)) {
    if (name.startsWith('.') || name === 'node_modules') continue;
    const abs = join(dir, name);
    const skills = name === 'skills' ? dirs(abs).filter((s) => existsSync(join(abs, s, 'SKILL.md'))) : [];
    if (skills.length) found.push({ dir: rel, skills });
    else found.push(...findPlugins(abs, rel ? `${rel}/${name}` : name));
  }
  return found;
}

// YAML subset that SKILL.md frontmatter uses: `key: value`, quoted scalars,
// `|` / `>` blocks and indented continuation lines. Anything else is reported, not guessed.
function parseFrontmatter(text, file) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return void errors.push(`${file}: missing --- frontmatter`);
  const fields = {};
  let key, mode, lines;
  const end = () => {
    if (!key) return;
    const raw = lines.join(mode === '|' ? '\n' : ' ').trim();
    if (raw.startsWith('"')) {
      try {
        fields[key] = JSON.parse(raw);
      } catch {
        errors.push(`${file}: cannot parse quoted value of "${key}"`);
      }
    } else if (raw.startsWith("'") && raw.endsWith("'") && raw.length > 1) {
      fields[key] = raw.slice(1, -1).replaceAll("''", "'");
    } else fields[key] = raw;
  };
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):(?:\s+(.*))?$/.exec(line);
    if (kv) {
      end();
      key = kv[1];
      const v = kv[2] ?? '';
      mode = /^[|>][-+]?$/.test(v) ? v[0] : 'plain';
      lines = mode === 'plain' && v ? [v] : [];
    } else if (key && /^(\s|$)/.test(line)) lines.push(line.trim());
    else if (!/^\s*#/.test(line)) errors.push(`${file}: unsupported frontmatter line: ${line}`);
  }
  end();
  return fields;
}

function readJson(rel) {
  const file = join(root, rel);
  if (!existsSync(file)) return {};
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    die(`${rel} is not valid JSON, refusing to overwrite it (${e.message})`);
  }
}

function remoteOwnerRepo() {
  try {
    const url = execFileSync('git', ['-C', root, 'remote', 'get-url', 'origin'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const m = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url);
    if (m) return [m[1], m[2]];
  } catch {}
  return [undefined, basename(root)];
}

const version = opts.version?.replace(/^v/, '');
if (version !== undefined && !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]+)?$/.test(version)) {
  die(`--version must be semver like 1.2.3 or v1.2.3, got "${opts.version}"`);
}

const found = findPlugins(root, '');
if (!found.length) die(`no skills/<name>/SKILL.md found under ${root}`);

const oldClaude = readJson(CLAUDE_PATH);
const oldCodex = readJson(CODEX_PATH);
const [remoteOwner, repo] = remoteOwnerRepo();
const name = oldClaude.name ?? slug(repo); // never rename an existing marketplace: users' installs are keyed by it
const ownerName = opts.owner ?? remoteOwner;
const owner = opts.owner || !oldClaude.owner ? ownerName && { name: ownerName } : oldClaude.owner;
if (!owner) die('cannot infer the owner from git remote, pass --owner');

const plugins = found.map(({ dir, skills }) => {
  const descriptions = skills.map((s) => {
    const file = `${dir ? `${dir}/` : ''}skills/${s}/SKILL.md`;
    const fm = parseFrontmatter(readFileSync(join(root, file), 'utf8'), file) ?? {};
    if (!fm.description) errors.push(`${file}: "description" is required`);
    if (fm.name && fm.name !== s) errors.push(`${file}: name "${fm.name}" must match its directory "${s}"`);
    return fm.description;
  });
  return {
    name: dir ? slug(basename(dir)) : name,
    source: dir ? `./${dir}` : './',
    description: skills.length === 1 ? descriptions[0] : `Skills: ${skills.join(', ')}`,
    ...(version && { version }),
  };
});
for (const [i, p] of plugins.entries()) {
  if (plugins.findIndex((q) => q.name === p.name) !== i) errors.push(`duplicate plugin name "${p.name}"`);
}
const manifests = found.map(({ dir }, i) => {
  const rel = dir ? `${dir}/plugin.json` : 'plugin.json';
  const old = readJson(rel);
  if (Object.keys(old).length && !String(old.$schema).startsWith('https://agent-plugins.org/')) {
    errors.push(`${rel} exists but is not an agent-plugins.org manifest (no matching "$schema"), refusing to touch it`);
  }
  const { source, ...fields } = plugins[i];
  return [rel, { $schema: PORTABLE_SCHEMA, ...old, ...fields }];
});
if (errors.length) die(`\n  ${errors.join('\n  ')}`);

// Fields this tool writes always win; defaults lose to hand edits; unknown hand-added fields are kept.
// (The leading `...p` only puts name/source first in the output.)
const merge = (old = [], fresh, defaults) =>
  fresh.map((p) => ({ ...p, ...defaults, ...old.find((o) => o.name === p.name), ...p }));

const claude = { ...oldClaude, name, owner, plugins: merge(oldClaude.plugins, plugins) };
const codex = {
  ...oldCodex,
  name: oldCodex.name ?? name,
  interface: oldCodex.interface ?? { displayName: name },
  plugins: merge(
    oldCodex.plugins,
    plugins.map(({ source, ...p }) => ({ ...p, source: { source: 'local', path: source } })),
    { policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' },
  ),
};

for (const [rel, data] of [[CLAUDE_PATH, claude], [CODEX_PATH, codex], ...manifests]) {
  const json = `${JSON.stringify(data, null, 2)}\n`;
  if (opts['dry-run']) {
    console.log(`# ${rel}\n${json}`);
    continue;
  }
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), json);
  console.log(`wrote ${rel}`);
}
for (const p of plugins) console.log(`  ${p.name}  ${p.source}${version ? `  v${version}` : ''}`);
