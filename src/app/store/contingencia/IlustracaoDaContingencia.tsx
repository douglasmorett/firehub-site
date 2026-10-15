"use client";

/**
 * O desenho do "Como funciona" do Modo Contingência: a nuvem, o computador do
 * caixa, a TV da cozinha, o celular do garçom e a impressora, em três cenas
 * (com internet → caiu → voltou). Passa sozinho; um clique numa cena para a
 * troca automática, para o dono ler com calma.
 *
 * Cada cena só mostra o que a contingência faz de verdade
 * (Projetos/FireHub - Modo Contingência.md no vault): a cópia desce para o
 * computador com internet; na queda, TV e celular falam com o computador pela
 * rede da loja e a faixa avisa; na volta, o que foi feito sobe para a nuvem.
 * A frase da faixa é a de components/contingencia/TrocaDeContingencia.tsx.
 */
import { useEffect, useState } from "react";
import { Cloud, CloudOff, Monitor, Printer, Smartphone, Tv } from "lucide-react";

export type Cena = "normal" | "caiu" | "voltou";

const CENAS: { id: Cena; rotulo: string; titulo: string; texto: string }[] = [
  {
    id: "normal",
    rotulo: "1. Com internet",
    titulo: "Tudo como hoje",
    texto: "Todo mundo usa o FireHub pela internet. Enquanto isso, o computador do caixa guarda uma cópia da loja, sempre atualizada.",
  },
  {
    id: "caiu",
    rotulo: "2. A internet caiu",
    titulo: "O computador do caixa assume",
    texto: "Em menos de 1 minuto as telas passam para o computador da loja, com um aviso embaixo. A TV e o celular do garçom chegam nele pelo Wi-Fi. Você continua lançando pedido e imprimindo.",
  },
  {
    id: "voltou",
    rotulo: "3. A internet voltou",
    titulo: "Tudo sobe sozinho",
    texto: "O computador manda para a nuvem tudo o que foi feito na queda, sem duplicar, e as telas voltam sozinhas. Ninguém precisa fazer nada.",
  },
];

const ROXO = "#7C3AED";
const VERDE = "#16A34A";
const VERMELHO = "#DC2626";

// Posições em % da área do desenho (o SVG das linhas usa a mesma régua).
const P = {
  nuvem: { x: 50, y: 11 },
  pc: { x: 50, y: 46 },
  tv: { x: 14, y: 68 },
  cel: { x: 86, y: 68 },
  imp: { x: 50, y: 80 },
};

type Linha = { de: keyof typeof P; para: keyof typeof P; cor: string; fluxo?: "desce" | "sobe"; tracejada?: boolean; some?: boolean };

function linhasDa(cena: Cena): Linha[] {
  if (cena === "normal") {
    return [
      { de: "nuvem", para: "tv", cor: VERDE },
      { de: "nuvem", para: "cel", cor: VERDE },
      { de: "nuvem", para: "pc", cor: VERDE, fluxo: "desce" },
      { de: "pc", para: "imp", cor: "#64748B" },
      { de: "pc", para: "tv", cor: ROXO, some: true },
      { de: "pc", para: "cel", cor: ROXO, some: true },
    ];
  }
  if (cena === "caiu") {
    return [
      { de: "nuvem", para: "tv", cor: VERMELHO, tracejada: true, some: true },
      { de: "nuvem", para: "cel", cor: VERMELHO, tracejada: true, some: true },
      { de: "nuvem", para: "pc", cor: VERMELHO, tracejada: true },
      { de: "pc", para: "imp", cor: ROXO, fluxo: "desce" },
      { de: "pc", para: "tv", cor: ROXO, fluxo: "desce" },
      { de: "pc", para: "cel", cor: ROXO, fluxo: "desce" },
    ];
  }
  return [
    { de: "nuvem", para: "tv", cor: VERDE },
    { de: "nuvem", para: "cel", cor: VERDE },
    { de: "nuvem", para: "pc", cor: ROXO, fluxo: "sobe" },
    { de: "pc", para: "imp", cor: "#64748B" },
    { de: "pc", para: "tv", cor: ROXO, some: true },
    { de: "pc", para: "cel", cor: ROXO, some: true },
  ];
}

