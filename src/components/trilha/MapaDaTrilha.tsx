"use client";

/**
 * O desenho da Trilha Premiada — o mesmo mapa para o lojista e para o cliente.
 *
 * Serpentina: um ponto por pedido, descendo em linhas que alternam de direção,
 * com curva nas viradas e a bandeira no fim. Tudo calculado em PIXEL sobre a
 * largura MEDIDA do container e redesenhado no resize — é o que faz o mesmo
 * componente servir o celular e o desktop sem duas versões do desenho.
 *
 * Uma só implementação de propósito: se a trilha do lojista e a do cliente
 * fossem dois desenhos, a loja configuraria olhando um mapa e o cliente veria
 * outro. O que a loja monta é literalmente o que o cliente percorre.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { nomeDoPremio, type ParadaDaTrilha } from "@/lib/trilha-premiada";

type Props = {
  paradas: ParadaDaTrilha[];
  /** Passos dados no ciclo atual. 0 = ninguém andou ainda (é o caso do editor). */
  passos?: number;
  /** Foto do produto escolhido como prêmio, por id. */
  fotoDoProduto?: (produtoId?: string) => string | undefined;
  /** Só o editor passa: clicar no quadrado abre a escolha do prêmio. */
  onEscolher?: (indice: number) => void;
  /** Altura menor, para a faixa do cardápio. */
  compacto?: boolean;
};

const ESTILO = `
.fh-mapa{position:relative;width:100%;border:1px solid #E4E8E5;border-radius:14px;overflow:hidden;
  background:
    radial-gradient(circle at 12% 18%, rgba(47,143,99,.08) 0 38%, transparent 39%),
    radial-gradient(circle at 88% 72%, rgba(217,154,32,.10) 0 34%, transparent 35%),
    #FBFAF7}
.fh-mapa svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.fh-no{position:absolute;transform:translate(-50%,-50%);z-index:2}
.fh-bolinha{width:15px;height:15px;border-radius:50%;background:#fff;border:2.5px solid #DCE3DF;transition:all .2s}
.fh-bolinha.andada{background:#2F8F63;border-color:#2F8F63}
.fh-bolinha.aqui{background:#D99A20;border-color:#D99A20;box-shadow:0 0 0 5px rgba(217,154,32,.26)}
.fh-premio{width:62px;height:62px;border-radius:15px;border:3px solid #DCE3DF;background:#fff;
  padding:0;overflow:hidden;display:block;position:relative;transition:all .2s;
  box-shadow:0 3px 10px rgba(22,33,30,.10);font-family:inherit}
.fh-premio.clicavel{cursor:pointer}
.fh-premio.clicavel:hover{transform:scale(1.06);border-color:#D99A20}
.fh-premio img{width:100%;height:100%;object-fit:cover;display:block}
.fh-premio .vazio{display:flex;align-items:center;justify-content:center;height:100%;font-size:1.5rem;color:#A3B0AB}
.fh-premio.ganho{border-color:#2F8F63}
.fh-premio.proximo{border-color:#D99A20;box-shadow:0 0 0 5px rgba(217,154,32,.22)}
.fh-premio .n{position:absolute;top:-9px;right:-9px;background:#1B3A33;color:#F4F7F5;
  font-size:.68rem;font-weight:800;border-radius:999px;padding:2px 7px;border:2px solid #fff;line-height:1.25}
.fh-premio.ganho .n{background:#2F8F63}
.fh-premio.proximo .n{background:#D99A20;color:#2B1E05}
.fh-mapa.compacto .fh-premio{width:48px;height:48px;border-radius:12px}
.fh-mapa.compacto .fh-bandeira{width:42px;height:42px;font-size:1.1rem}
.fh-mapa.compacto .fh-bolinha{width:12px;height:12px}
.fh-legenda{position:absolute;top:70px;left:50%;transform:translateX(-50%);
  font-size:.66rem;font-weight:700;color:#16211E;background:#fff;border:1px solid #E4E8E5;
  border-radius:9px;padding:3px 7px;box-shadow:0 2px 6px rgba(22,33,30,.10);width:max-content;
  max-width:86px;text-align:center;line-height:1.25;overflow:hidden;display:-webkit-box;
  -webkit-line-clamp:2;-webkit-box-orient:vertical}
.fh-bandeira{width:54px;height:54px;border-radius:50%;background:#1B3A33;color:#F4F7F5;
  display:flex;align-items:center;justify-content:center;font-size:1.4rem;border:3px solid #fff;
  box-shadow:0 3px 12px rgba(22,33,30,.14)}
`;

