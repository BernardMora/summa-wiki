"use client";
import { useEffect, useMemo, useState } from "react";
import { AGENTS, useAgentModels, useInstalledAgents } from "../agent-session.ts";
import { appearanceAttributes, PRESETS, resolveAppearance, type AppearanceMode, type PresetId } from "@/src/appearance/catalog.ts";

type Stage = "welcome" | "ai" | "demo" | "vault" | "done";
type AgentId = "claude" | "antigravity" | "opencode" | "codex";

interface Initial {
  onboarding: { status: string; stage: Stage; lesson: string | null; completed: string[]; skipped: string[]; design: PresetId; mode: AppearanceMode };
  ai: { agent: AgentId | null; model: string; configured: boolean };
  demoVault: { path: string; locale: string; templateVersion: number } | null;
  locale: "es" | "en";
}

const copy = {
  es: {
    welcome: "Bienvenido a Summa Wiki", intro: "Tus archivos, tu contexto y tus agentes en un solo espacio local.", start: "Configurar Summa", design: "Elige un diseño", designHint: "El demo y tu nuevo vault usarán este diseño. Podrás modificarlo después.", mode: "Modo de color", light: "Claro", dark: "Oscuro", system: "Automático",
    ai: "Agentes y modelos", aiIntro: "Summa funciona sin IA, pero un agente permite investigar, conectar y modificar el vault con su contexto completo.",
    explore: "Explorar el wiki de ejemplo", exploreIntro: "Practica dentro del wiki ficticio de Alex. Tus archivos personales no se tocarán y podrás restaurar el demo cuando quieras.",
    vault: "Tu propio vault", back: "Atrás", next: "Siguiente", skip: "Omitir", detected: "Detectado", missing: "No detectado",
    noAi: "Continuar sin IA", use: "Usar", model: "Modelo", install: "Cómo instalar", retry: "Volver a comprobar",
    openDemo: "Abrir el vault de ejemplo", resetDemo: "Restablecer el demo", create: "Crear un vault nuevo", existing: "Abrir un vault existente",
    installTitle: "Instala el agente fuera de Summa y vuelve a comprobar", installBody: "Usa la documentación oficial del proveedor para instalar e iniciar sesión. Summa nunca ejecutará el instalador por ti.",
  },
  en: {
    welcome: "Welcome to Summa Wiki", intro: "Your files, context, and agents in one local workspace.", start: "Set up Summa", design: "Choose a design", designHint: "The demo and your new vault will use it. You can customize it later.", mode: "Color mode", light: "Light", dark: "Dark", system: "Auto",
    ai: "Agents and models", aiIntro: "Summa works without AI, but an agent can research, connect, and change the vault with its full context.",
    explore: "Explore the example wiki", exploreIntro: "Practice inside Alex's fictional wiki. Your personal files stay untouched and you can reset the demo at any time.",
    vault: "Your own vault", back: "Back", next: "Next", skip: "Skip", detected: "Detected", missing: "Not detected",
    noAi: "Continue without AI", use: "Use", model: "Model", install: "How to install", retry: "Check again",
    openDemo: "Open the example vault", resetDemo: "Reset the demo", create: "Create a new vault", existing: "Open an existing vault",
    installTitle: "Install the agent outside Summa, then check again", installBody: "Use the provider's official documentation to install and sign in. Summa will never run the installer for you.",
  },
};

const docs: Record<AgentId, string> = {
  claude: "https://docs.anthropic.com/en/docs/claude-code/overview",
  antigravity: "https://antigravity.google/docs/cli",
  opencode: "https://opencode.ai/docs",
  codex: "https://developers.openai.com/codex/cli",
};

const presetCopy: Record<PresetId, { es: [string, string]; en: [string, string] }> = {
  "summa-classic": { es: ["Summa Clásico", "Editorial, enciclopédico y sobrio."], en: ["Summa Classic", "Editorial, encyclopedic, and restrained."] },
  notebook: { es: ["Cuaderno", "Cálido, relajado y enfocado en lectura."], en: ["Notebook", "Warm, relaxed, and focused on reading."] },
  studio: { es: ["Estudio", "Moderno, neutral y de jerarquía limpia."], en: ["Studio", "Modern, neutral, with clean hierarchy."] },
  archive: { es: ["Archivo", "Académico, compacto y estructurado."], en: ["Archive", "Academic, compact, and structured."] },
  terminal: { es: ["Terminal", "Técnico, oscuro y de contraste alto."], en: ["Terminal", "Technical, dark, and high contrast."] },
};

