"use client";

/**
 * A escala de UMA pessoa, no celular dela (Lucas/Frangoso, 13/11/2026):
 *
 *  1. "Confirme os seus turnos": o que falta aceitar e o botão "Aceito". O
 *     servidor grava a hora, o telefone, o IP e o aparelho — a prova de que
 *     ela escolheu os dias (equipe sem carteira).
 *  2. O mês: cada turno com horário, função, diária e o aceite.
 *  3. "Baixar PDF": a janela de impressão do celular/computador ("Salvar como
 *     PDF"), como as outras telas do FireHub — sem biblioteca. O papel é uma
 *     folha A4 limpa só com a escala dela.
 */

import { useCallback, useEffect, useState } from "react";
import { diaPorExtenso, horarioDoTurno, mesPorExtenso, navegar, type TurnoDaPessoa } from "@/lib/escala-da-equipe/regras";

type Dados = {
  loja: { nome: string; logo: string | null };
  pessoa: { nome: string; tipo: string; telefone: string | null };
  hoje: string; mes: string;
  turnos: TurnoDaPessoa[];
  resumo: { turnos: number; total: number; semValor: number; aceitos: number; aguardando: number };
  pendentes: TurnoDaPessoa[];
};

const COR = "#0F766E";
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const maiuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export default function MinhaEscalaClient({ codigo, token }: { codigo: string; token: string }) {
  const api = `/api/escala/${codigo}/minha/${token}`;
  const [dados, setDados] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mes, setMes] = useState<string | null>(null);
  const [aceitando, setAceitando] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(null);

  const carregar = useCallback(async (m: string | null) => {
    try {
      const r = await fetch(`${api}${m ? `?mes=${m}` : ""}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Não deu para abrir a sua escala.");
      setDados(j);
      setMes(j.mes);
      setErro(null);
    } catch (e: any) {
      setErro(e.message);
    }
  }, [api]);
  useEffect(() => { carregar(null); }, [carregar]);
  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 7000);
    return () => clearTimeout(t);
  }, [aviso]);

  async function aceitar() {
    if (!dados) return;
    setAceitando(true);
    try {
      const r = await fetch(api, {
        method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "aceitar", inscricaoIds: dados.pendentes.map((t) => t.inscricaoId) }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Não deu certo. Tente de novo.");
      setAviso({ tipo: "ok", texto: j.aceitos ? `Pronto! ${j.aceitos} turno${j.aceitos === 1 ? "" : "s"} aceito${j.aceitos === 1 ? "" : "s"}. A loja já vê.` : "Esses turnos já estavam aceitos." });
      await carregar(mes);
    } catch (e: any) {
      setAviso({ tipo: "erro", texto: e.message });
    } finally {
      setAceitando(false);
    }
  }

  if (erro && !dados) {
    return (
      <main className="mesc" style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <style>{CSS}</style>
        <div className="mesc-cartao" style={{ maxWidth: 380, textAlign: "center" }}>
          <div style={{ fontSize: 40 }}>🔗</div>
          <h1 style={{ fontSize: 20, margin: "8px 0 6px" }}>Não deu para abrir</h1>
          <p className="mesc-dica">{erro}</p>
        </div>
      </main>
    );
  }
  if (!dados || !mes) return <main className="mesc" style={{ padding: 24 }}><style>{CSS}</style>Carregando a sua escala…</main>;

  const { loja, pessoa, turnos, resumo, pendentes } = dados;
  const emitidoEm = new Date().toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

  return (
    <main className="mesc">
      <style>{CSS}</style>
      {aviso && <div role={aviso.tipo === "erro" ? "alert" : "status"} className={`mesc-aviso ${aviso.tipo}`} onClick={() => setAviso(null)}>{aviso.texto}</div>}

      <div className="mesc-tela">
        <header className="mesc-topo">
          {loja.logo ? <img src={loja.logo} alt="" className="mesc-logo" /> : <div className="mesc-logo vazio">📅</div>}
          <div>
            <div className="mesc-loja">{loja.nome}</div>
            <h1>Minha escala</h1>
          </div>
        </header>

        <div className="mesc-corpo">
          <section className="mesc-cartao">
            <div className="mesc-ola">Olá, {pessoa.nome.split(/\s+/)[0]}! 👋</div>
            <div className="mesc-dica">{pessoa.tipo}{pessoa.telefone ? ` · ${pessoa.telefone}` : ""}</div>
          </section>

          {pendentes.length > 0 ? (
            <section className="mesc-cartao mesc-pedido">
              <h2>Confirme os seus turnos</h2>
              {pendentes.map((t) => (
                <div key={t.inscricaoId} className="mesc-linha">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="mesc-dia">{maiuscula(diaPorExtenso(t.data))}</div>
                    <div><b>{horarioDoTurno(t.inicio, t.fim)}</b> · {t.funcao}</div>
                  </div>
                  {t.valor ? <span className="mesc-valor">{reais(t.valor)}</span> : null}
                </div>
              ))}
              <p className="mesc-dica" style={{ margin: "10px 0" }}>
                Ao tocar em <b>Aceito</b> você confirma que escolheu trabalhar nesses dias e horários. A loja guarda a data e a hora do aceite.
              </p>
              <button type="button" className="mesc-botao" disabled={aceitando} onClick={aceitar}>
                {aceitando ? "Confirmando…" : `✅ Aceito ${pendentes.length === 1 ? "este turno" : `estes ${pendentes.length} turnos`}`}
              </button>
              <p className="mesc-dica" style={{ margin: "8px 0 0", textAlign: "center" }}>Algo errado? Não aceite e fale com a loja.</p>
            </section>
          ) : (
            <section className="mesc-cartao mesc-tudo-ok">✅ Tudo aceito. Nada esperando a sua confirmação.</section>
          )}

          <section className="mesc-cartao">
            <div className="mesc-mes">
              <button type="button" className="mesc-leve" aria-label="Mês anterior" onClick={() => carregar(navegar("mes", `${mes}-01`, -1).slice(0, 7))}>‹</button>
              <h2 style={{ flex: 1, textAlign: "center", margin: 0 }}>{maiuscula(mesPorExtenso(`${mes}-01`))}</h2>
              <button type="button" className="mesc-leve" aria-label="Próximo mês" onClick={() => carregar(navegar("mes", `${mes}-01`, 1).slice(0, 7))}>›</button>
            </div>
            {turnos.length === 0 ? <p className="mesc-dica">Nenhum turno seu neste mês.</p> : turnos.map((t) => (
              <div key={t.inscricaoId} className="mesc-linha">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="mesc-dia">{maiuscula(diaPorExtenso(t.data))}{t.data === dados.hoje ? " · hoje" : ""}</div>
                  <div><b>{horarioDoTurno(t.inicio, t.fim)}</b> · {t.funcao}{t.valor ? ` · ${reais(t.valor)}` : ""}</div>
                </div>
                <span className={`mesc-selo ${t.aceitoEm ? "ok" : ""}`}>{t.aceitoEm ? `✓ aceito ${quando(t.aceitoEm)}` : "aguardando"}</span>
              </div>
            ))}
            {turnos.length > 0 && (
              <div className="mesc-total">
                {resumo.turnos} turno{resumo.turnos === 1 ? "" : "s"}{resumo.total > 0 ? ` · previsto ${reais(resumo.total)}` : ""}
                {resumo.semValor > 0 ? ` (${resumo.semValor} sem valor combinado)` : ""}
              </div>
            )}
            <button type="button" className="mesc-botao claro" disabled={turnos.length === 0} onClick={() => window.print()}>📄 Baixar PDF do mês</button>
            <p className="mesc-dica" style={{ margin: "6px 0 0", textAlign: "center" }}>Na janela que abrir, escolha “Salvar como PDF”.</p>
          </section>
          <p className="mesc-rodape">Escala pelo FireHub</p>
        </div>
      </div>

      {/* O PDF: só aparece no papel. */}
      <div className="mesc-papel">
        <div className="cabeca">
          <div>
            <div className="loja">{loja.nome}</div>
            <h1>Escala de {pessoa.nome} — {mesPorExtenso(`${mes}-01`)}</h1>
            <div className="sub">{pessoa.tipo}{pessoa.telefone ? ` · WhatsApp ${pessoa.telefone}` : ""}</div>
          </div>
          <div className="emitido">Emitido em {emitidoEm}</div>
        </div>
        {turnos.length === 0 ? <p>Nenhum turno neste mês.</p> : (
          <table>
            <thead><tr><th>Dia</th><th>Horário</th><th>Função</th><th>Valor</th><th>Aceite</th></tr></thead>
            <tbody>
              {turnos.map((t) => (
                <tr key={t.inscricaoId}>
                  <td className="dia">{diaPorExtenso(t.data)}</td>
                  <td>{horarioDoTurno(t.inicio, t.fim)}</td>
                  <td>{t.funcao}</td>
                  <td>{t.valor ? reais(t.valor) : "—"}</td>
                  <td>{t.aceitoEm ? `Aceito pelo funcionário em ${quando(t.aceitoEm)}` : "Aguardando aceite"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="totais">
          {resumo.turnos} turno(s) · {resumo.aceitos} aceito(s) · {resumo.aguardando} aguardando
          {resumo.total > 0 ? ` · valor previsto ${reais(resumo.total)}` : ""}{resumo.semValor > 0 ? ` (${resumo.semValor} sem valor combinado)` : ""}
        </p>
        <p className="nota">
          O aceite é feito pela própria pessoa, no link pessoal enviado ao WhatsApp dela; a loja guarda a data, a hora, o telefone e o aparelho de cada aceite.
        </p>
      </div>
    </main>
  );
}

const CSS = `
.mesc { min-height: 100vh; background: #F0FDFA; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #0F172A; padding-bottom: 40px; }
.mesc-topo { background: linear-gradient(135deg, ${COR}, #115E59); color: #fff; padding: 22px 16px 26px; display: flex; gap: 14px; align-items: center; }
.mesc-topo h1 { margin: 0; font-size: 24px; font-weight: 900; }
.mesc-loja { font-size: 14px; opacity: .85; font-weight: 700; }
.mesc-logo { width: 56px; height: 56px; border-radius: 16px; object-fit: cover; background: #fff; flex-shrink: 0; }
.mesc-logo.vazio { display: flex; align-items: center; justify-content: center; font-size: 28px; background: rgba(255,255,255,.15); }
.mesc-corpo { max-width: 560px; margin: -14px auto 0; padding: 0 12px; }
.mesc-cartao { background: #fff; border-radius: 16px; padding: 14px; margin-bottom: 12px; box-shadow: 0 4px 14px rgba(15,23,42,.06); }
.mesc-cartao h2 { margin: 0 0 8px; font-size: 17px; font-weight: 900; }
.mesc-pedido { border: 2px solid #FCD34D; }
.mesc-tudo-ok { background: #ECFDF5; color: #065F46; font-weight: 800; }
.mesc-ola { font-size: 18px; font-weight: 900; }
.mesc-dica { font-size: 13px; color: #64748B; margin: 4px 0 0; line-height: 1.45; }
.mesc-linha { display: flex; gap: 10px; align-items: center; padding: 10px 0; border-top: 1px solid #F1F5F9; font-size: 14.5px; }
.mesc-linha:first-of-type { border-top: 0; }
.mesc-dia { font-size: 12.5px; color: ${COR}; font-weight: 800; }
.mesc-valor { font-weight: 900; color: #047857; white-space: nowrap; }
.mesc-selo { font-size: 12px; font-weight: 800; color: #92400E; background: #FEF3C7; border-radius: 999px; padding: 4px 9px; white-space: nowrap; }
.mesc-selo.ok { color: #047857; background: #ECFDF5; }
.mesc-botao { width: 100%; height: 52px; border-radius: 12px; border: 0; background: ${COR}; color: #fff; font-weight: 900; font-size: 17px; cursor: pointer; font-family: inherit; margin-top: 6px; }
.mesc-botao.claro { background: #fff; color: ${COR}; border: 2px solid ${COR}; height: 48px; font-size: 15.5px; margin-top: 12px; }
.mesc-botao:disabled { opacity: .6; }
.mesc-leve { width: 42px; height: 40px; border-radius: 11px; border: 1.5px solid #CBD5E1; background: #fff; font-weight: 900; font-size: 18px; cursor: pointer; }
.mesc-mes { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.mesc-total { font-size: 13.5px; font-weight: 800; color: #334155; border-top: 1px solid #F1F5F9; padding-top: 10px; }
.mesc-aviso { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 50; width: min(460px, calc(100vw - 24px)); border-radius: 14px; padding: 13px 15px; font-weight: 800; font-size: 14.5px; box-shadow: 0 10px 30px rgba(15,23,42,.2); cursor: pointer; }
.mesc-aviso.ok { background: #ECFDF5; color: #065F46; border-left: 5px solid #059669; }
.mesc-aviso.erro { background: #FEF2F2; color: #991B1B; border-left: 5px solid #DC2626; }
.mesc-rodape { text-align: center; font-size: 12px; color: #94A3B8; margin-top: 24px; }
.mesc-papel { display: none; }
@media print {
  @page { size: A4; margin: 14mm; }
  .mesc { background: #fff; padding: 0; min-height: 0; }
  .mesc-tela, .mesc-aviso { display: none !important; }
  .mesc-papel { display: block; font-family: Arial, Helvetica, sans-serif; color: #000; }
  .mesc-papel .cabeca { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: 2px solid #000; padding-bottom: 6px; margin-bottom: 10px; gap: 12px; }
  .mesc-papel .loja { font-size: 13pt; font-weight: 700; }
  .mesc-papel h1 { font-size: 16pt; margin: 2px 0; }
  .mesc-papel .sub, .mesc-papel .emitido { font-size: 9pt; color: #444; }
  .mesc-papel table { width: 100%; border-collapse: collapse; font-size: 10.5pt; }
  .mesc-papel th { text-align: left; background: #eee; border: 1px solid #999; padding: 5px 6px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .mesc-papel td { border: 1px solid #999; padding: 5px 6px; vertical-align: top; }
  .mesc-papel tr { break-inside: avoid; }
  .mesc-papel .dia { text-transform: capitalize; font-weight: 700; }
  .mesc-papel .totais { font-weight: 700; margin-top: 10px; }
  .mesc-papel .nota { font-size: 8.5pt; color: #444; margin-top: 8px; }
}
`;
