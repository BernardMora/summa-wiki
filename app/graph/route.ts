import { getT } from "@/lib/i18n.server.ts";

export const dynamic = "force-dynamic";

/**
 * Compatibility boundary for bookmarks and old history entries.
 *
 * The graph is workspace-only. Keeping this as an HTTP route—not a page that
 * calls `redirect()` while rendering—means `/graph` can never stream a
 * standalone shell before Next applies the redirect on the client.
 */
export function GET(req: Request) {
  const target = new URL("/workspace", req.url);
  target.searchParams.set("open", "graph:");
  target.searchParams.set("title", getT()("nav.graph"));
  return Response.redirect(target, 307);
}
