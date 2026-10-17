"use client";

/**
 * Relatório de mesas da loja — as mesas fechadas no período (consumo, taxa de
 * serviço, gorjeta e desconto no fechamento, total e por garçom) e as vendas
 * separadas por origem: balcão, mesa, delivery e retirada.
 *
 * Mora no módulo de garçons porque foi de lá que o dono pediu (17/09/2026):
 * "no módulo garçom ter a opção de relatório de mesas, informando quanto foi
 * arrecadado de taxa de serviço, total ou separado por garçom, e no relatório
 * tem que ter separado quanto vendeu balcão, mesa e delivery".
 *
 * A tela só desenha o que /api/store/mesas/relatorio devolve. Nenhuma conta
 * mora aqui (estão em lib/relatorios/relatorio-de-mesas.ts, pela régua única):
 * se a régua ou o dia operacional mudarem, mudam num lugar só, e a tela
 * continua certa. Nem o "hoje": "Hoje" e "Ontem" vão como atalho e o servidor
 * resolve no dia operacional da LOJA (vira às 5h) — às 2h da manhã, "Hoje"
 * ainda é o dia anterior, que é o turno que está aberto.
 */

import { Fragment, useEffect, useState } from "react";
import { ArrowLeft, Loader2, UtensilsCrossed, Store, Bike, ShoppingBag } from "lucide-react";
import { fmtDia, hojeNaLoja } from "@/lib/relatorios/base";
import { fusoDoNavegador } from "@/lib/relatorios/relatorio-de-mesas";

type LinhaDeOrigem = { valor: number; vendas: number; lancamentos: number };

type Relatorio = {
  periodo: { de: string; ate: string; hoje: string };
  mesas: {
    fechadas: number;
    consumo: number;
    taxaServico: number;
    gorjetas: number;
    descontoNoFechamento: number;
    mesasComDesconto: number;
    porGarcom: { waiterId: string | null; nome: string; mesas: number; taxaServico: number; gorjetas: number; consumo: number; desconto: number; mesasComDesconto: number }[];
  };
  vendas: {
    total: number;
    vendas: number;
    lancamentos: number;
    porOrigem: Record<"MESA" | "BALCAO" | "DELIVERY" | "RETIRADA", LinhaDeOrigem>;
    deliveryPorCanal: (LinhaDeOrigem & { canal: string })[];
  };
};

const fmt = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);
const fmtQtd = (n: number) => (n || 0).toLocaleString("pt-BR");

