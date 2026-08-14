import { app, BrowserWindow, Menu, dialog, ipcMain, nativeImage, nativeTheme, shell } from "electron";
import { spawn } from "node:child_process";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveVault, rememberVault, readSettings, inspectVault } from "../src/appdata.mjs";

/**
 * Cascarón de escritorio — Fase 1.
 *
 * NO reimplementa nada: arranca el mismo `server.ts` que usa `npm run dev` y
 * carga http://localhost:PORT en una ventana nativa. Todo lo que ya funciona
 * (Next, las rutas de /api, la pty por WebSocket en PORT+1) sigue igual.
 *
 * El servidor corre como PROCESO HIJO con el Node del sistema, no dentro de
 * Electron, y eso es deliberado: `node-pty` es un módulo nativo compilado
 * contra el ABI de Node, no contra el de Electron. Cargándolo aquí habría que
 * pasar por `electron-rebuild` desde el primer día. Como hijo, node-pty ni se
 * entera de que Electron existe. Ese es el trabajo de la Fase 2 (empaquetar),
 * no de esta.
 *
 * Corolario: en Fase 1 la app se lanza desde una terminal (`npm run desktop`),
 * porque hereda el PATH de esa shell para encontrar `node`. Una app lanzada
 * desde el Dock recibe un PATH mínimo — otro problema de la Fase 2.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const PORT = Number(process.env.PORT ?? 4321);
const ORIGIN = `http://localhost:${PORT}`;

/**
 * El bundle se llama "Summa Wiki": la MARCA, no el contenido.
 *
 * En macOS el nombre de la barra de menús sale de `CFBundleName` en el
 * Info.plist, NO de `app.setName()` ni de la configuración del vault: es lo
 * único de la identidad que no se puede cambiar en caliente. Reescribir el
 * Info.plist del .app instalado sí cambiaría el rótulo, pero rompe la firma de
 * código y Gatekeeper se niega a abrirlo — no es un camino.
 *
 * Ojo con la palabra repetida: la app es "Summa Wiki" y la instancia del
 * usuario también se llama wiki —"Wiki de Ana"—. No chocan porque viven en
 * planos distintos: esto es el rótulo del programa, aquello es el título del
 * contenido, y lo segundo se configura en `wiki-config.json`. Si algún día se
 * ven juntos en pantalla y confunden, el que cede es este.
 */
app.setName("Summa Wiki");

/**
 * Identidad configurada por el usuario, leída del vault.
 *
 * Se lee directamente del disco en vez de pedir `/api/config` para poder
 * pintar el splash con el nombre correcto y poner el icono del Dock ANTES de
 * que el servidor esté en pie — que tarda segundos.
 *
 * La resolución del vault ya NO se repite aquí: sale de `src/appdata.mjs`, el
 * mismo módulo que usa `src/config.ts`. Antes eran dos líneas copiadas, y dos
 * copias de una regla son dos reglas en cuanto una de las dos cambie.
 */
function vaultConfig() {
  const { path: vault } = resolveVault();
  const fallback = { name: "Wiki", icon: null };
  if (!vault) return fallback;

  // `.summa/` primero, `04-Sistema/` después. En el PRIMER arranque tras la
  // Fase 11 este proceso lee antes de que el servidor haya migrado nada, así
  // que sin el segundo camino el splash saldría con el nombre de fábrica una
  // única vez — un parpadeo pequeño, pero gratuito de evitar.
  const candidates = [
    path.join(vault, ".summa", "config.json"),
    path.join(vault, "04-Sistema", "wiki-config.json"),
  ];
  for (const file of candidates) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(file, "utf8")); } catch { continue; }
    const name = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : fallback.name;
    let icon = null;
    if (typeof raw.icon === "string" && raw.icon.trim()) {
      const abs = path.resolve(vault, raw.icon.trim());
      // Contención dentro del vault, igual que en configIconPath().
      if (abs.startsWith(path.resolve(vault) + path.sep) && fs.existsSync(abs)) icon = abs;
    }
    return { name, icon };
  }
  return fallback;
}

