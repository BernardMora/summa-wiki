import { NextResponse } from "next/server";
import { readSettings, writeSettings, resolveLocale } from "@/src/appdata.mjs";
import { isLocale } from "@/src/locales.mjs";
import { LOCALES } from "@/lib/i18n.ts";

export const dynamic = "force-dynamic";

/**
 * El idioma de la interfaz.
 *
 * Vive en la configuración de MÁQUINA (`settings.json`), no en el vault, y esa
 * es la diferencia con `/api/config`: el nombre de la wiki es identidad del
 * vault y viaja con él, el idioma es preferencia de quien está sentado frente a
 * la pantalla. El mismo vault abierto en dos máquinas puede leerse en dos
 * idiomas, igual que ya pasa con el tema.
 *
 * A diferencia de cambiar de vault, esto **no reinicia nada**. El servidor
 * resuelve el idioma por petición (ver `lib/i18n.server.ts`), así que un
 * `router.refresh()` del cliente basta para que vuelva todo traducido.
 */

export async function GET() {
  const { locale } = readSettings();
  return NextResponse.json({
    locale: resolveLocale(),
    // `null` = nunca eligió y está viendo el idioma del sistema o el respaldo.
    // La interfaz no lo usa hoy; el CLI y el soporte sí, para distinguir
    // "se ve en inglés porque lo pidió" de "se ve en inglés por default".
    explicit: locale !== null,
    available: LOCALES,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const locale = body && body.locale;
  if (!isLocale(locale)) {
    return NextResponse.json(
      { error: `unsupported locale: ${LOCALES.join(", ")}` },
      { status: 400 },
    );
  }
  writeSettings({ locale });
  return NextResponse.json({ ok: true, locale });
}
