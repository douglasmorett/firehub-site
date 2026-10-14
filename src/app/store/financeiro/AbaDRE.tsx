"use client";
/**
 * A aba DRE Geral: cartões, o demonstrativo e o que falta para o resultado ser
 * o lucro de verdade. A conta é toda de lib/financeiro/dre.ts — aqui só se
 * desenha.
 */
import { useState } from "react";
import { BarChart2, DollarSign, Package, ShoppingBag, TrendingUp, Truck, Users } from "lucide-react";
import AjudaModulo from "@/components/AjudaModulo";
import DespesasLancadas, { type DespesaDTO } from "./DespesasLancadas";
import { DRERow, KPICard, TituloDaSecao, fmtNum, fmtPct, fmtR } from "./ui";
import {
  COBERTURA_MINIMA, diaCurto, economiaNosCanaisProprios, nomeDoMes,
  type ComissoesDosApps, type FaltaDoCmv, type ResultadoDoDRE,
} from "@/lib/financeiro/dre";

/** Um botão por lugar de resolver (duas faltas podem levar à mesma tela). */
function botoesDasFaltas(faltas: FaltaDoCmv[]): FaltaDoCmv[] {
  const vistos = new Set<string>();
  return faltas.filter((f) => (vistos.has(f.href) ? false : (vistos.add(f.href), true)));
}

const vermelho = "#C92E09";
const verde = "#0F766E";
const corDoValor = (v: number) => (v >= 0 ? verde : vermelho);

const ROTULO_DA_SITUACAO: Record<string, string> = {
  fechado: "boleto emitido",
  pago: "pago",
  projetado: "projeção do mês",
  previsto: "fechamento a rodar",
  isento: "isento",
  teste: "em teste",
  "sem-cobranca": "sem cobrança",
};

