"use client";

/**
 * ContasAPagarClient — a tela de contas a pagar do lojista.
 *
 * Antes desta tela a aba tinha SÓ o formulário: quem lançava um boleto via
 * "Conta registrada com sucesso!" e não via a conta em lugar nenhum. Não era
 * bug de filtro — não existia listagem, e o servidor nem buscava os `Payable`.
 *
 * O recorte é o mesmo do Portal Hakim, que é o modelo pedido:
 *   🔴 Atrasadas   vencimento < hoje
 *   🟡 Vencem hoje vencimento = hoje
 *   🟢 Futuras     vencimento > hoje
 *
 * ── POR QUE COMPARAR TEXTO E NÃO Date ─────────────────────────────────────
 * `dueDate` chega como "YYYY-MM-DD" e "hoje" é calculado com timeZone
 * America/Sao_Paulo. Comparar string com string mantém o dia como DIA. Com
 * `new Date(dueDate)` o navegador leria meia-noite UTC, que em UTC-3 é 21h do
 * dia anterior: toda conta apareceria vencendo um dia antes, e a que vence
 * hoje cairia em "atrasadas" — justamente o erro que o lojista veria primeiro.
 */

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { markPayableAsPaid, deletePayable } from "@/app/actions/finance";
import FinanceForm from "@/components/FinanceForm";

export type PayableDTO = {
  id: string;
  supplierName: string;
  value: number;
  status: string;
  category: string;
  paymentType: string | null;
  barcode: string | null;
  dueDate: string;          // YYYY-MM-DD
  receivedDate: string | null;
  paidDate: string | null;
};

const fmtR = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

/** Formata sem passar por Date, para o dia não escorregar por fuso. */
const fmtData = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

/** Quantos dias entre duas datas YYYY-MM-DD, contando em dias inteiros. */
const diasEntre = (a: string, b: string) =>
  Math.round((Date.parse(b + "T12:00:00") - Date.parse(a + "T12:00:00")) / 86400000);

