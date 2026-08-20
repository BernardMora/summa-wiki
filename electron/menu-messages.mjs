/**
 * Las cadenas del menú nativo y de los diálogos del sistema.
 *
 * Duplican el MECANISMO de `lib/messages/`, no su contenido, y viven aparte por
 * una razón dura: el proceso principal de Electron es JavaScript plano, y las
 * tablas de la interfaz son TypeScript que solo existe después de que Next las
 * compile. Main arranca antes que eso y no puede importarlas.
 *
 * Son pocas cadenas y ninguna se comparte con la página —el menú de macOS
 * no dice nada que la interfaz también diga— así que no hay traducción que
 * pueda quedar desincronizada entre las dos tablas. Si algún día se solapan,
 * lo correcto es mover las compartidas a un `.mjs` que ambos lados importen,
 * no importar `lib/messages` desde aquí.
 *
 * Los ítems con `role:` de Electron (Deshacer, Copiar, Recargar, Pantalla
 * completa, la del menú de la app) NO están aquí: Electron los traduce solo
 * usando el idioma del sistema. Solo van los `label:` propios.
 */

export const MENU = {
  en: {
    file: "File",
    openNote: "Open note…",
    newTerminal: "New terminal",
    openVault: "Open vault…",
    newVault: "New vault…",
    recentVaults: "Recent vaults",
    noRecents: "No recent vaults",
    save: "Save",
    view: "View",
    chooseFolder: "Choose folder",
    choose: "Choose",
    // Diálogos: el título va corto porque macOS lo pone en negritas sobre el
    // cuerpo, y Windows lo mete en la barra de la ventana.
    serverFailedTitle: "Couldn't start the server",
    serverFailedBody: "{node} not found.\n\n{message}\n\nLaunch the app from a terminal (npm run desktop), or export WIKI_NODE with the absolute path to node.",
    serverStoppedTitle: "The server stopped",
    serverStoppedBody: "server.ts exited with code {code}.\n\nError log:\n{log}",
    restartFailedTitle: "Couldn't restart",
    restartFailedBody: "Port {port} is still held by another process. Close it and try again.",
    pickVaultTitle: "Choose vault",
    pickVaultMessage: "The folder where your knowledge base lives",
    pickVaultButton: "Open",
    emptyVaultMessage: "That folder is empty",
    emptyVaultDetail: "No .md files were found inside. You can use it as a new vault, but there will be nothing to read when it opens.",
    emptyVaultUseAnyway: "Use it anyway",
    emptyVaultCancel: "Cancel",
    externalLinkTitle: "Open external link?",
    externalLinkMessage: "Do you want to open this link in your browser?",
    externalLinkOpen: "Open",
    externalLinkCancel: "Cancel",
  },
  es: {
    file: "Archivo",
    openNote: "Abrir nota…",
    newTerminal: "Nueva terminal",
    openVault: "Abrir vault…",
    newVault: "Nuevo vault…",
    recentVaults: "Vaults recientes",
    noRecents: "Sin vaults recientes",
    save: "Guardar",
    view: "Ver",
    chooseFolder: "Elegir carpeta",
    choose: "Elegir",
    serverFailedTitle: "No se pudo arrancar el servidor",
    serverFailedBody: "No se encontró {node}.\n\n{message}\n\nLanza la app desde una terminal (npm run desktop) o exporta WIKI_NODE con la ruta absoluta a node.",
    serverStoppedTitle: "El servidor se detuvo",
    serverStoppedBody: "server.ts terminó con código {code}.\n\nLog de error:\n{log}",
    restartFailedTitle: "No se pudo reiniciar",
    restartFailedBody: "El puerto {port} sigue ocupado por otro proceso. Ciérralo y vuelve a intentarlo.",
    pickVaultTitle: "Elegir vault",
    pickVaultMessage: "La carpeta donde vive tu base de conocimiento",
    pickVaultButton: "Abrir",
    emptyVaultMessage: "Esa carpeta está vacía",
    emptyVaultDetail: "No se encontró ningún archivo .md adentro. Puedes usarla como vault nuevo, pero al abrirla no habrá nada que leer.",
    emptyVaultUseAnyway: "Usarla igual",
    emptyVaultCancel: "Cancelar",
    externalLinkTitle: "¿Abrir enlace externo?",
    externalLinkMessage: "¿Quieres abrir este enlace en el navegador?",
    externalLinkOpen: "Abrir",
    externalLinkCancel: "Cancelar",
  },
};

/** El traductor del proceso principal. Mismo contrato que `makeT` de la página. */
export function menuT(locale) {
  const table = MENU[locale] ?? MENU.en;
  return (key, vars) => {
    const raw = table[key] ?? MENU.en[key] ?? key;
    return vars
      ? raw.replace(/\{(\w+)\}/g, (whole, k) => (k in vars ? String(vars[k]) : whole))
      : raw;
  };
}
