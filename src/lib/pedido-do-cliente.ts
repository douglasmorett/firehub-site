/**
 * Este pedido é DESTE cliente do WhatsApp? — a regra única do robô.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Lapastine, 09/10/2026: o Alessandro pediu pelo SITE (pedido #4, já saindo
 * para entrega) e depois escreveu no WhatsApp "quando sair para entregar me
 * avisa". O robô respondeu que o pedido "ainda não foi confirmado no sistema"
 * e começou a montar um pedido NOVO, com as mesmas pizzas. Dois defeitos
 * somados:
 *
 *  1. A busca do pedido em andamento aceitava só `source` "WHATSAPP_IA" e
 *     "SITE" — e o site grava "ONLINE". Nenhum pedido do cardápio online era
 *     encontrado, nunca, nem com o telefone certo.
 *  2. No site ele digitou 94 99266-0433; o WhatsApp dele é 94 99269-0433. Um
 *     dígito trocado, e a comparação pelos 8 dígitos finais não o reconhecia.
 *
 * A regra do dono: o robô TEM de saber que quem escreve já pediu — para
 * oferecer o acréscimo (pop-up para a loja) ou avisar que já saiu para
 * entrega, em vez de abrir outro pedido.
 *
 * ── A regra ─────────────────────────────────────────────────────────────────
 *
 *  - Mesmo telefone (DDD + número, nono dígito tolerado — lib/telefone.ts): é
 *    dele.
 *  - Telefone com UM dígito errado (trocado, ou dois vizinhos invertidos) E o
 *    mesmo primeiro nome: é dele, com a marca `parecido` — o robô fica sabendo
 *    que o número do pedido não é o do WhatsApp.
 *  - Só o nome, ou só o telefone parecido: NÃO é dele. "Maria" sozinha é meia
 *    cidade, e o número parecido de outra pessoa é o vizinho.
 *
 * Arquivo puro (só importa lib/telefone.ts): roda no teste sem banco.
 */
import { telefoneCanonico } from "./telefone";

/**
 * Os canais em que o pedido é da LOJA e o robô pode tratar dele: o próprio
 * robô, o cardápio online e o balcão. iFood, 99, Brendi e afins não se alteram
 * daqui — o pedido mora na plataforma.
 */
export const CANAIS_DA_LOJA = ["WHATSAPP_IA", "ONLINE", "SITE", "WEB", "PRESENCIAL", "PDV", "TOTEM"];

/** Nome que não diz quem é a pessoa. */
const NOME_GENERICO = /^(cliente|whatsapp|user|usuario|ifood|balcao|mesa|consumidor)/;

/** Primeiro nome, minúsculo e sem acento; "" se não servir para comparar. */
export function primeiroNomeDe(nome: string | null | undefined): string {
  const limpo = String(nome || "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .trim();
  const primeiro = limpo.split(/\s+/)[0] || "";
  if (primeiro.length < 3 || NOME_GENERICO.test(primeiro)) return "";
  return primeiro;
}

/**
 * Os dois números diferem por UM erro de digitação: um dígito trocado, ou dois
 * vizinhos invertidos (92690 × 92960). Iguais NÃO contam aqui — isso é
 * `mesmoTelefone`.
 */
export function telefoneComUmErro(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = telefoneCanonico(a);
  const cb = telefoneCanonico(b);
  if (!ca || !cb || ca === cb || ca.length !== cb.length) return false;
  const dif: number[] = [];
  for (let i = 0; i < ca.length; i++) if (ca[i] !== cb[i]) dif.push(i);
  if (dif.length === 1) return true;
  return dif.length === 2 && dif[1] === dif[0] + 1 && ca[dif[0]] === cb[dif[1]] && ca[dif[1]] === cb[dif[0]];
}

export type ComoReconheceu = "telefone" | "parecido";

/**
 * Como o pedido foi reconhecido como deste cliente — ou `null`, não é dele.
 *
 * `nomes`: o que se sabe do nome de quem escreve (o nome do WhatsApp, o do
 * cadastro de clientes). Basta um deles bater com o do pedido.
 */
export function pedidoEhDoCliente(
  pedido: { customerPhone?: string | null; customerName?: string | null },
  cliente: { telefone: string | null | undefined; nomes?: Array<string | null | undefined> }
): ComoReconheceu | null {
  const doCliente = telefoneCanonico(cliente.telefone);
  if (!doCliente) return null;
  const doPedido = telefoneCanonico(pedido.customerPhone);
  if (doPedido && doPedido === doCliente) return "telefone";
  if (!telefoneComUmErro(pedido.customerPhone, cliente.telefone)) return null;
  const nomeDoPedido = primeiroNomeDe(pedido.customerName);
  if (!nomeDoPedido) return null;
  return (cliente.nomes || []).some((n) => primeiroNomeDe(n) === nomeDoPedido) ? "parecido" : null;
}

/**
 * Os filtros do funil no banco (o `pedidoEhDoCliente` decide depois): o final
 * de 4 dígitos pega o número certo e o que errou no começo; o primeiro nome
 * pega o que errou no final.
 */
export function funilDoCliente(cliente: { telefone: string | null | undefined; nomes?: Array<string | null | undefined> }): {
  final4: string;
  primeirosNomes: string[];
} {
  const canonico = telefoneCanonico(cliente.telefone);
  const primeirosNomes = Array.from(new Set((cliente.nomes || []).map(primeiroNomeDe).filter(Boolean)));
  return { final4: canonico ? canonico.slice(-4) : "", primeirosNomes };
}
