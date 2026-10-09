/**
 * /src/lib/tipo-do-pedido-do-robo.ts
 *
 * Entrega ou retirada, no pedido que o robô do WhatsApp anota. Sem banco e sem
 * rede de propósito: é provado por scripts/teste-tipo-do-pedido-do-robo.mjs.
 *
 * O JSON do PEDIDO_IA não traz o tipo — traz `address` e `deliveryFee`. O sinal
 * é o que a IA anotou: texto de balcão ("retirada", "vou buscar") é retirada;
 * sem endereço nenhum e sem frete também. Todo o resto é entrega.
 *
 * ── O endereço que vale é o do PEDIDO, não o da mensagem ────────────────────
 *
 * O robô grava um rascunho logo no primeiro PEDIDO_IA, antes de o cliente dar o
 * endereço, e o atualiza a cada mensagem. A regra olhava só o `address` da
 * mensagem da vez — e a atualização do rascunho nem regravava o tipo. O pedido
 * nascia RETIRADA e ficava assim com endereço, frete e nota "Entrega: 1.9 km":
 * seis na Hakim Centro entre 06 e 12/09/2026, o #50 com a cliente esperando em
 * casa. Então o endereço é o desta mensagem ou, se ela não trouxe, o que o
 * rascunho já guardou.
 */

export type TipoDoPedido = "DELIVERY" | "RETIRADA";

const FALA_DE_BALCAO = /retirad|balc[ãa]o|buscar|takeout|pickup/;

export function tipoDoPedidoDoRobo(e: {
  /** `address` do PEDIDO_IA desta mensagem. */
  enderecoDoPayload?: unknown;
  /** `customerAddress` do rascunho que esta mensagem atualiza, se houver. */
  enderecoDoRascunho?: unknown;
  /** `deliveryType`/`orderType`, se a IA escreveu um. */
  tipoInformado?: unknown;
  /** Frete já validado (número, >= 0). */
  frete: number;
}): { tipo: TipoDoPedido; endereco: string } {
  const endereco = String(e.enderecoDoPayload || e.enderecoDoRascunho || "").trim();
  const texto = `${endereco} ${e.tipoInformado || ""}`.toLowerCase();
  const retirada = FALA_DE_BALCAO.test(texto) || (!endereco && e.frete === 0);
  return { tipo: retirada ? "RETIRADA" : "DELIVERY", endereco };
}

// ── RETIRADA SÓ QUANDO O CLIENTE PEDIU ──────────────────────────────────────
//
// Pizzaria Lapastine, 08/10/2026, pedido nº 2: o cliente não disse se era
// entrega ou retirada. O modelo escreveu "Tipo: Retirada no balcão" no resumo
// (e "Retirada no balcão" no endereço da tag), o cliente respondeu "Sim
// completa" ao resumo e o pedido fechou como RETIRADA — enquanto o robô ainda
// pedia a localização para entregar. A localização chegou depois e virou
// "alteração" de um pedido que já estava na cozinha como balcão.
//
// O tipo continua vindo da tag (acima). Esta é só a trava do FECHAMENTO: o
// pedido final de retirada precisa de o cliente ter falado em retirar/buscar
// em algum momento da conversa.

const CLIENTE_FALA_EM_RETIRAR = new RegExp(
  [
    /retirada|\bretiro\b|vou retirar|pra retirar|para retirar|retirar (ai|aqui|na loja|no balcao|no local)/.source,
    /\bbuscar\b|\bbusco\b|vou busca|passo (ai|ae|la|pra pegar|para pegar)|\bvou (ai|ae|la)\b/.source,
    /pego (ai|ae|la|aqui)|vou pegar|eu pego|balcao|takeout|pickup/.source,
    // Espanhol: "paso a buscar", "lo recojo"
    /recoger|\brecojo\b/.source,
  ].join("|"),
);

const semAcento = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * O cliente pediu para retirar? `true` = falou; `false` = não falou em nenhuma
 * mensagem; `null` = não dá para saber (áudio sem transcrição, mensagem sem
 * texto) — e aí ninguém trava nada.
 */
export function clientePediuRetirada(textosDoCliente: unknown[], ouvindoAudio = false): boolean | null {
  const textos = (textosDoCliente || []).map((t) => String(t ?? ""));
  if (textos.some((t) => CLIENTE_FALA_EM_RETIRAR.test(semAcento(t)))) return true;
  if (ouvindoAudio || textos.some((t) => !t.trim() || /(^|[^a-z])[aá]udio([^a-z]|$)/i.test(t))) return null;
  return false;
}
