"use client";
import { redo, undo } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import type { ReactNode } from "react";
import { clearInlineFormatting, indentLines, insertTable, insertText, selectionWrapped, setLinePrefix, setSemanticStyle, toggleHtml, toggleList, toggleWrap } from "./editorCommands.ts";
import { useT } from "./I18n";

export default function EditorToolbar({ view, onImage, onVideo, revision, showNavigation, showFrontmatter, rawMarkdown, hasSelection, hideAuthorship, onToggleNavigation, onToggleFrontmatter, onToggleMarkdown, onMarkHuman, onMarkAi, onUnmark, onToggleAuthorship, onHide }: {
  view: EditorView | null;
  onImage: () => void;
  onVideo: () => void;
  revision: number;
  showNavigation: boolean;
  showFrontmatter: boolean;
  rawMarkdown: boolean;
  hasSelection: boolean;
  hideAuthorship: boolean;
  onToggleNavigation: () => void;
  onToggleFrontmatter: () => void;
  onToggleMarkdown: () => void;
  onMarkHuman: () => void;
  onMarkAi: () => void;
  onUnmark: () => void;
  onToggleAuthorship: () => void;
  onHide: () => void;
}) {
  const t = useT();
  void revision;
  const run = (fn: (v: EditorView) => unknown) => { if (view) fn(view); };
  const button = (label: string, content: ReactNode, fn: (v: EditorView) => unknown, active = false) => (
    <button type="button" title={label} data-tooltip={label} aria-label={label} aria-pressed={active} className={active ? "on" : ""}
      disabled={!view} onMouseDown={(e) => e.preventDefault()} onClick={() => run(fn)}>{content}</button>
  );
  const selected = view?.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to) ?? "";

  return (
    <div className="editor-toolbar" role="toolbar" aria-label={t("editor.toolbar")} data-tour="editor-toolbar">
      <div className="editor-toolgroup">
        {button(t("editor.heading1"), "H1", (v) => setLinePrefix(v, "# "))}
        {button(t("editor.heading2"), "H2", (v) => setLinePrefix(v, "## "))}
        {button(t("editor.heading3"), "H3", (v) => setLinePrefix(v, "### "))}
      </div>
      <div className="editor-toolgroup">
        {button(t("editor.bold"), "B", (v) => toggleWrap(v, "**"), !!view && selectionWrapped(view, "**"))}
        {button(t("editor.italic"), "I", (v) => toggleWrap(v, "*"), !!view && selectionWrapped(view, "*"))}
        {button(t("editor.underline"), <span style={{ textDecoration: "underline" }}>U</span>, (v) => toggleHtml(v, "<u>", "</u>"))}
        {button(t("editor.strike"), "S", (v) => toggleWrap(v, "~~"), !!view && selectionWrapped(view, "~~"))}
        {button(t("editor.code"), "</>", (v) => toggleWrap(v, "`"), !!view && selectionWrapped(view, "`"))}
        {button(t("editor.superscript"), <span>x<sup>2</sup></span>, (v) => toggleHtml(v, "<sup>", "</sup>"))}
        {button(t("editor.subscript"), <span>x<sub>2</sub></span>, (v) => toggleHtml(v, "<sub>", "</sub>"))}
        {button(t("editor.quote"), "❯", (v) => setLinePrefix(v, "> "))}
      </div>
      <div className="editor-toolgroup">
        {button(t("editor.bullets"), <ToolbarIcon kind="bullets" />, (v) => toggleList(v, "bullet"))}
        {button(t("editor.numbered"), <ToolbarIcon kind="numbered" />, (v) => toggleList(v, "number"))}
        {button(t("editor.tasks"), <ToolbarIcon kind="tasks" />, (v) => toggleList(v, "task"))}
        {button(t("editor.outdent"), "←", (v) => indentLines(v, true))}
        {button(t("editor.indent"), "→", (v) => indentLines(v))}
      </div>
      <div className="editor-toolgroup">
        <label className="editor-color" data-tooltip={t("editor.textColor")}><span>A</span><select aria-label={t("editor.textColor")} defaultValue="" onChange={(e) => {
          const color = e.target.value; e.target.value = "";
          if (view && color) setSemanticStyle(view, "text", color);
        }}><option value="">{t("editor.textColor")}</option><option value="none">{t("editor.defaultColor")}</option><option value="red">Red</option><option value="orange">Orange</option><option value="green">Green</option><option value="blue">Blue</option><option value="purple">Purple</option><option value="muted">Gray</option></select></label>
        <label className="editor-color editor-highlight" data-tooltip={t("editor.highlight")}><span>A</span><select aria-label={t("editor.highlight")} defaultValue="" onChange={(e) => {
          const color = e.target.value; e.target.value = "";
          if (view && color) setSemanticStyle(view, "highlight", color);
        }}><option value="">{t("editor.highlight")}</option><option value="none">{t("editor.noHighlight")}</option><option value="yellow">Yellow</option><option value="orange">Orange</option><option value="green">Green</option><option value="blue">Blue</option><option value="purple">Purple</option><option value="gray">Gray</option></select></label>
        {button(t("editor.clearFormat"), "Tx", clearInlineFormatting)}
      </div>
      <div className="editor-toolgroup" data-tour="media-tools">
        {button(t("editor.link"), <ToolbarIcon kind="link" />, (v) => {
          const label = selected || t("editor.linkText");
          insertText(v, `[${label}](https://)`, label.length + 3);
        })}
        <button type="button" title={t("editor.image")} aria-label={t("editor.image")} disabled={!view} data-tour="insert-image"
          data-tooltip={t("editor.image")} onMouseDown={(e) => e.preventDefault()} onClick={onImage}><ToolbarIcon kind="image" /></button>
        <button type="button" title={t("editor.video")} data-tooltip={t("editor.video")} aria-label={t("editor.video")} disabled={!view} data-tour="insert-video"
          onMouseDown={(e) => e.preventDefault()} onClick={onVideo}><ToolbarIcon kind="video" /></button>
        {button(t("editor.table"), <ToolbarIcon kind="table" />, insertTable)}
        {button(t("editor.rule"), "—", (v) => insertText(v, "\n\n---\n\n"))}
      </div>
      <div className="editor-toolgroup editor-history">
        {button(t("editor.undo"), "↶", undo)}
        {button(t("editor.redo"), "↷", redo)}
      </div>
      <div className="editor-toolgroup editor-viewtools">
        <button type="button" title={t("pane.markMine")} data-tooltip={t("pane.markMine")} aria-label={t("pane.markMine")} disabled={!hasSelection} data-tour="authorship-human"
          onMouseDown={(e) => e.preventDefault()} onClick={onMarkHuman}><ToolbarIcon kind="human" /></button>
        <button type="button" title={t("pane.markAi")} data-tooltip={t("pane.markAi")} aria-label={t("pane.markAi")} disabled={!hasSelection} data-tour="authorship-ai"
          onMouseDown={(e) => e.preventDefault()} onClick={onMarkAi}><ToolbarIcon kind="ai" /></button>
        <button type="button" title={t("pane.unmark")} data-tooltip={t("pane.unmark")} aria-label={t("pane.unmark")}
          onMouseDown={(e) => e.preventDefault()} onClick={onUnmark}><ToolbarIcon kind="unmark" /></button>
        <button type="button" title={hideAuthorship ? t("pane.showAuthorship") : t("pane.hideAuthorship")}
          data-tooltip={hideAuthorship ? t("pane.showAuthorship") : t("pane.hideAuthorship")}
          aria-label={hideAuthorship ? t("pane.showAuthorship") : t("pane.hideAuthorship")} aria-pressed={hideAuthorship}
          className={hideAuthorship ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onClick={onToggleAuthorship}><ToolbarIcon kind="authorship" /></button>
        <button type="button" title={t("editor.navigation")} data-tooltip={t("editor.navigation")} aria-label={t("editor.navigation")} aria-pressed={showNavigation}
          className={showNavigation ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onClick={onToggleNavigation}><ToolbarIcon kind="panel" /></button>
        <button type="button" title={t("editor.frontmatter")} data-tooltip={t("editor.frontmatter")} aria-label={t("editor.frontmatter")} aria-pressed={showFrontmatter}
          className={showFrontmatter ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onClick={onToggleFrontmatter}><ToolbarIcon kind="frontmatter" /></button>
        <button type="button" title={t("editor.markdown")} data-tooltip={t("editor.markdown")} aria-label={t("editor.markdown")} aria-pressed={rawMarkdown}
          className={rawMarkdown ? "on" : ""} onMouseDown={(e) => e.preventDefault()} onClick={onToggleMarkdown}>M↓</button>
        <button type="button" title={t("editor.hideToolbar")} data-tooltip={t("editor.hideToolbar")} aria-label={t("editor.hideToolbar")}
          onMouseDown={(e) => e.preventDefault()} onClick={onHide}>⌃</button>
      </div>
    </div>
  );
}

function ToolbarIcon({ kind }: { kind: "bullets" | "numbered" | "tasks" | "link" | "image" | "video" | "panel" | "frontmatter" | "table" | "human" | "ai" | "unmark" | "authorship" }) {
  if (kind === "human") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3" /><path d="M5 20c.5-4 3-6 7-6s6.5 2 7 6" /></svg>;
  if (kind === "ai") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.2 4.2L17 9l-3.8 1.8L12 15l-1.2-4.2L7 9l3.8-1.8L12 3ZM18.5 14l.7 2.3 2.3.7-2.3.7-.7 2.3-.7-2.3-2.3-.7 2.3-.7.7-2.3Z" /></svg>;
  if (kind === "unmark") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 15 8-8 6 6-7 7H7l-3-3Z" /><path d="m14 19 6-6" /></svg>;
  if (kind === "authorship") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12s3.5-5 9-5 9 5 9 5-3.5 5-9 5-9-5-9-5Z" /><circle cx="12" cy="12" r="2.5" /></svg>;
  if (kind === "table") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="1" /><path d="M3 10h18M9 4v16M15 4v16" /></svg>;
  if (kind === "panel") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M8 9v11" /></svg>;
  if (kind === "frontmatter") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4 3 7l3 3M18 4l3 3-3 3M8 15h8M8 19h8" /></svg>;
  if (kind === "link") return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1.1l2-2a5 5 0 0 0-7.1-7.1l-1.1 1.1M14 11a5 5 0 0 0-7.1-.1l-2 2A5 5 0 0 0 12 20l1.1-1.1" /></svg>
  );
  if (kind === "image") return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8.5" cy="9" r="1.5" /><path d="m4 17 5-5 4 4 2-2 5 5" /></svg>
  );
  if (kind === "video") return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="14" height="14" rx="2" /><path d="m17 10 4-2v8l-4-2Z" /></svg>;
  if (kind === "tasks") return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="7" height="7" rx="1" /><path d="m5 7.5 1.5 1.5L9 6M13 7.5h8M3 17h7M13 17h8" /></svg>
  );
  if (kind === "numbered") return (
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h2v5M3.5 10H7M4 15c.3-1 2.8-1 2.8.4 0 1-2.8 2.1-2.8 3.6h3M11 7h10M11 17h10" /></svg>
  );
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="7" r="1.5" fill="currentColor" stroke="none" /><circle cx="5" cy="17" r="1.5" fill="currentColor" stroke="none" /><path d="M10 7h11M10 17h11" /></svg>;
}
