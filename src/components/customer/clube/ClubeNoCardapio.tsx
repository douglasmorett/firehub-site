"use client";

/**
 * O Clube do aplicativo na tela do cardápio (só dentro do app da loja):
 * - FaixaDoClube: abaixo do topo da loja — convite, "ativo" ou "pagamento pendente";
 * - ModalDoClube: o que o clube dá, a conta de quando ele se paga e o "Assinar";
 *   para o sócio do cartão (Asaas), a assinatura dele e o "Cancelar";
 * - ClubeNaSacola: a linha do desconto, ou quanto o pedido sairia mais barato.
 *
 * Nada flutua por cima do cardápio: tudo entra no fluxo da página.
 */
import { useState } from "react";
import { Crown, X, Check, AlertTriangle, ChevronRight, Loader2, Lock } from "lucide-react";
import type { ClubeDaLoja, SituacaoDoClube } from "./useClubeDoApp";

const reais = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;
const pct = (n: number) => `${Number.isInteger(n) ? n : String(n).replace(".", ",")}%`;
const diaMes = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
const OURO = "#F5B301";
const OURO_CLARO = "#FCD34D";

const caixa: React.CSSProperties = { maxWidth: 1200, margin: "12px auto 0", padding: "0 12px", boxSizing: "border-box" };

const noCartao = (c: ClubeDaLoja) => c.cobranca === "asaas";
const comoPaga = (c: ClubeDaLoja) => (noCartao(c) ? "no cartão de crédito · cancele quando quiser" : "cartão ou Pix Automático");

