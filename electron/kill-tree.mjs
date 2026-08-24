import { spawn } from "node:child_process";

/**
 * Kill the server and everything it opened, on all three platforms.
 *
 * ⚠ `process.kill(-pid)` DOES NOT EXIST on Windows. A negative pid does not
 * name a process group there: it is an invalid pid, and the call throws
 * immediately. Because it sat inside an empty `try {} catch {}`, on Windows the
 * app shut the server down by telling nobody — the child stayed alive, holding
 * its port, with its own Next inside.
 *
 * That single fault produced both of the failures users actually saw:
 *
 * - **Switching vaults never worked** (issue #9). `restartServer()` kills,
 *   waits for the port to be released, and starts again. On Windows nothing
 *   died, the port was never released, and five seconds later the "could not
 *   restart" dialog appeared. First-run onboarding goes through that path —
 *   opening the example vault IS a vault switch — and it had already written
 *   the path into settings before failing: from that moment the app had a
 *   vault, and onboarding never showed again.
 * - **The port stayed occupied** (issue #10). A server that outlives the app
 *   takes its block of ports with it until somebody kills it by hand.
 *
 * `taskkill /T /F` is what `scripts/smoke-package.mjs` already used for the
 * same job, and that duplication is what kept the bug invisible for so long:
 * the test knew how a process is killed on Windows, and the app did not.
 *
 * Dependencies are injectable so both branches can be tested from a single
 * platform; nothing passes them in production.
 *
 * @param {number} pid
 * @param {object} [deps]
 * @param {string} [deps.platform]
 * @param {(cmd: string, args: string[], options?: object) => unknown} [deps.run]
 * @param {(pid: number, signal: string) => void} [deps.kill]
 * @returns {boolean} Whether the kill was requested — not that the process is
 *   already gone. Neither route is instantaneous, which is why callers still
 *   wait for the port to be released.
 */
export function killTree(pid, deps = {}) {
  const { platform = process.platform, run = spawn, kill = process.kill } = deps;
  if (!Number.isInteger(pid) || pid <= 0) return false;

  if (platform === "win32") {
    // `/T` takes the whole tree, which is the equivalent of killing the group.
    // `/F` because a Next server with open requests does not honour the polite
    // request, and there is nothing to save here: the state lives on disk.
    try { run("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" }); }
    catch { return false; }
    return true;
  }

  // The negative pid is the GROUP, and that is why the spawn asks for
  // `detached: true` on POSIX: without a group of its own, this call would take
  // the caller down with it. On Windows `detached` is not needed — `/T` walks
  // the tree — and it would open a new console window on every launch.
  try { kill(-pid, "SIGTERM"); } catch { return false; }
  return true;
}
