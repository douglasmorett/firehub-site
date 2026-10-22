"use client";

import { useEffect, useState } from "react";
import { ArrowRight, Bell, CheckCircle2, Download, Minus, Send, ShoppingBag, Sparkles, TrendingDown, TrendingUp, Users, Wallet } from "lucide-react";
import { Sparkline, Tendencia, Variacao } from "./graficos";
import { ROTULO_DO_PERIODO, data, diaCurto, inteiro, pct, reais, reaisCurto, type Dados, type Destaque } from "./tipos";

const CHAVE_DA_TAXA = "meu-aplicativo:taxa-marketplace";

/** A taxa de marketplace que a loja paga (estimativa editável, guardada neste navegador). */
export function useTaxaDeMarketplace(padrao: number): [number, (n: number) => void] {
  const [taxa, setTaxa] = useState(padrao);
  useEffect(() => {
    try { const v = Number(localStorage.getItem(CHAVE_DA_TAXA)); if (v > 0 && v <= 50) setTaxa(v); } catch {}
  }, []);
  const mudar = (n: number) => {
    const v = Math.min(50, Math.max(0, Math.round(n * 10) / 10));
    setTaxa(v);
    try { localStorage.setItem(CHAVE_DA_TAXA, String(v)); } catch {}
  };
  return [taxa, mudar];
}

export function IconeDoDestaque({ d }: { d: Destaque }) {
  return (
    <span className="ma-destaque-icone">
      {d.tipo === "ganha" ? <TrendingUp size={18} /> : d.tipo === "perde" ? <TrendingDown size={18} /> : <Sparkles size={18} />}
    </span>
  );
}

