import Link from "@/components/AppLink";
import type { RookieLeagueData } from "@/lib/rookie/types";

/** B クラス候補（計画: docs/plans/2026-11-27_b-class-candidates.md）。名前順・前向きの言い方で出す */
export function BCandidatesList({ data }: { data: NonNullable<RookieLeagueData["bCandidates"]> }) {
  if (data.entries.length === 0) return null;
  return (
    <section className="mt-10 border-t border-border pt-6">
      <h3 className="text-base font-bold">B クラスで上位を狙える 21A の学生</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        21A での最近の走りを、同じ大会の B クラスの記録と比べると、B では上位争いに入れる競技 2 年目までの学生です。
        <br className="hidden sm:inline" />
        B で勝つ経験を積むのも 1 つの道です。
      </p>

      <ul className="mt-4 divide-y divide-border/60 border-y border-border/60">
        {data.entries.map((e) => (
          <li key={e.nameKey} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-2 py-2.5">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {e.linkable ? (
                  <Link href={`/a/${encodeURIComponent(e.nameKey)}`} className="hover:text-primary">
                    {e.name}
                  </Link>
                ) : (
                  e.name
                )}
              </span>
              <span className="block truncate text-xs text-muted">
                {e.club || "—"}
                <span className="mx-1.5">·</span>
                <span className="whitespace-nowrap">{e.year}年目</span>
              </span>
            </span>
            <span className="whitespace-nowrap text-xs text-muted">
              B なら <span className="font-medium text-foreground">{e.band}</span> 相当
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-xs leading-relaxed text-muted">
        比べ方: {data.from} 〜 {data.to} に、21A と B が同じ日に走った大会だけを使い、1km あたりのタイムで「B に出ていたら何番目くらいか」を出しています（女子は男女のタイム差を補正）。
        2 大会以上で、B の上位 4 分の 1 に入らない水準の人を載せています。並びは所属ごとで、速さの順ではありません。掲載をやめたい場合は
        <Link href="/contact" className="text-primary hover:underline">
          お問い合わせ
        </Link>
        からご連絡ください。
      </p>
    </section>
  );
}
