"use client";

/**
 * Multimarcas — a tela do dono (/store/multimarcas).
 *
 * Desativado: a apresentação — o que é, um celular com a página de exemplo
 * funcionando (rede fictícia, lib/multimarcas/exemplo.ts), o que vem junto, o
 * preço À PARTE da mensalidade e as dúvidas — e, ao ativar, o termo
 * (lib/multimarcas/termo.ts). Ativado: o estado da assinatura e o editor.
 *
 * Douglas, 17/10/2026: "tem que fazer uma página bem bonita explicando" e "o
 * cara vai pagar o valor normal por cada loja (2% do faturamento) e mais 97
 * para ter essa página. Uma coisa nada a ver com a outra. Tem que ficar bem
 * especificado, bem claro pro cliente."
 *
 * `previa` = dados de mentira, sem servidor (rota /rede/previa/oferta, para
 * mostrar a tela antes de publicar).
 */

import { useCallback, useEffect, useState } from "react";
import { Check, Image as ImageIcon, LayoutGrid, Link2, Search, ShoppingBag, Smartphone, Sparkles, Star, Store } from "lucide-react";
import VitrineDaRede from "@/components/rede/VitrineDaRede";
import { CONFIG_DO_EXEMPLO, PRODUTOS_DO_EXEMPLO } from "@/lib/multimarcas/exemplo";
import { CLAUSULAS_DO_TERMO_DO_MULTIMARCAS, TITULO_DO_TERMO_DO_MULTIMARCAS, VERSAO_DO_TERMO_DO_MULTIMARCAS } from "@/lib/multimarcas/termo";
import s from "./Multimarcas.module.css";

type Estado = { ativo: boolean; cobradoEsteMes: boolean; testeAte: string | null; emTeste: boolean; jaTestou: boolean; isento: boolean };
export type DadosDoMultimarcas = {
  estado: Estado;
  preco: number;
  diasDeTeste: number;
  mensalidade: { percentual: number; minimo: number; teto: number; lojaExtraMarketplace: number };
};
type Aviso = { tipo: "ok" | "erro"; titulo: string; detalhe?: string };

const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: v % 1 ? 2 : 0 });
const data = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

export default function MultimarcasClient({ previa }: { previa?: DadosDoMultimarcas }) {
  const [dados, setDados] = useState<DadosDoMultimarcas | null>(previa ?? null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [termoAberto, setTermoAberto] = useState(false);
  const [confirmarDesligar, setConfirmarDesligar] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);

  const carregar = useCallback(async () => {
    if (previa) return;
    try {
      const r = await fetch("/api/store/multimarcas", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Erro ao carregar");
      setDados(j);
    } catch (e: any) {
      setErro(e.message);
    }
  }, [previa]);
  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), aviso.tipo === "erro" ? 10000 : 7000);
    return () => clearTimeout(t);
  }, [aviso]);

  async function ligar(ligar: boolean) {
    if (!dados) return;
    setSalvando(true);
    setConfirmarDesligar(false);
    try {
      let estado: Estado;
      if (previa) {
        estado = ligar
          ? { ...dados.estado, ativo: true, emTeste: true, jaTestou: true, testeAte: dados.estado.testeAte ?? new Date(Date.now() + dados.diasDeTeste * 864e5).toISOString() }
          : { ...dados.estado, ativo: false, emTeste: false };
      } else {
        const r = await fetch("/api/store/multimarcas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ligar ? { ligar, aceite: { versao: VERSAO_DO_TERMO_DO_MULTIMARCAS } } : { ligar }),
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || "Erro");
        estado = j.estado;
      }
      setDados({ ...dados, estado });
      setTermoAberto(false);
      setAviso(ligar
        ? { tipo: "ok", titulo: "Multimarcas ativado!", detalhe: estado.isento ? undefined : `Os ${dados.diasDeTeste} primeiros dias são grátis. Depois, ${reais(dados.preco)} por mês numa linha própria do boleto, à parte da mensalidade.` }
        : { tipo: "ok", titulo: "Multimarcas desativado.", detalhe: "A página das marcas saiu do ar e o mês que vem não é cobrado." });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e: any) {
      setAviso({ tipo: "erro", titulo: "Não deu certo", detalhe: e.message });
    } finally {
      setSalvando(false);
    }
  }

  if (erro) return <div className={s.erro}>{erro}</div>;
  if (!dados) return <div className={s.carregando}>Carregando…</div>;
  const { estado } = dados;

  return (
    <div className={s.pagina}>
      {aviso && (
        <div role="status" className={aviso.tipo === "ok" ? s.avisoOk : s.avisoErro} onClick={() => setAviso(null)}>
          <strong>{aviso.titulo}</strong>
          {aviso.detalhe && <span>{aviso.detalhe}</span>}
        </div>
      )}

      {estado.ativo ? (
        <Ativo dados={dados} salvando={salvando} confirmarDesligar={confirmarDesligar}
          onPedirDesligar={() => setConfirmarDesligar(true)} onCancelarDesligar={() => setConfirmarDesligar(false)} onDesligar={() => ligar(false)} />
      ) : (
        <Oferta dados={dados} salvando={salvando} onAtivar={() => setTermoAberto(true)} />
      )}

      {termoAberto && <Termo preco={dados.preco} salvando={salvando} onCancelar={() => setTermoAberto(false)} onAceitar={() => ligar(true)} />}
    </div>
  );
}

