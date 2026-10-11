"use client";
/**
 * A tela do Financeiro: período, abas e o estado que as abas dividem (custos
 * fixos, despesas lançadas, comissão dos apps). As contas moram em
 * lib/financeiro/dre.ts; cada aba desenha num arquivo próprio.
 *
 * ── O período (auditoria de 11/10/2026) ─────────────────────────────────────
 *
 * Era o relógio do NAVEGADOR sobre 365 dias de pedidos mandados inteiros:
 * "7 dias" = as últimas 168 horas, "Hoje" desde a meia-noite (às 08:51 ainda
 * mostrava a madrugada de ontem) e o personalizado terminava às 23:59:00.
 * Ragnar, "7 dias": DRE R$ 67.904,20 × Relatórios R$ 54.867,76. Agora é o
 * período dos Relatórios — os mesmos atalhos, o dia operacional da loja (vira
 * às 5h, no fuso dela) — e o servidor manda só a janela pedida. Um período só
 * para o DRE, o Extrato e o Relatório: o Extrato tinha botões próprios que não
 * desligavam o personalizado.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import InvoicesClient from "@/components/InvoicesClient";
import AjudaModulo from "@/components/AjudaModulo";
import ContasAPagarClient, { type PayableDTO } from "./ContasAPagarClient";
import type { DespesaDTO } from "./DespesasLancadas";
import AbaDRE from "./AbaDRE";
import AbaMensalidade from "./AbaMensalidade";
import { AbaExtrato, AbaRelatorio } from "./AbaExtrato";
import AbaConfiguracoes from "./AbaConfiguracoes";
import AbaCustosFixos from "./AbaCustosFixos";
import type { VisaoDoCiclo } from "@/lib/billing";
import {
  ATALHOS_DO_FINANCEIRO, atalhoDoFinanceiro, calcularDRE, diaCurto, lerPeriodo, periodoDoFinanceiro,
  type ComissoesDosApps, type CustoFixo, type DadosDoPeriodo,
} from "@/lib/financeiro/dre";

type Aba = "mensalidade" | "extrato" | "relatorio" | "configuracoes" | "dre" | "custosfix" | "pagamentos" | "contasapagar" | "notascompras";

/** As abas em que o período vale (as outras não dependem dele). */
const ABAS_COM_PERIODO = new Set<Aba>(["dre", "extrato", "relatorio", "pagamentos", "custosfix"]);

