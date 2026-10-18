"use client";

/**
 * A linha do tempo da loja na gaveta do perfil (lib/perfil-da-loja/linha-do-tempo.ts):
 * o resumo do relacionamento no topo e a lista, mais recente primeiro, com
 * filtro por tipo. O vendedor vê resumos (sem o texto das conversas); o admin, tudo.
 */
import { useMemo, useState } from "react";
import { BellRing, CalendarClock, ClipboardList, Headset, Info, MessageCircle, NotebookPen, Bot, UserRoundCog, ArrowRightLeft } from "lucide-react";
import { ROTULO_DO_TIPO, type LinhaDoTempo as Linha, type TipoNaLinhaDoTempo } from "@/lib/perfil-da-loja/linha-do-tempo";

const ICONE: Record<TipoNaLinhaDoTempo, typeof Info> = {
  CONVERSA: MessageCircle, AJUDA: BellRing, REUNIAO: CalendarClock, NOTA: NotebookPen, ETAPA: ArrowRightLeft,
  VENDEDOR: UserRoundCog, CADASTRO: ClipboardList, ROBO: Bot,
};
const ORDEM: TipoNaLinhaDoTempo[] = ["CONVERSA", "AJUDA", "REUNIAO", "NOTA", "ETAPA", "VENDEDOR", "CADASTRO", "ROBO"];

export const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
const nomeDoCanal = (c: "WHATSAPP" | "PAINEL" | null) => (c === "PAINEL" ? "chat do painel" : "WhatsApp do FireHub");

