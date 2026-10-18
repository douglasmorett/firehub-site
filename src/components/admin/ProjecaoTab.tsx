"use client";
import React, { useEffect, useState } from "react";
import type { ProjecaoDoMes, LinhaDaProjecao } from "@/lib/projecao-do-mes";
import type { Crescimento, Taxa } from "@/lib/projecao-de-crescimento-regras";

/**
 * Aba Projeção do admin: quanto o mês deve fechar de mensalidade e quem
 * precisa de uma ligação. Dados de /api/admin/projecao (lib/projecao-do-mes.ts).
 */

const fmt = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmt0 = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const qtd = (n: number) => Math.round(n).toLocaleString("pt-BR");
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const nomeDoMes = (ym: string) => MESES[Number(ym.slice(5, 7)) - 1] || ym;
const diaMes = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const dataCurta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "—");

const COR = "#E8360C";
const COR_PROJETADA = "#F9C4B4";

type Lista = "pararam" | "testeAcabando" | "cardapioSemVenda" | "semCardapio";

const SITUACAO: Record<LinhaDaProjecao["situacao"], { rotulo: string; classe: string }> = {
  PAGANDO: { rotulo: "Pagando", classe: "fha-badge-active" },
  TESTE_ACABA: { rotulo: "Teste acaba", classe: "fha-badge-trial" },
  SO_USO: { rotulo: "Mínimo sem venda", classe: "fha-badge-pending" },
};

function BotaoWhatsapp({ numero, texto }: { numero: string | null; texto: string }) {
  if (!numero) return <span style={{ color: "#94A3B8", fontSize: "0.74rem" }}>sem telefone</span>;
  return (
    <a className="fha-btn" href={`https://wa.me/${numero}?text=${encodeURIComponent(texto)}`} target="_blank" rel="noreferrer">
      💬 WhatsApp
    </a>
  );
}

