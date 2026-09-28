"use client";
/**
 * O aviso do cardápio, dentro da própria página. Era `alert()` do navegador —
 * a caixa cinza "firehubfood.com.br diz" — e o dono pediu pop-up (28/09/2026).
 * Aviso de campo faltando leva o cliente até o campo ao fechar: rola, põe o
 * cursor e pinta a borda de vermelho até ele digitar.
 *
 * Uso: `const { avisar, perguntar, avisoNaTela } = useAvisoDoCardapio();` e
 * `{avisoNaTela}` em qualquer lugar do JSX — o pop-up vai por portal para o
 * body, acima de todo modal da página. `perguntar` substitui o `confirm()`.
 *
 * O estilo mora aqui, e não no store.css: o ComboModal também usa o aviso, e
 * ele abre no PDV, nas mesas e na edição de pedido, que não carregam o CSS do
 * cardápio.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertCircle, XCircle, CheckCircle2, Info, Clock } from "lucide-react";

export type TipoDeAviso = "falta" | "erro" | "fechada" | "sucesso" | "info";

export type Aviso = {
  titulo: string;
  texto?: ReactNode;
  tipo?: TipoDeAviso;
  /** `data-campo` do campo a mostrar quando o aviso fechar. */
  campo?: string;
  /** Texto do botão. Sem ele: "Preencher" quando há campo, "Entendi" quando não. */
  botao?: string;
  /** Roda quando o cliente fecha o aviso (abrir o mapa, mostrar a entrega...). */
  aoFechar?: () => void;
};

export type Pergunta = {
  titulo: string;
  texto?: ReactNode;
  confirmar: string;
  cancelar?: string;
  /** Apaga ou cancela algo: botão vermelho, e o foco começa no "não". */
  perigo?: boolean;
};

type NaTela =
  | ({ modo: "aviso" } & Aviso)
  | ({ modo: "pergunta"; responder: (sim: boolean) => void } & Pergunta);

const CORES: Record<TipoDeAviso, { fundo: string; tinta: string }> = {
  falta: { fundo: "#FFF7E6", tinta: "#B45309" },
  erro: { fundo: "#FEF2F2", tinta: "#B91C1C" },
  fechada: { fundo: "#F1F5F9", tinta: "#334155" },
  sucesso: { fundo: "#ECFDF5", tinta: "#047857" },
  info: { fundo: "#EFF6FF", tinta: "#1D4ED8" },
};
const ICONE = { falta: AlertCircle, erro: XCircle, fechada: Clock, sucesso: CheckCircle2, info: Info };

// Sem \p{...}: o tsconfig mira ES2017.
const EMOJI_NO_COMECO = /^(?:[☀-➿⬀-⯿]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDD00-\uDFFF]|[️‍\s])+/;

/** Tira o emoji do começo do texto: o aviso já tem ícone. */
export function semEmojiNoComeco(texto: string): string {
  return texto.replace(EMOJI_NO_COMECO, "");
}

/**
 * Rola até o campo, põe o cursor e pinta a borda até o cliente digitar. O
 * campo é achado por `data-campo`, não por id: o checkout existe duas vezes na
 * página (coluna do computador e gaveta do celular), e vale o que está à vista.
 */
export function mostrarCampo(campo: string) {
  const el = Array.from(document.querySelectorAll<HTMLElement>(`[data-campo="${campo}"]`)).find((e) => e.getClientRects().length > 0);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  try {
    el.focus({ preventScroll: true });
  } catch {}
  el.classList.add("aviso-cardapio-campo");
  const tirar = () => {
    el.classList.remove("aviso-cardapio-campo");
    el.removeEventListener("input", tirar);
  };
  el.addEventListener("input", tirar);
  window.setTimeout(tirar, 5000);
}

const CSS = `
.aviso-cardapio-fundo{position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);animation:avisoCardapioFundo .15s ease-out}
.aviso-cardapio{background:#fff;border-radius:20px;width:100%;max-width:360px;padding:22px 20px 18px;box-sizing:border-box;text-align:center;box-shadow:0 24px 60px rgba(15,23,42,.35);animation:avisoCardapioEntra .2s cubic-bezier(.2,.9,.3,1.2)}
.aviso-cardapio-icone{width:56px;height:56px;border-radius:999px;display:grid;place-items:center;margin:0 auto 12px}
.aviso-cardapio-titulo{margin:0 0 6px;font-size:1.12rem;font-weight:900;color:#0F172A;line-height:1.3}
.aviso-cardapio-texto{margin:0;font-size:.92rem;color:#475569;line-height:1.5}
.aviso-cardapio-botoes{display:flex;gap:8px;margin-top:18px}
.aviso-cardapio-botoes button{flex:1;min-height:48px;border-radius:12px;font-size:.98rem;font-weight:800;cursor:pointer;font-family:inherit;padding:10px 14px}
.aviso-cardapio-principal{background:#C92E09;color:#fff;border:none}
.aviso-cardapio-principal.perigo{background:#B91C1C}
.aviso-cardapio-secundario{background:#fff;color:#334155;border:1.5px solid #CBD5E1}
.aviso-cardapio-campo{border-color:#DC2626!important;box-shadow:0 0 0 3px rgba(220,38,38,.2)!important;animation:avisoCardapioCampo .45s ease 2}
@keyframes avisoCardapioFundo{from{opacity:0}to{opacity:1}}
@keyframes avisoCardapioEntra{from{opacity:0;transform:translateY(12px) scale(.96)}to{opacity:1;transform:none}}
@keyframes avisoCardapioCampo{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}
@media (prefers-reduced-motion:reduce){.aviso-cardapio,.aviso-cardapio-fundo,.aviso-cardapio-campo{animation:none}}
`;

