"use client";

/**
 * Meu aplicativo › Clube — o clube de assinatura do app (lib/clube).
 *
 * O que a loja vê aqui, nesta ordem: se o clube está pagando a conta (sócios,
 * mensalidade que caiu, desconto dado, sócio × não sócio), a configuração com
 * a prévia de como o cliente vê, como a cobrança funciona e quem é sócio.
 *
 * Duas formas de cobrar: o cartão automático pelo Asaas DA LOJA (padrão: a
 * loja liga sozinha, o FireHub não cobra nada a mais) e a Cakto (o Clube da
 * Hakim, que segue nela até o Douglas migrar). Dados de /api/store/meu-aplicativo/clube.
 */
import { useCallback, useEffect, useState } from "react";
import { BadgePercent, CheckCircle2, Copy, CreditCard, Crown, Lock, Receipt, Repeat, TrendingUp, Users, Wallet, XCircle } from "lucide-react";
import { FaixaDoClube } from "@/components/customer/clube/ClubeNoCardapio";
import type { Aviso } from "./MeuAplicativoClient";
import { data, reais } from "./tipos";

type Situacao = "ativo" | "pendente" | "encerrado" | "nao_assinante";
type Config = {
  ativo: boolean;
  cobranca: "cakto" | "asaas";
  valor: number;
  percentual: number;
  teto: number | null;
  linkDoCheckout: string | null;
  nome: string | null;
  acumulaComCupom: boolean;
  chamada: string | null;
};
type Lado = { clientes: number; vendas: number; valor: number; ticket: number; pedidosPorCliente: number; valorPorCliente: number };
type DadosDoClube = {
  config: Config;
  asaas: { pronto: boolean; conta: string | null; ambiente: "producao" | "sandbox" | null; avisoLigado: boolean; lojaDaConta: string | null };
  webhookUrl: string | null;
  temSegredoDaCakto: boolean;
  aviso?: string | null;
  numeros: {
    ativos: number; pendentes: number; encerrados: number; novos: number; cancelamentos: number;
    mensalidades: number; mensalidadesPagas: number; receitaBruta: number; receitaLiquida: number; saldo: number;
    pedidosNoMes: number; descontoNoMes: number; faturamentoNoMes: number;
  };
  comparacao: { socios: Lado; naoSocios: Lado; frequenciaVezes: number | null; ticketDiferencaPct: number | null };
  assinantes: {
    id: string; nome: string; telefone: string; situacao: Situacao; cancelado: boolean; cobranca: "cakto" | "asaas";
    desde: string | null; canceladoEm: string | null; pagoAte: string | null; pagamentos: number; podeCancelar: boolean;
  }[];
};

const ROTULO: Record<Situacao, { texto: string; cor: string; fundo: string }> = {
  ativo: { texto: "Ativo", cor: "#047857", fundo: "#D1FAE5" },
  pendente: { texto: "Cartão recusado", cor: "#B45309", fundo: "#FEF3C7" },
  encerrado: { texto: "Cancelou", cor: "#64748B", fundo: "#F1F5F9" },
  nao_assinante: { texto: "Não pagou", cor: "#64748B", fundo: "#F1F5F9" },
};

const EVENTOS_DA_CAKTO = [
  "Compra aprovada",
  "Assinatura criada",
  "Assinatura renovada",
  "Renovação de assinatura recusada",
  "Assinatura atrasada",
  "Atraso de assinatura recuperado",
  "Assinatura cancelada",
  "Reembolso",
  "Chargeback",
];

const LIMITE_DA_CHAMADA = 80;

const numero = (s: string) => {
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};
const pct = (n: number) => `${String(n).replace(".", ",")}%`;
const vezes = (n: number) => String(n).replace(".", ",");

