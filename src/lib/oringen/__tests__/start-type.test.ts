import { describe, it, expect } from "vitest";
import { isFreeStart, isChaseStartOnFinalStage, missingStartReason } from "../start-type";

/**
 * 公式（oringen.se/tavling/ol.html）の規定と、実データ（1日目・全189クラスの startTime 充足率が
 * 0% か 100% の二値）の両方に照らしたテスト。
 *
 * 2026-07-15、フリースタートのクラスに「抽選待ち・開催が近づくと埋まります」と表示していた誤りの回帰テスト。
 * 待っても永久に埋まらないものを「待てば埋まる」と言っていた。
 */

describe("isFreeStart — 抽選（false）", () => {
  // 実データで 100% スタート時刻を持っていたクラス
  it.each(["D10", "D13", "D21", "D21 Lång", "H21", "H21 Lång", "H40", "H45", "H55", "H60", "H70", "D70", "H50-1", "H50-2"])(
    "%s は抽選",
    (n) => expect(isFreeStart(n)).toBe(false),
  );

  it("少年の Kort は抽選（公式: Ungdomarnas kortklasser ... har lottad starttid）", () => {
    for (const n of ["D12 Kort", "D14 Kort", "D16 Kort", "H12 Kort", "H14 Kort", "H16 Kort"]) {
      expect(isFreeStart(n), n).toBe(false);
    }
  });

  it("MTBO の年齢クラスは抽選（2026-07-13 に公開済み）", () => {
    for (const n of ["MTBO H21", "MTBO D21", "MTBO H75", "MTBO D12"]) {
      expect(isFreeStart(n), n).toBe(false);
    }
  });
});

describe("isFreeStart — フリースタート（true）", () => {
  it("DH75〜95 はフリースタート（公式: utom DH75-95 som har fri minutstart）", () => {
    for (const n of ["H75", "D75", "H80", "D80", "H85", "D85", "H90"]) {
      expect(isFreeStart(n), n).toBe(true);
    }
  });

  it("H70 は抽選、H75 から フリー（境界）", () => {
    expect(isFreeStart("H70")).toBe(false);
    expect(isFreeStart("H75")).toBe(true);
  });

  it("成人の Kort はフリースタート（公式: Du har fri starttid）", () => {
    for (const n of ["D21 Kort-1", "D21 Kort-2", "H21 Kort-1", "H21 Kort-2", "D40 Kort", "D55 Kort", "H60 Kort", "H70 Kort", "H45 Kort-1", "D17-20 Kort", "H17-20 Kort"]) {
      expect(isFreeStart(n), n).toBe(true);
    }
  });

  it("Motion はフリースタート", () => {
    for (const n of ["D35 Motion", "H21 Motion", "D75 Motion", "H65 Motion"]) {
      expect(isFreeStart(n), n).toBe(true);
    }
  });

  it("Etappstart はフリースタート", () => {
    for (const n of ["Etappstart Blå 3,5", "Etappstart Gul 2,5", "Etappstart Svart 7,5", "Etappstart Orange 3,3", "Etappstart Pre-Elit", "Etappstart Inskolning", "MTBO Etappstart Svår kort"]) {
      expect(isFreeStart(n), n).toBe(true);
    }
  });

  it("開放クラス（色）はフリースタート", () => {
    for (const n of ["Blå 2,5", "Blå 3,5", "Gul 10,0", "Orange 4,0", "Svart 7,5", "Vit 2,5"]) {
      expect(isFreeStart(n), n).toBe(true);
    }
  });

  it("PreO はフリースタート（公式ニュース: fri minutstart för samtliga klasser）", () => {
    for (const n of ["Pre-A", "Pre-B", "Pre-C", "Pre-Elit", "Prova på PreO Pre-A"]) {
      expect(isFreeStart(n), n).toBe(true);
    }
  });

  it("Para-I / Inskolning / 3-dagars はフリースタート", () => {
    for (const n of ["D-Para-I", "H-Para-I", "Inskolning", "3-dagars Svart 7,5"]) {
      expect(isFreeStart(n), n).toBe(true);
    }
  });
});

describe("isChaseStartOnFinalStage — 5日目の追い抜きスタート", () => {
  // 実データ: 5日目に時刻を持つのは D10/D11/D12/H10/H11/H12 とその Kort の12クラスだけ。
  // 公式: 「jaktstart för alla utom DH10–DH12 och Para-I」
  it("DH10〜DH12 は対象外（5日目も抽選で公開済み）", () => {
    for (const n of ["D10", "D11", "D12", "H10", "H11", "H12", "D12 Kort", "H12 Kort"]) {
      expect(isChaseStartOnFinalStage(n), n).toBe(false);
    }
  });

  it("Para-I は対象外", () => {
    expect(isChaseStartOnFinalStage("D-Para-I")).toBe(false);
  });

  it("DH14 以上は追い抜き対象", () => {
    for (const n of ["D14", "H14", "D21", "H40", "H70", "H75"]) {
      expect(isChaseStartOnFinalStage(n), n).toBe(true);
    }
  });

  it("Kort（成人）も5日目は追い抜き（公式: På femte etappen är det jaktstart）", () => {
    for (const n of ["D21 Kort-2", "H60 Kort", "D55 Kort"]) {
      expect(isChaseStartOnFinalStage(n), n).toBe(true);
    }
  });

  it("D14/H14/D16/H16 Kort は追い抜き対象（実データで5日目に時刻あり＝要注意）", () => {
    // 実データでは D14 Kort/H14 Kort/D16 Kort/H16 Kort が5日目に時刻を持つ。
    // 少年 Kort は全日抽選なので、5日目の時刻も先に出ている。
    // isChaseStartOnFinalStage は true を返すが、時刻が既にあるので UI では時刻が優先される。
    expect(isChaseStartOnFinalStage("D14 Kort")).toBe(true);
  });

  it("Etappstart / PreO は総合が無いので追い抜きではない", () => {
    for (const n of ["Etappstart Svart 7,5", "MTBO Etappstart Svår kort", "Pre-Elit", "Inskolning"]) {
      expect(isChaseStartOnFinalStage(n), n).toBe(false);
    }
  });
});

describe("missingStartReason — 時刻が無い理由", () => {
  it("5日目の追い抜きは chase-start（フリーと混同しない）", () => {
    expect(missingStartReason("H60 Kort", 5)).toBe("chase-start");
    expect(missingStartReason("H40", 5)).toBe("chase-start");
  });

  it("1〜4日目の Kort は free-start（永久に入らない）", () => {
    expect(missingStartReason("H60 Kort", 1)).toBe("free-start");
    expect(missingStartReason("H60 Kort", 4)).toBe("free-start");
  });

  it("Etappstart は5日目でも free-start（総合が無いので追い抜きにならない）", () => {
    expect(missingStartReason("Etappstart Svart 7,5", 5)).toBe("free-start");
  });

  it("H75 は1〜4日目 free-start、5日目は chase-start", () => {
    expect(missingStartReason("H75", 1)).toBe("free-start");
    expect(missingStartReason("H75", 5)).toBe("chase-start");
  });

  it("抽選クラスで未公開は unpublished（日本勢では Elit のみ＝該当者なし）", () => {
    expect(missingStartReason("H21 Elit", 1)).toBe("unpublished");
  });
});
