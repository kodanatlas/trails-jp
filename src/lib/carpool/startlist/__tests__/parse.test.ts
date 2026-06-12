import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { parseStartlistText, type StartlistRow } from "../parse";
import { extractStartlistFromPdf } from "../index";

// 実サンプル PDF。Windows node なら C:/ パス、WSL/Linux node なら /mnt/c/ パスで解決する
// （vitest 4 は rolldown native binding の都合で実行環境が分かれるため両対応）。
const SAMPLE_PDF_CANDIDATES = [
  "C:/Users/user/Downloads/orienteering-carpool/docs/spec/samples/startlist_sample_olk2264.pdf",
  "/mnt/c/Users/user/Downloads/orienteering-carpool/docs/spec/samples/startlist_sample_olk2264.pdf",
];
const SAMPLE_PDF = SAMPLE_PDF_CANDIDATES.find((p) => existsSync(p)) ?? SAMPLE_PDF_CANDIDATES[0];

describe("parseStartlistText (ユニット・小さな文字列)", () => {
  it("3 トークン行を 姓名(先頭2) + 所属(残り) に分割する", () => {
    const text = "ME（レーン１） 10:45~11:14\n11:34 1134 猪俣 祐貴 入間市OLC 531904";
    const rows = parseStartlistText([text]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual<StartlistRow>({
      startTime: "11:34",
      bib: "1134",
      name: "猪俣 祐貴",
      affiliation: "入間市OLC",
      className: "ME",
    });
  });

  it("2 トークン行（姓名連結）は name=先頭1トークン・affiliation=2番目", () => {
    const text = "B（レーン８） 13:00~13:30\n12:52 5252 石橋一真 千葉大OLC/ES関東C 519072";
    const rows = parseStartlistText([text]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("石橋一真");
    expect(rows[0].affiliation).toBe("千葉大OLC/ES関東C");
    expect(rows[0].className).toBe("B");
  });

  it("5 トークン行は name=先頭2・affiliation=残り全部 join（所属内空白を保持）", () => {
    // mid = "井上 匠梧 京都OLC / のまど" → name="井上 匠梧", affiliation="京都OLC / のまど"
    const text = "M21A2（レーン2） 11:00~11:30\n11:07 5107 井上 匠梧 京都OLC / のまど 525170";
    const rows = parseStartlistText([text]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("井上 匠梧");
    expect(rows[0].affiliation).toBe("京都OLC / のまど");
  });

  it("4 トークン行は name=先頭2・affiliation=残り2を join", () => {
    const text = "11:20 1120 山田 太郎 KATANA Adventure 123456";
    const rows = parseStartlistText([text]);
    expect(rows[0].name).toBe("山田 太郎");
    expect(rows[0].affiliation).toBe("KATANA Adventure");
  });

  it("所属が '-' の行は affiliation を '-' のまま保持する", () => {
    const text = "11:20 1120 田中 次郎 - 654321";
    const rows = parseStartlistText([text]);
    expect(rows[0].name).toBe("田中 次郎");
    expect(rows[0].affiliation).toBe("-");
  });

  it("見出し行でセクション className を追従する（1ブロックに複数クラス）", () => {
    const text = [
      "B（レーン８） 13:00~13:30",
      "13:01 9001 佐藤 一 入間市OLC 100001",
      "N（レーン８） 13:31~14:00",
      "13:32 9002 鈴木 二 入間市OLC 100002",
    ].join("\n");
    const rows = parseStartlistText([text]);
    expect(rows).toHaveLength(2);
    expect(rows[0].className).toBe("B");
    expect(rows[1].className).toBe("N");
  });

  it("見出しの無い貼り付けデータ行だけでも className='' で行を取る", () => {
    const text = "11:34 1134 猪俣 祐貴 入間市OLC 531904\n11:42 1142 弓田 和生 入間市OLC/長野県協会 261194";
    const rows = parseStartlistText([text]);
    expect(rows).toHaveLength(2);
    expect(rows[0].className).toBe("");
    expect(rows[1].name).toBe("弓田 和生");
  });

  it("フッタやヘッダ行など非データ行は無視する", () => {
    const text = [
      "スタート時間 ゼッケン 氏名 所属 Eカード番号",
      "ME（レーン１） 10:45~11:14",
      "11:34 1134 猪俣 祐貴 入間市OLC 531904",
      "- 3 - 目次に戻る",
    ].join("\n");
    const rows = parseStartlistText([text]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("猪俣 祐貴");
  });
});

describe("extractStartlistFromPdf (実サンプル PDF)", () => {
  it("実サンプル PDF を解析して 859 行以上抽出する（実測 863）", async () => {
    const data = new Uint8Array(readFileSync(SAMPLE_PDF));
    const rows = await extractStartlistFromPdf(data);
    expect(rows.length).toBeGreaterThanOrEqual(859);

    // className 集合に代表クラスが含まれる。
    const classes = new Set(rows.map((r) => r.className));
    for (const c of ["ME", "M21A1", "W21A", "N"]) {
      expect(classes.has(c)).toBe(true);
    }

    // 代表行: 児玉 健 = M21A1 / JDOA/入間市OLC、猪俣 祐貴 = 入間市OLC 11:34。
    const kodama = rows.find((r) => r.name === "児玉 健");
    expect(kodama).toBeDefined();
    expect(kodama?.affiliation).toBe("JDOA/入間市OLC");
    expect(kodama?.className).toBe("M21A1");

    const inomata = rows.find((r) => r.name === "猪俣 祐貴");
    expect(inomata).toBeDefined();
    expect(inomata?.affiliation).toBe("入間市OLC");
    expect(inomata?.startTime).toBe("11:34");

    // エッジ行: 石橋一真（2トークン姓名連結）/ 井上 匠梧（5トークン）。
    const ishibashi = rows.find((r) => r.name === "石橋一真");
    expect(ishibashi).toBeDefined();
    expect(ishibashi?.affiliation).toBe("千葉大OLC/ES関東C");

    const inoue = rows.find((r) => r.name === "井上 匠梧");
    expect(inoue).toBeDefined();
    expect(inoue?.affiliation).toBe("京都OLC / のまど");
  });
});
