"use client";

/**
 * O texto que a tela fiscal pede antes de uma ação sem volta: a JUSTIFICATIVA
 * do cancelamento da NFC-e (15 a 255 caracteres — a regra da SEFAZ para o
 * xJust) e a DESCRIÇÃO da devolução feita pelo contador (10 a 500).
 *
 * Era `window.prompt`: uma linha só, sem contagem, e o texto curto só era
 * recusado DEPOIS do OK — o lojista perdia o que tinha digitado e começava de
 * novo. Aqui o campo mostra quantos caracteres tem e quanto falta, o botão de
 * confirmar só habilita dentro da regra, a recusa do servidor aparece dentro do
 * modal (com o texto ainda lá), Esc fecha e o foco volta para quem abriu.
 *
 * A regra de contagem é a de lib/textos-da-tela-fiscal (`regraDoTexto`): conta
 * o texto como ele VAI — espaços repetidos e quebras de linha viram um espaço,
 * como a SEFAZ faz.
 */
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { regraDoTexto, textoDaJustificativa } from "@/lib/textos-da-tela-fiscal";

type Props = {
  /** Prefixo dos ids (título, campo, ajuda, contagem) — estável para teste e leitor de tela. */
  id: string;
  titulo: string;
  /** O rótulo do campo de texto. */
  rotulo: string;
  /** O texto de ajuda (o que o prompt dizia). */
  ajuda: string;
  regra: { minimo: number; maximo: number };
  /** O que o confirm() de antes avisava: a ação é definitiva, não emite nada na SEFAZ… */
  aviso?: ReactNode;
  /** Declaração que precisa ser marcada antes de confirmar (a devolução: "o contador JÁ fez"). */
  declaracao?: string;
  textoDoBotao: string;
  /** Ação perigosa (cancelar a nota): o botão sai vermelho. */
  perigosa?: boolean;
  enviando: boolean;
  /** A recusa do servidor, dentro do modal. */
  erro?: string | null;
  /** Um caminho a mais depois da recusa (cancelamento fora do prazo → registrar a devolução). */
  outraAcao?: { texto: string; aoClicar: () => void } | null;
  aoConfirmar: (texto: string) => void;
  aoFechar: () => void;
};

const FOCAVEIS = 'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

