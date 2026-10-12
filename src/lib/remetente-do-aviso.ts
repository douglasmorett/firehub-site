/**
 * POR QUAL WHATSAPP SAI O AVISO DE STATUS DO PEDIDO.
 *
 * Regra do Douglas (12/10/2026): cada loja fala pelo próprio número. Loja
 * sem WhatsApp conectado não manda nada — nunca o número de outra loja.
 *
 * Caso que motivou: a Yakisoba do San é filial da China Pow (marcas
 * diferentes, mesmo dono). O WhatsApp dela estava com o robô do Anota AI, não
 * com o FireHub. O pedido nº 20 do site (11/10) foi aceito sozinho e o "EM
 * PRODUÇÃO" saiu pelo número da China Pow: a cliente recebeu de um número que
 * não conhecia, falou com o número da Yakisoba, ninguém achou o pedido e ela
 * cancelou depois de quase 3 h.
 *
 * Única exceção: pedido FEITO PELO ROBÔ numa filial sem conexão. Ele só pode
 * ter nascido na conversa do robô da principal e sido passado à filial no
 * aceite (Pizzaria 17 → Aeroporto, lib/finalizar-rascunho.ts). Aí o aviso
 * continua na mesma conversa em que o cliente pediu — não é outra loja
 * respondendo.
 *
 * Arquivo puro, sem imports: o teste o carrega sozinho
 * (scripts/teste-remetente-do-aviso.ts).
 */
export function lojaQueEnviaOAviso(p: {
  lojaDoPedido: string;
  lojaConectada: boolean;
  origemDoPedido: string | null | undefined;
  principalDoGrupo: string | null | undefined;
  principalConectada: boolean;
}): string | null {
  if (p.lojaConectada) return p.lojaDoPedido;
  if (p.principalDoGrupo && p.principalConectada && p.origemDoPedido === "WHATSAPP_IA") {
    return p.principalDoGrupo;
  }
  // Loja sozinha (sem grupo) e desconectada: tenta pelo próprio número, como
  // sempre foi — o `connected` pode estar atrasado e o gateway decide. Filial
  // de grupo sem conexão não tem o que tentar: o número dela não é do FireHub.
  return p.principalDoGrupo ? null : p.lojaDoPedido;
}
