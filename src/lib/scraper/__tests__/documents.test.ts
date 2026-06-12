import { describe, it, expect } from "vitest";
import { parseDocuments } from "../documents";

/**
 * JOY 大会ページの「発行書類」セクションを模した HTML。
 *  - 相対 getfile リンク（要綱）→ 絶対化される
 *  - 絶対 getfile リンク（スタートリスト）→ そのまま
 *  - 重複 url（同一 getfile を 2 回）→ 1 件に
 *  - getfile 以外のリンク（/event/view, 外部）→ 除外
 *  - テキスト無しの getfile リンク → 除外
 */
const HTML = `
<html><body>
  <div class="event_detail">
    <h3>発行書類</h3>
    <ul class="documents">
      <li><a href="/event/getfile/1001">要綱.pdf</a></li>
      <li><a href="https://japan-o-entry.com/event/getfile/1002"> スタートリスト </a></li>
      <li><a href="/event/getfile/1001">要綱（重複）</a></li>
      <li><a href="/event/view/55">大会詳細</a></li>
      <li><a href="https://example.com/other">外部リンク</a></li>
      <li><a href="/event/getfile/1003"></a></li>
    </ul>
  </div>
</body></html>
`;

describe("parseDocuments", () => {
  it("extracts only getfile links with text", () => {
    const docs = parseDocuments(HTML);
    expect(docs).toHaveLength(2);
  });

  it("absolutizes relative getfile urls", () => {
    const docs = parseDocuments(HTML);
    expect(docs[0]).toEqual({
      title: "要綱.pdf",
      url: "https://japan-o-entry.com/event/getfile/1001",
    });
  });

  it("keeps already-absolute getfile urls and trims title", () => {
    const docs = parseDocuments(HTML);
    expect(docs[1]).toEqual({
      title: "スタートリスト",
      url: "https://japan-o-entry.com/event/getfile/1002",
    });
  });

  it("dedupes repeated urls (first wins)", () => {
    const docs = parseDocuments(HTML);
    const urls = docs.map((d) => d.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toContain("https://japan-o-entry.com/event/getfile/1001");
  });

  it("excludes non-getfile links and empty-text links", () => {
    const docs = parseDocuments(HTML);
    const urls = docs.map((d) => d.url);
    expect(urls.some((u) => u.includes("/event/view/"))).toBe(false);
    expect(urls.some((u) => u.includes("example.com"))).toBe(false);
    expect(urls.some((u) => u.includes("/event/getfile/1003"))).toBe(false);
  });

  it("returns empty array for html without documents", () => {
    expect(parseDocuments("<html><body><p>no docs</p></body></html>")).toEqual([]);
  });
});
