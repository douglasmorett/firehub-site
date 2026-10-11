"use client";
/**
 * DADOS SENSÍVEIS — o coração dos números da loja (pedido do Douglas, 11/10/2026):
 * "painel de CMV com gráfico, com ponteiro, do vermelho ao verde; CMV de semana,
 * de dia, de mês; números assertivos".
 *
 * Três abas:
 *   Painel  o ponteiro do CMV REAL do período (contagem + compras − contagem),
 *           o gráfico dia a dia (um trecho por contagem), a conta aberta, o
 *           CMO, o custo primário, onde está o dinheiro e os avisos.
 *   Equipe  a folha que dá o CMO (salário, encargos, benefícios).
 *   Metas   a meta que pinta o ponteiro.
 *
 * A conta é do servidor (lib/cmv/painel.ts). Aqui só se mostra, e a tela se
 * atualiza sozinha a cada minuto — fechou a contagem do dia, o ponteiro anda.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ClipboardCheck, Info, Pencil, Plus, RefreshCw, ShoppingCart, Trash2, X } from "lucide-react";
import { PALETA } from "@/lib/paleta-brasa";
import { Bloco, Cartao, GradeDeCartoes, Vazio } from "@/components/relatorios/ModeloDoRelatorio";
import Ponteiro from "@/components/cmv/Ponteiro";
import { fmtPct, fmtReais, fmtQtd, somarDias } from "@/lib/relatorios/base";
import { inicioDaSemanaDoCmv, NOMES_DOS_DIAS_DA_SEMANA } from "@/lib/cmv/semana-do-cmv";
import type { Painel } from "@/lib/cmv/painel";

type Aba = "painel" | "equipe" | "metas";
type Atalho = "semana" | "semanaPassada" | "hoje" | "ontem" | "mes" | "mesPassado" | "outro";

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
const diaCurto = (dia: string) => `${DIAS[new Date(`${dia}T12:00:00Z`).getUTCDay()]} ${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const ddmm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
const tipoDaContagem = (t: string) => (t === "RAPIDA" ? "rápida" : "completa");

/** `comecaEm`: o dia da semana em que a semana do CMV começa (segue o dia da contagem completa). */
function periodoDo(atalho: Atalho, hoje: string, comecaEm = 1): { de: string; ate: string } | null {
  const seg = inicioDaSemanaDoCmv(hoje, comecaEm);
  switch (atalho) {
    case "semana": return { de: seg, ate: somarDias(seg, 6) };
    case "semanaPassada": return { de: somarDias(seg, -7), ate: somarDias(seg, -1) };
    case "hoje": return { de: hoje, ate: hoje };
    case "ontem": return { de: somarDias(hoje, -1), ate: somarDias(hoje, -1) };
    case "mes": {
      const de = `${hoje.slice(0, 7)}-01`;
      const [a, m] = hoje.split("-").map(Number);
      const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
      return { de, ate: `${hoje.slice(0, 7)}-${String(ultimo).padStart(2, "0")}` };
    }
    case "mesPassado": {
      const fim = somarDias(`${hoje.slice(0, 7)}-01`, -1);
      return { de: `${fim.slice(0, 7)}-01`, ate: fim };
    }
    default: return null;
  }
}

const ATALHOS: { chave: Atalho; rotulo: string }[] = [
  { chave: "semana", rotulo: "Esta semana" },
  { chave: "semanaPassada", rotulo: "Semana passada" },
  { chave: "ontem", rotulo: "Ontem" },
  { chave: "hoje", rotulo: "Hoje" },
  { chave: "mes", rotulo: "Este mês" },
  { chave: "mesPassado", rotulo: "Mês passado" },
];

const corDaZona = (z: string) => (z === "verde" ? PALETA.ok : z === "amarelo" ? PALETA.atencao : z === "vermelho" ? PALETA.grave : PALETA.areiaTinta);
const tomDaZona = (z: string): "ok" | "atencao" | "grave" | "neutro" => (z === "verde" ? "ok" : z === "amarelo" ? "atencao" : z === "vermelho" ? "grave" : "neutro");