export default function RelatorioDeMesas({ onVoltar }: { onVoltar: () => void }) {
  const [filtro, setFiltro] = useState<"hoje" | "ontem" | "periodo">("hoje");
  // O dia OPERACIONAL (vira às 5h), não o do calendário: o `diaLocal()` de
  // antes, às 2h da manhã, já dava o dia seguinte — que nem tinha começado.
  const [de, setDe] = useState(() => hojeNaLoja(fusoDoNavegador()));
  const [ate, setAte] = useState(() => hojeNaLoja(fusoDoNavegador()));
  const [dados, setDados] = useState<Relatorio | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  // "Hoje" e "Ontem" são do dia operacional da LOJA: quem resolve é o servidor.
  const consulta = filtro === "periodo" ? `de=${de}&ate=${ate}` : `atalho=${filtro}`;

  useEffect(() => {
    let vivo = true;
    setCarregando(true);
    setErro("");
    fetch(`/api/store/mesas/relatorio?${consulta}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!vivo) return;
        if (!r.ok) { setErro(j?.error || "Não consegui carregar o relatório."); setDados(null); }
        else setDados(j);
      })
      .catch(() => vivo && setErro("Sem conexão. Tente de novo."))
      .finally(() => vivo && setCarregando(false));
    return () => { vivo = false; };
  }, [consulta]);

  const escolherFiltro = (chave: typeof filtro) => {
    // O "Período" abre no período que está na tela, já resolvido pelo servidor.
    if (chave === "periodo" && filtro !== "periodo" && dados?.periodo) {
      setDe(dados.periodo.de);
      setAte(dados.periodo.ate);
    }
    setFiltro(chave);
  };

  const origem = dados?.vendas.porOrigem;
  const total = dados?.vendas.total || 0;
  const pct = (v: number) => (total > 0 ? `${((v / total) * 100).toFixed(0)}%` : "—");
  const desconto = dados?.mesas.descontoNoFechamento || 0;
  const temDesconto = desconto > 0;
  const periodoNaTela = dados?.periodo
    ? dados.periodo.de === dados.periodo.ate ? fmtDia(dados.periodo.de) : `${fmtDia(dados.periodo.de)} a ${fmtDia(dados.periodo.ate)}`
    : "";

  // Pedido do Fabiano (Ragnar Burger, 06/10/2026), sobre ESTA tabela:
  // ticket médio e percentual de vendas por garçom.
  //
  // O ticket é por MESA FECHADA, não por pedido: a mesa é a unidade que o
  // garçom atende, e um pedido de mesa nasce "N/A" — quem guarda o dinheiro
  // é a sessão (lib/pagamentos-da-mesa.ts). Garçom sem mesa fechada no
  // período não vira divisão por zero.
  const ticket = (consumo: number, mesas: number) => (mesas > 0 ? fmt(consumo / mesas) : "—");

  // Percentual sobre o CONSUMO NAS MESAS do período, que é o total desta
  // tabela — não sobre o faturamento da loja, senão a coluna somaria menos
  // de 100% e ninguém entenderia por quê (delivery e balcão ficam de fora).
  const pctDoSalao = (v: number) => {
    const base = dados?.mesas.consumo || 0;
    return base > 0 ? `${((v / base) * 100).toFixed(1)}%` : "—";
  };

  const botaoFiltro = (chave: typeof filtro, rotulo: string) => (
    <button
      key={chave}
      onClick={() => escolherFiltro(chave)}
      style={{ padding: "8px 16px", borderRadius: 6, border: "none", background: filtro === chave ? "#fff" : "transparent", color: filtro === chave ? "#475569" : "#64748B", fontWeight: 700, cursor: "pointer", boxShadow: filtro === chave ? "0 2px 4px rgba(0,0,0,0.05)" : "none" }}
    >
      {rotulo}
    </button>
  );

  const colunasPorGarcom = temDesconto ? 8 : 7;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <button onClick={onVoltar} style={{ background: "#F1F5F9", border: "none", padding: 10, borderRadius: 8, cursor: "pointer", display: "flex" }}>
          <ArrowLeft size={20} color="#475569" />
        </button>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: "#1E293B", display: "flex", alignItems: "center", gap: 10 }}>
          <UtensilsCrossed size={26} color="#475569" /> Relatório de Mesas
        </h1>
      </div>

      {/* ── Período ── */}
      <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #E2E8F0", padding: 24, marginBottom: 24 }}>
        <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginBottom: 20 }}>
          <div style={{ display: "flex", gap: 8, background: "#F8FAFC", padding: 4, borderRadius: 10, border: "1px solid #E2E8F0" }}>
            {botaoFiltro("hoje", "Hoje")}
            {botaoFiltro("ontem", "Ontem")}
            {botaoFiltro("periodo", "Período")}
          </div>
          {filtro === "periodo" && (
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <input type="date" value={de} onChange={(e) => setDe(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #E2E8F0", fontFamily: "inherit", color: "#1E293B" }} />
              <span style={{ color: "#94A3B8" }}>até</span>
              <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #E2E8F0", fontFamily: "inherit", color: "#1E293B" }} />
            </div>
          )}
          <span style={{ marginLeft: "auto", fontSize: 12, color: "#94A3B8", textAlign: "right" }}>
            {/* O período que o servidor resolveu: às 2h, "Hoje" mostra a data de ontem — o turno aberto. */}
            {!carregando && periodoNaTela && <strong style={{ color: "#475569" }}>{periodoNaTela} · </strong>}
            O dia vira às 5h da manhã: mesa fechada de madrugada conta no dia anterior.
          </span>
        </div>

        {erro && (
          <div role="alert" style={{ background: "#FEF2F2", color: "#B71C1C", border: "1px solid #FECACA", borderRadius: 10, padding: "10px 12px", fontSize: 13, fontWeight: 600, marginBottom: 14 }}>
            {erro}
          </div>
        )}

        {/* ── Números das mesas fechadas ── */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
          <div style={{ background: "#FAF6F2", padding: 20, borderRadius: 12, border: "1px solid #E0D4FF" }}>
            <div style={{ fontSize: 13, color: "#334155", fontWeight: 700, marginBottom: 4 }}>Mesas fechadas</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: "#0F172A" }}>{carregando ? "…" : dados?.mesas.fechadas ?? 0}</div>
          </div>
          <div style={{ background: "#F8FAFC", padding: 20, borderRadius: 12, border: "1px solid #E2E8F0" }}>
            <div style={{ fontSize: 13, color: "#475569", fontWeight: 700, marginBottom: 4 }}>Consumo nas mesas</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#1E293B" }}>{carregando ? "…" : fmt(dados?.mesas.consumo || 0)}</div>
            <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4 }}>O lançado nas contas, sem taxa, gorjeta e troco</div>
          </div>
          <div style={{ background: "#F0FDFA", padding: 20, borderRadius: 12, border: "1px solid #99F6E4" }}>
            <div style={{ fontSize: 13, color: "#0F766E", fontWeight: 900, marginBottom: 4 }}>Taxa de serviço arrecadada</div>
            <div style={{ fontSize: 28, fontWeight: 900, color: "#134E4A" }}>{carregando ? "…" : fmt(dados?.mesas.taxaServico || 0)}</div>
          </div>
          <div style={{ background: "#F8FAFC", padding: 20, borderRadius: 12, border: "1px solid #E2E8F0" }}>
            <div style={{ fontSize: 13, color: "#475569", fontWeight: 700, marginBottom: 4 }}>Gorjetas extras</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#1E293B" }}>{carregando ? "…" : fmt(dados?.mesas.gorjetas || 0)}</div>
          </div>
          {/* O desconto dado ao fechar a conta, À PARTE: não sai do consumo
              (régua única). Só aparece quando houve. */}
          {!carregando && temDesconto && (
            <div style={{ background: "#FFF7ED", padding: 20, borderRadius: 12, border: "1px solid #FED7AA" }}>
              <div style={{ fontSize: 13, color: "#9A3412", fontWeight: 700, marginBottom: 4 }}>Desconto no fechamento</div>
              <div style={{ fontSize: 24, fontWeight: 900, color: "#7C2D12" }}>{fmt(desconto)}</div>
              <div style={{ fontSize: 11, color: "#9A3412", marginTop: 4 }}>
                Em {fmtQtd(dados!.mesas.mesasComDesconto)} {dados!.mesas.mesasComDesconto === 1 ? "conta" : "contas"} · à parte, não sai do consumo
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Taxa de serviço por garçom ── */}
      <h3 style={{ fontSize: 18, fontWeight: 800, color: "#1E293B", marginBottom: 12 }}>Taxa de serviço por garçom</h3>
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden", marginBottom: 28 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#F8FAFC", borderBottom: "2px solid #E2E8F0", textAlign: "left" }}>
              <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Garçom</th>
              <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13, textAlign: "right" }}>Mesas</th>
              <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13, textAlign: "right" }}>Consumo</th>
              <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13, textAlign: "right" }}>Ticket médio</th>
              <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13, textAlign: "right" }}>% do consumo</th>
              {temDesconto && <th style={{ padding: "14px 16px", color: "#9A3412", fontWeight: 700, fontSize: 13, textAlign: "right" }}>Desconto</th>}
              <th style={{ padding: "14px 16px", color: "#1E293B", fontWeight: 800, fontSize: 13, textAlign: "right" }}>Taxa de serviço</th>
              <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13, textAlign: "right" }}>Gorjetas</th>
            </tr>
          </thead>
          <tbody>
            {carregando ? (
              <tr><td colSpan={colunasPorGarcom} style={{ padding: 40, textAlign: "center" }}><Loader2 className="animate-spin mx-auto text-slate-400" size={32} /></td></tr>
            ) : !dados || dados.mesas.porGarcom.length === 0 ? (
              <tr><td colSpan={colunasPorGarcom} style={{ padding: 40, textAlign: "center", color: "#94A3B8" }}>Nenhuma mesa fechada no período.</td></tr>
            ) : (
              <>
                {dados.mesas.porGarcom.map((g) => (
                  <tr key={g.waiterId || "__sem__"} style={{ borderBottom: "1px solid #E2E8F0" }}>
                    <td style={{ padding: "14px 16px", fontWeight: 700, color: g.waiterId ? "#1E293B" : "#94A3B8", fontStyle: g.waiterId ? "normal" : "italic" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ width: 30, height: 30, borderRadius: "50%", background: g.waiterId ? "#FAF6F2" : "#F1F5F9", color: g.waiterId ? "#475569" : "#94A3B8", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13 }}>
                          {g.nome.charAt(0).toUpperCase()}
                        </div>
                        {g.nome}
                      </div>
                    </td>
                    <td style={{ padding: "14px 16px", textAlign: "right", color: "#475569", fontWeight: 600 }}>{g.mesas}</td>
                    <td style={{ padding: "14px 16px", textAlign: "right", color: "#475569" }}>{fmt(g.consumo)}</td>
                    <td style={{ padding: "14px 16px", textAlign: "right", color: "#475569", fontWeight: 600 }}>{ticket(g.consumo, g.mesas)}</td>
                    <td style={{ padding: "14px 16px", textAlign: "right", color: "#64748B", fontWeight: 700 }}>{pctDoSalao(g.consumo)}</td>
                    {temDesconto && <td style={{ padding: "14px 16px", textAlign: "right", color: "#9A3412", fontWeight: 600 }}>{g.desconto > 0 ? fmt(g.desconto) : "—"}</td>}
                    <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 800, color: "#0F766E" }}>{fmt(g.taxaServico)}</td>
                    <td style={{ padding: "14px 16px", textAlign: "right", color: "#B45309", fontWeight: 700 }}>{g.gorjetas > 0 ? fmt(g.gorjetas) : "—"}</td>
                  </tr>
                ))}
                <tr style={{ background: "#F8FAFC", borderTop: "2px solid #E2E8F0" }}>
                  <td style={{ padding: "14px 16px", fontWeight: 900, color: "#1E293B" }}>Total</td>
                  <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 800 }}>{dados.mesas.fechadas}</td>
                  <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 800 }}>{fmt(dados.mesas.consumo)}</td>
                  <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 800 }}>{ticket(dados.mesas.consumo, dados.mesas.fechadas)}</td>
                  <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 800, color: "#64748B" }}>{dados.mesas.consumo > 0 ? "100%" : "—"}</td>
                  {temDesconto && <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 800, color: "#9A3412" }}>{fmt(desconto)}</td>}
                  <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 900, color: "#134E4A" }}>{fmt(dados.mesas.taxaServico)}</td>
                  <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 800, color: "#B45309" }}>{dados.mesas.gorjetas > 0 ? fmt(dados.mesas.gorjetas) : "—"}</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* ── Vendas por origem ── */}
      <h3 style={{ fontSize: 18, fontWeight: 800, color: "#1E293B", marginBottom: 12 }}>Vendas por origem</h3>
      <div style={{ background: "#fff", borderRadius: 12, border: "1px solid #E2E8F0", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#F8FAFC", borderBottom: "2px solid #E2E8F0", textAlign: "left" }}>
              <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13 }}>Origem</th>
              <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13, textAlign: "right" }}>Vendas</th>
              <th style={{ padding: "14px 16px", color: "#1E293B", fontWeight: 800, fontSize: 13, textAlign: "right" }}>Vendido</th>
              <th style={{ padding: "14px 16px", color: "#475569", fontWeight: 700, fontSize: 13, textAlign: "right" }}>% do total</th>
            </tr>
          </thead>
          <tbody>
            {carregando || !origem ? (
              <tr><td colSpan={4} style={{ padding: 40, textAlign: "center" }}><Loader2 className="animate-spin mx-auto text-slate-400" size={32} /></td></tr>
            ) : (
              <>
                {([
                  ["BALCAO", "Balcão", <Store key="b" size={16} color="#4338CA" />, "#FAF6F2"],
                  ["MESA", "Mesa", <UtensilsCrossed key="m" size={16} color="#9A3412" />, "#FFF4EF"],
                  ["DELIVERY", "Delivery", <Bike key="d" size={16} color="#1C1917" />, "#FAF6F2"],
                  ["RETIRADA", "Retirada (site / app)", <ShoppingBag key="r" size={16} color="#0F766E" />, "#F0FDFA"],
                ] as const).map(([chave, rotulo, icone, fundo]) => (
                  <Fragment key={chave}>
                  <tr style={{ borderBottom: "1px solid #E2E8F0" }}>
                    <td style={{ padding: "14px 16px", fontWeight: 700, color: "#1E293B" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 30, height: 30, borderRadius: 8, background: fundo, display: "flex", alignItems: "center", justifyContent: "center" }}>{icone}</div>
                        {rotulo}
                      </div>
                    </td>
                    <td style={{ padding: "14px 16px", textAlign: "right", color: "#475569", fontWeight: 600 }}>
                      {fmtQtd(origem[chave].vendas)}
                      {/* A mesa é UMA venda, por mais rodadas que tenha: as
                          rodadas ficam como detalhe, nunca no lugar das mesas. */}
                      {chave === "MESA" && origem.MESA.lancamentos > 0 && (
                        <div style={{ fontSize: 11, color: "#94A3B8", fontWeight: 600 }}>
                          {origem.MESA.vendas === 1 ? "mesa" : "mesas"} · {fmtQtd(origem.MESA.lancamentos)} {origem.MESA.lancamentos === 1 ? "rodada" : "rodadas"}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 800, color: "#1E293B" }}>{fmt(origem[chave].valor)}</td>
                    <td style={{ padding: "14px 16px", textAlign: "right", color: "#64748B", fontWeight: 700 }}>{pct(origem[chave].valor)}</td>
                  </tr>
                  {/* O delivery aberto por plataforma: iFood, 99Food, site… É o que
                      o lojista precisa para comparar com o repasse de cada uma. Logo
                      abaixo do Delivery — embaixo da Retirada, lia-se "Retirada: iFood". */}
                  {chave === "DELIVERY" && dados!.vendas.deliveryPorCanal.map((c) => (
                    <tr key={c.canal} style={{ borderBottom: "1px solid #F1F5F9", background: "#FAFBFF" }}>
                      <td style={{ padding: "8px 16px 8px 56px", color: "#64748B", fontSize: 13 }}>↳ {c.canal}</td>
                      <td style={{ padding: "8px 16px", textAlign: "right", color: "#94A3B8", fontSize: 13 }}>{fmtQtd(c.vendas)}</td>
                      <td style={{ padding: "8px 16px", textAlign: "right", color: "#475569", fontSize: 13, fontWeight: 600 }}>{fmt(c.valor)}</td>
                      <td style={{ padding: "8px 16px", textAlign: "right", color: "#94A3B8", fontSize: 13 }}>{pct(c.valor)}</td>
                    </tr>
                  ))}
                  </Fragment>
                ))}
                <tr style={{ background: "#F8FAFC", borderTop: "2px solid #E2E8F0" }}>
                  <td style={{ padding: "14px 16px", fontWeight: 900, color: "#1E293B" }}>Total vendido</td>
                  <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 800 }}>{fmtQtd(dados!.vendas.vendas)}</td>
                  <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 900, color: "#1E293B", fontSize: 16 }}>{fmt(total)}</td>
                  <td style={{ padding: "14px 16px", textAlign: "right", fontWeight: 800, color: "#64748B" }}>100%</td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      <p style={{ margin: "12px 4px 0", fontSize: 12, color: "#94A3B8", lineHeight: 1.5 }}>
        Mesas fechadas, consumo, taxa de serviço e gorjeta: as contas fechadas no período (a mesa liberada sem consumo também conta como
        fechada). O consumo é o que foi lançado na conta, sem taxa de serviço, gorjeta e troco; o desconto dado ao fechar a conta aparece à
        parte e não sai do consumo. Mesa a mesa, com abertura, fechamento, forma de pagamento e itens: Mesas › 📋 Histórico (os mesmos
        números, dia a dia).
      </p>
      <p style={{ margin: "6px 4px 0", fontSize: 12, color: "#94A3B8", lineHeight: 1.5 }}>
        Vendas por origem: pela hora do pedido, os mesmos números do relatório Vendas por período — por isso a linha Mesa inclui mesa
        ainda aberta e pode diferir do consumo das mesas fechadas. Cada pedido é uma venda; a mesa conta como uma venda só, por mais
        rodadas que tenha. A taxa de serviço não entra em &quot;Vendido&quot; — é cobrada à parte; quanto dela vai para cada garçom está no
        relatório dele (comissão).
      </p>
    </>
  );
}
