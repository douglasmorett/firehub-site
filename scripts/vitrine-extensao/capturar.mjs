/**
 * Tira as capturas 1280x800 da ficha na Chrome Web Store a partir do popup
 * REAL da extensão (cena.html + stub.js). Rode depois do npm run
 * extensao:build, porque o build limpa build/chrome-store/.
 *
 * Uso: node scripts/vitrine-extensao/capturar.mjs
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const raiz = path.resolve(import.meta.dirname, "..", "..");
const destino = path.join(raiz, "build", "chrome-store", "loja");
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".png": "image/png", ".css": "text/css" };
const CENAS = ["automatico", "login", "manual"];

// cena.html busca o popup.html por fetch, então precisa de HTTP, não file://.
const servidor = http.createServer((req, res) => {
  const arquivo = path.join(raiz, decodeURIComponent(req.url.split("?")[0]));
  if (!arquivo.startsWith(raiz)) { res.writeHead(403); res.end(); return; }
  fs.readFile(arquivo, (erro, corpo) => {
    if (erro) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "Content-Type": TIPOS[path.extname(arquivo)] || "application/octet-stream" });
    res.end(corpo);
  });
});
await new Promise((ok) => servidor.listen(0, ok));
const porta = servidor.address().port;

fs.mkdirSync(destino, { recursive: true });
const navegador = await chromium.launch();
try {
  const pagina = await navegador.newPage({ viewport: { width: 1280, height: 800 } });
  for (const [i, cena] of CENAS.entries()) {
    await pagina.goto(`http://localhost:${porta}/scripts/vitrine-extensao/cena.html?c=${cena}`);
    await pagina.waitForTimeout(1500);
    const arquivo = path.join(destino, `captura-${i + 1}-${cena}.png`);
    await pagina.screenshot({ path: arquivo });
    console.log("✅", path.relative(raiz, arquivo));
  }
} finally {
  await navegador.close();
  servidor.close();
}
