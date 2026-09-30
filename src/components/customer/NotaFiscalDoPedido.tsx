"use client";

/**
 * A nota fiscal (NFC-e) de UM pedido, dentro do painel de pedidos: o estado
 * dela, por que ainda não tem (lib/fiscal-modo → porQueSemNota) e o Emitir
 * com o CPF/CNPJ pedido na hora.
 *
 * ── Por que mora no pedido ──────────────────────────────────────────────────
 *
 * Na emissão MANUAL (Fiscal → Configurações → Como a nota é emitida) é aqui
 * que a nota nasce: o cliente pede "põe o CPF na nota", o atendente clica no
 * pedido, digita e emite — sem ir para a tela Fiscal, que é do dono. Na
 * AUTOMÁTICA é aqui que se resolve a exceção: a entrega que ficou em "Falta
 * CPF", a forma que não tem nota automática, a nota que falhou.
 *
 * Emitir é a MESMA rota do botão da tela fiscal (POST api/store/fiscal/emitir),
 * com as mesmas travas. O estado vem de api/store/fiscal/nota-do-pedido, lido
 * quando o painel abre — o feed do painel não carrega o porquê.
 *
 * `NotaFiscalDaLoja` (o contexto) diz ao card se a loja emite: sem emissão
 * ligada, nem o 🧾 do card nem este painel aparecem.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { documentoDeVerdade, mascararDocumentoDigitado, problemaDoDocumento } from "@/lib/documento-do-cliente";

export type NotaFiscalDaLoja = { ligada: boolean; modo: "automatico" | "manual"; emHomologacao: boolean };

const Contexto = createContext<NotaFiscalDaLoja | null>(null);

/** A loja emite NFC-e? Lido uma vez pelo painel de pedidos; `null` enquanto não se sabe. */
export function useNotaFiscalDaLoja(): NotaFiscalDaLoja | null {
  return useContext(Contexto);
}

