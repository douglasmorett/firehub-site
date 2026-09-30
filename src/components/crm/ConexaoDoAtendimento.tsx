"use client";
import React, { useCallback, useEffect, useState } from "react";
import { Modal, api, haQuanto } from "./comum";

type Config = {
  roboLigado: boolean;
  nomeDoAtendente: string;
  avisarNoWhatsApp: string | null;
  lembreteAoContato: boolean;
  avisoAoVendedor: boolean;
  instrucoesExtras: string;
  evolutionUrl: string | null;
  temChaveDoGateway: boolean;
  conexao: { conectado: boolean | null; telefone: string | null; desde: string | null; desconectadoDesde: string | null; jaConectou: boolean };
};

const exibirTelefone = (t: string | null) => {
  const d = String(t || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return t || "";
};

/**
 * A barra do topo da caixa de atendimento (admin): o número do FireHub está
 * conectado? o robô está ligado? — e o botão que abre a conexão (QR ou código)
 * e o que o robô sabe além da base.
 */
export default function ConexaoDoAtendimento() {
  const [config, setConfig] = useState<Config | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [trocandoRobo, setTrocandoRobo] = useState(false);

  const carregar = useCallback(async () => {
    // Pergunta ao gateway primeiro: o gravado pode estar velho (o número
    // conectou antes de existir o aviso de conexão, ou o evento se perdeu).
    await api("/api/crm/atendimento/conexao");
    const r = await api("/api/crm/atendimento");
    if (!r.ok) { setErro(r.erro); return; }
    setErro(null);
    setConfig(r.dados.config);
  }, []);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => {
    const i = setInterval(() => { if (document.visibilityState === "visible") void carregar(); }, 30_000);
    return () => clearInterval(i);
  }, [carregar]);

  const alternarRobo = async () => {
    if (!config) return;
    const ligar = !config.roboLigado;
    if (ligar && !confirm("Ligar o robô? A partir de agora ele responde sozinho as mensagens NOVAS que chegarem no WhatsApp do FireHub (as conversas em que alguém respondeu nas últimas horas continuam com a pessoa).")) return;
    setTrocandoRobo(true);
    const r = await api("/api/crm/atendimento", { method: "PUT", json: { roboLigado: ligar } });
    setTrocandoRobo(false);
    if (r.ok) setConfig(r.dados.config); else setErro(r.erro);
  };

  const cx = config?.conexao;
  const status = !config
    ? { cor: "#94A3B8", texto: "Carregando…" }
    : cx?.conectado
      ? { cor: "#22C55E", texto: `Conectado${cx.telefone ? ` · ${exibirTelefone(cx.telefone)}` : ""}` }
      : cx?.jaConectou
        ? { cor: "#EF4444", texto: `Desconectado${cx.desconectadoDesde ? ` ${haQuanto(cx.desconectadoDesde)}` : ""}` }
        : { cor: "#F59E0B", texto: "Número do FireHub ainda não conectado" };

  return (
    <>
      <div className="crm-card" style={{ padding: "10px 14px", marginBottom: 12, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: "0.84rem" }}>
          <i style={{ width: 9, height: 9, borderRadius: "50%", background: status.cor, display: "inline-block" }} />
          WhatsApp do FireHub: {status.texto}
        </span>
        {config && !cx?.conectado && <button className="crm-btn crm-btn-primary crm-btn-sm" onClick={() => setAberto(true)}>Conectar</button>}
        <span style={{ flex: 1 }} />
        {config && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: "0.82rem", fontWeight: 700, cursor: "pointer" }} title="Com o robô desligado as conversas só são gravadas; ninguém responde sozinho.">
            <span style={{ color: config.roboLigado ? "#15803D" : "#64748B" }}>🤖 Robô {config.roboLigado ? "ligado" : "desligado"}</span>
            <button
              role="switch"
              aria-checked={config.roboLigado}
              disabled={trocandoRobo}
              onClick={alternarRobo}
              style={{ width: 42, height: 24, borderRadius: 12, border: "none", cursor: "pointer", position: "relative", background: config.roboLigado ? "#22C55E" : "#CBD5E1", transition: "background .15s" }}
            >
              <span style={{ position: "absolute", top: 3, left: config.roboLigado ? 21 : 3, width: 18, height: 18, borderRadius: "50%", background: "#FFFFFF", transition: "left .15s", boxShadow: "0 1px 2px rgba(0,0,0,.2)" }} />
            </button>
          </label>
        )}
        <button className="crm-btn crm-btn-sm" onClick={() => setAberto(true)}>⚙️ Conexão e robô</button>
      </div>
      {erro && <div className="crm-erro" style={{ marginBottom: 12 }}>{erro}</div>}
      {aberto && config && <ModalDaConexao config={config} aoFechar={() => { setAberto(false); void carregar(); }} aoMudar={setConfig} />}
    </>
  );
}

