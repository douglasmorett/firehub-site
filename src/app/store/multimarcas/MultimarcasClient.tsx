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
import { LayoutGrid, Link2 } from "lucide-react";
import OfertaDoMultimarcas from "./OfertaDoMultimarcas";
import EditorDoMultimarcas from "./EditorDoMultimarcas";
import InterruptorDoModulo from "@/components/modulos/InterruptorDoModulo";
import ResumoDaCobranca from "@/components/modulos/ResumoDaCobranca";
import { CLAUSULAS_DO_TERMO_DO_MULTIMARCAS, TITULO_DO_TERMO_DO_MULTIMARCAS, VERSAO_DO_TERMO_DO_MULTIMARCAS } from "@/lib/multimarcas/termo";
import s from "./Multimarcas.module.css";

type Estado = { ativo: boolean; cobradoEsteMes: boolean; testeAte: string | null; emTeste: boolean; jaTestou: boolean; isento: boolean; cortesia: boolean;
  /** Desligamento marcado para a virada do mês (lib/modulo-pago.ts). */
  desligaEm: string | null; fimDoMes: string | null };
export type DadosDoMultimarcas = {
  estado: Estado;
  preco: number;
  diasDeTeste: number;
  /** O Aplicativo da loja completo (Android + Apple): quem paga, ganha o Multimarcas de cortesia. */
  precoDoAppCompleto: number;
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
    const antes = dados.estado;
    try {
      let estado: Estado;
      if (previa) {
        estado = ligar
          ? { ...dados.estado, ativo: true, emTeste: true, jaTestou: true, testeAte: dados.estado.testeAte ?? new Date(Date.now() + dados.diasDeTeste * 864e5).toISOString() }
          : { ...dados.estado, ativo: false, emTeste: false, desligaEm: null };
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
      // O aviso diz o que acontece com a cobrança, do jeito da regra (lib/modulo-pago.ts).
      setAviso(ligar
        ? antes.ativo && antes.desligaEm
          ? { tipo: "ok", titulo: "O Multimarcas continua ligado.", detalhe: "O desligamento da virada do mês foi cancelado; a cobrança segue normal." }
          : { tipo: "ok", titulo: "Multimarcas ligado!", detalhe: estado.isento ? undefined
              : estado.cortesia ? "Cortesia: com o Aplicativo da loja completo, não é cobrado."
              : estado.emTeste && estado.testeAte ? `Grátis até ${data(estado.testeAte)}. Depois disso, se continuar ligado, o mês entra inteiro no boleto (${reais(dados.preco)}), à parte da mensalidade.`
              : `Este mês já entra inteiro no boleto (${reais(dados.preco)}), numa linha própria, à parte da mensalidade.` }
        : estado.ativo && estado.desligaEm
          ? { tipo: "ok", titulo: `O Multimarcas desliga em ${data(estado.desligaEm)}.`, detalhe: "Este mês já está pago: até lá ele continua liberado para você, e o mês que vem não é cobrado." }
          : { tipo: "ok", titulo: "Multimarcas desligado.", detalhe: "Você estava no teste grátis: nada foi cobrado. A página das marcas saiu do ar." });
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
        <Ativo dados={dados} previa={!!previa} onAviso={(tipo, titulo, detalhe) => setAviso({ tipo, titulo, detalhe })} salvando={salvando}
          onDesligar={() => ligar(false)} onContinuar={() => ligar(true)} />
      ) : (
        <OfertaDoMultimarcas dados={dados} salvando={salvando} onAtivar={() => setTermoAberto(true)} />
      )}

      {termoAberto && <Termo preco={dados.preco} diasDeTeste={dados.diasDeTeste} comTeste={!estado.jaTestou && !estado.isento} cortesia={estado.cortesia}
        salvando={salvando} onCancelar={() => setTermoAberto(false)} onAceitar={() => ligar(true)} />}
    </div>
  );
}

// ─── Ativado ─────────────────────────────────────────────────────────────

function Ativo({ dados, previa, onAviso, salvando, onDesligar, onContinuar }: {
  dados: DadosDoMultimarcas; previa: boolean; onAviso: (tipo: "ok" | "erro", titulo: string, detalhe?: string) => void; salvando: boolean;
  onDesligar: () => void; onContinuar: () => void;
}) {
  const e = dados.estado;
  return (
    <>
      <div className={s.cabecalhoAtivo}>
        <h1>Multimarcas</h1>
        <span className={s.seloAtivo}>{e.isento ? "LIBERADO" : e.cortesia ? "ATIVO · CORTESIA DO APLICATIVO" : e.emTeste && e.testeAte ? `ATIVO · grátis até ${data(e.testeAte)}` : "ATIVO"}</span>
      </div>
      <p className={s.sub}>A página com todas as suas marcas, banners e a sacola única.</p>

      {/* O liga/desliga com a regra da cobrança escrita (components/modulos/InterruptorDoModulo). */}
      <InterruptorDoModulo nome="o Multimarcas" preco={dados.preco} estado={e} salvando={salvando}
        onLigar={() => {}} onDesligar={onDesligar} onContinuar={onContinuar} />

      {previa ? (
      <section className={s.montagem}>
          <span className={s.recursoIcone}><Link2 size={20} /></span>
          <div>
            <strong>Próximo passo: montar as suas marcas</strong>
            <p>Aqui você vai separar as categorias do cardápio por marca, subir logo, capa e banners, e pegar o link da página.</p>
          </div>
        </section>
      ) : (
        <EditorDoMultimarcas onAviso={onAviso} />
      )}

    </>
  );
}

// ─── Termo ───────────────────────────────────────────────────────────────

function Termo({ preco, diasDeTeste, comTeste, cortesia, salvando, onCancelar, onAceitar }: {
  preco: number; diasDeTeste: number; comTeste: boolean; cortesia: boolean; salvando: boolean; onCancelar: () => void; onAceitar: () => void;
}) {
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
        <ResumoDaCobranca preco={preco} diasDeTeste={diasDeTeste} comTeste={comTeste} cortesia={cortesia} />
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