export default function DREClient({
  inicio, dadosIniciais, erroInicial, cicloInicial, papel, paymentFees, storeName, produtosSemCusto = [],
  initialFixedCosts = [], comissoesIniciais = {}, initialRepasseConfig = {}, payables = [], initialDespesas = [],
}: {
  /** Período, "hoje" e fuso decididos NO SERVIDOR (o dia operacional da loja). */
  inicio: { de: string; ate: string; hoje: string; tz: string; aba: Aba };
  dadosIniciais: DadosDoPeriodo | null;
  erroInicial: string | null;
  cicloInicial: VisaoDoCiclo | null;
  papel: string;
  paymentFees: unknown;
  storeName: string;
  produtosSemCusto?: { id: string; name: string }[];
  initialFixedCosts?: CustoFixo[];
  comissoesIniciais?: ComissoesDosApps;
  initialRepasseConfig?: any;
  payables?: PayableDTO[];
  initialDespesas?: DespesaDTO[];
}) {
  const [aba, setAba] = useState<Aba>(inicio.aba === "pagamentos" ? "relatorio" : inicio.aba);
  const [periodo, setPeriodo] = useState({ de: inicio.de, ate: inicio.ate });
  const [hoje, setHoje] = useState(inicio.hoje);
  const [dados, setDados] = useState<DadosDoPeriodo | null>(dadosIniciais);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(erroInicial);
  const [custos, setCustos] = useState<CustoFixo[]>(initialFixedCosts);
  const [despesas, setDespesas] = useState<DespesaDTO[]>(initialDespesas);
  const [comissoes, setComissoes] = useState<ComissoesDosApps>(comissoesIniciais);
  const ultimoPedido = useRef(0);

  // O período e a aba vão para a URL: recarregar ou mandar o link abre a
  // MESMA tela. Sem navegação (replaceState): a tela não remonta.
  useEffect(() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      sp.set("tab", aba);
      sp.set("de", periodo.de);
      sp.set("ate", periodo.ate);
      const hash = aba === "mensalidade" ? window.location.hash : "";
      window.history.replaceState(null, "", `${window.location.pathname}?${sp.toString()}${hash}`);
    } catch { /* navegador sem history: nada a fazer */ }
  }, [aba, periodo]);

  const carregar = useCallback(async (de: string, ate: string) => {
    const id = ++ultimoPedido.current;
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/store/financeiro/periodo?de=${de}&ate=${ate}`, { cache: "no-store" });
      const j = await res.json().catch(() => null);
      if (id !== ultimoPedido.current) return; // chegou outro pedido depois deste
      if (!res.ok || !j || j.error) { setErro(j?.error || "Não foi possível carregar o período. Tente de novo."); return; }
      setDados(j as DadosDoPeriodo);
      if (j.hoje) setHoje(j.hoje);
    } catch {
      if (id === ultimoPedido.current) setErro("Sem conexão. Tente de novo.");
    } finally {
      if (id === ultimoPedido.current) setCarregando(false);
    }
  }, []);

  // A página só manda o período pronto quando abre numa aba que o usa; nas
  // outras (Mensalidade, a padrão) ele é buscado na primeira vez que o
  // lojista abre o DRE, o Extrato, o Relatório, os Custos Fixos ou as
  // Configurações.
  const usaPeriodo = ABAS_COM_PERIODO.has(aba) || aba === "configuracoes";
  useEffect(() => {
    if (usaPeriodo && !dados && !carregando && !erro) carregar(periodo.de, periodo.ate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usaPeriodo]);

  const mudarPeriodo = (de: string, ate: string) => {
    const p = lerPeriodo(de, ate, hoje);
    setPeriodo(p);
    carregar(p.de, p.ate);
  };

  const dre = useMemo(
    () => (dados ? calcularDRE({ dados, custosFixos: custos, despesas, comissoes, paymentFees }) : null),
    [dados, custos, despesas, comissoes, paymentFees],
  );

  const atalhoAtivo = atalhoDoFinanceiro(periodo.de, periodo.ate, hoje);
  const mostraPeriodo = ABAS_COM_PERIODO.has(aba);

  const tabStyle = (tab: Aba, cor = "#0F172A") => ({
    padding: "8px 16px", borderRadius: "10px", border: "none", cursor: "pointer",
    fontWeight: 700, fontSize: "0.85rem", fontFamily: "inherit",
    background: aba === tab ? cor : "transparent",
    color: aba === tab ? "#fff" : "#64748B",
    transition: "all 0.2s",
  });

  const semDados = (
    <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: "2rem", textAlign: "center", color: "#64748B" }}>
      {carregando ? "Carregando o período…" : (erro || "Sem dados do período.")}
      {!carregando && (
        <div style={{ marginTop: 12 }}>
          <button onClick={() => carregar(periodo.de, periodo.ate)} style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid #CBD5E1", background: "#fff", cursor: "pointer", fontWeight: 700, fontFamily: "inherit" }}>
            Tentar de novo
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div style={{ fontFamily: "'Inter', sans-serif", background: "#F8FAFC", minHeight: "100vh" }}>
      <div style={{ background: "#fff", borderBottom: "1px solid #E2E8F0", padding: "1rem 1.5rem" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "1rem" }}>
            <div>
              <h1 style={{ fontWeight: 800, fontSize: "1.4rem", margin: 0 }}>📊 Financeiro</h1>
              <p style={{ fontSize: "0.8rem", color: "#64748B", margin: 0 }}>{storeName}</p>
            </div>

            {mostraPeriodo && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                {ATALHOS_DO_FINANCEIRO.map((a) => (
                  <button key={a.chave}
                    onClick={() => { const p = periodoDoFinanceiro(a.chave, hoje); mudarPeriodo(p.de, p.ate); }}
                    style={{
                      padding: "6px 12px", borderRadius: 10, border: "none", cursor: "pointer",
                      fontWeight: 700, fontSize: "0.78rem", fontFamily: "inherit",
                      background: atalhoAtivo === a.chave ? "#0F172A" : "#F1F5F9",
                      color: atalhoAtivo === a.chave ? "#fff" : "#475569",
                    }}>
                    {a.rotulo}
                  </button>
                ))}
                <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                  <input type="date" value={periodo.de} max={hoje} aria-label="De"
                    onChange={(e) => e.target.value && mudarPeriodo(e.target.value, periodo.ate)}
                    style={{ padding: "5px 8px", borderRadius: 8, border: `1.5px solid ${atalhoAtivo ? "#E2E8F0" : "#0F172A"}`, fontSize: "0.78rem" }} />
                  <span style={{ fontSize: "0.75rem", color: "#94A3B8" }}>até</span>
                  <input type="date" value={periodo.ate} max={hoje} aria-label="Até"
                    onChange={(e) => e.target.value && mudarPeriodo(periodo.de, e.target.value)}
                    style={{ padding: "5px 8px", borderRadius: 8, border: `1.5px solid ${atalhoAtivo ? "#E2E8F0" : "#0F172A"}`, fontSize: "0.78rem" }} />
                </div>
              </div>
            )}
          </div>
          {mostraPeriodo && (
            <p style={{ fontSize: "0.72rem", color: "#94A3B8", margin: "6px 0 0" }}>
              {carregando ? "Carregando… " : ""}
              {diaCurto(periodo.de, true)} a {diaCurto(periodo.ate, true)} · o dia vira às 5h da manhã, como no caixa e nos Relatórios
            </p>
          )}

          <div style={{ display: "flex", gap: 6, marginTop: "1rem", background: "#F1F5F9", borderRadius: 12, padding: 4, width: "fit-content", maxWidth: "100%", flexWrap: "wrap" }}>
            <button style={tabStyle("mensalidade")} onClick={() => setAba("mensalidade")}>Mensalidade</button>
            <button style={tabStyle("dre")} onClick={() => setAba("dre")}>📊 DRE Geral</button>
            <button style={tabStyle("extrato")} onClick={() => setAba("extrato")}>Extrato</button>
            <button style={tabStyle("relatorio")} onClick={() => setAba("relatorio")}>Relatório</button>
            <button style={tabStyle("contasapagar", "#C92E09")} onClick={() => setAba("contasapagar")}>🤖 Contas a Pagar (IA)</button>
            <button style={tabStyle("notascompras", "#1C1917")} onClick={() => setAba("notascompras")}>🧾 Notas de Compras</button>
            <button style={tabStyle("custosfix", "#475569")} onClick={() => setAba("custosfix")}>
              🏢 Custos Fixos {custos.length > 0 && <span style={{ background: "#475569", color: "#fff", borderRadius: 20, padding: "1px 7px", fontSize: "0.72rem", marginLeft: 4 }}>{custos.length}</span>}
            </button>
            <button style={tabStyle("configuracoes")} onClick={() => setAba("configuracoes")}>Configurações</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "1.5rem", opacity: carregando && mostraPeriodo ? 0.55 : 1, transition: "opacity .15s" }}>
        {erro && dados && mostraPeriodo && (
          <div role="alert" style={{ background: "#FEF2F2", border: "1px solid #FECACA", color: "#B71C1C", borderRadius: 12, padding: "10px 14px", marginBottom: "1rem", fontSize: "0.84rem", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span>{erro} Os números abaixo ainda são de {diaCurto(dados.de, true)} a {diaCurto(dados.ate, true)}.</span>
            <button onClick={() => carregar(periodo.de, periodo.ate)} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid #FECACA", background: "#fff", color: "#B71C1C", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              Tentar de novo
            </button>
          </div>
        )}

        {aba === "mensalidade" && <AbaMensalidade ciclo={cicloInicial} tz={inicio.tz} />}

        {aba === "dre" && (dre && dados
          ? <AbaDRE dre={dre} de={dados.de} ate={dados.ate} comissoes={comissoes} produtosSemCusto={produtosSemCusto}
              despesas={despesas} onDespesas={setDespesas} irPara={(a) => setAba(a)} />
          : semDados)}

        {aba === "extrato" && (dados ? <AbaExtrato dados={dados} comissoes={comissoes} repasseConfig={initialRepasseConfig} /> : semDados)}

        {(aba === "relatorio" || aba === "pagamentos") && (dados && dre ? <AbaRelatorio dados={dados} dre={dre} /> : semDados)}

        {aba === "configuracoes" && (
          <AbaConfiguracoes comissoes={comissoes} onComissoes={setComissoes} dre={dre} repasseConfig={initialRepasseConfig} />
        )}

        {aba === "custosfix" && <AbaCustosFixos custos={custos} onCustos={setCustos} dre={dre} />}

        {/* Antes esta aba tinha só o <FinanceForm />: o lojista lançava a conta e
            não via nada. Quem manda é o ContasAPagarClient (atrasadas / hoje /
            futuras), no fuso da loja. */}
        {aba === "contasapagar" && <ContasAPagarClient payables={payables} fuso={inicio.tz} />}

        {aba === "notascompras" && (
          <div style={{ maxWidth: 1200, margin: "0 auto" }}>
            <AjudaModulo
              icone="🧾"
              titulo="Notas de Compras"
              oQueE="É o arquivo das notas e cupons de tudo o que a sua loja COMPRA — carne, embalagem, bebida, material de limpeza."
              paraQueServe="Guardando as notas aqui, você tem o histórico do que comprou, de quem e por quanto, para conferir preço de fornecedor e achar o comprovante quando precisar."
              aviso="As notas NÃO entram no DRE: o custo do DRE vem do custo cadastrado em cada produto do cardápio (CMV) e das despesas lançadas. Somar as compras também contaria o mesmo gasto duas vezes. O boleto que ainda vai vencer entra na aba Contas a Pagar."
              passos={[
                { titulo: "Tire a foto", texto: "fotografe a nota ou o cupom direto do celular, ainda no balcão de recebimento da mercadoria." },
                { titulo: "A IA lê sozinha", texto: "ela identifica o valor e a categoria da compra. Você só confere se ficou certo." },
                { titulo: "Confirme", texto: "conferida, a nota fica guardada no histórico de compras da loja." },
              ]}
            />
            <InvoicesClient role={papel || "FRANCHISEE"} canSeePersonal={false} />
          </div>
        )}
      </div>
    </div>
  );
}