export default function Onboarding({ initial }: { initial: Initial }) {
  const [locale, setLocale] = useState<"es" | "en">(initial.locale);
  const [stage, setStage] = useState<Stage>(initial.onboarding.stage === "done" ? "welcome" : initial.onboarding.stage);
  const [agent, setAgent] = useState<AgentId | null>(initial.ai.agent);
  const [model, setModel] = useState(initial.ai.model);
  const [design, setDesign] = useState<PresetId>(initial.onboarding.design ?? "summa-classic");
  const [mode, setMode] = useState<AppearanceMode>(initial.onboarding.mode ?? "system");
  const [busy, setBusy] = useState(false);
  const { installed } = useInstalledAgents();
  const { models, loading } = useAgentModels(agent ?? "claude");
  const t = copy[locale];
  const stages: Stage[] = ["ai", "demo", "vault"];
  const progress = Math.max(0, stages.indexOf(stage));

  useEffect(() => { document.body.classList.add("onboarding-active"); return () => document.body.classList.remove("onboarding-active"); }, []);
  useEffect(() => {
    const resolved = resolveAppearance({ version: 1, activePreset: design, mode, overrides: { typography: null, palette: null, buttons: null }, customPresets: [] });
    const attrs = appearanceAttributes(resolved);
    for (const [key, value] of Object.entries(attrs)) value ? document.documentElement.setAttribute(key, value) : document.documentElement.removeAttribute(key);
  }, [design, mode]);

  async function saveState(next: Stage) {
    setStage(next);
    await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "state", status: "in_progress", stage: next, design, mode }) });
  }

  async function chooseLocale(next: "es" | "en") {
    setLocale(next);
    await fetch("/api/locale", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ locale: next }) });
  }

  async function chooseDesign(next: PresetId) {
    setDesign(next);
    await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "state", status: "in_progress", stage, design: next }) });
  }

  async function chooseMode(next: AppearanceMode) {
    setMode(next);
    await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "state", status: "in_progress", stage, mode: next }) });
  }

  async function saveAi(configured: boolean) {
    await fetch("/api/onboarding/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent, model, configured }) });
    await saveState("demo");
  }

  async function openDemo(reset = false) {
    setBusy(true);
    try {
      const r = await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: reset ? "reset-example" : "example", locale, design, mode }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error);
      await fetch("/api/vault", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: data.demoVault.path }) });
      if (window.summa) await window.summa.switchVault(data.demoVault.path);
      else location.href = "/";
    } finally { setBusy(false); }
  }

  const selectedInstalled = agent ? installed(agent) : false;
  const modelOptions = useMemo(() => models, [models]);

  return <main className="onboarding-screen">
    <div className="onboarding-top">
      <div className="onboarding-brand">Summa Wiki</div>
      <div className="onboarding-progress" aria-label="Progress">
        {stages.map((s, i) => <span key={s} className={stage !== "welcome" && i <= progress ? "on" : ""} />)}
      </div>
      <div className="onboarding-locale">
        <button className={locale === "es" ? "on" : ""} onClick={() => chooseLocale("es")}>ES</button>
        <button className={locale === "en" ? "on" : ""} onClick={() => chooseLocale("en")}>EN</button>
      </div>
    </div>

    {stage === "welcome" && <section className="onboarding-hero">
      <img className="onboarding-logo" src="/wiki-icon.svg" alt="" aria-hidden="true" /><p className="eyebrow">Summa Wiki</p><h1>{t.welcome}</h1><p>{t.intro}</p>
      <div className="onboarding-design"><h2>{t.design}</h2><p>{t.designHint}</p><div className="design-cards">{PRESETS.map((preset) => { const [name, description] = presetCopy[preset.id][locale]; return <button key={preset.id} className={design === preset.id ? "selected" : ""} onClick={() => chooseDesign(preset.id)}><span className={`preset-swatch palette-${preset.palette}`} /><strong>{name}</strong><small>{description}</small></button>; })}</div><h2 className="mode-heading">{t.mode}</h2><div className="mode-cards">{(["light", "dark", "system"] as AppearanceMode[]).map((item) => <button key={item} className={mode === item ? "selected" : ""} onClick={() => chooseMode(item)}><span className={`mode-preview mode-${item}`} aria-hidden="true" /><strong>{t[item]}</strong></button>)}</div></div>
      <button className="onboarding-primary" onClick={() => saveState("ai")}>{t.start} →</button>
    </section>}

    {stage === "ai" && <section className="onboarding-panel">
      <p className="eyebrow">01 · IA</p><h1>{t.ai}</h1><p>{t.aiIntro}</p>
      <div className="agent-cards">
        {AGENTS.map((a) => { const has = installed(a.id); return <button key={a.id} className={`agent-card${agent === a.id ? " selected" : ""}`} onClick={() => { setAgent(a.id); setModel(""); }}>
          <strong>{a.name}</strong><span className={has ? "available" : "unavailable"}>{has === null ? "…" : has ? `● ${t.detected}` : `○ ${t.missing}`}</span>
        </button>; })}
      </div>
      {agent && selectedInstalled && <div className="onboarding-field"><label>{t.model}</label>{loading ? <p className="model-loading">{locale === "es" ? "Consultando modelos disponibles…" : "Loading available models…"}</p> : <div className="model-cards">{modelOptions.map((m) => <button key={m.id || "default"} className={model === m.id ? "selected" : ""} onClick={() => setModel(m.id)}><strong>{m.label || (locale === "es" ? "Predeterminado del CLI" : "CLI default")}</strong><small>{m.id || (locale === "es" ? "Usa la configuración actual del agente" : "Uses the agent's current configuration")}</small></button>)}</div>}</div>}
      {agent && selectedInstalled === false && <div className="install-box"><strong>{t.installTitle}</strong><p>{t.installBody}</p><a href={docs[agent]} target="_blank" rel="noreferrer">{t.install}: {AGENTS.find((a) => a.id === agent)?.name} ↗</a><button onClick={() => location.reload()}>{t.retry}</button></div>}
      <div className="onboarding-actions"><button onClick={() => saveState("welcome")}>{t.back}</button><button onClick={() => saveAi(false)}>{t.noAi}</button><button className="onboarding-primary" disabled={!agent || !selectedInstalled} onClick={() => saveAi(true)}>{t.next} →</button></div>
    </section>}

    {stage === "demo" && <section className="onboarding-panel onboarding-demo">
      <p className="eyebrow">02 · DEMO</p><h1>{t.explore}</h1><p>{t.exploreIntro}</p>
      <div className="example-preview"><div><strong>{locale === "es" ? "Wiki de ejemplo de Alex" : "Alex's example wiki"}</strong><span>{locale === "es" ? "Una vida ficticia con contexto conectado" : "A fictional life with connected context"}</span></div><ul><li>{locale === "es" ? "Identidad y decisiones" : "Identity and decisions"}</li><li>{locale === "es" ? "Trabajo y finanzas" : "Work and finances"}</li><li>{locale === "es" ? "Salud y relaciones" : "Health and relationships"}</li><li>{locale === "es" ? "Aprendizaje y journal" : "Learning and journal"}</li></ul></div>
      <div className="onboarding-actions"><button onClick={() => saveState("ai")}>{t.back}</button>{initial.demoVault && <button onClick={() => openDemo(true)}>{t.resetDemo}</button>}<button onClick={() => saveState("vault")}>{t.skip}</button><button className="onboarding-primary" disabled={busy} onClick={() => openDemo(false)}>{t.openDemo} →</button></div>
    </section>}

    {stage === "vault" && <section className="onboarding-panel">
      <p className="eyebrow">03 · VAULT</p><h1>{t.vault}</h1>
      <div className="vault-choices"><a href="/setup?new=1" className="agent-card"><strong>{t.create}</strong><span>→</span></a><a href="/setup?open=1" className="agent-card"><strong>{t.existing}</strong><span>→</span></a></div>
      <div className="onboarding-actions"><button onClick={() => saveState("demo")}>{t.back}</button></div>
    </section>}
  </main>;
}
