"use client";

/**
 * "Como funciona" desenhado da Cotação: a loja pede a tabela → o fornecedor
 * responde do jeito dele → o comparativo (absorveu a antiga miniatura
 * ExemploDoComparativo da página de venda) → o pedido e o estoque.
 * As mensagens são as de lib/cotacao/mensagens.ts (textoDoPedidoDePrecos e
 * textoDoPedidoDeCompra), resumidas; os rótulos, os de ./Comparativo
 * ("Revisar e enviar pedido →") e ./Pedidos ("✅ recebido", entra no estoque
 * com o custo). 10 × 34,50 + 5 × 39,90 = R$ 544,50.
 */
import type { CSSProperties, ReactNode } from "react";
import { Passos } from "@/components/ilustracoes/Passos";
import { Audio, Balao, Botao, Celular, Painel, Selo, Selos } from "@/components/ilustracoes/aparelhos";

/** Dois aparelhos lado a lado; no celular encolhem juntos em vez de empilhar e estourar a altura. */
function Par({ children }: { children: ReactNode }) {
  return <div className="ilu-cot-par" style={{ display: "flex", gap: 14, alignItems: "center", justifyContent: "center" }}>{children}</div>;
}
const CSS = "@media (max-width:460px){.ilu-cot-par{zoom:.72}}";

const hora = (h: string) => <small style={{ display: "block", textAlign: "right", color: "#64748B" }}>{h} ✓✓</small>;
const PEDE = "Pode me mandar a tabela de preços atualizada ou o encarte da semana?";

const cel: CSSProperties = { padding: "4px 5px", borderBottom: "1px solid #E5E7EB", textAlign: "left" };
const barato: CSSProperties = { ...cel, background: "#DCFCE7", color: "#166534", fontWeight: 800 };
const LINHAS: [string, string[], number][] = [["Tomate (kg)", ["6,90", "7,40", "7,10"], 0], ["Mussarela (kg)", ["38,90", "—", "34,50"], 2], ["Coca lata (cx)", ["—", "42,00", "39,90"], 2]];

export function IlustracaoDaCotacao() {
  return (<>
    <style>{CSS}</style>
    <Passos titulo="Na prática" passos={[
      {
        legenda: "No dia marcado (ex.: segunda e quinta às 8h), o WhatsApp da loja pede a tabela a cada fornecedor.",
        desenho: (
          <Par>
            <Celular titulo="Ceasa do Zé" sub="fornecedor">
              <Balao eu>Bom dia, Zé! Aqui é Restaurante Sabor 😊<br />{PEDE}<br />Itens que estamos cotando: tomate, cebola, batata.<br />Obrigado!{hora("08:00")}</Balao>
            </Celular>
            <Celular titulo="Atacado Real" sub="fornecedor">
              <Balao eu>Bom dia! Aqui é Restaurante Sabor 😊<br />{PEDE}<br />Itens que estamos cotando: mussarela, coca lata.<br />Obrigado!{hora("08:01")}</Balao>
            </Celular>
          </Par>
        ),
      },
      {
        legenda: "Cada fornecedor responde do jeito dele: texto, foto do encarte, PDF ou áudio.",
        desenho: (
          <Par>
            <Celular titulo="Ceasa do Zé" sub="fornecedor">
              <Balao eu>{PEDE}</Balao>
              <Balao>Tomate 6,90 kg<br />Cebola 4,50 kg<br />Batata 5,20 kg</Balao>
              <Balao><Audio tempo="0:12" /></Balao>
            </Celular>
            <Celular titulo="Atacado Real" sub="fornecedor">
              <Balao eu>{PEDE}</Balao>
              <Balao>
                <div style={{ height: 80, borderRadius: 5, background: "linear-gradient(135deg,#FEF08A,#F97316)", display: "grid", placeItems: "center", fontWeight: 800, color: "#7C2D12", textAlign: "center" }}>OFERTAS<br />DA SEMANA</div>
                foto do encarte
              </Balao>
            </Celular>
          </Par>
        ),
      },
      {
        legenda: "A loja lê tudo e monta o comparativo. O mais barato fica em verde.",
        desenho: (
          <Painel titulo="📊 Comparativo">
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10.5 }}>
              <thead><tr style={{ color: "#64748B", fontSize: 9.5 }}>{["Produto", "Ceasa", "Hortifruti", "Atacado"].map((t) => <th key={t} style={{ ...cel, fontWeight: 600 }}>{t}</th>)}</tr></thead>
              <tbody>
                {LINHAS.map(([nome, precos, melhor]) => (
                  <tr key={nome}><td style={cel}>{nome}</td>{precos.map((p, i) => <td key={i} style={i === melhor ? barato : cel}>{p}{i === melhor ? " ✓" : ""}</td>)}</tr>
                ))}
              </tbody>
            </table>
            <Botao cor="verde" style={{ justifySelf: "end", padding: "6px 12px" }}>Revisar e enviar pedido →</Botao>
          </Painel>
        ),
      },
      {
        legenda: "Você confirma e o pedido vai para cada fornecedor. Quando chega, entra no estoque com o custo.",
        desenho: (
          <Par>
            <Celular titulo="Atacado Real" sub="fornecedor">
              <Balao eu>Bom dia! Aqui é Restaurante Sabor. Segue o nosso pedido:<br />• 10 kg Mussarela — R$ 34,50<br />• 5 cx Coca lata — R$ 39,90<br />Total: R$ 544,50<br />Entrega: amanhã, 17/11.<br />Pode confirmar, por favor? Obrigado!</Balao>
              <Balao>Fechado! Amanhã cedo 👍</Balao>
            </Celular>
            <Selos>
              <Selo cor="verde">✅ recebido</Selo>
              <Selo cor="laranja">Estoque: +10 kg Mussarela</Selo>
              <Selo cor="azul">Custo: R$ 34,50/kg</Selo>
            </Selos>
          </Par>
        ),
      },
    ]} />
  </>);
}
