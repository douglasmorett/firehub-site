"use client";
import React, { useCallback, useEffect, useState } from "react";
import type { DesempenhoDoVendedor } from "@/lib/crm/desempenho";
import { EstiloDoCrm, api } from "./comum";

const PERIODOS = [
  { chave: "7", rotulo: "7 dias" },
  { chave: "30", rotulo: "30 dias" },
  { chave: "90", rotulo: "90 dias" },
];

function tempo(min: number | null): string {
  if (min === null) return "—";
  if (min < 60) return `${min} min`;
  if (min < 24 * 60) return `${Math.round(min / 6) / 10} h`.replace(".", ",");
  return `${Math.round(min / 144) / 10} dias`.replace(".", ",");
}

/**
 * O DESEMPENHO DA EQUIPE no período — o que cada vendedor fez com os contatos
 * que recebeu: quanto demorou para responder, quantas demonstrações marcou e
 * fez, quantos viraram teste e cliente. Complementa o placar da carteira
 * (clientes, parados, comissão) que fica logo acima, na aba Vendedores.
 */
export default function DesempenhoDaEquipe() {
  const [periodo, setPeriodo] = useState("30");
  const [linhas, setLinhas] = useState<DesempenhoDoVendedor[] | null>(null);
  const [intervalo, setIntervalo] = useState<{ de: string; ate: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await api(`/api/crm/desempenho?dias=${periodo}`);
    if (!r.ok) { setErro(r.erro); return; }
    setErro(null);
    setLinhas(r.dados.equipe || []);
    setIntervalo({ de: r.dados.de, ate: r.dados.ate });
  }, [periodo]);

  useEffect(() => { void carregar(); }, [carregar]);

  const br = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
  const total = (campo: keyof DesempenhoDoVendedor) => (linhas || []).reduce((s, l) => s + (Number(l[campo]) || 0), 0);

  return (
    <div className="crm" style={{ marginTop: 24 }}>
      <EstiloDoCrm />
      <div className="crm-card" style={{ overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #EEF0F3", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <h3 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 800 }}>Desempenho no CRM</h3>
          {intervalo && <span className="crm-sub">{br(intervalo.de)} a {br(intervalo.ate)}</span>}
          <span style={{ flex: 1 }} />
          {PERIODOS.map((p) => (
            <button key={p.chave} className={`crm-chip${periodo === p.chave ? " on" : ""}`} onClick={() => setPeriodo(p.chave)}>{p.rotulo}</button>
          ))}
        </div>
        {erro && <div className="crm-erro" style={{ margin: 12 }}>{erro}</div>}
        <div style={{ overflowX: "auto" }}>
          <table className="crm-tabela">
            <thead>
              <tr>
                <th>Vendedor</th>
                <th title="Contatos que passaram para ele no período">Recebeu</th>
                <th title="Contatos dele que ainda não receberam a primeira mensagem dele (agora)">Esperando resposta</th>
                <th title="Média entre receber o contato e mandar a primeira mensagem pelo WhatsApp do FireHub">Tempo até responder</th>
                <th title="Mensagens que ele mandou pela tela / em quantas conversas">Mensagens</th>
                <th title="Demonstrações marcadas no período">Demos marcadas</th>
                <th title="Das demonstrações que aconteceram no período">Feitas / faltaram</th>
                <th title="Demonstrações marcadas daqui para frente">Próximas</th>
                <th title="Lojas da carteira dele que se cadastraram no período (teste grátis)">Cadastros</th>
                <th title="Contatos dele que foram para Cliente / Perdido no período">Clientes / perdidos</th>
              </tr>
            </thead>
            <tbody>
              {linhas === null && <tr><td colSpan={10} className="crm-sub" style={{ textAlign: "center", padding: 20 }}>Carregando…</td></tr>}
              {linhas?.length === 0 && <tr><td colSpan={10} className="crm-sub" style={{ textAlign: "center", padding: 20 }}>Nenhum vendedor na equipe.</td></tr>}
              {linhas?.map((l) => (
                <tr key={l.vendedorId} style={{ opacity: l.ativo ? 1 : 0.55 }}>
                  <td style={{ fontWeight: 700 }}>{l.nome}{!l.ativo && <span className="crm-sub"> (inativo)</span>}</td>
                  <td>{l.recebidos}</td>
                  <td style={{ color: l.esperando > 0 ? "#B45309" : undefined, fontWeight: l.esperando > 0 ? 800 : undefined }}>{l.esperando}</td>
                  <td>{tempo(l.tempoAtePrimeiroContatoMin)}</td>
                  <td>{l.mensagens} <span className="crm-sub">/ {l.conversas}</span></td>
                  <td>{l.demosMarcadas}</td>
                  <td>{l.demosFeitas} <span className="crm-sub">/ {l.demosFaltou}</span></td>
                  <td>{l.proximasDemos}</td>
                  <td style={{ color: l.cadastros > 0 ? "#15803D" : undefined, fontWeight: l.cadastros > 0 ? 800 : undefined }}>{l.cadastros}</td>
                  <td>{l.clientes} <span className="crm-sub">/ {l.perdidos}</span></td>
                </tr>
              ))}
              {linhas && linhas.length > 1 && (
                <tr style={{ background: "#F8FAFC" }}>
                  <td style={{ fontWeight: 800 }}>Equipe</td>
                  <td>{total("recebidos")}</td>
                  <td>{total("esperando")}</td>
                  <td>—</td>
                  <td>{total("mensagens")}</td>
                  <td>{total("demosMarcadas")}</td>
                  <td>{total("demosFeitas")} <span className="crm-sub">/ {total("demosFaltou")}</span></td>
                  <td>{total("proximasDemos")}</td>
                  <td>{total("cadastros")}</td>
                  <td>{total("clientes")} <span className="crm-sub">/ {total("perdidos")}</span></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
