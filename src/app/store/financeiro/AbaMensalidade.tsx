"use client";
/**
 * A aba Mensalidade: primeiro a fatura FECHADA que ainda está em aberto (é
 * para cá que o "Ver Fatura" do aviso do topo manda — âncora #fatura), depois
 * o mês em andamento, com a conta inteira à vista: o que entra a 1% e a 2%, o
 * mínimo e o teto, as lojas extras de marketplace e as taxas de serviço.
 *
 * Tudo vem do ciclo do servidor (lib/billing.ts, getCurrentCycleView) — a
 * mesma conta do boleto. Auditoria de 11/10/2026: a tela não somava as lojas
 * extras (Ragnar via R$ 400 e o boleto veio de R$ 500) nem mostrava as taxas
 * que a API já devolvia, e o "Ver Fatura" abria o mês corrente com o boleto de
 * setembro sumido.
 */
import { useEffect, useState, type ReactNode } from "react";
import { FIREHUB_PLAN, MES_DOS_2_POR_CENTO } from "@/lib/firehub-billing";
import type { VisaoDoCiclo } from "@/lib/billing";
import { diasAte } from "@/lib/prazo-da-mensalidade";
import { nomeDoMes } from "@/lib/financeiro/dre";
import { fmtNum, fmtR } from "./ui";
import CartaoIndiqueEGanhe from "./CartaoIndiqueEGanhe";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const mesPorExtenso = (ym: string) => {
  const [a, m] = ym.split("-").map(Number);
  return MESES[m - 1] ? `${MESES[m - 1]} de ${a}` : ym;
};
/** "2026-10-05" → "05/10". */
const diaEMes = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

type PedidoDoCiclo = {
  id: string; createdAt: string; status: string; totalAmount: number; discountTotal: number | null;
  customerName: string | null; paymentMethod: string | null; dailyOrderNumber: number | null;
  ifoodReference: string | null; openDeliveryReference: string | null; bruto: number; percentual: number;
};

function numeroDoPedido(p: PedidoDoCiclo): string {
  if (p.dailyOrderNumber != null) return `#${p.dailyOrderNumber}`;
  if (p.ifoodReference) return `iFood #${p.ifoodReference}`;
  if (p.openDeliveryReference) return `#${p.openDeliveryReference}`;
  return `#${p.id.slice(-4).toUpperCase()}`;
}

