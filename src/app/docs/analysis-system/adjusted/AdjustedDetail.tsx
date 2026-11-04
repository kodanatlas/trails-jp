"use client";

import { useEffect, useState } from "react";
import "../report.css";
import "./adjusted.css";

type Theme = "dark" | "light";
const STORAGE_KEY = "trails-docs-theme"; // システム全体構成ページと共有

export interface LiveAdjustment {
  windowStart: string;
  nodes: { pct: number; gap: number }[];
  pairedCount: number;
  generatedAt: string | null;
}

/* 2026年11月改定時点の値（本文・図の説明用。現在の値は「現在の値」の表を参照） */
const TIERS = [
  { label: "上位10%", pct: 5, gap: 189, lo: 153, hi: 198 },
  { label: "上位10〜25%", pct: 17.5, gap: 242, lo: 231.5, hi: 284 },
  { label: "上位25〜50%", pct: 37.5, gap: 290, lo: 255, hi: 314 },
  { label: "下位50%", pct: 75, gap: 338, lo: 315, hi: 363 },
];
const OLD_GAP = 159.3;

const TIER_LABELS = ["上位10%", "上位10〜25%", "上位25〜50%", "下位50%"];

function useReportTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* localStorage 不可でも既定ダークで成立 */
    }
    const prefersLight =
      typeof window !== "undefined" &&
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: light)").matches;
    // 保存済みテーマ／OS 設定の反映はマウント後にしか読めないため effect 内で行う
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
  return [theme, toggle];
}

