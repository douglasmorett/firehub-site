/**
 * O BAIRRO na comanda da cozinha e o aviso "Taxa pelo bairro" fora da
 * observação do cliente (lib/bairro-na-comanda.ts).
 *
 * Divinos Burguer, 16/10/2026: o Luiz divide os pedidos entre os motoboys
 * olhando a comanda da COZINHA ("Cozinha sem valores", sem endereço) e pediu o
 * bairro nela. E o aviso do sistema "[📍 Taxa pelo bairro: …]" saía no papel
 * como "!! OBSERVACAO DO CLIENTE !!".
 *
 *   npx tsx scripts/teste-bairro-na-comanda.ts
 *
 * Confere:
 *   1. o bairro de cada canal (site, iFood, 99Food, robô), e nada em
 *      retirada, mesa ou endereço sem bairro legível;
 *   2. a observação do papel sem o aviso do sistema (o resto intacto);
 *   3. a ROTA de verdade (GET /api/store/print-queue) com a configuração da
 *      Divinos depois do script (scratch/divinos-linha-do-bairro.ts), contra
 *      um banco falso em memória — pedido novo e reimpressão;
 *   4. o trilho do NAVEGADOR (lib/print.ts → printOrder), com o Assistente
 *      local simulado;
 *   5. o papel desenhado pelo código do Assistente (lib/gerado/comanda-do-
 *      assistente.ts = server.js 1.2.44; o desenho do texto rico e da
 *      observação é o mesmo das 1.2.42/1.2.43 que as lojas têm — entre elas e
 *      a 1.2.44 só mudou a linha "Qtd Pedidos"). Nada vai a banco.
 */
export {};

process.env.DATABASE_URL ||= "postgresql://banco-falso/teste";
process.env.NEXTAUTH_SECRET ||= "segredo-so-do-teste-do-bairro";

let ok = 0, falhas = 0;
const confere = (oQue: string, cond: boolean, detalhe?: unknown) => {
  if (cond) ok++;
  else falhas++;
  console.log(`  ${cond ? "✓" : "✗"} ${oQue}${cond || detalhe === undefined ? "" : `\n      → ${JSON.stringify(detalhe)}`}`);
};

const ETIQUETA = "[📍 Taxa pelo bairro: o mapa achou o bairro, não a rua do cliente — confira o endereço antes de sair]";

/** lib/ifood-eventos.ts (pedido novo do iFood) — cópia fiel, como em teste-endereco-impresso.ts. */
function textoDoIfood(addr: any): string {
  const formatted = addr.formattedAddress || "";
  const neighborhood = addr.neighborhood || "";
  const city = addr.city || "";
  const complement = addr.complement || addr.streetNameComplement || "";
  const reference = addr.reference || addr.streetNameReference || "";
  const parts: string[] = [];
  if (formatted) parts.push(formatted);
  else if (addr.streetName) parts.push(`${addr.streetName}${addr.streetNumber ? `, ${addr.streetNumber}` : ""}`);
  if (complement && !parts.some((p) => p.toLowerCase().includes(complement.toLowerCase()))) parts.push(`Comp: ${complement}`);
  if (reference && !parts.some((p) => p.toLowerCase().includes(reference.toLowerCase()))) parts.push(`Ref: ${reference}`);
  if (neighborhood && (!parts[0] || !parts[0].toLowerCase().includes(neighborhood.toLowerCase()))) parts.push(neighborhood);
  if (city) parts.push(city);
  return parts.join(" - ");
}

// ── A configuração da Divinos depois do script ──────────────────────────────
const LOJA = "loja_divinos_teste";
const ENDERECO_DA_RAISSA = "Rua Projetada ac e Francisco viana, 132 - Porto do Carro (Casa)";

