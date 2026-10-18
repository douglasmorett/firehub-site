"use client";

/**
 * COMO VOCÊ GANHA — o comissionamento do vendedor explicado (Douglas,
 * 18/10/2026): "quem atende tem que ser comissionado… se amanhã ele parar de
 * atender quem ele convidou, ele perde os 10%".
 *
 *   • COMO EMBAIXADOR (autônomo): o % de embaixador das lojas que ele indicou,
 *     recorrente enquanto a loja paga — atenda quem atender, mesmo fora da equipe;
 *   • COMO VENDEDOR (contratado), enquanto atende:
 *   • loja que veio pelo link de vendedor dele → % de link do cadastro (10%);
 *   • loja atribuída à carteira dele → % de atribuída (3%);
 *   • recarga de disparo das lojas que ele atende → 3% (o vendedor NÃO vê a
 *     margem nem o custo da Meta: só quanto ganha por pacote — pedido do Douglas).
 *
 * Os percentuais são os do CADASTRO (o que o split paga). O admin vê também o
 * combinado, o aviso de divergência e a margem do disparo. Aparece no portal
 * (Meus números) e no detalhe da carteira no admin.
 */
import { Link2, UserPlus, Wallet, Info, TriangleAlert, MessageSquare, DoorOpen, Handshake } from "lucide-react";
import { useDinheiro } from "@/components/parceiro/ValoresOcultos";
import { COMISSAO_COMBINADA, exemploDeComissao } from "@/lib/performance-das-carteiras/regras";
import { ESTILO_DO_PERFIL } from "./estilo";

export type PacoteDoDisparo = { mensagens: number; ganho: number };

export type DadosDoComissionamento = {
  /** % de EMBAIXADOR (recorrente) das lojas que ele indicou; null = não é embaixador. */
  embaixador?: number | null;
  lojasIndicadas?: number;
  /** % do cadastro: lojas do link de vendedor (commissionPercent) e atribuídas (sellerPercent); null = não é vendedor. */
  link: number | null;
  atribuida: number | null;
  lojasDoLink: number;
  lojasAtribuidas: number;
  previstoNoMes: number;
  recebidoNoMes: number;
  recebidoNoMesAnterior?: number | null;
  /** O que ele ganhou com disparo no período (3% da margem das recargas). */
  ganhoComDisparo?: number | null;
  /** Vendedor: "pacote de N mensagens → você ganha R$ X". */
  pacotes?: PacoteDoDisparo[];
  /** Só o admin: bruto e margem do disparo no período. */
  disparoDoAdmin?: { bruto: number; margem: number; estimado: boolean } | null;
  /** Só o admin: cadastro diferente do combinado. */
  divergencias?: string[];
  custoMeta?: number;
  rotulos?: { previsto: string; previstoSub: string; recebido: string };
};

