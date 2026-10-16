import { describe, it, expect } from "vitest";
import { canonicalEventHeaders, extractEventHeaders, normalizeHeader } from "../event-headers";

// JOY ランキング表の構造（固定4列＋大会列。年齢別は "補完1" 列を含む）を模した最小 fixture。
const html = `
<table>
  <thead><tr>
    <th>順位</th><th>氏名</th><th>所属</th><th>合計点数</th>
    <th>2026-10-12
                トータス50周年Day3</th>
    <th>2026-10-04 京京立Day2</th>
    <th>補完1</th>
  </tr></thead>
  <tbody><tr><td>1</td><td>伊藤 樹</td><td>三河OLC</td><td>6241.1</td><td>2061</td><td></td><td></td></tr></tbody>
</table>`;

describe("normalizeHeader", () => {
  it("改行とインデントを1つの空白に畳む", () => {
    expect(normalizeHeader("2026-04-12\n                富士山麓大会")).toBe("2026-04-12 富士山麓大会");
  });
});

describe("extractEventHeaders", () => {
  it("固定4列と日付で始まらない列（補完1）を除き、正規化・ソートして返す", () => {
    expect(extractEventHeaders(html)).toEqual(["2026-10-04 京京立Day2", "2026-10-12 トータス50周年Day3"]);
  });

  it("表が無ければ空配列", () => {
    expect(extractEventHeaders("<html><body>maintenance</body></html>")).toEqual([]);
  });
});

describe("canonicalEventHeaders", () => {
  it("表記の空白差だけの重複を1つにまとめる", () => {
    expect(canonicalEventHeaders(["2026-10-04  京京立Day2", "2026-10-04 京京立Day2 "])).toEqual([
      "2026-10-04 京京立Day2",
    ]);
  });
});