export default function AbaClube({ nomeDaLoja, avisar }: { nomeDaLoja: string; avisar: (a: Aviso) => void }) {
  const [dados, setDados] = useState<DadosDoClube | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [cancelando, setCancelando] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<string | null>(null);
  const [form, setForm] = useState({
    ativo: false, cobranca: "asaas" as "cakto" | "asaas", nome: "", chamada: "", valor: "29,90", percentual: "15", teto: "",
    acumulaComCupom: false, link: "", segredo: "",
  });

  const aplicar = useCallback((d: DadosDoClube) => {
    setDados(d);
    setForm({
      ativo: d.config.ativo,
      cobranca: d.config.cobranca,
      nome: d.config.nome || "",
      chamada: d.config.chamada || "",
      valor: d.config.valor.toFixed(2).replace(".", ","),
      percentual: String(d.config.percentual).replace(".", ","),
      teto: d.config.teto != null ? d.config.teto.toFixed(2).replace(".", ",") : "",
      acumulaComCupom: d.config.acumulaComCupom,
      link: d.config.linkDoCheckout || "",
      segredo: "",
    });
  }, []);

  useEffect(() => {
    fetch("/api/store/meu-aplicativo/clube", { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "Erro ao carregar"); aplicar(j); })
      .catch((e) => setErro(e.message));
  }, [aplicar]);

  async function salvar() {
    const valor = numero(form.valor);
    const percentual = numero(form.percentual);
    const teto = form.teto.trim() ? numero(form.teto) : null;
    if (!(valor >= 5 && valor <= 500)) return avisar({ tipo: "erro", titulo: "Mensalidade inválida", detalhe: "De R$ 5,00 a R$ 500,00." });
    if (!(percentual >= 5 && percentual <= 50)) return avisar({ tipo: "erro", titulo: "Desconto inválido", detalhe: "Entre 5% e 50%." });
    if (teto !== null && !(teto > 0)) return avisar({ tipo: "erro", titulo: "Teto inválido", detalhe: "Deixe vazio para não ter teto." });
    setSalvando(true);
    try {
      const r = await fetch("/api/store/meu-aplicativo/clube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ativo: form.ativo,
          cobranca: form.cobranca,
          nome: form.nome,
          chamada: form.chamada,
          valor,
          percentual,
          teto,
          acumulaComCupom: form.acumulaComCupom,
          linkDoCheckout: form.link.trim() || null,
          ...(form.segredo.trim() ? { segredoDaCakto: form.segredo.trim() } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Não deu para salvar.");
      aplicar(j);
      avisar(
        j.aviso
          ? { tipo: "atencao", titulo: "Clube salvo", detalhe: j.aviso }
          : {
              tipo: "ok",
              titulo: j.config.ativo ? "Clube ligado" : "Clube salvo",
              detalhe: j.config.ativo ? "Já aparece no aplicativo. Quem está com o app aberto vê ao recarregar o cardápio." : "Desligado: o app não mostra o clube.",
            },
      );
    } catch (e: any) {
      avisar({ tipo: "erro", titulo: "Não salvou", detalhe: e.message });
    } finally {
      setSalvando(false);
    }
  }

  async function cancelarSocio(id: string) {
    setCancelando(id);
    try {
      const r = await fetch("/api/store/meu-aplicativo/clube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "cancelar", assinanteId: id }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Não deu para cancelar.");
      aplicar(j);
      avisar({ tipo: "ok", titulo: "Assinatura cancelada", detalhe: "Nenhuma cobrança nova sai no cartão. O desconto vale até o fim do mês já pago." });
    } catch (e: any) {
      avisar({ tipo: "erro", titulo: "Não cancelou", detalhe: e.message });
    } finally {
      setCancelando(null);
      setConfirmar(null);
    }
  }

  function copiar(texto: string) {
    navigator.clipboard?.writeText(texto).then(
      () => avisar({ tipo: "ok", titulo: "Copiado", detalhe: "Cole na Cakto, em Integrações › Webhooks." }),
      () => avisar({ tipo: "erro", titulo: "Não copiou", detalhe: "Selecione o texto e copie à mão." }),
    );
  }

  if (erro) return <div className="ma-cartao" style={{ color: "#B91C1C", fontWeight: 700 }}>{erro}</div>;
  if (!dados) return <div className="ma-esqueleto" style={{ height: 320 }} />;

  const n = dados.numeros;
  const cartao = form.cobranca === "asaas";
  const cmp = dados.comparacao;
  const previa = {
    nome: form.nome.trim() || `Clube ${nomeDaLoja}`,
    valor: numero(form.valor) >= 1 ? numero(form.valor) : 29.9,
    percentual: numero(form.percentual) > 0 ? numero(form.percentual) : 15,
    teto: form.teto.trim() && numero(form.teto) > 0 ? numero(form.teto) : null,
    cobranca: form.cobranca,
    acumulaComCupom: form.acumulaComCupom,
    chamada: form.chamada.trim() || null,
  };
  const sePagaEm = Math.ceil(previa.valor / (previa.percentual / 100));
  // Cartão: o que caiu de verdade no Asaas. Cakto: a estimativa sócios × mensalidade.
  const entrouNoMes = cartao ? n.receitaLiquida : n.mensalidades;
  const saldo = Math.round((entrouNoMes - n.descontoNoMes) * 100) / 100;
  const maiorTicket = Math.max(cmp.socios.ticket, cmp.naoSocios.ticket, 1);
  const maiorFreq = Math.max(cmp.socios.pedidosPorCliente, cmp.naoSocios.pedidosPorCliente, 1);

  return (
    <div className="ma-pilha">
      {/* 1. O clube está pagando a conta? */}
      <div className="ma-hero">
        <div className="ma-hero-item">
          <div className="ma-hero-rotulo"><Crown size={15} color="#FACC15" /> Sócios ativos</div>
          <div className="ma-hero-valor ouro">{n.ativos}</div>
          <div className="ma-hero-det">
            +{n.novos} novos · −{n.cancelamentos} cancelaram este mês{n.pendentes > 0 ? ` · ${n.pendentes} com cartão recusado` : ""}
          </div>
        </div>
        <div className="ma-hero-item">
          <div className="ma-hero-rotulo"><Wallet size={15} /> {cartao ? "Mensalidades que caíram" : "Mensalidades por mês"}</div>
          <div className="ma-hero-valor">{reais(entrouNoMes)}</div>
          <div className="ma-hero-det">
            {cartao
              ? `${n.mensalidadesPagas} paga(s) no Asaas este mês · líquido das taxas`
              : `${n.ativos} × ${reais(dados.config.valor)} (antes das taxas da Cakto)`}
          </div>
        </div>
        <div className="ma-hero-item">
          <div className="ma-hero-rotulo"><BadgePercent size={15} /> Desconto dado no mês</div>
          <div className="ma-hero-valor">{reais(n.descontoNoMes)}</div>
          <div className="ma-hero-det" style={{ color: saldo >= 0 ? "#86EFAC" : "#FCA5A5" }}>
            {n.pedidosNoMes} pedido(s) de sócio · {saldo >= 0 ? `mensalidades cobrem o desconto, sobram ${reais(saldo)}` : `desconto passou as mensalidades em ${reais(-saldo)}`}
          </div>
        </div>
        <div className="ma-hero-item">
          <div className="ma-hero-rotulo"><TrendingUp size={15} /> Sócio × não sócio</div>
          <div className="ma-hero-valor">{cmp.frequenciaVezes != null ? `${vezes(cmp.frequenciaVezes)}×` : "—"}</div>
          <div className="ma-hero-det">
            {cmp.frequenciaVezes != null
              ? `pedidos por cliente em 30 dias: sócio ${vezes(cmp.socios.pedidosPorCliente)}, não sócio ${vezes(cmp.naoSocios.pedidosPorCliente)}`
              : "aparece quando houver pedidos de sócio"}
          </div>
        </div>
      </div>

      {/* 2. Sócio × não sócio: o valor do clube para a loja */}
      <div className="ma-cartao">
        <h2><TrendingUp size={18} color="#CA8A04" /> O sócio compra mais?</h2>
        <p className="ma-cartao-sub">Últimos 30 dias, todas as vendas com telefone (app, site, WhatsApp, balcão; mesa fica fora). Sócio = quem está com o clube em dia hoje.</p>
        {cmp.socios.clientes === 0 ? (
          <div className="ma-vazio">
            <div className="ma-vazio-icone"><Users size={22} /></div>
            <b>Ainda sem pedido de sócio</b>
            Quando os primeiros sócios pedirem, aqui aparece quantas vezes eles pedem e quanto gastam, lado a lado com quem não é sócio.
          </div>
        ) : (
          <div className="ma-grade-2">
            <div>
              <div className="ma-rotulo" style={{ marginTop: 0 }}>Pedidos por cliente</div>
              <div className="ma-comparo">
                <div><span>Sócios</span><i style={{ width: `${(cmp.socios.pedidosPorCliente / maiorFreq) * 100}%`, background: "#CA8A04" }} /><b>{vezes(cmp.socios.pedidosPorCliente)}</b></div>
                <div><span>Não sócios</span><i style={{ width: `${(cmp.naoSocios.pedidosPorCliente / maiorFreq) * 100}%`, background: "#94A3B8" }} /><b>{vezes(cmp.naoSocios.pedidosPorCliente)}</b></div>
              </div>
              <div className="ma-rotulo">Ticket médio</div>
              <div className="ma-comparo">
                <div><span>Sócios</span><i style={{ width: `${(cmp.socios.ticket / maiorTicket) * 100}%`, background: "#CA8A04" }} /><b>{reais(cmp.socios.ticket)}</b></div>
                <div><span>Não sócios</span><i style={{ width: `${(cmp.naoSocios.ticket / maiorTicket) * 100}%`, background: "#94A3B8" }} /><b>{reais(cmp.naoSocios.ticket)}</b></div>
              </div>
            </div>
            <div>
              <table className="ma-tabela">
                <thead><tr><th></th><th>Sócios</th><th>Não sócios</th></tr></thead>
                <tbody>
                  <tr><td>Clientes</td><td data-rotulo="Sócios">{cmp.socios.clientes}</td><td data-rotulo="Não sócios">{cmp.naoSocios.clientes}</td></tr>
                  <tr><td>Vendas</td><td data-rotulo="Sócios">{cmp.socios.vendas}</td><td data-rotulo="Não sócios">{cmp.naoSocios.vendas}</td></tr>
                  <tr><td>Gasto por cliente</td><td data-rotulo="Sócios">{reais(cmp.socios.valorPorCliente)}</td><td data-rotulo="Não sócios">{reais(cmp.naoSocios.valorPorCliente)}</td></tr>
                </tbody>
              </table>
              <p className="ma-explica">
                {cmp.ticketDiferencaPct != null && (
                  <>O ticket do sócio está {cmp.ticketDiferencaPct >= 0 ? `${pct(cmp.ticketDiferencaPct)} acima` : `${pct(-cmp.ticketDiferencaPct)} abaixo`} do de quem não é sócio (já com o desconto). </>
                )}
                Comparação, não prova: quem assina já tendia a pedir mais. O que vale olhar é se o sócio continua pedindo mês a mês.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="ma-grade-2">
        {/* 3. Configuração */}
        <div className="ma-cartao">
          <h2><Crown size={18} color="#CA8A04" /> O seu clube</h2>
          <p className="ma-cartao-sub">Um plano só: o cliente paga por mês e ganha o desconto em todo pedido feito pelo aplicativo. No site, no WhatsApp, no balcão e nos marketplaces o preço não muda.</p>

          <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, fontSize: ".9rem", cursor: "pointer" }}>
            <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} style={{ width: 20, height: 20, accentColor: "#0F172A" }} />
            Mostrar o clube no aplicativo
          </label>

          <div className="ma-rotulo">Como o cliente paga</div>
          <div style={{ display: "grid", gap: 8 }}>
            {([
              { id: "asaas", titulo: "Cartão automático (Asaas da loja)", det: "O cliente digita o cartão uma vez, na página segura do Asaas; todo mês cobra sozinho. O dinheiro cai no seu Asaas.", icone: CreditCard },
              { id: "cakto", titulo: "Cakto", det: "Você cria o produto de assinatura na Cakto e cola o link aqui. Cartão ou Pix Automático.", icone: Repeat },
            ] as const).map((o) => {
              const Icone = o.icone;
              const marcado = form.cobranca === o.id;
              return (
                <label key={o.id} style={{
                  display: "flex", gap: 10, padding: "11px 12px", borderRadius: 12, cursor: "pointer", alignItems: "flex-start",
                  border: `1.5px solid ${marcado ? "#CA8A04" : "#E2E8F0"}`, background: marcado ? "#FFFBEB" : "#fff",
                }}>
                  <input type="radio" name="cobranca" checked={marcado} onChange={() => setForm({ ...form, cobranca: o.id })} style={{ marginTop: 3, accentColor: "#CA8A04" }} />
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 800, fontSize: ".88rem" }}><Icone size={15} /> {o.titulo}</span>
                    <span style={{ display: "block", fontSize: ".78rem", color: "#64748B", lineHeight: 1.45, marginTop: 2 }}>{o.det}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {cartao && (
            <div style={{
              marginTop: 10, padding: "10px 12px", borderRadius: 10, fontSize: ".8rem", lineHeight: 1.45, display: "flex", gap: 8, alignItems: "flex-start",
              background: dados.asaas.pronto ? "#ECFDF5" : "#FEF2F2", color: dados.asaas.pronto ? "#065F46" : "#991B1B",
            }}>
              {dados.asaas.pronto ? <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1 }} /> : <XCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />}
              <span>
                {dados.asaas.pronto ? (
                  <>Asaas conectado{dados.asaas.conta ? ` (${dados.asaas.conta}${dados.asaas.ambiente === "sandbox" ? ", Sandbox" : ""})` : ""}. As mensalidades caem nessa conta{dados.asaas.lojaDaConta ? `, a da ${dados.asaas.lojaDaConta}` : ""}.
                    {!dados.asaas.avisoLigado && " O aviso automático de pagamento ainda não está ligado: salve o clube ligado para o FireHub ligar."}</>
                ) : (
                  <>Conecte o Asaas da loja (o mesmo do pagamento online) para cobrar no cartão. <a href="/store/integracoes?abrir=asaas" style={{ color: "inherit", fontWeight: 800 }}>Conectar o Asaas</a></>
                )}
              </span>
            </div>
          )}

          <div className="ma-rotulo">Nome do clube <small>opcional</small></div>
          <input className="ma-campo" value={form.nome} placeholder={`Clube ${nomeDaLoja}`} maxLength={40} onChange={(e) => setForm({ ...form, nome: e.target.value })} />

          <div className="ma-rotulo">Chamada no app <small>{form.chamada.length}/{LIMITE_DA_CHAMADA}</small></div>
          <input className="ma-campo" value={form.chamada} maxLength={LIMITE_DA_CHAMADA}
            placeholder={`Assine e ganhe ${pct(previa.percentual)} OFF em todos os pedidos`}
            onChange={(e) => setForm({ ...form, chamada: e.target.value })} />

          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
            <div>
              <div className="ma-rotulo">Mensalidade (R$)</div>
              <input className="ma-campo" inputMode="decimal" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })} />
            </div>
            <div>
              <div className="ma-rotulo">Desconto (%)</div>
              <input className="ma-campo" inputMode="decimal" value={form.percentual} onChange={(e) => setForm({ ...form, percentual: e.target.value })} />
            </div>
            <div>
              <div className="ma-rotulo">Teto/pedido <small>R$</small></div>
              <input className="ma-campo" inputMode="decimal" value={form.teto} placeholder="sem teto" onChange={(e) => setForm({ ...form, teto: e.target.value })} />
            </div>
          </div>
          <p className="ma-explica">
            Mensalidade de R$ 5 a R$ 500 e desconto de 5% a 50%. Com {pct(previa.percentual)}, o clube se paga para o cliente a partir de {reais(sePagaEm)} em pedidos no mês.
            {!cartao && " A mensalidade aqui é só o que aparece no app: o preço cobrado é o do produto na Cakto. Use o mesmo valor."}
          </p>

          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, fontSize: ".86rem", cursor: "pointer", marginTop: 12 }}>
            <input type="checkbox" checked={form.acumulaComCupom} onChange={(e) => setForm({ ...form, acumulaComCupom: e.target.checked })} style={{ width: 18, height: 18, marginTop: 1, accentColor: "#0F172A" }} />
            <span><b>Somar com cupom</b><span style={{ display: "block", color: "#64748B", fontSize: ".78rem", lineHeight: 1.45 }}>
              Desmarcado (recomendado): com cupom no pedido vale o cupom, e a sacola avisa o sócio. Marcado, os dois descontos entram juntos.
            </span></span>
          </label>
          <p className="ma-explica">
            Promoção do cardápio não é cupom: o % do clube sai sobre o preço que o cliente paga, já com a promoção — no item em promoção o desconto em reais fica menor. A entrega nunca leva desconto do clube.
          </p>

          {!cartao && (
            <>
              <div className="ma-rotulo">Link do checkout da Cakto</div>
              <input className="ma-campo" value={form.link} placeholder="https://pay.cakto.com.br/…" onChange={(e) => setForm({ ...form, link: e.target.value })} />
            </>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            <button className="ma-botao" disabled={salvando} onClick={() => salvar()}>{salvando ? "Salvando…" : "Salvar"}</button>
          </div>
        </div>

        {/* Como o cliente vê */}
        <div className="ma-cartao">
          <h2>Como aparece no app</h2>
          <p className="ma-cartao-sub">Logo abaixo do topo do cardápio, sem cobrir nada. Na sacola, quem não é sócio vê quanto economizaria naquele pedido.</p>
          <div style={{ background: "#F5F5F5", borderRadius: 14, padding: "4px 0 14px", border: "1px solid #E2E8F0", display: "grid", gap: 0 }}>
            <FaixaDoClube clube={previa} situacao="nao_assinante" pagoAte={null} onAbrir={() => {}} onPagar={() => {}} />
            <FaixaDoClube clube={previa} situacao="ativo" pagoAte={new Date(Date.now() + 20 * 86_400_000).toISOString()} onAbrir={() => {}} onPagar={() => {}} />
            <FaixaDoClube clube={previa} situacao="pendente" pagoAte={null} onAbrir={() => {}} onPagar={() => {}} />
          </div>
          <p className="ma-explica">De cima para baixo: quem ainda não é sócio, quem está pagando e quem teve o cartão recusado (continua pedindo normal, só sem o desconto).</p>
          <div className="ma-rotulo">O que o FireHub cobra</div>
          <p style={{ margin: 0, fontSize: ".86rem", color: "#334155", lineHeight: 1.55 }}>
            Nada a mais: o clube faz parte do plano do aplicativo. {cartao ? "No cartão, só a tarifa do Asaas por mensalidade, na sua conta." : "Na Cakto, as taxas da Cakto."}
          </p>
        </div>
      </div>

      {/* 4. Como a cobrança funciona */}
      {cartao ? (
        <div className="ma-cartao">
          <h2><Lock size={18} /> Como o cliente assina e paga</h2>
          <p className="ma-cartao-sub">Sem cadastrar produto em lugar nenhum: o FireHub cria a assinatura no seu Asaas quando o cliente toca em Assinar.</p>
          <div className="ma-passo"><em>1</em> No app, o cliente entra na conta e toca em Assinar</div>
          <p style={{ margin: 0, fontSize: ".88rem", color: "#334155", lineHeight: 1.55 }}>Na primeira vez ele informa o CPF (o Asaas exige do titular). O FireHub cria o cliente no seu Asaas, sem as notificações pagas do Asaas.</p>
          <div className="ma-passo"><em>2</em> Digita o cartão na página segura do Asaas</div>
          <p style={{ margin: 0, fontSize: ".88rem", color: "#334155", lineHeight: 1.55 }}>O cartão nunca passa pelo FireHub nem pelo app. Pagou a 1ª mensalidade, o Asaas cria a assinatura mensal e cobra o mesmo cartão todo mês.</p>
          <div className="ma-passo"><em>3</em> O desconto entra sozinho, só no aplicativo</div>
          <p style={{ margin: 0, fontSize: ".88rem", color: "#334155", lineHeight: 1.55 }}>
            O servidor confere o pedido: feito de dentro do app, com o login do sócio e a mensalidade em dia. Cartão recusado, o desconto sai até o cliente trocar o cartão; cancelou, vale até o fim do mês pago.
          </p>
          <div className="ma-passo"><em>4</em> Você acompanha aqui</div>
          <p style={{ margin: 0, fontSize: ".88rem", color: "#334155", lineHeight: 1.55 }}>Cada pagamento, recusa e cancelamento chega pelo aviso do Asaas e muda a lista de sócios abaixo. O cliente cancela pelo app; você pode cancelar pela lista.</p>
        </div>
      ) : (
        <div className="ma-cartao">
          <h2>Ligar a cobrança na Cakto</h2>
          <p className="ma-cartao-sub">A Cakto cobra o cliente todo mês (cartão ou Pix Automático) e avisa o FireHub. Quem pagou ganha o desconto na hora; quem não pagou perde o desconto sozinho.</p>
          <div className="ma-passo"><em>1</em> Crie o produto</div>
          <p style={{ margin: 0, fontSize: ".88rem", color: "#334155", lineHeight: 1.55 }}>
            Na Cakto, crie um produto do tipo <b>Assinatura recorrente</b>, cobrança <b>mensal</b>, com o valor de {reais(previa.valor)}. Nas formas de pagamento, deixe <b>cartão de crédito</b> e <b>Pix Automático</b>.
          </p>
          <div className="ma-passo"><em>2</em> Cole o link do checkout</div>
          <p style={{ margin: 0, fontSize: ".88rem", color: "#334155", lineHeight: 1.55 }}>Copie o link da oferta (pay.cakto.com.br/…) e cole no campo “Link do checkout” acima.</p>
          <div className="ma-passo"><em>3</em> Ligue o aviso (webhook)</div>
          <p style={{ margin: "0 0 8px", fontSize: ".88rem", color: "#334155", lineHeight: 1.55 }}>
            Em <b>Integrações › Webhooks</b>, crie um webhook para este produto com o endereço abaixo e marque os eventos:
          </p>
          {dados.webhookUrl ? (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <code style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", background: "#F1F5F9", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 12px", fontSize: ".78rem" }}>{dados.webhookUrl}</code>
              <button className="ma-botao-leve" onClick={() => copiar(dados.webhookUrl!)}><Copy size={14} /> Copiar</button>
            </div>
          ) : (
            <p className="ma-explica" style={{ marginTop: 0 }}>Salve o clube uma vez para gerar o endereço.</p>
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {EVENTOS_DA_CAKTO.map((e) => <span key={e} className="ma-selo" style={{ background: "#F1F5F9", color: "#334155" }}>{e}</span>)}
          </div>
          <div className="ma-rotulo">Chave secreta do webhook <small>opcional · {dados.temSegredoDaCakto ? "já guardada" : "não guardada"}</small></div>
          <div style={{ display: "flex", gap: 8 }}>
            <input className="ma-campo" type="password" autoComplete="off" value={form.segredo} placeholder={dados.temSegredoDaCakto ? "•••••••• (cole outra para trocar)" : "a chave que a Cakto mostra no webhook"} onChange={(e) => setForm({ ...form, segredo: e.target.value })} />
            <button className="ma-botao-leve" disabled={salvando || !form.segredo.trim()} onClick={() => salvar()}>Guardar</button>
          </div>
          <div className="ma-passo"><em>4</em> Ligue o clube</div>
          <p style={{ margin: 0, fontSize: ".88rem", color: "#334155", lineHeight: 1.55 }}>
            Marque “Mostrar o clube no aplicativo” e salve. Faça uma assinatura de teste com o seu número: em segundos ela aparece em Sócios, logo abaixo.
          </p>
        </div>
      )}

      {/* 5. Sócios */}
      <div className="ma-cartao">
        <h2><Users size={18} /> Sócios</h2>
        {dados.assinantes.length === 0 ? (
          <div className="ma-vazio">
            <div className="ma-vazio-icone"><Crown size={22} /></div>
            <b>Ninguém assinou ainda</b>
            Assim que alguém pagar a 1ª mensalidade, aparece aqui com a data da próxima cobrança.
          </div>
        ) : (
          <table className="ma-tabela">
            <thead>
              <tr><th>Cliente</th><th>Situação</th><th>Sócio desde</th><th>Pago até</th><th>Mensalidades</th><th></th></tr>
            </thead>
            <tbody>
              {dados.assinantes.map((a) => {
                const r = a.cancelado && a.situacao === "ativo" ? { texto: "Cancelou (vale até o fim)", cor: "#475569", fundo: "#F1F5F9" } : ROTULO[a.situacao];
                return (
                  <tr key={a.id}>
                    <td>{a.nome}<div style={{ fontSize: ".74rem", color: "#94A3B8", fontWeight: 600 }}>{a.telefone}{a.cobranca === "cakto" ? " · Cakto" : ""}</div></td>
                    <td data-rotulo="Situação"><span className="ma-selo" style={{ color: r.cor, background: r.fundo }}>{r.texto}</span></td>
                    <td data-rotulo="Sócio desde">{a.desde ? data(a.desde) : "—"}</td>
                    <td data-rotulo="Pago até">{a.pagoAte ? data(a.pagoAte) : "—"}</td>
                    <td data-rotulo="Mensalidades">{a.pagamentos}</td>
                    <td data-rotulo="">
                      {a.podeCancelar && (confirmar === a.id ? (
                        <span style={{ display: "inline-flex", gap: 6 }}>
                          <button className="ma-botao-leve" onClick={() => setConfirmar(null)}>Manter</button>
                          <button className="ma-botao" style={{ background: "#B91C1C", padding: "8px 12px" }} disabled={cancelando === a.id} onClick={() => cancelarSocio(a.id)}>
                            {cancelando === a.id ? "Cancelando…" : "Confirmar"}
                          </button>
                        </span>
                      ) : (
                        <button className="ma-botao-leve" onClick={() => setConfirmar(a.id)}>Cancelar</button>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="ma-explica"><Receipt size={12} style={{ verticalAlign: "-2px" }} /> {n.pedidosNoMes} pedido(s) de sócio este mês, {reais(n.faturamentoNoMes)} vendidos com o desconto do clube. O desconto também aparece no relatório Cupons e descontos, como “Clube do aplicativo”.</p>
      </div>
    </div>
  );
}