export default function AbaMensalidade({ ciclo, tz }: { ciclo: VisaoDoCiclo | null; tz: string }) {
  const [verDetalhes, setVerDetalhes] = useState(false);

  // O aviso do topo manda para /store/financeiro?tab=mensalidade#fatura. A seção
  // já vem desenhada do servidor, mas a navegação do Next pode chegar antes do
  // desenho — então rola até ela de novo quando a aba monta.
  useEffect(() => {
    if (typeof window === "undefined" || window.location.hash !== "#fatura") return;
    const t = setTimeout(() => document.getElementById("fatura")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    return () => clearTimeout(t);
  }, []);

  if (!ciclo) {
    return (
      <div id="fatura" style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 16, padding: "1.25rem", color: "#B71C1C" }}>
        Não foi possível carregar a mensalidade agora. Recarregue a página em instantes.
      </div>
    );
  }

  const faturas = ciclo.faturasEmAberto || [];

  // Loja isenta HOJE pode ter boleto de antes em aberto (virou parceira, teve o
  // percentual zerado): a fatura aparece primeiro, como para qualquer loja —
  // a faixa do topo cobra e trava pelo mesmo boleto.
  if (ciclo.isExempt) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
        {faturas.length > 0 && <FaturasEmAberto faturas={faturas} />}
        <div id={faturas.length === 0 ? "fatura" : undefined} style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", borderRadius: 20, padding: "1.75rem", color: "#fff", border: "1.5px solid #0F766E" }}>
          <span style={{ background: "#F0FDFA", color: "#0F766E", padding: "4px 12px", borderRadius: 20, fontSize: "0.78rem", fontWeight: 900 }}>✨ Conta isenta</span>
          <h2 style={{ fontSize: "1.5rem", fontWeight: 900, margin: "8px 0 2px", color: "#F8FAFC" }}>Mensalidade FireHub (isenta)</h2>
          <p style={{ margin: 0, fontSize: "0.85rem", color: "#94A3B8" }}>Esta loja não paga mensalidade nem comissão da plataforma.</p>
        </div>
        <CartaoIndiqueEGanhe />
      </div>
    );
  }

  const agora = new Date();
  const testeAte = ciclo.trialEndsAt ? new Date(ciclo.trialEndsAt) : null;
  const cobraDesde = ciclo.cobrancaDesde ? new Date(ciclo.cobrancaDesde) : null;
  const dataCurta = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: tz });
  const a1 = ciclo.vendasA1PorCento || 0;
  const a2 = Math.max(0, ciclo.totalSales - a1);
  const pct2 = ciclo.yearMonth >= MES_DOS_2_POR_CENTO ? FIREHUB_PLAN.PERCENT_RATE : 1;
  const pelaPorcentagem = a1 * 0.01 + a2 * (pct2 / 100);
  const mensalidade = ciclo.mensalidadePrevista ?? 0;
  const motivoDoValor = ciclo.emTeste
    ? null
    : ciclo.cobrancaPorUso && ciclo.totalSales === 0
      ? `mínimo por uso do sistema (${ciclo.cobrancaPorUso.motivos.join(", ")})`
      : pelaPorcentagem >= FIREHUB_PLAN.MAX_MONTHLY
        ? `teto de ${fmtR(FIREHUB_PLAN.MAX_MONTHLY)} atingido`
        : ciclo.totalSales > 0 && pelaPorcentagem < FIREHUB_PLAN.MIN_MONTHLY
          ? `mínimo de ${fmtR(FIREHUB_PLAN.MIN_MONTHLY)} (a porcentagem deu ${fmtR(pelaPorcentagem)})`
          : null;
  const extras = ciclo.lojasExtras;
  const partesDasLojas = [
    extras.lojasIfood > 1 ? `iFood +${extras.lojasIfood - 1}` : null,
    extras.lojas99 > 1 ? `99Food +${extras.lojas99 - 1}` : null,
  ].filter(Boolean).join(", ");
  const nExtras = Math.max(0, extras.lojasIfood - 1) + Math.max(0, extras.lojas99 - 1);

  const linha = (rotulo: ReactNode, valor: ReactNode, sub?: ReactNode, destaque = false) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderTop: destaque ? "2px solid #334155" : "1px solid #1E293B" }}>
      <div>
        <div style={{ fontSize: destaque ? "0.95rem" : "0.86rem", fontWeight: destaque ? 900 : 600, color: "#E2E8F0" }}>{rotulo}</div>
        {sub && <div style={{ fontSize: "0.74rem", color: "#94A3B8", marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ fontSize: destaque ? "1.1rem" : "0.9rem", fontWeight: destaque ? 900 : 700, color: destaque ? "#F8FAFC" : "#CBD5E1", whiteSpace: "nowrap" }}>{valor}</div>
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
      {/* ── FATURA FECHADA EM ABERTO (para onde o aviso do topo manda) ──── */}
      {faturas.length > 0 && <FaturasEmAberto faturas={faturas} />}

      {/* ── O MÊS EM ANDAMENTO ─────────────────────────────────────────── */}
      <div id={faturas.length === 0 ? "fatura" : undefined} style={{
        background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", borderRadius: 20, padding: "1.75rem", color: "#fff",
        boxShadow: "0 10px 30px rgba(0,0,0,0.15)", border: "1px solid #334155", scrollMarginTop: 80,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "1rem", marginBottom: "1rem" }}>
          <div>
            <span style={{ background: "#FFF7E6", color: "#92400E", padding: "4px 12px", borderRadius: 20, fontSize: "0.78rem", fontWeight: 900 }}>
              {ciclo.emTeste
                ? (testeAte && testeAte > agora
                  ? `🧪 Em teste até ${dataCurta(testeAte)}${cobraDesde ? " · as vendas a partir daí entram na cobrança" : " · sem cobrança neste mês"}`
                  : "🧪 Período de teste — sem cobrança neste mês")
                : "⏳ Mês em andamento · o boleto sai no fechamento (dia 1) e vence no dia 5"}
            </span>
            <h2 style={{ fontSize: "1.45rem", fontWeight: 900, margin: "8px 0 2px", color: "#F8FAFC" }}>
              Mensalidade de {mesPorExtenso(ciclo.yearMonth)}
            </h2>
            <p style={{ margin: 0, fontSize: "0.82rem", color: "#94A3B8" }}>
              Plano: {pct2}% sobre o valor cheio das vendas (antes de cupons) · mínimo {fmtR(FIREHUB_PLAN.MIN_MONTHLY)} · teto {fmtR(FIREHUB_PLAN.MAX_MONTHLY)} por mês
              {!ciclo.emTeste && cobraDesde && testeAte && cobraDesde.getTime() === testeAte.getTime() && <> · teste terminou em {dataCurta(cobraDesde)}: só as vendas a partir daí contam</>}
            </p>
          </div>
          <div style={{ textAlign: "right", background: "#1E293B", padding: "12px 18px", borderRadius: 14, border: "1px solid #334155" }}>
            <div style={{ fontSize: "0.72rem", color: "#94A3B8", fontWeight: 700 }}>PREVISÃO DO BOLETO ATÉ AGORA</div>
            <div style={{ fontSize: "1.8rem", fontWeight: 900, color: "#F8FAFC", marginTop: 2 }}>{fmtR(ciclo.amountPending)}</div>
          </div>
        </div>

        {/* A conta, linha a linha — cada parte do boleto com o seu número. */}
        <div style={{ background: "#0B1220", borderRadius: 14, padding: "4px 16px 8px" }}>
          {linha(
            "Vendas na base de cálculo",
            fmtR(ciclo.totalSales),
            ciclo.emTeste
              ? "nada ainda: as vendas passam a contar quando o teste terminar"
              : `valor cheio (antes de cupons)${cobraDesde && testeAte && cobraDesde.getTime() === testeAte.getTime() ? ` desde ${dataCurta(cobraDesde)}` : " do mês"}`,
          )}
          {!ciclo.emTeste && ciclo.totalSales > 0 && (
            a1 > 0
              ? linha(
                  <>Porcentagem: {fmtR(a1)} a 1% (01 a 03/10) + {fmtR(a2)} a {pct2}%</>,
                  fmtR(pelaPorcentagem),
                  "a taxa subiu para 2% em 04/10/2026; o que foi vendido antes continua a 1%",
                )
              : linha(`Porcentagem: ${pct2}% de ${fmtR(ciclo.totalSales)}`, fmtR(pelaPorcentagem))
          )}
          {linha(
            "Mensalidade",
            fmtR(mensalidade),
            ciclo.emTeste ? "em teste: sem mensalidade por enquanto" : motivoDoValor || undefined,
          )}
          {nExtras > 0 && linha(
            `${nExtras} ${nExtras === 1 ? "loja extra" : "lojas extras"} de marketplace (${partesDasLojas})`,
            fmtR(extras.valor),
            `a primeira loja de cada app é grátis; cada adicional custa ${fmtR(FIREHUB_PLAN.EXTRA_STORE_FEE)} por mês`,
          )}
          {(ciclo.taxas?.trafegoPago || 0) > 0 && linha("Gestão de tráfego pago (FireHub)", fmtR(ciclo.taxas.trafegoPago), "R$ 50 por semana de campanha ativa")}
          {(ciclo.taxas?.totem || 0) > 0 && linha("Totem de autoatendimento", fmtR(ciclo.taxas.totem))}
          {(ciclo.taxas?.assessor || 0) > 0 && linha("Bill, seu assessor (estoque e financeiro pelo WhatsApp)", fmtR(ciclo.taxas.assessor || 0), "R$ 29,90 no mês em que ficou ativo depois dos 7 dias grátis (termo aceito ao ligar)")}
          {(ciclo.amountOffset || 0) > 0 && linha("Já abatido por pagamentos online", `- ${fmtR(Math.min(ciclo.amountOffset, mensalidade))}`)}
          {ciclo.indiqueEGanhe?.isenta && linha("Mensalidade isenta (Indique e Ganhe)", fmtR(0), `${ciclo.indiqueEGanhe.ativosPagantes} restaurantes indicados ativos e pagantes — vale enquanto forem mais de 10`)}
          {(ciclo.indiqueEGanhe?.abate || 0) > 0 && linha(
            "Desconto Indique e Ganhe",
            `- ${fmtR(ciclo.indiqueEGanhe.abate)}`,
            ciclo.indiqueEGanhe.saldo > ciclo.indiqueEGanhe.abate
              ? `crédito de indicação; sobram ${fmtR(ciclo.indiqueEGanhe.saldo - ciclo.indiqueEGanhe.abate)} para os próximos meses`
              : "crédito de indicação, usado no fechamento",
          )}
          {linha("Previsão do boleto até agora", fmtR(ciclo.amountPending), "muda até o fim do mês conforme as vendas; o valor final sai no fechamento", true)}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", borderTop: "1px solid #334155", paddingTop: "1.1rem", marginTop: "1.1rem" }}>
          {ciclo.asaasBoletoUrl ? (
            <a href={ciclo.asaasBoletoUrl} target="_blank" rel="noreferrer" style={{ background: "#0F766E", color: "#fff", textDecoration: "none", padding: "12px 22px", borderRadius: 12, fontSize: "0.92rem", fontWeight: 900 }}>
              ⚡ Abrir boleto / pagar
            </a>
          ) : (
            <span style={{ alignSelf: "center", fontSize: "0.82rem", color: "#94A3B8" }}>
              O boleto deste mês é gerado no fechamento (dia 1) e aparece aqui.
            </span>
          )}
          <button onClick={() => setVerDetalhes(true)} style={{
            background: "#334155", color: "#F8FAFC", border: "1px solid #475569", padding: "12px 18px", borderRadius: 12,
            fontSize: "0.88rem", fontWeight: 800, cursor: "pointer", fontFamily: "inherit",
          }}>
            📄 Detalhes da cobrança
          </button>
        </div>
      </div>

      <CartaoIndiqueEGanhe />

      {verDetalhes && <DetalhesDaCobranca ciclo={ciclo} tz={tz} onFechar={() => setVerDetalhes(false)} />}
    </div>
  );
}

