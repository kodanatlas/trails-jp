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

/** ミス判定: 想定タイム＋ロスの積み上げバー＋閾値ライン。閾値超えのロスがミス。 */
function MissBar() {
  const x0 = 118;
  const base = 210; // 想定タイム（px）
  const thr = x0 + base + base * 0.3; // 想定×1.3
  const rows = [
    { y: 58, label: "レッグA", loss: 40, miss: false },
    { y: 128, label: "レッグB", loss: 108, miss: true },
  ];
  return (
    <svg viewBox="0 0 620 196" role="img" aria-label="ミス判定の閾値の図解">
      <line x1={thr} y1={30} x2={thr} y2={162} stroke="var(--pink)" strokeDasharray="5 4" strokeOpacity={0.8} />
      <text x={thr} y={22} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--pink)">
        閾値＝想定 ×1.3（下限あり）
      </text>
      {rows.map((r) => (
        <g key={r.label}>
          <text x={x0 - 12} y={r.y + 15} textAnchor="end" fontSize="12" fontWeight="700" fill="var(--muted)">
            {r.label}
          </text>
          <rect x={x0} y={r.y} width={base} height={24} rx={4} fill="var(--green)" fillOpacity={0.55} />
          <rect x={x0 + base} y={r.y} width={r.loss} height={24} rx={4} fill={r.miss ? "var(--pink)" : "var(--dim)"} fillOpacity={r.miss ? 0.7 : 0.5} />
          <text x={x0 + base + r.loss + 12} y={r.y + 16} fontSize="11" fontWeight="700" fill={r.miss ? "var(--pink)" : "var(--green)"}>
            {r.miss ? "ロス > 閾値 → ミス" : "ロス < 閾値 → ミスでない"}
          </text>
        </g>
      ))}
      <text x={x0} y={186} fontSize="10.5" fill="var(--dim)">
        <tspan fill="var(--green)">■</tspan> 想定タイム（ラップ − ロス）　<tspan fill="var(--pink)">■</tspan> ロス（超過分）
      </text>
    </svg>
  );
}

/** 安定性: 2選手のレース得点の散らばり。狭い=安定(高得点)、広い=不安定(低得点)。 */
function ConsistencyDiagram() {
  const mean = 330;
  const athletes = [
    { y: 56, label: "選手X", dots: [300, 314, 324, 333, 342, 352], note: "CV小 → 安定 92", col: "var(--green)" },
    { y: 122, label: "選手Y", dots: [214, 258, 300, 344, 392, 446], note: "CV大 → 不安定 41", col: "var(--amber)" },
  ];
  return (
    <svg viewBox="0 0 620 176" role="img" aria-label="安定性の散らばりの図解">
      <line x1={mean} y1={26} x2={mean} y2={150} stroke="var(--line)" strokeDasharray="4 4" />
      <text x={mean} y={18} textAnchor="middle" fontSize="10" fill="var(--dim)">
        平均
      </text>
      {athletes.map((a) => (
        <g key={a.label}>
          <text x={70} y={a.y + 5} textAnchor="end" fontSize="12" fontWeight="700" fill="var(--muted)">
            {a.label}
          </text>
          <line x1={90} y1={a.y} x2={480} y2={a.y} stroke="var(--line)" />
          {a.dots.map((d, i) => (
            <circle key={i} cx={d} cy={a.y} r={5} fill={a.col} fillOpacity={0.85} />
          ))}
          <text x={492} y={a.y + 4} fontSize="11" fontWeight="700" fill={a.col}>
            {a.note}
          </text>
        </g>
      ))}
      <text x={90} y={168} fontSize="10.5" fill="var(--dim)">
        score = (1 − CV / 0.3) × 100　＝ ブレが小さいほど高得点
      </text>
    </svg>
  );
}