/** O bloco "Relacionamento" (também no topo da visão geral do perfil). */
export function ResumoDoRelacionamento({ l, aoVerTudo }: { l: Linha; aoVerTudo?: () => void }) {
  return (
    <section className="pf-painel">
      <div className="pf-painel-cab">
        <div>
          <h3 className="pf-h"><Headset size={17} aria-hidden /> Relacionamento com a loja</h3>
          <p className="pf-sub">Do CRM do FireHub: WhatsApp do FireHub, chat do painel e agenda.{l.modo === "VENDEDOR" ? " As conversas aparecem em resumo; o texto fica com o administrador." : ""}</p>
        </div>
        {aoVerTudo && <button type="button" className="pf-botao pequeno" onClick={aoVerTudo}>Ver a linha do tempo</button>}
      </div>
      {l.semContato ? (
        <div className="pf-vazio">Esta loja ainda não tem contato ligado no CRM do FireHub — nenhuma conversa, pedido de ajuda ou reunião registrada.</div>
      ) : (
        <div className="lt-resumo">
          <div className={`lt-cartao${l.ajudaAberta ? " alerta" : ""}`}>
            <span className="pf-rotulo">Pedido de ajuda</span>
            <b>{l.ajudaAberta ? `Esperando desde ${quando(l.ajudaAberta.desde)}` : "Nenhum aberto"}</b>
            <small>{l.contagem.AJUDA} no histórico</small>
          </div>
          <div className="lt-cartao">
            <span className="pf-rotulo">Último atendimento</span>
            <b>{l.ultimoAtendimento ? quando(l.ultimoAtendimento.em) : "Nenhum registrado"}</b>
            <small>{l.ultimoAtendimento ? `por ${l.ultimoAtendimento.por} · ${nomeDoCanal(l.ultimoAtendimento.canal)}` : l.marcadoAtendidoEm ? `vendedor marcou "atendido" em ${quando(l.marcadoAtendidoEm)}` : "ninguém respondeu pessoalmente"}</small>
          </div>
          <div className="lt-cartao">
            <span className="pf-rotulo">Conversas</span>
            <b>{l.conversas.total} {l.conversas.total === 1 ? "mensagem" : "mensagens"}</b>
            <small>{l.conversas.daLoja} da loja · {l.conversas.doFireHub} do FireHub{l.conversas.peloPainel ? ` · ${l.conversas.peloPainel} pelo painel` : ""}</small>
          </div>
          <div className="lt-cartao">
            <span className="pf-rotulo">Reuniões</span>
            <b>{l.contagem.REUNIAO}</b>
            <small>{l.vendedorDaLoja ? `vendedor: ${l.vendedorDaLoja}` : "sem vendedor"}</small>
          </div>
          {l.reportou.length > 0 && (
            <div className="lt-reportou">
              <span className="pf-rotulo">O que a loja reportou</span>
              <ul>{l.reportou.slice(0, 4).map((r) => <li key={r.em + r.motivo}><b>{quando(r.em)}</b> {r.motivo}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default function LinhaDoTempo({ l }: { l: Linha }) {
  const [filtro, setFiltro] = useState<TipoNaLinhaDoTempo | "TODOS">("TODOS");
  const itens = useMemo(() => (filtro === "TODOS" ? l.itens : l.itens.filter((i) => i.tipo === filtro)), [l, filtro]);
  return (
    <div className="lt">
      <ResumoDoRelacionamento l={l} />
      <section className="pf-painel">
        <div className="pf-painel-cab">
          <div>
            <h3 className="pf-h"><ClipboardList size={17} aria-hidden /> Linha do tempo <small>{l.itens.length} registros, o mais recente primeiro</small></h3>
          </div>
          <div className="pf-chips" role="group" aria-label="Filtrar por tipo">
            <button type="button" className={`pf-chip${filtro === "TODOS" ? " on" : ""}`} onClick={() => setFiltro("TODOS")}>Tudo <span>{l.itens.length}</span></button>
            {ORDEM.filter((t) => l.contagem[t] > 0).map((t) => (
              <button key={t} type="button" className={`pf-chip${filtro === t ? " on" : ""}`} onClick={() => setFiltro(t)} aria-pressed={filtro === t}>{ROTULO_DO_TIPO[t]} <span>{l.contagem[t]}</span></button>
            ))}
          </div>
        </div>
        {itens.length === 0 ? <div className="pf-vazio">Nada registrado {filtro === "TODOS" ? "para esta loja" : `em ${ROTULO_DO_TIPO[filtro].toLowerCase()}`}.</div> : (
          <ol className="lt-lista">
            {itens.map((i) => {
              const Icone = ICONE[i.tipo];
              return (
                <li key={i.id} className={`lt-item t-${i.tipo}${i.direcao === "ENTRADA" ? " entrada" : ""}`}>
                  <span className="lt-icone"><Icone size={15} aria-hidden /></span>
                  <div className="lt-corpo">
                    <div className="lt-cab">
                      <strong>{i.titulo}</strong>
                      <span className="lt-tag">{ROTULO_DO_TIPO[i.tipo]}</span>
                      {i.canal && <span className="lt-tag leve">{nomeDoCanal(i.canal)}</span>}
                      <time>{quando(i.em)}</time>
                    </div>
                    {i.texto && <p>{i.texto}</p>}
                    {i.autor && i.tipo !== "CONVERSA" && <small>por {i.autor}</small>}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        <div className="lt-nota">
          <Info size={14} aria-hidden />
          <div>
            <b>O que não é registrado:</b>
            <ul>{l.naoRegistrado.map((t) => <li key={t}>{t}</li>)}</ul>
          </div>
        </div>
      </section>
    </div>
  );
}

export const ESTILO_DA_LINHA_DO_TEMPO = `
.lt { display: flex; flex-direction: column; gap: 14px; }
.lt-resumo { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; padding: 0 16px 16px; }
.lt-cartao { border: 1px solid var(--pf-linha-forte); border-radius: 12px; padding: 10px 12px; background: var(--pf-papel); display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.lt-cartao b { font-size: 0.95rem; }
.lt-cartao small { color: var(--pf-cinza); font-size: 0.74rem; }
.lt-cartao.alerta { border-color: #B91C1C; background: #FFF5F4; }
.lt-cartao.alerta b { color: #991B1B; }
.lt-reportou { grid-column: 1 / -1; border: 1px solid var(--pf-linha-forte); border-radius: 12px; padding: 10px 12px; background: var(--pf-papel); }
.lt-reportou ul { margin: 6px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font-size: 0.84rem; }
.lt-reportou b { font-variant-numeric: tabular-nums; margin-right: 6px; font-size: 0.76rem; color: var(--pf-cinza); }
.lt-lista { list-style: none; margin: 0; padding: 4px 16px 12px; position: relative; }
.lt-lista::before { content: ""; position: absolute; left: 31px; top: 8px; bottom: 16px; width: 2px; background: var(--pf-linha-forte); }
.lt-item { display: grid; grid-template-columns: 32px minmax(0,1fr); gap: 12px; padding: 8px 0; position: relative; }
.lt-icone { width: 32px; height: 32px; border-radius: 10px; display: grid; place-items: center; background: var(--pf-papel); border: 1.5px solid var(--pf-tinta-2); color: var(--pf-tinta); z-index: 1; }
.lt-item.t-AJUDA .lt-icone { border-color: #B91C1C; color: #B91C1C; background: #FFF5F4; }
.lt-corpo { border: 1px solid var(--pf-linha-forte); border-radius: 12px; background: var(--pf-papel); padding: 9px 12px; min-width: 0; }
.lt-item.entrada .lt-corpo { background: var(--pf-papel-2); }
.lt-cab { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; }
.lt-cab strong { font-size: 0.88rem; }
.lt-cab time { margin-left: auto; font-size: 0.74rem; color: var(--pf-cinza); font-variant-numeric: tabular-nums; white-space: nowrap; }
.lt-tag { font-size: 0.68rem; font-weight: 800; padding: 1px 7px; border-radius: 999px; background: var(--pf-tinta); color: #fff; text-transform: uppercase; letter-spacing: .03em; }
.lt-tag.leve { background: var(--pf-neutro-bg); color: var(--pf-tinta-2); text-transform: none; letter-spacing: 0; }
.lt-corpo p { margin: 5px 0 0; font-size: 0.84rem; color: var(--pf-tinta); white-space: pre-wrap; overflow-wrap: anywhere; }
.lt-corpo small { display: block; margin-top: 4px; color: var(--pf-cinza); font-size: 0.74rem; }
.lt-nota { display: flex; gap: 8px; margin: 4px 16px 16px; padding: 10px 12px; border-radius: 10px; background: var(--pf-papel-2); border: 1px dashed var(--pf-linha-forte); font-size: 0.78rem; color: var(--pf-tinta-2); }
.lt-nota ul { margin: 4px 0 0; padding-left: 16px; }
@media (max-width: 640px) {
  .lt-resumo { grid-template-columns: repeat(2, minmax(0,1fr)); padding: 0 12px 12px; }
  .lt-lista { padding: 4px 12px 12px; }
  .lt-lista::before { left: 27px; }
  .lt-cab time { margin-left: 0; width: 100%; }
}
`;
