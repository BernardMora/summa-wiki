/**
 * El puente que expone `electron/preload.cjs`.
 *
 * Declarado una sola vez y en un `.d.ts`: cuando cada componente traía su
 * propio `declare global`, dos versiones del mismo tipo se contradecían y
 * TypeScript marcaba "Subsequent property declarations must have the same
 * type" — que es el aviso correcto para el problema real, que era tener la
 * interfaz del preload escrita en dos sitios.
 *
 * Ausente fuera de Electron, y esa ausencia es la señal que usa la interfaz
 * para caer a un campo de texto. Por eso es opcional.
 */
interface SummaBridge {
  /** Elige un vault Y reinicia el servidor contra él. */
  pickVault: () => Promise<string | null>;
  switchVault: (dir: string) => Promise<{ ok: boolean; vault?: string; reason?: string }>;
  /** Solo elige una carpeta y devuelve la ruta; no toca nada. */
  chooseFolder: (title?: string) => Promise<string | null>;
}

interface Window {
  summa?: SummaBridge;
  /**
   * Abre una pestaña en el workspace. Lo publica `TabsProvider`, que vive en el
   * layout, así que existe en toda la app — a diferencia de `__wikiOpen`, que
   * solo existe donde el Workspace está montado. Lo usan el menú nativo de
   * Electron y la ingesta.
   */
  __wikiOpenTab?: (id: string, title: string, activate?: boolean) => void;
}
