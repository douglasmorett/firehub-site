"use client";
/**
 * "Acertar com o motoboy", no pé do cartão dele no relatório (Motoboys →
 * Relatório de Pagamentos). Pedido do Douglas, 19/10/2026:
 *
 *   - Acertar: confirma o total da tela como PAGO, com a opção de abater o
 *     fiado em aberto (vira baixa no Fiado e sai do que a loja paga).
 *   - Depois de pago, todo filtro que alcança aqueles dias — até um dia
 *     sozinho — mostra em grande que já foi pago, e o botão some.
 *   - Desfazer volta tudo (inclusive a baixa do fiado).
 *
 * Gravação em lib/acerto-pago.ts; os dias pagos chegam no relatório
 * (lib/relatorio-do-entregador.ts: acertosPagos, diasPagos).
 *
 * Escala da equipe (Douglas, 12/11/2026: "onde faz com o motoboy? Coloca lá
 * também"): o Pix que o motoboy deu na escala aparece aqui com "Copiar Pix", e
 * se a escala já marcou pagamento dele em dias deste período, o aviso diz
 * quanto — para não pagar o mesmo dia duas vezes. A conta do acerto não muda.
 */
import { useState } from "react";
import type { Aviso } from "@/components/mesas/SelecionarItensParaImpressao";
import { comSenhaDoGerente, useSenhaDoGerente } from "@/components/SenhaDoGerente";
import { ROTULO_DO_PIX, pixFormatado, pixParaCopiar, tipoDaChave } from "@/lib/escala-da-equipe/regras";

/** O que a Escala da equipe sabe deste motoboy no período (api/motoboy-report/escala). */
export type EscalaNoAcerto = { pix: string | null; pixTipo: string | null; pixOrigem: string | null; pago: number; dias: string[] };

async function copiarTexto(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true; } catch {
    try {
      const t = document.createElement("textarea");
      t.value = texto; t.style.position = "fixed"; t.style.opacity = "0";
      document.body.appendChild(t); t.select();
      const ok = document.execCommand("copy");
      t.remove();
      return ok;
    } catch { return false; }
  }
}

