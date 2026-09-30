/**
 * O cron da NFC-e (lib/fiscal-automatico → retentarNotasFiscais) e a nota da
 * conta da mesa (emitirNfceDaMesa), rodando de verdade — contra um banco FALSO
 * em memória e um provedor FALSO (fetch interceptado). Nada vai ao banco nem
 * ao Focus.
 *
 *   npx tsx scripts/teste-fiscal-retentativa.ts
 *
 * O que trava:
 *  - a fila de retentativa: esgotadas e falhas do botão Emitir que a
 *    automática não cobre saem de vez, com o motivo; a falha nova entra mesmo
 *    atrás de 45 esgotadas (antes: `take: 40` sem ordem);
 *  - a conta de mesa fechada sem nota é achada pela varredura, e a nota vai
 *    com o cartão exato e o troco no dinheiro;
 *  - exceção dentro da emissão da mesa fica registrada (antes: só console);
 *  - o desconto do fechamento é gravado antes de tudo;
 *  - a nota à mão de venda antiga (até 31 dias) em contingência ou
 *    "processando" é consultada (antes: só pedido criado nas últimas 48 h);
 *  - o aviso do parceiro gravado durante a consulta não some, e o aviso não
 *    desfaz a efetivação que o cron gravou no meio (compare-and-swap);
 *  - a falha da nota da conta traz as pendências item a item;
 *  - o cron só roda em produção.
 *
 * O banco falso implementa só os filtros que este código usa, com a semântica
 * do Postgres onde ela importa: `path … equals: AnyNull` casa a chave AUSENTE
 * (o SQL do Prisma é `#> … = 'null' OR #> … IS NULL`, conferido em
 * 24/09/2026), `notIn` não casa nulo, e toda escrita carimba `updatedAt`
 * (@updatedAt no schema). O `equals` do fiscalInfo inteiro com objeto (o
 * compare-and-swap) foi conferido contra o Postgres num SELECT em 24/09/2026.
 */
import { Prisma } from "@prisma/client";

// ── Banco falso ──────────────────────────────────────────────────────────────
type Linha = Record<string, any>;
const db: { user: Linha[]; customerOrder: Linha[]; tableSession: Linha[] } = { user: [], customerOrder: [], tableSession: [] };
let falharGravacaoEmitida = 0; // faz o próximo update EMITTED lançar (simula o banco caindo)
/**
 * Uma escrita de OUTRO caminho que chega logo antes de um updateMany (a
 * corrida entre a leitura e a escrita): roda uma vez, no primeiro updateMany
 * de pedido cujo `where` cita o id e que `casa` aceita.
 */
let antesDaGravacao: { id: string; casa: (args: any) => boolean; fazer: () => void } | null = null;

const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const ehAnyNull = (v: unknown) => v === Prisma.AnyNull || v === Prisma.DbNull || v === Prisma.JsonNull;

function casaCampo(valor: any, filtro: any): boolean {
  if (filtro === null) return valor == null;
  if (filtro instanceof Date) return valor instanceof Date && valor.getTime() === filtro.getTime();
  if (typeof filtro !== "object" || Array.isArray(filtro)) return igual(valor, filtro);
  if (ehAnyNull(filtro)) return valor == null;
  if ("path" in filtro) {
    const noCaminho = (filtro.path as string[]).reduce((v: any, k) => (v == null ? undefined : v[k]), valor);
    if ("equals" in filtro) return ehAnyNull(filtro.equals) ? noCaminho == null : igual(noCaminho, filtro.equals);
    throw new Error(`filtro de caminho não suportado: ${JSON.stringify(filtro)}`);
  }
  for (const [op, alvo] of Object.entries(filtro)) {
    if (op === "equals") { if (ehAnyNull(alvo) ? valor != null : !igual(valor, alvo)) return false; }
    else if (op === "in") { if (!(alvo as unknown[]).includes(valor)) return false; }
    else if (op === "notIn") { if (valor == null || (alvo as unknown[]).includes(valor)) return false; }
    else if (op === "gte") { if (!(valor instanceof Date) || valor.getTime() < (alvo as Date).getTime()) return false; }
    else if (op === "not") { if (valor == null || igual(valor, alvo)) return false; }
    else throw new Error(`operador não suportado: ${op}`);
  }
  return true;
}
function casa(linha: Linha, where: any): boolean {
  if (!where) return true;
  for (const [k, v] of Object.entries(where)) {
    if (k === "AND") { if (!(v as any[]).every((w) => casa(linha, w))) return false; }
    else if (k === "OR") { if (!(v as any[]).some((w) => casa(linha, w))) return false; }
    else if (k === "NOT") { if (casa(linha, v)) return false; }
    else if (!casaCampo(linha[k], v)) return false;
  }
  return true;
}
function ordenar<T extends Linha>(linhas: T[], orderBy: any): T[] {
  if (!orderBy) return linhas;
  const [[campo, dir]] = Object.entries(orderBy) as [string, string][];
  return [...linhas].sort((a, b) => (a[campo].getTime() - b[campo].getTime()) * (dir === "desc" ? -1 : 1));
}
const copia = <T>(v: T): T => (v == null ? v : structuredClone(v));
function projetar(linha: Linha, args: any, modelo: keyof typeof db): Linha {
  const saida: Linha = { ...linha };
  if (modelo === "tableSession") {
    const sel = args?.select?.orders;
    if (sel) {
      let pedidos = db.customerOrder.filter((o) => o.tableSessionId === linha.id);
      pedidos = ordenar(pedidos, sel.orderBy);
      saida.orders = pedidos.map((o) => ({ ...o, fiscalInfo: copia(o.fiscalInfo) }));
    }
  }
  if (modelo === "customerOrder") saida.fiscalInfo = copia(linha.fiscalInfo);
  return saida;
}
const delegado = (modelo: keyof typeof db) => ({
  findUnique: async (args: any) => {
    const l = db[modelo].find((x) => casa(x, args.where));
    return l ? projetar(l, args, modelo) : null;
  },
  findFirst: async (args: any) => {
    const l = db[modelo].find((x) => casa(x, args.where));
    return l ? projetar(l, args, modelo) : null;
  },
  findMany: async (args: any = {}) => {
    const achados = ordenar(db[modelo].filter((x) => casa(x, args.where)), args.orderBy);
    return achados.slice(0, args.take ?? achados.length).map((l) => projetar(l, args, modelo));
  },
  updateMany: async (args: any) => {
    if (modelo === "customerOrder" && args.data?.fiscalStatus === "EMITTED" && falharGravacaoEmitida > 0) {
      falharGravacaoEmitida--;
      throw new Error("conexão com o banco caiu");
    }
    if (modelo === "customerOrder" && antesDaGravacao && JSON.stringify(args.where).includes(`"${antesDaGravacao.id}"`) && antesDaGravacao.casa(args)) {
      const outro = antesDaGravacao;
      antesDaGravacao = null;
      outro.fazer();
    }
    const alvos = db[modelo].filter((x) => casa(x, args.where));
    // `updatedAt` é @updatedAt no schema: o Prisma carimba em toda escrita.
    for (const a of alvos) Object.assign(a, copia(args.data), modelo === "customerOrder" ? { updatedAt: new Date() } : {});
    return { count: alvos.length };
  },
});
/**
 * O SQL cru que o cron manda: a CONCESSÃO da rodada por loja
 * (lib/fiscal-automatico → sqlPegarConcessaoDaRodada), compare-and-set em
 * fiscalConfig.rodadaFiscal. Reconhecido pelo marcador, como no banco falso
 * do emissor próprio (scripts/nfce-teste-apoio).
 */
async function executarSql(sql: any): Promise<number> {
  const v = sql.values as any[];
  const m = /fh:([a-z-]+)/.exec(String(sql?.sql ?? ""))?.[1] ?? "";
  if (m === "pegar-concessao-da-rodada") {
    const [dados, lojaId, agoraMs, dono] = v;
    const u = db.user.find((x) => x.id === lojaId);
    const atual = u?.fiscalConfig?.rodadaFiscal ?? {};
    if (!u || (Number(atual.ate) >= Number(agoraMs) && atual.dono !== dono)) return 0;
    u.fiscalConfig = { ...u.fiscalConfig, rodadaFiscal: JSON.parse(dados) };
    return 1;
  }
  if (m === "soltar-concessao-da-rodada") {
    const [lojaId, dono] = v;
    const u = db.user.find((x) => x.id === lojaId);
    if (!u || u.fiscalConfig?.rodadaFiscal?.dono !== dono) return 0;
    const { rodadaFiscal, ...resto } = u.fiscalConfig;
    void rodadaFiscal;
    u.fiscalConfig = resto;
    return 1;
  }
  throw new Error(`SQL cru não previsto no banco falso: "${m}"`);
}
(globalThis as any).prisma = { user: delegado("user"), customerOrder: delegado("customerOrder"), tableSession: delegado("tableSession"), $executeRaw: executarSql };
process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";

