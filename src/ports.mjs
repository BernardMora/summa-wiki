/**
 * The app's ports, in one place.
 *
 * It is `.mjs` for the same reason `appdata.mjs` is: both processes import it,
 * and `electron/main.js` runs inside Electron, without
 * `--experimental-strip-types`. Before this, the number 4321 was written by
 * hand in six files — the server, the desktop port probe, the MCP URL handed to
 * the agent, the audit skill, the vault scaffolder and the `start` script — and
 * none of them knew about the others.
 */

/**
 * The default port.
 *
 * **It is not 4321 any more, and the change is not cosmetic.** 4321 is Astro's
 * default dev-server port and IANA's `rwhois`: on a machine that has ever
 * opened an Astro project it is taken, and that is what people who installed
 * the app on Windows ran into (issue #10). The probe in `electron/main.js`
 * knows how to jump to another block, but a default that collides spends that
 * mechanism on the very first launch — exactly when the user has no way to tell
 * what happened.
 *
 * 43210 satisfies the three conditions that matter:
 *
 * - **Unassigned at IANA**, and away from the registered range where developer
 *   tooling clusters (3000, 4321, 5173, 8080…).
 * - **Below 49152**, where Windows' dynamic range begins. Hyper-V and WinNAT
 *   RESERVE whole blocks in there, and a `bind` against one of them does not
 *   fail with "in use" but with EACCES — an error that looks nothing like its
 *   cause.
 * - **Outside Chromium's blocked-port list**, since Chromium is what loads the
 *   page inside Electron. A port from that list would serve HTTP perfectly well
 *   and the window would still refuse to open it.
 */
export const DEFAULT_PORT = 43210;

/**
 * How many consecutive ports the server needs: Next's pages on `PORT` and the
 * agent WebSocket on `PORT + 1` (see `server.ts`).
 *
 * Declared rather than written by hand in the probe loop because it already
 * drifted once: while the built-in terminal existed the server bound THREE
 * ports and the probe still reserved two, so the third one leaked into the next
 * window's block.
 */
export const PORTS_NEEDED = 2;

/**
 * The port for THIS run.
 *
 * `PORT` is set by the desktop shell after probing for a free block, so reading
 * it is the only way the server, the MCP URL and the audit skill point at the
 * same place when two windows are open.
 *
 * The range is validated along with the type: `Number("")` is 0 and
 * `Number(undefined)` is NaN, and both have to fall back to the default instead
 * of trying to bind port 0 — which on POSIX means "give me any", and would hand
 * out a port different from the one the app told the agent about.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {number}
 */
export function resolvePort(env = process.env) {
  const port = Number(env.PORT);
  return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PORT;
}
