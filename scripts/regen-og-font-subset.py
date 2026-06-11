#!/usr/bin/env python3
"""OG 画像用 NotoSansJP サブセットフォントの再生成（WSL で実行）。

既存サブセット（assets/fonts/NotoSansJP-subset.otf）の収録コードポイントに
追加文字を足して、元フォントから再サブセットする。
元フォントの生成コマンドが残っていなかった事故（±欠落の修正時に元の文字集合を
cmap から逆算した）の再発防止として、手順をスクリプト化しておく。

使い方:
  1. 元フォントを取得:
     curl -L -o /tmp/NotoSansJP-Bold.otf \
       https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/JP/NotoSansJP-Bold.otf
  2. python3 scripts/regen-og-font-subset.py            # unicodes ファイル生成
  3. pyftsubset /tmp/NotoSansJP-Bold.otf \
       --unicodes-file=/tmp/subset_unicodes.txt \
       --output-file=assets/fonts/NotoSansJP-subset.otf
  4. python3 scripts/regen-og-font-subset.py --verify   # カバレッジ検証
"""

import sys
from fontTools.ttLib import TTFont

SUBSET_PATH = "assets/fonts/NotoSansJP-subset.otf"
UNICODES_OUT = "/tmp/subset_unicodes.txt"

# opengraph-image.tsx / page.tsx の UI 文字列で使う文字（描画欠けを防ぐ必須集合）
UI_REQUIRED = (
    "trails.jp オリエンタイプ 日本オリエンテーリング統合プラットフォーム"
    "ベスト順位 最近の調子 フォレスト スプリント ±+-%/・0123456789位"
)


def current_codepoints() -> set[int]:
    font = TTFont(SUBSET_PATH)
    cps: set[int] = set()
    for table in font["cmap"].tables:
        cps.update(table.cmap.keys())
    return cps


def main() -> None:
    cps = current_codepoints()
    if "--verify" in sys.argv:
        missing = {c for c in UI_REQUIRED if ord(c) not in cps and not c.isspace()}
        if missing:
            print(f"NG: UI 必須文字が欠落: {sorted(missing)}")
            sys.exit(1)
        print(f"OK: {len(cps)} コードポイント収録、UI 必須文字は全てカバー")
        return

    cps.update(ord(c) for c in UI_REQUIRED if not c.isspace())
    with open(UNICODES_OUT, "w") as out:
        out.write("\n".join(f"U+{c:04X}" for c in sorted(cps)))
    print(f"{UNICODES_OUT}: {len(cps)} コードポイント（既存 cmap ∪ UI 必須文字）")


if __name__ == "__main__":
    main()
