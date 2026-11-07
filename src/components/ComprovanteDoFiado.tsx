"use client";
/**
 * IMPRIMIR PARA ASSINAR e ASSINAR NA TELA, no fiado.
 *
 * Pedido do Douglas (07/11/2026): o funcionário (ou cliente) que leva no
 * fiado assina — no papel, com o nome legível, ou na própria tela, com o dedo
 * ou o mouse. O papel é montado no servidor (lib/comprovante-do-fiado.ts) e
 * sai pela fila do Assistente, na impressora do caixa; sem Assistente, pelo
 * navegador. A assinatura da tela fica em AssinaturaDoFiado
 * (lib/fiado-para-assinar.ts) e aparece no Extrato.
 *
 * Quem usa: Balcão (venda em "Conta Funcionário"), Fiado (dívida lançada à mão
 * e o Extrato, para reimprimir/assinar depois) e Mesas (conta no fiado).
 *
 *   const pref = usePreferenciasDoComprovante();
 *   <OpcoesDoComprovante {...pref} />            // as duas caixinhas
 *   {aberto && <ModalDoComprovanteDoFiado ... pedirAssinatura={pref.assinar} imprimir={pref.imprimir} />}
 *
 * As duas caixinhas vêm LIGADAS e a escolha fica lembrada neste aparelho: no
 * PC do caixa sem impressora a loja desmarca uma vez e pronto; no tablet do
 * balcão, assinar com o dedo é o caminho natural.
 */
import { useEffect, useRef, useState } from "react";

const CHAVE = "firehub.fiado.comprovante.v1";

export function usePreferenciasDoComprovante() {
  const [imprimir, setImprimirSt] = useState(true);
  const [assinar, setAssinarSt] = useState(true);
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(CHAVE) || "null");
      if (p && typeof p === "object") {
        if (typeof p.imprimir === "boolean") setImprimirSt(p.imprimir);
        if (typeof p.assinar === "boolean") setAssinarSt(p.assinar);
      }
    } catch { /* navegador sem armazenamento: fica o padrão (as duas ligadas) */ }
  }, []);
  const gravar = (n: { imprimir: boolean; assinar: boolean }) => {
    try { localStorage.setItem(CHAVE, JSON.stringify(n)); } catch { /* sem armazenamento: vale só agora */ }
  };
  return {
    imprimir,
    assinar,
    setImprimir: (v: boolean) => { setImprimirSt(v); gravar({ imprimir: v, assinar }); },
    setAssinar: (v: boolean) => { setAssinarSt(v); gravar({ imprimir, assinar: v }); },
  };
}

/** As duas caixinhas, logo abaixo da escolha do cliente do fiado. */
export function OpcoesDoComprovante(p: { imprimir: boolean; assinar: boolean; setImprimir: (v: boolean) => void; setAssinar: (v: boolean) => void }) {
  const caixa: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, fontSize: "0.82rem", fontWeight: 700, color: "#334155", cursor: "pointer", padding: "4px 0" };
  return (
    <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 10, background: "#F8FAFC", border: "1px solid #E2E8F0" }}>
      <label style={caixa}>
        <input type="checkbox" checked={p.imprimir} onChange={(e) => p.setImprimir(e.target.checked)} style={{ width: 18, height: 18 }} />
        🖨️ Imprimir comprovante para assinar
      </label>
      <label style={caixa}>
        <input type="checkbox" checked={p.assinar} onChange={(e) => p.setAssinar(e.target.checked)} style={{ width: 18, height: 18 }} />
        ✍️ Pedir assinatura na tela
      </label>
    </div>
  );
}

/**
 * A caixa onde se assina. Canvas puro (sem biblioteca): o traço é guardado em
 * tamanho fixo (500×180) qualquer que seja a tela, e o PNG com fundo
 * transparente sai com 5–20 KB.
 */
