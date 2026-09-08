import type { Metadata } from "next";
import KanbanDeDemonstracao from "./KanbanDeDemonstracao";

export const metadata: Metadata = {
  title: "Painel de demonstração — FireHub Prazos",
  description: "Um painel de pedidos de mentira para testar a extensão FireHub Prazos sem precisar de loja.",
  robots: { index: false, follow: false },
};

/**
 * /prazos/demo — um kanban de mentira, público.
 *
 * Existe por dois motivos práticos:
 *   1. a revisão da Chrome Web Store reprova por "funcionalidade não
 *      demonstrável" quando o revisor não consegue ver o produto trabalhando;
 *      ele não tem loja no iFood, mas nesta página ele marca uma coluna e vê
 *      a extensão contar;
 *   2. quem está pensando em assinar testa a marcação antes de pagar.
 *
 * As colunas têm cabeçalho com contador, que é exatamente o que o leitor da
 * extensão procura em um painel de verdade.
 */
export default function DemoPage() {
  return <KanbanDeDemonstracao />;
}
