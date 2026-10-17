"use client";

/**
 * A seção "Pedidos de app" do cadastro do entregador: ele recebe igual aos
 * pedidos do site, ou diferente — o valor da entrega que veio do app, ou um
 * valor fixo por entrega de app.
 *
 * ── Por que mora no cadastro de cada um ─────────────────────────────────────
 *
 * Até 17/10/2026 era um quadro no topo da aba Motoboys, uma escolha só para a
 * loja inteira, com três botões e dois avisos amarelos. O dono: "está confuso,
 * ninguém usa nem entende, e o nosso layout fica feio". A pergunta real é por
 * pessoa ("o Lucas leva R$ 4,00 no iFood, o freelancer leva o que o app
 * pagou"), e o lugar de responder é onde o lojista já cadastra quanto paga a
 * ele. A regra mora em lib/repasse-do-entregador.ts (PedidoDeAppDoEntregador)
 * e a conta em lib/ganho-do-entregador.ts.
 *
 * A tela mostra o que VALE para ele, não só o que está gravado: quem nunca
 * escolheu e está numa loja com a regra antiga ligada aparece com ela
 * (`daLoja`), e o salvar só grava a escolha se a pessoa mexeu aqui.
 */

export type ModoNoApp = "IGUAL" | "APP" | "FIXO";

export default function PedidosDeAppDoEntregador({ modo, fixo, daLoja, onEscolher, onFixo }: {
  modo: ModoNoApp;
  /** O valor fixo como a pessoa digitou ("4,00"). */
  fixo: string;
  /** O que aparece veio da regra antiga da loja, não do cadastro dele. */
  daLoja: boolean;
  onEscolher: (m: ModoNoApp) => void;
  onFixo: (t: string) => void;
}) {
  const diferente = modo !== "IGUAL";

  const opcao = (ativo: boolean, titulo: string, sub: string | null, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      style={{
        flex: "1 1 220px", minWidth: 0, textAlign: "left", cursor: "pointer", fontFamily: "inherit",
        padding: "10px 12px", borderRadius: 10,
        border: ativo ? "2px solid #C92E09" : "1.5px solid #E2E8F0",
        background: ativo ? "#FFF4EF" : "#fff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: "0.86rem", fontWeight: 800, color: ativo ? "#9A3412" : "#334155" }}>
        <span aria-hidden>{ativo ? "●" : "○"}</span>{titulo}
      </div>
      {sub && <div style={{ fontSize: "0.74rem", color: "#64748B", marginTop: 2, lineHeight: 1.4 }}>{sub}</div>}
    </button>
  );

  return (
    <div style={{ marginBottom: 14, padding: "12px 14px", background: "#F8FAFC", border: "1.5px solid #E2E8F0", borderRadius: 12 }}>
      <b style={{ display: "block", fontSize: "0.9rem", color: "#334155", marginBottom: 8 }}>
        📱 Pedidos de app (iFood, 99Food, Keeta…)
      </b>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {opcao(!diferente, "Igual aos pedidos do site", "Recebe pelo pagamento acima.", () => onEscolher("IGUAL"))}
        {opcao(diferente, "Pagar diferente nos pedidos de app", null, () => { if (!diferente) onEscolher("FIXO"); })}
      </div>

      {diferente && (
        <div style={{ marginTop: 8, padding: "10px 12px", background: "#fff", border: "1.5px solid #FFD3C2", borderRadius: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.84rem", fontWeight: 700, color: "#334155", cursor: "pointer" }}>
            <input type="radio" name="pedido-de-app" checked={modo === "APP"} onChange={() => onEscolher("APP")} />
            O valor da entrega que veio do app
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "0.84rem", fontWeight: 700, color: "#334155", cursor: "pointer", flexWrap: "wrap" }}>
            <input type="radio" name="pedido-de-app" checked={modo === "FIXO"} onChange={() => onEscolher("FIXO")} />
            Um valor fixo por entrega de app: R$
            <input
              type="text"
              inputMode="decimal"
              placeholder="4,00"
              value={fixo}
              onFocus={() => { if (modo !== "FIXO") onEscolher("FIXO"); }}
              onChange={(e) => onFixo(e.target.value)}
              style={{ width: 90, padding: "7px 9px", borderRadius: 8, border: "1.5px solid #FFD3C2", color: "#9A3412", fontSize: "0.88rem", fontWeight: 800, textAlign: "center", outline: "none", fontFamily: "inherit" }}
            />
          </label>
        </div>
      )}

      {daLoja && (
        <p style={{ margin: "8px 0 0", fontSize: "0.74rem", color: "#64748B" }}>
          Hoje ele segue a regra geral da loja. Mude aqui para valer só para ele.
        </p>
      )}
    </div>
  );
}

/** "4,00" e "4.00" viram 4; vazio ou inválido, nulo. */
export function valorDoCampo(t: string): number | null {
  const limpo = String(t || "").replace(/\s/g, "").replace(",", ".");
  if (!limpo) return null;
  const n = Number(limpo);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}
