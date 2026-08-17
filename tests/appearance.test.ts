import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_APPEARANCE, resolveAppearance } from "../src/appearance/catalog.ts";

test("Summa Clásico is the backwards-compatible default", () => {
  assert.deepEqual(resolveAppearance(DEFAULT_APPEARANCE), {
    preset: "summa-classic", activePreset: "summa-classic", name: "Summa Clásico",
    mode: "system", typography: "editorial", palette: "editorial-blue",
    buttons: "classic", customized: false,
  });
});

test("overrides compose without mutating the base package", () => {
  const config = structuredClone(DEFAULT_APPEARANCE);
  config.activePreset = "notebook";
  config.overrides.typography = "modern";
  const resolved = resolveAppearance(config);
  assert.equal(resolved.preset, "notebook");
  assert.equal(resolved.palette, "paper-terracotta");
  assert.equal(resolved.typography, "modern");
  assert.equal(resolved.customized, true);
});

test("vault persistence validates, deduplicates and writes atomically", async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "summa-appearance-"));
  process.env.WIKI_VAULT = vault;
  const { APPEARANCE_PATH, readAppearance, writeAppearance } = await import("../src/appearance/store.ts");
  const saved = writeAppearance({
    version: 99, activePreset: "mine", mode: "dark",
    overrides: { typography: "bogus", palette: "archive-green", buttons: "soft" },
    customPresets: [
      { id: "mine", name: "Mine", basePreset: "archive", typography: "academic", palette: "archive-green", buttons: "classic" },
      { id: "mine", name: "Duplicate", basePreset: "studio", typography: "modern", palette: "neutral-indigo", buttons: "solid" },
      { id: "summa-classic", name: "Shadow", basePreset: "studio", typography: "modern", palette: "neutral-indigo", buttons: "solid" },
    ],
  });
  assert.equal(saved.version, 1);
  assert.equal(saved.customPresets.length, 1);
  assert.equal(saved.overrides.typography, null);
  assert.equal(readAppearance().activePreset, "mine");
  assert.equal(fs.existsSync(APPEARANCE_PATH), true);
  assert.equal(fs.readdirSync(path.dirname(APPEARANCE_PATH)).some((x) => x.includes(".tmp")), false);
  fs.rmSync(vault, { recursive: true, force: true });
});
