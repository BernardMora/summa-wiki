"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BUTTONS, DEFAULT_APPEARANCE, PALETTES, PRESETS, TYPOGRAPHIES,
  appearanceAttributes, resolveAppearance,
  type AppearanceConfig, type AppearanceMode, type ButtonId, type PaletteId,
  type PresetId, type TypographyId,
} from "@/src/appearance/catalog.ts";
import { useT } from "./I18n.tsx";

function apply(config: AppearanceConfig) {
  const root = document.documentElement;
  const attrs = appearanceAttributes(resolveAppearance(config));
  for (const [key, value] of Object.entries(attrs)) {
    if (value) root.setAttribute(key, value); else root.removeAttribute(key);
  }
}

function slug(name: string) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 36) || "custom";
}

export default function AppearanceDesigner() {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<AppearanceConfig | null>(null);
  const [draft, setDraft] = useState<AppearanceConfig | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const router = useRouter();
  const t = useT();

  async function launch() {
    setErr("");
    try {
      const r = await fetch("/api/appearance");
      const data = await r.json();
      setSaved(data.config); setDraft(data.config); setOpen(true);
    } catch { setErr(t("settings.appearanceLoadFailed")); }
  }

  useEffect(() => { if (draft && open) apply(draft); }, [draft, open]);
  useEffect(() => {
    if (!open) return;
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  // `close` deliberately uses the latest saved state; a render follows every change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, saved]);

  const resolved = useMemo(() => draft ? resolveAppearance(draft) : null, [draft]);

  function close() {
    if (saved) apply(saved);
    setOpen(false); setDraft(null); setName(""); setErr("");
  }

  function choosePreset(id: string) {
    if (!draft) return;
    setDraft({ ...draft, activePreset: id, overrides: { typography: null, palette: null, buttons: null } });
  }

  function override(kind: "typography" | "palette" | "buttons", value: string) {
    if (!draft) return;
    const base = resolveAppearance({ ...draft, overrides: { typography: null, palette: null, buttons: null } });
    setDraft({ ...draft, overrides: { ...draft.overrides, [kind]: base[kind] === value ? null : value } as AppearanceConfig["overrides"] });
  }

  async function persist(next = draft) {
    if (!next || saving) return;
    setSaving(true); setErr("");
    try {
      const r = await fetch("/api/appearance", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const data = await r.json();
      if (!r.ok) { setErr(data.error ?? t("settings.saveFailed")); return; }
      setSaved(data.config); setDraft(data.config); apply(data.config); setOpen(false); router.refresh();
    } catch { setErr(t("settings.saveFailed")); }
    finally { setSaving(false); }
  }

  async function saveCustom() {
    if (!draft || !resolved || !name.trim()) return;
    let id = slug(name);
    const taken = new Set([...PRESETS.map((p) => p.id), ...draft.customPresets.map((p) => p.id)]);
    let n = 2; const base = id;
    while (taken.has(id)) id = `${base}-${n++}`;
    const custom = {
      id, name: name.trim().slice(0, 40), basePreset: resolved.preset,
      typography: resolved.typography, palette: resolved.palette, buttons: resolved.buttons,
    };
    const next: AppearanceConfig = {
      ...draft, activePreset: id, overrides: { typography: null, palette: null, buttons: null },
      customPresets: [...draft.customPresets, custom],
    };
    setDraft(next); await persist(next);
  }

  function renameCustom() {
    if (!draft || !name.trim()) return;
    const next = { ...draft, customPresets: draft.customPresets.map((p) => p.id === draft.activePreset ? { ...p, name: name.trim().slice(0, 40) } : p) };
    setName(""); setDraft(next);
  }

  function deleteCustom() {
    if (!draft || !draft.customPresets.some((p) => p.id === draft.activePreset)) return;
    if (!window.confirm(t("settings.deletePackageConfirm"))) return;
    const next = { ...draft, activePreset: "summa-classic", overrides: { typography: null, palette: null, buttons: null }, customPresets: draft.customPresets.filter((p) => p.id !== draft.activePreset) } as AppearanceConfig;
    setName(""); setDraft(next);
  }

  const custom = draft?.customPresets ?? [];
  const activeIsCustom = custom.some((p) => p.id === draft?.activePreset);
  return (
    <>
      <button className="cfglink appearance-open" onClick={launch}>{t("settings.appearanceOpen")}</button>
      {err && !open && <div className="err">{err}</div>}
      {open && draft && resolved && (
        <div className="appearance-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
          <section className="appearance-dialog" role="dialog" aria-modal="true" aria-labelledby="appearance-title">
            <header className="appearance-head">
              <div><h2 id="appearance-title">{t("settings.appearance")}</h2><p>{t("settings.appearanceHint")}</p></div>
              <button onClick={close} aria-label={t("common.close")}>×</button>
            </header>
            <div className="appearance-body">
              <div className="appearance-controls">
                <h3>{t("settings.theme")}</h3>
                <div className="appearance-modes" role="group" aria-label={t("settings.theme")}>
                  {(["light", "system", "dark"] as AppearanceMode[]).map((mode) => (
                    <button key={mode} className={draft.mode === mode ? "on" : ""} onClick={() => setDraft({ ...draft, mode })}>
                      {mode === "light" ? `☀ ${t("settings.themeLight")}` : mode === "dark" ? `☾ ${t("settings.themeDark")}` : `◐ ${t("settings.themeAuto")}`}
                    </button>
                  ))}
                </div>
                <p className="appearance-modehint">{draft.mode === "system" ? t("settings.themeAutoHint") : t("settings.themeFixedHint")}</p>
                <h3>{t("settings.designPackages")}</h3>
                <div className="presetgrid">
                  {[...PRESETS, ...custom].map((p) => (
                    <button key={p.id} className={`presetcard${draft.activePreset === p.id ? " on" : ""}`} onClick={() => choosePreset(p.id)}>
                      <span className={`preset-swatch palette-${p.palette}`} />
                      <strong>{p.name}</strong><small>{"description" in p ? p.description : t("settings.customPackage")}</small>
                    </button>
                  ))}
                </div>
                <h3>{t("settings.customize")}</h3>
                <label>{t("settings.typography")}<select value={resolved.typography} onChange={(e) => override("typography", e.target.value as TypographyId)}>{TYPOGRAPHIES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                <label>{t("settings.palette")}<select value={resolved.palette} onChange={(e) => override("palette", e.target.value as PaletteId)}>{PALETTES.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
                <label>{t("settings.buttons")}<select value={resolved.buttons} onChange={(e) => override("buttons", e.target.value as ButtonId)}>{BUTTONS.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
              </div>
              <div className="appearance-preview">
                <div className="preview-label">{resolved.customized ? t("settings.customized") : resolved.name}</div>
                <article><h1>{t("settings.previewTitle")}</h1><p>{t("settings.previewBody")} <a href="#" onClick={(e) => e.preventDefault()}>{t("settings.previewLink")}</a>.</p><h2>{t("settings.previewSection")}</h2></article>
                <div className="panel blue"><h2>{t("settings.previewPanel")}</h2><div>{t("settings.previewPanelBody")}</div></div>
                <div className="preview-actions"><button className="newbtn primary">{t("settings.previewPrimary")}</button><button className="newbtn">{t("settings.previewSecondary")}</button><button className="newbtn danger">{t("common.delete")}</button></div>
              </div>
            </div>
            {err && <div className="err appearance-error">{err}</div>}
            <footer className="appearance-footer">
              <div className="save-custom"><input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={t("settings.packageName")} />
                {activeIsCustom ? <><button disabled={!name.trim() || saving} onClick={renameCustom}>{t("common.rename")}</button><button className="danger" onClick={deleteCustom}>{t("common.delete")}</button></> : <button disabled={!name.trim() || saving} onClick={saveCustom}>{t("settings.saveAsPackage")}</button>}
              </div>
              <button onClick={close}>{t("common.cancel")}</button><button className="newbtn primary" disabled={saving} onClick={() => persist()}>{saving ? t("common.saving") : t("settings.apply")}</button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