// ─── El servidor ────────────────────────────────────────────────────────────

/**
 * ¿Hay algo escuchando en el puerto? Una conexión TCP, no una petición HTTP.
 *
 * La primera versión preguntaba por HTTP con 800 ms de tolerancia, y estaba
 * mal por dos motivos que se dan a la vez en `next dev`: compilar la primera
 * ruta tarda segundos, y un `.next` desincronizado responde 500. Ninguna de
 * las dos cosas significa "no hay servidor", pero ambas hacían fallar la
 * comprobación — así que se lanzaba un segundo servidor que moría en
 * EADDRINUSE contra el que ya estaba corriendo. El puerto abierto es el hecho
 * que de verdad se quería medir, y se mide en microsegundos.
 */
function listening(timeout = 400) {
  return new Promise((resolve) => {
    const sock = net.connect({ port: PORT, host: "127.0.0.1" });
    const done = (v) => { sock.destroy(); resolve(v); };
    sock.setTimeout(timeout);
    sock.once("connect", () => done(true));
    sock.once("timeout", () => done(false));
    sock.once("error", () => done(false));
  });
}

/**
 * Basta con que el puerto abra: `loadURL` se encarga de esperar la respuesta,
 * y mientras tanto la ventana sigue mostrando loading.html — Electron no
 * descarta la página actual hasta que la nueva navegación confirma.
 */
async function waitForServer(ms = 90_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await listening()) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

let server = null;
let quitting = false;

function startServer() {
  const node = process.env.WIKI_NODE || "node";

  // Electron marca su propio entorno; el hijo debe verse como un `node`
  // cualquiera. Lo demás (npm_*, CLAUDE_CODE_*) lo limpia server.ts por su
  // cuenta antes de abrir cada shell — ver shellEnv() allá.
  const env = { ...process.env, PORT: String(PORT), UV_THREADPOOL_SIZE: "64" };
  for (const k of Object.keys(env)) if (k.startsWith("ELECTRON_")) delete env[k];

  server = spawn(node, ["--experimental-strip-types", "--no-warnings", "server.ts"], {
    cwd: ROOT,
    env,
    // Grupo de procesos propio: al salir se mata el grupo entero, no solo al
    // node — si no, las shells que la terminal integrada dejó abiertas
    // sobreviven al cierre de la ventana.
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });

  server.stdout.on("data", (b) => process.stdout.write(`[server] ${b}`));
  server.stderr.on("data", (b) => process.stderr.write(`[server] ${b}`));
  server.on("error", (e) => {
    dialog.showErrorBox(
      "No se pudo arrancar el servidor",
      `No se encontró \`${node}\`.\n\n${e.message}\n\n` +
      `Lanza la app desde una terminal (npm run desktop) o exporta WIKI_NODE ` +
      `con la ruta absoluta a node.`,
    );
    app.quit();
  });

  // Si el servidor se cae solo (un error de compilación fatal, un puerto que
  // se ocupó entre la comprobación y el spawn) la ventana se quedaría en el
  // splash para siempre sin decir por qué.
  server.on("exit", (code, signal) => {
    if (quitting || signal) return;
    dialog.showErrorBox(
      "El servidor se detuvo",
      `\`server.ts\` terminó con código ${code}. Revisa la consola de donde ` +
      `lanzaste la app: el detalle sale con el prefijo [server].`,
    );
  });
}

/**
 * @param {boolean} forQuit `true` al cerrar la app, `false` al reiniciar.
 *
 * La distinción importa por el diálogo de "el servidor se detuvo": al salir,
 * la muerte del hijo es lo esperado y avisar sería ruido; al reiniciar, el
 * hijo también muere a propósito, pero el proceso tiene que volver a estar
 * atento a una caída de verdad en cuanto arranque el nuevo. Un único flag
 * `quitting` que solo subía dejaba la app muda para siempre después del
 * primer cambio de vault.
 */