// ─── Desativado: a apresentação ──────────────────────────────────────────

const RECURSOS = [
  { icone: LayoutGrid, titulo: "Todas as marcas numa página", texto: "Um link só com todas as suas marcas, uma embaixo da outra, com nota, prazo e taxa." },
  { icone: ShoppingBag, titulo: "Sacola única, entrega única", texto: "O cliente põe um burguer de uma marca e um frango de outra. Um pedido, um motoboy, uma taxa." },
  { icone: ImageIcon, titulo: "Banners de oferta", texto: "Você mesmo troca os banners: promoção do dia, combo novo, frete grátis. Cada banner leva para a marca." },
  { icone: Search, titulo: "Busca em todas as marcas", texto: "O cliente digita \"frango\" ou \"açaí\" e acha em qualquer uma das suas marcas." },
  { icone: Star, titulo: "Nota de cada marca", texto: "As avaliações dos pedidos aparecem no cartão de cada marca." },
  { icone: Store, titulo: "Comanda separada por marca", texto: "Na cozinha, o pedido chega com um bloco para cada marca: a equipe sabe a embalagem certa." },
];

const PASSOS = [
  { titulo: "Ative", texto: "Aceite o termo e o Multimarcas fica liberado na hora." },
  { titulo: "Monte as marcas", texto: "Diga quais categorias do cardápio são de cada marca, suba logo, capa e banners." },
  { titulo: "Divulgue um link só", texto: "Bio do Instagram, WhatsApp, anúncio. Os pedidos caem no painel como sempre." },
];

