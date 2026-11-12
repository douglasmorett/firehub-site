"use client";

/**
 * Aba 💰 Pagamentos da Escala da equipe — SÓ O DONO (como a diária).
 *
 * Douglas, 12/11/2026: "tem uma opção de colocar que essa pessoa já foi paga
 * naquele dia… pagou, ele bota que foi pago. Que aí ele tem o controle do que
 * pagou, do que não pagou, do que falta, do que está pendente."
 *
 *   - Período (semana, mês ou personalizado) com o resumo: devido, pago, pendente.
 *   - Uma linha por pessoa (Pix com "copiar"), que abre os turnos trabalhados:
 *     marcar pago um a um, desfazer, ou "Pagar tudo o que está pendente".
 *   - Turno de amanhã não aparece como "a pagar" (ainda não trabalhou).
 *   - Motoboy com o dia já pago no acerto (Motoboys › Relatório): aparece
 *     "pago no acerto", só leitura — dois controles pagando o mesmo dia é
 *     pagar em dobro.
 *   - Imprimir e baixar planilha do período.
 *
 * As contas são as de lib/escala-da-equipe/regras.ts (resumoDosPagamentos),
 * as mesmas do teste.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ROTULO_DO_PIX, chaveDaPessoa, dataValida, diaEMes, diaPorExtenso, horarioDoTurno, navegar, numeroDoDia, periodoDaVisao, pixFormatado,
  resumoDosPagamentos, situacaoDoPagamento, tipoDaChave, tituloDoPeriodo,
  type ItemDePagamento, type ResumoDaPessoa, type TipoDePessoa,
} from "@/lib/escala-da-equipe/regras";
import {
  Avatar, BotaoCopiarPix, COR, COR_CLARA, Janela, LINK_DO_ACERTO, S, SELO_DO_TIPO, SeloDoPagamento, SeloDoTipo, pedir, reais, reaisNoCampo,
  type Aviso, type Confirmacao,
} from "./ui";
import { CSS_DO_PAPEL } from "./Impressao";

export type PessoaDoPagamento = {
  tipo: TipoDePessoa; id: string; nome: string; funcao: string | null; diaria: number | null;
  pix: string | null; pixTipo: string | null; pixOrigem: string | null; pixAtualizadoEm: string | null;
};
type Dados = { hoje: string; de: string; ate: string; fuso: string; itens: ItemDePagamento[]; pessoas: PessoaDoPagamento[] };
type Modo = "semana" | "mes" | "personalizado";
type Filtro = "pendentes" | "todos";

const CHAVE_DO_MODO = "escala:pagamentos:modo";

/** "80,00", "1.200,50" ou "80.5" viram número; vazio/estranho = NaN. */
export function lerReais(t: string): number {
  const s = t.trim().replace(/[R$\s]/g, "");
  if (!s) return NaN;
  return Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
}