export function CaixaDeAssinatura({ onMudar }: { onMudar: (png: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const desenhando = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  // Comprimento do traço: um toque sem querer não vale como assinatura.
  const tinta = useRef(0);
  const [vazio, setVazio] = useState(true);

  const ponto = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * c.width) / r.width, y: ((e.clientY - r.top) * c.height) / r.height };
  };
  const ctx = () => {
    const c = ref.current?.getContext("2d");
    if (c) { c.lineWidth = 3.2; c.lineCap = "round"; c.lineJoin = "round"; c.strokeStyle = "#0F172A"; }
    return c;
  };
  const limpar = () => {
    const c = ref.current;
    c?.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    tinta.current = 0;
    setVazio(true);
    onMudar(null);
  };

  return (
    <div>
      <div style={{ position: "relative", border: "2px dashed #94A3B8", borderRadius: 12, background: "#fff" }}>
        <canvas
          ref={ref}
          width={500}
          height={180}
          style={{ display: "block", width: "100%", height: "auto", touchAction: "none", cursor: "crosshair", borderRadius: 10 }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            desenhando.current = true;
            ultimo.current = ponto(e);
            const c = ctx();
            if (c) { c.beginPath(); c.arc(ultimo.current.x, ultimo.current.y, 1.4, 0, Math.PI * 2); c.fillStyle = "#0F172A"; c.fill(); }
            setVazio(false);
          }}
          onPointerMove={(e) => {
            if (!desenhando.current || !ultimo.current) return;
            const p = ponto(e);
            const c = ctx();
            if (c) { c.beginPath(); c.moveTo(ultimo.current.x, ultimo.current.y); c.lineTo(p.x, p.y); c.stroke(); }
            tinta.current += Math.hypot(p.x - ultimo.current.x, p.y - ultimo.current.y);
            ultimo.current = p;
          }}
          onPointerUp={() => {
            desenhando.current = false;
            ultimo.current = null;
            onMudar(tinta.current > 40 && ref.current ? ref.current.toDataURL("image/png") : null);
          }}
          onPointerCancel={() => { desenhando.current = false; ultimo.current = null; }}
        />
        {vazio && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", color: "#94A3B8", fontWeight: 700, fontSize: "0.95rem" }}>
            ✍️ Assine aqui com o dedo ou o mouse
          </div>
        )}
        <div style={{ position: "absolute", left: "8%", right: "8%", bottom: "22%", borderTop: "1px solid #CBD5E1", pointerEvents: "none" }} />
      </div>
      <div style={{ textAlign: "right", marginTop: 4 }}>
        <button type="button" onClick={limpar} style={{ border: "none", background: "none", color: "#64748B", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", textDecoration: "underline" }}>
          Limpar e assinar de novo
        </button>
      </div>
    </div>
  );
}

type Etapa = "assinar" | "salvando" | "imprimindo" | "semAssistente" | "erroDaImpressao";

/**
 * O modal do comprovante. Com `pedirAssinatura`, abre na caixa de assinar;
 * depois (ou direto, sem ela) manda o papel se `imprimir`. Fecha sozinho
 * quando dá certo, com o recado para a tela de trás; fica aberto quando o
 * papel não vai sair, para oferecer o navegador.
 */
