import { Metadata } from "next";
import fs from "fs";
import path from "path";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";

export const metadata: Metadata = {
  title: "分析システム構成",
  description:
    "trails.jp 分析機能のシステム構成・データソース・処理フローの技術ドキュメント",
};

export default function AnalysisSystemDoc() {
  const md = fs.readFileSync(
    path.join(process.cwd(), "docs/analysis-system.md"),
    "utf-8"
  );

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <MarkdownRenderer content={md} />
    </div>
  );
}