const fmt = (v: number) => `R$ ${(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const diaCurto = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export default function AcertoPago({ motoboyId, nome, de, ate, diasTrabalhados, diasPagos, acertos, total, fiadoEmAberto, tz, avisar, aoMudar, escala = null }: {
  motoboyId: string;
  nome: string;
  /** O período da tela (dias do expediente). */
  de: string;
  ate: string;
  diasTrabalhados: string[];
  diasPagos: string[];
  acertos: { id: string; dias: string[]; valorDoAcerto: number; fiadoAbatido: number; valorPago: number; criadoPor: string | null; em: string }[];
  /** O TOTAL que o cartão mostra. */
  total: number;
  fiadoEmAberto: number;
  tz: string;
  avisar: (a: Aviso) => void;
  aoMudar: () => Promise<void> | void;
  escala?: EscalaNoAcerto | null;
}) {
  const [aberto, setAberto] = useState(false);
  const [abater, setAbater] = useState(fiadoEmAberto > 0);
  const [enviando, setEnviando] = useState(false);
  const { pedirSenha, modalDaSenha } = useSenhaDoGerente();

  const faltam = diasTrabalhados.filter((d) => !diasPagos.includes(d));
  const tudoPago = diasTrabalhados.length > 0 && faltam.length === 0;
  const abatido = abater ? Math.min(fiadoEmAberto, total) : 0;
  const aPagar = Math.round((total - abatido) * 100) / 100;

  const confirmar = async () => {
    setEnviando(true);
    try {
      const res = await fetch("/api/motoboy-report/acerto", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ motoboyId, de, ate, dias: diasTrabalhados, valorDoAcerto: total, abaterFiado: abater }),
      });
      const dados = await res.json().catch(() => ({}));
      if (!res.ok) { avisar({ tipo: "erro", titulo: dados?.error || "Não deu para marcar agora." }); return; }
      avisar({ tipo: "ok", titulo: `Acerto de ${nome} marcado como pago: ${fmt(dados.acerto.valorPago)}.` });
      setAberto(false);
      await aoMudar();
    } catch {
      avisar({ tipo: "erro", titulo: "Sem conexão. Tente de novo." });
    } finally {
      setEnviando(false);
    }
  };

  const desfazer = async (id: string) => {
    if (!window.confirm("Desfazer este acerto? Ele volta a aparecer como não pago e a baixa do fiado (se teve) é apagada.")) return;
    const res = await comSenhaDoGerente(
      (cab) => fetch(`/api/motoboy-report/acerto?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: cab }),
      pedirSenha,
    ).catch(() => null);
    if (res === null) return; // o gerente cancelou
    const dados = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) { avisar({ tipo: "erro", titulo: dados?.error || "Não deu para desfazer agora." }); return; }
    avisar({ tipo: "ok", titulo: "Acerto desfeito." });
    await aoMudar();
  };

  const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const tipoDoPix = escala?.pix ? tipoDaChave(escala.pix, escala.pixTipo) : null;

  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
      {modalDaSenha}
      {acertos.length > 0 && (
        <div style={{
          border: `3px solid ${tudoPago ? "#059669" : "#D97706"}`, background: tudoPago ? "#ECFDF5" : "#FFFBEB",
          borderRadius: 14, padding: "14px 16px", textAlign: "center",
        }}>
          <div style={{ fontSize: "1.5rem", fontWeight: 900, color: tudoPago ? "#047857" : "#B45309", letterSpacing: 0.5 }}>
            {tudoPago ? "✅ JÁ FOI PAGO" : `⚠️ ${diasPagos.length} DE ${diasTrabalhados.length} DIAS JÁ PAGOS`}
          </div>
          {!tudoPago && (
            <div style={{ fontSize: "0.8rem", color: "#92400E", marginTop: 4 }}>
              Faltam: {faltam.map(diaCurto).join(", ")} — o total acima soma os dias pagos também.
            </div>
          )}
          {acertos.map((a) => (
            <div key={a.id} style={{ fontSize: "0.8rem", color: "#334155", marginTop: 8, lineHeight: 1.5 }}>
              Pago em <b>{quando(a.em)}</b>{a.criadoPor ? ` por ${a.criadoPor}` : ""} · dias {a.dias.length > 3 ? `${diaCurto(a.dias[0])} a ${diaCurto(a.dias[a.dias.length - 1])}` : a.dias.map(diaCurto).join(", ")}
              <br />
              Acerto {fmt(a.valorDoAcerto)}{a.fiadoAbatido > 0 ? ` − fiado ${fmt(a.fiadoAbatido)}` : ""} = <b>{fmt(a.valorPago)} pago</b>
              {" · "}
              <button type="button" onClick={() => desfazer(a.id)} style={{ background: "none", border: "none", color: "#B91C1C", textDecoration: "underline", cursor: "pointer", fontSize: "0.78rem", fontFamily: "inherit", padding: 0 }}>
                desfazer
              </button>
            </div>
          ))}
        </div>
      )}

      {escala && escala.pago > 0 && (
        <div style={{ border: "1.5px solid #FDE68A", background: "#FFFBEB", borderRadius: 12, padding: "10px 12px", fontSize: "0.82rem", color: "#92400E", lineHeight: 1.45 }}>
          ⚠️ Na escala já constam <b>{fmt(escala.pago)}</b> pagos a {nome} em {escala.dias.length} dia{escala.dias.length === 1 ? "" : "s"} deste período
          ({escala.dias.map(diaCurto).join(", ")}). Confira antes de acertar, para não pagar em dobro.
        </div>
      )}

      {escala?.pix && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", border: "1px solid #E2E8F0", borderRadius: 12, padding: "8px 12px", background: "#F8FAFC" }}>
          <span style={{ fontSize: "0.8rem", color: "#475569", flex: 1, minWidth: 0 }}>
            Pix de {nome}{tipoDoPix ? ` (${ROTULO_DO_PIX[tipoDoPix]})` : ""}: <b style={{ color: "#0F172A" }}>{pixFormatado(escala.pix, escala.pixTipo)}</b>
            {escala.pixOrigem === "troca-link" && <span style={{ display: "block", color: "#B45309", fontWeight: 700 }}>Chave trocada pelo link da escala — confirme com ele antes de pagar.</span>}
          </span>
          <button type="button" onClick={async () => avisar(await copiarTexto(pixParaCopiar(escala.pix!, escala.pixTipo)) ? { tipo: "ok", titulo: `Pix de ${nome} copiado` } : { tipo: "erro", titulo: "Não deu para copiar. Selecione a chave e copie." })}
            style={{ padding: "6px 12px", borderRadius: 9, border: "1.5px solid #059669", background: "#fff", color: "#047857", fontWeight: 800, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>
            📋 Copiar Pix
          </button>
        </div>
      )}

      {!tudoPago && diasTrabalhados.length > 0 && !aberto && (
        <button type="button" onClick={() => { setAbater(fiadoEmAberto > 0); setAberto(true); }}
          disabled={diasPagos.length > 0}
          title={diasPagos.length > 0 ? "Filtre só os dias que faltam para acertar o resto" : undefined}
          style={{
            width: "100%", padding: "12px 16px", borderRadius: 12, border: "none", fontFamily: "inherit",
            background: diasPagos.length > 0 ? "#CBD5E1" : "#059669", color: "#fff", fontWeight: 900, fontSize: "0.95rem",
            cursor: diasPagos.length > 0 ? "default" : "pointer",
          }}>
          💵 Acertar com {nome}
        </button>
      )}

      {aberto && (
        <div style={{ border: "2px solid #059669", borderRadius: 14, padding: 14, background: "#fff", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontWeight: 900, color: "#065F46" }}>💵 Acertar com {nome} — {de === ate ? diaCurto(de) : `${diaCurto(de)} a ${diaCurto(ate)}`}</div>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.88rem" }}>
            <span>Total do acerto</span><b>{fmt(total)}</b>
          </div>
          {fiadoEmAberto > 0 ? (
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.88rem", cursor: "pointer", color: "#6D28D9" }}>
              <input type="checkbox" checked={abater} onChange={(e) => setAbater(e.target.checked)} style={{ width: 18, height: 18 }} />
              <span style={{ flex: 1 }}>Abater o fiado em aberto ({fmt(fiadoEmAberto)})</span>
              {abater && <b>− {fmt(abatido)}</b>}
            </label>
          ) : (
            <div style={{ fontSize: "0.78rem", color: "#64748B" }}>Sem fiado em aberto.</div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "1.05rem", fontWeight: 900, borderTop: "2px solid #065F46", paddingTop: 8 }}>
            <span>PAGAR AO MOTOBOY</span><span style={{ color: "#047857" }}>{fmt(aPagar)}</span>
          </div>
          {abater && abatido > 0 && (
            <div style={{ fontSize: "0.74rem", color: "#64748B" }}>O fiado abatido entra como baixa na tela Fiado.</div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" onClick={() => setAberto(false)} disabled={enviando}
              style={{ flex: 1, padding: 10, borderRadius: 10, border: "1.5px solid #CBD5E1", background: "#fff", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
              Voltar
            </button>
            <button type="button" onClick={confirmar} disabled={enviando}
              style={{ flex: 2, padding: 10, borderRadius: 10, border: "none", background: "#059669", color: "#fff", fontWeight: 900, cursor: "pointer", fontFamily: "inherit" }}>
              {enviando ? "Marcando..." : `Confirmar: pago ${fmt(aPagar)}`}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
