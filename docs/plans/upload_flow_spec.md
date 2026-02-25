# 地図アップロード・承認フロー仕様書

## 方針決定

- **所有者登録**: メール認証のみ＋事後管理（C案）
- **公開範囲**: 所有者が自由に選択
- **承認**: 管理者レビュー制（アップロード→レビューキュー→承認/差し戻し）

---

## 1. 所有者登録フロー

### 1.1 登録画面 (`/register`)

| 項目 | 必須 | 説明 |
|------|------|------|
| メールアドレス | ◎ | 認証用。ログインID兼用 |
| 表示名 | ◎ | クラブ名 or 個人名 |
| 所属団体 | - | JOA登録クラブ名など（任意） |
| 自己紹介 | - | 地図作成実績など自由記述 |

### 1.2 フロー

```
1. メールアドレス + パスワード で登録
2. 確認メール送信 → リンククリックで認証完了
3. プロフィール入力（表示名・所属等）
4. 即座にアップロード機能が使える
5. アップロードされた地図は管理者レビュー後に公開
```

### 1.3 事後管理

- 不正利用（著作権侵害、スパム）→ 管理者がアカウント停止
- 通報機能: 一般ユーザーが不正地図を通報可能
- 停止アカウントの地図は自動非公開化

---

## 2. 地図アップロードフロー

### 2.1 アップロード画面 (`/upload`)

#### ステップ1: 画像アップロード

```
┌─────────────────────────────────────────┐
│ 地図をアップロード         ステップ 1/3  │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────────┐    │
│  │                                 │    │
│  │   画像をドラッグ&ドロップ       │    │
│  │   または クリックして選択       │    │
│  │                                 │    │
│  │   JPEG / PNG / TIFF             │    │
│  │   最大 50MB                     │    │
│  │                                 │    │
│  └─────────────────────────────────┘    │
│                                         │
│  アップロード後のプレビューが表示される  │
│                                         │
│                            [次へ →]     │
└─────────────────────────────────────────┘
```

#### ステップ2: メタデータ入力

```
┌─────────────────────────────────────────┐
│ 地図情報を入力             ステップ 2/3  │
├─────────────────────────────────────────┤
│                                         │
│ 地図名 *        [___________________]   │
│ 都道府県 *      [▼ 選択してください]    │
│ 市区町村 *      [___________________]   │
│                                         │
│ テレイン *      ○森林 ○公園 ○市街地    │
│                 ○砂丘 ○混合            │
│                                         │
│ 縮尺 *          [▼ 1:10000]            │
│ 等高線間隔 *    [▼ 2.5] m              │
│ 作成年 *        [2025]                  │
│                                         │
│ 説明            [___________________]   │
│                 [___________________]   │
│                                         │
│ タグ            [入力してEnter]         │
│                 [森林] [インカレ] [×]   │
│                                         │
│ 公開範囲 *                              │
│ ◉ 全体公開                             │
│   高解像度画像を全ユーザーに公開         │
│ ○ 低解像度のみ公開                     │
│   サムネイルとポリゴンを公開。           │
│   高解像度は許可制リクエスト             │
│ ○ ポリゴンのみ公開                     │
│   地図の範囲と基本情報のみ公開。         │
│   画像は非公開                          │
│                                         │
│                   [← 戻る] [次へ →]     │
└─────────────────────────────────────────┘
```

#### ステップ3: 位置合わせ（ジオリファレンス）

```
┌─────────────────────────────────────────┐
│ 位置合わせ                 ステップ 3/3  │
├─────────────────────────────────────────┤
│                                         │
│ ┌───────────────────────────────────┐   │
│ │                                   │   │
│ │  国土地理院タイル (ベースマップ)   │   │
│ │                                   │   │
│ │    ┌─────────┐  ← 地図画像       │   │
│ │    │ OL MAP  │    (半透明)        │   │
│ │    │         │                    │   │
│ │    └─────────┘                    │   │
│ │         ↑ ドラッグで位置調整      │   │
│ │         ↑ 四隅をドラッグでリサイズ │   │
│ │         ↑ 回転ハンドルで回転      │   │
│ │                                   │   │
│ └───────────────────────────────────┘   │
│                                         │
│ 透過度: [====●=====]  50%              │
│ 回転:   [===●======]  7.0°            │
│                                         │
│ ☑ 位置合わせをスキップ                  │
│   (後から管理画面で設定可能)            │
│                                         │
│            [← 戻る] [申請する]          │
└─────────────────────────────────────────┘
```

### 2.2 申請後の状態遷移

```
draft (下書き)
  ↓ [申請する]
pending_review (レビュー待ち)
  ↓ 管理者レビュー
  ├→ approved (承認・公開)
  ├→ revision_requested (差し戻し・修正依頼)
  │    ↓ 所有者が修正
  │    → pending_review (再レビュー)
  └→ rejected (却下)
```

