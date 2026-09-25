import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, ArrowDown, MousePointer2 } from "lucide-react";

/**
 * Os desenhos da página de venda: o que a loja vê de verdade, em miniatura.
 *
 * Nasceram das ilustrações do passo a passo da extensão do painel
 * (src/app/store/extensao-ifood/ilustracoes.tsx), que o dono aprovou em
 * 25/09/2026: "ficaram ótimas, use na página de venda". Não são as mesmas,
 * porque a extensão é outra — a do painel lê o FireHub e só escreve no iFood;
 * a FireHub Prazos lê o painel do sistema que a loja JÁ usa e escreve no iFood
 * e no 99Food. Desenhar o FireHub aqui venderia um produto que o cliente não
 * vai receber.
 *
 * Os rótulos são os da extensão e do e-mail de acesso:
 *   - firehub-prazos-extension/popup/popup.html ("📋 Colunas que contam
 *     pedido", "➕ Marcar coluna na aba atual", "🤖 Robô ligado");
 *   - a pílula que scripts/ifood.js injeta ("58 min · 8 ped. · 3/3 loja(s)");
 *   - o e-mail de api/prazos/cakto ("FireHub Prazos — seu acesso à extensão",
 *     "1. Instalar a extensão no Chrome", "2. Ativar minha conta").
 * Trocou o texto lá, troque aqui — senão a página promete um botão que não
 * existe.
 *
 * Nada de logotipo do iFood nem do 99: o nome da tela e a cor do botão
 * identificam o lugar sem vestir a marca de ninguém (mesma regra da
 * DemoAoVivo). HTML e CSS puros — a página abre em menos de 2 s no 4G.
 */

const LARANJA = "#FF5722";
const VERMELHO_IFOOD = "#EA1D2C";
const AMARELO_99 = "#FFC700";

const moldura: CSSProperties = {
  background: "#FFF",
  border: "1px solid #CBD5E1",
  borderRadius: 12,
  boxShadow: "0 10px 26px rgba(15,23,42,0.10)",
  overflow: "hidden",
  fontSize: 11,
  textAlign: "left",
};

const popupFundo: CSSProperties = {
  background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)",
  color: "#F8FAFC",
  borderRadius: 14,
  padding: 11,
  boxShadow: "0 14px 34px rgba(15,23,42,0.28)",
  fontSize: 11,
  textAlign: "left",
};

/** Etiqueta laranja de "é aqui". */
export function Destaque({ children }: { children: ReactNode }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#E8360C", color: "#FFF", fontSize: 10.5, fontWeight: 900, padding: "3px 9px", borderRadius: 999, boxShadow: "0 3px 10px rgba(232,54,12,0.35)", whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

/** Cabeçalho do popup da FireHub Prazos. */
function CabecalhoDoPopup() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBottom: 8, marginBottom: 8, borderBottom: "1px solid #334155" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: `linear-gradient(135deg, ${LARANJA}, #F44336)`, display: "grid", placeItems: "center", fontSize: 12 }}>🔥</div>
        <div>
          <div style={{ fontWeight: 900, fontSize: 11.5 }}>FireHub Prazos</div>
          <div style={{ fontSize: 8, color: "#FF7A59", fontWeight: 800, letterSpacing: 0.2 }}>PRAZO AUTOMÁTICO · IFOOD E 99FOOD</div>
        </div>
      </div>
    </div>
  );
}

/** Barra de abas do Chrome com a aba ativa em branco. */
function Abas({ abas }: { abas: { cor: string; letra: string; titulo: string; ativa?: boolean }[] }) {
  return (
    <div style={{ display: "flex", gap: 3, padding: "6px 6px 0", background: "#DDE3EA" }}>
      {abas.map((a) => (
        <div key={a.titulo} style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 5, padding: "6px 7px", borderRadius: "8px 8px 0 0", background: a.ativa ? "#FFF" : "transparent", fontWeight: 700, color: "#0F172A", fontSize: 9.5 }}>
          <span style={{ width: 13, height: 13, borderRadius: 4, background: a.cor, display: "grid", placeItems: "center", fontSize: 7.5, color: a.cor === AMARELO_99 ? "#0F172A" : "#FFF", fontWeight: 900, flexShrink: 0 }}>{a.letra}</span>
          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.titulo}</span>
        </div>
      ))}
    </div>
  );
}

