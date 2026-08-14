"use client";
import Workspace from "./Workspace.tsx";
import type { Payload } from "./ArticlePane.tsx";

/**
 * Thin wrapper: the note route seeds the workspace with one payload.
 *
 * `/workspace` monta el mismo componente con `initial` en null y la pestaña a
 * abrir en `seed`: es el mismo workspace, sin nota de la que colgar.
 */
export default function ArticleClient({ initial, seed }: {
  initial: Payload | null;
  seed?: { id: string; title: string } | null;
}) {
  return <Workspace initial={initial} seed={seed} />;
}
