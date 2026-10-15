/**
 * O fetch para o Assistente local em arquivo próprio: a tela do totem (TEF)
 * usa sem carregar o motor de impressão inteiro. lib/print.ts reexporta daqui.
 */

/**
 * TODO fetch para o Assistente local passa por aqui — nunca por fetch() puro.
 *
 * ── POR QUE (Chrome 2026, "Local Network Access") ───────────────────────────
 *
 * O Chrome passou a exigir permissão do usuário para um site público falar com
 * localhost — e a requisição só entra na fila do prompt se DECLARAR o espaço
 * de endereço de destino. Sem a declaração o bloqueio é imediato e mudo:
 *
 *   "Permission was denied for this request to access the `loopback` address
 *    space."
 *
 * Foi assim que, em 27/08/2026, a tela de impressoras passou a dizer
 * "Desconectado" com o Assistente rodando e saudável na mesma máquina (visto
 * no Brasa Burguer e reproduzido aqui) — e a impressão disparada do navegador
 * morria do mesmo jeito, sem erro visível.
 *
 * O nome do valor mudou entre versões do spec ("local" → "loopback"), e valor
 * desconhecido faz o fetch LANÇAR TypeError na hora. Por isso a escada:
 * loopback → local → sem a opção (navegador antigo ignora chave desconhecida,
 * então o último degrau é o comportamento de sempre).
 *
 * Na primeira chamada o Chrome mostra "firehubfood.com.br quer acessar
 * dispositivos na sua rede" — a loja clica PERMITIR uma vez e a escolha fica
 * salva para o site inteiro (o WebSocket da tela de impressoras herda a
 * permissão; ele não tem como declarar o espaço sozinho).
 */
export async function fetchAssistente(url: string, init?: RequestInit): Promise<Response> {
  for (const espaco of ["loopback", "local"]) {
    try {
      return await fetch(url, { ...(init || {}), targetAddressSpace: espaco } as RequestInit);
    } catch (err) {
      // TypeError com a MENSAGEM do enum = valor que este Chrome não conhece:
      // tenta o próximo nome. Qualquer outra falha (rede, timeout, abort) é
      // real e sobe para o chamador tratar como sempre tratou.
      const msg = String((err as any)?.message || "");
      if (err instanceof TypeError && /targetAddressSpace|address space|enum/i.test(msg)) continue;
      throw err;
    }
  }
  return fetch(url, init);
}