function No({ onde, icone, nome, sub, cor, fundo, brilho }: {
  onde: { x: number; y: number }; icone: React.ReactNode; nome: string; sub?: string; cor: string; fundo: string; brilho?: string;
}) {
  return (
    <div
      className="fh-ct-no"
      style={{ left: `${onde.x}%`, top: `${onde.y}%` }}
    >
      <div
        className="fh-ct-icone"
        style={{ color: cor, background: fundo, boxShadow: brilho ? `0 0 0 6px ${brilho}` : "0 2px 8px rgba(15,23,42,.08)" }}
      >
        {icone}
      </div>
      <div className="fh-ct-nome">{nome}</div>
      {sub && <div className="fh-ct-sub" style={{ color: cor }}>{sub}</div>}
    </div>
  );
}

const ESTILO = `
.fh-ct{border:1.5px solid #E9E3FB;border-radius:16px;background:#fff;overflow:hidden}
.fh-ct-abas{display:flex;gap:6px;padding:12px 12px 0;flex-wrap:wrap}
.fh-ct-aba{flex:1 1 140px;border:1.5px solid #E2E8F0;background:#F8FAFC;color:#475569;border-radius:10px;padding:8px 10px;font:inherit;font-size:13px;font-weight:800;cursor:pointer;position:relative;overflow:hidden;text-align:center}
.fh-ct-aba.ativa{border-color:${ROXO};background:#F5F3FF;color:${ROXO}}
.fh-ct-aba .fh-ct-tempo{position:absolute;left:0;bottom:0;height:3px;background:${ROXO};width:0}
.fh-ct-aba.ativa .fh-ct-tempo.corre{animation:fh-ct-tempo 6s linear forwards}
@keyframes fh-ct-tempo{to{width:100%}}
.fh-ct-palco{position:relative;height:310px;margin:6px 8px 0;background:radial-gradient(420px 200px at 50% 55%,#FAF7FF,transparent 70%)}
.fh-ct-linhas{position:absolute;inset:0;width:100%;height:100%}
.fh-ct-palco line{transition:stroke .5s ease,opacity .5s ease}
.fh-ct-fluxo{stroke-dasharray:5 6;animation:fh-ct-fluxo .9s linear infinite}
.fh-ct-fluxo.sobe{animation-direction:reverse}
@keyframes fh-ct-fluxo{to{stroke-dashoffset:-22}}
.fh-ct-no{position:absolute;transform:translate(-50%,-50%);display:flex;flex-direction:column;align-items:center;gap:4px;width:136px;text-align:center;transition:opacity .4s ease}
.fh-ct-icone{width:52px;height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;transition:background .4s ease,color .4s ease,box-shadow .4s ease}
.fh-ct-nome{font-size:12px;font-weight:800;color:#0F172A;line-height:1.15;background:rgba(255,255,255,.94);padding:1px 5px;border-radius:5px}
.fh-ct-sub{font-size:11px;font-weight:700;line-height:1.15;background:rgba(255,255,255,.94);padding:1px 5px;border-radius:5px}
.fh-ct-linha-faixa{height:30px;display:flex;justify-content:center;align-items:center;padding:0 8px}
.fh-ct-faixa{white-space:nowrap;max-width:100%;overflow:hidden;text-overflow:ellipsis;background:#92400e;color:#fff;font-size:11.5px;font-weight:700;padding:5px 12px;border-radius:999px;box-shadow:0 4px 12px rgba(0,0,0,.2)}
.fh-ct-faixa.volta{background:#166534}
.fh-ct-texto{padding:4px 18px 16px}
.fh-ct-texto b{display:block;font-size:15px;color:#0F172A;margin-bottom:2px}
.fh-ct-texto p{margin:0;font-size:14px;color:#475569;line-height:1.5}
@media (max-width:520px){
  .fh-ct-palco{height:280px}
  .fh-ct-no{width:86px}
  .fh-ct-icone{width:42px;height:42px;border-radius:12px}
  .fh-ct-nome{font-size:11px}
  .fh-ct-sub{font-size:10px}
}
@media (prefers-reduced-motion:reduce){
  .fh-ct-fluxo{animation:none}
  .fh-ct-aba.ativa .fh-ct-tempo.corre{animation:none}
}
`;

