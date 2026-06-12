import { describe, it, expect } from "vitest";
import { isAllowedStartlistUrl } from "../url-allow";

describe("isAllowedStartlistUrl (m2: SSRF 対策の allowlist)", () => {
  it("japan-o-entry.com は許可", () => {
    expect(isAllowedStartlistUrl("https://japan-o-entry.com/event/getfile/123")).toBe(true);
  });

  it("www. 付き / http も許可", () => {
    expect(isAllowedStartlistUrl("https://www.japan-o-entry.com/event/getfile/1")).toBe(true);
    expect(isAllowedStartlistUrl("http://japan-o-entry.com/event/getfile/1")).toBe(true);
  });

  it("他ドメイン・なりすましサブドメインは拒否", () => {
    expect(isAllowedStartlistUrl("https://evil.example.com/a.pdf")).toBe(false);
    expect(isAllowedStartlistUrl("https://japan-o-entry.com.evil.com/a.pdf")).toBe(false);
    expect(isAllowedStartlistUrl("https://evil-japan-o-entry.com/a.pdf")).toBe(false);
  });

  it("プライベート IP / localhost / IP リテラルは拒否", () => {
    expect(isAllowedStartlistUrl("http://10.0.0.1/x.pdf")).toBe(false);
    expect(isAllowedStartlistUrl("http://192.168.1.1/x.pdf")).toBe(false);
    expect(isAllowedStartlistUrl("http://172.16.0.1/x.pdf")).toBe(false);
    expect(isAllowedStartlistUrl("http://127.0.0.1/x.pdf")).toBe(false);
    expect(isAllowedStartlistUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedStartlistUrl("http://localhost/x.pdf")).toBe(false);
    expect(isAllowedStartlistUrl("http://[::1]/x.pdf")).toBe(false);
  });

  it("その他プロトコル・不正文字列は拒否", () => {
    expect(isAllowedStartlistUrl("ftp://japan-o-entry.com/x.pdf")).toBe(false);
    expect(isAllowedStartlistUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedStartlistUrl("not a url")).toBe(false);
    expect(isAllowedStartlistUrl("")).toBe(false);
  });
});
