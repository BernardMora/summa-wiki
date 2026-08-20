import Onboarding from "@/components/onboarding/Onboarding.tsx";
import { readSettings } from "@/src/appdata.mjs";

export const dynamic = "force-dynamic";

export default function OnboardingPage() {
  const settings = readSettings();
  return <Onboarding initial={{ onboarding: settings.onboarding, ai: settings.ai, demoVault: settings.demoVault, locale: settings.locale ?? "es" }} />;
}
