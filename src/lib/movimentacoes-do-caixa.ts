/**
 * As entradas (reforço/suprimento) e retiradas (sangria) de um caixa JÁ
 * FECHADO, para quem confere depois: o Histórico de caixas e o PDF do
 * fechamento (api/cash-session/fechamento-pdf).
 *
 * Pedido do Victor na Pizzaria 17 (14/10/2026): as sangrias "não aparecem no
 * relatório". Elas já entravam no dinheiro esperado (lib/esperado-do-turno.ts)
 * e no papel do fechamento, mas o Histórico só mostrava o esperado pronto — e
 * uma retirada de R$ 200 escondida dentro do "Sistema" do dinheiro é
 * justamente o que a contabilidade pergunta.
 *
 * Só LÊ a tabela que o caixa aberto grava (api/cash-session/movimentacao).
 * Nenhuma conta nova: a régua do esperado continua sendo a do fechamento.
 */
import { prisma } from "@/lib/prisma";
import { temEstruturaDeCaixa } from "@/lib/garantir-colunas";
import { resumoDasMovimentacoes, type MovimentoDoCaixa } from "@/lib/resumo-das-movimentacoes";
import { lancadoDepoisDoFechamento } from "@/lib/lancamento-tardio-do-caixa";

export { resumoDasMovimentacoes, type MovimentoDoCaixa };

/**
 * As movimentações dos caixas pedidos, por caixa, na ordem em que aconteceram.
 *
 * `null` quando a tabela não existe (boot que não conseguiu criar) ou a
 * consulta falhou: a tela some com o bloco em vez de dizer "nenhuma" — dizer
 * que não houve sangria sem ter conseguido olhar seria mentir.
 *
 * Uma consulta para todos os caixas (o Histórico lista 60) e uma para os nomes.
 * O `closedAt` de cada caixa marca o que foi lançado depois do fechamento.
 */
export async function movimentacoesDosCaixas(
  lojaId: string,
  caixasComFechamento: { id: string; closedAt: Date | null }[],
): Promise<Map<string, MovimentoDoCaixa[]> | null> {
  const porCaixa = new Map<string, MovimentoDoCaixa[]>();
  if (caixasComFechamento.length === 0) return porCaixa;
  const caixas = caixasComFechamento.map((c) => c.id);
  const fechadoEm = new Map(caixasComFechamento.map((c) => [c.id, c.closedAt]));
  try {
    if (!(await temEstruturaDeCaixa())) return null;
    const movs = await prisma.cashMovement.findMany({
      // O franchiseeId no WHERE: o id do caixa sozinho não prova que é desta loja.
      where: { cashSessionId: { in: caixas }, franchiseeId: lojaId },
      select: { id: true, cashSessionId: true, tipo: true, valor: true, descricao: true, criadoPor: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });

    // `criadoPor` é o e-mail de quem lançou. Na tela, o nome — mas só de quem
    // é DESTA loja (o dono ou a equipe dele). O suporte do FireHub entrando
    // como a loja fica com o e-mail, que é o que foi gravado.
    const emails = [...new Set(movs.map((m) => m.criadoPor).filter((e): e is string => !!e))];
    const nomes = new Map<string, string>();
    if (emails.length > 0) {
      const gente = await prisma.user.findMany({
        where: { email: { in: emails }, OR: [{ id: lojaId }, { ownerId: lojaId }] },
        select: { email: true, name: true },
      });
      for (const g of gente) if (g.email && g.name?.trim()) nomes.set(g.email, g.name.trim());
    }

    for (const m of movs) {
      const lista = porCaixa.get(m.cashSessionId) || [];
      lista.push({
        id: m.id,
        // O mesmo critério do esperado: o que não é ENTRADA sai da gaveta.
        tipo: m.tipo === "ENTRADA" ? "ENTRADA" : "SAIDA",
        valor: Number(m.valor) || 0,
        descricao: m.descricao?.trim() || null,
        quem: m.criadoPor ? nomes.get(m.criadoPor) || m.criadoPor : null,
        em: m.createdAt,
        depoisDoFechamento: lancadoDepoisDoFechamento(m.createdAt, fechadoEm.get(m.cashSessionId)),
      });
      porCaixa.set(m.cashSessionId, lista);
    }
    return porCaixa;
  } catch (e: any) {
    console.warn("[Caixa] Entradas e retiradas não carregadas:", e?.message);
    return null;
  }
}
