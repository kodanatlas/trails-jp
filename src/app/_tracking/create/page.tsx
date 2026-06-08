import type { Metadata } from "next";
import { CreateEventForm } from "./CreateEventForm";

export const metadata: Metadata = {
  title: "イベント作成 - GPS追跡",
  description: "ライブGPS追跡イベントを作成",
};

export default function CreateEventPage() {
  return <CreateEventForm />;
}