function stopServer(forQuit = true) {
  quitting = true;
  if (server?.pid) {
    try { process.kill(-server.pid, "SIGTERM"); } catch { /* ya se fue */ }
  }
  server = null;
  if (!forQuit) quitting = false;
}

/** ¿Se soltó ya el puerto? Tras SIGTERM el cierre no es instantáneo. */
async function waitForPortFree(ms = 5_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (!(await listening(150))) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/**
 * Levanta el servidor otra vez, contra lo que diga la configuración AHORA.
 *
 * Es el mecanismo entero del cambio de vault. `VAULT` se resuelve al cargar
 * `src/config.ts` y de ella cuelgan los bundles, las rutas de `.summa/` y el
 * índice; un proceso nuevo es la forma barata y sin sorpresas de que todo eso
 * se recalcule a la vez. Reemplazarlo en caliente significaría invalidar seis
 * cachés en el orden correcto para ahorrar dos segundos.
 */
async function restartServer() {
  stopServer(false);
  if (!(await waitForPortFree())) {
    // El puerto sigue ocupado: quien lo tiene no es nuestro hijo (un
    // `npm run dev` aparte, por ejemplo). Arrancar otro solo produciría un
    // EADDRINUSE ilegible.
    dialog.showErrorBox(
      "No se pudo reiniciar",
      `El puerto ${PORT} sigue ocupado por otro proceso. Ciérralo y vuelve a intentarlo.`,
    );
    return false;
  }
  startServer();
  if (!(await waitForServer())) return false;
  await win?.loadURL(ORIGIN).catch(() => {});
  return true;
}

// ─── Estado de la ventana ───────────────────────────────────────────────────

const STATE = path.join(app.getPath("userData"), "window-state.json");

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE, "utf8")); } catch { return {}; }
}

function writeState(win) {
  if (!win || win.isDestroyed()) return;
  const b = win.isMaximized() || win.isFullScreen() ? win.getNormalBounds() : win.getBounds();
  try { fs.writeFileSync(STATE, JSON.stringify({ ...b, maximized: win.isMaximized() })); } catch { /* no es crítico */ }
}

// ─── Ventana ────────────────────────────────────────────────────────────────

let win = null;

async function createWindow() {
  const s = readState();

  win = new BrowserWindow({
    width: s.width ?? 1440,
    height: s.height ?? 900,
    x: s.x, y: s.y,
    minWidth: 900,
    minHeight: 560,
    // Sin barra de título: el masthead ocupa el borde superior. La sangría
    // para los semáforos y la región arrastrable las pone globals.css bajo
    // [data-desktop] — ver preload.cjs.
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#101418" : "#ffffff",
    show: false,
    webPreferences: { preload: path.join(HERE, "preload.cjs") },
  });

  if (s.maximized) win.maximize();
  win.once("ready-to-show", () => win.show());

  // Enlaces externos al navegador del sistema, no dentro de la app: una
  // ventana de Electron sin barra de direcciones es una ratonera.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(ORIGIN)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(ORIGIN) && !url.startsWith("file://")) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  for (const ev of ["resize", "move", "close"]) win.on(ev, () => writeState(win));
  win.on("closed", () => { win = null; });

  // Next tarda unos segundos en compilar la primera ruta; una ventana en
  // blanco parece una app rota. El nombre va por query string porque el splash
  // se pinta antes de que exista servidor al que preguntárselo.
  await win.loadFile(path.join(HERE, "loading.html"), { query: { name: brand.name } });

  if (!(await listening())) startServer();

  if (await waitForServer()) {
    // Cerrar la ventana mientras Next compila la primera ruta aborta esta
    // navegación, y `loadURL` rechaza con ERR_FAILED. No es un error que
    // haya que mostrar: es la salida normal de quien se cansa de esperar.
    await win.loadURL(ORIGIN).catch(() => {});
  } else {
    await win.webContents.executeJavaScript(
      `document.body.dataset.state = "error"`,
    ).catch(() => {});
  }
}