export default function ModalDeJustificativa({
  id, titulo, rotulo, ajuda, regra, aviso, declaracao, textoDoBotao, perigosa = false,
  enviando, erro, outraAcao, aoConfirmar, aoFechar,
}: Props) {
  const [texto, setTexto] = useState("");
  const [declarado, setDeclarado] = useState(false);
  const caixaRef = useRef<HTMLDivElement>(null);
  const campoRef = useRef<HTMLTextAreaElement>(null);

  const r = regraDoTexto(texto, regra);
  const pode = r.ok && (!declaracao || declarado) && !enviando;

  // O foco vai para o campo ao abrir e VOLTA para o botão que abriu ao fechar
  // (quem usa teclado não recomeça do topo da página).
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    campoRef.current?.focus();
    return () => {
      if (antes && typeof antes.focus === "function" && document.contains(antes)) antes.focus();
    };
  }, []);

  // Durante o envio o botão de confirmar fica desabilitado e o foco sai dele.
  // Voltou a recusa (o modal continua aberto): o foco volta para o campo, onde
  // se corrige — em vez de ficar perdido no fundo da página.
  const enviandoAntes = useRef(enviando);
  useEffect(() => {
    const caixa = caixaRef.current;
    if (enviandoAntes.current && !enviando && caixa && !caixa.contains(document.activeElement)) campoRef.current?.focus();
    enviandoAntes.current = enviando;
  }, [enviando]);

  const confirmar = () => {
    if (!pode) return;
    aoConfirmar(textoDaJustificativa(texto));
  };

  const fechar = () => {
    if (!enviando) aoFechar();
  };

  const noTeclado = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      fechar();
      return;
    }
    // Ctrl/⌘+Enter confirma sem tirar a mão do teclado (Enter sozinho é nova linha).
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      confirmar();
      return;
    }
    // O Tab fica dentro do modal: sair dele levaria o foco para a lista atrás do fundo escuro.
    if (e.key === "Tab" && caixaRef.current) {
      const focaveis = Array.from(caixaRef.current.querySelectorAll<HTMLElement>(FOCAVEIS));
      if (focaveis.length === 0) return;
      const primeiro = focaveis[0];
      const ultimo = focaveis[focaveis.length - 1];
      if (e.shiftKey && document.activeElement === primeiro) {
        e.preventDefault();
        ultimo.focus();
      } else if (!e.shiftKey && document.activeElement === ultimo) {
        e.preventDefault();
        primeiro.focus();
      }
    }
  };

  const corDaContagem = r.sobram > 0 ? "#B71C1C" : r.faltam > 0 ? "#92400E" : "#0F766E";
  const situacao =
    r.sobram > 0
      ? ` — ${r.sobram} além do máximo`
      : r.faltam > 0
        ? ` — faltam ${r.faltam} para o mínimo de ${regra.minimo}`
        : " — dentro da regra";
  const corDoBotao = perigosa ? "#B71C1C" : "#1C1917";

  return (
    // Clicar no fundo NÃO fecha: um toque fora apagaria a justificativa inteira.
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div
        ref={caixaRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-titulo`}
        onKeyDown={noTeclado}
        style={{ background: "#fff", borderRadius: 16, width: "100%", maxWidth: 500, maxHeight: "92vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}
      >
        <div style={{ padding: "1rem 1.25rem", borderBottom: "1px solid #E2E8F0", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <h2 id={`${id}-titulo`} style={{ margin: 0, fontSize: "1.1rem", fontWeight: 800, color: "#1E293B" }}>{titulo}</h2>
          <button type="button" aria-label="Fechar" onClick={fechar} disabled={enviando} style={{ background: "none", border: "none", cursor: enviando ? "not-allowed" : "pointer", fontSize: "1.1rem", padding: 4 }}>
            ✕
          </button>
        </div>

        <div style={{ padding: "1.25rem" }}>
          {aviso && (
            <div style={{ background: "#FFF4EF", border: "1px solid #FFD3C2", borderRadius: 10, padding: "12px", marginBottom: 14, fontSize: "0.82rem", color: "#9A3412", lineHeight: 1.45 }}>
              {aviso}
            </div>
          )}

          <label htmlFor={`${id}-campo`} style={{ fontSize: "0.8rem", fontWeight: 800, color: "#1C1917", display: "block", marginBottom: 4 }}>
            {rotulo}
          </label>
          <p id={`${id}-ajuda`} style={{ fontSize: "0.76rem", color: "#475569", margin: "0 0 6px", lineHeight: 1.45 }}>
            {ajuda}
          </p>
          <textarea
            id={`${id}-campo`}
            ref={campoRef}
            value={texto}
            rows={4}
            // readOnly (e não disabled) no envio: o campo continua com o foco.
            readOnly={enviando}
            onChange={(e) => setTexto(e.target.value)}
            aria-describedby={`${id}-ajuda ${id}-contagem`}
            aria-invalid={r.sobram > 0 || undefined}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: `2px solid ${r.sobram > 0 ? "#B71C1C" : "#1C1917"}`, fontSize: "0.88rem", fontFamily: "inherit", resize: "vertical", boxSizing: "border-box", lineHeight: 1.45 }}
          />
          <p id={`${id}-contagem`} style={{ fontSize: "0.74rem", fontWeight: 700, color: corDaContagem, margin: "4px 0 0" }}>
            {r.tamanho} de {regra.maximo} caracteres{situacao}
          </p>

          {declaracao && (
            <label style={{ display: "flex", alignItems: "flex-start", gap: 8, marginTop: 12, fontSize: "0.8rem", color: "#334155", cursor: enviando ? "default" : "pointer", lineHeight: 1.45 }}>
              <input
                type="checkbox"
                checked={declarado}
                disabled={enviando}
                onChange={(e) => setDeclarado(e.target.checked)}
                style={{ accentColor: "#1C1917", width: 16, height: 16, marginTop: 2, flexShrink: 0 }}
              />
              <span>{declaracao}</span>
            </label>
          )}

          {erro && (
            <p role="alert" style={{ margin: "12px 0 0", padding: "8px 12px", borderRadius: 8, fontSize: "0.8rem", lineHeight: 1.5, color: "#B71C1C", background: "#FEF2F2", border: "1px solid #FECACA", whiteSpace: "pre-line" }}>
              {erro}
            </p>
          )}
          {outraAcao && (
            <button
              type="button"
              onClick={outraAcao.aoClicar}
              disabled={enviando}
              style={{ marginTop: 10, padding: "8px 14px", borderRadius: 8, border: "1.5px solid #475569", background: "#fff", color: "#334155", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" }}
            >
              {outraAcao.texto}
            </button>
          )}

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 18 }}>
            <button
              type="button"
              onClick={fechar}
              disabled={enviando}
              style={{ padding: "10px 16px", borderRadius: 8, border: "1.5px solid #CBD5E1", background: "#fff", color: "#1C1917", fontWeight: 700, fontSize: "0.85rem", cursor: enviando ? "not-allowed" : "pointer" }}
            >
              Voltar
            </button>
            <button
              type="button"
              onClick={confirmar}
              disabled={!pode}
              aria-describedby={`${id}-contagem`}
              style={{ padding: "10px 20px", borderRadius: 8, border: "none", background: pode ? corDoBotao : "#CBD5E1", color: pode ? "#fff" : "#64748B", fontWeight: 800, fontSize: "0.85rem", cursor: pode ? "pointer" : "not-allowed" }}
            >
              {enviando ? "Enviando…" : textoDoBotao}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
