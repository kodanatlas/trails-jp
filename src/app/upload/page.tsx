import type { Metadata } from "next";
import { AuthGuard } from "@/components/AuthGuard";
import { UploadWizard } from "./UploadWizard";

export const metadata: Metadata = {
  title: "地図をアップロード",
  description: "オリエンテーリング地図をアップロードして共有しましょう。",
};

export default function UploadPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <AuthGuard>
        <UploadWizard />
      </AuthGuard>
    </div>
  );
}
