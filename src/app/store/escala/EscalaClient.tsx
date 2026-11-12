"use client";

/**
 * Escala da equipe — a tela do lojista (/store/escala).
 *
 * O pedido (Lucas, Frangoso — Douglas, 11/11/2026): equipe sem carteira e
 * motoboy freelancer; ele combinava turno com um e com outro e se perdia —
 * faltava ou sobrava motoboy. Agora ele abre as vagas por dia e turno
 * ("segunda à noite: 2 motoboys, 1 atendente"), manda o link no grupo, o
 * pessoal se inscreve sozinho até o prazo, ele encaixa quem quiser, vê "hoje
 * vem fulano e sicrano" e imprime para colar na parede.
 *
 * Incluso no plano, para todas as lojas (sem liga/desliga de módulo pago).
 * Abas: Escala (dia/semana/mês), Pessoas, Link de inscrição.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { diaEMes, horarioDoTurno, navegar, periodoDaVisao, situacaoDasVagas, tituloDoPeriodo, type Visao } from "@/lib/escala-da-equipe/regras";
import { AvisoNoTopo, COR, COR_CLARA, ErroDaApi, JanelaDeConfirmacao, S, pedir, reais, type Arrasto, type Aviso, type Confirmacao, type ConfigDoLink, type DadosDaEscala, type Turno } from "./ui";
import { BarraDasVagas, CSS_DO_CALENDARIO, VisaoDaSemana, VisaoDoDia, VisaoDoMes } from "./Calendario";
import PessoasAoLado from "./PessoasAoLado";
import { DetalheDoTurno, FormDoTurno } from "./JanelaDoTurno";
import Pessoas from "./Pessoas";
import LinkDeInscricao from "./LinkDeInscricao";
import Impressao, { type O_QUE_IMPRIMIR } from "./Impressao";

type Aba = "escala" | "pessoas" | "link";
const CHAVE_DA_VISAO = "escala:visao";
const CHAVE_DO_LADO = "escala:pessoas-ao-lado";

export default function EscalaClient() {
  const [aba, setAba] = useState<Aba>("escala");
  const [visao, setVisao] = useState<Visao>("semana");
  const [data, setData] = useState<string | null>(null);
  const [dados, setDados] = useState<DadosDaEscala | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [confirmacao, setConfirmacao] = useState<Confirmacao | null>(null);
  const [form, setForm] = useState<{ turno?: Turno; data: string } | null>(null);
  const [aberto, setAberto] = useState<string | null>(null);
  const [imprimir, setImprimir] = useState<O_QUE_IMPRIMIR | null>(null);
  const [copiando, setCopiando] = useState(false);
  // A lista de pessoas ao lado (arrastar para o turno) — lembrada por navegador.
  const [lado, setLado] = useState(true);

  useEffect(() => {
    try { const v = localStorage.getItem(CHAVE_DA_VISAO) as Visao | null; if (v === "dia" || v === "semana" || v === "mes") setVisao(v); } catch {}
    try { if (localStorage.getItem(CHAVE_DO_LADO) === "0") setLado(false); } catch {}
  }, []);
  const mostrarLado = (v: boolean) => {
    setLado(v);
    try { localStorage.setItem(CHAVE_DO_LADO, v ? "1" : "0"); } catch {}
  };
  const trocarVisao = (v: Visao) => {
    setVisao(v);
    try { localStorage.setItem(CHAVE_DA_VISAO, v); } catch {}
  };

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      // A primeira carga vem sem período: o servidor diz que dia é hoje NA LOJA.
      const q = data ? `?de=${periodoDaVisao(visao, data).de}&ate=${periodoDaVisao(visao, data).ate}` : "";
      const d = await pedir<DadosDaEscala>(`/api/store/escala${q}`);
      setDados(d);
      setErro(null);
      if (!data) setData(d.hoje);
    } catch (e: any) {
      setErro(e.message);
    } finally {
      setCarregando(false);
    }
  }, [data, visao]);
  useEffect(() => { carregar(); }, [carregar]);

  const avisar = useCallback((a: Aviso) => setAviso(a), []);
  const fecharAviso = useCallback(() => setAviso(null), []);
  const fimDaImpressao = useCallback(() => setImprimir(null), []);

  const turnos = dados?.turnos ?? [];
  const turnoAberto = turnos.find((t) => t.id === aberto) || null;
  const resumo = useMemo(() => {
    let vagas = 0, preenchidas = 0, faltam = 0;
    for (const t of turnos) {
      const v = situacaoDasVagas(t.inscritos.length, t.vagas);
      vagas += v.vagas; preenchidas += Math.min(v.preenchidas, v.vagas); faltam += v.faltam;
    }
    return { vagas, preenchidas, faltam };
  }, [turnos]);
  const funcoesUsadas = useMemo(() => [...new Set(turnos.map((t) => t.funcao))], [turnos]);

  if (erro && !dados) {
    return (
      <div className="container" style={{ marginTop: "1.5rem" }}>
        <div style={{ ...S.cartao, borderColor: "#FECACA", background: "#FEF2F2" }}>
          <strong>Não deu para abrir a escala.</strong>
          <p style={{ ...S.texto, marginTop: 4 }}>{erro}</p>
          <button type="button" style={{ ...S.botao, marginTop: 10 }} onClick={carregar}>Tentar de novo</button>
        </div>
      </div>
    );
  }
  if (!dados || !data) return <div className="container" style={{ marginTop: "1.5rem", color: "#64748B" }}>Carregando a escala…</div>;

  function apagar(t: Turno) {
    const fazer = async (confirmado: boolean) => {
      try {
        await pedir(`/api/store/escala/turnos/${t.id}${confirmado ? "?confirmar=1" : ""}`, "DELETE");
        setAberto(null);
        avisar({ tipo: "ok", titulo: "Turno apagado" });
        carregar();
      } catch (e: any) {
        avisar({ tipo: "erro", titulo: "Não deu para apagar", detalhe: e.message });
      }
    };
    if (t.inscritos.length === 0) return fazer(false);
    setConfirmacao({
      titulo: "Apagar turno com gente inscrita?",
      texto: `${t.inscritos.map((i) => i.nome).join(", ")} ${t.inscritos.length === 1 ? "sai" : "saem"} da escala.\nAvise ${t.inscritos.length === 1 ? "a pessoa" : "o pessoal"} — o link não manda mensagem sozinho.`,
      botao: "Apagar turno",
      perigo: true,
      acao: () => fazer(true),
    });
  }

  /**
   * Soltou alguém num turno: da lista = escalar; de outro turno = mudar (entra
   * no novo e só depois sai do antigo — se a entrada falhar, nada muda).
   * Turno cheio pergunta "abrir mais uma vaga?", como no detalhe do turno.
   */
  async function soltar(turno: Turno, a: Arrasto) {
    const onde = `${turno.funcao}, ${diaEMes(turno.data)} ${horarioDoTurno(turno.inicio, turno.fim)}`;
    const fazer = async (aumentarVaga: boolean) => {
      await pedir("/api/store/escala/inscricoes", "POST", { turnoId: turno.id, pessoaTipo: a.pessoaTipo, pessoaId: a.pessoaId, aumentarVaga });
      if (a.tipo === "inscricao") await pedir(`/api/store/escala/inscricoes/${a.inscricaoId}`, "DELETE");
      avisar({ tipo: "ok", titulo: a.tipo === "inscricao" ? `${a.nome} mudou de turno` : `${a.nome} escalado(a)`, detalhe: onde });
      carregar();
    };
    try {
      await fazer(false);
    } catch (e: any) {
      if (e instanceof ErroDaApi && e.dados?.codigo === "CHEIO") {
        setConfirmacao({
          titulo: "Turno cheio",
          texto: `As ${turno.vagas} vaga(s) de ${onde} já estão preenchidas.\nAbrir mais uma vaga e colocar ${a.nome}?`,
          botao: "Abrir vaga e colocar",
          acao: () => fazer(true).catch((e2: any) => avisar({ tipo: "erro", titulo: "Não deu certo", detalhe: e2.message })),
        });
      } else {
        avisar({ tipo: "erro", titulo: `Não deu para colocar ${a.nome}`, detalhe: e.message });
        carregar();
      }
    }
  }

  async function tirarArrastando(a: Extract<Arrasto, { tipo: "inscricao" }>) {
    try {
      await pedir(`/api/store/escala/inscricoes/${a.inscricaoId}`, "DELETE");
      avisar({ tipo: "ok", titulo: `${a.nome} saiu do turno` });
      carregar();
    } catch (e: any) {
      avisar({ tipo: "erro", titulo: "Não deu para tirar", detalhe: e.message });
    }
  }

  async function copiarSemanaAnterior() {
    setCopiando(true);
    try {
      const r = await pedir<{ criados: number; jaExistiam: number }>("/api/store/escala/copiar-semana", "POST", { semana: data });
      avisar(r.criados
        ? { tipo: "ok", titulo: `${r.criados} turno${r.criados === 1 ? "" : "s"} copiado${r.criados === 1 ? "" : "s"} da semana anterior`, detalhe: `Sem as pessoas — cada semana tem as suas inscrições.${r.jaExistiam ? ` ${r.jaExistiam} já existia(m) e não foram duplicados.` : ""}` }
        : { tipo: "info", titulo: "Nada para copiar", detalhe: "Os turnos da semana anterior já estão nesta semana." });
      carregar();
    } catch (e: any) {
      avisar({ tipo: e instanceof ErroDaApi && e.status === 400 ? "atencao" : "erro", titulo: e.message });
    } finally {
      setCopiando(false);
    }
  }

  const ABAS: Array<[Aba, string]> = [["escala", "📅 Escala"], ["pessoas", "👥 Pessoas"], ["link", "🔗 Link de inscrição"]];

  return (
    <div className="esc-pagina" style={{ padding: "18px clamp(12px, 2vw, 28px) 120px" }}>
      <style>{CSS_DA_PAGINA + CSS_DO_CALENDARIO}</style>
      <AvisoNoTopo aviso={aviso} onFechar={fecharAviso} />

      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <h1 className="font-bold" style={{ fontSize: "1.8rem", margin: 0 }}>📅 Escala da equipe</h1>
          <p className="text-muted" style={{ margin: "4px 0 0" }}>Abra as vagas por turno, mande o link no grupo e veja quem vem — motoboys, equipe e freelancers.</p>
        </div>
        <button type="button" style={S.botao} onClick={() => { setAba("escala"); setForm({ data }); }}>+ Novo turno</button>
      </div>

      <div className="esc-abas">
        {ABAS.map(([a, rotulo]) => (
          <button key={a} type="button" className={aba === a ? "ativa" : ""} onClick={() => setAba(a)}>
            {rotulo}{a === "pessoas" && <span className="conta">{dados.pessoas.filter((p) => p.ativo).length}</span>}
          </button>
        ))}
      </div>

      {aba === "escala" && (
        <>
          <div className="esc-barra">
            <div className="esc-segmento" role="group" aria-label="Visão">
              {([["dia", "Dia"], ["semana", "Semana"], ["mes", "Mês"]] as Array<[Visao, string]>).map(([v, r]) => (
                <button key={v} type="button" className={visao === v ? "ativa" : ""} onClick={() => trocarVisao(v)}>{r}</button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button type="button" style={{ ...S.botaoLeve, width: 42, padding: 0 }} aria-label="Anterior" onClick={() => setData(navegar(visao, data, -1))}>‹</button>
              <button type="button" style={S.botaoLeve} onClick={() => setData(dados.hoje)}>Hoje</button>
              <button type="button" style={{ ...S.botaoLeve, width: 42, padding: 0 }} aria-label="Próximo" onClick={() => setData(navegar(visao, data, 1))}>›</button>
            </div>
            <strong style={{ fontSize: 17, color: "#0F172A", flex: 1, minWidth: 160 }}>
              {maiuscula(tituloDoPeriodo(visao, data))} {carregando && <span style={{ fontSize: 12, color: "#94A3B8", fontWeight: 600 }}>atualizando…</span>}
            </strong>
            {visao === "semana" && (
              <button type="button" style={S.botaoLeve} disabled={copiando} onClick={copiarSemanaAnterior} title="Cria nesta semana os mesmos turnos da semana passada (sem as pessoas)">
                {copiando ? "Copiando…" : "⧉ Copiar semana anterior"}
              </button>
            )}
            {visao !== "mes" && !lado && (
              <button type="button" style={S.botaoLeve} onClick={() => mostrarLado(true)} title="Mostrar a lista de pessoas para arrastar para os turnos">👥 Pessoas ao lado</button>
            )}
            <button type="button" style={S.botaoLeve} onClick={() => setImprimir("escala")}>🖨️ Imprimir</button>
          </div>

          <div className="esc-resumo">
            <Numero rotulo="Turnos" valor={String(turnos.length)} />
            <Numero rotulo="Vagas preenchidas" valor={`${resumo.preenchidas}/${resumo.vagas}`}
              barra={<BarraDasVagas preenchidas={resumo.preenchidas} vagas={resumo.vagas} cor={resumo.faltam ? "#B45309" : "#047857"} />} />
            <Numero rotulo="Faltam" valor={String(resumo.faltam)} cor={resumo.faltam > 0 ? "#DC2626" : "#047857"} />
            {dados.custo && (
              <Numero rotulo="Custo previsto (diárias)" valor={reais(dados.custo.total)} cor={COR}
                dica={dados.custo.semValor ? `${dados.custo.semValor} inscrição(ões) sem diária combinada fora da conta` : "Soma das diárias combinadas de quem está inscrito"} />
            )}
          </div>

          {turnos.length === 0 && !carregando && (
            <div style={{ ...S.cartao, marginBottom: 12, background: COR_CLARA, borderColor: "#99F6E4" }}>
              <strong style={{ color: COR }}>Nenhum turno neste período.</strong>
              <p style={{ ...S.texto, marginTop: 4 }}>
                Crie o turno (ex.: segunda 18:00–23:30, Motoboy, 2 vagas) e marque "Repetir" para preencher a semana ou o mês de uma vez.
                {visao === "semana" ? " Ou copie a semana anterior." : ""} Depois mande o link da aba "Link de inscrição" no grupo.
              </p>
            </div>
          )}

          <div className={`esc-com-lado${visao !== "mes" && lado ? " aberto" : ""}`}>
            <div style={{ minWidth: 0 }}>
              {visao === "dia" && <VisaoDoDia data={data} hoje={dados.hoje} turnos={turnos} mostrarDiaria={dados.ehDono} onAbrir={(t) => setAberto(t.id)} onNovo={() => setForm({ data })} onSoltar={soltar} />}
              {visao === "semana" && <VisaoDaSemana data={data} hoje={dados.hoje} turnos={turnos} onAbrir={(t) => setAberto(t.id)} onNovo={(d) => setForm({ data: d })} onDia={(d) => { setData(d); trocarVisao("dia"); }} onSoltar={soltar} />}
              {visao === "mes" && <VisaoDoMes data={data} hoje={dados.hoje} turnos={turnos} onDia={(d) => { setData(d); trocarVisao("dia"); }} />}
            </div>
            {visao !== "mes" && lado && <PessoasAoLado pessoas={dados.pessoas} turnos={turnos} onTirar={tirarArrastando} onFechar={() => mostrarLado(false)} />}
          </div>

          {dados.custo && dados.custo.porPessoa.length > 0 && (
            <details style={{ ...S.cartao, marginTop: 14 }}>
              <summary style={{ cursor: "pointer", fontWeight: 800, color: "#0F172A" }}>Custo previsto por pessoa — {reais(dados.custo.total)} <span style={{ fontWeight: 600, color: "#94A3B8", fontSize: 12.5 }}>(só o dono vê)</span></summary>
              <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, fontSize: 14 }}>
                <tbody>
                  {dados.custo.porPessoa.map((p) => (
                    <tr key={p.nome} style={{ borderTop: "1px solid #F1F5F9" }}>
                      <td style={{ padding: "6px 4px", fontWeight: 700 }}>{p.nome}</td>
                      <td style={{ padding: "6px 4px", color: "#64748B" }}>{p.turnos} turno{p.turnos === 1 ? "" : "s"}</td>
                      <td style={{ padding: "6px 4px", textAlign: "right", fontWeight: 800 }}>{reais(p.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {dados.custo.semValor > 0 && <p style={{ ...S.texto, fontSize: 12.5, marginTop: 6 }}>{dados.custo.semValor} inscrição(ões) de quem não tem diária combinada não entram na soma — cadastre a diária na aba Pessoas.</p>}
            </details>
          )}
        </>
      )}

      {aba === "pessoas" && <div style={{ marginTop: 14 }}><Pessoas pessoas={dados.pessoas} ehDono={dados.ehDono} onMudou={carregar} avisar={avisar} /></div>}

      {aba === "link" && (
        <div style={{ marginTop: 14 }}>
          <LinkDeInscricao config={dados.config} nomeDaLoja={dados.loja.nome} funcoesUsadas={funcoesUsadas} avisar={avisar}
            confirmar={setConfirmacao} onImprimirCartaz={() => setImprimir("cartaz")}
            onSalvo={(c: ConfigDoLink) => setDados((d) => (d ? { ...d, config: c } : d))} />
        </div>
      )}

      {form && (
        <FormDoTurno turno={form.turno} dataInicial={form.data} avisar={avisar} onFechar={() => setForm(null)}
          onSalvo={() => { setForm(null); carregar(); }} />
      )}
      {turnoAberto && !form && (
        <DetalheDoTurno turno={turnoAberto} pessoas={dados.pessoas} ehDono={dados.ehDono} avisar={avisar} confirmar={setConfirmacao}
          onFechar={() => setAberto(null)} onMudou={carregar} onEditar={() => setForm({ turno: turnoAberto, data: turnoAberto.data })}
          onApagar={() => apagar(turnoAberto)} />
      )}
      <JanelaDeConfirmacao c={confirmacao} onFechar={() => setConfirmacao(null)} />
      {imprimir && (
        <Impressao oQue={imprimir} visao={visao} data={data} turnos={turnos} nomeDaLoja={dados.loja.nome} codigo={dados.config.codigo} onPronto={fimDaImpressao} />
      )}
    </div>
  );
}

/** Só a primeira letra ("Novembro de 2026", não "Novembro De 2026" do text-transform). */
const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

function Numero({ rotulo, valor, cor = "#0F172A", dica, barra }: { rotulo: string; valor: string; cor?: string; dica?: string; barra?: React.ReactNode }) {
  return (
    <div title={dica} style={{ ...S.cartao, padding: "12px 16px", flex: "1 1 160px" }}>
      <div style={{ fontSize: 12.5, fontWeight: 800, color: "#64748B" }}>{rotulo}</div>
      <div style={{ fontSize: 26, fontWeight: 900, color: cor, letterSpacing: -0.4 }}>{valor}</div>
      {barra && <div style={{ marginTop: 4 }}>{barra}</div>}
      {dica && <div style={{ fontSize: 11, color: "#94A3B8" }}>{dica}</div>}
    </div>
  );
}

const CSS_DA_PAGINA = `
.esc-abas { display: flex; gap: 6px; margin-top: 16px; overflow-x: auto; border-bottom: 1px solid #E2E8F0; }
.esc-abas button { border: 0; background: none; padding: 10px 14px; font-weight: 800; font-size: 14.5px; color: #64748B; cursor: pointer; font-family: inherit; border-bottom: 3px solid transparent; white-space: nowrap; display: inline-flex; gap: 6px; align-items: center; }
.esc-abas button.ativa { color: ${COR}; border-bottom-color: ${COR}; }
.esc-abas .conta { font-size: 11px; background: ${COR_CLARA}; color: ${COR}; border-radius: 999px; padding: 1px 7px; }
.esc-barra { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 14px 0 12px; }
.esc-segmento { display: inline-flex; background: #F1F5F9; border-radius: 12px; padding: 3px; }
.esc-segmento button { border: 0; background: none; padding: 8px 14px; border-radius: 9px; font-weight: 800; font-size: 14px; color: #475569; cursor: pointer; font-family: inherit; }
.esc-segmento button.ativa { background: #fff; color: ${COR}; box-shadow: 0 1px 3px rgba(15,23,42,.12); }
.esc-resumo { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
.esc-com-lado { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; align-items: start; }
.esc-com-lado.aberto { grid-template-columns: minmax(0, 1fr) 270px; }
@media (max-width: 1100px) { .esc-com-lado.aberto { grid-template-columns: minmax(0, 1fr); } .esc-lado { display: none !important; } }
.esc-arrastavel { transition: border-color .15s, box-shadow .15s, transform .15s; }
.esc-arrastavel:hover { border-color: #5EEAD4 !important; box-shadow: 0 4px 12px rgba(15,118,110,.12); transform: translateX(-2px); }
.esc-arrastavel:active { cursor: grabbing; }
.esc-form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.esc-form label { display: block; min-width: 0; }
.esc-candidato:hover { border-color: #5EEAD4 !important; background: ${COR_CLARA} !important; }
@media (max-width: 560px) { .esc-form { grid-template-columns: 1fr; } }
`;
