"use client";

/**
 * O VALOR DO MÓDULO (regra "Produto pago mostra valor"): o que as reservas
 * trouxeram no mês, em R$ e em gente, comparado com o mês anterior, os
 * gráficos de quando o salão enche e dicas do que fazer com isso.
 */
import type { ReactNode } from "react";
import { DIAS_CURTOS, minutos } from "@/lib/reservas/regras";
import {
  BORDA, COR, CORES_DA_ORIGEM, ICONE_DA_ORIGEM, NOME_DA_ORIGEM, Numero, TINTA, TINTA_2, TINTA_3,
  cartao, h2, nomeDoMes, pct, reais, reaisCurto, texto, type Dados,
} from "./comum";

function Variacao({ agora, antes, sufixo = "" }: { agora: number; antes: number; sufixo?: string }) {
  if (!antes) return <>{agora ? "primeiro mês com reservas" : "sem reservas ainda"}</>;
  const d = (agora - antes) / antes;
  const sobe = d >= 0;
  return <span style={{ color: sobe ? "#15803D" : "#B91C1C", fontWeight: 800 }}>{sobe ? "▲" : "▼"} {Math.abs(Math.round(d * 100))}%{sufixo} vs mês anterior</span>;
}

function Grafico({ titulo, sub, children }: { titulo: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ ...cartao, minWidth: 0 }}>
      <h2 style={h2}>{titulo}</h2>
      {sub && <p style={{ ...texto, fontSize: 12.5, marginTop: 2 }}>{sub}</p>}
      <div style={{ marginTop: 14 }}>{children}</div>
    </section>
  );
}

/** Colunas verticais (uma série: sem legenda, o título diz o que é). */
function Colunas({ itens, altura = 150 }: { itens: { rotulo: string; valor: number; dica: string }[]; altura?: number }) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  const maior = itens.reduce((a, b) => (b.valor > a.valor ? b : a), itens[0]);
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${itens.length}, minmax(14px, 1fr))`, gap: 3, alignItems: "end", height: altura, minWidth: itens.length * 16, borderBottom: `1px solid ${BORDA}` }}>
        {itens.map((i) => (
          <div key={i.rotulo} className="rsv-coluna" style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
            <span className="rsv-dica" style={{ position: "absolute", bottom: "100%", left: "50%", transform: "translate(-50%,0)", background: TINTA, color: "#fff", fontSize: 11.5, padding: "6px 8px", borderRadius: 7, whiteSpace: "nowrap", zIndex: 5 }}>{i.dica}</span>
            {i === maior && i.valor > 0 && <span style={{ fontSize: 10.5, fontWeight: 900, color: TINTA, textAlign: "center", marginBottom: 2 }}>{i.valor}</span>}
            <i className="rsv-barra" style={{ display: "block", height: `${(i.valor / max) * 100}%`, minHeight: i.valor ? 3 : 0, borderRadius: "4px 4px 0 0", background: COR, opacity: i.valor ? 1 : 0.15 }} />
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${itens.length}, minmax(14px, 1fr))`, gap: 3, minWidth: itens.length * 16, marginTop: 4 }}>
        {itens.map((i, k) => <span key={i.rotulo} style={{ fontSize: 10, color: TINTA_3, textAlign: "center", fontWeight: 700 }}>{itens.length > 16 ? (k % 5 === 0 || k === itens.length - 1 ? i.rotulo : "") : i.rotulo}</span>)}
      </div>
    </div>
  );
}

/** Barras horizontais com o valor ao lado. */
function Linhas({ itens }: { itens: { rotulo: string; valor: number; texto: string }[] }) {
  const max = Math.max(1, ...itens.map((i) => i.valor));
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {itens.map((i) => (
        <div key={i.rotulo} style={{ display: "grid", gridTemplateColumns: "56px 1fr 64px", gap: 10, alignItems: "center" }}>
          <span style={{ fontSize: 12.5, fontWeight: 800, color: TINTA_2, fontVariantNumeric: "tabular-nums" }}>{i.rotulo}</span>
          <i className="rsv-barra" style={{ height: 12, borderRadius: "0 4px 4px 0", background: COR, width: `${(i.valor / max) * 100}%`, minWidth: i.valor ? 3 : 0 }} />
          <span style={{ fontSize: 12.5, fontWeight: 800, color: TINTA, textAlign: "right" }}>{i.texto}</span>
        </div>
      ))}
    </div>
  );
}

