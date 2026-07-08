"use client";

import { useEffect, useState } from "react";
import type { SiteStats } from "@/lib/site-stats";
import "./report.css";

type Theme = "dark" | "light";
const STORAGE_KEY = "trails-docs-theme";

/* ---- システム全体マップ（積層スパイン）データ ---- */
const LAYERS: {
  y: number;
  accent: string;
  fill: string;
  stroke: string;
  title: string;
  chips: { x: number; w: number; t: string; manual?: boolean }[];
}[] = [
  {
    y: 20,
    accent: "#fbbf24",
    fill: "rgba(251,191,36,.06)",
    stroke: "rgba(251,191,36,.45)",
    title: "DATA SOURCES ｜ 外部データ源",
    chips: [
      { x: 72, w: 260, t: "JOY — japan-o-entry.com" },
      { x: 360, w: 260, t: "LapCenter — mulka2.com" },
      { x: 648, w: 260, t: "どこオリ — dokori.net" },
    ],
  },
  {
    y: 134,
    accent: "#67e8f9",
    fill: "rgba(34,211,238,.05)",
    stroke: "rgba(34,211,238,.4)",
    title: "INGEST ｜ スクレイパー（cheerio + undici）＋ 手動取込",
    chips: [
      { x: 48, w: 160, t: "events.ts" },
      { x: 228, w: 160, t: "rankings.ts" },
      { x: 408, w: 160, t: "lapcenter.ts" },
      { x: 588, w: 160, t: "entries.ts" },
      { x: 768, w: 160, t: "どこオリ手動取込", manual: true },
    ],
  },
  {
    y: 248,
    accent: "#a78bfa",
    fill: "rgba(167,139,250,.06)",
    stroke: "rgba(167,139,250,.4)",
    title: "AUTOMATION ｜ Vercel Cron（日次）",
    chips: [
      { x: 48, w: 200, t: "sync-events 03:00" },
      { x: 276, w: 200, t: "sync-entries 04:00" },
      { x: 504, w: 200, t: "sync-lapcenter 12:00" },
      { x: 732, w: 200, t: "水曜 自動再デプロイ" },
    ],
  },
  {
    y: 362,
    accent: "#f8fafc",
    fill: "rgba(148,163,184,.06)",
    stroke: "rgba(148,163,184,.35)",
    title: "PERSISTENCE ｜ Supabase",
    chips: [
      { x: 90, w: 380, t: "PostgreSQL ｜ athletes・lc_performances・lc_leg_splits 他" },
      { x: 510, w: 380, t: "Storage ｜ events.json・entry-index.json" },
    ],
  },
  {
    y: 476,
    accent: "#34d399",
    fill: "rgba(52,211,153,.06)",
    stroke: "rgba(52,211,153,.4)",
    title: "API ｜ Route Handlers",
    chips: [
      { x: 48, w: 260, t: "/api/lc/[name]" },
      { x: 360, w: 260, t: "/api/athletes/*" },
      { x: 672, w: 260, t: "/api/likes/*" },
    ],
  },
  {
    y: 590,
    accent: "#f472b6",
    fill: "rgba(244,114,182,.06)",
    stroke: "rgba(244,114,182,.4)",
    title: "FRONTEND ｜ Next.js App Router + Recharts",
    chips: [
      { x: 48, w: 260, t: "イベント・ランキング" },
      { x: 360, w: 260, t: "選手・結果分析・クラブ" },
      { x: 672, w: 260, t: "応援・シェアカード" },
    ],
  },
];

const ARROW_TOPS = [106, 220, 334, 448, 562];

function SystemMap() {
  return (
    <svg viewBox="0 0 980 700" role="img" aria-label="trails.jp システム全体マップ">
      <defs>
        <marker
          id="ar"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="#64748b" />
        </marker>
      </defs>

      {LAYERS.map((L, i) => (
        <g key={i}>
          <rect
            x="30"
            y={L.y}
            width="920"
            height="86"
            rx="14"
            fill={L.fill}
            stroke={L.stroke}
            strokeWidth="1.3"
          />
          <text x="48" y={L.y + 26} fill={L.accent} fontSize="12.5" fontWeight="800">
            {L.title}
          </text>
          {L.chips.map((c, j) => (
            <g key={j}>
              <rect
                x={c.x}
                y={L.y + 42}
                width={c.w}
                height="30"
                rx="8"
                fill={c.manual ? "rgba(251,191,36,.14)" : "rgba(15,23,42,.7)"}
                stroke={c.manual ? "rgba(251,191,36,.55)" : "rgba(148,163,184,.3)"}
              />
              <text
                x={c.x + c.w / 2}
                y={L.y + 61}
                textAnchor="middle"
                fill={c.manual ? "#fbbf24" : "#e2e8f0"}
                fontSize="11.5"
              >
                {c.t}
              </text>
            </g>
          ))}
        </g>
      ))}

      {ARROW_TOPS.map((yb, i) => (
        <line
          key={i}
          x1="490"
          y1={yb}
          x2="490"
          y2={yb + 26}
          stroke="#64748b"
          strokeWidth="1.6"
          markerEnd="url(#ar)"
        />
      ))}
    </svg>
  );
}

