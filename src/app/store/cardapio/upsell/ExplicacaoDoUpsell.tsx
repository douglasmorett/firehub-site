"use client";
import { useState } from "react";

/**
 * O topo da tela do Upsell: o que é, como funciona e a janela que o cliente
 * vê no site, desenhada (Douglas, 20/11/2026: "a explicação, aumente o ticket
 * médio, como funciona, imagem ilustrativa bonita, e aí ele cadastra").
 * Loja sem itens vê aberta; quem já configurou vê só o "Como funciona?".
 */

const PASSOS = [
  ["1", "Escolha os itens", "Bebida, sobremesa, porção: o que combina com qualquer pedido. Você escolhe quantos."],
  ["2", "Dê um desconto, se quiser", "O cliente vê o preço riscado e o novo ao lado. Sem desconto também funciona."],
  ["3", "O cliente vê ao fechar o pedido", "Ao tocar em Continuar pedido, a janela aparece uma vez, só com o que ainda não está na sacola."],
] as const;

const ITENS_DO_DESENHO = [
  { emoji: "🥤", nome: "Refri 2 L", de: "14,90", por: "12,90", noCarrinho: true },
  { emoji: "🍫", nome: "Brownie", de: "16,90", por: "13,90", noCarrinho: false },
  { emoji: "🍟", nome: "Batata frita", de: null, por: "19,90", noCarrinho: false },
];

