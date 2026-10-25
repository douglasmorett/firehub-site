/**
 * INCLUIR OU CORRIGIR O CLIENTE (nome e telefone) DE UM PEDIDO JÁ LANÇADO.
 *
 * Divinos Burguer (Luiz Carlos, 24/10/2026): "preciso adicionar um cliente no
 * pedido que eu gerei como balcão, e não consigo". No balcão o nome e o
 * telefone são opcionais, e depois de lançado não havia onde preencher: só
 * cancelar e lançar tudo de novo (imprimia a comanda duas vezes).
 *
 * Mesma ideia do endereço (lib/correcao-de-endereco.ts): uma regra pura, que a
 * tela (o botão) e a rota leem — não existe botão que o servidor recusa.
 *
 * Quem NÃO muda o cliente:
 *   - sem permissão de editar pedido, pedido cancelado ou ainda não pronto;
 *   - pedido de mesa: o cliente é o da conta, e a mesa tem a tela dela;
 *   - pedido de app (iFood, 99Food...): nome e telefone são do app, que
 *     continua com os dados dele — mudar aqui só desencontraria os dois.
 */
import { STATUS_CANCELADOS } from "@/lib/status-pedido";
import { STATUS_EDITAVEIS, podeEditarPedidos, type OperadorDaEdicao } from "@/lib/edicao-de-pedido";
import { canalDoPedido } from "@/lib/canal-do-pedido";

export const MAXIMO_DO_NOME = 80;
/** DDD + número (10 ou 11 dígitos), com ou sem o 55 na frente. */
const TELEFONE_MIN = 10;
const TELEFONE_MAX = 13;

/** O telefone que o PDV grava quando o balcão fica sem cliente. */
const TELEFONE_VAZIO = /^0+$/;

/** O botão aparece / a rota aceita? `null` = pode; senão, o porquê. */
export function motivoParaNaoMudarOCliente(pedido: any, operador: OperadorDaEdicao): string | null {
  if (!pedido?.id) return "Pedido não encontrado.";
  if ((STATUS_CANCELADOS as readonly string[]).includes(String(pedido.status || "").toUpperCase())) {
    return "Pedido cancelado não muda de cliente.";
  }
  if (!podeEditarPedidos(operador)) {
    return "Você não tem permissão para editar pedidos. O dono da loja libera em Configurações → Equipe.";
  }
  if (pedido.tableSessionId || String(pedido.deliveryType || "").toUpperCase() === "MESA") {
    return "Este pedido é de uma mesa: o cliente é o da conta.";
  }
  if (canalDoPedido(pedido).ehMarketplace) {
    return "Pedido de aplicativo: o nome e o telefone são do app.";
  }
  if (!(STATUS_EDITAVEIS as readonly string[]).includes(String(pedido.status || "").toUpperCase())) {
    return "Este pedido ainda não está pronto para ser editado.";
  }
  return null;
}

/** O nome como vai ser gravado: espaços juntados, sem quebra de linha. */
export function nomeParaGravar(texto: unknown): string {
  return String(texto ?? "").replace(/\s+/g, " ").trim();
}

/** Só os dígitos do telefone. */
export function telefoneParaGravar(texto: unknown): string {
  return String(texto ?? "").replace(/\D/g, "");
}

/** O pedido ainda não tem telefone de verdade (balcão sem cliente grava zeros ou nada). */
export function semTelefone(telefone: unknown): boolean {
  const d = telefoneParaGravar(telefone);
  return d.length === 0 || TELEFONE_VAZIO.test(d);
}

/** `null` = serve; senão, a frase para a tela. Nome ou telefone: pelo menos um. */
export function problemaDoCliente(nome: string, telefone: string): string | null {
  if (!nome && !telefone) return "Preencha o nome ou o telefone do cliente.";
  if (nome && nome.length < 2) return "Escreva o nome do cliente.";
  if (nome.length > MAXIMO_DO_NOME) return `Nome longo demais (máximo ${MAXIMO_DO_NOME} letras).`;
  if (telefone && (telefone.length < TELEFONE_MIN || telefone.length > TELEFONE_MAX)) {
    return "Telefone com DDD, por exemplo 22 99999-9999.";
  }
  return null;
}

/** Igual ao que já está gravado: não é mudança. Campo em branco = não mexe. */
export function mesmoCliente(
  novo: { nome: string; telefone: string },
  atual: { customerName?: unknown; customerPhone?: unknown },
): boolean {
  const nomeIgual = !novo.nome || nomeParaGravar(atual.customerName).toLowerCase() === novo.nome.toLowerCase();
  const telIgual = !novo.telefone || telefoneParaGravar(atual.customerPhone) === novo.telefone;
  return nomeIgual && telIgual;
}

/** O resumo para o histórico do pedido: "Cliente: (sem) → Ana · 22999999999". */
export function descricaoDaMudancaDoCliente(
  novo: { nome: string; telefone: string },
  atual: { customerName?: unknown; customerPhone?: unknown },
): string {
  const parte = (nome: unknown, tel: unknown) => {
    // "Cliente" e "Balcão" são o que o PDV põe quando ninguém foi informado.
    const n = /^(cliente|balc[aã]o)$/i.test(nomeParaGravar(nome)) ? "" : nomeParaGravar(nome);
    const t = semTelefone(tel) ? "" : telefoneParaGravar(tel);
    return [n, t].filter(Boolean).join(" · ") || "(sem cliente)";
  };
  const depoisNome = novo.nome || nomeParaGravar(atual.customerName);
  const depoisTel = novo.telefone || (semTelefone(atual.customerPhone) ? "" : telefoneParaGravar(atual.customerPhone));
  return `Cliente ${parte(atual.customerName, atual.customerPhone)} → ${parte(depoisNome, depoisTel)}`;
}