function ModalDaConexao({ config, aoFechar, aoMudar }: { config: Config; aoFechar: () => void; aoMudar: (c: Config) => void }) {
  const [qr, setQr] = useState<string | null>(null);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [numero, setNumero] = useState("22981118514");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [conectado, setConectado] = useState(!!config.conexao.conectado);
  const [form, setForm] = useState({
    nomeDoAtendente: config.nomeDoAtendente,
    avisarNoWhatsApp: config.avisarNoWhatsApp || "",
    lembreteAoContato: config.lembreteAoContato,
    avisoAoVendedor: config.avisoAoVendedor,
    instrucoesExtras: config.instrucoesExtras,
    evolutionUrl: config.evolutionUrl || "",
    evolutionApiKey: "",
  });

  // Enquanto o QR/código está na tela, confere a cada 3 s se o celular já leu.
  useEffect(() => {
    if (!qr && !codigo) return;
    const i = setInterval(async () => {
      const r = await api("/api/crm/atendimento/conexao");
      if (r.ok && r.dados.estado?.conectado) {
        setConectado(true);
        setQr(null);
        setCodigo(null);
        setOk("Conectado! As mensagens do WhatsApp do FireHub já aparecem na caixa de atendimento.");
      }
    }, 3000);
    return () => clearInterval(i);
  }, [qr, codigo]);

  const conexao = async (acao: string, extra: Record<string, unknown> = {}) => {
    setErro(null); setOk(null); setOcupado(acao);
    const r = await api("/api/crm/atendimento/conexao", { method: "POST", json: { acao, ...extra } });
    setOcupado(null);
    if (!r.ok) { setErro(r.dados?.erro || r.erro); return null; }
    return r.dados;
  };

  const salvar = async () => {
    setErro(null); setOk(null); setOcupado("salvar");
    const r = await api("/api/crm/atendimento", { method: "PUT", json: form });
    setOcupado(null);
    if (!r.ok) { setErro(r.erro); return; }
    aoMudar(r.dados.config);
    setForm((f) => ({ ...f, evolutionApiKey: "" }));
    setOk("Configuração salva.");
  };

  return (
    <Modal titulo="WhatsApp do FireHub e robô" aoFechar={aoFechar} largura={620}>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {erro && <div className="crm-erro">{erro}</div>}
        {ok && <div className="crm-ok">{ok}</div>}

        <section>
          <h4 style={{ margin: "0 0 8px", fontSize: "0.86rem" }}>1. Conexão do número</h4>
          {conectado ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div className="crm-ok">✓ Conectado{config.conexao.telefone ? ` — ${exibirTelefone(config.conexao.telefone)}` : ""}. Você continua usando o WhatsApp Business normalmente no celular.</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="crm-btn" disabled={!!ocupado} onClick={async () => { if (await conexao("reiniciar")) setOk("Conexão reiniciada (sem precisar de QR)."); }}>↻ Reiniciar conexão</button>
                <button className="crm-btn crm-btn-perigo" disabled={!!ocupado} onClick={async () => {
                  const palavra = prompt('Isso desliga o atendimento do número do FireHub no painel. Digite DESCONECTAR para confirmar.');
                  if (palavra !== "DESCONECTAR") return;
                  if (await conexao("desconectar", { confirmar: "DESCONECTAR" })) { setConectado(false); setOk("Desconectado."); }
                }}>Desconectar</button>
              </div>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <ol style={{ margin: 0, paddingLeft: 18, fontSize: "0.82rem", lineHeight: 1.6, color: "#334155" }}>
                <li>No celular do número do FireHub, abra o <b>WhatsApp Business</b>.</li>
                <li>Toque em <b>⋮ → Aparelhos conectados → Conectar aparelho</b>.</li>
                <li>Leia o QR abaixo (ou use "Conectar com número de telefone" e digite o código).</li>
              </ol>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button className="crm-btn crm-btn-primary" disabled={!!ocupado} onClick={async () => {
                  const d = await conexao("qr");
                  if (d?.conectado) { setConectado(true); setOk("Já estava conectado."); }
                  else if (d?.qr) { setQr(d.qr); setCodigo(null); }
                  else if (d?.erro) setErro(d.erro);
                }}>{ocupado === "qr" ? "Gerando…" : "Mostrar QR"}</button>
                <input className="crm-input" style={{ width: 170 }} value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="DDD + número" />
                <button className="crm-btn" disabled={!!ocupado} onClick={async () => {
                  const d = await conexao("codigo", { numero });
                  if (d?.conectado) { setConectado(true); setOk("Já estava conectado."); }
                  else if (d?.codigo) { setCodigo(d.codigo); setQr(null); }
                }}>{ocupado === "codigo" ? "Pedindo…" : "Pedir código"}</button>
              </div>
              {qr && <img src={qr} alt="QR para conectar o WhatsApp do FireHub" style={{ width: 240, height: 240, alignSelf: "center", border: "1px solid #E5E7EB", borderRadius: 12 }} />}
              {codigo && (
                <div style={{ alignSelf: "center", textAlign: "center" }}>
                  <div className="crm-sub">Digite no celular:</div>
                  <div style={{ fontSize: "2rem", fontWeight: 900, letterSpacing: 6 }}>{codigo}</div>
                </div>
              )}
              {(qr || codigo) && <div className="crm-sub" style={{ textAlign: "center" }}>Esperando o celular… esta tela avisa sozinha quando conectar.</div>}
            </div>
          )}
        </section>

        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <h4 style={{ margin: 0, fontSize: "0.86rem" }}>2. Avisos e robô</h4>
          <div className="crm-grade2">
            <label><span className="crm-rotulo">Nome do atendente (opcional)</span>
              <input className="crm-input" placeholder="Vazio = 'assistente do FireHub'" value={form.nomeDoAtendente} onChange={(e) => setForm({ ...form, nomeDoAtendente: e.target.value })} />
            </label>
            <label><span className="crm-rotulo">Me avisar neste WhatsApp</span>
              <input className="crm-input" placeholder="Vazio = (22) 99885-1680" value={form.avisarNoWhatsApp} onChange={(e) => setForm({ ...form, avisarNoWhatsApp: e.target.value })} />
            </label>
          </div>
          <div className="crm-sub">Chega aqui (num número diferente do atendimento): quando alguém pede uma pessoa e quando o WhatsApp do FireHub desconecta.</div>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.84rem" }}>
            <input type="checkbox" checked={form.lembreteAoContato} onChange={(e) => setForm({ ...form, lembreteAoContato: e.target.checked })} />
            Lembrar o contato 1 hora antes da demonstração
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: "0.84rem" }}>
            <input type="checkbox" checked={form.avisoAoVendedor} onChange={(e) => setForm({ ...form, avisoAoVendedor: e.target.checked })} />
            Avisar o vendedor no WhatsApp dele (contato novo na carteira, reunião marcada, pedido de pessoa)
          </label>
          <label><span className="crm-rotulo">Recados para o robô (valem mais que a base)</span>
            <textarea className="crm-textarea" rows={4} placeholder="Ex.: Esta semana, quem fechar ganha 30 dias de teste. Não atendemos fora do Brasil." value={form.instrucoesExtras} onChange={(e) => setForm({ ...form, instrucoesExtras: e.target.value })} />
          </label>
          <details>
            <summary className="crm-sub" style={{ cursor: "pointer" }}>Gateway próprio (avançado)</summary>
            <div className="crm-grade2" style={{ marginTop: 8 }}>
              <input className="crm-input" placeholder="URL do gateway (vazio = o padrão)" value={form.evolutionUrl} onChange={(e) => setForm({ ...form, evolutionUrl: e.target.value })} />
              <input className="crm-input" type="password" placeholder={config.temChaveDoGateway ? "Chave salva (deixe vazio para manter)" : "Chave do gateway"} value={form.evolutionApiKey} onChange={(e) => setForm({ ...form, evolutionApiKey: e.target.value })} />
            </div>
          </details>
          <button className="crm-btn crm-btn-dark" style={{ alignSelf: "flex-start" }} disabled={ocupado === "salvar"} onClick={salvar}>{ocupado === "salvar" ? "Salvando…" : "Salvar"}</button>
        </section>
      </div>
    </Modal>
  );
}