const quando = (iso: string, fuso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: fuso, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function Pagamentos({ hoje, nomeDaLoja, avisar, confirmar, onMudou }: {
  hoje: string; nomeDaLoja: string; avisar: (a: Aviso) => void; confirmar: (c: Confirmacao) => void; onMudou: () => void;
}) {
  const [modo, setModo] = useState<Modo>("semana");
  const [data, setData] = useState(hoje);
  const [de, setDe] = useState(() => periodoDaVisao("mes", hoje).de);
  const [ate, setAte] = useState(hoje);
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("pendentes");
  const [aberta, setAberta] = useState<string | null>(null);
  const [pagar, setPagar] = useState<{ itens: ItemDePagamento[]; pessoa: PessoaDoPagamento | null; tudo: boolean } | null>(null);
  const [imprimir, setImprimir] = useState(false);

  useEffect(() => {
    try { const m = localStorage.getItem(CHAVE_DO_MODO); if (m === "semana" || m === "mes") setModo(m); } catch {}
  }, []);
  const trocarModo = (m: Modo) => {
    setModo(m);
    try { if (m !== "personalizado") localStorage.setItem(CHAVE_DO_MODO, m); } catch {}
  };

  const periodo = modo === "personalizado" ? { de, ate } : periodoDaVisao(modo, data);
  const periodoOk = modo !== "personalizado" || (dataValida(de) && dataValida(ate) && numeroDoDia(ate) >= numeroDoDia(de) && numeroDoDia(ate) - numeroDoDia(de) <= 93);
  const titulo = modo === "personalizado" ? `${diaEMes(de)} a ${diaEMes(ate)}` : tituloDoPeriodo(modo, data);

  const carregar = useCallback(async () => {
    if (!periodoOk) return;
    setCarregando(true);
    try {
      setDados(await pedir<Dados>(`/api/store/escala/pagamentos?de=${periodo.de}&ate=${periodo.ate}`));
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [periodo.de, periodo.ate, periodoOk]);
  useEffect(() => { carregar(); }, [carregar]);

  const mudou = useCallback(() => { carregar(); onMudou(); }, [carregar, onMudou]);
  const fimDaImpressao = useCallback(() => setImprimir(false), []);

  const resumo = useMemo(() => (dados ? resumoDosPagamentos(dados.itens, dados.hoje) : null), [dados]);
  const pessoaDe = useMemo(() => new Map((dados?.pessoas || []).map((p) => [chaveDaPessoa(p.tipo, p.id), p])), [dados]);
  const futuros = useMemo(() => (dados ? dados.itens.filter((i) => situacaoDoPagamento(i, dados.hoje) === "futuro").length : 0), [dados]);
  const lista = (resumo?.porPessoa || []).filter((p) => filtro === "todos" || p.pendente > 0 || p.semValor > 0);

  function desfazer(i: ItemDePagamento) {
    if (!i.pagamento) return;
    const pg = i.pagamento;
    confirmar({
      titulo: "Desfazer o pagamento?",
      texto: `${i.nome} — ${diaPorExtenso(i.data)}, ${horarioDoTurno(i.inicio, i.fim)}.\nO turno volta para "a pagar" (${reais(pg.valor)}). O registro fica no histórico.`,
      botao: "Desfazer pagamento",
      perigo: true,
      acao: async () => {
        try {
          await pedir(`/api/store/escala/pagamentos/${pg.id}`, "DELETE");
          avisar({ tipo: "ok", titulo: "Pagamento desfeito", detalhe: `${i.nome}, ${diaEMes(i.data)}` });
          mudou();
        } catch (e: any) {
          avisar({ tipo: "erro", titulo: "Não deu para desfazer", detalhe: e.message });
        }
      },
    });
  }

  function baixarPlanilha() {
    if (!dados) return;
    const cel = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const linhas = [["Data", "Horário", "Função", "Pessoa", "Tipo", "Pix", "Situação", "Valor", "Pago em", "Pago por", "Observação"].map(cel).join(";")];
    for (const p of resumo?.porPessoa || []) {
      const pe = pessoaDe.get(chaveDaPessoa(p.pessoaTipo, p.pessoaId));
      for (const i of p.itens) {
        const s = situacaoDoPagamento(i, dados.hoje);
        const valor = i.pagamento ? i.pagamento.valor : s === "pendente" && i.diaria ? i.diaria : null;
        linhas.push([
          diaEMes(i.data), horarioDoTurno(i.inicio, i.fim), i.funcao, i.nome, SELO_DO_TIPO[i.pessoaTipo].rotulo, pe?.pix ? pixFormatado(pe.pix, pe.pixTipo) : "",
          s === "pago" ? "Pago" : s === "acerto" ? `Pago no acerto (${diaEMes(i.acerto!.dia)})` : i.diaria ? "A pagar" : "A pagar (sem valor combinado)",
          valor != null ? valor.toFixed(2).replace(".", ",") : "", i.pagamento ? quando(i.pagamento.pagoEm, dados.fuso) : "", i.pagamento?.pagoPor || "", i.pagamento?.obs || "",
        ].map(cel).join(";"));
      }
    }
    // BOM: o Excel em português só lê os acentos com ele.
    const blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `pagamentos-escala-${periodo.de}-a-${periodo.ate}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  return (
    <div style={{ marginTop: 14 }}>
      <div className="esc-barra" style={{ marginTop: 0 }}>
        <div className="esc-segmento" role="group" aria-label="Período">
          {([["semana", "Semana"], ["mes", "Mês"], ["personalizado", "Escolher datas"]] as Array<[Modo, string]>).map(([m, r]) => (
            <button key={m} type="button" className={modo === m ? "ativa" : ""} onClick={() => trocarModo(m)}>{r}</button>
          ))}
        </div>
        {modo !== "personalizado" ? (
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" style={{ ...S.botaoLeve, width: 42, padding: 0 }} aria-label="Anterior" onClick={() => setData(navegar(modo, data, -1))}>‹</button>
            <button type="button" style={S.botaoLeve} onClick={() => setData(hoje)}>Hoje</button>
            <button type="button" style={{ ...S.botaoLeve, width: 42, padding: 0 }} aria-label="Próximo" onClick={() => setData(navegar(modo, data, 1))}>›</button>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} style={{ ...S.campo, width: 160, padding: "8px 10px" }} aria-label="De" />
            <span style={{ color: "#64748B", fontWeight: 700 }}>a</span>
            <input type="date" value={ate} min={de} onChange={(e) => setAte(e.target.value)} style={{ ...S.campo, width: 160, padding: "8px 10px" }} aria-label="Até" />
          </div>
        )}
        <strong style={{ fontSize: 17, color: "#0F172A", flex: 1, minWidth: 160 }}>
          {titulo.charAt(0).toUpperCase() + titulo.slice(1)} {carregando && <span style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600 }}>atualizando…</span>}
        </strong>
        <button type="button" style={S.botaoLeve} disabled={!dados} onClick={baixarPlanilha} title="Planilha (CSV) com cada turno do período">⬇️ Planilha</button>
        <button type="button" style={S.botaoLeve} disabled={!resumo} onClick={() => setImprimir(true)}>🖨️ Imprimir</button>
      </div>
      {!periodoOk && <p style={{ ...S.texto, color: "#B45309", marginBottom: 10 }}>Escolha um período de até 3 meses, com o "de" antes do "até".</p>}
      {erro && <div style={{ ...S.cartao, borderColor: "#FECACA", background: "#FEF2F2", marginBottom: 12 }}><strong>Não deu para abrir os pagamentos.</strong> <span style={S.texto}>{erro}</span></div>}

      {resumo && (
        <div className="esc-resumo">
          <Numero rotulo="Devido no período" valor={reais(resumo.devido)} dica={`${resumo.turnos} turno${resumo.turnos === 1 ? "" : "s"} trabalhado${resumo.turnos === 1 ? "" : "s"}`} />
          <Numero rotulo="Pago" valor={reais(resumo.pago)} cor="#047857" />
          <Numero rotulo="Pendente" valor={reais(resumo.pendente)} cor={resumo.pendente > 0 ? "#B45309" : "#047857"}
            dica={resumo.semValor ? `+ ${resumo.semValor} turno(s) sem valor combinado` : resumo.pendente > 0 ? "Diária combinada dos turnos sem pagamento" : "Tudo pago"} />
          {resumo.noAcerto > 0 && <Numero rotulo="Pagos no acerto do motoboy" valor={String(resumo.noAcerto)} cor={COR} dica="Turnos de motoboy cujo dia já foi pago no acerto" />}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
        {([["pendentes", "Só quem tem pendência"], ["todos", "Todos"]] as Array<[Filtro, string]>).map(([f, r]) => (
          <button key={f} type="button" onClick={() => setFiltro(f)} style={{
            ...S.botaoPequeno, borderColor: filtro === f ? COR : "#CBD5E1", background: filtro === f ? COR_CLARA : "#fff", color: filtro === f ? COR : "#334155",
          }}>{r}</button>
        ))}
        {futuros > 0 && <span style={{ fontSize: 12.5, color: "#94A3B8" }}>{futuros} turno(s) ainda por vir no período não entram na conta.</span>}
      </div>

      {dados && lista.length === 0 && (
        <div style={{ ...S.cartao, textAlign: "center" }}>
          <p style={S.texto}>{resumo && resumo.turnos > 0 ? "Ninguém com pagamento pendente neste período. 🎉" : "Ninguém trabalhou neste período (ou ainda não chegou o dia)."}</p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {lista.map((p) => {
          const k = chaveDaPessoa(p.pessoaTipo, p.pessoaId);
          const pe = pessoaDe.get(k) || null;
          const pendentes = p.itens.filter((i) => situacaoDoPagamento(i, dados!.hoje) === "pendente");
          return (
            <div key={k} style={{ ...S.cartao, padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <Avatar nome={p.nome} tipo={p.pessoaTipo} tamanho={40} />
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 15.5, color: "#0F172A" }}>{p.nome}</strong>
                    <SeloDoTipo tipo={p.pessoaTipo} />
                    {pe?.funcao && <span style={{ fontSize: 12.5, color: "#64748B" }}>{pe.funcao}</span>}
                  </div>
                  <LinhaDoPix pessoa={pe} nome={p.nome} avisar={avisar} />
                </div>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "baseline" }}>
                  <Valor rotulo="Turnos" valor={String(p.turnos)} />
                  <Valor rotulo="Devido" valor={reais(p.devido)} />
                  <Valor rotulo="Pago" valor={reais(p.pago)} cor="#047857" />
                  <Valor rotulo="Pendente" valor={p.pendente > 0 ? reais(p.pendente) : p.semValor ? "—" : reais(0)} cor={p.pendente > 0 || p.semValor ? "#B45309" : "#047857"}
                    extra={p.semValor ? `${p.semValor} sem valor combinado` : p.noAcerto ? `${p.noAcerto} pago(s) no acerto` : undefined} />
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button type="button" style={S.botaoPequeno} onClick={() => setAberta(aberta === k ? null : k)} aria-expanded={aberta === k}>
                  {aberta === k ? "▲ Esconder os turnos" : `▼ Ver os ${p.turnos} turno${p.turnos === 1 ? "" : "s"}`}
                </button>
                {pendentes.length > 0 && (
                  <button type="button" style={{ ...S.botaoPequeno, background: "#059669", borderColor: "#059669", color: "#fff" }}
                    onClick={() => setPagar({ itens: pendentes, pessoa: pe, tudo: true })}>
                    💵 Pagar tudo o que está pendente{p.pendente > 0 && !p.semValor ? ` (${reais(p.pendente)})` : ""}
                  </button>
                )}
              </div>
              {aberta === k && <TurnosDaPessoa p={p} hoje={dados!.hoje} fuso={dados!.fuso} onPagar={(i) => setPagar({ itens: [i], pessoa: pe, tudo: false })} onDesfazer={desfazer} />}
            </div>
          );
        })}
      </div>

      {pagar && <JanelaDePagar itens={pagar.itens} pessoa={pagar.pessoa} tudo={pagar.tudo} avisar={avisar} onFechar={() => setPagar(null)} onPago={() => { setPagar(null); mudou(); }} />}
      {imprimir && resumo && dados && (
        <ImpressaoDosPagamentos titulo={titulo} nomeDaLoja={nomeDaLoja} resumo={resumo} pessoaDe={pessoaDe} hoje={dados.hoje} onPronto={fimDaImpressao} />
      )}
    </div>
  );
}

function Numero({ rotulo, valor, cor = "#0F172A", dica }: { rotulo: string; valor: string; cor?: string; dica?: string }) {
  return (
    <div style={{ ...S.cartao, padding: "12px 16px", flex: "1 1 170px" }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: "#64748B" }}>{rotulo}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: cor, letterSpacing: -0.4 }}>{valor}</div>
      {dica && <div style={{ fontSize: 11, color: "#94A3B8" }}>{dica}</div>}
    </div>
  );
}

function Valor({ rotulo, valor, cor = "#0F172A", extra }: { rotulo: string; valor: string; cor?: string; extra?: string }) {
  return (
    <div style={{ minWidth: 72 }}>
      <div style={{ fontSize: 11, fontWeight: 800, color: "#94A3B8", textTransform: "uppercase", letterSpacing: 0.3 }}>{rotulo}</div>
      <div style={{ fontSize: 16, fontWeight: 900, color: cor }}>{valor}</div>
      {extra && <div style={{ fontSize: 11, color: "#B45309", fontWeight: 700 }}>{extra}</div>}
    </div>
  );
}

/** O Pix da pessoa com "copiar" — e o aviso quando a chave foi trocada pelo link. */
export function LinhaDoPix({ pessoa, nome, avisar }: { pessoa: Pick<PessoaDoPagamento, "pix" | "pixTipo" | "pixOrigem" | "pixAtualizadoEm"> | null; nome: string; avisar: (a: Aviso) => void }) {
  if (!pessoa?.pix) return <div style={{ fontSize: 12.5, color: "#94A3B8", marginTop: 2 }}>Sem chave Pix — ela pode informar pelo link de inscrição, ou cadastre na aba Pessoas.</div>;
  const tipo = tipoDaChave(pessoa.pix, pessoa.pixTipo);
  return (
    <div style={{ marginTop: 3 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", fontSize: 13, color: "#334155" }}>
        <span>Pix{tipo ? ` (${ROTULO_DO_PIX[tipo]})` : ""}: <b>{pixFormatado(pessoa.pix, pessoa.pixTipo)}</b></span>
        <BotaoCopiarPix pix={pessoa.pix} pixTipo={pessoa.pixTipo} nome={nome} avisar={avisar} rotulo="📋 Copiar Pix" />
      </div>
      {pessoa.pixOrigem === "troca-link" && (
        <div style={{ fontSize: 12, color: "#B45309", fontWeight: 700, marginTop: 2 }}>
          ⚠️ Chave trocada pelo link{pessoa.pixAtualizadoEm ? ` em ${new Date(pessoa.pixAtualizadoEm).toLocaleDateString("pt-BR")}` : ""} — confirme com a pessoa antes de pagar.
        </div>
      )}
    </div>
  );
}

function TurnosDaPessoa({ p, hoje, fuso, onPagar, onDesfazer }: {
  p: ResumoDaPessoa; hoje: string; fuso: string; onPagar: (i: ItemDePagamento) => void; onDesfazer: (i: ItemDePagamento) => void;
}) {
  return (
    <div style={{ marginTop: 10, borderTop: "1px solid #F1F5F9", display: "flex", flexDirection: "column" }}>
      {p.itens.map((i) => {
        const s = situacaoDoPagamento(i, hoje);
        return (
          <div key={i.inscricaoId} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 2px", borderBottom: "1px solid #F8FAFC" }}>
            <div style={{ flex: "1 1 200px", minWidth: 0 }}>
              <div style={{ fontWeight: 800, fontSize: 14, textTransform: "capitalize" }}>{diaPorExtenso(i.data)}</div>
              <div style={{ fontSize: 12.5, color: "#64748B" }}>{horarioDoTurno(i.inicio, i.fim)} · {i.funcao}</div>
            </div>
            <SeloDoPagamento situacao={s} />
            {s === "pago" && i.pagamento && (
              <span style={{ fontSize: 12.5, color: "#475569" }}>
                <b style={{ color: "#047857" }}>{reais(i.pagamento.valor)}</b>{i.pagamento.forma ? ` · ${i.pagamento.forma === "pix" ? "Pix" : "dinheiro"}` : ""} · {quando(i.pagamento.pagoEm, fuso)}{i.pagamento.pagoPor ? ` por ${i.pagamento.pagoPor}` : ""}
                {i.pagamento.obs && <span style={{ display: "block", color: "#64748B" }}>📝 {i.pagamento.obs}</span>}
              </span>
            )}
            {s === "pendente" && <span style={{ fontSize: 13, fontWeight: 800, color: i.diaria ? "#B45309" : "#94A3B8" }}>{i.diaria ? reais(i.diaria) : "sem valor combinado"}</span>}
            {s === "acerto" && i.acerto && (
              <a href={LINK_DO_ACERTO} style={{ fontSize: 12.5, color: COR, fontWeight: 800 }} title="Abrir o relatório de pagamentos dos motoboys">
                Pago no acerto ({diaEMes(i.acerto.dia)}) ↗
              </a>
            )}
            <span style={{ marginLeft: "auto" }}>
              {s === "pendente" && <button type="button" style={{ ...S.botaoPequeno, borderColor: "#059669", color: "#047857" }} onClick={() => onPagar(i)}>Marcar pago</button>}
              {s === "pago" && <button type="button" style={{ ...S.botaoPequeno, border: 0, color: "#B91C1C", textDecoration: "underline" }} onClick={() => onDesfazer(i)}>desfazer</button>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Marcar como pago: um turno (o valor nasce com a diária combinada) ou o
 * "pagar tudo" (o total pendente — o dono confirma ou digita outro, e o
 * servidor divide entre os turnos pela diária de cada um).
 */
export function JanelaDePagar({ itens, pessoa, tudo, avisar, onFechar, onPago }: {
  itens: ItemDePagamento[]; pessoa: PessoaDoPagamento | null; tudo: boolean; avisar: (a: Aviso) => void; onFechar: () => void; onPago: () => void;
}) {
  const nome = itens[0]?.nome || pessoa?.nome || "";
  const comDiaria = itens.every((i) => Number(i.diaria) > 0);
  const soma = Math.round(itens.reduce((s, i) => s + (Number(i.diaria) > 0 ? Number(i.diaria) : 0), 0) * 100) / 100;
  const [valor, setValor] = useState(comDiaria ? reaisNoCampo(soma) : "");
  const [forma, setForma] = useState<"pix" | "dinheiro" | null>(pessoa?.pix ? "pix" : null);
  const [obs, setObs] = useState("");
  const [enviando, setEnviando] = useState(false);
  const n = lerReais(valor);
  const valido = Number.isFinite(n) && n > 0;

  async function confirmar() {
    if (!valido) return avisar({ tipo: "atencao", titulo: "Digite o valor pago" });
    setEnviando(true);
    try {
      await pedir("/api/store/escala/pagamentos", "POST", { inscricaoIds: itens.map((i) => i.inscricaoId), valor: n, forma, obs });
      avisar({ tipo: "ok", titulo: `${nome}: ${reais(n)} marcado como pago`, detalhe: itens.length > 1 ? `${itens.length} turnos` : `${diaPorExtenso(itens[0].data)}` });
      onPago();
    } catch (e: any) {
      avisar({ tipo: "erro", titulo: "Não deu para marcar o pagamento", detalhe: e.message });
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Janela largura={480} onFechar={onFechar}
      titulo={tudo ? `💵 Pagar tudo de ${nome}` : `💵 Marcar pago — ${nome}`}
      subtitulo={itens.length === 1 ? `${diaPorExtenso(itens[0].data)} · ${horarioDoTurno(itens[0].inicio, itens[0].fim)} · ${itens[0].funcao}` : `${itens.length} turnos pendentes: ${itens.map((i) => diaEMes(i.data)).join(", ")}`}
      rodape={<>
        <button type="button" style={S.botaoLeve} onClick={onFechar} disabled={enviando}>Voltar</button>
        <button type="button" style={{ ...S.botao, background: "#059669", opacity: valido && !enviando ? 1 : 0.6 }} disabled={!valido || enviando} onClick={confirmar}>
          {enviando ? "Marcando…" : valido ? `Confirmar: pago ${reais(n)}` : "Confirmar"}
        </button>
      </>}>
      <LinhaDoPix pessoa={pessoa} nome={nome} avisar={avisar} />
      <label style={{ display: "block", marginTop: 12 }}>
        <span style={S.rotulo}>{tudo ? "Valor total pago" : "Valor pago"}</span>
        <input autoFocus value={valor} inputMode="decimal" onChange={(e) => setValor(e.target.value)} placeholder="80,00" style={{ ...S.campo, fontSize: 20, fontWeight: 800 }} />
        <span style={{ fontSize: 12, color: "#64748B" }}>
          {comDiaria
            ? `${itens.length > 1 ? "Soma das diárias combinadas" : "Diária combinada"}: ${reais(soma)}. Pagou outro valor? É só mudar.`
            : itens.some((i) => Number(i.diaria) > 0)
              ? "Parte destes turnos não tem diária combinada — digite o total que pagou."
              : "Sem valor combinado — digite o que pagou."}
          {tudo && itens.length > 1 ? " O total é dividido entre os turnos pela diária de cada um." : ""}
        </span>
      </label>
      <div style={{ marginTop: 12 }}>
        <span style={S.rotulo}>Forma (opcional)</span>
        <div style={{ display: "flex", gap: 6 }}>
          {([["pix", "Pix"], ["dinheiro", "Dinheiro"]] as const).map(([f, r]) => (
            <button key={f} type="button" onClick={() => setForma(forma === f ? null : f)} style={{
              ...S.botaoPequeno, borderColor: forma === f ? COR : "#CBD5E1", background: forma === f ? COR_CLARA : "#fff", color: forma === f ? COR : "#334155",
            }}>{r}</button>
          ))}
        </div>
      </div>
      <label style={{ display: "block", marginTop: 12 }}>
        <span style={S.rotulo}>Observação (opcional)</span>
        <input value={obs} maxLength={300} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: pago junto com a gorjeta" style={S.campo} />
      </label>
    </Janela>
  );
}

/** O relatório de pagamentos do período no papel (A4), no mesmo estilo da escala impressa. */
function ImpressaoDosPagamentos({ titulo, nomeDaLoja, resumo, pessoaDe, hoje, onPronto }: {
  titulo: string; nomeDaLoja: string; resumo: ReturnType<typeof resumoDosPagamentos>; pessoaDe: Map<string, PessoaDoPagamento>; hoje: string; onPronto: () => void;
}) {
  const [montado, setMontado] = useState(false);
  const imprimiu = useRef(false);
  useEffect(() => setMontado(true), []);
  useEffect(() => {
    if (!montado || imprimiu.current) return;
    const t = setTimeout(() => {
      imprimiu.current = true;
      window.addEventListener("afterprint", () => onPronto(), { once: true });
      window.print();
    }, 150);
    return () => clearTimeout(t);
  }, [montado, onPronto]);
  if (!montado) return null;
  const impressoEm = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  const dias = (p: ResumoDaPessoa, s: string) => p.itens.filter((i) => situacaoDoPagamento(i, hoje) === s).map((i) => diaEMes(i.data)).join(", ");

  return createPortal(
    <div className="esc-papel">
      <style>{CSS_DO_PAPEL}</style>
      <div className="cabeca">
        <div>
          <div className="loja">{nomeDaLoja}</div>
          <h1>Pagamentos da equipe — {titulo}</h1>
        </div>
        <div className="impresso">Impresso em {impressoEm}</div>
      </div>
      {resumo.porPessoa.length === 0 ? <p>Ninguém trabalhou neste período.</p> : (
        <table>
          <thead>
            <tr><th>Pessoa</th><th style={{ width: "22%" }}>Pix</th><th style={{ width: "8%" }}>Turnos</th><th style={{ width: "11%" }}>Devido</th><th style={{ width: "11%" }}>Pago</th><th style={{ width: "11%" }}>Pendente</th></tr>
          </thead>
          <tbody>
            {resumo.porPessoa.map((p) => {
              const pe = pessoaDe.get(chaveDaPessoa(p.pessoaTipo, p.pessoaId));
              const pagos = dias(p, "pago"), pend = dias(p, "pendente"), acerto = dias(p, "acerto");
              return (
                <tr key={chaveDaPessoa(p.pessoaTipo, p.pessoaId)} className="bloco">
                  <td>
                    <b>{p.nome}</b> <small>({SELO_DO_TIPO[p.pessoaTipo].rotulo.toLowerCase()})</small>
                    <div className="obs">
                      {pagos && <>Pago: {pagos}. </>}{pend && <>A pagar: {pend}. </>}{acerto && <>No acerto do motoboy: {acerto}.</>}
                    </div>
                  </td>
                  <td>{pe?.pix ? pixFormatado(pe.pix, pe.pixTipo) : "—"}</td>
                  <td>{p.turnos}</td>
                  <td>{reais(p.devido)}</td>
                  <td>{reais(p.pago)}</td>
                  <td className={p.pendente > 0 || p.semValor ? "falta" : ""}>{reais(p.pendente)}{p.semValor ? <div className="obs">+ {p.semValor} sem valor</div> : null}</td>
                </tr>
              );
            })}
            <tr className="bloco">
              <td colSpan={3}><b>Total</b></td>
              <td><b>{reais(resumo.devido)}</b></td>
              <td><b>{reais(resumo.pago)}</b></td>
              <td className="falta"><b>{reais(resumo.pendente)}</b></td>
            </tr>
          </tbody>
        </table>
      )}
    </div>,
    document.body,
  );
}

