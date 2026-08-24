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

test("legacy Claude settings migrate to the ACP preset id", () => {
  appdata.writeSettings({ ai: { agent: "claude", model: "opus", configured: true } });
  const settings = appdata.readSettings();
  assert.equal(settings.ai.agent, "claude-code");
  assert.equal(settings.ai.configured, true);
});

/*
 * The rule the first screen depends on, checked as a rule.
 *
 * Both `app/page.tsx` and `electron/main.js` ask this question, and on Windows
 * the answer flipped to `false` behind the user's back: opening the example
 * vault wrote the vault path into settings and then failed to restart the
 * server, so from the second launch on the app had a vault and onboarding was
 * gone (issue #9). The restart is fixed in `electron/kill-tree.mjs`; this pins
 * down what "first run" means so the two callers cannot drift apart.
 */
test("onboarding is owed until there is a vault or the tour is finished", () => {
  /*
   * The home directory is moved aside for this test, and that detail is the
   * reason the bug survived so long. `resolveVault` still honours the historic
   * hardcoded path, `~/Documents/aios`; on the one machine this app is
   * developed on that folder exists, so `needsOnboarding` is false there and no
   * amount of local testing ever reaches the first-run screen.
   */
  const home = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "summa-home-"));
  process.env.HOME = elsewhere;
  process.env.USERPROFILE = elsewhere;
  test.after(() => {
    Object.assign(process.env, home);
    fs.rmSync(elsewhere, { recursive: true, force: true });
  });

  appdata.writeSettings({ vault: null });
  onboarding.patchOnboarding({ status: "not_started" });
  assert.equal(appdata.needsOnboarding(), true);

  // Left half-way through: still owed, which is what brings someone back to
  // where they stopped instead of to an encyclopedia they have not filled yet.
  onboarding.patchOnboarding({ status: "in_progress", stage: "demo" });
  assert.equal(appdata.needsOnboarding(), true);

  onboarding.patchOnboarding({ status: "completed" });
  assert.equal(appdata.needsOnboarding(), false);

  // A vault settles it on its own: someone who already opened one is not a
  // first run, whatever the tour's state says.
  onboarding.patchOnboarding({ status: "not_started" });
  appdata.writeSettings({ vault: tmp });
  assert.equal(appdata.needsOnboarding(), false);
  appdata.writeSettings({ vault: null });
});