// ─── Menú ───────────────────────────────────────────────────────────────────

/**
 * Los ítems de app no llaman a ninguna API nueva: reinyectan el mismo evento
 * de teclado que la página ya escucha (QuickSwitcher.tsx:48, ArticlePane.tsx:144)
 * o usan el hook que el workspace ya publica en `window.__wikiOpen`
 * (Tabs.tsx:57). Así el menú nativo existe sin que la app tenga que saber que
 * corre dentro de Electron.
 *
 * El acelerador del menú se come la tecla antes que la página, por eso hace
 * falta reinyectarla — no hay doble disparo.
 */
function press(key, mods = {}) {
  const init = JSON.stringify({ key, bubbles: true, cancelable: true, metaKey: true, ...mods });
  win?.webContents.executeJavaScript(
    `window.dispatchEvent(new KeyboardEvent("keydown", ${init}))`,
  ).catch(() => {});
}

/**
 * `__wikiOpenTab` y no `__wikiOpen`: el segundo solo existe donde el Workspace
 * está montado, así que desde la portada este ítem del menú no hacía nada, sin
 * decirlo. El primero lo publica TabsProvider, que vive en el layout, y trae
 * de serie la navegación a /workspace cuando no hay panes.
 */
function newTerminal() {
  win?.webContents.executeJavaScript(
    `window.__wikiOpenTab && window.__wikiOpenTab("term:" + Date.now().toString(36), "Terminal", true)`,
  ).catch(() => {});
}

/**
 * Elegir carpeta y reiniciar contra ella. Lo comparten el ítem de menú y el
 * botón del panel de configuración, vía IPC.
 *
 * @param {string|null} dir Ruta ya elegida, o `null` para abrir el diálogo.
 * @returns {Promise<{ok: boolean, vault?: string, reason?: string}>}
 */
async function openVault(dir = null) {
  let target = dir;
  if (!target) {
    const r = await dialog.showOpenDialog(win ?? undefined, {
      title: "Elegir vault",
      message: "La carpeta donde vive tu base de conocimiento",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Abrir",
    });
    if (r.canceled || !r.filePaths[0]) return { ok: false, reason: "cancelled" };
    target = r.filePaths[0];
  }

  const kind = inspectVault(target);
  if (kind === "missing") return { ok: false, reason: "missing" };

  // Una carpeta vacía se puede elegir —es el vault que aún no existe— pero no
  // en silencio: sin este aviso, elegir la carpeta equivocada da una app
  // vacía sin explicación, y el usuario no tiene forma de distinguir eso de
  // una app rota.
  if (kind === "empty") {
    const { response } = await dialog.showMessageBox(win ?? undefined, {
      type: "question",
      buttons: ["Usarla igual", "Cancelar"],
      defaultId: 1,
      cancelId: 1,
      message: "Esa carpeta está vacía",
      detail: "No se encontró ningún archivo .md adentro. Puedes usarla como vault nuevo, pero al abrirla no habrá nada que leer.",
    });
    if (response !== 0) return { ok: false, reason: "cancelled" };
  }

  rememberVault(target);
  brand = vaultConfig();
  applyDockIcon();
  buildMenu();
  const ok = await restartServer();
  return { ok, vault: target };
}

/** Los últimos vaults abiertos, para el submenú. Se reconstruye al cambiar. */
function recentsSubmenu() {
  const { recents } = readSettings();
  const current = resolveVault().path;
  const items = recents
    .filter((r) => r !== current)
    .slice(0, 8)
    .map((r) => ({ label: r.replace(process.env.HOME ?? process.env.USERPROFILE ?? "~", "~"), click: () => openVault(r) }));
  return items.length ? items : [{ label: "Sin vaults recientes", enabled: false }];
}

