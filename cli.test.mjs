import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const cli = (...args) => spawnSync(process.execPath, [join(import.meta.dirname, 'cli.mjs'), ...args], { encoding: 'utf8' });
const put = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const read = (root, rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

test('generates both catalogs, keeps hand edits, rejects bad skills', () => {
  const root = mkdtempSync(join(tmpdir(), 'My_Skills-'));
  put(root, 'skills/alpha/SKILL.md', '---\nname: alpha\ndescription: >\n  Folded\n  text\n---\nbody');
  put(root, 'skills/beta/SKILL.md', '---\ndescription: "quoted \\"b\\""\n---\n');
  put(root, 'plugins/gamma/skills/gamma/SKILL.md', "---\nname: gamma\ndescription: 'it''s gamma'\nmetadata:\n  a: b\n---\n");
  put(root, '.claude/skills/dev-only/SKILL.md', '---\ndescription: dev\n---\n');
  put(root, 'node_modules/x/skills/y/SKILL.md', '---\ndescription: dep\n---\n');

  let r = cli(root, '--owner', 'nogikun', '--version', 'v1.2.0');
  assert.equal(r.status, 0, r.stderr);
  const claude = read(root, '.claude-plugin/marketplace.json');
  const name = claude.name;
  assert.match(name, /^my-skills-/);
  assert.deepEqual(claude.owner, { name: 'nogikun' });
  assert.deepEqual(claude.plugins, [
    { name: 'gamma', source: './plugins/gamma', description: "it's gamma", version: '1.2.0' },
    { name, source: './', description: 'Skills: alpha, beta', version: '1.2.0' },
  ]);
  const codex = read(root, '.agents/plugins/marketplace.json');
  assert.deepEqual(codex.plugins[0], {
    policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' },
    category: 'Productivity',
    name: 'gamma',
    description: "it's gamma",
    version: '1.2.0',
    source: { source: 'local', path: './plugins/gamma' },
  });
  assert.deepEqual(read(root, 'plugin.json'), {
    $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json',
    name, description: 'Skills: alpha, beta', version: '1.2.0',
  });
  assert.equal(read(root, 'plugins/gamma/plugin.json').name, 'gamma');

  // hand edits survive, version is kept when not passed, removed plugins disappear
  claude.plugins[0].tags = ['keep'];
  writeFileSync(join(root, '.claude-plugin/marketplace.json'), JSON.stringify(claude));
  codex.plugins[0].category = 'Coding';
  writeFileSync(join(root, '.agents/plugins/marketplace.json'), JSON.stringify(codex));
  put(root, 'plugins/gamma/skills/gamma/SKILL.md', '---\ndescription: new\n---\n');
  r = cli(root);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(read(root, '.claude-plugin/marketplace.json').plugins[0], {
    name: 'gamma', source: './plugins/gamma', description: 'new', version: '1.2.0', tags: ['keep'],
  });
  assert.equal(read(root, '.agents/plugins/marketplace.json').plugins[0].category, 'Coding');

  put(root, 'skills/beta/SKILL.md', '---\nname: other\n---\n');
  r = cli(root, '--dry-run');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /"description" is required/);
  assert.match(r.stderr, /name "other" must match/);

  assert.equal(cli(root, '--version', 'latest').status, 1);

  put(root, 'skills/beta/SKILL.md', '---\ndescription: ok\n---\n');
  put(root, 'plugins/gamma/plugin.json', '{"name":"someone-elses"}');
  r = cli(root);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /plugins\/gamma\/plugin.json exists but is not an agent-plugins.org manifest/);
});
