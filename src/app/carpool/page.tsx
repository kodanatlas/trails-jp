import type { Metadata } from "next";
import CarpoolIndexClient from "./_components/CarpoolIndexClient";

export const metadata: Metadata = {
  title: "配車割 | trails.jp",
  robots: { index: false, follow: false },
};

export default function CarpoolIndexPage() {
  return <CarpoolIndexClient />;
}
