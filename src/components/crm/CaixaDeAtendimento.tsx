"use client";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, Bot, Check, CheckCheck, Clock, Hand, MessageCircle, PanelRight, Pause, Search, SendHorizontal, Smartphone,
  Store, TriangleAlert, UserRound, X, type LucideIcon,
} from "lucide-react";
import type { ContatoDaLista, MensagemDaTela } from "@/lib/crm/serializar";
import { EstiloDoCrm, Iniciais, SeloDaEtapa, api, horaDe, quandoCurto } from "./comum";
import FichaDoContato, { type DetalheDoContato } from "./FichaDoContato";

type Filtro = "todas" | "aguardando" | "naoLidas" | "semVendedor";

/**
 * Quem escreveu a mensagem que SAIU, e como o balão mostra: a equipe (admin,
 * vendedor, celular) em verde, o robô em lilás, o automático em âmbar
 * (classes em comum.tsx). `previa` é o prefixo na lista de conversas.
 */
const AUTORES: Record<string, { classe: "gente" | "robo" | "aviso"; rotulo: string; previa: string; Icone: LucideIcon }> = {
  ROBO: { classe: "robo", rotulo: "Robô", previa: "Robô", Icone: Bot },
  ADMIN: { classe: "gente", rotulo: "Admin", previa: "Admin", Icone: UserRound },
  VENDEDOR: { classe: "gente", rotulo: "Vendedor", previa: "", Icone: UserRound },
  CELULAR: { classe: "gente", rotulo: "Pelo celular", previa: "Celular", Icone: Smartphone },
  SISTEMA: { classe: "aviso", rotulo: "Automático", previa: "Aviso", Icone: Clock },
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
  const [roboLigado, setRoboLigado] = useState<boolean | null>(null);
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
    setRoboLigado(typeof r.dados.roboLigado === "boolean" ? r.dados.roboLigado : null);
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

  // O robô nesta conversa, numa palavra e numa cor (a pílula da faixa).
  const estadoDoRobo = !c
    ? null
    : roboLigado === false
      ? { tom: "cinza", texto: "Robô desligado (geral)" }
      : c.roboDesligado
        ? { tom: "cinza", texto: "Robô desligado aqui" }
        : c.aguardandoHumano
          ? { tom: "vermelho", texto: "Esperando uma pessoa" }
          : c.roboPausadoAte
            ? { tom: "ambar", texto: `Robô pausado até ${horaDe(c.roboPausadoAte)}` }
            : { tom: "verde", texto: "Robô atende esta conversa" };

  return (
    <div className="crm">
      <EstiloDoCrm />
      {cabecalho}
      <div className={`crm-caixa${selecionado ? " com-conversa" : ""}${fichaAberta ? " ficha-aberta" : ""}`}>
        {/* ── Lista ── */}
        <div className="crm-lista">
          <div className="crm-faixa">
            <div style={{ flex: 1, minWidth: 0 }}>
              <h3>Conversas</h3>
              <div className="crm-sub" style={{ fontSize: "0.72rem" }}>
                {totais.naoLidas ? `${totais.naoLidas} não lida${totais.naoLidas > 1 ? "s" : ""}` : "Tudo lido"}
                {totais.aguardando ? ` · ${totais.aguardando} pedindo pessoa` : ""}
              </div>
            </div>
          </div>
          <div className="crm-lista-topo">
            <div className="crm-busca">
              <Search size={15} strokeWidth={2.2} aria-hidden />
              <input className="crm-input" placeholder="Buscar nome, loja ou telefone" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Buscar conversa" />
            </div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
              <button className={`crm-chip${filtro === "todas" ? " on" : ""}`} onClick={() => setFiltro("todas")}>Todas</button>
              <button className={`crm-chip alerta${filtro === "aguardando" ? " on" : ""}`} onClick={() => setFiltro("aguardando")}>
                <Hand size={13} strokeWidth={2.2} aria-hidden /> Pediram pessoa{totais.aguardando ? ` · ${totais.aguardando}` : ""}
              </button>
              <button className={`crm-chip${filtro === "naoLidas" ? " on" : ""}`} onClick={() => setFiltro("naoLidas")}>Não lidas{totais.naoLidas ? ` · ${totais.naoLidas}` : ""}</button>
              {modo === "ADMIN" && <button className={`crm-chip${filtro === "semVendedor" ? " on" : ""}`} onClick={() => setFiltro("semVendedor")}>Sem vendedor</button>}
            </div>
            {modo === "ADMIN" && vendedores.length > 0 && (
              <select className="crm-select" value={vendedorFiltro} onChange={(e) => setVendedorFiltro(e.target.value)} aria-label="Filtrar por vendedor">
                <option value="">Todos os vendedores</option>
                {vendedores.map((v) => <option key={v.id} value={v.id}>{v.nome}</option>)}
              </select>
            )}
          </div>
          <div className="crm-lista-itens">
            {erroLista && <div className="crm-erro" style={{ margin: 10 }}>{erroLista}</div>}
            {carregou && !erroLista && contatos.length === 0 && (
              <div className="crm-vazio">
                <MessageCircle size={34} strokeWidth={1.6} aria-hidden />
                {busca || filtro !== "todas" ? "Nenhuma conversa com esse filtro." : modo === "ADMIN" ? "As conversas do WhatsApp do FireHub aparecem aqui assim que ele estiver conectado." : "Quando o admin passar contatos para você, as conversas aparecem aqui."}
              </div>
            )}
            {contatos.map((x) => {
              const autor = x.ultimaMensagemDe ? AUTORES[x.ultimaMensagemDe] : null;
              return (
                <div
                  key={x.id}
                  className={`crm-item${x.id === selecionado ? " ativo" : ""}${x.naoLidas > 0 ? " nao-lida" : ""}`}
                  onClick={() => { setSelecionado(x.id); setFichaAberta(false); }}
                >
                  <span className="crm-avatar"><Iniciais texto={nomeDe(x)} tamanho={40} /></span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 6 }}>
                      <span className="crm-item-nome">{nomeDe(x)}</span>
                      <span className="crm-item-hora">{quandoCurto(x.ultimaMensagemEm || x.criadoEm)}</span>
                    </div>
                    <div className="crm-item-previa">
                      {autor?.previa ? `${autor.previa}: ` : ""}
                      {x.ultimaMensagemTexto ? comNegrito(x.ultimaMensagemTexto) : x.telefone ? x.telefone : "sem mensagens"}
                    </div>
                    <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <SeloDaEtapa etapa={x.etapa} pequeno />
                      {x.ehLojista && <span className="crm-marca loja"><Store size={11} strokeWidth={2.4} aria-hidden />loja</span>}
                      {x.aguardandoHumano && <span className="crm-marca pessoa"><Hand size={11} strokeWidth={2.4} aria-hidden />pessoa</span>}
                      {(x.roboPausadoAte || x.roboDesligado) && !x.aguardandoHumano && (
                        <span className="crm-marca pausa" title="Robô pausado nesta conversa"><Pause size={10} strokeWidth={2.6} aria-hidden />robô</span>
                      )}
                      {modo === "ADMIN" && x.vendedorNome && <span className="crm-item-hora">{x.vendedorNome.split(/\s+/)[0]}</span>}
                      <span style={{ flex: 1 }} />
                      {x.naoLidas > 0 && <span className="crm-bolinha" aria-label={`${x.naoLidas} não lidas`}>{x.naoLidas}</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Conversa ── */}
        <div className="crm-conversa">
          {!c ? (
            <div className="crm-vazio">
              <MessageCircle size={40} strokeWidth={1.4} aria-hidden />
              <b>Escolha uma conversa</b>
              <span>As mensagens aparecem aqui, com o que o robô, a equipe e o contato disseram.</span>
            </div>
          ) : (
            <>
              {/* Dois andares: quem é (em cima) e o robô nesta conversa (embaixo). */}
              <div className="crm-faixa crm-faixa-conversa">
                <button className="crm-faixa-btn crm-voltar" onClick={() => setSelecionado(null)} aria-label="Voltar para a lista"><ArrowLeft size={15} aria-hidden /></button>
                <span className="crm-avatar"><Iniciais texto={nomeDe(c)} tamanho={38} /></span>
                <div className="crm-conversa-quem">
                  <b>{nomeDe(c)}</b>
                  <div className="crm-sub">{c.telefone || "sem telefone"}{c.vendedorNome ? ` · ${c.vendedorNome}` : ""}</div>
                </div>
                <span className="crm-so-largo"><SeloDaEtapa etapa={c.etapa} /></span>
                <button className="crm-faixa-btn" onClick={() => setFichaAberta((v) => !v)} title="Ficha do contato" aria-label="Ficha do contato">
                  <PanelRight size={15} aria-hidden /><span className="crm-so-largo">Ficha</span>
                </button>
              </div>
              <div className="crm-subfaixa">
                {estadoDoRobo && <span className={`crm-pilula ${estadoDoRobo.tom}`}><i aria-hidden />{estadoDoRobo.texto}</span>}
                <span style={{ flex: 1 }} />
                {!c.roboDesligado && (c.roboPausadoAte || c.aguardandoHumano ? (
                  <button className="crm-faixa-btn claro" onClick={() => acaoDoRobo("devolver")} title="O robô volta a responder esta conversa">
                    <Bot size={15} aria-hidden /> Devolver ao robô
                  </button>
                ) : (
                  <button className="crm-faixa-btn" onClick={() => acaoDoRobo("pausar")} title="O robô para de responder esta conversa até alguém devolver. Responder também pausa: 2 h pela tela, 10 min pelo celular.">
                    <Pause size={14} aria-hidden /> Pausar robô
                  </button>
                ))}
              </div>
              {c.aguardandoHumano && (
                <div className="crm-alerta">
                  <Hand size={16} strokeWidth={2.2} aria-hidden style={{ flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>Pediu uma pessoa{c.aguardandoHumanoDesde ? ` às ${horaDe(c.aguardandoHumanoDesde)}` : ""}. O robô fica quieto até alguém responder.</span>
                  <button className="crm-btn crm-btn-sm" onClick={() => acaoDoRobo("resolvido")}><Check size={13} aria-hidden /> Já atendi</button>
                </div>
              )}
              <div className="crm-mensagens" ref={areaRef} onScroll={aoRolar}>
                {mensagens.length === 0 && (
                  <div className="crm-vazio"><b>Nenhuma mensagem ainda</b><span>Escreva abaixo para começar a conversa.</span></div>
                )}
                {blocos.map((b) => (
                  <React.Fragment key={b.dia}>
                    <div className="crm-dia">{b.dia}</div>
                    {b.itens.map((m) => {
                      const autor = m.direcao === "SAIDA" ? AUTORES[m.autor] || AUTORES.ADMIN : null;
                      const Icone = autor?.Icone;
                      const rotulo = autor ? (m.autor === "VENDEDOR" || m.autor === "ADMIN" ? m.autorNome || autor.rotulo : autor.rotulo) : null;
                      return (
                        <div key={m.id} className={`crm-balao ${m.direcao === "ENTRADA" ? "entrada" : `saida ${autor!.classe}`}${m.status === "FALHOU" ? " falhou" : ""}`}>
                          {rotulo && <div className="quem">{Icone && <Icone size={12} strokeWidth={2.4} aria-hidden />}{rotulo}</div>}
                          {comNegrito(m.texto)}
                          <div className="hora">
                            {m.status === "FALHOU" && <span className="erro-envio"><TriangleAlert size={11} strokeWidth={2.6} aria-hidden /> não enviada</span>}
                            {horaDe(m.criadoEm)}
                            {m.direcao === "SAIDA" && m.status !== "FALHOU" && <CheckCheck size={13} strokeWidth={2.2} aria-label="enviada" />}
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
                <div className="crm-compor-linha">
                  <textarea
                    className="crm-textarea"
                    rows={1}
                    placeholder={c.podeResponder ? "Escreva a resposta…" : "Este contato não tem WhatsApp."}
                    aria-label="Resposta"
                    disabled={!c.podeResponder}
                    value={texto}
                    onChange={(e) => setTexto(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void enviar(); } }}
                  />
                  <button className="crm-enviar" disabled={enviando || !texto.trim() || !c.podeResponder} onClick={enviar} aria-label="Enviar" title="Enviar (Enter)">
                    <SendHorizontal size={19} strokeWidth={2.2} aria-hidden />
                  </button>
                </div>
                <div className="crm-compor-dica">
                  <span>Enter envia · Shift+Enter pula linha</span>
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
          <div className="crm-faixa">
            <h3 style={{ flex: 1 }}>Ficha do contato</h3>
            {fichaAberta && <button className="crm-faixa-btn" onClick={() => setFichaAberta(false)} aria-label="Fechar a ficha"><X size={15} aria-hidden /></button>}
          </div>
          <div className="crm-ficha-corpo">
            {detalhe ? (
              <FichaDoContato
                modo={modo}
                detalhe={detalhe}
                vendedores={vendedores}
                aoAtualizar={() => { if (selecionado) void carregarDetalhe(selecionado); void carregarLista(); }}
              />
            ) : (
              <div className="crm-vazio"><UserRound size={30} strokeWidth={1.6} aria-hidden />A ficha do contato aparece aqui.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
