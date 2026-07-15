import { describe, it, expect } from "vitest";
import { difficultyOf, type DifficultyLevel } from "../difficulty";
import programJson from "@/data/oringen-program.json";

const LEVELS = programJson.difficultyLevels as DifficultyLevel[];

describe("difficultyOf", () => {
  it.each([
    ["Blå 3,5", "Blå"],
    ["Blå 2,5", "Blå"],
    ["Gul 10,0", "Gul"],
    ["Svart 7,5", "Svart"],
    ["Vit 2,5", "Vit"],
    ["Orange 4,0", "Orange"],
  ])("開放クラス %s -> %s", (cls, sv) => {
    expect(difficultyOf(cls, LEVELS)?.sv).toBe(sv);
  });

  it.each([
    ["Etappstart Gul 2,5", "Gul"],
    ["Etappstart Blå 3,5", "Blå"],
    ["Etappstart Svart 7,5", "Svart"],
    ["Etappstart Orange 3,3", "Orange"],
    ["3-dagars Svart 7,5", "Svart"],
  ])("接頭辞つき %s -> %s", (cls, sv) => {
    expect(difficultyOf(cls, LEVELS)?.sv).toBe(sv);
  });

  it("年齢クラスには色が無い", () => {
    for (const n of ["H40", "D21 Lång", "H60 Kort", "D35 Motion", "H75", "Pre-Elit"]) {
      expect(difficultyOf(n, LEVELS), n).toBeNull();
    }
  });

  it("MTBO の難易度語（Svår/Lätt）は色ではない", () => {
    // MTBO は色でなく Svår/Lätt/Mycket lätt で難易度を表す。色として拾わないこと。
    expect(difficultyOf("MTBO Etappstart Svår kort", LEVELS)).toBeNull();
    expect(difficultyOf("MTBO Etappstart Lätt lång", LEVELS)).toBeNull();
  });

  it("色を返すとき hex と日本語も伴う（UI が色見本を出せる）", () => {
    const d = difficultyOf("Blå 3,5", LEVELS);
    expect(d?.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    expect(d?.ja).toBe("青");
    expect(d?.level).toBe("難");
  });

  it("実データの日本勢クラスで色が付くもの/付かないもの", () => {
    expect(difficultyOf("Etappstart Orange 4,0", LEVELS)?.ja).toBe("橙");
    expect(difficultyOf("Etappstart Gul 3,5", LEVELS)?.ja).toBe("黄");
    expect(difficultyOf("H21 Kort-2", LEVELS)).toBeNull();
  });
});
