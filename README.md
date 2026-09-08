# スキルアップ図鑑（skillup-zukan.net）

講座・スクールの比較図鑑サイト。**公開中**（https://skillup-zukan.net/）。

- Phase 1: スキーマ・収集パイプライン・口コミ要約パイプライン・診断ウィザードのロジック（完了）
- Phase 2: フロントエンド（一覧・詳細・診断）、静的ページ生成、独自ドメインでの公開（完了）

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
scraper/lib/branding.js       ロゴURL・ジャンルアイコン・色（画像まわりの方針）
scraper/lib/recommend.js      おすすめ枠の選定（掲載情報の充実度）
scraper/recheck-guards.js     全レコードへのガード再適用（AI呼び出しなし）
index.html                    一覧・詳細・診断（1枚のSPA）
assets/wizard.js              診断ロジックのブラウザ用バンドル（lib/から自動生成）
scraper/prerender.js          Puppeteerでの静的化
scraper/generate-sitemap.js   sitemap.xml と llms.txt の生成
DATA_QUALITY_POLICY.md        データ品質ポリシー（判断基準）
PROJECT_CONTEXT.md            プロジェクト共通コンテキスト（図鑑シリーズ）
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

## 口コミ要約パイプライン（現在は停止中）

**2026-09-08 時点の方針: 当面は口コミ無しで進める。** 3サイトを調査した結果、いずれも
自動収集を見送ることにした。設定は `data/review-sources.json` で全件 `enabled: false` の
ままで、パイプラインは1件もHTTPリクエストを送らない（fail-closed）。

| サイト | 調査結果 |
| --- | --- |
| コエテコキャンパス | `robots.txt` が `Disallow: /campus/reviews/*` を明示。口コミページを名指しで拒否 |
| マナビット | 会員規約の禁止行為に「営利を目的とした行為」「商業目的での利用・複製」 |
| リスキリング.jp | `robots.txt` に禁止なし、規約ページも見当たらず。ただし口コミは投稿者・運営者の著作物で、同種の比較サイト（競合）の中心コンテンツにあたるため見送り |

口コミ機能を再開する場合の選択肢は、各スクールから転載許可を得る／図鑑に投稿フォームを
置いて自前で集める、のいずれか。他社サイトからの自動収集を再検討する場合は、上表の
調査をやり直したうえで `enabled` / `robots_txt_ok` / `terms_ok` / `checked_by_human_at` を
埋めること（4つ揃っていないホストへのリクエストは実行時に拒否される）。

実装自体は残してある（`lib/review-summary.js`）。原文は保存せず、複数件をまとめた
「傾向」だけを要約し、必ず出典とセットで保存する設計。

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

### 掲載スクールの画像の扱い

**ロゴ（ファビコン）だけを表示し、それ以外の画像は使わない。**

| 使うもの | 使わないもの |
| --- | --- |
| ロゴ（ファビコン）。Googleのアイコン配信サービス（`https://www.google.com/s2/favicons`）経由 | 各スクールが作った共有用の大きな画像（`og:image`）、講座紹介の写真・図版 |

ロゴを使う理由は「どのスクールかを見分けるため」の識別用途で、既存2サイト
（agent-zukan / freelance-anken-zukan）も同じ方式を取っている。画像を当サイトの
サーバーに複製せず、サイズも小さい。

`og:image` を使わない理由は3つある。

1. 著作権が各スクールにあり、営利サイトへの無断掲載は許諾の範囲外になりうる
2. 相手のサーバーから直接読み込む（ホットリンク）ため、相手の通信量を使うことになる
3. 相手が画像を差し替える・参照を拒否すると、こちらの表示が勝手に壊れる

当サイトは各スクールから掲載許諾を得ているわけではなく、公開情報をもとに勝手に
掲載している立場なので、相手の負担になる取り方はしない。

