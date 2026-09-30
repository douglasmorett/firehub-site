"use client";
import React, { useEffect, useState } from "react";
import { ETAPAS, ORIGENS, ROTULO_DA_ETAPA, ROTULO_DA_ORIGEM, ROTULO_DO_STATUS_DE_REUNIAO, type StatusDeReuniao } from "@/lib/crm/etapas";
import type { ContatoCompleto, ReuniaoDaTela } from "@/lib/crm/serializar";
import type { EstadoDaLojaParaSuporte } from "@/lib/atendimento/estado-da-loja";
import { Iniciais, SeloDaEtapa, api, dataHora, haQuanto } from "./comum";
import ModalDeReuniao from "./ModalDeReuniao";

export type Evento = { id: string; tipo: string; texto: string; autorNome: string | null; autorTipo: string | null; criadoEm: string };
export type DetalheDoContato = {
  contato: ContatoCompleto;
  loja: EstadoDaLojaParaSuporte | null;
  reunioes: ReuniaoDaTela[];
  eventos: Evento[];
};

const hojeEmBrasilia = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/**
 * A FICHA DO CONTATO — a coluna da direita da caixa de atendimento e o
 * detalhe do funil. Etapa, vendedor, dados, o robô nesta conversa, a loja
 * (quando é lojista, com o raio-x do suporte), reuniões, notas e a linha do
 * tempo de tudo que aconteceu.
 */