export default function IlustracaoDaContingencia() {
  const [cena, setCena] = useState<Cena>("normal");
  const [sozinho, setSozinho] = useState(true);

  useEffect(() => {
    if (!sozinho) return;
    const t = setTimeout(() => {
      setCena((c) => (c === "normal" ? "caiu" : c === "caiu" ? "voltou" : "normal"));
    }, 6000);
    return () => clearTimeout(t);
  }, [cena, sozinho]);

  const caiu = cena === "caiu";
  const atual = CENAS.find((c) => c.id === cena)!;

  return (
    <div className="fh-ct" data-ilustracao-contingencia>
      <style dangerouslySetInnerHTML={{ __html: ESTILO }} />
      <div className="fh-ct-abas" role="tablist">
        {CENAS.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={cena === c.id}
            data-cena={c.id}
            className={`fh-ct-aba${cena === c.id ? " ativa" : ""}`}
            onClick={() => { setSozinho(false); setCena(c.id); }}
          >
            {c.rotulo}
            {/* A barrinha conta o tempo até a próxima cena; parado, ela some. */}
            <span key={`${cena}-${sozinho}`} className={`fh-ct-tempo${sozinho ? " corre" : ""}`} />
          </button>
        ))}
      </div>

      <div className="fh-ct-palco" aria-hidden>
        <svg className="fh-ct-linhas" viewBox="0 0 100 100" preserveAspectRatio="none">
          {linhasDa(cena).map((l) => (
            <line
              key={`${l.de}-${l.para}`}
              x1={P[l.de].x} y1={P[l.de].y} x2={P[l.para].x} y2={P[l.para].y}
              stroke={l.cor}
              strokeWidth={l.fluxo ? 3 : 2}
              vectorEffect="non-scaling-stroke"
              strokeDasharray={l.tracejada ? "4 5" : undefined}
              opacity={l.some ? 0 : l.tracejada ? 0.45 : 1}
              className={l.fluxo ? `fh-ct-fluxo${l.fluxo === "sobe" ? " sobe" : ""}` : undefined}
            />
          ))}
        </svg>

        <No
          onde={P.nuvem}
          icone={caiu ? <CloudOff size={26} /> : <Cloud size={26} />}
          nome="FireHub na internet"
          sub={caiu ? "fora do ar" : cena === "voltou" ? "recebendo tudo" : "no ar"}
          cor={caiu ? VERMELHO : VERDE}
          fundo={caiu ? "#FEF2F2" : "#F0FDF4"}
        />
        <No
          onde={P.pc}
          icone={<Monitor size={26} />}
          nome="Computador do caixa"
          sub={caiu ? "atendendo a loja" : cena === "voltou" ? "enviando para a nuvem" : "guardando a cópia"}
          cor={ROXO}
          fundo="#F5F3FF"
          brilho={caiu ? "rgba(124,58,237,.18)" : undefined}
        />
        <No onde={P.tv} icone={<Tv size={24} />} nome="TV da cozinha" sub={caiu ? "pelo Wi-Fi da loja" : "pela internet"} cor={caiu ? ROXO : "#334155"} fundo="#F1F5F9" />
        <No onde={P.cel} icone={<Smartphone size={24} />} nome="Celular do garçom" sub={caiu ? "pelo Wi-Fi da loja" : "pela internet"} cor={caiu ? ROXO : "#334155"} fundo="#F1F5F9" />
        <No onde={P.imp} icone={<Printer size={22} />} nome="Impressora" sub={caiu ? "imprimindo igual" : undefined} cor={caiu ? ROXO : "#334155"} fundo="#F1F5F9" />

      </div>

      {/* A faixa que aparece embaixo das telas de verdade durante a queda. A
          linha tem altura fixa: o texto de baixo não pula ao trocar de cena. */}
      <div className="fh-ct-linha-faixa" aria-hidden>
        {cena === "caiu" && <div className="fh-ct-faixa">Sem conexão com o FireHub — trabalhando no computador da loja.</div>}
        {cena === "voltou" && <div className="fh-ct-faixa volta">✅ Conexão voltou — tudo foi enviado.</div>}
      </div>

      <div className="fh-ct-texto" aria-live="polite">
        <b>{atual.titulo}</b>
        <p>{atual.texto}</p>
      </div>
    </div>
  );
}

