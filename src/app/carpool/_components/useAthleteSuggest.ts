"use client";

/**
 * 氏名のインクリメンタル候補サジェスト用フック（指摘4）。
 *
 * 既存 API `GET /api/athletes/search?q=`（MembersClient の選手紐付けで使用実績あり）を
 * debounce（300ms）付きで呼び、正規氏名の候補を返す。候補表示はベストエフォート
 * （失敗時は静かに非表示・自由入力を妨げない）。
 *
 * 使い方:
 *   const suggest = useAthleteSuggest();
 *   <input onChange={(e) => { ...; suggest.setQuery(e.target.value); }} />
 *   {suggest.results.map(...)}  // 候補クリック時は suggest.dismiss() で閉じる
 */

import { useEffect, useRef, useState } from "react";
import { shouldQueryAthletes } from "@/lib/carpool/suggest";
import type { AthleteSuggestion } from "./carpoolTypes";

const DEBOUNCE_MS = 300;

export interface AthleteSuggestState {
  /** 現在のクエリ（入力 onChange で更新する）。 */
  query: string;
  setQuery: (q: string) => void;
  /** 表示すべき候補（0件なら非表示）。 */
  results: AthleteSuggestion[];
  /** 検索中フラグ（表示は任意）。 */
  loading: boolean;
  /** 候補リストを閉じる（選択直後など）。進行中の検索結果も破棄する。 */
  dismiss: () => void;
  /** クエリごと初期化（フォームを開き直すときなど）。 */
  clear: () => void;
}

export function useAthleteSuggest(): AthleteSuggestState {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AthleteSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  // 逐次番号: dismiss/新クエリで進め、古い fetch の結果を破棄する（stale 応答対策）。
  const seqRef = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (!shouldQueryAthletes(q)) {
      seqRef.current++;
      setResults([]);
      setLoading(false);
      return;
    }
    const seq = ++seqRef.current;
    setLoading(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          // trails.jp 既存 API（/api/athletes/search）。carpool 配下ではないため素の fetch。
          const res = await fetch(`/api/athletes/search?q=${encodeURIComponent(q)}`, {
            headers: { Accept: "application/json" },
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as { athletes?: AthleteSuggestion[] };
          if (seqRef.current === seq) setResults(data.athletes ?? []);
        } catch {
          // サジェストはベストエフォート: 失敗しても自由入力を妨げない（静かに非表示）。
          if (seqRef.current === seq) setResults([]);
        } finally {
          if (seqRef.current === seq) setLoading(false);
        }
      })();
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const dismiss = () => {
    seqRef.current++;
    setResults([]);
    setLoading(false);
  };

  const clear = () => {
    seqRef.current++;
    setQuery("");
    setResults([]);
    setLoading(false);
  };

  return { query, setQuery, results, loading, dismiss, clear };
}