function Oferta({ dados, salvando, onAtivar }: { dados: DadosDoMultimarcas; salvando: boolean; onAtivar: () => void }) {
  const m = dados.mensalidade;
  const isento = dados.estado.isento;
  const comTeste = !isento && !dados.estado.jaTestou;
  const botao = salvando ? "Ativando…" : comTeste ? `Ativar com ${dados.diasDeTeste} dias grátis` : "Ativar o Multimarcas";

  const perguntas: [string, string][] = [
    ["Os R$ " + dados.preco + " substituem a minha mensalidade?",
      `Não. A mensalidade de cada loja continua igual: ${m.percentual}% do faturamento, com mínimo de ${reais(m.minimo)} e teto de ${reais(m.teto)}. As lojas extras de iFood e 99Food continuam ${reais(m.lojaExtraMarketplace)} cada. O Multimarcas é um valor fixo, à parte, numa linha própria do mesmo boleto.`],
    ["Pago mais se tiver mais marcas?", `Não. São ${reais(dados.preco)} por mês para a página, com quantas marcas você quiser colocar nela.`],
    ["Preciso criar uma loja nova para cada marca?", "Não. Você diz quais categorias do seu cardápio são de cada marca. O pedido continua caindo no seu painel, na sua impressora e no seu caixa."],
    ["E o iFood e os outros apps?", "Não muda nada. O Multimarcas é a sua página própria, sem comissão por pedido."],
    ["Como cancelo?", "Aqui nesta tela, em \"Desativar\". A página sai do ar e o mês seguinte não é cobrado."],
  ];

  return (
    <>
      <section className={s.hero}>
        <div className={s.heroTexto}>
          <span className={s.selo}><Sparkles size={14} /> Novo · para dark kitchen e operação com várias marcas</span>
          <h1>Multimarcas</h1>
          <p className={s.heroFrase}>Todas as suas marcas numa página só, com a sua cara. O cliente pede de várias e recebe <strong>tudo numa entrega só</strong>.</p>
          <div className={s.heroAcoes}>
            <button className={s.cta} onClick={onAtivar} disabled={salvando}>{botao}</button>
            <span className={s.precoCurto}>{isento ? "Liberado para a sua conta" : <><strong>{reais(dados.preco)}/mês</strong> · à parte da mensalidade</>}</span>
          </div>
          <ul className={s.garantias}>
            <li><Check size={16} /> Sem comissão por pedido</li>
            <li><Check size={16} /> Desativa quando quiser</li>
            <li><Check size={16} /> Pronto para virar aplicativo</li>
          </ul>
        </div>
        <div className={s.palco}>
          <div className={s.telefone}>
            <VitrineDaRede config={CONFIG_DO_EXEMPLO} produtos={PRODUTOS_DO_EXEMPLO} embutida />
          </div>
          <span className={s.dicaDoTelefone}>Exemplo funcionando — toque, entre nas marcas e monte a sacola</span>
        </div>
      </section>

      <section className={s.secao}>
        <h2>O que você tem com o Multimarcas</h2>
        <p className={s.sub}>Feito para quem tem várias marcas saindo da mesma cozinha.</p>
        <div className={s.recursos}>
          {RECURSOS.map((r) => (
            <div key={r.titulo} className={s.recurso}>
              <span className={s.recursoIcone}><r.icone size={20} /></span>
              <strong>{r.titulo}</strong>
              <p>{r.texto}</p>
            </div>
          ))}
        </div>
      </section>

      <section className={s.secao}>
        <h2>Como funciona</h2>
        <ol className={s.passos}>
          {PASSOS.map((p, i) => (
            <li key={p.titulo}><span className={s.numero}>{i + 1}</span><div><strong>{p.titulo}</strong><p>{p.texto}</p></div></li>
          ))}
        </ol>
        <div className={s.faixaApp}>
          <Smartphone size={22} />
          <span><strong>Quer o seu aplicativo?</strong> O Aplicativo da loja é montado em cima desta mesma estrutura: todas as marcas, banners e a sacola única, na Play Store e na App Store.</span>
        </div>
      </section>

      <section className={s.secao} id="preco">
        <h2>Quanto custa</h2>
        <p className={s.sub}>Um valor fixo, separado da mensalidade. Uma coisa não mexe na outra.</p>
        <div className={s.precos}>
          <div className={s.caixaContinua}>
            <span className={s.rotulo}>O que você já paga — continua igual</span>
            <div className={s.linhaPreco}><span>Mensalidade de cada loja</span><strong>{m.percentual}% do faturamento</strong></div>
            <p className={s.miudo}>mínimo de {reais(m.minimo)} e teto de {reais(m.teto)} por loja</p>
            <div className={s.linhaPreco}><span>Cada loja extra no iFood ou na 99Food</span><strong>{reais(m.lojaExtraMarketplace)}</strong></div>
          </div>
          <div className={s.mais}>+</div>
          <div className={s.caixaNova}>
            <span className={s.rotulo}>Multimarcas</span>
            <div className={s.valorGrande}>{reais(dados.preco)}<small>/mês</small></div>
            <p>Fixo, com quantas marcas você quiser. Vem numa <strong>linha própria</strong> do mesmo boleto.</p>
            {comTeste && <p className={s.teste}>{dados.diasDeTeste} primeiros dias grátis na primeira ativação.</p>}
          </div>
        </div>
        <div className={s.exemplo}>
          <strong>Exemplo:</strong> sua loja paga {reais(m.teto)} de mensalidade. Com o Multimarcas, o boleto vem com {reais(m.teto)} (mensalidade) + {reais(dados.preco)} (Multimarcas) = <strong>{reais(m.teto + dados.preco)}</strong>.
        </div>
        <div className={s.ctaFinal}>
          <button className={s.cta} onClick={onAtivar} disabled={salvando}>{botao}</button>
        </div>
      </section>

      <section className={s.secao}>
        <h2>Dúvidas</h2>
        <div className={s.faq}>
          {perguntas.map(([p, r]) => (
            <details key={p}>
              <summary>{p}</summary>
              <p>{r}</p>
            </details>
          ))}
        </div>
      </section>
    </>
  );
}