/** 最近の調子: レース得点の推移。直近3大会の平均が全体平均より上なら好調。 */
function RecentFormDiagram() {
  const pts = [
    { x: 120, v: 96 },
    { x: 168, v: 108 },
    { x: 216, v: 92 },
    { x: 264, v: 118 },
    { x: 312, v: 104 },
    { x: 360, v: 112 },
    { x: 408, v: 128 },
    { x: 456, v: 132 },
    { x: 504, v: 126 },
  ];
  const baseY = 100;
  const toY = (v: number) => 150 - v * 0.72;
  const recent = pts.slice(-3);
  const recAvg = recent.reduce((s, p) => s + p.v, 0) / 3;
  return (
    <svg viewBox="0 0 620 176" role="img" aria-label="最近の調子の図解">
      <line x1={100} y1={toY(baseY)} x2={540} y2={toY(baseY)} stroke="var(--line)" strokeDasharray="5 4" />
      <text x={104} y={toY(baseY) - 6} fontSize="10.5" fill="var(--dim)">
        全体平均
      </text>
      <polyline
        points={pts.map((p) => `${p.x},${toY(p.v)}`).join(" ")}
        fill="none"
        stroke="var(--line)"
        strokeWidth={1.5}
      />
      {pts.map((p, i) => {
        const isRec = i >= pts.length - 3;
        return <circle key={i} cx={p.x} cy={toY(p.v)} r={isRec ? 5.5 : 4} fill={isRec ? "var(--green)" : "var(--dim)"} fillOpacity={isRec ? 0.95 : 0.6} />;
      })}
      <rect x={recent[0].x - 8} y={toY(recAvg) - 34} width={recent[2].x - recent[0].x + 16} height={20} rx={5} fill="var(--green)" fillOpacity={0.14} stroke="var(--green)" strokeOpacity={0.5} />
      <text x={(recent[0].x + recent[2].x) / 2} y={toY(recAvg) - 20} textAnchor="middle" fontSize="10.5" fontWeight="700" fill="var(--green)">
        直近3大会 平均 +8%
      </text>
      <text x={100} y={170} fontSize="10.5" fill="var(--dim)">
        直近3大会の平均が全体平均より上＝好調（主戦場の種目別に算出）
      </text>
    </svg>
  );
}

/** トレンド: 全ペアの傾きの中央値をとる Theil–Sen。1つの外れ値で向きが反転しない。 */
function TrendDiagram() {
  const pts = [
    { x: 130, y: 138 },
    { x: 200, y: 120 },
    { x: 270, y: 150 },
    { x: 340, y: 104 },
    { x: 410, y: 92 },
    { x: 480, y: 74 },
    { x: 300, y: 58 }, // 外れ値（大崩れの逆＝好走）
  ];
  const pairs = [
    [0, 5],
    [1, 4],
    [2, 5],
    [0, 4],
    [1, 5],
  ];
  return (
    <svg viewBox="0 0 620 190" role="img" aria-label="Theil-Senトレンドの図解">
      <line x1={110} y1={168} x2={560} y2={168} stroke="var(--line)" />
      <text x={110} y={184} fontSize="10.5" fill="var(--dim)">
        レース順 →
      </text>
      {pairs.map(([a, b], i) => (
        <line key={i} x1={pts[a].x} y1={pts[a].y} x2={pts[b].x} y2={pts[b].y} stroke="var(--dim)" strokeOpacity={0.35} strokeWidth={1} />
      ))}
      <line x1={110} y1={150} x2={560} y2={64} stroke="var(--cyan)" strokeWidth={2.5} />
      {pts.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={5} fill={i === 6 ? "var(--amber)" : "var(--violet)"} fillOpacity={0.9} />
      ))}
      <text x={pts[6].x + 8} y={pts[6].y - 4} fontSize="10" fill="var(--amber)">
        外れ値
      </text>
      <text x={456} y={54} textAnchor="end" fontSize="10.5" fontWeight="700" fill="var(--cyan)">
        全ペアの傾きの中央値
      </text>
      <text x={110} y={20} fontSize="10.5" fill="var(--dim)">
        単発の大崩れ・好走 1 本では向きが反転しない（頑健回帰）
      </text>
    </svg>
  );
}

