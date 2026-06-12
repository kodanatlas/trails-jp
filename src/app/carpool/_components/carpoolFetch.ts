"use client";

/**
 * /api/carpool/... へのフェッチ薄ラッパ。
 * - 成功時はパース済み JSON を返す。
 * - 失敗時は API の { error: string }（日本語）を message に持つ Error を throw。
 * - 429 は専用メッセージに差し替える。
 */

const API_PREFIX = "/api/carpool";

const RATE_LIMIT_MESSAGE =
  "アクセスが集中しています。しばらく待ってから再試行してください。";

/** path に /api/carpool を前置（既に絶対パスならそのまま）。 */
export function buildUrl(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  if (path.startsWith(API_PREFIX)) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${API_PREFIX}${normalized}`;
}

function isErrorEnvelope(value: unknown): value is { error: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
  );
}

export async function fetchCarpool<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(buildUrl(path), {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options?.headers ?? {}),
    },
  });

  if (res.status === 429) {
    throw new Error(RATE_LIMIT_MESSAGE);
  }

  let parsed: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!res.ok) {
    if (isErrorEnvelope(parsed)) {
      throw new Error(parsed.error);
    }
    throw new Error(`通信に失敗しました（${res.status}）`);
  }

  return parsed as T;
}

function jsonBody(body: unknown): RequestInit {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function postCarpool<T>(path: string, body: unknown): Promise<T> {
  return fetchCarpool<T>(path, { method: "POST", ...jsonBody(body) });
}

export async function patchCarpool<T>(path: string, body: unknown): Promise<T> {
  return fetchCarpool<T>(path, { method: "PATCH", ...jsonBody(body) });
}

export async function putCarpool<T>(path: string, body: unknown): Promise<T> {
  return fetchCarpool<T>(path, { method: "PUT", ...jsonBody(body) });
}
