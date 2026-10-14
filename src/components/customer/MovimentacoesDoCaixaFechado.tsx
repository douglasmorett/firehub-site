import { composicaoDoDinheiroEsperado, resumoDasMovimentacoes, type MovimentoDoCaixa } from "@/lib/resumo-das-movimentacoes";

/**
 * "Entradas e retiradas do caixa" no Histórico de caixas: sangria por
 * sangria, reforço por reforço, com hora, motivo e quem lançou.
 *
 * Pedido do Victor na Pizzaria 17 (14/10/2026): as retiradas já entravam no
 * dinheiro esperado, mas ninguém via QUAIS — o "Sistema" do dinheiro vinha
 * pronto, e a sangria de R$ 200 para pagar o gás sumia dentro dele.
 *
 * Componente de servidor: não tem estado, só mostra o que a página leu
 * (lib/movimentacoes-do-caixa.ts). `movimentos` nulo = não deu para ler a
 * tabela, e aí o bloco não aparece (dizer "nenhuma" sem ter olhado é mentir).
 */
const fmt = (v: number) => `${v < -0.004 ? "−" : ""}R$ ${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function MovimentacoesDoCaixaFechado({
  movimentos,
  esperadoEmDinheiro,
  trocoInicial,
  fuso,
}: {
  movimentos: MovimentoDoCaixa[] | null;
  esperadoEmDinheiro: number;
  trocoInicial: number;
  fuso: string | null | undefined;
}) {
  if (!movimentos) return null;
  const resumo = resumoDasMovimentacoes(movimentos);
  const { vendasEmDinheiro } = composicaoDoDinheiroEsperado(esperadoEmDinheiro, trocoInicial, resumo);
  // Dia e hora: o turno da noite atravessa a meia-noite.
  const quando = (d: Date) =>
    new Date(d).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: fuso || "America/Sao_Paulo" });

  // A regra do esperado, escrita: quem lê a tabela acima precisa saber que o
  // "Sistema" do dinheiro já desconta a sangria — senão soma de novo e acha falta.
  const regra = (
    <div style={{ marginTop: 6, fontSize: "0.72rem", color: "#64748B", lineHeight: 1.5 }}>
      {vendasEmDinheiro != null ? (
        <>
          Dinheiro esperado <strong>{fmt(esperadoEmDinheiro)}</strong> = troco inicial {fmt(trocoInicial)} + vendas em dinheiro {fmt(vendasEmDinheiro)}
          {" "}+ entradas {fmt(resumo.entradas.valor)} − retiradas {fmt(resumo.retiradas.valor)}
        </>
      ) : (
        <>Dinheiro esperado = troco inicial + vendas em dinheiro + entradas − retiradas</>
      )}
    </div>
  );

  if (movimentos.length === 0) {
    return (
      <div style={{ padding: "8px 16px", borderTop: "1px solid #F1F5F9" }}>
        <div style={{ fontSize: "0.75rem", color: "#94A3B8" }}>Nenhuma entrada ou retirada neste caixa.</div>
        {regra}
      </div>
    );
  }

  return (
    <div style={{ padding: "10px 16px", borderTop: "1px solid #F1F5F9" }}>
      <div style={{ fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.06em", color: "#64748B", textTransform: "uppercase", marginBottom: 6 }}>
        Entradas e retiradas do caixa
      </div>
      {movimentos.map((m) => {
        const entrada = m.tipo === "ENTRADA";
        return (
          <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, padding: "5px 0", borderBottom: "1px dashed #F1F5F9", fontSize: "0.8rem" }}>
            <span style={{ minWidth: 0, color: "#334155" }}>
              <span style={{ color: "#64748B", fontVariantNumeric: "tabular-nums" }}>{quando(m.em)}</span>
              {" · "}
              <strong>{entrada ? "Entrada (suprimento)" : "Retirada (sangria)"}</strong>
              <span style={{ display: "block", fontSize: "0.72rem", color: "#64748B" }}>
                {m.descricao || "sem motivo informado"}
                {m.quem ? ` • por ${m.quem}` : ""}
              </span>
            </span>
            <span style={{ whiteSpace: "nowrap", fontWeight: 800, fontVariantNumeric: "tabular-nums", color: entrada ? "#0F766E" : "#C92E09" }}>
              {entrada ? "+" : "−"}{fmt(m.valor)}
            </span>
          </div>
        );
      })}
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "4px 16px", marginTop: 6, fontSize: "0.78rem", fontWeight: 700, color: "#334155" }}>
        <span>Entradas ({resumo.entradas.qtd}): <span style={{ color: "#0F766E" }}>+{fmt(resumo.entradas.valor)}</span></span>
        <span>Retiradas ({resumo.retiradas.qtd}): <span style={{ color: "#C92E09" }}>−{fmt(resumo.retiradas.valor)}</span></span>
      </div>
      {regra}
    </div>
  );
}