/** Uma barra empilhada com legenda e rótulo direto (2 px de respiro entre as partes). */
function Empilhada({ partes }: { partes: { nome: string; valor: number; cor: string; icone?: string }[] }) {
  const total = partes.reduce((t, p) => t + p.valor, 0);
  if (!total) return <p style={{ ...texto, fontSize: 13 }}>Ainda sem reservas neste mês.</p>;
  return (
    <div>
      <div style={{ display: "flex", gap: 2, height: 22, borderRadius: 6, overflow: "hidden" }}>
        {partes.filter((p) => p.valor).map((p) => <i key={p.nome} title={`${p.nome}: ${p.valor}`} style={{ width: `${(p.valor / total) * 100}%`, background: p.cor }} />)}
      </div>
      <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
        {partes.map((p) => (
          <div key={p.nome} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <i style={{ width: 10, height: 10, borderRadius: 3, background: p.cor }} />
            <span style={{ color: TINTA_2, fontWeight: 700 }}>{p.icone} {p.nome}</span>
            <span style={{ flex: 1 }} />
            <b style={{ color: TINTA }}>{p.valor}</b>
            <span style={{ color: TINTA_3, width: 40, textAlign: "right" }}>{pct(p.valor / total)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Resultados({ dados }: { dados: Dados }) {
  const v = dados.valor;
  if (!v) return null;
  const n = v.numeros;
  const ym = v.mes;
  const diasNoMes = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
  const porDia = Array.from({ length: diasNoMes }, (_, i) => {
    const d = `${ym}-${String(i + 1).padStart(2, "0")}`;
    const x = n.porDia[d];
    return { rotulo: String(i + 1), valor: x?.reservas || 0, dica: `${String(i + 1).padStart(2, "0")}/${ym.slice(5, 7)}: ${x?.reservas || 0} reservas · ${x?.pessoas || 0} pessoas` };
  });
  const horas = Object.entries(n.porHora).sort((a, b) => minutos(a[0]) - minutos(b[0]));
  const totalHoras = horas.reduce((t, [, q]) => t + q, 0);
  const topHora = [...horas].sort((a, b) => b[1] - a[1])[0];
  const topDia = n.porDiaDaSemana.indexOf(Math.max(...n.porDiaDaSemana));
  const porPessoa = n.pessoasComConsumo ? n.consumo / n.pessoasComConsumo : null;
  const semMesa = n.chegaram - n.mesasComConsumo;
  const lotados = (dados.calendario || []).filter((d) => d.aceita && d.pico >= (dados.config?.maxReservasSimultaneas || 1)).length;

  const dicas: { icone: string; titulo: string; texto: string }[] = [];
  if (n.comparecimento != null && n.comparecimento < 0.85 && n.naoVieram >= 2) {
    dicas.push({ icone: "⌛", titulo: `${n.naoVieram} reservas não vieram (${pct(1 - n.comparecimento)})`, texto: "Mande um “ainda está de pé?” no WhatsApp na véspera para quem reservou: mesa que fica vazia é faturamento perdido no horário mais disputado." });
  }
  if (lotados >= 2) {
    dicas.push({ icone: "🔥", titulo: `${lotados} dias com horário lotado neste mês`, texto: "Tem gente querendo vir e não cabendo. Se o salão comporta, aumente as reservas ao mesmo tempo em Configurar, ou abra um horário mais cedo (o robô oferece sozinho)." });
  }
  if (semMesa > 0) {
    dicas.push({ icone: "🍽️", titulo: `${semMesa} reserva${semMesa > 1 ? "s" : ""} que veio sem mesa ligada`, texto: "Ao marcar “Chegou”, escolha a mesa: assim o FireHub soma quanto as reservas consumiram e você vê o retorno do módulo em reais." });
  }
  if (n.reservas > 0 && n.peloRobo / n.reservas >= 0.5) {
    dicas.push({ icone: "🤖", titulo: `O robô fez ${pct(n.peloRobo / n.reservas)} das reservas sozinho`, texto: "São conversas que ninguém da equipe precisou responder. Divulgue “reserve pelo WhatsApp” no Instagram e na porta: o robô atende 24 h." });
  }
  if (!dicas.length) {
    dicas.push({ icone: "📣", titulo: "Faça o cliente saber que dá para reservar", texto: "Coloque “Reserve sua mesa pelo WhatsApp” na bio do Instagram e no cardápio. Cada reserva confirmada aparece aqui, com a ocupação de cada horário." });
  }

  return (
    <div style={{ display: "grid", gap: 16 }} className="rsv-entra">
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ ...h2, fontSize: 20 }}>Resultado de {nomeDoMes(ym)}</h2>
        <span style={{ ...texto, fontSize: 13 }}>Reservas canceladas não entram na conta.</span>
      </div>

      <div className="rsv-grade">
        <Numero destaque icone="💰" rotulo="Consumo das mesas reservadas" valor={reaisCurto(n.consumo)}
          sub={n.mesasComConsumo ? `${n.mesasComConsumo} mesas${porPessoa ? ` · ${reais(porPessoa)} por pessoa` : ""}` : "ligue a mesa ao marcar “Chegou”"} />
        <Numero icone="📅" rotulo="Reservas no mês" valor={n.reservas} sub={<Variacao agora={n.reservas} antes={v.anterior.reservas} />} />
        <Numero icone="👥" rotulo="Pessoas reservadas" valor={n.pessoas} sub={<>{n.pessoasQueVieram} já vieram · <Variacao agora={n.pessoas} antes={v.anterior.pessoas} /></>} />
        <Numero icone="✅" rotulo="Comparecimento" valor={pct(n.comparecimento)} sub={`${n.chegaram} vieram · ${n.naoVieram} não vieram`} />
        <Numero icone="🤖" rotulo="Feitas pelo robô" valor={n.peloRobo} sub={n.reservas ? `${pct(n.peloRobo / n.reservas)} sem ninguém da equipe` : "o robô reserva sozinho"} />
      </div>

      <Grafico titulo="Reservas por dia" sub="O número em cima é o dia mais cheio. Passe o mouse para ver cada dia.">
        <Colunas itens={porDia} />
      </Grafico>

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))" }}>
        <Grafico titulo="Horários mais procurados" sub={topHora ? `O pico é às ${topHora[0]}: ${pct(topHora[1] / totalHoras)} das reservas chegam nessa hora.` : "Por hora de chegada."}>
          {horas.length ? <Linhas itens={horas.map(([h, q]) => ({ rotulo: h, valor: q, texto: `${q} (${pct(q / totalHoras)})` }))} /> : <p style={{ ...texto, fontSize: 13 }}>Ainda sem reservas neste mês.</p>}
        </Grafico>
        <Grafico titulo="Dias da semana" sub={n.reservas ? `${["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"][topDia]} é o dia que mais reserva.` : "Quantas reservas cada dia recebeu."}>
          <Linhas itens={n.porDiaDaSemana.map((q, i) => ({ rotulo: DIAS_CURTOS[i], valor: q, texto: String(q) }))} />
        </Grafico>
        <Grafico titulo="De onde vêm as reservas">
          <Empilhada partes={(["ROBO", "PAINEL", "BILL"] as const).map((o) => ({ nome: NOME_DA_ORIGEM[o], icone: ICONE_DA_ORIGEM[o], cor: CORES_DA_ORIGEM[o], valor: o === "ROBO" ? n.peloRobo : o === "PAINEL" ? n.peloPainel : n.peloBill }))} />
        </Grafico>
        <Grafico titulo="Quem veio" sub="Das reservas com o horário já passado.">
          <Empilhada partes={[
            { nome: "Chegaram", icone: "✅", cor: "#16A34A", valor: n.chegaram },
            { nome: "Não vieram", icone: "⌛", cor: "#F59E0B", valor: n.naoVieram },
            { nome: "Ainda por vir", icone: "📌", cor: "#CBD5E1", valor: n.reservas - n.chegaram - n.naoVieram },
          ]} />
        </Grafico>
      </div>

      <section style={{ ...cartao, background: "linear-gradient(180deg,#FAF5FF,#fff)", borderColor: "#DDD6FE" }}>
        <h2 style={h2}>O que fazer com isso</h2>
        <div style={{ display: "grid", gap: 12, marginTop: 12, gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {dicas.map((d) => (
            <div key={d.titulo} style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "#fff", border: `1px solid ${BORDA}`, borderRadius: 14, padding: 14 }}>
              <span aria-hidden style={{ fontSize: 24 }}>{d.icone}</span>
              <div><b style={{ color: TINTA, fontSize: 14 }}>{d.titulo}</b><p style={{ ...texto, fontSize: 13, marginTop: 4 }}>{d.texto}</p></div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
