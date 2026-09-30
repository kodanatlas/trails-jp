import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLongPress, placePopover } from "../long-press";

// 省略された文字を長押しで吹き出し表示する（FullText 部品）の、画面に依存しない判定

describe("createLongPress", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const onLongPress = vi.fn();
    const lp = createLongPress({ delayMs: 450, moveTolerancePx: 10, onLongPress });
    return { lp, onLongPress };
  };

  it("押し続けて 450ms で発火し、離したとき true（続くタップ＝ページ移動を止める印）", () => {
    const { lp, onLongPress } = setup();
    lp.start(100, 100);
    vi.advanceTimersByTime(449);
    expect(onLongPress).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);
    expect(lp.end()).toBe(true);
  });

  it("短いタップは発火せず、離したとき false（リンクは通常どおり移動）", () => {
    const { lp, onLongPress } = setup();
    lp.start(100, 100);
    vi.advanceTimersByTime(200);
    expect(lp.end()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
  });

  it("指が許容量より動いたら（スクロール）取り消す", () => {
    const { lp, onLongPress } = setup();
    lp.start(100, 100);
    lp.move(100, 105); // 許容内
    lp.move(100, 115); // 許容超え
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
    expect(lp.end()).toBe(false);
  });

  it("cancel で取り消せる・次の押下は新しく数え直す", () => {
    const { lp, onLongPress } = setup();
    lp.start(0, 0);
    lp.cancel();
    vi.advanceTimersByTime(1000);
    expect(onLongPress).not.toHaveBeenCalled();
    lp.start(0, 0);
    vi.advanceTimersByTime(450);
    expect(onLongPress).toHaveBeenCalledTimes(1);
  });
});

describe("placePopover", () => {
  const viewport = { width: 390, height: 844 };
  const pop = { width: 200, height: 60 };

  it("基本は文字の上に、文字の中央に合わせて出す", () => {
    const p = placePopover({ left: 100, top: 300, width: 100, bottom: 320 }, pop, viewport);
    expect(p.placement).toBe("above");
    expect(p.top).toBe(300 - 60 - 8);
    expect(p.left).toBe(150 - 100);
  });

  it("上に入らなければ下に出す", () => {
    const p = placePopover({ left: 100, top: 30, width: 100, bottom: 50 }, pop, viewport);
    expect(p.placement).toBe("below");
    expect(p.top).toBe(50 + 8);
  });

  it("画面の左右からはみ出さない（端から 8px 空ける）", () => {
    expect(placePopover({ left: 0, top: 300, width: 40, bottom: 320 }, pop, viewport).left).toBe(8);
    expect(placePopover({ left: 360, top: 300, width: 30, bottom: 320 }, pop, viewport).left).toBe(390 - 200 - 8);
  });
});