代わりに、ジャンルのアイコンとロゴの代替タイルは当サイトで描き起こしている
（`lib/branding.js` の `GENRE_ICONS` / `monogram()`）。この方針は
`test/branding.test.js` が機械的に検査していて、index.html に
`google.com/s2/favicons` 以外の外部画像が混ざるとテストが落ちる。


## 実行

```bash
cd scraper

npm test                                   # ユニットテスト（287件）
npm run generate-mock                      # モックデータ40件を再生成
npm run validate                           # data/schools.json をスキーマ検証
node validate-schools.js ../data/mock/schools.mock.json

DISCOVER_GENRES=programming npm run discover    # 1ジャンルだけ発見（既定も programming）
DISCOVER_GENRES=all DISCOVER_MAX_PER_RUN=20 npm run discover

npm run build-wizard                       # assets/wizard.js を lib/ から再生成
npm run prerender                          # /school/{id}/ と /category/{genre}/ を静的化
npm run recheck-guards                     # 全レコードにガードを再適用（ジャンル追加のたびに実行）
npm run reverify-skips                     # スキップリストの再検証
REVIEW_ONLY_SCHOOL_ID=<id> npm run summarize-reviews   # 1校だけ口コミ要約
```

### 主な環境変数

| 変数 | 既定 | 用途 |
| --- | --- | --- |
| `DISCOVER_GENRES` | `programming`（cronは `all`） | 対象ジャンル（カンマ区切り、`all` で全8ジャンル。`all` の並び順は日付で回転する） |
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

### 抽出結果に対する機械的なガード

**プロンプトの指示だけに頼らない。** 初回の本番実行で、プロンプトに「本文から読み取れなければ null」と書いてあるにもかかわらず、AIがフッターの著作権表記から運営会社名を合成する誤りが3件中3件で起きた。以降は「AIへの指示」と「本文照合による機械的な検証」を必ず二重で持つ方針にしている（`normalizeStructuredFields()` 内）。

| ガード | 内容 |
| --- | --- |
| `verifyOfficialName()` | `official_name` がページ本文に一字一句無ければ `null` に落とす |
| `verifySubsidyClaim()` | 本文に給付金関連のキーワードが一つも無ければ `subsidy_eligible` を `false` に倒す |
| `verifyPlans()` | plans の金額・期間がページ本文に無ければ、その項目を null にする |
| `verifyCareerPaths()` | `career_paths` の職種名がページ本文に無ければ落とす |
| `verifyPrefectures()` / `filterToCampusPrefectures()` | `area` の都道府県が本文に無い、または通学拠点の根拠が無ければ落とす（トップページ経路・フォールバック経路の両方で通す） |
| `filterFeatures()` | `features` から検証不能な統計的数値主張・金銭的コミットメント文言・最上級の主張を除外する |
| `stripExaggeratedSentences()` | `description` から同じ基準で該当する**文**を落とす（散文なので文単位） |
| `classifyFormat()` | 受講形式を確定し、確定できなければ `review_flags: ["format_unconfirmed"]` を立てる |

`description` にも `features` と同じ基準を適用する。散文なので該当する文ごと落とし、残りは自然な文章として成立させる（日本語の文は「。」で区切れば単体で意味が通る）。短くなること自体は問題としないが、除外で客観的事実まで巻き込まれた場合は、カリキュラム内容・受講形式等の事実で補う。

`filterFeatures()` が落とすのは、「転職成功率99%」のような検証不能な統計、「転職保証」「返金保証」のような金銭的コミットメント、「業界No.1」のような最上級の主張。いずれも本文に実際に書かれてはいるが、真偽をこちらで検証できず、図鑑が中立的な「特徴」として並べるとその主張を保証しているように読める。**除外の結果 `features` が0〜2件になっても水増ししない。** 残すのは客観的事実（カリキュラム、サポート形態、受講形式、講師属性、教材）に限る。

`classifyFormat()` は、以前「`offline`/`both` なのに `area` が空なら問答無用で `online` に丸める」としていた箇所を置き換えたもの。通学拠点を持つスクールを黙ってオンライン専用として掲載すると、都道府県フィルターで通学先を探せなくなるため、次の判定にした。

