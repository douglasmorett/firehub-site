"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * A tela que abre ao escanear o QR da etiqueta.
 *
 * Contexto de uso, que decide tudo: a pessoa veio da câmera do celular, está DE
 * PÉ, dentro da câmara fria, com UMA mão, às vezes de luva, com a tela
 * embaçando. Não tem menu, não tem tempo e não vai ler texto longo.
 *
 * Por isso: rosto colorido sólido com a palavra do estado em caixa alta,
 * alvos de 56-60px, e o CÓDIGO sempre visível em todos os estados — para ler
 * em voz alta no telefone com o suporte, ou digitar quando o QR está molhado.
 */

const CORES: Record<string, { fundo: string; claro: string; borda: string; texto: string }> = {
  vencido:     { fundo: "#B71C1C", claro: "#FEF2F2", borda: "#FECACA", texto: "#B71C1C" },
  hoje:        { fundo: "#D14300", claro: "#FFF1E8", borda: "#FFD3C2", texto: "#D14300" },
  atencao:     { fundo: "#B45309", claro: "#FFF7E6", borda: "#FDE68A", texto: "#B45309" },
  emDia:       { fundo: "#15803D", claro: "#ECFDF3", borda: "#ABEFC6", texto: "#15803D" },
  semValidade: { fundo: "#64748B", claro: "#F1F5F9", borda: "#E2E8F0", texto: "#64748B" },
  info:        { fundo: "#1D4ED8", claro: "#EFF6FF", borda: "#B2DDFF", texto: "#1D4ED8" },
};

const fmtData = (iso: string | null) => {
  if (!iso) return "—";
  const d = iso.slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
};

