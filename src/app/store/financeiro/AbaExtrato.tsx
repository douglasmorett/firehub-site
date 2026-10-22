"use client";
/**
 * As abas Extrato e Relatório: cada venda do período e o caminho do dinheiro
 * (caixa da loja, repasse do app, conta Asaas da loja).
 *
 * O que saiu daqui (auditoria de 11/10/2026), porque prometia o que não faz:
 *   • o "Saldo Gateway da Loja (Mercado Pago)" e o botão de saque — nenhuma
 *     loja usa esse gateway e a rota de saque está desligada
 *     (api/store/repasse/solicitar responde 503);
 *   • a "Mensalidade" listada no resumo sem ser descontada da "Receita
 *     Líquida" — a mensalidade é boleto, não sai do dinheiro online;
 *   • "Faturamento Online", que só somava o Mercado Pago (R$ 0 para todas);
 *   • linhas fixas em R$ 0,00 (tráfego pago, indicação, reembolsos, repasse);
 *   • "Exportar transações", que só dava um alert — agora baixa a planilha;
 *   • os botões de período próprios, que não desligavam o período
 *     personalizado — agora o período é um só, o do topo.
 */
import { useMemo, useState, type ReactNode } from "react";
import AjudaModulo from "@/components/AjudaModulo";
import { fmtNum, fmtPct, fmtR } from "./ui";
import {
  diaCurto, entraNoDRE, recebimentosDoPeriodo,
  type ComissoesDosApps, type DadosDoPeriodo, type PedidoDoFinanceiro, type ResultadoDoDRE,
} from "@/lib/financeiro/dre";
import { situacaoDoPedido } from "@/lib/relatorios/regua-da-venda";

const NOME_DO_CANAL: Record<string, string> = {
  IFOOD: "iFood", "99FOOD": "99Food", BRENDI: "Brendi", WABIZ: "Wabiz", JOTAJA: "Jotajá",
  WHATSAPP_IA: "Robô do WhatsApp", PDV: "Balcão / PDV", TOTEM: "Totem", MESA: "Mesa", SITE: "Site próprio", DESCONHECIDO: "Outro canal",
};

type Lancamento = {
  id: string;
  quando: string;
  pedido: string;
  canal: string;
  forma: string;
  destino: string;
  situacao: "Venda" | "Cancelado";
  valor: number;
  taxa: number;
  taxaEstimada: boolean;
  liquido: number;
};

function lancamentosDoPeriodo(pedidos: PedidoDoFinanceiro[], comissoes: ComissoesDosApps, tz: string): Lancamento[] {
  const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: tz, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const saida: Lancamento[] = [];
  for (const p of [...pedidos].reverse()) {
    const cancelado = situacaoDoPedido(p.status) === "cancelado";
    if (!cancelado && !entraNoDRE(p)) continue;
    const online = p.pagamentos.some((x) => x.forma === "ONLINE");
    const canal = NOME_DO_CANAL[p.canal] || p.canal;
    const destino = p.tableSessionId
      ? "Caixa da loja (conta da mesa)"
      : online
        ? (p.marketplace ? `Repasse do ${canal}` : "Sua conta Asaas")
        : "Caixa da loja";
    // A taxa que se sabe por pedido: a do FireHub no pago pelo site (gravada no pedido), e a
    // comissão do app pelo percentual que a loja cadastrou (estimada).
    let taxa = 0, estimada = false;
    if (!cancelado) {
      if (online && !p.marketplace) taxa = p.taxaOnline;
      else if (p.marketplace && typeof comissoes[p.canal] === "number") {
        taxa = Math.round((p.itens > 0 ? p.itens : Math.max(0, p.totalAmount - p.deliveryFee)) * comissoes[p.canal]!) / 100;
        estimada = true;
      }
    }
    const valor = cancelado ? 0 : p.totalAmount;
    saida.push({
      id: p.id,
      quando: quando(p.criadoEm),
      pedido: `#${p.numero}`,
      canal,
      forma: p.tableSessionId ? "na conta da mesa" : (p.paymentMethod || "—"),
      destino,
      situacao: cancelado ? "Cancelado" : "Venda",
      valor,
      taxa,
      taxaEstimada: estimada,
      liquido: Math.round((valor - taxa) * 100) / 100,
    });
  }
  return saida;
}