- `area` が取れている通学系 → そのまま採用
- 本文に「完全オンライン」「すべてオンライン」「オンラインに特化」等の明示があれば **オンライン確定**
- それ以外 → `online` として掲載しつつ `format_unconfirmed` を立てる（承認フェーズが無いため掲載自体は止めない）

`review_flags` は社内参考情報で、UI表示には使わない。`subsidy_eligible` の裏取りは、給付金対象であることの言い回しが多様（「教育訓練給付金対象」「給付金で最大80%OFF」「リスキリング支援事業対象」等）なため、**キーワードが一つも無ければ `false` に倒す**という粗い判定にとどめてある。キーワードがあれば、その文脈の妥当性まではAIの判断を尊重する。

## 価格と期間: plans が事実、price は導出

`plans[]` がレコードの事実で、`price` はそこから機械的に導出される表示用オブジェクト。

```json
"plans": [
  { "label": "集中8週間プラン", "amount": 475200, "duration": "8週間" },
  { "label": "16週間プラン",   "amount": 567600, "duration": "16週間" }
],
"price": { "display": "475,200円〜", "min_yen": 475200, "scope": "detail_page" }
```

- **期間はプラン単位でのみ持つ。** スクール全体の代表 `duration` は持たない。実データを調べた結果、期間は「1プラン＝1期間＝1金額」のセットで、スクール全体の目安値という概念が存在しなかった（`tech-camp` の旧 `duration`「短期集中スタイル：10週間 / 夜間・休日スタイル：約6ヶ月」は plans を散文で書き直しただけだった）
- **「最短」を代表値にしない。** `sejuku` の料金ページには「無料カウンセリング実施後2週間以内のご入会」というキャンペーンの申込期限があり、素朴に最短を取ると受講期間として `2週間` を掲げてしまう。`min_yen` が割引価格になった件と同じ轍
- `amount` / `duration` はどちらも `null` を許す（金額だけ・期間だけ載っているページがあるため）。両方 null のプランは名前だけ残っても使い道が無いので落とす
- `price.display` / `price.min_yen` は `plans` から機械生成し、AIには書かせない

### 金額の種別（kind）

`plans[].kind` は `total`（一括・総額）/ `monthly`（月額）/ `enrollment`（入学金）。`price.min_yen` は**同じ種別の中でのみ**求める（`total` を優先し、無ければ `monthly`）。入学金は受講料そのものではないので `min_yen` には使わない。種別を判定できなかったプランも使わない。

混ぜてはいけない理由は Vook school の実例。月額39,600円（別途入学金139,700円）を、sejuku の一括475,200円と同じ `min_yen` 軸に並べると、桁の違うものが同列に見えてしまう。月額の場合は `display` も「月額39,600円〜」とし、数字だけで一括料金と見分けが付かない状態を避ける。

`price.kind` に、その `min_yen` がどちらの種別かを持たせてある。**価格ソートは同じ `kind` 同士で行うこと。**

 に、その  がどちらの種別かを持たせてある。**価格ソートは同じ  同士で行うこと。**

### 巡回した詳細ページのURL

`price_detail_url` と `area_detail_url` は用途別に分けてある。1つの `detail_page_url` を price と area で共有していた時期があり、後から走った area 巡回が price の出所（`/courses/career/`）を会社概要ページのURLで上書きしてしまった。`price.scope` はこの `price_detail_url` の有無から導出する。

## 広告枠（Google AdSense）

枠は4か所。設定は `index.html` の `var ADSENSE = { ... }` にまとまっている。
`client` もスロットIDも**既存2サイトと同じものを流用**している
（AdSense の広告ユニットはアカウントに属していて、複数サイトで使い回せる）。