---

## 3. 管理者レビュー画面 (`/admin/reviews`)

### 3.1 レビューキュー

```
┌─────────────────────────────────────────┐
│ レビューキュー              3件 未処理   │
├─────────────────────────────────────────┤
│                                         │
│ ┌─ 申請 #42 ──────────────────────────┐ │
│ │ 昭和の森 (2025年版)                 │ │
│ │ 申請者: 千葉OLクラブ                │ │
│ │ 申請日: 2026-03-01                  │ │
│ │ 公開範囲: 全体公開                  │ │
│ │          [レビューする →]           │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ ┌─ 申請 #41 ──────────────────────────┐ │
│ │ 代々木公園 (Sprint 2026)            │ │
│ │ 申請者: 東京OLクラブ                │ │
│ │ 申請日: 2026-02-28                  │ │
│ │ 公開範囲: ポリゴンのみ              │ │
│ │          [レビューする →]           │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

### 3.2 レビュー詳細画面

```
┌─────────────────────────────────────────┐
│ レビュー: 昭和の森 (2025年版)           │
├─────────────────────────────────────────┤
│                                         │
│ [地図画像プレビュー + 位置合わせ確認]   │
│                                         │
│ メタデータ確認:                         │
│ ・地図名: 昭和の森         ☑ OK        │
│ ・場所: 千葉県千葉市       ☑ OK        │
│ ・テレイン: 森林           ☑ OK        │
│ ・縮尺: 1:10000           ☑ OK        │
│ ・位置合わせ: [確認する]   ⚠ 要確認    │
│                                         │
│ コメント:                               │
│ [________________________________]      │
│ [________________________________]      │
│                                         │
│ [承認して公開] [修正を依頼] [却下]      │
└─────────────────────────────────────────┘
```

---

## 4. 公開範囲の挙動

### 4.1 閲覧者から見える内容

| 要素 | 全体公開 | 低解像度公開 | ポリゴンのみ |
|------|---------|------------|------------|
| 地図DB上のポリゴン | ◎ | ◎ | ◎ |
| 地図名・メタデータ | ◎ | ◎ | ◎ |
| サムネイル画像 | ◎ | ◎ (低解像度) | × |
| 詳細ページ | ◎ | ◎ (低解像度) | 基本情報のみ |
| オーバーレイ表示 | ◎ (高解像度) | × (リクエスト制) | × |
| ダウンロード | ◎ | × | × |

### 4.2 高解像度リクエスト（低解像度公開の場合）

```
閲覧者 → [高解像度をリクエスト] ボタン
  ↓
所有者にメール通知
  ↓
所有者が承認/却下
  ↓
承認された閲覧者のみ高解像度を閲覧可能
```

---

## 5. データモデル追加

### users テーブル

```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  organization TEXT,
  bio TEXT,
  role TEXT NOT NULL DEFAULT 'owner'
    CHECK (role IN ('owner', 'admin')),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  email_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### maps テーブル 変更

```sql
ALTER TABLE maps ADD COLUMN owner_id UUID REFERENCES users(id);
ALTER TABLE maps ADD COLUMN review_status TEXT NOT NULL DEFAULT 'draft'
  CHECK (review_status IN ('draft', 'pending_review', 'approved',
                           'revision_requested', 'rejected'));
ALTER TABLE maps ADD COLUMN visibility TEXT NOT NULL DEFAULT 'full'
  CHECK (visibility IN ('full', 'low_res', 'polygon_only'));
ALTER TABLE maps ADD COLUMN original_image_url TEXT;
ALTER TABLE maps ADD COLUMN low_res_image_url TEXT;
ALTER TABLE maps ADD COLUMN rotation_deg NUMERIC(5,2) DEFAULT 0;
ALTER TABLE maps ADD COLUMN review_comment TEXT;
ALTER TABLE maps ADD COLUMN submitted_at TIMESTAMPTZ;
ALTER TABLE maps ADD COLUMN approved_at TIMESTAMPTZ;
```

### map_access_requests テーブル（高解像度リクエスト）

```sql
CREATE TABLE map_access_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id UUID NOT NULL REFERENCES maps(id),
  requester_email TEXT NOT NULL,
  requester_name TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  responded_at TIMESTAMPTZ
);
```

### map_reports テーブル（通報）

```sql
CREATE TABLE map_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id UUID NOT NULL REFERENCES maps(id),
  reporter_email TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 6. 実装フェーズ

| フェーズ | 内容 |
|----------|------|
| Phase 1.5 | 所有者登録 + アップロード(ステップ1,2) + 管理者レビュー |
| Phase 2 | 位置合わせUI(ステップ3) + オーバーレイ表示 |
| Phase 3 | 高解像度リクエスト + 通報機能 |
