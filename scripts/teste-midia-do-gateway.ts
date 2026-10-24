/**
 * A mídia do sendMedia baixada pelo próprio gateway (whatsapp-gateway/midia-do-envio.js):
 * cada redirecionamento conferido, conexão no IP conferido (sem rebinding),
 * teto de tamanho e de tipo. Servidor HTTP local; o DNS e a conexão são
 * injetados (`resolver` / `agente`) para o nome "loja.teste" parecer público.
 *
 *   npx tsx scripts/teste-midia-do-gateway.ts
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";

const req_ = createRequire(import.meta.url);
const { baixarMidia, ipInterno } = req_("../whatsapp-gateway/midia-do-envio.js");

let falhas = 0;
function confere(nome: string, ok: boolean, obtido?: unknown) {
  if (ok) console.log(`✅ ${nome}`);
  else { falhas++; console.log(`❌ ${nome} — obtido ${JSON.stringify(obtido)}`); }
}
async function erroDe(p: Promise<unknown>): Promise<string> {
  try { await p; return ""; } catch (e: any) { return String(e?.message || e); }
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 7)]);
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)]);
const PDF = Buffer.from("%PDF-1.4\n% cardápio\n");
const pedidos: string[] = [];

const servidor = http.createServer((req, res) => {
  pedidos.push(`${req.headers.host}${req.url}`);
  const u = new URL(req.url || "/", "http://x");
  const n = Number(u.pathname.split("/")[2]);
  if (u.pathname === "/foto.png") { res.writeHead(200, { "Content-Type": "image/png" }); return res.end(PNG); }
  if (u.pathname === "/foto-sem-tipo") { res.writeHead(200, { "Content-Type": "application/octet-stream" }); return res.end(JPG); }
  if (u.pathname === "/cardapio.pdf") { res.writeHead(200, { "Content-Type": "application/pdf" }); return res.end(PDF); }
  if (u.pathname === "/pagina") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end("<h1>oi</h1>"); }
  if (u.pathname === "/grande") { res.writeHead(200, { "Content-Type": "image/png", "Content-Length": String(17 * 1024 * 1024) }); return res.end(PNG); }
  if (u.pathname === "/grande-sem-tamanho") { res.writeHead(200, { "Content-Type": "image/png" }); res.write(PNG); res.write(Buffer.alloc(2000)); return res.end(); }
  if (u.pathname === "/vai") { res.writeHead(302, { Location: u.searchParams.get("para") || "/" }); return res.end(); }
  if (u.pathname.startsWith("/cadeia/")) { res.writeHead(302, { Location: n > 0 ? `/cadeia/${n - 1}` : "/foto.png" }); return res.end(); }
  res.writeHead(404); res.end();
});
servidor.on("clientError", () => {});

// O "DNS" do teste e a conexão: o socket vai para o servidor local, mas só
// depois de perguntar ao lookup que o gateway passou qual IP usar — é esse IP
// que fica anotado (prova de que a conexão usa o IP conferido).
const ipsConectados: string[] = [];
class AgenteDeTeste extends http.Agent {
  createConnection(opcoes: any, cb: any) {
    const s = new net.Socket();
    opcoes.lookup(opcoes.host, {}, (err: any, ip: string) => {
      if (err) return s.destroy(err);
      ipsConectados.push(ip);
      s.connect(opcoes.port, "127.0.0.1");
    });
    cb?.(null, s);
    return s;
  }
}

async function main() {
  await new Promise<void>((ok) => servidor.listen(0, "127.0.0.1", ok));
  const porta = (servidor.address() as AddressInfo).port;
  const base = `http://loja.teste:${porta}`;
  const publico = async (host: string) => (host === "loja.teste" ? ["8.8.8.8"] : ["10.0.0.9"]);
  const op = (extra: Record<string, unknown> = {}) => ({ resolver: publico, agente: new AgenteDeTeste(), ...extra });

  console.log("[1] Faixas bloqueadas");
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1",
    "0.0.0.0", "198.18.0.1", "198.19.255.255", "192.0.0.8", "192.0.2.1", "203.0.113.5", "224.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:169.254.169.254", "64:ff9b::a9fe:a9fe", "2002:a9fe:a9fe::1", "2001::1",
    "2001:db8::1", "fc00::1", "fd12:3456::1", "fe80::1", "ff02::1", "x"]) {
    confere(`${ip} é interno`, ipInterno(ip) === true);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "104.16.0.1", "172.32.0.1", "2606:4700::1111", "2804:14c::1"]) {
    confere(`${ip} é público`, ipInterno(ip) === false);
  }

  console.log("\n[2] URL pública passa e vira buffer");
  let r = await baixarMidia(`${base}/foto.png`, op());
  confere("foto PNG: os mesmos bytes", Buffer.isBuffer(r.buffer) && r.buffer.equals(PNG));
  confere("foto PNG: mimetype image/png", r.mimetype === "image/png", r.mimetype);
  confere("conectou no IP conferido (8.8.8.8), com o Host do site", ipsConectados.at(-1) === "8.8.8.8" && pedidos.at(-1) === `loja.teste:${porta}/foto.png`, [ipsConectados.at(-1), pedidos.at(-1)]);
  r = await baixarMidia(`${base}/cardapio.pdf`, op({ tipo: "document" }));
  confere("PDF do cardápio como documento: application/pdf", r.mimetype === "application/pdf" && r.buffer.equals(PDF), r.mimetype);
  r = await baixarMidia(`${base}/foto-sem-tipo`, op());
  confere("CDN com octet-stream e bytes de JPEG passa como imagem", r.mimetype === "image/jpeg", r.mimetype);
  r = await baixarMidia(`${base}/cadeia/4`, op());
  confere("5 redirecionamentos dentro do site: passa", r.buffer.equals(PNG));

  console.log("\n[3] Redirecionamento para dentro: recusado");
  let antes = pedidos.length;
  confere("302 → http://127.0.0.1 (o próprio servidor do teste)",
    /interno/.test(await erroDe(baixarMidia(`${base}/vai?para=${encodeURIComponent(`http://127.0.0.1:${porta}/foto.png`)}`, op()))));
  confere("...e o servidor não recebeu o segundo pedido", pedidos.length === antes + 1, pedidos.slice(antes));
  confere("302 → http://169.254.169.254 (metadata)",
    /interno/.test(await erroDe(baixarMidia(`${base}/vai?para=${encodeURIComponent("http://169.254.169.254/latest/meta-data/")}`, op()))));
  confere("302 → http://[::ffff:127.0.0.1]",
    /interno/.test(await erroDe(baixarMidia(`${base}/vai?para=${encodeURIComponent(`http://[::ffff:127.0.0.1]:${porta}/foto.png`)}`, op()))));
  confere("302 → host que resolve para 10.x",
    /interno/.test(await erroDe(baixarMidia(`${base}/vai?para=${encodeURIComponent("http://interno.teste/x")}`, op()))));
  confere("302 → file:///etc/passwd", /protocolo/.test(await erroDe(baixarMidia(`${base}/vai?para=${encodeURIComponent("file:///etc/passwd")}`, op()))));
  confere("6 redirecionamentos: recusado", /demais/.test(await erroDe(baixarMidia(`${base}/cadeia/5`, op()))));
  confere("direto em http://127.0.0.1 (DNS e conexão de verdade): recusado",
    /interno/.test(await erroDe(baixarMidia(`http://127.0.0.1:${porta}/foto.png`))));
  confere("localhost: recusado", /interno/.test(await erroDe(baixarMidia(`http://localhost:${porta}/foto.png`))));

  console.log("\n[4] DNS que muda de resposta (rebinding)");
  let consultas = 0;
  const muda = async () => (++consultas === 1 ? ["8.8.8.8"] : ["169.254.169.254"]);
  r = await baixarMidia(`${base}/foto.png`, op({ resolver: muda }));
  confere("uma consulta só, e a conexão foi no IP dela (não em outra resposta do DNS)", consultas === 1 && ipsConectados.at(-1) === "8.8.8.8", [consultas, ipsConectados.at(-1)]);
  consultas = 0;
  confere("302 para o mesmo host, que agora responde 169.254.169.254: recusado",
    /interno/.test(await erroDe(baixarMidia(`${base}/vai?para=${encodeURIComponent(`${base}/foto.png`)}`, op({ resolver: muda })))));
  confere("DNS com um IP público e um interno juntos: recusado",
    /interno/.test(await erroDe(baixarMidia(`${base}/foto.png`, op({ resolver: async () => ["8.8.8.8", "10.0.0.1"] })))));

  console.log("\n[5] Tamanho e tipo");
  confere("Content-Length de 17 MB: recusado", /teto/.test(await erroDe(baixarMidia(`${base}/grande`, op()))));
  confere("sem Content-Length, passou do teto no meio: recusado", /teto/.test(await erroDe(baixarMidia(`${base}/grande-sem-tamanho`, op({ teto: 1000 })))));
  confere("página HTML como imagem: recusado", /não serve/.test(await erroDe(baixarMidia(`${base}/pagina`, op()))));
  confere("foto pedida como documento (PDF): recusado", /não serve/.test(await erroDe(baixarMidia(`${base}/foto.png`, op({ tipo: "document" })))));
  confere("404: recusado", /HTTP 404/.test(await erroDe(baixarMidia(`${base}/nao-existe`, op()))));

  console.log("\n[6] O sendMedia do server.js");
  const gw = readFileSync("whatsapp-gateway/server.js", "utf8");
  const rota = gw.slice(gw.indexOf('app.post("/message/sendMedia/'), gw.indexOf("// 4.5 Obter Base64"));
  confere("baixa pela baixarMidia, com o tipo pedido", /await baixarMidia\(mediaUrl, \{ tipo: ehDocumento \? "document" : "image" \}\)/.test(rota));
  confere("o Baileys recebe o buffer, nunca { url }", !/\{\s*url:/.test(rota) && /document: midia\.buffer/.test(rota) && /image: midia\.buffer/.test(rota));
  confere("recusada: a legenda vai como texto e a resposta é 400",
    /catch \(err\) \{[\s\S]{0,400}sendMessage\(jid, \{ text: caption \}\)[\s\S]{0,80}status\(400\)/.test(rota));

  servidor.close();
}

main()
  .then(() => { console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo."); process.exit(falhas ? 1 : 0); })
  .catch((e) => { console.error(e); process.exit(1); });
