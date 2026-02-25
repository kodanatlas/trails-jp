"use client";

import { useState } from "react";
import { Pencil } from "lucide-react";
import type { OrienteeringMap } from "@/types/map";
import { MapEditor } from "./MapEditor";

interface Props {
  map: OrienteeringMap;
}

export function EditButton({ map }: Props) {
  const [editing, setEditing] = useState(false);

  return (
    <>
      <button
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-primary/30 hover:text-primary"
      >
        <Pencil className="h-3.5 w-3.5" />
        編集
      </button>
      {editing && <MapEditor map={map} onClose={() => setEditing(false)} />}
    </>
  );
}