| 場所 | 設定キー | 現在のID |
| --- | --- | --- |
| 一覧の最上部 | `ADSENSE.slots.top` | `1771024424` |
| 一覧の途中（6件ごと） | `ADSENSE.slots.inFeed` | `5518697744` |
| 一覧の最下部 | `ADSENSE.slots.bottom` | `1620805016` |
| 講座の詳細ページ | `ADSENSE.slots.detail` | `7953289398` |

### 流用したことによる制約

ユニット単位のレポートが3サイト分まとまってしまう。どの場所がこのサイトでいくら
稼いだかを分けて見たくなったら、AdSense でこのサイト専用の広告ユニットを作って
`slots` を差し替える。サイト単位の売上は AdSense のサイト別レポートで分けて見られる。

### 広告が出ないとき

AdSense の管理画面で `skillup-zukan.net` が「サイト」として追加され、審査を通って
いるかを確認する。**未登録のうちは、IDが正しくても配信されない。**

配信されなかった枠は自動で消える（AdSense が `ins` に付ける
`data-ad-status="unfilled"` を見て、`.ad-slot` ごと非表示にしている）ので、
「広告」の見出しと空白だけが残ることはない。

### 触るときの注意

- `slots` を変えたら `cd scraper && node prerender.js` で静的ページを作り直す
- 静的化したHTMLには広告タグを入れない（`window.__PRERENDER__` で抑止）。
  入れてしまうと古い広告タグがHTMLに残り続ける
- AdSense のスクリプトは `<head>` に直接書かず、IDが設定されているときだけJSから読み込む

これらは `test/site-ui.test.js` が検査している。

## おすすめ講座（トップの横スクロール）

選び方は `lib/recommend.js`。**提携（アフィリエイト）している講座だけ**を出す広告枠で、
目印は `cta_type === "affiliate"`。agent-zukan / freelance-anken-zukan の `featured` 枠と
同じ考え方で、A8などの提携データを取り込むときにこの値が立つ。

提携が0件のあいだは**枠ごと表示しない**。情報が充実した講座などで埋めてはいけない
（「PR」表示と実態が食い違うため）。表示順は毎回ランダムにする（特定の1社だけが
常に先頭になるのを避けるため）。ジャンル別ページには出さない。

### 表示するときの約束

提携している講座を選んで見せる枠なので、**必ず「PR」表示を添える**。
2023年10月からのステマ規制（景品表示法）で、広告であることを隠すと違反になる。
`affiliateBadges()` が「注目」と「PR」を対で出しており、`test/recommend.test.js` が
PR表示の有無を検査している。

### 提携の有無が影響する範囲（ここだけ）

| 場所 | 提携の影響 |
| --- | --- |
| おすすめ枠 | **提携先のみ**を表示する（広告枠） |
| 診断結果 | 点数は影響を受けない。**点数が完全に同点のときだけ**提携先を先に出す（`lib/match.js`） |
| 一覧の並び順 | 影響なし（料金の安い順） |
| 掲載するかどうか・掲載内容 | 影響なし（公式サイトの記載のみに基づく） |

この範囲は `faq.html` と `privacy.html` にも書いてある。変えるときは両方を直すこと。

## 診断ウィザード

質問は `lib/wizard-questions.js`、スコアリングは `lib/match.js`。

- Q2（ジャンル）の選択肢の並びは、Q1で選ばれた目的を上位に置いているジャンル順（`GENRE_PURPOSE_ORDER` の逆引き = `genreOrderForPurpose()`）
- Q4で「通学」を選んだ場合のみ、都道府県の追加質問が出る
- 配点: 目的一致 +3 / レベル完全一致 +2・隣接 +1 / 受講スタイル一致 +2 / 給付金 +2 / ジャンル一致数 最大 +3
- 同点のタイブレーク: 口コミの出典件数が多い方 → `cta_type === "affiliate"` を優先
- マッチ理由は加点の大きかった上位2項目を自然文に変換したもの（`match_reasons`）

「口コミ件数」は口コミ原文を保存しない設計のため、`review_summary.sources[]` の件数を指標として使っている。