/** Uma coluna do quadro de pedidos: título, contador e cartões cinzas. */
function Coluna({ titulo, pedidos, marcada = false }: { titulo: string; pedidos: number; marcada?: boolean }) {
  return (
    <div style={{ flex: 1, minWidth: 0, border: marcada ? `2px solid ${LARANJA}` : "1px solid #E2E8F0", borderRadius: 9, background: marcada ? "#FFF7ED" : "#F8FAFC", padding: 6, position: "relative" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 800, fontSize: 10.5, color: "#0F172A", marginBottom: 5, gap: 4 }}>
        <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{titulo}</span>
        <span style={{ background: marcada ? "#0F172A" : "#CBD5E1", color: marcada ? "#FFF" : "#334155", borderRadius: 999, padding: "0 7px", fontSize: 10, flexShrink: 0 }}>{pedidos}</span>
      </div>
      <div style={{ display: "grid", gap: 4 }}>
        {Array.from({ length: Math.min(pedidos, 3) }).map((_, i) => (
          <div key={i} style={{ height: 11, borderRadius: 4, background: marcada ? "#FED7AA" : "#E2E8F0" }} />
        ))}
      </div>
    </div>
  );
}

/** O campo de tempo de um portal: nome da tela, − valor +, e o botão da cor da casa. */
function CampoDoPortal({ tela, valor, cor, botao }: { tela: string; valor: string; cor: string; botao?: string }) {
  const texto = cor === AMARELO_99 ? "#0F172A" : "#FFF";
  return (
    <div style={{ border: "1px solid #E2E8F0", borderRadius: 10, padding: "7px 9px", background: "#FFF" }}>
      <div style={{ fontSize: 9.5, color: "#64748B", fontWeight: 700 }}>{tela}</div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 5 }}>
        <span style={{ width: 20, height: 20, borderRadius: 999, border: `1.5px solid ${cor === AMARELO_99 ? "#CA8A04" : cor}`, color: cor === AMARELO_99 ? "#CA8A04" : cor, display: "grid", placeItems: "center", fontWeight: 900 }}>−</span>
        <span style={{ fontWeight: 900, fontSize: 16, color: "#0F172A" }}>{valor}</span>
        <span style={{ width: 20, height: 20, borderRadius: 999, border: `1.5px solid ${cor === AMARELO_99 ? "#CA8A04" : cor}`, color: cor === AMARELO_99 ? "#CA8A04" : cor, display: "grid", placeItems: "center", fontWeight: 900 }}>+</span>
      </div>
      {botao && (
        <div style={{ marginTop: 6, background: cor, color: texto, borderRadius: 6, textAlign: "center", fontWeight: 800, fontSize: 10.5, padding: "3px 0" }}>{botao}</div>
      )}
    </div>
  );
}

/**
 * COMO FUNCIONA: "o painel mostra a fila → a extensão calcula → iFood e 99
 * mudam". Deitado no computador, em pé no celular (classes pz-fluxo/pz-seta-*).
 */