function JanelaDesenhada() {
  return (
    <div aria-hidden style={{ position: "relative", width: 250, flexShrink: 0, margin: "0 auto" }}>
      {/* celular */}
      <div style={{ borderRadius: 34, background: "#0F172A", padding: 10, boxShadow: "0 24px 50px rgba(15,23,42,.35)" }}>
        <div style={{ borderRadius: 26, overflow: "hidden", background: "#F1F5F9", height: 430, position: "relative" }}>
          {/* a sacola, atrás */}
          <div style={{ padding: "26px 14px 0", filter: "blur(1.5px)", opacity: 0.7 }}>
            <div style={{ fontWeight: 900, fontSize: 13, color: "#0F172A", marginBottom: 8 }}>Sua sacola</div>
            {["X-Burguer duplo", "X-Salada"].map((n) => (
              <div key={n} style={{ background: "#fff", borderRadius: 10, padding: "8px 10px", marginBottom: 6, fontSize: 11, color: "#334155", display: "flex", justifyContent: "space-between" }}>
                <span>{n}</span><span>R$ 32,90</span>
              </div>
            ))}
            <div style={{ background: "#E8360C", color: "#fff", borderRadius: 10, padding: 9, textAlign: "center", fontSize: 11, fontWeight: 800, marginTop: 8 }}>Continuar pedido</div>
          </div>
          {/* a janela do upsell */}
          <div style={{ position: "absolute", inset: 0, background: "rgba(15,23,42,.45)", display: "flex", alignItems: "flex-end" }}>
            <div style={{ background: "#fff", borderRadius: "18px 18px 0 0", padding: "14px 12px 12px", width: "100%" }}>
              <div style={{ fontWeight: 900, fontSize: 14, color: "#0F172A", marginBottom: 10 }}>Que tal levar também?</div>
              {ITENS_DO_DESENHO.map((i) => (
                <div key={i.nome} style={{ display: "flex", alignItems: "center", gap: 8, padding: 7, borderRadius: 11, marginBottom: 6, border: `1.5px solid ${i.noCarrinho ? "#10B981" : "#E2E8F0"}`, background: i.noCarrinho ? "#ECFDF5" : "#fff" }}>
                  <div style={{ width: 34, height: 34, borderRadius: 8, background: "#FEF3C7", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{i.emoji}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 800, fontSize: 10.5, color: "#0F172A", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.nome}</div>
                    <div style={{ fontSize: 10, color: "#0F172A", fontWeight: 800, whiteSpace: "nowrap" }}>
                      {i.de && <span style={{ display: "block", textDecoration: "line-through", color: "#94A3B8", fontWeight: 500, fontSize: 9 }}>R$ {i.de}</span>}
                      R$ {i.por}
                    </div>
                  </div>
                  <div style={{ fontSize: 9.5, fontWeight: 800, padding: "5px 7px", borderRadius: 7, background: i.noCarrinho ? "transparent" : "#0F172A", color: i.noCarrinho ? "#047857" : "#fff", whiteSpace: "nowrap" }}>
                    {i.noCarrinho ? "✓ Na sacola" : "+ Adicionar"}
                  </div>
                </div>
              ))}
              <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                <div style={{ flex: 1, border: "1.5px solid #E2E8F0", borderRadius: 9, padding: 7, textAlign: "center", fontSize: 10, color: "#475569", fontWeight: 700 }}>Não, obrigado</div>
                <div style={{ flex: 1, background: "#0F172A", borderRadius: 9, padding: 7, textAlign: "center", fontSize: 10, color: "#fff", fontWeight: 800 }}>Continuar</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {/* o selo do ganho */}
      <div className="fh-upsell-selo" style={{ position: "absolute", right: -10, top: 96, background: "#16A34A", color: "#fff", fontWeight: 900, fontSize: 13, padding: "8px 12px", borderRadius: 12, boxShadow: "0 8px 20px rgba(22,163,74,.4)", transform: "rotate(4deg)" }}>
        +R$ 12,90<br /><span style={{ fontSize: 10, fontWeight: 700 }}>no mesmo pedido</span>
      </div>
    </div>
  );
}

export default function ExplicacaoDoUpsell({ jaConfigurado }: { jaConfigurado: boolean }) {
  const [aberta, setAberta] = useState(!jaConfigurado);

  if (!aberta) {
    return (
      <button type="button" onClick={() => setAberta(true)}
        style={{ border: "1.5px solid #99F6E4", background: "#F0FDFA", color: "#0F766E", fontWeight: 800, fontSize: "0.82rem", padding: "8px 14px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit", marginBottom: "1rem" }}>
        💡 Como funciona o upsell?
      </button>
    );
  }

  return (
    <section style={{ background: "linear-gradient(135deg,#F0FDFA 0%,#FFFFFF 55%,#FFF7ED 100%)", border: "1px solid #CCFBF1", borderRadius: 20, padding: "24px 24px 28px", marginBottom: "1.25rem", position: "relative" }}>
      <style>{`@keyframes fhSeloSobe{0%,100%{transform:rotate(4deg) translateY(0)}50%{transform:rotate(4deg) translateY(-6px)}}.fh-upsell-selo{animation:fhSeloSobe 2.6s ease-in-out infinite}@media (prefers-reduced-motion:reduce){.fh-upsell-selo{animation:none}}`}</style>
      {jaConfigurado && (
        <button type="button" aria-label="Fechar explicação" onClick={() => setAberta(false)}
          style={{ position: "absolute", top: 12, right: 12, border: "none", background: "#fff", borderRadius: "50%", width: 30, height: 30, cursor: "pointer", fontWeight: 800, color: "#64748B" }}>✕</button>
      )}
      <div style={{ display: "flex", gap: 28, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ flex: "1 1 300px", minWidth: 0 }}>
          <div style={{ display: "inline-block", fontSize: "0.7rem", fontWeight: 900, letterSpacing: ".08em", color: "#0F766E", background: "#CCFBF1", padding: "4px 10px", borderRadius: 999, textTransform: "uppercase" }}>Upsell da sacola</div>
          <h2 style={{ fontSize: "1.6rem", fontWeight: 900, color: "#0F172A", margin: "10px 0 6px", lineHeight: 1.15 }}>Aumente o ticket médio da sua loja</h2>
          <p style={{ fontSize: "0.92rem", color: "#475569", margin: "0 0 18px", lineHeight: 1.5 }}>
            Na hora de fechar o pedido, o site oferece aquele refri, a sobremesa ou a porção que o cliente esqueceu.
            Um toque e o item entra na sacola. É venda a mais no mesmo pedido, com a mesma entrega.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {PASSOS.map(([n, titulo, texto]) => (
              <div key={n} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#0F766E", color: "#fff", fontWeight: 900, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{n}</div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A" }}>{titulo}</div>
                  <div style={{ fontSize: "0.82rem", color: "#64748B", lineHeight: 1.45 }}>{texto}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 18, background: "#fff", border: "1px dashed #FDBA74", borderRadius: 12, padding: "10px 14px", fontSize: "0.82rem", color: "#7C2D12" }}>
            <strong>Exemplo:</strong> pedido de R$ 65,80 + refri de R$ 12,90 aceito na janela = <strong style={{ whiteSpace: "nowrap" }}>R$ 78,70</strong>. Quase 20% a mais no mesmo pedido.
          </div>
          <a href="#escolher-itens"
            style={{ display: "inline-block", marginTop: 18, background: "#0F172A", color: "#fff", fontWeight: 800, fontSize: "0.9rem", padding: "12px 22px", borderRadius: 12, textDecoration: "none" }}>
            Escolher os itens ↓
          </a>
        </div>
        <JanelaDesenhada />
      </div>
    </section>
  );
}
