"use client";

/**
 * Meu aplicativo › Clube — o clube de assinatura do app (lib/clube).
 *
 * O que a loja vê aqui, nesta ordem: se o clube está pagando a conta
 * (mensalidades × desconto dado no mês), a configuração (preço, %, teto, link
 * do checkout da Cakto), o passo a passo para ligar a Cakto e quem assina.
 * Os dados vêm de /api/store/meu-aplicativo/clube.
 */
import { useCallback, useEffect, useState } from "react";
import { Copy, Crown, Users, Wallet, Receipt, BadgePercent } from "lucide-react";
import { FaixaDoClube } from "@/components/customer/clube/ClubeNoCardapio";
import type { Aviso } from "./MeuAplicativoClient";
import { data, reais } from "./tipos";

type Situacao = "ativo" | "pendente" | "encerrado" | "nao_assinante";
type Config = { ativo: boolean; valor: number; percentual: number; teto: number | null; linkDoCheckout: string | null; nome: string | null };
type DadosDoClube = {
  config: Config;
  webhookUrl: string | null;
  temSegredoDaCakto: boolean;
  numeros: { ativos: number; pendentes: number; encerrados: number; mensalidades: number; pedidosNoMes: number; descontoNoMes: number; faturamentoNoMes: number };
  assinantes: { id: string; nome: string; telefone: string; situacao: Situacao; desde: string | null; pagoAte: string | null; pagamentos: number }[];
};