/** クロスレース: (巡航速度, ミス率) の散布に頑健回帰。期待値との残差でミスの多寡を評価。 */
function CrossRaceDiagram() {
  const cohort = [
    [150, 150],
    [190, 138],
    [230, 128],
    [250, 132],
    [290, 118],
    [320, 108],
    [360, 100],
    [400, 96],
    [430, 84],
    [470, 78],
    [280, 96],
    [340, 122],
  ];
  const me = [360, 130]; // 期待線より上＝ミス多い、下＝少ない
  const lineY = (x: number) => 168 - (x - 150) * 0.28;
  return (
    <svg viewBox="0 0 620 214" role="img" aria-label="クロスレース残差の図解">
      <line x1={110} y1={186} x2={540} y2={186} stroke="var(--line)" />
      <line x1={110} y1={40} x2={110} y2={186} stroke="var(--line)" />
      <text x={540} y={202} textAnchor="end" fontSize="10.5" fill="var(--dim)">
        巡航速度（速い → 遅い）
      </text>
      <text x={104} y={36} textAnchor="end" fontSize="10.5" fill="var(--dim)">
        ミス率
      </text>
      <line x1={150} y1={lineY(150)} x2={490} y2={lineY(490)} stroke="var(--cyan)" strokeWidth={2} strokeDasharray="6 4" />
      <text x={492} y={lineY(490) + 4} fontSize="10" fill="var(--cyan)">
        期待値
      </text>
      {cohort.map((p, i) => (
        <circle key={i} cx={p[0]} cy={p[1]} r={4.5} fill="var(--violet)" fillOpacity={0.55} />
      ))}
      <line x1={me[0]} y1={me[1]} x2={me[0]} y2={lineY(me[0])} stroke="var(--green)" strokeWidth={2} />
      <circle cx={me[0]} cy={me[1]} r={6} fill="var(--green)" />
      <text x={me[0] + 10} y={me[1] + 4} fontSize="10.5" fontWeight="700" fill="var(--green)">
        この選手＝期待よりミスが少ない
      </text>
      <text x={110} y={22} fontSize="10.5" fill="var(--dim)">
        同水準の巡航速度指標の選手群の期待ミス率との差（残差）を百分位帯で提示
      </text>
    </svg>
  );
}

/** レッグ分解: 総ロスをコース起因（フィールド中央値）と自分の超過に分ける。 */
function LegDecompDiagram() {
  const x0 = 150;
  const rows = [
    { y: 54, label: "レッグ1", course: 118, excess: 26, tag: "コースの罠", tagCol: "var(--violet)" },
    { y: 122, label: "レッグ2", course: 70, excess: 128, tag: "自分のミス", tagCol: "var(--pink)" },
  ];
  return (
    <svg viewBox="0 0 620 190" role="img" aria-label="レッグ分解の図解">
      {rows.map((r) => (
        <g key={r.label}>
          <text x={x0 - 12} y={r.y + 15} textAnchor="end" fontSize="12" fontWeight="700" fill="var(--muted)">
            {r.label}
          </text>
          <rect x={x0} y={r.y} width={r.course} height={24} rx={4} fill="var(--violet)" fillOpacity={0.6} />
          <rect x={x0 + r.course} y={r.y} width={r.excess} height={24} rx={4} fill="var(--pink)" fillOpacity={0.65} />
          <text x={x0 + r.course + r.excess + 12} y={r.y + 16} fontSize="11" fontWeight="700" fill={r.tagCol}>
            {r.tag}
          </text>
        </g>
      ))}
      <text x={x0} y={182} fontSize="10.5" fill="var(--dim)">
        総ロス＝<tspan fill="var(--violet)">コース起因（フィールド中央値ロス）</tspan> ＋ <tspan fill="var(--pink)">自分の超過</tspan>。超過が大きいレッグ＝自分のミス
      </text>
    </svg>
  );
}

/** 並べ替え検定: レース内のミス総数を固定した帰無分布に対し観測が裾かで偏りを判定。 */
function PermTestDiagram() {
  const bars = [3, 7, 14, 24, 34, 40, 36, 27, 18, 11, 7, 4, 3, 2];
  const bw = 26;
  const x0 = 120;
  const baseY = 158;
  const obsIdx = 11; // 観測（右裾）
  return (
    <svg viewBox="0 0 620 196" role="img" aria-label="並べ替え検定の図解">
      <line x1={x0 - 6} y1={baseY} x2={x0 + bars.length * bw + 6} y2={baseY} stroke="var(--line)" />
      {bars.map((b, i) => {
        const inTail = i >= obsIdx;
        return (
          <rect
            key={i}
            x={x0 + i * bw}
            y={baseY - b * 3.1}
            width={bw - 4}
            height={b * 3.1}
            rx={2}
            fill={inTail ? "var(--pink)" : "var(--violet)"}
            fillOpacity={inTail ? 0.55 : 0.4}
          />
        );
      })}
      <line x1={x0 + obsIdx * bw} y1={30} x2={x0 + obsIdx * bw} y2={baseY} stroke="var(--pink)" strokeWidth={2} />
      <text x={x0 + obsIdx * bw + 6} y={40} fontSize="10.5" fontWeight="700" fill="var(--pink)">
        観測＝このセルのミス数
      </text>
      <text x={x0 + 4 * bw} y={54} textAnchor="middle" fontSize="10.5" fill="var(--dim)">
        並べ替えた帰無分布
      </text>
      <text x={x0} y={182} fontSize="10.5" fill="var(--dim)">
        レース内のミス総数を固定して並べ替え → 観測が裾なら「偏って多い」。多重比較は BH-FDR（q=0.10）で補正
      </text>
    </svg>
  );
}