export default function DadosSensiveisClient({ hoje, nomeDaLoja }: { hoje: string; nomeDaLoja: string }) {
  const [aba, setAba] = useState<Aba>("painel");
  const [atalho, setAtalho] = useState<Atalho>("semana");
  // Nulo até a primeira resposta: a semana da loja (segue o dia da contagem
  // completa) vem do servidor, e o primeiro pedido vai sem período.
  const [periodo, setPeriodo] = useState<{ de: string; ate: string } | null>(null);
  const [comecaEm, setComecaEm] = useState(1);
  const [dados, setDados] = useState<Painel | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [atualizadoEm, setAtualizadoEm] = useState<string>("");

  const carregar = useCallback(async (silencioso = false) => {
    if (!silencioso) setCarregando(true);
    try {
      const r = await fetch(`/api/store/dados-sensiveis${periodo ? `?de=${periodo.de}&ate=${periodo.ate}` : ""}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Não deu para carregar os números.");
      setDados(j);
      if (j.semana) setComecaEm(j.semana.comecaEm);
      if (!periodo) setPeriodo(j.periodo);
      setErro(null);
      setAtualizadoEm(new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [periodo?.de, periodo?.ate]);

  useEffect(() => { carregar(); }, [carregar]);

  // "Ao vivo": a cada minuto, com a aba aberta. A contagem do dia fecha, o ponteiro anda.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") carregar(true); }, 60_000);
    return () => clearInterval(t);
  }, [carregar]);

  const escolher = (a: Atalho) => {
    setAtalho(a);
    const p = periodoDo(a, hoje, comecaEm);
    if (p) setPeriodo(p);
  };

  return (
    <div style={{ padding: "1.5rem 1rem 3rem", maxWidth: 1280, margin: "0 auto", fontFamily: "system-ui, -apple-system, sans-serif", color: PALETA.carvao }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 800, color: PALETA.marca, textTransform: "uppercase", letterSpacing: "0.08em" }}>🔒 Dados sensíveis · {nomeDaLoja}</div>
          <h1 style={{ margin: "2px 0 0", fontSize: "1.55rem", fontWeight: 900, letterSpacing: "-0.01em" }}>CMV real e custo da loja</h1>
          <p style={{ margin: "4px 0 0", fontSize: "0.86rem", color: PALETA.areiaTinta, maxWidth: 760 }}>
            CMV pela contagem de estoque e pelas compras lançadas, não pela ficha técnica. Só o dono e quem tem a caixinha "Dados sensíveis" em Equipe veem esta tela.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/store/estoque/contagem" className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
            <ClipboardCheck size={15} /> Contagem
          </Link>
          <Link href="/store/estoque/compras" className="btn btn-outline" style={{ display: "inline-flex", alignItems: "center", gap: 6, textDecoration: "none" }}>
            <ShoppingCart size={15} /> Compras
          </Link>
        </div>
      </header>

      <nav role="tablist" aria-label="Seções" style={{ display: "flex", gap: 6, borderBottom: `1px solid ${PALETA.areiaBorda}`, marginBottom: "1rem", overflowX: "auto" }}>
        {([["painel", "Painel"], ["equipe", "Equipe (CMO)"], ["metas", "Metas"]] as [Aba, string][]).map(([k, r]) => (
          <button key={k} role="tab" aria-selected={aba === k} type="button" onClick={() => setAba(k)}
            style={{ border: "none", background: "none", padding: "0.6rem 0.9rem", fontWeight: 800, fontSize: "0.9rem", cursor: "pointer",
              color: aba === k ? PALETA.marca : PALETA.areiaTinta, borderBottom: `3px solid ${aba === k ? PALETA.marca : "transparent"}`, whiteSpace: "nowrap" }}>
            {r}
          </button>
        ))}
      </nav>

      {aba === "painel" && (
        <>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: "1rem" }}>
            {ATALHOS.map((a) => (
              <button key={a.chave} type="button" onClick={() => escolher(a.chave)}
                style={{ border: `1px solid ${atalho === a.chave ? PALETA.carvao : PALETA.areiaBorda}`, background: atalho === a.chave ? PALETA.carvao : "#fff",
                  color: atalho === a.chave ? "#fff" : PALETA.carvao, borderRadius: 999, padding: "0.35rem 0.8rem", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer" }}>
                {a.rotulo}
              </button>
            ))}
            <span style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: "0.8rem" }}>
              <input aria-label="De" type="date" value={periodo?.de || ""} max={periodo?.ate} onChange={(e) => { if (e.target.value && periodo) { setAtalho("outro"); setPeriodo({ ...periodo, de: e.target.value }); } }}
                style={{ border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 8, padding: "0.3rem 0.4rem" }} />
              a
              <input aria-label="Até" type="date" value={periodo?.ate || ""} min={periodo?.de} onChange={(e) => { if (e.target.value && periodo) { setAtalho("outro"); setPeriodo({ ...periodo, ate: e.target.value }); } }}
                style={{ border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 8, padding: "0.3rem 0.4rem" }} />
            </span>
            <button type="button" onClick={() => carregar()} title="Atualizar agora"
              style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${PALETA.areiaBorda}`, background: "#fff", borderRadius: 8, padding: "0.35rem 0.7rem", fontSize: "0.78rem", fontWeight: 700, color: PALETA.areiaTinta, cursor: "pointer" }}>
              <RefreshCw size={14} /> {atualizadoEm ? `Atualizado às ${atualizadoEm}` : "Atualizar"}
            </button>
          </div>

          {erro && <Alerta tipo="erro" texto={erro} />}
          {!dados && carregando && <Vazio texto="Carregando os números da loja…" />}
          {dados && <PainelDoCmv dados={dados} carregando={carregando} />}
        </>
      )}

      {aba === "equipe" && periodo && <AbaEquipe periodo={periodo} />}
      {aba === "metas" && <AbaMetas metas={dados?.metas} semana={dados?.semana} onSalvo={() => carregar(true)} />}
    </div>
  );
}

