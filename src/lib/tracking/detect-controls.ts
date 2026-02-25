/**
 * O-map画像からコントロール円（紫/マゼンタ）を自動検出
 *
 * IOF標準: コントロールは紫色の円で描画される
 * 検出手順:
 *   1. Canvas に画像を描画
 *   2. 紫/マゼンタ色のピクセルを検出 (HSL色空間)
 *   3. 検出ピクセルをクラスタリング
 *   4. クラスタのサイズと形状（円形度）でフィルタリング
 *   5. 中心座標を返す
 */

export interface DetectedControl {
  /** ピクセル座標 (画像左上が原点) */
  px: number;
  py: number;
  /** 検出円の半径 (ピクセル) */
  radius: number;
  /** 信頼度 0-1 */
  confidence: number;
}

export interface ImageBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

/**
 * 検出されたピクセル座標を地理座標に変換
 */
export function pixelToGeo(
  px: number,
  py: number,
  imgWidth: number,
  imgHeight: number,
  bounds: ImageBounds
): { lat: number; lng: number } {
  const xRatio = px / imgWidth;
  const yRatio = py / imgHeight;
  return {
    lng: bounds.west + xRatio * (bounds.east - bounds.west),
    lat: bounds.north - yRatio * (bounds.north - bounds.south),
  };
}

/**
 * RGB → HSL 変換
 */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;

  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return [h * 360, s, l];
}

/**
 * ピクセルが紫/マゼンタ色かどうか判定
 * O-map のコントロール色は IOF 紫 (C100 M100 相当)
 * 印刷/スキャン品質により幅広い範囲をカバー
 */
function isPurplePixel(r: number, g: number, b: number): boolean {
  const [h, s, l] = rgbToHsl(r, g, b);

  // 紫～マゼンタ色相: 260°-340°
  const hueMatch = h >= 260 && h <= 340;
  // 十分な彩度 (灰色を除外)
  const satMatch = s >= 0.2;
  // 明度: 暗すぎず明るすぎず
  const lumMatch = l >= 0.15 && l <= 0.85;
  // 赤と青が緑より強い (紫の特徴)
  const channelMatch = r > g * 0.8 && b > g * 0.8;

  return hueMatch && satMatch && lumMatch && channelMatch;
}

/**
 * シンプルなグリッドベースクラスタリング
 */
function clusterPixels(
  mask: Uint8Array,
  width: number,
  height: number,
  cellSize: number
): { cx: number; cy: number; count: number }[] {
  const cols = Math.ceil(width / cellSize);
  const rows = Math.ceil(height / cellSize);
  const grid = new Float64Array(cols * rows * 3); // sumX, sumY, count

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!mask[y * width + x]) continue;
      const col = Math.floor(x / cellSize);
      const row = Math.floor(y / cellSize);
      const idx = (row * cols + col) * 3;
      grid[idx] += x;
      grid[idx + 1] += y;
      grid[idx + 2] += 1;
    }
  }

  const clusters: { cx: number; cy: number; count: number }[] = [];
  for (let i = 0; i < grid.length; i += 3) {
    if (grid[i + 2] > 0) {
      clusters.push({
        cx: grid[i] / grid[i + 2],
        cy: grid[i + 1] / grid[i + 2],
        count: grid[i + 2],
      });
    }
  }
  return clusters;
}

/**
 * 近接クラスタを統合
 */