export function useAvisoDoCardapio() {
  const [naTela, setNaTela] = useState<NaTela | null>(null);
  const [montado, setMontado] = useState(false);
  const atual = useRef<NaTela | null>(null);
  const principal = useRef<HTMLButtonElement>(null);
  const secundario = useRef<HTMLButtonElement>(null);

  useEffect(() => setMontado(true), []);

  const mostrar = useCallback((n: NaTela) => {
    // Pergunta sem resposta que dá lugar a outro aviso conta como "não".
    const antes = atual.current;
    if (antes?.modo === "pergunta") antes.responder(false);
    atual.current = n;
    setNaTela(n);
  }, []);

  const fechar = useCallback((sim: boolean) => {
    const n = atual.current;
    atual.current = null;
    setNaTela(null);
    if (!n) return;
    if (n.modo === "pergunta") {
      n.responder(sim);
      return;
    }
    // Depois de o pop-up sair: o foco no campo não briga com o do botão.
    window.setTimeout(() => {
      if (n.campo) mostrarCampo(n.campo);
      n.aoFechar?.();
    }, 30);
  }, []);

  const avisar = useCallback((a: Aviso | string) => mostrar({ modo: "aviso", ...(typeof a === "string" ? { titulo: a } : a) }), [mostrar]);

  const perguntar = useCallback(
    (p: Pergunta) => new Promise<boolean>((resolve) => mostrar({ modo: "pergunta", ...p, responder: resolve })),
    [mostrar]
  );

  useEffect(() => {
    if (!naTela) return;
    // Tira o foco do campo (fecha o teclado do celular). Na pergunta que apaga
    // algo, o Enter não pode confirmar sem querer: o foco começa no "não".
    (naTela.modo === "pergunta" && naTela.perigo ? secundario : principal).current?.focus();
    const tecla = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Captura na janela: o Esc fecha só o aviso, não o modal que está atrás.
      e.preventDefault();
      e.stopImmediatePropagation();
      fechar(false);
    };
    window.addEventListener("keydown", tecla, true);
    return () => window.removeEventListener("keydown", tecla, true);
  }, [naTela, fechar]);

  let popup: ReactNode = null;
  if (montado && naTela) {
    const tipo: TipoDeAviso = naTela.modo === "pergunta" ? (naTela.perigo ? "erro" : "info") : naTela.tipo || (naTela.campo ? "falta" : "info");
    const Icone = ICONE[tipo];
    const cor = CORES[tipo];
    const texto = typeof naTela.texto === "string" ? semEmojiNoComeco(naTela.texto) : naTela.texto;
    popup = createPortal(
      <div
        className="aviso-cardapio-fundo"
        role="presentation"
        // O pop-up fica dentro de modais (ComboModal, pagamento) na árvore do
        // React: sem parar aqui, o toque nele chegaria ao fundo do modal de
        // trás, que fecha ao toque.
        onClick={(e) => {
          e.stopPropagation();
          if (e.target === e.currentTarget) fechar(false);
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onTouchStart={(e) => e.stopPropagation()}
      >
        <div className="aviso-cardapio" role="alertdialog" aria-modal="true" aria-labelledby="aviso-cardapio-titulo" aria-describedby={texto ? "aviso-cardapio-texto" : undefined}>
          <div className="aviso-cardapio-icone" style={{ background: cor.fundo, color: cor.tinta }}>
            <Icone size={30} strokeWidth={2.4} />
          </div>
          <h2 id="aviso-cardapio-titulo" className="aviso-cardapio-titulo">
            {semEmojiNoComeco(naTela.titulo)}
          </h2>
          {texto ? (
            <p id="aviso-cardapio-texto" className="aviso-cardapio-texto">
              {texto}
            </p>
          ) : null}
          <div className="aviso-cardapio-botoes">
            {naTela.modo === "pergunta" ? (
              <>
                <button ref={secundario} type="button" className="aviso-cardapio-secundario" onClick={() => fechar(false)}>
                  {naTela.cancelar || "Voltar"}
                </button>
                <button ref={principal} type="button" className={`aviso-cardapio-principal${naTela.perigo ? " perigo" : ""}`} onClick={() => fechar(true)}>
                  {naTela.confirmar}
                </button>
              </>
            ) : (
              <button ref={principal} type="button" className="aviso-cardapio-principal" onClick={() => fechar(true)}>
                {naTela.botao || (naTela.campo ? "Preencher" : "Entendi")}
              </button>
            )}
          </div>
        </div>
      </div>,
      document.body
    );
  }

  const avisoNaTela = (
    <>
      {/* Fica mesmo com o pop-up fechado: o campo continua vermelho depois dele. */}
      <style>{CSS}</style>
      {popup}
    </>
  );

  return { avisar, perguntar, avisoNaTela };
}
