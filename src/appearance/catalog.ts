export type AppearanceMode = "system" | "light" | "dark";

export type PresetId = "summa-classic" | "notebook" | "studio" | "archive" | "terminal";
export type TypographyId = "editorial" | "humanist" | "modern" | "academic" | "monospace" | "system";
export type PaletteId = "editorial-blue" | "paper-terracotta" | "neutral-indigo" | "archive-green" | "technical-charcoal";
export type ButtonId = "classic" | "soft" | "solid" | "technical";

export interface AppearanceChoice<T extends string> {
  id: T;
  name: string;
  description: string;
}

export interface Preset extends AppearanceChoice<PresetId> {
  typography: TypographyId;
  palette: PaletteId;
  buttons: ButtonId;
}

export interface CustomPreset {
  id: string;
  name: string;
  basePreset: PresetId;
  typography: TypographyId;
  palette: PaletteId;
  buttons: ButtonId;
}

export interface AppearanceConfig {
  version: 1;
  activePreset: string;
  mode: AppearanceMode;
  overrides: {
    typography: TypographyId | null;
    palette: PaletteId | null;
    buttons: ButtonId | null;
  };
  customPresets: CustomPreset[];
}

export interface ResolvedAppearance {
  preset: PresetId;
  activePreset: string;
  name: string;
  mode: AppearanceMode;
  typography: TypographyId;
  palette: PaletteId;
  buttons: ButtonId;
  customized: boolean;
}

export const PRESETS: Preset[] = [
  { id: "summa-classic", name: "Summa Clásico", description: "Editorial, enciclopédico y sobrio.", typography: "editorial", palette: "editorial-blue", buttons: "classic" },
  { id: "notebook", name: "Cuaderno", description: "Cálido, relajado y enfocado en la lectura.", typography: "humanist", palette: "paper-terracotta", buttons: "soft" },
  { id: "studio", name: "Estudio", description: "Moderno, neutral y de jerarquía limpia.", typography: "modern", palette: "neutral-indigo", buttons: "solid" },
  { id: "archive", name: "Archivo", description: "Académico, compacto y estructurado.", typography: "academic", palette: "archive-green", buttons: "classic" },
  { id: "terminal", name: "Terminal", description: "Técnico, oscuro y de contraste alto.", typography: "monospace", palette: "technical-charcoal", buttons: "technical" },
];

export const TYPOGRAPHIES: AppearanceChoice<TypographyId>[] = [
  { id: "editorial", name: "Editorial clásica", description: "Serif para lectura y sans para la interfaz." },
  { id: "humanist", name: "Humanista", description: "Formas cálidas y abiertas para leer por más tiempo." },
  { id: "modern", name: "Moderna", description: "Sans-serif limpia en toda la aplicación." },
  { id: "academic", name: "Académica", description: "Tipografía de libro con navegación compacta." },
  { id: "monospace", name: "Monoespaciada", description: "Ritmo técnico para interfaz y encabezados." },
  { id: "system", name: "Del sistema", description: "Usa las fuentes nativas del dispositivo." },
];

export const PALETTES: AppearanceChoice<PaletteId>[] = [
  { id: "editorial-blue", name: "Azul editorial", description: "Blancos neutros y azul enciclopédico." },
  { id: "paper-terracotta", name: "Papel y terracota", description: "Crema, tinta y un acento cálido." },
  { id: "neutral-indigo", name: "Índigo neutral", description: "Grises fríos y acento índigo." },
  { id: "archive-green", name: "Verde archivo", description: "Pergamino, verde profundo y líneas firmes." },
  { id: "technical-charcoal", name: "Carbón técnico", description: "Superficies oscuras con verde y cian." },
];

export const BUTTONS: AppearanceChoice<ButtonId>[] = [
  { id: "classic", name: "Clásico", description: "Rectangular, borde fino y radio mínimo." },
  { id: "soft", name: "Suave", description: "Superficie tonal y esquinas redondeadas." },
  { id: "solid", name: "Sólido", description: "Acciones principales rellenas y claras." },
  { id: "technical", name: "Técnico", description: "Compacto, recto y de contraste marcado." },
];

export const DEFAULT_APPEARANCE: AppearanceConfig = {
  version: 1,
  activePreset: "summa-classic",
  mode: "system",
  overrides: { typography: null, palette: null, buttons: null },
  customPresets: [],
};

const ids = <T extends string>(xs: AppearanceChoice<T>[]) => new Set(xs.map((x) => x.id));
export const PRESET_IDS = ids(PRESETS);
export const TYPOGRAPHY_IDS = ids(TYPOGRAPHIES);
export const PALETTE_IDS = ids(PALETTES);
export const BUTTON_IDS = ids(BUTTONS);

export function resolveAppearance(config: AppearanceConfig): ResolvedAppearance {
  const custom = config.customPresets.find((p) => p.id === config.activePreset);
  const official = PRESETS.find((p) => p.id === config.activePreset);
  const base = official ?? PRESETS.find((p) => p.id === custom?.basePreset) ?? PRESETS[0];
  const recipe = custom ?? base;
  const typography = config.overrides.typography ?? recipe.typography;
  const palette = config.overrides.palette ?? recipe.palette;
  const buttons = config.overrides.buttons ?? recipe.buttons;
  return {
    preset: base.id,
    activePreset: config.activePreset,
    name: custom?.name ?? base.name,
    mode: config.mode,
    typography,
    palette,
    buttons,
    customized: !!config.overrides.typography || !!config.overrides.palette || !!config.overrides.buttons,
  };
}

export function appearanceAttributes(resolved: ResolvedAppearance) {
  return {
    "data-theme": resolved.mode === "system" ? undefined : resolved.mode,
    "data-preset": resolved.preset,
    "data-typography": resolved.typography,
    "data-palette": resolved.palette,
    "data-buttons": resolved.buttons,
  };
}
