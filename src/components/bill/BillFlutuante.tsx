"use client";

/**
 * A CARINHA DO BILL no canto do painel — só para o dono, só com o serviço
 * ligado (R$ 49,90/mês, lib/assessor/assinatura.ts).
 *
 * Douglas, 14/10/2026: "ele ativou, atualizou a página, já aparece a carinha
 * do Bill lá embaixo… pra clicar, dar o comando pra ele". Nem precisa
 * atualizar: a tela /store/bill avisa pelo evento `bill:ligado`.
 *
 * Fica acima do balão do WhatsApp da loja (bottom 100) e do "Fale conosco"
 * (bottom 24), no mesmo canto. Na própria /store/bill some: a conversa já está
 * na página.
 *
 * Arrasta como as outras bolinhas (lib/useArrastavel.ts — Douglas, 16/10/2026:
 * "o bill possa ser clicado e arrastado igual aos outros botões"); ao
 * recarregar volta para o canto.
 */

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import ConversaComOBill from "./ConversaComOBill";
import RostoDoBill, { type EmocaoDoBill } from "./RostoDoBill";
import { useArrastavel } from "@/lib/useArrastavel";

export const EVENTO_BILL_LIGADO = "bill:ligado";

export default function BillFlutuante({ ligadoInicial }: { ligadoInicial: boolean }) {
  const [ligado, setLigado] = useState(ligadoInicial);
  const [aberto, setAberto] = useState(false);
  // A carinha olha para o mouse; sorri quando o ponteiro chega nela e, com a
  // conversa aberta, mostra o que o Bill está fazendo (ouvindo, pensando...).
  const [sobre, setSobre] = useState(false);
  const [humor, setHumor] = useState<EmocaoDoBill>("normal");
  const caminho = usePathname();
  // Antes do `return null`: hook que não roda em toda renderização derruba a tela.
  const arraste = useArrastavel();

  useEffect(() => {
    const ouvir = (e: Event) => setLigado(Boolean((e as CustomEvent).detail));
    window.addEventListener(EVENTO_BILL_LIGADO, ouvir);
    return () => window.removeEventListener(EVENTO_BILL_LIGADO, ouvir);
  }, []);

  // Na tela do KDS (TV da cozinha) a bolinha ficava em cima dos cartões:
  // o toque no pedido abria o Bill em vez de dar pronto.
  if (!ligado || caminho?.startsWith("/store/bill") || caminho?.startsWith("/store/kds/tela")) return null;

  return (
    <>
      <style>{`
        @keyframes bill-brilho { 0%,100% { box-shadow: 0 0 0 0 rgba(34,211,238,.55), 0 8px 24px rgba(2,6,23,.35); } 50% { box-shadow: 0 0 0 8px rgba(34,211,238,0), 0 8px 24px rgba(2,6,23,.35); } }
        @media (prefers-reduced-motion: reduce) { .bill-botao { animation: none !important; } }
      `}</style>

      {!aberto && (
        <div style={{ position: "fixed", bottom: 176, right: "clamp(8px, 4vw, 24px)", zIndex: 10001, display: "flex", alignItems: "center", gap: 8, ...arraste.estiloDoContainer }}>
          <span style={{ background: "#0B1220", color: "#67E8F9", fontWeight: 800, fontSize: 12, padding: "5px 10px", borderRadius: 999, boxShadow: "0 4px 12px rgba(2,6,23,.25)" }}>
            Fale com o Bill
          </span>
          <button
            className="bill-botao"
            {...arraste.alca}
            // Quem acabou de largar o Bill em outro canto não quer a conversa aberta.
            onClick={() => { if (!arraste.arrastou()) setAberto(true); }}
            onPointerEnter={() => setSobre(true)}
            onPointerLeave={() => setSobre(false)}
            aria-label="Abrir conversa com o Bill, seu assessor"
            style={{ width: 60, height: 60, borderRadius: 999, border: "2px solid #22D3EE", padding: 0, overflow: "hidden", cursor: "grab", touchAction: "none", background: "#020617", animation: "bill-brilho 2.6s ease-in-out infinite", display: "grid", placeItems: "center" }}
          >
            <RostoDoBill tamanho={60} seguirMouse emocao={sobre ? "feliz" : "normal"} style={{ transform: "scale(1.3)", pointerEvents: "none" }} />
          </button>
        </div>
      )}

      {aberto && (
        <div
          role="dialog"
          aria-label="Bill, seu assessor"
          style={{
            position: "fixed", bottom: "clamp(8px, 3vw, 24px)", right: "clamp(8px, 3vw, 24px)", zIndex: 10002,
            width: "min(400px, calc(100vw - 16px))", height: "min(600px, calc(100vh - 32px))",
            borderRadius: 16, overflow: "hidden", boxShadow: "0 24px 60px rgba(2,6,23,.35)", border: "1px solid #1E293B",
            display: "flex", flexDirection: "column", background: "#EFEAE2",
          }}
        >
          <div style={{ background: "#0B1220", color: "white", padding: "10px 12px", display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 38, height: 38, borderRadius: 999, border: "1.5px solid #22D3EE", display: "grid", placeItems: "center", overflow: "hidden", flexShrink: 0 }}>
              <RostoDoBill tamanho={36} emocao={humor} style={{ transform: "scale(1.3)" }} />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 900, fontSize: 15 }}>Bill, seu assessor</div>
              <div style={{ fontSize: 11.5, color: "#94A3B8" }}>Estoque, financeiro e cardápio · a mesma conversa do WhatsApp</div>
            </div>
            <a href="/store/bill" style={{ fontSize: 11.5, color: "#67E8F9", fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap" }}>Histórico</a>
            <button onClick={() => setAberto(false)} aria-label="Fechar" style={{ background: "transparent", border: 0, color: "#CBD5E1", cursor: "pointer", padding: 4, display: "grid", placeItems: "center" }}>
              <X size={20} />
            </button>
          </div>
          <div style={{ flex: 1, minHeight: 0 }}>
            <ConversaComOBill altura="100%" aoMudarEstado={setHumor} />
          </div>
        </div>
      )}
    </>
  );
}