export function ModalDoComprovanteDoFiado(p: {
  employeeId: string;
  alvo: "PEDIDO" | "MESA";
  alvoId: string;
  nomeDoCliente: string;
  /** "R$ 23,90" já formatado, e "Pedido #12" / "Mesa 4" — só para o título. */
  valor?: string;
  rotulo?: string;
  pedirAssinatura: boolean;
  imprimir: boolean;
  /** Reimpressão pelo Extrato: o papel diz que é 2ª via. */
  segundaVia?: boolean;
  onFechar: (recado: string | null) => void;
}) {
  const [etapa, setEtapa] = useState<Etapa>(p.pedirAssinatura ? "assinar" : "imprimindo");
  const [nome, setNome] = useState(p.nomeDoCliente);
  const [png, setPng] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const assinou = useRef(false);
  const comecou = useRef(false);

  const urlDoNavegador = `/api/store/employees/${encodeURIComponent(p.employeeId)}/comprovante?alvo=${p.alvo}&alvoId=${encodeURIComponent(p.alvoId)}${p.segundaVia ? "&segundaVia=1" : ""}`;
  const recadoDaAssinatura = () => (assinou.current ? "✍️ Assinatura guardada." : null);

  const imprimirAgora = async () => {
    setEtapa("imprimindo");
    setErro("");
    try {
      const r = await fetch(`/api/store/employees/${encodeURIComponent(p.employeeId)}/comprovante`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alvo: p.alvo, alvoId: p.alvoId, segundaVia: p.segundaVia === true }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErro(j.error || "Não consegui imprimir."); setEtapa("erroDaImpressao"); return; }
      // Na fila, mas ninguém puxando: não é "enviado" (como o papel do caixa).
      if (j.assistenteOuvindo === false) { setEtapa("semAssistente"); return; }
      p.onFechar(`${assinou.current ? "✍️ Assinatura guardada. " : ""}🖨️ Comprovante do fiado enviado para a impressora.`);
    } catch {
      setErro("Sem conexão.");
      setEtapa("erroDaImpressao");
    }
  };

  // Sem assinatura na tela, é só o papel: manda ao abrir.
  useEffect(() => {
    if (comecou.current) return;
    comecou.current = true;
    if (!p.pedirAssinatura) {
      if (p.imprimir) void imprimirAgora();
      else p.onFechar(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const depoisDaAssinatura = () => {
    if (p.imprimir) void imprimirAgora();
    else p.onFechar(recadoDaAssinatura());
  };

  const salvar = async () => {
    if (!png) { setErro("Faça a assinatura na caixa."); return; }
    if (nome.trim().length < 2) { setErro("Digite o nome de quem está assinando."); return; }
    setEtapa("salvando");
    setErro("");
    try {
      const r = await fetch(`/api/store/employees/${encodeURIComponent(p.employeeId)}/assinatura`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alvo: p.alvo, alvoId: p.alvoId, nome: nome.trim(), imagem: png }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok && !j.jaAssinado) { setErro(j.error || "Não consegui guardar a assinatura."); setEtapa("assinar"); return; }
      assinou.current = r.ok;
      depoisDaAssinatura();
    } catch {
      setErro("Sem conexão. Tente de novo.");
      setEtapa("assinar");
    }
  };

  const botao = (cor: string, cheio: boolean): React.CSSProperties => ({
    flex: 1, padding: "12px 10px", borderRadius: 10, fontWeight: 800, fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit",
    border: cheio ? "none" : "1.5px solid #CBD5E1", background: cheio ? cor : "#fff", color: cheio ? "#fff" : "#475569",
    textAlign: "center", textDecoration: "none", display: "inline-block",
  });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10000, padding: 12 }}>
      <div role="dialog" aria-label="Comprovante do fiado" style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 520, padding: 18, boxShadow: "0 20px 25px -5px rgba(0,0,0,0.15)" }}>
        <h3 style={{ margin: "0 0 2px", fontWeight: 800, fontSize: "1.1rem", color: "#0F172A" }}>
          📒 Fiado de {p.nomeDoCliente}{p.valor ? ` — ${p.valor}` : ""}
        </h3>
        {p.rotulo && <div style={{ fontSize: "0.8rem", color: "#64748B", marginBottom: 10 }}>{p.rotulo}</div>}

        {(etapa === "assinar" || etapa === "salvando") && (
          <>
            <label style={{ display: "block", fontSize: "0.78rem", fontWeight: 700, color: "#475569", margin: "8px 0 4px" }}>Nome legível de quem assina</label>
            <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} placeholder="Nome completo"
              style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontSize: "0.95rem", outline: "none", marginBottom: 10, boxSizing: "border-box" }} />
            <CaixaDeAssinatura onMudar={(v) => { setPng(v); if (v) setErro(""); }} />
            {erro && <div role="alert" style={{ color: "#B91C1C", fontWeight: 700, fontSize: "0.82rem", marginTop: 6 }}>{erro}</div>}
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button type="button" style={botao("#475569", false)} disabled={etapa === "salvando"} onClick={depoisDaAssinatura}>
                {p.imprimir ? "Pular (só o papel)" : "Pular"}
              </button>
              <button type="button" style={{ ...botao("#0F766E", true), opacity: png ? 1 : 0.55 }} disabled={etapa === "salvando"} onClick={salvar}>
                {etapa === "salvando" ? "Guardando..." : p.imprimir ? "✅ Salvar e imprimir" : "✅ Salvar assinatura"}
              </button>
            </div>
          </>
        )}

        {etapa === "imprimindo" && <div style={{ padding: "18px 0", textAlign: "center", color: "#475569", fontWeight: 700 }}>🖨️ Enviando o comprovante para a impressora...</div>}

        {(etapa === "semAssistente" || etapa === "erroDaImpressao") && (
          <>
            <div style={{ margin: "10px 0", padding: "10px 12px", borderRadius: 10, background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", fontSize: "0.85rem", fontWeight: 700, lineHeight: 1.45 }}>
              {etapa === "semAssistente"
                ? "⚠️ O comprovante ficou na fila, mas o Assistente de Impressão desta loja não está ligado — o papel sai quando ele abrir. Para imprimir agora, use o navegador."
                : `❌ ${erro} Dá para imprimir pelo navegador.`}
              {assinou.current && <div style={{ color: "#0F766E", marginTop: 6 }}>✍️ A assinatura já está guardada.</div>}
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" style={botao("#475569", false)} onClick={() => p.onFechar(recadoDaAssinatura())}>Fechar</button>
              <a href={urlDoNavegador} target="_blank" rel="noopener" style={botao("#0F766E", true)}>🧾 Imprimir pelo navegador</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
