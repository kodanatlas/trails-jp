import { describe, expect, it } from "vitest";
import { findLcRunnerForAthlete } from "../../../app/results/[eventId]/[classId]/LegAnalysisClient";

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
