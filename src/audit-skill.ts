import type { Architecture } from "./architecture.ts";
import { writeSkill, localNote, type SkillWrite } from "./skills.ts";

/**
 * La skill que audita el vault.
 *
 * Sale de `/wiki-health`, una skill escrita a mano para UN vault concreto: sus
 * rutas, sus dos bundles, su convención `aios://`, y frases como «~73 notas
 * están así y es correcto». Todo eso era cierto ahí y falso en cualquier otro
 * vault, así que aquí no se copia: se deriva de `architecture.json`, igual que
 * la skill de ingesta.
 *
 * Lo que SÍ se hereda es lo único que no se puede generar: el juicio. La
 * observación que la hacía valer más que el linter es que **la mayoría de los
 * hallazgos no son errores**, y que reportarlos todos por igual entrena a
 * ignorar la lista entera. Esa parte es prosa fija a propósito.
 */

export function auditSkill(arch: Architecture, port: number): string {
  const shared = arch.bundles.filter((b) => b.shared);
  const multi = arch.bundles.length > 1;

  return `---
name: audit
description: Audita la salud del vault y propone arreglos. Corre el linter contra el formato, separa lo que está roto de lo que está vacío por diseño, y sugiere qué artículos falta escribir según la estructura del grafo. No toca nada sin confirmación.
---

# Auditar el vault

Arquitectura de este vault: **${arch.name}** — ${arch.description}

Dos trabajos distintos, en este orden:

1. **Integridad** — ¿algo se rompió desde la última revisión?
2. **Crecimiento** — ¿qué artículo falta escribir?

El linter ya existe. Lo que aportas tú es el juicio: **la mayoría de los
hallazgos no son errores**, y reportarlos todos por igual entrena a quien lee a
ignorar la lista entera.

## Cuándo

- Cada semana, o después de una sesión grande de edición.
- Siempre después de renombrar, mover o borrar archivos en lote.
- Antes de compartir el vault con alguien más.

## Paso 1 — Pedir el reporte

La app publica el diagnóstico en JSON mientras está abierta:

\`\`\`bash
curl -s http://localhost:${port}/api/health
\`\`\`

Trae \`stats\` (notas, enlaces, rotos, aislados), \`counts\` (cuántos hallazgos de
cada tipo), \`issues\` (la lista completa, cada uno con \`kind\` · \`note\` ·
\`detail\`), \`candidates\` (los mejores artículos que faltan, con
\`candidatesTotal\` diciendo cuántos hay en total — \`?full=1\` los trae todos) y
\`orphans\` (notas sin enlaces entrantes).

Léelo entero. **No lo cortes con \`head\`**: partir el JSON a la mitad lo vuelve
ilegible y te deja adivinando lo que falta. Si pesa, empieza por \`counts\` para
saber qué buscar dentro de \`issues\`.

Si no responde, la app está cerrada: pídele a quien te lanzó que la abra, o
audita leyendo el vault a mano. **No inventes un diagnóstico.** Un reporte de
salud equivocado es peor que no tenerlo — se actúa sobre él.

## Paso 2 — Clasificar antes de reportar

\`issues\` viene como lista plana. **Divídela en tres cubetas.**

### Roto — hay que arreglarlo

| \`kind\` | Qué significa |
|---|---|
| \`broken-link\` | Un enlace no resuelve. Casi siempre un archivo que se movió. |
| \`missing-type\` · \`invalid-type\` | Fuera del vocabulario de \`CLAUDE.md\`. |
| \`missing-title\` · \`missing-author\` | Campos obligatorios ausentes. |
| \`created-after-updated\` | Fecha imposible: alguien la escribió mal. |
| \`non-slug-filename\` | Rompe URLs y enlaces. |
| \`source-without-resource\` | Una nota \`type: source\` que no apunta a su fuente no sirve de nada. |
| \`malformed-provenance\` | Marcadores \`<!-- ai -->\` desbalanceados. Ojo: los que están dentro de bloques de código son documentación, no atribución. |

### Por diseño — NO reportarlo como problema

| \`kind\` | Por qué está bien |
|---|---|
| \`no-created\` | La regla es dejarlo vacío antes que inventarlo. En un vault con material importado son cientos de notas y todas correctas. Dilo como **un** conteo, no como una lista. |
| \`mixed-without-markers\` | Legítimo cuando la mezcla se declaró a nivel de archivo. |

### Señal, no error — traerlo a la conversación

| Hallazgo | Qué preguntar |
|---|---|
| \`stale-active\` | ¿Sigue activo o ya se archivó en la práctica? Una nota de referencia sin tocar 40 días no dice lo mismo que un proyecto vivo. |
| \`orphans\` | ¿Falta enlazarlas, o son notas que nunca necesitan entradas — diario, plantillas, notas compañeras de un PDF? |

## Paso 3 — Proponer los arreglos, no aplicarlos

Presenta lo roto **agrupado por causa, no por archivo**. Cinco enlaces rotos por
una misma carpeta que se movió son **un** problema, no cinco.

Para cada grupo: qué pasó, cuántos archivos afecta, y el arreglo que propones.
**Espera confirmación.** Los arreglos en lote sobre un vault son exactamente
donde se pierde información.

Reglas al arreglar:

- **Nunca inventes \`created:\`.** Vacío es la respuesta correcta. El \`mtime\` del
  sistema dice cuándo se copió el archivo, no cuándo se escribió.
- **Renombrar a slug**: primero extrae al frontmatter cualquier fecha que venga
  en el nombre, después renombra. Nunca al revés — si no, la fecha se pierde.
- **Borrar contra archivar**: si la nota tiene enlaces entrantes, \`status:
  archived\` conserva el grafo y borrarla lo rompe. Propón archivar por defecto.
- **No reescribas el contenido de una nota** para arreglar metadatos. El texto es
  de quien lo escribió, aunque esté mal redactado.
- **Marca lo tuyo**: todo lo que escribas va envuelto en \`<!-- ai -->\` …
  \`<!-- /ai -->\`, y la nota pasa a \`author: mixed\` si ya tenía contenido humano.
${multi ? `- **Enlaces que cruzan de un bundle a otro** no pueden ser rutas relativas que
  se escapen de su raíz. Los bundles de este vault: ${arch.bundles.map((b) => `\`${b.id}\``).join(", ")}.
` : ""}${shared.length ? `- ⚠ **${shared.map((b) => `\`${b.id}\``).join(", ")} ${shared.length > 1 ? "son bundles compartidos" : "es un bundle compartido"}**: lo que
  cambies ahí se sincroniza con las demás personas que lo editen. Dilo antes de
  tocarlo y confirma aparte.
` : ""}
## Paso 4 — Qué falta escribir

\`candidates\` propone desde la estructura del grafo, no desde el contenido:

- **\`tag-cluster\`** — varias notas comparten etiqueta y ninguna las agrupa.
  Falta un artículo que las conecte.
- **\`co-cited\`** — dos notas que se citan juntas todo el tiempo pero no se
  enlazan entre sí. Suele haber un concepto en medio que nadie escribió.
- **\`orphan-cluster\`** — notas aisladas del mismo tema: algo que nadie ha
  indexado todavía.

**Filtra antes de sugerir.** Un candidato que no puedes justificar en una frase
es ruido. Prioriza los que cruzan temas — ahí aparecen las ideas que no se ven
leyendo una sola nota.

Si aceptan uno, el artículo **sintetiza y cita a sus fuentes, no las
reemplaza**: nace con \`author: agent\`, y cada nota fuente recibe un enlace de
vuelta envuelto en marcadores de procedencia.

## Paso 5 — Cerrar

Reporta en este orden:

1. Una línea de estado: notas, enlaces, rotos, aislados — y el delta contra la
   corrida anterior si lo sabes.
2. Lo roto, agrupado por causa, con el arreglo que propones.
3. Lo que es señal: proyectos estancados, huérfanos que sí importan.
4. Candidatos a artículo, **máximo tres**, cada uno con su porqué.

No cierres con «todo bien» si hay ochenta hallazgos por diseño. Di el número y
por qué no son problemas.

## Reglas que no se negocian

1. **Clasificar antes de reportar.** Una lista plana de ochenta hallazgos no es
   un reporte, es ruido.
2. **Confirmar antes de escribir.** Sobre todo en lote${shared.length ? ", y sobre todo en un bundle compartido" : ""}.
3. **Verificar después de arreglar.** Vuelve a pedir \`/api/health\` y confirma
   que los rotos bajaron. Un arreglo sin verificar no está hecho.
4. **No reindexes a mano.** La app reconstruye su índice sola a los pocos
   segundos de cualquier cambio en disco.
${localNote("audit")}`;
}

export function writeAuditSkill(vault: string, arch: Architecture, port = 4321): SkillWrite {
  return writeSkill(vault, "audit", auditSkill(arch, port));
}