export default function FichaDoContato({
  modo, detalhe, vendedores, aoAtualizar, aoFechar, aoAbrirConversa,
}: {
  modo: "ADMIN" | "VENDEDOR";
  detalhe: DetalheDoContato;
  vendedores: { id: string; nome: string }[];
  aoAtualizar: () => void;
  aoFechar?: () => void;
  aoAbrirConversa?: (id: string) => void;
}) {
  const c = detalhe.contato;
  const [dados, setDados] = useState({ nome: c.nome || "", nomeDaLoja: c.nomeDaLoja || "", cidade: c.cidade || "", email: c.email || "", origem: c.origem });
  const [notas, setNotas] = useState(c.notas || "");
  const [anotacao, setAnotacao] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [marcando, setMarcando] = useState(false);
  const [motivoPerda, setMotivoPerda] = useState("");
  const [pedindoMotivo, setPedindoMotivo] = useState(false);
  const [buscaLoja, setBuscaLoja] = useState("");
  const [lojas, setLojas] = useState<{ id: string; nome: string; email: string; cidade: string | null }[]>([]);
  const [ligandoLoja, setLigandoLoja] = useState(false);

  useEffect(() => {
    setDados({ nome: c.nome || "", nomeDaLoja: c.nomeDaLoja || "", cidade: c.cidade || "", email: c.email || "", origem: c.origem });
    setNotas(c.notas || "");
    setErro(null);
    setSalvo(null);
    setPedindoMotivo(false);
    setLigandoLoja(false);
  }, [c.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!ligandoLoja || buscaLoja.trim().length < 2) { setLojas([]); return; }
    const t = setTimeout(async () => {
      const r = await api(`/api/crm/lojas?busca=${encodeURIComponent(buscaLoja.trim())}`);
      if (r.ok) setLojas(r.dados.lojas || []);
    }, 250);
    return () => clearTimeout(t);
  }, [buscaLoja, ligandoLoja]);

  const patch = async (corpo: Record<string, unknown>, rotulo: string) => {
    setErro(null); setSalvo(null); setOcupado(rotulo);
    const r = await api(`/api/crm/contatos/${c.id}`, { method: "PATCH", json: corpo });
    setOcupado(null);
    if (!r.ok) { setErro(r.erro); return false; }
    setSalvo(rotulo);
    setTimeout(() => setSalvo(null), 2500);
    aoAtualizar();
    return true;
  };

  const robo = async (acao: string) => {
    setErro(null); setOcupado(acao);
    const r = await api(`/api/crm/contatos/${c.id}/robo`, { method: "POST", json: { acao } });
    setOcupado(null);
    if (!r.ok) setErro(r.erro); else aoAtualizar();
  };

  const anotar = async () => {
    if (!anotacao.trim()) return;
    setOcupado("nota");
    const r = await api(`/api/crm/contatos/${c.id}/notas`, { method: "POST", json: { texto: anotacao } });
    setOcupado(null);
    if (!r.ok) { setErro(r.erro); return; }
    setAnotacao("");
    aoAtualizar();
  };

  const statusDaReuniao = async (id: string, status: StatusDeReuniao) => {
    setOcupado(`r${id}`);
    const r = await api(`/api/crm/agenda/${id}`, { method: "PATCH", json: { status } });
    setOcupado(null);
    if (!r.ok) setErro(r.erro); else aoAtualizar();
  };

  const loja = detalhe.loja;
  const nomeDeExibicao = c.nomeDaLoja || c.nome || c.telefone || "Contato";
  const estadoDoRobo = c.roboDesligado
    ? "Desligado para este número"
    : c.aguardandoHumano
      ? "Esperando uma pessoa responder"
      : c.roboPausadoAte
        ? `Pausado até ${dataHora(c.roboPausadoAte)}`
        : "Pode responder";

  return (
    <div className="crm" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Iniciais texto={nomeDeExibicao} tamanho={42} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 800, fontSize: "0.95rem", overflow: "hidden", textOverflow: "ellipsis" }}>{nomeDeExibicao}</div>
          <div className="crm-sub">
            {c.nome && c.nomeDaLoja ? `${c.nome} · ` : ""}{c.telefone || "sem telefone"}
            {c.whatsapp && <> · <a href={c.whatsapp} target="_blank" rel="noreferrer" style={{ color: "#0F766E", fontWeight: 700 }}>WhatsApp</a></>}
          </div>
        </div>
        {aoFechar && <button className="crm-x" onClick={aoFechar} aria-label="Fechar ficha">×</button>}
      </div>

      {erro && <div className="crm-erro">{erro}</div>}
      {salvo && <div className="crm-ok">✓ Salvo</div>}

      <div className="crm-bloco">
        <h4>Funil</h4>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <select
            className="crm-select"
            value={c.etapa}
            disabled={ocupado === "etapa"}
            onChange={(e) => {
              if (e.target.value === "PERDIDO") { setPedindoMotivo(true); return; }
              void patch({ etapa: e.target.value }, "etapa");
            }}
          >
            {ETAPAS.map((e) => <option key={e} value={e}>{ROTULO_DA_ETAPA[e]}</option>)}
          </select>
          <SeloDaEtapa etapa={c.etapa} />
        </div>
        {c.etapa === "PERDIDO" && c.motivoPerda && <div className="crm-sub" style={{ marginTop: 6 }}>Motivo: {c.motivoPerda}</div>}
        {pedindoMotivo && (
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input className="crm-input" autoFocus placeholder="Por que perdeu? (preço, já tem sistema…)" value={motivoPerda} onChange={(e) => setMotivoPerda(e.target.value)} />
            <button className="crm-btn crm-btn-dark" onClick={async () => { if (await patch({ etapa: "PERDIDO", motivoPerda }, "etapa")) { setPedindoMotivo(false); setMotivoPerda(""); } }}>OK</button>
            <button className="crm-btn" onClick={() => setPedindoMotivo(false)}>×</button>
          </div>
        )}
        <div style={{ marginTop: 10 }}>
          <span className="crm-rotulo">Vendedor</span>
          {modo === "ADMIN" ? (
            <select className="crm-select" style={{ width: "100%" }} value={c.vendedorId || ""} disabled={ocupado === "vendedor"} onChange={(e) => void patch({ vendedorId: e.target.value || null }, "vendedor")}>
              <option value="">— Sem vendedor —</option>
              {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
              {c.vendedorId && !vendedores.some((v) => v.id === c.vendedorId) && <option value={c.vendedorId}>{c.vendedorNome} (fora da equipe)</option>}
            </select>
          ) : (
            <div style={{ fontWeight: 700, fontSize: "0.86rem" }}>{c.vendedorNome || "—"}</div>
          )}
          {c.vendedorAtribuidoEm && (
            <div className="crm-sub" style={{ marginTop: 4 }}>
              Recebeu {haQuanto(c.vendedorAtribuidoEm)} · {c.primeiroContatoEm ? `primeiro contato ${haQuanto(c.primeiroContatoEm)}` : "ainda sem contato do vendedor"}
            </div>
          )}
        </div>
      </div>

      <div className="crm-bloco">
        <h4>Robô nesta conversa</h4>
        <div style={{ fontSize: "0.82rem", fontWeight: 600, marginBottom: 8 }}>{estadoDoRobo}</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {c.roboDesligado ? (
            <button className="crm-btn crm-btn-sm" disabled={!!ocupado} onClick={() => robo("religar")}>Religar para este número</button>
          ) : (
            <>
              {c.roboPausadoAte || c.aguardandoHumano
                ? <button className="crm-btn crm-btn-sm" disabled={!!ocupado} onClick={() => robo("devolver")}>🤖 Devolver ao robô</button>
                : <button className="crm-btn crm-btn-sm" disabled={!!ocupado} onClick={() => robo("pausar")}>⏸ Pausar robô</button>}
              {c.aguardandoHumano && <button className="crm-btn crm-btn-sm" disabled={!!ocupado} onClick={() => robo("resolvido")}>✓ Já atendi</button>}
              <button className="crm-btn crm-btn-sm crm-btn-perigo" disabled={!!ocupado} onClick={() => robo("desligar")} title="Contato pessoal, fornecedor: o robô nunca responde">Nunca responder</button>
            </>
          )}
        </div>
      </div>

      {loja ? (
        <div className="crm-bloco">
          <h4>Loja {loja.cardapio && <a href={loja.cardapio} target="_blank" rel="noreferrer" style={{ color: "#0F766E", textTransform: "none", marginLeft: 4 }}>ver cardápio ↗</a>}</h4>
          <div className="crm-linha"><span>Loja</span><span>{loja.loja}</span></div>
          <div className="crm-linha"><span>Situação</span><span>{loja.teste.emTeste ? `Em teste · ${loja.teste.diasRestantes} dia(s)` : "Assinante"}</span></div>
          <div className="crm-linha"><span>Site aberto</span><span>{loja.lojaAberta ? "Sim" : "Não"}</span></div>
          <div className="crm-linha"><span>Último pedido</span><span>{loja.ultimoPedido} · {loja.pedidosNaSemana} na semana</span></div>
          <div className="crm-linha"><span>Robô do WhatsApp</span><span style={{ color: loja.robo.conectado === false ? "#B91C1C" : undefined }}>{loja.robo.conectado === null ? "—" : loja.robo.conectado ? "Conectado" : "Desconectado"}</span></div>
          <div className="crm-linha">
            <span>Impressão</span>
            <span style={{ color: loja.impressao.minutosSemConsultar !== null && loja.impressao.minutosSemConsultar > 10 ? "#B45309" : undefined }}>
              {loja.impressao.ultimaConsulta ? `${haQuanto(loja.impressao.ultimaConsulta)}${loja.impressao.versao ? ` · v${loja.impressao.versao}` : ""}` : "nunca conectou"}
            </span>
          </div>
          <div className="crm-linha"><span>Canais</span><span>{[loja.canais.ifood && "iFood", loja.canais.food99 && "99Food", loja.canais.jotaja && "JotaJá", loja.canais.brendi && "Brendi"].filter(Boolean).join(", ") || "só próprios"}</span></div>
          {loja.faturaEmAberto && (
            <div className="crm-linha"><span>Fatura em aberto</span><span style={{ color: "#B91C1C" }}>R$ {loja.faturaEmAberto.valor.toFixed(2).replace(".", ",")}</span></div>
          )}
          {modo === "ADMIN" && <button className="crm-btn crm-btn-sm" style={{ marginTop: 6 }} onClick={() => void patch({ userId: null }, "loja")}>Desvincular desta loja</button>}
        </div>
      ) : modo === "ADMIN" ? (
        <div className="crm-bloco">
          <h4>Loja</h4>
          {!ligandoLoja ? (
            <button className="crm-btn crm-btn-sm" onClick={() => setLigandoLoja(true)}>Já é cliente? Ligar a uma loja</button>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <input className="crm-input" autoFocus placeholder="Nome da loja, e-mail ou cidade" value={buscaLoja} onChange={(e) => setBuscaLoja(e.target.value)} />
              {lojas.map((l) => (
                <button key={l.id} className="crm-btn" style={{ justifyContent: "flex-start", whiteSpace: "normal", textAlign: "left" }} onClick={async () => { if (await patch({ userId: l.id }, "loja")) setLigandoLoja(false); }}>
                  <span><b>{l.nome}</b><br /><span className="crm-sub">{l.email}{l.cidade ? ` · ${l.cidade}` : ""}</span></span>
                </button>
              ))}
              <button className="crm-btn crm-btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setLigandoLoja(false)}>Cancelar</button>
            </div>
          )}
        </div>
      ) : null}

      <div className="crm-bloco">
        <h4>Dados</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <input className="crm-input" placeholder="Nome da pessoa" value={dados.nome} onChange={(e) => setDados({ ...dados, nome: e.target.value })} />
          <input className="crm-input" placeholder="Nome da loja" value={dados.nomeDaLoja} onChange={(e) => setDados({ ...dados, nomeDaLoja: e.target.value })} />
          <div className="crm-grade2">
            <input className="crm-input" placeholder="Cidade" value={dados.cidade} onChange={(e) => setDados({ ...dados, cidade: e.target.value })} />
            <input className="crm-input" placeholder="E-mail" value={dados.email} onChange={(e) => setDados({ ...dados, email: e.target.value })} />
          </div>
          <label><span className="crm-rotulo">Origem</span>
            <select className="crm-select" style={{ width: "100%" }} value={dados.origem} onChange={(e) => setDados({ ...dados, origem: e.target.value })}>
              {ORIGENS.map((o) => <option key={o} value={o}>{ROTULO_DA_ORIGEM[o]}</option>)}
            </select>
          </label>
          {c.resumo && <div className="crm-aviso" style={{ fontSize: "0.78rem" }}><b>O robô anotou:</b> {c.resumo}</div>}
          <button className="crm-btn crm-btn-dark" style={{ alignSelf: "flex-start" }} disabled={ocupado === "dados"} onClick={() => void patch(dados, "dados")}>
            {ocupado === "dados" ? "Salvando…" : "Salvar dados"}
          </button>
        </div>
      </div>

      <div className="crm-bloco">
        <h4>Reuniões</h4>
        {detalhe.reunioes.length === 0 && <div className="crm-sub" style={{ marginBottom: 8 }}>Nenhuma reunião marcada.</div>}
        {detalhe.reunioes.map((r) => (
          <div key={r.id} style={{ border: "1px solid #EEF0F3", borderRadius: 10, padding: "8px 10px", marginBottom: 6 }}>
            <div style={{ fontWeight: 700, fontSize: "0.8rem" }}>{r.titulo}</div>
            <div className="crm-sub">{dataHora(r.inicio)} · {r.vendedorNome} · {ROTULO_DO_STATUS_DE_REUNIAO[r.status as StatusDeReuniao] || r.status}</div>
            {r.status === "MARCADA" && (
              <div style={{ display: "flex", gap: 5, marginTop: 6, flexWrap: "wrap" }}>
                <button className="crm-btn crm-btn-sm" disabled={!!ocupado} onClick={() => statusDaReuniao(r.id, "REALIZADA")}>✓ Feita</button>
                <button className="crm-btn crm-btn-sm" disabled={!!ocupado} onClick={() => statusDaReuniao(r.id, "FALTOU")}>Não veio</button>
                <button className="crm-btn crm-btn-sm crm-btn-perigo" disabled={!!ocupado} onClick={() => statusDaReuniao(r.id, "CANCELADA")}>Cancelar</button>
              </div>
            )}
          </div>
        ))}
        <button className="crm-btn crm-btn-sm crm-btn-primary" onClick={() => setMarcando(true)}>📅 Marcar demonstração</button>
      </div>

      <div className="crm-bloco">
        <h4>Notas</h4>
        <textarea className="crm-textarea" rows={3} placeholder="O que vale lembrar sobre este contato" value={notas} onChange={(e) => setNotas(e.target.value)} />
        <button className="crm-btn crm-btn-sm" style={{ marginTop: 6 }} disabled={ocupado === "notas" || notas === (c.notas || "")} onClick={() => void patch({ notas }, "notas")}>Salvar notas</button>
      </div>

      <div className="crm-bloco">
        <h4>Linha do tempo</h4>
        <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
          <input className="crm-input" placeholder="Anotar (ex.: liguei, retorna sexta)" value={anotacao} onChange={(e) => setAnotacao(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void anotar(); }} />
          <button className="crm-btn" disabled={!anotacao.trim() || ocupado === "nota"} onClick={anotar}>+</button>
        </div>
        {detalhe.eventos.length === 0 && <div className="crm-sub">Nada ainda.</div>}
        {detalhe.eventos.map((e) => (
          <div key={e.id} style={{ borderLeft: "2px solid #E5E7EB", padding: "2px 0 8px 10px", marginLeft: 4 }}>
            <div style={{ fontSize: "0.8rem" }}>{e.texto}</div>
            <div className="crm-sub" style={{ fontSize: "0.68rem" }}>{e.autorNome || (e.autorTipo === "ROBO" ? "Robô" : "Sistema")} · {dataHora(e.criadoEm)}</div>
          </div>
        ))}
      </div>

      {aoAbrirConversa && <button className="crm-btn" onClick={() => aoAbrirConversa(c.id)}>💬 Abrir a conversa</button>}

      {marcando && (
        <ModalDeReuniao
          modo={modo}
          vendedores={vendedores}
          inicial={{ vendedorId: c.vendedorId || undefined, data: hojeEmBrasilia(), hora: "10:00", contato: { id: c.id, rotulo: nomeDeExibicao } }}
          aoFechar={() => setMarcando(false)}
          aoSalvar={() => { setMarcando(false); aoAtualizar(); }}
        />
      )}
    </div>
  );
}