async function main() {
  const B = await import("../src/lib/bairro-na-comanda");
  const { camposDoEnderecoParaImpressao } = await import("../src/lib/endereco-impresso");
  const M = await import("../src/lib/comanda-modelo");
  const { notasDaEntrega } = await import("../src/lib/entrega-do-pedido");
  const { comandaDoAssistente } = await import("../src/lib/gerado/comanda-do-assistente");
  const { lerPapel } = await import("../src/lib/papel-da-impressora");

  const entrega = (source: string, customerAddress: string, extra: Record<string, unknown> = {}) =>
    ({ deliveryType: "DELIVERY", source, customerAddress, ...extra });
  /** O que o {bairro} imprime para este pedido, pela régua do papel. */
  const bairroNaComanda = (pedido: any, cidade: string | null) =>
    B.textoDoBairroNaComanda({ ...pedido, ...camposDoEnderecoParaImpressao(pedido, cidade) });

  // ── 1. O BAIRRO DE CADA CANAL ─────────────────────────────────────────────
  console.log("\n[1] O bairro de cada canal");
  confere("site: \"…, 132 - Porto do Carro (Casa)\" → PORTO DO CARRO",
    bairroNaComanda(entrega("SITE", ENDERECO_DA_RAISSA), "Cabo Frio") === "PORTO DO CARRO",
    bairroNaComanda(entrega("SITE", ENDERECO_DA_RAISSA), "Cabo Frio"));
  const ifood = textoDoIfood({ streetName: "Rua Itajuru", streetNumber: "107", complement: "casa 1", neighborhood: "Jardim Excelsior", city: "Cabo Frio" });
  confere(`iFood: o bairro que o parceiro mandou ("${ifood}") → JARDIM EXCELSIOR`,
    bairroNaComanda(entrega("IFOOD", ifood, { ifoodOrderId: "x" }), "Cabo Frio") === "JARDIM EXCELSIOR",
    bairroNaComanda(entrega("IFOOD", ifood, { ifoodOrderId: "x" }), "Cabo Frio"));
  const ifoodOutraCidade = textoDoIfood({ streetName: "Rua A", streetNumber: "10", neighborhood: "Tamoios", city: "Cabo Frio" });
  confere("iFood de cliente em outra cidade (loja em Unamar): a cidade do fim não vira bairro",
    bairroNaComanda(entrega("IFOOD", ifoodOutraCidade, { ifoodOrderId: "x" }), "Unamar") === "TAMOIOS");
  const ifoodSemBairro = "Sh Mansões Sobradinho Q 52 conjunto B, 20 - Comp: Condominio verde vale - Brasília";
  confere("iFood que apagou o bairro (já estava no nome da rua): sem linha, não chuta a rua",
    bairroNaComanda(entrega("IFOOD", ifoodSemBairro, { ifoodOrderId: "x" }), "Brasília") === "");
  confere("99Food: \"Rua Mayer, 727 - Liberdade, Rio das Ostras - RJ, portão branco\" → LIBERDADE",
    bairroNaComanda(entrega("99FOOD", "Rua Mayer, 727 - Liberdade, Rio das Ostras - RJ, portão branco"), "Rio das Ostras") === "LIBERDADE");
  confere("robô: \"Rua Paranaíba, 470, Operário, Rio das Ostras\" → OPERÁRIO",
    bairroNaComanda(entrega("WHATSAPP_IA", "Rua Paranaíba, 470, Operário, Rio das Ostras"), "Rio das Ostras") === "OPERÁRIO");
  confere("robô sem a cidade da loja (ambíguo): sem linha — Rio das Ostras não vira bairro",
    bairroNaComanda(entrega("WHATSAPP_IA", "Rua Paranaíba, 470, Operário, Rio das Ostras"), null) === "");
  confere("retirada: sem linha",
    bairroNaComanda({ deliveryType: "RETIRADA", source: "SITE", customerAddress: ENDERECO_DA_RAISSA }, "Cabo Frio") === "");
  confere("mesa: sem linha",
    bairroNaComanda({ deliveryType: "MESA", source: "PRESENCIAL", customerAddress: "Mesa 4", tableSessionId: "c1" }, "Cabo Frio") === "");
  confere("balcão com texto solto (\"quadra 05\"): sem linha",
    bairroNaComanda(entrega("PRESENCIAL", "quadra 05"), "Brasília") === "");
  {
    const comAviso = entrega("SITE", ENDERECO_DA_RAISSA, { notes: ETIQUETA });
    const valores = B.valoresDosCamposDoSite({ ...comAviso, ...camposDoEnderecoParaImpressao(comAviso as any, "Cabo Frio") });
    confere("taxa pelo bairro: {bairro} = \"PORTO DO CARRO\" e {avisoDoBairro} = \"(confira o endereço)\"",
      valores.bairro === "PORTO DO CARRO" && valores.avisoDoBairro === "(confira o endereço)", valores);
    const semAvisoNaNota = B.valoresDosCamposDoSite({ ...entrega("SITE", ENDERECO_DA_RAISSA), bairroDoPedido: "Porto do Carro" });
    confere("sem a taxa pelo bairro, {avisoDoBairro} fica vazio", semAvisoNaNota.avisoDoBairro === "", semAvisoNaNota);
    const semBairro = B.valoresDosCamposDoSite({ ...entrega("PRESENCIAL", "quadra 05"), notes: ETIQUETA });
    confere("aviso sem bairro não sai sozinho (ele fala do bairro)", semBairro.bairro === "" && semBairro.avisoDoBairro === "", semBairro);
  }
  {
    const campos = camposDoEnderecoParaImpressao(entrega("SITE", ENDERECO_DA_RAISSA, { notes: ETIQUETA }) as any, "Cabo Frio");
    confere("o endereço do papel leva o aviso ao lado do bairro (todas as lojas, com ou sem a linha BAIRRO)",
      (campos.enderecoImpresso || []).some((l) => l.rotulo === "Bairro" && l.valor === "Porto do Carro (confira o endereço)"), campos.enderecoImpresso);
    confere("…e o Assistente antigo, na linha única", /Bairro: Porto do Carro \(confira o endereço\)/.test(campos.customerAddress || ""), campos.customerAddress);
    const deNovo = camposDoEnderecoParaImpressao({ ...entrega("SITE", ENDERECO_DA_RAISSA, { notes: ETIQUETA }), ...campos } as any, "Cabo Frio");
    confere("pedido já separado (reimpressão) não ganha o aviso duas vezes", JSON.stringify(deNovo) === "{}", deNovo);
    const semSeparar = camposDoEnderecoParaImpressao(entrega("PRESENCIAL", "casa amarela em frente à padaria", { notes: ETIQUETA }) as any, "Cabo Frio");
    confere("endereço que não se separa: o aviso vai no fim do texto",
      semSeparar.customerAddress === "casa amarela em frente à padaria (confira o endereço)" && !semSeparar.bairroDoPedido, semSeparar);
    const semAviso = camposDoEnderecoParaImpressao(entrega("SITE", ENDERECO_DA_RAISSA) as any, "Cabo Frio");
    confere("sem o aviso o endereço do papel é o de sempre",
      semAviso.customerAddress === "Rua Projetada ac e Francisco viana, 132 | Comp: Casa | Bairro: Porto do Carro", semAviso.customerAddress);
  }

  // ── 2. A OBSERVAÇÃO DO PAPEL ──────────────────────────────────────────────
  console.log("\n[2] A observação do papel sem o aviso do sistema");
  const notaDaTaxa = notasDaEntrega({ peloBairro: true, resultado: "ATENDE", motivosDaConfirmacao: [] } as any, { canal: "site" });
  confere("a etiqueta que o pedido grava é a que a lib tira do papel", notaDaTaxa[0] === B.ETIQUETA_DA_TAXA_PELO_BAIRRO && B.ETIQUETA_DA_TAXA_PELO_BAIRRO === ETIQUETA, notaDaTaxa);
  confere("só o aviso → observação vazia", B.notasParaOPapel(ETIQUETA) === "");
  confere("recado do cliente + aviso (como o site grava) → só o recado", B.notasParaOPapel(`capricha no molho ${ETIQUETA}`) === "capricha no molho");
  confere("agendamento, cupom e recado ficam; o aviso sai",
    B.notasParaOPapel(`[📅 AGENDADO para sex 17/10 às 19:00] [Cupom: VOLTA10] sem cebola ${ETIQUETA}`) === "[📅 AGENDADO para sex 17/10 às 19:00] [Cupom: VOLTA10] sem cebola");
  const doRobo = "🤖 Pedido finalizado via IA pelo WhatsApp · Entrega: 0.84 km (ponto aproximado) de 6 km, taxa R$ 5,00 · 📍 taxa pelo bairro (o mapa não achou a rua) — confira o endereço · Obs: sem cebola";
  confere("robô: o pedaço \"📍 taxa pelo bairro (…) — confira o endereço\" sai, o resto fica",
    B.notasParaOPapel(doRobo) === "🤖 Pedido finalizado via IA pelo WhatsApp · Entrega: 0.84 km (ponto aproximado) de 6 km, taxa R$ 5,00 · Obs: sem cebola", B.notasParaOPapel(doRobo));
  confere("robô: o aviso também vira \"(confira o endereço)\" no bairro", B.temAvisoDaTaxaPeloBairro(doRobo));
  confere("linha de outro assunto fica idêntica", B.notasParaOPapel(`📝 sem cebola\n${ETIQUETA}`) === "📝 sem cebola");
  const semAviso = "📝 Sem cebola, por favor";
  confere("sem o aviso, a MESMA observação volta", B.notasParaOPapel(semAviso) === semAviso && B.notasParaOPapel(null) === null && B.notasParaOPapel(undefined) === undefined);
  confere("\"endereço aproximado\" não é o aviso do bairro (continua no papel)",
    !B.temAvisoDaTaxaPeloBairro("[📍 Endereço localizado só de forma aproximada (centro do bairro) — confira com o cliente]"));

  // ── OS BLOCOS COM O CAMPO DO SITE ─────────────────────────────────────────
  console.log("\n[2b] O campo trocado pelo valor nos blocos");
  const linha = B.blocoDaLinhaDoBairro();
  const resolvidos = B.blocosComCamposDoSite([linha], { bairro: "PORTO DO CARRO", avisoDoBairro: "(confira o endereço)" })!;
  confere("o pedaço do campo vira texto pronto, com negrito e 2x intactos; o aviso na linha de baixo, em 1x",
    JSON.stringify(resolvidos[0].linhas) === JSON.stringify([
      { partes: [{ texto: "BAIRRO: PORTO DO CARRO" }], negrito: true, tamanho: 2 },
      { partes: [{ texto: "(confira o endereço)" }], negrito: true },
    ]), resolvidos[0].linhas);
  const vazios = B.blocosComCamposDoSite([linha], { bairro: "", avisoDoBairro: "" })!;
  confere("sem bairro, o pedaço some com o rótulo (linhas sem nada para imprimir)", (vazios[0].linhas || []).every((l) => l.partes.length === 0), vazios[0].linhas);
  const livre = B.blocosComCamposDoSite([{ tipo: "textoLivre", ligado: true, texto: "{cliente} - {bairro}" }], { bairro: "CENTRO" })!;
  confere("texto livre: só o {bairro} é trocado, {cliente} fica para o Assistente", livre[0].texto === "{cliente} - CENTRO", livre[0].texto);
  const semCampo = [{ tipo: "itens" as const, ligado: true }];
  confere("sem campo do site, a MESMA lista volta", B.blocosComCamposDoSite(semCampo, { bairro: "X" }) === semCampo);
  confere("os dois campos estão na lista da tela (texto livre e texto com variáveis)",
    ["bairro", "avisoDoBairro"].every((k) => M.CAMPOS_DISPONIVEIS.some((c) => c.chave === k)));
  {
    const via = M.modelosProntos().find((m) => m.id === M.ID_MODELO_COZINHA)!.cozinha;
    const comLinha = B.viaComLinhaDoBairro(via);
    const tipos = comLinha.map((b) => b.tipo);
    confere("a linha entra logo abaixo do cliente, antes dos itens",
      tipos.join(",") === "numeroPedido,canal,avisoEntrega,separador,dataHora,cliente,textoRico,itens", tipos);
    confere("rodar de novo não duplica", B.viaComLinhaDoBairro(comLinha) === comLinha);
    const prev = M.montarComanda(comLinha, M.pedidoDeExemplo("Divinos"), { colunas: 48, comValores: false });
    confere("a prévia da tela (montarComanda) mostra \"BAIRRO: COSTAZUL\"", prev.some((l) => l.texto === "BAIRRO: COSTAZUL" && l.tamanho === 2 && l.negrito === true), prev.map((l) => l.texto));
    const { papelDaPrevia } = await import("../src/lib/previa-da-comanda");
    const papelTela = papelDaPrevia({ lista: comLinha, via: "cozinha", exemplo: "entrega", nomeDaLoja: "Divinos", colunas: 48 })
      .map((l) => l.trechos.map((t) => t.texto).join("").trim());
    confere("a prévia de \"Personalizar impressão\" (código do Assistente) também", papelTela.includes("BAIRRO: COSTAZUL"), papelTela);
  }

  // ── 3. A FILA DA NUVEM, COM A DIVINOS ─────────────────────────────────────
  console.log("\n[3] Fila da nuvem (GET /api/store/print-queue) com a configuração da Divinos");
  const prontoCozinha = M.modelosProntos().find((m) => m.id === M.ID_MODELO_COZINHA)!;
  const modeloDaDivinos = {
    ...prontoCozinha,
    cozinha: B.viaComLinhaDoBairro(prontoCozinha.cozinha),
    completo: B.viaComLinhaDoBairro(prontoCozinha.completo),
  };
  const printerConfig = {
    autoprint: true,
    printers: [{ id: "1", name: "ELGIN i9", label: "Cozinha", copies: 1, categories: [], modulos: ["salao", "delivery"], paperWidth: "80mm", modeloId: M.ID_MODELO_COZINHA }],
    comandaModelo: { ...M.modeloPadrao(), modelos: [modeloDaDivinos] },
  };
  const dono = {
    id: LOJA, printerConfig, storeName: "Divinos Burguer", name: "Divinos", slug: "divinos", storeLoyalty: null, city: "Cabo Frio",
    printQueuePolledAt: new Date(), printQueueEstado: { versao: "1.2.43" },
  };
  const agora = Date.now();
  const pedido = (id: string, n: number, extra: Record<string, unknown>) => ({
    id, franchiseeId: LOJA, dailyOrderNumber: n, source: "SITE", status: "ACEITO", createdAt: new Date(agora - 5_000),
    printedAt: null, parentOrderId: null, deliveryType: "DELIVERY", customerName: "Cliente", customerPhone: "22999990000",
    customerAddress: ENDERECO_DA_RAISSA, paymentMethod: "Pix", totalAmount: 40, deliveryFee: 5, discountTotal: 0, notes: null,
    franchisee: { storeName: "Divinos Burguer", name: "Divinos" }, tableSession: null,
    items: [{ id: `${id}_i1`, orderId: id, menuProductId: null, menuProduct: null, notes: null, quantity: 1, price: 35, productName: "X-Divino", comboSelections: null }],
    ...extra,
  });
  const pedidos = [
    pedido("cm_raissa", 21, { customerName: "Raissa", notes: ETIQUETA }),
    pedido("cm_molho", 22, { customerName: "Bruna", notes: `capricha no molho ${ETIQUETA}` }),
    pedido("cm_ifood", 23, {
      customerName: "Carlos", source: "IFOOD", ifoodOrderId: "if-1", ifoodReference: "4035", notes: "📝 sem cebola",
      customerAddress: ifood,
    }),
    pedido("cm_retirada", 24, { customerName: "Dani", deliveryType: "RETIRADA", customerAddress: null, notes: "sem cebola" }),
  ];
  // A reimpressão pelo painel: o pedido como a tela de pedidos manda (formattedOrder).
  const reimpressao = {
    id: "pr_1", kind: "REIMPRESSAO", createdAt: new Date(agora - 2_000),
    payload: {
      id: "cm_raissa_reimp", dailyOrderNumber: 21, customerName: "Raissa", customerPhone: "22999990000",
      customerAddress: ENDERECO_DA_RAISSA, deliveryType: "DELIVERY", source: "SITE", paymentMethod: "Pix",
      items: [{ name: "X-Divino", qty: 1, price: 35 }], totalAmount: 40, deliveryFee: 5, notes: ETIQUETA,
      createdAt: new Date(agora - 60_000).toISOString(), franchiseeId: LOJA,
    },
  };

  const vazio = (metodo: string) => async () =>
    metodo.startsWith("findMany") || metodo.startsWith("groupBy") ? [] : metodo.startsWith("count") ? 0 : metodo.endsWith("Many") ? { count: 0 } : null;
  const tabela = (feitos: Record<string, any> = {}) =>
    new Proxy(feitos, { get: (t, k) => (k in t ? (t as any)[k] : vazio(String(k))) });
  (globalThis as any).prisma = new Proxy(
    {
      user: tabela({
        findUnique: async ({ where }: any) => (where?.id === LOJA ? dono : null),
        update: async () => dono,
      }),
      customerOrder: tabela({ findMany: async ({ where }: any) => (where?.franchiseeId === LOJA ? pedidos : []) }),
      printRequest: tabela({ findMany: async ({ where }: any) => (where?.franchiseeId === LOJA ? [reimpressao] : []) }),
    },
    { get: (t, k) => (k in t ? (t as any)[k] : String(k).startsWith("$") ? async () => [] : tabela()) },
  );

  const { GET } = await import("../src/app/api/store/print-queue/route");
  const { NextRequest } = await import("next/server");
  const res = await GET(new NextRequest(`https://firehubfood.com.br/api/store/print-queue?franchiseeId=${LOJA}&v=1.2.43&pendentes=0`, { headers: { "x-forwarded-for": "10.9.8.7" } }));
  const { jobs } = (await res.json()) as { jobs: any[] };

  /** O papel do destino como o Assistente monta (server.js, laço dos `destinos`). */
  const papelDoDestino = (job: any, destino: any) => lerPapel(comandaDoAssistente({
    ...job.order,
    items: Array.isArray(destino.items) ? destino.items : job.order?.items,
    somenteBebidas: destino.somenteBebidas === true,
    blocos: Array.isArray(destino.blocos) && destino.blocos.length ? destino.blocos : job.order?.blocos,
    avisos: destino.avisos && typeof destino.avisos === "object" ? destino.avisos : job.order?.avisos,
    semValores: destino.semValores === true || job.order?.semValores === true,
  }, "Divinos Burguer", 48, "safe"));
  const textoDe = (l: any) => l.trechos.map((t: any) => t.texto).join("").trim();
  const papelDoPedido = (id: string) => {
    const job = jobs.find((j) => String(j?.order?.id || "") === id);
    const destino = job?.destinos?.find((d: any) => d.printer === "ELGIN i9");
    return { job, destino, papel: job && destino ? papelDoDestino(job, destino) : [] };
  };
  const mostrar = (papel: any[]) => {
    const t = papel.map(textoDe);
    const de = t.findIndex((x) => x === "CLIENTE");
    const ate = t.findIndex((x, i) => i > de && x === "PEDIDO");
    for (const x of t.slice(Math.max(0, de), ate > de ? ate + 1 : de + 8)) if (x) console.log(`      |${x}`);
  };

  {
    const { job, destino, papel } = papelDoPedido("cm_raissa");
    confere("a fila entrega o pedido da Raissa para a ELGIN i9", !!job && !!destino);
    console.log("    papel da cozinha (Raissa, taxa pelo bairro):");
    mostrar(papel);
    const t = papel.map(textoDe);
    const iBairro = t.indexOf("BAIRRO: PORTO DO CARRO");
    const linhaDoBairro = papel[iBairro];
    confere("sai \"BAIRRO: PORTO DO CARRO\"", iBairro >= 0, t);
    confere("…em destaque: negrito e 2x", !!linhaDoBairro && linhaDoBairro.trechos.some((x: any) => x.negrito && x.largura === 2 && x.altura === 2 && /PORTO DO CARRO/.test(x.texto)), linhaDoBairro?.trechos);
    const linhaDoAviso = papel[iBairro + 1];
    confere("…com \"(confira o endereco)\" logo abaixo, pequeno (1x) e em negrito",
      t[iBairro + 1] === "(confira o endereco)" && !!linhaDoAviso && linhaDoAviso.trechos.some((x: any) => x.negrito && x.largura === 1 && x.altura === 1 && /confira/.test(x.texto)),
      { texto: t[iBairro + 1], trechos: linhaDoAviso?.trechos });
    const iNome = t.findIndex((x) => x.startsWith("Nome: Raissa"));
    const iPedido = t.indexOf("PEDIDO");
    confere("…logo abaixo do cliente e antes de PEDIDO", iNome >= 0 && iNome < iBairro && iBairro < iPedido, { iNome, iBairro, iPedido });
    confere("NÃO sai \"OBSERVACAO DO CLIENTE\"", !t.some((x) => /OBSERVACAO/.test(x)), t);
    confere("o texto do aviso não aparece em lugar nenhum do papel", !t.some((x) => /Taxa pelo bairro/i.test(x)));
    confere("no banco o pedido continua com a etiqueta (painel e app do motoboy)", pedidos[0].notes === ETIQUETA);
    confere("a cozinha segue sem valores", !t.some((x) => /R\$/.test(x)), t.filter((x) => /R\$/.test(x)));
    const cru = lerPapel(comandaDoAssistente({ ...pedidos[0], blocos: B.viaComLinhaDoBairro(prontoCozinha.cozinha), semValores: true }, "Divinos Burguer", 48, "safe")).map(textoDe);
    confere("prova do contrário: SEM o site resolver, o Assistente instalado não imprime a linha (campo desconhecido some)", !cru.some((x) => /^BAIRRO:/.test(x)), cru.filter((x) => /BAIRRO/.test(x)));
  }
  {
    const { papel } = papelDoPedido("cm_molho");
    const t = papel.map(textoDe);
    console.log("    papel da cozinha (Bruna, recado + taxa pelo bairro):");
    mostrar(papel);
    const iFaixa = t.findIndex((x) => /OBSERVACAO DO CLIENTE/.test(x));
    confere("o recado do cliente continua com a faixa", iFaixa >= 0 && t.slice(iFaixa + 1, iFaixa + 3).some((x) => /capricha no molho/.test(x)), t.slice(iFaixa, iFaixa + 3));
    confere("…e sem o aviso do sistema junto", !t.some((x) => /Taxa pelo bairro|mapa achou/i.test(x)));
    confere("BAIRRO: PORTO DO CARRO", t.includes("BAIRRO: PORTO DO CARRO"));
  }
  {
    const { papel } = papelDoPedido("cm_ifood");
    const t = papel.map(textoDe);
    console.log("    papel da cozinha (iFood):");
    mostrar(papel);
    confere("iFood: \"BAIRRO: JARDIM EXCELSIOR\" (o bairro que o iFood mandou), sem o aviso", t.includes("BAIRRO: JARDIM EXCELSIOR") && !t.includes("(confira o endereco)"), t.filter((x) => /BAIRRO|confira/.test(x)));
    confere("iFood: o recado 📝 continua na faixa", t.some((x) => /OBSERVACAO DO CLIENTE/.test(x)) && t.some((x) => /sem cebola/.test(x)));
  }
  {
    const { job, papel } = papelDoPedido("cm_retirada");
    const t = papel.map(textoDe);
    confere("retirada: sai na cozinha, SEM linha de bairro", !!job && !t.some((x) => /^BAIRRO/.test(x)), t.filter((x) => /BAIRRO/.test(x)));
    confere("retirada: o recado continua", t.some((x) => /sem cebola/.test(x)));
  }
  {
    const job = jobs.find((j) => String(j?.id || "") === "job_pr_1");
    const destino = job?.destinos?.find((d: any) => d.printer === "ELGIN i9");
    const t = job && destino ? papelDoDestino(job, destino).map(textoDe) : [];
    confere("reimpressão pelo painel: a mesma linha \"BAIRRO: PORTO DO CARRO\" + aviso, sem a observação", t.includes("BAIRRO: PORTO DO CARRO") && t.includes("(confira o endereco)") && !t.some((x) => /OBSERVACAO/.test(x)), t);
  }

  // ── 4. O NAVEGADOR (lib/print.ts) ─────────────────────────────────────────
  console.log("\n[4] Trilho do navegador (printOrder → Assistente local simulado)");
  const enviados: any[] = [];
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    const resposta = (corpo: unknown) => new Response(JSON.stringify(corpo), { status: 200, headers: { "Content-Type": "application/json" } });
    if (u.endsWith("/status")) return resposta({ ok: true });
    if (u.endsWith("/print")) { enviados.push(JSON.parse(String(init?.body || "{}"))); return resposta({ ok: true }); }
    return resposta({});
  };
  const { printOrder } = await import("../src/lib/print");
  const doPainel = {
    id: "cm_raissa", dailyOrderNumber: 21, customerName: "Raissa", customerPhone: "22999990000", qtdPedidosDoCliente: null,
    customerAddress: ENDERECO_DA_RAISSA, deliveryType: "DELIVERY" as const, source: "SITE", paymentMethod: "Pix",
    items: [{ name: "X-Divino", qty: 1, price: 35 }], totalAmount: 40, deliveryFee: 5, notes: ETIQUETA,
    createdAt: new Date(agora - 60_000).toISOString(),
  };
  const r = await printOrder(doPainel as any, "Divinos Burguer", { ...printerConfig, cidadeDaLoja: "Cabo Frio" } as any, {}, false);
  const corpo = enviados.find((e) => e.printer === "ELGIN i9");
  confere("o navegador imprimiu na ELGIN i9", r.success && !!corpo, r);
  const tNav = corpo ? lerPapel(comandaDoAssistente(corpo.order, corpo.storeName, 48, "safe")).map(textoDe) : [];
  confere("navegador: \"BAIRRO: PORTO DO CARRO\" + \"(confira o endereco)\", sem a observação", tNav.includes("BAIRRO: PORTO DO CARRO") && tNav.includes("(confira o endereco)") && !tNav.some((x) => /OBSERVACAO/.test(x)), tNav);
  confere("navegador: o bloco já chega resolvido (nenhum campo \"bairro\" vai ao Assistente)",
    !JSON.stringify(corpo?.order?.blocos || []).includes("\"campo\":\"bairro\""), corpo?.order?.blocos);

  console.log(`\n${ok} ok, ${falhas} falha(s)`);
  process.exit(falhas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
