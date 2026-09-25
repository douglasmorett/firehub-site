import type { CSSProperties, ReactNode } from "react";
import { Puzzle, Pin, ArrowRight, ArrowDown } from "lucide-react";

/**
 * Desenhos do passo a passo: miniaturas do que o lojista vai ver de verdade
 * (barra do Chrome, popup da extensão, abas, pílula do painel). Os rótulos
 * são os mesmos de firehub-ifood-extension/popup/popup.html e do
 * firehub-bridge.js — se a extensão trocar um texto, troque aqui também,
 * senão o passo a passo manda procurar um botão que não existe.
 */

const popupFundo: CSSProperties = {
  width: "100%",
  maxWidth: 270,
  background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
  color: "#F8FAFC",
  borderRadius: 14,
  padding: 12,
  boxShadow: "0 14px 34px rgba(15,23,42,0.28)",
  fontSize: 11,
  textAlign: "left",
};

function CabecalhoDoPopup({ sub, status, statusCor }: { sub: string; status: string; statusCor: "verde" | "vermelho" }) {
  const verde = statusCor === "verde";
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 8, marginBottom: 8, borderBottom: "1px solid #334155" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: "linear-gradient(135deg, #FF5722, #F44336)", display: "grid", placeItems: "center", fontSize: 12 }}>🔥</div>
        <div>
          <div style={{ fontWeight: 900, fontSize: 11.5 }}>FireHub iFood</div>
          <div style={{ fontSize: 8.5, color: "#FF7A59", fontWeight: 700 }}>{sub}</div>
        </div>
      </div>
      <span style={{ fontSize: 8.5, fontWeight: 800, padding: "2px 6px", borderRadius: 10, background: verde ? "#064E3B" : "#7F1D1D", color: verde ? "#34D399" : "#FCA5A5" }}>
        {status}
      </span>
    </div>
  );
}

/** Uma seta de "é aqui" com legenda, apontando para o elemento ao lado. */
export function Destaque({ children }: { children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#E8360C", color: "#FFF", fontSize: 10.5, fontWeight: 900, padding: "3px 8px", borderRadius: 999, boxShadow: "0 3px 10px rgba(232,54,12,0.35)", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

/** Passo "instalar": a ficha na Chrome Web Store e a confirmação do Chrome. */
export function FichaDaLoja() {
  return (
    <div style={{ width: "100%", maxWidth: 330, display: "grid", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, background: "#FFF", border: "1px solid #CBD5E1", borderRadius: 12, padding: 12, boxShadow: "0 10px 26px rgba(15,23,42,0.10)" }}>
        <div style={{ width: 36, height: 36, borderRadius: 9, background: "linear-gradient(135deg, #FF5722, #F44336)", display: "grid", placeItems: "center", fontSize: 18, flexShrink: 0 }}>🔥</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 11.5, color: "#0F172A", lineHeight: 1.25 }}>FireHub — Prazo Automático</div>
          <div style={{ fontSize: 9.5, color: "#64748B" }}>Chrome Web Store</div>
        </div>
        <span style={{ background: "#1A73E8", color: "#FFF", borderRadius: 999, padding: "6px 11px", fontWeight: 800, fontSize: 10.5, whiteSpace: "nowrap", outline: "2px solid #E8360C", outlineOffset: 2 }}>
          Usar no Chrome
        </span>
      </div>
      <div style={{ background: "#FFF", border: "1px solid #CBD5E1", borderRadius: 12, padding: 12, boxShadow: "0 10px 26px rgba(15,23,42,0.10)", fontSize: 11 }}>
        <div style={{ fontWeight: 800, color: "#0F172A" }}>Adicionar &quot;FireHub — Prazo Automático&quot;?</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 10 }}>
          <span style={{ border: "1px solid #CBD5E1", borderRadius: 999, padding: "5px 11px", color: "#1A73E8", fontWeight: 700 }}>Cancelar</span>
          <span style={{ background: "#1A73E8", color: "#FFF", borderRadius: 999, padding: "5px 11px", fontWeight: 800, outline: "2px solid #E8360C", outlineOffset: 2 }}>Adicionar extensão</span>
        </div>
      </div>
    </div>
  );
}

