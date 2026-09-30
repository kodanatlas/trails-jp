/**
 * 長押しの判定と吹き出しの配置（画面に依存しない純粋な部分）。FullText 部品が使う。
 * docs/plans/2026-09-30_fulltext-long-press.md
 */

export interface LongPress {
  /** 指を置いた */
  start(x: number, y: number): void;
  /** 指が動いた（許容量を超えたらスクロールとみなし取り消す） */
  move(x: number, y: number): void;
  /** 指を離した。長押しが発火していたら true＝続くタップ（リンクの移動等）を止める */
  end(): boolean;
  /** 取り消し（スクロール開始・ポインタ取り消し等） */
  cancel(): void;
}

export function createLongPress(opts: {
  delayMs: number;
  moveTolerancePx: number;
  onLongPress: () => void;
}): LongPress {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let origin: { x: number; y: number } | null = null;
  let fired = false;

  const clear = () => {
    if (timer != null) clearTimeout(timer);
    timer = null;
  };

  return {
    start(x, y) {
      clear();
      origin = { x, y };
      fired = false;
      timer = setTimeout(() => {
        timer = null;
        fired = true;
        opts.onLongPress();
      }, opts.delayMs);
    },
    move(x, y) {
      if (!origin || timer == null) return;
      if (Math.hypot(x - origin.x, y - origin.y) > opts.moveTolerancePx) clear();
    },
    end() {
      clear();
      origin = null;
      const wasFired = fired;
      fired = false;
      return wasFired;
    },
    cancel() {
      clear();
      origin = null;
      fired = false;
    },
  };
}

const MARGIN = 8;

/** 吹き出しの位置。基本は対象の上・中央揃え。上に入らなければ下。左右は画面端から MARGIN 空ける */
export function placePopover(
  anchor: { left: number; top: number; width: number; bottom: number },
  pop: { width: number; height: number },
  viewport: { width: number; height: number }
): { left: number; top: number; placement: "above" | "below" } {
  const center = anchor.left + anchor.width / 2;
  const maxLeft = Math.max(MARGIN, viewport.width - pop.width - MARGIN);
  const left = Math.min(Math.max(center - pop.width / 2, MARGIN), maxLeft);
  const above = anchor.top - pop.height - MARGIN;
  if (above >= MARGIN) return { left, top: above, placement: "above" };
  return { left, top: anchor.bottom + MARGIN, placement: "below" };
}