/* ---- 分析ロジックの図解（inline SVG・テーマ変数で配色） ---- */

/** 集団走の除染: 2走者の通過時刻タイムライン。連続で近接した区間を除外として赤で示す。 */
function PackDiagram() {
  const selfX = [72, 138, 206, 268, 330, 396, 462, 556];
  const otherX = [98, 164, 228, 274, 336, 402, 468, 508];
  const packFrom = 3;
  const packTo = 6; // 通過時刻が近接する連続コントロール
  const yS = 74;
  const yO = 142;
  const shadeX0 = Math.min(selfX[packFrom], otherX[packFrom]) - 14;
  const shadeX1 = Math.max(selfX[packTo], otherX[packTo]) + 14;
  return (
    <svg viewBox="0 0 620 214" role="img" aria-label="集団走の除染の図解">
      <rect
        x={shadeX0}
        y={44}
        width={shadeX1 - shadeX0}
        height={128}
        rx={10}
        fill="var(--pink)"
        fillOpacity={0.1}
        stroke="var(--pink)"
        strokeOpacity={0.6}
        strokeDasharray="5 4"
      />
      <text x={(shadeX0 + shadeX1) / 2} y={36} textAnchor="middle" fontSize="12" fontWeight="700" fill="var(--pink)">
        通過時刻が連続で近い → 集団走の疑い（このレッグ群を除外）
      </text>
      <line x1={58} y1={yS} x2={582} y2={yS} stroke="var(--line)" />
      <line x1={58} y1={yO} x2={582} y2={yO} stroke="var(--line)" />
      <text x={50} y={yS + 4} textAnchor="end" fontSize="12" fontWeight="700" fill="var(--green)">
        自分
      </text>
      <text x={50} y={yO + 4} textAnchor="end" fontSize="12" fontWeight="700" fill="var(--cyan)">
        相手
      </text>
      {selfX.map((sx, i) => {
        const inPack = i >= packFrom && i <= packTo;
        return (
          <g key={i}>
            <line
              x1={sx}
              y1={yS}
              x2={otherX[i]}
              y2={yO}
              stroke={inPack ? "var(--pink)" : "var(--line)"}
              strokeWidth={inPack ? 2 : 1}
            />
            <circle cx={sx} cy={yS} r={5} fill="var(--green)" />
            <circle cx={otherX[i]} cy={yO} r={5} fill="var(--cyan)" />
          </g>
        );
      })}
      <text x={64} y={yO + 24} fontSize="10.5" fill="var(--muted)">
        スタート
      </text>
      <text x={576} y={yO + 24} textAnchor="end" fontSize="10.5" fill="var(--muted)">
        フィニッシュ
      </text>
      <text x={320} y={206} textAnchor="middle" fontSize="10.5" fill="var(--dim)">
        縦に揃う＝同じ時刻に通過＝一緒に走っている
      </text>
    </svg>
  );
}

/** 局面×レッグ長: 3×3 のミス率ヒートマップ。偏って多いセルを赤フラグ。 */
function CellGrid() {
  const vals = [
    [8, 11, 15],
    [9, 13, 19],
    [7, 12, 27],
  ];
  const phases = ["序盤", "中盤", "終盤"];
  const lengths = ["短", "中", "長"];
  const x0 = 104;
  const y0 = 30;
  const c = 74;
  const flagR = 2;
  const flagC = 2;
  return (
    <svg viewBox="0 0 400 300" role="img" aria-label="局面とレッグ長の3×3セルの図解">
      <text x={18} y={y0 + 6} fontSize="11.5" fontWeight="700" fill="var(--muted)">
        局面
      </text>
      <text x={26} y={y0 + 22} fontSize="12" fill="var(--dim)">
        ↓
      </text>
      {vals.map((row, r) =>
        row.map((v, col) => {
          const t = (v - 7) / 22;
          const isFlag = r === flagR && col === flagC;
          const x = x0 + col * c;
          const y = y0 + r * c;
          const s = c - 6;
          return (
            <g key={`${r}-${col}`}>
              <rect
                x={x}
                y={y}
                width={s}
                height={s}
                rx={8}
                fill="var(--pink)"
                fillOpacity={0.05 + t * 0.34}
                stroke={isFlag ? "var(--pink)" : "var(--line)"}
                strokeWidth={isFlag ? 2.5 : 1}
              />
              <text x={x + s / 2} y={y + s / 2 + 5} textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--ink)">
                {v}%
              </text>
              {isFlag && (
                <text x={x + s / 2} y={y + 17} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="var(--pink)">
                  ▲ 偏り
                </text>
              )}
            </g>
          );
        }),
      )}
      {phases.map((p, r) => (
        <text key={p} x={x0 - 10} y={y0 + r * c + (c - 6) / 2 + 4} textAnchor="end" fontSize="11.5" fill="var(--muted)">
          {p}
        </text>
      ))}
      {lengths.map((l, col) => (
        <text key={l} x={x0 + col * c + (c - 6) / 2} y={y0 + 3 * c + 6} textAnchor="middle" fontSize="11.5" fill="var(--muted)">
          {l}
        </text>
      ))}
      <text x={x0 + 1.5 * c - 3} y={y0 + 3 * c + 28} textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--dim)">
        レッグ長（＝所要時間・距離ではない）→
      </text>
    </svg>
  );
}

