"use client";

import { useEffect, useState } from "react";
import { ShieldCheck, Info, Tag } from "lucide-react";

/**
 * O palco da prévia: a bandeja rebaixada, e o papel dentro dela.
 *
 * O que está aqui é só a MOLDURA. O papel é o `children` — a própria
 * `.print-area`, o mesmo nó que o handlePrint copia para o iframe, encolhido
 * por `transform: scale()`. É essa escolha que faz o selo "PRÉVIA FIEL" ser uma
 * afirmação verificável e não marketing: `transform` não causa reflow, então a
 * quebra de linha do nome do produto na tela é a mesma do papel, caractere por
 * caractere.
 *
 * Uma prévia reimplementada com "tamanhos equivalentes" divergiria na primeira
 * mudança de layout — e o lojista só descobriria depois de gastar a etiqueta.
 */

/** Quanto o papel de 384x576px encolhe para caber na coluna. */
function useEscalaDoPapel(): number {
  // Começa em 0.75 (o valor do tablet) e não em 1: no primeiro render do
  // servidor não existe window, e chutar grande faria o papel estourar a
  // bandeja por um frame em toda tela pequena.
  const [k, setK] = useState(0.75);

  useEffect(() => {
    const medir = () => {
      const l = window.innerWidth;
      // Piso absoluto de 0.62: abaixo disso o bloco de ingredientes (3mm, uns
      // 11px) cai para menos de 7px e vira ruído cinza — a prévia deixaria de
      // mostrar justamente o que ela existe para vigiar.
      setK(l >= 1280 ? 1 : l >= 1024 ? 0.75 : Math.max(0.62, Math.min(0.75, (l - 80) / 384)));
    };
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);

  return k;
}

export function BandejaDaEtiqueta({
  children,
  quantidade,
  preparando,
  avisos,
}: {
  children: React.ReactNode;
  quantidade: number;
  preparando: boolean;
  avisos: { chave: string; texto: string }[];
}) {
  const k = useEscalaDoPapel();

  return (
    <div className="fh-previa">
      <div className="fh-previa__head">
        <span className="fh-selo-fiel">
          <ShieldCheck size={14} /> PRÉVIA FIEL
        </span>
        <span style={{ font: "500 13px/1.3 Inter, system-ui, sans-serif", color: "var(--fh-t3)" }}>
          é o mesmo bloco que vai para a impressora
        </span>
      </div>

      <div className="fh-bandeja" style={{ minHeight: `calc(576px * ${k} + 64px)`, padding: k >= 1 ? 32 : 24 }}>
        <div className="fh-folha" style={{ ["--k" as any]: k }}>
          {children}
        </div>

        {quantidade > 1 && !preparando && (
          <span className="fh-chip-escuro" style={{ position: "absolute", top: 12, right: 12 }}>
            ×{quantidade} iguais
          </span>
        )}

        {/* O véu existe para o lojista nunca ver a coluna de 12 folhas que o
            React monta no instante da impressão. */}
        {preparando && (
          <div className="fh-bandeja__veu">
            <div>Preparando {quantidade > 1 ? `${quantidade} etiquetas` : "a etiqueta"}…</div>
          </div>
        )}
      </div>

      {avisos.length > 0 && (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {avisos.map((a) => (
            <div key={a.chave} className="fh-aviso fh-aviso--atencao">
              <Info size={18} style={{ flexShrink: 0, marginTop: 1 }} />
              <span>{a.texto}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * O fantasma: a silhueta da etiqueta que ainda não existe.
 *
 * A tela vazia de antes era um `<select>` boiando numa página em branco, e não
 * dizia nem o que ia acontecer depois de escolher. Aqui a forma do que vai
 * chegar já está na bandeja.
 */
export function EtiquetaFantasma() {
  const k = useEscalaDoPapel();

  return (
    <div className="fh-previa">
      <div className="fh-previa__head">
        <span className="fh-chip">
          <Tag size={14} /> SUA ETIQUETA APARECE AQUI
        </span>
      </div>
      <div className="fh-bandeja" style={{ minHeight: `calc(576px * ${k} + 64px)`, padding: k >= 1 ? 32 : 24 }}>
        <div className="fh-fantasma" style={{ ["--k" as any]: k }}>
          <div className="fh-fantasma__papel">
            <div className="fh-barra" style={{ height: 26 * k, width: "78%" }} />
            <div className="fh-barra" style={{ height: 12 * k, width: "40%" }} />
            <div style={{ height: 1, background: "var(--fh-linha-forte)", margin: "6px 0" }} />
            <div style={{ display: "flex", gap: 10 * k, flex: 1 }}>
              <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 7 * k }}>
                <div className="fh-barra" style={{ height: 10 * k, width: "60%" }} />
                <div className="fh-barra" style={{ height: 8 * k, width: "100%" }} />
                <div className="fh-barra" style={{ height: 8 * k, width: "92%" }} />
                <div className="fh-barra" style={{ height: 8 * k, width: "70%" }} />
              </div>
              <div className="fh-barra" style={{ width: 110 * k, height: 150 * k }} />
            </div>
            <div style={{ height: 1, background: "var(--fh-linha-forte)", margin: "6px 0" }} />
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 * k, flex: 1 }}>
                <div className="fh-barra" style={{ height: 9 * k, width: "62%" }} />
                <div className="fh-barra" style={{ height: 9 * k, width: "55%" }} />
                <div className="fh-barra" style={{ height: 9 * k, width: "48%" }} />
              </div>
              <div
                className="fh-barra"
                style={{ width: 56 * k, height: 56 * k, borderRadius: 4, display: "grid", placeItems: "center" }}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="fh-vazio" style={{ padding: "24px" }}>
        <div className="fh-vazio__titulo">Escolha um insumo para começar</div>
        <div className="fh-vazio__texto">
          Assim que você escolher, a etiqueta aparece aqui do jeito exato que vai sair na impressora — e você
          confere antes de gastar papel.
        </div>
      </div>
    </div>
  );
}
