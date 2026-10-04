/**
 * VÁRIAS LOJAS DA MESMA CONTA NO MESMO COMPUTADOR.
 *
 * O Assistente de Impressão guarda UM `franchiseeId`: o da loja que a tela de
 * Impressoras salvou por último. Quem tem duas lojas no mesmo PC (China Pow +
 * Yakisoba do San, 04/10/2026) só imprimia essa. Os 3 pedidos pagos da Yakisoba
 * ficaram 20 horas em "NOVO" sem papel, e o Flávio achou que o robô "só fazia o
 * resumo".
 *
 * A REGRA (do dono): o painel manda.
 *   - uma loja selecionada  → o PC imprime só ela;
 *   - "Todas as lojas"      → o PC imprime todas.
 * É o mesmo que o painel aberto já faz no navegador (feed de pedidos). Aqui a
 * fila da nuvem, que atende o Assistente, passa a seguir a mesma seleção.
 *
 * MAS SÓ NA CONTA QUE LIGA "estas lojas dividem este computador" (tela de
 * Impressoras), e é de propósito: o dono de lojas em ENDEREÇOS diferentes, cada
 * uma com o seu Assistente, ao olhar a loja 2 pelo computador da loja 1 faria a
 * loja 1 parar de imprimir, e a comanda da 2 sairia na impressora da 1. Só o
 * dono sabe se as lojas dividem o PC.
 *
 * Onde mora cada coisa, no `printerConfig`:
 *   - `lojasDaContaNesteComputador`: a opção do dono, em qualquer loja da conta.
 *   - `selecaoDoPainel`: "all" ou o id da loja; gravado na loja PRINCIPAL pela
 *     troca de loja (api/store/switch). Sem registro, vale "todas".
 */

export const CHAVE_DAS_LOJAS_NO_PC = "lojasDaContaNesteComputador";
export const CHAVE_DA_SELECAO = "selecaoDoPainel";

export type LojaDoGrupo = { id: string; accountGroupId?: string | null; printerConfig?: unknown };

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

/** A loja principal do grupo: a que não aponta para outra. */
function principalDoGrupo(grupo: LojaDoGrupo[]): LojaDoGrupo | undefined {
  return grupo.find((l) => !l.accountGroupId || l.accountGroupId === l.id) || grupo[0];
}

/**
 * A seleção do painel, só se ela ainda vale: "all" ou o id de uma loja DESTE
 * grupo. Qualquer outra coisa (loja apagada, lixo) é "sem seleção".
 */
export function selecaoDoPainel(grupo: LojaDoGrupo[]): "all" | string | null {
  const sel = (principalDoGrupo(grupo)?.printerConfig as any)?.[CHAVE_DA_SELECAO];
  if (sel === "all") return "all";
  return typeof sel === "string" && grupo.some((l) => l.id === sel) ? sel : null;
}

/**
 * As lojas que a fila entrega a este Assistente, que perguntou por `franchiseeId`.
 *
 *  - Opção desligada (ou conta de uma loja só): só a loja dele, como sempre foi.
 *  - Ligada, "Todas" ou sem seleção registrada: a dele primeiro, e as irmãs.
 *  - Ligada, uma loja selecionada: SÓ essa, mesmo que o Assistente tenha sido
 *    configurado para outra. Esse é o ponto da regra: o painel manda.
 */
export function lojasQueOPcAtende(franchiseeId: string, grupo: LojaDoGrupo[] | null | undefined): string[] {
  const lojas = Array.isArray(grupo) ? grupo : [];
  if (!lojas.some((l) => l.id === franchiseeId) || lojas.length <= 1) return [franchiseeId];
  if (!lojas.some((l) => ligadoNaConfig(l.printerConfig))) return [franchiseeId];
  const sel = selecaoDoPainel(lojas);
  if (sel && sel !== "all") return [sel];
  return [franchiseeId, ...lojas.map((l) => l.id).filter((id) => id !== franchiseeId)];
}

/**
 * As lojas cujas comandas este Assistente pode CONFIRMAR ("já imprimi").
 *
 * É o grupo inteiro (com a opção ligada) e não só o que a seleção atende agora:
 * o painel pode trocar de loja entre a fila entregar a comanda e o Assistente
 * confirmar. Recusar a confirmação faria a comanda voltar na fila e sair em
 * dobro quando "Todas" fosse selecionada de novo.
 */
export function lojasQueOPcConfirma(franchiseeId: string, grupo: LojaDoGrupo[] | null | undefined): string[] {
  const lojas = Array.isArray(grupo) ? grupo : [];
  if (!lojas.some((l) => l.id === franchiseeId) || lojas.length <= 1) return [franchiseeId];
  if (!lojas.some((l) => ligadoNaConfig(l.printerConfig))) return [franchiseeId];
  return [franchiseeId, ...lojas.map((l) => l.id).filter((id) => id !== franchiseeId)];
}
