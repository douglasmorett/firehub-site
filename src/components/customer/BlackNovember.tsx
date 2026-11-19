"use client";

/**
 * A janela da Black November FireHub no painel (regra: lib/black-november.ts;
 * servidor: /api/store/black-november).
 *
 * - Uma vez por loja: fechar (X, Esc, clique fora) ou clicar grava no
 *   SERVIDOR; o localStorage só poupa a consulta neste aparelho.
 * - Nunca empilha: espera não haver nenhuma outra janela do painel aberta
 *   (role="dialog" / aria-modal — central de tutoriais, novidades, termos…)
 *   por 2 s seguidos antes de abrir. Não abre no KDS, totem e telas de TV.
 * - Na prévia (PREVIEW_BLACK_NOVEMBER=1), ?variante=teto|fixo força a janela
 *   e a cobrança é simulada: mostra a URL e o corpo que iriam ao Asaas.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { ArrowRight, ExternalLink, Loader2, QrCode, X } from "lucide-react";

type Variante = "teto" | "fixo";
type Situacao = { mostrar: boolean; variante?: Variante; emTeste?: boolean; previa?: boolean };
type Resultado = { invoiceUrl: string; simulado?: boolean; corpo?: Record<string, unknown>; forma: "cartao" | "pix" };

const CHAVE_LOCAL = "fh_black_november_2026_visto_";
const SEM_ABRIR = ["/store/totem", "/store/kds", "/store/painel-de-senhas", "/store/caixa-mercado/caixa", "/store/balanca"];
const WHATSAPP = "https://wa.me/5522981118514?text=Quero+a+Black+November+do+FireHub";

export default function BlackNovember({ usuarioId }: { usuarioId: string }) {
  const rota = usePathname();
  const [situacao, setSituacao] = useState<Situacao | null>(null);
  const [aberto, setAberto] = useState(false);
  const [enviando, setEnviando] = useState<"cartao" | "pix" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const janela = useRef<HTMLDivElement>(null);
  const foco = useRef<Element | null>(null);
  const forcada = useRef<Variante | null>(null);
  const rotaRef = useRef(rota);
  rotaRef.current = rota;

  // 1. A loja vê? (o servidor decide; o aparelho só lembra o que já viu)
  useEffect(() => {
    let pedida: string | null = null;
    try { pedida = new URLSearchParams(window.location.search).get("variante"); } catch {}
    if (pedida === "teto" || pedida === "fixo") forcada.current = pedida;
    try {
      if (!forcada.current && localStorage.getItem(CHAVE_LOCAL + usuarioId) === "1") return;
    } catch {}
    let vivo = true;
    fetch(`/api/store/black-november${forcada.current ? `?variante=${forcada.current}` : ""}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Situacao | null) => {
        if (!vivo || !d) return;
        if (!d.mostrar) {
          try { localStorage.setItem(CHAVE_LOCAL + usuarioId, "1"); } catch {}
          return;
        }
        setSituacao(d);
      })
      .catch(() => { /* sem rede, a janela fica para depois */ });
    return () => { vivo = false; };
  }, [usuarioId]);

  // 2. Espera a vez: nenhuma outra janela aberta por 2 s seguidos.
  useEffect(() => {
    if (!situacao?.mostrar || aberto) return;
    const montou = Date.now();
    let calmaDesde: number | null = null;
    const iv = window.setInterval(() => {
      const outra = document.querySelector('[role="dialog"]:not([data-black-november]), [aria-modal="true"]:not([data-black-november])');
      const telaDeOperacao = SEM_ABRIR.some((r) => (rotaRef.current || "").startsWith(r));
      if (outra || telaDeOperacao) { calmaDesde = null; return; }
      calmaDesde ??= Date.now();
      if (Date.now() - calmaDesde >= 2000 && Date.now() - montou >= 3000) {
        window.clearInterval(iv);
        foco.current = document.activeElement;
        setAberto(true);
      }
    }, 400);
    return () => window.clearInterval(iv);
  }, [situacao, aberto]);

  const variante: Variante = situacao?.variante === "teto" ? "teto" : "fixo";
  const previa = !!situacao?.previa;

  const fechar = useCallback(() => {
    setAberto(false);
    setSituacao(null);
    if (!previa) { try { localStorage.setItem(CHAVE_LOCAL + usuarioId, "1"); } catch {} }
    if (!resultado) {
      fetch("/api/store/black-november", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "visto", variante }),
      }).catch(() => {});
    }
    (foco.current as HTMLElement | null)?.focus?.();
  }, [previa, resultado, usuarioId, variante]);

  // Esc fecha; foco preso na janela; a página de trás não rola.
  useEffect(() => {
    if (!aberto) return;
    janela.current?.focus({ preventScroll: true });
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); fechar(); return; }
      if (e.key !== "Tab" || !janela.current) return;
      const focaveis = Array.from(janela.current.querySelectorAll<HTMLElement>("button:not([disabled]), a[href]"));
      if (!focaveis.length) return;
      const [primeiro, ultimo] = [focaveis[0], focaveis[focaveis.length - 1]];
      if (e.shiftKey && document.activeElement === primeiro) { e.preventDefault(); ultimo.focus(); }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro.focus(); }
    };
    window.addEventListener("keydown", tecla);
    return () => { window.removeEventListener("keydown", tecla); document.body.style.overflow = antes; };
  }, [aberto, fechar]);

  const contratar = async (forma: "cartao" | "pix") => {
    setErro(null);
    setEnviando(forma);
    // A aba nasce no clique: aberta depois do await, o navegador bloqueia.
    const aba = previa ? null : window.open("", "_blank");
    try {
      const r = await fetch("/api/store/black-november", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "cobrar", forma, variante }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || !d?.invoiceUrl) throw new Error(d?.error || "Não deu para gerar a cobrança agora.");
      if (!previa) { try { localStorage.setItem(CHAVE_LOCAL + usuarioId, "1"); } catch {} }
      if (aba && !d.simulado) aba.location.href = d.invoiceUrl;
      else aba?.close();
      setResultado({ invoiceUrl: d.invoiceUrl, simulado: d.simulado, corpo: d.corpo, forma });
    } catch (e: any) {
      aba?.close();
      setErro(e?.message || "Não deu para gerar a cobrança agora.");
    } finally {
      setEnviando(null);
    }
  };

  if (!aberto || !situacao?.mostrar) return null;

  return (
    <div className="bn-fundo" data-black-november onMouseDown={(e) => { if (e.target === e.currentTarget) fechar(); }}>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@800;900&display=swap" precedence="default" />
      <style>{ESTILO}</style>
      <div ref={janela} className="bn-janela" role="dialog" aria-modal="true" aria-labelledby="bn-titulo" aria-describedby="bn-oferta" tabIndex={-1} data-black-november>
        <button type="button" className="bn-fechar" onClick={fechar} aria-label="Fechar">
          <X size={20} strokeWidth={2.2} aria-hidden />
        </button>

        <div className="bn-arte" aria-hidden>
          <Presente />
        </div>

        <div className="bn-conteudo">
          <div className="bn-marca">
            <img src="/firehub-flame.png" alt="" width={18} height={18} />
            <span><b>FIRE</b>HUB</span>
            <span className="bn-prazo">até 30/11</span>
          </div>

          <h2 id="bn-titulo" className="bn-titulo">
            <span>Black</span> <span className="bn-laranja">November</span>
          </h2>

          {resultado ? (
            <Depois resultado={resultado} onFechar={fechar} />
          ) : (
            <>
              <div id="bn-oferta">
                {variante === "teto" ? (
                  <>
                    <p className="bn-chamada">Contrate 1 ano e economize R$&nbsp;800.</p>
                    <p className="bn-apoio">São 2 meses grátis: 12 meses no teto de R$&nbsp;400 custariam R$&nbsp;4.800. Na Black November, o ano inteiro sai por R$&nbsp;4.000.</p>
                  </>
                ) : (
                  <>
                    <p className="bn-chamada">1 ano de FireHub por R$&nbsp;4.000.</p>
                    <p className="bn-apoio">Venda quanto quiser: a mensalidade não sobe. O valor fica fechado pelos próximos 12 meses.</p>
                  </>
                )}
                {situacao.emTeste && (
                  <p className="bn-apoio bn-teste">Seu teste grátis continua. O ano começa a contar quando ele acabar.</p>
                )}
              </div>

              <div className="bn-preco">
                <div className="bn-parcela">
                  <span className="bn-vezes">12x de</span>
                  <span className="bn-valor">R$&nbsp;333,33</span>
                  <span className="bn-juros">sem juros no cartão</span>
                </div>
                <div className="bn-avista">
                  {variante === "teto" ? (
                    <>De <s>R$&nbsp;4.800</s> por <b>R$&nbsp;4.000</b>, ou à vista no Pix</>
                  ) : (
                    <>ou <b>R$&nbsp;4.000</b> à vista no Pix</>
                  )}
                </div>
              </div>

              {erro && (
                <div className="bn-erro" role="alert">
                  {erro} <a href={WHATSAPP} target="_blank" rel="noopener noreferrer">Chamar no WhatsApp</a>
                </div>
              )}

              <div className="bn-acoes">
                <button type="button" className="bn-primario" onClick={() => contratar("cartao")} disabled={!!enviando}>
                  {enviando === "cartao" ? <Loader2 size={18} className="bn-gira" aria-hidden /> : null}
                  {enviando === "cartao" ? "Gerando o pagamento…" : "Quero aproveitar"}
                  {enviando !== "cartao" && <ArrowRight size={18} strokeWidth={2.4} aria-hidden />}
                </button>
                <button type="button" className="bn-secundario" onClick={() => contratar("pix")} disabled={!!enviando}>
                  {enviando === "pix" ? <Loader2 size={16} className="bn-gira" aria-hidden /> : <QrCode size={16} aria-hidden />}
                  {enviando === "pix" ? "Gerando o Pix…" : "Prefiro Pix à vista"}
                </button>
              </div>

              <p className="bn-letras">
                Oferta válida até 30/11/2026. Plano anual, sem devolução se cancelar no meio do ano.
                O pagamento é pelo Asaas, em nome de GRUPO HAKIM LTDA, a empresa do FireHub.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Depois({ resultado, onFechar }: { resultado: Resultado; onFechar: () => void }) {
  if (resultado.simulado) {
    return (
      <div className="bn-depois">
        <p className="bn-chamada bn-menor">Prévia: nada foi enviado ao Asaas.</p>
        <p className="bn-apoio">Na loja de verdade, abriria em outra aba:</p>
        <code className="bn-url">{resultado.invoiceUrl}</code>
        {resultado.corpo && (
          <dl className="bn-corpo">
            {Object.entries(resultado.corpo).map(([k, v]) => (
              <div key={k}><dt>{k}</dt><dd>{String(v)}</dd></div>
            ))}
          </dl>
        )}
        <div className="bn-acoes"><button type="button" className="bn-secundario" onClick={onFechar}>Fechar</button></div>
      </div>
    );
  }
  return (
    <div className="bn-depois">
      <p className="bn-chamada bn-menor">
        {resultado.forma === "pix" ? "O Pix abriu em outra aba." : "O pagamento abriu em outra aba."}
      </p>
      <p className="bn-apoio">Quando o Asaas confirmar, o plano anual entra sozinho na sua conta e a mensalidade dos próximos 12 meses já fica paga.</p>
      <div className="bn-acoes">
        <a className="bn-primario" href={resultado.invoiceUrl} target="_blank" rel="noopener noreferrer">
          Abrir o pagamento <ExternalLink size={16} aria-hidden />
        </a>
        <button type="button" className="bn-secundario" onClick={onFechar}>Fechar</button>
      </div>
    </div>
  );
}

/** A caixa de presente preta com laço laranja (a arte da campanha de 04/11). */
function Presente() {
  return (
    <svg viewBox="0 0 260 250" className="bn-presente" role="presentation">
      <defs>
        <radialGradient id="bn-luz" cx="50%" cy="48%" r="50%">
          <stop offset="0%" stopColor="#FF7A26" stopOpacity=".55" />
          <stop offset="55%" stopColor="#FF6B1A" stopOpacity=".12" />
          <stop offset="100%" stopColor="#FF6B1A" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="bn-corpo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#221A15" />
          <stop offset="60%" stopColor="#120D0A" />
          <stop offset="100%" stopColor="#070504" />
        </linearGradient>
        <linearGradient id="bn-tampa" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2C221B" />
          <stop offset="100%" stopColor="#140F0B" />
        </linearGradient>
        <linearGradient id="bn-fita" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#E2520A" />
          <stop offset="45%" stopColor="#FF8A3D" />
          <stop offset="100%" stopColor="#C94706" />
        </linearGradient>
        <linearGradient id="bn-fita-h" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FF8A3D" />
          <stop offset="100%" stopColor="#D94A05" />
        </linearGradient>
        <linearGradient id="bn-laco" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#FFA060" />
          <stop offset="100%" stopColor="#E0520A" />
        </linearGradient>
        <filter id="bn-sombra" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="7" />
        </filter>
      </defs>

      <circle cx="130" cy="128" r="122" fill="url(#bn-luz)" />
      <ellipse cx="130" cy="226" rx="86" ry="9" fill="#000" opacity=".7" filter="url(#bn-sombra)" />

      {/* corpo */}
      <rect x="50" y="122" width="160" height="100" rx="7" fill="url(#bn-corpo)" />
      <rect x="50" y="122" width="160" height="100" rx="7" fill="none" stroke="#FFFFFF" strokeOpacity=".07" />
      <rect x="50" y="160" width="160" height="20" fill="url(#bn-fita-h)" />
      <rect x="116" y="122" width="28" height="100" fill="url(#bn-fita)" />
      <rect x="50" y="122" width="160" height="10" fill="#000" opacity=".35" />

      <g className="bn-tampa-grupo">
        <rect x="38" y="96" width="184" height="32" rx="7" fill="url(#bn-tampa)" />
        <rect x="38" y="96" width="184" height="32" rx="7" fill="none" stroke="#FFFFFF" strokeOpacity=".09" />
        <rect x="42" y="98" width="176" height="2" rx="1" fill="#FFFFFF" opacity=".08" />
        <rect x="114" y="96" width="32" height="32" fill="url(#bn-fita)" />
        {/* laço */}
        <path d="M130 98 C 100 58, 58 66, 74 92 C 83 106, 110 104, 130 98 Z" fill="url(#bn-laco)" />
        <path d="M130 98 C 160 58, 202 66, 186 92 C 177 106, 150 104, 130 98 Z" fill="url(#bn-laco)" />
        <path d="M130 98 C 112 80, 88 78, 86 88 C 90 96, 112 99, 130 98 Z" fill="#9C3400" opacity=".55" />
        <path d="M130 98 C 148 80, 172 78, 174 88 C 170 96, 148 99, 130 98 Z" fill="#9C3400" opacity=".55" />
        <path d="M124 102 L104 132 L114 129 L118 140 L131 104 Z" fill="#E85A0E" />
        <path d="M136 102 L156 132 L146 129 L142 140 L129 104 Z" fill="#C94706" />
        <rect x="119" y="88" width="22" height="18" rx="6" fill="url(#bn-laco)" />
        <rect x="123" y="91" width="9" height="3" rx="1.5" fill="#FFFFFF" opacity=".35" />
      </g>
    </svg>
  );
}

const ESTILO = `
.bn-fundo{
  --bn-preto:#0C0907; --bn-carvao:#16100C; --bn-borda:rgba(255,160,96,.16);
  --bn-laranja:#FF6B1A; --bn-laranja-claro:#FF8A3D; --bn-marfim:#FBF4EC;
  --bn-texto2:#D4C6B8; --bn-texto3:#A8968A;
  position:fixed; inset:0; z-index:10060; display:flex; align-items:center; justify-content:center;
  padding:24px; background:rgba(14,10,8,.62); backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px);
  animation:bn-fundo .3s ease-out both;
}
.bn-janela{
  position:relative; display:grid; grid-template-columns:minmax(0,300px) minmax(0,1fr);
  width:min(780px,100%); max-height:calc(100dvh - 48px); overflow:auto;
  background:var(--bn-preto); color:var(--bn-marfim); border-radius:24px;
  border:1px solid var(--bn-borda);
  box-shadow:0 30px 80px -20px rgba(0,0,0,.65), 0 12px 24px -12px rgba(0,0,0,.5);
  font-family:Inter, system-ui, sans-serif;
  animation:bn-sobe .55s cubic-bezier(.16,1,.3,1) both;
}
.bn-janela:focus{outline:none}
.bn-janela ::selection{background:var(--bn-laranja); color:#160A03}
.bn-arte{
  position:relative; display:flex; align-items:center; justify-content:center;
  background:radial-gradient(120% 90% at 50% 100%, #2A1508 0%, var(--bn-carvao) 45%, #0A0705 100%);
  border-right:1px solid var(--bn-borda); padding:28px 18px;
}
.bn-presente{width:100%; max-width:290px; height:auto; display:block}
.bn-tampa-grupo{transform-box:fill-box; transform-origin:50% 100%; animation:bn-tampa 1.1s cubic-bezier(.16,1,.3,1) .35s both}
.bn-conteudo{padding:34px 36px 28px; display:flex; flex-direction:column; min-width:0}
.bn-marca{display:flex; align-items:center; gap:8px; font-size:.78rem; letter-spacing:.06em; color:var(--bn-texto2)}
.bn-marca b{color:#FF4D3A; font-weight:900}
.bn-marca span:nth-child(2){font-weight:800; color:var(--bn-marfim)}
.bn-prazo{margin-left:auto; margin-right:40px; padding:4px 10px; border-radius:999px; border:1px solid var(--bn-borda);
  color:var(--bn-laranja-claro); font-weight:700; letter-spacing:.02em; font-size:.74rem; white-space:nowrap}
.bn-titulo{
  margin:18px 0 14px; font-family:"Big Shoulders Display", Inter, sans-serif; font-weight:900;
  font-size:clamp(3rem, 7.4vw, 4.4rem); line-height:.86; letter-spacing:-.01em; text-transform:uppercase; color:var(--bn-marfim);
  text-wrap:balance;
}
.bn-titulo span{display:inline-block}
.bn-laranja{color:var(--bn-laranja)}
.bn-chamada{margin:0 0 8px; font-size:1.3rem; line-height:1.25; font-weight:800; letter-spacing:-.015em; color:var(--bn-marfim); text-wrap:balance}
.bn-chamada.bn-menor{font-size:1.12rem}
.bn-apoio{margin:0 0 6px; font-size:.92rem; line-height:1.55; color:var(--bn-texto2); max-width:48ch}
.bn-teste{color:var(--bn-laranja-claro); margin-top:8px}
.bn-preco{
  margin:20px 0 18px; padding:16px 18px; border-radius:16px;
  background:linear-gradient(180deg, rgba(255,107,26,.10), rgba(255,107,26,.04));
  border:1px solid rgba(255,107,26,.28);
  display:flex; flex-direction:column; gap:12px;
}
.bn-parcela{display:grid; grid-template-columns:auto auto; justify-content:start; align-items:baseline; column-gap:8px}
.bn-vezes{font-size:.9rem; font-weight:700; color:var(--bn-texto2)}
.bn-valor{font-size:2.15rem; font-weight:900; letter-spacing:-.03em; color:var(--bn-marfim); font-variant-numeric:tabular-nums; line-height:1}
.bn-juros{grid-column:1 / -1; margin-top:6px; font-size:.8rem; font-weight:600; color:var(--bn-laranja-claro)}
.bn-avista{padding-top:12px; border-top:1px solid rgba(255,107,26,.2); font-size:.88rem; line-height:1.4; color:var(--bn-texto2)}
.bn-avista s{color:var(--bn-texto3); text-decoration-thickness:1.5px}
.bn-avista b{color:var(--bn-marfim); font-variant-numeric:tabular-nums}
.bn-acoes{display:flex; gap:10px; flex-wrap:wrap; align-items:center}
.bn-primario,.bn-secundario{
  display:inline-flex; align-items:center; justify-content:center; gap:8px; min-height:48px; box-sizing:border-box;
  border-radius:14px; font-family:inherit; font-weight:800; cursor:pointer; text-decoration:none;
  transition:transform .16s cubic-bezier(.16,1,.3,1), background-color .16s, box-shadow .16s, border-color .16s;
}
.bn-primario{
  flex:1 1 220px; padding:0 22px; font-size:1.02rem; border:0; color:#160A03; background:var(--bn-laranja);
  box-shadow:0 10px 24px -10px rgba(255,107,26,.75), inset 0 1px 0 rgba(255,255,255,.35);
}
.bn-primario:hover:not(:disabled){background:var(--bn-laranja-claro); transform:translateY(-1px)}
.bn-primario:active:not(:disabled){transform:translateY(0) scale(.985)}
.bn-secundario{
  flex:0 1 auto; padding:0 18px; font-size:.92rem; color:var(--bn-marfim); background:transparent; border:1px solid rgba(251,244,236,.22);
}
.bn-secundario:hover:not(:disabled){border-color:rgba(251,244,236,.5); background:rgba(251,244,236,.05)}
.bn-primario:disabled,.bn-secundario:disabled{opacity:.6; cursor:progress}
.bn-primario:focus-visible,.bn-secundario:focus-visible,.bn-fechar:focus-visible,.bn-erro a:focus-visible{outline:2px solid var(--bn-laranja-claro); outline-offset:3px}
.bn-fechar{
  position:absolute; top:14px; right:14px; z-index:2; width:40px; height:40px; min-height:0; border-radius:12px; display:grid; place-items:center;
  background:rgba(251,244,236,.06); color:var(--bn-texto2); border:1px solid rgba(251,244,236,.1); cursor:pointer; padding:0;
}
.bn-fechar:hover{background:rgba(251,244,236,.12); color:var(--bn-marfim)}
.bn-letras{margin:16px 0 0; font-size:.74rem; line-height:1.55; color:var(--bn-texto3); max-width:60ch}
.bn-erro{margin:0 0 14px; padding:10px 12px; border-radius:12px; font-size:.86rem; line-height:1.45;
  background:rgba(239,68,68,.12); border:1px solid rgba(239,68,68,.35); color:#FECACA}
.bn-erro a{color:var(--bn-marfim); font-weight:700; text-underline-offset:3px}
.bn-depois{display:flex; flex-direction:column; gap:6px; margin-top:4px}
.bn-depois .bn-acoes{margin-top:14px}
.bn-url{display:block; padding:10px 12px; border-radius:10px; background:#1C140F; border:1px solid var(--bn-borda);
  color:var(--bn-laranja-claro); font-size:.8rem; word-break:break-all}
.bn-corpo{margin:8px 0 0; display:grid; gap:4px; font-size:.78rem}
.bn-corpo div{display:grid; grid-template-columns:140px 1fr; gap:8px}
.bn-corpo dt{color:var(--bn-texto3)} .bn-corpo dd{margin:0; color:var(--bn-texto2); word-break:break-word}
.bn-gira{animation:bn-gira .9s linear infinite}
@keyframes bn-fundo{from{opacity:0}}
@keyframes bn-sobe{from{opacity:0; transform:translateY(18px) scale(.98)}}
@keyframes bn-tampa{0%{transform:translateY(0)} 45%{transform:translateY(-9px) rotate(-1.5deg)} 100%{transform:translateY(0)}}
@keyframes bn-gira{to{transform:rotate(360deg)}}

@media (max-width:640px){
  .bn-fundo{align-items:flex-end; padding:0}
  .bn-janela{grid-template-columns:1fr; width:100%; max-height:calc(100dvh - 12px); border-radius:24px 24px 0 0; border-bottom:0;
    animation-name:bn-sobe-celular}
  .bn-arte{border-right:0; border-bottom:1px solid var(--bn-borda); padding:14px 16px 4px; height:128px; box-sizing:border-box}
  .bn-presente{max-width:none; width:auto; height:100%}
  .bn-conteudo{padding:20px 20px calc(20px + env(safe-area-inset-bottom))}
  .bn-titulo{margin:14px 0 12px; font-size:3.1rem}
  .bn-chamada{font-size:1.15rem}
  .bn-preco{padding:14px; margin:16px 0 14px}
  .bn-valor{font-size:1.9rem}
  .bn-primario,.bn-secundario{flex:1 1 100%}
}
@keyframes bn-sobe-celular{from{transform:translateY(40px); opacity:0}}
@media (prefers-reduced-motion:reduce){
  .bn-fundo,.bn-janela,.bn-tampa-grupo{animation:none}
  .bn-primario,.bn-secundario{transition:none}
}
`;