const ROTULO: Record<Situacao, { texto: string; cor: string; fundo: string }> = {
  ativo: { texto: "Ativo", cor: "#047857", fundo: "#D1FAE5" },
  pendente: { texto: "Sem pagamento", cor: "#B45309", fundo: "#FEF3C7" },
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

const numero = (s: string) => {
  const n = Number(String(s).replace(",", "."));
  return Number.isFinite(n) ? n : NaN;
};

export default function AbaClube({ nomeDaLoja, avisar }: { nomeDaLoja: string; avisar: (a: Aviso) => void }) {
  const [dados, setDados] = useState<DadosDoClube | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({ ativo: false, nome: "", valor: "29,90", percentual: "15", teto: "", link: "", segredo: "" });

  const aplicar = useCallback((d: DadosDoClube) => {
    setDados(d);
    setForm({
      ativo: d.config.ativo,
      nome: d.config.nome || "",
      valor: d.config.valor.toFixed(2).replace(".", ","),
      percentual: String(d.config.percentual).replace(".", ","),
      teto: d.config.teto != null ? d.config.teto.toFixed(2).replace(".", ",") : "",
      link: d.config.linkDoCheckout || "",
      segredo: "",
    });
  }, []);

  useEffect(() => {
    fetch("/api/store/meu-aplicativo/clube", { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "Erro ao carregar"); aplicar(j); })
      .catch((e) => setErro(e.message));
  }, [aplicar]);

  async function salvar(ligar?: boolean) {
    const valor = numero(form.valor);
    const percentual = numero(form.percentual);
    const teto = form.teto.trim() ? numero(form.teto) : null;
    if (!(valor >= 1)) return avisar({ tipo: "erro", titulo: "Mensalidade inválida", detalhe: "Use o mesmo valor do produto na Cakto, ex.: 29,90." });
    if (!(percentual > 0 && percentual <= 50)) return avisar({ tipo: "erro", titulo: "Desconto inválido", detalhe: "Entre 1% e 50%." });
    if (teto !== null && !(teto > 0)) return avisar({ tipo: "erro", titulo: "Teto inválido", detalhe: "Deixe vazio para não ter teto." });
    setSalvando(true);
    try {
      const r = await fetch("/api/store/meu-aplicativo/clube", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ativo: ligar ?? form.ativo,
          nome: form.nome,
          valor,
          percentual,
          teto,
          linkDoCheckout: form.link.trim() || null,
          ...(form.segredo.trim() ? { segredoDaCakto: form.segredo.trim() } : {}),
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Não deu para salvar.");
      aplicar(j);
      avisar({
        tipo: "ok",
        titulo: j.config.ativo ? "Clube ligado" : "Clube salvo",
        detalhe: j.config.ativo ? "Já aparece no aplicativo. Quem já está com o app aberto vê ao recarregar o cardápio." : "Desligado: o app não mostra o clube.",
      });
    } catch (e: any) {
      avisar({ tipo: "erro", titulo: "Não salvou", detalhe: e.message });
    } finally {
      setSalvando(false);
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
  const saldo = Math.round((n.mensalidades - n.descontoNoMes) * 100) / 100;
  const previa = {
    nome: form.nome.trim() || `Clube ${nomeDaLoja}`,
    valor: numero(form.valor) >= 1 ? numero(form.valor) : 29.9,
    percentual: numero(form.percentual) > 0 ? numero(form.percentual) : 15,
    teto: form.teto.trim() && numero(form.teto) > 0 ? numero(form.teto) : null,
  };

  return (
    <div className="ma-pilha">
      {/* 1. O clube está pagando a conta? */}
      <div className="ma-hero">
        <div className="ma-hero-item">
          <div className="ma-hero-rotulo"><Crown size={15} color="#FACC15" /> Assinantes ativos</div>
          <div className="ma-hero-valor ouro">{n.ativos}</div>
          <div className="ma-hero-det">{n.pendentes > 0 ? `${n.pendentes} sem pagamento · ` : ""}{dados.config.ativo ? "clube ligado" : "clube desligado"}</div>
        </div>
        <div className="ma-hero-item">
          <div className="ma-hero-rotulo"><Wallet size={15} /> Mensalidades por mês</div>
          <div className="ma-hero-valor">{reais(n.mensalidades)}</div>
          <div className="ma-hero-det">{n.ativos} × {reais(dados.config.valor)} (antes das taxas da Cakto)</div>
        </div>
        <div className="ma-hero-item">
          <div className="ma-hero-rotulo"><Receipt size={15} /> Pedidos de assinantes no mês</div>
          <div className="ma-hero-valor">{n.pedidosNoMes}</div>
          <div className="ma-hero-det">{reais(n.faturamentoNoMes)} vendidos pelo app</div>
        </div>
        <div className="ma-hero-item">
          <div className="ma-hero-rotulo"><BadgePercent size={15} /> Desconto dado no mês</div>
          <div className="ma-hero-valor">{reais(n.descontoNoMes)}</div>
          <div className="ma-hero-det" style={{ color: saldo >= 0 ? "#86EFAC" : "#FCA5A5" }}>
            {saldo >= 0 ? `Mensalidades cobrem o desconto: sobra ${reais(saldo)}` : `Desconto passou as mensalidades em ${reais(-saldo)}`}
          </div>
        </div>
      </div>

      <div className="ma-grade-2">
        {/* 2. Configuração */}
        <div className="ma-cartao">
          <h2><Crown size={18} color="#CA8A04" /> O seu clube</h2>
          <p className="ma-cartao-sub">Um plano só: o cliente paga por mês e ganha o desconto em todo pedido feito pelo aplicativo. No site e no WhatsApp o preço não muda.</p>

          <label style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 800, fontSize: ".9rem", cursor: "pointer" }}>
            <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} style={{ width: 20, height: 20, accentColor: "#0F172A" }} />
            Mostrar o clube no aplicativo
          </label>

          <div className="ma-rotulo">Nome do clube <small>opcional</small></div>
          <input className="ma-campo" value={form.nome} placeholder={`Clube ${nomeDaLoja}`} maxLength={40} onChange={(e) => setForm({ ...form, nome: e.target.value })} />

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
            O desconto sai sobre os produtos (a entrega não entra), depois de cupom e prêmios. Com {String(previa.percentual).replace(".", ",")}%, o clube se paga para o cliente a partir de {reais(Math.ceil(previa.valor / (previa.percentual / 100)))} em pedidos no mês.
            A mensalidade aqui é só o que aparece no app: o preço cobrado é o do produto na Cakto. Use o mesmo valor.
          </p>

          <div className="ma-rotulo">Link do checkout da Cakto</div>
          <input className="ma-campo" value={form.link} placeholder="https://pay.cakto.com.br/…" onChange={(e) => setForm({ ...form, link: e.target.value })} />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 16 }}>
            <button className="ma-botao" disabled={salvando} onClick={() => salvar()}>{salvando ? "Salvando…" : "Salvar"}</button>
          </div>
        </div>

        {/* Como o cliente vê */}
        <div className="ma-cartao">
          <h2>Como aparece no app</h2>
          <p className="ma-cartao-sub">Logo abaixo do topo do cardápio, sem cobrir nada. Na sacola, quem não assina vê quanto economizaria naquele pedido.</p>
          <div style={{ background: "#F5F5F5", borderRadius: 14, padding: "4px 0 14px", border: "1px solid #E2E8F0", display: "grid", gap: 0 }}>
            <FaixaDoClube clube={previa} situacao="nao_assinante" pagoAte={null} onAbrir={() => {}} onPagar={() => {}} />
            <FaixaDoClube clube={previa} situacao="ativo" pagoAte={new Date(Date.now() + 20 * 86_400_000).toISOString()} onAbrir={() => {}} onPagar={() => {}} />
            <FaixaDoClube clube={previa} situacao="pendente" pagoAte={null} onAbrir={() => {}} onPagar={() => {}} />
          </div>
          <p className="ma-explica">De cima para baixo: quem ainda não assina, quem está pagando e quem ficou sem pagamento (continua pedindo normal, só sem o desconto).</p>
        </div>
      </div>

      {/* 3. Passo a passo da Cakto */}
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
          Marque “Mostrar o clube no aplicativo” e salve. Faça uma assinatura de teste com o seu número: em segundos ela aparece em Assinantes, logo abaixo.
        </p>
      </div>

      {/* 4. Assinantes */}
      <div className="ma-cartao">
        <h2><Users size={18} /> Assinantes</h2>
        {dados.assinantes.length === 0 ? (
          <div className="ma-vazio">
            <div className="ma-vazio-icone"><Crown size={22} /></div>
            <b>Ninguém assinou ainda</b>
            Assim que alguém pagar o clube pela Cakto, aparece aqui com a data do próximo pagamento.
          </div>
        ) : (
          <table className="ma-tabela">
            <thead>
              <tr><th>Cliente</th><th>Situação</th><th>Assina desde</th><th>Pago até</th><th>Pagamentos</th></tr>
            </thead>
            <tbody>
              {dados.assinantes.map((a) => {
                const r = ROTULO[a.situacao];
                return (
                  <tr key={a.id}>
                    <td>{a.nome}<div style={{ fontSize: ".74rem", color: "#94A3B8", fontWeight: 600 }}>{a.telefone}</div></td>
                    <td data-rotulo="Situação"><span className="ma-selo" style={{ color: r.cor, background: r.fundo }}>{r.texto}</span></td>
                    <td data-rotulo="Assina desde">{a.desde ? data(a.desde) : "—"}</td>
                    <td data-rotulo="Pago até">{a.pagoAte ? data(a.pagoAte) : "—"}</td>
                    <td data-rotulo="Pagamentos">{a.pagamentos}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
