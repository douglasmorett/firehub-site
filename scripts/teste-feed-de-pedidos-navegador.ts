/**
 * scripts/teste-feed-de-pedidos-navegador.ts — o lado do navegador do "só o
 * que mudou" (lib/feed-de-pedidos.ts), com um servidor simulado.
 *
 *   npx tsx scripts/teste-feed-de-pedidos-navegador.ts
 *
 * Confere: 1ª rodada completa; depois `desde` = agora do servidor − 30 s;
 * completa de novo a cada 60 s, ao trocar a janela e quando pedida; servidor
 * antigo (sem X-Feed-Agora) segue sempre completo; removido sai, alterado
 * troca, novo entra na ordem certa; resposta igual → mesmo texto.
 */
import assert from "node:assert/strict";
import { criarFeedDePedidos } from "../src/lib/feed-de-pedidos";

type Resp = { corpo: unknown; agora?: string; status?: number };
let fila: Resp[] = [];
const urls: string[] = [];
let relogio = Date.parse("2026-10-02T03:00:00Z");
Date.now = () => relogio;

(globalThis as any).fetch = async (url: string) => {
  urls.push(url);
  const r = fila.shift();
  if (!r) throw new Error("servidor simulado sem resposta para " + url);
  const h = new Map<string, string>([["date", new Date(relogio).toUTCString()]]);
  if (r.agora) h.set("x-feed-agora", r.agora);
  return {
    ok: (r.status ?? 200) < 400,
    status: r.status ?? 200,
    headers: { get: (k: string) => h.get(k.toLowerCase()) ?? null },
    text: async () => JSON.stringify(r.corpo),
  } as any;
};

const p = (id: string, min: number, extra: Record<string, unknown> = {}) => ({ id, createdAt: new Date(Date.parse("2026-10-02T02:00:00Z") + min * 60e3).toISOString(), status: "NOVO", ...extra });
const desdeDe = (u: string) => new URL(u, "http://x").searchParams.get("desde");

async function main() {
  const feed = criarFeedDePedidos();
  const A = p("A", 1), B = p("B", 2), C = p("C", 3);

  // 1ª rodada: completa
  fila.push({ corpo: [C, B, A], agora: "2026-10-02T03:00:00.000Z" });
  let r = await feed.buscar("&from=x&to=y");
  assert.equal(desdeDe(urls.at(-1)!), null, "1ª rodada não manda desde");
  assert.equal(r.completa, true);
  assert.deepEqual(r.lista!.map((o) => o.id), ["C", "B", "A"]);
  const textoInicial = r.texto;

  // 2ª: só o que mudou, desde = agora − 30 s; nada mudou → mesmo texto
  relogio += 5000;
  fila.push({ corpo: { pedidos: [], removidos: [], agora: "2026-10-02T03:00:05.000Z" } });
  r = await feed.buscar("&from=x&to=y");
  assert.equal(desdeDe(urls.at(-1)!), "2026-10-02T02:59:30.000Z", "desde = agora − 30 s");
  assert.equal(r.completa, false);
  assert.equal(r.texto, textoInicial, "sem mudança, o texto é igual ao da completa (o painel não redesenha)");

  // 3ª: B muda de status, A sai do filtro, D (mais novo) entra
  relogio += 5000;
  const B2 = { ...B, status: "ACEITO" }, D = p("D", 4);
  fila.push({ corpo: { pedidos: [B2, D], removidos: ["A", "Z-desconhecido"], agora: "2026-10-02T03:00:10.000Z" } });
  r = await feed.buscar("&from=x&to=y");
  assert.equal(desdeDe(urls.at(-1)!), "2026-10-02T02:59:35.000Z");
  assert.deepEqual(r.lista!.map((o) => o.id), ["D", "C", "B"]);
  assert.equal(r.lista!.find((o) => o.id === "B").status, "ACEITO");
  assert.deepEqual(JSON.parse(r.texto).map((o: any) => o.id), ["D", "C", "B"], "texto = lista remontada");

  // 4ª: passaram 60 s da última completa → completa de novo
  relogio += 60_000;
  fila.push({ corpo: [D, C, B2], agora: "2026-10-02T03:01:10.000Z" });
  r = await feed.buscar("&from=x&to=y");
  assert.equal(desdeDe(urls.at(-1)!), null, "a cada 60 s vem completa");
  assert.equal(r.completa, true);

  // 5ª: trocou o período → completa
  relogio += 5000;
  fila.push({ corpo: [C], agora: "2026-10-02T03:01:15.000Z" });
  r = await feed.buscar("&from=OUTRO&to=y");
  assert.equal(desdeDe(urls.at(-1)!), null, "período novo → completa");
  assert.deepEqual(r.lista!.map((o) => o.id), ["C"]);

  // 6ª: completa pedida (recarregar depois de editar)
  relogio += 5000;
  fila.push({ corpo: [C], agora: "2026-10-02T03:01:20.000Z" });
  await feed.buscar("&from=OUTRO&to=y", { completa: true });
  assert.equal(desdeDe(urls.at(-1)!), null, "completa pedida");

  // 7ª: o servidor respondeu completa no lugar do delta (mudança em massa)
  relogio += 5000;
  fila.push({ corpo: [D, C], agora: "2026-10-02T03:01:25.000Z" });
  r = await feed.buscar("&from=OUTRO&to=y");
  assert.ok(desdeDe(urls.at(-1)!), "pediu delta");
  assert.equal(r.completa, true, "lista pura é tratada como completa");
  assert.deepEqual(r.lista!.map((o) => o.id), ["D", "C"]);

  // 8ª: erro do servidor não mexe na lista guardada
  relogio += 5000;
  fila.push({ corpo: { error: "x" }, status: 500 });
  r = await feed.buscar("&from=OUTRO&to=y");
  assert.equal(r.ok, false);
  fila.push({ corpo: { pedidos: [], removidos: [], agora: "2026-10-02T03:01:35.000Z" } });
  r = await feed.buscar("&from=OUTRO&to=y");
  assert.deepEqual(r.lista!.map((o) => o.id), ["D", "C"], "lista intacta depois do erro");

  // Servidor antigo: sem X-Feed-Agora → toda rodada completa (comportamento de antes)
  const velho = criarFeedDePedidos();
  fila.push({ corpo: [A] }); await velho.buscar("");
  relogio += 5000;
  fila.push({ corpo: [A, B] }); r = await velho.buscar("");
  assert.equal(desdeDe(urls.at(-1)!), null, "servidor sem o cabeçalho → sempre completa");
  assert.deepEqual(r.lista!.map((o) => o.id), ["A", "B"]);

  // Corte de 200: o 201º mais antigo sai, como na completa
  const grande = criarFeedDePedidos();
  const muitos = Array.from({ length: 200 }, (_, i) => p("P" + i, 200 - i));
  fila.push({ corpo: muitos, agora: "2026-10-02T03:02:00.000Z" }); await grande.buscar("");
  relogio += 5000;
  fila.push({ corpo: { pedidos: [p("NOVO", 999)], removidos: [], agora: "2026-10-02T03:02:05.000Z" } });
  r = await grande.buscar("");
  assert.equal(r.lista!.length, 200);
  assert.equal(r.lista![0].id, "NOVO");
  assert.ok(!r.lista!.some((o) => o.id === "P199"), "o mais antigo saiu no corte");

  console.log("✓ lado do navegador: todas as verificações passaram");
}

main().catch((e) => { console.error("✗", e?.message || e); process.exit(1); });
