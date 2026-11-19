/**
 * Os aparelhos em miniatura dos desenhos de "como funciona" (./Passos):
 * monitor, celular (WhatsApp ou app), tablet, totem, TV, cupom impresso,
 * QR, cartão de comanda, leitor de código de barras, mapa, painel claro.
 * São retratos das telas reais — por isso cada um tem a cor do aparelho,
 * não a do tema do painel.
 */
import type { CSSProperties, ReactNode } from "react";

const MONO = "ui-monospace, 'JetBrains Mono', Consolas, monospace";
const sombra = "0 14px 30px rgba(15,23,42,.22)";

export const LARANJA = "#E8360C";

export function Monitor({ children, largura = 440 }: { children: ReactNode; largura?: number }) {
  return (
    <div style={{ width: `min(100%, ${largura}px)` }}>
      <div style={{ background: "#0F172A", border: "7px solid #273244", borderRadius: 10, color: "#E2E8F0", font: `500 10px/1.35 ${MONO}`, padding: 8, boxShadow: sombra }}>{children}</div>
      <div style={{ width: 60, height: 10, background: "#273244", margin: "0 auto", borderRadius: "0 0 6px 6px" }} />
    </div>
  );
}

export function Etiqueta({ children, verde }: { children: ReactNode; verde?: boolean }) {
  return <span style={{ display: "inline-block", fontSize: 8.5, padding: "1px 5px", borderRadius: 4, background: verde ? "#064E3B" : "#1E293B", color: verde ? "#34D399" : "#94A3B8", marginLeft: 4 }}>{children}</span>;
}

/** Celular. `tipo="whats"` desenha a conversa do WhatsApp; `"app"` uma tela clara de app/site. */
export function Celular({ titulo, sub, tipo = "whats", children }: { titulo: string; sub?: string; tipo?: "whats" | "app"; children: ReactNode }) {
  return (
    <div style={{ width: 160, height: 310, borderRadius: 24, border: "6px solid #111827", background: "#FFF", overflow: "hidden", display: "flex", flexDirection: "column", boxShadow: sombra, color: "#111", fontSize: 10, lineHeight: 1.35, textAlign: "left" }}>
      <div style={{ background: tipo === "whats" ? "#075E54" : "#0F172A", color: "#FFF", padding: "7px 8px", fontWeight: 700, fontSize: 10.5 }}>
        {titulo}{sub && <small style={{ display: "block", fontWeight: 500, opacity: 0.8, fontSize: 8.5 }}>{sub}</small>}
      </div>
      <div style={{ flex: 1, padding: tipo === "whats" ? 7 : 8, display: "flex", flexDirection: "column", gap: tipo === "whats" ? 5 : 6, overflow: "hidden", background: tipo === "whats" ? "#ECE5DD" : "#F8FAFC" }}>{children}</div>
    </div>
  );
}

/** Balão do WhatsApp. `eu` = mensagem enviada (verde, à direita). `botoes` = botões de resposta da API oficial. */
export function Balao({ eu, children, botoes }: { eu?: boolean; children: ReactNode; botoes?: string[] }) {
  return (
    <div style={{ maxWidth: "88%", alignSelf: eu ? "flex-end" : "flex-start", padding: "5px 7px", borderRadius: 7, background: eu ? "#D9FDD3" : "#FFF", boxShadow: "0 1px 1px rgba(0,0,0,.1)" }}>
      {children}
      {botoes?.map((b) => <span key={b} style={{ display: "block", marginTop: 5, borderTop: "1px solid #E5E7EB", paddingTop: 4, textAlign: "center", color: "#0284C7", fontWeight: 700 }}>{b}</span>)}
    </div>
  );
}

export function Audio({ tempo }: { tempo: string }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 5 }}>▶ <i style={{ flex: 1, height: 10, background: "repeating-linear-gradient(90deg,#94A3B8 0 2px,transparent 2px 4px)" }} /> {tempo}</div>;
}

export function Botao({ children, cor = "laranja", style }: { children: ReactNode; cor?: "laranja" | "cinza" | "verde"; style?: CSSProperties }) {
  const fundo = cor === "laranja" ? LARANJA : cor === "verde" ? "#16A34A" : "#E2E8F0";
  return <div style={{ background: fundo, color: cor === "cinza" ? "#0F172A" : "#FFF", borderRadius: 7, padding: 6, textAlign: "center", fontWeight: 700, ...style }}>{children}</div>;
}

export function Linha({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 6, ...style }}>{children}</div>;
}

