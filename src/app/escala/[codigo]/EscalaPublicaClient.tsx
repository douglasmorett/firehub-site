"use client";

/**
 * A página do link de inscrição (/escala/<código>) — feita para o celular de
 * quem está no grupo da equipe.
 *
 *  1. A pessoa digita o WhatsApp. Se for de motoboy, funcionário ou freelancer
 *     da loja, a página diz "Olá, João" e usa esse cadastro; se não, pede nome,
 *     função e a chave Pix (vira freelancer "veio pelo link" na primeira
 *     inscrição).
 *  1b. Pix (Douglas, 12/11/2026: "manda ele colocar o Pix dele para facilitar
 *     na hora do pagamento"): quem já é da loja e não tem Pix vê o pedido no
 *     topo e de novo ao tocar em "Quero esta vaga" (pode pular — volta a pedir
 *     na próxima visita). A chave gravada aparece ESCONDIDA (***.456.789-**),
 *     com "corrigir"; trocar uma chave que já existe só deste aparelho.
 *  2. Vê as vagas abertas das próximas semanas, por dia, e filtra por função.
 *  3. "Quero esta vaga" — o servidor trava a vaga (duas pessoas na última:
 *     só uma entra) e devolve a chave de desistir, que fica SÓ neste aparelho.
 *  4. "Minhas inscrições": desistir só com essa chave e dentro do prazo da
 *     loja — ninguém tira o colega digitando o telefone dele.
 *
 * O telefone e as chaves ficam no localStorage (com try/catch: aba anônima
 * só não lembra). De quem já se inscreveu aparece só o primeiro nome.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { FUNCOES, TIPOS_DE_PIX, chaveDaFuncao, diaPorExtenso, horarioDoTurno, lerChavePix, prazoFalado, somarDias, telefoneUtilizavel } from "@/lib/escala-da-equipe/regras";

type TurnoAberto = { id: string; data: string; inicio: string; fim: string; funcao: string; obs: string | null; vagas: number; faltam: number; nomes: string[] };
type Dados = {
  loja: { nome: string; logo: string | null }; hoje: string;
  regras: { linkAtivo: boolean; prazoInscricaoHoras: number; permiteDesistir: boolean; prazoDesistenciaHoras: number };
  turnos: TurnoAberto[];
};
type MinhaInscricao = { inscricaoId: string; turnoId: string; data: string; inicio: string; fim: string; funcao: string; podeDesistir: boolean };
type PixVisivel = { mascarada: string; tipo: string | null };
type Identidade = { conhecido: false } | { conhecido: true; pessoa: { nome: string; tipo: string }; pix: PixVisivel | null; inscricoes: MinhaInscricao[] };
type Aviso = { tipo: "ok" | "erro"; texto: string };

const COR = "#0F766E";

function ler(chave: string): string | null {
  try { return window.localStorage.getItem(chave); } catch { return null; }
}
function gravar(chave: string, valor: string | null) {
  try { if (valor == null) window.localStorage.removeItem(chave); else window.localStorage.setItem(chave, valor); } catch { /* aba anônima: só não lembra */ }
}

async function chamar<T>(url: string, corpo?: unknown): Promise<T> {
  const r = await fetch(url, corpo === undefined ? { cache: "no-store" } : { method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || "Não deu certo. Tente de novo."), { codigo: j.codigo });
  return j as T;
}

