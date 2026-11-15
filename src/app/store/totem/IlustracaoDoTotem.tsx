"use client";

/**
 * "Como funciona" desenhado do Totem: escolhe → confere, nome e CPF → paga →
 * senha e cozinha. Os rótulos são os de app/totem/[slug]/TotemApp.tsx
 * (Adicionar ao carrinho, Seu pedido, Total a pagar, Como podemos te chamar?,
 * CPF ou CNPJ na nota?, Pular, Usar este, Como deseja pagar?, Pagar na
 * maquininha, Pix, Pagar no caixa, "Aproxime, insira ou passe o cartão",
 * Pagamento aprovado!, "Aguarde, logo chamaremos seu nome:", Senha do pedido).
 * 29,90 + 7,00 = R$ 36,90.
 */
import type { ReactNode } from "react";
import { Passos } from "@/components/ilustracoes/Passos";
import { Botao, FotoDeProduto, Linha, Papel, Totem, Traco } from "@/components/ilustracoes/aparelhos";

/** Totem + papel lado a lado; no celular encolhe junto em vez de empilhar e estourar a altura. */
function Par({ children }: { children: ReactNode }) {
  return <div className="ilu-totem-par" style={{ display: "flex", gap: 14, alignItems: "center", justifyContent: "center" }}>{children}</div>;
}
const CSS = "@media (max-width:520px){.ilu-totem-par{zoom:.65}}";

const PRODUTOS: [string, string, boolean?][] = [["X-Bacon", "R$ 29,90"], ["Batata", "R$ 14,90"], ["Refri", "R$ 7,00", true], ["Combo", "R$ 39,90"]];

export function IlustracaoDoTotem() {
  return (<>
    <style>{CSS}</style>
    <Passos passos={[
      {
        legenda: "O cliente escolhe no totem e toca em “Adicionar ao carrinho”.",
        desenho: (
          <div style={{ position: "relative" }}>
            <Totem>
              <b style={{ fontSize: 12 }}>Lanches</b>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 5 }}>
                {PRODUTOS.map(([nome, preco, azul], i) => (
                  <div key={nome} style={{ background: "#F1F5F9", borderRadius: 6, padding: 5, fontSize: 9, outline: i === 0 ? "2px solid #E8360C" : undefined }}>
                    <FotoDeProduto azul={azul} />{nome}<br /><b>{preco}</b>
                  </div>
                ))}
              </div>
              <Botao style={{ marginTop: "auto" }}>Adicionar ao carrinho</Botao>
            </Totem>
            <span className="ilu-pula" aria-hidden style={{ position: "absolute", left: 128, bottom: 26, fontSize: 24, filter: "drop-shadow(0 3px 4px rgba(0,0,0,.3))" }}>👆</span>
          </div>
        ),
      },
      {
        legenda: "Confere o pedido, diz o nome e se quer CPF na nota.",
        desenho: (
          <Totem>
            <b style={{ fontSize: 12 }}>Seu pedido</b>
            <Linha><span>1 X-Bacon</span><span>29,90</span></Linha>
            <Linha><span>1 Refri</span><span>7,00</span></Linha>
            <Linha style={{ borderTop: "1px solid #E5E7EB", paddingTop: 4 }}><b>Total a pagar</b><b>R$ 36,90</b></Linha>
            <div style={{ marginTop: 6 }}>Como podemos te chamar?</div>
            <div style={{ border: "1px solid #CBD5E1", borderRadius: 5, padding: 4 }}>Marina▍</div>
            <div>CPF ou CNPJ na nota?</div>
            <div style={{ display: "flex", gap: 5 }}>
              <Botao cor="cinza" style={{ flex: 1 }}>Pular</Botao>
              <Botao cor="cinza" style={{ flex: 1, opacity: 0.5 }}>Usar este</Botao>
            </div>
          </Totem>
        ),
      },
      {
        legenda: "Escolhe como pagar: na maquininha, no Pix da tela ou no caixa.",
        desenho: (<>
          <Totem>
            <b style={{ fontSize: 12 }}>Como deseja pagar?</b>
            <Botao>💳 Pagar na maquininha</Botao>
            <Botao cor="cinza">Pix</Botao>
            <Botao cor="cinza">Pagar no caixa</Botao>
            <div style={{ marginTop: "auto", textAlign: "center", background: "#F1F5F9", borderRadius: 6, padding: 8 }}>Aproxime, insira ou<br />passe o cartão</div>
          </Totem>
          <div style={{ fontSize: 44 }} aria-hidden>📟</div>
        </>),
      },
      {
        legenda: "Pagou, ganhou a senha. O pedido sai na cozinha e a senha aparece na TV.",
        desenho: (
          <Par>
            <Totem style={{ alignItems: "center", justifyContent: "center", textAlign: "center" }}>
              <b style={{ color: "#16A34A", fontSize: 13 }}>Pagamento aprovado!</b>
              <span>Aguarde, logo chamaremos seu nome: <b>Marina</b></span>
              <span style={{ marginTop: 8, color: "#64748B", letterSpacing: 1 }}>SENHA DO PEDIDO</span>
              <span style={{ fontSize: 40, fontWeight: 900, color: "#E53935", lineHeight: 1 }}>#418</span>
            </Totem>
            <Papel>
              <b>SENHA 418 · TOTEM</b><Traco />1 X-Bacon<br />1 Refri<Traco />PAGO · Crédito
            </Papel>
          </Par>
        ),
      },
    ]} />
  </>);
}
