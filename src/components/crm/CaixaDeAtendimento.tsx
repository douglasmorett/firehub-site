"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContatoDaLista, MensagemDaTela } from "@/lib/crm/serializar";
import { EstiloDoCrm, Iniciais, SeloDaEtapa, api, dataHora, horaDe, quandoCurto } from "./comum";
import FichaDoContato, { type DetalheDoContato } from "./FichaDoContato";

type Filtro = "todas" | "aguardando" | "naoLidas" | "semVendedor";

const COR_DO_AUTOR: Record<string, { fundo: string; texto: string; rotulo: string }> = {
  ROBO: { fundo: "#EEF2FF", texto: "#1E1B4B", rotulo: "🤖 Robô" },
  ADMIN: { fundo: "#FFE4DA", texto: "#431407", rotulo: "Admin" },
  VENDEDOR: { fundo: "#FEF3C7", texto: "#422006", rotulo: "Vendedor" },
  CELULAR: { fundo: "#DCFCE7", texto: "#052E16", rotulo: "📱 Pelo celular" },
  SISTEMA: { fundo: "#F1F5F9", texto: "#334155", rotulo: "⏰ Automático" },
};

const diaDaMensagem = (iso: string) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "long", day: "2-digit", month: "2-digit" }).format(new Date(iso));

/** O *negrito* do WhatsApp como negrito na tela (a assinatura do vendedor, o que o robô destaca). */
function comNegrito(texto: string): React.ReactNode {
  const partes = texto.split(/(\*[^*\n]+\*)/g);
  return partes.map((p, i) => (/^\*[^*\n]+\*$/.test(p) ? <b key={i}>{p.slice(1, -1)}</b> : <React.Fragment key={i}>{p}</React.Fragment>));
}

/**
 * A CAIXA DE ATENDIMENTO do número do FireHub — admin (todas as conversas) e
 * vendedor (só as dele). Lista à esquerda, conversa no meio, ficha à direita.
 *
 * Atualiza sozinha: a lista a cada 6 s e a conversa aberta a cada 3 s (só o
 * que chegou depois da última mensagem). Aba escondida não pergunta nada.
 */
