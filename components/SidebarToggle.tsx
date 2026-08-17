"use client";
import { useEffect, useState } from "react";
import { useT } from "./I18n";

export default function SidebarToggle() {
  const t = useT();
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(localStorage.getItem("wiki.sidecollapsed") === "1");
  }, []);

  return (
    <button
      type="button"
      className="tab-side-toggle"
      title={t("chrome.toggleSidebar")}
      aria-label={t("chrome.toggleSidebar")}
      aria-expanded={!collapsed}
      onClick={() => {
        const next = !collapsed;
        const width = `${localStorage.getItem("wiki.sidew") || 195}px`;
        document.documentElement.style.setProperty("--sidew", next ? "0px" : width);
        if (next) document.documentElement.dataset.side = "collapsed";
        else delete document.documentElement.dataset.side;
        localStorage.setItem("wiki.sidecollapsed", next ? "1" : "0");
        setCollapsed(next);
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3.5" y="4" width="17" height="16" rx="2" />
        <path d="M9 4v16" />
        {collapsed ? <path d="m13 9 3 3-3 3" /> : <path d="m16 9-3 3 3 3" />}
      </svg>
    </button>
  );
}
