/**
 * O VOLTAR do celular fechando a tela de cima, não o módulo inteiro.
 *
 * ── O problema ──────────────────────────────────────────────────────────────
 *
 * A tela de mesas troca de "tela" só no estado do React (mapa → mesa → cardápio
 * → carrinho). O navegador não sabia de nada disso: o garçom no Android fazia o
 * gesto de voltar esperando sair do cardápio e saía do sistema — e o pedido que
 * estava montando ia junto.
 *
 * ── A regra ─────────────────────────────────────────────────────────────────
 *
 * Cada camada aberta ganha uma entrada no histórico (`pushState` com o id dela).
 * Quando o navegador volta, fecha tudo que foi aberto DEPOIS da entrada em que
 * ele parou. Quando a própria tela fecha uma camada (botão "← Mesa", enviar
 * pedido), a entrada dela precisa sumir do histórico também, senão o próximo
 * voltar "não faz nada". Se ela está no topo, a tela chama `history.back()`; se
 * não está (fechou duas de uma vez), a entrada fica SOLTA e é pulada quando o
 * navegador chegar nela.
 *
 * Este arquivo é só a conta, sem `window`: `useVoltarDoCelular` aplica.
 */

export type CamadaAberta = { id: number; nome: string };

export type EstadoDasCamadas = {
  /** Camadas abertas, da de baixo para a de cima (id crescente). */
  pilha: CamadaAberta[];
  /** Ids cuja camada a tela fechou sem consumir a entrada do histórico. */
  soltas: number[];
};

export const SEM_CAMADAS: EstadoDasCamadas = { pilha: [], soltas: [] };

export function abrirCamada(estado: EstadoDasCamadas, camada: CamadaAberta): EstadoDasCamadas {
  return { ...estado, pilha: [...estado.pilha.filter((c) => c.id !== camada.id), camada] };
}

/**
 * O navegador voltou (ou avançou) e parou na entrada `idNoHistorico` — nulo é a
 * entrada da própria página, anterior a qualquer camada.
 */
export function aoVoltarNoNavegador(estado: EstadoDasCamadas, idNoHistorico: number | null) {
  const limite = idNoHistorico ?? 0;
  // De cima para baixo: a tela de cima fecha antes da de baixo.
  const fechar = estado.pilha.filter((c) => c.id > limite).reverse();
  const pilha = estado.pilha.filter((c) => c.id <= limite);
  const pularOutraVez = idNoHistorico !== null && estado.soltas.includes(idNoHistorico);
  // Entrada solta além de onde o navegador parou não volta a ser alcançada
  // voltando; guardar só faria a lista crescer.
  const soltas = estado.soltas.filter((id) => id < limite);
  return { fechar, pularOutraVez, estado: { pilha, soltas } };
}

/**
 * A tela fechou a camada `id` por conta própria. `idNoHistorico` é o id da
 * entrada atual do navegador: sendo a dela, dá para consumir com `back()`.
 */
export function aoFecharPelaTela(estado: EstadoDasCamadas, id: number, idNoHistorico: number | null) {
  const aberta = estado.pilha.some((c) => c.id === id);
  const pilha = estado.pilha.filter((c) => c.id !== id);
  if (!aberta) return { voltarNoNavegador: false, estado: { ...estado, pilha } };
  const noTopoDoHistorico = idNoHistorico === id;
  return {
    voltarNoNavegador: noTopoDoHistorico,
    estado: { pilha, soltas: noTopoDoHistorico ? estado.soltas : [...estado.soltas, id] },
  };
}
