"use client";

import { useEffect, useState } from "react";

/**
 * A demonstração do topo da página: o Chrome da loja, com as duas abas que
 * importam e o popup da extensão aberto.
 *
 * Refeita em 19/09/2026 a pedido do dono: "queria algo mostrando no Google
 * Chrome, na aba do iFood, mudando a entrega, e a extensão aberta de
 * verdade". A versão anterior mostrava painel e popup lado a lado, sem
 * navegador — explicava o cálculo e escondia o que o lojista compra, que é
 * o número mudando SOZINHO no Portal do Parceiro.
 *
 * O ciclo conta a história inteira em três cenas, e a janela troca de aba
 * como trocaria na mão:
 *   1. aba do painel: a fila enche (é daí que sai o número);
 *   2. aba do Portal: a extensão escreve — o campo pisca em "salvando";
 *   3. aba do Portal: salvo, com o horário e a pílula verde.
 *
 * O que está desenhado aqui é o que a extensão faz de verdade:
 *   - o popup é o `popup/popup.html` (cabeçalho, as três caixas SEU PAINEL /
 *     IFOOD / 99FOOD, o banner com os minutos, a chave do robô e a lista de
 *     lojas marcadas);
 *   - a pílula no canto inferior direito da página do iFood é a que
 *     `scripts/ifood.js` injeta, com o mesmo texto ("58 min · 8 ped. · 3/3
 *     loja(s)") e a mesma regra de cor (laranja esperando, verde aplicado);
 *   - a tabela de prazo é a do servidor (28/38/58/78 por motoboy).
 * Nada de logotipo do iFood: a janela mostra o endereço e o nome da tela,
 * que é o que identifica o lugar sem vestir a marca de ninguém.
 *
 * Sem biblioteca de animação: a página precisa abrir em menos de 2 s no 4G.
 */

const ROTEIRO = [3, 5, 8, 11, 14, 9, 6, 3];
const MOTOBOYS = 3;
/**
 * As três lojas eram "Centro", "Shopping" e "Praia" — três bairros, que é
 * justamente o que a extensão NÃO faz com uma assinatura só. A cozinha da
 * demonstração é uma: quem muda de prazo junto são as marcas que saem dela.
 */
const LOJAS = ["Burger da Casa", "Pastel do Zé", "Açaí da Esquina"];

function faixaDoPrazo(pedidos: number) {
  if (pedidos <= MOTOBOYS) return { minutos: 28, cor: "#22C55E", estouro: false };
  if (pedidos <= 2 * MOTOBOYS) return { minutos: 38, cor: "#84CC16", estouro: false };
  if (pedidos <= 3 * MOTOBOYS) return { minutos: 58, cor: "#F59E0B", estouro: false };
  if (pedidos <= 4 * MOTOBOYS) return { minutos: 78, cor: "#F97316", estouro: false };
  return { minutos: 78, cor: "#EF4444", estouro: true };
}

const NOMES = ["Ana", "Lucas", "Bia", "Caio", "Dani", "Edu", "Fê", "Gui", "Hugo", "Ivo", "Jorge", "Kau", "Lia", "Nina"];
const ITENS = ["X-burguer", "Pastel", "Esfiha", "Combo 2", "Pizza", "Açaí", "Coxinha"];

/** As cenas do ciclo, na ordem, com quanto cada uma fica na tela. */
const CENAS = [
  { aba: "painel", fase: "lendo", ms: 2600 },
  { aba: "portal", fase: "escrevendo", ms: 1100 },
  { aba: "portal", fase: "salvo", ms: 2600 },
] as const;

