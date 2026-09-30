import { describe, it, expect } from "vitest";
import {
  buildLegFingerprintIndex,
  buildLegFingerprintArtifacts,
  type TrackedLegRow,
  type CompanionRow,
} from "../leg-fingerprint";
import {
  verifyFingerprintDetails,
  verifyDetailsAgainstSource,
  FingerprintInvariantError,
  type DisciplineDetail,
} from "../leg-fingerprint-details";

// ミスの傾向ドリルダウン（docs/plans/2026-09-30_miss-trend-drilldown.md）の明細出力と不変条件

let eidSeq = 1000;
function mkRace(
  key: string,
  date: string,
  legs: { lap: number; loss: number }[],
  opts: { start?: string | null; runnerIndex?: number; eventId?: number; eventName?: string } = {}
): TrackedLegRow {
  const eid = opts.eventId ?? eidSeq++;
  const laps = legs.map((l) => l.lap);
  const elapsed: number[] = [];
  let acc = 0;
  for (const l of laps) {
    acc += l;
    elapsed.push(acc);
  }
  return {
    runner_key: key,
    event_date: date,
    event_name: opts.eventName ?? `大会${eid}`,
    class_name: "M21",
    race_type: "forest",
    club: "テストクラブ",
    rank: 3,
    speed: 100,
    start_time: opts.start === undefined ? "10:00:00" : opts.start,
    lap_sec: laps,
    leg_loss_sec: legs.map((l) => l.loss),
    leg_speed: laps.map(() => 100),
    elapsed_sec: elapsed,
    lc_event_id: eid,
    lc_class_id: 0,
    runner_index: opts.runnerIndex ?? 1,
  };
}

/** 18レッグ: 終盤6本は長レッグ(300s)・他は100s台。missAt のレッグだけミス */
function legsWithMisses(missAt: number[]): { lap: number; loss: number }[] {
  return Array.from({ length: 18 }, (_, l) => {
    const base = l >= 12 ? 300 : 100 + l;
    const loss = missAt.includes(l) ? Math.ceil(0.3 * base) + 20 : 2;
    return { lap: base + loss, loss };
  });
}

function sixRaces(key: string, missAt: number[]): TrackedLegRow[] {
  return Array.from({ length: 6 }, (_, r) => mkRace(key, `2026-0${r + 1}-01`, legsWithMisses(missAt)));
}

/** 明細から数え直したセル [n, m] */
function cellsFromDetail(d: DisciplineDetail): [number, number][] {
  const out = Array.from({ length: 9 }, () => [0, 0] as [number, number]);
  d.legs.c.forEach((c, i) => {
    out[c][0]++;
    out[c][1] += d.legs.m[i];
  });
  return out;
}

describe("buildLegFingerprintArtifacts: 明細と集計の一致", () => {
  it("index は buildLegFingerprintIndex と完全に同一（カードの数字は変わらない）", () => {
    const tracked = [...sixRaces("一致選手", [2, 12]), ...sixRaces("別選手", [5])];
    const { index } = buildLegFingerprintArtifacts(tracked, []);
    expect(JSON.stringify(index)).toBe(JSON.stringify(buildLegFingerprintIndex(tracked, [])));
  });

  it("セルごとの行数=n・ミス行数=m、レース数・有効レッグ数が集計と一致する", () => {
    const tracked = sixRaces("一致選手", [2, 12, 14]);
    const { index, details } = buildLegFingerprintArtifacts(tracked, []);
    const fp = index.athletes["一致選手"]!.f!;
    const d = details["一致選手"]!.f!;
    expect(cellsFromDetail(d)).toEqual(fp.cells.map((c) => [c.n, c.m]));
    expect(d.races.length).toBe(fp.races);
    expect(d.races.filter((r) => r.x == null).length).toBe(fp.racesUsed);
    expect(d.legs.c.length).toBe(fp.legsValid);
    expect(() => verifyFingerprintDetails(index, details)).not.toThrow();
  });

  it("掲載ゲート未達（4レース）の選手は明細も出さない", () => {
    const tracked = Array.from({ length: 4 }, (_, r) =>
      mkRace("少数選手", `2026-01-0${r + 1}`, legsWithMisses([3]))
    );
    const { details } = buildLegFingerprintArtifacts(tracked, []);
    expect(details["少数選手"]).toBeUndefined();
  });
});

