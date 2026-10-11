# skill-mart

リポジトリ内の `skills/<name>/SKILL.md` を見つけてカタログを生成し、
そのリポジトリを Claude / Codex / ChatGPT / Cursor / Copilot に登録できるようにする CLI。
skills.sh 経由の配布と ClawHub への公開にも対応する。

| 対象 | 出力 |
|---|---|
| Claude Code / Claude Desktop (Cowork) | `.claude-plugin/marketplace.json` |
| Codex / ChatGPT | `.agents/plugins/marketplace.json` |
| Cursor | `.cursor-plugin/marketplace.json` |
| GitHub Copilot | `.github/plugin/marketplace.json` |
| 各プラグイン（共通） | `<plugin>/plugin.json`（[Agent Plugins](https://agent-plugins.org) 形式） |
| skills.sh | GitHub リポジトリから直接インストール（専用カタログ不要） |
| ClawHub | `--publish-clawhub` で各スキルを公開 |

依存パッケージなし、Node.js 22 以上。

## 使い方

skills リポジトリのルートで実行する。

```bash
npx -y github:nogikun/skill-mart#main --require-name --version v1.2.0
```

追加の配布先に対応するコードが `main` に反映された後に使う。`v1.0.0` は Claude / Codex / ChatGPT 用のみ。
対応版のリリース後は `#main` をそのリリースタグに固定する。

| オプション | 説明 |
|---|---|
| `[dir]` | スキャンするディレクトリ（既定: `.`） |
| `--version` | プラグインの version。`v` 付きタグもそのまま渡せる。省略時は既存の値を維持 |
| `--owner` | owner 名。省略時は既存の値 → git remote の owner |
| `--dry-run` | 検証と表示だけ行い、書き込まない。SKILL.md に不備があれば exit 1 |
| `--require-name` | 全配布先で必要な SKILL.md の `name` も検証。同期 workflow では常に指定 |
| `--publish-clawhub` | カタログ生成後、各スキルを ClawHub に公開。環境変数 `CLAWHUB_TOKEN` が必要。`--dry-run` 併用時は対象の表示だけ行う |

## ルール

- **`skills/` を含むディレクトリ = 1 プラグイン**
  - `skills/foo/SKILL.md` → リポジトリ全体が 1 プラグイン（名前はリポジトリ名）
  - `plugins/x/skills/foo/SKILL.md` → プラグイン `x`
  - スキルを個別にインストールさせたいなら `plugins/<skill>/skills/<skill>/` に置く
- `.` で始まるディレクトリ（`.claude/skills` など開発用）と `node_modules` は対象外
- SKILL.md は `description` 必須。`name` を書くならディレクトリ名と一致させる
  - 全配布先に配布する場合は `name` も必須。小文字の英数字とハイフンで指定する
- 既存の marketplace.json を手で編集した項目（`category`, `tags` など）は再生成しても残る。
  ツールが書く `name` / `source` / `description` / `version` は上書きされる
- マーケットプレイス名は一度決まったら変えない（既存の `name` を優先）。利用者のインストールがこの名前に紐づくため
- `<plugin>/plugin.json` は `$schema` が agent-plugins.org のものだけ更新する。別用途の `plugin.json` があればエラーで止まる

## GitHub Actions でリリース時に反映する

[examples/marketplace.yml](examples/marketplace.yml) を skills リポジトリの `.github/workflows/` にコピーする。

- PR: SKILL.md を検証（`--dry-run`）
- Release 公開: `version = タグ` で再生成し、既定ブランチに commit
- Prerelease: 何もしない（利用者は既定ブランチのカタログを読むため、全員に配信されてしまう）

同期では4種類のカタログと各プラグインの `plugin.json` をまとめて更新する。
カタログは `.gitignore` の対象でも commit に含める。
workflow の実行結果の Summary に各配布先の登録方法・インストールコマンドを表示する。

運用上の注意:

- `GITHUB_TOKEN` で作られた Release では `release` イベントが発火しない。release-please などで自動リリースする場合は、
  そのワークフローから `workflow_call` で呼ぶ
- 既定ブランチを保護している場合は GitHub App トークンが必要（ワークフロー内のコメント参照）

### ClawHub の自動公開

skills リポジトリの Settings → Secrets and variables → Actions に以下を設定する。

| 種別 | 名前 | 値 |
|---|---|---|
| Variable | `CLAWHUB_PUBLISH` | `true` |
| Secret | `CLAWHUB_TOKEN` | [ClawHub](https://clawhub.ai) の公開用 API トークン |

これでカタログの commit / push 成功後、リリースまたは手動実行のたびにスキルを公開する。
`workflow_call` で呼ぶ場合は、呼び出し元で `secrets: inherit` を指定するか、`CLAWHUB_TOKEN` を明示的に渡す。
有効化したのにトークンがない場合はエラーで止まる。PR と prerelease では公開しない。

公開単位はプラグインではなく `skills/<name>/` のスキルと付属ファイル。
slug はルートのスキルなら `<marketplace>-<skill>`、サブプラグイン内なら `<marketplace>-<plugin>-<skill>`。
同じ slug が複数できる場合は公開前にエラーにする。
ClawHub 側の version は内容変更に応じて自動更新し、変更なしなら公開をスキップする。
リリースタグを使うカタログの version とは独立する。途中で失敗した場合は再実行できる。
元リポジトリから削除したスキルの ClawHub 公開は自動削除しない。

ClawHub CLI は公開するときだけ `npx` で取得する（`clawhub@0.23.3`）。
トークンは権限を制限した一時ファイルで渡し、成功・失敗のどちらでも削除する。
公開と更新の仕様は [ClawHub 公式ガイド](https://docs.openclaw.ai/clawhub/quickstart) を参照。

### skills.sh と Cursor の公開一覧

[skills.sh](https://www.skills.sh/docs/faq) は専用の `marketplace.json` や公開 API を使わず、
利用者が `npx skills add owner/repo` でインストールすると、テレメトリーを通じて公開一覧に反映される。
workflow は配布可能なリポジトリを整備し、Summary にこのコマンドを表示する。
CI から掲載目的のインストールは行わない。公開一覧に載せるにはリポジトリを公開する。

Cursor は GitHub リポジトリのマーケットプレイスをインポートできる。
Cursor の公式公開一覧にも掲載したい場合は、生成済みリポジトリを
[投稿フォーム](https://cursor.com/marketplace/publish) に提出し、審査を受ける。
カタログの生成・更新は workflow で完了するが、公式一覧への審査は別途必要。

## 利用者側の登録

カタログは既定ブランチから読まれる。

| アプリ | 手順 |
|---|---|
| Claude Desktop (Cowork) | Customize → `+` → Add marketplace from GitHub → リポジトリ URL |
| Claude Code | `/plugin marketplace add owner/repo` |
| Claude 組織 (Team/Enterprise) | 組織設定 → Plugins & skills → Marketplaces → Add → Sync from GitHub |
| Codex CLI / ChatGPT デスクトップの Codex | `codex plugin marketplace add owner/repo` |
| ChatGPT ワークスペース (Business/Enterprise) | 管理者が GitHub マーケットプレイスをインポート・同期 |
| Cursor | Customize → From GitHub Repository でリポジトリを指定、またはチームのマーケットプレイスに追加してプラグインをインストール（[公式手順](https://cursor.com/docs/skills)） |
| GitHub Copilot CLI | `copilot plugin marketplace add owner/repo`（[公式手順](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/plugins-marketplace)） |
| skills.sh 対応エージェント | `npx skills add owner/repo` |
| OpenClaw / ClawHub | ClawHub に公開されたスキルをインストール |

個人の ChatGPT アカウントでは、ChatGPT の UI から任意のリポジトリを追加できない（2026-09 時点、OpenAI のドキュメントより）。

## 開発

```bash
npm test
```

リリースは `package.json` の version を上げてタグ（`v1.0.0` など）を打つ。skills リポジトリ側は `#vX.Y.Z` でタグ固定して使う。

環境構築（任意）: Nix（[Determinate Systems 版](https://install.determinate.systems)推奨）→ `task init`
