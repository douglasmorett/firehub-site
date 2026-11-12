"use client";

/**
 * As duas janelas do turno:
 *   FormDoTurno     criar (com "repetir" nos dias da semana até uma data) e editar;
 *   DetalheDoTurno  quem vem, tirar pessoa, encaixar alguém da lista (equipe,
 *                   motoboys, freelancers) ou cadastrar um freelancer na hora.
 */

import { useMemo, useState } from "react";
import {
  FUNCOES, NOMES_CURTOS_DOS_DIAS, chaveDaFuncao, datasDaRepeticao, diaDaSemana, diaPorExtenso, fimDoMes, horarioDoTurno,
  situacaoDasVagas, viraAMeiaNoite,
} from "@/lib/escala-da-equipe/regras";
import { PilulaDasVagas } from "./Calendario";
import {
  COR, COR_CLARA, ErroDaApi, Janela, S, SELO_DO_TIPO, SeloDoLink, SeloDoTipo, pedir, reais,
  type Aviso, type Confirmacao, type Pessoa, type Turno,
} from "./ui";

const OUTRO = "__outro__";

// ── Criar / editar ──────────────────────────────────────────────────────────

export function FormDoTurno({ turno, dataInicial, onFechar, onSalvo, avisar }: {
  turno?: Turno; dataInicial: string; onFechar: () => void; onSalvo: () => void; avisar: (a: Aviso) => void;
}) {
  const daLista = !turno || FUNCOES.some((f) => chaveDaFuncao(f) === chaveDaFuncao(turno.funcao));
  const [data, setData] = useState(turno?.data || dataInicial);
  const [inicio, setInicio] = useState(turno?.inicio || "18:00");
  const [fim, setFim] = useState(turno?.fim || "23:30");
  const [funcao, setFuncao] = useState<string>(turno ? (daLista ? turno.funcao : OUTRO) : "Motoboy");
  const [outra, setOutra] = useState(turno && !daLista ? turno.funcao : "");
  const [vagas, setVagas] = useState(turno?.vagas || 1);
  const [obs, setObs] = useState(turno?.obs || "");
  const [repetir, setRepetir] = useState(false);
  const [dias, setDias] = useState<number[]>(() => [diaDaSemana(turno?.data || dataInicial)]);
  const [ate, setAte] = useState(() => fimDoMes(dataInicial));
  const [salvando, setSalvando] = useState(false);

  const repeticao = useMemo(() => (repetir ? datasDaRepeticao(data, ate, dias) : null), [repetir, data, ate, dias]);
  const funcaoFinal = funcao === OUTRO ? outra.trim() : funcao;
  const vagaDeMenos = turno && vagas < turno.inscritos.length;

  async function salvar() {
    if (repeticao && !repeticao.ok) return avisar({ tipo: "atencao", titulo: repeticao.erro });
    setSalvando(true);
    try {
      const corpo = { data, inicio, fim, funcao: funcaoFinal, vagas, obs, ...(repetir && !turno ? { repetir: { ate, dias } } : {}) };
      if (turno) await pedir(`/api/store/escala/turnos/${turno.id}`, "PUT", corpo);
      else {
        const r = await pedir<{ criados: number }>("/api/store/escala/turnos", "POST", corpo);
        avisar({ tipo: "ok", titulo: r.criados > 1 ? `${r.criados} turnos criados` : "Turno criado", detalhe: `${funcaoFinal}, ${horarioDoTurno(inicio, fim)}` });
      }
      if (turno) avisar({ tipo: "ok", titulo: "Turno salvo" });
      onSalvo();
    } catch (e: any) {
      avisar({ tipo: "erro", titulo: "Não deu para salvar", detalhe: e.message });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Janela titulo={turno ? "Editar turno" : "Novo turno"} subtitulo={turno ? diaPorExtenso(turno.data) : "Abra as vagas — o pessoal se inscreve pelo link ou você encaixa."} onFechar={onFechar} rodape={<>
      <button type="button" style={S.botaoLeve} onClick={onFechar}>Cancelar</button>
      <button type="button" style={{ ...S.botao, opacity: salvando ? 0.6 : 1 }} disabled={salvando || !funcaoFinal} onClick={salvar}>
        {salvando ? "Salvando…" : turno ? "Salvar" : repeticao?.ok ? `Criar ${repeticao.datas.length} turno${repeticao.datas.length === 1 ? "" : "s"}` : "Criar turno"}
      </button>
    </>}>
      <div className="esc-form">
        <label style={{ gridColumn: "1 / -1" }}>
          <span style={S.rotulo}>Data</span>
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} style={S.campo} />
        </label>
        <label>
          <span style={S.rotulo}>Começa</span>
          <input type="time" value={inicio} onChange={(e) => setInicio(e.target.value)} style={S.campo} />
        </label>
        <label>
          <span style={S.rotulo}>Termina</span>
          <input type="time" value={fim} onChange={(e) => setFim(e.target.value)} style={S.campo} />
        </label>
        {viraAMeiaNoite(inicio, fim) && (
          <div style={{ gridColumn: "1 / -1", fontSize: 12.5, color: "#64748B", marginTop: -4 }}>🌙 Termina no dia seguinte — o turno fica no dia em que começa.</div>
        )}
        <div style={{ gridColumn: "1 / -1" }}>
          <span style={S.rotulo}>Função</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {[...FUNCOES, OUTRO].map((f) => (
              <button key={f} type="button" onClick={() => setFuncao(f)} style={{
                ...S.botaoPequeno, borderColor: funcao === f ? COR : "#CBD5E1", background: funcao === f ? COR_CLARA : "#fff", color: funcao === f ? COR : "#334155",
              }}>{f === OUTRO ? "Outro…" : f}</button>
            ))}
          </div>
          {funcao === OUTRO && <input autoFocus value={outra} maxLength={40} onChange={(e) => setOutra(e.target.value)} placeholder="Ex.: Pizzaiolo, Entregador de bike" style={{ ...S.campo, marginTop: 8 }} />}
        </div>
        <label>
          <span style={S.rotulo}>Vagas</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button type="button" style={{ ...S.botaoLeve, width: 42, padding: 0 }} onClick={() => setVagas((v) => Math.max(1, v - 1))} aria-label="Menos uma vaga">−</button>
            <input inputMode="numeric" value={vagas} onChange={(e) => setVagas(Math.max(1, Math.min(50, Number(e.target.value.replace(/\D/g, "")) || 1)))} style={{ ...S.campo, textAlign: "center", width: 64 }} />
            <button type="button" style={{ ...S.botaoLeve, width: 42, padding: 0 }} onClick={() => setVagas((v) => Math.min(50, v + 1))} aria-label="Mais uma vaga">+</button>
          </div>
        </label>
        <label style={{ gridColumn: "1 / -1" }}>
          <span style={S.rotulo}>Observação (aparece no link)</span>
          <input value={obs} maxLength={300} onChange={(e) => setObs(e.target.value)} placeholder="Ex.: chegar 15 min antes, levar bag" style={S.campo} />
        </label>
        {vagaDeMenos && (
          <div style={{ gridColumn: "1 / -1", fontSize: 13, color: "#B45309", background: "#FFFBEB", borderRadius: 10, padding: "8px 10px" }}>
            Já tem {turno!.inscritos.length} inscritos — com {vagas} vaga{vagas === 1 ? "" : "s"} o turno fica com gente a mais (ninguém sai sozinho; tire pelo detalhe do turno).
          </div>
        )}
        {!turno && (
          <div style={{ gridColumn: "1 / -1", border: "1px solid #E2E8F0", borderRadius: 12, padding: "10px 12px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 800, fontSize: 14, cursor: "pointer" }}>
              <input type="checkbox" checked={repetir} onChange={(e) => setRepetir(e.target.checked)} /> Repetir em outros dias
            </label>
            {repetir && (
              <div style={{ marginTop: 10 }}>
                <span style={S.rotulo}>Nos dias</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                    const on = dias.includes(d);
                    return (
                      <button key={d} type="button" onClick={() => setDias((x) => (on ? x.filter((y) => y !== d) : [...x, d]))} style={{
                        ...S.botaoPequeno, width: 48, padding: 0, borderColor: on ? COR : "#CBD5E1", background: on ? COR : "#fff", color: on ? "#fff" : "#334155",
                      }}>{NOMES_CURTOS_DOS_DIAS[d]}</button>
                    );
                  })}
                  <button type="button" style={{ ...S.botaoPequeno, border: 0, color: COR }} onClick={() => setDias([1, 2, 3, 4, 5])}>seg–sex</button>
                  <button type="button" style={{ ...S.botaoPequeno, border: 0, color: COR }} onClick={() => setDias([0, 1, 2, 3, 4, 5, 6])}>todos</button>
                </div>
                <label style={{ display: "block", marginTop: 10 }}>
                  <span style={S.rotulo}>Até</span>
                  <input type="date" value={ate} min={data} onChange={(e) => setAte(e.target.value)} style={S.campo} />
                </label>
                <div style={{ fontSize: 13, marginTop: 8, color: repeticao?.ok ? COR : "#DC2626", fontWeight: 700 }}>
                  {repeticao?.ok ? `Vai criar ${repeticao.datas.length} turno${repeticao.datas.length === 1 ? "" : "s"} de ${funcaoFinal || "…"}.` : repeticao?.erro}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Janela>
  );
}

// ── Detalhe: quem vem, encaixar, tirar ──────────────────────────────────────

export function DetalheDoTurno({ turno, pessoas, ehDono, onFechar, onMudou, onEditar, onApagar, avisar, confirmar }: {
  turno: Turno; pessoas: Pessoa[]; ehDono: boolean; onFechar: () => void; onMudou: () => void; onEditar: () => void; onApagar: () => void;
  avisar: (a: Aviso) => void; confirmar: (c: Confirmacao) => void;
}) {
  const [busca, setBusca] = useState("");
  const [novo, setNovo] = useState(false);
  const [nome, setNome] = useState(""), [telefone, setTelefone] = useState(""), [diaria, setDiaria] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const v = situacaoDasVagas(turno.inscritos.length, turno.vagas);

  const ja = new Set(turno.inscritos.map((i) => `${i.pessoaTipo}:${i.pessoaId}`));
  const candidatos = useMemo(() => {
    const b = chaveDaFuncao(busca);
    const daFuncao = chaveDaFuncao(turno.funcao);
    return pessoas
      .filter((p) => p.ativo && !ja.has(`${p.tipo}:${p.id}`))
      .filter((p) => !b || chaveDaFuncao(p.nome).includes(b) || chaveDaFuncao(p.funcao).includes(b) || (p.telefone || "").replace(/\D/g, "").includes(b.replace(/\D/g, "") || "#"))
      // Quem é da mesma função primeiro: no turno de motoboy, os motoboys no topo.
      .sort((a, c) => Number(chaveDaFuncao(c.funcao) === daFuncao) - Number(chaveDaFuncao(a.funcao) === daFuncao) || a.nome.localeCompare(c.nome, "pt-BR"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pessoas, busca, turno]);

  async function encaixar(corpo: Record<string, unknown>, nomeDaPessoa: string) {
    setOcupado(true);
    try {
      await pedir("/api/store/escala/inscricoes", "POST", { turnoId: turno.id, ...corpo });
      avisar({ tipo: "ok", titulo: `${nomeDaPessoa} encaixado(a)`, detalhe: `${turno.funcao}, ${horarioDoTurno(turno.inicio, turno.fim)}` });
      setNovo(false); setNome(""); setTelefone(""); setDiaria(""); setBusca("");
      onMudou();
    } catch (e: any) {
      if (e instanceof ErroDaApi && e.dados?.codigo === "CHEIO") {
        // O freelancer novo já foi cadastrado: a segunda tentativa vai pelo id dele.
        const pelaPessoa = e.dados.pessoaId ? { pessoaTipo: e.dados.pessoaTipo, pessoaId: e.dados.pessoaId } : corpo;
        if (e.dados.pessoaId) { setNovo(false); onMudou(); }
        confirmar({
          titulo: "Turno cheio",
          texto: `As ${turno.vagas} vaga(s) já estão preenchidas.\nAbrir mais uma vaga e encaixar ${nomeDaPessoa}?`,
          botao: "Abrir vaga e encaixar",
          acao: () => encaixar({ ...pelaPessoa, aumentarVaga: true }, nomeDaPessoa),
        });
      } else avisar({ tipo: "erro", titulo: "Não deu para encaixar", detalhe: e.message });
    } finally {
      setOcupado(false);
    }
  }

  async function tirar(id: string, nomeDaPessoa: string) {
    setOcupado(true);
    try {
      await pedir(`/api/store/escala/inscricoes/${id}`, "DELETE");
      avisar({ tipo: "ok", titulo: `${nomeDaPessoa} saiu do turno` });
      onMudou();
    } catch (e: any) {
      avisar({ tipo: "erro", titulo: "Não deu para tirar", detalhe: e.message });
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Janela largura={600} onFechar={onFechar}
      titulo={<span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>{turno.funcao} <PilulaDasVagas turno={turno} grande /></span>}
      subtitulo={`${diaPorExtenso(turno.data)} · ${horarioDoTurno(turno.inicio, turno.fim)}`}
      rodape={<>
        <button type="button" style={{ ...S.botaoLeve, color: "#DC2626", borderColor: "#FECACA", marginRight: "auto" }} onClick={onApagar}>Apagar turno</button>
        <button type="button" style={S.botaoLeve} onClick={onEditar}>Editar turno</button>
        <button type="button" style={S.botao} onClick={onFechar}>Pronto</button>
      </>}>
      {turno.obs && <p style={{ ...S.texto, marginBottom: 10 }}>📝 {turno.obs}</p>}

      <h3 style={{ ...S.h2, fontSize: 15 }}>Quem vem ({turno.inscritos.length})</h3>
      {turno.inscritos.length === 0 ? (
        <p style={{ ...S.texto, marginTop: 4 }}>Ninguém ainda. Mande o link no grupo ou encaixe abaixo.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
          {turno.inscritos.map((i) => (
            <div key={i.id} style={{ display: "flex", alignItems: "center", gap: 8, border: "1px solid #E2E8F0", borderRadius: 10, padding: "8px 10px" }}>
              <SeloDoTipo tipo={i.pessoaTipo} />
              <strong style={{ fontSize: 14.5, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>{i.nome}</strong>
              {i.origem === "link" ? <SeloDoLink /> : <span style={{ fontSize: 11, color: "#94A3B8", fontWeight: 700 }}>painel</span>}
              {ehDono && i.diaria ? <span style={{ fontSize: 12.5, color: "#475569" }}>{reais(i.diaria)}</span> : null}
              <button type="button" disabled={ocupado} aria-label={`Tirar ${i.nome}`} title="Tirar do turno" onClick={() => tirar(i.id, i.nome)}
                style={{ border: 0, background: "#FEF2F2", color: "#DC2626", borderRadius: 8, width: 30, height: 30, cursor: "pointer", fontSize: 16 }}>×</button>
            </div>
          ))}
        </div>
      )}
      {v.faltam > 0 && <div style={{ marginTop: 8, fontSize: 13, fontWeight: 800, color: "#B45309" }}>Falta{v.faltam > 1 ? "m" : ""} {v.faltam} pessoa{v.faltam > 1 ? "s" : ""}.</div>}

      <div style={{ marginTop: 16, borderTop: "1px solid #F1F5F9", paddingTop: 14 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <h3 style={{ ...S.h2, fontSize: 15, flex: 1 }}>Encaixar alguém</h3>
          <button type="button" style={{ ...S.botaoPequeno, borderColor: COR, color: COR }} onClick={() => setNovo((x) => !x)}>{novo ? "Escolher da lista" : "+ Novo freelancer"}</button>
        </div>
        {novo ? (
          <div className="esc-form" style={{ marginTop: 10 }}>
            <label style={{ gridColumn: "1 / -1" }}><span style={S.rotulo}>Nome</span><input autoFocus value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} style={S.campo} /></label>
            <label><span style={S.rotulo}>WhatsApp (opcional)</span><input value={telefone} inputMode="tel" onChange={(e) => setTelefone(e.target.value)} placeholder="22 99999-1234" style={S.campo} /></label>
            {ehDono && <label><span style={S.rotulo}>Diária combinada (opcional)</span><input value={diaria} inputMode="decimal" onChange={(e) => setDiaria(e.target.value)} placeholder="80,00" style={S.campo} /></label>}
            <div style={{ gridColumn: "1 / -1", display: "flex", justifyContent: "flex-end" }}>
              <button type="button" style={S.botao} disabled={ocupado || nome.trim().length < 2}
                onClick={() => encaixar({ novoFreelancer: { nome, telefone, funcao: turno.funcao, diaria } }, nome.trim())}>
                Cadastrar e encaixar
              </button>
            </div>
          </div>
        ) : (
          <>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por nome, função ou telefone" style={{ ...S.campo, marginTop: 10 }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8, maxHeight: 260, overflowY: "auto" }}>
              {candidatos.length === 0 && <p style={{ ...S.texto, fontSize: 13 }}>Ninguém {busca ? "com essa busca" : "disponível"}. Cadastre um freelancer na hora.</p>}
              {candidatos.map((p) => (
                <button key={`${p.tipo}:${p.id}`} type="button" disabled={ocupado} onClick={() => encaixar({ pessoaTipo: p.tipo, pessoaId: p.id }, p.nome)}
                  className="esc-candidato" style={{ display: "flex", alignItems: "center", gap: 8, textAlign: "left", border: "1px solid #E2E8F0", borderRadius: 10, padding: "8px 10px", background: "#fff", cursor: "pointer", fontFamily: "inherit" }}>
                  <span title={SELO_DO_TIPO[p.tipo].rotulo}>{SELO_DO_TIPO[p.tipo].icone}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: 14 }}>{p.nome}</strong>
                    <span style={{ fontSize: 12, color: "#64748B", marginLeft: 6 }}>{[p.funcao, p.telefone].filter(Boolean).join(" · ")}</span>
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 800, color: COR }}>Encaixar</span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </Janela>
  );
}
