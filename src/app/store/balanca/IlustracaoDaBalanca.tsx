"use client";

/**
 * "Como funciona" desenhado da Balança: cartão na entrada → prato na balança →
 * peso firme + cartão no leitor → valor na comanda e conta fechada no caixa.
 * Os rótulos são os de balanca/pesar/TelaDaBalanca.tsx (Trocar balança, Sair,
 * Aguarde o peso firmar…, Passe o cartão da comanda, Nº do cartão, Lançar,
 * "Não verificado — o peso que vale é o do visor da balança", "✅ R$ … na
 * comanda …", "Total da comanda: … Retire o prato.") e o caminho do caixa é o
 * de BalancaClient (Mesas › 🎫 Comandas). 0,452 kg × R$ 51,90 = R$ 23,46.
 */
import type { ReactNode } from "react";
import { Passos } from "@/components/ilustracoes/Passos";
import { CartaoDeComanda, Papel, Seta, Tablet, Traco } from "@/components/ilustracoes/aparelhos";

const LOJA = "Restaurante Sabor";
const NOTA = "Não verificado — o peso que vale é o do visor da balança";

/** O cabeçalho da tela de pesar: loja à esquerda, produto e botões à direita. */
function Cabecalho({ botao }: { botao: string }) {
  return (
    <div style={{ alignSelf: "stretch", display: "flex", flexWrap: "wrap", gap: "2px 8px", fontSize: 9, color: "#94A3B8", marginBottom: "auto", textAlign: "left" }}>
      <b style={{ color: "#FFF" }}>⚖️ {LOJA}</b>
      <span style={{ flex: 1 }} />
      <span>Refeição por kg · R$ 51,90/kg</span>
      <span>{botao}</span>
      <span>Sair</span>
    </div>
  );
}

function Titulo({ children, cor = "#E2E8F0", className }: { children: ReactNode; cor?: string; className?: string }) {
  return <div className={className} style={{ fontSize: 15, fontWeight: 900, color: cor }}>{children}</div>;
}

const rodape = { fontSize: 8.5, color: "#64748B", marginTop: "auto" } as const;

export function IlustracaoDaBalanca() {
  return (
    <Passos titulo="Como funciona no salão" passos={[
      {
        legenda: "Na entrada, o cliente pega um cartão de comanda numerado.",
        desenho: (<>
          <CartaoDeComanda numero={17} loja={LOJA} largura={170} />
          <span className="ilu-pula" aria-hidden style={{ fontSize: 30, filter: "drop-shadow(0 3px 4px rgba(0,0,0,.3))" }}>🧑</span>
        </>),
      },
      {
        legenda: "Serve o prato e põe na balança. A tela fica esperando o peso.",
        desenho: (
          <Tablet>
            <Cabecalho botao="Trocar balança" />
            <Titulo className="ilu-pisca">Aguarde o peso firmar…</Titulo>
            <div style={{ fontSize: 40 }} aria-hidden>🍽️</div>
            <div style={rodape}>{NOTA}</div>
          </Tablet>
        ),
      },
      {
        legenda: "O peso firma, o valor aparece e o cliente passa o cartão no leitor.",
        desenho: (<>
          <Tablet>
            <Cabecalho botao="Trocar balança" />
            <Titulo cor="#5EEAD4">Passe o cartão da comanda</Titulo>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", fontVariantNumeric: "tabular-nums" }}>
              <span style={{ fontSize: 28, fontWeight: 900, color: "#FFF" }}>0,452 kg</span>
              <span style={{ fontSize: 20, fontWeight: 900, color: "#5EEAD4" }}>R$ 23,46</span>
            </div>
            <div style={{ fontSize: 8, color: "#94A3B8" }}>{NOTA}</div>
            <div style={{ display: "flex", gap: 5, width: "80%", marginBottom: "auto" }}>
              <span style={{ flex: 1, border: "2px solid #14B8A6", borderRadius: 6, padding: "3px 6px", color: "#64748B", fontWeight: 800 }}>Nº do cartão</span>
              <span style={{ background: "#14B8A6", color: "#0F172A", borderRadius: 6, padding: "3px 8px", fontWeight: 900 }}>Lançar</span>
            </div>
          </Tablet>
          <CartaoDeComanda numero={17} largura={110} girar={-8} />
        </>),
      },
      {
        legenda: "O prato cai na comanda 17. No caixa, a conta fecha em Mesas › Comandas, com NFC-e em kg.",
        desenho: (<>
          <Tablet>
            <Cabecalho botao="Trocar balança" />
            <Titulo cor="#86EFAC">✅ R$ 23,46 na comanda 17</Titulo>
            <div style={{ color: "#CBD5E1", marginBottom: "auto" }}>Total da comanda: R$ 23,46. Retire o prato.</div>
          </Tablet>
          <Seta />
          <Papel>
            <b>COMANDA 17</b><Traco />
            0,452 kg Refeição .. 23,46<br />1 Suco natural ..... 8,00<Traco />
            <b>TOTAL R$ 31,46</b><br />NFC-e emitida
          </Papel>
        </>),
      },
    ]} />
  );
}
