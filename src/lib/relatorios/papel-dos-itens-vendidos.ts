/**
 * O "Itens vendidos" num papel de bobina, para a contagem do fim da noite.
 *
 * O botão Imprimir dos relatórios é o do navegador (window.print) e vai para a
 * impressora PADRÃO do Windows — que no PC do caixa costuma ser a térmica. A
 * página feita para A4 sai na bobina como uma fita de metros, e a impressora
 * "dispara sem parar" (Vânia/Pizzaria Bom Cheff, 05/11/2026: toda vez que tirava
 * o relatório das pizzas vendidas).
 *
 * Este papel viaja pela fila do caixa (lib/imprimir-caixa.ts): kind começando
 * com "CAIXA_" e `relatorio` em linhas, que o Assistente 1.2.19+ já imprime
 * como relatório, na impressora do caixa — sem instalador novo. Assistente mais
 * antigo imprime `items` (os produtos) no formato de pedido.
 *
 * Sai a árvore inteira da tela, com os mesmos filtros e agrupamentos:
 * categoria, produto e, dentro dele, as opções (meia pizza conta 0,5).
 */
import { montar, reais, type LinhaDoCaixa, type LinhaDoRelatorio } from "@/lib/cupom-do-caixa";
import { fmtDia, fmtQtd } from "@/lib/relatorios/base";
import type { NoDoRelatorio } from "@/lib/relatorios/itens-vendidos";

export type DadosDosItensVendidos = {
  periodo: { de: string; ate: string; horaDe?: string | null; horaAte?: string | null };
  itens: NoDoRelatorio[];
  opcoes: NoDoRelatorio[] | null;
  total: { quantidade: number; valor: number };
};

export function papelDosItensVendidos(
  dados: DadosDosItensVendidos,
  cabecalho: { loja: string; dataHora: string; operador: string },
) {
  const L: LinhaDoRelatorio[] = [];
  const p = dados.periodo;
  const dias = p.de === p.ate ? fmtDia(p.de) : `${fmtDia(p.de)} a ${fmtDia(p.ate)}`;
  L.push({ tipo: "linha", texto: "Periodo", valor: dias });
  if (p.horaDe || p.horaAte) L.push({ tipo: "linha", texto: "Horario", valor: `${p.horaDe || "00:00"} a ${p.horaAte || "24:00"}` });

  // Categoria vira título de bloco; produto e opção, linha com a quantidade na
  // frente (é o que se confere) e o valor à direita. O Assistente tira espaço
  // do começo da linha, então a opção leva um "- " em vez de recuo; e sabor
  // sem preço próprio não imprime "R$ 0,00".
  const descer = (nos: NoDoRelatorio[]) => {
    for (const n of nos) {
      if (n.tipo === "categoria") {
        L.push({ tipo: "titulo", texto: `${n.nome} (${fmtQtd(n.quantidade)})` });
      } else if (n.tipo === "grupo") {
        L.push({ tipo: "texto", texto: `${n.nome}:` });
      } else {
        const valor = n.valor != null && (n.tipo === "produto" || Math.abs(n.valor) >= 0.005) ? reais(n.valor) : "";
        L.push({ tipo: "linha", texto: `${n.tipo === "opcao" ? "- " : ""}${fmtQtd(n.quantidade)}x ${n.nome}`, valor });
      }
      if (n.filhos?.length) descer(n.filhos);
    }
  };
  descer(dados.itens);
  if (dados.itens.length === 0) L.push({ tipo: "texto", texto: "Nenhum item vendido no periodo e filtros escolhidos." });
  L.push({ tipo: "separador" });
  L.push({ tipo: "destaque", texto: `TOTAL ${fmtQtd(dados.total.quantidade)} itens`, valor: reais(dados.total.valor) });

  if (dados.opcoes?.length) {
    L.push({ tipo: "titulo", texto: "Opcoes escolhidas" });
    descer(dados.opcoes);
  }
  L.push({ tipo: "texto", texto: "Meia pizza conta 0,5 de cada sabor. Cancelados nao entram." });

  // Para o Assistente < 1.2.19, que não lê `relatorio`: os produtos.
  const items: LinhaDoCaixa[] = [];
  const produtos = (nos: NoDoRelatorio[]) => {
    for (const n of nos) {
      if (n.tipo === "produto") items.push({ name: n.nome, qty: n.quantidade, price: n.valor ?? 0 });
      else if (n.tipo === "categoria" && n.filhos) produtos(n.filhos);
    }
  };
  produtos(dados.itens);

  return montar({
    id: `caixa_itens_vendidos_${Date.now()}`,
    kind: "CAIXA_ITENS_VENDIDOS",
    titulo: "ITENS VENDIDOS",
    cabecalho,
    items,
    total: dados.total.valor,
    rodape: "",
    relatorio: L,
  });
}