export default function ScanDoLoteClient({
  codigo, estado, lote, ultima, nomeDaLoja,
}: {
  codigo: string;
  estado: string;
  lote: any;
  ultima: any;
  nomeDaLoja: string;
}) {
  const router = useRouter();
  const [quantidade, setQuantidade] = useState<number>(lote?.quantidadeRestante ?? 1);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState<null | { quantidade: number; saldo: number; unidade: string }>(null);

  const passo = (lote?.unit === "un" ? 1 : 0.1);
  const arred = (n: number) => Number(n.toFixed(3));

  const movimentar = async (acao: "SAIDA" | "DESCARTE") => {
    setErro("");
    setEnviando(true);
    try {
      // Chave gerada AQUI e reusada num reenvio da mesma intenção: rede de
      // cozinha cai, o dedo aperta duas vezes, e nenhuma das duas coisas pode
      // virar baixa dobrada.
      const sourceRef = `qr:${codigo}:${acao}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      const res = await fetch(`/api/lote/${encodeURIComponent(codigo)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao, quantidade, sourceRef }),
      });
      const d = await res.json();
      if (!res.ok) { setErro(d.error || "Não consegui registrar. Tente de novo."); return; }
      setFeito({
        quantidade,
        saldo: d.insumo?.quantity ?? 0,
        unidade: d.insumo?.unit || lote?.unit || "un",
      });
    } catch {
      setErro("Sem conexão. A baixa NÃO foi registrada — tente de novo quando o sinal voltar.");
    } finally {
      setEnviando(false);
    }
  };

  // ── Depois de dar baixa ────────────────────────────────────────────────
  if (feito) {
    const c = CORES.emDia;
    return (
      <Moldura nomeDaLoja={nomeDaLoja} cor={c} icone="check" palavra="Pronto" titulo={lote?.productName || "Baixa registrada"}>
        <div style={{ background: c.claro, border: `1px solid ${c.borda}`, borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: "0.95rem", color: c.texto, fontWeight: 800, lineHeight: 1.5 }}>
            Saíram {feito.quantidade} {feito.unidade} do estoque.
          </div>
          <div style={{ fontSize: "0.85rem", color: "#475569", marginTop: 6 }}>
            Restam <strong>{arred(feito.saldo)} {feito.unidade}</strong> de {lote?.insumo?.name}.
          </div>
        </div>
        <div style={{ flexGrow: 1 }} />
        <Codigo codigo={codigo} />
        <Rodape>
          <button onClick={() => router.refresh()} style={btnPrimario("#0F172A")}>Escanear outra etiqueta</button>
        </Rodape>
      </Moldura>
    );
  }

  // ── Estados sem ação de baixa ──────────────────────────────────────────
  if (estado === "NAO_ENCONTRADA" || estado === "CODIGO_INVALIDO") {
    const c = CORES.semValidade;
    return (
      <Moldura nomeDaLoja={nomeDaLoja} cor={c} icone="busca" palavra="Não encontrada"
               titulo={estado === "CODIGO_INVALIDO" ? "Esse código não parece uma etiqueta" : "Esta etiqueta não é desta loja"}>
        <div style={{ fontSize: "0.9rem", color: "#475569", lineHeight: 1.55 }}>
          {estado === "CODIGO_INVALIDO"
            ? "O código de uma etiqueta do FireHub tem 8 caracteres. Confira se leu o QR certo."
            : "O código não existe aqui, pertence a outra loja, ou a etiqueta foi excluída. Nada foi movimentado."}
        </div>
        <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: 14 }}>
          <div style={rotulo}>Você está em</div>
          <div style={{ fontSize: "1rem", fontWeight: 800, color: "#0F172A", marginTop: 4 }}>{nomeDaLoja}</div>
          <div style={{ fontSize: "0.79rem", color: "#64748B", marginTop: 7, lineHeight: 1.45 }}>
            Se você tem mais de uma loja, troque no topo do FireHub e escaneie de novo.
          </div>
        </div>
        <div style={{ flexGrow: 1 }} />
        <Codigo codigo={codigo} />
        <Rodape>
          <a href="/store/estoque" style={{ ...btnPrimario("#0F172A"), textDecoration: "none" }}>Ir para o estoque</a>
        </Rodape>
      </Moldura>
    );
  }

  if (estado === "RECURSO_INDISPONIVEL") {
    const c = CORES.semValidade;
    return (
      <Moldura nomeDaLoja={nomeDaLoja} cor={c} icone="busca" palavra="Indisponível" titulo="O rastreio por etiqueta ainda não está ligado">
        <div style={{ fontSize: "0.9rem", color: "#475569", lineHeight: 1.55 }}>
          Isso costuma se resolver sozinho em alguns minutos. Se continuar, avise o suporte e diga este código.
        </div>
        <div style={{ flexGrow: 1 }} />
        <Codigo codigo={codigo} />
      </Moldura>
    );
  }

  if (estado === "SEM_INSUMO_VINCULADO") {
    const c = CORES.atencao;
    return (
      <Moldura nomeDaLoja={nomeDaLoja} cor={c} icone="alerta" palavra="Falta vincular" titulo={lote?.productName || "Item sem insumo"}>
        <div style={{ fontSize: "0.9rem", color: "#475569", lineHeight: 1.55 }}>
          A etiqueta está certa, mas este item ainda não está ligado a um insumo do estoque. Por isso não dá
          para dar baixa — o sistema não sabe de qual insumo tirar.
        </div>
        <Fatos lote={lote} />
        <div style={{ flexGrow: 1 }} />
        <Codigo codigo={codigo} />
        <Rodape>
          <a href="/store/estoque" style={{ ...btnPrimario("#E8360C"), textDecoration: "none" }}>Vincular a um insumo</a>
        </Rodape>
      </Moldura>
    );
  }

  if (estado === "JA_MOVIMENTADO") {
    const c = CORES.info;
    const segundos = ultima ? Math.max(1, Math.round((Date.now() - new Date(ultima.quando).getTime()) / 1000)) : 0;
    return (
      <Moldura nomeDaLoja={nomeDaLoja} cor={c} icone="voltar" palavra="Já foi baixado" titulo={lote?.productName || ""}>
        <div style={{ background: c.claro, border: `1px solid ${c.borda}`, borderRadius: 12, padding: 14, fontSize: "0.88rem", color: c.texto, fontWeight: 700, lineHeight: 1.5 }}>
          Você deu saída de {ultima?.quantidade} {lote?.unit} <strong>há {segundos < 60 ? `${segundos} segundos` : `${Math.round(segundos / 60)} min`}</strong>.
          Não registramos de novo — o estoque continua certo.
        </div>
        <Fatos lote={lote} />
        <div style={{ flexGrow: 1 }} />
        <Codigo codigo={codigo} />
        <Rodape>
          <button onClick={() => movimentar("SAIDA")} disabled={enviando} style={btnPrimario("#E8360C")}>
            {enviando ? "Registrando..." : "Dar outra saída mesmo assim"}
          </button>
        </Rodape>
      </Moldura>
    );
  }

  if (estado === "LOTE_ZERADO") {
    const c = CORES.semValidade;
    return (
      <Moldura nomeDaLoja={nomeDaLoja} cor={c} icone="check" palavra="Lote acabou" titulo={lote?.productName || ""}>
        <div style={{ fontSize: "0.9rem", color: "#475569", lineHeight: 1.55 }}>
          Todo o conteúdo deste lote já saiu do estoque. Pode descartar a etiqueta.
        </div>
        <Fatos lote={lote} />
        <div style={{ flexGrow: 1 }} />
        <Codigo codigo={codigo} />
      </Moldura>
    );
  }

  // ── OK: a tela de dar baixa ────────────────────────────────────────────
  const venceu = lote?.estadoDePrazo === "vencido";
  const c = CORES[lote?.estadoDePrazo] || CORES.emDia;

  return (
    <Moldura nomeDaLoja={nomeDaLoja} cor={c}
             icone={venceu ? "x" : "check"}
             palavra={venceu ? "Venceu" : lote?.estadoDePrazo === "hoje" ? "Vence hoje" : "Em dia"}
             titulo={lote?.productName || ""}>
      {venceu && (
        <div style={{ background: c.claro, border: `1px solid ${c.borda}`, borderRadius: 12, padding: 14, fontSize: "0.88rem", color: c.texto, fontWeight: 800, lineHeight: 1.45 }}>
          {lote.textoDePrazo}. Não usar — descartar e registrar a perda.
        </div>
      )}

      <Fatos lote={lote} />

      {!venceu && (
        <div style={{ background: c.claro, border: `1px solid ${c.borda}`, borderRadius: 12, padding: "12px 14px", fontSize: "0.85rem", color: c.texto, fontWeight: 700 }}>
          {lote?.textoDePrazo}
        </div>
      )}

      {erro && (
        <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 12, padding: "12px 14px", fontSize: "0.86rem", color: "#B71C1C", fontWeight: 700, lineHeight: 1.45 }}>{erro}</div>
      )}

      <div style={{ flexGrow: 1 }} />
      <Codigo codigo={codigo} />

      <Rodape>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setQuantidade(q => Math.max(passo, arred(q - passo)))}
                  style={btnPasso} aria-label="Diminuir">−</button>
          <div style={{ flexGrow: 1, height: 56, border: "1px solid #CBD5E1", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 900, fontSize: "1.3rem", color: "#0F172A" }}>
            {arred(quantidade)} {lote?.unit}
          </div>
          <button onClick={() => setQuantidade(q => arred(Math.min(lote?.quantidadeRestante ?? q + passo, q + passo)))}
                  style={btnPasso} aria-label="Aumentar">+</button>
        </div>

        <button onClick={() => movimentar(venceu ? "DESCARTE" : "SAIDA")} disabled={enviando}
                style={btnPrimario(venceu ? "#B71C1C" : "#E8360C")}>
          {enviando ? "Registrando..." : venceu ? `Descartar ${arred(quantidade)} ${lote?.unit}` : "Dar saída"}
        </button>

        {venceu && (
          <button onClick={() => movimentar("SAIDA")} disabled={enviando}
                  style={{ height: 48, borderRadius: 12, border: "1px solid #E2E8F0", background: "#fff", color: "#334155", fontWeight: 700, fontSize: "0.9rem", cursor: "pointer", fontFamily: "inherit" }}>
            Dar saída assim mesmo
          </button>
        )}
      </Rodape>
    </Moldura>
  );
}

