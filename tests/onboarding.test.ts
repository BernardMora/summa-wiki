import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "summa-onboarding-"));
process.env.WIKI_USER_DATA = tmp;

const appdata = await import("../src/appdata.mjs");
const onboarding = await import("../src/onboarding.mjs");

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test("los defaults distinguen un primer arranque", () => {
  const settings = appdata.readSettings();
  assert.equal(settings.onboarding.status, "not_started");
  assert.equal(settings.onboarding.stage, "welcome");
  assert.equal(settings.ai.configured, false);
  assert.equal(settings.demoVault, null);
});

test("el demo se crea fuera de los documentos del usuario y respeta apariencia y procedencia", () => {
  onboarding.patchOnboarding({ design: "archive", mode: "dark" });
  const demo = onboarding.createExampleVault("es");
  assert.ok(demo.path.startsWith(tmp + path.sep));
  assert.ok(fs.existsSync(path.join(demo.path, "AGENTS.md")));
  assert.ok(fs.existsSync(path.join(demo.path, "skills", "decision-brief", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(demo.path, "skills", "weekly-review", "SKILL.md")));
  const mixed = fs.readFileSync(path.join(demo.path, "01-Vida", "01-Trabajo", "estudio-creativo", "estudio-creativo.md"), "utf8");
  assert.match(mixed, /author: mixed/);
  assert.match(mixed, /<!-- ai -->[\s\S]*<!-- \/ai -->/);
  assert.doesNotMatch(mixed, /pillar: other[\s\S]*pillar: consulting/);
  const appearance = JSON.parse(fs.readFileSync(path.join(demo.path, ".summa", "appearance.json"), "utf8"));
  assert.equal(appearance.activePreset, "archive");
  assert.equal(appearance.mode, "dark");
});

test("restaurar el demo elimina sus cambios y nunca otro vault", () => {
  const demo = onboarding.createExampleVault("en");
  const touched = path.join(demo.path, "practice.txt");
  fs.writeFileSync(touched, "changed");
  const other = path.join(tmp, "personal-vault");
  fs.mkdirSync(other);
  fs.writeFileSync(path.join(other, "mine.md"), "mine");

  onboarding.createExampleVault("en", { reset: true });
  assert.equal(fs.existsSync(touched), false);
  assert.equal(fs.readFileSync(path.join(other, "mine.md"), "utf8"), "mine");
});

test("el progreso y la selección de IA sobreviven escrituras parciales", () => {
  appdata.writeSettings({ ai: { agent: "codex", model: "gpt-test", configured: true } });
  onboarding.patchOnboarding({ status: "in_progress", stage: "demo", lesson: "edit", completed: ["navigate"] });
  appdata.writeSettings({ locale: "en" });
  const settings = appdata.readSettings();
  assert.equal(settings.ai.agent, "codex");
  assert.equal(settings.onboarding.lesson, "edit");
  assert.deepEqual(settings.onboarding.completed, ["navigate"]);
});
