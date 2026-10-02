// Sonda: abre uma tela da loja fictícia e tira uma foto, sem gravar nada.
// Serve para olhar a tela antes de escrever (ou consertar) um roteiro.
//
// Uso:  node tutoriais/motor/sondar.mjs store/pedidos-clientes [arquivo.png]
import path from "node:path";
import fs from "node:fs";
import { abrirNavegador, entrar, Palco, BASE, dormir } from "./palco.mjs";
import { LOJA } from "../ambiente/semente.mjs";

// Sem a barra inicial de propósito: o Git Bash do Windows troca "/store/..." por um caminho de disco.
const rota = "/" + String(process.argv[2] || "store/pedidos-clientes").replace(/^[/]+/, "");
const destino = process.argv[3] || path.join(process.cwd(), "tutoriais", "saida", "sonda.png");
fs.mkdirSync(path.dirname(destino), { recursive: true });

const navegador = await abrirNavegador();
try {
  const estado = await entrar(navegador, LOJA);
  const palco = await Palco.abrir(navegador, { estado, pastaDosQuadros: path.join(path.dirname(destino), "quadros-sonda") });
  const erros = [];
  palco.pagina.on("pageerror", (e) => erros.push(String(e).slice(0, 200)));
  await palco.pagina.goto(`${BASE}${rota}`, { waitUntil: "load", timeout: 180_000 }).catch((e) => console.log("aviso:", String(e).slice(0, 120)));
  await dormir(5000);
  await palco.pagina.screenshot({ path: destino });
  console.log("foto:", destino, "| url:", palco.pagina.url());
  if (erros.length) console.log("erros da página:", erros);
} finally {
  await navegador.close();
}
