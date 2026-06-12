"use client";

import { useCallback, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type ToastType = "success" | "error";

interface ToastState {
  id: number;
  message: string;
  type: ToastType;
}

export interface UseToastResult {
  toast: (message: string, type?: ToastType) => void;
  toastEl: ReactNode;
}

/**
 * 画面上部に 3 秒で自動消滅する簡易トースト。
 * `const { toast, toastEl } = useToast();` で取得し、`toastEl` を JSX に置く。
 */
export function useToast(): UseToastResult {
  const [current, setCurrent] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const counterRef = useRef(0);

  const toast = useCallback((message: string, type: ToastType = "success") => {
    counterRef.current += 1;
    const id = counterRef.current;
    setCurrent({ id, message, type });
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setCurrent((prev) => (prev && prev.id === id ? null : prev));
    }, 3000);
  }, []);

  const toastEl: ReactNode = current ? (
    <div
      className="pointer-events-none fixed inset-x-0 top-3 z-[100] flex justify-center px-4"
      role="status"
      aria-live="polite"
    >
      <div
        className={cn(
          "pointer-events-auto max-w-sm rounded-lg px-4 py-2 text-sm font-medium shadow-2xl",
          current.type === "success"
            ? "bg-green-500/90 text-white"
            : "bg-red-500/90 text-white",
        )}
      >
        {current.message}
      </div>
    </div>
  ) : null;

  return { toast, toastEl };
}