/** z-score 補正: 生ポイント差(右=Sprint偏り) → 補正後(中央に均衡) の before/after 分布。 */
function LeanShift() {
  const cx = 320;
  const x0 = 140;
  const x1 = 500;
  const topOff = [-42, -24, -10, 3, 8, 12, 16, 20, 24, 28, 33, 38, 44, 51, 59, 68, 79, 92, 106, 118, -54, -16];
  const botOff = [-60, -48, -37, -28, -20, -13, -7, -2, 3, 9, 15, 22, 30, 39, 49, 60, -10, 6, -24, 20, -36, 42];
  const dot = (off: number, y: number, i: number) => (
    <circle key={`${y}-${i}`} cx={cx + off * 1.5} cy={y} r={3.6} fill={off < 0 ? "var(--green)" : "var(--cyan)"} fillOpacity={0.85} />
  );
  return (
    <svg viewBox="0 0 620 214" role="img" aria-label="z-score補正の前後の図解">
      <line x1={cx} y1={30} x2={cx} y2={182} stroke="var(--line)" strokeDasharray="4 4" />
      <text x={cx} y={22} textAnchor="middle" fontSize="10" fill="var(--dim)">
        同等
      </text>
      <line x1={x0} y1={70} x2={x1} y2={70} stroke="var(--line)" />
      <line x1={x0} y1={150} x2={x1} y2={150} stroke="var(--line)" />
      <text x={x0} y={52} fontSize="11.5" fontWeight="700" fill="var(--muted)">
        ① 生ポイント差
      </text>
      <text x={x0} y={132} fontSize="11.5" fontWeight="700" fill="var(--muted)">
        ② z-score 補正後
      </text>
      {topOff.map((o, i) => dot(o, 70, i))}
      {botOff.map((o, i) => dot(o, 150, i))}
      <text x={x1 + 6} y={73} fontSize="10.5" fontWeight="700" fill="var(--pink)">
        77% がSprint側
      </text>
      <text x={x1 + 6} y={153} fontSize="10.5" fontWeight="700" fill="var(--green)">
        53 / 47 均衡
      </text>
      <text x={x0 - 6} y={196} fontSize="10.5" fill="var(--green)">
        ◀ Forest寄り
      </text>
      <text x={x1} y={196} textAnchor="end" fontSize="10.5" fill="var(--cyan)">
        Sprint寄り ▶
      </text>
      <text x={cx} y={208} textAnchor="middle" fontSize="10.5" fill="var(--dim)">
        スプリントは母集団平均が約0.4σ高い → 母集団で正規化して補正
      </text>
    </svg>
  );
}