type No = { i: number; parada?: ParadaDaTrilha; fim?: boolean; x: number; y: number };

export default function MapaDaTrilha({ paradas, passos = 0, fotoDoProduto, onEscolher, compacto }: Props) {
  const caixa = useRef<HTMLDivElement>(null);
  const andado = useRef<SVGPathElement>(null);
  const [largura, setLargura] = useState(0);

  // A medida vem do DOM, não de um palpite: `clientWidth` antes da pintura
  // (useLayoutEffect) evita o mapa nascer apertado e pular de tamanho.
  useLayoutEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => setLargura(el.clientWidth || 0);
    medir();
    const obs = new ResizeObserver(medir);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const total = paradas.length ? paradas[paradas.length - 1].pedidos : 0;
  const L = largura || 600;
  // O passo é medido pelo QUADRADO do prêmio (62px), não pelo pontinho: com
  // passo menor que o quadrado, dois prêmios próximos se sobrepõem e a
  // etiqueta de um cobre a do outro.
  const passo = compacto ? (L < 420 ? 44 : 52) : L < 420 ? 56 : L < 700 ? 64 : 74;
  const margem = compacto ? 32 : 40;
  const alturaLinha = compacto ? 76 : 108;
  // Teto na quantidade por linha para a trilha SERPENTEAR: em linha reta ela
  // vira uma régua, e o que o lojista pediu foi um caminho.
  const cabem = Math.min(
    compacto ? 8 : 9,
    Math.max(3, Math.floor((L - margem * 2) / passo) + 1),
  );

  // Linhas EQUILIBRADAS. Enchendo cada linha até o teto, 15 pedidos com teto 7
  // deixavam a bandeira sozinha numa terceira linha vazia; distribuindo pelo
  // número de linhas necessárias, as mesmas 16 casas viram 6+6+4.
  const quantidade = total + 1;
  const linhas = Math.max(1, Math.ceil(quantidade / cabem));
  const porLinha = Math.min(cabem, Math.ceil(quantidade / linhas));

  const nos: No[] = [];
  for (let i = 1; i <= quantidade; i++) {
    const k = i - 1;
    const linha = Math.floor(k / porLinha);
    let col = k % porLinha;
    if (linha % 2 === 1) col = porLinha - 1 - col;
    nos.push({
      i,
      parada: paradas.find((p) => p.pedidos === i),
      fim: i === total + 1,
      x: margem + col * passo,
      y: margem + linha * alturaLinha,
    });
  }

  // O respiro embaixo é pela LEGENDA: ela pende ~57px abaixo do centro do nó, e
  // sem a folga a etiqueta do último prêmio saía cortada pelo overflow.
  const altura = margem * 2 + (linhas - 1) * alturaLinha + (compacto ? 0 : 46);

  // O traçado: reta dentro da linha, curva na virada.
  let d = "";
  for (let linha = 0; linha < linhas; linha++) {
    const daLinha = nos.filter((_, k) => Math.floor(k / porLinha) === linha);
    if (!daLinha.length) continue;
    const a = daLinha[0];
    const b = daLinha[daLinha.length - 1];
    d += linha === 0 ? `M ${a.x} ${a.y}` : ` L ${a.x} ${a.y}`;
    d += ` L ${b.x} ${b.y}`;
    const proxima = nos.filter((_, k) => Math.floor(k / porLinha) === linha + 1)[0];
    if (proxima) {
      const meio = b.y + alturaLinha / 2;
      const saida = b.x === a.x ? 0 : b.x > a.x ? 40 : -40;
      const entrada = proxima.x > b.x ? 40 : -40;
      d += ` C ${b.x + saida} ${meio}, ${proxima.x + entrada} ${meio}, ${proxima.x} ${proxima.y}`;
    }
  }

  // Preenche o traçado até onde o cliente chegou.
  useEffect(() => {
    const el = andado.current;
    if (!el) return;
    if (!passos || !total) { el.style.strokeDasharray = "0 9999"; return; }
    const comp = el.getTotalLength();
    const fracao = Math.min(1, passos / (total + 1));
    el.style.strokeDasharray = String(comp);
    el.style.strokeDashoffset = String(comp * (1 - fracao));
  }, [d, passos, total, largura]);

  if (!total) {
    return (
      <div className="fh-mapa" style={{ padding: 26, textAlign: "center" }}>
        <style>{ESTILO}</style>
        <p style={{ margin: 0, fontSize: "0.82rem", color: "#6B7A75" }}>
          Nenhuma parada na trilha ainda.
        </p>
      </div>
    );
  }

  return (
    <div ref={caixa} className={`fh-mapa${compacto ? " compacto" : ""}`} style={{ height: altura }}>
      <style>{ESTILO}</style>
      <svg viewBox={`0 0 ${L} ${altura}`} preserveAspectRatio="none" aria-hidden="true">
        <path d={d} fill="none" stroke="#DCE3DF" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
        <path ref={andado} d={d} fill="none" stroke="#2F8F63" strokeWidth={9} strokeLinecap="round" strokeLinejoin="round" />
      </svg>

      {nos.map((n) => {
        if (n.fim) {
          return (
            <div key="fim" className="fh-no" style={{ left: n.x, top: n.y }} title="Fim da trilha">
              <div className="fh-bandeira">🏁</div>
            </div>
          );
        }
        if (!n.parada) {
          // Sem passo dado não há "você está aqui": na tela do lojista isso
          // acendia a primeira bolinha como se um cliente estivesse nela.
          const classe = passos >= n.i ? "andada" : passos > 0 && passos === n.i - 1 ? "aqui" : "";
          return (
            <div key={n.i} className="fh-no" style={{ left: n.x, top: n.y }}>
              <div className={`fh-bolinha ${classe}`} title={`${n.i}º pedido`} />
            </div>
          );
        }
        const p = n.parada;
        const indice = paradas.indexOf(p);
        const foto = p.tipo === "produto" ? fotoDoProduto?.(p.produtoId) : undefined;
        const ganho = passos >= p.pedidos;
        const proximo = !ganho && paradas.find((x) => x.pedidos > passos) === p;
        return (
          <div key={n.i} className="fh-no" style={{ left: n.x, top: n.y }}>
            <button
              type="button"
              className={`fh-premio${ganho ? " ganho" : ""}${proximo ? " proximo" : ""}${onEscolher ? " clicavel" : ""}`}
              onClick={onEscolher ? () => onEscolher(indice) : undefined}
              disabled={!onEscolher}
              title={onEscolher ? `${nomeDoPremio(p)} — clique para trocar` : nomeDoPremio(p)}
              style={onEscolher ? undefined : { cursor: "default" }}
            >
              {foto ? (
                <img src={foto} alt={nomeDoPremio(p)} />
              ) : (
                <div className="vazio">{p.tipo === "frete" ? "🛵" : p.tipo === "desconto" ? "🏷️" : "＋"}</div>
              )}
              <span className="n">{p.pedidos}</span>
            </button>
            {!compacto && <span className="fh-legenda">{ganho ? "✓ " : ""}{nomeDoPremio(p)}</span>}
          </div>
        );
      })}
    </div>
  );
}