export default function AbaDRE({
  dre, de, ate, comissoes, despesas, onDespesas, irPara,
}: {
  dre: ResultadoDoDRE;
  de: string;
  ate: string;
  comissoes: ComissoesDosApps;
  despesas: DespesaDTO[];
  onDespesas: (d: DespesaDTO[]) => void;
  irPara: (aba: "configuracoes" | "custosfix") => void;
}) {
  const [verTodosSemCusto, setVerTodosSemCusto] = useState(false);
  const despesasDoPeriodo = despesas.filter((d) => d.dia >= de && d.dia <= ate);
  const economia = economiaNosCanaisProprios(dre, comissoes);
  const porTipo = dre.porTipo.filter((t) => t.vendas > 0).map((t) => `${t.rotulo} ${fmtNum(t.vendas)}`).join(" · ");
  const percentualDoCmv = dre.valorDosItens > 0 ? (dre.cmv / dre.valorDosItens) * 100 : 0;
  const c = dre.cmvDetalhe;
  const faltasQueBloqueiam = botoesDasFaltas(c.faltas.filter((f) => f.bloqueia));
  const semCustoVisiveis = verTodosSemCusto ? c.semCusto.itens : c.semCusto.itens.slice(0, 12);
  // Ausente em dado antigo (página aberta antes do deploy).
  const desp = c.desperdicio;

  return (
    <>
      <AjudaModulo
        icone="📊"
        titulo="DRE — o resultado da sua loja"
        oQueE="Mostra, no período escolhido, quanto entrou de venda, quanto saiu de custo e o que sobrou."
        paraQueServe="É a resposta para “trabalhei o mês todo, mas ganhei dinheiro?”."
        aviso="O resultado só vira lucro de verdade com o custo dos produtos (pela contagem do estoque, pela ficha técnica com as compras lançadas ou pelo custo digitado no produto), a comissão de cada app cadastrada na aba Configurações e as taxas da maquininha em Minha Loja. Enquanto faltar alguma delas, o DRE mostra “resultado incompleto” e diz o que falta — ele não inventa o número."
        passos={[
          { titulo: "Escolha o período", texto: "os botões do topo são os mesmos dos Relatórios, e o dia vira às 5h da manhã, como no caixa." },
          { titulo: "Olhe a margem de contribuição", texto: "é o que sobra de cada venda depois do produto, da comissão do app, da taxa do cartão e do entregador." },
          { titulo: "Caiu a margem?", texto: "confira o CMV. Quase sempre é preço de fornecedor que subiu e o cardápio não acompanhou." },
        ]}
      />

      {/* ── O QUE FALTA PARA SER LUCRO ─────────────────────────────────── */}
      {!dre.completo && (
        <div style={{ background: "#FFF7E6", border: "2px solid #B45309", borderRadius: 14, padding: "16px 20px", marginBottom: "1.5rem" }}>
          <p style={{ fontWeight: 800, color: "#92400E", margin: "0 0 6px", fontSize: "0.95rem" }}>
            ⚠️ Resultado incompleto — o número abaixo ainda não é o lucro da loja
          </p>
          <ul style={{ margin: "0 0 10px", paddingLeft: 18, color: "#78350F", fontSize: "0.84rem", lineHeight: 1.6 }}>
            {dre.pendencias.map((p) => <li key={p}>{p.charAt(0).toUpperCase() + p.slice(1)}.</li>)}
          </ul>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {/* O botão do CMV é o do que de fato falta: compra, ficha, custo no cardápio ou o nome do app. */}
            {faltasQueBloqueiam.map((f) => (
              <a key={f.href} href={f.href} style={{ background: "#B45309", color: "#fff", padding: "7px 14px", borderRadius: 8, fontWeight: 700, fontSize: "0.8rem", textDecoration: "none" }}>
                📦 {f.rotulo}
              </a>
            ))}
            {dre.comissoes.some((c) => c.pct === null) && (
              <button onClick={() => irPara("configuracoes")} style={{ background: "#fff", color: "#92400E", border: "1.5px solid #B45309", padding: "6px 14px", borderRadius: 8, fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", fontFamily: "inherit" }}>
                ⚙️ Cadastrar a comissão dos apps
              </button>
            )}
            {dre.taxas.some((t) => !t.configurada) && (
              <a href="/store/minha-loja" style={{ background: "#fff", color: "#92400E", border: "1.5px solid #B45309", padding: "6px 14px", borderRadius: 8, fontWeight: 700, fontSize: "0.8rem", textDecoration: "none" }}>
                💳 Cadastrar as taxas da maquininha
              </a>
            )}
          </div>
        </div>
      )}

      {/* ── CARTÕES ────────────────────────────────────────────────────── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "1rem", marginBottom: "1.5rem" }}>
        <KPICard icon={<DollarSign size={18} color={verde} />} label="Valor vendido" value={fmtR(dre.valorVendido)}
          sub={`${fmtNum(dre.vendas)} ${dre.vendas === 1 ? "venda" : "vendas"} · o mesmo valor dos Relatórios desta loja`} color={verde} />
        {dre.completo ? (
          <KPICard icon={<TrendingUp size={18} color="#1C1917" />} label="Resultado do período (DRE)" value={<span style={{ color: corDoValor(dre.resultado) }}>{fmtR(dre.resultado)}</span>}
            sub={`${fmtPct(dre.margens.resultado)} da receita da loja`} color="#1C1917" />
        ) : (
          <KPICard alerta icon={<TrendingUp size={18} color="#B45309" />} label="Resultado do período (DRE)" value="Incompleto"
            sub={dre.pendencias[0] ? dre.pendencias[0].charAt(0).toUpperCase() + dre.pendencias[0].slice(1) + (dre.pendencias.length > 1 ? ` (+${dre.pendencias.length - 1})` : "") : undefined} color="#B45309" />
        )}
        <KPICard icon={<ShoppingBag size={18} color="#64748B" />} label="Ticket médio" value={fmtR(dre.ticketMedio)}
          sub={porTipo || "sem vendas"} color="#64748B" />
        <KPICard icon={<Package size={18} color="#B45309" />} label={c.real ? "CMV real (custo dos produtos)" : "CMV (custo dos produtos)"} value={fmtR(dre.cmv)}
          alerta={!c.completo}
          sub={dre.valorDosItens > 0 || c.real
            ? <>{fmtPct(percentualDoCmv)} do valor dos itens · {c.titulo.replace(/^CMV /, "")}{c.semCusto.valor > 0 ? ` · ${fmtR(c.semCusto.valor)} em itens sem custo` : ""}</>
            : "sem itens no período"} color="#B45309" />
        <KPICard icon={<Truck size={18} color="#0D9488" />} label="Entregadores" value={dre.entregadores.erro ? "Não apurado" : fmtR(dre.entregadores.total)}
          alerta={Boolean(dre.entregadores.erro)}
          sub={dre.entregadores.erro ? "Erro ao ler o acerto dos entregadores" : `${fmtNum(dre.entregadores.corridas)} corridas · ${fmtR(dre.entregadores.porEntrega)} + ${fmtR(dre.entregadores.diarias)} de diárias`} color="#0D9488" />
        <KPICard icon={<Users size={18} color={vermelho} />} label="Cancelamentos" value={fmtNum(dre.cancelados.pedidos)}
          sub={`${fmtR(dre.cancelados.valor)} em pedidos cancelados`} color={vermelho} />
      </div>

      {/* ── O QUE FALTA NO CMV ──────────────────────────────────────────── */}
      {c.faltas.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #FDE68A", borderRadius: 14, padding: "14px 18px", marginBottom: "1.5rem" }}>
          <p style={{ fontWeight: 800, color: "#92400E", margin: "0 0 4px", fontSize: "0.9rem" }}>
            {c.completo ? "Para o custo dos produtos ficar ainda mais certo" : "O que falta para o custo dos produtos (CMV)"}
          </p>
          <p style={{ color: "#78350F", fontSize: "0.8rem", margin: "0 0 10px", lineHeight: 1.5 }}>
            {c.titulo}.{" "}
            {c.itensFora > 0 && (c.real
              ? <>Nos dias fora da contagem, {fmtPct(c.coberturaFora * 100, 0)} do valor dos itens tem custo.</>
              : <>{fmtPct(c.coberturaFora * 100, 0)} do valor dos itens vendidos tem custo.</>)}
            {c.semCusto.valor > 0 && <> Item sem custo não entra como R$ 0,00 escondido: fica de fora e conta contra o mínimo de {fmtPct(COBERTURA_MINIMA * 100, 0)} — abaixo dele, o DRE não chama o resultado de lucro.</>}
          </p>
          <ul style={{ margin: "0 0 10px", paddingLeft: 18, color: "#78350F", fontSize: "0.8rem", lineHeight: 1.55 }}>
            {c.faltas.map((f) => (
              <li key={f.chave} style={{ marginBottom: 6 }}>
                {f.texto}{" "}
                <a href={f.href} style={{ color: "#B45309", fontWeight: 700 }}>{f.rotulo} →</a>
              </li>
            ))}
          </ul>
          {c.semCusto.itens.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {semCustoVisiveis.map((i) => (
                <span key={i.nome} title={i.faltas.map((f) => f.nome).join(", ")} style={{ background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 6, padding: "3px 10px", fontSize: "0.76rem", fontWeight: 600, color: "#92400E" }}>
                  {i.nome} · {fmtR(i.valor)}
                </span>
              ))}
              {c.semCusto.itens.length > 12 && (
                <button onClick={() => setVerTodosSemCusto((v) => !v)} style={{ fontSize: "0.76rem", color: "#92400E", fontWeight: 700, background: "none", border: "1px dashed #FDE68A", borderRadius: 6, padding: "3px 10px", cursor: "pointer" }}>
                  {verTodosSemCusto ? "▲ Ver menos" : `▼ Ver mais ${c.semCusto.itens.length - 12}`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── O DEMONSTRATIVO ────────────────────────────────────────────── */}
      <div style={{ background: "#fff", borderRadius: 16, boxShadow: "0 2px 12px rgba(0,0,0,0.06)", overflow: "hidden" }}>
        <div style={{ padding: "18px 24px", borderBottom: "1px solid #F1F5F9", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <BarChart2 size={20} color="#0F172A" />
          <h2 style={{ fontWeight: 800, fontSize: "1.05rem", margin: 0 }}>
            Demonstrativo de Resultado — {diaCurto(de, true)} a {diaCurto(ate, true)}
          </h2>
          <span style={{ fontSize: "0.75rem", color: "#94A3B8" }}>
            {dre.dias} {dre.dias === 1 ? "dia" : "dias"} · o dia vira às 5h, como no caixa e nos Relatórios
          </span>
        </div>

        <TituloDaSecao cor={verde} fundo="#F0FDFA">RECEITAS</TituloDaSecao>
        <DRERow label="(+) Valor vendido" value={dre.valorVendido} bold
          detalhe={`${fmtNum(dre.vendas)} vendas (${fmtNum(dre.lancamentos)} lançamentos; a mesa conta uma vez) · o mesmo valor dos Relatórios desta loja`} />
        <DRERow label="Pedidos sem a taxa de entrega" value={dre.produtos} indent={1} />
        <DRERow label="Taxa de entrega — entregas da loja" value={dre.freteDaLoja} indent={1} />
        {dre.freteDoApp > 0 && <DRERow label="Taxa de entrega — corridas do entregador do app" value={dre.freteDoApp} indent={1} />}
        {dre.freteDoApp > 0 && (
          <DRERow label="(-) Taxa de entrega que fica com o app" value={-dre.freteDoApp} color={vermelho}
            detalhe={`${fmtNum(dre.entregasDoApp)} corridas feitas pelo entregador do app: o cliente paga a taxa, mas ela não é da loja`} />
        )}
        {dre.taxaDoApp > 0 && (
          <DRERow label="(-) Taxa de serviço do app (fica com o app)" value={-dre.taxaDoApp} color={vermelho}
            detalhe={`${fmtNum(dre.pedidosComTaxaDoApp)} pedidos de app: a diferença entre o total do pedido e itens + entrega − desconto, que fica com o app (a taxa de serviço; no 99Food gravado pelo preço cheio, o desconto que entrou em dobro no total)`} />
        )}
        {dre.descontoNaMesa > 0 && (
          <DRERow label="(-) Desconto dado no fechamento das mesas" value={-dre.descontoNaMesa} color={vermelho}
            detalhe={`${fmtNum(dre.mesasComDesconto)} ${dre.mesasComDesconto === 1 ? "mesa fechada" : "mesas fechadas"} com desconto no período (pelo dia do fechamento)`} />
        )}
        {dre.cupomDoApp > 0 && (
          <DRERow label="(+) Cupom pago pelo app" value={dre.cupomDoApp} color={verde}
            detalhe="desconto que o app deu ao cliente e repassa à loja — não sai do bolso da loja" />
        )}
        <DRERow label="(=) RECEITA DA LOJA" value={dre.receitaDaLoja} bold border color={corDoValor(dre.receitaDaLoja)} />

        <TituloDaSecao cor="#E8590C" fundo="#FFF4EF">CUSTO DOS PRODUTOS VENDIDOS</TituloDaSecao>
        <DRERow label="(-) CMV — custo dos produtos vendidos" value={-dre.cmv} color={dre.cmv > 0 ? vermelho : "#0F172A"}
          detalhe={dre.valorDosItens > 0 || c.real
            ? `${c.titulo} · com custo: ${fmtPct(dre.cobertura * 100, 0)} do valor dos itens (${fmtR(dre.valorDosItensComCusto)} de ${fmtR(dre.valorDosItens)})`
            : undefined} />
        {c.real && (
          <DRERow indent={1} label={`Pela contagem do estoque — ${diaCurto(c.real.de)} a ${diaCurto(c.real.ate)}`} value={-c.real.cmv} color={vermelho}
            detalhe={`estoque no fim de ${diaCurto(c.real.abertura)} ${fmtR(c.real.estoqueInicial)} + compras que entraram ${fmtR(c.real.compras)} − estoque no fim de ${diaCurto(c.real.ate)} ${fmtR(c.real.estoqueFinal)}${c.real.pct != null ? ` · ${fmtPct(c.real.pct)} das vendas desses dias (${fmtR(c.real.vendas)}, sem a taxa de entrega)` : ""}`} />
        )}
        {c.ficha.itens > 0 && (
          <DRERow indent={1} label={c.real ? "Outros dias — pela ficha técnica × custo das compras" : "Pela ficha técnica × custo das compras"} value={-c.ficha.custo} color={vermelho}
            detalhe={`${fmtR(c.ficha.itens)} em itens; o insumo vale o custo da última compra lançada até o dia da venda`} />
        )}
        {c.cadastro.itens > 0 && (
          <DRERow indent={1} label={c.real ? "Outros dias — pelo custo digitado no produto" : "Pelo custo digitado no produto"} value={-c.cadastro.custo} color={vermelho}
            detalhe={`${fmtR(c.cadastro.itens)} em itens sem ficha técnica`} />
        )}
        {c.semCusto.valor > 0 && (
          <DRERow indent={1} label="Itens sem custo (ficam de fora do CMV)" value={<span style={{ color: "#B45309", fontWeight: 700 }}>{fmtR(c.semCusto.valor)} em itens</span>}
            detalhe={c.coberturaFora < COBERTURA_MINIMA ? "abaixo do mínimo: o resultado fica incompleto — veja o que falta no topo" : "dentro do mínimo; o que falta está no topo"} />
        )}
        {/* Desperdício: o que foi para o lixo é custo sem venda. Nos dias da
            contagem ele já está no CMV real; nos outros entra somado aqui. */}
        {desp && (desp.cancelados.pedidos > 0 || desp.lancado.valor > 0) && (
          <>
            <DRERow indent={1} label="Desperdício de pedidos cancelados (já produzidos)" value={-desp.cancelados.noCmv} color={vermelho}
              detalhe={`${fmtNum(desp.cancelados.pedidos)} ${desp.cancelados.pedidos === 1 ? "pedido cancelado" : "pedidos cancelados"} depois de sair da produção, de ficar pronto ou de sair para entrega (cancelado antes disso não conta) · ${fmtR(desp.cancelados.valor)} pelo custo dos itens${desp.cancelados.semCusto > 0 ? ` · ${fmtR(desp.cancelados.semCusto)} em itens sem custo ficam de fora` : ""}${desp.naContagem > 0 ? " · nos dias da contagem do estoque já está dentro do CMV real" : ""}`} />
            <DRERow indent={1} label="Desperdício lançado (produtos, insumos, FireCheck)" value={-desp.lancado.noCmv} color={vermelho}
              detalhe={`${fmtR(desp.lancado.valor)} lançados em Estoque › Desperdício, Movimentar › Perda e no FireCheck${desp.naContagem > 0 ? " · nos dias da contagem do estoque já está dentro do CMV real" : ""}`} />
          </>
        )}
        <DRERow label="(=) LUCRO BRUTO" value={dre.lucroBruto} bold border color={corDoValor(dre.lucroBruto)} />

        <TituloDaSecao cor="#E11D48" fundo="#FFF1F2">CUSTOS QUE ANDAM COM A VENDA</TituloDaSecao>
        <DRERow label="(-) Comissão e taxas dos apps" value={-dre.totalComissoes} color={vermelho}
          detalhe={dre.comissoes.length === 0 ? "nenhuma venda de app no período" : undefined} />
        {dre.comissoes.map((c) => (
          <DRERow key={c.canal} indent={1}
            label={c.pct === null ? `${c.nome} — comissão não configurada` : `${c.nome} — ${fmtPct(c.pct, c.pct % 1 ? 2 : 0)} sobre os itens`}
            value={c.pct === null ? <span style={{ color: "#B45309", fontWeight: 700 }}>falta configurar</span> : -c.valor}
            color={vermelho}
            detalhe={`${fmtNum(c.pedidos)} pedidos · itens de ${fmtR(c.base)}`} />
        ))}
        <DRERow label="(-) Taxas de pagamento" value={-dre.totalTaxas} color={vermelho}
          detalhe="pela forma de pagamento do caixa; pedido pago no app não tem taxa aqui — ela está na comissão do app" />
        {dre.taxas.map((t) => (
          <DRERow key={t.chave} indent={1}
            label={t.configurada ? `${t.rotulo} — ${fmtPct(t.pct ?? 0, 2)}` : `${t.rotulo} — taxa não cadastrada`}
            value={t.configurada ? -t.valor : <span style={{ color: "#B45309", fontWeight: 700 }}>falta cadastrar</span>}
            color={vermelho}
            detalhe={`sobre ${fmtR(t.base)} · ${t.comoFoi}`} />
        ))}
        <DRERow label="(-) Entregadores" value={dre.entregadores.erro ? <span style={{ color: "#B45309", fontWeight: 700 }}>não apurado</span> : -dre.entregadores.total} color={vermelho}
          detalhe={dre.entregadores.erro
            ? "não foi possível ler o acerto dos entregadores agora — recarregue a página"
            : `${fmtR(dre.entregadores.porEntrega)} pelas ${fmtNum(dre.entregadores.corridas)} corridas + ${fmtR(dre.entregadores.diarias)} de diárias (${fmtNum(dre.entregadores.diasDeDiaria)} dias-entregador) — a mesma conta do Motoboys → Relatório`} />
        <DRERow label="(=) MARGEM DE CONTRIBUIÇÃO" value={dre.margemDeContribuicao} bold border color={corDoValor(dre.margemDeContribuicao)}
          detalhe="o que as vendas deixam para pagar a mensalidade, as despesas e os custos fixos" />

        <TituloDaSecao cor="#1C1917" fundo="#FAF6F2">PLATAFORMA FIREHUB</TituloDaSecao>
        <DRERow label="(-) Mensalidade FireHub" value={-dre.mensalidade.total} color="#1C1917"
          detalhe={dre.mensalidade.isenta
            ? "loja isenta de mensalidade"
            : "o boleto de cada mês (o mês em andamento projetado pelo ritmo de vendas até agora), pela parte dos dias do mês que cai no período"} />
        {!dre.mensalidade.isenta && dre.mensalidade.meses.map((m) => (
          <DRERow key={m.mes} indent={1}
            label={`${nomeDoMes(m.mes)} (${ROTULO_DA_SITUACAO[m.situacao || ""] || ""}): ${fmtR(m.valorDoMes)} × ${m.dias}/${m.diasDoMes} dias`}
            value={-m.valor} color="#1C1917" />
        ))}

        <TituloDaSecao cor="#475569" fundo="#F8FAFC">DESPESAS E CUSTOS FIXOS</TituloDaSecao>
        {dre.despesas.total > 0 && (
          <>
            <DRERow label="(-) Despesas lançadas" value={-dre.despesas.total} color={vermelho} />
            {dre.despesas.porCategoria.map(([categoria, total]) => (
              <DRERow key={categoria} label={categoria} value={-total} color={vermelho} indent={1} />
            ))}
          </>
        )}
        <DespesasLancadas todas={despesas} doPeriodo={despesasDoPeriodo} onMudou={onDespesas} />
        {dre.custosFixos.itens.length > 0 ? (
          <>
            <DRERow label="(-) Custos fixos" value={-dre.custosFixos.total} color="#475569"
              detalhe={`rateio mês a mês: ${dre.custosFixos.meses.map((m) => `${m.dias}/${m.diasDoMes} de ${nomeDoMes(m.mes)}`).join(" + ")} = ${dre.custosFixos.mesesEquivalentes.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} ${dre.custosFixos.mesesEquivalentes === 1 ? "mês" : "meses"} de ${fmtR(dre.custosFixos.totalMensal)}`} />
            {dre.custosFixos.itens.map((c) => (
              <DRERow key={c.id} label={c.label} value={-c.valor} color="#475569" indent={1} />
            ))}
          </>
        ) : (
          <div style={{ padding: "10px 24px", background: "#FAFAFA", borderTop: "1px solid #F1F5F9" }}>
            <span style={{ fontSize: "0.75rem", color: "#94A3B8" }}>
              💡 Nenhum custo fixo cadastrado —{" "}
              <button onClick={() => irPara("custosfix")} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontWeight: 700, fontSize: "0.75rem", padding: 0, fontFamily: "inherit" }}>
                cadastre aluguel, salários, energia, contador…
              </button>
            </span>
          </div>
        )}

        <div style={{ background: dre.completo ? (dre.resultado >= 0 ? "#F0FDFA" : "#FFF1F2") : "#FFF7E6", borderTop: "2px solid #E2E8F0" }}>
          <DRERow
            label={dre.completo ? "(=) RESULTADO DO PERÍODO" : "(=) RESULTADO PARCIAL — incompleto"}
            value={dre.resultado} bold
            color={dre.completo ? corDoValor(dre.resultado) : "#92400E"}
            detalhe={dre.completo ? undefined : `não é o lucro: falta ${dre.pendencias.join("; ")}`} />
        </div>

        {(dre.servicoDasMesas.taxa > 0 || dre.servicoDasMesas.gorjeta > 0) && (
          <div style={{ padding: "8px 24px", fontSize: "0.74rem", color: "#94A3B8", borderTop: "1px solid #F1F5F9" }}>
            Fora do DRE, como nos Relatórios: taxa de serviço {fmtR(dre.servicoDasMesas.taxa)} e gorjeta {fmtR(dre.servicoDasMesas.gorjeta)} das mesas fechadas no período.
          </div>
        )}
        {dre.avisos.length > 0 && (
          <div style={{ padding: "8px 24px 12px", fontSize: "0.74rem", color: "#64748B", borderTop: "1px solid #F1F5F9", lineHeight: 1.6 }}>
            {dre.avisos.map((a) => <div key={a}>• {a.charAt(0).toUpperCase() + a.slice(1)}.</div>)}
          </div>
        )}

        {/* Margens: todas sobre a receita da loja (uma base só). */}
        <div style={{ padding: "20px 24px", borderTop: "1px solid #F1F5F9" }}>
          <p style={{ fontSize: "0.72rem", color: "#94A3B8", margin: "0 0 10px" }}>Margens sobre a receita da loja ({fmtR(dre.receitaDaLoja)})</p>
          <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
            {[
              { label: "Margem bruta", val: dre.margens.bruta, color: "#B45309" },
              { label: "Margem de contribuição", val: dre.margens.contribuicao, color: "#1C1917" },
              { label: dre.completo ? "Margem do resultado" : "Margem do resultado (incompleto)", val: dre.margens.resultado, color: dre.completo ? verde : "#B45309" },
            ].map((m) => (
              <div key={m.label} style={{ flex: 1, minWidth: 160 }}>
                <p style={{ fontSize: "0.75rem", color: "#64748B", margin: "0 0 4px" }}>{m.label}</p>
                <div style={{ background: "#F1F5F9", borderRadius: 6, height: 8, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, Math.max(0, m.val))}%`, height: "100%", background: m.color, borderRadius: 6, transition: "width 0.5s" }} />
                </div>
                <p style={{ fontSize: "0.85rem", fontWeight: 800, color: m.color, margin: "4px 0 0" }}>{fmtPct(m.val)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── CANAIS PRÓPRIOS × APP ──────────────────────────────────────── */}
      {economia.base > 0 && (
        <div style={{ background: "#F0FDFA", borderRadius: 16, padding: "1.1rem 1.25rem", border: "1px solid #99F6E4", marginTop: "1.5rem" }}>
          <div style={{ fontSize: "0.8rem", fontWeight: 800, color: verde }}>💚 Vendas pelos seus canais próprios (site e WhatsApp)</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 900, color: verde, margin: "4px 0" }}>{fmtR(economia.base)}</div>
          <p style={{ margin: 0, fontSize: "0.78rem", color: verde, lineHeight: 1.5 }}>
            {fmtNum(economia.pedidos)} pedidos sem comissão de app. Se tivessem passado pelo iFood com {fmtPct(economia.percentual, economia.percentual % 1 ? 2 : 0)} de
            comissão e taxas ({economia.daLoja ? "o percentual que você cadastrou" : "referência do plano Entrega do iFood: 23% + 3,2% do pagamento online"}),
            a loja teria pago cerca de <strong>{fmtR(economia.valor)}</strong> ao app. Balcão, mesa e as vendas que já são do app não entram nesta conta.
          </p>
        </div>
      )}
    </>
  );
}