/** As faturas FECHADAS em aberto, a mais antiga primeiro (seção #fatura). */
function FaturasEmAberto({ faturas }: { faturas: VisaoDoCiclo["faturasEmAberto"] }) {
  return (
    <div id="fatura" style={{ display: "flex", flexDirection: "column", gap: 12, scrollMarginTop: 80 }}>
      {faturas.map((f) => {
        const dias = diasAte(f.venceEm);
        return (
          <div key={f.yearMonth} style={{
            background: f.vencida ? "#FEF2F2" : "#EFF6FF", border: `2px solid ${f.vencida ? "#C92E09" : "#1D4ED8"}`,
            borderRadius: 18, padding: "1.25rem 1.5rem", display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between",
          }}>
            <div>
              <div style={{ fontSize: "0.78rem", fontWeight: 900, color: f.vencida ? "#C92E09" : "#1D4ED8", letterSpacing: 0.5 }}>
                {f.vencida ? "FATURA VENCIDA" : "FATURA EM ABERTO"}
              </div>
              <div style={{ fontSize: "1.25rem", fontWeight: 900, color: "#0F172A", marginTop: 2 }}>
                Mensalidade de {mesPorExtenso(f.yearMonth)} · {fmtR(f.valor)}
              </div>
              <div style={{ fontSize: "0.84rem", color: "#475569", marginTop: 4 }}>
                {dias > 0
                  ? <>Vence em <strong>{diaEMes(f.venceEm)}</strong> ({dias === 1 ? "falta 1 dia" : `faltam ${dias} dias`}).</>
                  : dias === 0
                    ? <>Vence <strong>hoje ({diaEMes(f.venceEm)})</strong>.</>
                    // `bloqueiaEm` é o INSTANTE da trava (00h do dia 11): o último dia
                    // de uso é o anterior a ele.
                    : <>Venceu em <strong>{diaEMes(f.venceEm)}</strong> e já está com juros e multa. Sem o pagamento, o sistema trava depois do dia {new Date(new Date(f.bloqueiaEm).getTime() - 1).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" })}.</>}
              </div>
            </div>
            {f.boletoUrl ? (
              <a href={f.boletoUrl} target="_blank" rel="noreferrer" style={{
                background: f.vencida ? "#C92E09" : "#1D4ED8", color: "#fff", textDecoration: "none", padding: "12px 22px",
                borderRadius: 12, fontSize: "0.92rem", fontWeight: 900, whiteSpace: "nowrap",
              }}>
                ⚡ Pagar (boleto, Pix ou cartão)
              </a>
            ) : (
              <span style={{ fontSize: "0.82rem", color: "#475569" }}>
                O link do boleto não ficou gravado. Fale com o suporte pelo WhatsApp para receber a fatura.
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A janela "Detalhes da Cobrança": os pedidos que formam a base do mês
 * corrente, lidos do CICLO (lib/billing.ts, pedidosDoCicloAtual). Antes ela
 * listava os pedidos do período do DRE e chamava a receita do período de
 * "Vendas registradas no ciclo"; o "Valor bruto" saía líquido, o número do
 * pedido era o fim do id e a coluna Cliente vinha vazia.
 */
function DetalhesDaCobranca({ ciclo, tz, onFechar }: { ciclo: VisaoDoCiclo; tz: string; onFechar: () => void }) {
  const [dados, setDados] = useState<{ yearMonth: string; desde: string | null; pedidos: PedidoDoCiclo[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [todos, setTodos] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch("/api/billing/cycle?pedidos=1", { cache: "no-store" })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!vivo) return;
        if (!r.ok || !j) setErro(j?.error || "Não foi possível carregar os pedidos do ciclo.");
        else setDados(j);
      })
      .catch(() => vivo && setErro("Sem conexão. Tente de novo."));
    return () => { vivo = false; };
  }, []);

  const pedidos = dados?.pedidos || [];
  const somaBruto = pedidos.reduce((s, p) => s + Math.round(p.bruto * 100), 0) / 100;
  const somaPorcentagem = pedidos.reduce((s, p) => s + Math.round(p.bruto * p.percentual), 0) / 100;
  const visiveis = todos ? pedidos : pedidos.slice(0, 100);
  const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15, 23, 42, 0.75)", backdropFilter: "blur(6px)", zIndex: 99999, display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
      <div style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 880, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden", border: "1px solid #E2E8F0" }}>
        <div style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", padding: "1.1rem 1.5rem", color: "#fff", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: "1.1rem", fontWeight: 900, color: "#F8FAFC" }}>Detalhes da cobrança — {nomeDoMes(ciclo.yearMonth)}</h3>
            <p style={{ margin: 0, fontSize: "0.78rem", color: "#94A3B8" }}>Os pedidos que entram na base da mensalidade deste mês, pelo valor cheio (pago + cupom).</p>
          </div>
          <button onClick={onFechar} aria-label="Fechar" style={{ background: "none", border: "none", color: "#94A3B8", cursor: "pointer", fontSize: "1.2rem", fontWeight: 900 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "1.25rem 1.5rem" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "1rem", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 14, padding: "1rem 1.25rem", marginBottom: "1rem" }}>
            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748B" }}>VENDAS NA BASE DO CICLO</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 900, color: "#0F172A" }}>{fmtR(ciclo.totalSales)}</div>
              {dados && <div style={{ fontSize: "0.72rem", color: "#64748B" }}>{fmtNum(pedidos.length)} pedidos{dados.desde ? ` desde ${new Date(dados.desde).toLocaleDateString("pt-BR", { timeZone: tz })}` : ""}</div>}
            </div>
            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748B" }}>PORCENTAGEM DOS PEDIDOS</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 900, color: "#0F766E" }}>{dados ? fmtR(somaPorcentagem) : "…"}</div>
              <div style={{ fontSize: "0.72rem", color: "#64748B" }}>antes do mínimo e do teto</div>
            </div>
            <div>
              <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748B" }}>MENSALIDADE PREVISTA</div>
              <div style={{ fontSize: "1.25rem", fontWeight: 900, color: "#1C1917" }}>{fmtR(ciclo.mensalidadePrevista ?? 0)}</div>
              <div style={{ fontSize: "0.72rem", color: "#64748B" }}>mínimo {fmtR(FIREHUB_PLAN.MIN_MONTHLY)} · teto {fmtR(FIREHUB_PLAN.MAX_MONTHLY)}</div>
            </div>
          </div>

          {erro && <div style={{ color: "#B71C1C", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>{erro}</div>}
          {!dados && !erro && <div style={{ textAlign: "center", color: "#64748B", padding: "2rem" }}>Carregando os pedidos do ciclo…</div>}
          {dados && Math.abs(somaBruto - ciclo.totalSales) > 0.05 && (
            <div style={{ fontSize: "0.76rem", color: "#92400E", background: "#FFF7E6", borderRadius: 8, padding: "8px 12px", marginBottom: 10 }}>
              A lista soma {fmtR(somaBruto)}: entrou pedido novo desde que a tela abriu. Feche e abra a aba de novo para atualizar.
            </div>
          )}

          {dados && (
            <div style={{ border: "1px solid #E2E8F0", borderRadius: 12, overflow: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", minWidth: 640 }}>
                <thead>
                  <tr style={{ background: "#F1F5F9", color: "#475569", textAlign: "left" }}>
                    <th style={{ padding: "9px 12px" }}>Pedido</th>
                    <th style={{ padding: "9px 12px" }}>Data / hora</th>
                    <th style={{ padding: "9px 12px" }}>Cliente</th>
                    <th style={{ padding: "9px 12px" }}>Pagamento</th>
                    <th style={{ padding: "9px 12px" }}>Valor cheio</th>
                    <th style={{ padding: "9px 12px" }}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {pedidos.length === 0 ? (
                    <tr><td colSpan={6} style={{ padding: "2rem", textAlign: "center", color: "#94A3B8" }}>Nenhum pedido na base deste mês ainda.</td></tr>
                  ) : visiveis.map((p) => (
                    <tr key={p.id} style={{ borderTop: "1px solid #F1F5F9" }}>
                      <td style={{ padding: "8px 12px", fontWeight: 800, color: "#0F172A" }}>
                        {numeroDoPedido(p)}
                        {String(p.status).toUpperCase().includes("CANCEL") && <div style={{ fontSize: "0.68rem", fontWeight: 700, color: "#B91C1C" }}>cancelado (conta desde 04/10)</div>}
                      </td>
                      <td style={{ padding: "8px 12px", color: "#64748B", whiteSpace: "nowrap" }}>{quando(p.createdAt)}</td>
                      <td style={{ padding: "8px 12px" }}>{p.customerName || "—"}</td>
                      <td style={{ padding: "8px 12px" }}>{p.paymentMethod || "—"}</td>
                      <td style={{ padding: "8px 12px", fontWeight: 700, color: "#0F172A", whiteSpace: "nowrap" }}>
                        {fmtR(p.bruto)}
                        {(p.discountTotal || 0) > 0 && <div style={{ fontSize: "0.7rem", fontWeight: 500, color: "#64748B" }}>pago {fmtR(p.totalAmount)} + cupom {fmtR(p.discountTotal || 0)}</div>}
                      </td>
                      <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{p.percentual}% = {fmtR(Math.round(p.bruto * p.percentual) / 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {pedidos.length > visiveis.length && (
                <button onClick={() => setTodos(true)} style={{ width: "100%", padding: 10, background: "#F8FAFC", border: "none", borderTop: "1px solid #E2E8F0", color: "#334155", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
                  Mostrar os {fmtNum(pedidos.length)} pedidos
                </button>
              )}
            </div>
          )}
        </div>

        <div style={{ background: "#F8FAFC", borderTop: "1px solid #E2E8F0", padding: "0.9rem 1.5rem", display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => window.print()} style={{ background: "#fff", border: "1px solid #CBD5E1", borderRadius: 8, padding: "8px 14px", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer", color: "#334155" }}>
            🖨️ Imprimir / salvar em PDF
          </button>
          <button onClick={onFechar} style={{ background: "#E2E8F0", border: "none", borderRadius: 8, padding: "8px 14px", fontSize: "0.82rem", fontWeight: 700, cursor: "pointer", color: "#475569" }}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}
