/**
 * maplibre-gl の読み込み口。地図を使う画面はここから読み込む。
 *
 * maplibre-gl 6 は ESM 配布になり、タイル処理用の worker を「本体と同じ場所にある別ファイル」として
 * 読みに行く。バンドル後はその場所にファイルが無く "Worker failed to load" になるため、
 * worker ファイルをバンドラに静的アセットとして出力させ、その URL を明示する。
 */
export async function loadMaplibre() {
  const mod = await import("maplibre-gl");
  if (!mod.getWorkerUrl()) {
    mod.setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);
  }
  return mod;
}
