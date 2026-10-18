"use client";

/**
 * COMO VOCÊ GANHA — o comissionamento do vendedor explicado (Douglas,
 * 18/10/2026): "quem veio pelo link dele garante 10% de comissão; quem veio
 * jogado na carteira dele mantém os 3%. Tudo isso tem que ficar bem explicado
 * no comissionamento dele."
 *
 * Os percentuais mostrados são os do CADASTRO (o que o split do boleto paga de
 * verdade — lib/billing.ts e lib/parceiro/regras.ts). O admin vê também o
 * combinado e o aviso quando o cadastro diverge; o vendedor vê só o que recebe.
 * Aparece no portal do vendedor (Meus números) e no detalhe da carteira no admin.
 */
import { Link2, UserPlus, Wallet, Info, TriangleAlert, MessageSquare } from "lucide-react";
import { useDinheiro } from "@/components/parceiro/ValoresOcultos";
import { COMISSAO_COMBINADA, exemploDeComissao } from "@/lib/performance-das-carteiras/regras";
import { ESTILO_DO_PERFIL } from "./estilo";

export type DadosDoComissionamento = {
  /** % do cadastro: lojas do link de convite (commissionPercent) e atribuídas (sellerPercent). */
  link: number | null;
  atribuida: number | null;
  lojasDoLink: number;
  lojasAtribuidas: number;
  /** Comissão prevista do mês corrente (ciclo aberto) e o que já caiu. */
  previstoNoMes: number;
  recebidoNoMes: number;
  recebidoNoMesAnterior?: number | null;
  /** Comissão sobre a margem do disparo no período (calculada; ainda não sai no split). */
  comissaoDoDisparo?: number | null;
  /** Só o admin: cadastro diferente do combinado. */
  divergencias?: string[];
  custoMeta?: number;
  /** Os rótulos dos números (o admin mostra o período escolhido, não o mês). */
  rotulos?: { previsto: string; previstoSub: string; recebido: string };
};