export default function ProjecaoTab() {
  const [dados, setDados] = useState<ProjecaoDoMes | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [lista, setLista] = useState<Lista>("pararam");
  const [filtro, setFiltro] = useState<"todas" | LinhaDaProjecao["situacao"]>("todas");
  const [mostrarTudo, setMostrarTudo] = useState(false);
  const [diaEmFoco, setDiaEmFoco] = useState<number | null>(null);

  const carregar = async () => {
    setCarregando(true);
    setErro(null);
    try {
      const r = await fetch("/api/admin/projecao", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error || `Erro ${r.status}`);
      setDados(j);
    } catch (e: any) {
      setErro(e?.message || "Não deu para carregar a projeção");
    } finally {
      setCarregando(false);
    }
  };
  useEffect(() => { carregar(); }, []);

  if (!dados) {
    return (
      <div className="fha-section" style={{ padding: 28, color: erro ? "#B91C1C" : "#64748B" }}>
        {erro ? <>Não deu para carregar a projeção: {erro} <button className="fha-btn" onClick={carregar} style={{ marginLeft: 8 }}>Tentar de novo</button></>
          : "Somando as vendas do mês…"}
      </div>
    );
  }

  const { totais, linhas, vendasDoMes, dias, mesPassado, contatos, regras } = dados;
  const mes = nomeDoMes(dados.mes);
  const vendendo = linhas.filter((l) => l.chance >= 1);

  // De onde vem a mensalidade: os grupos que a aposta pesa diferente.
  const grupos = [
    { rotulo: "Pagando e vendendo", f: (l: LinhaDaProjecao) => l.situacao === "PAGANDO" && l.chance >= 1 },
    { rotulo: "Pagando, mas parou de vender", f: (l: LinhaDaProjecao) => l.situacao === "PAGANDO" && l.chance < 1 },
    { rotulo: "Teste acaba · vende mais de R$ 10 mil", f: (l: LinhaDaProjecao) => l.situacao === "TESTE_ACABA" && l.faixa === "GRANDE" },
    { rotulo: "Teste acaba · R$ 2–10 mil", f: (l: LinhaDaProjecao) => l.situacao === "TESTE_ACABA" && l.faixa === "MEDIA" },
    { rotulo: "Teste acaba · menos de R$ 2 mil", f: (l: LinhaDaProjecao) => l.situacao === "TESTE_ACABA" && l.faixa === "PEQUENA" },
    { rotulo: "Mínimo sem ter vendido", f: (l: LinhaDaProjecao) => l.situacao === "SO_USO" },
  ].map((g) => {
    const ls = linhas.filter(g.f);
    return { ...g, lojas: ls.length, seTodas: ls.reduce((s, l) => s + l.total, 0), aposta: ls.reduce((s, l) => s + l.total * l.chance, 0), chance: ls[0]?.chance ?? 0 };
  }).filter((g) => g.lojas > 0);
  const maiorGrupo = Math.max(1, ...grupos.map((g) => g.seTodas));

  const maiorDia = Math.max(1, ...dias.map((d) => d.valor));
  const foco = diaEmFoco !== null ? dias[diaEmFoco] : null;

  const linhasFiltradas = filtro === "todas" ? linhas : linhas.filter((l) => l.situacao === filtro);

  const LISTAS: { key: Lista; rotulo: string; n: number; dica: string }[] = [
    { key: "pararam", rotulo: "Pararam de vender", n: contatos.pararam.length, dica: `Vendiam e estão há ${regras.diasParaLigar} dias ou mais sem pedido (até 45 dias). Vermelho = ${regras.diasParaParada}+ dias.` },
    { key: "testeAcabando", rotulo: "Teste acabando", n: contatos.testeAcabando.length, dica: `Já venderam e o teste acaba em até ${regras.diasDoFimDoTeste} dias: hora de mostrar o valor antes do primeiro boleto.` },
    { key: "cardapioSemVenda", rotulo: "Cardápio pronto, nunca vendeu", n: contatos.cardapioSemVenda.length, dica: "Montaram o cardápio e não receberam nenhum pedido: oferecer a integração que falta." },
    { key: "semCardapio", rotulo: "Sem cardápio", n: contatos.semCardapio.length, dica: "Cadastraram e não montaram o cardápio: oferecer montar a loja." },
  ];
  const listaAtual = LISTAS.find((l) => l.key === lista)!;
  const LIMITE = 40;

  return (
    <>
      <style>{`
        .pj-grid2 { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 14px; margin-bottom: 24px; }
        @media (max-width: 1000px) { .pj-grid2 { grid-template-columns: minmax(0, 1fr); } }
        .pj-nota { font-size: 0.76rem; color: #64748B; line-height: 1.5; }
        .pj-pill { border: 1px solid #E2E8F0; background: #FFFFFF; color: #334155; padding: 6px 12px; border-radius: 999px; font-size: 0.78rem; font-weight: 700; cursor: pointer; font-family: inherit; }
        .pj-pill.on { background: #0B0B0C; color: #FFFFFF; border-color: #0B0B0C; }
        .pj-num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        .pj-tabela { overflow-x: auto; }
        .pj-dia { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: stretch; height: 100%; cursor: default; padding: 0 1px; }
        .pj-dia > div { border-radius: 4px 4px 0 0; min-height: 2px; }
        .pj-dividido { display: flex; flex-wrap: wrap; gap: 8px 0; margin-top: 4px; }
        .pj-dividido > div { flex: 1 1 110px; min-width: 0; }
        .pj-dividido > div + div { border-left: 1px solid #E5E7EB; padding-left: 12px; margin-left: 12px; }
        .pj-meia-lbl { font-size: 0.66rem; color: #94A3B8; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 700; }
        .pj-meia-val { font-size: 1.3rem; font-weight: 900; letter-spacing: -0.4px; font-variant-numeric: tabular-nums; }
      `}</style>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div className="pj-nota">
          Mensalidade de <b>{mes}</b>: o que cada loja já vendeu depois do teste + o ritmo dos últimos 7 dias até o fim do mês, pela mesma conta do boleto.
          Atualizado às {new Date(dados.geradoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}.
        </div>
        <button className="fha-btn" onClick={carregar} disabled={carregando}>{carregando ? "Atualizando…" : "↻ Atualizar"}</button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 24 }}>
        {[
          { label: `Aposta para ${mes}`, val: fmt0(totais.aposta), sub: `entre ${fmt0(totais.garantido)} e ${fmt0(totais.seTodas)}`, color: COR },
          { label: "Já garantido", val: fmt0(totais.garantido), sub: `${vendendo.length} lojas pagando e vendendo`, color: "#15803D" },
          { label: "Se todas pagarem", val: fmt0(totais.seTodas), sub: `${linhas.length} boletos previstos`, color: "#0F172A" },
          // O mesmo quadrado mostra valor e transações (pedidos não cancelados) — a meta de transações do Pix.
          { label: "Vendas pelo sistema", val: fmt0(vendasDoMes.ateAgora), sub: `deve fechar em ${fmt0(vendasDoMes.projetado)}`, color: "#0F172A",
            transacoes: {
              ateAgora: vendasDoMes.pedidosAteAgora, projetado: vendasDoMes.pedidosProjetados,
              proprios: vendasDoMes.propriosAteAgora, propriosProjetados: vendasDoMes.propriosProjetados,
            } },
          { label: `${nomeDoMes(dados.mesSeguinte)} no ritmo de hoje`, val: fmt0(dados.mesSeguinteNoRitmo), sub: "mês cheio, todas fora do teste", color: "#0F172A" },
        ].map((k: { label: string; val: string; sub: string; color: string; transacoes?: { ateAgora: number; projetado: number; proprios: number; propriosProjetados: number } }) => (
          <div key={k.label} className="fha-kpi">
            <div className="fha-kpi-lbl">{k.label}</div>
            {k.transacoes ? (
              <div className="pj-dividido">
                <div>
                  <div className="pj-meia-lbl">Valor</div>
                  <div className="pj-meia-val" style={{ color: k.color }}>{k.val}</div>
                  <div className="fha-kpi-sub">{k.sub}</div>
                </div>
                <div>
                  <div className="pj-meia-lbl">Transações</div>
                  <div className="pj-meia-val" style={{ color: k.color }}>{qtd(k.transacoes.ateAgora)}</div>
                  <div className="fha-kpi-sub">deve fechar em {qtd(k.transacoes.projetado)}</div>
                  <div className="fha-kpi-sub" title="Site, robô do WhatsApp e totem: o que passaria pela Tuna. iFood, 99, Brendi e balcão ficam de fora.">
                    canal próprio: <b>{qtd(k.transacoes.proprios)}</b> → {qtd(k.transacoes.propriosProjetados)}
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="fha-kpi-val" style={{ color: k.color }}>{k.val}</div>
                <div className="fha-kpi-sub">{k.sub}</div>
              </>
            )}
          </div>
        ))}
      </div>

      <div className="pj-grid2">
        {/* Vendas por dia: realizado + projetado */}
        <div className="fha-section" style={{ padding: "18px 20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
            <h3 style={{ color: "#0F172A", fontWeight: 800, margin: 0, fontSize: "0.95rem" }}>Vendas pelo sistema, por dia</h3>
            <div className="pj-nota" style={{ display: "flex", gap: 12 }}>
              <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: COR, marginRight: 5 }} />vendido</span>
              <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: COR_PROJETADA, marginRight: 5 }} />ritmo dos últimos 7 dias</span>
            </div>
          </div>
          <div className="pj-nota" style={{ minHeight: 20, color: "#334155" }}>
            {foco ? <><b>{diaMes(foco.dia)}</b> · {fmt0(foco.valor)} {foco.tipo === "projetado" ? "(projetado)" : foco.tipo === "hoje" ? "(hoje, até agora)" : ""}</>
              : <>Média de {fmt0(vendasDoMes.porDia)} por dia nos últimos 7 dias, todas as lojas.</>}
          </div>
          <div style={{ display: "flex", alignItems: "flex-end", height: 150, borderBottom: "1px solid #E5E7EB", marginTop: 6 }} onMouseLeave={() => setDiaEmFoco(null)}>
            {dias.map((d, i) => (
              <div key={d.dia} className="pj-dia" onMouseEnter={() => setDiaEmFoco(i)} title={`${diaMes(d.dia)}: ${fmt0(d.valor)}`}>
                {/* Hoje: o que falta para o ritmo, em cima do vendido até agora. */}
                {d.tipo === "hoje" && vendasDoMes.porDia > d.valor && (
                  <div style={{ height: `${((vendasDoMes.porDia - d.valor) / maiorDia) * 100}%`, background: COR_PROJETADA, borderRadius: d.valor > 0 ? "4px 4px 0 0" : undefined, marginBottom: 1 }} />
                )}
                <div style={{
                  height: `${Math.max(1.5, (d.valor / maiorDia) * 100)}%`,
                  background: d.tipo === "projetado" ? COR_PROJETADA : COR,
                  opacity: diaEmFoco === null || diaEmFoco === i ? 1 : 0.55,
                }} />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }} className="pj-nota">
            {dias.filter((_, i) => i % 5 === 0).map((d) => <span key={d.dia}>{diaMes(d.dia)}</span>)}
          </div>
        </div>

        {/* De onde vem a mensalidade */}
        <div className="fha-section" style={{ padding: "18px 20px" }}>
          <h3 style={{ color: "#0F172A", fontWeight: 800, margin: "0 0 4px", fontSize: "0.95rem" }}>De onde vem a mensalidade</h3>
          <div className="pj-nota" style={{ marginBottom: 12 }}>Barra = se todas pagarem · número = aposta (chance de pagar)</div>
          {grupos.map((g) => (
            <div key={g.rotulo} style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: "0.8rem", color: "#334155", marginBottom: 4 }}>
                <span><b>{g.rotulo}</b> <span style={{ color: "#94A3B8" }}>· {g.lojas} {g.lojas === 1 ? "loja" : "lojas"} · {Math.round(g.chance * 100)}%</span></span>
                <span className="pj-num"><b>{fmt0(g.aposta)}</b> <span style={{ color: "#94A3B8" }}>de {fmt0(g.seTodas)}</span></span>
              </div>
              <div style={{ height: 8, background: "#F1F5F9", borderRadius: 4 }}>
                <div style={{ height: 8, width: `${(g.seTodas / maiorGrupo) * 100}%`, background: COR_PROJETADA, borderRadius: 4, position: "relative" }}>
                  <div style={{ position: "absolute", inset: 0, width: `${g.chance * 100}%`, background: COR, borderRadius: 4 }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <MesQueVemComCrescimento c={dados.crescimento} mes={dados.mes} mesSeguinte={dados.mesSeguinte} noRitmo={dados.mesSeguinteNoRitmo} />

      {/* Mês passado */}
      <div className="fha-section" style={{ marginBottom: 24 }}>
        <div className="fha-section-head">
          <h3>Boletos de {nomeDoMes(mesPassado.mes)}</h3>
          <div className="pj-nota">
            <b style={{ color: "#15803D" }}>{fmt(mesPassado.recebido)}</b> recebidos de {mesPassado.lojasPagas} {mesPassado.lojasPagas === 1 ? "loja" : "lojas"}
            {" · "}<b style={{ color: "#B91C1C" }}>{fmt(mesPassado.emAberto)}</b> em aberto
            {mesPassado.perdoadas > 0 && <> · {mesPassado.perdoadas} perdoada{mesPassado.perdoadas > 1 ? "s" : ""}</>}
          </div>
        </div>
        {mesPassado.lojasEmAberto.length > 0 && (
          <div className="pj-tabela">
            <table className="fha-table">
              <thead><tr><th>Loja</th><th className="pj-num">Em aberto</th><th>Asaas</th><th>Último pedido</th><th></th></tr></thead>
              <tbody>
                {mesPassado.lojasEmAberto.map((c) => (
                  <tr key={c.id}>
                    <td style={{ fontWeight: 700, color: "#0F172A" }}>{c.loja}</td>
                    <td className="pj-num">{fmt(c.valor)}</td>
                    <td>{c.asaas === "OVERDUE" ? <span className="fha-badge fha-badge-pending">Vencido</span> : <span className="fha-badge fha-badge-exempt">{c.asaas || "—"}</span>}</td>
                    <td>{c.diasSemPedido === null ? "nunca" : c.diasSemPedido === 0 ? "hoje" : `há ${c.diasSemPedido} dias`}</td>
                    <td><BotaoWhatsapp numero={c.whatsapp} texto={`Olá! Aqui é do FireHub. A mensalidade de ${nomeDoMes(mesPassado.mes)} da ${c.loja} está em aberto (${fmt(c.valor)}). Posso te mandar o link do boleto?`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Para ligar */}
      <div className="fha-section" style={{ marginBottom: 24 }}>
        <div className="fha-section-head"><h3>Para entrar em contato</h3></div>
        <div style={{ padding: "12px 18px", display: "flex", gap: 6, flexWrap: "wrap", borderBottom: "1px solid #EEF0F3" }}>
          {LISTAS.map((l) => (
            <button key={l.key} className={`pj-pill${lista === l.key ? " on" : ""}`} onClick={() => { setLista(l.key); setMostrarTudo(false); }}>
              {l.rotulo} ({l.n})
            </button>
          ))}
        </div>
        <div className="pj-nota" style={{ padding: "10px 18px" }}>{listaAtual.dica}</div>
        <div className="pj-tabela">
          {lista === "pararam" && (
            <table className="fha-table">
              <thead><tr><th>Loja</th><th>Sem pedido</th><th>Último pedido</th><th className="pj-num">Vendia por semana</th><th className="pj-num">Pedidos (30 dias)</th><th>Vendedor</th><th></th></tr></thead>
              <tbody>
                {(mostrarTudo ? contatos.pararam : contatos.pararam.slice(0, LIMITE)).map((c) => (
                  <tr key={c.id}>
                    <td><div style={{ fontWeight: 700, color: "#0F172A" }}>{c.loja}</div><div className="pj-nota">{c.cidade || ""}{c.isenta ? " · isenta" : ""}</div></td>
                    <td><span className={`fha-badge ${c.parada ? "fha-badge-pending" : "fha-badge-trial"}`}>{c.diasSemPedido} dias</span></td>
                    <td>{dataCurta(c.ultimoPedido)}</td>
                    <td className="pj-num">{fmt0(c.porSemana30d)}</td>
                    <td className="pj-num">{c.pedidos30d}</td>
                    <td>{c.vendedor || <span style={{ color: "#94A3B8" }}>—</span>}</td>
                    <td><BotaoWhatsapp numero={c.whatsapp} texto={`Olá! Aqui é do FireHub. Vi que a ${c.loja} não recebe pedido pelo sistema desde ${dataCurta(c.ultimoPedido)}. Aconteceu alguma coisa? Posso ajudar?`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {lista === "testeAcabando" && (
            <table className="fha-table">
              <thead><tr><th>Loja</th><th>Teste acaba</th><th className="pj-num">Vendido no mês</th><th>Último pedido</th><th>Vendedor</th><th></th></tr></thead>
              <tbody>
                {(mostrarTudo ? contatos.testeAcabando : contatos.testeAcabando.slice(0, LIMITE)).map((c) => (
                  <tr key={c.id}>
                    <td><div style={{ fontWeight: 700, color: "#0F172A" }}>{c.loja}</div><div className="pj-nota">{c.cidade || ""}</div></td>
                    <td><span className="fha-badge fha-badge-trial">{dataCurta(c.testeAte)} · {c.diasRestantes}d</span></td>
                    <td className="pj-num">{fmt0(c.vendidoNoMes)}</td>
                    <td>{c.diasSemPedido === null ? "nunca" : c.diasSemPedido === 0 ? "hoje" : `há ${c.diasSemPedido} dias`}</td>
                    <td>{c.vendedor || <span style={{ color: "#94A3B8" }}>—</span>}</td>
                    <td><BotaoWhatsapp numero={c.whatsapp} texto={`Olá! Aqui é do FireHub. O teste da ${c.loja} termina em ${dataCurta(c.testeAte)}. Como está sendo usar o sistema? Ficou alguma dúvida?`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {lista === "cardapioSemVenda" && (
            <table className="fha-table">
              <thead><tr><th>Loja</th><th>Cadastro</th><th className="pj-num">Produtos</th><th>Ligado</th><th>Falta</th><th>Vendedor</th><th></th></tr></thead>
              <tbody>
                {(mostrarTudo ? contatos.cardapioSemVenda : contatos.cardapioSemVenda.slice(0, LIMITE)).map((c) => (
                  <tr key={c.id}>
                    <td><div style={{ fontWeight: 700, color: "#0F172A" }}>{c.loja}</div><div className="pj-nota">{c.cidade || ""}{c.contaDe ? ` · loja extra de ${c.contaDe}` : ""}</div></td>
                    <td>há {c.cadastroHaDias} dias</td>
                    <td className="pj-num">{c.produtos}</td>
                    <td>{c.ligadas.length ? c.ligadas.join(", ") : <span style={{ color: "#94A3B8" }}>nada</span>}</td>
                    <td style={{ color: "#B45309", fontWeight: 700 }}>{c.faltam.join(", ") || "—"}</td>
                    <td>{c.vendedor || <span style={{ color: "#94A3B8" }}>—</span>}</td>
                    <td><BotaoWhatsapp numero={c.whatsapp} texto={`Olá! Aqui é do FireHub. O cardápio da ${c.loja} já está pronto no sistema. Quer ajuda para ligar ${c.faltam.length ? c.faltam.join(", ") : "as integrações"} e começar a receber pedidos?`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {lista === "semCardapio" && (
            <table className="fha-table">
              <thead><tr><th>Loja</th><th>Cadastro</th><th>Teste até</th><th>Vendedor</th><th></th></tr></thead>
              <tbody>
                {(mostrarTudo ? contatos.semCardapio : contatos.semCardapio.slice(0, LIMITE)).map((c) => (
                  <tr key={c.id}>
                    <td><div style={{ fontWeight: 700, color: "#0F172A" }}>{c.loja}</div><div className="pj-nota">{c.cidade || ""}{c.contaDe ? ` · loja extra de ${c.contaDe}` : ""}</div></td>
                    <td>{c.cadastroHaDias === 0 ? "hoje" : `há ${c.cadastroHaDias} dias`}</td>
                    <td>{dataCurta(c.testeAte)}</td>
                    <td>{c.vendedor || <span style={{ color: "#94A3B8" }}>—</span>}</td>
                    <td><BotaoWhatsapp numero={c.whatsapp} texto={`Olá! Aqui é do FireHub. Vi que você criou a conta da ${c.loja} e o cardápio ainda está vazio. Quer que a gente monte o cardápio para você?`} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {listaAtual.n > LIMITE && !mostrarTudo && (
          <div style={{ padding: "12px 18px" }}><button className="fha-btn" onClick={() => setMostrarTudo(true)}>Mostrar todas as {listaAtual.n}</button></div>
        )}
        {listaAtual.n === 0 && <div className="pj-nota" style={{ padding: "4px 18px 16px" }}>Ninguém nesta lista agora.</div>}
      </div>

      {/* Loja a loja */}
      <div className="fha-section" style={{ marginBottom: 24 }}>
        <div className="fha-section-head">
          <h3>Mensalidade prevista por loja <span style={{ color: "#94A3B8", fontWeight: 500 }}>({linhasFiltradas.length})</span></h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {([["todas", "Todas"], ["PAGANDO", "Pagando"], ["TESTE_ACABA", "Teste acaba"], ["SO_USO", "Mínimo sem venda"]] as const).map(([k, r]) => (
              <button key={k} className={`pj-pill${filtro === k ? " on" : ""}`} onClick={() => setFiltro(k)}>{r}</button>
            ))}
          </div>
        </div>
        <div className="pj-tabela">
          <table className="fha-table">
            <thead>
              <tr>
                <th>Loja</th><th>Situação</th><th className="pj-num">Vendido no mês</th><th className="pj-num">Ritmo/dia</th>
                <th className="pj-num">Base projetada</th><th className="pj-num">Mensalidade</th><th className="pj-num">Extras</th>
                <th className="pj-num">Boleto previsto</th><th className="pj-num">Chance</th>
              </tr>
            </thead>
            <tbody>
              {linhasFiltradas.map((l) => (
                <tr key={l.id}>
                  <td><div style={{ fontWeight: 700, color: "#0F172A" }}>{l.loja}</div><div className="pj-nota">{l.porque}</div></td>
                  <td>
                    <span className={`fha-badge ${SITUACAO[l.situacao].classe}`}>{SITUACAO[l.situacao].rotulo}</span>
                    {l.situacao === "TESTE_ACABA" && <div className="pj-nota">até {dataCurta(l.testeAte)}</div>}
                  </td>
                  <td className="pj-num">{fmt0(l.vendidoNoMes)}</td>
                  <td className="pj-num">{fmt0(l.porDia)}</td>
                  <td className="pj-num">{fmt0(l.baseProjetada)}</td>
                  <td className="pj-num">{fmt(l.mensalidade)}</td>
                  <td className="pj-num">{l.extras + l.taxas > 0 ? fmt(l.extras + l.taxas) : "—"}</td>
                  <td className="pj-num" style={{ fontWeight: 800, color: "#0F172A" }}>{fmt(l.total)}</td>
                  <td className="pj-num">{Math.round(l.chance * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="pj-nota" style={{ marginBottom: 24 }}>
        <b>Como a conta é feita.</b> Base = valor bruto dos pedidos (cupons somados de volta), sem rascunho da IA nem totem não pago; cancelado conta desde 04/10/2026;
        venda durante o teste não conta. 2% (vendas de 01 a 03/10/2026 a 1%), mínimo R$ 100, teto R$ 400; cada loja extra de iFood/99 soma R$ 50.
        Lojas isentas (Hakim, parceiros) ficam fora. "Mínimo sem venda" é quem saiu do teste, não vendeu e usou o sistema — o fechamento cobra o mínimo.
        A chance de pagar são pesos fixos, não estatística: 100% quem já paga e vende; 50% quem já paga e parou há {regras.diasParaParada}+ dias;
        teste acabando 80% (vende mais de R$ 10 mil/mês), 50% (R$ 2–10 mil), 25% (menos); mínimo sem venda 25%.
      </div>
    </>
  );
}

const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: v < 0.1 ? 1 : 0 })}%`;
const num = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: v < 10 ? 1 : 0 });
const deTaxa = (t: Taxa) => (t.n ? `${t.s} de ${t.n} · faixa de ${pct(t.min)} a ${pct(t.max)}` : "sem loja para medir");
const maiuscula = (s: string) => s[0].toUpperCase() + s.slice(1);
const somarUmMes = (ym: string, n: number) => {
  const t = Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`;
};

/**
 * "Mês que vem se mantiver o padrão" (lib/projecao-de-crescimento-regras.ts):
 * o número principal é o mês atual menos a perda do último mês mais a receita
 * nova de novo (e a mesma conta nos últimos 30 dias); embaixo, o conservador
 * pela conversão do teste, loja a loja, com a conta escrita na tela.
 */
function MesQueVemComCrescimento({ c, mes, mesSeguinte, noRitmo }: { c: Crescimento; mes: string; mesSeguinte: string; noRitmo: number }) {
  const [cenario, setCenario] = useState<"igual" | "media">("igual");
  const [mesEmFoco, setMesEmFoco] = useState<number | null>(null);
  const atual = nomeDoMes(mes), seguinte = nomeDoMes(mesSeguinte);
  const { taxas, ritmoDeCadastro: rc, partes, cenarios, mesmoPadrao: mp } = c;
  const cr = mp.crescimento;
  const anterior = nomeDoMes(somarUmMes(mes, -1));
  const naMedia = cenario === "media" && !!cenarios.media;
  const usado = naMedia ? cenarios.media! : cenarios.igual;
  const t = cenarios.taxasUsadas;
  const mesesDaMedia = rc.mesesDaMedia.length === 0 ? ""
    : rc.mesesDaMedia.length === 1 ? nomeDoMes(rc.mesesDaMedia[0])
      : `${nomeDoMes(rc.mesesDaMedia[0]).slice(0, 3)}–${nomeDoMes(rc.mesesDaMedia[rc.mesesDaMedia.length - 1]).slice(0, 3)}`;

  const contas = [
    {
      rotulo: "Lojas pagando e vendendo hoje",
      linha: `${fmt0(partes.pagantesNoRitmo.valor)} (${partes.pagantesNoRitmo.lojas} lojas, mês cheio no ritmo dos últimos 7 dias) − ${pct(t.perda)} de perda (em lojas, contando as paradas)`,
      valor: usado.base,
      detalhe: <>Perda mensal: das lojas com boleto num mês, as que não tiveram boleto no mês seguinte (para {atual}: sem boleto previsto vendendo, ou paradas há 7+ dias) — {deTaxa(taxas.perda)}, em {taxas.perda.meses} {taxas.perda.meses === 1 ? "mês medido" : "meses medidos"}. Saem {fmt0(usado.perdido)}.</>,
    },
    {
      rotulo: "Em teste e já vendendo",
      linha: `${fmt0(partes.emTesteVendendo.valor)} (${partes.emTesteVendendo.lojas} lojas, só os dias de ${seguinte} depois do teste) × ${pct(t.convVendeu)} que viram pagantes`,
      valor: usado.testeVendendo,
      detalhe: <>Das contas que venderam durante o teste e já saíram dele, as que viraram pagantes: {deTaxa(taxas.convVendeu)}. No mês cheio essas lojas fariam {fmt0(partes.emTesteVendendo.valorMesCheio)}; o teste come o começo de {seguinte}.</>,
    },
    {
      rotulo: "Em teste sem venda",
      linha: `${partes.emTesteSemVenda} lojas × ${pct(t.convNaoVendeu)} viram pagantes × ${fmt0(t.mensalidadeNova)} de mensalidade da nova`,
      valor: usado.testeSemVenda,
      detalhe: <>Contas em teste, sem pedido nos últimos 7 dias, cujo teste acaba antes do fim de {seguinte}. Das que saíram do teste sem ter vendido nele, viraram pagantes: {deTaxa(taxas.convNaoVendeu)}.</>,
    },
    {
      rotulo: `Contas novas de ${seguinte}`,
      linha: `${num(usado.cadastros)} cadastros × ${pct(c.fracaoNoMes)} saem do teste no mês × ${pct(t.convCadastro)} viram pagantes × ${fmt0(t.mensalidadeNova)} ≈ ${num(usado.novasLojas)} lojas`,
      valor: usado.novas,
      detalhe: <>
        Cadastros: {naMedia ? `média de ${mesesDaMedia} (${num(rc.media!)} por mês)` : `o ritmo de ${atual} (${num(rc.ateAgora)} até agora, ${num(rc.porDia)} por dia) × ${rc.diasDoSeguinte} dias`}.
        {" "}Teste típico de {c.diasDeTeste} dias: quem se cadastra depois do dia {Math.max(1, rc.diasDoSeguinte - c.diasDeTeste)} só paga no mês seguinte.
        {" "}Conversão cadastro→pagante das contas que já saíram do teste: {deTaxa(taxas.convCadastro)}.
        {" "}Mensalidade da nova no 1º mês pago (pela conta do boleto de {seguinte}): {taxas.mensalidadeNova.reserva ? "nenhuma conta nova pagou ainda, vale o mínimo" : `média de ${taxas.mensalidadeNova.n} contas`} — {fmt(t.mensalidadeNova)}.
      </>,
    },
  ];

  // Gráfico: boletos por mês (real), o previsto deste mês e o projetado do próximo.
  const barras = [
    ...c.serie.map((s) => ({ mes: s.mes, valor: s.tipo === "previsto" ? s.seTodas : s.cobrado, aposta: s.cobrado, pagantes: s.boletos, tipo: s.tipo as "real" | "previsto" | "projetado", faixa: null as null | [number, number] })),
    { mes: mesSeguinte, valor: mp.doMes.total, aposta: mp.doMes.totalAposta, pagantes: mp.mesAtual.boletos - mp.doMes.lojasPerdidas + mp.doMes.lojasNovas + mp.doMes.lojasFicam, tipo: "projetado" as const, faixa: [mp.faixa.min, mp.faixa.max] as [number, number] },
  ];
  const maior = Math.max(1, ...barras.map((b) => Math.max(b.valor, b.faixa?.[1] ?? 0)));
  const foco = mesEmFoco !== null ? barras[mesEmFoco] : null;
  const ALTURA = 150;
  // Funil: os meses vazios antes do primeiro cadastro viram uma linha só.
  const primeiroComCadastro = c.funil.findIndex((f) => f.cadastros > 0);
  const vazios = primeiroComCadastro > 0 ? c.funil.slice(0, primeiroComCadastro) : [];
  const mesesDoFunil = c.funil.slice(Math.max(0, primeiroComCadastro)).reverse();
  const desde = nomeDoMes(c.funil[Math.max(0, primeiroComCadastro)].mes);

  return (
    <div className="fha-section" style={{ marginBottom: 24 }}>
      <style>{`
        .pj-conta { padding: 10px 0; border-bottom: 1px solid #F1F3F5; }
        .pj-conta summary { cursor: pointer; list-style: none; display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 14px; }
        .pj-conta summary::-webkit-details-marker { display: none; }
        .pj-conta[open] .pj-seta { transform: rotate(180deg); }
        .pj-seta { display: inline-block; color: #94A3B8; font-weight: 500; transition: transform .15s; }
        .pj-mes { flex: 1; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; height: 100%; position: relative; min-width: 0; cursor: default; }
        .pj-mes .barra { width: 70%; max-width: 64px; border-radius: 4px 4px 0 0; min-height: 2px; box-sizing: border-box; }
      `}</style>
      <div className="fha-section-head">
        <h3>{maiuscula(seguinte)} se mantiver o padrão</h3>
      </div>
      <div style={{ padding: "14px 18px" }}>
        {/* Quanto este mês cresceu sobre o que entrou de verdade no mês passado. */}
        <div style={{ background: "#F8FAFC", border: "1px solid #EEF0F3", borderRadius: 10, padding: "10px 12px", fontSize: "0.82rem", color: "#334155", marginBottom: 12, lineHeight: 1.6 }}>
          <b>{maiuscula(anterior)}:</b> {fmt0(cr.recebido)} recebidos de {cr.lojasPagas} {cr.lojasPagas === 1 ? "loja" : "lojas"}
          {cr.boletosEmAberto > 0 && <> <span style={{ color: "#64748B" }}>(+ {fmt0(cr.emAberto)} em aberto em {cr.boletosEmAberto} {cr.boletosEmAberto === 1 ? "boleto" : "boletos"} — a inadimplência esperada, fora da conta)</span></>}
          {" → "}<b>{maiuscula(atual)}:</b> {fmt0(mp.mesAtual.seTodas)} se todas pagarem{cr.vezesSeTodas !== null && <> = <b>{num(cr.vezesSeTodas)}x</b> o recebido</>}
          {" · "}{fmt0(mp.mesAtual.aposta)} na aposta{cr.vezesAposta !== null && <> = <b>{num(cr.vezesAposta)}x</b></>}.
        </div>
        {c.historicoCurto && (
          <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", color: "#92400E", borderRadius: 10, padding: "9px 12px", fontSize: "0.78rem", marginBottom: 14, lineHeight: 1.5 }}>
            <b>Histórico curto:</b> {c.historicoCurto.join("; ")}. Os números são ordem de grandeza — por isso a faixa é larga.
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, marginBottom: 14 }}>
          {[
            { label: "Mesmo padrão do último mês", val: fmt0(mp.doMes.total), sub: `na aposta ${fmt0(mp.doMes.totalAposta)}`, on: true },
            { label: "Ritmo dos últimos 30 dias", val: fmt0(mp.de30dias.total), sub: `na aposta ${fmt0(mp.de30dias.totalAposta)}`, on: false },
            { label: "Conservador (conversão do teste)", val: fmt0(cenarios.igual.total), sub: "a conta por coorte, mais abaixo", on: false },
            { label: "Faixa", val: `${fmt0(mp.faixa.min)} – ${fmt0(mp.faixa.max)}`, sub: "do menor ao maior cenário (aposta e conservador inclusos)", on: false },
          ].map((k) => (
            <div key={k.label} className="fha-kpi" style={k.on ? { borderColor: COR } : undefined}>
              <div className="fha-kpi-lbl">{k.label}</div>
              <div className="fha-kpi-val" style={{ color: k.on ? COR : "#0F172A", fontSize: k.label === "Faixa" ? "1.3rem" : undefined }}>{k.val}</div>
              <div className="fha-kpi-sub">{k.sub}</div>
            </div>
          ))}
        </div>

        {/* A conta do número principal, uma linha cada, com o detalhe ao abrir. */}
        <div style={{ marginBottom: 18 }}>
          {[
            { rotulo: "Mesmo padrão do último mês", l: mp.doMes, de: `o mesmo que entrou em ${atual}`,
              perdaDe: `das ${mp.doMes.lojasAnteriores} lojas com boleto em ${anterior}, ${mp.doMes.lojasPerdidas} não têm boleto em ${atual}`,
              novaDe: `${mp.doMes.lojasNovas} lojas com o 1º boleto em ${atual} (inclui quem sai do teste até o fim do mês)`,
              ficamDe: `lojas em teste vendendo constante cujo teste só acaba em ${seguinte} — sem boleto em ${atual}, ficariam de fora` },
            { rotulo: "Ritmo dos últimos 30 dias", l: mp.de30dias, de: "o que entrou nos últimos 30 dias",
              perdaDe: `das ${mp.de30dias.lojasAnteriores} lojas com boleto em ${anterior}, ${mp.de30dias.lojasPerdidas} sem boleto em ${atual} ou paradas há 7+ dias agora`,
              novaDe: `${mp.de30dias.lojasNovas} lojas que começaram a pagar (saíram do teste) nos últimos 30 dias`,
              ficamDe: `todas as lojas em teste vendendo constante, pela mensalidade de ${seguinte} no ritmo` },
          ].map((k) => (
            <details key={k.rotulo} className="pj-conta">
              <summary>
                <span style={{ fontWeight: 700, color: "#0F172A", fontSize: "0.84rem" }}>{k.rotulo} <span className="pj-seta">▾</span></span>
                <span className="pj-num" style={{ fontWeight: 800, color: "#0F172A" }}>{fmt0(k.l.total)}</span>
                <span className="pj-nota" style={{ gridColumn: "1 / -1" }}>
                  {maiuscula(atual)} {fmt0(mp.mesAtual.seTodas)} − perda {pct(k.l.perda)} + {fmt0(k.l.nova)} de lojas novas ({k.de})
                  {k.l.lojasFicam > 0 && <> + {fmt0(k.l.ficam)} de {k.l.lojasFicam} {k.l.lojasFicam === 1 ? "loja" : "lojas"} em teste vendendo constante</>} = <b>{fmt0(k.l.total)}</b>
                </span>
              </summary>
              <div className="pj-nota" style={{ marginTop: 6, background: "#F8FAFC", borderRadius: 8, padding: "8px 10px", color: "#334155" }}>
                {maiuscula(seguinte)} = {atual} × (1 − perda) + receita nova + lojas em teste que ficam. Perda: {k.perdaDe} — {fmt0(k.l.perdido)} de {fmt0(k.l.anterior)}.
                {" "}Receita nova: {k.novaDe}.
                {" "}Ficam ({fmt0(k.l.ficam)}): {k.ficamDe}. Vendendo constante = em teste, pedido nos últimos 7 dias e 10+ pedidos em 30 dias (o &quot;teste ativado&quot; do perfil da loja); em teste sem venda, parada ou com poucas vendas fica fora — só o conservador conta com elas.
                {" "}Na aposta (chance de cada boleto; as em teste vendendo constante a 100%): {fmt0(mp.mesAtual.aposta)} − {pct(k.l.perda)} + {fmt0(k.l.novaAposta)}{k.l.ficam > 0 && <> + {fmt0(k.l.ficam)}</>} = {fmt0(k.l.totalAposta)}.
                {" "}A conta supõe que {seguinte} traz de novo a mesma receita nova — não multiplica o crescimento.
              </div>
            </details>
          ))}
        </div>

        <div className="pj-grid2" style={{ marginBottom: 18 }}>
          <div>
            <h3 style={{ color: "#0F172A", fontWeight: 800, margin: "0 0 4px", fontSize: "0.9rem" }}>Conservador (pela conversão do teste)</h3>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", margin: "4px 0 6px" }}>
              <button className={`pj-pill${!naMedia ? " on" : ""}`} onClick={() => setCenario("igual")}>Cadastros como em {atual}</button>
              <button className={`pj-pill${naMedia ? " on" : ""}`} onClick={() => setCenario("media")} disabled={!cenarios.media}
                title={cenarios.media ? undefined : "Ainda não há mês completo com cadastro"}>Média dos últimos meses</button>
            </div>
            <div className="pj-nota">
              Loja a loja, pela taxa medida de quem já saiu do teste (contas desde {desde}). Sai menor porque as contas de {atual} acabaram de sair do teste
              e ainda não tiveram tempo de virar pagantes (a conversão do mês fica baixa), e as lojas em teste só contam os dias depois do teste. Toque numa linha para ver cada taxa.
            </div>
            {contas.map((k) => (
              <details key={k.rotulo} className="pj-conta">
                <summary>
                  <span style={{ fontWeight: 700, color: "#0F172A", fontSize: "0.84rem" }}>{k.rotulo} <span className="pj-seta">▾</span></span>
                  <span className="pj-num" style={{ fontWeight: 800, color: "#0F172A" }}>{fmt0(k.valor)}</span>
                  <span className="pj-nota" style={{ gridColumn: "1 / -1" }}>{k.linha}</span>
                </summary>
                <div className="pj-nota" style={{ marginTop: 6, background: "#F8FAFC", borderRadius: 8, padding: "8px 10px", color: "#334155" }}>{k.detalhe}</div>
              </details>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "12px 0 2px", fontSize: "0.9rem" }}>
              <b style={{ color: "#0F172A" }}>Conservador</b>
              <b className="pj-num" style={{ color: "#0F172A", fontSize: "1.05rem" }}>{fmt0(usado.total)}</b>
            </div>
            <div className="pj-nota">
              ≈ {num(usado.pagantes)} lojas pagantes. Fora desta conta: lojas extras de iFood/99 (R$ 50 cada), taxas e o mínimo de quem só usa sem vender.
              {" "}Só as que já vendem, no ritmo de hoje e sem perda: {fmt0(noRitmo)}.
            </div>
          </div>

          {/* Gráfico: mensalidade e pagantes por mês */}
          <div>
            <h3 style={{ color: "#0F172A", fontWeight: 800, margin: "0 0 2px", fontSize: "0.9rem" }}>Mensalidade por mês</h3>
            <div className="pj-nota" style={{ minHeight: 38, color: "#334155" }}>
              {foco ? <><b>{maiuscula(nomeDoMes(foco.mes))}</b> · {fmt0(foco.valor)} · {num(foco.pagantes)} {foco.tipo === "real" ? "boletos cobrados" : foco.tipo === "previsto" ? `boletos previstos se todas pagarem · ${fmt0(foco.aposta)} na aposta` : `pagantes projetadas · na aposta ${fmt0(foco.aposta)} · faixa ${fmt0(foco.faixa![0])} a ${fmt0(foco.faixa![1])}`}</>
                : <>Boletos cobrados (real), {atual} se todas pagarem e {seguinte} no mesmo padrão. Passe o mouse ou toque numa barra.</>}
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: ALTURA + 20, borderBottom: "1px solid #E5E7EB", marginTop: 6 }} onMouseLeave={() => setMesEmFoco(null)}>
              {barras.map((b, i) => (
                <div key={b.mes} className="pj-mes" onMouseEnter={() => setMesEmFoco(i)} onClick={() => setMesEmFoco(i)}
                  title={`${nomeDoMes(b.mes)}: ${fmt0(b.valor)} · ${num(b.pagantes)} ${b.tipo === "projetado" ? "pagantes projetadas" : "boletos"}`}>
                  {b.faixa && (
                    // A faixa pessimista–otimista: um traço fino atrás da barra.
                    <div style={{ position: "absolute", bottom: (b.faixa[0] / maior) * ALTURA, height: Math.max(2, ((b.faixa[1] - b.faixa[0]) / maior) * ALTURA), width: 2, background: "#94A3B8" }} />
                  )}
                  <span className="pj-nota" style={{
                    fontWeight: 700, color: "#0F172A", whiteSpace: "nowrap", position: "relative",
                    // Na barra projetada o valor fica acima do traço da faixa.
                    marginBottom: 2 + (b.faixa ? Math.max(0, ((b.faixa[1] - b.valor) / maior) * ALTURA) : 0),
                  }}>{fmt0(b.valor)}</span>
                  <div className="barra" style={{
                    height: Math.max(2, (b.valor / maior) * ALTURA),
                    background: b.tipo === "real" ? COR : b.tipo === "previsto" ? COR_PROJETADA : "rgba(255,255,255,.6)",
                    border: b.tipo === "projetado" ? `2px dashed ${COR}` : undefined, borderBottom: "none",
                    opacity: mesEmFoco === null || mesEmFoco === i ? 1 : 0.55, position: "relative",
                  }} />
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
              {barras.map((b) => (
                <div key={b.mes} className="pj-nota" style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: "#334155" }}>{nomeDoMes(b.mes).slice(0, 3)}</div>
                  <div>{num(b.pagantes)} {b.tipo === "projetado" ? "proj." : "boletos"}</div>
                </div>
              ))}
            </div>
            <div className="pj-nota" style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 8 }}>
              <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: COR, marginRight: 5 }} />cobrado</span>
              <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: COR_PROJETADA, marginRight: 5 }} />previsto ({atual}, se todas pagarem)</span>
              <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, border: `2px dashed ${COR}`, marginRight: 5, boxSizing: "border-box", verticalAlign: "-1px" }} />projetado · traço = faixa</span>
            </div>
          </div>
        </div>

        <h3 style={{ color: "#0F172A", fontWeight: 800, margin: "0 0 6px", fontSize: "0.9rem" }}>Funil por mês de cadastro</h3>
        <div className="pj-tabela">
          <table className="fha-table">
            <thead>
              <tr>
                <th>Mês</th><th className="pj-num">Cadastros</th><th className="pj-num">Ativaram</th><th className="pj-num">Ainda em teste</th>
                <th className="pj-num">Saíram do teste</th><th className="pj-num">Pagantes</th><th className="pj-num">Continuam</th><th className="pj-num">Pararam</th>
                <th className="pj-num">Conversão</th>
              </tr>
            </thead>
            <tbody>
              {mesesDoFunil.map((f) => (
                <tr key={f.mes}>
                  <td style={{ fontWeight: 700, color: "#0F172A" }}>{maiuscula(nomeDoMes(f.mes))}{f.mes === mes && <div className="pj-nota" style={{ fontWeight: 400 }}>até hoje · deve fechar em {rc.fechaEm}</div>}</td>
                  {f.cadastros === 0 ? <td colSpan={8} style={{ color: "#94A3B8" }}>nenhum cadastro</td> : <>
                    <td className="pj-num">{f.cadastros}</td>
                    <td className="pj-num">{f.ativaram} <span style={{ color: "#94A3B8" }}>· {pct(f.ativaram / f.cadastros)}</span></td>
                    <td className="pj-num">{f.emTeste || "—"}</td>
                    <td className="pj-num">{f.sairamDoTeste}</td>
                    <td className="pj-num" style={{ fontWeight: 700 }}>{f.pagantes}{f.pagantes > f.pagaram && <div className="pj-nota" style={{ fontWeight: 400 }}>{f.pagaram} pagaram · {f.pagantes - f.pagaram} previstas</div>}</td>
                    <td className="pj-num" style={{ color: "#15803D" }}>{f.continuam}</td>
                    <td className="pj-num" style={{ color: f.pararam ? "#B91C1C" : undefined }}>{f.pararam}</td>
                    <td className="pj-num">{f.conversao === null ? "—" : pct(f.conversao)}</td>
                  </>}
                </tr>
              ))}
              {vazios.length > 0 && (
                <tr>
                  <td style={{ fontWeight: 700, color: "#0F172A" }}>{vazios.length === 1 ? maiuscula(nomeDoMes(vazios[0].mes)) : `${maiuscula(nomeDoMes(vazios[0].mes))} a ${nomeDoMes(vazios[vazios.length - 1].mes)}`}</td>
                  <td colSpan={8} style={{ color: "#94A3B8" }}>nenhum cadastro</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="pj-nota" style={{ marginTop: 10 }}>
          <b>Regras.</b> Cadastro = conta nova (sem as isentas, as contas da casa e as lojas extras de uma conta que já existe). Ativou = fez o 1º pedido.
          Pagante = saiu do teste e pagou um boleto ou tem boleto previsto em {atual}{" "}vendendo depois do teste (o &quot;mínimo sem venda&quot; não conta).
          Continua = pedido há menos de 7 dias; parou = 7 dias ou mais. Conversão = pagantes ÷ saíram do teste: quem ainda está em teste fica de fora até sair.
          A faixa usa a ponta de 90% de cada taxa (com poucas lojas ela abre) e o menor/maior dos dois cenários de cadastro.
        </div>
      </div>
    </div>
  );
}