export default function ComoVoceGanha({ d, modo, tema = "areia", embutido = false }: { d: DadosDoComissionamento; modo: "VENDEDOR" | "ADMIN"; tema?: "areia" | "admin"; embutido?: boolean }) {
  const dinheiro = useDinheiro();
  const ex = exemploDeComissao({ link: d.link, atribuida: d.atribuida }, d.custoMeta);
  const exEmbaixador = d.embaixador ? Math.round(ex.boleto * d.embaixador) / 100 : null;
  const ehVendedor = d.link !== null || d.atribuida !== null;
  const ehEmbaixador = d.embaixador !== null && d.embaixador !== undefined;
  const vend = modo === "VENDEDOR";
  const naCarteira = vend ? "na sua carteira" : "na carteira dele";
  const noAsaas = vend ? "na sua carteira do Asaas" : "na carteira do Asaas dele";
  const rotulos = d.rotulos ?? { previsto: "Previsto neste mês", previstoSub: "o ciclo de agora, se as lojas pagarem", recebido: "Já caiu neste mês" };

  const corpo = (
    <section className="pf-painel cg">
      <div className="pf-painel-cab">
        <div>
          <h3 className="pf-h"><Wallet size={17} aria-hidden /> Como {vend ? "você ganha" : "ele ganha"}</h3>
          <p className="pf-sub">Comissão é uma parte da conta que a loja paga ao FireHub todo mês — não das vendas da loja.{ehEmbaixador && ehVendedor ? " São dois papéis, cada um com a sua regra." : ""}</p>
        </div>
      </div>

      {!vend && d.divergencias && d.divergencias.length > 0 && (
        <div className="cg-aviso" role="note">
          <TriangleAlert size={16} aria-hidden />
          <div>
            <strong>Cadastro diferente do combinado ({COMISSAO_COMBINADA.LINK}% link / {COMISSAO_COMBINADA.ATRIBUIDA}% atribuída)</strong>
            {d.divergencias.map((t) => <p key={t}>{t}</p>)}
            <p>Os números desta tela são os que o boleto paga hoje.</p>
          </div>
        </div>
      )}

      {ehEmbaixador && (
        <>
          <h4 className="cg-papel">Como embaixador <span>recorrente</span></h4>
          <div className="cg-regras um">
            <div className="cg-regra">
              <span className="cg-icone emb"><Handshake size={18} aria-hidden /></span>
              <div>
                <div className="cg-pct">{d.embaixador}%</div>
                <strong>{vend ? "Lojas que você indicou" : "Lojas que ele indicou"}</strong>
                <p>Enquanto a loja estiver ativa e pagando — mesmo que outro vendedor atenda e mesmo {vend ? "se você deixar" : "se ele deixar"} a equipe de vendas. É o programa de indicação (autônomo). {d.lojasIndicadas ?? 0} {(d.lojasIndicadas ?? 0) === 1 ? "loja" : "lojas"} hoje.</p>
              </div>
            </div>
          </div>
        </>
      )}

      {ehVendedor && <h4 className="cg-papel">Como vendedor <span>enquanto atende</span></h4>}
      {ehVendedor && <div className="cg-regras">
        {d.link !== null && <div className="cg-regra">
          <span className="cg-icone link"><Link2 size={18} aria-hidden /></span>
          <div>
            <div className="cg-pct">{d.link === null ? "—" : `${d.link}%`}</div>
            <strong>{vend ? "Loja que veio pelo seu link" : "Loja que veio pelo link dele"}</strong>
            <p>Enquanto {vend ? "você atende" : "ele atende"} a loja e {vend ? "está" : "está"} na equipe. Se outro vendedor passar a atender, a comissão passa para quem atende. {d.lojasDoLink} {d.lojasDoLink === 1 ? "loja" : "lojas"} hoje.</p>
          </div>
        </div>}
        {d.atribuida !== null && <div className="cg-regra">
          <span className="cg-icone atrib"><UserPlus size={18} aria-hidden /></span>
          <div>
            <div className="cg-pct">{d.atribuida === null ? "—" : `${d.atribuida}%`}</div>
            <strong>{vend ? "Loja atribuída à sua carteira" : "Loja atribuída à carteira dele"}</strong>
            <p>A loja chegou pelo FireHub (anúncio, site{ehEmbaixador ? " ou indicação de outro" : ""}) e foi posta {naCarteira} para atender. {d.lojasAtribuidas} {d.lojasAtribuidas === 1 ? "loja" : "lojas"} hoje.</p>
          </div>
        </div>}
      </div>}

      <ul className="cg-como">
        <li><Info size={14} aria-hidden /><span><b>Sobre o quê:</b> o boleto do mês da loja — mensalidade (2% das vendas, mínimo R$ 100, máximo R$ 400) + os serviços cobrados nele (App, Bill, Multimarcas, totem, tráfego, lojas extras). O Asaas calcula sobre o valor líquido do boleto (depois da tarifa dele).</span></li>
        <li><Info size={14} aria-hidden /><span><b>Quando cai:</b> no dia em que a loja paga o boleto, direto {noAsaas} (split). Loja que não pagou não gera comissão; loja isenta ou em teste não tem boleto.</span></li>
        {ehVendedor && <li><MessageSquare size={14} aria-hidden /><span><b>Disparo oficial:</b> {vend
          ? <>{COMISSAO_COMBINADA.DISPARO}% em cada recarga de disparo das suas lojas, no Pix da recarga.{d.ganhoComDisparo ? <> Neste mês: <b>{dinheiro(d.ganhoComDisparo)}</b>.</> : null}</>
          : <>{COMISSAO_COMBINADA.DISPARO}% do LUCRO do FireHub em cada recarga das lojas que ele atende (valor − custo da Meta), em split de valor fixo no Pix.
            {d.disparoDoAdmin && d.disparoDoAdmin.bruto > 0 ? <> No período: {dinheiro(d.disparoDoAdmin.bruto)} em recargas, {dinheiro(d.disparoDoAdmin.margem)} de lucro{d.disparoDoAdmin.estimado ? " (custo estimado)" : ""}, {dinheiro(d.ganhoComDisparo || 0)} para ele.</> : null}</>}
        </span></li>}
        {ehVendedor && <li><DoorOpen size={14} aria-hidden /><span><b>Comissão de vendedor:</b> vale enquanto {vend ? "você trabalha" : "ele trabalha"} na equipe e atende a loja. Parou de atender, deixa de receber dela; saiu da equipe, deixa de receber as comissões de vendedor futuras (10% e 3%).{ehEmbaixador ? " As indicações de embaixador continuam." : ""}</span></li>}
      </ul>

      {vend && ehVendedor && d.pacotes && d.pacotes.length > 0 && (
        <div className="cg-pacotes">
          <strong>Disparo: quanto você ganha por recarga</strong>
          <table>
            <thead><tr><th>Pacote</th><th>Você ganha</th></tr></thead>
            <tbody>
              {d.pacotes.map((p) => <tr key={p.mensagens}><td>{p.mensagens.toLocaleString("pt-BR")} mensagens</td><td><b>{dinheiro(p.ganho)}</b></td></tr>)}
            </tbody>
          </table>
        </div>
      )}

      <div className="cg-numeros">
        <div><span className="pf-rotulo">{rotulos.previsto}</span><b>{dinheiro(d.previstoNoMes)}</b><small>{rotulos.previstoSub}</small></div>
        <div><span className="pf-rotulo">{rotulos.recebido}</span><b>{dinheiro(d.recebidoNoMes)}</b><small>boletos pagos</small></div>
        {d.recebidoNoMesAnterior !== undefined && d.recebidoNoMesAnterior !== null && (
          <div><span className="pf-rotulo">Mês passado</span><b>{dinheiro(d.recebidoNoMesAnterior)}</b><small>recebido</small></div>
        )}
      </div>

      <div className="cg-exemplo">
        <strong>Exemplo</strong>
        <p>
          Uma loja que vende {dinheiro(ex.faturamento)} no mês paga {dinheiro(ex.mensalidade)} de mensalidade + {dinheiro(ex.app)} do App = boleto de {dinheiro(ex.boleto)}.
          {exEmbaixador !== null && <> Indicada {vend ? "por você" : "por ele"}: <b>{dinheiro(exEmbaixador)}</b> ({d.embaixador}%, todo mês que a loja pagar).</>}
          {ex.link !== null && <> Pelo link de vendedor: <b>{dinheiro(ex.link)}</b> ({d.link}%).</>}
          {ex.atribuida !== null && <> Atribuída: <b>{dinheiro(ex.atribuida)}</b> ({d.atribuida}%).</>}
        </p>
        {!vend && ehVendedor && (
          <p>
            Recarga de {dinheiro(ex.recarga.valor)} ({ex.recarga.disparos} mensagens): a Meta cobra {dinheiro(ex.recarga.disparos * ex.recarga.custo)}, o lucro do FireHub é {dinheiro(ex.margem)} e o vendedor que atende leva {dinheiro(ex.disparo)} ({COMISSAO_COMBINADA.DISPARO}%).
          </p>
        )}
      </div>
    </section>
  );
  if (embutido) return corpo;
  return (
    <div className={`pf${tema === "admin" ? " pf-admin" : ""}`}>
      <style>{ESTILO_DO_PERFIL + ESTILO_DO_COMISSIONAMENTO}</style>
      {corpo}
    </div>
  );
}

