/**
 * A PROJEÇÃO DO MÊS DE UM PARCEIRO — pedido do Douglas (12/11/2026): "ver a
 * projeção do mês para eles também, igual eu vejo pra mim no total".
 *
 * Não é conta nova: é a projeção do admin (lib/projecao-do-mes.ts,
 * montarProjecao — o boleto previsto de cada loja e a chance de pagar)
 * RECORTADA nas lojas do relatório do parceiro (lib/parceiro/relatorio.ts:
 * papelNaLoja decide quais lojas são dele e o % de cada uma). A comissão é a
 * do "mês atual" do portal (comissaoSobre) sobre o boleto projetado, e só
 * conta onde o repasse cai (o mesmo `cai` de resumirLojas).
 *
 * Função pura: o portal (/vendedor, /embaixador), o relatório do admin
 * (/admin/parceiros/[id]) e a aba Vendedores chamam; scripts/teste-projecao-do-parceiro.ts confere.
 */
import type { LinhaDaProjecao } from "@/lib/projecao-do-mes";
import { totaisDaProjecao } from "@/lib/projecao-do-mes-regras";
import { comissaoSobre, type LojaDoRelatorio } from "@/lib/parceiro/regras";

type Totais = ReturnType<typeof totaisDaProjecao>;

export type LinhaDaProjecaoDoParceiro = {
  id: string;
  loja: string;
  situacao: LinhaDaProjecao["situacao"];
  testeAte: string | null;
  vendidoNoMes: number;
  /** O boleto projetado da loja (mensalidade + lojas extras + taxas). */
  total: number;
  chance: number;
  porque: string;
  percentual: number;
  /** A comissão dele se o boleto for pago (0 quando o repasse não cai). */
  comissao: number;
  repasseCai: boolean;
};

export type ProjecaoDoParceiro = {
  mes: string;
  geradoEm: string;
  /** Lojas dele no relatório (carteira + indicação). */
  lojas: number;
  /** Delas, as que têm boleto previsto no mês. */
  boletos: number;
  /** O que as lojas com boleto previsto já venderam no mês. */
  vendidoNoMes: number;
  /** A mensalidade da FireHub nessas lojas: garantido, aposta (pela chance) e se todas pagarem. */
  mensalidade: Totais;
  /** A comissão dele sobre esses boletos, nas mesmas três contas. */
  comissao: Totais;
  /** O que a conta daria nas lojas em que o repasse não cai (sem carteira, teto…), se todas pagarem. */
  semRepasse: number;
  linhas: LinhaDaProjecaoDoParceiro[];
};

const redondo = (v: number) => Math.round(v * 100) / 100;

export function recortarProjecao(
  projecao: { mes: string; geradoEm: string; linhas: LinhaDaProjecao[] },
  lojasDoParceiro: Pick<LojaDoRelatorio, "id" | "percentual" | "repasse">[],
): ProjecaoDoParceiro {
  const dele = new Map(lojasDoParceiro.map((l) => [l.id, l]));
  let semRepasse = 0;
  const linhas: LinhaDaProjecaoDoParceiro[] = [];
  for (const x of projecao.linhas) {
    const l = dele.get(x.id);
    if (!l) continue;
    const repasseCai = l.repasse === "CAI";
    const daria = comissaoSobre(x.total, l.percentual);
    if (!repasseCai) semRepasse += daria;
    linhas.push({
      id: x.id, loja: x.loja, situacao: x.situacao, testeAte: x.testeAte, vendidoNoMes: x.vendidoNoMes,
      total: x.total, chance: x.chance, porque: x.porque, percentual: l.percentual,
      comissao: repasseCai ? daria : 0, repasseCai,
    });
  }
  return {
    mes: projecao.mes,
    geradoEm: projecao.geradoEm,
    lojas: lojasDoParceiro.length,
    boletos: linhas.length,
    vendidoNoMes: redondo(linhas.reduce((s, l) => s + l.vendidoNoMes, 0)),
    mensalidade: totaisDaProjecao(linhas),
    comissao: totaisDaProjecao(linhas.map((l) => ({ total: l.comissao, chance: l.chance }))),
    semRepasse: redondo(semRepasse),
    linhas,
  };
}
