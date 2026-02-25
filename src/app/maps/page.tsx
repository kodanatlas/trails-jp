import { sampleMaps } from "@/lib/sample-data";
import { MapBrowser } from "./MapBrowser";

export const metadata = {
  title: "地図ライブラリ | trails.jp",
  description: "全国のオリエンテーリング地図を地図上で検索・閲覧。",
};

export default function MapsPage() {
  return <MapBrowser maps={sampleMaps} />;
}
