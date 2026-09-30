import { describe, expect, it } from "vitest";
import {
  findLcRunnerForAthlete,
  resolveLegFocusSubject,
} from "../../../app/results/[eventId]/[classId]/LegAnalysisClient";

const eventId = 1;
const classId = 1;

describe("findLcRunnerForAthlete", () => {
  const sameNameRunners = [
    { index: 0, name: "鈴木 健太", club: "金大OLC" },
    { index: 1, name: "鈴木 健太", club: "筑波大学" },
  ];

  it("金大OLC の生氏名を金沢大学側の表示名で特定する", () => {
    expect(
      findLcRunnerForAthlete(
        sameNameRunners,
        "鈴木健太（金沢大学）",
        eventId,
        classId,
      ),
    ).toBe(sameNameRunners[0]);
  });

  it("同姓同名のうち筑波大学側だけを表示名で特定する", () => {
    expect(
      findLcRunnerForAthlete(
        sameNameRunners,
        "鈴木健太（筑波大学）",
        eventId,
        classId,
      ),
    ).toBe(sameNameRunners[1]);
  });

  it("改名対象でない一般選手を従来どおり生氏名で特定する", () => {
    const runners = [{ index: 2, name: "田中 創", club: "大阪OLC" }];

    expect(findLcRunnerForAthlete(runners, "田中創", eventId, classId)).toBe(runners[0]);
  });
});

describe("resolveLegFocusSubject（ミスの傾向の明細から来たときの主役の特定）", () => {
  const runners = [
    { index: 0, name: "田中 創", club: "大阪OLC" },
    { index: 1, name: "山本 花", club: "京大OLC" },
    { index: 2, name: "田中 創", club: "大阪OLC" }, // 同クラスの再走
  ];

  it("走者番号の走者が指定選手なら、その出走行を使う（再走の2本目も選べる）", () => {
    expect(resolveLegFocusSubject(runners, "田中創", 2, eventId, classId)).toEqual({
      runner: runners[2],
      indexMismatch: false,
    });
  });
  it("走者番号の走者が別人なら（LapCenter 側の並びが変わった等）、氏名で特定し直して印を立てる", () => {
    expect(resolveLegFocusSubject(runners, "田中創", 1, eventId, classId)).toEqual({
      runner: runners[0],
      indexMismatch: true,
    });
  });
  it("走者番号が範囲外でも氏名で特定し直して印を立てる", () => {
    expect(resolveLegFocusSubject(runners, "田中創", 9, eventId, classId)).toEqual({
      runner: runners[0],
      indexMismatch: true,
    });
  });
  it("走者番号の指定が無ければ従来どおり氏名で特定する", () => {
    expect(resolveLegFocusSubject(runners, "山本花", null, eventId, classId)).toEqual({
      runner: runners[1],
      indexMismatch: false,
    });
  });
  it("選手の指定が無ければ主役なし", () => {
    expect(resolveLegFocusSubject(runners, null, 1, eventId, classId)).toEqual({
      runner: undefined,
      indexMismatch: false,
    });
  });
});