export default function ComoVoceGanha({ d, modo, tema = "areia", embutido = false }: { d: DadosDoComissionamento; modo: "VENDEDOR" | "ADMIN"; tema?: "areia" | "admin"; embutido?: boolean }) {
  const dinheiro = useDinheiro();
  const ex = exemploDeComissao({ link: d.link, atribuida: d.atribuida }, d.custoMeta);
  const naCarteira = modo === "VENDEDOR" ? "na sua carteira" : "na carteira dele";
  const noAsaas = modo === "VENDEDOR" ? "na sua carteira do Asaas" : "na carteira do Asaas dele";
  const rotulos = d.rotulos ?? { previsto: "Previsto neste mês", previstoSub: "o ciclo de agora, se as lojas pagarem", recebido: "Já caiu neste mês" };
  const corpo = (
    <section className="pf-painel cg">
      <div className="pf-painel-cab">
        <div>
          <h3 className="pf-h"><Wallet size={17} aria-hidden /> Como {modo === "VENDEDOR" ? "você ganha" : "ele ganha"}</h3>
          <p className="pf-sub">Comissão é uma parte da conta que a loja paga ao FireHub todo mês — não das vendas da loja.</p>
        </div>
      </div>

      {modo === "ADMIN" && d.divergencias && d.divergencias.length > 0 && (
        <div className="cg-aviso" role="note">
          <TriangleAlert size={16} aria-hidden />
          <div>
            <strong>Cadastro diferente do combinado ({COMISSAO_COMBINADA.LINK}% link / {COMISSAO_COMBINADA.ATRIBUIDA}% atribuída)</strong>
            {d.divergencias.map((t) => <p key={t}>{t}</p>)}
            <p>Os números desta tela são os que o boleto paga hoje.</p>
          </div>
        </div>
      )}

      <div className="cg-regras">
        <div className="cg-regra">
          <span className="cg-icone link"><Link2 size={18} aria-hidden /></span>
          <div>
            <div className="cg-pct">{d.link === null ? "—" : `${d.link}%`}</div>
            <strong>{modo === "VENDEDOR" ? "Loja que veio pelo seu link" : "Loja que veio pelo link dele"}</strong>
            <p>A loja se cadastra pelo link de convite e fica {naCarteira}. {d.lojasDoLink} {d.lojasDoLink === 1 ? "loja" : "lojas"} hoje.</p>
          </div>
        </div>
        <div className="cg-regra">
          <span className="cg-icone atrib"><UserPlus size={18} aria-hidden /></span>
          <div>
            <div className="cg-pct">{d.atribuida === null ? "—" : `${d.atribuida}%`}</div>
            <strong>{modo === "VENDEDOR" ? "Loja atribuída à sua carteira" : "Loja atribuída à carteira dele"}</strong>
            <p>A loja chegou pelo FireHub (anúncio, site) e foi posta {naCarteira} para atender. {d.lojasAtribuidas} {d.lojasAtribuidas === 1 ? "loja" : "lojas"} hoje.</p>
          </div>
        </div>
      </div>

      <ul className="cg-como">
        <li><Info size={14} aria-hidden /><span><b>Sobre o quê:</b> o boleto do mês da loja — mensalidade (2% das vendas, mínimo R$ 100, máximo R$ 400) + os serviços cobrados nele (App, Bill, Multimarcas, totem, tráfego, lojas extras). O Asaas calcula sobre o valor líquido do boleto (depois da tarifa dele).</span></li>
        <li><Info size={14} aria-hidden /><span><b>Quando cai:</b> no dia em que a loja paga o boleto, direto {noAsaas} (split). Loja que não pagou não gera comissão; loja isenta ou em teste não tem boleto.</span></li>
        <li><MessageSquare size={14} aria-hidden /><span><b>Disparo oficial:</b> conta sobre o LUCRO do FireHub na recarga (valor − custo da Meta), não sobre o valor cheio. A recarga é um Pix à parte: essa parte ainda não cai sozinha no split{d.comissaoDoDisparo ? ` (${dinheiro(d.comissaoDoDisparo)} no período, calculado)` : ""}.</span></li>
      </ul>

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
          {ex.link !== null && <> Pelo link: <b>{dinheiro(ex.link)}</b> ({d.link}%).</>}
          {ex.atribuida !== null && <> Atribuída: <b>{dinheiro(ex.atribuida)}</b> ({d.atribuida}%).</>}
        </p>
        <p>
          Recarga de disparo de {dinheiro(ex.recarga.valor)} ({ex.recarga.disparos} mensagens): a Meta cobra {dinheiro(ex.recarga.disparos * ex.recarga.custo)}, o lucro do FireHub é {dinheiro(ex.margem)}
          {ex.linkDisparo !== null && <> — pelo link, {dinheiro(ex.linkDisparo)}</>}{ex.atribuidaDisparo !== null && <>; atribuída, {dinheiro(ex.atribuidaDisparo)}</>}.
        </p>
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
.cg-icone.link { background: #EFE9FD; color: #6D28D9; } .cg-icone.atrib { background: #E3EBFD; color: #1D4ED8; }
.cg-pct { font-size: 1.6rem; font-weight: 900; letter-spacing: -0.02em; line-height: 1.05; }
.cg-regra strong { display: block; font-size: 0.88rem; margin-top: 2px; }
.cg-regra p { margin: 3px 0 0; font-size: 0.8rem; color: var(--pf-tinta-2); }
.cg-como { list-style: none; margin: 0; padding: 0 18px 12px; display: flex; flex-direction: column; gap: 6px; }
.cg-como li { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 8px; font-size: 0.82rem; color: var(--pf-tinta-2); align-items: start; }
.cg-como li svg { margin-top: 3px; color: var(--pf-cinza); }
.cg-numeros { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; padding: 0 18px 12px; }
.cg-numeros div { border: 1px solid var(--pf-linha); border-radius: 12px; padding: 10px 12px; display: flex; flex-direction: column; gap: 2px; background: var(--pf-papel); }
.cg-numeros b { font-size: 1.2rem; font-variant-numeric: tabular-nums; }
.cg-numeros small { color: var(--pf-cinza); font-size: 0.74rem; }
.cg-exemplo { margin: 0 18px 16px; padding: 11px 13px; border-radius: 12px; background: var(--pf-papel-2); border: 1px dashed var(--pf-linha-forte); font-size: 0.82rem; color: var(--pf-tinta-2); }
.cg-exemplo p { margin: 4px 0 0; }
@media (max-width: 640px) {
  .cg-regras { grid-template-columns: 1fr; padding: 0 14px 12px; }
  .cg-como, .cg-numeros { padding-left: 14px; padding-right: 14px; }
  .cg-exemplo, .cg-aviso { margin-left: 14px; margin-right: 14px; }
}
`;