/** Tela escura de tablet (balança, tela cheia). */
export function Tablet({ children }: { children: ReactNode }) {
  return <div style={{ width: "min(100%, 330px)", aspectRatio: "4 / 3", background: "#0F172A", border: "9px solid #111827", borderRadius: 16, color: "#E2E8F0", fontSize: 11, lineHeight: 1.35, padding: 12, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", textAlign: "center", gap: 6, boxShadow: sombra }}>{children}</div>;
}

export function Totem({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div>
      <div style={{ width: 170, height: 320, background: "#FFF", border: "10px solid #1F2937", borderRadius: "14px 14px 4px 4px", color: "#111", fontSize: 10, lineHeight: 1.35, padding: 8, display: "flex", flexDirection: "column", gap: 6, boxShadow: sombra, textAlign: "left", ...style }}>{children}</div>
      <div style={{ width: 56, height: 30, background: "#1F2937", margin: "0 auto", clipPath: "polygon(25% 0,75% 0,100% 100%,0 100%)" }} />
    </div>
  );
}

export function TV({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return <div style={{ width: "min(100%, 400px)", aspectRatio: "16 / 9", background: "#0B1220", border: "8px solid #111827", borderRadius: 8, color: "#E2E8F0", fontSize: 10, padding: 8, boxShadow: sombra, ...style }}>{children}</div>;
}

/** Cupom/comanda impressa, com a borda serrilhada embaixo. */
export function Papel({ children, largura = 150 }: { children: ReactNode; largura?: number }) {
  const serra = "linear-gradient(#000 0 0) top/100% calc(100% - 6px) no-repeat, radial-gradient(circle at 5px 6px, transparent 4px, #000 4.5px) bottom/10px 6px repeat-x";
  return <div style={{ width: largura, background: "#FFF", color: "#111", font: `500 9px/1.45 ${MONO}`, padding: "10px 10px 14px", boxShadow: "0 10px 22px rgba(15,23,42,.18)", WebkitMask: serra, mask: serra, textAlign: "left" }}>{children}</div>;
}

export function Traco() {
  return <hr style={{ border: 0, borderTop: "1px dashed #999", margin: "5px 0" }} />;
}

/** Um QR de mentira (desenho), com os três quadrados de canto. */
export function Qr({ modulos = 21, px = 3 }: { modulos?: number; px?: number }) {
  const n = modulos, s = px;
  const quadrados: ReactNode[] = [];
  let x = 7;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    x = (x * 73 + 19) % 101;
    const canto = (i < 8 && j < 8) || (i > n - 9 && j < 8) || (i < 8 && j > n - 9);
    if (!canto && x % 2) quadrados.push(<rect key={`${i}-${j}`} x={i * s} y={j * s} width={s} height={s} fill="#111" />);
  }
  const canto = (a: number, b: number) => (
    <g key={`c${a}${b}`}>
      <rect x={a * s} y={b * s} width={7 * s} height={7 * s} fill="#111" />
      <rect x={(a + 1) * s} y={(b + 1) * s} width={5 * s} height={5 * s} fill="#FFF" />
      <rect x={(a + 2) * s} y={(b + 2) * s} width={3 * s} height={3 * s} fill="#111" />
    </g>
  );
  return (
    <svg width={n * s} height={n * s} viewBox={`0 0 ${n * s} ${n * s}`} style={{ background: "#FFF", padding: 4, borderRadius: 4, boxSizing: "content-box", flex: "none" }} aria-hidden>
      {quadrados}{canto(0, 0)}{canto(n - 7, 0)}{canto(0, n - 7)}
    </svg>
  );
}

export function CodigoDeBarras({ altura = 28 }: { altura?: number }) {
  return <div style={{ height: altura, background: "repeating-linear-gradient(90deg,#111 0 2px,#FFF 2px 3px,#111 3px 4px,#FFF 4px 6px,#111 6px 9px,#FFF 9px 10px)" }} />;
}

/** Leitor de código de barras com o feixe vermelho correndo. */
export function Leitor() {
  return (
    <div style={{ position: "relative", width: 70, height: 96, flex: "none" }} aria-hidden>
      <div style={{ position: "absolute", left: 8, top: 0, width: 52, height: 26, background: "#475569", borderRadius: 8, transform: "rotate(-18deg)" }} />
      <div style={{ position: "absolute", left: 24, top: 8, width: 22, height: 60, background: "#334155", borderRadius: "6px 6px 10px 10px", transform: "rotate(-18deg)" }} />
      <div className="ilu-scan" style={{ position: "absolute", left: 0, top: 26, width: 70, height: 3, background: "#EF4444", boxShadow: "0 0 8px #EF4444" }} />
    </div>
  );
}

/** Cartão de comanda numerada (self-service por quilo). */
export function CartaoDeComanda({ numero, loja, largura = 150, girar = 0 }: { numero: number; loja?: string; largura?: number; girar?: number }) {
  return (
    <div style={{ width: largura, aspectRatio: "1.6", background: "#FFF", borderRadius: 9, padding: 9, color: "#111", fontWeight: 700, fontSize: 11, boxShadow: "0 10px 22px rgba(15,23,42,.18)", display: "flex", flexDirection: "column", justifyContent: "space-between", transform: girar ? `rotate(${girar}deg)` : undefined, textAlign: "left" }}>
      <span>{loja ? `${loja} · ` : ""}Comanda</span>
      <span style={{ font: `800 26px ${MONO}` }}>{numero}</span>
      <CodigoDeBarras altura={16} />
    </div>
  );
}

/** Cartão branco (tela clara do painel, resumo, pedido novo). */
export function Painel({ titulo, sub, children, largura = 400, style }: { titulo?: ReactNode; sub?: ReactNode; children?: ReactNode; largura?: number; style?: CSSProperties }) {
  return (
    <div style={{ width: `min(100%, ${largura}px)`, background: "#FFF", borderRadius: 12, color: "#111", fontSize: 11, lineHeight: 1.4, padding: 12, boxShadow: "0 12px 26px rgba(15,23,42,.16)", display: "grid", gap: 7, textAlign: "left", ...style }}>
      {titulo && <b style={{ fontSize: 13, fontWeight: 800 }}>{titulo}</b>}
      {sub && <span style={{ color: "#64748B", fontSize: 10 }}>{sub}</span>}
      {children}
    </div>
  );
}

/** Selo do que acontece depois (venda concluída, estoque, financeiro). */
export function Selo({ children, cor = "branco" }: { children: ReactNode; cor?: "verde" | "laranja" | "azul" | "branco" }) {
  const c = { verde: ["#DCFCE7", "#166534"], laranja: ["#FFEDD5", "#9A3412"], azul: ["#DBEAFE", "#1E40AF"], branco: ["#FFF", "#111"] }[cor];
  return <span style={{ fontWeight: 700, fontSize: 11, padding: "6px 10px", borderRadius: 8, background: c[0], color: c[1], boxShadow: "0 6px 14px rgba(15,23,42,.14)", justifySelf: "start" }}>{children}</span>;
}

export function Selos({ children }: { children: ReactNode }) {
  return <div style={{ display: "grid", gap: 6 }}>{children}</div>;
}

export function Seta({ para = "→" }: { para?: "→" | "←" }) {
  return <span aria-hidden style={{ fontWeight: 800, fontSize: 22, color: LARANJA }}>{para}</span>;
}

/** Mapa simples (ruas em branco sobre verde) para pinos e rotas. */
export function Mapa({ children }: { children: ReactNode }) {
  const ruas = "linear-gradient(90deg,transparent 46%,#FFF 46% 49%,transparent 49%),linear-gradient(0deg,transparent 30%,#FFF 30% 33%,transparent 33%),linear-gradient(0deg,transparent 70%,#FFF 70% 72%,transparent 72%),linear-gradient(90deg,transparent 78%,#FFF 78% 80%,transparent 80%),#D7EAD3";
  return <div style={{ position: "relative", width: "min(100%, 400px)", aspectRatio: "16 / 10", borderRadius: 12, overflow: "hidden", boxShadow: "0 12px 26px rgba(15,23,42,.16)", background: ruas }}>{children}</div>;
}

export function Pino({ x, y, children, cor = LARANJA }: { x: string; y: string; children: ReactNode; cor?: string }) {
  return (
    <div style={{ position: "absolute", left: x, top: y, width: 24, height: 24, borderRadius: "50% 50% 50% 0", transform: "rotate(-45deg)", background: cor, display: "grid", placeItems: "center", boxShadow: "0 3px 6px rgba(0,0,0,.3)" }}>
      <span style={{ transform: "rotate(45deg)", color: "#FFF", fontWeight: 800, fontSize: 10 }}>{children}</span>
    </div>
  );
}

/** Rótulo branco no canto do mapa. */
export function RotuloDoMapa({ children, canto = "esq" }: { children: ReactNode; canto?: "esq" | "dir" }) {
  return <div style={{ position: "absolute", [canto === "esq" ? "left" : "right"]: 8, bottom: 8, background: "#FFF", borderRadius: 6, padding: "4px 8px", fontWeight: 700, fontSize: 11, color: "#111" }}>{children}</div>;
}

/** Fotinho de produto (gradiente no lugar da foto). */
export function FotoDeProduto({ altura = 34, azul }: { altura?: number; azul?: boolean }) {
  return <i style={{ display: "block", height: altura, borderRadius: 4, background: azul ? "linear-gradient(135deg,#93C5FD,#2563EB)" : "linear-gradient(135deg,#FDBA74,#EA580C)", marginBottom: 3 }} />;
}

/** Barras horizontais com rótulo e valor (média, "onde está o dinheiro"). */
export function Barras({ linhas }: { linhas: { rotulo: string; pct: number; valor: string; cor?: string }[] }) {
  return (
    <div style={{ display: "grid", gap: 5 }}>
      {linhas.map((l) => (
        <div key={l.rotulo} style={{ display: "grid", gridTemplateColumns: "100px 1fr 54px", gap: 6, alignItems: "center", fontSize: 10.5 }}>
          <span>{l.rotulo}</span>
          <i style={{ height: 12, borderRadius: 3, background: l.cor ?? LARANJA, width: `${l.pct}%` }} />
          <b>{l.valor}</b>
        </div>
      ))}
    </div>
  );
}

export const estiloMono = MONO;
