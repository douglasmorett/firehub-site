/**
 * A MÍDIA DO sendMedia É BAIXADA AQUI, NÃO PELO BAILEYS.
 *
 * Com `{ url }`, o Baileys baixa pelo axios: segue até 21 redirecionamentos
 * sem conferir nenhum e resolve o DNS de novo por conta própria. Conferir só o
 * primeiro endereço (como era até 24/10) deixava um 302 — ou um DNS que muda
 * de resposta (rebinding) — levar o gateway à rede interna ou ao metadata da
 * nuvem, e a resposta voltava a quem pediu como mídia no WhatsApp (SSRF).
 *
 * Aqui: cada salto é conferido, a conexão vai para o IP que foi conferido (sem
 * segunda consulta ao DNS), com teto de tamanho e de tipo. O Baileys recebe só
 * os bytes. Foto do /uploads do site, CDN do iFood etc. continuam passando.
 */
const http = require("http");
const https = require("https");
const net = require("net");
const dns = require("dns");

const TETO_DA_MIDIA = 16 * 1024 * 1024; // o limite de foto do WhatsApp
const MAX_SALTOS = 5;
// O FireHub desiste do sendMedia em 12 s (lib/whatsapp-evolution.ts): o
// download não pode comer o tempo do envio.
const TEMPO_DA_MIDIA_MS = 9000;

// O que não é internet pública (registro de endereços especiais da IANA).
const bloqueados = new net.BlockList();
for (const [rede, bits] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 3], // 224–255: multicast, reservado, broadcast
]) bloqueados.addSubnet(rede, bits, "ipv4");
// IPv6: só o unicast global (2000::/3) passa — fica de fora ::1, ::ffff:x
// (IPv4 embutido), 64:ff9b:: (NAT64), fc00::/7, fe80::/10, multicast. Dentro
// dele, ainda: Teredo e afins (2001::/23), documentação e 6to4 (2002::/16,
// que embute um IPv4 qualquer).
const global6 = new net.BlockList();
global6.addSubnet("2000::", 3, "ipv6");
for (const [rede, bits] of [["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20]]) {
  bloqueados.addSubnet(rede, bits, "ipv6");
}

function ipInterno(ip) {
  try {
    const v = net.isIP(ip);
    if (v === 4) return bloqueados.check(ip, "ipv4");
    if (v === 6) return !global6.check(ip, "ipv6") || bloqueados.check(ip, "ipv6");
  } catch {}
  return true;
}

const resolverDoSistema = async (host) => (await dns.promises.lookup(host, { all: true })).map((r) => r.address);

// http/https só para host que resolve SÓ para IP público. Devolve o IP a usar.
async function conferirEndereco(endereco, resolver) {
  let u;
  try { u = new URL(String(endereco)); } catch { throw new Error("URL inválida"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error(`protocolo ${u.protocol}`);
  const host = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (!host || host === "localhost" || host.endsWith(".localhost")) throw new Error("endereço interno");
  let ips;
  try { ips = net.isIP(host) ? [host] : await resolver(host); } catch { throw new Error("host não resolve"); }
  if (!ips.length || ips.some(ipInterno)) throw new Error("endereço interno");
  return { u, ip: ips[0] };
}

function pedir(u, ip, signal, agente) {
  const familia = net.isIP(ip);
  return new Promise((ok, falha) => {
    const req = (u.protocol === "https:" ? https : http).get(u, {
      // Sem conexão reaproveitada: cada pedido conecta no IP desta conferência.
      agent: agente || false,
      signal,
      // O socket conecta no IP conferido; Host e SNI do TLS seguem o nome da
      // URL, então o certificado do site confere normalmente.
      lookup: (_host, opcoes, cb) => (opcoes && opcoes.all ? cb(null, [{ address: ip, family: familia }]) : cb(null, ip, familia)),
      headers: { "User-Agent": "FireHub-Gateway", Accept: "image/*,application/pdf;q=0.9,*/*;q=0.5" },
    }, ok);
    req.on("error", falha);
  });
}

// O tipo tem que ser o que foi pedido. CDN que manda octet-stream passa se os
// primeiros bytes forem do tipo certo.
function tipoDaMidia(cabecalho, buffer, tipo) {
  const ct = String(cabecalho || "").split(";")[0].trim().toLowerCase();
  const generico = !ct || ct === "application/octet-stream" || ct === "binary/octet-stream";
  const inicio = buffer.subarray(0, 12);
  if (tipo === "document") {
    return ct === "application/pdf" || (generico && inicio.toString("latin1", 0, 5) === "%PDF-") ? "application/pdf" : null;
  }
  if (ct.startsWith("image/")) return ct;
  if (!generico) return null;
  if (inicio[0] === 0xff && inicio[1] === 0xd8 && inicio[2] === 0xff) return "image/jpeg";
  if (inicio.toString("latin1", 0, 4) === "\x89PNG") return "image/png";
  if (inicio.toString("latin1", 0, 4) === "GIF8") return "image/gif";
  if (inicio.toString("latin1", 0, 4) === "RIFF" && inicio.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/**
 * Baixa a mídia de `endereco` para enviar como `tipo` ("image" ou "document").
 * Devolve { buffer, mimetype } ou lança Error com o motivo, para o log e a
 * resposta 400. `resolver` e `agente` existem para o teste
 * (scripts/teste-midia-do-gateway.ts).
 */
async function baixarMidia(endereco, { tipo = "image", resolver = resolverDoSistema, agente, teto = TETO_DA_MIDIA, tempo = TEMPO_DA_MIDIA_MS } = {}) {
  const signal = AbortSignal.timeout(tempo);
  let atual = endereco;
  for (let salto = 0; ; salto++) {
    const { u, ip } = await conferirEndereco(atual, resolver);
    let res;
    try { res = await pedir(u, ip, signal, agente); } catch (e) { throw new Error(`falha ao baixar (${e.code || e.name})`); }
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
      res.resume();
      if (salto >= MAX_SALTOS) throw new Error("redirecionamentos demais");
      try { atual = new URL(res.headers.location, u).href; } catch { throw new Error("redirecionamento inválido"); }
      continue;
    }
    if (res.statusCode !== 200) { res.resume(); throw new Error(`HTTP ${res.statusCode}`); }
    const acima = `mídia acima do teto de ${teto} bytes`;
    if (Number(res.headers["content-length"] || 0) > teto) { res.destroy(); throw new Error(acima); }
    const partes = [];
    let total = 0;
    try {
      for await (const parte of res) {
        total += parte.length;
        if (total > teto) break;
        partes.push(parte);
      }
    } catch (e) { throw new Error(`falha ao baixar (${e.code || e.name})`); }
    if (total > teto) { res.destroy(); throw new Error(acima); }
    const buffer = Buffer.concat(partes);
    const mimetype = tipoDaMidia(res.headers["content-type"], buffer, tipo);
    if (!mimetype) throw new Error(`tipo "${res.headers["content-type"] || "?"}" não serve como ${tipo === "document" ? "PDF" : "imagem"}`);
    return { buffer, mimetype };
  }
}

module.exports = { baixarMidia, conferirEndereco, ipInterno, TETO_DA_MIDIA };