export default function EscalaPublicaClient({ codigo, loja }: { codigo: string; loja: { nome: string; logo: string | null } }) {
  const api = `/api/escala/${codigo}`;
  const CHAVE_TEL = `escala:${codigo}:telefone`, CHAVE_CHAVES = `escala:${codigo}:chaves`, CHAVE_NOVO = `escala:${codigo}:novo`;

  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [telefone, setTelefone] = useState("");
  const [identidade, setIdentidade] = useState<Identidade | null>(null);
  const [nome, setNome] = useState(""), [funcao, setFuncao] = useState("");
  const [chaves, setChaves] = useState<Record<string, string>>({});
  const [filtro, setFiltro] = useState<string>("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [desistindo, setDesistindo] = useState<string | null>(null);
  // O Pix digitado (novo cadastro, pedido de quem não tem, ou correção) — não vai para o localStorage.
  const [pix, setPix] = useState(""), [pixTipo, setPixTipo] = useState("");
  const [corrigindoPix, setCorrigindoPix] = useState(false);
  // "Agora não": vale só nesta visita — na próxima o pedido aparece de novo.
  const [pulouPix, setPulouPix] = useState(false);
  const [pedindoPix, setPedindoPix] = useState<TurnoAberto | null>(null);

  const carregar = useCallback(async () => {
    try { setDados(await chamar<Dados>(api)); setErro(null); } catch (e: any) { setErro(e.message); }
  }, [api]);

  const identificar = useCallback(async (tel: string, silencioso = false) => {
    if (!telefoneUtilizavel(tel)) { if (!silencioso) setAviso({ tipo: "erro", texto: "Digite o WhatsApp com DDD (ex.: 22 99999-1234)." }); return; }
    setOcupado("identificar");
    try {
      const r = await chamar<Identidade>(api, { acao: "identificar", telefone: tel });
      setIdentidade(r);
      gravar(CHAVE_TEL, tel);
    } catch (e: any) {
      if (!silencioso) setAviso({ tipo: "erro", texto: e.message });
    } finally {
      setOcupado(null);
    }
  }, [api, CHAVE_TEL]);

  useEffect(() => {
    carregar();
    const tel = ler(CHAVE_TEL);
    try { setChaves(JSON.parse(ler(CHAVE_CHAVES) || "{}") || {}); } catch { setChaves({}); }
    try { const n = JSON.parse(ler(CHAVE_NOVO) || "null"); if (n) { setNome(n.nome || ""); setFuncao(n.funcao || ""); } } catch {}
    if (tel) { setTelefone(tel); identificar(tel, true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), aviso.tipo === "erro" ? 9000 : 6000);
    return () => clearTimeout(t);
  }, [aviso]);

  const funcoes = useMemo(() => [...new Set((dados?.turnos || []).map((t) => t.funcao))], [dados]);
  const turnos = (dados?.turnos || []).filter((t) => !filtro || chaveDaFuncao(t.funcao) === chaveDaFuncao(filtro));
  const dias = [...new Set(turnos.map((t) => t.data))].sort();
  const minhas = identidade?.conhecido ? identidade.inscricoes : [];
  const estou = new Set(minhas.map((i) => i.turnoId));

  function sair() {
    gravar(CHAVE_TEL, null);
    setIdentidade(null);
    setTelefone("");
    setPix(""); setPixTipo(""); setCorrigindoPix(false); setPulouPix(false);
  }

  const pixLido = pix.trim() ? lerChavePix(pix, pixTipo || undefined) : null;
  const semPix = identidade?.conhecido === true && !identidade.pix;

  /** Grava (ou corrige) o Pix de quem já é da loja. Trocar a chave que existe: o servidor confere a chave do aparelho. */
  async function salvarPix() {
    if (!pixLido?.ok) { setAviso({ tipo: "erro", texto: pixLido ? pixLido.erro : "Digite a sua chave Pix." }); return; }
    setOcupado("pix");
    try {
      await chamar(api, { acao: "pix", telefone, pix, pixTipo: pixTipo || undefined, chaves: Object.values(chaves) });
      setAviso({ tipo: "ok", texto: "Chave Pix salva. A loja usa ela para te pagar." });
      setPix(""); setPixTipo(""); setCorrigindoPix(false);
      await identificar(telefone, true);
    } catch (e: any) {
      setAviso({ tipo: "erro", texto: e.message });
    } finally {
      setOcupado(null);
    }
  }

  async function quero(t: TurnoAberto, pixNaHora?: "salvar" | "pular") {
    if (!identidade) { setAviso({ tipo: "erro", texto: "Primeiro digite o seu WhatsApp lá em cima." }); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (!identidade.conhecido && (nome.trim().length < 2 || !funcao)) { setAviso({ tipo: "erro", texto: "Escreva o seu nome e escolha a sua função lá em cima." }); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (!identidade.conhecido && !pixLido?.ok) { setAviso({ tipo: "erro", texto: pixLido ? pixLido.erro : "Digite a sua chave Pix lá em cima — é por ela que a loja te paga." }); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    // Já é da loja e não tem Pix: pede antes de reservar (dá para pular).
    if (semPix && !pulouPix && !pixNaHora) { setPedindoPix(t); return; }
    setPedindoPix(null);
    const mandarPix = (!identidade.conhecido || (semPix && pixNaHora === "salvar")) && pixLido?.ok;
    setOcupado(t.id);
    try {
      const r = await chamar<{ inscricaoId: string; chave: string | null }>(api, {
        acao: "inscrever", telefone, turnoId: t.id, nome, funcao, ...(mandarPix ? { pix, pixTipo: pixTipo || undefined } : {}),
      });
      if (mandarPix) { setPix(""); setPixTipo(""); }
      if (r.chave) {
        const novas = { ...chaves, [r.inscricaoId]: r.chave };
        setChaves(novas);
        gravar(CHAVE_CHAVES, JSON.stringify(novas));
      }
      setAviso({ tipo: "ok", texto: `Pronto! Você está na escala: ${diaPorExtenso(t.data)}, ${horarioDoTurno(t.inicio, t.fim)} (${t.funcao}).` });
      await Promise.all([carregar(), identificar(telefone, true)]);
    } catch (e: any) {
      setAviso({ tipo: "erro", texto: e.message });
      carregar();
    } finally {
      setOcupado(null);
    }
  }

  async function desistir(i: MinhaInscricao) {
    setOcupado(i.inscricaoId);
    try {
      await chamar(api, { acao: "desistir", inscricaoId: i.inscricaoId, chave: chaves[i.inscricaoId] });
      const novas = { ...chaves };
      delete novas[i.inscricaoId];
      setChaves(novas);
      gravar(CHAVE_CHAVES, JSON.stringify(novas));
      setAviso({ tipo: "ok", texto: "Você saiu do turno. A vaga voltou para o grupo." });
      await Promise.all([carregar(), identificar(telefone, true)]);
    } catch (e: any) {
      setAviso({ tipo: "erro", texto: e.message });
    } finally {
      setOcupado(null);
      setDesistindo(null);
    }
  }

  const regras = dados?.regras;

  return (
    <main className="escp">
      <style>{CSS}</style>
      {aviso && <div role={aviso.tipo === "erro" ? "alert" : "status"} className={`escp-aviso ${aviso.tipo}`} onClick={() => setAviso(null)}>{aviso.texto}</div>}

      <header className="escp-topo">
        {loja.logo ? <img src={loja.logo} alt="" className="escp-logo" /> : <div className="escp-logo vazio">📅</div>}
        <div>
          <div className="escp-loja">{loja.nome}</div>
          <h1>Escala da equipe</h1>
        </div>
      </header>

      <div className="escp-corpo">
        {regras && (
          <p className="escp-regras">
            Escolha o seu turno. Inscrição {prazoFalado(regras.prazoInscricaoHoras)}
            {regras.permiteDesistir ? `; desistência pelo link ${prazoFalado(regras.prazoDesistenciaHoras)}` : "; para desistir, fale com a loja"}.
          </p>
        )}

        <section className="escp-cartao">
          {!identidade ? (
            <form onSubmit={(e) => { e.preventDefault(); identificar(telefone); }}>
              <label className="escp-rotulo" htmlFor="escp-tel">Seu WhatsApp</label>
              <div className="escp-linha">
                <input id="escp-tel" className="escp-campo" inputMode="tel" autoComplete="tel" placeholder="22 99999-1234" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
                <button type="submit" className="escp-botao" disabled={ocupado === "identificar"}>{ocupado === "identificar" ? "…" : "Entrar"}</button>
              </div>
              <p className="escp-dica">Não precisa de senha nem de app. O número só serve para a loja saber quem é você.</p>
            </form>
          ) : identidade.conhecido ? (
            <div>
              <div className="escp-linha" style={{ alignItems: "center" }}>
                <div style={{ flex: 1 }}>
                  <div className="escp-ola">Olá, {identidade.pessoa.nome}! 👋</div>
                  <div className="escp-dica" style={{ margin: 0 }}>{identidade.pessoa.tipo} · {telefone}</div>
                </div>
                <button type="button" className="escp-leve" onClick={sair}>Não sou eu</button>
              </div>
              {identidade.pix && !corrigindoPix && (
                <div className="escp-pix-ok">
                  <span style={{ flex: 1 }}>💸 Seu Pix: <b>{identidade.pix.mascarada}</b></span>
                  <button type="button" className="escp-link" onClick={() => { setCorrigindoPix(true); setPix(""); setPixTipo(""); }}>corrigir</button>
                </div>
              )}
              {(corrigindoPix || (!identidade.pix && !pulouPix)) && (
                <div className="escp-pix-pedido">
                  <div style={{ fontWeight: 900, marginBottom: 4 }}>{corrigindoPix ? "Corrigir a sua chave Pix" : "💸 Informe a sua chave Pix"}</div>
                  <p className="escp-dica" style={{ margin: "0 0 8px" }}>{corrigindoPix ? "Digite a chave nova. Só dá para trocar pelo celular em que você se inscreveu." : "A loja usa a sua chave para te pagar mais rápido."}</p>
                  <CampoDoPix pix={pix} tipo={pixTipo} onPix={setPix} onTipo={setPixTipo} lido={pixLido} />
                  <div className="escp-linha" style={{ marginTop: 10 }}>
                    <button type="button" className="escp-leve" onClick={() => (corrigindoPix ? setCorrigindoPix(false) : setPulouPix(true))}>{corrigindoPix ? "Cancelar" : "Agora não"}</button>
                    <button type="button" className="escp-botao" style={{ flex: 1, height: 40, fontSize: 15 }} disabled={ocupado === "pix"} onClick={salvarPix}>{ocupado === "pix" ? "Salvando…" : "Salvar Pix"}</button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="escp-linha" style={{ alignItems: "center" }}>
                <div className="escp-ola" style={{ flex: 1 }}>Primeira vez por aqui?</div>
                <button type="button" className="escp-leve" onClick={sair}>Trocar número</button>
              </div>
              <p className="escp-dica">Não achamos {telefone} na equipe da loja. Diga quem é você — vale para as próximas vezes.</p>
              <label className="escp-rotulo" htmlFor="escp-nome">Seu nome</label>
              <input id="escp-nome" className="escp-campo" value={nome} maxLength={80} autoComplete="name" onChange={(e) => { setNome(e.target.value); gravar(CHAVE_NOVO, JSON.stringify({ nome: e.target.value, funcao })); }} />
              <label className="escp-rotulo" style={{ marginTop: 10 }}>Sua função</label>
              <div className="escp-chips">
                {FUNCOES.map((f) => (
                  <button key={f} type="button" className={`escp-chip ${funcao === f ? "on" : ""}`} onClick={() => { setFuncao(f); gravar(CHAVE_NOVO, JSON.stringify({ nome, funcao: f })); }}>{f}</button>
                ))}
              </div>
              <label className="escp-rotulo" style={{ marginTop: 10 }}>Sua chave Pix <span style={{ fontWeight: 600, color: "#64748B" }}>(para a loja te pagar)</span></label>
              <CampoDoPix pix={pix} tipo={pixTipo} onPix={setPix} onTipo={setPixTipo} lido={pixLido} />
            </div>
          )}
        </section>

        {minhas.length > 0 && (
          <section className="escp-cartao">
            <h2>Minhas inscrições</h2>
            {minhas.map((i) => {
              const temChave = !!chaves[i.inscricaoId];
              return (
                <div key={i.inscricaoId} className="escp-minha">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="escp-dia">{diaPorExtenso(i.data)}{i.data === dados?.hoje ? " · hoje" : i.data === (dados && somarDias(dados.hoje, 1)) ? " · amanhã" : ""}</div>
                    <div><b>{horarioDoTurno(i.inicio, i.fim)}</b> · {i.funcao}</div>
                  </div>
                  {i.podeDesistir && temChave ? (
                    desistindo === i.inscricaoId ? (
                      <div className="escp-linha">
                        <button type="button" className="escp-leve" onClick={() => setDesistindo(null)}>Voltar</button>
                        <button type="button" className="escp-botao perigo" disabled={ocupado === i.inscricaoId} onClick={() => desistir(i)}>Confirmar</button>
                      </div>
                    ) : <button type="button" className="escp-leve" onClick={() => setDesistindo(i.inscricaoId)}>Desistir</button>
                  ) : (
                    <span className="escp-miudo">{!regras?.permiteDesistir || !i.podeDesistir ? "Não pode ir? Fale com a loja." : "Feita em outro aparelho — para sair, fale com a loja."}</span>
                  )}
                </div>
              );
            })}
          </section>
        )}

        {erro && <section className="escp-cartao erro">{erro}</section>}
        {regras && !regras.linkAtivo && <section className="escp-cartao">⏸️ A loja fechou as inscrições pelo link por enquanto.</section>}

        {regras?.linkAtivo && (
          <>
            <div className="escp-titulo-vagas">
              <h2>Vagas abertas</h2>
              {funcoes.length > 1 && (
                <div className="escp-chips">
                  <button type="button" className={`escp-chip ${!filtro ? "on" : ""}`} onClick={() => setFiltro("")}>Todas</button>
                  {funcoes.map((f) => <button key={f} type="button" className={`escp-chip ${filtro === f ? "on" : ""}`} onClick={() => setFiltro(f)}>{f}</button>)}
                </div>
              )}
            </div>
            {!dados ? <p className="escp-dica">Carregando…</p> : dias.length === 0 ? (
              <section className="escp-cartao"><p className="escp-dica" style={{ margin: 0 }}>Nenhuma vaga aberta agora. Quando a loja abrir, aparece aqui — guarde este link.</p></section>
            ) : dias.map((d) => (
              <section key={d}>
                <div className="escp-dia-cabeca">{diaPorExtenso(d)}{d === dados.hoje ? " · hoje" : d === somarDias(dados.hoje, 1) ? " · amanhã" : ""}</div>
                {turnos.filter((t) => t.data === d).map((t) => (
                  <div key={t.id} className="escp-turno">
                    <div className="escp-turno-topo">
                      <div>
                        <div className="escp-hora">{horarioDoTurno(t.inicio, t.fim)}</div>
                        <div className="escp-funcao">{t.funcao}</div>
                      </div>
                      <span className="escp-vagas">{t.faltam} vaga{t.faltam === 1 ? "" : "s"}</span>
                    </div>
                    {t.obs && <div className="escp-obs">📝 {t.obs}</div>}
                    {t.nomes.length > 0 && <div className="escp-nomes">Já vão: {t.nomes.join(", ")}</div>}
                    {estou.has(t.id) ? (
                      <div className="escp-estou">✓ Você está neste turno</div>
                    ) : (
                      <button type="button" className="escp-botao cheio" disabled={!!ocupado} onClick={() => quero(t)}>
                        {ocupado === t.id ? "Reservando…" : "Quero esta vaga"}
                      </button>
                    )}
                  </div>
                ))}
              </section>
            ))}
          </>
        )}
        <p className="escp-rodape">Escala pelo FireHub</p>
      </div>

      {pedindoPix && (
        <div className="escp-fundo" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setPedindoPix(null); }}>
          <div className="escp-janela">
            <div className="escp-ola">Antes de reservar: qual a sua chave Pix?</div>
            <p className="escp-dica" style={{ margin: "4px 0 10px" }}>A loja usa para te pagar mais rápido. {diaPorExtenso(pedindoPix.data)}, {horarioDoTurno(pedindoPix.inicio, pedindoPix.fim)} ({pedindoPix.funcao}).</p>
            <CampoDoPix pix={pix} tipo={pixTipo} onPix={setPix} onTipo={setPixTipo} lido={pixLido} />
            <button type="button" className="escp-botao cheio" disabled={!pixLido?.ok || !!ocupado} onClick={() => quero(pedindoPix, "salvar")}>Salvar Pix e quero a vaga</button>
            <button type="button" className="escp-leve" style={{ width: "100%", marginTop: 8 }} disabled={!!ocupado} onClick={() => { setPulouPix(true); setPix(""); quero(pedindoPix, "pular"); }}>Pular por agora e quero a vaga</button>
          </div>
        </div>
      )}
    </main>
  );
}

/** A chave Pix com o tipo (automático ou escolhido) e o retorno na hora: "✓ CPF" ou o que está errado. */
function CampoDoPix({ pix, tipo, onPix, onTipo, lido }: {
  pix: string; tipo: string; onPix: (v: string) => void; onTipo: (v: string) => void; lido: ReturnType<typeof lerChavePix> | null;
}) {
  return (
    <div>
      <input className="escp-campo" style={{ display: "block" }} value={pix} maxLength={120} autoComplete="off" placeholder="CPF, celular, e-mail ou chave aleatória" onChange={(e) => onPix(e.target.value)} />
      <div className="escp-chips" style={{ marginTop: 8 }}>
        <button type="button" className={`escp-chip mini ${!tipo ? "on" : ""}`} onClick={() => onTipo("")}>Automático</button>
        {TIPOS_DE_PIX.map((t) => <button key={t.tipo} type="button" className={`escp-chip mini ${tipo === t.tipo ? "on" : ""}`} onClick={() => onTipo(t.tipo)}>{t.rotulo}</button>)}
      </div>
      {lido && <div className={`escp-pix-retorno ${lido.ok ? "ok" : "erro"}`}>{lido.ok ? `✓ Chave ${TIPOS_DE_PIX.find((t) => t.tipo === lido.tipo)?.rotulo}` : lido.erro}</div>}
    </div>
  );
}

const CSS = `
.escp { min-height: 100vh; background: #F0FDFA; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0F172A; padding-bottom: 40px; }
.escp-topo { background: linear-gradient(135deg, ${COR}, #115E59); color: #fff; padding: 22px 16px 26px; display: flex; gap: 14px; align-items: center; }
.escp-topo h1 { margin: 0; font-size: 24px; font-weight: 900; }
.escp-loja { font-size: 14px; opacity: .85; font-weight: 700; }
.escp-logo { width: 56px; height: 56px; border-radius: 16px; object-fit: cover; background: #fff; flex-shrink: 0; }
.escp-logo.vazio { display: flex; align-items: center; justify-content: center; font-size: 28px; background: rgba(255,255,255,.15); }
.escp-corpo { max-width: 560px; margin: -14px auto 0; padding: 0 12px; }
.escp-regras { background: #fff; border-radius: 14px; padding: 10px 14px; font-size: 13.5px; color: #475569; margin: 0 0 10px; box-shadow: 0 4px 14px rgba(15,23,42,.06); }
.escp-cartao { background: #fff; border-radius: 16px; padding: 14px; margin-bottom: 12px; box-shadow: 0 4px 14px rgba(15,23,42,.06); }
.escp-cartao.erro { color: #B91C1C; background: #FEF2F2; }
.escp-cartao h2, .escp-titulo-vagas h2 { margin: 0 0 8px; font-size: 17px; font-weight: 900; }
.escp-rotulo { display: block; font-size: 13px; font-weight: 800; color: #334155; margin-bottom: 6px; }
.escp-linha { display: flex; gap: 8px; }
.escp-campo { flex: 1; width: 100%; box-sizing: border-box; min-width: 0; height: 48px; padding: 0 14px; border-radius: 12px; border: 1.5px solid #CBD5E1; font-size: 17px; font-family: inherit; }
.escp-campo:focus { outline: none; border-color: ${COR}; box-shadow: 0 0 0 3px #CCFBF1; }
.escp-botao { height: 48px; padding: 0 20px; border-radius: 12px; border: 0; background: ${COR}; color: #fff; font-weight: 900; font-size: 16px; cursor: pointer; font-family: inherit; }
.escp-botao:disabled { opacity: .6; }
.escp-botao.cheio { width: 100%; margin-top: 10px; }
.escp-botao.perigo { background: #DC2626; height: 40px; font-size: 14px; padding: 0 14px; }
.escp-leve { height: 40px; padding: 0 14px; border-radius: 11px; border: 1.5px solid #CBD5E1; background: #fff; color: #334155; font-weight: 800; font-size: 14px; cursor: pointer; font-family: inherit; white-space: nowrap; }
.escp-dica { font-size: 13px; color: #64748B; margin: 8px 0 0; line-height: 1.45; }
.escp-ola { font-size: 18px; font-weight: 900; }
.escp-chips { display: flex; gap: 6px; flex-wrap: wrap; }
.escp-chip { height: 36px; padding: 0 14px; border-radius: 999px; border: 1.5px solid #CBD5E1; background: #fff; font-weight: 800; font-size: 14px; color: #334155; cursor: pointer; font-family: inherit; }
.escp-chip.on { background: ${COR}; border-color: ${COR}; color: #fff; }
.escp-minha { display: flex; gap: 10px; align-items: center; padding: 10px 0; border-top: 1px solid #F1F5F9; font-size: 14.5px; flex-wrap: wrap; }
.escp-minha:first-of-type { border-top: 0; }
.escp-dia { font-size: 12.5px; color: ${COR}; font-weight: 800; text-transform: capitalize; }
.escp-miudo { font-size: 12px; color: #64748B; max-width: 170px; }
.escp-titulo-vagas { margin: 18px 2px 8px; }
.escp-dia-cabeca { font-size: 14px; font-weight: 900; color: #134E4A; text-transform: capitalize; margin: 14px 4px 6px; }
.escp-turno { background: #fff; border-radius: 16px; padding: 14px; margin-bottom: 10px; box-shadow: 0 4px 14px rgba(15,23,42,.06); border-left: 5px solid ${COR}; }
.escp-turno-topo { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
.escp-hora { font-size: 19px; font-weight: 900; }
.escp-funcao { font-size: 15px; font-weight: 800; color: ${COR}; }
.escp-vagas { background: #FEF3C7; color: #92400E; font-weight: 900; font-size: 13px; border-radius: 999px; padding: 5px 11px; white-space: nowrap; }
.escp-obs { font-size: 13.5px; color: #475569; margin-top: 8px; }
.escp-nomes { font-size: 13px; color: #64748B; margin-top: 6px; }
.escp-estou { margin-top: 10px; background: #ECFDF5; color: #047857; font-weight: 900; border-radius: 12px; padding: 12px; text-align: center; }
.escp-aviso { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 50; width: min(460px, calc(100vw - 24px)); border-radius: 14px; padding: 13px 15px; font-weight: 800; font-size: 14.5px; box-shadow: 0 10px 30px rgba(15,23,42,.2); cursor: pointer; }
.escp-aviso.ok { background: #ECFDF5; color: #065F46; border-left: 5px solid #059669; }
.escp-aviso.erro { background: #FEF2F2; color: #991B1B; border-left: 5px solid #DC2626; }
.escp-rodape { text-align: center; font-size: 12px; color: #94A3B8; margin-top: 24px; }
.escp-chip.mini { height: 30px; padding: 0 11px; font-size: 12.5px; }
.escp-pix-ok { display: flex; align-items: center; gap: 8px; margin-top: 10px; background: #ECFDF5; color: #065F46; border-radius: 12px; padding: 9px 12px; font-size: 14px; }
.escp-pix-pedido { margin-top: 12px; border: 2px solid #FCD34D; background: #FFFBEB; border-radius: 14px; padding: 12px; }
.escp-pix-retorno { font-size: 13px; font-weight: 800; margin-top: 6px; }
.escp-pix-retorno.ok { color: #047857; }
.escp-pix-retorno.erro { color: #B45309; }
.escp-link { border: 0; background: none; color: ${COR}; font-weight: 800; text-decoration: underline; cursor: pointer; font-size: 14px; font-family: inherit; }
.escp-fundo { position: fixed; inset: 0; z-index: 60; background: rgba(15,23,42,.55); display: flex; align-items: flex-end; justify-content: center; padding: 12px; }
.escp-janela { background: #fff; border-radius: 18px; padding: 18px 16px; width: 100%; max-width: 480px; box-shadow: 0 24px 60px rgba(2,6,23,.35); }
`;
