# 配車割ツール 本番実テスト 3バグ修正

作成: 2026-06-13 (JST)

## 根本原因（調査結論）

### バグ1: 移動時間が異常値（車1093分・公共交通1440分）
- **座標スワップはコードには無い**（明言）。
  - `geocode.ts` `pickFirstLatLng`: GSI `[lng,lat]` を `lng=coords[0]`/`lat=coords[1]` で正しく取得。
    スワップ値（lat=139.7）は `isValidLat`(>90)で弾かれるため、ジオコーディング経由ではDBに入らない。
  - `osrm.ts` `buildOsrmCoordsParam`: `${lng},${lat}`（OSRM の lon,lat 順）で正しい。
- 真因 = **本番 DB の `carpool_nodes` 行の lat/lng が入れ替わっている**（手入力の取り違え or 旧版コード由来の歴史的破損）。
  lat に経度（例 139.7）が入った行を OSRM に渡すと海上ルートになり巨大値（1093分）になる。
  transit の 1440 ちょうどは `estimateTransitMinutes` の `maxMin=1440` 上限クランプ。
- **対策（コード防御）**:
  1. 日本域チェック（lat 20–46 / lng 122–154）。域外で、かつ入替えると域内に入る場合は自動スワップ。
     入替えても域外なら破棄（null）。`geocode.ts` の結果と OSRM/推定の入力ノードに適用。
  2. 異常値ガード: 車 > 600分・transit > 480分は「異常として保存しない」+ 日本語警告。
     transit 上限を 1440 → 480 に変更（1440 クランプを廃止）。
  3. 回帰テスト: 目黒駅(35.633,139.716)/練馬駅(35.748,139.654)モックで car 20–60分・transit 妥当域。

### バグ2: 実行前チェックに生 UUID
- `solver/validate.ts` の `name = (id)=>id` が no-op で、SolveInput の UUID をそのまま出力。
  validate は SolveInput しか持たず displayName を知らない。
- **対策**: `buildPlanInput` が `nameMap`（memberId→表示名 / nodeId→場所名）を返し、
  PlanClient で validationErrors/warnings の UUID を `relabelIssues` で置換してから描画。

### バグ3: 「ルート候補が登録されていません」で初回が必ず止まる
- 北極星「手入力は例外だけ」違反。既定ルートが無いと初回が必ずブロック。
- **対策**: PlanClient に `autoCreateRoute()` を実装。会場座標があるとき
  `POST routes`（名称「自動ルート」/ toll 0 / distanceKm=OSRM由来 / risk 0）→ `routes/auto-times` を続けて呼ぶ。
  「ルート候補が登録されていません」エラー行のリンクを「ルートを自動作成」アクションに差し替え。

### minor
- masters の Phase3 文言更新。
- 移動時間一覧で 車>600分 の行に ⚠ 表示。

## 制約
- carpool 配下のみ・npm install/commit 禁止・vitest 全 green・tsc 0・eslint 変更分 0。
- テストは WSL Linux node で実行（`/home/kodan/.nvm/versions/node/v24.12.0/bin/node node_modules/vitest/vitest.mjs run`）。

## 本番 DB 修復 SQL（メインが Management API で実行）
- 誤座標 nodes: lat>46 OR lat<20 OR lng>154 OR lng<122 を対象に、入替えで域内化する行のみ lat↔lng スワップ。
- 誤 travel_times: 自動算出（source in osrm/api）かつ minutes が車>600/transit>480 の行を削除（再計算で埋め直す）。
</content>
</invoke>
