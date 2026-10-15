/**
 * scripts/teste-tef.js — o TEF do totem (tef/index.js) com o motor SIMULADOR,
 * sem Electron, sem PayGo e sem nuvem de verdade: APPDATA de mentira na pasta
 * temporária, FireHub falso no `fetch`, impressora falsa.
 *
 *   node scripts/teste-tef.js
 *
 * Confere:
 *   - venda aprovada: pendência em disco → comprovante (2 vias) → FireHub
 *     CONFIRMAR → CNF na PayGo → pendência apagada;
 *   - recusada (valor ,99): nada a confirmar, FireHub fica sabendo;
 *   - menu "CREDITO/DEBITO" respondido pela tela;
 *   - abortada pelo totem no meio (PW_iPPAbort) → cancelado;
 *   - FireHub fora do ar → NÃO confirma, fica pendente; voltou → confirma;
 *   - FireHub manda DESFAZER (pedido cancelado) → desfaz + aviso impresso;
 *   - impressora falhou → desfaz (comprovante é obrigatório);
 *   - Assistente cai com pendência em disco → na volta pergunta ao FireHub e
 *     desfaz (venda não gravada) ou confirma (venda gravada);
 *   - motor cai no meio (valor ,97) → supervisor sobe de novo → a pendência
 *     que ficou no "host" é desfeita na venda seguinte, que passa;
 *   - rotas /tef: sem segredo 401, origem estranha 403, certo 200.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");

process.env.FIREHUB_TEF_SIM_PASSO_MS = "40";
const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), "firehub-tef-teste-"));
const { criarTef } = require("../tef");
const K = require("../tef/constantes");

let falhas = 0;
function confere(nome, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "ok  " : "FALHOU"} ${nome}${ok ? "" : ` → ${JSON.stringify(obtido)} (esperado ${JSON.stringify(esperado)})`}`);
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
async function ate(cond, ms = 8000) {
  const fim = Date.now() + ms;
  while (Date.now() < fim) {
    if (await cond()) return true;
    await dormir(20);
  }
  return false;
}

// ── FireHub falso ───────────────────────────────────────────────────────────
const NUVEM = "https://firehubfood.com.br";
const CHAVE = "chave-do-assistente-tef-123456";
const nuvem = {
  foraDoAr: false,
  pedidos: {}, // id → { valorCentavos, pago, transacao, cancelado }
  chamadas: [],
};
async function fetchFalso(url, init = {}) {
  const u = new URL(url);
  const corpo = init.body ? JSON.parse(init.body) : null;
  nuvem.chamadas.push({ metodo: init.method, caminho: u.pathname, corpo });
  if (nuvem.foraDoAr) throw new TypeError("fetch failed");
  const resp = (status, json) => new Response(JSON.stringify(json), { status });
  if (init.headers.authorization !== `Bearer ${CHAVE}`) return resp(401, { error: "chave" });
  if (u.pathname === "/api/totem/tef/resultado") {
    const p = nuvem.pedidos[corpo.pedidoId];
    if (!p) return resp(404, { acao: "DESFAZER", motivo: "PEDIDO_INEXISTENTE" });
    if (!corpo.aprovado) return resp(200, { acao: "NADA" });
    if (p.cancelado) return resp(409, { acao: "DESFAZER", motivo: "PEDIDO_CANCELADO", mensagem: "Pedido cancelado." });
    if (p.pago && p.transacao !== corpo.transacaoId) return resp(409, { acao: "DESFAZER", motivo: "JA_PAGO" });
    if (corpo.valorCentavos !== p.valorCentavos) return resp(409, { acao: "DESFAZER", motivo: "VALOR_DIVERGENTE" });
    p.pago = true;
    p.transacao = corpo.transacaoId;
    p.dados = corpo;
    return resp(200, { acao: "CONFIRMAR", numero: 42 });
  }
  if (u.pathname === "/api/totem/tef/pedido") {
    const p = nuvem.pedidos[u.searchParams.get("id")];
    if (!p) return resp(404, { acao: "DESFAZER" });
    const desta = p.pago && p.transacao === u.searchParams.get("transacao");
    return resp(200, { acao: desta ? "CONFIRMAR" : "DESFAZER", pagoPorEstaTransacao: desta });
  }
  return resp(404, {});
}

// ── Impressora falsa ────────────────────────────────────────────────────────
const impressos = [];
let impressoraQuebrada = false;
async function imprimirFalso(texto, { via }) {
  if (impressoraQuebrada) throw new Error("impressora sem papel");
  impressos.push({ via, texto });
}

function novoTef(pasta = path.join(RAIZ, "FireHub")) {
  const tef = criarTef({
    pasta,
    fetch: fetchFalso,
    imprimir: imprimirFalso,
    semCofre: true,
    log: (m) => process.env.TEF_VERBOSO && console.log("   [tef]", m),
    esperaNovaTentativaMs: 150,
    esperaReligarMs: 100,
    prazoDaConfirmacaoMs: 3000,
    prazoDaNuvemMs: 2000,
  });
  tef._gravarPareamento({ licencaId: "licA", chave: CHAVE, segredoLocal: "segredo-local-do-totem", nuvem: NUVEM });
  tef._gravarConfig({ motor: "simulador" });
  return tef;
}
const host = (pasta = path.join(RAIZ, "FireHub")) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(pasta, "tef", "simulador", "simulador-host.json"), "utf8"));
  } catch {
    return { pendente: null, historico: [] };
  }
};
const arquivoPendente = (pasta = path.join(RAIZ, "FireHub")) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(pasta, "tef-pendente.json"), "utf8"));
  } catch {
    return [];
  }
};

async function vender(tef, pedidoId, valorCentavos, forma = "credito") {
  nuvem.pedidos[pedidoId] = nuvem.pedidos[pedidoId] || { valorCentavos };
  const r = await tef.iniciarVenda({ pedidoId, valorCentavos, forma });
  if (r.status !== 200) return { inicio: r, final: null };
  await ate(() => tef.estadoDe(r.corpo.id).corpo.final);
  return { inicio: r, final: tef.estadoDe(r.corpo.id).corpo };
}

async function main() {
  const tef = novoTef();
  tef.iniciar();
  confere("motor simulador sobe", await ate(() => tef.status().pronto), true);

  // ── Aprovada ──────────────────────────────────────────────────────────────
  {
    const mensagens = new Set();
    nuvem.pedidos.p1 = { valorCentavos: 3990 };
    const r = await tef.iniciarVenda({ pedidoId: "p1", valorCentavos: 3990, forma: "credito" });
    confere("venda responde rápido com id", r.status === 200 && /^tef_/.test(r.corpo.id), true);
    await ate(() => {
      const e = tef.estadoDe(r.corpo.id).corpo;
      if (e.mensagem) mensagens.add(e.mensagem);
      return e.final;
    });
    const e = tef.estadoDe(r.corpo.id).corpo;
    confere("aprovada: fase", e.fase, "aprovado");
    confere("aprovada: número do pedido vem do FireHub", e.numero, 42);
    confere("tela viu a mensagem do pinpad", mensagens.has("INSIRA OU APROXIME O CARTAO") && mensagens.has("DIGITE A SENHA"), true);
    await ate(() => host().historico.length === 1);
    confere("aprovada: CNF na PayGo", host().historico.map((h) => h.acao), ["CONFIRMADA"]);
    await ate(() => arquivoPendente().length === 0); confere("aprovada: pendência apagada do disco", arquivoPendente(), []);
    confere("aprovada: duas vias impressas", impressos.map((i) => i.via), ["cliente", "loja"]);
    confere("aprovada: FireHub recebeu NSU, autorização e comprovante", Boolean(nuvem.pedidos.p1.dados.nsu && nuvem.pedidos.p1.dados.autorizacao && nuvem.pedidos.p1.dados.comprovanteCliente), true);
  }

  // ── Recusada ──────────────────────────────────────────────────────────────
  {
    const antes = host().historico.length;
    const { final } = await vender(tef, "p2", 1099);
    confere("recusada (,99): fase", final.fase, "recusado");
    confere("recusada: mensagem do host", /NEGADA/.test(final.mensagem), true);
    confere("recusada: nada confirmado nem desfeito", host().historico.length, antes);
    await ate(() => nuvem.chamadas.some((c) => c.corpo && c.corpo.pedidoId === "p2"));
    confere("recusada: FireHub fica sabendo (aprovado:false)", nuvem.chamadas.find((c) => c.corpo && c.corpo.pedidoId === "p2").corpo.aprovado, false);
  }

  // ── Menu CREDITO/DEBITO respondido pela tela ──────────────────────────────
  {
    nuvem.pedidos.p3 = { valorCentavos: 2500 };
    const r = await tef.iniciarVenda({ pedidoId: "p3", valorCentavos: 2500 });
    await ate(() => tef.estadoDe(r.corpo.id).corpo.fase === "pergunta");
    const e = tef.estadoDe(r.corpo.id).corpo;
    confere("sem forma: pergunta menu com 2 opções", [e.pergunta && e.pergunta.tipo, e.pergunta && e.pergunta.opcoes.length], ["menu", 2]);
    confere("responder", tef.responder(r.corpo.id, "2").status, 200);
    await ate(() => tef.estadoDe(r.corpo.id).corpo.final);
    confere("débito pelo menu: aprovada", tef.estadoDe(r.corpo.id).corpo.fase, "aprovado");
    confere("débito chegou ao FireHub", nuvem.pedidos.p3.dados.tipo, "2");
  }

  // ── Abortada pelo totem ───────────────────────────────────────────────────
  {
    const antes = host().historico.length;
    nuvem.pedidos.p4 = { valorCentavos: 1500 };
    const r = await tef.iniciarVenda({ pedidoId: "p4", valorCentavos: 1500, forma: "debito" });
    confere("ocupado: outra venda no meio → 409", (await tef.iniciarVenda({ pedidoId: "outro", valorCentavos: 100 })).status, 409);
    await ate(() => tef.estadoDe(r.corpo.id).corpo.fase === "pinpad");
    confere("cancelar no pinpad", tef.cancelar().status, 200);
    await ate(() => tef.estadoDe(r.corpo.id).corpo.final);
    confere("abortada: fase cancelado", tef.estadoDe(r.corpo.id).corpo.fase, "cancelado");
    confere("abortada: nada no host", host().historico.length, antes);
    confere("abortada: host sem pendência", host().pendente, null);
  }

  // ── FireHub fora do ar: não confirma; voltou → confirma ───────────────────
  {
    nuvem.foraDoAr = true;
    nuvem.pedidos.p5 = { valorCentavos: 4590 };
    const r = await tef.iniciarVenda({ pedidoId: "p5", valorCentavos: 4590, forma: "credito" });
    await ate(() => arquivoPendente().length === 1);
    await dormir(600);
    confere("servidor fora: pendência em disco", arquivoPendente().map((p) => p.pedidoId), ["p5"]);
    confere("servidor fora: NÃO confirmou na PayGo", Boolean(host().pendente), true);
    confere("servidor fora: tela segue registrando", tef.estadoDe(r.corpo.id).corpo.fase, "registrando");
    confere("servidor fora: venda nova bloqueada (pendência)", (await tef.iniciarVenda({ pedidoId: "p6", valorCentavos: 100 })).status, 409);
    nuvem.foraDoAr = false;
    await ate(() => tef.estadoDe(r.corpo.id).corpo.final);
    confere("voltou: aprovado", tef.estadoDe(r.corpo.id).corpo.fase, "aprovado");
    await ate(() => arquivoPendente().length === 0);
    confere("voltou: confirmada e pendência apagada", [host().historico.at(-1).acao, arquivoPendente().length], ["CONFIRMADA", 0]);
  }

  // ── FireHub manda DESFAZER (pedido cancelado) ─────────────────────────────
  {
    nuvem.pedidos.p7 = { valorCentavos: 2990, cancelado: true };
    impressos.length = 0;
    const { final } = await vender(tef, "p7", 2990);
    confere("pedido cancelado: desfeito", final.fase, "desfeito");
    await ate(() => host().historico.at(-1).acao === "DESFEITA");
    confere("pedido cancelado: REV_OTHER_AUT", host().historico.at(-1).status, K.PWCNF.REV_OTHER_AUT);
    confere("pedido cancelado: aviso de desfeita impresso", impressos.map((i) => i.via), ["cliente", "loja", "aviso"]);
  }

  // ── Impressora falhou → desfaz sem falar com o FireHub ────────────────────
  {
    impressoraQuebrada = true;
    const chamadasAntes = nuvem.chamadas.length;
    const { final } = await vender(tef, "p8", 1990);
    impressoraQuebrada = false;
    confere("sem comprovante: desfeito", final.fase, "desfeito");
    await ate(() => host().historico.at(-1).status === K.PWCNF.REV_PRN_AUT);
    confere("sem comprovante: REV_PRN_AUT", host().historico.at(-1).status, K.PWCNF.REV_PRN_AUT);
    confere("sem comprovante: FireHub nem soube", nuvem.chamadas.slice(chamadasAntes).filter((c) => c.corpo && c.corpo.pedidoId === "p8").length, 0);
  }

  // ── Motor cai no meio (,97) → supervisor → pendência do host desfeita ─────
  {
    const r = await tef.iniciarVenda({ pedidoId: "p9", valorCentavos: 1297, forma: "credito" });
    await ate(() => tef.estadoDe(r.corpo.id).corpo.final);
    confere("motor caiu: transação em erro", tef.estadoDe(r.corpo.id).corpo.fase, "erro");
    confere("motor caiu: host ficou com pendência", Boolean(host().pendente), true);
    confere("supervisor sobe o motor de novo", await ate(() => tef.status().pronto), true);
    const { final } = await vender(tef, "p10", 2000);
    confere("venda seguinte passa", final && final.fase, "aprovado");
    const desfeitas = host().historico.filter((h) => h.valor === 1297);
    confere("pendência do host (,97) foi DESFEITA (REV_PWR_AUT)", desfeitas.map((h) => [h.acao, h.status]), [["DESFEITA", K.PWCNF.REV_PWR_AUT]]);
    confere("FireHub nunca recebeu o p9", nuvem.pedidos.p9 === undefined || !nuvem.pedidos.p9.pago, true);
  }

  // ── Rotas /tef: segredo e origem ──────────────────────────────────────────
  let express = null;
  try {
    express = require("express");
  } catch {
    console.log("(express não instalado aqui: rode com NODE_PATH apontando para node_modules do Assistente para testar as rotas)");
  }
  if (express) {
    const app = express();
    app.use(express.json());
    tef.registrar(app);
    const srv = await new Promise((r) => {
      const s = app.listen(0, "127.0.0.1", () => r(s));
    });
    const porta = srv.address().port;
    const pedir = (headers) =>
      new Promise((resolve) => {
        http.get({ host: "127.0.0.1", port: porta, path: "/tef/status", headers }, (res) => {
          res.resume();
          resolve(res.statusCode);
        });
      });
    confere("rota sem segredo → 401", await pedir({ origin: NUVEM }), 401);
    confere("rota com origem estranha → 403", await pedir({ origin: "https://site-malicioso.com", "x-firehub-tef": "segredo-local-do-totem" }), 403);
    confere("rota com segredo errado → 401", await pedir({ origin: NUVEM, "x-firehub-tef": "outro" }), 401);
    confere("rota certa → 200", await pedir({ origin: NUVEM, "x-firehub-tef": "segredo-local-do-totem" }), 200);
    srv.close();
  }

  await tef.encerrar();

  // ── Assistente cai com pendência em disco (outra execução) ────────────────
  {
    const pasta = path.join(RAIZ, "FireHub-queda");
    // 1ª execução: FireHub fora → aprovada fica pendente; o Assistente "cai".
    nuvem.foraDoAr = true;
    const a = novoTef(pasta);
    a.iniciar();
    await ate(() => a.status().pronto);
    nuvem.pedidos.q1 = { valorCentavos: 5590 };
    await a.iniciarVenda({ pedidoId: "q1", valorCentavos: 5590, forma: "credito" });
    await ate(() => arquivoPendente(pasta).length === 1);
    await a.encerrar();
    confere("queda: pendência ficou em disco", arquivoPendente(pasta).map((p) => [p.pedidoId, p.fase]), [["q1", "aguardando_servidor"]]);
    confere("queda: host ainda sem confirmação", Boolean(host(pasta).pendente), true);

    // 2ª execução: FireHub voltou, mas a venda NÃO está gravada → desfaz.
    nuvem.foraDoAr = false;
    const b = novoTef(pasta);
    b.iniciar();
    await ate(() => arquivoPendente(pasta).length === 0);
    confere("volta: perguntou ao FireHub pelo pedido", nuvem.chamadas.some((c) => c.caminho === "/api/totem/tef/pedido"), true);
    confere("volta: venda não gravada → DESFEITA (REV_PWR_AUT)", [host(pasta).historico.at(-1).acao, host(pasta).historico.at(-1).status], ["DESFEITA", K.PWCNF.REV_PWR_AUT]);
    await b.encerrar();

    // E quando a venda FOI gravada (o FireHub respondeu, a resposta se perdeu):
    nuvem.foraDoAr = true;
    const c = novoTef(pasta);
    c.iniciar();
    await ate(() => c.status().pronto);
    nuvem.pedidos.q2 = { valorCentavos: 3300 };
    await c.iniciarVenda({ pedidoId: "q2", valorCentavos: 3300, forma: "debito" });
    await ate(() => arquivoPendente(pasta).length === 1);
    const pend = arquivoPendente(pasta)[0];
    Object.assign(nuvem.pedidos.q2, { pago: true, transacao: pend.transacaoId });
    await c.encerrar();
    nuvem.foraDoAr = false;
    const d = novoTef(pasta);
    d.iniciar();
    await ate(() => arquivoPendente(pasta).length === 0);
    confere("volta: venda gravada → CONFIRMADA", host(pasta).historico.at(-1).acao, "CONFIRMADA");
    await d.encerrar();
  }

  console.log(falhas ? `\n${falhas} FALHA(S)` : "\nTudo certo.");
  fs.rmSync(RAIZ, { recursive: true, force: true });
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
