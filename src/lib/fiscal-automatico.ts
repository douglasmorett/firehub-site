/**
 * /src/lib/fiscal-automatico.ts
 *
 * Emissão automática de NFC-e quando o pedido é concluído.
 *
 * A tela fiscal sempre ofereceu "formas de pagamento com emissão automática"
 * (autoEmitPaymentMethods) — mas NENHUM código lia essa lista: o lojista
 * marcava PIX e cartão achando que as notas sairiam sozinhas, e nada
 * acontecia. Este arquivo é quem cumpre a promessa: o hook de status chama
 * `emitirNfceAutomatica` no ENTREGUE e a nota sai pelas mesmas funções do
 * botão "Emitir" — mesma validação, mesma ref idempotente, mesmo registro de
 * falha honesto.
 *
 * Silencioso por desenho: emissão automática não pode travar a operação. Se a
 * loja não está configurada, não faz nada (o aviso já mora na tela fiscal);
 * se a SEFAZ recusar, o pedido fica FAILED com o motivo e aparece na aba
 * Notas fiscais como "Falhou" — nunca um alert no meio do salão.
 */
import { prisma } from "@/lib/prisma";
import {
  emitirNfce,
  pendenciasParaEmitir,
  type ConfiguracaoFiscal,
  type ItemDaNota,
} from "./fiscal-emissao";

/**
 * Traduz o `paymentMethod` gravado no pedido (que varia por canal: "PIX",
 * "Dinheiro", "Cartão de Crédito", "CREDIT", "cash"...) para a chave que a
 * tela fiscal usa nos checkboxes (MONEY | PIX | CREDIT_CARD | DEBIT_CARD |
 * VOUCHER). Sem correspondência → null → não emite automático.
 */
export function chaveDaFormaDePagamento(forma: string | null | undefined): string | null {
  const f = (forma || "").toLowerCase();
  if (!f) return null;
  if (f.includes("pix")) return "PIX";
  if (f.includes("dinheiro") || f.includes("money") || f.includes("cash") || f.includes("espécie") || f.includes("especie")) return "MONEY";
  if (f.includes("créd") || f.includes("cred")) return "CREDIT_CARD";
  if (f.includes("déb") || f.includes("deb")) return "DEBIT_CARD";
  if (f.includes("vale") || f.includes("voucher") || f.includes("refei") || f.includes("aliment") || f.includes("meal")) return "VOUCHER";
  return null;
}

/**
 * Emite a NFC-e do pedido se a loja pediu emissão automática para aquela
 * forma de pagamento. Fire-and-forget: quem chama não espera nem depende.
 */
export async function emitirNfceAutomatica(orderId: string): Promise<void> {
  try {
    const order = await prisma.customerOrder.findUnique({
      where: { id: orderId },
      include: { items: { include: { menuProduct: true } } },
    });
    if (!order) return;

    // Nota já autorizada não se emite de novo.
    const fiscalAtual = (order.fiscalInfo as any) || {};
    if (order.fiscalStatus === "EMITTED" && fiscalAtual.nfceKey) return;
    // Se há nota em processamento na SEFAZ, reemitir duplicaria — a consulta
    // (manual ou o próprio reenvio, que consulta a ref) resolve o estado.
    if (fiscalAtual.processando) return;

    const loja = await prisma.user.findUnique({
      where: { id: order.franchiseeId },
      select: { fiscalConfig: true },
    });
    const config = (loja?.fiscalConfig as (ConfiguracaoFiscal & {
      enabled?: boolean;
      autoEmitPaymentMethods?: string[];
    }) | null) ?? {};

    if (!config.enabled) return;

    const listaAuto = Array.isArray(config.autoEmitPaymentMethods)
      ? config.autoEmitPaymentMethods
      : [];
    const chave = chaveDaFormaDePagamento(order.paymentMethod);
    if (!chave || !listaAuto.includes(chave)) return;

    // Loja sem cadastro completo: não tenta (e não marca FAILED — a pendência
    // é de configuração, não deste pedido; a tela fiscal já lista o que falta).
    if (pendenciasParaEmitir(config).length > 0) {
      console.log(`[Fiscal Auto] Loja ${order.franchiseeId} com cadastro incompleto — pedido ${orderId} segue pendente.`);
      return;
    }

    const itens: ItemDaNota[] = order.items.map((item) => {
      const p = item.menuProduct;
      // Mesmo mapeamento do botão Emitir: o cadastro fiscal do produto manda.
      // No Regime Normal (CRT 3) o campo "situação tributária" guarda o CST.
      const situacao = String(p?.csosn ?? "").trim();
      return {
        codigo: p?.id ?? item.id,
        descricao: item.productName || p?.name || "Item",
        ncm: p?.ncm ?? "",
        cest: p?.cest ?? null,
        cfop: p?.cfop ?? "5102",
        unidadeComercial: "UN",
        quantidade: item.quantity,
        valorUnitario: item.price,
        valorTotal: item.price * item.quantity,
        origem: Number(p?.origem ?? 0) || 0,
        csosn: situacao || null,
        cst: situacao.length === 2 ? situacao : null,
        pis: p?.pis ?? null,
        cofins: p?.cofins ?? null,
      };
    });

    const resultado = await emitirNfce(config, {
      id: order.id,
      numero: order.dailyOrderNumber ?? null,
      itens,
      valorTotal: order.totalAmount,
      taxaEntrega: order.deliveryFee || 0,
      desconto: order.discountTotal || 0,
      formaDePagamento: order.paymentMethod || "Dinheiro",
      documentoDoCliente: order.customerCpfCnpj,
      nomeDoCliente: order.customerName,
    });

    if (resultado.ok) {
      await prisma.customerOrder.update({
        where: { id: order.id },
        data: {
          fiscalStatus: "EMITTED",
          fiscalInfo: {
            nfceKey: resultado.chaveDeAcesso,
            nfceNumber: resultado.numero,
            serie: resultado.serie,
            protocol: resultado.protocolo,
            emittedAt: resultado.emitidaEm,
            ambiente: resultado.ambiente,
            xmlUrl: resultado.urlDoXml,
            pdfUrl: resultado.urlDoDanfe,
            emitidaAutomaticamente: true,
          },
        },
      });
      console.log(`[Fiscal Auto] ✅ NFC-e do pedido ${orderId} autorizada (${resultado.chaveDeAcesso}).`);
      return;
    }

    if (resultado.motivo === "processando") {
      await prisma.customerOrder.update({
        where: { id: order.id },
        data: {
          fiscalStatus: "PENDING",
          fiscalInfo: {
            ...fiscalAtual,
            processando: true,
            ultimaTentativaEm: new Date().toISOString(),
          },
        },
      });
      console.log(`[Fiscal Auto] ⏳ NFC-e do pedido ${orderId} em processamento na SEFAZ.`);
      return;
    }

    await prisma.customerOrder.update({
      where: { id: order.id },
      data: {
        fiscalStatus: "FAILED",
        fiscalInfo: {
          ...fiscalAtual,
          ultimaTentativaEm: new Date().toISOString(),
          ultimoErro: resultado.mensagem,
          motivo: resultado.motivo,
          tentativaAutomatica: true,
        },
      },
    });
    console.error(`[Fiscal Auto] ❌ NFC-e do pedido ${orderId} não autorizada: ${resultado.mensagem}`);
  } catch (err: any) {
    // Nunca propaga: emissão automática não pode derrubar a rota de status.
    console.error(`[Fiscal Auto] Erro inesperado no pedido ${orderId}:`, err?.message);
  }
}