export function CartaoSePagou({ dados, compacto = false }: { dados: Dados; compacto?: boolean }) {
  const p = dados.painel;
  const [taxa, setTaxa] = useTaxaDeMarketplace(dados.regras.taxaMarketplacePadrao);
  const app = p.canais.find((c) => c.canal === "APP")!;
  const economia = Math.round(app.faturamento * taxa) / 100;
  const plano = Math.round(dados.plano.valor * p.periodo.dias / 30 * 100) / 100;
  const vezes = plano > 0 ? economia / plano : null;
  return (
    <div className="ma-cartao">
      <h2><Wallet size={18} /> O app já se pagou?</h2>
      <p className="ma-cartao-sub">Se esses pedidos tivessem vindo por um marketplace, a comissão sairia do seu bolso. Estimativa com a taxa que você informar.</p>
      <div className="ma-pagou">
        <div className="ma-pagou-x">
          {vezes == null ? "—" : `${vezes.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}×`}
          <small>{vezes != null && vezes >= 1 ? "O PLANO SE PAGOU" : "DO VALOR DO PLANO"}</small>
        </div>
        <div className="ma-pagou-linhas">
          <div>Vendido pelo app em {ROTULO_DO_PERIODO[p.periodo.chave].toLowerCase()}: <b>{reais(app.faturamento)}</b></div>
          <div>Comissão que você <b>não</b> pagou ({taxa.toLocaleString("pt-BR")}%): <b>{reais(economia)}</b></div>
          <div>Plano do app no mesmo período: <b>{reais(plano)}</b>{dados.plano.valor ? <span style={{ color: "#94A3B8" }}> ({reais(dados.plano.valor)}/mês ÷ 30 × {p.periodo.dias} dias)</span> : null}</div>
          <div className="ma-comparo" aria-hidden>
            <div><span>Comissão evitada</span><i style={{ width: "100%", background: "#CA8A04" }} /><b>{reais(economia)}</b></div>
            <div><span>Plano do app</span><i style={{ width: `${economia > 0 ? Math.max(2, Math.min(100, (plano / economia) * 100)) : 100}%`, background: "#94A3B8" }} /><b>{reais(plano)}</b></div>
          </div>
          {!compacto && (
            <label className="ma-taxa">
              Taxa média do seu marketplace:
              <input type="number" min={0} max={50} step={0.5} value={taxa} onChange={(e) => setTaxa(Number(e.target.value))} aria-label="Taxa do marketplace em %" />%
              <span style={{ color: "#94A3B8" }}>(iFood: 12% no Básico, 23% no Entrega, + 3,2% do pagamento online)</span>
            </label>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AbaVisaoGeral({ dados, irPara }: { dados: Dados; irPara: (aba: "resultados" | "notificacoes") => void }) {
  const p = dados.painel;
  const { base } = p;
  const app = p.canais.find((c) => c.canal === "APP")!;
  const appAnt = p.canaisAnterior.find((c) => c.canal === "APP")!;
  const dias = p.serie.map((d) => d.dia);
  const rotuloPeriodo = ROTULO_DO_PERIODO[p.periodo.chave].toLowerCase();
  const destaques = p.destaques.filter((d) => d.tipo !== "neutro").slice(0, 3);
  const n = p.notificacoes.resumo30;

  return (
    <div className="ma-pilha">
      {!p.temAberturas && (
        <div className="ma-nota">
          <b>Os números de “ativos” começam quando os clientes abrirem a versão nova do app</b> — ela chega sozinha na próxima vez que cada
          cliente abrir o aplicativo. Até lá, a base mostra quem já pediu pelo app.
        </div>
      )}

      <section className="ma-hero" aria-label="Seu app agora">
        <div className="ma-hero-item">
          <div className="ma-hero-rotulo"><span className="ma-pulso" aria-hidden /> Com o app aberto agora</div>
          <div className="ma-hero-valor ouro">{inteiro(base.ativosAgora)}</div>
          <div className="ma-hero-det">nos últimos {dados.regras.ativoAgoraMin} minutos · atualiza sozinho</div>
          <Sparkline valores={p.serie.map((d) => d.aberturas)} cor="#FACC15" />
        </div>
        <div className="ma-hero-item">
          <div className="ma-hero-rotulo"><Download size={14} /> Clientes com o app</div>
          <div className="ma-hero-valor">{inteiro(base.instalacoes)}</div>
          <div className="ma-hero-det">+{inteiro(base.novosNoMes)} este mês</div>
        </div>
        <div className="ma-hero-item">
          <div className="ma-hero-rotulo"><Users size={14} /> Usaram em 30 dias</div>
          <div className="ma-hero-valor">{inteiro(base.ativos30)}</div>
          <div className="ma-hero-det">{inteiro(base.ativos7)} nos últimos 7 dias</div>
        </div>
        <div className="ma-hero-item">
          <div className="ma-hero-rotulo"><Bell size={14} /> Recebem notificação</div>
          <div className="ma-hero-valor">{inteiro(base.recebemNotificacao)}</div>
          <div className="ma-hero-det">{base.instalacoes ? `${pct(base.recebemNotificacao / base.instalacoes)} da base` : "pedido e promoções"}</div>
        </div>
        <div className="ma-hero-rodape">
          <span><b>{inteiro(base.semPermissao)}</b> não permitiram notificação no celular</span>
          {base.recusaramNaTelaAntiga > 0 && (
            <span title="Tocaram “Agora não” na tela de promoções da versão anterior do app: recebem só os avisos do pedido.">
              <b>{inteiro(base.recusaramNaTelaAntiga)}</b> recusaram promoção na versão anterior
            </span>
          )}
          {base.aguardandoTermo + base.versaoAntiga > 0 && (
            <span><b>{inteiro(base.aguardandoTermo + base.versaoAntiga)}</b> passam a receber quando abrirem a versão nova do app</span>
          )}
          <span className="ma-hero-explica">Para usar o app, o cliente precisa permitir a notificação. No Android o app não abre sem ela; no iPhone a Apple exige deixar continuar, então o app pede de novo a cada abertura.</span>
        </div>
      </section>

      <div className="ma-grade">
        <div className="ma-kpi app">
          <div className="ma-kpi-rotulo"><TrendingUp size={14} /> Faturamento pelo app</div>
          <div className="ma-kpi-valor">{reais(app.faturamento)}</div>
          <Variacao atual={app.faturamento} anterior={appAnt.faturamento} />
        </div>
        <div className="ma-kpi app">
          <div className="ma-kpi-rotulo"><ShoppingBag size={14} /> Pedidos pelo app</div>
          <div className="ma-kpi-valor">{inteiro(app.pedidos)}</div>
          <Variacao atual={app.pedidos} anterior={appAnt.pedidos} />
        </div>
        <div className="ma-kpi app">
          <div className="ma-kpi-rotulo"><Wallet size={14} /> Ticket médio do app</div>
          <div className="ma-kpi-valor">{app.pedidos ? reais(app.ticketMedio) : "—"}</div>
          <Variacao atual={app.ticketMedio} anterior={appAnt.ticketMedio} />
        </div>
        <div className="ma-kpi app">
          <div className="ma-kpi-rotulo"><Sparkles size={14} /> Das suas vendas, pelo app</div>
          <div className="ma-kpi-valor">{pct(app.participacao, 1)}</div>
          <Variacao atual={app.participacao} anterior={appAnt.participacao} />
        </div>
      </div>

      <div className="ma-cartao">
        <h2><TrendingUp size={18} /> Faturamento pelo app, dia a dia</h2>
        <p className="ma-cartao-sub">
          {diaCurto(p.periodo.de)} a {diaCurto(p.periodo.ate)} contra {diaCurto(p.periodo.anteriorDe)} a {diaCurto(p.periodo.anteriorAte)} (tracejado).
          Mesma régua dos Relatórios: sem cancelados, o dia vira às 5h{dados.unidades.length > 1 ? ", todas as unidades" : ""}.
        </p>
        <Tendencia
          atual={p.serie.map((d) => d.app)}
          anterior={p.serieAnterior.map((d) => d.app)}
          dias={dias}
          formato={reais}
          formatoEixo={reaisCurto}
          rotuloAtual={`Este período (${rotuloPeriodo})`}
          rotuloAnterior="Período anterior"
          vazio="Nenhum pedido pelo app neste período ainda."
        />
      </div>

      <div className="ma-grade-2">
        <CartaoSePagou dados={dados} compacto />
        <div className="ma-cartao">
          <h2><CheckCircle2 size={18} /> O que o app faz pela sua loja</h2>
          <p className="ma-cartao-sub">Comparado com o seu site pelo navegador, no mesmo período. Só aparece o que os números mostram.</p>
          {destaques.length ? (
            <div className="ma-destaques">
              {destaques.map((d) => (
                <div key={d.titulo} className={`ma-destaque ${d.tipo}`}>
                  <IconeDoDestaque d={d} />
                  <div><b>{d.titulo}</b><span>{d.detalhe}</span>{d.acao && <span className="ma-acao">→ {d.acao}</span>}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="ma-vazio">
              <div className="ma-vazio-icone"><Minus size={20} /></div>
              <b>Ainda sem comparação segura</b>
              Precisamos de pelo menos 10 pedidos pelo app e 10 pelo site no período para comparar ticket, frequência e retorno.
            </div>
          )}
          <button className="ma-link" style={{ marginTop: 12 }} onClick={() => irPara("resultados")}>Ver todos os canais <ArrowRight size={13} style={{ verticalAlign: -2 }} /></button>
        </div>
      </div>

      <div className="ma-grade-2">
        <div className="ma-cartao">
          <h2><Users size={18} /> Aparelhos que abriram o app</h2>
          <p className="ma-cartao-sub">Cada celular conta uma vez por dia.</p>
          <Tendencia
            atual={p.serie.map((d) => d.aberturas)}
            anterior={p.serieAnterior.map((d) => d.aberturas)}
            dias={dias}
            formato={(v) => `${inteiro(Math.round(v))} aparelhos`}
            formatoEixo={(v) => inteiro(Math.round(v))}
            cor="#2563EB"
            altura={180}
            rotuloAtual="Este período"
            vazio="Os acessos aparecem quando os clientes abrirem a versão nova do app."
          />
        </div>
        <div className="ma-cartao">
          <h2><Send size={18} /> Notificações nos últimos 30 dias</h2>
          <p className="ma-cartao-sub">De graça, direto no celular de quem tem o app e permitiu notificação.</p>
          {n.envios ? (
            <div className="ma-envio-numeros" style={{ marginTop: 0 }}>
              <div className="ma-envio-num"><span>Enviadas</span><b>{inteiro(n.envios)}</b></div>
              <div className="ma-envio-num"><span>Abertas</span><b>{inteiro(n.abertos)}</b><small>{n.entregues ? pct(n.abertos / n.entregues, 1) : ""}</small></div>
              <div className="ma-envio-num bom"><span>Pedidos em 24 h</span><b>{inteiro(n.pedidos)}</b></div>
              <div className="ma-envio-num bom"><span>Vendido</span><b>{reaisCurto(n.faturamento)}</b></div>
            </div>
          ) : (
            <div className="ma-vazio" style={{ padding: "12px 0" }}>
              <b>Nenhuma notificação ainda</b>
              {inteiro(p.notificacoes.segmentos.todos || 0)} clientes já podem receber. Uma boa primeira: o mais pedido do app, uma hora antes do pico.
            </div>
          )}
          <button className="ma-botao marca" style={{ marginTop: 14 }} onClick={() => irPara("notificacoes")}><Send size={16} /> Mandar notificação</button>
        </div>
      </div>

      <div className="ma-cartao">
        <h2><CheckCircle2 size={18} /> Seu plano</h2>
        <div className="ma-plano">
          <div><span>Plano</span><b>{dados.plano.rotulo || "—"}</b></div>
          <div><span>Ativo desde</span><b>{data(dados.plano.ativoDesde)}</b></div>
          <div><span>Mensalidade</span><b>{dados.plano.valor ? `${reais(dados.plano.valor)}/mês` : "—"}</b></div>
          <div><span>Cobrança</span><b>No boleto, junto com a mensalidade do FireHub</b></div>
        </div>
      </div>
    </div>
  );
}