export const ESTILO_DO_COMISSIONAMENTO = `
.cg-aviso { margin: 0 18px 12px; display: flex; gap: 10px; align-items: flex-start; padding: 11px 13px; border-radius: 12px; background: #FFF7ED; border: 1px solid #FED7AA; color: #7C2D12; font-size: 0.82rem; }
.cg-aviso p { margin: 3px 0 0; }
.cg-regras { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; padding: 0 18px 12px; }
.cg-regra { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 12px; align-items: start; border: 1px solid var(--pf-linha); border-radius: 14px; padding: 12px 14px; background: var(--pf-papel-2); }
.cg-icone { width: 38px; height: 38px; border-radius: 11px; display: grid; place-items: center; }
.cg-icone.link { background: #FBE3DA; color: #C92E09; } .cg-icone.atrib { background: #E3EBFD; color: #1D4ED8; } .cg-icone.emb { background: #EFE9FD; color: #6D28D9; }
.pf .cg-papel { margin: 2px 18px 8px; font-size: 0.78rem; font-weight: 800; text-transform: uppercase; letter-spacing: .05em; color: var(--pf-tinta-2); display: flex; gap: 8px; align-items: center; }
.cg-papel span { text-transform: none; letter-spacing: 0; font-weight: 700; font-size: 0.72rem; padding: 2px 8px; border-radius: 999px; background: var(--pf-neutro-bg); color: var(--pf-neutro); }
.cg-regras.um { grid-template-columns: minmax(0,1fr); }
.cg-pct { font-size: 1.6rem; font-weight: 900; letter-spacing: -0.02em; line-height: 1.05; }
.cg-regra strong { display: block; font-size: 0.88rem; margin-top: 2px; }
.cg-regra p { margin: 3px 0 0; font-size: 0.8rem; color: var(--pf-tinta-2); }
.cg-como { list-style: none; margin: 0; padding: 0 18px 12px; display: flex; flex-direction: column; gap: 6px; }
.cg-como li { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 8px; font-size: 0.82rem; color: var(--pf-tinta-2); align-items: start; }
.cg-como li svg { margin-top: 3px; color: var(--pf-cinza); }
.cg-pacotes { margin: 0 18px 12px; border: 1px solid var(--pf-linha); border-radius: 12px; padding: 10px 12px; background: var(--pf-papel); font-size: 0.82rem; }
.cg-pacotes table { width: 100%; border-collapse: collapse; margin-top: 6px; }
.cg-pacotes th { text-align: left; font-size: 0.7rem; color: var(--pf-cinza); text-transform: uppercase; letter-spacing: .04em; padding: 4px 0; }
.cg-pacotes td { padding: 5px 0; border-top: 1px dashed var(--pf-linha); font-variant-numeric: tabular-nums; }
.cg-pacotes th:last-child, .cg-pacotes td:last-child { text-align: right; }
.cg-numeros { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; padding: 0 18px 12px; }
.cg-numeros div { border: 1px solid var(--pf-linha); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; background: var(--pf-papel); }
.cg-numeros b { font-size: 1.2rem; font-variant-numeric: tabular-nums; }
.cg-numeros small { color: var(--pf-cinza); font-size: 0.74rem; }
.cg-exemplo { margin: 0 18px 16px; padding: 11px 13px; border-radius: 12px; background: var(--pf-papel-2); border: 1px dashed var(--pf-linha-forte); font-size: 0.82rem; color: var(--pf-tinta-2); }
.cg-exemplo p { margin: 4px 0 0; }
@media (max-width: 640px) {
  .cg-regras { grid-template-columns: 1fr; padding: 0 14px 12px; }
  .cg-como, .cg-numeros { padding-left: 14px; padding-right: 14px; }
  .cg-exemplo, .cg-aviso, .cg-pacotes, .pf .cg-papel { margin-left: 14px; margin-right: 14px; }
}
`;