export default function DemoAoVivo() {
  const [passo, setPasso] = useState(0);
  const [cena, setCena] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => {
      const proxima = (cena + 1) % CENAS.length;
      setCena(proxima);
      // Volta para a aba do painel = a fila mudou de novo.
      if (proxima === 0) setPasso((p) => p + 1);
    }, CENAS[cena].ms);
    return () => clearTimeout(t);
  }, [cena]);

  const { aba, fase } = CENAS[cena];
  const pedidos = ROTEIRO[passo % ROTEIRO.length];
  const anteriores = ROTEIRO[(passo + ROTEIRO.length - 1) % ROTEIRO.length];
  const f = faixaDoPrazo(pedidos);
  const fAnterior = faixaDoPrazo(anteriores);
  // Enquanto está escrevendo, o Portal ainda mostra o número velho — é esse
  // atraso de um segundo que faz a pessoa entender quem mexeu no campo.
  const minutosNoPortal = fase === "salvo" ? f.minutos : fAnterior.minutos;
  const preparo99 = Math.max(5, Math.min(30, f.minutos - 15));
  const cheio = Math.min(100, (pedidos / (4 * MOTOBOYS)) * 100);
  const novos = Math.max(1, Math.round(pedidos / 4));

  const cartaoPedido: React.CSSProperties = {
    background: "#fff", border: "1px solid #E2E8F0", borderRadius: 7,
    padding: "4px 7px", fontSize: ".64rem", marginBottom: 4, lineHeight: 1.25, color: "#0F172A",
  };
  const abaBase: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 6, padding: "6px 12px",
    borderRadius: "8px 8px 0 0", fontSize: ".68rem", fontWeight: 700,
    maxWidth: 190, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
  };

  return (
    <div className="demo-chrome">
      {/* ─────────── A janela do Chrome ─────────── */}
      <div style={{ background: "#DEE1E6", borderRadius: "12px 12px 0 0", padding: "8px 10px 0", boxShadow: "0 18px 45px rgba(0,0,0,.35)" }}>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
          <div style={{ display: "flex", gap: 5, padding: "0 8px 8px 2px" }}>
            {["#FF5F57", "#FEBC2E", "#28C840"].map((c) => (
              <span key={c} style={{ width: 9, height: 9, borderRadius: 999, background: c, display: "block" }} />
            ))}
          </div>
          <div style={{ ...abaBase, background: aba === "painel" ? "#fff" : "#C9CDD3", color: aba === "painel" ? "#0F172A" : "#4B5563" }}>
            <span style={{ fontSize: ".7rem" }}>📋</span> Meu painel de pedidos
          </div>
          <div style={{ ...abaBase, background: aba === "portal" ? "#fff" : "#C9CDD3", color: aba === "portal" ? "#0F172A" : "#4B5563" }}>
            <span style={{ fontSize: ".7rem" }}>🛵</span> Portal do Parceiro
          </div>
        </div>

        {/* Barra de endereço + o ícone da extensão, com o anel de "aberta" */}
        <div style={{ background: "#fff", display: "flex", alignItems: "center", gap: 8, padding: "7px 10px" }}>
          <span style={{ color: "#9AA0A6", fontSize: ".72rem", letterSpacing: "-1px" }}>←　→　⟳</span>
          <div style={{ flex: 1, background: "#F1F3F4", borderRadius: 999, padding: "4px 10px", fontSize: ".66rem", color: "#3C4043", display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span style={{ fontSize: ".6rem" }}>🔒</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {aba === "portal" ? "portal.ifood.com.br/entrega/tempo-de-entrega" : "meupainel.com.br/pedidos"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ color: "#5F6368", fontSize: ".72rem" }}>🧩</span>
            <span style={{
              display: "grid", placeItems: "center", width: 22, height: 22, borderRadius: 7,
              background: "linear-gradient(135deg,#FF5722,#F44336)", fontSize: ".7rem",
              boxShadow: "0 0 0 2.5px rgba(255,87,34,.35)",
            }}>🔥</span>
          </div>
        </div>
      </div>

      {/* ─────────── O conteúdo da aba ─────────── */}
      <div className="demo-conteudo" style={{ position: "relative", background: aba === "portal" ? "#F8F8F8" : "#F1F5F9", borderRadius: "0 0 12px 12px", padding: 12, boxShadow: "0 18px 45px rgba(0,0,0,.3)" }}>
        {aba === "painel" ? (
          <div>
            <div style={{ fontSize: ".6rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>
              Seu sistema · pedidos de hoje
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: ".68rem", fontWeight: 700, marginBottom: 6, color: "#0F172A" }}>
                  <span>Novos</span>
                  <span style={{ background: "#0F172A", color: "#fff", borderRadius: 999, minWidth: 20, height: 20, display: "grid", placeItems: "center", fontSize: ".64rem" }}>{novos}</span>
                </div>
                {Array.from({ length: novos }).map((_, i) => (
                  <div key={i} style={cartaoPedido}>
                    <b style={{ display: "block", fontSize: ".68rem" }}>#{200 + i} {NOMES[(i + 3) % NOMES.length]}</b>
                    <span style={{ color: "#64748B" }}>{ITENS[(i + 2) % ITENS.length]}</span>
                  </div>
                ))}
              </div>

              <div style={{ background: "#FFF7ED", border: "2px solid #FF5722", borderRadius: 10, padding: 8, boxShadow: "0 0 0 4px rgba(255,87,34,.12)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: ".68rem", fontWeight: 700, marginBottom: 6, color: "#0F172A" }}>
                  <span>Em preparo</span>
                  <span style={{ background: "#FF5722", color: "#fff", borderRadius: 999, minWidth: 20, height: 20, display: "grid", placeItems: "center", fontSize: ".64rem" }}>{pedidos}</span>
                </div>
                <div style={{ maxHeight: 176, overflow: "hidden" }}>
                  {Array.from({ length: pedidos }).map((_, i) => (
                    <div key={i} style={cartaoPedido}>
                      <b style={{ display: "block", fontSize: ".68rem" }}>#{100 + i} {NOMES[i % NOMES.length]}</b>
                      <span style={{ color: "#64748B" }}>{ITENS[i % ITENS.length]}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ fontSize: ".62rem", color: "#64748B", marginTop: 8, textAlign: "center" }}>
              A coluna laranja é a que você marcou com um clique.
            </div>
          </div>
        ) : (
          <div>
            <div style={{ fontSize: ".6rem", fontWeight: 800, color: "#9AA0A6", textTransform: "uppercase", letterSpacing: ".4px", marginBottom: 8 }}>
              Portal do Parceiro · Entrega
            </div>
            <div style={{ background: "#fff", border: "1px solid #E5E7EB", borderRadius: 12, padding: "20px 18px", boxShadow: "0 2px 8px rgba(15,23,42,.06)" }}>
              <div style={{ fontSize: ".72rem", color: "#6B7280", fontWeight: 700 }}>Tempo de entrega para novos pedidos</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 6 }}>
                <div style={{ fontSize: "3rem", fontWeight: 900, color: "#111827", lineHeight: 1.05, transition: "color .3s" }}>
                  {minutosNoPortal}
                </div>
                <div style={{ fontSize: ".9rem", fontWeight: 700, color: "#6B7280" }}>minutos</div>
                {fase === "escrevendo" ? (
                  <span style={{ marginLeft: "auto", background: "#FEF3C7", color: "#92400E", fontWeight: 800, fontSize: ".64rem", padding: "4px 9px", borderRadius: 999 }}>
                    ↻ salvando…
                  </span>
                ) : (
                  <span style={{ marginLeft: "auto", background: "#DCFCE7", color: "#166534", fontWeight: 800, fontSize: ".64rem", padding: "4px 9px", borderRadius: 999 }}>
                    ✓ salvo agora
                  </span>
                )}
              </div>
              <div style={{ height: 1, background: "#F3F4F6", margin: "14px 0 12px" }} />
              <div style={{ fontSize: ".66rem", color: "#6B7280", lineHeight: 1.5 }}>
                {fase === "escrevendo"
                  ? "Gravando o novo tempo nas lojas marcadas…"
                  : `Alterado pela extensão FireHub Prazos · ${LOJAS.length} lojas desta cozinha`}
              </div>
              {/* As três marcas aparecem na tela do portal porque é assim que
                  o lojista confere: uma linha por loja, todas com o mesmo
                  número, mudadas na mesma passada. */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                {LOJAS.map((l) => (
                  <span key={l} style={{
                    background: fase === "salvo" ? "#F0FDF4" : "#FFFBEB",
                    border: `1px solid ${fase === "salvo" ? "#BBF7D0" : "#FDE68A"}`,
                    color: fase === "salvo" ? "#166534" : "#92400E",
                    borderRadius: 999, padding: "4px 10px", fontSize: ".62rem", fontWeight: 700,
                  }}>
                    {l} · {fase === "salvo" ? `${f.minutos} min ✓` : "salvando…"}
                  </span>
                ))}
              </div>
            </div>

            {/* A pílula que scripts/ifood.js desenha por cima da página. */}
            <div style={{
              marginTop: 12, display: "inline-flex", alignItems: "center", gap: 8,
              background: "linear-gradient(135deg,#0F172A,#1E293B)", color: "#fff",
              border: `1.5px solid ${fase === "salvo" ? "#22C55E" : "#FF5722"}`, borderRadius: 20,
              padding: "6px 14px", fontSize: ".66rem", fontWeight: 800, boxShadow: "0 8px 25px rgba(0,0,0,.25)",
            }}>
              <span>🔥</span>
              <span>FireHub Prazos: {f.minutos} min · {pedidos} ped. · {fase === "salvo" ? "3/3" : "0/3"} loja(s)</span>
            </div>
          </div>
        )}

        {/* ─────────── O popup da extensão, ancorado no ícone ─────────── */}
        <div className="demo-popup">
          <div style={{ background: "#0B1220", border: "1px solid #334155", borderRadius: 12, padding: 11, display: "flex", flexDirection: "column", gap: 9, boxShadow: "0 20px 50px rgba(0,0,0,.45)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: 8, background: "linear-gradient(135deg,#FF5722,#F44336)", display: "grid", placeItems: "center", fontSize: ".9rem" }}>🔥</div>
              <div style={{ minWidth: 0 }}>
                <b style={{ fontSize: ".82rem" }}>FireHub Prazos</b>
                <div style={{ color: "#94A3B8", fontSize: ".52rem", fontWeight: 800, letterSpacing: ".2px", whiteSpace: "nowrap" }}>IFOOD E 99FOOD</div>
              </div>
              <span style={{ marginLeft: "auto", background: "rgba(34,197,94,.15)", border: "1px solid rgba(34,197,94,.5)", color: "#4ADE80", fontSize: ".54rem", fontWeight: 800, padding: "3px 7px", borderRadius: 999, whiteSpace: "nowrap" }}>
                ATIVO
              </span>
            </div>

            {/* As três caixas do popup de verdade. */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 5 }}>
              {[
                ["SEU PAINEL", `${pedidos} ped.`, "#fff"],
                ["IFOOD", fase === "salvo" ? "✓ ok" : "↻", fase === "salvo" ? "#4ADE80" : "#FBBF24"],
                ["99FOOD", fase === "salvo" ? "✓ ok" : "↻", fase === "salvo" ? "#4ADE80" : "#FBBF24"],
              ].map(([t, v, cor]) => (
                <div key={t} style={{ background: "#0F172A", border: "1px solid #334155", borderRadius: 8, padding: "5px 6px", textAlign: "center" }}>
                  <div style={{ fontSize: ".47rem", color: "#94A3B8", fontWeight: 800, letterSpacing: ".3px" }}>{t}</div>
                  <div style={{ fontSize: ".68rem", fontWeight: 900, color: cor, marginTop: 1 }}>{v}</div>
                </div>
              ))}
            </div>

            <div style={{ background: "#0F172A", border: "1px solid #334155", borderRadius: 10, padding: "9px 10px", display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: ".62rem", fontWeight: 800 }}>{f.estouro ? "Cozinha lotada" : "Prazo no iFood"}</div>
                <div style={{ fontSize: ".54rem", color: "#94A3B8" }}>{pedidos} na fila · {MOTOBOYS} motoboys · 99Food {preparo99} min</div>
                <div style={{ height: 5, borderRadius: 999, background: "#1E293B", overflow: "hidden", marginTop: 5 }}>
                  <div style={{ height: "100%", width: `${cheio}%`, background: "linear-gradient(90deg,#22C55E,#F59E0B,#EF4444)", transition: "width .6s ease" }} />
                </div>
              </div>
              <div style={{ fontSize: "1.6rem", fontWeight: 900, color: f.cor, lineHeight: 1, transition: "color .4s" }}>{f.minutos}</div>
            </div>

            {/* A chave do robô: é o que o lojista desliga quando quer. */}
            <div style={{ background: "#0F172A", border: "1px solid #334155", borderRadius: 10, padding: "7px 10px", display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: ".62rem", fontWeight: 800 }}>Robô ligado</div>
                <div style={{ fontSize: ".52rem", color: "#94A3B8" }}>Ajusta sozinho nas lojas marcadas</div>
              </div>
              <span style={{ width: 30, height: 17, borderRadius: 999, background: "#22C55E", position: "relative", flexShrink: 0 }}>
                <span style={{ position: "absolute", top: 2, right: 2, width: 13, height: 13, borderRadius: 999, background: "#fff" }} />
              </span>
            </div>

            <div>
              <div style={{ fontSize: ".54rem", color: "#94A3B8", fontWeight: 800, letterSpacing: ".3px", marginBottom: 4 }}>
                🏪 LOJAS QUE MUDAM DE PRAZO · MESMA COZINHA
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                {LOJAS.map((l) => (
                  <div key={l} style={{ display: "flex", alignItems: "center", gap: 6, background: "#0F172A", border: "1px solid #334155", borderRadius: 8, padding: "5px 8px", fontSize: ".62rem" }}>
                    <span>🛵</span><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l}</span>
                    <span style={{ marginLeft: "auto", fontWeight: 800, fontSize: ".6rem", color: fase === "salvo" ? "#34D399" : "#FBBF24", whiteSpace: "nowrap" }}>
                      {fase === "salvo" ? "✓" : "↻"} {f.minutos} min
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      <div style={{ color: "#94A3B8", fontSize: ".78rem", marginTop: 10, textAlign: "center", lineHeight: 1.5 }}>
        A fila do seu painel enche · a extensão escreve no Portal do Parceiro · o cliente vê o prazo certo.
      </div>

      <style>{`
        .demo-chrome { position: relative; }
        /* No desktop o popup fica ancorado embaixo do ícone da extensão,
           como abre no Chrome de verdade — e a página abre espaço para ele,
           senão ele tapa justamente a coluna de pedidos que interessa. */
        /* A altura acompanha o popup: ele é ancorado no ícone e, como no
           Chrome de verdade, não pode vazar para fora da janela. */
        .demo-conteudo { padding-right: 276px !important; min-height: 366px; }
        .demo-popup { position: absolute; top: 10px; right: 10px; width: 252px; z-index: 5; }
        .demo-popup::before {
          content: ""; position: absolute; top: -6px; right: 16px;
          border-left: 7px solid transparent; border-right: 7px solid transparent;
          border-bottom: 7px solid #334155;
        }
        @media (max-width: 860px) {
          /* No celular ele não cabe por cima: vira o bloco de baixo, que é
             onde o polegar já está. */
          .demo-conteudo { padding-right: 12px !important; min-height: 0; }
          .demo-popup { position: static; width: auto; margin-top: 12px; }
          .demo-popup::before { display: none; }
        }
      `}</style>
    </div>
  );
}