/** Passo "fixar": barra do Chrome com o menu do quebra-cabeça aberto. */
export function BarraDoChrome() {
  return (
    <div style={{ width: "100%", maxWidth: 330, borderRadius: 12, border: "1px solid #CBD5E1", background: "#FFF", overflow: "hidden", boxShadow: "0 10px 26px rgba(15,23,42,0.10)", fontSize: 11 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#E8EEF6" }}>
        <div style={{ flex: 1, background: "#FFF", borderRadius: 999, padding: "5px 10px", color: "#64748B", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          firehubfood.com.br/store
        </div>
        <div title="ícone fixado" style={{ width: 24, height: 24, borderRadius: 999, background: "#FFF", display: "grid", placeItems: "center", fontSize: 12, outline: "2px solid #E8360C", outlineOffset: 1 }}>🔥</div>
        <div style={{ width: 24, height: 24, borderRadius: 999, background: "#FFF", display: "grid", placeItems: "center", color: "#334155", outline: "2px solid #1A73E8", outlineOffset: 1 }}>
          <Puzzle size={13} />
        </div>
      </div>
      <div style={{ position: "relative", padding: "10px 10px 12px" }}>
        <div style={{ marginLeft: "auto", width: "86%", border: "1px solid #E2E8F0", borderRadius: 10, boxShadow: "0 8px 20px rgba(15,23,42,0.12)", padding: 8, background: "#FFF" }}>
          <div style={{ fontSize: 10, color: "#64748B", fontWeight: 700, marginBottom: 6 }}>Extensões</div>
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "6px 6px", borderRadius: 8, background: "#FFF7ED" }}>
            <span style={{ fontSize: 13 }}>🔥</span>
            <span style={{ flex: 1, fontWeight: 700, color: "#0F172A", fontSize: 10.5, lineHeight: 1.25 }}>FireHub — Prazo Automático</span>
            <span style={{ width: 22, height: 22, borderRadius: 999, display: "grid", placeItems: "center", background: "#1A73E8", color: "#FFF" }}>
              <Pin size={12} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Passo "entrar": a tela de login do popup. */
export function PopupLogin() {
  const campo: CSSProperties = { background: "#0F172A", border: "1px solid #475569", borderRadius: 6, padding: "5px 7px", color: "#64748B", marginBottom: 6 };
  return (
    <div style={popupFundo}>
      <CabecalhoDoPopup sub="AUTENTICAÇÃO" status="DESCONECTADO" statusCor="vermelho" />
      <div style={{ background: "#1E293B", border: "1px solid #334155", borderRadius: 10, padding: 9 }}>
        <div style={{ fontWeight: 800, textAlign: "center", marginBottom: 8 }}>🔐 Faça Login na sua Conta FireHub</div>
        <div style={{ fontSize: 9, color: "#94A3B8", marginBottom: 3 }}>E-mail do FireHub:</div>
        <div style={campo}>seu e-mail do painel</div>
        <div style={{ fontSize: 9, color: "#94A3B8", marginBottom: 3 }}>Senha:</div>
        <div style={campo}>••••••••</div>
        <div style={{ marginTop: 4, background: "linear-gradient(135deg, #FF5722 0%, #E64A19 100%)", borderRadius: 7, padding: "7px 0", textAlign: "center", fontWeight: 900 }}>
          🔑 Entrar e Conectar Loja
        </div>
      </div>
    </div>
  );
}

/** Passo "deixar abertas": as duas abas que ficam no Chrome do caixa. */
export function AbasDoChrome() {
  const aba = (cor: string, icone: string, titulo: string, ativa: boolean): ReactNode => (
    <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 6, padding: "7px 9px", borderRadius: "9px 9px 0 0", background: ativa ? "#FFF" : "transparent", fontWeight: 700, color: "#0F172A", fontSize: 10.5 }}>
      <span style={{ width: 14, height: 14, borderRadius: 4, background: cor, display: "grid", placeItems: "center", fontSize: 8, color: "#FFF", flexShrink: 0 }}>{icone}</span>
      <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{titulo}</span>
    </div>
  );
  return (
    <div style={{ width: "100%", maxWidth: 340 }}>
      <div style={{ borderRadius: 12, border: "1px solid #CBD5E1", overflow: "hidden", boxShadow: "0 10px 26px rgba(15,23,42,0.10)" }}>
        <div style={{ display: "flex", gap: 4, padding: "6px 6px 0", background: "#DDE3EA" }}>
          {aba("#E8360C", "🔥", "Pedidos · FireHub", true)}
          {aba("#EA1D2C", "i", "Portal do Parceiro · Entrega", false)}
        </div>
        <div style={{ background: "#FFF", padding: "10px 12px", fontSize: 10.5, color: "#64748B" }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ width: 8, height: 8, borderRadius: 999, background: "#22C55E" }} />
            Chrome aberto no computador do caixa
          </div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
        <Destaque>1ª aba: seu painel</Destaque>
        <Destaque>2ª aba: iFood, não feche</Destaque>
      </div>
    </div>
  );
}

/** Passo "ligar o robô": modo automático com motoboys e a chave verde. */
export function PopupRobo({ motoboys = 3, pedidos = 7, prazo = "58 min" }: { motoboys?: number; pedidos?: number; prazo?: string }) {
  return (
    <div style={popupFundo}>
      <CabecalhoDoPopup sub="AUTOMATION & ETA" status="ONLINE" statusCor="verde" />
      <div style={{ display: "flex", background: "#0F172A", border: "1px solid #334155", borderRadius: 8, padding: 2, marginBottom: 8 }}>
        <div style={{ flex: 1, textAlign: "center", padding: "4px 0", borderRadius: 6, background: "#334155", fontWeight: 800 }}>🤖 Automático</div>
        <div style={{ flex: 1, textAlign: "center", padding: "4px 0", color: "#94A3B8", fontWeight: 800 }}>✍️ Manual</div>
      </div>
      <div style={{ background: "#1E293B", border: "1px solid #334155", borderRadius: 9, padding: 8, marginBottom: 8, outline: "2px solid #FF5722", outlineOffset: 2 }}>
        <div style={{ fontSize: 8.5, fontWeight: 800, color: "#94A3B8", marginBottom: 4 }}>🛵 MOTOBOYS NA CASA</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ width: 22, height: 22, borderRadius: 6, background: "#334155", display: "grid", placeItems: "center", fontWeight: 900 }}>−</span>
          <span style={{ fontSize: 16, fontWeight: 900, color: "#38BDF8" }}>{motoboys}</span>
          <span style={{ width: 22, height: 22, borderRadius: 6, background: "#334155", display: "grid", placeItems: "center", fontWeight: 900 }}>+</span>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5, marginBottom: 8 }}>
        <div style={{ background: "#0F172A", border: "1px solid #334155", borderRadius: 8, padding: 5, textAlign: "center" }}>
          <div style={{ fontSize: 13, fontWeight: 900, color: "#F59E0B" }}>{pedidos}</div>
          <div style={{ fontSize: 8, color: "#94A3B8", fontWeight: 700 }}>Em Produção</div>
        </div>
        <div style={{ background: "#0F172A", border: "1px solid #334155", borderRadius: 8, padding: 5, textAlign: "center" }}>
          <div style={{ fontSize: 12, fontWeight: 900, color: "#38BDF8" }}>{prazo}</div>
          <div style={{ fontSize: 8, color: "#94A3B8", fontWeight: 700 }}>Status Carga</div>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#0F172A", border: "1px solid #334155", borderRadius: 9, padding: "7px 9px", outline: "2px solid #22C55E", outlineOffset: 2 }}>
        <div>
          <div style={{ fontWeight: 800 }}>🤖 Robô Automático</div>
          <div style={{ fontSize: 8, color: "#94A3B8" }}>Ajusta o prazo no iFood sozinho</div>
        </div>
        <span style={{ position: "relative", width: 34, height: 19, borderRadius: 999, background: "#22C55E", flexShrink: 0 }}>
          <span style={{ position: "absolute", top: 2, left: 17, width: 15, height: 15, borderRadius: 999, background: "#FFF" }} />
        </span>
      </div>
    </div>
  );
}