function mergeClusters(
  clusters: { cx: number; cy: number; count: number }[],
  mergeRadius: number
): { cx: number; cy: number; count: number }[] {
  const merged: { cx: number; cy: number; count: number }[] = [];
  const used = new Set<number>();

  for (let i = 0; i < clusters.length; i++) {
    if (used.has(i)) continue;
    let sumX = clusters[i].cx * clusters[i].count;
    let sumY = clusters[i].cy * clusters[i].count;
    let totalCount = clusters[i].count;
    used.add(i);

    for (let j = i + 1; j < clusters.length; j++) {
      if (used.has(j)) continue;
      const dx = clusters[i].cx - clusters[j].cx;
      const dy = clusters[i].cy - clusters[j].cy;
      if (Math.sqrt(dx * dx + dy * dy) < mergeRadius) {
        sumX += clusters[j].cx * clusters[j].count;
        sumY += clusters[j].cy * clusters[j].count;
        totalCount += clusters[j].count;
        used.add(j);
      }
    }

    merged.push({
      cx: sumX / totalCount,
      cy: sumY / totalCount,
      count: totalCount,
    });
  }
  return merged;
}

/**
 * O-map画像からコントロール円を検出
 */
export function detectControls(
  imageData: ImageData,
  minRadius: number = 8,
  maxRadius: number = 60
): DetectedControl[] {
  const { width, height, data } = imageData;

  // 1. 紫ピクセルのマスクを作成
  const mask = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i += 4) {
    const pixIdx = i / 4;
    if (isPurplePixel(data[i], data[i + 1], data[i + 2])) {
      mask[pixIdx] = 1;
    }
  }

  // 2. グリッドクラスタリング (セルサイズはminRadiusに基づく)
  const cellSize = Math.max(4, Math.floor(minRadius / 2));
  const rawClusters = clusterPixels(mask, width, height, cellSize);

  // 3. 近接クラスタを統合
  const mergeRadius = maxRadius * 1.5;
  const merged = mergeClusters(rawClusters, mergeRadius);

  // 4. 各クラスタの形状を分析してコントロール円をフィルタ
  const controls: DetectedControl[] = [];

  for (const cluster of merged) {
    // 最小ピクセル数のフィルタ (円弧の一部分を検出)
    // コントロール円の円周上のピクセルを検出するので、
    // 最小で円周の1/4程度 (紫ピクセルは円弧上にのみ存在)
    const minPixels = minRadius * 1.5;
    if (cluster.count < minPixels) continue;

    // クラスタ内のピクセル分布から半径を推定
    // 中心からの平均距離を計算
    const cx = cluster.cx;
    const cy = cluster.cy;
    let sumDist = 0;
    let distCount = 0;
    let maxDist = 0;

    const searchR = maxRadius * 2;
    const x0 = Math.max(0, Math.floor(cx - searchR));
    const x1 = Math.min(width - 1, Math.ceil(cx + searchR));
    const y0 = Math.max(0, Math.floor(cy - searchR));
    const y1 = Math.min(height - 1, Math.ceil(cy + searchR));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!mask[y * width + x]) continue;
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < mergeRadius) {
          sumDist += dist;
          distCount++;
          if (dist > maxDist) maxDist = dist;
        }
      }
    }

    if (distCount === 0) continue;
    const avgDist = sumDist / distCount;

    // 半径が範囲内かチェック
    if (avgDist < minRadius || avgDist > maxRadius) continue;

    // 円形度の判定: ピクセルが中心から均等に分布しているか
    // 標準偏差が小さいほど円形
    let sumSqDiff = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!mask[y * width + x]) continue;
        const dx = x - cx;
        const dy = y - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < mergeRadius) {
          sumSqDiff += (dist - avgDist) ** 2;
        }
      }
    }
    const stdDev = Math.sqrt(sumSqDiff / distCount);
    const circularity = 1 - stdDev / avgDist; // 1に近いほど円形

    // 円形度が低いものは除外 (線分やテキストなど)
    if (circularity < 0.4) continue;

    const confidence = Math.min(1, circularity * (distCount / (avgDist * 4)));

    controls.push({
      px: Math.round(cx),
      py: Math.round(cy),
      radius: Math.round(avgDist),
      confidence,
    });
  }

  // 信頼度でソート (高い順)
  controls.sort((a, b) => b.confidence - a.confidence);

  return controls;
}
