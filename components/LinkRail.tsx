"use client";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useCollator, useT } from "./I18n";
import type { Ref } from "./ArticlePane.tsx";

const STORAGE_KEY = "wiki.linkRail";

function uniqueSorted(refs: Ref[], collator: Intl.Collator): Ref[] {
  const unique = new Map<string, Ref>();
  for (const ref of refs) unique.set(ref.id, ref);
  return [...unique.values()].sort((a, b) => collator.compare(a.title, b.title));
}

/**
 * Local neighbourhood of the open note. Direction stays explicit: outgoing
 * notes are targets of this note, while backlinks are notes that point here.
 */
export default function LinkRail({
  outbound,
  backlinks,
  onOpen,
}: {
  outbound: Ref[];
  backlinks: Ref[];
  onOpen: (ref: Ref, newTab: boolean) => void;
}) {
  const t = useT();
  const collator = useCollator();
  const [open, setOpen] = useState(true);
  const targets = useMemo(() => uniqueSorted(outbound, collator), [outbound, collator]);
  const sources = useMemo(() => uniqueSorted(backlinks, collator), [backlinks, collator]);

  useEffect(() => {
    if (localStorage.getItem(STORAGE_KEY) === "0") setOpen(false);
  }, []);

  function follow(event: MouseEvent<HTMLAnchorElement>, ref: Ref) {
    event.preventDefault();
    onOpen(ref, event.metaKey || event.ctrlKey);
  }

  function branch(label: string, refs: Ref[]) {
    return (
      <section className="linkbranch">
        <h3>{label}</h3>
        {refs.length > 0 ? (
          <ul>
            {refs.map((ref) => (
              <li key={ref.id}>
                <a
                  href={`/note/${encodeURIComponent(ref.id)}`}
                  title={`${ref.title}\n${ref.path}`}
                  onClick={(event) => follow(event, ref)}
                  onAuxClick={(event) => {
                    if (event.button !== 1) return;
                    event.preventDefault();
                    onOpen(ref, true);
                  }}
                >
                  {ref.title}
                </a>
              </li>
            ))}
          </ul>
        ) : <p>{t("pane.none")}</p>}
      </section>
    );
  }

  return (
    <aside className={`linkrail${open ? "" : " closed"}`} aria-label={t("chrome.connections")}>
      <button
        className="linkrailtoggle"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => {
          const next = !value;
          localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
          return next;
        })}
        title={t("chrome.connections")}
      >
        {open ? `‹ ${t("chrome.connections")}` : "›"}
      </button>
      {open && (
        <nav>
          {branch(t("pane.outbound", { n: targets.length }), targets)}
          {branch(t("pane.inbound", { n: sources.length }), sources)}
        </nav>
      )}
    </aside>
  );
}
