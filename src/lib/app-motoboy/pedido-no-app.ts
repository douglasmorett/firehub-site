/**
 * O pedido como o APP NATIVO do entregador recebe (apps/motoboy).
 *
 * A página web do motoboy (/loja/[slug]/motoboy) faz estas contas no próprio
 * navegador, importando as libs do site. O app nativo não importa nada do site:
 * ele é outro projeto, publicado nas lojas, e cada versão instalada vive meses
 * no bolso de alguém. Regra que morasse no app só mudaria quando o entregador
 * atualizasse. Então o servidor manda tudo pronto, e o app só desenha:
 *
 *   - o número grande é o do PAINEL (dailyOrderNumber), com a referência do
 *     iFood/99 ao lado — loja e entregador falando o mesmo número;
 *   - o endereço que vai para o Google Maps/Waze sem "Comp:" e "Ref:", que
 *     impediam o mapa de gerar a rota (Ragnar, 03/09/2026);
 *   - a sacola (lib/pedido-do-motoboy.ts) e as bebidas do "você entregou?"
 *     (lib/beverage.ts), as mesmas da página web e da comanda.
 *
 * Quanto cobrar na porta já vinha decidido em `cobrarNaEntrega`
 * (lib/pagamento-na-entrega.ts) e continua vindo de lá.
 */
import { getBeveragesFromOrder } from "@/lib/beverage";
import { formaCanonica } from "@/lib/pagamento-na-entrega";
import { pedidoParaOMotoboy, resumoDoPedido } from "@/lib/pedido-do-motoboy";

/** Quanto tempo o entregador tem para devolver um pedido que ele mesmo puxou. */
export const JANELA_PARA_DEVOLVER_MS = 10 * 60_000;

/**
 * Tira do endereço o que o geocodificador não entende. Mesmo corte da página
 * web: separador " - " com espaço dos dois lados (o do iFood), porque hífen
 * colado é nome de rua ("Rod. BR-101").
 */
