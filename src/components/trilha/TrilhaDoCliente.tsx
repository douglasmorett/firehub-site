"use client";

/**
 * A Trilha Premiada do lado do cliente: a faixa no cardápio e o mapa aberto.
 *
 * A faixa diz UMA coisa — quanto falta para o próximo prêmio — porque é o que
 * decide o pedido de hoje. O resto (mapa inteiro, prêmios, regras) mora um
 * toque adiante, em "Ver a trilha".
 *
 * Todo texto vem de lib/trilha-premiada.ts, escrito a partir do que a loja
 * configurou. Frase fixa aqui viraria mentira no dia em que a loja mudasse o
 * prazo — e é assim que nasce reclamação de promoção.
 */

import { useState } from "react";
import {
  chamadaDaTrilha,
  nomeDoPremio,
  regrasDaTrilha,
  type ParadaDaTrilha,
  type ProgressoNaTrilha,
  type TrilhaPremiada,
} from "@/lib/trilha-premiada";
import MapaDaTrilha from "./MapaDaTrilha";

export type ProgressoDoCliente = Pick<
  ProgressoNaTrilha, "passos" | "faltam" | "proxima" | "conquistadas" | "completou"
> & {
  chamada?: string;
  premio?: ParadaDaTrilha | null;
  premiosNaFila?: number;
  cicloExpiraEm?: string | null;
};

