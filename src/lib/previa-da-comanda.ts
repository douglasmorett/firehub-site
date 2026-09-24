/**
 * O papel da prévia de "Personalizar impressão", montado pelo MESMO código que
 * imprime (lib/gerado/comanda-do-assistente.ts, cópia do Assistente) e lido
 * byte a byte (lib/papel-da-impressora.ts).
 *
 * Aqui só mora o pedido de exemplo e o envelope que o Assistente recebe — o
 * mesmo que lib/print.ts e a fila da nuvem montam para o pedido de verdade:
 * `blocos` pela mesma `blocosParaOAssistente`, `avisos` só com o que a loja
 * desligou, `semValores` na via da cozinha.
 */
import { comandaDoAssistente } from "@/lib/gerado/comanda-do-assistente";
import { lerPapel, type LinhaDoPapel } from "@/lib/papel-da-impressora";
import { blocosParaOAssistente, saneiaAvisos, type AvisosDesligados, type Bloco } from "@/lib/comanda-modelo";

/**
 * Três pedidos, porque um só não mostra todos os avisos: o pago na entrega
 * mostra "COBRAR NA ENTREGA" e o troco; o do iFood mostra "NÃO COBRAR" e a
 * linha do número no app; o da mesa mostra a mesa no topo e o garçom.
 */
export type ExemploDaPrevia = "entrega" | "ifood" | "mesa";

export const EXEMPLOS_DA_PREVIA: { chave: ExemploDaPrevia; nome: string }[] = [
  { chave: "entrega", nome: "Entrega paga na entrega" },
  { chave: "ifood", nome: "iFood pago online" },
  { chave: "mesa", nome: "Mesa com garçom" },
];

function pedidoDeExemplo(exemplo: ExemploDaPrevia) {
  // Hora fixa: a prévia não pode "piscar" a cada minuto que passa.
  const createdAt = "2026-09-23T21:45:00.000Z";
  const itens = [
    { name: "Pizza Calabresa G", qty: 1, quantity: 1, price: 54.9, notes: "bem assada" },
    { name: "Esfiha de Carne", qty: 4, quantity: 4, price: 5.5 },
    { name: "Coca-Cola Lata", qty: 2, quantity: 2, price: 6 },
  ];
  const subtotal = 54.9 + 4 * 5.5 + 2 * 6;
  if (exemplo === "mesa") {
    // Uma rodada lançada na conta aberta: os campos são os que a fila e o
    // painel mandam (lib/mesa-na-comanda.ts), e o pagamento fica para o
    // fechamento da mesa.
    return {
      id: "exemplo_previa_mesa",
      dailyOrderNumber: 8,
      customerName: "Carlos",
      customerPhone: "00000000000",
      customerAddress: "Mesa 4",
      deliveryType: "MESA",
      source: "PRESENCIAL",
      paymentMethod: "N/A",
      tableSessionId: "exemplo_previa_conta",
      mesa: "4",
      garcom: "Rafaela",
      items: itens,
      deliveryFee: 0,
      totalAmount: Math.round(subtotal * 100) / 100,
      createdAt,
    };
  }
  if (exemplo === "ifood") {
    return {
      id: "exemplo_previa_ifood",
      dailyOrderNumber: 43,
      customerName: "Larissa Moreira",
      customerPhone: "(22) 99999-1020",
      customerAddress: "Rua Dez, 59 - Costazul - Rio das Ostras",
      deliveryType: "DELIVERY",
      source: "IFOOD",
      ifoodReference: "4035",
      deliveryBy: "MERCHANT",
      paymentMethod: "Credito (Pago Online)",
      isPrepaid: true,
      notes: "📝 Sem cebola, por favor. Tocar a campainha.",
      items: itens,
      deliveryFee: 7,
      totalAmount: Math.round((subtotal + 7) * 100) / 100,
      createdAt,
    };
  }
  return {
    id: "exemplo_previa_entrega",
    dailyOrderNumber: 12,
    customerName: "Larissa Moreira",
    customerPhone: "(22) 99999-1020",
    customerAddress: "Rua Dez, 59 - Costazul - Rio das Ostras",
    deliveryType: "DELIVERY",
    source: "SITE",
    paymentMethod: "Dinheiro",
    changeAmount: 100,
    notes: "📝 Sem cebola, por favor. Tocar a campainha.",
    items: itens,
    deliveryFee: 7,
    totalAmount: Math.round((subtotal + 7) * 100) / 100,
    createdAt,
  };
}

export type EntradaDaPrevia = {
  lista: Bloco[];
  avisos?: AvisosDesligados;
  via: "completo" | "cozinha";
  exemplo: ExemploDaPrevia;
  nomeDaLoja: string;
  colunas: number;
  /** A tarja de bebida segue a configuração da loja, como no papel de verdade. */
  autoBeverageTag?: boolean;
  customBeverageKeywords?: unknown;
};

/** As linhas do papel, exatamente como o Assistente atual as imprime. */
export function papelDaPrevia(e: EntradaDaPrevia): LinhaDoPapel[] {
  const avisos = saneiaAvisos(e.avisos);
  const order = {
    ...pedidoDeExemplo(e.exemplo),
    blocos: blocosParaOAssistente(e.lista),
    ...(avisos ? { avisos } : {}),
    ...(e.via === "cozinha" ? { semValores: true } : {}),
    printerConfig: {
      autoBeverageTag: e.autoBeverageTag,
      customBeverageKeywords: e.customBeverageKeywords,
    },
  };
  return lerPapel(comandaDoAssistente(order, e.nomeDaLoja || "Sua Loja", e.colunas, "safe"));
}