## 公開とデプロイ

GitHub Pages（`main` ブランチのルート）＋ Cloudflare DNS。既存2サイトと同じ構成。

| 項目 | 設定 |
| --- | --- |
| ホスティング | GitHub Pages / source = `main` ブランチの `/`（build_type: legacy） |
| 独自ドメイン | `CNAME` ファイル（`skillup-zukan.net`、末尾改行なし・apexのみ） |
| DNS | Cloudflare。apex に GitHub Pages の A レコード4件（185.199.108-111.153） |
| プロキシ | **DNS only（グレーの雲）**。オレンジの雲にすると Pages の証明書発行が通らない |
| SSL/TLS | Cloudflare 側 `Full` |
| HTTPS | GitHub Pages 側で Enforce HTTPS 有効（http → https は 301） |

デプロイは push で自動。`main` が更新されると Pages が再ビルドする。
日次ディスカバリーのワークフローは `data/schools.json` の更新後に `prerender.js` と
`generate-sitemap.js` を回して `school/` `category/` `sitemap.xml` `llms.txt` まで
コミットするため、収集結果がそのまま公開ページに反映される。

`404.html` は Pages が自動で使う。掲載を取り下げたスクールの静的ページは
`school/<id>/` ごと消えるため、そのURLは 404 に落ちる。

サブドメイン `www` は未設定（apex のみ）。必要になったら Cloudflare に
`www` → `ttr-fjmt.github.io` の CNAME（DNS only）を足す。

### 状態を確認する

```bash
gh api repos/ttr-fjmt/skillup-zukan/pages          # ビルド状況・証明書・HTTPS強制
curl -sI https://skillup-zukan.net/ | head -1      # 実際の応答
```

## 動作確認の進め方

1. ~~モックデータ40件のスキーマ検証~~ → `npm run generate-mock` で生成し全件通過済み
2. ~~診断ウィザードのスコアリングのユニットテスト~~ → `npm test`（287件）で通過済み
3. ~~発見パイプラインを1ジャンルのみ実行~~ → programming から始めて全8ジャンルの初回実行が完了。
   日次 cron の対象も `all` に広げてある
   ```bash
   DISCOVER_GENRES=programming DISCOVER_MAX_PER_RUN=3 npm run discover
   ```
   確認する点: 二段階検証が機能しているか（`name_mismatch` / `fetch_failed` がスキップリストに落ちているか）、`skill_genre[]` の自動付与が妥当か、`[ai:cache]` の `cache_read` が2件目以降で増えているか、`data/discovery-log/YYYY-MM-DD.json` に新規IDが記録されているか。承認フェーズが無く即時公開されるため、この回で入った分は必ず目視で確認すること
4. **口コミ要約パイプラインは当面動かさない**（`data/review-sources.json` は全件 `enabled: false`）。
   3サイトを調査した結果、robots.txt または利用規約の理由で見送っている
   ```bash
   REVIEW_ONLY_SCHOOL_ID=<id> npm run summarize-reviews
   ```
   確認する点: 出力された要約文が原文の構成をなぞっていないか（**人力確認**）
5. ジャンルを増やしたあとは `npm run recheck-guards` を全レコードに流し、
   `npm run validate` が通ることを確認する

## 未確定・要判断事項

- ジャンル別発見クエリの精度・ヒット数（少なければ `lib/discovery-queries.js` にクエリを追加する）
- `skill_genre[]` 自動付与の精度（承認フェーズが無く直接公開されるため、`data/discovery-log/` の記録を手がかりに事後で確認する。誤判定が目立つ場合は `normalizeStructuredFields()` の丸め込みか抽出プロンプトを調整する）
- 口コミ要約の品質（原文に寄りすぎる場合は `lib/review-summary.js` のプロンプトを調整する）
- A8インポート（`cta_url` / `cta_type: "affiliate"` の流し込み）は提携が取れてから。既存2サイトの `import-a8.js` を移植する想定
