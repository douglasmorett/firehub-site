/**
 * "TAMBEM NESTE PEDIDO" na comanda de cada setor (lib/outros-setores-na-comanda.ts,
 * opÃ§Ã£o `avisarOutrosSetores` da impressora).
 *
 * JerrajÃª (Gil, 17/10/2026): pastel, burger e esfiha em impressoras separadas
 * por categoria. Cada comanda de setor termina com o que saiu nas outras, para
 * a equipe nÃ£o liberar um e esquecer o outro.
 *
 *   npx tsx scripts/teste-outros-setores-na-comanda.ts
 *
 * Confere:
 *   1. a regra pura: lista por impressora, quantidades somadas, sem a prÃ³pria;
 *      desligada = nada; uma impressora sÃ³ = nada; sÃ³ bebidas conta bebida;
 *   2. o encaixe nos blocos (logo depois dos itens) e o papel desenhado pelo
 *      cÃ³digo do Assistente (lib/gerado/comanda-do-assistente.ts) â€” inclusive
 *      que o modelo de fÃ¡brica desenha o mesmo papel do layout embutido;
 *   3. a ROTA de verdade (GET /api/store/print-queue) com banco falso;
 *   4. o trilho do navegador (lib/print.ts â†’ printOrder) com Assistente falso.
 */
export {};

process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";
process.env.NEXTAUTH_SECRET ||= "x";

let ok = 0, falhas = 0;
const confere = (oQue: string, cond: boolean, detalhe?: unknown) => {
  if (cond) ok++;
  else falhas++;
  console.log(`  ${cond ? "âœ“" : "âœ—"} ${oQue}${cond || detalhe === undefined ? "" : `\n      â†’ ${JSON.stringify(detalhe)}`}`);
};
const igual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