export function FluxoDoPrazo() {
  const quadro: CSSProperties = { flex: 1, minWidth: 0, background: "#FFF", border: "1px solid #E2E8F0", borderRadius: 16, padding: "14px 14px 16px", boxShadow: "0 4px 14px rgba(15,23,42,0.05)", display: "flex", flexDirection: "column" };
  const rotulo: CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 900, letterSpacing: 0.3, color: "#334155", textTransform: "uppercase", marginBottom: 10 };
  const numero = (n: number) => (
    <span style={{ width: 22, height: 22, borderRadius: 999, background: `linear-gradient(135deg, ${LARANJA}, #E64A19)`, color: "#FFF", display: "grid", placeItems: "center", fontSize: 12, flexShrink: 0 }}>{n}</span>
  );
  const legenda: CSSProperties = { fontSize: 13.5, color: "#475569", margin: "12px 0 0", lineHeight: 1.45 };
  const seta = (
    <div style={{ display: "grid", placeItems: "center", color: "#E8360C", flexShrink: 0 }} aria-hidden>
      <ArrowRight className="pz-seta-lado" size={26} strokeWidth={2.6} />
      <ArrowDown className="pz-seta-baixo" size={26} strokeWidth={2.6} />
    </div>
  );

  return (
    <div className="pz-fluxo" style={{ display: "flex", alignItems: "stretch", gap: 10 }}>
      <style>{`
        .pz-seta-baixo { display: none; }
        @media (max-width: 760px) {
          .pz-fluxo { flex-direction: column; }
          .pz-seta-lado { display: none; }
          .pz-seta-baixo { display: block; }
        }
      `}</style>

      <div style={quadro}>
        <div style={rotulo}>{numero(1)} Seu painel mostra a fila</div>
        <div style={{ ...moldura, boxShadow: "none" }}>
          <Abas abas={[{ cor: "#334155", letra: "P", titulo: "Painel de pedidos", ativa: true }]} />
          <div style={{ display: "flex", gap: 6, padding: 8 }}>
            <Coluna titulo="Em preparo" pedidos={7} marcada />
            <Coluna titulo="Pronto" pedidos={2} />
          </div>
        </div>
        <p style={legenda}>
          Ela conta os pedidos da coluna que você marcou. <b>Saipos, Cardápio Web, Consumer</b> — o sistema que você já usa.
        </p>
      </div>

      {seta}

      <div style={quadro}>
        <div style={rotulo}>{numero(2)} A extensão calcula</div>
        {/* A conta em duas linhas: os dois números que entram e, embaixo, o
            prazo que sai. Numa linha só o resultado quebrava sozinho. */}
        <div style={{ flex: 1, display: "grid", placeItems: "center", alignContent: "center", gap: 6, background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: "14px 8px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 7, fontWeight: 900, fontSize: 14, color: "#0F172A", flexWrap: "wrap" }}>
            <span style={{ background: "#FFF", border: "1px solid #E2E8F0", borderRadius: 8, padding: "5px 9px" }}>7 pedidos</span>
            <span style={{ color: "#94A3B8" }}>+</span>
            <span style={{ background: "#FFF", border: "1px solid #E2E8F0", borderRadius: 8, padding: "5px 9px" }}>🛵 3 motoboys</span>
          </div>
          <ArrowDown size={18} strokeWidth={2.6} color="#94A3B8" aria-hidden />
          <span style={{ background: "#FEF3C7", color: "#A16207", border: "1px solid #FDE68A", borderRadius: 10, padding: "6px 16px", fontWeight: 900, fontSize: 22 }}>58 min</span>
        </div>
        <p style={legenda}>
          Cruza a fila com os <b>motoboys na casa</b> e escolhe o prazo. Encheu, sobe. Esvaziou, desce.
        </p>
      </div>

      {seta}

      <div style={quadro}>
        <div style={rotulo}>{numero(3)} iFood e 99 mudam</div>
        <div style={{ display: "grid", gap: 6 }}>
          <CampoDoPortal tela="Portal do Parceiro · Tempo de entrega" valor="58 min" cor={VERMELHO_IFOOD} botao="Salvar" />
          <CampoDoPortal tela="99Food · Tempo de preparo" valor="43 min" cor={AMARELO_99} />
        </div>
        <p style={legenda}>
          Ela aperta os mesmos botões que você apertaria, e salva. Nas lojas que você marcou.
        </p>
      </div>
    </div>
  );
}

/** INSTALAR 1: o e-mail que chega depois da compra. */
export function EmailDeAcesso() {
  const botao = (texto: string, fundo: string, marcado: boolean): ReactNode => (
    <div style={{ background: fundo, color: "#FFF", fontWeight: 800, fontSize: 10.5, padding: "7px 10px", borderRadius: 8, textAlign: "center", outline: marcado ? "2px solid #E8360C" : "none", outlineOffset: 2 }}>{texto}</div>
  );
  return (
    <div style={{ ...moldura, width: "100%", maxWidth: 320 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", background: "#F1F5F9", borderBottom: "1px solid #E2E8F0" }}>
        <div style={{ width: 24, height: 24, borderRadius: 999, background: `linear-gradient(135deg, ${LARANJA}, #F44336)`, display: "grid", placeItems: "center", fontSize: 12, flexShrink: 0 }}>🔥</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 800, color: "#0F172A", fontSize: 10.5 }}>FireHub Prazos</div>
          <div style={{ color: "#475569", fontSize: 9.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>seu acesso à extensão</div>
        </div>
        <span style={{ marginLeft: "auto", fontSize: 9, color: "#64748B", flexShrink: 0 }}>agora</span>
      </div>
      <div style={{ padding: 10, display: "grid", gap: 7 }}>
        <div style={{ color: "#334155", fontSize: 10.5 }}>Olá! Sua assinatura do FireHub Prazos está ativa.</div>
        {botao("1. Instalar a extensão no Chrome", `linear-gradient(135deg, ${LARANJA}, #E64A19)`, true)}
        {botao("2. Ativar minha conta", "#0F172A", false)}
      </div>
    </div>
  );
}

/** INSTALAR 2: a ficha na Chrome Web Store e a confirmação do Chrome. */
export function FichaDaLoja() {
  return (
    <div style={{ width: "100%", maxWidth: 320, display: "grid", gap: 8 }}>
      <div style={{ ...moldura, display: "flex", alignItems: "center", gap: 10, padding: 10 }}>
        <div style={{ width: 34, height: 34, borderRadius: 9, background: `linear-gradient(135deg, ${LARANJA}, #F44336)`, display: "grid", placeItems: "center", fontSize: 17, flexShrink: 0 }}>🔥</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 11.5, color: "#0F172A" }}>FireHub Prazos</div>
          <div style={{ fontSize: 9.5, color: "#64748B" }}>Chrome Web Store</div>
        </div>
        <span style={{ background: "#1A73E8", color: "#FFF", borderRadius: 999, padding: "6px 10px", fontWeight: 800, fontSize: 10, whiteSpace: "nowrap", outline: "2px solid #E8360C", outlineOffset: 2 }}>Usar no Chrome</span>
      </div>
      <div style={{ ...moldura, padding: 10 }}>
        <div style={{ fontWeight: 800, color: "#0F172A" }}>Adicionar &quot;FireHub Prazos&quot;?</div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 7, marginTop: 9 }}>
          <span style={{ border: "1px solid #CBD5E1", borderRadius: 999, padding: "4px 10px", color: "#1A73E8", fontWeight: 700 }}>Cancelar</span>
          <span style={{ background: "#1A73E8", color: "#FFF", borderRadius: 999, padding: "4px 10px", fontWeight: 800 }}>Adicionar extensão</span>
        </div>
      </div>
    </div>
  );
}