// ── Provedor falso ───────────────────────────────────────────────────────────
type Chamada = { metodo: string; ref: string; host: string; corpo: any };
const chamadas: Chamada[] = [];
/**
 * ref → resposta: "autoriza", "contingencia" (autorizada off-line, não
 * efetivada), "rejeita" (a SEFAZ recusou: erro_autorizacao) ou "cai" (500).
 * Sem entrada: 500.
 */
const respostas = new Map<string, "autoriza" | "contingencia" | "rejeita" | "cai">();
/** ref → o único servidor da Focus em que a nota existe; no outro, 404. */
const soNoServidor = new Map<string, "api.focusnfe.com.br" | "homologacao.focusnfe.com.br">();
/**
 * ref → o que acontece no mundo DURANTE a consulta dessa ref (o provedor
 * demora; nesse tempo o iFood cancela o pedido). Roda uma vez, antes da
 * resposta do GET.
 */
const duranteAConsulta = new Map<string, () => Promise<void>>();
let numero = 100;
(globalThis as any).fetch = async (url: string, init: any = {}) => {
  const metodo = String(init.method || "GET");
  const ref = decodeURIComponent(String(url).match(/nfce(?:\?ref=|\/)([^?&]+)/)?.[1] || "");
  const host = new URL(String(url)).host;
  chamadas.push({ metodo, ref, host, corpo: init.body ? JSON.parse(init.body) : null });
  const noMeio = metodo === "GET" ? duranteAConsulta.get(ref) : undefined;
  if (noMeio) {
    duranteAConsulta.delete(ref);
    await noMeio();
  }
  const onde = soNoServidor.get(ref);
  if (onde && onde !== host) {
    return new Response(JSON.stringify({ codigo: "nao_encontrado", mensagem: "Nota fiscal não encontrada" }), { status: 404 });
  }
  const r = respostas.get(ref) ?? "cai";
  if (r === "autoriza" || r === "contingencia") {
    numero++;
    return new Response(JSON.stringify({
      status: "autorizado", chave_nfe: "NFe" + String(numero).padStart(44, "3"), numero, serie: 1,
      protocolo: "1330000" + numero, data_emissao: new Date().toISOString(),
      caminho_danfe: `/arquivos/danfe-${numero}.html`, caminho_xml_nota_fiscal: `/arquivos/${numero}.xml`,
      ...(r === "contingencia" ? { contingencia_offline: true, contingencia_offline_efetivada: false } : {}),
    }), { status: 201, headers: { "Content-Type": "application/json" } });
  }
  if (r === "rejeita") {
    return new Response(JSON.stringify({ status: "erro_autorizacao", status_sefaz: "778", mensagem_sefaz: "Rejeição: NCM inexistente" }), { status: 200 });
  }
  return new Response(JSON.stringify({ codigo: "erro_interno", mensagem: "fora do ar" }), { status: 500 });
};

// ── Cenário ──────────────────────────────────────────────────────────────────
const LOJA = "loja-1";
const agora = new Date();
const haMin = (min: number) => new Date(agora.getTime() - min * 60_000);
db.user.push({
  id: LOJA, ifoodMerchantId: null, food99MerchantId: null,
  fiscalConfig: {
    enabled: true, provedor: "focusnfe", tokenDoProvedor: "token-de-teste", ambiente: 2, serie: 1,
    cnpj: "11.222.333/0001-81", inscricaoEstadual: "12.345.678", razaoSocial: "LOJA TESTE LTDA", regimeTributario: 1,
    logradouro: "Rua A", numero: "100", bairro: "Centro", municipio: "Rio das Ostras", codigoMunicipio: "3304524",
    uf: "RJ", cep: "28890-000", cscId: "1", csc: "abc", temCertificado: true,
    autoEmitPaymentMethods: ["PIX", "CREDIT_CARD"], momentoDaEmissao: "saida",
  },
});
// Um defeito DENTRO de `emitirNfce`, antes do fetch: `montarCorpoDaNfce` lê
// `config.intermediadores[canal]` (lib/fiscal-emissao → intermediadorDoPedido;
// na conta da mesa o canal é "MESA") e só ela lê. O getter mora num objeto
// ANINHADO: a emissão lê a config NORMALIZADA (lib/fiscal-config), que é uma
// cópia rasa — um getter no próprio fiscalConfig (como era, no `pixEstatico`)
// some na cópia e o defeito nunca dispararia. Armado só no caso da seção 3.
let armarDefeitoNaMontagem = false;
const intermediadoresComDefeito: Record<string, unknown> = {};
// "MESA" é o canal da conta da mesa; "PDV" o do pedido de balcão (seção 8).
for (const canal of ["MESA", "PDV"]) {
  Object.defineProperty(intermediadoresComDefeito, canal, {
    enumerable: false,
    get() {
      if (armarDefeitoNaMontagem) throw new Error("defeito na montagem do corpo da nota");
      return undefined;
    },
  });
}
db.user[0].fiscalConfig.intermediadores = intermediadoresComDefeito;
const produto = { id: "pz", name: "Pastel", ncm: "19059090", cfop: "5102", csosn: "102", origem: "0" };
const itens = (valor: number) => [{ id: `i-${valor}`, productName: "Pastel", quantity: 1, price: valor, menuProduct: produto }];
let seq = 0;
function pedido(p: Partial<Linha>): Linha {
  const o: Linha = {
    id: `p${++seq}`, franchiseeId: LOJA, status: "ENTREGUE", deliveryType: "RETIRADA", tableSessionId: null,
    paymentMethod: "Pix", paymentMethods: null, gatewayPaymentId: null, totalAmount: 30, customerCpfCnpj: null,
    customerName: "Cliente", customerAddress: null, source: "BALCAO", fiscalStatus: "PENDING", fiscalInfo: null,
    createdAt: haMin(60), items: itens(30), ...p,
  };
  // Sem gravação desde a criação, a não ser que o caso diga outra coisa.
  if (!o.updatedAt) o.updatedAt = o.createdAt;
  db.customerOrder.push(o);
  return o;
}

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};
const doPedido = (id: string) => db.customerOrder.find((o) => o.id === id)!;

