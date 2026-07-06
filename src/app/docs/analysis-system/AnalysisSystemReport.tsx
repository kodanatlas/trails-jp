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
      { x: 90, w: 380, t: "PostgreSQL ｜ athletes・lc_performances 他" },
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
          </p>
          <div className="kpis">
            <div className="kpi">
              <div className="n">{stats.events.toLocaleString()}</div>
              <div className="l">収集イベント</div>
            </div>
            <div className="kpi">
              <div className="n">{stats.athletes.toLocaleString()}</div>
              <div className="l">ランキング掲載選手</div>
            </div>
            <div className="kpi">
              <div className="n">{stats.lcRecords.toLocaleString()}</div>
              <div className="l">成績レコード（巡航速度・ミス率）</div>
            </div>
            <div className="kpi">
              <div className="n">{stats.clubs.toLocaleString()}</div>
              <div className="l">クラブ</div>
            </div>
          </div>
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
              </ul>
              <span className="file mono">/analysis</span>
            </div>
            <div className="doc a">
              <div className="ghost">L</div>
              <span className="tag">RESULTS</span>
              <h3>結果分析（レッグ）</h3>
              <p>LapCenter のスプリットから、レッグ単位でタイムを分解。</p>
              <ul>
                <li>ロスを<b>コース起因／自分のミス</b>に分解（罠レッグ判定）</li>
                <li><b>区間賞</b>・ノーミス推定順位・タイム差グラフ</li>
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
              <div className="d">巡航速度・ミス率を収集して DB へ <code>upsert</code>。</div>
            </div>
            <div className="wave">
              <div className="w">水曜 ビルド時</div>
              <div className="t">build-analysis-index</div>
              <div className="d">ランキング最新取得 → <b>athlete-index / club-stats</b> を再生成。</div>
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
                スコア体系の違いを母集団で正規化し差で判定（閾値 0.3）→ forester / sprinter /
                allrounder。
              </div>
            </div>
            <div className="dec">
              <div className="k">TREND ｜ トレンドライン</div>
              <div className="v">
                <span className="hl">Theil–Sen</span> 頑健回帰
              </div>
              <div className="why">
                スコア・巡航速度・ミス率のトレンド線を Forest／Sprint 独立で描画（レース順ベース・5レース未満は非表示）。
                pairwise slope の中央値を使うため、単発の大崩れレースで向きが反転しない。
              </div>
            </div>
            <div className="dec">
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
            <div className="ph now">
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
              <div className="w">進行中</div>
              <div className="d">残る静的 JSON（athlete-index 等）も DB API 化。</div>
              <div className="chips">
                <span className="chip b">API</span>
              </div>
            </div>
            <div className="ph">
              <div className="p">P3</div>
              <div className="w">構想</div>
              <div className="d">応援機能の運用拡充（トレンド表示・グループ応援）。</div>
              <div className="chips">
                <span className="chip c">応援</span>
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
          数値は 2026-05〜06 時点の規模感。本ページは直リンク用の技術解説です。 ／{" "}
          <a href="/">trails.jp を開く</a>
        </footer>
      </div>
    </div>
  );
}