/** INSTALAR 3: marcar a coluna — o botão do popup e a coluna ganhando a borda. */
export function MarcarColuna() {
  return (
    <div style={{ width: "100%", maxWidth: 320, display: "grid", gap: 8 }}>
      <div style={popupFundo}>
        <CabecalhoDoPopup />
        <div style={{ fontSize: 9.5, fontWeight: 800, color: "#94A3B8", marginBottom: 5 }}>📋 Colunas que contam pedido</div>
        <div style={{ background: `linear-gradient(135deg, ${LARANJA} 0%, #E64A19 100%)`, borderRadius: 7, padding: "6px 0", textAlign: "center", fontWeight: 900, outline: "2px solid #FFF", outlineOffset: 2 }}>
          ➕ Marcar coluna na aba atual
        </div>
      </div>
      <div style={{ ...moldura, padding: 8, position: "relative" }}>
        <div style={{ display: "flex", gap: 6 }}>
          <Coluna titulo="Em preparo" pedidos={7} marcada />
          <Coluna titulo="Pronto" pedidos={1} />
        </div>
        <span style={{ position: "absolute", left: "38%", top: "46%", color: "#0F172A" }} aria-hidden>
          <MousePointer2 size={20} fill="#FFF" strokeWidth={2} />
        </span>
        <div style={{ marginTop: 7 }}>
          <Destaque>✓ Em preparo marcada</Destaque>
        </div>
      </div>
    </div>
  );
}

/** INSTALAR 4: as três abas abertas no Chrome da loja, e a pílula trabalhando. */
export function AbasAbertas() {
  return (
    <div style={{ width: "100%", maxWidth: 320, display: "grid", gap: 8 }}>
      <div style={moldura}>
        <Abas
          abas={[
            { cor: "#334155", letra: "P", titulo: "Painel de pedidos" },
            { cor: VERMELHO_IFOOD, letra: "i", titulo: "Portal do Parceiro", ativa: true },
            { cor: AMARELO_99, letra: "99", titulo: "99Food Admin" },
          ]}
        />
        <div style={{ position: "relative", padding: "12px 10px 40px", background: "#FFF" }}>
          <div style={{ height: 10, width: "70%", borderRadius: 4, background: "#F1F5F9", marginBottom: 6 }} />
          <div style={{ height: 10, width: "50%", borderRadius: 4, background: "#F1F5F9" }} />
          <span style={{ position: "absolute", right: 8, bottom: 8, display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 10px", borderRadius: 999, fontSize: 10, fontWeight: 800, background: "linear-gradient(135deg, #065F46 0%, #064E3B 100%)", border: "1.5px solid #34D399", color: "#FFF", boxShadow: "0 6px 16px rgba(15,23,42,0.22)", whiteSpace: "nowrap" }}>
            🔥 58 min · 8 ped. · 3/3 loja(s)
          </span>
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", ...popupFundo, padding: "8px 10px" }}>
        <div>
          <div style={{ fontWeight: 800 }}>🤖 Robô ligado</div>
          <div style={{ fontSize: 8.5, color: "#94A3B8" }}>Ajusta iFood e 99Food sozinho, nas lojas marcadas</div>
        </div>
        <span style={{ position: "relative", width: 34, height: 19, borderRadius: 999, background: "#22C55E", flexShrink: 0 }}>
          <span style={{ position: "absolute", top: 2, left: 17, width: 15, height: 15, borderRadius: 999, background: "#FFF" }} />
        </span>
      </div>
    </div>
  );
}