export function AdjustedDetail({ live }: { live: LiveAdjustment | null }) {
  const [theme, toggle] = useReportTheme();

  return (
    <div className="report-root" data-theme={theme}>
      <button
        className="theme-toggle"
        type="button"
        aria-label="ダークモードとライトモードを切り替える"
        onClick={toggle}
      >
        <span className="if-dark">LIGHT</span>
        <span className="if-light">DARK</span>
      </button>

      <article className="adj">
        <a className="back" href="/docs/analysis-system#adjusted">
          ← システム全体構成「補正済みポイント」に戻る
        </a>
        <h1>補正済みポイントの詳細：スプリントの補正</h1>
        <p className="intro">
          選手ページのメイン数値「補正済みポイント」は、JOY の「上位3大会合計」をもとに、フォレストとスプリントを同じ物差しで比べられるよう補正した値です。
          このページでは、スプリントの得点から何点をどう差し引いているのか、その根拠と検証結果を説明します。2026年11月に方式を改めました。
        </p>

        <section>
          <h2>1. 計算の流れ</h2>
          <ol className="steps">
            <li>
              <span className="t">対象にする大会を選ぶ</span>
              <span className="d">
                無差別クラス（女子は女子無差別）の、JOY と同じ直近1年の実大会。
              </span>
            </li>
            <li>
              <span className="t">選手の水準を測る</span>
              <span className="d">
                フォレストとスプリントそれぞれの上位3大会の平均をとり、その平均が同性の選手の分布でどの位置にあるかを出す。
              </span>
            </li>
            <li>
              <span className="t">差し引く量を決める</span>
              <span className="d">水準に応じて、1大会あたり約190〜340点の範囲で決まる（下の 3 章）。</span>
            </li>
            <li>
              <span className="t">スプリントの各大会から差し引く</span>
              <span className="d">フォレストの得点はそのまま。スプリントの各大会の得点から、決まった量を引く。</span>
            </li>
            <li>
              <span className="t">混ぜて上位3大会を合計する</span>
              <span className="d">
                補正後の得点で、フォレストとスプリントを区別せずに高い順に3つ選んで合計する。これが補正済みポイント。
              </span>
            </li>
          </ol>
        </section>

        <section>
          <h2>2. なぜスプリントを補正するのか</h2>
          <p>
            JOY ランキングの得点は、同じ選手でもスプリントのほうが高く出ます。直近1年に両種目とも3大会以上出ている
            <b>506人</b>（男子386人・女子120人）で「スプリント上位3大会の平均 − フォレスト上位3大会の平均」を比べると、
            <b>97%の選手でスプリントのほうが高く、差の中央値は289点</b>でした。
          </p>
          <p>
            このまま混ぜて上位3大会を選ぶと、スプリントの大会ばかりが選ばれ、スプリントに多く出る選手ほど有利になります。
            そこで、スプリントの得点を「フォレストならこのくらい」という水準に直してから比べます。
          </p>

          <h3>以前の方式（2026年11月の改定まで）と、その問題</h3>
          <p>
            以前は「スプリント無差別の平均合計 − フォレスト無差別の平均合計」を3で割った値（最終的に<b>約160点</b>）を、全員一律に差し引いていました。
            これには2つの問題がありました。
          </p>
          <ul>
            <li>
              <b>差を小さく見積もっていた。</b>
              合計点は大会数が3つに満たない選手だと小さくなります。直近1年の大会数が3未満の選手はスプリントで54%、フォレストで24%と、スプリントに偏っています。
              そのためスプリントの平均合計だけが低く出て、種目の差が実際より小さく見えていました。
              そもそも2つの平均は顔ぶれの違う集団どうしの比較で、どの選手を含めるかで値が約160点から380点台まで動きます（全員なら約160点、各種目で3大会以上の選手に限ると約380点）。
            </li>
            <li>
              <b>全員に同じ量を引いていた。</b>
              次の章で見るとおり、差は選手の水準によって大きく違います。
            </li>
          </ul>
          <p>
            そこで改定後は、<b>同じ選手のスプリントとフォレストを直接比べた差</b>をもとに、差し引く量を決めています。
            同じ人どうしを比べるので、種目ごとに出場者の顔ぶれが違うことの影響を抑えられます。
            ただし対象は両種目とも3大会以上出ている選手に限られ、種目ごとの出場数の違い（フォレストのほうが多い）はそのまま残ります。
          </p>
        </section>

        <section>
          <h2>3. 差し引く量は水準によって変わる</h2>
          <p>
            同じ選手での差（スプリント − フォレスト）は、上位の選手ほど小さく、下位ほど大きくなります。両種目に出ている選手を水準で4つの層に分けると、各層の中央値は次のとおりです。
          </p>
          <div className="fig">
            <GapCurve />
            <p className="cap">
              点は各層の中央値で、層の中ほど（上位5%・17.5%・37.5%・75%の位置）に置いている。縦線は95%信頼区間
              （506人から重複を許して選び直し、層分けと中央値を推定し直すことを1万回繰り返したときの範囲）。
              点と点の間は直線でつなぎ、上位5%以内は約189点、上位75%より下（下位25%）は約338点で一定にする。破線は以前の一律の値（約160点）。
            </p>
          </div>
          <p>
            この傾向と並行して、1人の選手の中での得点のばらつきも種目で違います。両種目に3大会以上出ている506人で、
            選手ごとの大会得点の標準偏差（中央値）はスプリント59点、フォレスト129点と、フォレストのほうが2倍以上ぶれます。
            上位の選手ほどフォレストのばらつきが小さく、出場数も多い傾向があり、これが上位で差が縮む一因と考えられます。ただし、原因を特定したものではありません。
          </p>
          <p>
            そのため、どんな一律の量でもすべての層には合いません。全体の中央値（約290点）を一律に引けば上位層は引きすぎ・下位層は引き足りなくなります。
            以前の一律約160点では、上位10%層を除くどの層でもスプリントが1大会あたり約80〜200点高いまま残り、水準が低い層ほど大きく残っていました（5 章の表）。
          </p>

          <h3>水準の測り方</h3>
          <ul>
            <li>
              <b>両種目とも直近1年に3大会以上ある選手：</b>
              フォレスト上位3大会の平均とスプリント上位3大会の平均の、さらに平均を「水準」とし、同じ条件（両種目とも3大会以上）の同性の選手の中での位置（上位何%か）を出します。
            </li>
            <li>
              <b>それ以外の選手（どちらかの種目が3大会未満）：</b>
              スプリント上位3大会の平均（3大会未満ならある分の平均）で代用し、同じ条件（両種目とも3大会以上）の同性の選手のスプリント上位3平均の分布の中での位置を出します。
            </li>
          </ul>
          <p className="muted">
            スプリントの得点だけで水準を測らないのは、スプリントが得意な選手ほど上の層に集まり、「得意さ」まで種目の差として差し引いてしまうためです。
            両種目の平均で測れば、同じくらいの実力の選手どうしで種目の差を比べられます。
          </p>

          <h3>計算例（男子・2026年11月時点）</h3>
          <div className="example">
            <div className="row">
              <span>フォレスト上位3大会の平均</span>
              <span>2,600点</span>
            </div>
            <div className="row">
              <span>スプリント上位3大会の平均</span>
              <span>2,900点</span>
            </div>
            <div className="row">
              <span>水準（2つの平均）</span>
              <span>2,750点 → 上位42%</span>
            </div>
            <div className="row">
              <span>差し引く量（上位25〜50%層と下位50%層の間を補間）</span>
              <span>約296点</span>
            </div>
            <div className="row">
              <span>スプリントの大会が3,000点なら</span>
              <span>3,000 − 296 = 2,704点として比べる</span>
            </div>
          </div>
          <p className="muted">
            同じ男子でも、フォレスト2,900点・スプリント3,100点の選手（上位4%）は約189点、フォレスト2,200点・スプリント2,500点の選手（上位90%）は約338点になります。
            選手ページの「補正済みポイント」の内訳に、その選手に適用した値を表示しています。
          </p>

          <h3>男女共通の値を使う理由</h3>
          <p>
            水準の位置は男女別に測りますが、各層の差し引く量は男女共通です。女子だけで推定した値（例えば下位50%層で363点）は、
            人数が少ない（120人）ため信頼区間が広く（下位50%層で±約49点、上位10%層では±約61点）、どの層でも男女共通の値がその範囲に入っていました。
            男女で別々の値を使うだけの根拠が今回のデータからは得られなかったため、より安定する男女共通の値を使っています。
          </p>
        </section>

        <section>
          <h2>4. 対象にする大会</h2>
          <ul>
            <li>
              <b>直近1年の実大会だけ。</b>
              JOY ランキングと同じ期間にそろえます。期間の開始日は、JOY が公表している合計点を最もよく再現できる日をデータから逆算して決めています
              （2026年11月時点では2025年11月16日以降の大会。無差別4クラスの3,336件中3,335件で JOY の合計点と一致）。
            </li>
            <li>
              <b>女子は「女子無差別」のランキングだけを使う。</b>
              女子選手は「無差別」と「女子無差別」の両方に載っています。以前は両方の大会を混ぜていたため、同じ大会が2回数えられていました（改定時に修正）。
            </li>
            <li>
              <b>「補完」は大会数が足りないときだけ。</b>
              JOY は種目ごとに、直近1年の実大会が3つに満たない選手に「補完」の値を1枠加えて合計しています。補正済みポイントでは、
              両種目合わせた実大会が3つ未満のときだけ、実大会がある種目の補完値（スプリントは差し引いた後の値）の高いほうを1枠加えます。
              実大会が3つ以上ある選手では、補完が実際の大会を押しのけることはありません。
            </li>
          </ul>
        </section>

        <section>
          <h2>5. 検証結果</h2>
          <p>
            補正がうまくいっていれば、両種目に出ている選手について「補正後のスプリント上位3平均 − フォレスト上位3平均」が、どの層でもおおむね0になるはずです。
            層ごとの中央値（1大会あたり・点）を、以前の方式と比べました。
            なお、この表は差し引く量の推定に使ったのと同じデータでの確認です。差し引く量は各層の中央値から作っているので、改定後の値が0に近くなるのは作り方からある程度当然で、
            「4層・男女共通」という補正の形が層ごとの偏りを残していないかを見るためのものです。将来のデータでの精度を保証するものではありません。
          </p>
          <div className="tbl-wrap">
            <table>
              <thead>
                <tr>
                  <th>層（水準）</th>
                  <th>人数</th>
                  <th>補正前の差</th>
                  <th>以前の方式</th>
                  <th>改定後</th>
                </tr>
              </thead>
              <tbody>
                <ResidualRow label="男子 上位10%" n={39} raw={184} old={25} now={-19} />
                <ResidualRow label="男子 上位10〜25%" n={58} raw={243} old={84} now={17} />
                <ResidualRow label="男子 上位25〜50%" n={96} raw={284} old={125} now={2} />
                <ResidualRow label="男子 下位50%" n={193} raw={338} old={178} now={12} />
                <ResidualRow label="女子 上位10%" n={12} raw={204} old={45} now={15} />
                <ResidualRow label="女子 上位10〜25%" n={18} raw={240} old={80} now={-2} />
                <ResidualRow label="女子 上位25〜50%" n={30} raw={308} old={149} now={12} />
                <ResidualRow label="女子 下位50%" n={60} raw={363} old={204} now={35} warn />
              </tbody>
            </table>
          </div>
          <p className="tbl-note">2026年11月2日時点の JOY ランキングで集計。プラスはスプリントが高く残っていることを表す。</p>
          <p>
            以前の方式では上位10%層以外で1大会あたり約80〜200点（下位層ほど大きい）のスプリント有利が残っていましたが、改定後はほとんどの層で±20点前後に収まりました。
            女子の下位50%層だけ+35点が残っています。この層だけ女子専用の値を使えば+10点まで縮みますが、上の 3 章のとおりその値は不安定なため、
            男女共通の値を優先しました（この層の女子60人での揺れの範囲内とみています）。
          </p>
          <p>ほかに次の点を確認しています。</p>
          <ul>
            <li>
              補正済みポイントがある全1,637人で、ビルド時に計算した値と、選手ページと同じ計算で出し直した値が一致する。
            </li>
            <li>
              同じ選手の中では、スプリントの得点が高い大会ほど補正後の値も高い（補正で大会の並び順は入れ替わらない）。
              選手どうしでは差し引く量が水準によって違うため、生の得点の順と補正後の順が入れ替わることがある。
            </li>
            <li>差し引く量の推定は安定している（各層の95%信頼区間の半幅は23〜30点）。</li>
          </ul>
        </section>

        <section>
          <h2>6. 現在の値</h2>
          {live ? (
            <>
              <p>
                差し引く量はランキングを更新する（毎週）たびに、同じ方法で計算し直しています。現在の値は次のとおりです。
              </p>
              <div className="tbl-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>層（水準）</th>
                      <th>差し引く量（1大会あたり）</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.nodes.map((n, i) => (
                      <tr key={n.pct}>
                        <td>{TIER_LABELS[i] ?? `上位${Math.round(n.pct * 100)}%付近`}</td>
                        <td>約{Math.round(n.gap)}点</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="tbl-note">
                対象期間 {live.windowStart} 〜 ／ 推定に使った選手 {live.pairedCount}人
                {live.generatedAt && <> ／ サイト更新日 {jstDate(live.generatedAt)}</>}
              </p>
            </>
          ) : (
            <p className="muted">現在の値を読み込めませんでした。</p>
          )}
        </section>

        <section>
          <h2>7. 限界と注意</h2>
          <ul>
            <li>
              差し引く量は、両種目に出ている選手から推定しています。スプリントにしか出ない選手にも同じ考え方を当てはめていますが、
              その選手がフォレストに出たら実際にどうなるかは確かめられません。
            </li>
            <li>
              上位層や女子の層は人数が少なく（12〜60人）、毎週の再計算で値が動くことがあります（信頼区間の半幅は男女共通の値で23〜30点）。
            </li>
            <li>
              大会ごとの難易度や参加者の顔ぶれの違いは、JOY の得点計算に含まれる範囲でしか反映されません。この補正は「種目全体の水準差」をならすもので、個々の大会の差は扱いません。
            </li>
          </ul>
          <p className="muted">
            関連：<a href="/docs/analysis-system#adjusted">システム全体構成「補正済みポイント」</a> ／{" "}
            <a href="/docs/analysis-system#lean">タイプ分類と Forest／Sprint 寄り</a>（こちらは別の方法で種目差を正規化している）
          </p>
        </section>
      </article>
    </div>
  );
}

/** ISO 時刻を JST の YYYY-MM-DD に */
function jstDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

function ResidualRow({
  label,
  n,
  raw,
  old,
  now,
  warn = false,
}: {
  label: string;
  n: number;
  raw: number;
  old: number;
  now: number;
  warn?: boolean;
}) {
  const fmt = (v: number) => (v > 0 ? `+${v}` : `${v}`);
  return (
    <tr>
      <td>{label}</td>
      <td>{n}</td>
      <td>{fmt(raw)}</td>
      <td>{fmt(old)}</td>
      <td className={warn ? "warn" : "good"}>{fmt(now)}</td>
    </tr>
  );
}

/** 水準（上位何%）と差し引く量の関係。2026-11 時点の節点と95%信頼区間 */
function GapCurve() {
  const W = 640;
  const H = 300;
  const L = 64;
  const R = 24;
  const T = 24;
  const B = 52;
  const xOf = (pct: number) => L + (pct / 100) * (W - L - R);
  const yMin = 140;
  const yMax = 380;
  const yOf = (v: number) => T + ((yMax - v) / (yMax - yMin)) * (H - T - B);
  const pts = [
    { pct: 0, gap: TIERS[0].gap },
    ...TIERS.map((t) => ({ pct: t.pct, gap: t.gap })),
    { pct: 100, gap: TIERS[3].gap },
  ];
  const path = pts.map((p, i) => `${i === 0 ? "M" : "L"}${xOf(p.pct).toFixed(1)},${yOf(p.gap).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="選手の水準と、スプリント1大会あたりに差し引く量の関係">
      {[150, 200, 250, 300, 350].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={yOf(v)} y2={yOf(v)} stroke="var(--line)" />
          <text x={L - 8} y={yOf(v) + 4} textAnchor="end" fontSize="11" fill="var(--dim)">
            {v}
          </text>
        </g>
      ))}
      {[0, 10, 25, 50, 75, 100].map((p) => (
        <text key={p} x={xOf(p)} y={H - B + 18} textAnchor="middle" fontSize="11" fill="var(--dim)">
          {p === 0 ? "トップ" : `上位${p}%`}
        </text>
      ))}
      <text x={(L + W - R) / 2} y={H - 10} textAnchor="middle" fontSize="11.5" fill="var(--muted)">
        選手の水準（男女別の分布での位置）
      </text>
      <text
        x={16}
        y={(T + H - B) / 2}
        textAnchor="middle"
        fontSize="11.5"
        fill="var(--muted)"
        transform={`rotate(-90 16 ${(T + H - B) / 2})`}
      >
        差し引く量（点）
      </text>
      <line
        x1={L}
        x2={W - R}
        y1={yOf(OLD_GAP)}
        y2={yOf(OLD_GAP)}
        stroke="var(--dim)"
        strokeDasharray="5 5"
      />
      <text x={W - R} y={yOf(OLD_GAP) - 6} textAnchor="end" fontSize="11" fill="var(--dim)">
        以前の一律の値（約160点）
      </text>
      <path d={path} fill="none" stroke="var(--cyan)" strokeWidth={2.5} />
      {TIERS.map((t) => (
        <g key={t.label}>
          <line x1={xOf(t.pct)} x2={xOf(t.pct)} y1={yOf(t.lo)} y2={yOf(t.hi)} stroke="var(--cyan)" strokeWidth={1.5} opacity={0.6} />
          <circle cx={xOf(t.pct)} cy={yOf(t.gap)} r={5} fill="var(--cyan)" />
          <text x={xOf(t.pct) + 8} y={yOf(t.gap) - 8} fontSize="11.5" fontWeight="700" fill="var(--ink)">
            約{t.gap}
          </text>
        </g>
      ))}
    </svg>
  );
}
