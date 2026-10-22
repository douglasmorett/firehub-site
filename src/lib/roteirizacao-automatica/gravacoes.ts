/**
 * Rota 100% automatizada — o que GRAVAR a partir do que o planejador decidiu.
 *
 * Puro (sem banco) de propósito: é a tradução de `Acao[]` (planejador.ts) em
 * passos de gravação, e é ela que o teste confere
 * (scripts/teste-roteirizacao-automatica.ts). Quem executa os passos no banco
 * é executar.ts, com as travas de SQL por cima destas (pedido sem motoboy,
 * rota AUTO ainda PENDING).
 *
 * As regras que moram aqui (Fase 1 do plano, vault "FireHub - Plano despacho
 * automático"):
 *   - só se mexe em rota AUTO aberta LIDA neste ciclo. Ação para rota que não
 *     está na lista (a manual, a de outra loja, a que já saiu) é ignorada —
 *     D4/D8: a rota montada à mão é da loja;
 *   - "acrescentar" traz a rota inteira na ordem nova (`ordem`): a sequência
 *     de TODAS as paradas é regravada, uma vez por rota, com a última ordem do
 *     ciclo (duas entradas na mesma rota = duas ações, uma sequência);
 *   - "apagar-rota" só quando a rota ficou vazia depois das saídas do ciclo;
 *   - "chamar" ainda não é gravada: é a Fase 2 (avisar o motoboy). Volta como
 *     pendente, para o resumo mostrar.
 *
 * SEM IMPORTS de valor (só tipos): o teste carrega sem banco.
 */
import type { Acao } from "./planejador";

/** Uma rota AUTO aberta como foi lida no ciclo: o id e os pedidos dela. */
export type RotaLida = { id: string; pedidoIds: string[] };

export type Passo =
  /** Rota nova sem motoboy (D7), pedidos na ordem das paradas: `routeSequence` = posição + 1. */
  | { tipo: "criar-rota"; pedidoIds: string[] }
  /** O pedido entra na rota (routeId + prioridade no KDS). */
  | { tipo: "entrar-na-rota"; rotaId: string; pedidoId: string }
  /** O pedido sai: routeId, prioridade e sequência zerados. */
  | { tipo: "sair-da-rota"; rotaId: string; pedidoId: string; motivo: "cancelado" | "espera-estourada" }
  /** A ordem inteira da rota: `routeSequence` = posição + 1, de cada pedido. */
  | { tipo: "sequencia"; rotaId: string; pedidoIds: string[] }
  | { tipo: "apagar-rota"; rotaId: string };

export type AcaoIgnorada = { acao: Acao; motivo: "rota-desconhecida" | "rota-com-pedido" | "pedido-repetido" | "fora-da-rota" | "vazia" };

export type Gravacoes = {
  passos: Passo[];
  /** Decididas mas não gravadas nesta fase ("chamar" — Fase 2). */
  pendentes: Acao[];
  ignoradas: AcaoIgnorada[];
};

export function gravacoesDasAcoes(acoes: Acao[], rotasLidas: RotaLida[]): Gravacoes {
  const passos: Passo[] = [];
  const pendentes: Acao[] = [];
  const ignoradas: AcaoIgnorada[] = [];

  // Quem está em cada rota, andando junto com as ações (sair tira, entrar põe).
  const membros = new Map(rotasLidas.map((r) => [r.id, new Set(r.pedidoIds)]));
  // Pedido que já ganhou rota neste ciclo não ganha outra (o planejador não
  // repete, mas uma rota duplicada no banco é pior que uma ação perdida).
  const jaColocados = new Set<string>();
  // A última ordem de cada rota que cresceu, na ordem em que as rotas cresceram.
  const ordemFinal = new Map<string, string[]>();

  for (const a of acoes) {
    switch (a.tipo) {
      case "criar-rota": {
        const pedidoIds = a.pedidos.filter((id, i) => !jaColocados.has(id) && a.pedidos.indexOf(id) === i);
        if (pedidoIds.length === 0) { ignoradas.push({ acao: a, motivo: a.pedidos.length === 0 ? "vazia" : "pedido-repetido" }); break; }
        for (const id of pedidoIds) jaColocados.add(id);
        passos.push({ tipo: "criar-rota", pedidoIds });
        break;
      }
      case "acrescentar": {
        const naRota = membros.get(a.rotaId);
        if (!naRota) { ignoradas.push({ acao: a, motivo: "rota-desconhecida" }); break; }
        if (jaColocados.has(a.pedidoId) || naRota.has(a.pedidoId)) { ignoradas.push({ acao: a, motivo: "pedido-repetido" }); break; }
        jaColocados.add(a.pedidoId);
        naRota.add(a.pedidoId);
        passos.push({ tipo: "entrar-na-rota", rotaId: a.rotaId, pedidoId: a.pedidoId });
        // Só quem está na rota entra na sequência (a ordem do planejador é a
        // rota inteira; um id estranho nela não vira parada).
        ordemFinal.delete(a.rotaId);
        ordemFinal.set(a.rotaId, a.ordem.filter((id) => naRota.has(id)));
        break;
      }
      case "tirar-da-rota": {
        const naRota = membros.get(a.rotaId);
        if (!naRota) { ignoradas.push({ acao: a, motivo: "rota-desconhecida" }); break; }
        if (!naRota.has(a.pedidoId)) { ignoradas.push({ acao: a, motivo: "fora-da-rota" }); break; }
        naRota.delete(a.pedidoId);
        passos.push({ tipo: "sair-da-rota", rotaId: a.rotaId, pedidoId: a.pedidoId, motivo: a.motivo });
        const ordem = ordemFinal.get(a.rotaId);
        if (ordem) ordemFinal.set(a.rotaId, ordem.filter((id) => id !== a.pedidoId));
        break;
      }
      case "apagar-rota": {
        const naRota = membros.get(a.rotaId);
        if (!naRota) { ignoradas.push({ acao: a, motivo: "rota-desconhecida" }); break; }
        if (naRota.size > 0) { ignoradas.push({ acao: a, motivo: "rota-com-pedido" }); break; }
        membros.delete(a.rotaId);
        ordemFinal.delete(a.rotaId);
        passos.push({ tipo: "apagar-rota", rotaId: a.rotaId });
        break;
      }
      case "chamar": {
        // Fase 2: chamadaEm/chamadaMotoboyId + push ROTA_PRONTA.
        if (!membros.has(a.rotaId)) { ignoradas.push({ acao: a, motivo: "rota-desconhecida" }); break; }
        pendentes.push(a);
        break;
      }
    }
  }

  // A sequência vai por último: depois de todas as entradas e saídas do ciclo.
  for (const [rotaId, pedidoIds] of ordemFinal) {
    if (pedidoIds.length > 0) passos.push({ tipo: "sequencia", rotaId, pedidoIds });
  }

  return { passos, pendentes, ignoradas };
}
