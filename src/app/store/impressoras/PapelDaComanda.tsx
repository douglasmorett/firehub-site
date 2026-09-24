"use client";

/**
 * O papel da prévia, desenhado ponto a ponto como a cabeça da impressora.
 *
 * Recebe as linhas que lib/papel-da-impressora.ts leu dos bytes do Assistente
 * e desenha cada letra na largura que ela ocupa no papel: fonte A = uma
 * célula, fonte B = 3/4, largura dobrada = duas células. A altura dobrada
 * estica a letra para cima — é assim que saem "COBRAR NA ENTREGA" e o
 * "Total", e era justamente o que a prévia antiga não sabia mostrar.
 *
 * A largura do papel é a da bobina (58 mm = 384 pontos, 80 mm = 576). Quando a
 * impressora está configurada com menos colunas do que a bobina comporta, o
 * texto ocupa só parte do papel e a faixa da direita aparece vazia — igual ao
 * papel de verdade, que foi o que a Pizzaria do Costa recebeu.
 */
import type { LinhaDoPapel } from "@/lib/papel-da-impressora";
import { larguraDoTrecho } from "@/lib/papel-da-impressora";

/** Altura da letra em pontos (fonte A 24, fonte B 17) e o respiro entre linhas. */
const ALTURA_A = 24;
const ALTURA_B = 17;
const RESPIRO = 6;

export type AcaoDaLinha = { titulo?: string; destaque?: boolean; clicavel: boolean };

type Props = {
  linhas: LinhaDoPapel[];
  pontos: number;
  celula: number;
  /** px por ponto da cabeça. */
  escala: number;
  /** O que cada linha faz ao clicar (editar palavra, apontar bloco, abrir aviso). */
  acoes?: (AcaoDaLinha | null)[];
  onClicarLinha?: (i: number) => void;
  /** Linha substituída por um editor (a palavra sendo trocada). */
  linhaEmEdicao?: number | null;
  renderizarEdicao?: (i: number) => React.ReactNode;
};

export default function PapelDaComanda({ linhas, pontos, celula, escala, acoes, onClicarLinha, linhaEmEdicao, renderizarEdicao }: Props) {
  return (
    <div
      style={{
        width: pontos * escala,
        background: "#FFFDF8",
        color: "#1A1512",
        padding: `${14 * escala}px 0 ${26 * escala}px`,
        boxShadow: "0 2px 10px rgba(60,40,25,0.12)",
        fontFamily: "ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace",
        position: "relative",
      }}
    >
      {linhas.map((l, i) => {
        const acao = acoes?.[i] || null;
        if (linhaEmEdicao === i && renderizarEdicao) {
          return (
            <div key={i} style={{ minHeight: (ALTURA_A + RESPIRO) * escala, display: "flex", alignItems: "center" }}>
              {renderizarEdicao(i)}
            </div>
          );
        }
        if (l.vazia) {
          return <div key={i} style={{ height: (ALTURA_A + RESPIRO) * escala }} />;
        }
        if (l.qr) {
          const lado = l.qr.pontos * escala;
          return (
            <div key={i} style={{ display: "flex", justifyContent: l.alinhamento === "centro" ? "center" : "flex-start", padding: `${4 * escala}px 0` }}>
              <div
                title="QR code — sai deste tamanho no papel"
                style={{
                  width: lado, height: lado, border: `${Math.max(2, 6 * escala)}px solid #1A1512`,
                  background: "repeating-conic-gradient(#1A1512 0% 25%, #FFFDF8 0% 50%) 0 0 / 22% 22%",
                  opacity: 0.85,
                }}
              />
            </div>
          );
        }
        const alturaDaLinha = Math.max(...l.trechos.map((t) => (t.fonteB ? ALTURA_B : ALTURA_A) * t.altura)) + RESPIRO;
        const larguraDaLinha = l.trechos.reduce((s, t) => s + larguraDoTrecho(t, celula), 0);
        const recuo = l.alinhamento === "centro" ? Math.max(0, (pontos - larguraDaLinha) / 2)
          : l.alinhamento === "direita" ? Math.max(0, pontos - larguraDaLinha) : 0;
        return (
          <div
            key={i}
            onClick={acao?.clicavel && onClicarLinha ? () => onClicarLinha(i) : undefined}
            title={acao?.titulo}
            className={acao?.clicavel ? "linha-do-papel" : undefined}
            style={{
              height: alturaDaLinha * escala,
              whiteSpace: "nowrap",
              display: "flex",
              alignItems: "flex-end",
              paddingLeft: recuo * escala,
              cursor: acao?.clicavel ? "pointer" : "default",
              borderRadius: 3,
              outline: acao?.destaque ? "1px dashed #CBD5E1" : undefined,
              outlineOffset: -1,
            }}
          >
            {l.trechos.map((t, j) => {
              const passo = celula * (t.fonteB ? 0.75 : 1) * t.largura * escala;
              const alturaDaLetra = (t.fonteB ? ALTURA_B : ALTURA_A) * escala;
              // O corpo da letra é o da fonte normal; a ampliação é transform,
              // como a impressora faz: estica a mesma letra, não troca de fonte.
              const corpo = alturaDaLetra * 0.82;
              return (
                <span
                  key={j}
                  style={{
                    display: "inline-flex",
                    background: t.invertido ? "#1A1512" : undefined,
                    color: t.invertido ? "#FFFDF8" : undefined,
                  }}
                >
                  {Array.from(t.texto).map((ch, k) => (
                    <span
                      key={k}
                      style={{
                        display: "inline-block",
                        width: passo,
                        height: alturaDaLetra * t.altura,
                        position: "relative",
                        overflow: "visible",
                      }}
                    >
                      <span
                        style={{
                          position: "absolute",
                          left: 0,
                          bottom: 0,
                          width: passo / t.largura,
                          textAlign: "center",
                          fontSize: corpo,
                          lineHeight: `${alturaDaLetra}px`,
                          fontWeight: t.negrito ? 800 : 400,
                          transform: `scale(${t.largura}, ${t.altura})`,
                          transformOrigin: "left bottom",
                        }}
                      >
                        {ch === " " ? " " : ch}
                      </span>
                    </span>
                  ))}
                </span>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
