import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('sync workflow commits all catalogs even when their directories are ignored', (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'skill-mart-workflow-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const root = join(temp, 'repo');
  const remote = join(temp, 'remote.git');
  mkdirSync(root);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '--bare', remote);
  git('init', '-b', 'main');
  git('config', 'user.name', 'test');
  git('config', 'user.email', 'test@example.com');
  git('remote', 'add', 'origin', remote);
  writeFileSync(join(root, '.gitignore'), '.agents/\n.claude-plugin/\n.cursor-plugin/\n.github/plugin/\n');
  for (const dir of ['skills/alpha', 'plugins/beta/skills/beta']) {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, 'SKILL.md'), `---\nname: ${dir.split('/').at(-1)}\ndescription: Test skill\n---\n`);
  }
  git('add', '-A');
  git('commit', '-m', 'initial');
  git('push', '-u', 'origin', 'main');

  const workflow = readFileSync(join(import.meta.dirname, 'examples/marketplace.yml'), 'utf8');
  const commitStep = workflow.match(/      - name: Commit catalogs\n        run: \|\n((?:          .*\n)+)/)?.[1];
  assert.ok(commitStep, 'workflow has a commit step');
  const sync = (tag) => {
    execFileSync(process.execPath, [join(import.meta.dirname, 'cli.mjs'), root, '--owner', 'test', '--require-name', '--version', tag]);
    execFileSync('bash', ['-e', '-o', 'pipefail', '-c', commitStep], {
      cwd: root, env: { ...process.env, TAG: tag }, stdio: ['ignore', 'pipe', 'pipe'],
    });
  };
  const catalogs = ['.claude-plugin/marketplace.json', '.agents/plugins/marketplace.json', '.cursor-plugin/marketplace.json', '.github/plugin/marketplace.json'];
  for (const version of ['1.2.0', '1.3.0']) {
    sync(`v${version}`);
    for (const file of [...catalogs, 'plugin.json', 'plugins/beta/plugin.json']) {
      const data = JSON.parse(git('--git-dir', remote, 'show', `main:${file}`));
      assert.ok((data.plugins ?? [data]).every((plugin) => plugin.version === version), file);
    }
  }
  const head = git('rev-parse', 'HEAD');
  sync('v1.3.0');
  assert.equal(git('rev-parse', 'HEAD'), head, 'unchanged catalogs do not create another commit');

  const summary = join(temp, 'summary.md');
  const summaryStep = workflow.match(/      - name: Distribution summary[\s\S]*?        run: \|\n((?:          .*\n)+)/)?.[1];
  assert.ok(summaryStep, 'workflow has a distribution summary');
  execFileSync('bash', ['-e', '-o', 'pipefail', '-c', summaryStep], {
    cwd: root, env: { ...process.env, REPOSITORY: 'test/skills', CLAWHUB_ENABLED: 'false', GITHUB_STEP_SUMMARY: summary },
  });
  assert.match(readFileSync(summary, 'utf8'), /npx skills add test\/skills/);
  assert.match(readFileSync(summary, 'utf8'), /ClawHub publication enabled: false/);
});