// ─── Ativado ─────────────────────────────────────────────────────────────

function Ativo({ dados, salvando, confirmarDesligar, onPedirDesligar, onCancelarDesligar, onDesligar }: {
  dados: DadosDoMultimarcas; salvando: boolean; confirmarDesligar: boolean;
  onPedirDesligar: () => void; onCancelarDesligar: () => void; onDesligar: () => void;
}) {
  const e = dados.estado;
  return (
    <>
      <div className={s.cabecalhoAtivo}>
        <h1>Multimarcas</h1>
        <span className={s.seloAtivo}>{e.isento ? "LIBERADO" : e.emTeste && e.testeAte ? `ATIVO · grátis até ${data(e.testeAte)}` : "ATIVO"}</span>
      </div>
      <p className={s.sub}>A página com todas as suas marcas, banners e a sacola única.</p>

      <section className={s.montagem}>
        <span className={s.recursoIcone}><Link2 size={20} /></span>
        <div>
          <strong>Próximo passo: montar as suas marcas</strong>
          <p>Aqui você vai separar as categorias do cardápio por marca, subir logo, capa e banners, e pegar o link da página.</p>
        </div>
      </section>

      {!e.isento && (
        <div className={s.desligar}>
          <span>
            {reais(dados.preco)} por mês, numa linha própria do boleto, à parte da mensalidade.
            {e.emTeste && e.testeAte ? ` Grátis até ${data(e.testeAte)}.` : e.cobradoEsteMes ? " Este mês já entra no boleto." : ""}
          </span>
          {confirmarDesligar ? (
            <span className={s.desligarBotoes}>
              <button className={s.botaoPerigo} onClick={onDesligar} disabled={salvando}>{salvando ? "Desativando…" : "Sim, desativar"}</button>
              <button className={s.botaoLeve} onClick={onCancelarDesligar} disabled={salvando}>Cancelar</button>
            </span>
          ) : (
            <button className={s.botaoLeve} onClick={onPedirDesligar}>Desativar</button>
          )}
        </div>
      )}
    </>
  );
}

// ─── Termo ───────────────────────────────────────────────────────────────

function Termo({ preco, salvando, onCancelar, onAceitar }: { preco: number; salvando: boolean; onCancelar: () => void; onAceitar: () => void }) {
  const [concordo, setConcordo] = useState(false);
  return (
    <div role="dialog" aria-modal="true" aria-label={TITULO_DO_TERMO_DO_MULTIMARCAS} className={s.termoFundo}
      onClick={(e) => { if (e.target === e.currentTarget && !salvando) onCancelar(); }}>
      <div className={s.termo}>
        <div className={s.termoTopo}>
          <span className={s.recursoIcone}><LayoutGrid size={20} /></span>
          <div>
            <strong>{TITULO_DO_TERMO_DO_MULTIMARCAS}</strong>
            <span>{reais(preco)} por mês · versão de {VERSAO_DO_TERMO_DO_MULTIMARCAS.split("-").reverse().join("/")}</span>
          </div>
        </div>
        <ol className={s.clausulas}>
          {CLAUSULAS_DO_TERMO_DO_MULTIMARCAS.map((c, i) => <li key={i}>{c}</li>)}
        </ol>
        <label className={s.concordo}>
          <input type="checkbox" checked={concordo} onChange={(e) => setConcordo(e.target.checked)} />
          Li e concordo com o termo e autorizo a cobrança de {reais(preco)} por mês no boleto do FireHub, à parte da mensalidade.
        </label>
        <div className={s.termoBotoes}>
          <button className={s.botaoLeve} onClick={onCancelar} disabled={salvando}>Agora não</button>
          <button className={s.cta} onClick={onAceitar} disabled={!concordo || salvando}>{salvando ? "Ativando…" : "Concordo e ativar"}</button>
        </div>
      </div>
    </div>
  );
}
