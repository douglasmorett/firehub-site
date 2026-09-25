// Exploração: abre uma URL (logado ou não) e tira foto. Uso: node explorar.mjs <caminho> <nome> [painel]
import { navegador, contextoPainel, contextoCelular, entrarNoPainel, foto, BASE, dormir } from "./comum.mjs";
const [, , caminho, nome, modo] = process.argv;
const b = await navegador();
const ctx = modo === "painel" ? await contextoPainel(b) : await contextoCelular(b);
const page = await ctx.newPage();
page.on("console", (m) => { if (m.type() === "error") console.log("[console]", m.text().slice(0, 200)); });
if (modo === "painel") await entrarNoPainel(page);
await page.goto(BASE + caminho, { waitUntil: "domcontentloaded" });
await dormir(Number(process.env.ESPERA || 6000));
console.log(await foto(page, nome));
console.log((await page.innerText("body")).slice(0, 3000));
await b.close();