describe("明細のレッグ番号とレース識別", () => {
  it("手前のレッグが無効でも、レッグ番号はコース上の元の番号（0始まり）を保つ", () => {
    const tracked = sixRaces("番号選手", [5]);
    // 1レース目の第0・第1レッグを無効化（lap null）→ 第5レッグは l=5 のまま
    tracked[0].lap_sec[0] = null;
    tracked[0].lap_sec[1] = null;
    const { details } = buildLegFingerprintArtifacts(tracked, []);
    const d = details["番号選手"]!.f!;
    const race0Legs = d.legs.l.filter((_, i) => d.legs.r[i] === 0);
    expect(race0Legs).not.toContain(0);
    expect(race0Legs).not.toContain(1);
    const missLegs = d.legs.l.filter((_, i) => d.legs.r[i] === 0 && d.legs.m[i] === 1);
    expect(missLegs).toEqual([5]);
    expect(d.races[0].L).toBe(18);
  });

  it("同じ大会・クラスの再走は runner_index で別レースとして区別される", () => {
    const base = sixRaces("再走選手", [3]);
    const rerun = mkRace("再走選手", base[0].event_date, legsWithMisses([7]), {
      eventId: base[0].lc_event_id,
      runnerIndex: 2,
    });
    const { details } = buildLegFingerprintArtifacts([...base, rerun], []);
    const races = details["再走選手"]!.f!.races.filter((r) => r.ev === base[0].lc_event_id);
    expect(races.map((r) => r.ri).sort()).toEqual([1, 2]);
  });

  it("レースには日付・大会名・クラス・LapCenter の大会/クラス ID が載る", () => {
    const tracked = sixRaces("属性選手", [3]);
    const { details } = buildLegFingerprintArtifacts(tracked, []);
    const r0 = details["属性選手"]!.f!.races[0];
    expect(r0).toMatchObject({
      d: tracked[0].event_date,
      e: tracked[0].event_name,
      c: "M21",
      ev: tracked[0].lc_event_id,
      cl: 0,
      ri: 1,
      L: 18,
    });
  });
});

describe("集計対象外の記録", () => {
  it("集団走が過半のレースは理由 pack で残り、除外レッグ数は legsPack と一致する", () => {
    const packed = mkRace("除外選手", "2026-01-01", legsWithMisses([3]));
    const companion: CompanionRow = {
      lc_event_id: packed.lc_event_id,
      lc_class_id: 0,
      runner_index: 99,
      start_time: "10:00:05",
      elapsed_sec: packed.elapsed_sec,
      rank: 5,
      leg_loss_sec: packed.leg_loss_sec,
    };
    const tracked = [packed, ...sixRaces("除外選手", [3, 13]).slice(0, 5)];
    const { index, details } = buildLegFingerprintArtifacts(tracked, [companion]);
    const fp = index.athletes["除外選手"]!.f!;
    const d = details["除外選手"]!.f!;
    const excluded = d.races.filter((r) => r.x != null);
    expect(excluded.map((r) => r.x)).toEqual(["pack"]);
    expect(d.pack.r.length).toBe(fp.legsPack);
    // 採用レースのレッグは除外レースを参照しない
    const excludedIdx = d.races.findIndex((r) => r.x === "pack");
    expect(d.legs.r).not.toContain(excludedIdx);
    expect(() => verifyFingerprintDetails(index, details)).not.toThrow();
  });

  it("start 不明のレースは pu フラグ付きで記録され packUnchecked と一致する", () => {
    const tracked = Array.from({ length: 5 }, (_, r) =>
      mkRace("開始不明", `2026-03-0${r + 1}`, legsWithMisses([4, 13]), { start: null })
    );
    const { index, details } = buildLegFingerprintArtifacts(tracked, []);
    const d = details["開始不明"]!.f!;
    expect(d.races.filter((r) => r.pu === 1).length).toBe(index.athletes["開始不明"]!.f!.packUnchecked);
  });
});

