/**
 * CJS a propósito, no ESM: con `sandbox: true` (el default desde Electron 20)
 * el preload se carga como CommonJS, y el `.cjs` lo deja explícito frente al
 * `"type": "module"` del package.json.
 *
 * Lo único que hace es marcar el documento como "corriendo en escritorio",
 * para que globals.css sepa dejar sitio a los semáforos de macOS y declarar
 * el masthead como región arrastrable. Sin esto la ventana sin barra de
 * título no se puede mover. En el navegador el atributo no existe y las
 * reglas no aplican — la versión web queda intacta.
 */
const { contextBridge, ipcRenderer } = require("electron");

const mark = () => {
  document.documentElement.dataset.desktop =
    process.platform === "darwin" ? "mac" : process.platform;
};

if (document.documentElement) mark();
else document.addEventListener("DOMContentLoaded", mark);

/**
 * Lo único que la página no puede hacer sola: abrir el selector de carpetas
 * del sistema y pedir el reinicio del servidor.
 *
 * Elegir el vault por HTTP no alcanza. `/api/vault` acepta una ruta escrita a
 * mano —y eso es lo que se usa en el navegador durante el desarrollo— pero
 * pedirle a alguien que teclee la ruta absoluta de una carpeta es una interfaz
 * que solo tolera quien ya sabe lo que hace. El diálogo nativo es la versión
 * para todos los demás.
 *
 * `window.summa` no existe fuera de Electron, y esa ausencia es la señal que
 * usa la interfaz para caer al campo de texto. No hace falta preguntar de otra
 * forma si se está en escritorio.
 */
contextBridge.exposeInMainWorld("summa", {
  /** @returns {Promise<string|null>} ruta elegida, o null si se canceló */
  pickVault: () => ipcRenderer.invoke("vault:pick"),
  /** Guarda el vault y reinicia el servidor contra él. */
  switchVault: (dir) => ipcRenderer.invoke("vault:switch", dir),
  /**
   * Solo elegir una carpeta: devuelve la ruta y no toca nada.
   *
   * Distinto de `pickVault`, que elige Y reinicia. Al crear un vault hace
   * falta la ruta antes de escribir nada — todavía queda por decidir el
   * nombre y la arquitectura, y reiniciar contra una carpeta vacía a medio
   * asistente dejaría al usuario mirando "este vault está vacío".
   */
  chooseFolder: (title) => ipcRenderer.invoke("dialog:folder", title),
});