export function FaixaDoClube({
  clube,
  situacao,
  pagoAte,
  onAbrir,
  onPagar,
  cancelado = false,
  confirmando = false,
}: {
  clube: ClubeDaLoja;
  situacao: SituacaoDoClube;
  pagoAte: string | null;
  onAbrir: () => void;
  onPagar: () => void;
  cancelado?: boolean;
  confirmando?: boolean;
}) {
  if (confirmando && situacao !== "ativo") {
    return (
      <div style={caixa}>
        <div role="status" style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: 14, background: "#1C1917", color: "#fff" }}>
          <Loader2 size={20} color={OURO} style={{ animation: "girarClube 1s linear infinite", flexShrink: 0 }} />
          <style>{"@keyframes girarClube{to{transform:rotate(360deg)}}"}</style>
          <span style={{ fontSize: "0.86rem", lineHeight: 1.35 }}>
            <strong style={{ color: OURO_CLARO }}>Confirmando o seu pagamento…</strong> Assim que o cartão for aprovado, os {pct(clube.percentual)} OFF entram sozinhos.
          </span>
        </div>
      </div>
    );
  }

  if (situacao === "ativo") {
    // Sócio do cartão: a faixa abre a assinatura (próxima cobrança, cancelar).
    const gerenciavel = noCartao(clube);
    const Conteudo = (
      <>
        <span style={{ width: 30, height: 30, borderRadius: 99, background: OURO, display: "grid", placeItems: "center", flexShrink: 0 }}>
          <Crown size={17} color="#1C1917" strokeWidth={2.5} />
        </span>
        <span style={{ fontSize: "0.86rem", lineHeight: 1.3, minWidth: 0, textAlign: "left" }}>
          <strong style={{ color: OURO_CLARO }}>{clube.nome} ativo</strong>
          <span style={{ opacity: 0.85 }}> · {pct(clube.percentual)} OFF já entra sozinho nos seus pedidos</span>
        </span>
        {pagoAte && (
          <span style={{ marginLeft: "auto", fontSize: "0.72rem", opacity: 0.7, whiteSpace: "nowrap" }}>
            {cancelado ? `vale até ${diaMes(pagoAte)}` : `renova ${diaMes(pagoAte)}`}
          </span>
        )}
        {gerenciavel && <ChevronRight size={16} style={{ opacity: 0.6, flexShrink: 0 }} />}
      </>
    );
    const estilo: React.CSSProperties = {
      display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 14, width: "100%",
      background: "linear-gradient(135deg,#1C1917,#292524)", color: "#fff", boxShadow: "0 2px 10px rgba(0,0,0,.08)", border: 0,
    };
    return (
      <div style={caixa}>
        {gerenciavel
          ? <button type="button" onClick={onAbrir} aria-label={`Minha assinatura do ${clube.nome}`} style={{ ...estilo, cursor: "pointer" }}>{Conteudo}</button>
          : <div style={estilo}>{Conteudo}</div>}
      </div>
    );
  }

  if (situacao === "pendente") {
    return (
      <div style={caixa}>
        <div role="status" style={{
          display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", padding: "12px 14px", borderRadius: 14,
          background: "#FFFBEB", border: "1.5px solid #FCD34D", color: "#78350F",
        }}>
          <AlertTriangle size={22} color="#D97706" style={{ flexShrink: 0 }} />
          <span style={{ flex: "1 1 220px", fontSize: "0.84rem", lineHeight: 1.4 }}>
            <strong style={{ display: "block", fontSize: "0.92rem" }}>
              {noCartao(clube) ? `O cartão do seu ${clube.nome} não passou` : `Seu ${clube.nome} está sem pagamento`}
            </strong>
            {noCartao(clube)
              ? `Use outro cartão para voltar a ganhar ${pct(clube.percentual)} OFF. Você continua pedindo normalmente, só sem o desconto do clube.`
              : `Pague para voltar a ganhar ${pct(clube.percentual)} OFF. Você continua pedindo normalmente, só sem o desconto do clube.`}
          </span>
          <button type="button" onClick={noCartao(clube) ? onAbrir : onPagar} style={{
            background: "#D97706", color: "#fff", border: 0, borderRadius: 10, padding: "10px 16px",
            fontWeight: 800, fontSize: "0.86rem", cursor: "pointer", whiteSpace: "nowrap",
          }}>
            {noCartao(clube) ? "Trocar o cartão" : "Pagar o clube"}
          </button>
        </div>
      </div>
    );
  }

  // Não assinante (ou o período pago acabou depois de cancelar): o convite.
  return (
    <div style={caixa}>
      <button type="button" onClick={onAbrir} aria-label={`Conhecer o ${clube.nome}`} style={{
        width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "12px 14px", borderRadius: 16,
        background: "linear-gradient(135deg,#1C1917 0%,#3F3A36 100%)", color: "#fff", border: 0, cursor: "pointer",
        textAlign: "left", boxShadow: "0 6px 18px rgba(28,25,23,.18)",
      }}>
        <span style={{ width: 42, height: 42, borderRadius: 12, background: OURO, display: "grid", placeItems: "center", flexShrink: 0 }}>
          <Crown size={23} color="#1C1917" strokeWidth={2.4} />
        </span>
        <span style={{ flex: 1, minWidth: 0, lineHeight: 1.25 }}>
          <span style={{ display: "block", fontSize: "0.7rem", fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: OURO_CLARO }}>
            {situacao === "encerrado" ? `Volte para o ${clube.nome}` : clube.nome}
          </span>
          <span style={{ display: "block", fontSize: "1rem", fontWeight: 900 }}>
            {clube.chamada || `Assine e ganhe ${pct(clube.percentual)} OFF em todos os pedidos`}
          </span>
          <span style={{ display: "block", fontSize: "0.76rem", opacity: 0.75, marginTop: 2 }}>
            {reais(clube.valor)}/mês · {comoPaga(clube)}
          </span>
        </span>
        <span style={{
          background: OURO, color: "#1C1917", borderRadius: 10, padding: "9px 14px", fontWeight: 900, fontSize: "0.85rem",
          whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 2, flexShrink: 0,
        }}>
          Assinar <ChevronRight size={16} strokeWidth={3} />
        </span>
      </button>
    </div>
  );
}

/** "123.456.789-01" enquanto digita. */
function mascaraDoCpf(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 11);
  return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1-$2");
}