async function main() {
  const { retentarNotasFiscais, emitirNfceDaMesa } = await import("../src/lib/fiscal-automatico");

  // ── 1. A fila de retentativa ──────────────────────────────────────────────
  console.log("\n— Fila de retentativa —");
  // 45 esgotadas (5 tentativas), gravadas pela versão anterior, sem a marca.
  // A NOVA fica por último no banco: com `take: 40` sem ordem ela não entrava.
  const esgotadas = Array.from({ length: 45 }, (_, i) =>
    pedido({
      createdAt: haMin(300 + i), fiscalStatus: "FAILED",
      fiscalInfo: { motivo: "erro_de_comunicacao", tentativasAutomaticas: 5, ultimaTentativaEm: haMin(200).toISOString(), ultimoErro: "fora" },
    })
  );
  // Falha do botão Emitir num pedido em dinheiro (fora da lista da automática).
  const doBotao = pedido({
    createdAt: haMin(90), paymentMethod: "Dinheiro", fiscalStatus: "FAILED",
    fiscalInfo: { motivo: "erro_de_comunicacao", ultimaTentativaEm: haMin(80).toISOString(), ultimoErro: "fora" },
  });
  // A 4ª tentativa: vai falhar de novo e esgotar AGORA.
  const quarta = pedido({
    createdAt: haMin(50), fiscalStatus: "FAILED",
    fiscalInfo: { motivo: "erro_de_comunicacao", tentativasAutomaticas: 4, ultimaTentativaEm: haMin(20).toISOString(), ultimoErro: "fora" },
  });
  const nova = pedido({
    createdAt: haMin(8), status: "SAIU_ENTREGA", deliveryType: "RETIRADA", fiscalStatus: "FAILED",
    fiscalInfo: { motivo: "erro_de_comunicacao", tentativasAutomaticas: 1, ultimaTentativaEm: haMin(5).toISOString(), ultimoErro: "fora" },
  });
  // Retirada SAIU_ENTREGA não é hora da nota no modo "saida": ENTREGUE é.
  nova.status = "ENTREGUE";
  respostas.set(`firehub-${nova.id}`, "autoriza");

  const r1 = await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere("a falha nova entrou na fila e foi reemitida (autorizada)", [doPedido(nova.id).fiscalStatus, r1.reemitidas >= 1], ["EMITTED", true]);
  confere("a 4ª tentativa falhou e já saiu da fila com o motivo", [doPedido(quarta.id).fiscalInfo.tentativasAutomaticas, doPedido(quarta.id).fiscalInfo.retentativaEncerrada, String(doPedido(quarta.id).fiscalInfo.motivoDoFimDaRetentativa).includes("5 tentativas")], [5, true, true]);
  confere(
    "a falha do botão em dinheiro saiu da fila, dizendo que a automática não cobre",
    [doPedido(doBotao.id).fiscalInfo.retentativaEncerrada, String(doPedido(doBotao.id).fiscalInfo.motivoDoFimDaRetentativa).includes("não cobre")],
    [true, true]
  );
  confere("o botão em dinheiro não foi ao provedor", chamadas.some((c) => c.ref === `firehub-${doBotao.id}`), false);
  const encerradasNa1 = esgotadas.filter((e) => doPedido(e.id).fiscalInfo.retentativaEncerrada === true).length;
  const r2 = await retentarNotasFiscais({ orcamentoMs: 60_000 });
  const encerradasNa2 = esgotadas.filter((e) => doPedido(e.id).fiscalInfo.retentativaEncerrada === true).length;
  confere("as 45 esgotadas saem da fila em duas rodadas (40 por busca), sem ir ao provedor", [encerradasNa1 > 0, encerradasNa2, chamadas.filter((c) => esgotadas.some((e) => c.ref === `firehub-${e.id}`)).length], [true, 45, 0]);
  const r3 = await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere("na 3ª rodada a fila está limpa: nada reemitido, nada encerrado", [r3.reemitidas, r3.encerradas], [0, 0]);
  confere("resumo conta as encerradas", r1.encerradas + r2.encerradas >= 46, true);
  // Uma tentativa nova (gancho de status) apaga a marca: a falha nova volta à fila.
  const { emitirNfceAutomatica } = await import("../src/lib/fiscal-automatico");
  doBotao.paymentMethod = "Pix";
  await emitirNfceAutomatica(doBotao.id);
  confere("tentativa nova apaga o fim da retentativa anterior", [doPedido(doBotao.id).fiscalStatus, doPedido(doBotao.id).fiscalInfo.retentativaEncerrada ?? null, doPedido(doBotao.id).fiscalInfo.tentativasAutomaticas], ["FAILED", null, 1]);

  // ── 2. A conta de mesa esquecida ──────────────────────────────────────────
  console.log("\n— Conta de mesa esquecida —");
  const sessao = (id: string, s: Partial<Linha>) => {
    db.tableSession.push({ id, franchiseeId: LOJA, status: "CLOSED", closedAt: haMin(10), customerName: "Mesa 4", serviceFee: 0, waiterTip: 0, paymentMethods: [], ...s });
  };
  // Conta de R$ 143 (80 + 63), paga com R$ 100 no cartão e R$ 50 em dinheiro.
  sessao("S1", { paymentMethods: [{ method: "Cartão Crédito", amount: 100 }, { method: "Dinheiro", amount: 50 }] });
  const s1a = pedido({ tableSessionId: "S1", deliveryType: "MESA", paymentMethod: "N/A", totalAmount: 80, items: itens(80), createdAt: haMin(70) });
  const s1b = pedido({ tableSessionId: "S1", deliveryType: "MESA", paymentMethod: "N/A", totalAmount: 63, items: itens(63), createdAt: haMin(40) });
  respostas.set("firehub-mesa-S1", "autoriza");
  // Paga só em dinheiro — fora da lista (PIX, CREDIT_CARD): não é da automática.
  sessao("S2", { paymentMethods: [{ method: "Dinheiro", amount: 30 }] });
  const s2 = pedido({ tableSessionId: "S2", deliveryType: "MESA", paymentMethod: "N/A", createdAt: haMin(30) });
  // Um pedido já rejeitado: é de uma pessoa, não da varredura.
  sessao("S3", { paymentMethods: [{ method: "Pix", amount: 30 }] });
  pedido({ tableSessionId: "S3", deliveryType: "MESA", fiscalStatus: "FAILED", fiscalInfo: { motivo: "rejeitada", ultimoErro: "x" } });
  // Itens ilegíveis: a montagem lança — antes era só console.error.
  sessao("S4", { paymentMethods: [{ method: "Pix", amount: 30 }] });
  const s4 = pedido({ tableSessionId: "S4", deliveryType: "MESA", items: null });
  // Fechada antes da janela (3 h): fora.
  sessao("S5", { closedAt: haMin(180), paymentMethods: [{ method: "Pix", amount: 30 }] });
  const s5 = pedido({ tableSessionId: "S5", deliveryType: "MESA" });

  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere("a conta esquecida saiu: os dois pedidos com a mesma nota da conta", [doPedido(s1a.id).fiscalStatus, doPedido(s1b.id).fiscalStatus, doPedido(s1a.id).fiscalInfo.idDaNota, doPedido(s1a.id).fiscalInfo.nfceKey === doPedido(s1b.id).fiscalInfo.nfceKey], ["EMITTED", "EMITTED", "mesa-S1", true]);
  const corpoS1 = chamadas.find((c) => c.ref === "firehub-mesa-S1" && c.metodo === "POST")?.corpo;
  confere(
    "a nota da conta foi com o cartão exato e o troco no dinheiro (DIMP)",
    corpoS1 && [corpoS1.valor_total, corpoS1.formas_pagamento.map((f: any) => [f.forma_pagamento, f.valor_pagamento]), corpoS1.valor_troco],
    [143, [["03", 100], ["01", 50]], 7]
  );
  confere("conta paga em forma fora da lista: não emitida", [chamadas.some((c) => c.ref === "firehub-mesa-S2"), doPedido(s2.id).fiscalInfo], [false, null]);
  confere("conta com pedido rejeitado: não emitida pela varredura", chamadas.some((c) => c.ref === "firehub-mesa-S3"), false);
  confere(
    "exceção na montagem da conta ficou registrada (FAILED, erro interno, sem ref da conta)",
    [doPedido(s4.id).fiscalStatus, doPedido(s4.id).fiscalInfo.motivo, String(doPedido(s4.id).fiscalInfo.ultimoErro).includes("erro interno"), doPedido(s4.id).fiscalInfo.idDaNota ?? null],
    ["FAILED", "erro_interno", true, null]
  );
  confere("conta fechada fora da janela: não emitida", [chamadas.some((c) => c.ref === "firehub-mesa-S5"), doPedido(s5.id).fiscalInfo], [false, null]);
  const antes = chamadas.length;
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere("a rodada seguinte não repete a conta que falhou por erro interno", chamadas.slice(antes).some((c) => c.ref === "firehub-mesa-S4"), false);

  // ── 3. O fechamento: desconto gravado antes, exceção depois do envio ──────
  console.log("\n— Fechamento da conta —");
  sessao("S6", { paymentMethods: [{ method: "Pix", amount: 45 }] });
  const s6 = pedido({ tableSessionId: "S6", deliveryType: "MESA", totalAmount: 50, items: itens(50) });
  respostas.set("firehub-mesa-S6", "autoriza");
  falharGravacaoEmitida = 1; // a SEFAZ autoriza, e o banco cai na hora de gravar
  const r6 = await emitirNfceDaMesa("S6", { desconto: 5 });
  confere(
    "exceção depois de enviar: fica 'processando' com a ref da conta e o desconto do fechamento",
    [r6.acao, doPedido(s6.id).fiscalStatus, doPedido(s6.id).fiscalInfo.processando, doPedido(s6.id).fiscalInfo.idDaNota, doPedido(s6.id).fiscalInfo.contaDaMesa?.desconto, doPedido(s6.id).fiscalInfo.contaDaMesa?.origemDoDesconto],
    ["ignorado", "PENDING", true, "mesa-S6", 5, "fechamento"]
  );
  confere(
    "o 'processando' da exceção já leva o que a nota declarou (vNF 45, Pix)",
    [doPedido(s6.id).fiscalInfo.valorDaNota, doPedido(s6.id).fiscalInfo.formaNaNota],
    [45, "Pix"]
  );
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere("a consulta do cron acha a nota e grava EMITTED", [doPedido(s6.id).fiscalStatus, doPedido(s6.id).fiscalInfo.idDaNota, doPedido(s6.id).fiscalInfo.contaDaMesa?.desconto], ["EMITTED", "mesa-S6", 5]);
  // Antes: a consulta copiava só o gravado, e o "processando" da exceção não
  // tinha a nota — EMITTED sem valorDaNota, e agruparPorNota caía na soma dos
  // pedidos (50) para uma nota de vNF 45.
  const { agruparPorNota } = await import("../src/lib/fiscal-momento");
  confere(
    "depois da consulta: valorDaNota 45 e formaNaNota Pix; a lista de notas vale 45, não 50",
    [doPedido(s6.id).fiscalInfo.valorDaNota, doPedido(s6.id).fiscalInfo.formaNaNota, agruparPorNota([doPedido(s6.id) as any]).map((n) => n.valor)],
    [45, "Pix", [45]]
  );
  // Exceção DENTRO de `emitirNfce` (montagem do corpo, antes do fetch): é
  // defeito nosso, não "processando". Antes a marca "enviada" vinha antes de
  // `emitirNfce`, e o ciclo ia até "5 tentativas sem resposta do provedor".
  sessao("S9", { paymentMethods: [{ method: "Pix", amount: 30 }] });
  const s9 = pedido({ tableSessionId: "S9", deliveryType: "MESA", totalAmount: 30, items: itens(30) });
  respostas.set("firehub-mesa-S9", "autoriza");
  armarDefeitoNaMontagem = true;
  const r9 = await emitirNfceDaMesa("S9", { desconto: 0 });
  armarDefeitoNaMontagem = false;
  const info9 = doPedido(s9.id).fiscalInfo;
  confere(
    "exceção na montagem dentro de emitirNfce: FAILED erro_interno, sem ref da conta, sem ir ao provedor",
    [r9.acao, doPedido(s9.id).fiscalStatus, info9.motivo, info9.processando, info9.idDaNota ?? null, String(info9.ultimoErro).includes("erro interno"), chamadas.some((c) => c.ref === "firehub-mesa-S9")],
    ["ignorado", "FAILED", "erro_interno", false, null, true, false]
  );
  const antes9 = chamadas.length;
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere(
    "a rodada seguinte não consulta nem reemite a conta do defeito interno",
    [chamadas.slice(antes9).some((c) => c.ref === "firehub-mesa-S9"), doPedido(s9.id).fiscalInfo.motivo],
    [false, "erro_interno"]
  );
  // Conta com 100% de desconto: não há venda para a nota. Marca, e a varredura não insiste.
  sessao("S7", { paymentMethods: [{ method: "Pix", amount: 0.01 }] });
  const s7 = pedido({ tableSessionId: "S7", deliveryType: "MESA", totalAmount: 20, items: itens(20) });
  const r7 = await emitirNfceDaMesa("S7", { desconto: 20 });
  confere("conta de total zero: marcada sem nota, status fiscal intacto", [r7.foraDaAutomatica, doPedido(s7.id).fiscalStatus, Boolean(doPedido(s7.id).fiscalInfo.semNotaAutomatica)], [true, "PENDING", true]);
  const antes7 = chamadas.length;
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere("a varredura não volta na conta de total zero", chamadas.slice(antes7).some((c) => c.ref === "firehub-mesa-S7"), false);
  // Desconto não gravado (a exceção veio antes até disso): deduzido do pago.
  sessao("S8", { paymentMethods: [{ method: "Pix", amount: 27 }], serviceFee: 2.7 });
  const s8 = pedido({ tableSessionId: "S8", deliveryType: "MESA", totalAmount: 30, items: itens(30) });
  respostas.set("firehub-mesa-S8", "autoriza");
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  const corpoS8 = chamadas.find((c) => c.ref === "firehub-mesa-S8")?.corpo;
  confere(
    "sem desconto gravado: o pago (27 − 2,70 de taxa) define a nota, e a origem fica registrada",
    [corpoS8?.valor_total, doPedido(s8.id).fiscalInfo.contaDaMesa?.desconto, doPedido(s8.id).fiscalInfo.contaDaMesa?.origemDoDesconto],
    [24.3, 5.7, "pago"]
  );
  // A nota da conta pedida à mão (tela): passa mesmo com forma fora da lista.
  respostas.set("firehub-mesa-S2", "autoriza");
  const r2m = await emitirNfceDaMesa("S2", { manual: true });
  confere("nota da conta manual: sai mesmo em dinheiro, e não se diz automática", [r2m.acao, doPedido(s2.id).fiscalInfo.emitidaAutomaticamente], ["emitida", false]);

  // ── 4. Contingência off-line ──────────────────────────────────────────────
  // A nota em contingência VALE para o cliente e o DANFE tem de ser impresso.
  // A versão anterior gravava PENDING/"processando": a aba Notas fiscais só
  // mostra o DANFE em EMITTED (api/store/fiscal/invoices), e o "Consultar
  // situação" que ela oferece em Processando apagava a marca. Agora é EMITTED
  // com `contingencia: true`, e o cron consulta até efetivar ou recusar.
  console.log("\n— Contingência off-line —");
  const offline = pedido({ createdAt: haMin(3), status: "ENTREGUE", deliveryType: "RETIRADA", paymentMethod: "Pix" });
  respostas.set(`firehub-${offline.id}`, "contingencia");
  const rc = await emitirNfceAutomatica(offline.id);
  const { travaDaNotaFiscal } = await import("../src/lib/edicao-de-pedido");
  const infoC = doPedido(offline.id).fiscalInfo;
  confere(
    "contingência: EMITTED com a chave, o DANFE e a marca (a tela mostra o cupom para imprimir)",
    [rc.acao, doPedido(offline.id).fiscalStatus, infoC.contingencia, Boolean(infoC.nfceKey), String(infoC.pdfUrl).startsWith("https://homologacao.focusnfe.com.br/arquivos/danfe-"), Boolean(infoC.contingenciaDesde)],
    ["emitida", "EMITTED", true, true, true, true]
  );
  confere(
    "a trava fala da contingência (e, com o pedido já levado, não promete cancelar)",
    ((f) => [f.includes("contingência"), f.includes("não vai poder ser cancelada")])(travaDaNotaFiscal({ ...doPedido(offline.id), fiscalInfo: { ...doPedido(offline.id).fiscalInfo, ambiente: 1 } }, "cancelar o pedido") || ""),
    [true, true]
  );
  const antesC = chamadas.length;
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere(
    "ainda em contingência: o cron consultou (GET) e a nota segue EMITTED com a marca",
    [chamadas.slice(antesC).filter((c) => c.ref === `firehub-${offline.id}`).map((c) => c.metodo), doPedido(offline.id).fiscalStatus, doPedido(offline.id).fiscalInfo.contingencia, Boolean(doPedido(offline.id).fiscalInfo.ultimaConsultaEm)],
    [["GET"], "EMITTED", true, true]
  );
  respostas.set(`firehub-${offline.id}`, "autoriza"); // a SEFAZ efetivou
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere(
    "efetivada: EMITTED sem a marca, com a hora da efetivação",
    [doPedido(offline.id).fiscalStatus, doPedido(offline.id).fiscalInfo.contingencia ?? null, Boolean(doPedido(offline.id).fiscalInfo.contingenciaEfetivadaEm)],
    ["EMITTED", null, true]
  );
  const antesE = chamadas.length;
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere("efetivada, sai da consulta do cron", chamadas.slice(antesE).some((c) => c.ref === `firehub-${offline.id}`), false);
  // A SEFAZ recusa a nota em contingência na transmissão: o cupom deixa de
  // valer — só este EMITTED pode virar FAILED.
  const recusada = pedido({ createdAt: haMin(4), status: "ENTREGUE", deliveryType: "RETIRADA", paymentMethod: "Pix" });
  respostas.set(`firehub-${recusada.id}`, "contingencia");
  await emitirNfceAutomatica(recusada.id);
  respostas.set(`firehub-${recusada.id}`, "rejeita");
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  const infoR = doPedido(recusada.id).fiscalInfo;
  confere(
    "contingência recusada na transmissão: FAILED, sem a marca, dizendo que o cupom não vale",
    [doPedido(recusada.id).fiscalStatus, infoR.contingencia, Boolean(infoR.contingenciaRecusadaEm), String(infoR.ultimoErro).includes("CONTINGÊNCIA"), String(infoR.ultimoErro).includes("778")],
    ["FAILED", false, true, true, true]
  );
  // Uma nota autorizada comum nunca é trocada por falha (a trava SEM_NOTA_VIVA).
  const autorizada = doPedido(nova.id);
  confere("nota autorizada comum continua EMITTED depois de tudo", autorizada.fiscalStatus, "EMITTED");

  // ── 5. "Ainda não é a hora" é passageiro ──────────────────────────────────
  // Retirada em Pix, modo "saida": a loja clicou Emitir em PREPARANDO com o
  // provedor fora. Antes, a 1ª rodada encerrava a linha ("status PREPARANDO
  // ainda não é a hora") e, quando o pedido ia a ENTREGUE por um caminho sem
  // gancho, a nota nunca saía.
  console.log("\n— Status que ainda não é a hora —");
  const cedo = pedido({
    createdAt: haMin(15), status: "PREPARANDO", deliveryType: "RETIRADA", paymentMethod: "Pix", fiscalStatus: "FAILED",
    fiscalInfo: { motivo: "erro_de_comunicacao", ultimaTentativaEm: haMin(10).toISOString(), ultimoErro: "fora" },
  });
  const cancelado = pedido({
    createdAt: haMin(15), status: "CANCELADO", deliveryType: "RETIRADA", paymentMethod: "Pix", fiscalStatus: "FAILED",
    fiscalInfo: { motivo: "erro_de_comunicacao", ultimaTentativaEm: haMin(10).toISOString(), ultimoErro: "fora" },
  });
  respostas.set(`firehub-${cedo.id}`, "autoriza");
  respostas.set(`firehub-${cancelado.id}`, "autoriza");
  const rCedo = await emitirNfceAutomatica(cedo.id);
  confere("o gancho em PREPARANDO volta 'ignorado' SEM a marca de fora da automática", [rCedo.acao, rCedo.foraDaAutomatica ?? null], ["ignorado", null]);
  const rCancelado = await emitirNfceAutomatica(cancelado.id);
  confere("pedido cancelado, sim, é fora da automática", rCancelado.foraDaAutomatica, true);
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere(
    "rodada com o pedido na cozinha: não encerra, não emite",
    [doPedido(cedo.id).fiscalStatus, doPedido(cedo.id).fiscalInfo.retentativaEncerrada ?? null, chamadas.some((c) => c.ref === `firehub-${cedo.id}`)],
    ["FAILED", null, false]
  );
  cedo.status = "ENTREGUE"; // pelo KDS / fechamento de caixa: sem gancho de status
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere("o pedido chegou à hora por um caminho sem gancho: a rodada seguinte emite", doPedido(cedo.id).fiscalStatus, "EMITTED");
  confere("o cancelado nunca foi ao provedor", chamadas.some((c) => c.ref === `firehub-${cancelado.id}`), false);

  // ── 6. Ambiente da nota e carimbo de "emissão ligada" ─────────────────────
  // A loja testou em homologação (uma nota ficou processando) e passou para
  // produção há 5 min (`emissaoLigadaEm` recarimbado). Antes o cron consultava
  // em api.focusnfe.com.br (404), a nota virava falha e a rodada seguinte
  // fazia o POST em PRODUÇÃO para uma venda anterior à troca.
  console.log("\n— Ambiente da nota e emissão ligada —");
  const PROD = "loja-prod";
  db.user.push({
    id: PROD, ifoodMerchantId: null, food99MerchantId: null,
    fiscalConfig: { ...db.user[0].fiscalConfig, ambiente: 1, emissaoLigadaEm: haMin(5).toISOString() },
  });
  const deProd = (p: Partial<Linha>) => pedido({ franchiseeId: PROD, ...p });
  const homolog = deProd({
    createdAt: haMin(40), fiscalStatus: "PENDING",
    fiscalInfo: { processando: true, ambiente: 2, ultimaTentativaEm: haMin(39).toISOString(), tentativasAutomaticas: 1 },
  });
  soNoServidor.set(`firehub-${homolog.id}`, "homologacao.focusnfe.com.br");
  respostas.set(`firehub-${homolog.id}`, "autoriza");
  const falhaHomolog = deProd({
    createdAt: haMin(30), fiscalStatus: "FAILED",
    fiscalInfo: { motivo: "erro_de_comunicacao", ambiente: 2, tentativasAutomaticas: 1, ultimaTentativaEm: haMin(20).toISOString(), ultimoErro: "fora" },
  });
  const antesDeLigar = deProd({
    createdAt: haMin(30), fiscalStatus: "FAILED",
    fiscalInfo: { motivo: "erro_de_comunicacao", ultimaTentativaEm: haMin(20).toISOString(), ultimoErro: "fora" },
  });
  const depoisDeLigar = deProd({
    createdAt: haMin(3), fiscalStatus: "FAILED",
    fiscalInfo: { motivo: "erro_de_comunicacao", ambiente: 1, tentativasAutomaticas: 1, ultimaTentativaEm: haMin(3).toISOString(), ultimoErro: "fora" },
  });
  for (const p of [falhaHomolog, antesDeLigar, depoisDeLigar]) respostas.set(`firehub-${p.id}`, "autoriza");
  const antesAmb = chamadas.length;
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  const doHomolog = chamadas.slice(antesAmb).filter((c) => c.ref === `firehub-${homolog.id}`).map((c) => `${c.metodo} ${c.host}`);
  confere(
    "a nota que ficou processando em homologação é consultada em homologação, e só",
    [doHomolog[0], doHomolog.every((c) => c === "GET homologacao.focusnfe.com.br"), doPedido(homolog.id).fiscalStatus, doPedido(homolog.id).fiscalInfo.ambiente],
    ["GET homologacao.focusnfe.com.br", true, "EMITTED", 2]
  );
  confere(
    "falha de homologação não é reemitida em produção: sai da fila dizendo por quê",
    [chamadas.slice(antesAmb).some((c) => c.ref === `firehub-${falhaHomolog.id}`), doPedido(falhaHomolog.id).fiscalInfo.retentativaEncerrada, String(doPedido(falhaHomolog.id).fiscalInfo.motivoDoFimDaRetentativa).includes("outro ambiente")],
    [false, true, true]
  );
  confere(
    "venda anterior ao carimbo de emissão ligada: não é reemitida (como na varredura)",
    [chamadas.slice(antesAmb).some((c) => c.ref === `firehub-${antesDeLigar.id}`), doPedido(antesDeLigar.id).fiscalInfo.retentativaEncerrada, String(doPedido(antesDeLigar.id).fiscalInfo.motivoDoFimDaRetentativa).includes("anterior")],
    [false, true, true]
  );
  confere(
    "controle: a falha de produção posterior ao carimbo é reemitida em produção",
    [chamadas.slice(antesAmb).filter((c) => c.ref === `firehub-${depoisDeLigar.id}`).map((c) => `${c.metodo} ${c.host}`)[0], doPedido(depoisDeLigar.id).fiscalStatus, doPedido(depoisDeLigar.id).fiscalInfo.ambiente],
    ["POST api.focusnfe.com.br", "EMITTED", 1]
  );
  confere("nenhum POST em produção para as vendas de antes da troca", chamadas.slice(antesAmb).some((c) => c.metodo === "POST" && c.host === "api.focusnfe.com.br" && [homolog.id, falhaHomolog.id, antesDeLigar.id].some((id) => c.ref === `firehub-${id}`)), false);

  // ── 7. O cron está agendado ───────────────────────────────────────────────
  // A rota só roda se estiver em scripts/cron-runner.js (o que o Dockerfile
  // sobe): sem a linha, nada deste arquivo acontece em produção. Até
  // 24/09/2026 ela não existia — agora é verificação, não aviso.
  console.log("\n— Agendamento —");
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  // Rodado da raiz do repositório (npx tsx scripts/teste-fiscal-retentativa.ts).
  const cronRunner = readFileSync(join(process.cwd(), "scripts", "cron-runner.js"), "utf8");
  confere(
    "scripts/cron-runner.js agenda /api/cron/fiscal-retentativa a cada 2 minutos",
    /name: 'fiscal-retentativa',\s*path: '\/api\/cron\/fiscal-retentativa',\s*intervalMs: 2 \* 60_000/.test(cronRunner),
    true
  );

  // ── 8. Exceção no pedido comum fica registrada ────────────────────────────
  // O catch de `emitirNfceAutomatica` era só um console.error: o pedido ficava
  // "Não emitida" sem rastro. Agora grava como a conta da mesa grava.
  console.log("\n— Exceção na emissão do pedido comum —");
  const comDefeito = pedido({ createdAt: haMin(2), status: "ENTREGUE", deliveryType: "RETIRADA", paymentMethod: "Pix" });
  respostas.set(`firehub-${comDefeito.id}`, "autoriza");
  armarDefeitoNaMontagem = true;
  const rDefeito = await emitirNfceAutomatica(comDefeito.id);
  armarDefeitoNaMontagem = false;
  const infoDefeito = doPedido(comDefeito.id).fiscalInfo;
  confere(
    "exceção antes do provedor: FAILED erro_interno com a mensagem, sem ir ao provedor",
    [rDefeito.acao, doPedido(comDefeito.id).fiscalStatus, infoDefeito?.motivo, String(infoDefeito?.ultimoErro).includes("erro interno"), chamadas.some((c) => c.ref === `firehub-${comDefeito.id}`)],
    ["ignorado", "FAILED", "erro_interno", true, false]
  );
  const antesDoDefeito = chamadas.length;
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere("a retentativa não refaz o defeito interno (daria o mesmo erro)", chamadas.slice(antesDoDefeito).some((c) => c.ref === `firehub-${comDefeito.id}`), false);

  // ── 9. Config legada: "producao" por extenso ──────────────────────────────
  // A emissão e o cron liam o fiscalConfig CRU: Number("producao") = NaN, e a
  // nota ia para o servidor de HOMOLOGAÇÃO da loja que escolheu produção.
  console.log("\n— Config legada (ambiente por extenso) —");
  const LEGADA = "loja-legada";
  db.user.push({
    id: LEGADA, ifoodMerchantId: null, food99MerchantId: null,
    fiscalConfig: { ...db.user[0].fiscalConfig, intermediadores: null, ambiente: "producao", emissaoLigadaEm: haMin(60).toISOString() },
  });
  const daLegada = pedido({
    franchiseeId: LEGADA, createdAt: haMin(10), fiscalStatus: "FAILED",
    fiscalInfo: { motivo: "erro_de_comunicacao", tentativasAutomaticas: 1, ultimaTentativaEm: haMin(9).toISOString(), ultimoErro: "fora" },
  });
  respostas.set(`firehub-${daLegada.id}`, "autoriza");
  const antesDaLegada = chamadas.length;
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere(
    "a reemissão da loja legada vai para PRODUÇÃO, e a nota fica gravada como de produção",
    [chamadas.slice(antesDaLegada).filter((c) => c.ref === `firehub-${daLegada.id}`).map((c) => `${c.metodo} ${c.host}`)[0], doPedido(daLegada.id).fiscalStatus, doPedido(daLegada.id).fiscalInfo.ambiente],
    ["POST api.focusnfe.com.br", "EMITTED", 1]
  );

  // ── 10. Conta cancelada pela loja: a automática não reemite ───────────────
  // Só uma pessoa pede a nota nova (botão Emitir → `manual`, ref -2). O
  // fechamento, a retentativa e a varredura nunca desfazem um cancelamento.
  console.log("\n— Conta com a nota cancelada —");
  sessao("S10", { paymentMethods: [{ method: "Pix", amount: 30 }] });
  const s10 = pedido({
    tableSessionId: "S10", deliveryType: "MESA", fiscalStatus: "CANCELED",
    fiscalInfo: { nfceKey: "K-S10", idDaNota: "mesa-S10", ambiente: 2, notaDaConta: { tableSessionId: "S10", pedidos: [] } },
  });
  respostas.set("firehub-mesa-S10-2", "autoriza");
  const rAuto = await emitirNfceDaMesa("S10");
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere(
    "automática: ignora a conta cancelada, nada vai ao provedor",
    [rAuto.acao, rAuto.motivo, doPedido(s10.id).fiscalStatus, chamadas.some((c) => c.ref.startsWith("firehub-mesa-S10"))],
    ["ignorado", "nota da conta cancelada pela loja", "CANCELED", false]
  );
  const rManual = await emitirNfceDaMesa("S10", { manual: true });
  confere(
    "manual: reemite com mesa-S10-2 e guarda a cancelada",
    [rManual.acao, doPedido(s10.id).fiscalStatus, doPedido(s10.id).fiscalInfo.idDaNota, doPedido(s10.id).fiscalInfo.notasAnteriores?.map((n: any) => n.nfceKey)],
    ["emitida", "EMITTED", "mesa-S10-2", ["K-S10"]]
  );

  // ── 11. Pedido cancelado pelo parceiro com a nota de pé ───────────────────
  console.log("\n— Aviso de cancelamento com nota —");
  const { alertarCancelamentoComNota } = await import("../src/lib/fiscal-automatico");
  const cancIfood = pedido({ status: "CANCELADO", ifoodOrderId: "if-77", fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "K77", nfceNumber: 77, ambiente: 1 } });
  const cancTeste = pedido({ status: "CANCELADO", ifoodOrderId: "if-78", fiscalStatus: "EMITTED", fiscalInfo: { nfceKey: "K78", ambiente: 2 } });
  const marcados = await alertarCancelamentoComNota({ ifoodOrderId: { in: ["if-77", "if-78"] } }, "iFood");
  confere(
    "marca o aviso só na nota de produção, sem mexer no status fiscal",
    [marcados, doPedido(cancIfood.id).fiscalInfo.alerta?.origem, doPedido(cancIfood.id).fiscalStatus, doPedido(cancTeste.id).fiscalInfo.alerta ?? null],
    [1, "iFood", "EMITTED", null]
  );
  const primeiro = doPedido(cancIfood.id).fiscalInfo.alerta.quando;
  await alertarCancelamentoComNota({ ifoodOrderId: "if-77" }, "disputa aceita");
  confere("o primeiro aviso fica (diz quando o cancelamento chegou)", [doPedido(cancIfood.id).fiscalInfo.alerta.quando, doPedido(cancIfood.id).fiscalInfo.alerta.origem], [primeiro, "iFood"]);

  // ── 12. Nota à mão de venda antiga: o cron acompanha ─────────────────────
  // A busca do passo 1 era pela idade do PEDIDO (48 h). O botão Emitir alcança
  // venda antiga (a conta de mesa fechada sem nota), e a nota dela que saísse
  // em contingência ou "processando" nunca era consultada.
  console.log("\n— Nota à mão de venda antiga —");
  const haDias = (d: number) => haMin(d * 24 * 60);
  sessao("S11", { closedAt: haDias(7), paymentMethods: [{ method: "Pix", amount: 30 }] });
  const s11 = pedido({ tableSessionId: "S11", deliveryType: "MESA", createdAt: haDias(7) });
  respostas.set("firehub-mesa-S11", "contingencia");
  const r11 = await emitirNfceDaMesa("S11", { manual: true });
  confere(
    "a nota da conta de uma semana atrás sai em contingência (EMITTED com a marca)",
    [r11.acao, doPedido(s11.id).fiscalStatus, doPedido(s11.id).fiscalInfo.contingencia],
    ["emitida", "EMITTED", true]
  );
  // Reprodução: o filtro antigo, aplicado às mesmas linhas.
  const pelaIdadeDoPedido = db.customerOrder.filter(
    (o) => o.franchiseeId === LOJA && o.createdAt.getTime() >= agora.getTime() - 48 * 3_600_000 && o.fiscalStatus === "EMITTED" && o.fiscalInfo?.contingencia === true
  );
  confere("reprodução: a busca pela idade do pedido (48 h) deixava esta nota de fora", pelaIdadeDoPedido.some((o) => o.id === s11.id), false);
  const antes11 = chamadas.length;
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere(
    "o cron consulta a nota da conta antiga (GET), e ela segue em contingência",
    [chamadas.slice(antes11).filter((c) => c.ref === "firehub-mesa-S11").map((c) => c.metodo), doPedido(s11.id).fiscalInfo.contingencia],
    [["GET"], true]
  );
  respostas.set("firehub-mesa-S11", "autoriza"); // a SEFAZ efetivou
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere(
    "efetivada: sai a marca e fica a hora",
    [doPedido(s11.id).fiscalStatus, doPedido(s11.id).fiscalInfo.contingencia ?? null, Boolean(doPedido(s11.id).fiscalInfo.contingenciaEfetivadaEm)],
    ["EMITTED", null, true]
  );
  // "Processando" de venda de 10 dias, gravado há 2 minutos (o botão Emitir).
  const processandoAntiga = pedido({
    createdAt: haDias(10), updatedAt: haMin(2), fiscalStatus: "PENDING",
    fiscalInfo: { processando: true, ambiente: 2, ultimaTentativaEm: haMin(2).toISOString(), emitidaAutomaticamente: false },
  });
  // Os limites: venda de 40 dias (fora do piso do índice — fica com o
  // "Consultar situação") e nota sem gravação nenhuma há 3 dias.
  const vendaDe40Dias = pedido({ createdAt: haDias(40), updatedAt: haMin(2), fiscalStatus: "PENDING", fiscalInfo: { processando: true, ambiente: 2 } });
  const paradaHa3Dias = pedido({ createdAt: haDias(10), updatedAt: haDias(3), fiscalStatus: "PENDING", fiscalInfo: { processando: true, ambiente: 2 } });
  for (const p of [processandoAntiga, vendaDe40Dias, paradaHa3Dias]) respostas.set(`firehub-${p.id}`, "autoriza");
  const antesP = chamadas.length;
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere("processando de venda de 10 dias, gravado agora: consultado e autorizado", doPedido(processandoAntiga.id).fiscalStatus, "EMITTED");
  confere(
    "fora da consulta: venda de 40 dias e nota parada há 3 dias",
    [vendaDe40Dias, paradaHa3Dias].map((p) => chamadas.slice(antesP).some((c) => c.ref === `firehub-${p.id}`)),
    [false, false]
  );

  // ── 13. O aviso do parceiro não some na consulta ──────────────────────────
  // O cron lia o fiscalInfo no começo da rodada, consultava (até 20 s por
  // nota) e regravava com as marcas daquela leitura: o aviso que o iFood
  // gravou no meio sumia — e, na contingência, a cada 2 minutos.
  console.log("\n— Aviso do parceiro durante a consulta —");
  const emContingencia = (ifoodOrderId: string, extra: Partial<Linha> = {}) =>
    deProd({
      createdAt: haMin(6), status: "SAIU_ENTREGA", deliveryType: "DELIVERY", source: "IFOOD", ifoodOrderId, fiscalStatus: "EMITTED",
      fiscalInfo: { nfceKey: `K-${ifoodOrderId}`, nfceNumber: 90, ambiente: 1, contingencia: true, contingenciaDesde: haMin(5).toISOString(), emittedAt: haMin(5).toISOString() },
      ...extra,
    });
  const corrida = emContingencia("if-90");
  respostas.set(`firehub-${corrida.id}`, "contingencia");
  duranteAConsulta.set(`firehub-${corrida.id}`, async () => {
    corrida.status = "CANCELADO"; // o iFood cancelou enquanto o provedor respondia
    await alertarCancelamentoComNota({ ifoodOrderId: "if-90" }, "iFood");
  });
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere(
    "o aviso gravado durante a consulta fica, e a nota segue em contingência",
    [doPedido(corrida.id).fiscalInfo.alerta?.origem ?? null, doPedido(corrida.id).fiscalInfo.contingencia, Boolean(doPedido(corrida.id).fiscalInfo.ultimaConsultaEm)],
    ["iFood", true, true]
  );
  respostas.set(`firehub-${corrida.id}`, "autoriza");
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere(
    "efetivada depois: o aviso continua",
    [doPedido(corrida.id).fiscalInfo.contingencia ?? null, doPedido(corrida.id).fiscalInfo.alerta?.origem ?? null],
    [null, "iFood"]
  );
  // A janela curta: o aviso chega entre a releitura e a escrita do cron.
  const corrida2 = emContingencia("if-91", { status: "CANCELADO" });
  respostas.set(`firehub-${corrida2.id}`, "autoriza");
  antesDaGravacao = {
    id: corrida2.id,
    casa: (args) => args.data?.fiscalStatus === "EMITTED",
    fazer: () => {
      corrida2.fiscalInfo = { ...corrida2.fiscalInfo, alerta: { quando: new Date().toISOString(), origem: "iFood", mensagem: "cancelado" } };
    },
  };
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere(
    "o aviso que chega entre a leitura e a escrita também fica (a escrita confere o que leu e relê)",
    [doPedido(corrida2.id).fiscalInfo.contingencia ?? null, doPedido(corrida2.id).fiscalInfo.alerta?.origem ?? null],
    [null, "iFood"]
  );
  // O contrário: o cron efetiva a contingência entre a leitura e a escrita do aviso.
  const corrida3 = emContingencia("if-92", { status: "CANCELADO" });
  const efetivadaEm = new Date().toISOString();
  antesDaGravacao = {
    id: corrida3.id,
    casa: (args) => !args.data?.fiscalStatus,
    fazer: () => {
      const { contingencia, ...resto } = corrida3.fiscalInfo;
      void contingencia;
      corrida3.fiscalInfo = { ...resto, contingenciaEfetivadaEm: efetivadaEm };
    },
  };
  await alertarCancelamentoComNota({ ifoodOrderId: "if-92" }, "iFood");
  confere(
    "o aviso não desfaz a efetivação que o cron gravou no meio (antes: a contingência voltava)",
    [doPedido(corrida3.id).fiscalInfo.contingencia ?? null, doPedido(corrida3.id).fiscalInfo.contingenciaEfetivadaEm, doPedido(corrida3.id).fiscalInfo.alerta?.origem ?? null],
    [null, efetivadaEm, "iFood"]
  );
  // E o "processando" que o cron autoriza no meio: o aviso era perdido.
  const corrida4 = deProd({
    createdAt: haMin(6), status: "CANCELADO", deliveryType: "DELIVERY", source: "IFOOD", ifoodOrderId: "if-93", fiscalStatus: "PENDING",
    fiscalInfo: { processando: true, ambiente: 1 },
  });
  antesDaGravacao = {
    id: corrida4.id,
    casa: (args) => !args.data?.fiscalStatus,
    fazer: () => {
      corrida4.fiscalStatus = "EMITTED";
      corrida4.fiscalInfo = { nfceKey: "K-if-93", nfceNumber: 93, ambiente: 1, emittedAt: new Date().toISOString() };
    },
  };
  await alertarCancelamentoComNota({ ifoodOrderId: "if-93" }, "iFood");
  confere(
    "processando autorizado no meio: o aviso é gravado sobre a nota autorizada (antes: perdido)",
    [doPedido(corrida4.id).fiscalStatus, doPedido(corrida4.id).fiscalInfo.nfceKey, String(doPedido(corrida4.id).fiscalInfo.alerta?.mensagem || "").includes("NFC-e autorizada nº 93")],
    ["EMITTED", "K-if-93", true]
  );

  // ── 14. As pendências da nota da conta chegam à tela ──────────────────────
  console.log("\n— Pendências na nota da conta —");
  const { respostaDaNotaDaConta } = await import("../src/lib/fiscal-config");
  const semNcm: Record<string, unknown> = { id: "sn", name: "Suco da casa", cfop: "5102", csosn: "102", origem: "0" };
  sessao("S12", { paymentMethods: [{ method: "Pix", amount: 30 }] });
  const s12 = pedido({ tableSessionId: "S12", deliveryType: "MESA", items: [{ id: "i-sn", productName: "Suco da casa", quantity: 1, price: 30, menuProduct: semNcm }] });
  respostas.set("firehub-mesa-S12", "autoriza");
  const r12 = await emitirNfceDaMesa("S12", { manual: true });
  const resposta12 = respostaDaNotaDaConta(r12, doPedido(s12.id));
  const falaDoNcm = (lista: unknown) => Array.isArray(lista) && lista.some((p: any) => /ncm/i.test(`${p.campo} ${p.mensagem}`));
  confere(
    "a falha da nota da conta traz o que falta, item a item (antes: só \"1 problema(s) nos itens\")",
    [r12.acao, falaDoNcm(r12.pendencias), falaDoNcm(resposta12.corpo.pendencias), resposta12.status],
    ["falhou", true, true, 409]
  );
  confere("as pendências ficam gravadas com a falha (a linha da tela mostra)", falaDoNcm(doPedido(s12.id).fiscalInfo.pendencias), true);
  confere("sem o resultado na mão, a resposta lê as gravadas", falaDoNcm(respostaDaNotaDaConta({ acao: "falhou", motivo: "x" }, doPedido(s12.id)).corpo.pendencias), true);
  semNcm.ncm = "22029900"; // a loja corrigiu o produto
  const r12b = await emitirNfceDaMesa("S12", { manual: true });
  confere("corrigido: a nota sai, e a lista velha não fica", [r12b.acao, doPedido(s12.id).fiscalInfo.pendencias ?? null], ["emitida", null]);

  // ── 15. O cron só roda em produção ────────────────────────────────────────
  // Em development o cron-auth libera tudo e o .env aponta para o banco de
  // produção: uma chamada ao cron no servidor de desenvolvimento emitiria
  // notas reais com o código de uma branch.
  console.log("\n— O cron só roda em produção —");
  const { motivoParaOCronFiscalNaoRodar } = await import("../src/lib/fiscal-momento");
  confere(
    "production roda; development e sem NODE_ENV não; a liberação explícita roda",
    [
      motivoParaOCronFiscalNaoRodar({ NODE_ENV: "production" }),
      typeof motivoParaOCronFiscalNaoRodar({ NODE_ENV: "development" }),
      typeof motivoParaOCronFiscalNaoRodar({}),
      motivoParaOCronFiscalNaoRodar({ NODE_ENV: "development", FISCAL_CRON_FORA_DE_PRODUCAO: "1" }),
    ],
    [null, "string", "string", null]
  );
  const rotaDoCron = readFileSync(join(process.cwd(), "src", "app", "api", "cron", "fiscal-retentativa", "route.ts"), "utf8");
  const guarda = rotaDoCron.indexOf("motivoParaOCronFiscalNaoRodar(process.env)");
  confere("a rota confere antes de rodar a retentativa", guarda > 0 && guarda < rotaDoCron.indexOf("await retentarNotasFiscais("), true);

  // ── 16. Como a nota é emitida (lib/fiscal-modo) ───────────────────────────
  // A escolha do módulo: automática com uma lista de formas por integração,
  // ou manual (nada sai sozinho). E a entrega sem CPF, que a SEFAZ recusa
  // (787): na automática ela não vai, não gasta número e não vira "Falhou".
  console.log("\n— Como a nota é emitida: modo, formas por integração e entrega sem CPF —");
  const MODO = "loja-modo";
  const configDoModo: Record<string, any> = {
    ...db.user[0].fiscalConfig,
    intermediadores: {},
    autoEmitPaymentMethods: ["PIX"],
    formasPorIntegracao: { IFOOD: ["ONLINE"] },
  };
  db.user.push({ id: MODO, ifoodMerchantId: "merchant-modo", food99MerchantId: null, fiscalConfig: configDoModo });
  const doModo = (p: Partial<Linha>) => pedido({ franchiseeId: MODO, createdAt: haMin(20), ...p });
  const chamouOProvedor = (id: string) => chamadas.some((c) => c.ref === `firehub-${id}` && c.metodo === "POST");

  const balcaoPix = doModo({ source: "BALCAO", paymentMethod: "Pix" });
  const balcaoDinheiro = doModo({ source: "BALCAO", paymentMethod: "Dinheiro" });
  const ifoodOnline = doModo({ source: "IFOOD", ifoodOrderId: "if-1", paymentMethod: "iFood App (Pago Online)" });
  const ifoodPix = doModo({ source: "IFOOD", ifoodOrderId: "if-2", paymentMethod: "Pix (Cobrar na entrega)" });
  for (const p of [balcaoPix, balcaoDinheiro, ifoodOnline, ifoodPix]) respostas.set(`firehub-${p.id}`, "autoriza");
  const rBalcaoPix = await emitirNfceAutomatica(balcaoPix.id);
  const rBalcaoDinheiro = await emitirNfceAutomatica(balcaoDinheiro.id);
  const rIfoodOnline = await emitirNfceAutomatica(ifoodOnline.id);
  const rIfoodPix = await emitirNfceAutomatica(ifoodPix.id);
  confere("vendas da loja seguem a lista da loja: Pix sai, Dinheiro não", [rBalcaoPix.acao, rBalcaoDinheiro.acao, rBalcaoDinheiro.foraDaAutomatica], ["emitida", "ignorado", true]);
  confere("o iFood segue a lista DELE: pago online sai, Pix na entrega não", [rIfoodOnline.acao, rIfoodPix.acao, rIfoodPix.motivo.includes("do iFood")], ["emitida", "ignorado", true]);

  // A varredura usa a mesma lista por canal.
  const esquecidoIfood = doModo({ source: "IFOOD", ifoodOrderId: "if-3", paymentMethod: "iFood App (Pago Online)" });
  const esquecidoDinheiro = doModo({ source: "BALCAO", paymentMethod: "Dinheiro" });
  respostas.set(`firehub-${esquecidoIfood.id}`, "autoriza");
  respostas.set(`firehub-${esquecidoDinheiro.id}`, "autoriza");
  const { emitirNotasEsquecidas } = await import("../src/lib/fiscal-automatico");
  await emitirNotasEsquecidas({ franchiseeId: MODO });
  confere("varredura: o iFood pago online esquecido sai; o dinheiro do balcão fica", [doPedido(esquecidoIfood.id).fiscalStatus, chamouOProvedor(esquecidoDinheiro.id)], ["EMITTED", false]);

  // Entrega sem CPF: não vai ao provedor e não vira FAILED.
  const entrega = (p: Partial<Linha>) =>
    doModo({ source: "SITE", deliveryType: "DELIVERY", status: "SAIU_ENTREGA", paymentMethod: "Pix", customerName: "Maria Souza", customerAddress: "Rua das Flores, 100 - Centro", ...p });
  const entregaSemCpf = entrega({});
  const entregaZeros = entrega({ customerCpfCnpj: "00000000000" });
  const entregaComCpf = entrega({ customerCpfCnpj: "52998224725" });
  for (const p of [entregaSemCpf, entregaZeros, entregaComCpf]) respostas.set(`firehub-${p.id}`, "autoriza");
  const rSemCpf = await emitirNfceAutomatica(entregaSemCpf.id);
  const rZeros = await emitirNfceAutomatica(entregaZeros.id);
  const rComCpf = await emitirNfceAutomatica(entregaComCpf.id);
  confere(
    "entrega sem CPF: fora da automática, sem provedor, PENDING com a marca \"falta documento\"",
    [rSemCpf.acao, rSemCpf.foraDaAutomatica, chamouOProvedor(entregaSemCpf.id), doPedido(entregaSemCpf.id).fiscalStatus, doPedido(entregaSemCpf.id).fiscalInfo?.semNotaAutomatica?.falta],
    ["ignorado", true, false, "PENDING", "documento"]
  );
  confere("o 00000000000 do JotaJá é sem CPF (falta, não inválido)", [rZeros.acao, doPedido(entregaZeros.id).fiscalInfo?.semNotaAutomatica?.falta], ["ignorado", "documento"]);
  confere("entrega com CPF sai", [rComCpf.acao, doPedido(entregaComCpf.id).fiscalStatus], ["emitida", "EMITTED"]);
  const antesDaVarredura = chamadas.length;
  await emitirNotasEsquecidas({ franchiseeId: MODO });
  confere("a varredura não volta à entrega marcada sem CPF", chamadas.slice(antesDaVarredura).some((c) => c.ref === `firehub-${entregaSemCpf.id}`), false);

  // Manual: nada sai sozinho — nem pelo gancho, nem pela varredura, nem a
  // retentativa de um clique que falhou por comunicação.
  configDoModo.modoDaEmissao = "manual";
  const manualPix = doModo({ source: "BALCAO", paymentMethod: "Pix" });
  const manualFalhou = doModo({
    source: "BALCAO", paymentMethod: "Pix", fiscalStatus: "FAILED",
    fiscalInfo: { motivo: "erro_de_comunicacao", ultimaTentativaEm: haMin(10).toISOString(), ultimoErro: "fora", tentativaAutomatica: false },
  });
  respostas.set(`firehub-${manualPix.id}`, "autoriza");
  respostas.set(`firehub-${manualFalhou.id}`, "autoriza");
  const rNoModoManual = await emitirNfceAutomatica(manualPix.id);
  confere("manual: o gancho de status não emite (fora da automática)", [rNoModoManual.acao, rNoModoManual.foraDaAutomatica, chamouOProvedor(manualPix.id)], ["ignorado", true, false]);
  confere("manual: a varredura não emite", await emitirNotasEsquecidas({ franchiseeId: MODO }), 0);
  await retentarNotasFiscais({ orcamentoMs: 60_000 });
  confere(
    "manual: a retentativa encerra o clique que falhou, com o motivo (a pessoa emite de novo pelo pedido)",
    [chamouOProvedor(manualFalhou.id), doPedido(manualFalhou.id).fiscalInfo.retentativaEncerrada, String(doPedido(manualFalhou.id).fiscalInfo.motivoDoFimDaRetentativa).includes("à mão")],
    [false, true, true]
  );
  const fonte = readFileSync(join(process.cwd(), "src", "lib", "fiscal-automatico.ts"), "utf8");
  const daMesa = fonte.slice(fonte.indexOf("export async function emitirNfceDaMesa("));
  confere(
    "manual: a conta da mesa só sai pelo clique (a guarda vem antes da lista de formas)",
    daMesa.indexOf('modoDaEmissao(config) === "manual"') > 0 && daMesa.indexOf('modoDaEmissao(config) === "manual"') < daMesa.indexOf("formaEntraNaAutomatica(chavesDaConta("),
    true
  );

  console.log(falhas === 0 ? "\nTudo certo." : `\n${falhas} falha(s).`);
  if (falhas > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