export function AnalysisSystemReport({
  buildDate,
  stats,
}: {
  buildDate: string;
  stats: SiteStats;
}) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* localStorage 不可（プライベートモード等）でも既定ダークで成立 */
    }
    const prefersLight =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches;
    setTheme(saved === "light" || (!saved && prefersLight) ? "light" : "dark");
  }, []);

  const toggle = () =>
    setTheme((t) => {
      const next: Theme = t === "dark" ? "light" : "dark";
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        /* 保存できなくても表示は切り替わる */
      }
      return next;
    });

  return (
    <div className="report-root" data-theme={theme}>
      <button
        className="theme-toggle"
        type="button"
        aria-label="ダークモードとライトモードを切り替える"
        onClick={toggle}
      >
        <svg
          className="moon"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
        <svg
          className="sun"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
        <span className="if-dark">LIGHT</span>
        <span className="if-light">DARK</span>
      </button>

      <div className="wrap">
        {/* ============ ヒーロー ============ */}
        <header className="hero">
          <span className="eyebrow">
            <span className="dot" />
            LIVE — 日次自動更新で稼働中
          </span>
          <h1 className="big">
            日本オリエンテーリングの
            <br />
            データを、1枚に。
          </h1>
          <p className="lead">
            trails.jp は、エントリーサイト <b>JOY</b>・成績データベース{" "}
            <b>LapCenter</b> から毎日自動でデータを集め、さらに大会受付サイト{" "}
            <b>どこオリ</b>{" "}
            などの大会情報を手動で一覧化して取り込み、イベント・ランキング・選手分析・クラブ統計・対戦履歴までを横断する、オリエンテーリング専用のデータプラットフォームです。本ページは、その{" "}
            <b>システム全体像と技術スタック</b> を1枚にまとめた技術ドキュメントです。
            現在 <b>{stats.events.toLocaleString()}</b> 大会・ランキング掲載{" "}
            <b>{stats.athletes.toLocaleString()}</b> 選手・
            <b>{stats.lcRecords.toLocaleString()}</b> 走の成績レコード・
            <b>{stats.clubs.toLocaleString()}</b> クラブを収録し、日次で更新しています。
          </p>
        </header>

        {/* ============ 01 システム全体マップ ============ */}
        <section>
          <div className="sec-head">
            <span className="sec-no">01</span>
            <h2>
              システム<span className="grad">全体マップ</span>
            </h2>
            <span className="sec-sub">
              色の意味 — アンバー：外部源／どこオリ手動取込 ／ シアン：取込（スクレイパー＋手動） ／ 紫：自動化 ／
              スレート：永続化 ／ 緑：API ／ ピンク：フロント。上から下へデータが流れる。
            </span>
          </div>
          <div className="map-frame">
            <SystemMap />
          </div>
        </section>

        {/* ============ 02 機能 ============ */}
        <section>
          <div className="sec-head">
            <span className="sec-no">02</span>
            <h2>
              提供<span className="grad">機能</span>
            </h2>
            <span className="sec-sub">分析機能だけでなく、収集〜可視化までを7つの軸で提供する。</span>
          </div>
          <div className="docs">
            <div className="doc a">
              <div className="ghost">E</div>
              <span className="tag">EVENTS</span>
              <h3>イベント</h3>
              <p>JOY 大会を日次取得、どこオリ大会は手動で一覧化して取込。リスト／カレンダー2ビュー。</p>
              <ul>
                <li>都道府県・受付状態・日付での<b>絞り込み</b></li>
                <li>受付中・直近30日は<b>所属別エントリー</b>を展開</li>
              </ul>
              <span className="file mono">/events</span>
            </div>
            <div className="doc b">
              <div className="ghost">R</div>
              <span className="tag">RANKINGS</span>
              <h3>ランキング</h3>
              <p>エリート／年齢別 × Forest／Sprint の80クラス。</p>
              <ul>
                <li>選手名・クラブで<b>即時フィルタ</b></li>
                <li>前月比・前年比の<b>増減デルタ</b>表示</li>
              </ul>
              <span className="file mono">/rankings</span>
            </div>
            <div className="doc c">
              <div className="ghost">A</div>
              <span className="tag">ATHLETE</span>
              <h3>選手分析</h3>
              <p>ポイント推移・巡航速度・ミス率を可視化。</p>
              <ul>
                <li><b>オリエンタイプ</b>分類（forester/sprinter/all）</li>
                <li>安定性・最近の調子・<b>対戦履歴</b></li>
                <li>クロスレースの<b>ミスの傾向</b>（局面×レッグ長）と相対評価</li>
              </ul>
              <span className="file mono">/analysis・/a/選手名</span>
            </div>
            <div className="doc a">
              <div className="ghost">L</div>
              <span className="tag">RESULTS</span>
              <h3>結果分析（レッグ）</h3>
              <p>LapCenter のスプリットから、レッグ単位でタイムを分解。</p>
              <ul>
                <li>ロスを<b>コース起因／自分のミス</b>に分解（罠レッグ判定）</li>
                <li><b>区間賞</b>・<b>順位が動いたレッグ</b>・ノーミス推定順位</li>
              </ul>
              <span className="file mono">/results</span>
            </div>
            <div className="doc b">
              <div className="ghost">C</div>
              <span className="tag">CLUB</span>
              <h3>クラブ分析</h3>
              <p>{stats.clubs.toLocaleString()}クラブを平均ポイント・人数でソート。</p>
              <ul>
                <li>所属選手一覧と<b>アクティブ人数</b></li>
                <li>名寄せ済みクラブ名で<b>表記ゆれを統合</b></li>
              </ul>
              <span className="file mono">/analysis（クラブ）</span>
            </div>
            <div className="doc c">
              <div className="ghost">V</div>
              <span className="tag">COMPARE</span>
              <h3>選手比較</h3>
              <p>最大8選手を色分けで同一グラフに重ね描き。</p>
              <ul>
                <li>ポイント推移の<b>並列比較</b></li>
                <li>散布図上で<b>種目特性</b>を比較</li>
              </ul>
              <span className="file mono">/analysis（比較）</span>
            </div>
            <div className="doc a">
              <div className="ghost">♥</div>
              <span className="tag">SUPPORT</span>
              <h3>応援（いいね）</h3>
              <p>調子の伸び率で急上昇／下降中の選手を一覧。</p>
              <ul>
                <li>個別＋<b>グループまとめ応援</b></li>
                <li>今週トップを<b>表彰台</b>でトップ掲示</li>
              </ul>
              <span className="file mono">/analysis（応援）</span>
            </div>
          </div>
        </section>

        {/* ============ 03 データソース ============ */}
        <section>
          <div className="sec-head">
            <span className="sec-no">03</span>
            <h2>
              3つの<span className="grad">データソース</span>
            </h2>
            <span className="sec-sub">
              who 列 — <span style={{ color: "var(--cyan)" }}>シアン=JOY</span> ／{" "}
              <span style={{ color: "var(--violet)" }}>紫=LapCenter</span> ／{" "}
              <span style={{ color: "var(--amber)" }}>アンバー=どこオリ</span>。各ソースを日付＋名称のファジーマッチで突合する。
            </span>
          </div>
          <div className="contract">
            <div className="row">
              <span className="who tf">JOY</span>
              <span className="key">events</span>
              <span className="use">→ 大会名・日程・座標（トップ＋年度アーカイブ）</span>
            </div>
            <div className="row">
              <span className="who tf">JOY</span>
              <span className="key">rankings ×80class</span>
              <span className="use">→ 選手名・クラブ・得点・大会別スコア</span>
            </div>
            <div className="row">
              <span className="who tf">JOY</span>
              <span className="key">entry-list</span>
              <span className="use">→ 所属別の出場予定者（オンデマンド）</span>
            </div>
            <div className="row">
              <span className="who cdk">LapCenter</span>
              <span className="key">cruising-speed</span>
              <span className="use">→ 走行速度指標（低いほど速い）</span>
            </div>
            <div className="row">
              <span className="who cdk">LapCenter</span>
              <span className="key">miss-rate</span>
              <span className="use">→ ナビゲーションロスの割合（%）</span>
            </div>
            <div className="row">
              <span className="who cdk">LapCenter</span>
              <span className="key">split-list</span>
              <span className="use">→ レッグ別ラップ・ロス・通過順位（全走者・11万レッグ超）</span>
            </div>
            <div className="row">
              <span className="who dkr">どこオリ</span>
              <span className="key">大会一覧（手動取込）</span>
              <span className="use">→ 大会名・日程・座標・受付状態（ホワイトリスト制）</span>
            </div>
            <div className="row">
              <span className="who dkr">どこオリ</span>
              <span className="key">entry-list（手動取込）</span>
              <span className="use">→ 日別エントリーを手動で一覧化</span>
            </div>
            <div className="note">
              名寄せ：全角→半角、大学/クラブ略称の展開、回次・期数の除去。Forest／Sprint
              区分は LapCenter 側では大会名から推定するため JOY と割れることがあり（例：前日大会）、
              レース突合は日付を主キーに、同日に1レースだけ・または名称一致で名寄せして重複表示を防ぐ。
              どこオリ大会は合成 ID（90,000,000〜）で JOY と衝突を回避し、手動取込分が無い回でも JOY 同期と既存保存分を維持するグレースフル劣化設計。
            </div>
          </div>
        </section>

        {/* ============ 04 データパイプライン ============ */}
        <section>
          <div className="sec-head">
            <span className="sec-no">04</span>
            <h2>
              日次<span className="grad">パイプライン</span>
            </h2>
            <span className="sec-sub">3つの Cron ＋ 水曜ビルドで、PC 起動なしに完全自動で鮮度を保つ。</span>
          </div>
          <div className="waves">
            <div className="wave">
              <div className="w">03:00 JST</div>
              <div className="t">sync-events</div>
              <div className="d">JOY イベント同期＋どこオリ手動取込分の反映＋LapCenter マッチング。<b>水曜は再デプロイを起動</b>。</div>
            </div>
            <div className="wave">
              <div className="w">04:00 JST</div>
              <div className="t">sync-entries</div>
              <div className="d">未開催大会のエントリーを並列スクレイプし、<b>選手別インデックス</b>を生成。</div>
            </div>
            <div className="wave">
              <div className="w">12:00 JST</div>
              <div className="t">sync-lapcenter</div>
              <div className="d">巡航速度・ミス率に加え<b>レッグ別スプリット</b>を収集して DB へ <code>upsert</code>（取込台帳で管理）。</div>
            </div>
            <div className="wave">
              <div className="w">水曜 ビルド時</div>
              <div className="t">build-analysis-index</div>
              <div className="d">ランキング最新取得 → <b>athlete-index / club-stats / クロスレース統計（cross-race・leg-fingerprint）</b> を再生成。</div>
            </div>
          </div>
          <div className="invariant">
            <span className="badge">不変条件</span>
            <span className="txt">
              Vercel Hobby は <code>Cron 1日1回</code>・<code>関数10秒</code>。重い処理はビルド時実行と{" "}
              <code>maxDuration</code> 拡張で制約内に収める。
            </span>
          </div>
        </section>

        {/* ============ 05 永続化 ============ */}
        <section>
          <div className="sec-head">
            <span className="sec-no">05</span>
            <h2>
              永続化・<span className="grad">DBスキーマ</span>
            </h2>
            <span className="sec-sub">
              Supabase PostgreSQL ＋ Storage。RLS で SELECT は公開、書き込みは service role のみ。
            </span>
          </div>
          <div className="topics">
            <div className="topic a">
              <div className="h">A｜分析データ</div>
              <ul>
                <li><code>athletes</code>（選手マスタ）</li>
                <li><code>athlete_appearances</code>（出場・順位）</li>
                <li><code>lc_performances</code>（巡航速度・ミス率）</li>
                <li><code>lc_leg_splits</code>（レッグ別スプリット・全走者）</li>
                <li><code>lc_leg_events</code>（per-leg 取込台帳）</li>
              </ul>
            </div>
            <div className="topic b">
              <div className="h">B｜応援</div>
              <ul>
                <li><code>likes</code>（session + IP hash で重複防止）</li>
                <li><code>athlete_like_counts</code>（集計ビュー）</li>
              </ul>
            </div>
            <div className="topic c">
              <div className="h">C｜運用監視</div>
              <ul>
                <li><code>cron_log</code>（実行ログ）</li>
                <li><code>club_stats_snapshot</code> / <code>ranking_snapshot</code></li>
              </ul>
            </div>
            <div className="topic d">
              <div className="h">D｜Storage</div>
              <ul>
                <li><code>events.json</code>（イベント本体）</li>
                <li><code>entry-index.json</code>（選手別エントリー）</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ============ 06 分析ロジック ============ */}
        <section>
          <div className="sec-head">
            <span className="sec-no">06</span>
            <h2>
              中身の<span className="grad">分析ロジック</span>
            </h2>
            <span className="sec-sub">ランキングとラップから、選手の「強さの質」を統計的に数値化する。</span>
          </div>
          <div className="decisions">
            <div className="dec">
              <div className="k">CONSISTENCY ｜ 安定性</div>
              <div className="v">
                変動係数の逆数を <span className="hl">0–100</span> 化
              </div>
              <div className="why">
                <code>score = (1 − CV/0.3) × 100</code>（CV = σ/μ）。ブレが小さいほど高得点。
                0.3 は「CV 30% で 0 点」とする規約スケール（検定に基づく値ではない）。
              </div>
            </div>
            <div className="dec">
              <div className="k">RECENT FORM ｜ 最近の調子</div>
              <div className="v">
                直近3大会 vs 全体平均の <span className="hl">差%</span>
              </div>
              <div className="why">種目別に算出（Forester は Forest のみ等）し主戦場で評価。</div>
            </div>
            <div className="dec">
              <div className="k">TYPE ｜ タイプ分類</div>
              <div className="v">
                無差別F/S を <span className="hl">z-score</span> 正規化
              </div>
              <div className="why">
                スコア体系の違いを母集団で正規化し差で判定（閾値 0.3＝±0.3σ・規約値）→ forester / sprinter /
                allrounder。選手ページの Forest／Sprint 寄りバーも同じ z-score 差で位置を決める。
              </div>
            </div>
            <div className="dec fig" id="lean" style={{ scrollMarginTop: "80px" }}>
              <div className="k">LEAN ｜ Forest／Sprint 寄りの補正</div>
              <LeanShift />
              <div className="cap">
                スプリントはランキング点の母集団平均が <b>約 0.4σ 高い</b>ため、生の得点差だと <b>8 割近くが Sprint 寄り</b>に偏ってしまう。
                各種目を母集団で <b>z-score 正規化</b>してから差を取ると偏りが消え、選手ページの寄りバー位置もこの補正値を使う。
              </div>
            </div>
            <div className="dec" id="trend" style={{ scrollMarginTop: "80px" }}>
              <div className="k">TREND ｜ トレンドライン</div>
              <div className="v">
                <span className="hl">Theil–Sen</span> 頑健回帰
              </div>
              <div className="why">
                スコア・巡航速度・ミス率のトレンド線を Forest／Sprint 独立で描画（レース順ベース・5レース未満は非表示）。
                pairwise slope の中央値を使うため、単発の大崩れレースで向きが反転しない。
              </div>
            </div>
            <div className="dec" id="cross-race" style={{ scrollMarginTop: "80px" }}>
              <div className="k">CROSS-RACE ｜ ミス率の相対評価</div>
              <div className="v">
                同水準帯の期待値との <span className="hl">Theil–Sen 残差</span>
              </div>
              <div className="why">
                種目内の n≥5 選手について（巡航速度中央値, ミス率中央値）に頑健回帰を当て、
                「同水準の巡航速度指標の選手群と比べてミスが多いか少ないか」を百分位帯で提示。
                巡航速度は出走クラス上位3基準の相対値であり、クラスをまたぐ絶対走力比較ではない。
                高ミス率レース（種目内上位四分位）の本数も併記する。
              </div>
            </div>
            <div className="dec">
              <div className="k">LEG ｜ レッグ分解（結果分析）</div>
              <div className="v">
                ロスを <span className="hl">コース起因＋自分の超過</span> に分解
              </div>
              <div className="why">
                LapCenter のスプリットから各レッグのロスをフィールド中央値と比較し、罠レッグ／自分のミスを判定。
                ノーミス推定タイム（記録 − 総ロス）で実フィールドに対する想定順位も算出する。
              </div>
            </div>
            <div className="dec" id="miss-trend" style={{ scrollMarginTop: "80px" }}>
              <div className="k">MISS-TREND ｜ ミスの傾向（クロスレース）</div>
              <div className="v">
                局面×レッグ長の <span className="hl">並べ替え検定</span>＋FDR
              </div>
              <div className="why">
                全レースのレッグ別ミス（想定タイム30%超の規約判定・集団走疑いは除外）を局面3×レッグ長3のセルに集計し、
                レース内のミス総数を固定した並べ替え帰無分布（日次調子・レース内相関を保存）に対する検定＋BH-FDR（q=0.10）で
                「偏って多い場所」だけをフラグ。巡航速度が近い帯（forest 5分位/sprint 3分位）の平均との記述比較も併記。
                トレンド線はクリーンレッグ数×出走規模の信頼度加重 Theil–Sen。
              </div>
            </div>
            <div className="dec" id="miss-def" style={{ scrollMarginTop: "80px" }}>
              <div className="k">MISS ｜ ミス判定</div>
              <div className="v">
                ロスが想定タイムの <span className="hl">30%超</span>（絶対下限つき）
              </div>
              <div className="why">
                各レッグの超過ロスが「想定タイム（ラップ − ロス）× 0.30」と「絶対下限 forest 10秒／sprint 5秒」の大きい方以上で 1 ミス。
                0.30 は日常ばらつき（中央値 6–8%）の 4–5 倍の規約値。地形・安全ルート・集団走のロスも含みうるためナビミスとは断定しない。
              </div>
            </div>
            <div className="dec fig grid" id="cell-def" style={{ scrollMarginTop: "80px" }}>
              <div className="k">CELL ｜ 局面 × レッグ長（ミス率ヒートマップ）</div>
              <CellGrid />
              <div className="cap">
                レース内のレッグを <b>局面（序盤／中盤／終盤）</b> × <b>レッグ長</b> の 9 セルに層別してミス率を集計。
                レッグ長は <b>所要時間（上位3名平均スプリット Ave3）のレース内3分位</b>＝距離ではなく同一大会内の相対区分。
                並べ替え検定＋FDR で「偏って多いセル」だけを赤フラグにする。
              </div>
            </div>
            <div className="dec fig" id="pack" style={{ scrollMarginTop: "80px" }}>
              <div className="k">PACK ｜ 集団走の除染</div>
              <PackDiagram />
              <div className="cap">
                同一コース（同大会×同クラス）の他走者と各コントロールの <b>通過時計時刻（スタート＋累積タイム）</b> を突合。
                差が <b>forest 15秒／sprint 10秒以内で 3 レッグ以上連続</b> した区間を集団走とみなし、その内側のレッグをミス集計から除外する
                （フォロワーの区間タイムは自分のナビ力を反映しないため）。リーダー／フォロワーは識別せず両者除外＝標本が減るだけで偏りは作らない。
                除外がレースの 50% 超ならレース自体を不採用、スタート時刻不明は「未チェック」。時刻近接に基づく推定のため「疑い」表記。
              </div>
            </div>
            <div className="dec">
              <div className="k">LEG-IMPACT ｜ 順位が動いたレッグ</div>
              <div className="v">
                通過順位の <span className="hl">平均変動</span>＋ミス残差連動（副）
              </div>
              <div className="why">
                主指標は各レッグでの通過順位（elapsedRank）の1人あたり平均変動＝仮定ゼロの記述統計。
                副指標は上位完走者（優勝+25%以内）のレッグ別ミス残差が「自レッグを除いた合計」と連動した度合いの相対値。
                百分率では表現しない（「このレッグでX%決まった」とは言えない設計）。完走者8名未満・リレー系クラスは非表示。
              </div>
            </div>
          </div>
        </section>

        {/* ============ 07 API ============ */}
        <section>
          <div className="sec-head">
            <span className="sec-no">07</span>
            <h2>
              公開<span className="grad">API</span>
            </h2>
            <span className="sec-sub">
              method — <span style={{ color: "var(--green)" }}>緑=GET</span> ／{" "}
              <span style={{ color: "var(--amber)" }}>アンバー=POST</span>。フロントは DB から1選手分のみ取得（数KB）。
            </span>
          </div>
          <div className="contract">
            <div className="row">
              <span className="who get">GET</span>
              <span className="key">/api/lc/[name]</span>
              <span className="use">→ 1選手の巡航速度・ミス率の全履歴</span>
            </div>
            <div className="row">
              <span className="who get">GET</span>
              <span className="key">/api/athletes/search?q=</span>
              <span className="use">→ 選手名・クラブ名で検索（上位20）</span>
            </div>
            <div className="row">
              <span className="who get">GET</span>
              <span className="key">/api/athletes/[name]</span>
              <span className="use">→ 選手詳細（appearances 含む）</span>
            </div>
            <div className="row">
              <span className="who get">GET</span>
              <span className="key">/api/athletes/[name]/entries</span>
              <span className="use">→ 出場予定大会</span>
            </div>
            <div className="row">
              <span className="who get">GET</span>
              <span className="key">/api/events/[id]/entries</span>
              <span className="use">→ 大会エントリー（所属別・1h キャッシュ）</span>
            </div>
            <div className="row">
              <span className="who post">POST</span>
              <span className="key">/api/likes</span>
              <span className="use">→ いいね送信（単体／最大100件一括）</span>
            </div>
            <div className="row">
              <span className="who get">GET</span>
              <span className="key">/api/likes/top?window=week</span>
              <span className="use">→ いいね上位（週次／累計）</span>
            </div>
            <div className="note">
              ランキング取得用の内部プロキシはビルド時のみ・認証必須。Vercel ビルド環境からの
              JOY 直アクセス不可を回避するための仕組み。
            </div>
          </div>
        </section>

        {/* ============ 08 技術スタック ============ */}
        <section>
          <div className="sec-head">
            <span className="sec-no">08</span>
            <h2>
              技術<span className="grad">スタック</span>
            </h2>
            <span className="sec-sub">依存は最小限。フルマネージドで運用工数をほぼゼロに。</span>
          </div>
          <div className="topics">
            <div className="topic a">
              <div className="h">A｜フレームワーク</div>
              <ul>
                <li><b>Next.js 16</b>（App Router）</li>
                <li><b>React 19</b> / TypeScript 5</li>
              </ul>
            </div>
            <div className="topic b">
              <div className="h">B｜データ・可視化</div>
              <ul>
                <li><b>Supabase</b>（PostgreSQL ＋ Storage）</li>
                <li><b>Recharts 3</b>（ライン／散布図）</li>
              </ul>
            </div>
            <div className="topic c">
              <div className="h">C｜収集・UI</div>
              <ul>
                <li><b>cheerio ＋ undici</b>（スクレイピング）</li>
                <li><b>Tailwind CSS v4</b> / lucide-react</li>
              </ul>
            </div>
          </div>
        </section>

        {/* ============ 09 ロードマップ・制限 ============ */}
        <section>
          <div className="sec-head">
            <span className="sec-no">09</span>
            <h2>
              ロードマップと<span className="grad">既知の制限</span>
            </h2>
          </div>
          <div className="road">
            <div className="ph">
              <div className="p">P1</div>
              <div className="w">完了</div>
              <div className="d">分析データを静的 JSON から Supabase DB へ移行。</div>
              <div className="chips">
                <span className="chip a">DB</span>
                <span className="chip b">Cron</span>
              </div>
            </div>
            <div className="ph">
              <div className="p">P2</div>
              <div className="w">完了</div>
              <div className="d">
                レッグ単位の統計分析基盤 — per-leg DB 取込（11万レッグ超）・ミスの傾向（並べ替え検定）・同水準帯コホート比較・順位が動いたレッグ。
              </div>
              <div className="chips">
                <span className="chip a">DB</span>
                <span className="chip b">統計</span>
              </div>
            </div>
            <div className="ph now">
              <div className="p">P3</div>
              <div className="w">次の焦点</div>
              <div className="d">
                堅牢性と精緻化 — API 障害時の縮退表示・検定の過分散対応・データ鮮度の監視。
              </div>
              <div className="chips">
                <span className="chip c">運用</span>
              </div>
            </div>
          </div>
          <div className="actions" style={{ marginTop: 14 }}>
            <div className="act">
              <div className="no">1</div>
              <div>
                <div className="t">Hobby Cron は 1日1回</div>
                <div className="d">3つのジョブを1日1パスずつに分け、制限内に収める設計。</div>
              </div>
            </div>
            <div className="act">
              <div className="no">2</div>
              <div>
                <div className="t">ビルド環境から JOY へ直アクセス不可</div>
                <div className="d">前回デプロイの関数をプロキシに使い、ランキングをビルド時取得。</div>
              </div>
            </div>
          </div>
        </section>

        <footer className="report-footer">
          <b>trails.jp 技術ドキュメント</b> ｜ 日本オリエンテーリング統合プラットフォーム ｜{" "}
          {buildDate}
          <br />
          本ページは直リンク用の技術解説です。 ／{" "}
          <a href="/">trails.jp を開く</a>
        </footer>
      </div>
    </div>
  );
}