/** 順位が動いたレッグ: 通過順位の推移。大きく動いたレッグを主指標に。 */
function LegImpactDiagram() {
  const ranks = [8, 7, 9, 6, 6, 12, 5, 5, 4, 4]; // elapsedRank（小=上位）
  const x0 = 130;
  const dx = 42;
  const toY = (r: number) => 40 + r * 10;
  const movers = [4, 6]; // 大きく動いたレッグ index
  const pts = ranks.map((r, i) => ({ x: x0 + i * dx, y: toY(r), r }));
  return (
    <svg viewBox="0 0 620 196" role="img" aria-label="順位が動いたレッグの図解">
      <text x={x0 - 18} y={toY(2) + 4} textAnchor="end" fontSize="10" fill="var(--dim)">
        上位
      </text>
      <text x={x0 - 18} y={toY(12) + 4} textAnchor="end" fontSize="10" fill="var(--dim)">
        下位
      </text>
      <polyline points={pts.map((p) => `${p.x},${p.y}`).join(" ")} fill="none" stroke="var(--cyan)" strokeWidth={2} />
      {pts.map((p, i) => {
        const big = movers.includes(i);
        return (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r={big ? 6.5 : 4} fill={big ? "var(--pink)" : "var(--cyan)"} fillOpacity={0.9} />
            {big && (
              <text x={p.x} y={p.y - 12} textAnchor="middle" fontSize="9.5" fontWeight="700" fill="var(--pink)">
                大きく動いた
              </text>
            )}
          </g>
        );
      })}
      <line x1={x0} y1={168} x2={x0 + (ranks.length - 1) * dx} y2={168} stroke="var(--line)" />
      <text x={x0} y={184} fontSize="10.5" fill="var(--dim)">
        各レッグでの通過順位（elapsedRank）の1人あたり平均変動が主指標（記述統計・％では出さない）
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
            <b>LapCenter</b> から毎日自動でデータを集め、さらに{" "}
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
            <div className="dec fig" id="consistency" style={{ scrollMarginTop: "80px" }}>
              <div className="k">CONSISTENCY ｜ 安定性</div>
              <ConsistencyDiagram />
              <div className="cap">
                各レース得点の <b>散らばり（変動係数 CV = σ/μ）</b>を <code>score = (1 − CV/0.3) × 100</code> で 0–100 化。ブレが小さいほど高得点。
                0.3 は「CV 30% で 0 点」とする規約スケール（検定に基づく値ではない）。
              </div>
            </div>
            <div className="dec fig" id="recent-form" style={{ scrollMarginTop: "80px" }}>
              <div className="k">RECENT FORM ｜ 最近の調子</div>
              <RecentFormDiagram />
              <div className="cap">
                直近3大会の平均を全体平均と比べた <b>差%</b>。上なら好調・下なら不調。種目別に算出し（Forester は Forest のみ等）主戦場で評価する。
              </div>
            </div>
            <div className="dec fig" id="lean" style={{ scrollMarginTop: "80px" }}>
              <div className="k">TYPE / LEAN ｜ タイプ分類と Forest／Sprint 寄り</div>
              <LeanShift />
              <div className="cap">
                無差別 F／S の得点を母集団で <b>z-score 正規化</b>し、差で forester／sprinter／allrounder を判定（閾値 ±0.3σ）。
                スプリントは母集団平均が <b>約 0.4σ 高い</b>ため生の得点差だと <b>8 割近くが Sprint 寄り</b>に偏る → 正規化で補正。選手ページの寄りバー位置もこの補正値を使う。
              </div>
            </div>
            <div className="dec fig" id="trend" style={{ scrollMarginTop: "80px" }}>
              <div className="k">TREND ｜ トレンドライン（Theil–Sen 頑健回帰）</div>
              <TrendDiagram />
              <div className="cap">
                スコア・巡航速度・ミス率のトレンドを <b>全ペアの傾きの中央値</b>で引く（レース順ベース・5レース未満は非表示・Forest／Sprint 独立）。
                単発の大崩れ／好走 1 本では向きが反転しない。
              </div>
            </div>
            <div className="dec fig" id="cross-race" style={{ scrollMarginTop: "80px" }}>
              <div className="k">CROSS-RACE ｜ ミス率の相対評価（残差）</div>
              <CrossRaceDiagram />
              <div className="cap">
                種目内 n≥5 の（巡航速度, ミス率）に頑健回帰を当て、<b>同水準の選手群の期待ミス率との差（残差）</b>を百分位帯で提示。
                巡航速度は出走クラス上位3基準の相対値で、クラスをまたぐ絶対走力比較ではない。高ミス率レース（種目内上位四分位）の本数も併記。
              </div>
            </div>
            <div className="dec fig" id="leg" style={{ scrollMarginTop: "80px" }}>
              <div className="k">LEG ｜ レッグ分解（結果分析）</div>
              <LegDecompDiagram />
              <div className="cap">
                各レッグのロスを <b>コース起因（フィールド中央値ロス）</b>と <b>自分の超過</b>に分け、罠レッグと自分のミスを区別。
                ノーミス推定タイム（記録 − 総ロス）で実フィールドに対する想定順位も出す。
              </div>
            </div>
            <div className="dec fig" id="miss-def" style={{ scrollMarginTop: "80px" }}>
              <div className="k">MISS ｜ ミス判定</div>
              <MissBar />
              <div className="cap">
                超過ロスが「想定タイム（ラップ − ロス）× 0.30」と「絶対下限 forest 10秒／sprint 5秒」の大きい方以上で 1 ミス。
                0.30 は日常ばらつき（中央値 6–8%）の 4–5 倍の規約値。地形・安全ルート・集団走のロスも含みうるためナビミスとは断定しない。
              </div>
            </div>
            <div className="dec fig grid" id="cell-def" style={{ scrollMarginTop: "80px" }}>
              <div className="k">CELL ｜ 局面 × レッグ長（ミス率ヒートマップ）</div>
              <CellGrid />
              <div className="cap">
                レッグを <b>局面（序盤／中盤／終盤）</b> × <b>レッグ長</b> の 9 セルに層別してミス率を集計。
                レッグ長は <b>所要時間（上位3名平均スプリット Ave3）のレース内3分位</b>＝距離ではなく同一大会内の相対区分。
              </div>
            </div>
            <div className="dec fig" id="pack" style={{ scrollMarginTop: "80px" }}>
              <div className="k">PACK ｜ 集団走の除染</div>
              <PackDiagram />
              <div className="cap">
                同一コースの他走者と各コントロールの <b>通過時計時刻（スタート＋累積）</b>を突合し、差が <b>forest 15秒／sprint 10秒以内で 3 レッグ以上連続</b>した区間を集団走とみなして除外
                （フォロワーの区間タイムは自分のナビ力ではないため）。両者除外＝標本が減るだけで偏りは作らない。50% 超ならレース不採用、スタート時刻不明は「未チェック」。
              </div>
            </div>
            <div className="dec fig" id="miss-trend" style={{ scrollMarginTop: "80px" }}>
              <div className="k">MISS-TREND ｜ ミスの傾向（並べ替え検定 ＋ FDR）</div>
              <PermTestDiagram />
              <div className="cap">
                上の 3×3 セル（ミス判定・集団走除外済み）のミス数を、<b>レース内のミス総数を固定した並べ替え帰無分布</b>（日次調子・レース内相関を保存）と比べ、
                裾にあるセルだけを <b>BH-FDR（q=0.10）</b>で「偏って多い」とフラグ。巡航速度が近い帯の平均との記述比較も併記する。
              </div>
            </div>
            <div className="dec fig" id="leg-impact" style={{ scrollMarginTop: "80px" }}>
              <div className="k">LEG-IMPACT ｜ 順位が動いたレッグ</div>
              <LegImpactDiagram />
              <div className="cap">
                主指標は各レッグでの <b>通過順位（elapsedRank）の1人あたり平均変動</b>＝仮定ゼロの記述統計。
                副指標は上位完走者のミス残差の連動度。<b>百分率では出さない</b>（「このレッグで X% 決まった」とは言えない設計）。完走者8名未満・リレー系は非表示。
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
