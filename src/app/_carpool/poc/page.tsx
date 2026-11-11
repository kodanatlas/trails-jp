import type { Metadata } from "next";
import PocClient from "./PocClient";

export const metadata: Metadata = {
  title: "配車割 MILP PoC (C-2)",
  description: "highs-js (WASM MILP) をブラウザ内 Web Worker で実行する検証ページ",
  robots: { index: false, follow: false },
};

export default function CarpoolPocPage() {
  return <PocClient />;
}