describe("verifyFingerprintDetails: 食い違いを検知する", () => {
  const setup = () => buildLegFingerprintArtifacts(sixRaces("検証選手", [2, 12]), [], { periodCutoff: "2026-04-01" });

  it("正常なら通る（期間比較つきでも）", () => {
    const { index, details } = setup();
    expect(() => verifyFingerprintDetails(index, details)).not.toThrow();
  });

  it("ミス判定を1件書き換えると FingerprintInvariantError", () => {
    const { index, details } = setup();
    const d = details["検証選手"]!.f!;
    const i = d.legs.m.findIndex((m) => m === 0);
    d.legs.m[i] = 1;
    expect(() => verifyFingerprintDetails(index, details)).toThrow(FingerprintInvariantError);
  });

  it("レッグを1本削ると FingerprintInvariantError", () => {
    const { index, details } = setup();
    const d = details["検証選手"]!.f!;
    for (const col of [d.legs.r, d.legs.l, d.legs.c, d.legs.lap, d.legs.loss, d.legs.m]) col.pop();
    expect(() => verifyFingerprintDetails(index, details)).toThrow(FingerprintInvariantError);
  });

  it("局面とセル番号が矛盾すると FingerprintInvariantError", () => {
    const { index, details } = setup();
    const d = details["検証選手"]!.f!;
    const i = d.legs.l.findIndex((l) => l === 0); // 序盤のレッグ
    d.legs.c[i] = 8; // 終盤×長に書き換え（他セルとの入れ替えで件数は崩れても、局面矛盾で必ず落ちる）
    expect(() => verifyFingerprintDetails(index, details)).toThrow(FingerprintInvariantError);
  });

  it("出るべき期間比較が集計から欠けていたら検知する", () => {
    const tracked = [
      ...Array.from({ length: 4 }, (_, r) => mkRace("期間選手", `2026-0${r + 1}-01`, legsWithMisses([2]))),
      ...Array.from({ length: 4 }, (_, r) => mkRace("期間選手", `2024-0${r + 1}-01`, legsWithMisses([2, 12]))),
    ];
    const { index, details } = buildLegFingerprintArtifacts(tracked, [], { periodCutoff: "2025-07-08" });
    expect(index.athletes["期間選手"]!.f!.periods).toBeDefined();
    delete index.athletes["期間選手"]!.f!.periods;
    expect(() => verifyFingerprintDetails(index, details)).toThrow(FingerprintInvariantError);
  });

  it("集計に無い選手の明細や、集計にある選手の明細欠落も検知する", () => {
    const { index, details } = setup();
    const extra = { ...details, 幽霊選手: details["検証選手"] };
    expect(() => verifyFingerprintDetails(index, extra)).toThrow(FingerprintInvariantError);
    const missing = { ...details };
    delete missing["検証選手"];
    expect(() => verifyFingerprintDetails(index, missing)).toThrow(FingerprintInvariantError);
  });
});

describe("verifyDetailsAgainstSource: 元データ（lc_leg_splits の行）との突き合わせ", () => {
  const setup = () => {
    const tracked = sixRaces("出所選手", [2, 12]);
    return { tracked, ...buildLegFingerprintArtifacts(tracked, []) };
  };

  it("正常なら通る", () => {
    const { tracked, details } = setup();
    expect(() => verifyDetailsAgainstSource(details, tracked, [])).not.toThrow();
  });

  it("走者番号を書き換えると検知する（別の出走行を指してしまう）", () => {
    const { tracked, details } = setup();
    details["出所選手"]!.f!.races[0].ri = 99;
    expect(() => verifyDetailsAgainstSource(details, tracked, [])).toThrow(FingerprintInvariantError);
  });

  it("大会名・日付の取り違えを検知する", () => {
    const { tracked, details } = setup();
    details["出所選手"]!.f!.races[1].d = "1999-01-01";
    expect(() => verifyDetailsAgainstSource(details, tracked, [])).toThrow(FingerprintInvariantError);
  });

  it("同じ局面の別レッグへの差し替え（ラップが元データと違う）を検知する", () => {
    const { tracked, details } = setup();
    const d = details["出所選手"]!.f!;
    const i = d.legs.l.findIndex((l, k) => l === 0 && d.legs.r[k] === 0);
    d.legs.l[i] = 1; // 同じ序盤の第1レッグ（ラップ 101 秒台）を指すが lap は第0レッグの値のまま
    expect(() => verifyDetailsAgainstSource(details, tracked, [])).toThrow(FingerprintInvariantError);
  });

  it("レッグ長の区分（短/中/長）の取り違えを検知する", () => {
    const { tracked, details } = setup();
    const d = details["出所選手"]!.f!;
    const i = d.legs.c.findIndex((c) => c === 0); // 序盤×短
    d.legs.c[i] = 2; // 序盤×長（局面は同じ）
    expect(() => verifyDetailsAgainstSource(details, tracked, [])).toThrow(FingerprintInvariantError);
  });

  it("同じ出走行が元データに2行あると、どちらか決められないので検知する", () => {
    const { tracked, details } = setup();
    const dup = { ...tracked[0] };
    expect(() => verifyDetailsAgainstSource(details, [...tracked, dup], [])).toThrow(
      FingerprintInvariantError
    );
  });
});