function buildMenu() {
  const mac = process.platform === "darwin";

  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(mac ? [{ role: "appMenu" }] : []),
    {
      label: "Archivo",
      submenu: [
        { label: "Abrir nota…", accelerator: "CmdOrCtrl+O", click: () => press("o") },
        { label: "Nueva terminal", accelerator: "CmdOrCtrl+T", click: newTerminal },
        { type: "separator" },
        { label: "Abrir vault…", accelerator: "CmdOrCtrl+Shift+O", click: () => openVault() },
        {
          label: "Nuevo vault…",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => win?.loadURL(`${ORIGIN}/setup?new=1`).catch(() => {}),
        },
        { label: "Vaults recientes", submenu: recentsSubmenu() },
        { type: "separator" },
        { label: "Guardar", accelerator: "CmdOrCtrl+S", click: () => press("s") },
        { type: "separator" },
        mac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "Ver",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
        // Sin ítems de zoom a propósito: ZoomGuard.tsx bloquea el zoom en la
        // página, y un menú que ofrece lo que la app rechaza miente.
      ],
    },
    { role: "windowMenu" },
  ]));
}

// ─── Ciclo de vida ──────────────────────────────────────────────────────────

/** Identidad leída una vez al arrancar; el splash y el Dock la usan. */
let brand = { name: "Wiki", icon: null };

/*
 * Icono del Dock, en caliente. Es la mitad de la identidad que NO está
 * atrapada en el bundle, y es lo que quita el logo de Electron mientras se
 * corre sin empaquetar.
 *
 * Preferencia: el icono que el usuario haya puesto en la configuración de su
 * vault; si no hay, el de la app (`build/icon.png`, generado con `npm run
 * icons` desde public/wiki-icon.svg). Antes solo se ponía el del usuario, así
 * que sin configurar nada salía el átomo de Electron.
 *
 * Es función y no código suelto porque el cambio de vault la vuelve a llamar:
 * abrir otro vault cambia la identidad, y el Dock tiene que seguirla.
 *
 * El del Finder y Launchpad siguen saliendo del .icns del bundle: eso solo se
 * arregla empaquetando.
 */
function applyDockIcon() {
  if (process.platform !== "darwin") return;
  for (const candidate of [brand.icon, path.join(ROOT, "build", "icon.png")]) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    const img = nativeImage.createFromPath(candidate);
    if (!img.isEmpty()) { app.dock?.setIcon(img); break; }
  }
}

app.whenReady().then(() => {
  brand = vaultConfig();
  applyDockIcon();
  buildMenu();

  // El panel de configuración de la página pide estas dos por IPC. El diálogo
  // nativo y matar un proceso hijo son cosas que solo el proceso principal
  // puede hacer; el servidor HTTP no tiene acceso a ninguna de las dos.
  ipcMain.handle("vault:pick", async () => {
    const r = await openVault();
    return r.ok ? r.vault : null;
  });
  ipcMain.handle("vault:switch", async (_e, dir) => {
    if (typeof dir !== "string" || !dir.trim()) return { ok: false, reason: "missing" };
    return openVault(dir);
  });
  ipcMain.handle("dialog:folder", async (_e, title) => {
    const r = await dialog.showOpenDialog(win ?? undefined, {
      title: typeof title === "string" && title ? title : "Elegir carpeta",
      properties: ["openDirectory", "createDirectory"],
      buttonLabel: "Elegir",
    });
    return r.canceled ? null : (r.filePaths[0] ?? null);
  });

  createWindow();
  app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

// Convención de macOS: cerrar la ventana no cierra la app. El servidor sigue
// vivo, así que reabrir con el ícono del Dock es instantáneo.
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
app.on("before-quit", stopServer);
process.on("exit", stopServer);