export function enderecoParaOMapa(endereco: string): string {
  return endereco
    .split(/\s+[-|]\s+/)
    .filter((parte) => !/^\s*(comp(lemento)?|ref(er[êe]ncia)?|obs)\s*[:.]/i.test(parte.trim()))
    .join(", ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * O ponto do cliente só guia a navegação quando é EXATO: o que o parceiro
 * mandou (iFood e 99 mandam o pino do cliente) ou o GPS/pino do próprio
 * cliente. O ponto que o servidor achou geocodificando o texto não ganha do
 * texto: o Google Maps geocodifica melhor, e o centro do bairro levaria o
 * entregador para a praça.
 */
function pontoExato(latLng: unknown): { lat: number; lng: number } | null {
  if (!latLng || typeof latLng !== "object") return null;
  const p = latLng as { lat?: unknown; lng?: unknown; origem?: unknown };
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  const origem = String(p.origem ?? "").trim();
  if (origem && !/gps|pino|parceiro|ifood|99|cliente/i.test(origem)) return null;
  return { lat, lng };
}

/**
 * O ponto para MOSTRAR no mapa — qualquer um que o pedido tenha. Diferente
 * de `pontoExato` (que guia a navegação): para o entregador ver "onde fica",
 * o ponto achado pelo texto ajuda, e o app avisa quando é só aproximado.
 * O Lucas (Frangoso, 03/10/2026): "às vezes o motoboy não precisa usar GPS,
 * eu vejo no mapa onde é e vou embora".
 */
export function pontoNoMapa(latLng: unknown): { lat: number; lng: number; aproximado: boolean } | null {
  if (!latLng || typeof latLng !== "object") return null;
  const p = latLng as { lat?: unknown; lng?: unknown; origem?: unknown };
  const lat = Number(p.lat);
  const lng = Number(p.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  const origem = String(p.origem ?? "").trim();
  // "bairro" = centro do bairro: serve para a direção, não para a porta.
  return { lat, lng, aproximado: /^bairro|centr[oó]ide|dicion/i.test(origem) };
}

/**
 * O telefone do cliente como o entregador usa. O iFood manda o 0800 com o
 * localizador ("08007003050 ID: 19612595"): discar só o 0800 e mostrar o ID,
 * que a central pede. WhatsApp só para celular de verdade.
 */
export function telefoneDoCliente(bruto: string | null | undefined): { discar: string; id: string | null; whatsapp: string | null } | null {
  const texto = String(bruto || "");
  const [antes, depois] = texto.split(/\bID\b\s*:?/i);
  const discar = String(antes || "").replace(/\D/g, "");
  if (discar.length < 8) return null;
  const id = depois ? depois.replace(/\D/g, "") || null : null;
  const ehCelular = !discar.startsWith("0800") && discar.length >= 10;
  const comPais = discar.length >= 12 && discar.startsWith("55") ? discar : `55${discar}`;
  return { discar, id, whatsapp: ehCelular ? comPais : null };
}

/** As observações sem as marcas que os parceiros colam no texto. */
export function observacaoLimpa(notas: string | null | undefined): string {
  return String(notas || "")
    // "Obs/Ref: Pedido Brendi #6003" no app do Frangoso (03/10/2026): a
    // referência já aparece na etiqueta do canal, aqui é só ruído.
    .replace(/Pedido (iFood|Jotaj[áa]|Brendi|99\s?Food|Wabiz|Anota\s?A[ií])\s*#\s*[A-Za-z0-9_-]+/gi, "")
    .replace(/^(\s*\|\s*)+|(\s*\|\s*)+$/g, "")
    .trim();
}

type PedidoDaLista = {
  id: string;
  dailyOrderNumber?: number | null;
  ifoodReference?: string | null;
  openDeliveryReference?: string | null;
  customerAddress?: string | null;
  customerLatLng?: unknown;
  notes?: string | null;
  customerPhone?: string | null;
  motoboyPuxadoEm?: Date | string | null;
  cobrarNaEntrega?: { metodo?: string | null } | null;
};

/** Os campos que o app desenha sem precisar de regra nenhuma. */
export function camposDoApp(
  pedido: PedidoDaLista,
  opcoes: { palavrasDeBebida: string | string[]; lembrarBebidas: boolean },
) {
  const endereco = String(pedido.customerAddress || "").trim() || "Endereço a confirmar";
  const paraOMapa = endereco === "Endereço a confirmar" ? "" : enderecoParaOMapa(endereco);
  const sacola = pedidoParaOMotoboy(pedido, opcoes.palavrasDeBebida);
  const refDaPlataforma = pedido.ifoodReference || pedido.openDeliveryReference || null;
  const numero = pedido.dailyOrderNumber ?? refDaPlataforma ?? pedido.id.slice(-4).toUpperCase();
  const puxadoEm = pedido.motoboyPuxadoEm ? new Date(pedido.motoboyPuxadoEm).getTime() : null;

  return {
    numero: String(numero),
    refDaPlataforma: refDaPlataforma && String(refDaPlataforma) !== String(numero) ? String(refDaPlataforma) : null,
    endereco,
    destino: paraOMapa ? { texto: paraOMapa, ponto: pontoExato(pedido.customerLatLng) } : null,
    /** O ponto para o mapa dentro do app (pode ser só aproximado). */
    mapa: pontoNoMapa(pedido.customerLatLng),
    telefone: telefoneDoCliente(pedido.customerPhone),
    observacao: observacaoLimpa(pedido.notes),
    sacola: { ...sacola, resumo: resumoDoPedido(sacola) },
    /** O "você entregou a bebida?" antes da baixa. Vazio = a loja desligou ou não há bebida. */
    bebidasParaConferir: opcoes.lembrarBebidas ? getBeveragesFromOrder(pedido, opcoes.palavrasDeBebida) : [],
    /** A forma que o pedido diz, já no nome da lista de formas (para marcar o botão certo). */
    formaDoPedido: pedido.cobrarNaEntrega ? formaCanonica(pedido.cobrarNaEntrega.metodo) : null,
    /** Até quando o "Não vou levar este pedido" vale. Nulo = a loja que atribuiu. */
    podeDevolverAte: puxadoEm ? new Date(puxadoEm + JANELA_PARA_DEVOLVER_MS).toISOString() : null,
  };
}
