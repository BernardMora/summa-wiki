import { NextResponse } from "next/server";
import { createExampleVault, patchOnboarding } from "@/src/onboarding.mjs";
import { readSettings } from "@/src/appdata.mjs";

export const dynamic = "force-dynamic";

export async function GET() {
  const settings = readSettings();
  return NextResponse.json({
    onboarding: settings.onboarding,
    ai: settings.ai,
    demoVault: settings.demoVault,
    locale: settings.locale ?? "es",
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body.action === "example" || body.action === "reset-example") {
    const appearancePatch: Record<string, unknown> = {};
    if (["summa-classic", "notebook", "studio", "archive", "terminal"].includes(body.design)) appearancePatch.design = body.design;
    if (["system", "light", "dark"].includes(body.mode)) appearancePatch.mode = body.mode;
    if (Object.keys(appearancePatch).length) patchOnboarding(appearancePatch);
    const demoVault = createExampleVault(body.locale, { reset: body.action === "reset-example" });
    const onboarding = patchOnboarding({ status: "in_progress", stage: "demo", lesson: "navigate" });
    return NextResponse.json({ ok: true, demoVault, onboarding });
  }
  if (body.action === "state") {
    const allowed = new Set(["welcome", "ai", "demo", "vault", "done"]);
    const patch: Record<string, unknown> = {};
    if (allowed.has(body.stage)) patch.stage = body.stage;
    if (["not_started", "in_progress", "completed"].includes(body.status)) patch.status = body.status;
    if (typeof body.lesson === "string" || body.lesson === null) patch.lesson = body.lesson;
    if (Array.isArray(body.completed)) patch.completed = body.completed;
    if (Array.isArray(body.skipped)) patch.skipped = body.skipped;
    if (["summa-classic", "notebook", "studio", "archive", "terminal"].includes(body.design)) patch.design = body.design;
    if (["system", "light", "dark"].includes(body.mode)) patch.mode = body.mode;
    return NextResponse.json({ ok: true, onboarding: patchOnboarding(patch) });
  }
  return NextResponse.json({ error: "unknown onboarding action" }, { status: 400 });
}
