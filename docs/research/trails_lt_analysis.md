# trails.lt 技術分析レポート (2026-02-25)

## 技術スタック

- **フロントエンド**: バニラJavaScript（React/Vue 未使用）、プロトタイプベースクラス設計
- **地図**: Leaflet.js 1.4.0 + カスタムプラグイン（回転付き画像オーバーレイ）
- **座標系**: EPSG:3346（リトアニア座標系）、Proj4js使用
- **CSS**: カスタムCSS + Flexbox（フレームワーク未使用）
- **UI部品**: noUiSlider（スライダー）、Dygraph 2.1.0（グラフ）
- **バンドル**: v1.min.js = 261KB（全コード一体）

## GPS追跡の仕組み

**WebSocketではなくHTTPポーリング方式**
- XMLHttpRequest で `/api/full` からGPSデータ全件を初期取得
- `setInterval(5000)` で `/api/update` に5秒間隔でポーリング
- 終了済みイベントは静的ファイル（settings.json, data.txt, update.txt）から読み込み
- 対応デバイス: Teltonika TMT250, Queclink GL300

## 地図機能

- **maps.trails.lt**: Leaflet + Proj4js + Crossroads.js（ハッシュSPAルーティング）
- **イベント地図**: `L.rotatedImageOverlay` カスタムプラグインでOL地図を回転付きオーバーレイ
- **ベースマップ**: Esri衛星画像 / OpenStreetMap 切替式

## イベントページ

- 静的HTMLで年度別時系列一覧（2020-2026年）
- フィルタ・ページネーションなし
- 個別イベントページに高機能GPSビューア（再生/一時停止、速度変更1x-200x、スプリット分析）

## ランキング

- rankings.trails.lt に存在するがサービス停止中（最終更新2020-10-26）
- ホームページのランキングセクションも display:none

## レスポンシブ

- 3段階ブレークポイント: 1240px, 1000px, 806px
- モバイルメニューボタンあり
- ピンチズーム無効化（地図操作との競合防止）

## trails.jp への学び

1. GPS追跡は5秒ポーリングで十分（WebSocket不要のMVP設計が可能）
2. 地図オーバーレイに回転機能が必要（OL地図は磁北基準で北が地図の上とは限らない）
3. 再生速度の可変（1x〜200x）は必須UI
4. ランキングは後回しにしてもよい（元サイトも停止中）