export default function TrilhaDoCliente({
  trilha,
  progresso,
  fotoDoProduto,
  corDaLoja = "#475569",
}: {
  trilha: TrilhaPremiada;
  /** `null` enquanto o cliente não se identificou: a trilha aparece como convite. */
  progresso: ProgressoDoCliente | null;
  fotoDoProduto?: (produtoId?: string) => string | undefined;
  corDaLoja?: string;
}) {
  const [aberta, setAberta] = useState(false);
  if (!trilha.ativa || !trilha.paradas.length) return null;

  const passos = progresso?.passos || 0;
  const premio = progresso?.premio || null;
  const chamada =
    progresso?.chamada ||
    chamadaDaTrilha({
      passos: 0, cicloComecouEm: null, cicloExpiraEm: null,
      proxima: trilha.paradas[0], faltam: trilha.paradas[0].pedidos,
      conquistadas: [], completou: false,
    });

  const total = trilha.paradas[trilha.paradas.length - 1].pedidos;
  const fracao = Math.min(100, Math.round((passos / total) * 100));

  return (
    <>
      <style>{ESTILO}</style>

      <div className="fh-faixa" onClick={() => setAberta(true)} role="button" tabIndex={0}
           onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setAberta(true); }}>
        <div className="fh-faixa-icone">🥾</div>
        <div className="fh-faixa-txt">
          <b>Trilha Premiada</b>
          <span>{premio ? `🎁 Você ganhou ${nomeDoPremio(premio)} — entra no seu próximo pedido.` : chamada}</span>
          {passos > 0 && !premio && (
            <div className="fh-barra"><i style={{ width: `${fracao}%` }} /></div>
          )}
        </div>
        <span className="fh-faixa-btn" style={{ color: corDaLoja }}>Ver a trilha ›</span>
      </div>

      {aberta && (
        <div className="fh-cortina-cli" onClick={() => setAberta(false)}>
          <div className="fh-folha-cli" onClick={(e) => e.stopPropagation()}>
            <div className="fh-topo-cli">
              <div>
                <b>🥾 Trilha Premiada</b>
                <span>{premio ? `Você ganhou ${nomeDoPremio(premio)}` : chamada}</span>
              </div>
              <button type="button" onClick={() => setAberta(false)} title="Fechar">✕</button>
            </div>

            <div className="fh-corpo-cli">
              <MapaDaTrilha paradas={trilha.paradas} passos={passos} fotoDoProduto={fotoDoProduto} />

              <p className="fh-onde">
                {passos > 0
                  ? `Você já deu ${passos} ${passos === 1 ? "passo" : "passos"} nesta trilha.`
                  : "Seu primeiro pedido já é o primeiro passo."}
              </p>

              {(progresso?.premiosNaFila || 0) > 1 && (
                <p className="fh-fila">
                  Você tem {progresso!.premiosNaFila} prêmios guardados. Eles entram um por pedido, na ordem
                  em que você ganhou.
                </p>
              )}

              <div className="fh-premios">
                {trilha.paradas.map((p, i) => {
                  const ganho = passos >= p.pedidos;
                  const foto = p.tipo === "produto" ? fotoDoProduto?.(p.produtoId) : undefined;
                  return (
                    <div key={i} className={`fh-premio-linha${ganho ? " ganho" : ""}`}>
                      <span className="mini">
                        {foto ? <img src={foto} alt="" /> : <i>{p.tipo === "frete" ? "🛵" : p.tipo === "desconto" ? "🏷️" : "🎁"}</i>}
                      </span>
                      <span className="txt">
                        <b>{nomeDoPremio(p)}</b>
                        <span>{ganho ? "conquistado" : `no ${p.pedidos}º pedido`}</span>
                      </span>
                      {ganho && <span className="selo">✓</span>}
                    </div>
                  );
                })}
              </div>

              <div className="fh-regras">
                <b>Como funciona</b>
                <ul>
                  {regrasDaTrilha(trilha).map((r, i) => <li key={i}>{r}</li>)}
                </ul>
              </div>
            </div>

            <div className="fh-pe-cli">
              <button type="button" style={{ background: corDaLoja }} onClick={() => setAberta(false)}>
                Entendi
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const ESTILO = `
.fh-faixa{display:flex;align-items:center;gap:11px;padding:11px 13px;border-radius:14px;cursor:pointer;
  background:linear-gradient(135deg,#ECFDF3,#FEFCE8);border:1.5px solid #ABEFC6;margin-bottom:14px;
  transition:box-shadow .2s}
.fh-faixa:hover{box-shadow:0 4px 14px rgba(22,33,30,.10)}
.fh-faixa-icone{width:38px;height:38px;border-radius:11px;background:#fff;border:1.5px solid #ABEFC6;
  display:flex;align-items:center;justify-content:center;font-size:1.2rem;flex-shrink:0}
.fh-faixa-txt{flex:1;min-width:0}
.fh-faixa-txt b{display:block;font-size:.8rem;font-weight:800;color:#14532D}
.fh-faixa-txt>span{display:block;font-size:.78rem;color:#3F6212;line-height:1.4;margin-top:1px}
.fh-faixa-btn{font-size:.76rem;font-weight:800;white-space:nowrap;flex-shrink:0}
.fh-barra{height:5px;border-radius:999px;background:#ECFDF3;margin-top:6px;overflow:hidden}
.fh-barra i{display:block;height:100%;border-radius:999px;background:#15803D}

.fh-cortina-cli{position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:99999;display:flex;
  align-items:flex-end;justify-content:center}
.fh-folha-cli{background:#fff;width:100%;max-width:560px;max-height:90vh;border-radius:18px 18px 0 0;
  display:flex;flex-direction:column;box-shadow:0 -10px 40px rgba(0,0,0,.28)}
.fh-topo-cli{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;padding:14px 16px;
  border-bottom:1px solid #F1F5F9}
.fh-topo-cli b{display:block;font-size:1rem;font-weight:800;color:#0F172A}
.fh-topo-cli>div>span{display:block;font-size:.78rem;color:#475569;margin-top:2px;line-height:1.4}
.fh-topo-cli button{width:30px;height:30px;border-radius:50%;border:none;background:#F1F5F9;cursor:pointer;
  font-weight:800;flex-shrink:0;font-family:inherit}
.fh-corpo-cli{padding:14px 16px;overflow-y:auto;flex:1}
.fh-onde{margin:10px 0 0;font-size:.8rem;font-weight:700;color:#0F172A;text-align:center}
.fh-fila{margin:6px 0 0;font-size:.76rem;color:#92400E;background:#FFF7E6;border:1px solid #FDE68A;
  border-radius:10px;padding:8px 10px;line-height:1.45}
.fh-premios{display:flex;flex-direction:column;gap:7px;margin-top:14px}
.fh-premio-linha{display:flex;align-items:center;gap:10px;padding:8px 10px;border:1.5px solid #E2E8F0;
  border-radius:12px;background:#fff}
.fh-premio-linha.ganho{border-color:#ABEFC6;background:#ECFDF3}
.fh-premio-linha .mini{width:40px;height:40px;border-radius:9px;overflow:hidden;background:#F1F5F9;
  display:flex;align-items:center;justify-content:center;flex-shrink:0}
.fh-premio-linha .mini img{width:100%;height:100%;object-fit:cover}
.fh-premio-linha .mini i{font-style:normal;font-size:1.1rem}
.fh-premio-linha .txt{flex:1;min-width:0}
.fh-premio-linha .txt b{display:block;font-size:.82rem;font-weight:800;color:#0F172A}
.fh-premio-linha .txt span{display:block;font-size:.72rem;color:#64748B;margin-top:1px}
.fh-premio-linha .selo{color:#15803D;font-weight:900}
.fh-regras{margin-top:16px;padding:12px 14px;border-radius:12px;background:#F8FAFC;border:1px solid #E2E8F0}
.fh-regras b{display:block;font-size:.82rem;font-weight:800;color:#0F172A;margin-bottom:6px}
.fh-regras ul{margin:0;padding-left:17px;display:flex;flex-direction:column;gap:4px}
.fh-regras li{font-size:.75rem;color:#475569;line-height:1.5}
.fh-pe-cli{padding:10px 16px 14px;border-top:1px solid #F1F5F9}
.fh-pe-cli button{width:100%;padding:12px;border-radius:12px;border:none;color:#fff;font-size:.88rem;
  font-weight:800;cursor:pointer;font-family:inherit}

@media (min-width:560px){
  .fh-cortina-cli{align-items:center;padding:20px}
  .fh-folha-cli{border-radius:18px}
}
`;