/* ─── Peças ──────────────────────────────────────────────────────────────── */

const rotulo: React.CSSProperties = {
  fontSize: "0.66rem", fontWeight: 800, letterSpacing: "0.08em",
  color: "#94A3B8", textTransform: "uppercase",
};

const btnPasso: React.CSSProperties = {
  width: 56, height: 56, border: "1px solid #CBD5E1", borderRadius: 12,
  background: "#fff", color: "#334155", fontSize: "1.5rem", fontWeight: 900,
  cursor: "pointer", fontFamily: "inherit", lineHeight: 1, flexShrink: 0,
};

const btnPrimario = (cor: string): React.CSSProperties => ({
  height: 60, borderRadius: 14, border: "none", background: cor, color: "#fff",
  fontWeight: 900, fontSize: "1.05rem", cursor: "pointer", fontFamily: "inherit",
  display: "flex", alignItems: "center", justifyContent: "center", width: "100%",
});

function Codigo({ codigo }: { codigo: string }) {
  return (
    <div style={{
      fontFamily: "ui-monospace, 'Courier New', monospace", fontSize: "1.3rem", fontWeight: 800,
      letterSpacing: "0.08em", color: "#334155", background: "#F1F5F9", border: "1px solid #E2E8F0",
      borderRadius: 12, padding: "11px 14px", textAlign: "center", userSelect: "all",
    }}>{codigo}</div>
  );
}

