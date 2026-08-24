import test from "node:test";
import assert from "node:assert/strict";

import { killTree } from "../electron/kill-tree.mjs";
import { DEFAULT_PORT, PORTS_NEEDED, resolvePort } from "../src/ports.mjs";

/*
 * Two bugs with one root cause, and neither could be seen from the platform
 * this app is developed on. On Windows the server child was never killed —
 * `process.kill(-pid)` throws there instead of signalling a process group — so
 * the port stayed occupied (#10) and switching vaults, which is how first-run
 * onboarding opens the example vault, always failed (#9).
 *
 * The platform is injected rather than detected so both branches run in CI on
 * all three operating systems, not only on the one that happens to be Windows.
 */

test("on Windows the server is killed with taskkill over the whole tree", () => {
  const calls: Array<[string, string[]]> = [];
  const ok = killTree(4242, {
    platform: "win32",
    run: (cmd: string, args: string[]) => { calls.push([cmd, args]); },
    kill: () => assert.fail("process.kill must not be used on Windows"),
  });

  assert.equal(ok, true);
  assert.equal(calls.length, 1);
  const [cmd, args] = calls[0];
  assert.equal(cmd, "taskkill");
  assert.deepEqual(args, ["/pid", "4242", "/T", "/F"]);
});

test("on POSIX the server is killed by process group", () => {
  const signalled: Array<[number, string]> = [];
  const ok = killTree(4242, {
    platform: "darwin",
    run: () => assert.fail("taskkill does not exist outside Windows"),
    kill: (pid: number, signal: string) => { signalled.push([pid, signal]); },
  });

  assert.equal(ok, true);
  assert.deepEqual(signalled, [[-4242, "SIGTERM"]]);
});

test("a server that never started is not killed by accident", () => {
  for (const pid of [0, -1, Number.NaN, undefined as unknown as number]) {
    assert.equal(
      killTree(pid, {
        platform: "win32",
        run: () => assert.fail(`killTree(${String(pid)}) must be a no-op`),
        kill: () => assert.fail(`killTree(${String(pid)}) must be a no-op`),
      }),
      false,
    );
  }
});

test("the default port is out of the way of dev servers and of Windows' dynamic range", () => {
  // 4321 is Astro's dev server and IANA's rwhois: it is taken on any machine
  // that has opened an Astro project, which is how #10 was reported.
  assert.notEqual(DEFAULT_PORT, 4321);
  // Windows reserves blocks inside the dynamic range (Hyper-V, WinNAT), where a
  // bind fails with EACCES rather than with "in use".
  assert.ok(DEFAULT_PORT < 49152);
  // Chromium refuses to load a page from its blocked ports, and Chromium is
  // what renders the window.
  assert.ok(DEFAULT_PORT > 10080);
});

test("PORT decides the run, and only a usable value does", () => {
  assert.equal(resolvePort({ PORT: "51000" }), 51000);
  // `Number("")` is 0 and `Number(undefined)` is NaN. Port 0 would bind
  // "anything" and hand the agent a URL for a port nobody is listening on.
  for (const PORT of ["", "0", "not-a-port", "65536", "-1", undefined]) {
    assert.equal(resolvePort({ PORT }), DEFAULT_PORT);
  }
});

test("the agent socket sits inside the reserved block", () => {
  // server.ts binds `port + 1`; the desktop probe reserves PORTS_NEEDED in a
  // row. If these ever disagree, a second window silently steals the first
  // one's agent port.
  assert.ok(PORTS_NEEDED >= 2);
});
