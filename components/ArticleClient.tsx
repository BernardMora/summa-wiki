"use client";
import Workspace from "./Workspace.tsx";
import type { Payload } from "./ArticlePane.tsx";

/** Thin wrapper: the note route seeds the workspace with one payload. */
export default function ArticleClient({ initial }: { initial: Payload }) {
  return <Workspace initial={initial} />;
}