// ── PAINEL ─────────────────────────────────────────────────────────────────

function PainelDoCmv({ dados, carregando }: { dados: Painel; carregando: boolean }) {
  const { cmv, metas } = dados;
  const res = cmv.resultado;
  const semValor =
    cmv.falta === "NENHUMA_CONTAGEM" ? "faça a primeira contagem" :
    cmv.falta === "SO_UMA_CONTAGEM" ? "falta a próxima contagem" : undefined;

  return (
    <div style={{ opacity: carregando ? 0.6 : 1, transition: "opacity 0.15s" }}>
      {dados.avisos.map((a, i) => <Alerta key={i} tipo={a.tipo} texto={a.texto} />)}

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "1rem", marginBottom: "1.25rem" }}>
        <div className="fh-relatorio-bloco" style={{ background: "#fff", border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 16, padding: "1.1rem 1rem 1rem", display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <Ponteiro valor={res?.pct ?? null} meta={metas.cmv} faixa={metas.faixa} rotulo="CMV real" semValor={semValor} tamanho={300} />
          <p style={{ margin: 0, fontSize: "0.82rem", color: PALETA.areiaTinta, textAlign: "center" }}>
            {res ? (
              <>
                <strong style={{ color: PALETA.carvao }}>{fmtReais(res.cmv)}</strong> de mercadoria para <strong style={{ color: PALETA.carvao }}>{fmtReais(res.vendas)}</strong> em vendas
                <br />de {diaCurto(res.de)} a {diaCurto(res.ate)} · fecha na contagem {tipoDaContagem(res.tipoDoFechamento)} de {ddmm(res.ate)}
                {cmv.parcial && <><br /><span style={{ color: PALETA.atencao, fontWeight: 700 }}>Ainda não cobre o período inteiro: anda a cada contagem.</span></>}
              </>
            ) : cmv.abertura ? (
              <>Começa na contagem de {ddmm(cmv.abertura.dia)}. Feche a próxima contagem para ver o CMV.</>
            ) : (
              <>Sem contagem fechada ainda.</>
            )}
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.75rem", alignContent: "start" }}>
          <Cartao rotulo="Vendas no período" valor={fmtReais(dados.vendas.total)} detalhe="valor vendido sem a taxa de entrega" />
          <Cartao rotulo="Compras lançadas" valor={fmtReais(dados.compras.total)} detalhe={dados.compras.foraDoCmv > 0 ? `+ ${fmtReais(dados.compras.foraDoCmv)} fora do CMV (limpeza etc.)` : "pelo dia em que a mercadoria chegou"} />
          <Cartao rotulo="CMO (mão de obra)" valor={dados.cmo.pct != null ? fmtPct(dados.cmo.pct) : "—"} tom={tomDaZona(dados.cmo.zona)}
            detalhe={<>{fmtReais(dados.cmo.total)} · meta {metas.cmo}%</>} />
          <Cartao rotulo="Custo primário" valor={dados.custoPrimario?.pct != null ? fmtPct(dados.custoPrimario.pct) : "—"}
            tom={dados.custoPrimario?.pct == null ? "neutro" : dados.custoPrimario.pct <= metas.cmv + metas.cmo ? "ok" : dados.custoPrimario.pct <= metas.cmv + metas.cmo + 5 ? "atencao" : "grave"}
            detalhe={dados.custoPrimario ? <>CMV + CMO de {ddmm(dados.custoPrimario.de)} a {ddmm(dados.custoPrimario.ate)} · meta {metas.cmv + metas.cmo}%</> : "aparece com o CMV"} />
          <Cartao rotulo="Perdas registradas" valor={fmtReais(dados.perdas.valor)} tom={dados.perdas.valor > 0 ? "atencao" : "neutro"} detalhe="lançadas em Estoque › Movimentar › Perda" />
          <Cartao rotulo="Última contagem" valor={dados.contagens.ultima ? ddmm(dados.contagens.ultima.dia) : "—"}
            detalhe={dados.contagens.ultima ? `${tipoDaContagem(dados.contagens.ultima.tipo)} · ${dados.contagens.marcadosNoDia} itens na contagem do dia` : "nenhuma ainda"} />
        </div>
      </section>

      {res && (
        <Bloco titulo="A conta do CMV" subtitulo="Sem estimativa: o que tinha, o que entrou e o que sobrou.">
          <ContaDoCmv res={res} />
        </Bloco>
      )}

      <Bloco titulo="CMV dia a dia" subtitulo="Uma barra por contagem fechada. Com a contagem rápida no fim de cada dia, uma barra por dia.">
        {cmv.trechos.length ? <GraficoDosTrechos trechos={cmv.trechos} meta={metas.cmv} faixa={metas.faixa} /> : <Vazio texto="Precisa de pelo menos duas contagens fechadas no período." />}
      </Bloco>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1rem" }}>
        <Bloco titulo="Onde está o dinheiro" subtitulo="O que mais saiu do estoque entre as duas contagens (estoque + compras − sobra), pelo custo da última contagem.">
          {dados.consumo.length ? (
            <Tabela colunas={["Insumo", "Saiu", "R$"]} linhas={dados.consumo.map((c) => [c.nome, `${fmtQtd(c.quantidade)} ${c.unidade}`, fmtReais(c.valor)])} />
          ) : <Vazio texto="Aparece quando houver duas contagens com custo." />}
        </Bloco>
        <Bloco titulo="Compras por fornecedor" subtitulo="Compras lançadas no período.">
          {dados.compras.porFornecedor.length ? (
            <Tabela colunas={["Fornecedor", "Compras", "R$"]} linhas={dados.compras.porFornecedor.map((f) => [f.fornecedor, String(f.compras), fmtReais(f.valor)])} />
          ) : <Vazio texto="Nenhuma compra lançada no período." />}
        </Bloco>
        <Bloco titulo="CMO por pessoa" subtitulo={`Folha proporcional aos dias${dados.cmo.diarias > 0 ? ` + ${fmtReais(dados.cmo.diarias)} em diárias` : ""}.`}>
          {dados.cmo.porPessoa.length ? (
            <Tabela colunas={["Pessoa", "Dias", "R$"]} linhas={dados.cmo.porPessoa.map((p) => [p.funcao ? `${p.nome} · ${p.funcao}` : p.nome, String(p.dias), fmtReais(p.valor)])} />
          ) : <Vazio texto="Cadastre a equipe na aba Equipe (CMO)." />}
        </Bloco>
        {dados.perdas.itens.length > 0 && (
          <Bloco titulo="Perdas registradas" subtitulo="O que foi lançado como perda no período.">
            <Tabela colunas={["Insumo", "Qtd.", "R$"]} linhas={dados.perdas.itens.map((p) => [p.nome, `${fmtQtd(p.quantidade)} ${p.unidade}`, fmtReais(p.valor)])} />
          </Bloco>
        )}
      </div>
    </div>
  );
}

