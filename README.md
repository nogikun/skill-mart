# skill-mart

リポジトリ内の `skills/<name>/SKILL.md` を見つけてカタログを生成し、
そのリポジトリを Claude / ChatGPT のアプリに `owner/repo` で入力するだけでマーケットプレイスとして登録できるようにする CLI。

| 対象 | 出力 |
|---|---|
| Claude Code / Claude Desktop (Cowork) | `.claude-plugin/marketplace.json` |
| Codex / ChatGPT | `.agents/plugins/marketplace.json` |
| 各プラグイン（共通） | `<plugin>/plugin.json`（[Agent Plugins](https://agent-plugins.org) 形式） |

依存パッケージなし、Node.js 22 以上。

## 使い方

skills リポジトリのルートで実行する。

```bash
npx -y github:nogikun/skill-mart#v1.0.0 --version v1.2.0
```

| オプション | 説明 |
|---|---|
| `[dir]` | スキャンするディレクトリ（既定: `.`） |
| `--version` | プラグインの version。`v` 付きタグもそのまま渡せる。省略時は既存の値を維持 |
| `--owner` | owner 名。省略時は既存の値 → git remote の owner |
| `--dry-run` | 検証と表示だけ行い、書き込まない。SKILL.md に不備があれば exit 1 |

## ルール

- **`skills/` を含むディレクトリ = 1 プラグイン**
  - `skills/foo/SKILL.md` → リポジトリ全体が 1 プラグイン（名前はリポジトリ名）
  - `plugins/x/skills/foo/SKILL.md` → プラグイン `x`
  - スキルを個別にインストールさせたいなら `plugins/<skill>/skills/<skill>/` に置く
- `.` で始まるディレクトリ（`.claude/skills` など開発用）と `node_modules` は対象外
- SKILL.md は `description` 必須。`name` を書くならディレクトリ名と一致させる
- 既存の marketplace.json を手で編集した項目（`category`, `tags` など）は再生成しても残る。
  ツールが書く `name` / `source` / `description` / `version` は上書きされる
- マーケットプレイス名は一度決まったら変えない（既存の `name` を優先）。利用者のインストールがこの名前に紐づくため
- `<plugin>/plugin.json` は `$schema` が agent-plugins.org のものだけ更新する。別用途の `plugin.json` があればエラーで止まる

## GitHub Actions でリリース時に反映する

[examples/marketplace.yml](examples/marketplace.yml) を skills リポジトリの `.github/workflows/` にコピーする。

- PR: SKILL.md を検証（`--dry-run`）
- Release 公開: `version = タグ` で再生成し、既定ブランチに commit
- Prerelease: 何もしない（利用者は既定ブランチのカタログを読むため、全員に配信されてしまう）

運用上の注意:

- `GITHUB_TOKEN` で作られた Release では `release` イベントが発火しない。release-please などで自動リリースする場合は、
  そのワークフローから `workflow_call` で呼ぶ
- 既定ブランチを保護している場合は GitHub App トークンが必要（ワークフロー内のコメント参照）

## 利用者側の登録

カタログは既定ブランチから読まれる。

| アプリ | 手順 |
|---|---|
| Claude Desktop (Cowork) | Customize → `+` → Add marketplace from GitHub → リポジトリ URL |
| Claude Code | `/plugin marketplace add owner/repo` |
| Claude 組織 (Team/Enterprise) | 組織設定 → Plugins & skills → Marketplaces → Add → Sync from GitHub |
| Codex CLI / ChatGPT デスクトップの Codex | `codex plugin marketplace add owner/repo` |
| ChatGPT ワークスペース (Business/Enterprise) | 管理者が GitHub マーケットプレイスをインポート・同期 |

個人の ChatGPT アカウントでは、ChatGPT の UI から任意のリポジトリを追加できない（2026-09 時点、OpenAI のドキュメントより）。

## 開発

```bash
npm test
```

リリースは `package.json` の version を上げてタグ（`v1.0.0` など）を打つ。skills リポジトリ側は `#vX.Y.Z` でタグ固定して使う。

環境構築（任意）: Nix（[Determinate Systems 版](https://install.determinate.systems)推奨）→ `task init`