export default function ContasAPagarClient({ payables }: { payables: PayableDTO[] }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [mostrarPagas, setMostrarPagas] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState<string | null>(null);

  const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

  const { atrasadas, hojeLista, futuras, pagas, totalAberto } = useMemo(() => {
    const pend = payables.filter((p) => p.status === "PENDING");
    const atrasadas = pend.filter((p) => p.dueDate < hoje);
    const hojeLista = pend.filter((p) => p.dueDate === hoje);
    const futuras = pend.filter((p) => p.dueDate > hoje);
    const pagas = payables
      .filter((p) => p.status === "PAID")
      .sort((a, b) => (b.paidDate || b.dueDate).localeCompare(a.paidDate || a.dueDate));
    return {
      atrasadas, hojeLista, futuras, pagas,
      totalAberto: pend.reduce((s, p) => s + p.value, 0),
    };
  }, [payables, hoje]);

  const soma = (l: PayableDTO[]) => l.reduce((s, p) => s + p.value, 0);

  async function pagar(id: string) {
    setOcupado(id);
    try {
      await markPayableAsPaid(id);
      router.refresh();
    } catch {
      alert("Não foi possível dar baixa nesta conta. Tente de novo.");
    } finally {
      setOcupado(null);
    }
  }

  async function excluir(id: string) {
    setOcupado(id);
    try {
      await deletePayable(id);
      setConfirmarExclusao(null);
      router.refresh();
    } catch {
      alert("Não foi possível excluir esta conta. Tente de novo.");
    } finally {
      setOcupado(null);
    }
  }

  // ── Cartão de uma conta ────────────────────────────────────────────────────
  const Conta = ({ p, cor }: { p: PayableDTO; cor: string }) => {
    const dias = diasEntre(hoje, p.dueDate);
    const legenda =
      p.status === "PAID" ? `Pago em ${p.paidDate ? fmtData(p.paidDate) : "—"}`
      : dias === 0 ? "Vence hoje"
      : dias < 0 ? `Atrasada há ${Math.abs(dias)} ${Math.abs(dias) === 1 ? "dia" : "dias"}`
      : `Faltam ${dias} ${dias === 1 ? "dia" : "dias"}`;

    return (
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center",
        padding: "14px 16px", borderRadius: 14, background: "#fff",
        border: "1px solid #E2E8F0", borderLeft: `4px solid ${cor}`,
      }}>
        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
          <div style={{ fontWeight: 800, color: "#0F172A", fontSize: "0.95rem" }}>
            {p.supplierName}
          </div>
          <div style={{ fontSize: "0.78rem", color: "#64748B", marginTop: 3 }}>
            Vence {fmtData(p.dueDate)} · <span style={{ color: cor, fontWeight: 700 }}>{legenda}</span>
          </div>
        </div>

        <div style={{ fontWeight: 900, fontSize: "1.05rem", color: "#0F172A", whiteSpace: "nowrap" }}>
          {fmtR(p.value)}
        </div>

        {p.status === "PENDING" && (
          <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => pagar(p.id)}
              disabled={ocupado === p.id}
              title="Dar baixa: marca esta conta como paga e tira ela da lista de pendentes"
              style={{
                background: "#059669", color: "#fff", border: "none", borderRadius: 10,
                padding: "8px 14px", fontWeight: 800, fontSize: "0.8rem",
                cursor: ocupado === p.id ? "wait" : "pointer", whiteSpace: "nowrap",
              }}
            >
              {ocupado === p.id ? "..." : "✓ Já paguei"}
            </button>
            <button
              onClick={() => setConfirmarExclusao(p.id)}
              disabled={ocupado === p.id}
              title="Excluir este lançamento"
              style={{
                background: "#fff", color: "#94A3B8", border: "1px solid #E2E8F0",
                borderRadius: 10, padding: "8px 11px", fontWeight: 800,
                fontSize: "0.8rem", cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>
        )}

        {confirmarExclusao === p.id && (
          <div style={{
            flexBasis: "100%", display: "flex", gap: 8, alignItems: "center",
            background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 10,
            padding: "10px 12px", fontSize: "0.82rem", color: "#991B1B",
          }}>
            <span style={{ flex: 1 }}>Excluir <strong>{p.supplierName}</strong>? Isso apaga o lançamento de vez.</span>
            <button onClick={() => excluir(p.id)}
              style={{ background: "#DC2626", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontWeight: 800, cursor: "pointer", fontSize: "0.78rem" }}>
              Sim, excluir
            </button>
            <button onClick={() => setConfirmarExclusao(null)}
              style={{ background: "#fff", color: "#475569", border: "1px solid #E2E8F0", borderRadius: 8, padding: "6px 12px", fontWeight: 700, cursor: "pointer", fontSize: "0.78rem" }}>
              Cancelar
            </button>
          </div>
        )}
      </div>
    );
  };

  // ── Bloco (atrasadas / hoje / futuras) ─────────────────────────────────────
  const Bloco = ({ titulo, explicacao, lista, cor, fundo, vazio }: {
    titulo: string; explicacao: string; lista: PayableDTO[];
    cor: string; fundo: string; vazio: string;
  }) => (
    <section style={{ marginBottom: 24 }}>
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 10, alignItems: "baseline",
        justifyContent: "space-between", marginBottom: 4,
      }}>
        <h3 style={{ margin: 0, fontSize: "1rem", fontWeight: 900, color: cor }}>
          {titulo} <span style={{ color: "#94A3B8", fontWeight: 700 }}>({lista.length})</span>
        </h3>
        {lista.length > 0 && (
          <span style={{ fontWeight: 900, color: cor, fontSize: "0.95rem" }}>{fmtR(soma(lista))}</span>
        )}
      </div>
      <p style={{ margin: "0 0 10px", fontSize: "0.79rem", color: "#64748B", lineHeight: 1.5 }}>
        {explicacao}
      </p>

      {lista.length === 0 ? (
        <div style={{
          background: fundo, border: `1px dashed ${cor}44`, borderRadius: 14,
          padding: "18px 16px", textAlign: "center", fontSize: "0.84rem", color: "#64748B",
        }}>
          {vazio}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {lista.map((p) => <Conta key={p.id} p={p} cor={cor} />)}
        </div>
      )}
    </section>
  );

  const Kpi = ({ rotulo, valor, qtd, cor, fundo, dica }: {
    rotulo: string; valor: number; qtd: number; cor: string; fundo: string; dica: string;
  }) => (
    <div title={dica} style={{
      background: fundo, border: `1px solid ${cor}33`, borderRadius: 16,
      padding: "14px 16px", flex: "1 1 150px",
    }}>
      <div style={{ fontSize: "0.74rem", fontWeight: 800, color: cor, letterSpacing: 0.2 }}>{rotulo}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "#0F172A", marginTop: 2 }}>{fmtR(valor)}</div>
      <div style={{ fontSize: "0.74rem", color: "#64748B", marginTop: 2 }}>
        {qtd} {qtd === 1 ? "conta" : "contas"}
      </div>
    </div>
  );

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "1.25rem 1rem 3rem" }}>

      {/* ── O QUE É ESTA TELA ─────────────────────────────────────────────── */}
      <div style={{ marginBottom: 18 }}>
        <h2 style={{ fontSize: "1.4rem", fontWeight: 900, color: "#0F172A", margin: "0 0 6px" }}>
          💸 Contas a Pagar
        </h2>
        <p style={{ fontSize: "0.87rem", color: "#475569", margin: 0, lineHeight: 1.6 }}>
          Aqui ficam os boletos e as contas dos seus fornecedores. Lance uma vez e a conta aparece
          sozinha na fila certa conforme a data de vencimento chega — assim você <strong>não perde
          vencimento nem paga juros por esquecimento</strong>. Quando pagar, clique em
          “<strong>✓ Já paguei</strong>” para dar baixa.
        </p>
      </div>

      {/* ── RESUMO ────────────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 20 }}>
        <Kpi rotulo="ATRASADAS" valor={soma(atrasadas)} qtd={atrasadas.length}
             cor="#DC2626" fundo="#FEF2F2"
             dica="Contas cujo vencimento já passou. Pague o quanto antes para evitar juros e multa." />
        <Kpi rotulo="VENCEM HOJE" valor={soma(hojeLista)} qtd={hojeLista.length}
             cor="#D97706" fundo="#FFFBEB"
             dica="Contas que vencem hoje. Se o boleto não for pago até o fim do dia, amanhã ele entra em atrasadas." />
        <Kpi rotulo="FUTURAS" valor={soma(futuras)} qtd={futuras.length}
             cor="#059669" fundo="#F0FDF4"
             dica="Contas já lançadas que ainda vão vencer. Servem para você se programar." />
        <Kpi rotulo="TOTAL EM ABERTO" valor={totalAberto} qtd={atrasadas.length + hojeLista.length + futuras.length}
             cor="#334155" fundo="#F8FAFC"
             dica="Tudo o que a loja ainda deve: atrasadas + de hoje + futuras." />
      </div>

      {/* ── LANÇAR CONTA ──────────────────────────────────────────────────── */}
      <div style={{
        background: "#fff", border: "1px solid #E2E8F0", borderRadius: 18,
        padding: mostrarForm ? "20px" : "14px 18px", marginBottom: 24,
        boxShadow: "0 6px 20px rgba(0,0,0,0.03)",
      }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ flex: "1 1 260px" }}>
            <div style={{ fontWeight: 900, color: "#0F172A", fontSize: "0.98rem" }}>
              ➕ Lançar uma conta nova
            </div>
            <div style={{ fontSize: "0.79rem", color: "#64748B", marginTop: 3, lineHeight: 1.5 }}>
              Tire uma foto do boleto e a IA preenche fornecedor, valor e vencimento sozinha.
              Se preferir, dá para digitar na mão.
            </div>
          </div>
          <button
            onClick={() => setMostrarForm((v) => !v)}
            style={{
              background: mostrarForm ? "#fff" : "#0F172A",
              color: mostrarForm ? "#475569" : "#fff",
              border: mostrarForm ? "1px solid #E2E8F0" : "none",
              borderRadius: 12, padding: "11px 20px", fontWeight: 800,
              fontSize: "0.85rem", cursor: "pointer", whiteSpace: "nowrap",
            }}
          >
            {mostrarForm ? "Fechar" : "Lançar conta"}
          </button>
        </div>

        {mostrarForm && (
          <div style={{ marginTop: 18, paddingTop: 18, borderTop: "1px solid #F1F5F9" }}>
            <FinanceForm category="BUSINESS" onSaved={() => { setMostrarForm(false); router.refresh(); }} />
          </div>
        )}
      </div>

      {/* ── AS TRÊS FILAS ─────────────────────────────────────────────────── */}
      <Bloco
        titulo="🔴 Atrasadas"
        cor="#DC2626" fundo="#FEF2F2"
        explicacao="O vencimento já passou. São as que costumam gerar juros e multa — resolva estas primeiro."
        lista={atrasadas}
        vazio="Nenhuma conta atrasada. Sua loja está em dia. 🎉"
      />

      <Bloco
        titulo="🟡 Vencem hoje"
        cor="#D97706" fundo="#FFFBEB"
        explicacao="Precisam ser pagas até o fim do dia de hoje. Amanhã elas passam para a fila das atrasadas."
        lista={hojeLista}
        vazio="Nada vencendo hoje."
      />

      <Bloco
        titulo="🟢 Futuras"
        cor="#059669" fundo="#F0FDF4"
        explicacao="Ainda vão vencer. Use esta lista para se programar e saber quanto vai sair do caixa nos próximos dias."
        lista={futuras}
        vazio="Nenhuma conta futura lançada ainda."
      />

      {/* ── HISTÓRICO ─────────────────────────────────────────────────────── */}
      <section>
        <button
          onClick={() => setMostrarPagas((v) => !v)}
          style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%",
            background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 14,
            padding: "12px 16px", cursor: "pointer", textAlign: "left",
          }}
        >
          <span style={{ fontWeight: 800, color: "#334155", fontSize: "0.92rem" }}>
            ✅ Contas já pagas ({pagas.length})
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ color: "#64748B", fontWeight: 800, fontSize: "0.85rem" }}>
            {mostrarPagas ? "ocultar ▲" : "ver histórico ▼"}
          </span>
        </button>

        {mostrarPagas && (
          <div style={{ marginTop: 12 }}>
            <p style={{ fontSize: "0.79rem", color: "#64748B", margin: "0 0 10px", lineHeight: 1.5 }}>
              Tudo o que já foi quitado. Serve de comprovante do que saiu do caixa e de histórico
              para conferir com o extrato do banco.
            </p>
            {pagas.length === 0 ? (
              <div style={{ background: "#F8FAFC", border: "1px dashed #CBD5E1", borderRadius: 14, padding: "18px", textAlign: "center", fontSize: "0.84rem", color: "#64748B" }}>
                Nenhuma conta paga ainda. Quando você clicar em “✓ Já paguei”, ela aparece aqui.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {pagas.map((p) => <Conta key={p.id} p={p} cor="#94A3B8" />)}
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