/** A planilha do Extrato: ";" e vírgula decimal, como o Excel em português abre. */
function baixarCsv(linhas: Lancamento[], de: string, ate: string) {
  const num = (v: number) => v.toFixed(2).replace(".", ",");
  const campo = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const cabecalho = ["Data/hora", "Pedido", "Canal", "Forma de pagamento", "Onde o dinheiro chega", "Situação", "Valor", "Taxa/comissão", "Taxa estimada", "Líquido"];
  const corpo = linhas.map((l) => [
    campo(l.quando), campo(l.pedido), campo(l.canal), campo(l.forma), campo(l.destino), campo(l.situacao),
    num(l.valor), num(l.taxa), l.taxaEstimada ? "sim" : "não", num(l.liquido),
  ].join(";"));
  const blob = new Blob(["﻿" + [cabecalho.join(";"), ...corpo].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `extrato-${de}-a-${ate}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function AbaExtrato({ dados, comissoes, repasseConfig }: { dados: DadosDoPeriodo; comissoes: ComissoesDosApps; repasseConfig: any }) {
  const [todos, setTodos] = useState(false);
  const lancamentos = useMemo(() => lancamentosDoPeriodo(dados.pedidos, comissoes, dados.tz), [dados, comissoes]);
  const receb = useMemo(() => recebimentosDoPeriodo(dados), [dados]);
  const visiveis = todos ? lancamentos : lancamentos.slice(0, 200);

  return (
    <div>
      <AjudaModulo
        icone="💳"
        titulo="Extrato das vendas"
        oQueE="Lista cada venda do período com o canal, a forma de pagamento e para onde o dinheiro vai: o caixa da loja, o repasse do app ou a sua conta Asaas (Pix e cartão pagos pelo site)."
        paraQueServe="Serve para conferir o que entrou e baixar a lista em planilha."
        aviso="O FireHub não guarda dinheiro da loja: o pago pelo site cai direto na sua conta Asaas, e o do app chega pelo repasse do próprio app."
      />

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1.25rem", marginBottom: "1.5rem" }}>
        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: "1.25rem" }}>
          <div style={{ fontSize: "0.86rem", fontWeight: 800, color: "#1C1917" }}>⚡ Pago online pelo site (sua conta Asaas)</div>
          <p style={{ fontSize: "1.9rem", fontWeight: 900, color: "#0F766E", margin: "4px 0" }}>{fmtR(receb.site.total)}</p>
          <div style={{ fontSize: "0.8rem", color: "#475569", lineHeight: 1.7 }}>
            {fmtNum(receb.site.pedidos)} pedidos · Pix {fmtR(receb.site.pix)} · cartão {fmtR(receb.site.cartao)}<br />
            Taxa do FireHub (gravada em cada pedido): − {fmtR(receb.site.taxaFireHub)}<br />
            {receb.site.pedidosEstornados > 0 && <>Pagos e depois cancelados: {fmtNum(receb.site.pedidosEstornados)} ({fmtR(receb.site.estornos)}) — confira o estorno no Asaas<br /></>}
            <strong>Líquido: {fmtR(receb.site.liquido)}</strong> (a tarifa do próprio Asaas sai no extrato do Asaas)
          </div>
          <div style={{ fontSize: "0.74rem", color: "#64748B", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 8, padding: "8px 10px", marginTop: 10 }}>
            {repasseConfig?.chavePix
              ? <>Chave Pix guardada para repasse: <strong>{repasseConfig.chavePix}</strong>. O repasse automático ainda não está ativo.</>
              : <>O repasse automático ainda não está ativo — o dinheiro do site já cai na sua conta Asaas.</>}
          </div>
        </div>

        <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: "1.25rem" }}>
          <div style={{ fontSize: "0.86rem", fontWeight: 800, color: "#0F172A", marginBottom: 8 }}>📋 Para onde foi o dinheiro das vendas</div>
          {[
            { rotulo: "Recebido na loja (caixa)", valor: receb.naLoja.total },
            { rotulo: "Pago no app (total pago pelo cliente; o repasse vem sem a comissão e as taxas do app)", valor: receb.noApp.total },
            { rotulo: "Pago online pelo site (conta Asaas)", valor: receb.site.total },
          ].map((l) => (
            <div key={l.rotulo} style={{ display: "flex", justifyContent: "space-between", padding: "7px 0", borderBottom: "1px solid #F1F5F9", fontSize: "0.86rem" }}>
              <span style={{ color: "#475569" }}>{l.rotulo}</span><strong>{fmtR(l.valor)}</strong>
            </div>
          ))}
          <p style={{ fontSize: "0.74rem", color: "#94A3B8", margin: "8px 0 0", lineHeight: 1.5 }}>
            A mensalidade do FireHub é cobrada por boleto (aba Mensalidade) e não sai destes valores. As mesas entram pelas baixas da conta, sem o troco.
          </p>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexWrap: "wrap", gap: 10 }}>
        <span style={{ fontSize: "0.82rem", color: "#64748B" }}>
          {fmtNum(lancamentos.length)} lançamentos de {diaCurto(dados.de, true)} a {diaCurto(dados.ate, true)}
        </span>
        <button
          onClick={() => baixarCsv(lancamentos, dados.de, dados.ate)}
          disabled={lancamentos.length === 0}
          style={{ padding: "7px 14px", borderRadius: 8, border: "1px solid #C92E09", background: "#fff", color: "#C92E09", fontWeight: 700, fontSize: "0.8rem", cursor: lancamentos.length ? "pointer" : "not-allowed", fontFamily: "inherit" }}
        >
          📥 Baixar planilha (CSV)
        </button>
      </div>

      <div style={{ background: "#fff", borderRadius: 14, border: "1px solid #E2E8F0", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem", minWidth: 900 }}>
          <thead>
            <tr style={{ background: "#F8FAFC", borderBottom: "1px solid #E2E8F0", color: "#475569", textAlign: "left" }}>
              <th style={{ padding: "9px 12px" }}>Data/hora</th>
              <th style={{ padding: "9px 12px" }}>Pedido</th>
              <th style={{ padding: "9px 12px" }}>Canal</th>
              <th style={{ padding: "9px 12px" }}>Forma de pagamento</th>
              <th style={{ padding: "9px 12px" }}>Onde o dinheiro chega</th>
              <th style={{ padding: "9px 12px" }}>Situação</th>
              <th style={{ padding: "9px 12px" }}>Valor</th>
              <th style={{ padding: "9px 12px" }}>Taxa</th>
              <th style={{ padding: "9px 12px" }}>Líquido</th>
            </tr>
          </thead>
          <tbody>
            {lancamentos.length === 0 ? (
              <tr><td colSpan={9} style={{ padding: "2.5rem", textAlign: "center", color: "#64748B" }}>Nenhuma venda no período escolhido.</td></tr>
            ) : visiveis.map((l) => (
              <tr key={l.id} style={{ borderBottom: "1px solid #F1F5F9" }}>
                <td style={{ padding: "8px 12px", whiteSpace: "nowrap" }}>{l.quando}</td>
                <td style={{ padding: "8px 12px", fontWeight: 700 }}>{l.pedido}</td>
                <td style={{ padding: "8px 12px" }}>{l.canal}</td>
                <td style={{ padding: "8px 12px" }}>{l.forma}</td>
                <td style={{ padding: "8px 12px" }}>{l.destino}</td>
                <td style={{ padding: "8px 12px" }}>
                  <span style={{ padding: "2px 8px", borderRadius: 99, background: l.situacao === "Venda" ? "#E6F4EA" : "#FEE2E2", color: l.situacao === "Venda" ? "#137333" : "#B71C1C", fontSize: "0.72rem", fontWeight: 700 }}>{l.situacao}</span>
                </td>
                <td style={{ padding: "8px 12px", fontWeight: 700, whiteSpace: "nowrap" }}>{fmtR(l.valor)}</td>
                <td style={{ padding: "8px 12px", color: "#C92E09", whiteSpace: "nowrap" }} title={l.taxaEstimada ? "comissão estimada pelo percentual cadastrado em Configurações" : undefined}>
                  {l.taxa > 0 ? `${l.taxaEstimada ? "~ " : ""}- ${fmtR(l.taxa)}` : "—"}
                </td>
                <td style={{ padding: "8px 12px", fontWeight: 800, whiteSpace: "nowrap" }}>{fmtR(l.liquido)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {lancamentos.length > visiveis.length && (
          <button onClick={() => setTodos(true)} style={{ width: "100%", padding: 10, background: "#F8FAFC", border: "none", borderTop: "1px solid #E2E8F0", color: "#334155", fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>
            Mostrar os {fmtNum(lancamentos.length)} lançamentos
          </button>
        )}
      </div>
      <p style={{ fontSize: "0.72rem", color: "#94A3B8", marginTop: 8 }}>
        "~" = comissão do app estimada pelo percentual que você cadastrou em Configurações. Pedido do app sem percentual cadastrado aparece sem taxa.
      </p>
    </div>
  );
}

export function AbaRelatorio({ dados, dre }: { dados: DadosDoPeriodo; dre: ResultadoDoDRE }) {
  const receb = useMemo(() => recebimentosDoPeriodo(dados), [dados]);
  const Cartao = ({ titulo, children }: { titulo: string; children: ReactNode }) => (
    <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: "1.25rem" }}>
      <h4 style={{ fontWeight: 800, fontSize: "0.95rem", color: "#0F172A", margin: "0 0 12px" }}>{titulo}</h4>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: "0.84rem" }}>{children}</div>
    </div>
  );
  const Linha = ({ rotulo, valor, forte }: { rotulo: string; valor: string; forte?: boolean }) => (
    <div style={{ display: "flex", justifyContent: "space-between", borderTop: forte ? "1px solid #F1F5F9" : undefined, paddingTop: forte ? 8 : 0 }}>
      <span style={{ color: forte ? "#0F172A" : "#475569", fontWeight: forte ? 800 : 400 }}>{rotulo}</span>
      <strong style={{ color: forte ? "#0F766E" : "#0F172A" }}>{valor}</strong>
    </div>
  );

  return (
    <div>
      <AjudaModulo
        icone="📈"
        titulo="Relatório do período"
        oQueE="O valor vendido no período separado por canal e pelo caminho do dinheiro: caixa da loja, repasse do app e pago online pelo site."
        paraQueServe="Use para enxergar de onde vem o seu dinheiro e quanto depende dos apps."
        passos={[
          { titulo: "Compare períodos", texto: "troque o período no topo: os números são os mesmos dos Relatórios." },
          { titulo: "Conferência do caixa", texto: "o detalhe por forma de pagamento, com a ponte para o caixa, está em Relatórios → Formas de pagamento." },
        ]}
      />
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: "1.25rem", flexWrap: "wrap", gap: 10 }}>
        <div>
          <span style={{ fontSize: "0.82rem", color: "#64748B", fontWeight: 700 }}>Valor vendido ({diaCurto(dados.de)} a {diaCurto(dados.ate)})</span>
          <h2 style={{ fontSize: "2rem", fontWeight: 900, color: "#0F766E", margin: 0 }}>{fmtR(dre.valorVendido)}</h2>
          <span style={{ fontSize: "0.76rem", color: "#94A3B8" }}>{fmtNum(dre.vendas)} vendas · ticket médio {fmtR(dre.ticketMedio)}</span>
        </div>
        <a href={`/store/relatorios/formas-de-pagamento?de=${dados.de}&ate=${dados.ate}`} style={{ fontSize: "0.8rem", fontWeight: 700, color: "#C92E09" }}>
          Abrir Relatórios → Formas de pagamento
        </a>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1.25rem" }}>
        <Cartao titulo="Por canal">
          {dre.porCanal.length === 0 ? <span style={{ color: "#94A3B8" }}>Sem vendas no período.</span> : dre.porCanal.map((c) => (
            <Linha key={c.canal} rotulo={`${c.nome} (${fmtNum(c.pedidos)})`} valor={`${fmtR(c.valor)} · ${fmtPct(dre.valorVendido > 0 ? (c.valor / dre.valorVendido) * 100 : 0)}`} />
          ))}
          <Linha rotulo="Total" valor={fmtR(dre.valorVendido)} forte />
        </Cartao>

        <Cartao titulo="Recebido na loja (caixa)">
          {receb.naLoja.linhas.length === 0 ? <span style={{ color: "#94A3B8" }}>Nada recebido na loja no período.</span> : receb.naLoja.linhas.map((l) => (
            <Linha key={l.forma} rotulo={l.rotulo} valor={fmtR(l.valor)} />
          ))}
          <Linha rotulo="Total recebido na loja" valor={fmtR(receb.naLoja.total)} forte />
        </Cartao>

        <Cartao titulo="Pago no app (total pago pelo cliente)">
          {receb.noApp.linhas.length === 0 ? <span style={{ color: "#94A3B8" }}>Nenhum pedido pago no app no período.</span> : receb.noApp.linhas.map((l) => (
            <Linha key={l.canal} rotulo={l.nome} valor={fmtR(l.valor)} />
          ))}
          <Linha rotulo="Total pago no app" valor={fmtR(receb.noApp.total)} forte />
          <span style={{ fontSize: "0.74rem", color: "#94A3B8" }}>O repasse do app vem sem a comissão e sem a taxa de serviço que ele cobra do cliente (veja o DRE).</span>
        </Cartao>

        <Cartao titulo="Pago online pelo site (conta Asaas)">
          <Linha rotulo="Pix" valor={fmtR(receb.site.pix)} />
          <Linha rotulo="Cartão" valor={fmtR(receb.site.cartao)} />
          <Linha rotulo="Taxa do FireHub" valor={`- ${fmtR(receb.site.taxaFireHub)}`} />
          <Linha rotulo="Líquido (antes da tarifa do Asaas)" valor={fmtR(receb.site.liquido)} forte />
        </Cartao>
      </div>
    </div>
  );
}