function Fatos({ lote }: { lote: any }) {
  if (!lote) return null;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
      <div><div style={rotulo}>Fabricado</div><div style={valor}>{fmtData(lote.fabricadoEm)}</div></div>
      <div><div style={rotulo}>Validade</div><div style={valor}>{fmtData(lote.validoAte)}</div></div>
      {lote.loteRef && <div><div style={rotulo}>Lote</div><div style={valor}>{lote.loteRef}</div></div>}
      <div><div style={rotulo}>Resta no lote</div><div style={valor}>{Number(lote.quantidadeRestante.toFixed(3))} {lote.unit}</div></div>
    </div>
  );
}

const valor: React.CSSProperties = {
  fontSize: "1.15rem", fontWeight: 800, color: "#0F172A", marginTop: 3,
  fontVariantNumeric: "tabular-nums",
};

function Rodape({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: 12,
      paddingTop: 16, marginTop: 4,
      // safe-area para o notch: a barra do iPhone come o botão sem isto.
      paddingBottom: "max(16px, env(safe-area-inset-bottom))",
    }}>{children}</div>
  );
}

function Moldura({
  nomeDaLoja, cor, icone, palavra, titulo, children,
}: {
  nomeDaLoja: string;
  cor: { fundo: string; claro: string; borda: string; texto: string };
  icone: "check" | "x" | "alerta" | "busca" | "voltar";
  palavra: string;
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ minHeight: "100dvh", background: "#F4F6F8", display: "flex", flexDirection: "column", fontFamily: "'Inter', system-ui, sans-serif" }}>
      <div style={{ height: 56, background: "#fff", borderBottom: "1px solid #E2E8F0", display: "flex", alignItems: "center", gap: 9, padding: "0 18px", flexShrink: 0 }}>
        <div style={{ width: 22, height: 22, borderRadius: 6, background: "linear-gradient(135deg,#B71C1C,#C62828)" }} />
        <div style={{ fontWeight: 900, fontSize: "0.85rem", color: "#0F172A" }}>FireHub</div>
        <div style={{ flexGrow: 1 }} />
        {/* O nome da loja em TODO estado: é o que transforma "não encontrada"
            em diagnóstico ("ah, estou na loja errada") em vez de mistério. */}
        <div style={{ fontSize: "0.75rem", color: "#64748B", fontWeight: 600 }}>{nomeDaLoja}</div>
      </div>

      <div style={{ background: cor.fundo, padding: "26px 22px 34px", display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
        <Icone tipo={icone} />
        <div style={{ fontSize: "1.35rem", fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.02em", color: "#fff", lineHeight: 1 }}>{palavra}</div>
        <div style={{ fontSize: "1.5rem", fontWeight: 900, color: "#fff", lineHeight: 1.12, letterSpacing: "-0.02em" }}>{titulo}</div>
      </div>

      <div style={{
        background: "#fff", borderRadius: "20px 20px 0 0", marginTop: -20, padding: 22,
        flexGrow: 1, display: "flex", flexDirection: "column", gap: 20,
      }}>{children}</div>
    </div>
  );
}

function Icone({ tipo }: { tipo: string }) {
  const comum = { width: 44, height: 44, viewBox: "0 0 24 24", fill: "none", stroke: "#fff", strokeWidth: 2.2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (tipo === "x") return <svg {...comum}><circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" /></svg>;
  if (tipo === "alerta") return <svg {...comum}><path d="M12 17h.01" /><path d="M12 9v4" /><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /></svg>;
  if (tipo === "busca") return <svg {...comum}><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /><path d="M8 11h6" /></svg>;
  if (tipo === "voltar") return <svg {...comum}><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l4 2" /></svg>;
  return <svg {...comum}><path d="M21.801 10A10 10 0 1 1 17 3.335" /><path d="m9 11 3 3L22 4" /></svg>;
}