export function ModalDoClube({
  clube,
  situacao,
  logado,
  abrindo,
  erro,
  onFechar,
  onAssinar,
  pedeCpf = false,
  pagoAte = null,
  cancelado = false,
  onCancelar,
}: {
  clube: ClubeDaLoja;
  situacao: SituacaoDoClube;
  logado: boolean;
  abrindo: boolean;
  erro: string;
  onFechar: () => void;
  onAssinar: (cpf?: string) => void;
  /** Clube do cartão, primeira assinatura: o Asaas pede o CPF. */
  pedeCpf?: boolean;
  pagoAte?: string | null;
  cancelado?: boolean;
  onCancelar?: () => void;
}) {
  const [cpf, setCpf] = useState("");
  const [confirmarCancelamento, setConfirmarCancelamento] = useState(false);
  // Quando o clube se paga: mensalidade ÷ %. E um mês de exemplo, honesto.
  const sePagaEm = clube.percentual > 0 ? clube.valor / (clube.percentual / 100) : 0;
  const exemploPedidos = 4;
  const exemploValor = 60;
  const economiaExemplo = Math.min(
    exemploPedidos * exemploValor * (clube.percentual / 100),
    clube.teto != null ? exemploPedidos * clube.teto : Infinity,
  );
  const cartao = noCartao(clube);
  const textoDoBotao = situacao === "pendente" ? (cartao ? "Pagar com outro cartão" : "Pagar o clube") : `Assinar por ${reais(clube.valor)}/mês`;
  const cpfCompleto = cpf.replace(/\D/g, "").length === 11;

  const moldura = (conteudo: React.ReactNode) => (
    <div role="dialog" aria-modal="true" aria-label={clube.nome} onClick={(e) => { if (e.target === e.currentTarget) onFechar(); }}
      style={{ position: "fixed", inset: 0, zIndex: 9990, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div style={{
        width: "min(460px, 100%)", maxHeight: "92vh", overflowY: "auto", background: "#fff",
        borderRadius: "20px 20px 0 0", boxShadow: "0 -10px 40px rgba(0,0,0,.25)", paddingBottom: "env(safe-area-inset-bottom)",
      }}>
        {conteudo}
      </div>
    </div>
  );

  const topo = (titulo: string, sub: string) => (
    <div style={{ position: "relative", padding: "26px 22px 22px", background: "linear-gradient(135deg,#1C1917,#44403C)", color: "#fff", borderRadius: "20px 20px 0 0" }}>
      <button type="button" onClick={onFechar} aria-label="Fechar" style={{ position: "absolute", top: 12, right: 12, background: "rgba(255,255,255,.12)", border: 0, borderRadius: 99, width: 32, height: 32, display: "grid", placeItems: "center", cursor: "pointer", color: "#fff" }}>
        <X size={18} />
      </button>
      <span style={{ width: 52, height: 52, borderRadius: 14, background: OURO, display: "grid", placeItems: "center", marginBottom: 12 }}>
        <Crown size={30} color="#1C1917" strokeWidth={2.3} />
      </span>
      <div style={{ fontSize: "0.75rem", fontWeight: 800, letterSpacing: ".06em", textTransform: "uppercase", color: OURO_CLARO }}>{clube.nome}</div>
      <div style={{ fontSize: "1.45rem", fontWeight: 900, lineHeight: 1.15, marginTop: 4 }}>{titulo}</div>
      <div style={{ fontSize: "0.86rem", opacity: 0.8, marginTop: 6 }}>{sub}</div>
    </div>
  );

  // ── O SÓCIO: a assinatura dele (só no cartão, que o FireHub consegue cancelar) ──
  if (situacao === "ativo") {
    return moldura(
      <>
        {topo("Você é sócio", `${pct(clube.percentual)} OFF em todo pedido pelo aplicativo`)}
        <div style={{ padding: "18px 22px 22px" }}>
          <div style={{ display: "grid", gap: 8, fontSize: "0.9rem", color: "#1E293B" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Mensalidade</span><strong>{reais(clube.valor)}</strong></div>
            {pagoAte && (
              <div style={{ display: "flex", justifyContent: "space-between" }}>
                <span>{cancelado ? "Desconto vale até" : "Próxima cobrança no cartão"}</span>
                <strong>{new Date(pagoAte).toLocaleDateString("pt-BR")}</strong>
              </div>
            )}
          </div>
          {cancelado ? (
            <p style={{ margin: "16px 0 0", fontSize: "0.84rem", color: "#475569", lineHeight: 1.45 }}>
              Assinatura cancelada: nenhuma cobrança nova. O desconto continua até o fim do mês que você já pagou.
            </p>
          ) : onCancelar && (
            <>
              {erro && <p role="alert" style={{ fontSize: "0.84rem", color: "#B91C1C", fontWeight: 700, margin: "14px 0 0" }}>{erro}</p>}
              {!confirmarCancelamento ? (
                <button type="button" onClick={() => setConfirmarCancelamento(true)} style={{
                  width: "100%", marginTop: 18, padding: "13px 16px", borderRadius: 12, border: "1.5px solid #E2E8F0", background: "#fff",
                  color: "#B91C1C", fontWeight: 800, fontSize: "0.92rem", cursor: "pointer",
                }}>
                  Cancelar a assinatura
                </button>
              ) : (
                <div style={{ marginTop: 16, padding: 14, borderRadius: 12, background: "#FEF2F2", border: "1px solid #FECACA" }}>
                  <p style={{ margin: 0, fontSize: "0.86rem", color: "#7F1D1D", lineHeight: 1.45 }}>
                    Cancelar agora? Nenhuma cobrança nova sai no cartão e o desconto vale até {pagoAte ? new Date(pagoAte).toLocaleDateString("pt-BR") : "o fim do mês pago"}.
                  </p>
                  <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                    <button type="button" onClick={() => setConfirmarCancelamento(false)} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: "1px solid #E2E8F0", background: "#fff", fontWeight: 800, cursor: "pointer" }}>
                      Manter
                    </button>
                    <button type="button" disabled={abrindo} onClick={onCancelar} style={{ flex: 1, padding: "11px 12px", borderRadius: 10, border: 0, background: "#B91C1C", color: "#fff", fontWeight: 800, cursor: abrindo ? "wait" : "pointer" }}>
                      {abrindo ? "Cancelando…" : "Sim, cancelar"}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </>,
    );
  }

  return moldura(
    <>
      {topo(`${pct(clube.percentual)} de desconto em todos os seus pedidos`, `Por ${reais(clube.valor)} por mês, aqui no aplicativo.`)}
      <div style={{ padding: "18px 22px 22px" }}>
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 10 }}>
          {[
            `${pct(clube.percentual)} OFF em todo pedido feito pelo aplicativo${clube.teto != null ? ` (até ${reais(clube.teto)} por pedido)` : ""}`,
            "Vale para o cardápio inteiro, na entrega e na retirada",
            clube.acumulaComCupom === false ? "O desconto entra sozinho na sacola (com cupom, vale o cupom)" : "O desconto entra sozinho na sacola, sem cupom",
            cartao ? "Cobrança mensal no cartão de crédito. Cancele quando quiser, pelo app" : "Pague no cartão de crédito ou no Pix Automático",
          ].map((t) => (
            <li key={t} style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: "0.9rem", color: "#1E293B", lineHeight: 1.35 }}>
              <span style={{ width: 22, height: 22, borderRadius: 99, background: "#FEF3C7", display: "grid", placeItems: "center", flexShrink: 0 }}>
                <Check size={14} color="#B45309" strokeWidth={3} />
              </span>
              {t}
            </li>
          ))}
        </ul>

        <div style={{ marginTop: 16, padding: "12px 14px", borderRadius: 12, background: "#F8FAFC", border: "1px solid #E2E8F0", fontSize: "0.84rem", color: "#334155", lineHeight: 1.45 }}>
          Pedindo {exemploPedidos} vezes de {reais(exemploValor)} no mês, você economiza <strong style={{ color: "#B45309" }}>{reais(economiaExemplo)}</strong>.
          {sePagaEm > 0 && <> O clube se paga a partir de <strong>{reais(Math.ceil(sePagaEm))}</strong> em pedidos no mês.</>}
        </div>

        {!logado && (
          <p style={{ fontSize: "0.8rem", color: "#64748B", margin: "14px 0 0", lineHeight: 1.4 }}>
            Para o desconto ser só seu, a assinatura fica ligada à sua conta. Entre (ou crie a conta) e já seguimos para o pagamento.
          </p>
        )}
        {logado && pedeCpf && (
          <div style={{ marginTop: 14 }}>
            <label htmlFor="cpf-do-clube" style={{ display: "block", fontSize: "0.8rem", fontWeight: 800, color: "#334155", marginBottom: 6 }}>Seu CPF</label>
            <input id="cpf-do-clube" inputMode="numeric" autoComplete="off" value={cpf} placeholder="000.000.000-00"
              onChange={(e) => setCpf(mascaraDoCpf(e.target.value))}
              style={{ width: "100%", boxSizing: "border-box", padding: "13px 14px", borderRadius: 12, border: "1.5px solid #CBD5E1", fontSize: "1rem" }} />
            <p style={{ fontSize: "0.74rem", color: "#64748B", margin: "6px 0 0", lineHeight: 1.4 }}>
              O Asaas, que cobra o cartão para a loja, pede o CPF do titular da assinatura. Só na primeira vez.
            </p>
          </div>
        )}
        {erro && <p role="alert" style={{ fontSize: "0.84rem", color: "#B91C1C", fontWeight: 700, margin: "12px 0 0" }}>{erro}</p>}

        <button type="button" onClick={() => onAssinar(pedeCpf ? cpf : undefined)} disabled={abrindo || (logado && pedeCpf && !cpfCompleto)} style={{
          width: "100%", marginTop: 16, padding: "15px 18px", borderRadius: 14, border: 0, cursor: abrindo ? "wait" : "pointer",
          background: OURO, color: "#1C1917", fontWeight: 900, fontSize: "1rem", opacity: abrindo || (logado && pedeCpf && !cpfCompleto) ? 0.6 : 1,
        }}>
          {abrindo ? "Abrindo o pagamento…" : logado ? textoDoBotao : "Entrar para assinar"}
        </button>
        <p style={{ fontSize: "0.74rem", color: "#94A3B8", margin: "10px 0 0", textAlign: "center", lineHeight: 1.4, display: "flex", gap: 5, justifyContent: "center", alignItems: "flex-start" }}>
          {cartao && <Lock size={12} style={{ flexShrink: 0, marginTop: 2 }} />}
          <span>
            {cartao
              ? "O cartão é digitado na página segura do Asaas, que cobra para a loja — ele não passa pelo app. Se uma cobrança não passar, você continua pedindo normalmente, só sem o desconto."
              : "Cobrança mensal pela Cakto. Se um pagamento não passar, você continua pedindo normalmente, só sem o desconto."}
          </span>
        </p>
      </div>
    </>,
  );
}

export function ClubeNaSacola({
  clube,
  situacao,
  desconto,
  economiaPossivel,
  onAbrir,
  compacto = false,
  foraPorCupom = false,
}: {
  clube: ClubeDaLoja;
  situacao: SituacaoDoClube;
  desconto: number;
  economiaPossivel: number;
  onAbrir: () => void;
  compacto?: boolean;
  /** Sócio com cupom na sacola e clube que não soma com cupom: vale o cupom. */
  foraPorCupom?: boolean;
}) {
  if (situacao === "ativo") {
    if (foraPorCupom) {
      return (
        <div style={{ margin: "4px 0", padding: "8px 10px", borderRadius: 10, background: "#FFFBEB", border: "1px solid #FCD34D", color: "#92400E", fontSize: "0.76rem", lineHeight: 1.35 }}>
          <Crown size={13} style={{ verticalAlign: "-2px" }} /> Com cupom, o desconto do clube não entra neste pedido. Tire o cupom para usar os {pct(clube.percentual)} do {clube.nome}.
        </div>
      );
    }
    if (desconto <= 0) return null;
    return (
      <div style={{ display: "flex", justifyContent: "space-between", color: "#B45309", fontWeight: compacto ? 700 : undefined }}>
        <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Crown size={14} /> Clube {pct(clube.percentual)}{compacto ? ":" : ""}</span>
        <span style={{ fontWeight: 700 }}>- {reais(desconto)}</span>
      </div>
    );
  }
  if (situacao === "pendente") {
    return (
      <button type="button" onClick={onAbrir} style={{
        display: "block", width: "100%", textAlign: "left", margin: "4px 0", padding: "8px 10px", borderRadius: 10,
        background: "#FFFBEB", border: "1px solid #FCD34D", color: "#92400E", fontSize: "0.76rem", lineHeight: 1.35, cursor: "pointer",
      }}>
        Seu clube está sem pagamento: este pedido sai sem os {pct(clube.percentual)}. <strong style={{ textDecoration: "underline" }}>{noCartao(clube) ? "Trocar o cartão" : "Pagar o clube"}</strong>
      </button>
    );
  }
  if (economiaPossivel <= 0) return null;
  return (
    <button type="button" onClick={onAbrir} style={{
      display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", margin: "4px 0", padding: "8px 10px",
      borderRadius: 10, background: "#1C1917", border: 0, color: "#fff", fontSize: "0.78rem", lineHeight: 1.35, cursor: "pointer",
    }}>
      <Crown size={16} color={OURO} style={{ flexShrink: 0 }} />
      <span style={{ flex: 1 }}>
        No {clube.nome} este pedido sairia <strong style={{ color: OURO_CLARO }}>{reais(economiaPossivel)}</strong> mais barato.
      </span>
      <span style={{ color: OURO_CLARO, fontWeight: 800, whiteSpace: "nowrap" }}>Conhecer</span>
    </button>
  );
}
