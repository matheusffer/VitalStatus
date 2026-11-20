// Gera site/og-image.png (1200x630) a partir de design/og-image.html usando o
// Chrome ou o Edge instalado. Uso: npm run og
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const candidatos = [
  process.env.CHROME_BIN,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);
const navegador = candidatos.find((c) => existsSync(c));
if (!navegador) {
  console.error("Chrome/Edge não encontrado. Defina CHROME_BIN com o caminho do executável.");
  process.exit(1);
}
const saida = join(raiz, "site", "og-image.png");
execFileSync(navegador, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--force-device-scale-factor=1",
  "--window-size=1200,630",
  "--virtual-time-budget=3000",
  `--screenshot=${saida}`,
  pathToFileURL(join(raiz, "design", "og-image.html")).href,
], { stdio: "inherit" });
console.log("Gerado:", saida);
