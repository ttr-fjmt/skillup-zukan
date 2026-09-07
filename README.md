# スキルアップ図鑑（skillup-zukan.net）— Phase 1

講座・スクールの比較図鑑サイト。Phase 1 は**スキーマ・収集パイプライン・口コミ要約パイプライン・診断ウィザードのロジック**までを実装する範囲で、ドメイン取得とデプロイは含まない。フロントエンド（HTML/カテゴリーページ/詳細ページ）も Phase 2 以降。

共通ロジックは [agent-zukan](https://github.com/ttr-fjmt/agent-zukan) / [freelance-anken-zukan](https://github.com/ttr-fjmt/freelance-anken-zukan) の二段階検証方式・日次ディスカバリー・プロンプトキャッシュの構造をそのまま踏襲している。

## ディレクトリ

```
schema/school.schema.json     School レコードの JSON Schema（draft 2020-12）
data/schools.json             掲載データ本体
data/school-discover-skip.json 実在照合に失敗した候補のスキップリスト
data/review-sources.json      口コミサイトの許可リスト（既定は全件 enabled=false）
data/mock/schools.mock.json   動作確認用の架空データ40件（自動生成）
data/discovery-log/           日次で新規 active 化されたIDの記録（YYYY-MM-DD.json）
scraper/lib/schema.js         GENRE / PURPOSE / LEVEL / GENRE_PURPOSE_ORDER 等のマスタ
scraper/lib/school-discovery.js 二段階検証パイプラインの中核
scraper/lib/discovery-log.js  日次の実行記録の書き出し
scraper/lib/review-summary.js 口コミ要約パイプラインの中核
scraper/lib/match.js          診断ウィザードのスコアリング
scraper/discover-schools.js   日次ディスカバリーのエントリーポイント
scraper/reverify-old-skips.js スキップリストのレスキュー（週次）
scraper/summarize-reviews.js  口コミ要約バッチ（週次・人力確認が済むまで動かない）
```

`GENRE` / `PURPOSE` / `LEVEL` / 都道府県は `scraper/lib/schema.js` が唯一のソースで、JSON Schema の enum・AIツール定義の enum・診断ウィザードの選択肢はすべてそこから導出する。ズレは `scraper/test/schema-masters.test.js` が落とす。

## セットアップ

```bash
cd scraper && npm install
```

Claude API を使うスクリプト（`discover-schools.js` / `summarize-reviews.js`）には `ANTHROPIC_API_KEY` が必要。

## 口コミ要約パイプラインを有効化する前に（人力確認が必須）

`summarize-reviews.js` は **fail-closed** で設計してあり、`data/review-sources.json` の各サイトについて次の4つが揃っていないホストには**1度もHTTPリクエストを送らない**。

- `enabled: true`
- `robots_txt_ok: true`
- `terms_ok: true`
- `checked_by_human_at: "YYYY-MM-DD"`

この確認は自動化していない（コードが「たぶん大丈夫」と判断してよい種類の問題ではないため）。ブラウザで次を確認してから、上記4項目を手で埋めること。

1. 各サイトの `/robots.txt`
   - <https://coeteco.jp/robots.txt>
   - <https://manab-it.com/robots.txt>
   - <https://xn--nckgz9qc8c.jp/robots.txt>（リスキリング.jp）
2. 各サイトの利用規約における、自動アクセス・クローリングに関する規定
3. いずれかでブロックされているサイトは `enabled: false` のまま（対象から除外）

確認が済んだら `.github/workflows/summarize-reviews.yml` の `schedule` ブロックのコメントを外して週次実行に切り替える。

実行時には、許可リストとは別に `lib/robots.js` による robots.txt の機械チェックも通す（二重の安全網。人力確認の代わりにはならない）。リクエスト間隔は最低2秒（`REVIEW_MIN_DELAY_MS`）。

## 表示名の約束: `school_name` を使う

UIに出すスクールの名称は、**必ず `school_name`（サービス名）**を使う。詳細ページの見出し・一覧のカード・診断結果・CTA周辺のいずれも同じ。

`official_name`（運営会社の正式名称）は**社内参考情報で、UI表示には使わない**。理由は2つ。

1. 利用者が探しているのはサービス名であって運営法人名ではない（「TechAcademy」を探す人は「株式会社ブリューアス」では見つけられない）
2. `official_name` は公式サイト本文に明示されていた場合のみ入り、確認できなければ `null` になる。表示に使うと、同じ画面で名前が出る講座と出ない講座が混ざる

`null` になるのは仕様どおりの正常な状態で、埋めるべき欠損ではない。`official_name` は運営元の照合や、同一法人が複数サービスを運営している場合の突き合わせに使う。

この方針は `schema/school.schema.json` の `school_name` / `official_name` の description と、`scraper/lib/schema.js` 冒頭のコメントにも記載してある。

## 著作権まわりの設計

口コミの原文は転載も1件ずつの言い換えもしない。`lib/review-summary.js` は次を構造として担保している。

1. 個別の口コミを1件ずつ要約させる呼び出し方をしない（必ず複数件をまとめて1回のAI呼び出しに渡す）
2. 原文は `data/` にも `schools.json` にも保存しない（AI入力としてメモリ上で使うだけ）
3. 要約文には必ず `sources[]`（出典名・URL・取得日時）が付く。`review_summary.sources` が空のレコードは JSON Schema が弾く

フロントエンドは「評判のポイント（出典：{source_name}）」＋出典への直リンクとセットでのみ表示する。要約の単独表示は禁止。

## 実行

```bash
cd scraper

npm test                                   # ユニットテスト（102件）
npm run generate-mock                      # モックデータ40件を再生成
npm run validate                           # data/schools.json をスキーマ検証
node validate-schools.js ../data/mock/schools.mock.json

DISCOVER_GENRES=programming npm run discover    # 1ジャンルだけ発見（既定も programming）
DISCOVER_GENRES=all DISCOVER_MAX_PER_RUN=20 npm run discover

npm run reverify-skips                     # スキップリストの再検証
REVIEW_ONLY_SCHOOL_ID=<id> npm run summarize-reviews   # 1校だけ口コミ要約
```

### 主な環境変数

| 変数 | 既定 | 用途 |
| --- | --- | --- |
| `DISCOVER_GENRES` | `programming` | 対象ジャンル（カンマ区切り、`all` で全8ジャンル） |
| `DISCOVER_MAX_PER_RUN` | `10` | 1回の実行で照合を通す候補数の上限 |
| `SCRAPER_MIN_DELAY_MS` | `3000` | 公式サイト巡回のポライトウェイト |
| `REVIEW_MIN_DELAY_MS` | `2000` | 口コミサイト巡回の最低インターバル |
| `REVERIFY_AFTER_DAYS` | `30` | スキップリスト再検証の対象とする経過日数 |
| `REVIEW_ONLY_SCHOOL_ID` | — | 口コミ要約を1校だけ実行 |
| `ANTHROPIC_DISCOVERY_MODEL` | `claude-sonnet-4-6` | 発見（web_search）用モデル |
| `ANTHROPIC_MODEL` | `claude-haiku-4-5-20251001` | 構造化用モデル |

## 収集パイプラインの原則

**二段階検証。** AIの「実在する」という自己申告を無条件に信用しない。

1. `searchGenreCandidates()` — Claude API の `web_search` でジャンル別に候補を発見（`lib/discovery-queries.js` の3〜5クエリを切り口として渡す）
2. `verifyCandidate()` — 候補の公式サイトへ実際にHTTPアクセスし、ページ本文にスクール名（法人格・サービス種別を除いた主要部分）が実在するか機械的に照合。ボット検出を避けるためブラウザ相当のUAを使う（`lib/http.js` の `VERIFY_UA`）

照合に失敗した候補は `data/school-discover-skip.json` に記録し再試行しない。`reverify-old-skips.js` が30日後にまとめて再検証し、通ったものだけスキップリストから外す。

**承認フェーズは無い。** 二段階検証を通過したレコードは、その時点で `status: "active"` として保存され、そのまま診断ウィザードの候補に入る。`status` は `"active"` / `"skipped"` の2値のみ。

代わりに、その回で新しく `active` 化されたIDを日次で記録する（`lib/discovery-log.js`）。承認UI・通知は持たない。

```
data/discovery-log/2026-09-07.json
[
  { "date": "2026-09-07", "genre": "programming", "new_school_ids": ["example-school", "..."] }
]
```

同じ日に複数回実行した場合は同じジャンルの行に追記され、前回分は消えない。新規が0件の日はファイルを作らない。日付はJST基準。

`skill_genre[]` / `purpose[]` / `target_level` / `career_paths[]` は公式サイト本文からのAI推定のまま公開されるので、精度の確認はこのログを手がかりに事後で行う。AIの出力は `normalizeStructuredFields()` が未知のenum値・矛盾した `format`/`area` の組み合わせを機械的に丸め、最終的に JSON Schema を通らないレコードは1件単位でスキップリストに落ちる。

**プロンプトキャッシュ。** 発見プロンプトのジャンル非依存な共通ルール部分と、構造化のツール定義に `cache_control: { type: 'ephemeral' }` を置いている。使用量は実行ログの `[ai:cache]` 行（`input` / `cache_write` / `cache_read` / `output`）で追える。

## 診断ウィザード

質問は `lib/wizard-questions.js`、スコアリングは `lib/match.js`。

- Q2（ジャンル）の選択肢の並びは、Q1で選ばれた目的を上位に置いているジャンル順（`GENRE_PURPOSE_ORDER` の逆引き = `genreOrderForPurpose()`）
- Q4で「通学」を選んだ場合のみ、都道府県の追加質問が出る
- 配点: 目的一致 +3 / レベル完全一致 +2・隣接 +1 / 受講スタイル一致 +2 / 給付金 +2 / ジャンル一致数 最大 +3
- 同点のタイブレーク: 口コミの出典件数が多い方 → `cta_type === "affiliate"` を優先
- マッチ理由は加点の大きかった上位2項目を自然文に変換したもの（`match_reasons`）

「口コミ件数」は口コミ原文を保存しない設計のため、`review_summary.sources[]` の件数を指標として使っている。

## 動作確認の進め方

1. ~~モックデータ40件のスキーマ検証~~ → `npm run generate-mock` で生成し全件通過済み
2. ~~診断ウィザードのスコアリングのユニットテスト~~ → `npm test`（102件）で通過済み
3. **発見パイプラインを1ジャンルのみ実行**（`ANTHROPIC_API_KEY` が必要 / 未実施）
   ```bash
   DISCOVER_GENRES=programming DISCOVER_MAX_PER_RUN=3 npm run discover
   ```
   確認する点: 二段階検証が機能しているか（`name_mismatch` / `fetch_failed` がスキップリストに落ちているか）、`skill_genre[]` の自動付与が妥当か、`[ai:cache]` の `cache_read` が2件目以降で増えているか、`data/discovery-log/YYYY-MM-DD.json` に新規IDが記録されているか。承認フェーズが無く即時公開されるため、この回で入った分は必ず目視で確認すること
4. **口コミ要約パイプラインを1校のみで実行**（上記の人力確認が完了してから / 未実施）
   ```bash
   REVIEW_ONLY_SCHOOL_ID=<id> npm run summarize-reviews
   ```
   確認する点: 出力された要約文が原文の構成をなぞっていないか（**人力確認**）
5. 3と4が問題なければ、ジャンルを1つずつ増やしながら本番相当のデータ収集へ

## 未確定・要判断事項

- ジャンル別発見クエリの精度・ヒット数（少なければ `lib/discovery-queries.js` にクエリを追加する）
- `skill_genre[]` 自動付与の精度（承認フェーズが無く直接公開されるため、`data/discovery-log/` の記録を手がかりに事後で確認する。誤判定が目立つ場合は `normalizeStructuredFields()` の丸め込みか抽出プロンプトを調整する）
- 口コミ要約の品質（原文に寄りすぎる場合は `lib/review-summary.js` のプロンプトを調整する）
- A8インポート（`cta_url` / `cta_type: "affiliate"` の流し込み）は提携が取れてから。既存2サイトの `import-a8.js` を移植する想定