async function main() {
  const S = await import("../src/lib/outros-setores-na-comanda");
  const { destinosDoPedido } = await import("../src/lib/roteamento-de-impressao");
  const M = await import("../src/lib/comanda-modelo");
  const { comandaDoAssistente } = await import("../src/lib/gerado/comanda-do-assistente");
  const { lerPapel } = await import("../src/lib/papel-da-impressora");
  const textoDe = (l: any) => l.trechos.map((t: any) => t.texto).join("").trim();

  const PASTEL = { id: "p", name: "ELGIN PASTEL", label: "Pastel", copies: 1, categories: ["PastÃ©is"] };
  const BURGER = { id: "b", name: "ELGIN BURGER", label: "Burger", copies: 1, categories: ["Burgers"] };
  const ESFIHA = { id: "e", name: "ELGIN ESFIHA", label: "Esfiha", copies: 1, categories: ["Esfihas"] };
  const BAR = { id: "r", name: "ELGIN BAR", label: "Bar", copies: 1, categories: [], somenteBebidas: true };
  const liga = <P extends object>(p: P) => ({ ...p, avisarOutrosSetores: true });

  const PASTEL_CARNE = { name: "Pastel de Carne", category: "PastÃ©is", quantity: 2, qty: 2, price: 12 };
  const X_BURGER = { name: "X-Burger", category: "Burgers", quantity: 1, qty: 1, price: 25 };
  const ESF_CARNE = { name: "Esfiha de Carne", category: "Esfihas", quantity: 2, qty: 2, price: 5 };
  const ESF_QUEIJO = { name: "Esfiha de Queijo", category: "Esfihas", quantity: 1, qty: 1, price: 5 };
  const COCA = { name: "Coca-Cola lata", category: "Bebidas", quantity: 1, qty: 1, price: 6 };
  const pedido = (items: any[]) => ({ id: "jr-1", source: "SITE", deliveryType: "DELIVERY", items });

  const setoresDe = (impressoras: any[], p: any, nome: string) => {
    const destinos = destinosDoPedido(impressoras, p);
    const desta = impressoras.find((i) => i.name === nome);
    return S.outrosSetoresDoPedido(destinos, desta, p.items, { source: p.source });
  };

  // â”€â”€ 1. A REGRA PURA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  console.log("\n[1] A regra: o que saiu nas outras impressoras");
  const TRES = [liga(PASTEL), liga(BURGER), liga(ESFIHA)];
  const MISTO = pedido([PASTEL_CARNE, X_BURGER, ESF_CARNE, ESF_QUEIJO]);
  confere("Pastel: BURGER 1 e ESFIHA 3 (2 + 1 somados), sem o prÃ³prio pastel",
    igual(setoresDe(TRES, MISTO, "ELGIN PASTEL"), [{ nome: "BURGER", itens: 1 }, { nome: "ESFIHA", itens: 3 }]), setoresDe(TRES, MISTO, "ELGIN PASTEL"));
  confere("Esfiha: PASTEL 2 e BURGER 1",
    igual(setoresDe(TRES, MISTO, "ELGIN ESFIHA"), [{ nome: "PASTEL", itens: 2 }, { nome: "BURGER", itens: 1 }]), setoresDe(TRES, MISTO, "ELGIN ESFIHA"));
  confere("opÃ§Ã£o desligada nesta impressora: nada",
    setoresDe([PASTEL, liga(BURGER), liga(ESFIHA)], MISTO, "ELGIN PASTEL").length === 0);
  confere("pedido sÃ³ de pastel: nada (nenhum item em outra)",
    setoresDe(TRES, pedido([PASTEL_CARNE]), "ELGIN PASTEL").length === 0);
  confere("uma impressora sÃ³: nada", setoresDe([liga(PASTEL)], MISTO, "ELGIN PASTEL").length === 0);
  confere("uma impressora sem categoria (recebe tudo): nada", setoresDe([liga({ ...PASTEL, categories: [] })], MISTO, "ELGIN PASTEL").length === 0);
  {
    const comBar = [liga(PASTEL), liga(BURGER), BAR];
    const p = pedido([PASTEL_CARNE, X_BURGER, COCA]);
    const s = setoresDe(comBar, p, "ELGIN PASTEL");
    confere("bar \"sÃ³ bebidas\": conta sÃ³ a bebida (BAR: 1), nÃ£o o pedido inteiro", igual(s, [{ nome: "BURGER", itens: 1 }, { nome: "BAR", itens: 1 }]), s);
    confere("a prÃ³pria impressora de sÃ³ bebidas nunca leva o aviso", setoresDe([liga(PASTEL), liga(BAR)], p, "ELGIN BAR").length === 0);
  }
  {
    const inteira = [liga(PASTEL), { ...BURGER, comandaInteiraNoMisto: true }];
    const s = setoresDe(inteira, pedido([PASTEL_CARNE, X_BURGER]), "ELGIN PASTEL");
    confere("a outra com \"comanda inteira\" (recebe o pedido todo) nÃ£o vira setor", s.length === 0, s);
  }
  {
    const semLabel = [liga({ ...PASTEL, label: "" }), { ...BURGER, label: "" }];
    const s = setoresDe(semLabel, pedido([PASTEL_CARNE, X_BURGER]), "ELGIN PASTEL");
    confere("impressora sem nome dado pela loja: vale o nome do Windows", igual(s, [{ nome: "ELGIN BURGER", itens: 1 }]), s);
  }
  confere("conta da mesa e papel do caixa ficam de fora",
    S.papelSemAvisoDeSetores({ kind: "CONTA_DA_MESA" }) && S.papelSemAvisoDeSetores({ kind: "CAIXA_FECHAMENTO" }) && !S.papelSemAvisoDeSetores({}));

  // â”€â”€ 2. OS BLOCOS E O PAPEL â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  console.log("\n[2] Os blocos e o papel do Assistente");
  const setores = [{ nome: "BURGER", itens: 1 }, { nome: "ESFIHA", itens: 2 }];
  confere("sem setor: undefined (o destino manda o que mandava)", S.blocosComOutrosSetores(undefined, []) === undefined);
  const fabrica = S.blocosComOutrosSetores(undefined, setores)!;
  confere("sem modelo da loja: o de fÃ¡brica, com o aviso logo depois dos itens",
    igual(fabrica.map((b) => b.tipo), ["numeroPedido", "canal", "avisoEntrega", "separador", "loja", "dataHora", "cliente", "entrega", "itens", "espaco", "separador", "textoRico", "separador", "totais", "pagamento", "qrMotoboy", "qrCliente"]),
    fabrica.map((b) => b.tipo));
  const cozinha = M.modelosProntos().find((m) => m.id === M.ID_MODELO_COZINHA)!.cozinha;
  const naCozinha = S.blocosComOutrosSetores(M.blocosParaOAssistente(cozinha), setores, { semValores: true })!;
  confere("modelo da cozinha: o aviso no fim (os itens sÃ£o o Ãºltimo bloco)", naCozinha.slice(-4).map((b) => b.tipo).join(",") === "espaco,separador,textoRico,separador");

  const ORDEM: any = {
    id: "jr-1", dailyOrderNumber: "41", customerName: "Gil", customerPhone: "61999990000", customerAddress: "Rua A, 1 - Centro",
    deliveryType: "DELIVERY", paymentMethod: "PIX", source: "SITE", items: [{ name: "Pastel de Carne", qty: 2, price: 12 }],
    totalAmount: 45, deliveryFee: 5, restoDoPedido: { itens: 3, valor: 35 }, createdAt: "2026-10-17T20:00:00Z",
  };
  // O texto de cada linha do papel (lerPapel interpreta os comandos ESC/POS),
  // sem as linhas em branco: os blocos emitem o RESET de formato em outro ponto.
  const vis = (s: string) => JSON.stringify(lerPapel(s).filter((l: any) => textoDe(l)).map((l: any) =>
    l.trechos.filter((x: any) => x.texto.trim()).map((x: any) => [x.texto.trim(), x.negrito, x.largura, x.altura, !!x.invertido])));
  for (const semValores of [false, true]) {
    const embutido = comandaDoAssistente({ ...ORDEM, semValores }, "Jerraje", 48);
    const m = M.modeloPadrao();
    const deFabrica = comandaDoAssistente({ ...ORDEM, semValores, blocos: M.blocosParaOAssistente(semValores ? m.cozinha : m.completo) }, "Jerraje", 48);
    confere(`modelo de fÃ¡brica = layout embutido no texto do papel (${semValores ? "sem" : "com"} valores)`, vis(embutido) === vis(deFabrica));
  }
  const papel = lerPapel(comandaDoAssistente({ ...ORDEM, blocos: fabrica }, "Jerraje", 48, "safe"));
  const t = papel.map(textoDe);
  console.log("    papel do PASTEL (com valores):");
  for (const x of t.slice(t.findIndex((x) => /Pastel de Carne/.test(x)), t.findIndex((x) => /^Subtotal/.test(x)) + 1)) console.log(`      |${x}`);
  const iItem = t.findIndex((x) => /2x Pastel de Carne/.test(x));
  const iTitulo = t.indexOf("** TAMBEM NESTE PEDIDO **");
  const iSub = t.findIndex((x) => /^Subtotal/.test(x));
  confere("sai \"** TAMBEM NESTE PEDIDO **\" depois dos itens e antes do Subtotal", iItem >= 0 && iItem < iTitulo && iTitulo < iSub, { iItem, iTitulo, iSub });
  confere("â€¦na tarja preta, em negrito", papel[iTitulo]?.trechos.some((x: any) => x.invertido && x.negrito), papel[iTitulo]?.trechos);
  confere("â€¦com o recado \"(sai em outro setor - nao preparar aqui)\"", t[iTitulo + 1] === "(sai em outro setor - nao preparar aqui)", t[iTitulo + 1]);
  confere("â€¦e as linhas \"BURGER: 1 item\" / \"ESFIHA: 2 itens\"", t[iTitulo + 2] === "BURGER: 1 item" && t[iTitulo + 3] === "ESFIHA: 2 itens", t.slice(iTitulo, iTitulo + 5));
  confere("â€¦cercado por separadores", /^-{10,}$/.test(t[iTitulo - 1]) && /^-{10,}$/.test(t[iTitulo + 4]), [t[iTitulo - 1], t[iTitulo + 4]]);
  confere("a linha \"Em outra impressora\" dos totais continua", t.some((x) => /^Em outra impressora/.test(x)));
  {
    const p58 = lerPapel(comandaDoAssistente({ ...ORDEM, blocos: fabrica }, "Jerraje", 32, "safe")).map(textoDe);
    confere("em 58 mm (32 colunas) o recado quebra mas sai inteiro", p58.join(" ").includes("(sai em outro setor - nao") && p58.join(" ").includes("preparar aqui)"), p58.filter((x) => /setor|preparar/.test(x)));
  }
  {
    const pc = lerPapel(comandaDoAssistente({ ...ORDEM, semValores: true, blocos: S.blocosComOutrosSetores(undefined, setores, { semValores: true }) }, "Jerraje", 48, "safe")).map(textoDe);
    const i = pc.indexOf("** TAMBEM NESTE PEDIDO **");
    confere("cozinha sem valores: o aviso sai antes do \"-- COMANDA DA COZINHA --\"", i >= 0 && i < pc.indexOf("-- COMANDA DA COZINHA --") && !pc.some((x) => /R\$/.test(x)), pc);
  }

  // â”€â”€ 3. A FILA DA NUVEM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  console.log("\n[3] Fila da nuvem (GET /api/store/print-queue)");
  const LOJA = "loja_jerraje_teste";
  const printerConfig = { autoprint: true, printers: [liga(PASTEL), liga(BURGER), { ...ESFIHA }] };
  const dono = {
    id: LOJA, printerConfig, storeName: "JerrajÃª", name: "JerrajÃª", slug: "jerraje", storeLoyalty: null, city: "BrasÃ­lia",
    printQueuePolledAt: new Date(), printQueueEstado: { versao: "1.2.43" },
  };
  const agora = Date.now();
  const item = (id: string, n: number, nome: string, categoria: string, qtd: number, preco: number) => ({
    id: `${id}_i${n}`, orderId: id, menuProductId: null, menuProduct: { name: nome, category: categoria }, category: categoria,
    notes: null, quantity: qtd, price: preco, productName: nome, comboSelections: null,
  });
  const pedidos = [{
    id: "cm_gil", franchiseeId: LOJA, dailyOrderNumber: 41, source: "SITE", status: "ACEITO", createdAt: new Date(agora - 5_000),
    printedAt: null, parentOrderId: null, deliveryType: "DELIVERY", customerName: "Gil", customerPhone: "61999990000",
    customerAddress: "Rua A, 1 - Centro", paymentMethod: "Pix", totalAmount: 64, deliveryFee: 5, discountTotal: 0, notes: null,
    franchisee: { storeName: "JerrajÃª", name: "JerrajÃª" }, tableSession: null,
    items: [item("cm_gil", 1, "Pastel de Carne", "PastÃ©is", 2, 12), item("cm_gil", 2, "X-Burger", "Burgers", 1, 25), item("cm_gil", 3, "Esfiha de Carne", "Esfihas", 2, 5)],
  }];
  const vazio = (metodo: string) => async () =>
    metodo.startsWith("findMany") || metodo.startsWith("groupBy") ? [] : metodo.startsWith("count") ? 0 : metodo.endsWith("Many") ? { count: 0 } : null;
  const tabela = (feitos: Record<string, any> = {}) => new Proxy(feitos, { get: (t, k) => (k in t ? (t as any)[k] : vazio(String(k))) });
  (globalThis as any).prisma = new Proxy(
    {
      user: tabela({ findUnique: async ({ where }: any) => (where?.id === LOJA ? dono : null), update: async () => dono }),
      customerOrder: tabela({ findMany: async ({ where }: any) => (where?.franchiseeId === LOJA ? pedidos : []) }),
      printRequest: tabela({ findMany: async () => [] }),
    },
    { get: (t, k) => (k in t ? (t as any)[k] : String(k).startsWith("$") ? async () => [] : tabela()) },
  );
  const { GET } = await import("../src/app/api/store/print-queue/route");
  const { NextRequest } = await import("next/server");
  const res = await GET(new NextRequest(`https://firehubfood.com.br/api/store/print-queue?franchiseeId=${LOJA}&v=1.2.43&pendentes=0`, { headers: { "x-forwarded-for": "10.9.8.7" } }));
  const { jobs } = (await res.json()) as { jobs: any[] };
  const job = jobs.find((j) => j?.order?.id === "cm_gil");
  confere("a fila entrega o pedido do Gil para as trÃªs", job?.destinos?.length === 3, job?.destinos?.map((d: any) => d.printer));
  const papelDoDestino = (nome: string) => {
    const d = job.destinos.find((x: any) => x.printer === nome);
    return lerPapel(comandaDoAssistente({
      ...job.order,
      items: Array.isArray(d.items) ? d.items : job.order?.items,
      somenteBebidas: d.somenteBebidas === true,
      restoDoPedido: d.restoDoPedido || undefined,
      blocos: Array.isArray(d.blocos) && d.blocos.length ? d.blocos : job.order?.blocos,
      semValores: d.semValores === true || job.order?.semValores === true,
    }, "Jerraje", 48, "safe")).map(textoDe);
  };
  if (job) {
    const pastel = papelDoDestino("ELGIN PASTEL");
    const i = pastel.indexOf("** TAMBEM NESTE PEDIDO **");
    confere("PASTEL (ligada): BURGER: 1 item / ESFIHA: 2 itens", i >= 0 && pastel[i + 2] === "BURGER: 1 item" && pastel[i + 3] === "ESFIHA: 2 itens", pastel.slice(i, i + 5));
    const burger = papelDoDestino("ELGIN BURGER");
    const j = burger.indexOf("** TAMBEM NESTE PEDIDO **");
    confere("BURGER (ligada): PASTEL: 2 itens / ESFIHA: 2 itens", j >= 0 && burger[j + 2] === "PASTEL: 2 itens" && burger[j + 3] === "ESFIHA: 2 itens", burger.slice(j, j + 5));
    const esfiha = papelDoDestino("ELGIN ESFIHA");
    confere("ESFIHA (desligada): sem aviso, e sem `blocos` no destino (papel de sempre)",
      !esfiha.some((x) => /TAMBEM NESTE PEDIDO/.test(x)) && !job.destinos.find((x: any) => x.printer === "ELGIN ESFIHA").blocos);
    confere("o pedido inteiro (Assistente que nÃ£o lÃª destinos) nÃ£o leva o aviso", !job.order.blocos);
  }

  // â”€â”€ 4. O NAVEGADOR â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  console.log("\n[4] Painel (lib/print.ts â†’ printOrder)");
  const enviados: any[] = [];
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (u.endsWith("/status")) return new Response(JSON.stringify({ ok: true, versao: "1.2.43" }), { status: 200 });
    if (u.endsWith("/print")) { enviados.push(JSON.parse(init.body)); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    return new Response("[]", { status: 200 });
  };
  const { printOrder } = await import("../src/lib/print");
  const naTela = {
    id: "jr-2", dailyOrderNumber: "42", customerName: "Gil", deliveryType: "RETIRADA", source: "PRESENCIAL", paymentMethod: "PIX",
    items: [
      { name: "Pastel de Carne", qty: 2, price: 12, category: "PastÃ©is" },
      { name: "X-Burger", qty: 1, price: 25, category: "Burgers" },
      { name: "Esfiha de Carne", qty: 2, price: 5, category: "Esfihas" },
    ],
    totalAmount: 59, deliveryFee: 0, createdAt: new Date().toISOString(),
  };
  await (printOrder as any)(naTela, "Jerraje", { autoprint: true, printers: [liga(PASTEL), BURGER, ESFIHA] }, {}, false);
  const doPastel = enviados.find((b) => b.printer === "ELGIN PASTEL");
  const doBurger = enviados.find((b) => b.printer === "ELGIN BURGER");
  const linhasDoAviso = (b: any) => (b?.order?.blocos || []).filter((x: any) => x.tipo === "textoRico").flatMap((x: any) => x.linhas.map((l: any) => l.partes.map((p: any) => p.texto).join("")));
  confere("PASTEL (ligada) recebe o aviso com BURGER: 1 item / ESFIHA: 2 itens",
    igual(linhasDoAviso(doPastel), ["** TAMBEM NESTE PEDIDO **", "(sai em outro setor - nao preparar aqui)", "BURGER: 1 item", "ESFIHA: 2 itens"]), linhasDoAviso(doPastel));
  confere("BURGER (desligada): nenhum bloco, como sempre", !doBurger?.order?.blocos, doBurger?.order?.blocos);
  enviados.length = 0;
  await (printOrder as any)(naTela, "Jerraje", { autoprint: true, printers: [liga(PASTEL), BURGER, ESFIHA] }, {}, true, false, false, "ELGIN PASTEL");
  confere("reimpressÃ£o pelo modal (pedido inteiro): sem aviso", enviados.length === 1 && !enviados[0].order.blocos, enviados.map((b) => b.order.blocos));
}

main()
  .catch((e) => { falhas++; console.error("âœ— erro:", e); })
  .finally(() => {
    console.log(falhas ? `\nâœ— ${falhas} falha(s), ${ok} ok` : `\nâœ“ tudo certo (${ok})`);
    process.exit(falhas ? 1 : 0);
  });
