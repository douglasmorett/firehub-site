"use client";
/**
 * Os ajustes à mão no acerto de um motoboy, dentro do cartão dele no relatório
 * (Motoboys → Relatório de Pagamentos):
 *
 *   - DiariasPorDia: a diária de cada dia trabalhado. Clica no valor do dia,
 *     muda e Salvar — muda só aquele dia daquele motoboy; "voltar ao padrão"
 *     devolve a diária do cadastro.
 *   - PendenciasDoMotoboy: "Lançar pendência" (valor + motivo + data) e a lista
 *     das lançadas, com Excluir. O valor sai do total a pagar.
 *   - OpcaoCartaoEVale: o interruptor da LOJA que junta débito, crédito e
 *     voucher num quadrado só na conferência.
 *
 * Pedido do Douglas para a Delícia de Casa (15/10/2026). A conta é do servidor
 * (lib/relatorio-do-entregador.ts): depois de salvar, a tela relê o relatório
 * — o mesmo número chega ao app do motoboy e ao Acerto de entregadores.
 */
import { useState, type CSSProperties } from "react";
import type { Aviso } from "@/components/mesas/SelecionarItensParaImpressao";
import type { DiariaDoDia, PendenciaDoAcerto } from "@/lib/ajustes-do-acerto-regras";
import { lerValorEmReais } from "@/lib/ajustes-do-acerto-regras";
import { comSenhaDoGerente, useSenhaDoGerente } from "@/components/SenhaDoGerente";

const fmt = (v: number) => `R$ ${(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
/** "2026-10-15" → "qua 15/10" (o dia do expediente já vem pronto do servidor). */
const nomeDoDia = (dia: string) => `${DIAS[new Date(`${dia}T12:00:00Z`).getUTCDay()]} ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const paraCampo = (v: number) => (v || 0).toFixed(2).replace(".", ",");

const botao = (cor: string, cheio = false): CSSProperties => ({
  padding: "4px 10px", borderRadius: 7, border: `1.5px solid ${cor}`, background: cheio ? cor : "#fff",
  color: cheio ? "#fff" : cor, fontWeight: 800, fontSize: "0.74rem", cursor: "pointer", fontFamily: "inherit", whiteSpace: "nowrap",
});

async function enviar(url: string, init: RequestInit): Promise<{ ok: true; dados: any } | { ok: false; erro: string }> {
  try {
    const res = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init.headers || {}) } });
    const dados = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, erro: dados?.error || "Não deu para salvar agora." };
    return { ok: true, dados };
  } catch {
    return { ok: false, erro: "Sem conexão. Tente de novo." };
  }
}

// ── Diária de cada dia ────────────────────────────────────────────────────

