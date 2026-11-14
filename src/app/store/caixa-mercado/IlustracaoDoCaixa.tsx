"use client";

/**
 * "Como funciona" desenhado do Caixa de mercado: bipa → lista com balança →
 * Pix/TEF → NFC-e + estoque + financeiro. Os rótulos são os de
 * caixa/CaixaClient.tsx (CAIXA LIVRE, ÚLTIMO ITEM, Bipe ou digite,
 * FINALIZAR (F10), Pagamento — total, RECEBIDO (Enter), Venda #… concluída).
 */
import type { CSSProperties } from "react";
import { Passos } from "@/components/ilustracoes/Passos";
import { CodigoDeBarras, Etiqueta, Leitor, Monitor, Papel, Qr, Selo, Selos, Seta, Traco } from "@/components/ilustracoes/aparelhos";

const topo = (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 3, alignItems: "center", paddingBottom: 6, borderBottom: "1px solid #1E293B", marginBottom: 6, fontWeight: 700 }}>
    Mercadinho Bom Preço · Caixa 1 <Etiqueta>Operador: Ana</Etiqueta><Etiqueta verde>Balança: conectada</Etiqueta><Etiqueta verde>TEF: pronto</Etiqueta><Etiqueta verde>Pix: chave ok</Etiqueta>
  </div>
);
const cel: CSSProperties = { padding: "2px 3px", borderBottom: "1px solid #1E293B", textAlign: "left" };
const dir: CSSProperties = { ...cel, textAlign: "right" };
const ITENS: [string, string, string][] = [["Coca-Cola Lata 350ml", "2", "10,98"], ["Arroz Tipo 1 5 kg", "1", "24,90"], ["Banana prata", "0,452", "3,16"]];
const vermelho = { background: "#E8360C", color: "#FFF", textAlign: "center" as const, borderRadius: 5, padding: "6px 3px", fontWeight: 700 };

export function IlustracaoDoCaixa() {
  return (
    <Passos passos={[
      {
        legenda: "O operador bipa o código de barras do produto.",
        desenho: (<>
          <Leitor />
          <div style={{ width: 84, background: "#FFF", borderRadius: 8, padding: 8, color: "#111", fontWeight: 600, fontSize: 10, textAlign: "center", boxShadow: "0 8px 18px rgba(0,0,0,.18)" }}>
            Coca-Cola Lata<div style={{ margin: "4px 0" }}><CodigoDeBarras /></div>7894900011517
          </div>
          <Seta />
          <Monitor>{topo}<div style={{ background: "#1E293B", borderRadius: 5, color: "#64748B", textAlign: "center", padding: "26px 6px", fontSize: 11 }}>CAIXA LIVRE — bipe o primeiro produto</div></Monitor>
        </>),
      },
      {
        legenda: "Cada item entra na lista. Fruta e verdura vão na balança (F4) e o peso entra sozinho.",
        desenho: (
          <Monitor>
            {topo}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 110px", gap: 8 }}>
              <div>
                <div style={{ background: "#1E293B", borderRadius: 5, padding: "5px 6px", marginBottom: 5, color: "#FDE68A" }}>ÚLTIMO ITEM · Banana prata 0,452 kg × 6,99 = R$ 3,16</div>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9 }}>
                  <thead><tr style={{ color: "#64748B" }}><th style={cel}>#</th><th style={cel}>Descrição</th><th style={dir}>Qtd</th><th style={dir}>Total</th></tr></thead>
                  <tbody>{ITENS.map(([d, q, t], i) => <tr key={d}><td style={cel}>{i + 1}</td><td style={cel}>{d}</td><td style={dir}>{q}</td><td style={dir}>{t}</td></tr>)}</tbody>
                </table>
                <div style={{ marginTop: 6, border: "1px solid #334155", borderRadius: 4, padding: "4px 6px", color: "#64748B" }}>Bipe ou digite ▍</div>
              </div>
              <div style={{ background: "#1E293B", borderRadius: 6, padding: 7, display: "flex", flexDirection: "column", gap: 3 }}>
                <small style={{ color: "#94A3B8", fontSize: 8.5 }}>Itens</small>3
                <small style={{ color: "#94A3B8", fontSize: 8.5 }}>TOTAL</small><span style={{ fontSize: 17, fontWeight: 700, color: "#FFF" }}>R$ 39,04</span>
                <span style={{ ...vermelho, marginTop: "auto" }}>FINALIZAR (F10)</span>
              </div>
            </div>
            <div style={{ marginTop: 6, color: "#64748B", fontSize: 8.5, borderTop: "1px solid #1E293B", paddingTop: 4 }}>F2 Buscar · F3 Quantidade · F4 Balança · F6 Desconto · F8 CPF · F10 Finalizar</div>
          </Monitor>
        ),
      },
      {
        legenda: "F10 finaliza. O Pix aparece na tela, sem taxa, ou o cartão vai direto no pinpad pelo TEF.",
        desenho: (
          <Monitor>
            <div style={{ background: "#1E293B", border: "1px solid #334155", borderRadius: 8, padding: 10 }}>
              <b>Pagamento — total R$ 39,04</b>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4, margin: "6px 0" }}>
                {["Dinheiro", "Pix", "Cartão no pinpad", "Crédito", "Débito", "Vale"].map((f, n) => (
                  <span key={f} style={{ background: f === "Pix" ? "#E8360C" : "#0F172A", border: `1px solid ${f === "Pix" ? "#E8360C" : "#334155"}`, borderRadius: 4, padding: "4px 2px", textAlign: "center", fontSize: 8.5, color: "#FFF" }}>
                    <small style={{ opacity: 0.7 }}>Alt+{n + 1}</small><br />{f}
                  </span>
                ))}
              </div>
              <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                <Qr />
                <div>O cliente paga lendo o QR no celular.<br /><br /><span style={{ ...vermelho, display: "inline-block", padding: "5px 8px" }}>RECEBIDO (Enter)</span></div>
              </div>
            </div>
          </Monitor>
        ),
      },
      {
        legenda: "A venda fecha: sai a NFC-e, o estoque dá baixa e o valor cai no financeiro.",
        desenho: (<>
          <Papel>
            <b>MERCADINHO BOM PREÇO</b><br />NFC-e nº 1.204<Traco />
            2 Coca-Cola Lata ... 10,98<br />1 Arroz T1 5 kg .... 24,90<br />0,452 kg Banana .... 3,16<Traco />
            <b>TOTAL R$ 39,04</b><br />Pix<br /><br /><Qr modulos={17} />
          </Papel>
          <Selos>
            <Selo cor="verde">✓ Venda #123 concluída</Selo>
            <Selo cor="laranja">Estoque: −2 Coca, −1 Arroz</Selo>
            <Selo cor="azul">Financeiro: + R$ 39,04</Selo>
          </Selos>
        </>),
      },
    ]} />
  );
}
