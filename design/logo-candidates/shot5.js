const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const DIR = "/Users/bernardomr/Documents/aios/05-Projects/summa-wiki/app/design/logo-candidates";

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 620, height: 1500, show: false });
  await win.loadFile(DIR + "/sheet5.html");
  await new Promise((r) => setTimeout(r, 1200));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(DIR + "/sheet5.png", img.toPNG());
  console.log("ok:", fs.statSync(DIR + "/sheet5.png").size, "bytes");
  app.quit();
}).catch((e) => { console.error("fallo:", e.message); app.exit(1); });