export function DiariasPorDia({ motoboyId, diarias, avisar, aoMudar }: {
  motoboyId: string;
  diarias: DiariaDoDia[];
  avisar: (a: Aviso) => void;
  /** Relê o relatório (a conta é do servidor). */
  aoMudar: () => Promise<void> | void;
}) {
  const [editando, setEditando] = useState<string | null>(null);
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState<string | null>(null);

  const abrir = (d: DiariaDoDia) => { setEditando(d.dia); setTexto(paraCampo(d.valor)); };

  const salvar = async (d: DiariaDoDia) => {
    const valor = lerValorEmReais(texto);
    if (valor === null) return avisar({ tipo: "atencao", titulo: "Digite o valor da diária", detalhe: "Ex.: 40,00 — zero vale para dia sem diária." });
    setSalvando(d.dia);
    const r = await enviar("/api/motoboy-report/diaria", { method: "PUT", body: JSON.stringify({ motoboyId, dia: d.dia, valor }) });
    setSalvando(null);
    if (!r.ok) return avisar({ tipo: "erro", titulo: "Diária não foi salva", detalhe: r.erro });
    setEditando(null);
    await aoMudar();
    avisar({ tipo: "ok", titulo: `Diária de ${nomeDoDia(d.dia)}: ${fmt(valor)}`, detalhe: "Só este dia mudou — o cadastro do motoboy continua igual." });
  };

  const voltar = async (d: DiariaDoDia) => {
    setSalvando(d.dia);
    const r = await enviar(`/api/motoboy-report/diaria?motoboyId=${encodeURIComponent(motoboyId)}&dia=${d.dia}`, { method: "DELETE" });
    setSalvando(null);
    if (!r.ok) return avisar({ tipo: "erro", titulo: "Não voltou ao padrão", detalhe: r.erro });
    setEditando(null);
    await aoMudar();
    avisar({ tipo: "ok", titulo: `${nomeDoDia(d.dia)} voltou para a diária do cadastro (${fmt(d.padrao)})` });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, margin: "6px 0 4px", padding: "8px 10px", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10 }}>
      <div style={{ fontSize: "0.7rem", color: "#64748B", fontWeight: 600, marginBottom: 2 }}>
        Clique no valor de um dia para mudar a diária só daquele dia. O cadastro do motoboy não muda.
      </div>
      {diarias.map((d) => {
        const aberto = editando === d.dia;
        return (
          <div key={d.dia} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap", fontSize: "0.8rem", padding: "3px 0", borderBottom: "1px dashed #E2E8F0" }}>
            <span style={{ fontWeight: 700, color: "#334155", minWidth: 80 }}>
              {nomeDoDia(d.dia)}
              {d.ajustada && (
                <span title={d.ajustadaPor ? `Ajustada por ${d.ajustadaPor}` : "Ajustada pela loja"}
                  style={{ marginLeft: 6, background: "#FEF3C7", color: "#92400E", border: "1px solid #FDE68A", padding: "0 6px", borderRadius: 4, fontWeight: 800, fontSize: "0.64rem" }}>
                  AJUSTADA
                </span>
              )}
            </span>
            {aberto ? (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                <span style={{ fontSize: "0.76rem", color: "#64748B" }}>R$</span>
                <input autoFocus value={texto} inputMode="decimal" onChange={(e) => setTexto(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") salvar(d); if (e.key === "Escape") setEditando(null); }}
                  aria-label={`Diária de ${nomeDoDia(d.dia)}`}
                  style={{ width: 80, padding: "4px 8px", borderRadius: 7, border: "1.5px solid #C92E09", fontSize: "0.82rem", fontFamily: "inherit", textAlign: "right" }} />
                <button type="button" disabled={salvando === d.dia} onClick={() => salvar(d)} style={botao("#C92E09", true)}>
                  {salvando === d.dia ? "Salvando…" : "Salvar"}
                </button>
                <button type="button" onClick={() => setEditando(null)} style={botao("#64748B")}>Cancelar</button>
                {d.ajustada && (
                  <button type="button" disabled={salvando === d.dia} onClick={() => voltar(d)} style={botao("#0F766E")} title={`Volta para ${fmt(d.padrao)}`}>
                    Voltar ao padrão
                  </button>
                )}
              </span>
            ) : (
              <button type="button" onClick={() => abrir(d)} title="Clique para mudar a diária deste dia"
                style={{ background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", display: "inline-flex", alignItems: "center", gap: 6 }}>
                {d.ajustada && <span style={{ textDecoration: "line-through", color: "#94A3B8", fontSize: "0.76rem" }}>{fmt(d.padrao)}</span>}
                <span style={{ fontWeight: 800, color: d.ajustada ? "#92400E" : "#0F172A", fontVariantNumeric: "tabular-nums" }}>{fmt(d.valor)}</span>
                <span aria-hidden style={{ fontSize: "0.72rem", opacity: 0.6 }}>✏️</span>
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Pendências ────────────────────────────────────────────────────────────

export function PendenciasDoMotoboy({ motoboyId, nome, pendencias, total, diaSugerido, de, ate, avisar, aoMudar }: {
  motoboyId: string;
  nome: string;
  pendencias: PendenciaDoAcerto[];
  total: number;
  /** A data que o formulário já traz (hoje, ou o último dia do período). */
  diaSugerido: string;
  /** O período do relatório na tela — para avisar quando a data cai fora dele. */
  de: string;
  ate: string;
  avisar: (a: Aviso) => void;
  aoMudar: () => Promise<void> | void;
}) {
  const [aberto, setAberto] = useState(false);
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [dia, setDia] = useState(diaSugerido);
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState<string | null>(null);
  // Excluir pendência lançada pode pedir a senha do gerente (Minha Loja →
  // Senha do gerente). Quem decide é a rota; aqui só se pede e repete.
  const { pedirSenha, modalDaSenha } = useSenhaDoGerente();

  const abrir = () => { setAberto(true); setValor(""); setMotivo(""); setDia(diaSugerido); };

  const lancar = async () => {
    const v = lerValorEmReais(valor);
    if (v === null || v <= 0) return avisar({ tipo: "atencao", titulo: "Digite o valor da pendência", detalhe: "Ex.: 50,00" });
    if (motivo.trim().length < 3) return avisar({ tipo: "atencao", titulo: "Escreva o motivo", detalhe: "O motoboy vê o que foi descontado e por quê." });
    if (!dia) return avisar({ tipo: "atencao", titulo: "Escolha a data da pendência" });
    setSalvando(true);
    const r = await enviar("/api/motoboy-report/pendencias", { method: "POST", body: JSON.stringify({ motoboyId, valor: v, motivo, dia }) });
    setSalvando(false);
    if (!r.ok) return avisar({ tipo: "erro", titulo: "Pendência não foi lançada", detalhe: r.erro });
    setAberto(false);
    await aoMudar();
    const fora = dia < de || dia > ate;
    avisar(fora
      ? { tipo: "atencao", titulo: `Pendência de ${fmt(v)} lançada para ${nomeDoDia(dia)}`, detalhe: "Essa data está fora do período deste relatório: o desconto aparece no relatório que incluir esse dia." }
      : { tipo: "ok", titulo: `Pendência de ${fmt(v)} lançada para ${nome}`, detalhe: "Já saiu do total a pagar — e aparece no app do motoboy e no Acerto de entregadores." });
  };

  const excluir = async (p: PendenciaDoAcerto) => {
    if (!window.confirm(`Excluir a pendência de ${fmt(p.valor)} (${p.motivo})? O valor volta para o total a pagar.`)) return;
    setExcluindo(p.id);
    let erro: string | null = null;
    try {
      const res = await comSenhaDoGerente(
        (cab) => fetch(`/api/motoboy-report/pendencias?id=${encodeURIComponent(p.id)}`, { method: "DELETE", headers: cab }),
        pedirSenha,
      );
      if (!res) { setExcluindo(null); return; } // o gerente cancelou
      if (!res.ok) erro = (await res.json().catch(() => ({})))?.error || "Não deu para excluir agora.";
    } catch {
      erro = "Sem conexão. Tente de novo.";
    }
    setExcluindo(null);
    if (erro) return avisar({ tipo: "erro", titulo: "Pendência não foi excluída", detalhe: erro });
    await aoMudar();
    avisar({ tipo: "ok", titulo: `Pendência de ${fmt(p.valor)} excluída`, detalhe: "O valor voltou para o total a pagar." });
  };

  const campo: CSSProperties = { padding: "7px 9px", borderRadius: 8, border: "1.5px solid #E2E8F0", fontSize: "0.82rem", fontFamily: "inherit", minWidth: 0 };

  return (
    <div style={{ fontSize: "0.85rem" }}>
      {modalDaSenha}
      {pendencias.length > 0 && (
        <div style={{ marginBottom: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", color: "#B91C1C" }}>
            <span>⚠️ Pendências ({pendencias.length})</span>
            <span style={{ fontWeight: 700 }}>− {fmt(total)}</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 3, margin: "4px 0 2px", fontSize: "0.76rem", color: "#475569" }}>
            {pendencias.map((p) => (
              <div key={p.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, borderBottom: "1px dashed #F1F5F9", paddingBottom: 3 }}>
                <span>
                  <strong>{nomeDoDia(p.dia)}</strong> · {p.motivo}
                  <span style={{ color: "#94A3B8" }}>
                    {" "}· lançada {p.criadoPor ? `por ${p.criadoPor} ` : ""}em {new Date(p.em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
                  <strong style={{ color: "#B91C1C" }}>− {fmt(p.valor)}</strong>
                  <button type="button" disabled={excluindo === p.id} onClick={() => excluir(p)} title="Tirar esta pendência do acerto"
                    style={{ ...botao("#B91C1C"), padding: "2px 8px", fontSize: "0.68rem" }}>
                    {excluindo === p.id ? "…" : "Excluir"}
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {!aberto ? (
        <button type="button" onClick={abrir} style={{ ...botao("#B91C1C"), marginTop: 2 }}>
          ➖ Lançar pendência
        </button>
      ) : (
        <div style={{ background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 10, padding: 10, marginTop: 4, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ fontWeight: 800, color: "#B91C1C", fontSize: "0.82rem" }}>Lançar pendência para {nome}</div>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(90px, 120px) minmax(130px, 160px)", gap: 8 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.7rem", fontWeight: 700, color: "#64748B" }}>
              VALOR (R$)
              <input value={valor} inputMode="decimal" placeholder="50,00" autoFocus onChange={(e) => setValor(e.target.value)} style={campo} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.7rem", fontWeight: 700, color: "#64748B" }}>
              DATA
              <input type="date" value={dia} onChange={(e) => setDia(e.target.value)} style={campo} />
            </label>
          </div>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: "0.7rem", fontWeight: 700, color: "#64748B" }}>
            MOTIVO (o motoboy vê)
            <input value={motivo} maxLength={300} placeholder="Ex.: faltou R$ 50,00 no dinheiro do acerto" onChange={(e) => setMotivo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") lancar(); }} style={campo} />
          </label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" disabled={salvando} onClick={lancar} style={botao("#B91C1C", true)}>{salvando ? "Lançando…" : "Lançar e descontar"}</button>
            <button type="button" onClick={() => setAberto(false)} style={botao("#64748B")}>Cancelar</button>
          </div>
          <div style={{ fontSize: "0.7rem", color: "#7F1D1D" }}>
            O valor sai do total a pagar no relatório que incluir essa data (o do mês também). Aparece no app do motoboy e no recibo do Acerto de entregadores.
          </div>
        </div>
      )}
    </div>
  );
}

// ── Opção da loja: cartão e voucher num quadrado só ───────────────────────

export function OpcaoCartaoEVale({ ligada, podeMudar, avisar, aoMudar }: {
  ligada: boolean;
  /** Funcionário vê, mas quem muda é o dono. */
  podeMudar: boolean;
  avisar: (a: Aviso) => void;
  aoMudar: (ligada: boolean) => void;
}) {
  const [salvando, setSalvando] = useState(false);
  const alternar = async () => {
    if (!podeMudar) return avisar({ tipo: "info", titulo: "Só o dono muda esta opção" });
    setSalvando(true);
    const r = await enviar("/api/motoboy-report/opcoes", { method: "PUT", body: JSON.stringify({ juntarCartaoEVale: !ligada }) });
    setSalvando(false);
    if (!r.ok) return avisar({ tipo: "erro", titulo: "Opção não foi salva", detalhe: r.erro });
    aoMudar(!ligada);
    avisar({ tipo: "ok", titulo: !ligada ? "Débito, crédito e voucher agora somam num quadrado só" : "Débito, crédito e voucher voltaram a quadrados separados" });
  };
  return (
    <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: podeMudar ? "pointer" : "default", fontSize: "0.82rem", color: "#334155" }}>
      <button type="button" role="switch" aria-checked={ligada} disabled={salvando} onClick={alternar}
        title={podeMudar ? "Vale para todos os motoboys da loja" : "Só o dono muda esta opção"}
        style={{ flexShrink: 0, width: 40, height: 22, borderRadius: 999, border: "none", padding: 2, cursor: podeMudar ? "pointer" : "not-allowed",
          background: ligada ? "#C92E09" : "#CBD5E1", transition: "background 0.15s", opacity: salvando ? 0.6 : 1 }}>
        <span style={{ display: "block", width: 18, height: 18, borderRadius: "50%", background: "#fff", transform: `translateX(${ligada ? 18 : 0}px)`, transition: "transform 0.15s" }} />
      </button>
      <span>
        <strong>Somar Débito, Crédito e Voucher num quadrado só</strong> na conferência ("💳 Cartão / voucher").
        <span style={{ display: "block", fontSize: "0.72rem", color: "#64748B" }}>Para quem confere a maquininha como um valor só. Vale para todos os motoboys da loja.</span>
      </span>
    </label>
  );
}