/** A pílula que o bridge desenha no canto do painel de pedidos. */
export function Pilula({ texto, estouro = false }: { texto: string; estouro?: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 13px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 800,
        background: estouro ? "linear-gradient(135deg, #7F1D1D 0%, #450A0A 100%)" : "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
        border: estouro ? "1.5px solid #EF4444" : "1.5px solid #FF5722",
        color: estouro ? "#FCA5A5" : "#FFF",
        boxShadow: "0 6px 18px rgba(15,23,42,0.22)",
        whiteSpace: "nowrap",
      }}
    >
      🔥 {texto}
    </span>
  );
}

/**
 * Os três quadros "FireHub conta → extensão calcula → iFood muda". Deitado no
 * computador, em pé no celular: a troca de direção e de seta é das classes
 * eta-fluxo / eta-seta-* que a página declara.
 */
export function Fluxo() {
  const quadro: CSSProperties = { flex: 1, minWidth: 0, background: "#FFF", border: "1px solid #E2E8F0", borderRadius: 16, padding: "14px 14px 16px", boxShadow: "0 4px 14px rgba(15,23,42,0.05)" };
  const rotulo: CSSProperties = { fontSize: 11, fontWeight: 900, letterSpacing: 0.3, color: "#64748B", textTransform: "uppercase", marginBottom: 8 };
  const seta = (
    <div style={{ display: "grid", placeItems: "center", color: "#E8360C", flexShrink: 0 }}>
      <ArrowRight className="eta-seta-lado" size={26} strokeWidth={2.6} />
      <ArrowDown className="eta-seta-baixo" size={26} strokeWidth={2.6} />
    </div>
  );
  return (
    <div className="eta-fluxo" style={{ display: "flex", alignItems: "stretch", gap: 10 }}>
      <div style={quadro}>
        <div style={rotulo}>1. O FireHub conta</div>
        <div style={{ border: "1px solid #E2E8F0", borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", background: "#FFF7ED", fontWeight: 800, fontSize: 12.5 }}>
            🔥 Em produção
            <span style={{ background: "#0F172A", color: "#FFF", borderRadius: 999, padding: "1px 8px", fontSize: 11 }}>7</span>
          </div>
          <div style={{ padding: 8, display: "grid", gap: 5 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ height: 12, borderRadius: 4, background: "#F1F5F9" }} />
            ))}
          </div>
        </div>
        <p style={{ fontSize: 12.5, color: "#475569", margin: "10px 0 0", lineHeight: 1.45 }}>
          Quantos pedidos estão na coluna <b>Em produção</b> do seu painel.
        </p>
      </div>
      {seta}
      <div style={quadro}>
        <div style={rotulo}>2. A extensão calcula</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, padding: "10px 0", fontWeight: 900, fontSize: 14, color: "#0F172A", flexWrap: "wrap" }}>
          <span style={{ background: "#F1F5F9", borderRadius: 8, padding: "4px 8px" }}>7 pedidos</span>
          <span style={{ color: "#94A3B8" }}>+</span>
          <span style={{ background: "#F1F5F9", borderRadius: 8, padding: "4px 8px" }}>🛵 3</span>
          <span style={{ color: "#94A3B8" }}>=</span>
          <span style={{ background: "#FEF3C7", color: "#A16207", borderRadius: 8, padding: "4px 8px" }}>58 min</span>
        </div>
        <p style={{ fontSize: 12.5, color: "#475569", margin: "4px 0 0", lineHeight: 1.45 }}>
          Cruza a fila com os <b>motoboys na casa</b> e escolhe o prazo da tabela.
        </p>
      </div>
      {seta}
      <div style={quadro}>
        <div style={rotulo}>3. O iFood muda</div>
        <div style={{ border: "1px solid #E2E8F0", borderRadius: 10, padding: "8px 10px" }}>
          <div style={{ fontSize: 10.5, color: "#64748B", fontWeight: 700 }}>Portal do Parceiro · Tempo de entrega</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
            <span style={{ width: 22, height: 22, borderRadius: 999, border: "1.5px solid #EA1D2C", color: "#EA1D2C", display: "grid", placeItems: "center", fontWeight: 900 }}>−</span>
            <span style={{ fontWeight: 900, fontSize: 17 }}>58 min</span>
            <span style={{ width: 22, height: 22, borderRadius: 999, border: "1.5px solid #EA1D2C", color: "#EA1D2C", display: "grid", placeItems: "center", fontWeight: 900 }}>+</span>
          </div>
          <div style={{ marginTop: 7, background: "#EA1D2C", color: "#FFF", borderRadius: 6, textAlign: "center", fontWeight: 800, fontSize: 11, padding: "4px 0" }}>Salvar</div>
        </div>
        <p style={{ fontSize: 12.5, color: "#475569", margin: "10px 0 0", lineHeight: 1.45 }}>
          Ela aperta os mesmos botões que você apertaria, na aba do iFood, e salva.
        </p>
      </div>
    </div>
  );
}