function ContaDoCmv({ res }: { res: NonNullable<Painel["cmv"]["resultado"]> }) {
  const linha = (rotulo: React.ReactNode, valor: number, sinal: string, forte = false) => (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "0.45rem 0", borderBottom: forte ? "none" : `1px dashed ${PALETA.areiaBorda}`, fontWeight: forte ? 900 : 600, fontSize: forte ? "1.05rem" : "0.9rem" }}>
      <span><span style={{ display: "inline-block", width: 18, color: PALETA.areiaTinta }}>{sinal}</span>{rotulo}</span>
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtReais(valor)}</span>
    </div>
  );
  return (
    <div style={{ maxWidth: 560 }}>
      {linha(<>Estoque na contagem de {ddmm(somarDias(res.de, -1))}</>, res.estoqueInicial, "")}
      {linha(<>Compras de {ddmm(res.de)} a {ddmm(res.ate)}</>, res.compras, "+")}
      {linha(<>Estoque na contagem de {ddmm(res.ate)}</>, res.estoqueFinal, "−")}
      <div style={{ borderTop: `2px solid ${PALETA.carvao}`, marginTop: 4 }} />
      {linha(<>CMV real {res.pct != null ? `(${fmtPct(res.pct)} de ${fmtReais(res.vendas)})` : ""}</>, res.cmv, "=", true)}
    </div>
  );
}

