"use client";

/**
 * Vault-relative path as a breadcrumb. Clicking a folder reveals it in the
 * Archivos panel on the left.
 *
 * The sidebar lives in a different subtree of the layout, so the two talk over
 * a DOM event rather than threading a provider through the whole app for one
 * interaction.
 */
export const REVEAL_EVENT = "wiki:reveal";

export function revealFolder(rel: string) {
  window.dispatchEvent(new CustomEvent(REVEAL_EVENT, { detail: rel }));
}

/** Keep the first folder and the last two, collapsing the middle to "..". */
function collapse(parts: string[]): (string | null)[] {
  if (parts.length <= 4) return parts;
  return [parts[0], null, ...parts.slice(-2)];
}

export default function Crumb({ vaultPath }: { vaultPath: string }) {
  const parts = vaultPath.split("/");
  const file = parts.pop() ?? "";
  const shown = collapse(parts);

  // Rebuild the real path for each visible folder, since collapsing hides some.
  let cursor = 0;
  const withPaths = shown.map((seg) => {
    if (seg === null) return { seg: null, full: "" };
    // Find this segment at or after the cursor so repeats resolve correctly.
    const idx = parts.indexOf(seg, cursor);
    cursor = idx + 1;
    return { seg, full: parts.slice(0, idx + 1).join("/") };
  });

  return (
    <span className="crumb" title={vaultPath}>
      {withPaths.map((p, i) => (
        <span key={i}>
          {p.seg === null ? (
            <span className="crumb-gap" title={parts.join("/")}>..</span>
          ) : (
            <a
              href="#"
              onClick={(e) => { e.preventDefault(); revealFolder(p.full); }}
              title={`Ver ${p.full} en Archivos`}
            >
              {p.seg}
            </a>
          )}
          <span className="crumb-sep">/</span>
        </span>
      ))}
      <span className="crumb-file">{file}</span>
    </span>
  );
}
