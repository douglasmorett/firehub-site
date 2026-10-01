/**
 * O que o PAINEL (lib/print.ts) entrega ao Assistente, campo a campo.
 *
 *   npx tsx scripts/teste-conta-pelo-painel.ts
 *
 * `printToDevice` monta o pedido do Assistente listando campo por campo: o que
 * não estiver na lista não chega ao papel. Dois casos de 01/10/2026:
 *
 *  - CONTA DA MESA (Delícias de Casa, mesa 2, 6 Coronas): o papel saiu
 *    "Subtotal R$ 83,40 / Total R$ 91,74", sem a linha da taxa de serviço.
 *    O cupom do servidor estava certo; o "Imprimir conta" do painel sai
 *    primeiro pela impressora local, e este trilho descartava `taxaSeparada`
 *    (e o desconto da conta). Sem a marca, o Assistente desenha o rodapé de
 *    pedido comum.
 *  - PREVISÃO DE ENTREGA no topo da comanda (lib/previsao-da-entrega.ts).
 */
export {}; // módulo, não script global: o `main` daqui não colide com o de outros scripts

let falhas = 0;
const confere = (oQue: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`${ok ? "✅" : "❌"} ${oQue}${ok ? "" : ` — obtido ${JSON.stringify(obtido)}, esperava ${JSON.stringify(esperado)}`}`);
};

// O cupom que o servidor montou para a mesa 2 (PrintRequest de 01/10/2026).
const CONTA_MESA_2 = {
  id: "conta_cmupvd6j902akpd01dahhj3qf_1790879485329",
  kind: "CONTA_DA_MESA",
  items: [{ qty: 6, name: "Corona Long Neck", price: 13.9 }],
  notes: "",
  rateio: [],
  source: "MESA",
  consumo: 83.4,
  gorjeta: 0,
  createdAt: "2026-10-01T18:31:25.329Z",
  isPrepaid: false,
  deliveryFee: 0,
  taxaServico: { valor: 8.34, percentual: 10 },
  totalAmount: 91.74,
  customerName: "Mesa 2 (douglas teste)",
  deliveryType: "MESA",
  taxaSeparada: true,
  paymentMethod: "Pendente - pagar no caixa ou na mesa",
  tableSessionId: "cmupvd6j902akpd01dahhj3qf",
  customerAddress: "Mesa 2",
  dailyOrderNumber: "CONTA MESA 2",
};

async function main() {
  const enviados: any[] = [];
  (globalThis as any).fetch = async (url: string, init?: any) => {
    const u = String(url);
    if (u.endsWith("/status")) return new Response(JSON.stringify({ ok: true, versao: "1.2.29" }), { status: 200 });
    if (u.endsWith("/print")) {
      enviados.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    return new Response("[]", { status: 200 });
  };
  const { printOrder } = await import("../src/lib/print");
  const config: any = { autoprint: true, printers: [{ name: "CAIXA", categories: [] }] };

  console.log("\n— Conta da mesa pelo painel —");
  await printOrder(CONTA_MESA_2 as any, "Delicias de Casa", config, {}, false);
  const conta = enviados[0]?.order || {};
  confere("chega como conta da mesa", conta.kind, "CONTA_DA_MESA");
  confere("chega com a marca de taxa fora dos itens", conta.taxaSeparada, true);
  confere("chega com a taxa e o percentual", conta.taxaServico, { valor: 8.34, percentual: 10 });
  confere("chega com o consumo", conta.consumo, 83.4);

  enviados.length = 0;
  const desconto = { valor: 10, motivo: "Cortesia" };
  await printOrder({ ...CONTA_MESA_2, descontoDaConta: desconto } as any, "Delicias de Casa", config, {}, false);
  confere("chega com o desconto da conta", enviados[0]?.order?.descontoDaConta, desconto);

  console.log("\n— Previsão de entrega pelo painel —");
  enviados.length = 0;
  const previsao = { em: "2026-10-01T23:45:00.000Z", tipo: "ENTREGA" };
  await printOrder({
    id: "cmprevisaopainel00000001",
    customerName: "Larissa",
    deliveryType: "DELIVERY",
    source: "SITE",
    paymentMethod: "Dinheiro",
    items: [{ name: "Pizza", qty: 1, price: 50 }],
    totalAmount: 57,
    deliveryFee: 7,
    createdAt: "2026-10-01T23:05:00.000Z",
    previsaoEntrega: previsao,
  } as any, "Hakim", config, {}, false);
  confere("a previsão calculada no painel chega ao Assistente", enviados[0]?.order?.previsaoEntrega, previsao);
}

main()
  .catch((e) => { falhas++; console.error("❌", e); })
  .finally(() => {
    console.log(falhas ? `\n❌ ${falhas} falha(s)` : "\n✅ tudo certo");
    process.exit(falhas ? 1 : 0);
  });
