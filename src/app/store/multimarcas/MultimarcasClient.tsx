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
import { CLAUSULAS_DO_TERMO_DO_MULTIMARCAS, TITULO_DO_TERMO_DO_MULTIMARCAS, VERSAO_DO_TERMO_DO_MULTIMARCAS } from "@/lib/multimarcas/termo";
import s from "./Multimarcas.module.css";

type Estado = { ativo: boolean; cobradoEsteMes: boolean; testeAte: string | null; emTeste: boolean; jaTestou: boolean; isento: boolean; cortesia: boolean };
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
        <OfertaDoMultimarcas dados={dados} salvando={salvando} onAtivar={() => setTermoAberto(true)} />
      )}

      {termoAberto && <Termo preco={dados.preco} salvando={salvando} onCancelar={() => setTermoAberto(false)} onAceitar={() => ligar(true)} />}
    </div>
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
        <span className={s.seloAtivo}>{e.isento ? "LIBERADO" : e.cortesia ? "ATIVO · CORTESIA DO APLICATIVO" : e.emTeste && e.testeAte ? `ATIVO · grátis até ${data(e.testeAte)}` : "ATIVO"}</span>
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
            {e.cortesia ? "Cortesia: enquanto o Aplicativo da loja estiver ativo no Android e no iPhone, o Multimarcas não é cobrado." : `${reais(dados.preco)} por mês, numa linha própria do boleto, à parte da mensalidade.`}
            {e.cortesia ? "" : e.emTeste && e.testeAte ? ` Grátis até ${data(e.testeAte)}.` : e.cobradoEsteMes ? " Este mês já entra no boleto." : ""}
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
