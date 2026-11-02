/**
 * 一時的な通信失敗（undici の "fetch failed" 等）に備え、throw した処理を少し待って取り直す。
 * 全試行が失敗したら最後のエラーを throw する（呼び出し側でイベント単位に隔離する前提）。
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 2;
  const delayMs = opts.delayMs ?? 1000;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastError;
}