function GraficoDosTrechos({ trechos, meta, faixa }: { trechos: Painel["cmv"]["trechos"]; meta: number; faixa: number }) {
  // Largura pelo número de barras: no celular o gráfico rola de lado com letra
  // legível, em vez de encolher tudo para caber.
  const esq = 40, dir = 12, h = 240, base = 200, topo = 18;
  const w = Math.max(420, esq + dir + trechos.length * 100);
  const valores = trechos.map((t) => t.pct ?? 0);
  const max = Math.max(50, Math.ceil(Math.max(meta + faixa + 5, ...valores) / 10) * 10);
  const y = (v: number) => base - (Math.max(0, Math.min(v, max)) / max) * (base - topo);
  const largura = (w - esq - dir) / trechos.length;
  const barra = Math.min(56, largura * 0.62);
  const grade: number[] = [];
  for (let v = 0; v <= max; v += 10) grade.push(v);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" style={{ minWidth: Math.round(w * 0.85), maxHeight: 360 }} role="img" aria-label="CMV por trecho entre contagens">
        {grade.map((v) => (
          <g key={v}>
            <line x1={esq} x2={w - dir} y1={y(v)} y2={y(v)} stroke={PALETA.areiaBorda} strokeWidth={1} />
            <text x={esq - 6} y={y(v) + 4} fontSize={10} textAnchor="end" fill={PALETA.areiaTinta}>{v}%</text>
          </g>
        ))}
        <line x1={esq} x2={w - dir} y1={y(meta)} y2={y(meta)} stroke={PALETA.carvao} strokeWidth={1.5} strokeDasharray="5 4" />
        <text x={w - dir} y={y(meta) - 5} fontSize={10} textAnchor="end" fill={PALETA.carvao} fontWeight={800}>meta {meta}%</text>
        {trechos.map((t, i) => {
          const cx = esq + largura * i + largura / 2;
          const v = t.pct;
          const cor = v == null ? PALETA.areiaBorda : v <= meta ? PALETA.ok : v <= meta + faixa ? PALETA.atencao : PALETA.grave;
          const topoBarra = v == null ? base - 2 : y(v);
          const rotulo = t.de === t.ate ? diaCurto(t.ate) : `${ddmm(t.de)}–${ddmm(t.ate)}`;
          return (
            <g key={`${t.de}-${t.ate}`}>
              <title>{`${rotulo}: CMV ${v != null ? `${String(v).replace(".", ",")}%` : "sem venda"} — ${fmtReais(t.cmv)} de ${fmtReais(t.vendas)}`}</title>
              <rect x={cx - barra / 2} y={topoBarra} width={barra} height={Math.max(2, base - topoBarra)} rx={4} fill={cor} />
              <text x={cx} y={topoBarra - 5} fontSize={11} textAnchor="middle" fill={PALETA.carvao} fontWeight={800}>{v != null ? `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : "—"}</text>
              <text x={cx} y={base + 16} fontSize={10.5} textAnchor="middle" fill={PALETA.areiaTinta} fontWeight={700}>{rotulo}</text>
              <text x={cx} y={base + 30} fontSize={9.5} textAnchor="middle" fill={PALETA.areiaTinta}>{fmtReais(t.cmv)}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function Tabela({ colunas, linhas }: { colunas: string[]; linhas: string[][] }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
        <thead>
          <tr>{colunas.map((c, i) => <th key={c} style={{ textAlign: i === 0 ? "left" : "right", padding: "0.35rem 0.4rem", fontSize: "0.72rem", textTransform: "uppercase", color: PALETA.areiaTinta, borderBottom: `1px solid ${PALETA.areiaBorda}` }}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {linhas.map((l, i) => (
            <tr key={i}>{l.map((v, j) => <td key={j} style={{ textAlign: j === 0 ? "left" : "right", padding: "0.4rem", borderBottom: `1px solid ${PALETA.areia}`, fontVariantNumeric: "tabular-nums", fontWeight: j === l.length - 1 ? 800 : 500 }}>{v}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Alerta({ tipo, texto }: { tipo: "erro" | "atencao" | "info"; texto: string }) {
  const cor = tipo === "erro" ? PALETA.grave : tipo === "atencao" ? PALETA.atencao : PALETA.carvao2;
  const fundo = tipo === "erro" ? PALETA.graveClaro : tipo === "atencao" ? PALETA.atencaoClaro : PALETA.areia;
  const borda = tipo === "erro" ? PALETA.graveBorda : tipo === "atencao" ? PALETA.atencaoBorda : PALETA.areiaBorda;
  const Icone = tipo === "info" ? Info : AlertTriangle;
  return (
    <div role={tipo === "erro" ? "alert" : undefined} style={{ display: "flex", gap: 10, alignItems: "flex-start", background: fundo, border: `1px solid ${borda}`, color: cor, borderRadius: 12, padding: "0.7rem 0.9rem", marginBottom: "0.75rem", fontSize: "0.86rem", fontWeight: 600 }}>
      <Icone size={18} style={{ flexShrink: 0, marginTop: 1 }} />
      <span>{texto}</span>
    </div>
  );
}

// ── EQUIPE (CMO) ───────────────────────────────────────────────────────────

type Pessoa = { id: string; nome: string; funcao: string | null; salario: number; encargosPct: number; beneficios: number; desde: string; ate: string | null; custoMensal: number };
const VAZIA = { nome: "", funcao: "", salario: "", encargosPct: "", beneficios: "", desde: "", ate: "" };

function AbaEquipe({ periodo }: { periodo: { de: string; ate: string } }) {
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [hoje, setHoje] = useState("");
  const [form, setForm] = useState<typeof VAZIA>(VAZIA);
  const [editando, setEditando] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  const carregar = useCallback(async () => {
    const r = await fetch("/api/store/dados-sensiveis/equipe", { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) { setErro(j.error); return; }
    setPessoas(j.pessoas);
    setHoje(j.hoje);
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  const ativos = pessoas.filter((p) => !p.ate || p.ate >= hoje);
  const totalMensal = ativos.reduce((s, p) => s + p.custoMensal, 0);

  const salvar = async () => {
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch(`/api/store/dados-sensiveis/equipe${editando ? `?id=${editando}` : ""}`, {
        method: editando ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setForm(VAZIA); setEditando(null); setAberto(false);
      await carregar();
    } catch (e: any) { setErro(e.message); } finally { setSalvando(false); }
  };

  const [apagando, setApagando] = useState<string | null>(null);
  const apagar = async (id: string) => {
    const r = await fetch(`/api/store/dados-sensiveis/equipe?id=${id}`, { method: "DELETE" });
    if (r.ok) { setApagando(null); await carregar(); }
  };

  const campo = (k: keyof typeof VAZIA, rotulo: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.76rem", fontWeight: 800, color: PALETA.areiaTinta }}>
      {rotulo}
      <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} {...extra}
        style={{ border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 8, padding: "0.5rem 0.6rem", fontSize: "0.9rem", color: PALETA.carvao, fontWeight: 600 }} />
    </label>
  );

  return (
    <>
      <GradeDeCartoes>
        <Cartao rotulo="Pessoas na folha" valor={String(ativos.length)} detalhe={pessoas.length > ativos.length ? `${pessoas.length - ativos.length} que já saíram ficam para o histórico` : undefined} />
        <Cartao rotulo="Custo mensal da equipe" valor={fmtReais(totalMensal)} detalhe="salário + encargos + benefícios" />
        <Cartao rotulo="Por semana (≈)" valor={fmtReais((totalMensal * 7) / 30)} detalhe={`período escolhido: ${ddmm(periodo.de)} a ${ddmm(periodo.ate)}`} />
      </GradeDeCartoes>

      <Alerta tipo="info" texto="O CMO soma o custo mensal de cada pessoa proporcional aos dias do período, mais as diárias lançadas no Financeiro como &quot;Diária / ajudante&quot;. Entregador não entra: é custo de entrega. Quem saiu, não apague: ponha a data de saída, para os meses em que trabalhou continuarem certos." />

      <Bloco titulo="Equipe" acoes={!aberto && (
        <button type="button" className="btn btn-primary" onClick={() => { setForm({ ...VAZIA, desde: hoje }); setEditando(null); setAberto(true); }} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Plus size={15} /> Adicionar pessoa
        </button>
      )}>
        {aberto && (
          <div style={{ border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 12, padding: "0.9rem", marginBottom: "1rem", background: PALETA.areia }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "0.7rem" }}>
              {campo("nome", "Nome")}
              {campo("funcao", "Função", { placeholder: "Pizzaiolo, atendente..." })}
              {campo("salario", "Salário mensal (R$)", { inputMode: "decimal" })}
              {campo("encargosPct", "Encargos e provisões (%)", { inputMode: "decimal", placeholder: "ex.: 20" })}
              {campo("beneficios", "Benefícios por mês (R$)", { inputMode: "decimal", placeholder: "VT, VR" })}
              {campo("desde", "Desde", { type: "date" })}
              {campo("ate", "Saiu em (se saiu)", { type: "date" })}
            </div>
            <p style={{ fontSize: "0.76rem", color: PALETA.areiaTinta, margin: "0.6rem 0 0" }}>
              Encargos: FGTS, INSS, férias e 13º, em % do salário. CLT no Simples costuma ficar perto de 20%; confirme com o contador. Diarista e MEI: 0%.
            </p>
            {erro && <Alerta tipo="erro" texto={erro} />}
            <div style={{ display: "flex", gap: 8, marginTop: "0.7rem" }}>
              <button type="button" className="btn btn-primary" disabled={salvando} onClick={salvar}>{salvando ? "Salvando…" : editando ? "Salvar alterações" : "Adicionar"}</button>
              <button type="button" className="btn btn-outline" onClick={() => { setAberto(false); setEditando(null); setErro(null); }}>Cancelar</button>
            </div>
          </div>
        )}
        {pessoas.length === 0 ? <Vazio texto="Ninguém cadastrado. Adicione a equipe para o CMO aparecer no painel." /> : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.86rem" }}>
              <thead>
                <tr>{["Pessoa", "Salário", "Encargos", "Benefícios", "Custo/mês", "Período", ""].map((c, i) => (
                  <th key={i} style={{ textAlign: i === 0 || i === 5 ? "left" : "right", padding: "0.35rem 0.4rem", fontSize: "0.72rem", textTransform: "uppercase", color: PALETA.areiaTinta, borderBottom: `1px solid ${PALETA.areiaBorda}` }}>{c}</th>
                ))}</tr>
              </thead>
              <tbody>
                {pessoas.map((p) => {
                  const saiu = Boolean(p.ate && p.ate < hoje);
                  return (
                    <tr key={p.id} style={{ opacity: saiu ? 0.55 : 1 }}>
                      <td style={{ padding: "0.45rem 0.4rem", fontWeight: 800 }}>{p.nome}{p.funcao && <span style={{ fontWeight: 500, color: PALETA.areiaTinta }}> · {p.funcao}</span>}</td>
                      <td style={{ textAlign: "right", padding: "0.45rem 0.4rem" }}>{fmtReais(p.salario)}</td>
                      <td style={{ textAlign: "right", padding: "0.45rem 0.4rem" }}>{fmtPct(p.encargosPct, 0)}</td>
                      <td style={{ textAlign: "right", padding: "0.45rem 0.4rem" }}>{fmtReais(p.beneficios)}</td>
                      <td style={{ textAlign: "right", padding: "0.45rem 0.4rem", fontWeight: 800 }}>{fmtReais(p.custoMensal)}</td>
                      <td style={{ padding: "0.45rem 0.4rem", fontSize: "0.8rem", color: PALETA.areiaTinta }}>desde {ddmm(p.desde)}{p.ate ? ` · saiu ${ddmm(p.ate)}` : ""}</td>
                      <td style={{ textAlign: "right", padding: "0.45rem 0.4rem", whiteSpace: "nowrap" }}>
                        {apagando === p.id ? (
                          <span style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: "0.78rem" }}>
                            Apagar mesmo?
                            <button type="button" onClick={() => apagar(p.id)} style={{ border: "none", background: PALETA.grave, color: "#fff", borderRadius: 6, padding: "0.2rem 0.5rem", fontWeight: 800, cursor: "pointer" }}>Apagar</button>
                            <button type="button" aria-label="Não apagar" onClick={() => setApagando(null)} style={{ border: "none", background: "none", cursor: "pointer" }}><X size={14} /></button>
                          </span>
                        ) : (
                          <>
                            <button type="button" aria-label={`Editar ${p.nome}`} onClick={() => {
                              setForm({ nome: p.nome, funcao: p.funcao || "", salario: String(p.salario), encargosPct: String(p.encargosPct), beneficios: String(p.beneficios), desde: p.desde, ate: p.ate || "" });
                              setEditando(p.id); setAberto(true);
                            }} style={{ border: "none", background: "none", cursor: "pointer", color: PALETA.areiaTinta }}><Pencil size={15} /></button>
                            <button type="button" aria-label={`Apagar ${p.nome}`} onClick={() => setApagando(p.id)} style={{ border: "none", background: "none", cursor: "pointer", color: PALETA.areiaTinta }}><Trash2 size={15} /></button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>
    </>
  );
}

// ── METAS ──────────────────────────────────────────────────────────────────

function AbaMetas({ metas, semana, onSalvo }: { metas?: Painel["metas"]; semana?: Painel["semana"]; onSalvo: () => void }) {
  const [cmv, setCmv] = useState(metas ? String(metas.cmv) : "");
  const [cmo, setCmo] = useState(metas ? String(metas.cmo) : "");
  const [diaDaContagem, setDiaDaContagem] = useState(semana ? String(semana.diaDaContagem) : "0");
  const [momento, setMomento] = useState<string>(semana?.momento || "DEPOIS_DE_FECHAR");
  useEffect(() => { if (semana) { setDiaDaContagem(String(semana.diaDaContagem)); setMomento(semana.momento); } }, [semana]);
  const dia = Number(diaDaContagem);
  const fecha = momento === "ANTES_DE_ABRIR" ? (dia + 6) % 7 : dia;
  const comeca = (fecha + 1) % 7;
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  useEffect(() => { if (metas) { setCmv(String(metas.cmv)); setCmo(String(metas.cmo)); } }, [metas]);

  const previa = useMemo(() => Number(cmv.replace(",", ".")) || 33, [cmv]);

  const salvar = async () => {
    const r = await fetch("/api/store/dados-sensiveis/metas", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cmvPct: cmv, cmoPct: cmo, semanaDoCmv: { diaDaContagem: dia, momento } }) });
    const j = await r.json();
    setMsg(r.ok ? { ok: true, texto: "Salvo." } : { ok: false, texto: j.error });
    if (r.ok) onSalvo();
  };

  return (
    <Bloco titulo="Metas do ponteiro" subtitulo="Verde até a meta, amarelo até 3 pontos acima, vermelho daí para cima.">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1.25rem", alignItems: "center" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", fontWeight: 800, color: PALETA.areiaTinta }}>
            Meta de CMV (%)
            <input value={cmv} onChange={(e) => setCmv(e.target.value)} inputMode="decimal" style={{ border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 8, padding: "0.55rem 0.6rem", fontSize: "1rem", fontWeight: 700, maxWidth: 160 }} />
            <span style={{ fontWeight: 500 }}>A planilha de custo do Hakim fala em 30 a 33%.</span>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8rem", fontWeight: 800, color: PALETA.areiaTinta }}>
            Meta de CMO (%)
            <input value={cmo} onChange={(e) => setCmo(e.target.value)} inputMode="decimal" style={{ border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 8, padding: "0.55rem 0.6rem", fontSize: "1rem", fontWeight: 700, maxWidth: 160 }} />
            <span style={{ fontWeight: 500 }}>Mão de obra sobre as vendas. CMV + CMO juntos são o custo primário.</span>
          </label>
          <fieldset style={{ border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 10, padding: "0.6rem 0.8rem", margin: 0 }}>
            <legend style={{ fontSize: "0.8rem", fontWeight: 800, color: PALETA.areiaTinta, padding: "0 4px" }}>Contagem completa</legend>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <select aria-label="Dia da contagem completa" value={diaDaContagem} onChange={(e) => setDiaDaContagem(e.target.value)} style={{ border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 8, padding: "0.5rem" }}>
                {NOMES_DOS_DIAS_DA_SEMANA.map((n, i) => <option key={n} value={i}>toda {n}</option>)}
              </select>
              <select aria-label="Quando" value={momento} onChange={(e) => setMomento(e.target.value)} style={{ border: `1px solid ${PALETA.areiaBorda}`, borderRadius: 8, padding: "0.5rem" }}>
                <option value="ANTES_DE_ABRIR">antes de abrir</option>
                <option value="DEPOIS_DE_FECHAR">depois de fechar</option>
              </select>
            </div>
            <span style={{ display: "block", fontSize: "0.8rem", color: PALETA.areiaTinta, marginTop: 6 }}>
              Ela vale o fim de <strong>{NOMES_DOS_DIAS_DA_SEMANA[fecha]}</strong>, então a semana do CMV vai de <strong>{NOMES_DOS_DIAS_DA_SEMANA[comeca]}</strong> a <strong>{NOMES_DOS_DIAS_DA_SEMANA[fecha]}</strong>.
            </span>
          </fieldset>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <button type="button" className="btn btn-primary" onClick={salvar}>Salvar</button>
            {msg && <span style={{ fontSize: "0.82rem", fontWeight: 700, color: msg.ok ? PALETA.ok : PALETA.grave }}>{msg.texto}</span>}
          </div>
        </div>
        <Ponteiro valor={previa} meta={previa} rotulo="Como fica a escala" tamanho={240} />
      </div>
    </Bloco>
  );
}
