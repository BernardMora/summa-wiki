import fs from "node:fs";
import path from "node:path";
import { summaFile } from "../config.ts";
import {
  BUTTON_IDS, DEFAULT_APPEARANCE, PALETTE_IDS, PRESET_IDS, TYPOGRAPHY_IDS,
  type AppearanceConfig, type AppearanceMode, type ButtonId, type CustomPreset,
  type PaletteId, type PresetId, type TypographyId,
} from "./catalog.ts";

export const APPEARANCE_PATH = summaFile("appearance.json");
export function appearanceExists(): boolean { return fs.existsSync(APPEARANCE_PATH); }

const stringId = (value: unknown) => typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,47}$/.test(value);

function customPreset(value: unknown): CustomPreset | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Record<string, unknown>;
  if (!stringId(p.id) || typeof p.name !== "string" || !p.name.trim() || p.name.trim().length > 40) return null;
  if (!PRESET_IDS.has(p.basePreset as PresetId)) return null;
  if (!TYPOGRAPHY_IDS.has(p.typography as TypographyId)) return null;
  if (!PALETTE_IDS.has(p.palette as PaletteId)) return null;
  if (!BUTTON_IDS.has(p.buttons as ButtonId)) return null;
  return {
    id: p.id as string, name: p.name.trim(), basePreset: p.basePreset as PresetId,
    typography: p.typography as TypographyId, palette: p.palette as PaletteId,
    buttons: p.buttons as ButtonId,
  };
}

export function normalizeAppearance(value: unknown): AppearanceConfig {
  if (!value || typeof value !== "object") return structuredClone(DEFAULT_APPEARANCE);
  const raw = value as Record<string, unknown>;
  const ov = raw.overrides && typeof raw.overrides === "object" ? raw.overrides as Record<string, unknown> : {};
  const customPresets: CustomPreset[] = [];
  const seen = new Set<string>(PRESET_IDS);
  if (Array.isArray(raw.customPresets)) {
    for (const value of raw.customPresets) {
      const preset = customPreset(value);
      if (!preset || seen.has(preset.id)) continue;
      seen.add(preset.id); customPresets.push(preset);
      if (customPresets.length === 30) break;
    }
  }
  const customIds = new Set(customPresets.map((p) => p.id));
  const activePreset = typeof raw.activePreset === "string" && (PRESET_IDS.has(raw.activePreset as PresetId) || customIds.has(raw.activePreset))
    ? raw.activePreset : DEFAULT_APPEARANCE.activePreset;
  const mode: AppearanceMode = raw.mode === "light" || raw.mode === "dark" || raw.mode === "system" ? raw.mode : "system";
  return {
    version: 1, activePreset, mode,
    overrides: {
      typography: TYPOGRAPHY_IDS.has(ov.typography as TypographyId) ? ov.typography as TypographyId : null,
      palette: PALETTE_IDS.has(ov.palette as PaletteId) ? ov.palette as PaletteId : null,
      buttons: BUTTON_IDS.has(ov.buttons as ButtonId) ? ov.buttons as ButtonId : null,
    },
    customPresets,
  };
}

export function readAppearance(): AppearanceConfig {
  try { return normalizeAppearance(JSON.parse(fs.readFileSync(APPEARANCE_PATH, "utf8"))); }
  catch { return structuredClone(DEFAULT_APPEARANCE); }
}

export function writeAppearance(value: unknown): AppearanceConfig {
  const next = normalizeAppearance(value);
  const dir = path.dirname(APPEARANCE_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `appearance.json.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, APPEARANCE_PATH);
  return next;
}