describe("明細のフィールド中央値（難レッグ判定用・docs/plans/2026-09-30_miss-trend-field-comparison.md）", () => {
  /** 1レース目のクラスに、完走の companion 2人・途中棄権の companion 1人・別の追跡選手 1人を入れる */
  const setup = () => {
    const own = sixRaces("場選手", [2, 12]);
    const race0 = own[0];
    const comp = (ri: number, rank: number | null, loss: (number | null)[]): CompanionRow => ({
      lc_event_id: race0.lc_event_id,
      lc_class_id: 0,
      runner_index: ri,
      start_time: null, // 集団走の判定に関わらせない
      elapsed_sec: race0.elapsed_sec.map(() => null),
      rank,
      leg_loss_sec: loss,
    });
    const L = race0.lap_sec.length;
    const companions = [
      comp(10, 1, Array(L).fill(10)),
      comp(11, 2, [null, ...Array(L - 1).fill(20)]), // 第0レッグだけ値なし
      comp(12, null, Array(L).fill(999)), // 途中棄権は相手にしない
    ];
    const mate = mkRace("同組選手", race0.event_date, legsWithMisses([]), {
      eventId: race0.lc_event_id,
      runnerIndex: 5,
      start: "11:00:00",
    });
    const tracked = [...own, mate];
    return { tracked, companions, ...buildLegFingerprintArtifacts(tracked, companions) };
  };
  const legOf = (d: DisciplineDetail, race: number, leg: number) =>
    d.legs.r.findIndex((r, i) => r === race && d.legs.l[i] === leg);

  it("本人を除く完走者（追跡選手＋companion）の中央値と、レッグ別の人数を持つ", () => {
    const { details } = setup();
    const d = details["場選手"]!.f!;
    const i1 = legOf(d, 0, 1); // 相手 = 10, 20, 同組選手の 2 → 中央値 10・3 人
    expect([d.legs.fm[i1], d.legs.fn[i1]]).toEqual([10, 3]);
    const i0 = legOf(d, 0, 0); // 相手 = 10, 2（20 の人は値なし）→ 中央値 6・2 人
    expect([d.legs.fm[i0], d.legs.fn[i0]]).toEqual([6, 2]);
  });

  it("相手のいないレースは中央値 null・人数 0", () => {
    const { details } = setup();
    const d = details["場選手"]!.f!;
    const i = legOf(d, 1, 1);
    expect([d.legs.fm[i], d.legs.fn[i]]).toEqual([null, 0]);
  });

  it("カードの数字（index）は相手の想定との差に左右されない", () => {
    const { tracked, companions, index } = setup();
    const blank = companions.map((c) => ({ ...c, rank: null, leg_loss_sec: c.leg_loss_sec.map(() => null) }));
    expect(JSON.stringify(buildLegFingerprintArtifacts(tracked, blank).index)).toBe(JSON.stringify(index));
  });

  it("元データ（tracked＋companion）からの再計算と一致すれば通る", () => {
    const { tracked, companions, index, details } = setup();
    expect(() => verifyFingerprintDetails(index, details)).not.toThrow();
    expect(() => verifyDetailsAgainstSource(details, tracked, companions)).not.toThrow();
  });

  it("中央値の書き換え・companion の取りこぼしを検知する", () => {
    const { tracked, companions, details } = setup();
    const d = details["場選手"]!.f!;
    const i = legOf(d, 0, 1);
    expect(() => verifyDetailsAgainstSource(details, tracked, [])).toThrow(FingerprintInvariantError);
    d.legs.fm[i] = 11;
    expect(() => verifyDetailsAgainstSource(details, tracked, companions)).toThrow(FingerprintInvariantError);
  });

  it("人数 0 なのに中央値がある（またはその逆）明細は不変条件違反", () => {
    const { index, details } = setup();
    const d = details["場選手"]!.f!;
    d.legs.fn[legOf(d, 0, 1)] = 0;
    expect(() => verifyFingerprintDetails(index, details)).toThrow(FingerprintInvariantError);
  });
});
