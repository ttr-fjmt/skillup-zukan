---
description: アフィリエイト案件のExcel(data/a8-import/アフィリエイト案件_スキルアップ図鑑.xlsx)の更新をコミット・push・ワークフロー実行・結果確認まで自動化する
---

data/a8-import/アフィリエイト案件_スキルアップ図鑑.xlsx の
更新を、以下の手順で完全自動処理してください。

【このサイト特有の前提】
既存2サイト（転職エージェント図鑑・フリーランス案件図鑑）と違い、
Excelから取り込むのは提携リンクだけです。掲載内容（料金・特徴・エリア等）は
必ず公式サイト本文から抽出・照合します。Excelの紹介文は掲載に使いません。
そのため、当サイトの8ジャンルに当てはまらない講座は掲載されずスキップされます。
これは意図した動作なので、失敗として報告せず「対象外」として伝えてください。

1. `git fetch origin && git status` で、リモートに新規コミットが
   無いか確認する（あれば `git pull --ff-only` で最新化する）。

2. 対象のExcelファイルに変更があるか `git status` で確認する。
   変更が無ければ、その旨を伝えて終了する（以降の手順は不要）。
   なお `~$` で始まる一時ファイルは Excel を開いている間にできるもので、
   .gitignore 済みなので無視してよい。

3. 変更があれば、以下でステージング・コミットする。

   ```
   git add "data/a8-import/アフィリエイト案件_スキルアップ図鑑.xlsx"
   git commit -m "chore: 提携案件のExcelを更新"
   ```

4. `git push` でリモートにpushする。

5. `gh workflow run import-a8.yml --repo ttr-fjmt/skillup-zukan`
   でワークフローを起動する。

6. 起動直後はrun IDがすぐに取得できない場合があるため、数秒待ってから
   `gh run list --workflow=import-a8.yml --repo ttr-fjmt/skillup-zukan --limit=1`
   で最新のrun IDを取得する。

7. `gh run watch <run-id> --repo ttr-fjmt/skillup-zukan --exit-status`
   で完了を待つ。

8. 完了後、`gh run view <run-id> --repo ttr-fjmt/skillup-zukan --log` で
   実行ログを取得し、以下のパターンで解析する
   （scraper/import-a8.js の実際の出力形式に基づく）。

   - サマリー行: `Done. updated=X added=Y skipped=Z` という形式の行。
     正規表現例: `/Done\. updated=(\d+) added=(\d+) skipped=(\d+)/`
   - 新規掲載: `[add]    スクール名 (id=xxx) ジャンル=...` という形式の行
     （`[add]` の後に空白4つ、`[update]` との桁揃え）。
     正規表現例: `/\[add\]\s+(.+?) \(id=/`
   - 既存の講座に提携リンクを付けた: `[update] スクール名 (id=xxx)` の行。
     正規表現例: `/\[update\]\s+(.+?) \(id=/`
   - 掲載しなかった行: `[skip]   スクール名: processing failed (理由)` の行。
     正規表現例: `/\[skip\]\s+(.+?): processing failed \((.+)\)/`

9. 以下の形式でユーザーに結果を報告する。

   - 新規掲載: X件（スクール名とジャンルの一覧）
   - 既存に提携リンクを設定: Y件（スクール名の一覧）
   - 掲載しなかった: Z件。**理由ごとに分けて伝える**
     - 「掲載条件を満たしません」→ 当サイトの8ジャンルに当てはまらなかった講座。
       スクール名を挙げ、掲載対象外である旨を伝える（失敗ではない）
     - 「実在照合に失敗」→ 公式サイトを取得できなかった、または
       ページ本文にスクール名が見当たらなかった。要確認として伝える
     - それ以外 → エラー内容をそのまま伝える
   - ワークフローの成功/失敗ステータス
   - 失敗した場合は、ログから読み取れるエラー内容も報告する

10. 掲載件数が変わった場合は、公開反映（GitHub Pages のビルド）が
    完了したことも確認してから報告する。

gh CLI が使えない場合のみ、フォールバックとして以下を案内する。

「GitHubの Actions タブから『Import affiliate schools』ワークフローを
手動実行してください
（https://github.com/ttr-fjmt/skillup-zukan/actions/workflows/import-a8.yml
→ Run workflow）」
