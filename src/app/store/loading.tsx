/**
 * src/app/store/loading.tsx — o que aparece entre o clique e a tela pronta.
 *
 * ── Por que existe ──────────────────────────────────────────────────────────
 *
 * Lojistas reclamaram (30/09/2026) que "clica e o site demora a responder".
 * Não havia nenhum loading.tsx no app, e no Next 16 rota dinâmica SEM ele não
 * é pré-carregada: o clique no menu ficava parado esperando o servidor montar
 * a tela inteira — 4,2 s na Início —, sem mudar nada na tela. Parecia travado.
 *
 * Com este arquivo o Next pré-carrega o painel até aqui, e o clique troca a
 * tela NA HORA para este esqueleto; o conteúdo entra quando chega. Vale para
 * todas as telas de /store que não tenham o próprio loading.tsx.
 * Ver node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md.
 *
 * Sem JavaScript e sem dado nenhum: tem que ser instantâneo.
 */

const ESTILO = `
.fh-carregando{ position:relative; padding:1.25rem 1.5rem; max-width:1400px; margin:0 auto; }
.fh-carregando-barra{ position:absolute; top:0; left:0; right:0; height:3px; overflow:hidden; }
.fh-carregando-barra::after{
  content:""; position:absolute; top:0; bottom:0; width:35%;
  background:var(--fh-marca, #C92E09); border-radius:3px;
  animation:fh-carregando-corre 1.1s ease-in-out infinite;
}
@keyframes fh-carregando-corre{ from{ left:-35%; } to{ left:100%; } }
.fh-carregando-esq{ background:#E7E5E4; border-radius:var(--fh-r1, 6px);
  animation:fh-carregando-pulsa 1.4s ease-in-out infinite; }
@keyframes fh-carregando-pulsa{ 0%,100%{ opacity:1; } 50%{ opacity:.55; } }
.fh-carregando-titulo{ height:22px; width:220px; max-width:60%; margin-bottom:1.25rem; }
.fh-carregando-cards{ display:flex; gap:1rem; flex-wrap:wrap; margin-bottom:1.25rem; }
.fh-carregando-card{ flex:1 1 200px; min-width:160px; height:92px; border-radius:14px; }
.fh-carregando-bloco{ height:280px; border-radius:14px; }
.fh-carregando-sr{ position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
@media (prefers-reduced-motion: reduce){
  .fh-carregando-barra::after, .fh-carregando-esq{ animation:none; }
  .fh-carregando-barra::after{ left:0; width:100%; opacity:.5; }
}
@media (max-width: 640px){ .fh-carregando{ padding:1rem; } .fh-carregando-bloco{ height:200px; } }
`;

export default function Carregando() {
  return (
    <div className="fh-carregando" role="status" aria-live="polite">
      <style>{ESTILO}</style>
      <div className="fh-carregando-barra" aria-hidden />
      <span className="fh-carregando-sr">Carregando…</span>
      <div className="fh-carregando-esq fh-carregando-titulo" aria-hidden />
      <div className="fh-carregando-cards" aria-hidden>
        <div className="fh-carregando-esq fh-carregando-card" />
        <div className="fh-carregando-esq fh-carregando-card" />
        <div className="fh-carregando-esq fh-carregando-card" />
        <div className="fh-carregando-esq fh-carregando-card" />
      </div>
      <div className="fh-carregando-esq fh-carregando-bloco" aria-hidden />
    </div>
  );
}