export function NotaFiscalDaLojaProvider({ children }: { children: ReactNode }) {
  const [loja, setLoja] = useState<NotaFiscalDaLoja | null>(null);
  useEffect(() => {
    let vivo = true;
    fetch("/api/store/fiscal/nota-do-pedido")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (vivo && d && typeof d.ligada === "boolean") setLoja({ ligada: d.ligada, modo: d.modo === "manual" ? "manual" : "automatico", emHomologacao: Boolean(d.emHomologacao) });
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);
  return <Contexto.Provider value={loja}>{children}</Contexto.Provider>;
}

type Estado = "autorizada" | "contingencia" | "processando" | "falhou" | "cancelada" | "sem_nota";
type Dados = NotaFiscalDaLoja & {
  pedido: { id: string; numero: number | null; cancelado: boolean; entrega: boolean; mesa: { contaFechada: boolean } | null };
  nota: { estado: Estado; numero: string | null; serie: string | null; chave: string | null; emitidaEm: string | null; erro: string | null; pendencias: { campo: string; mensagem: string }[] };
  semNota: { tipo: string; texto: string } | null;
  documentoObrigatorio: boolean;
  documento: string | null;
  podeAbrirODanfe: boolean;
};

const CHIP: Record<string, { fundo: string; texto: string }> = {
  ok: { fundo: "#DCFCE7", texto: "#166534" },
  atencao: { fundo: "#FEF3C7", texto: "#92400E" },
  erro: { fundo: "#FEE2E2", texto: "#B71C1C" },
  neutro: { fundo: "#F1F5F9", texto: "#475569" },
};

function rotuloDoEstado(d: Dados): { texto: string; tom: keyof typeof CHIP } {
  const n = d.nota;
  if (n.estado === "autorizada") return { texto: n.numero ? `Autorizada · nº ${n.numero}` : "Autorizada", tom: "ok" };
  if (n.estado === "contingencia") return { texto: "Contingência — aguardando SEFAZ", tom: "atencao" };
  if (n.estado === "processando") return { texto: "Na SEFAZ, aguardando resposta", tom: "atencao" };
  if (n.estado === "falhou") return { texto: "Não saiu", tom: "erro" };
  if (n.estado === "cancelada") return { texto: "Nota cancelada", tom: "neutro" };
  if (d.pedido.cancelado) return { texto: "Pedido cancelado", tom: "neutro" };
  if (d.semNota?.tipo === "falta_documento") return { texto: "Falta CPF", tom: "atencao" };
  if (d.semNota?.tipo === "aguardando") return { texto: "Aguardando a hora", tom: "neutro" };
  return { texto: "Sem nota", tom: "neutro" };
}

const botao = (principal: boolean, ativo = true): CSSProperties => ({
  padding: principal ? "9px 16px" : "8px 12px",
  borderRadius: 8,
  border: principal ? "none" : "1.5px solid #CBD5E1",
  background: principal ? (ativo ? "#1C1917" : "#CBD5E1") : "#fff",
  color: principal ? "#fff" : "#1C1917",
  fontWeight: 800,
  fontSize: "0.8rem",
  cursor: ativo ? "pointer" : "not-allowed",
  fontFamily: "inherit",
});

export default function NotaFiscalDoPedido({
  pedidoId,
  focar = false,
  aoMudar,
}: {
  pedidoId: string;
  /** Veio pelo 🧾 do card: rola até aqui e põe o cursor no CPF. */
  focar?: boolean;
  /** A nota mudou (emitida, consultada): o painel relê os pedidos. */
  aoMudar?: () => void | Promise<void>;
}) {
  // A loja sem emissão ligada não vê nada — nem o "carregando" piscando a
  // cada pedido aberto. Sem o contexto (fora do painel de pedidos), lê.
  const loja = useNotaFiscalDaLoja();
  const desligada = loja !== null && !loja.ligada;
  const [dados, setDados] = useState<Dados | null>(null);
  const [falhaAoLer, setFalhaAoLer] = useState(false);
  const [documento, setDocumento] = useState("");
  const [trabalhando, setTrabalhando] = useState<null | "emitir" | "consultar" | "reimprimir">(null);
  const [mensagem, setMensagem] = useState<{ ok: boolean; texto: string; lista?: string[] } | null>(null);
  const caixaRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLInputElement>(null);

  const ler = useCallback(async () => {
    try {
      const r = await fetch(`/api/store/fiscal/nota-do-pedido?orderId=${encodeURIComponent(pedidoId)}`);
      const d = await r.json().catch(() => null);
      if (!r.ok || !d || typeof d.ligada !== "boolean") {
        setFalhaAoLer(true);
        return null;
      }
      setFalhaAoLer(false);
      setDados(d);
      return d as Dados;
    } catch {
      setFalhaAoLer(true);
      return null;
    }
  }, [pedidoId]);

  useEffect(() => {
    setDados(null);
    setMensagem(null);
    if (desligada) return;
    ler().then((d) => {
      // O documento gravado já entra no campo; o "00000000000" do JotaJá, não.
      setDocumento(mascararDocumentoDigitado(documentoDeVerdade(d?.documento) ?? ""));
    });
  }, [ler, desligada]);

  useEffect(() => {
    if (!focar || !dados?.ligada) return;
    caixaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    campoRef.current?.focus({ preventScroll: true });
  }, [focar, dados?.ligada]);

  if (desligada) return null;
  if (!dados) {
    return falhaAoLer || !loja?.ligada ? null : <div ref={caixaRef} style={{ ...caixa, color: "#94A3B8", fontSize: "0.78rem" }}>🧾 Nota fiscal: carregando…</div>;
  }
  if (!dados.ligada) return null;

  const { nota, pedido } = dados;
  const chip = rotuloDoEstado(dados);
  const temNota = nota.estado === "autorizada" || nota.estado === "contingencia";
  const mesaAberta = Boolean(pedido.mesa && !pedido.mesa.contaFechada);
  const podeEmitir = !pedido.cancelado && !temNota && nota.estado !== "processando" && !mesaAberta;
  const problema = problemaDoDocumento(documento);
  const documentoServe = !problema && (!dados.documentoObrigatorio || documento.trim() !== "");

  const emitir = async () => {
    if (!documentoServe || trabalhando) return;
    setTrabalhando("emitir");
    setMensagem(null);
    try {
      const r = await fetch("/api/store/fiscal/emitir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: pedidoId, cpfCnpj: documento.trim() || null }),
      });
      const d = await r.json().catch(() => ({}));
      const depois = await ler();
      // 202: a SEFAZ recebeu e não respondeu ainda. Não é sucesso nem falha —
      // emitir de novo duplicaria; consultar resolve.
      if (r.status === 202) {
        setMensagem({ ok: true, texto: `${d.mensagem || "A SEFAZ está processando a nota."} Clique em Consultar em alguns segundos — não emita de novo.` });
      } else if (!r.ok) {
        // A falha que ficou GRAVADA no pedido o painel já mostra (o bloco
        // vermelho, com as pendências): repetir a mesma frase embaixo só
        // dobrava a tela. A recusa que não grava nada (CPF inválido, mesa
        // aberta, emissão desligada) aparece aqui.
        const jaNaTela = depois?.nota.estado === "falhou" && depois.nota.erro === d.mensagem;
        const lista = Array.isArray(d.pendencias) ? d.pendencias.slice(0, 6).map((p: any) => String(p?.mensagem ?? p)) : [];
        setMensagem(jaNaTela ? null : { ok: false, texto: d.mensagem || d.error || "A nota não saiu.", lista });
      } else {
        const numero = d.numero ? ` nº ${d.numero}` : "";
        const texto = d.contingencia
          ? `Nota${numero} emitida em CONTINGÊNCIA: ela vale — entregue o cupom ao cliente. A SEFAZ recebe depois.`
          : d.notaDaConta
            ? `Nota da conta da mesa${numero} autorizada.`
            : `Nota${numero} autorizada.`;
        setMensagem({ ok: true, texto: d.aviso ? `${texto} ${d.aviso}` : texto });
      }
      await aoMudar?.();
    } catch {
      setMensagem({ ok: false, texto: "Não consegui falar com o servidor. A nota NÃO foi emitida." });
    } finally {
      setTrabalhando(null);
    }
  };

  const consultar = async () => {
    if (trabalhando) return;
    setTrabalhando("consultar");
    setMensagem(null);
    try {
      const r = await fetch(`/api/store/fiscal/emitir?orderId=${encodeURIComponent(pedidoId)}`);
      const d = await r.json().catch(() => ({}));
      setMensagem({ ok: r.ok && d.success, texto: r.ok && d.success ? (d.mensagem || "Nota autorizada.") : d.mensagem || d.error || "A SEFAZ ainda não respondeu. Tente de novo em alguns segundos." });
      await ler();
      await aoMudar?.();
    } catch {
      setMensagem({ ok: false, texto: "Não consegui falar com o servidor." });
    } finally {
      setTrabalhando(null);
    }
  };

  const reimprimir = async () => {
    if (trabalhando) return;
    setTrabalhando("reimprimir");
    setMensagem(null);
    try {
      const r = await fetch("/api/store/fiscal/nota-do-pedido", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: pedidoId, acao: "reimprimir" }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setMensagem({ ok: true, texto: "Cupom fiscal enviado para a impressora do caixa.", lista: Array.isArray(d.avisos) ? d.avisos : [] });
      } else {
        setMensagem({
          ok: false,
          texto: (d.mensagem || "Não consegui mandar o cupom para a impressora.") + (dados.podeAbrirODanfe ? " Use Abrir cupom para imprimir pelo navegador." : ""),
        });
      }
    } catch {
      setMensagem({ ok: false, texto: "Não consegui falar com o servidor." });
    } finally {
      setTrabalhando(null);
    }
  };

  const nomeDoBotao =
    pedido.mesa ? "Emitir nota da conta" : nota.estado === "cancelada" ? "Emitir nova nota" : nota.estado === "falhou" ? "Tentar de novo" : "Emitir NFC-e";

  return (
    <div ref={caixaRef} style={caixa} aria-label="Nota fiscal do pedido">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.82rem", fontWeight: 800, color: "#1E293B" }}>🧾 Nota fiscal (NFC-e)</span>
        <span style={{ fontSize: "0.72rem", fontWeight: 800, padding: "3px 8px", borderRadius: 6, background: CHIP[chip.tom].fundo, color: CHIP[chip.tom].texto }}>{chip.texto}</span>
      </div>

      {dados.emHomologacao && (
        <p style={{ ...linha, color: "#92400E" }}>Modo TESTE (homologação): a nota vai para o ambiente de teste da SEFAZ e não tem valor fiscal.</p>
      )}

      {temNota && (
        <>
          {nota.estado === "contingencia" && (
            <p style={linha}>Emitida sem internet com a SEFAZ: ela vale, e o cupom tem de ser entregue. O FireHub transmite quando a SEFAZ voltar.</p>
          )}
          {nota.chave && <p style={{ ...linha, fontFamily: "monospace", fontSize: "0.7rem", wordBreak: "break-all" }}>Chave {nota.chave}</p>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
            <button type="button" onClick={reimprimir} disabled={Boolean(trabalhando)} style={botao(true, !trabalhando)}>
              {trabalhando === "reimprimir" ? "Enviando…" : "Reimprimir cupom"}
            </button>
            {dados.podeAbrirODanfe && (
              <button type="button" onClick={() => window.open(`/api/store/fiscal/danfe?orderId=${encodeURIComponent(pedidoId)}`, "_blank")} style={botao(false)}>
                Abrir cupom
              </button>
            )}
          </div>
        </>
      )}

      {nota.estado === "processando" && (
        <>
          <p style={linha}>A SEFAZ recebeu a nota e ainda não respondeu. Não emita de novo — consulte.</p>
          <button type="button" onClick={consultar} disabled={Boolean(trabalhando)} style={{ ...botao(true, !trabalhando), marginTop: 8 }}>
            {trabalhando === "consultar" ? "Consultando…" : "Consultar agora"}
          </button>
        </>
      )}

      {pedido.cancelado && !temNota && <p style={linha}>Pedido cancelado: não se emite nota de venda que não aconteceu.</p>}

      {mesaAberta && !temNota && (
        <p style={linha}>Pedido de mesa: a nota é da conta inteira. Feche a conta em Mesas e emita aqui ou em Fiscal.</p>
      )}

      {podeEmitir && (
        <>
          {nota.estado === "falhou" && nota.erro && (
            <div style={{ ...linha, color: "#B71C1C" }}>
              {nota.erro}
              {/* A pendência que repete a frase de cima (a falha de um item só) não entra de novo. */}
              {nota.pendencias.some((p) => p.mensagem !== nota.erro) && (
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {nota.pendencias.filter((p) => p.mensagem !== nota.erro).map((p, i) => <li key={i}>{p.mensagem}</li>)}
                </ul>
              )}
            </div>
          )}
          {nota.estado === "cancelada" && (
            <p style={linha}>A nota anterior{nota.numero ? ` (nº ${nota.numero})` : ""} foi cancelada. Emitir gera uma nota nova, com número novo.</p>
          )}
          {nota.estado === "sem_nota" && dados.semNota && (
            <p style={{ ...linha, color: dados.semNota.tipo === "falta_documento" ? "#92400E" : "#475569" }}>{dados.semNota.texto}</p>
          )}
          {pedido.mesa && <p style={linha}>A nota sai para a conta inteira da mesa, com todas as rodadas.</p>}

          <label htmlFor={`nota-documento-${pedidoId}`} style={{ display: "block", fontSize: "0.74rem", fontWeight: 800, color: "#1C1917", margin: "10px 0 4px" }}>
            {dados.documentoObrigatorio ? "CPF ou CNPJ do cliente (obrigatório na entrega)" : "CPF ou CNPJ na nota (opcional)"}
          </label>
          <input
            id={`nota-documento-${pedidoId}`}
            ref={campoRef}
            value={documento}
            onChange={(e) => { setDocumento(mascararDocumentoDigitado(e.target.value)); setMensagem(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") emitir(); }}
            inputMode="numeric"
            placeholder={dados.documentoObrigatorio ? "Pergunte ao cliente" : "Deixe em branco se o cliente não quiser"}
            aria-invalid={Boolean(problema)}
            aria-describedby={`nota-documento-${pedidoId}-ajuda`}
            style={{ width: "100%", boxSizing: "border-box", padding: "9px 12px", borderRadius: 8, border: `2px solid ${problema ? "#B71C1C" : "#CBD5E1"}`, fontSize: "0.9rem", outline: "none", fontFamily: "inherit" }}
          />
          <span id={`nota-documento-${pedidoId}-ajuda`} style={{ display: "block", fontSize: "0.7rem", marginTop: 3, color: problema ? "#B71C1C" : "#64748B" }}>
            {problema ||
              (!dados.documentoObrigatorio
                ? "Balcão, retirada e mesa saem sem documento; com ele, o cliente usa a nota depois."
                : dados.semNota?.tipo === "falta_documento"
                  ? "CPF tem 11 dígitos e CNPJ, 14 — pode digitar só os números."
                  : "Entrega: a SEFAZ só aceita a nota com o CPF/CNPJ e o endereço de quem recebe.")}
          </span>
          <button type="button" onClick={emitir} disabled={!documentoServe || Boolean(trabalhando)} style={{ ...botao(true, documentoServe && !trabalhando), marginTop: 10 }}>
            {trabalhando === "emitir" ? "Emitindo…" : nomeDoBotao}
          </button>
        </>
      )}

      {mensagem && (
        <div role="status" style={{ ...linha, marginTop: 10, fontWeight: 700, color: mensagem.ok ? "#0F766E" : "#B71C1C" }}>
          {mensagem.texto}
          {mensagem.lista && mensagem.lista.length > 0 && (
            <ul style={{ margin: "4px 0 0", paddingLeft: 18, fontWeight: 500 }}>
              {mensagem.lista.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const caixa: CSSProperties = { marginBottom: 12, background: "#F8FAFC", padding: "10px 12px", borderRadius: 10, border: "1px solid #E2E8F0" };
// `overflowWrap: anywhere`: a recusa pode trazer um caminho ou uma chave sem
// espaço (o certificado não achado, a chave de 44 dígitos) e a frase vazava
// da caixa do modal.
const linha: CSSProperties = { margin: "6px 0 0", fontSize: "0.76rem", color: "#475569", lineHeight: 1.45, overflowWrap: "anywhere" };
