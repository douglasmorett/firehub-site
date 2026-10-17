import { STATUS_EDITAVEIS, podeEditarPedidos, type OperadorDaEdicao } from "@/lib/edicao-de-pedido";
import { STATUS_CANCELADOS } from "@/lib/status-pedido";

/**
 * "Corrigir endereço" de um pedido já feito — a regra que a tela
 * (CorrigirEnderecoPainel) e a rota (/api/store/orders/[id]/endereco) leem.
 *
 * ── Por que existe (Showrrascão, 17/10/2026) ────────────────────────────────
 *
 * Flavio: "não está permitindo editar o endereço da pessoa… precisa editar o
 * endereço quando ele está errado e não dá opção, nem na comanda nem na base
 * do cliente". O "Editar cadastro" da ficha (11/10) muda o endereço principal
 * do CLIENTE para os próximos pedidos; o pedido que já entrou ficava com o
 * texto errado na comanda, na roteirização e no app do motoboy.
 *
 * ── As regras ───────────────────────────────────────────────────────────────
 *
 * Quem pode: o mesmo da edição de itens — dono sempre, funcionário com
 * "editar pedidos" (`podeEditarPedidos`); nos status que a edição aceita
 * (`STATUS_EDITAVEIS`: nunca cancelado nem rascunho do robô); mesa não (não é
 * entrega). Ao contrário da edição de itens, a NFC-e autorizada NÃO trava: o
 * endereço não muda valor nenhum da nota, e na loja que emite em todo pedido
 * a trava tiraria a correção justo de todos.
 * Marketplace PODE, ao contrário da taxa: o endereço não é dinheiro do app, e
 * é justamente no iFood/99Food que o cliente escolhe o endereço errado e
 * avisa pelo chat. A correção vale só aqui (comanda, mapa, motoboy); o app
 * continua com o dele.
 *
 * A taxa NÃO muda junto: a correção de taxa tem regra própria (motivo,
 * pagamento dividido, marketplace) e fica no botão dela.
 */

/** Os tipos que as rotas do pedido tratam como retirada. */
const TIPOS_DE_RETIRADA = ["PICKUP", "TAKEOUT", "RETIRADA", "BALCAO", "BALCÃO", "MESA", "PRESENCIAL", "IN_STORE"];

/** O endereço mais curto que ainda é endereço ("Rua A, 1"). */
export const MINIMO_DO_ENDERECO = 5;
/** O mesmo teto do campo do cadastro do cliente (200) com folga para complemento e referência. */
export const MAXIMO_DO_ENDERECO = 300;

/**
 * Até quando a distância acompanha o endereço novo — a mesma régua do
 * "Posicionar no mapa" (api/store/orders/[id]/ponto): `deliveryDistance` é
 * dinheiro do motoboy, e o acerto de um pedido mais velho pode já ter sido pago.
 */
export const REFAZ_DISTANCIA_ATE_HORAS = 12;

export function pedidoDeEntrega(pedido: { deliveryType?: string | null } | null | undefined): boolean {
  return !TIPOS_DE_RETIRADA.includes(String(pedido?.deliveryType || "").trim().toUpperCase());
}

/** O botão aparece / a rota aceita? `null` = pode; senão, o porquê. */
export function motivoParaNaoCorrigir(pedido: any, operador: OperadorDaEdicao): string | null {
  if (!pedido?.id) return "Pedido não encontrado.";
  if (!pedidoDeEntrega(pedido)) return "Este pedido não é de entrega.";
  if ((STATUS_CANCELADOS as readonly string[]).includes(String(pedido.status || "").toUpperCase())) {
    return "Pedido cancelado não muda de endereço.";
  }
  if (!podeEditarPedidos(operador)) {
    return "Você não tem permissão para editar pedidos. O dono da loja libera em Configurações → Equipe.";
  }
  if (pedido.tableSessionId) return "Este pedido é de uma mesa.";
  if (!(STATUS_EDITAVEIS as readonly string[]).includes(String(pedido.status || "").toUpperCase())) {
    return "Este pedido ainda não está pronto para ser editado.";
  }
  return null;
}

/** O texto como vai ser gravado: espaços juntados, sem quebra de linha. */
export function enderecoParaGravar(texto: unknown): string {
  return String(texto ?? "").replace(/\s+/g, " ").trim();
}

/** `null` = o texto serve; senão, a frase para a tela. */
export function problemaDoEndereco(texto: string): string | null {
  if (texto.length < MINIMO_DO_ENDERECO) return "Escreva o endereço completo: rua, número e bairro.";
  if (texto.length > MAXIMO_DO_ENDERECO) return `Endereço longo demais (máximo ${MAXIMO_DO_ENDERECO} letras). Ponha a referência na observação.`;
  return null;
}

/** Igual ao gravado, ignorando caixa e espaços: não é correção. */
export function mesmoEndereco(a: unknown, b: unknown): boolean {
  return enderecoParaGravar(a).toLowerCase() === enderecoParaGravar(b).toLowerCase();
}

/** A distância gravada é refeita a partir do endereço novo? (ver REFAZ_DISTANCIA_ATE_HORAS) */
export function refazADistancia(
  pedido: { createdAt: Date | string; deliveryDistance?: number | null },
  agora: Date = new Date(),
): boolean {
  if (pedido.deliveryDistance == null) return true;
  const idadeH = (agora.getTime() - new Date(pedido.createdAt).getTime()) / 3_600_000;
  return idadeH <= REFAZ_DISTANCIA_ATE_HORAS;
}
