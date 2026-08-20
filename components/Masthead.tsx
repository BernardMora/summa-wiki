"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import AgentMenu from "./AgentMenu.tsx";
import { useT } from "./I18n";
import { openInWorkspace, newTermId } from "./Tabs.tsx";

interface Hit { id: string; title: string; path: string; type: string; bundle: string; }

export default function Masthead({ name, tagline }: { name: string; tagline: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const t = useT();

  useEffect(() => {
    const value = localStorage.getItem("wiki.masthead") === "0";
    setHidden(value);
    document.body.classList.toggle("masthead-hidden", value);
    return () => document.body.classList.remove("masthead-hidden");
  }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setHits([]); return; }
    const t = setTimeout(async () => {
      const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=12`);
      setHits((await r.json()).hits ?? []);
      setOpen(true);
    }, 130);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  const setMastheadHidden = (value: boolean) => {
    setHidden(value);
    document.body.classList.toggle("masthead-hidden", value);
    localStorage.setItem("wiki.masthead", value ? "0" : "1");
  };

  return (
    <>
    <header className={`masthead${hidden ? " hidden" : ""}`}>
      <Link href="/" className="wordmark">
        <span className="name">{name}</span>
        {tagline && <span className="tag">{tagline}</span>}
      </Link>

      <div className="masthead-actions">
        <AgentMenu />
        <button
          className="themebtn terminal-icon-btn"
          data-tour="new-terminal"
          title={t("masthead.newTerminal")}
          aria-label={t("masthead.newTerminal")}
          onClick={() => openInWorkspace(newTermId(), "Terminal", true)}
        >
          <svg viewBox="0 0 18 18" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="1.8" y="2.4" width="14.4" height="13.2" rx="1.8"/><path d="m4.7 6.2 2.4 2.1-2.4 2.1M9.2 11.1h3.7"/></svg>
        </button>
      </div>

      <div className="searchwrap" ref={box}>
        <form
          onSubmit={(e) => { e.preventDefault(); if (q.trim()) router.push(`/search?q=${encodeURIComponent(q)}`); }}
        >
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => hits.length && setOpen(true)}
            placeholder={t("masthead.searchPlaceholder")}
            aria-label={t("masthead.searchLabel")}
          />
          <button type="submit">{t("masthead.searchLabel")}</button>
        </form>
        {open && hits.length > 0 && (
          <div className="suggest">
            {hits.map((h) => (
              <Link key={h.id} href={`/note/${encodeURIComponent(h.id)}`} onClick={() => setOpen(false)}>
                {h.title}
                <small>{h.bundle} · {h.type} · {h.path}</small>
              </Link>
            ))}
          </div>
        )}
      </div>

      <button className="masthead-hide" title={t("masthead.hide")} aria-label={t("masthead.hide")} onClick={() => setMastheadHidden(true)}>⌃</button>
    </header>
    {hidden && <button className="masthead-restore" title={t("masthead.show")} aria-label={t("masthead.show")} onClick={() => setMastheadHidden(false)}>⌄</button>}
    </>
  );
}
