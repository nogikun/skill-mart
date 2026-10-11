import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const cli = (...args) => spawnSync(process.execPath, [join(import.meta.dirname, 'cli.mjs'), ...args], { encoding: 'utf8' });
const put = (root, rel, text) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const read = (root, rel) => JSON.parse(readFileSync(join(root, rel), 'utf8'));

test('generates all catalogs, keeps hand edits, rejects bad skills', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'My_Skills-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
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
  for (const file of ['.cursor-plugin/marketplace.json', '.github/plugin/marketplace.json']) {
    assert.deepEqual(read(root, file), claude);
    put(root, file, JSON.stringify({
      ...claude, name: `custom-${file.split('/')[0].slice(1)}`,
      owner: { name: 'custom-owner' }, metadata: { description: 'keep' },
      plugins: [{ ...claude.plugins[0], tags: ['keep'] }],
    }));
  }
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
  for (const file of ['.cursor-plugin/marketplace.json', '.github/plugin/marketplace.json']) {
    const catalog = read(root, file);
    assert.ok(catalog.name.startsWith('custom-'));
    assert.deepEqual(catalog.owner, { name: 'custom-owner' });
    assert.deepEqual(catalog.metadata, { description: 'keep' });
    assert.deepEqual(catalog.plugins[0], {
      name: 'gamma', source: './plugins/gamma', description: 'new', version: '1.2.0', tags: ['keep'],
    });
  }

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

test('dry-run prints all catalogs and ClawHub targets without writing or publishing', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'skill-mart-dry-run-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, 'skills/alpha/SKILL.md', '---\nname: alpha\ndescription: Test\n---\n');
  const r = cli(root, '--owner', 'test', '--require-name', '--publish-clawhub', '--dry-run');
  assert.equal(r.status, 0, r.stderr);
  for (const file of ['.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json', '.cursor-plugin/marketplace.json', '.github/plugin/marketplace.json', 'plugin.json']) {
    assert.ok(r.stdout.includes(`# ${file}`), file);
    assert.equal(existsSync(join(root, file)), false, file);
  }
  assert.match(r.stdout, /would publish to ClawHub:/);
  put(root, 'skills/alpha/SKILL.md', '---\ndescription: Test\n---\n');
  assert.equal(cli(root, '--owner', 'test').status, 0, 'legacy CLI still accepts an omitted name');
  const invalid = cli(root, '--owner', 'test', '--require-name');
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /"name" is required/);
  rmSync(join(root, 'skills/alpha'), { recursive: true });
  put(root, 'skills/Uppercase/SKILL.md', '---\nname: Uppercase\ndescription: Test\n---\n');
  const uppercase = cli(root, '--owner', 'test', '--require-name');
  assert.equal(uppercase.status, 1);
  assert.match(uppercase.stderr, /"name" must use lowercase/);
});

test('invalid new catalogs and missing ClawHub credentials fail before writing', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'skill-mart-invalid-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, 'skills/alpha/SKILL.md', '---\nname: alpha\ndescription: Test\n---\n');
  for (const file of ['.cursor-plugin/marketplace.json', '.github/plugin/marketplace.json']) {
    put(root, file, 'not JSON');
    const r = cli(root, '--owner', 'test');
    assert.equal(r.status, 1);
    assert.match(r.stderr, /not valid JSON/);
    assert.equal(existsSync(join(root, '.claude-plugin/marketplace.json')), false);
    rmSync(join(root, file));
  }
  const r = spawnSync(process.execPath, [join(import.meta.dirname, 'cli.mjs'), root, '--owner', 'test', '--publish-clawhub'], {
    encoding: 'utf8', env: { ...process.env, CLAWHUB_TOKEN: '' },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /requires CLAWHUB_TOKEN/);
  assert.equal(existsSync(join(root, 'plugin.json')), false);
});

test('ClawHub publishes root and nested skills, isolates credentials, and reports failures', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'skill-mart-publish-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, 'skills/alpha/SKILL.md', '---\nname: alpha\ndescription: Test\n---\n');
  put(root, 'plugins/extra/skills/beta/SKILL.md', '---\nname: beta\ndescription: Test\n---\n');
  put(root, '.claude-plugin/marketplace.json', '{"name":"team","owner":{"name":"test"}}');
  const bin = join(root, '.mock-bin');
  const log = join(root, '.mock-log');
  mkdirSync(bin);
  writeFileSync(join(bin, 'npx'), `#!/usr/bin/env node
import { appendFileSync, readFileSync, statSync } from 'node:fs';
const config = process.env.CLAWHUB_CONFIG_PATH;
appendFileSync(process.env.MOCK_LOG, JSON.stringify({
  args: process.argv.slice(2), config,
  validToken: JSON.parse(readFileSync(config, 'utf8')).token === process.env.CLAWHUB_TOKEN,
  mode: statSync(config).mode & 0o777,
}) + '\\n');
if (process.env.MOCK_FAIL) process.exit(1);
`, { mode: 0o755 });
  const run = (fail = '') => spawnSync(process.execPath, [join(import.meta.dirname, 'cli.mjs'), root, '--require-name', '--version', 'v1.2.0', '--publish-clawhub'], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CLAWHUB_TOKEN: 'test-secret', MOCK_LOG: log, MOCK_FAIL: fail },
  });
  let r = run();
  assert.equal(r.status, 0, r.stderr);
  const calls = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ args }) => args[args.indexOf('--slug') + 1]), ['team-extra-beta', 'team-alpha']);
  for (const call of calls) {
    assert.deepEqual(call.args.slice(0, 5), ['--yes', 'clawhub@0.23.3', '--no-input', 'skill', 'publish']);
    assert.equal(existsSync(join(call.args[5], 'SKILL.md')), true);
    assert.equal(call.args.includes('--version'), false, 'ClawHub skips unchanged content on retry');
    assert.equal(call.args.includes('test-secret'), false);
    assert.equal(call.validToken, true);
    assert.equal(call.mode, 0o600);
    assert.equal(existsSync(call.config), false, 'temporary credentials are removed');
  }
  r = run('yes');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /ClawHub publication failed/);
  const failed = JSON.parse(readFileSync(log, 'utf8').trim().split('\n').at(-1));
  assert.equal(existsSync(failed.config), false, 'credentials are removed on failure too');
});

test('ambiguous ClawHub slugs are rejected before publishing', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'skill-mart-slugs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(root, '.claude-plugin/marketplace.json', '{"name":"team","owner":{"name":"test"}}');
  put(root, 'skills/foo-bar/SKILL.md', '---\nname: foo-bar\ndescription: Test\n---\n');
  put(root, 'plugins/foo/skills/bar/SKILL.md', '---\nname: bar\ndescription: Test\n---\n');
  const r = cli(root, '--publish-clawhub', '--dry-run');
  assert.equal(r.status, 1);
  assert.match(r.stderr, /duplicate ClawHub slug "team-foo-bar"/);
  assert.equal(existsSync(join(root, 'plugin.json')), false);
});
