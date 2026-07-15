# 海外遠征（O-Ringen 2026）— 児玉さんの作業手順

Claude 側の実装は完了・検証済み。ここに残るのは**児玉さんの手でしかできない作業**だけ。
設計の背景は `docs/plans/2026-07-15_abroad_oringen.md`。

大会は **2026-07-20〜25**（7/22 は休養日）。

---

## 1. PR #60 をマージする（＝本番デプロイ）

https://github.com/kodanatlas/trails-jp/pull/60

Claude はマージできない（自分の PR を人のレビューなしに main へ入れる操作はハーネスがブロックする）。
trails.jp は **main マージ＝本番デプロイ**。

**先に見てほしい差分**（レビューが要るのはこの2つだけ、他は新規ファイル）:
- `src/components/Header.tsx` — ナビに1行追加しただけ
- `src/data/oringen-2026.json` — 50名分のスナップショット（生年が入っていないこと）

**2 と 3 が未設定でもマージして安全**。ingest が 500 を返すだけで、ページはバンドルしたスナップショット
（今日時点の正しいデータ）で動く。表示が壊れることはない。

デプロイ後に確認: https://trailsjp.vercel.app/abroad
- ナビに「海外遠征」が出ているか
- 児玉さんの1日目が **10:22**（08:22 なら時刻バグの再発。すぐ知らせてください）

---

## 2. Vercel に `ORINGEN_INGEST_SECRET` を設定する

自動更新に必要。**これが無いと開催直前にスタート時刻が埋まらない。**

1. 任意の長いランダム文字列を作る（例: パスワードマネージャで32文字以上）
2. Vercel → trails_jp → Settings → Environment Variables
3. Name: `ORINGEN_INGEST_SECRET` / Value: 上の文字列 / **Production にチェック**
4. Save

※ 既存の `CRON_SECRET` は流用しない（権限を分けてある）。

---

## 3. GitHub Secrets に同じ値を設定する

1. https://github.com/kodanatlas/trails-jp/settings/secrets/actions
2. New repository secret
3. Name: `ORINGEN_INGEST_SECRET` / Secret: **2 と同じ文字列**
4. Add secret

---

## 4. 手動実行して到達性を確認する（**最重要**）

**未知のリスクがここに1つある。** GitHub の runner は US にあり、`resultat.oringen.se` に到達できるか
未確認。過去に `geocode-smoke` が GH-hosted から国土地理院の地理ブロックに当たった前例がある。

1. https://github.com/kodanatlas/trails-jp/actions/workflows/sync-oringen.yml
2. 右上「Run workflow」→ Run workflow
3. ログを見る

**成功**: `日本勢: 50 名 / 延べ 245 エントリー / ...` → `ingest -> HTTP 200: {"success":true,...}` → `done`

**失敗したら Claude に貼ってください。** 特に:
- `fetch failed` / タイムアウト → **地理ブロックの疑い**。取得を手元で回して POST する運用に切り替える
  （ページと ingest はそのまま使えるので、手戻りは workflow だけ）
- `HTTP 200: {"success":false,"blocked":"..."}` → 品質ガードが更新を拒否した。**既存データは保持されている**
  ので表示は壊れていない。`blocked` の値を知らせてください

以降は **1日2回自動**（13:00 と 23:00 JST）。手動で更新したいときはいつでも 4 の手順で回せる。

---

## 5. 共有する前に

**スマホで自分の目で見てから配る。** 一度開いたスマホは古いキャッシュを掴んでいることがある
（実際に起きた）。**古い版は2時間早い時刻を表示するので、そのまま配ると2時間早く会場に行く人が出る。**

- スマホで https://trailsjp.vercel.app/abroad を開き、1日目が **10:22** であることを確認
- 古ければ強制リロード。それでも駄目なら `?v=2` を付けて開く

**このページは noindex**（検索に載らない）。URL を知っている人だけが見られる。

---

## 6. 大会が終わったら（7/26 以降）

「海外遠征を消して」と Claude に言えば PR を出す。手順は3つだけ:

1. `src/components/Header.tsx` の `navItems` から `/abroad` の行を削除
2. `src/app/abroad` → `src/app/_abroad` にリネーム（`_` prefix でルーティング除外）
3. `.github/workflows/sync-oringen.yml` の `schedule` をコメントアウト

**Vercel と GitHub の `ORINGEN_INGEST_SECRET` も消す**（使わない秘密は残さない）。

---

## 補足: 確認しておくと良いこと（急がない）

**漢字氏名の推定8名**。読み・クラブから人手で照合したもので、確定ではない。児玉さんなら顔が浮かぶはず。

| ローマ字 | 推定した漢字 | 怪しい理由 |
|---|---|---|
| Kunisawa Itsuki | 国沢五月 | 五月は通常 Satsuki 読み |
| Yamamoto Hidekatsu | 山本英勝 | クラブ不一致（渋谷で走る会 / O-Ringen は Navitabi） |
| Malta Yudai | 丸田祐大 | 丸田＝Maruta で表記がずれる |
| Mori Tatsuo | 森竜生 | 竜生は Ryusei とも読める |
| Fujiwara Kotaro | 藤原考太郎 | 裏取りが1点足りない |
| Nakamura Ryota | 中村涼太 | 同上 |
| Tanaka Masataka | 田中雅崇 | 同上 |
| Mori Tomoki | 毛利智紀 | 同上 |

**未特定9名**（ローマ字のみ表示）: Suzuki Masao / Kojima Masako / Wakabayashi Kaito / Kume Junya /
Kume Saho / Tsukiyama Aya / Iwai Ryunosuke / Iwai Saaya / Tanaka Yu。
trails.jp は JOY ランキング掲載者しか持たないため、未掲載の方は引けない。

違っていたら `name_map.csv`（`~/projects/oringen_jp_startlist/`）と
`src/data/oringen-name-map.json` を直す。Claude に言えばやる。
