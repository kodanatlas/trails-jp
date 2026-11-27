/**
 * JOA 競技者登録の公開名簿（JOY の登録者名簿閲覧）。
 * 有効日を指定して「検索結果をダウンロード」すると、その日に有効な登録者の CSV（UTF-16LE・タブ区切り）が返る。
 * 公開されている列は 番号・氏名・登録都道府県・ふるさと登録都道府県・登録日・有効化日・失効日 だけ。
 * 登録年の列は無いので、年度ごとのスナップショットで初めて出た年度を初登録年度とする。
 */
import { normalizeNameKey } from "../name-key";
import type { JoaFirstRegistration } from "./types";

export const JOA_ROSTER_URL = "https://japan-o-entry.com/joaregist/openlist/1";

export interface RosterRow {
  nameKey: string;
  validFrom: string | null;
}

function unquote(s: string | undefined): string {
  return (s ?? "").trim().replace(/^"|"$/g, "").trim();
}

/** CSV（デコード済みテキスト）から 氏名キーと有効化日を取り出す */
export function parseRosterCsv(text: string): RosterRow[] {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const header = lines[0].split("\t").map(unquote);
  const nameIdx = header.indexOf("氏名");
  const validIdx = header.indexOf("有効化日");
  if (nameIdx < 0) throw new Error("JOA 名簿の CSV に「氏名」列がありません");
  return lines.slice(1).flatMap((line) => {
    const cols = line.split("\t");
    const name = unquote(cols[nameIdx]);
    if (!name) return [];
    const v = validIdx >= 0 ? unquote(cols[validIdx]) : "";
    return [{ nameKey: normalizeNameKey(name), validFrom: /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null }];
  });
}

/** 名簿の CSV を 1 回取得してデコードする（有効日 YYYY-MM-DD） */
export async function fetchRosterCsv(validDate: string, timeoutMs = 30_000): Promise<string> {
  const body = new URLSearchParams({
    valid_date: validDate,
    name: "",
    sub_manager1_name: "",
    sub_manager2_name: "",
    submit_csv: "検索結果をダウンロード",
  });
  const res = await fetch(JOA_ROSTER_URL, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "trails.jp" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`JOA 名簿の取得に失敗しました（HTTP ${res.status}）`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const isUtf16 = buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe;
  return new TextDecoder(isUtf16 ? "utf-16le" : "utf-8").decode(buf);
}

/** 年度の名簿を取る有効日（過去の年度は年度末、今年度は今日） */
export function snapshotDate(fy: number, todayIso: string): string {
  const end = `${fy + 1}-03-31`;
  return todayIso < end ? todayIso : end;
}

/** 年度ごとの名簿から初登録を出す（古い年度から順に見て、最初に出た年度を採る） */
export function firstRegistrations(byFy: ReadonlyMap<number, readonly RosterRow[]>): Map<string, JoaFirstRegistration> {
  const out = new Map<string, JoaFirstRegistration>();
  for (const fy of [...byFy.keys()].sort((a, b) => a - b)) {
    for (const row of byFy.get(fy) ?? []) {
      if (!out.has(row.nameKey)) out.set(row.nameKey, { nameKey: row.nameKey, firstFy: fy, firstValidFrom: row.validFrom });
    }
  }
  return out;
}

/** 既存の初登録（DB）に今年度の名簿を足す。既にいる人は変えない */
export function mergeCurrentFy(
  existing: ReadonlyMap<string, JoaFirstRegistration>,
  fy: number,
  rows: readonly RosterRow[],
): Map<string, JoaFirstRegistration> {
  const out = new Map(existing);
  for (const row of rows) {
    if (!out.has(row.nameKey)) out.set(row.nameKey, { nameKey: row.nameKey, firstFy: fy, firstValidFrom: row.validFrom });
  }
  return out;
}
