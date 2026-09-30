"use client";

import { useCallback, useEffect, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FULLTEXT_ON_LONG_PRESS } from "@/lib/ui-flags";
import { createLongPress, placePopover, type LongPress } from "@/lib/ui/long-press";

/**
 * 省略表示（truncate）される文字の要素。長押しで吹き出しに全文を出す（PC はマウスを乗せると全文ツールチップ）。
 * 実際に省略されているときだけ反応する。リンク内で長押ししたときはページ移動しない。
 * FULLTEXT_ON_LONG_PRESS=false なら従来どおりの要素をそのまま描くだけ（戻せるように）。
 * docs/plans/2026-09-30_fulltext-long-press.md
 */

type Tag = "span" | "p" | "div";

interface Props {
  as?: Tag;
  className?: string;
  children: ReactNode;
}

export function FullText({ as = "span", className, children }: Props) {
  if (!FULLTEXT_ON_LONG_PRESS) {
    const Plain = as;
    return <Plain className={className}>{children}</Plain>;
  }
  return (
    <FullTextActive as={as} className={className}>
      {children}
    </FullTextActive>
  );
}

const LONG_PRESS_MS = 450;
const MOVE_TOLERANCE_PX = 10;
const INTERACTIVE = "a, button, [role='button'], label, summary, select, input, textarea";

const isTruncated = (el: HTMLElement) => el.scrollWidth > el.clientWidth + 1;

function FullTextActive({ as: Element, className, children }: Required<Pick<Props, "as">> & Props) {
  const ref = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState<{ text: string; anchor: DOMRect } | null>(null);
  const suppressClick = useRef(false);
  const lastPointer = useRef<string>("mouse");

  const show = useCallback(() => {
    const el = ref.current;
    if (!el || !isTruncated(el)) return;
    setOpen({ text: el.textContent ?? "", anchor: el.getBoundingClientRect() });
  }, []);
  // 長押し判定は部品ごとに1つ。描画中に ref を触らないよう、マウント後に作ってイベントからだけ使う
  const longPressRef = useRef<LongPress | null>(null);
  useEffect(() => {
    const lp = createLongPress({ delayMs: LONG_PRESS_MS, moveTolerancePx: MOVE_TOLERANCE_PX, onLongPress: show });
    longPressRef.current = lp;
    return () => lp.cancel();
  }, [show]);

  // 吹き出しは、ほかの場所のタップ・スクロール・画面サイズ変更で閉じる
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    document.addEventListener("pointerdown", close, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    lastPointer.current = e.pointerType;
    if (e.pointerType === "mouse" || !ref.current || !isTruncated(ref.current)) return;
    longPressRef.current?.start(e.clientX, e.clientY);
  };
  // 捕捉フェーズで止める: この要素の内側にリンクがある場合も、外側がリンクの場合も、リンクの onClick より先に走る
  const onClickCapture = (e: MouseEvent<HTMLElement>) => {
    if (!suppressClick.current) return;
    // 長押しの後のタップ＝リンクの移動・ボタンの動作を止める（Next の Link は defaultPrevented を見て移動しない）
    suppressClick.current = false;
    e.preventDefault();
    e.stopPropagation();
  };
  const onClick = () => {
    // リンク・ボタンでない文字は、タッチの普通のタップでも全文を出す
    const el = ref.current;
    if (lastPointer.current !== "mouse" && el && !el.closest(INTERACTIVE)) show();
  };
  const onMouseEnter = () => {
    const el = ref.current;
    if (!el) return;
    if (isTruncated(el)) el.title = el.textContent ?? "";
    else el.removeAttribute("title");
  };

  return (
    <>
      <Element
        ref={(node: HTMLElement | null) => {
          ref.current = node;
        }}
        // 長押しで文字選択が始まらないようにする（タッチ端末のみ。PC では選択・コピーできるまま）
        className={`${className ?? ""} [@media(hover:none)]:select-none`}
        style={{ WebkitTouchCallout: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={(e: PointerEvent<HTMLElement>) => longPressRef.current?.move(e.clientX, e.clientY)}
        onPointerUp={() => {
          suppressClick.current = longPressRef.current?.end() ?? false;
        }}
        onPointerCancel={() => longPressRef.current?.cancel()}
        onContextMenu={(e: MouseEvent<HTMLElement>) => {
          // Android の長押しメニュー（リンクのコピー等）を、省略された文字の上では出さない
          if (lastPointer.current !== "mouse" && ref.current && isTruncated(ref.current)) e.preventDefault();
        }}
        onClickCapture={onClickCapture}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
      >
        {children}
      </Element>
      {open && createPortal(<Popover text={open.text} anchor={open.anchor} />, document.body)}
    </>
  );
}

function Popover({ text, anchor }: { text: string; anchor: DOMRect }) {
  return (
    <div
      role="tooltip"
      // 大きさが決まってから位置を直接置く（描画ごとの state 更新を避ける）
      ref={(node) => {
        if (!node) return;
        const p = placePopover(
          anchor,
          { width: node.offsetWidth, height: node.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight },
        );
        node.style.left = `${p.left}px`;
        node.style.top = `${p.top}px`;
        node.style.visibility = "visible";
      }}
      style={{ position: "fixed", left: 0, top: 0, visibility: "hidden", maxWidth: "min(90vw, 360px)" }}
      className="z-[100] rounded-lg border border-border bg-card px-3 py-2 text-xs leading-relaxed text-foreground shadow-xl"
    >
      {text}
    </div>
  );
}
