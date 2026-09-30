import { prisma } from "@/lib/prisma";

/**
 * O DESEMPENHO DE CADA VENDEDOR NO PERÍODO — o que o placar da aba
 * Vendedores ganhou com o CRM. Tudo medido pelo que ficou gravado (mensagens
 * que ele mandou pelo número do FireHub, reuniões da agenda, cadastros), não
 * pelo que ele marcou à mão.
 *
 * - recebidos: contatos que passaram para ele no período;
 * - esperando: contatos dele que ainda não receberam a primeira mensagem dele
 *   (agora, não no período — é a fila do dia);
 * - tempo até o primeiro contato: média, em minutos, entre receber e responder;
 * - demonstrações: marcadas no período, e das que aconteceram no período,
 *   quantas foram feitas e quantas o lead não apareceu;
 * - cadastros: lojas da carteira dele criadas no período (virou teste grátis);
 * - clientes / perdidos: contatos dele que mudaram para essas etapas no período.
 */
export type DesempenhoDoVendedor = {
  vendedorId: string;
  nome: string;
  ativo: boolean;
  recebidos: number;
  esperando: number;
  tempoAtePrimeiroContatoMin: number | null;
  mensagens: number;
  conversas: number;
  demosMarcadas: number;
  demosFeitas: number;
  demosFaltou: number;
  cadastros: number;
  clientes: number;
  perdidos: number;
  proximasDemos: number;
};

export async function desempenhoDaEquipe(de: Date, ate: Date): Promise<DesempenhoDoVendedor[]> {
  const equipe = await prisma.ambassador.findMany({
    where: { isVendedor: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, active: true },
  });
  const ids = equipe.map((v) => v.id);
  if (ids.length === 0) return [];

  const [recebidos, esperando, comPrimeiro, mensagens, marcadas, aconteceram, cadastros, etapas, proximas] = await Promise.all([
    prisma.crmContato.groupBy({ by: ["vendedorId"], where: { vendedorId: { in: ids }, vendedorAtribuidoEm: { gte: de, lt: ate } }, _count: { _all: true } }),
    prisma.crmContato.groupBy({
      by: ["vendedorId"],
      where: { vendedorId: { in: ids }, primeiroContatoEm: null, etapa: { notIn: ["CLIENTE", "PERDIDO"] } },
      _count: { _all: true },
    }),
    prisma.crmContato.findMany({
      where: { vendedorId: { in: ids }, primeiroContatoEm: { gte: de, lt: ate }, vendedorAtribuidoEm: { not: null } },
      select: { vendedorId: true, primeiroContatoEm: true, vendedorAtribuidoEm: true },
    }),
    prisma.crmMensagem.findMany({
      where: { autor: "VENDEDOR", autorId: { in: ids }, criadoEm: { gte: de, lt: ate }, status: "OK" },
      select: { autorId: true, contatoId: true },
    }),
    prisma.agendaReuniao.groupBy({
      by: ["vendedorId"],
      where: { vendedorId: { in: ids }, tipo: "DEMONSTRACAO", criadoEm: { gte: de, lt: ate }, status: { not: "CANCELADA" } },
      _count: { _all: true },
    }),
    prisma.agendaReuniao.findMany({
      where: { vendedorId: { in: ids }, tipo: "DEMONSTRACAO", inicio: { gte: de, lt: ate }, status: { in: ["REALIZADA", "FALTOU"] } },
      select: { vendedorId: true, status: true },
    }),
    prisma.user.groupBy({ by: ["vendedorId"], where: { vendedorId: { in: ids }, createdAt: { gte: de, lt: ate } }, _count: { _all: true } }),
    prisma.crmEvento.findMany({
      where: { tipo: "ETAPA", criadoEm: { gte: de, lt: ate }, contato: { vendedorId: { in: ids } } },
      select: { dados: true, contato: { select: { vendedorId: true } } },
    }),
    prisma.agendaReuniao.groupBy({
      by: ["vendedorId"],
      where: { vendedorId: { in: ids }, tipo: "DEMONSTRACAO", inicio: { gte: new Date() }, status: "MARCADA" },
      _count: { _all: true },
    }),
  ]);

  const contar = (lista: { vendedorId: string | null; _count: { _all: number } }[], id: string) =>
    lista.find((l) => l.vendedorId === id)?._count._all || 0;

  return equipe.map((v) => {
    const tempos = comPrimeiro
      .filter((c) => c.vendedorId === v.id)
      .map((c) => (c.primeiroContatoEm!.getTime() - c.vendedorAtribuidoEm!.getTime()) / 60_000)
      .filter((m) => m >= 0);
    const minhas = mensagens.filter((m) => m.autorId === v.id);
    const minhasEtapas = etapas.filter((e) => e.contato.vendedorId === v.id).map((e) => (e.dados as any)?.para);
    return {
      vendedorId: v.id,
      nome: v.name,
      ativo: v.active,
      recebidos: contar(recebidos, v.id),
      esperando: contar(esperando, v.id),
      tempoAtePrimeiroContatoMin: tempos.length ? Math.round(tempos.reduce((s, t) => s + t, 0) / tempos.length) : null,
      mensagens: minhas.length,
      conversas: new Set(minhas.map((m) => m.contatoId)).size,
      demosMarcadas: contar(marcadas, v.id),
      demosFeitas: aconteceram.filter((r) => r.vendedorId === v.id && r.status === "REALIZADA").length,
      demosFaltou: aconteceram.filter((r) => r.vendedorId === v.id && r.status === "FALTOU").length,
      cadastros: contar(cadastros as any, v.id),
      clientes: minhasEtapas.filter((p) => p === "CLIENTE").length,
      perdidos: minhasEtapas.filter((p) => p === "PERDIDO").length,
      proximasDemos: contar(proximas, v.id),
    };
  });
}
