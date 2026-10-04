/**
 * VÁRIAS LOJAS DA MESMA CONTA NO MESMO COMPUTADOR.
 *
 * O Assistente de Impressão guarda UM `franchiseeId`: o da loja que o painel
 * abriu por último. Quem tem duas lojas no mesmo PC (China Pow + Yakisoba do
 * San, 04/10/2026) só imprimia a loja aberta no painel. Os 3 pedidos pagos da
 * Yakisoba ficaram 20 horas em "NOVO" sem papel, e o Flávio achou que o robô
 * "só fazia o resumo".
 *
 * A fila da nuvem (api/store/print-queue) agora pode atender as lojas irmãs da
 * conta na mesma consulta. MAS SÓ QUANDO O DONO LIGA, e é de propósito: uma
 * conta com lojas em ENDEREÇOS diferentes (cada uma com o seu Assistente)
 * passaria a imprimir o pedido de uma na impressora da outra, e a comanda seria
 * dada como impressa no lugar errado. Só o dono sabe se as lojas dividem o PC.
 *
 * A opção mora no `printerConfig` de qualquer loja da conta; vale para o
 * grupo inteiro, então basta ligar uma vez, na loja que estiver aberta.
 */

export const CHAVE_DAS_LOJAS_NO_PC = "lojasDaContaNesteComputador";

export type LojaDoGrupo = { id: string; printerConfig?: unknown };

async function jobsDaResposta(r: Response | null | undefined): Promise<any[]> {
  if (!r || !r.ok) return [];
  try {
    const corpo = await r.json();
    return Array.isArray(corpo?.jobs) ? corpo.jobs : [];
  } catch {
    return [];
  }
}

/**
 * Junta as filas de cada loja numa lista só, da mais antiga para a mais nova.
 * Resposta de loja irmã que falhou, veio vazia ou com JSON quebrado vale como
 * "nada por agora": a comanda dela fica no banco e sai no poll seguinte, e a
 * impressão da loja principal nunca é derrubada por causa de uma irmã.
 */
export async function juntarJobsDasLojas(principal: Response, irmas: (Response | null | undefined)[]): Promise<any[]> {
  const jobs = [...(await jobsDaResposta(principal)), ...(await Promise.all(irmas.map(jobsDaResposta))).flat()];
  return jobs.sort((a, b) => String(a?.createdAt || "").localeCompare(String(b?.createdAt || "")));
}

/** Esta config liga a opção? Só `true` de verdade liga. */
export function ligadoNaConfig(printerConfig: unknown): boolean {
  return (printerConfig as any)?.[CHAVE_DAS_LOJAS_NO_PC] === true;
}

/**
 * As lojas que o Assistente de `franchiseeId` atende. Sempre inclui a própria
 * loja, primeiro. Sem a opção ligada em nenhuma loja da conta, é só ela.
 */
export function lojasQueOPcAtende(franchiseeId: string, grupo: LojaDoGrupo[] | null | undefined): string[] {
  const lojas = Array.isArray(grupo) ? grupo : [];
  const dentro = lojas.some((l) => l.id === franchiseeId);
  if (!dentro || lojas.length <= 1) return [franchiseeId];
  if (!lojas.some((l) => ligadoNaConfig(l.printerConfig))) return [franchiseeId];
  return [franchiseeId, ...lojas.map((l) => l.id).filter((id) => id !== franchiseeId)];
}