export default function CaixaDeAtendimento({
  modo, abrirContatoId, cabecalho,
}: {
  modo: "ADMIN" | "VENDEDOR";
  abrirContatoId?: string | null;
  cabecalho?: React.ReactNode;
}) {
  const [contatos, setContatos] = useState<ContatoDaLista[]>([]);
  const [totais, setTotais] = useState<{ aguardando: number; naoLidas: number }>({ aguardando: 0, naoLidas: 0 });
  const [carregou, setCarregou] = useState(false);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [busca, setBusca] = useState("");
  const [vendedorFiltro, setVendedorFiltro] = useState("");
  const [vendedores, setVendedores] = useState<{ id: string; nome: string }[]>([]);
  const [selecionado, setSelecionado] = useState<string | null>(abrirContatoId || null);
  const [detalhe, setDetalhe] = useState<DetalheDoContato | null>(null);
  const [mensagens, setMensagens] = useState<MensagemDaTela[]>([]);
  const [texto, setTexto] = useState("");
  const [assinar, setAssinar] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [fichaAberta, setFichaAberta] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const colarNoFim = useRef(true);
  // A conversa que está aberta AGORA. Toda resposta do servidor confere com
  // ela antes de mexer na tela: um clique rápido de A para B não pode fazer a
  // resposta atrasada de A aparecer — nem a mensagem "para A" sair para B.
  const abertaRef = useRef<string | null>(selecionado);

  useEffect(() => { if (abrirContatoId) setSelecionado(abrirContatoId); }, [abrirContatoId]);

  useEffect(() => {
    void api("/api/crm/equipe").then((r) => { if (r.ok) setVendedores(r.dados.vendedores || []); });
  }, []);

  const carregarLista = useCallback(async () => {
    const p = new URLSearchParams();
    if (busca.trim()) p.set("busca", busca.trim());
    if (filtro !== "todas") p.set("filtro", filtro);
    if (vendedorFiltro) p.set("vendedor", vendedorFiltro);
    const r = await api(`/api/crm/conversas?${p.toString()}`);
    setCarregou(true);
    if (!r.ok) { setErroLista(r.erro); return; }
    setErroLista(null);
    setContatos(r.dados.contatos || []);
    setTotais({ aguardando: r.dados.totais?.aguardando || 0, naoLidas: r.dados.totais?.naoLidas || 0 });
  }, [busca, filtro, vendedorFiltro]);

  useEffect(() => {
    const t = setTimeout(() => void carregarLista(), busca ? 300 : 0);
    return () => clearTimeout(t);
  }, [carregarLista, busca]);

  useEffect(() => {
    const i = setInterval(() => { if (document.visibilityState === "visible") void carregarLista(); }, 6000);
    return () => clearInterval(i);
  }, [carregarLista]);

  const carregarDetalhe = useCallback(async (id: string) => {
    const r = await api(`/api/crm/contatos/${id}`);
    if (abertaRef.current !== id) return;
    if (!r.ok) { setDetalhe(null); setMensagens([]); setErroEnvio(r.erro); return; }
    setDetalhe({ contato: r.dados.contato, loja: r.dados.loja, reunioes: r.dados.reunioes, eventos: r.dados.eventos });
    setMensagens(r.dados.mensagens || []);
    setContatos((lista) => lista.map((c) => (c.id === id ? { ...c, naoLidas: 0 } : c)));
  }, []);

  useEffect(() => {
    abertaRef.current = selecionado;
    // Troca de conversa limpa a tela na hora: nada da anterior fica à mostra
    // (nem habilita o envio) enquanto a nova carrega.
    setDetalhe(null);
    setMensagens([]);
    if (!selecionado) return;
    colarNoFim.current = true;
    setErroEnvio(null);
    void carregarDetalhe(selecionado);
  }, [selecionado, carregarDetalhe]);

  // A conversa aberta pergunta só pelo que é novo.
  useEffect(() => {
    if (!selecionado || !detalhe || detalhe.contato.id !== selecionado) return;
    const i = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const id = selecionado;
      const ultima = mensagens[mensagens.length - 1];
      const desde = ultima?.criadoEm || new Date(0).toISOString();
      const r = await api(`/api/crm/contatos/${id}?desde=${encodeURIComponent(desde)}`);
      if (!r.ok || abertaRef.current !== id) return;
      const novas: MensagemDaTela[] = r.dados.mensagens || [];
      if (novas.length > 0) {
        setMensagens((m) => {
          const ids = new Set(m.map((x) => x.id));
          return [...m, ...novas.filter((x) => !ids.has(x.id))];
        });
      }
      setDetalhe((d) => (d && d.contato.id === selecionado ? { ...d, contato: r.dados.contato } : d));
    }, 3000);
    return () => clearInterval(i);
  }, [selecionado, mensagens, detalhe]);

  useEffect(() => {
    if (colarNoFim.current) fimRef.current?.scrollIntoView({ block: "end" });
  }, [mensagens]);

  const aoRolar = () => {
    const el = areaRef.current;
    if (!el) return;
    colarNoFim.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const enviar = async () => {
    const conteudo = texto.trim();
    // Vai para o contato que a TELA mostra — e só quando ele é o selecionado.
    const alvo = detalhe?.contato.id;
    if (!conteudo || !alvo || alvo !== selecionado || enviando) return;
    setEnviando(true);
    setErroEnvio(null);
    const r = await api(`/api/crm/contatos/${alvo}/mensagens`, { method: "POST", json: { texto: conteudo, assinar } });
    setEnviando(false);
    if (abertaRef.current !== alvo) return;
    if (r.dados?.mensagem) {
      colarNoFim.current = true;
      setMensagens((m) => [...m, r.dados.mensagem]);
    }
    if (!r.ok) { setErroEnvio(r.dados?.erro || r.erro); return; }
    setTexto("");
    void carregarDetalhe(alvo);
    void carregarLista();
  };

  const acaoDoRobo = async (acao: string) => {
    const alvo = detalhe?.contato.id;
    if (!alvo || alvo !== selecionado) return;
    const r = await api(`/api/crm/contatos/${alvo}/robo`, { method: "POST", json: { acao } });
    if (abertaRef.current !== alvo) return;
    if (!r.ok) { setErroEnvio(r.erro); return; }
    void carregarDetalhe(alvo);
    void carregarLista();
  };

  const c = detalhe?.contato;
  const nomeDe = (x: { nomeDaLoja: string | null; nome: string | null; telefone: string | null }) => x.nomeDaLoja || x.nome || x.telefone || "Contato";

  const blocos = useMemo(() => {
    const saida: { dia: string; itens: MensagemDaTela[] }[] = [];
    for (const m of mensagens) {
      const dia = diaDaMensagem(m.criadoEm);
      const ultimo = saida[saida.length - 1];
      if (ultimo && ultimo.dia === dia) ultimo.itens.push(m);
      else saida.push({ dia, itens: [m] });
    }
    return saida;
  }, [mensagens]);

  return (
    <div className="crm">
      <EstiloDoCrm />
      {cabecalho}
      <div className={`crm-caixa${selecionado ? " com-conversa" : ""}${fichaAberta ? " ficha-aberta" : ""}`}>
        {/* ── Lista ── */}
        <div className="crm-lista">
          <div className="crm-lista-topo">
            <input className="crm-input" placeholder="Buscar nome, loja ou telefone…" value={busca} onChange={(e) => setBusca(e.target.value)} />
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              <button className={`crm-chip${filtro === "todas" ? " on" : ""}`} onClick={() => setFiltro("todas")}>Todas</button>
              <button className={`crm-chip alerta${filtro === "aguardando" ? " on" : ""}`} onClick={() => setFiltro("aguardando")}>🙋 Pediram pessoa{totais.aguardando ? ` (${totais.aguardando})` : ""}</button>
              <button className={`crm-chip${filtro === "naoLidas" ? " on" : ""}`} onClick={() => setFiltro("naoLidas")}>Não lidas{totais.naoLidas ? ` (${totais.naoLidas})` : ""}</button>
              {modo === "ADMIN" && <button className={`crm-chip${filtro === "semVendedor" ? " on" : ""}`} onClick={() => setFiltro("semVendedor")}>Sem vendedor</button>}
            </div>
            {modo === "ADMIN" && vendedores.length > 0 && (
              <select className="crm-select" value={vendedorFiltro} onChange={(e) => setVendedorFiltro(e.target.value)}>
                <option value="">Todos os vendedores</option>
                {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
              </select>
            )}
          </div>
          <div className="crm-lista-itens">
            {erroLista && <div className="crm-erro" style={{ margin: 10 }}>{erroLista}</div>}
            {carregou && !erroLista && contatos.length === 0 && (
              <div className="crm-vazio">
                <div style={{ fontSize: "1.6rem" }}>💬</div>
                {busca || filtro !== "todas" ? "Nenhuma conversa com esse filtro." : modo === "ADMIN" ? "As conversas do número do FireHub aparecem aqui assim que ele estiver conectado." : "Quando o admin passar contatos para você, as conversas aparecem aqui."}
              </div>
            )}
            {contatos.map((x) => (
              <div key={x.id} className={`crm-item${x.id === selecionado ? " ativo" : ""}`} onClick={() => { setSelecionado(x.id); setFichaAberta(false); }}>
                <Iniciais texto={nomeDe(x)} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
                    <span className="crm-item-nome">{nomeDe(x)}</span>
                    <span className="crm-sub" style={{ flexShrink: 0, fontSize: "0.68rem" }}>{quandoCurto(x.ultimaMensagemEm || x.criadoEm)}</span>
                  </div>
                  <div className="crm-item-previa">
                    {x.ultimaMensagemDe && x.ultimaMensagemDe !== "CLIENTE" && x.ultimaMensagemDe !== "VENDEDOR" ? `${COR_DO_AUTOR[x.ultimaMensagemDe]?.rotulo.replace(/^\S+ /, "") || "Você"}: ` : ""}
                    {x.ultimaMensagemTexto ? comNegrito(x.ultimaMensagemTexto) : x.telefone ? x.telefone : "sem mensagens"}
                  </div>
                  <div style={{ display: "flex", gap: 4, marginTop: 5, flexWrap: "wrap", alignItems: "center" }}>
                    <SeloDaEtapa etapa={x.etapa} pequeno />
                    {x.ehLojista && <span className="crm-selo" style={{ background: "#F1F5F9", color: "#334155", fontSize: "0.62rem", padding: "2px 6px" }}>🏪 loja</span>}
                    {x.aguardandoHumano && <span className="crm-selo" style={{ background: "#FEE2E2", color: "#B91C1C", fontSize: "0.62rem", padding: "2px 6px" }}>🙋 pessoa</span>}
                    {(x.roboPausadoAte || x.roboDesligado) && !x.aguardandoHumano && <span title="Robô pausado nesta conversa" style={{ fontSize: "0.7rem" }}>⏸</span>}
                    {modo === "ADMIN" && x.vendedorNome && <span className="crm-sub" style={{ fontSize: "0.66rem" }}>· {x.vendedorNome.split(/\s+/)[0]}</span>}
                    <span style={{ flex: 1 }} />
                    {x.naoLidas > 0 && <span className="crm-bolinha">{x.naoLidas}</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Conversa ── */}
        <div className="crm-conversa">
          {!c ? (
            <div className="crm-vazio"><div style={{ fontSize: "1.8rem" }}>👈</div>Escolha uma conversa.</div>
          ) : (
            <>
              <div className="crm-conversa-topo">
                <button className="crm-btn crm-btn-sm crm-voltar" onClick={() => setSelecionado(null)}>←</button>
                <Iniciais texto={nomeDe(c)} tamanho={34} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontWeight: 800, fontSize: "0.92rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nomeDe(c)}</div>
                  <div className="crm-sub">{c.telefone || "sem telefone"}{c.vendedorNome ? ` · ${c.vendedorNome}` : ""}</div>
                </div>
                <SeloDaEtapa etapa={c.etapa} />
                {c.roboDesligado ? (
                  <span className="crm-selo" style={{ background: "#F1F5F9", color: "#475569" }}>Robô desligado aqui</span>
                ) : c.roboPausadoAte || c.aguardandoHumano ? (
                  <button className="crm-btn crm-btn-sm" onClick={() => acaoDoRobo("devolver")} title="O robô volta a responder esta conversa">🤖 Devolver ao robô</button>
                ) : (
                  <button className="crm-btn crm-btn-sm" onClick={() => acaoDoRobo("pausar")} title="O robô para de responder esta conversa até alguém devolver">⏸ Pausar robô</button>
                )}
                <button className="crm-btn crm-btn-sm" onClick={() => setFichaAberta((v) => !v)}>Ficha</button>
              </div>
              {c.aguardandoHumano && (
                <div className="crm-aviso" style={{ margin: "8px 12px 0", display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ flex: 1 }}>🙋 Pediu uma pessoa {c.aguardandoHumanoDesde ? `(${dataHora(c.aguardandoHumanoDesde)})` : ""}. O robô está quieto até alguém responder.</span>
                  <button className="crm-btn crm-btn-sm" onClick={() => acaoDoRobo("resolvido")}>✓ Já atendi</button>
                </div>
              )}
              <div className="crm-mensagens" ref={areaRef} onScroll={aoRolar}>
                {mensagens.length === 0 && <div className="crm-vazio">Nenhuma mensagem ainda. Escreva abaixo para começar a conversa.</div>}
                {blocos.map((b) => (
                  <React.Fragment key={b.dia}>
                    <div className="crm-dia">{b.dia}</div>
                    {b.itens.map((m) => {
                      const cor = m.direcao === "SAIDA" ? COR_DO_AUTOR[m.autor] || COR_DO_AUTOR.ADMIN : null;
                      const rotulo = m.direcao === "SAIDA"
                        ? m.autor === "VENDEDOR" || m.autor === "ADMIN" ? m.autorNome || cor!.rotulo : cor!.rotulo
                        : null;
                      return (
                        <div key={m.id} className={`crm-balao ${m.direcao === "ENTRADA" ? "entrada" : "saida"}`}
                          style={cor ? { background: cor.fundo, color: cor.texto, border: m.status === "FALHOU" ? "1.5px solid #EF4444" : undefined } : undefined}>
                          {rotulo && <div className="quem">{rotulo}</div>}
                          {comNegrito(m.texto)}
                          <div className="hora">
                            {m.status === "FALHOU" && <b style={{ color: "#B91C1C", marginRight: 6 }}>⚠ não enviada</b>}
                            {horaDe(m.criadoEm)}
                          </div>
                        </div>
                      );
                    })}
                  </React.Fragment>
                ))}
                <div ref={fimRef} />
              </div>
              <div className="crm-compor">
                {erroEnvio && <div className="crm-erro" style={{ marginBottom: 8 }}>{erroEnvio}</div>}
                <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                  <textarea
                    className="crm-textarea"
                    style={{ minHeight: 44, maxHeight: 160 }}
                    rows={2}
                    placeholder={c.podeResponder ? "Escreva a resposta… (Enter envia, Shift+Enter pula linha)" : "Este contato não tem WhatsApp."}
                    disabled={!c.podeResponder}
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
                  />
                  <button className="crm-btn crm-btn-primary" style={{ height: 44 }} disabled={enviando || !texto.trim() || !c.podeResponder} onClick={enviar}>
                    {enviando ? "…" : "Enviar"}
                  </button>
                </div>
                <div className="crm-sub" style={{ marginTop: 6, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <span>Sai pelo WhatsApp do FireHub. Responder pausa o robô nesta conversa por 2 h.</span>
                  {modo === "VENDEDOR" && (
                    <label style={{ display: "inline-flex", gap: 5, alignItems: "center", cursor: "pointer" }}>
                      <input type="checkbox" checked={assinar} onChange={(e) => setAssinar(e.target.checked)} /> assinar com meu nome
                    </label>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* ── Ficha ── */}
        <div className="crm-ficha">
          {detalhe ? (
            <FichaDoContato
              modo={modo}
              detalhe={detalhe}
              vendedores={vendedores}
              aoAtualizar={() => { if (selecionado) void carregarDetalhe(selecionado); void carregarLista(); }}
              aoFechar={fichaAberta ? () => setFichaAberta(false) : undefined}
            />
          ) : (
            <div className="crm-vazio">A ficha do contato aparece aqui.</div>
          )}
        </div>
      </div>
    </div>
  );
}
