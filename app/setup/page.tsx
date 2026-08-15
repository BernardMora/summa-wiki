import Setup from "@/components/Setup";
import { HAS_VAULT, VAULT, vaultExists, readConfig } from "@/src/config.ts";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * El asistente: abrir un vault o crear uno.
 *
 * Con un vault abierto y en disco, entrar aquí por accidente no tiene sentido y
 * se devuelve a la portada. Pero `?new=1` es intención explícita —el usuario le
 * dio a «Crear vault nuevo…»— y entonces manda él.
 *
 * Sin ese parámetro el asistente quedaba inalcanzable en cuanto había un vault:
 * la única entrada era «Cambiar vault…», que abre carpetas que ya existen. Quien
 * quería crear uno nuevo no encontraba nada y parecía que la app no reaccionaba.
 */
export default async function SetupPage({
  searchParams,
}: {
  // Promesa, no objeto: Next 15 cambió la firma para poder empezar a renderizar
  // antes de conocer los parámetros.
  searchParams: Promise<{ new?: string }>;
}) {
  const deliberate = (await searchParams)?.new === "1";
  if (!deliberate && HAS_VAULT && vaultExists()) redirect("/");

  /*
   * Se llega aquí casi siempre desde un vault vacío que se acaba de abrir, y
   * volver a pedir esa misma carpeta con un selector en blanco era hacer dos
   * veces el mismo trabajo. Se propone lo que ya está abierto; sigue siendo
   * editable, y la validación corre igual sobre lo que quede.
   */
  const suggest = HAS_VAULT && vaultExists()
    ? { dir: VAULT, name: readConfig().name }
    : null;

  return (
    <Setup
      startAt={deliberate ? "create" : "start"}
      suggestDir={suggest?.dir ?? ""}
      suggestName={suggest?.name && suggest.name !== "Summa Wiki" ? suggest.name : ""}
    />
  );
}
