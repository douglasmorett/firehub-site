"use client";

import { Clock, GitCompareArrows, LayoutGrid, Store, TrendingUp, UserCheck } from "lucide-react";
import { BarrasPorCanal, MapaDeCalor, Tendencia, Variacao } from "./graficos";
import { CartaoSePagou, IconeDoDestaque } from "./AbaVisaoGeral";
import { CANAIS, COR_DO_CANAL, ROTULO_DO_CANAL, diaCurto, inteiro, pct, reais, reaisCurto, type CanalDoApp, type Dados } from "./tipos";

export default function AbaResultados({ dados }: { dados: Dados }) {
  const p = dados.painel;
  const ant = (c: CanalDoApp) => p.canaisAnterior.find((x) => x.canal === c)!;
  const canais = CANAIS.map((c) => p.canais.find((x) => x.canal === c)!).filter((c) => c.pedidos > 0 || ant(c.canal).pedidos > 0 || c.canal === "APP");
  const maxPart = Math.max(0.0001, ...canais.map((c) => c.participacao));

  // Por dia até 31 dias; por semana em 90 dias (a barra fica legível).
  const porSemana = p.serie.length > 31;
  const colunas: { rotulo: string; valores: Record<CanalDoApp, number> }[] = [];
  const passo = porSemana ? 7 : 1;
  for (let i = 0; i < p.serie.length; i += passo) {
    const fatia = p.serie.slice(i, i + passo);
    const valores = Object.fromEntries(CANAIS.map((c) => [c, fatia.reduce((s, d) => s + (d.porCanal[c] || 0), 0)])) as Record<CanalDoApp, number>;
    colunas.push({ rotulo: diaCurto(fatia[0].dia), valores });
  }
  const ad = p.antesDepois;
  const h = p.horario;

  return (
    <div className="ma-pilha">
      <div className="ma-cartao">
        <h2><GitCompareArrows size={18} /> O app contra os outros canais</h2>
        <p className="ma-cartao-sub">
          {diaCurto(p.periodo.de)} a {diaCurto(p.periodo.ate)}. Venda pela régua dos Relatórios (mesa conta uma vez, sem cancelados).
          Clientes pelo telefone do pedido. Retorno = fez outro pedido, em qualquer canal, até 30 dias depois do primeiro.
        </p>
        <table className="ma-tabela">
          <thead>
            <tr>
              <th>Canal</th><th>Pedidos</th><th>Faturamento</th><th>% do total</th><th>Ticket médio</th><th>Clientes</th><th>Pedidos/cliente</th><th>Voltam em 30 dias</th>
            </tr>
          </thead>
          <tbody>
            {canais.map((c) => (
              <tr key={c.canal} className={c.canal === "APP" ? "app" : ""}>
                <td><span className="ma-canal"><i style={{ background: COR_DO_CANAL[c.canal] }} />{ROTULO_DO_CANAL[c.canal]}</span></td>
                <td data-rotulo="Pedidos">{inteiro(c.pedidos)}</td>
                <td data-rotulo="Faturamento"><span>{reais(c.faturamento)} <Variacao atual={c.faturamento} anterior={ant(c.canal).faturamento} sufixo="" /></span></td>
                <td data-rotulo="% do total"><span>{pct(c.participacao, 1)}<span className="ma-barrinha"><b style={{ width: `${(c.participacao / maxPart) * 100}%`, background: COR_DO_CANAL[c.canal] }} /></span></span></td>
                <td data-rotulo="Ticket médio">{c.pedidos ? reais(c.ticketMedio) : "—"}</td>
                <td data-rotulo="Clientes">{inteiro(c.clientes)}</td>
                <td data-rotulo="Pedidos por cliente">{c.frequencia != null ? c.frequencia.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—"}</td>
                <td data-rotulo="Voltam em 30 dias" title={c.recorrencia == null ? "Poucos clientes com a janela de 30 dias fechada" : `${c.recorrenciaBase} clientes na conta`}>{pct(c.recorrencia)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="ma-explica">Total da loja no período: <b>{inteiro(p.total.pedidos)}</b> pedidos, <b>{reais(p.total.faturamento)}</b>, ticket {reais(p.total.ticketMedio)}.</div>
      </div>

      {p.destaques.length > 0 && (
        <div className="ma-cartao">
          <h2><TrendingUp size={18} /> O que os números dizem</h2>
          <p className="ma-cartao-sub">Comparações com pelo menos 10 pedidos de cada lado. Diferença menor que 5% não vira frase.</p>
          <div className="ma-destaques">
            {p.destaques.map((d) => (
              <div key={d.titulo} className={`ma-destaque ${d.tipo}`}>
                <IconeDoDestaque d={d} />
                <div><b>{d.titulo}</b><span>{d.detalhe}</span>{d.acao && <span className="ma-acao">→ {d.acao}</span>}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="ma-cartao">
        <h2><LayoutGrid size={18} /> Faturamento por canal{porSemana ? ", semana a semana" : ", dia a dia"}</h2>
        <p className="ma-cartao-sub">Quanto de cada {porSemana ? "semana" : "dia"} veio de cada canal. O amarelo é o seu app.</p>
        <BarrasPorCanal colunas={colunas} formato={reaisCurto} />
      </div>

      <div className="ma-grade-2">
        <div className="ma-cartao">
          <h2><UserCheck size={18} /> Quem instalou passou a pedir mais?</h2>
          <p className="ma-cartao-sub">
            O mesmo cliente (pelo telefone), em todos os canais: os dias antes de instalar contra o mesmo número de dias depois (até 60), por mês.
          </p>
          {ad.clientes >= 3 ? (
            <>
              <div className="ma-ad">
                <div className="ma-ad-col">
                  <h3>Antes do app</h3>
                  <div className="ma-ad-num">{ad.pedidosMesAntes.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}<small>pedidos/mês</small></div>
                  <div className="ma-ad-num" style={{ fontSize: "1.05rem", marginTop: 4 }}>{reais(ad.gastoMesAntes)}<small>/mês</small></div>
                </div>
                <div className="ma-ad-col depois">
                  <h3>Depois do app</h3>
                  <div className="ma-ad-num">{ad.pedidosMesDepois.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}<small>pedidos/mês</small></div>
                  <div className="ma-ad-num" style={{ fontSize: "1.05rem", marginTop: 4 }}>{reais(ad.gastoMesDepois)}<small>/mês</small></div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <Variacao atual={ad.pedidosMesDepois} anterior={ad.pedidosMesAntes} sufixo="pedidos por cliente" />
                <Variacao atual={ad.gastoMesDepois} anterior={ad.gastoMesAntes} sufixo="gasto por cliente" />
              </div>
              <div className="ma-explica">
                Conta: {inteiro(ad.clientes)} clientes que pediram pelo app e instalaram há 14 dias ou mais; janela média de {ad.janelaMediaDias} dias de cada lado.
                {ad.novos > 0 && ` ${inteiro(ad.novos)} deles não tinham pedido nenhum antes — chegaram pelo app.`} É comparação, não prova de que o app causou a diferença
                (o primeiro pedido pelo app entra no “depois”).
              </div>
            </>
          ) : (
            <div className="ma-vazio">
              <div className="ma-vazio-icone"><UserCheck size={20} /></div>
              <b>Precisa de um pouco mais de tempo</b>
              A conta usa clientes que instalaram há pelo menos 14 dias e já pediram pelo app ({inteiro(ad.clientes)} até agora; precisa de 3).
            </div>
          )}
        </div>
        <div className="ma-cartao">
          <h2><TrendingUp size={18} /> Quanto das suas vendas vem do app</h2>
          <p className="ma-cartao-sub">Semana a semana, desde a ativação.</p>
          {p.semanal.length >= 2 ? (
            <Tendencia
              atual={p.semanal.map((s) => s.participacao * 100)}
              dias={p.semanal.map((s) => s.inicio)}
              formato={(v) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}
              cor="#CA8A04"
              altura={200}
              rotuloAtual="% do faturamento pelo app"
            />
          ) : (
            <div className="ma-vazio">
              <div className="ma-vazio-icone"><TrendingUp size={20} /></div>
              <b>A curva aparece na 2ª semana</b>
              Cada ponto é uma semana desde que o app foi ativado.
            </div>
          )}
        </div>
      </div>

      <div className="ma-cartao">
        <h2><Clock size={18} /> Quando seus clientes pedem pelo app</h2>
        <p className="ma-cartao-sub">
          Pedidos pelo app nos últimos 90 dias, por dia da semana e hora.
          {h && <> Pico às <b>{h.pico}h</b>; o melhor horário para notificar é <b>{h.enviar}h</b> (uma hora antes). Dia mais forte: <b>{h.diaForte}</b>; mais fraco: <b>{h.diaFraco}</b>.</>}
        </p>
        <MapaDeCalor calor={p.calor} destaqueHora={h?.enviar} />
      </div>

      {p.porUnidade.length > 1 && (
        <div className="ma-cartao">
          <h2><Store size={18} /> Por unidade</h2>
          <p className="ma-cartao-sub">A base do app é da marca; aqui, quanto cada unidade vendeu pelo app no período.</p>
          <table className="ma-tabela">
            <thead><tr><th>Unidade</th><th>Pedidos pelo app</th><th>Faturamento pelo app</th><th>% da unidade</th></tr></thead>
            <tbody>
              {p.porUnidade.map((u) => (
                <tr key={u.id}>
                  <td>{u.nome}</td>
                  <td data-rotulo="Pedidos pelo app">{inteiro(u.pedidosApp)}</td>
                  <td data-rotulo="Faturamento pelo app">{reais(u.faturamentoApp)}</td>
                  <td data-rotulo="% da unidade">{u.faturamentoTotal ? pct(u.faturamentoApp / u.faturamentoTotal, 1) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CartaoSePagou dados={dados} />
    </div>
  );
}
