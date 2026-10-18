"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock, Crown, Info, Lightbulb, Radio, Send, ShoppingBag, Sparkles, Target, Wand2, X } from "lucide-react";
import { avaliarTexto } from "@/lib/app-da-loja/mensagem";
import { Funil } from "./graficos";
import type { Aviso } from "./MeuAplicativoClient";
import { dataHora, inteiro, pct, reais, reaisCurto, type Dados, type Envio, type TipoDeSegmento } from "./tipos";

const SELO_DO_ENVIO: Record<Envio["status"], { texto: string; cor: string; fundo: string }> = {
  AGENDADO: { texto: "Agendada", cor: "#1D4ED8", fundo: "#DBEAFE" },
  ENVIANDO: { texto: "Enviando", cor: "#B45309", fundo: "#FEF3C7" },
  ENVIADO: { texto: "Enviada", cor: "#047857", fundo: "#D1FAE5" },
  CANCELADO: { texto: "Cancelada", cor: "#475569", fundo: "#F1F5F9" },
  FALHOU: { texto: "Não saiu", cor: "#B91C1C", fundo: "#FEE2E2" },
};

const local = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
/** A próxima vez que o relógio marca `hora`:00 (hoje, ou amanhã se já passou). */
function proximaHora(hora: number): Date {
  const d = new Date();
  d.setHours(hora, 0, 0, 0);
  if (d.getTime() < Date.now() + 5 * 60_000) d.setDate(d.getDate() + 1);
  return d;
}

export default function AbaNotificacoes({ dados, avisar, recarregar }: { dados: Dados; avisar: (a: Aviso) => void; recarregar: () => Promise<void> }) {
  const p = dados.painel;
  const N = p.notificacoes;
  const { regras } = dados;
  const [objetivo, setObjetivo] = useState<string | null>(null);
  const [titulo, setTitulo] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [segmento, setSegmento] = useState<TipoDeSegmento>("todos");
  const [valorDoSegmento, setValorDoSegmento] = useState("");
  const [link, setLink] = useState<"cardapio" | "produto" | "nenhum">("cardapio");
  const [produtoId, setProdutoId] = useState("");
  const [busca, setBusca] = useState("");
  const [quando, setQuando] = useState<"agora" | "melhor" | "agendar">("agora");
  const [horario, setHorario] = useState(() => local(proximaHora(p.horario?.enviar ?? 18)));
  const [confirmar, setConfirmar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [todas, setTodas] = useState(false);
  const [ia, setIa] = useState<{ carregando: boolean; variacoes: { titulo: string; mensagem: string }[]; erro?: string } | null>(null);

  const produto = dados.produtos.find((x) => x.id === produtoId) || null;
  const filtrados = useMemo(() => {
    const b = busca.trim().toLowerCase();
    return (b ? dados.produtos.filter((x) => x.nome.toLowerCase().includes(b)) : dados.produtos).slice(0, 60);
  }, [busca, dados.produtos]);
  const categorias = useMemo(
    () => [...new Set([...Object.keys(N.alcanceCategorias), ...dados.produtos.map((x) => x.categoria)])].filter(Boolean).sort(),
    [N.alcanceCategorias, dados.produtos],
  );
  const defSeg = regras.segmentos.find((s) => s.tipo === segmento)!;
  const alcance =
    segmento === "produto" ? N.alcanceProdutos[valorDoSegmento] || 0
    : segmento === "categoria" ? N.alcanceCategorias[valorDoSegmento] || 0
    : N.segmentos[segmento] || 0;

  const quandoEnvia = quando === "agora" ? new Date() : quando === "melhor" ? proximaHora(p.horario?.enviar ?? 18) : new Date(horario);
  const enviosNoDia = N.quantosHoje;
  const avisos = avaliarTexto({ titulo, mensagem }, { hora: quandoEnvia.getHours(), enviosNoDia, titulosRecentes: N.titulosRecentes });
  const atencoes = avisos.filter((a) => a.nivel === "atencao");

  const tamTitulo = [...titulo].length, tamMensagem = [...mensagem].length;
  const problema =
    !titulo.trim() ? "Escreva o título." :
    !mensagem.trim() ? "Escreva a mensagem." :
    tamTitulo > regras.tituloMax ? "Título grande demais." :
    tamMensagem > regras.mensagemMax ? "Mensagem grande demais." :
    defSeg.comValor && !valorDoSegmento ? (defSeg.comValor === "produto" ? "Escolha o produto do grupo." : "Escolha a categoria do grupo.") :
    link === "produto" && !produto ? "Escolha o produto do link." :
    quando === "agendar" && !horario ? "Escolha o horário." :
    quando === "agora" && alcance === 0 ? "Ninguém nesse grupo pode receber agora." :
    null;

  const usarSugestao = (id: string) => {
    setObjetivo(id);
    const s = N.sugestoes.find((x) => x.objetivo === id);
    if (!s) return;
    setTitulo(s.titulo);
    setMensagem(s.mensagem);
    setSegmento(s.segmento);
    setValorDoSegmento("");
    if (s.produtoId && dados.produtos.some((x) => x.id === s.produtoId)) { setLink("produto"); setProdutoId(s.produtoId); }
    else setLink("cardapio");
    setIa(null);
  };

  const escreverComIa = async () => {
    setIa({ carregando: true, variacoes: [] });
    try {
      const r = await fetch("/api/store/meu-aplicativo/ia", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objetivo: objetivo || "promocaoDoDia", produtoId: link === "produto" ? produtoId : "", segmento, rascunho: mensagem }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "A IA não respondeu.");
      setIa({ carregando: false, variacoes: j.variacoes || [] });
    } catch (e: any) {
      setIa({ carregando: false, variacoes: [], erro: e.message });
    }
  };

  const enviar = async () => {
    setEnviando(true);
    try {
      const r = await fetch("/api/store/meu-aplicativo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titulo, mensagem,
          segmento: { tipo: segmento, valor: defSeg.comValor ? valorDoSegmento : null },
          comLink: link !== "nenhum",
          produtoId: link === "produto" ? produtoId : "",
          agendarPara: quando === "agora" ? undefined : quandoEnvia.toISOString(),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Não consegui enviar.");
      const e: Envio = j.envio;
      if (e?.status === "AGENDADO") avisar({ tipo: "ok", titulo: "Notificação agendada", detalhe: `Sai em ${dataHora(e.agendadoPara)}. Dá para cancelar até lá.` });
      else if (e?.status === "ENVIADO") avisar({ tipo: "ok", titulo: "Notificação enviada", detalhe: `${inteiro(e.aceitos)} de ${inteiro(e.alvo)} celulares. Aberturas e pedidos aparecem no histórico nas próximas horas.` });
      else avisar({ tipo: "atencao", titulo: "A notificação não saiu", detalhe: e?.motivo || "Tente de novo em alguns minutos." });
      setTitulo(""); setMensagem(""); setObjetivo(null); setIa(null); setConfirmar(false);
      await recarregar();
    } catch (err: any) {
      avisar({ tipo: "erro", titulo: "Não enviou", detalhe: err.message });
      setConfirmar(false);
    } finally {
      setEnviando(false);
    }
  };

  const cancelar = async (id: string) => {
    const r = await fetch(`/api/store/meu-aplicativo?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) avisar({ tipo: "erro", titulo: "Não cancelou", detalhe: j.error });
    else avisar({ tipo: "ok", titulo: "Agendamento cancelado" });
    await recarregar();
  };

  const r30 = N.resumo30;
  const melhores = new Map(N.melhores.map((id, i) => [id, i + 1]));

  return (
    <div className="ma-pilha">
      {/* RESULTADO DOS ÚLTIMOS 30 DIAS */}
      <div className="ma-cartao">
        <h2><Target size={18} /> O resultado das suas notificações (30 dias)</h2>
        <p className="ma-cartao-sub">Pedido atribuído = feito pelo app, num celular que recebeu a notificação, até 24 h depois. Mostra o que veio depois dela, não prova que ela causou.</p>
        {r30.envios ? (
          <div className="ma-grade-2" style={{ alignItems: "center" }}>
            <Funil etapas={[
              { rotulo: "Entregues", valor: r30.entregues },
              { rotulo: "Abertas", valor: r30.abertos, dica: "O cliente tocou na notificação" },
              { rotulo: "Pedidos", valor: r30.pedidos, dica: "Pedido pelo app em até 24 h" },
            ]} />
            <div className="ma-envio-numeros" style={{ marginTop: 0 }}>
              <div className="ma-envio-num bom"><span>Vendido depois</span><b>{reais(r30.faturamento)}</b></div>
              <div className="ma-envio-num"><span>Envios</span><b>{inteiro(r30.envios)}</b></div>
              <div className={`ma-envio-num${r30.entregues && r30.desligaram / r30.entregues > 0.02 ? " ruim" : ""}`}><span>Desligaram</span><b>{inteiro(r30.desligaram)}</b><small>{r30.entregues ? pct(r30.desligaram / r30.entregues, 1) : ""}</small></div>
              <div className="ma-envio-num"><span>Custaria no WhatsApp</span><b>{reaisCurto(r30.entregues * N.precoWhatsApp)}</b><small className="bloco">no app: R$ 0,00</small></div>
            </div>
          </div>
        ) : (
          <div className="ma-vazio">
            <div className="ma-vazio-icone"><Send size={20} /></div>
            <b>Sua primeira notificação está a dois cliques</b>
            Escolha um objetivo abaixo: a gente monta o texto com os dados da sua loja e indica para quem e quando mandar.
          </div>
        )}
      </div>

      {/* COMPOR */}
      <div className="ma-compor">
        <div className="ma-cartao">
          <h2><Send size={18} /> Nova notificação</h2>
          <p className="ma-cartao-sub">Chega no celular de quem tem o app e aceitou promoções. De graça, sem WhatsApp.</p>

          <div className="ma-passo"><em>1</em> O que você quer?</div>
          <div className="ma-chips">
            {regras.objetivos.map((o) => (
              <button key={o.id} className={`ma-chip${objetivo === o.id ? " marcado" : ""}`} onClick={() => usarSugestao(o.id)}>{o.emoji} {o.rotulo}</button>
            ))}
          </div>
          {objetivo && (
            <div className="ma-check" style={{ marginTop: 10 }}>
              <Lightbulb size={15} color="#CA8A04" /> <span>{N.sugestoes.find((s) => s.objetivo === objetivo)?.porque}</span>
            </div>
          )}

          <div className="ma-passo"><em>2</em> Para quem</div>
          <div className="ma-segmentos" role="radiogroup" aria-label="Para quem">
            {regras.segmentos.map((s) => {
              const n = s.comValor ? null : N.segmentos[s.tipo] ?? 0;
              return (
                <button key={s.tipo} role="radio" aria-checked={segmento === s.tipo} className={`ma-segmento${segmento === s.tipo ? " marcado" : ""}`}
                  onClick={() => { setSegmento(s.tipo); setValorDoSegmento(""); }} title={s.explica}>
                  <b>{s.rotulo}</b>
                  {n != null ? <strong>{inteiro(n)}</strong> : <strong style={{ fontSize: ".85rem", color: "#64748B" }}>escolher…</strong>}
                  <span>{s.explica}</span>
                </button>
              );
            })}
          </div>
          {defSeg.comValor === "produto" && (
            <select className="ma-campo" style={{ marginTop: 8 }} value={valorDoSegmento} onChange={(e) => setValorDoSegmento(e.target.value)} aria-label="Produto do grupo">
              <option value="">Quem pediu qual produto?</option>
              {dados.produtos.filter((x) => N.alcanceProdutos[x.id]).sort((a, b) => (N.alcanceProdutos[b.id] || 0) - (N.alcanceProdutos[a.id] || 0)).map((x) => (
                <option key={x.id} value={x.id}>{x.nome} — {inteiro(N.alcanceProdutos[x.id] || 0)} clientes</option>
              ))}
            </select>
          )}
          {defSeg.comValor === "categoria" && (
            <select className="ma-campo" style={{ marginTop: 8 }} value={valorDoSegmento} onChange={(e) => setValorDoSegmento(e.target.value)} aria-label="Categoria do grupo">
              <option value="">Quem pediu de qual categoria?</option>
              {categorias.map((c) => <option key={c} value={c}>{c} — {inteiro(N.alcanceCategorias[c] || 0)} clientes</option>)}
            </select>
          )}
          <div className="ma-check" style={{ marginTop: 8 }}>
            <Info size={15} /> <span><b>{defSeg.rotulo}:</b> {defSeg.explica} Vai para <b>{inteiro(alcance)}</b> {alcance === 1 ? "celular" : "celulares"}. Só entra quem aceitou receber promoções no app.</span>
          </div>

          <div className="ma-passo"><em>3</em> A mensagem</div>
          <label className="ma-rotulo" htmlFor="ma-titulo">Título <small className={tamTitulo > 40 ? "passou" : ""}>{tamTitulo}/40 ideal · máx. {regras.tituloMax}</small></label>
          <input id="ma-titulo" className="ma-campo" value={titulo} maxLength={regras.tituloMax + 10} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: 🍕 Pizza G por R$ 49,90 hoje" />
          <label className="ma-rotulo" htmlFor="ma-msg">Mensagem <small>{tamMensagem}/{regras.mensagemMax}</small></label>
          <textarea id="ma-msg" className="ma-campo" style={{ minHeight: 82, resize: "vertical" }} value={mensagem} maxLength={regras.mensagemMax + 20} onChange={(e) => setMensagem(e.target.value)} placeholder="Ex.: Só até as 23h. Toque e peça pelo app." />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <button className="ma-botao-leve" onClick={escreverComIa} disabled={ia?.carregando}><Wand2 size={14} /> {ia?.carregando ? "Escrevendo…" : "Escrever com IA (3 opções)"}</button>
          </div>
          {ia && !ia.carregando && (
            <div className="ma-ia">
              {ia.erro ? <span style={{ fontSize: ".82rem", color: "#B91C1C" }}>{ia.erro}</span> : (
                <>
                  <span style={{ fontSize: ".76rem", fontWeight: 800, color: "#6D28D9" }}>Toque numa opção para usar (dá para editar depois):</span>
                  {ia.variacoes.map((v, i) => (
                    <button key={i} className="ma-ia-variacao" onClick={() => { setTitulo(v.titulo); setMensagem(v.mensagem); }}>
                      <b>{v.titulo}</b><span>{v.mensagem}</span>
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
          {avisos.length > 0 && (
            <div className="ma-checklist" aria-live="polite">
              {avisos.map((a) => (
                <div key={a.texto} className={`ma-check ${a.nivel}`}>
                  {a.nivel === "bom" ? <CheckCircle2 size={15} /> : a.nivel === "atencao" ? <AlertTriangle size={15} /> : <Lightbulb size={15} />}
                  <span>{a.texto}</span>
                </div>
              ))}
            </div>
          )}

          <div className="ma-passo"><em>4</em> Ao tocar, abre</div>
          <div className="ma-chips">
            {([["cardapio", "O cardápio"], ["produto", "Um produto"], ["nenhum", "Só o app"]] as const).map(([v, t]) => (
              <button key={v} className={`ma-chip${link === v ? " marcado" : ""}`} onClick={() => setLink(v)}>{t}</button>
            ))}
          </div>
          {link === "produto" && (
            <div style={{ marginTop: 8 }}>
              <input className="ma-campo" value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar produto…" aria-label="Buscar produto" />
              <div className="ma-produtos" role="radiogroup" aria-label="Produto">
                {filtrados.length === 0 && <div style={{ padding: 10, fontSize: 13, color: "#94A3B8" }}>Nenhum produto com esse nome.</div>}
                {filtrados.map((x) => (
                  <button key={x.id} type="button" role="radio" aria-checked={produtoId === x.id} className={`ma-produto${produtoId === x.id ? " marcado" : ""}`} onClick={() => setProdutoId(x.id)}>
                    {x.foto
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={x.foto} alt="" className="ma-produto-foto" />
                      : <span className="ma-produto-foto ma-produto-sem-foto"><ShoppingBag size={16} /></span>}
                    <span className="ma-produto-nome">{x.nome}</span>
                    <span className="ma-produto-preco">{reais(x.preco)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="ma-passo"><em>5</em> Quando</div>
          <div className="ma-chips">
            <button className={`ma-chip${quando === "agora" ? " marcado" : ""}`} onClick={() => setQuando("agora")}>Agora</button>
            {p.horario && (
              <button className={`ma-chip${quando === "melhor" ? " marcado" : ""}`} onClick={() => setQuando("melhor")}>
                <Sparkles size={13} /> Melhor horário: {proximaHora(p.horario.enviar).getDate() === new Date().getDate() ? "hoje" : "amanhã"} às {p.horario.enviar}h
              </button>
            )}
            <button className={`ma-chip${quando === "agendar" ? " marcado" : ""}`} onClick={() => setQuando("agendar")}><CalendarClock size={13} /> Escolher</button>
          </div>
          {quando === "agendar" && <input type="datetime-local" className="ma-campo" style={{ marginTop: 8 }} value={horario} onChange={(e) => setHorario(e.target.value)} aria-label="Horário do envio" />}
          {quando === "melhor" && p.horario && (
            <div className="ma-check" style={{ marginTop: 8 }}><Clock size={15} /> <span>Seus clientes mais pedem pelo app às {p.horario.pico}h. Uma hora antes é quando decidem o que comer.</span></div>
          )}

          <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 18, flexWrap: "wrap" }}>
            <button className="ma-botao marca" disabled={!!problema} onClick={() => setConfirmar(true)}>
              {quando === "agora" ? <Send size={16} /> : <CalendarClock size={16} />} {quando === "agora" ? "Revisar e enviar" : "Revisar e agendar"}
            </button>
            {problema && <span style={{ fontSize: 12.5, color: "#64748B" }}>{problema}</span>}
          </div>
        </div>

        <div className="ma-previa">
          <div className="ma-cartao" style={{ display: "grid", justifyItems: "center", gap: 10 }}>
            <div style={{ fontSize: 12, fontWeight: 900, color: "#64748B", textTransform: "uppercase", letterSpacing: ".05em" }}>Como o cliente vê</div>
            <Celular nomeDoApp={dados.loja.nome} logo={dados.loja.logo} titulo={titulo} mensagem={mensagem} />
          </div>
          <div className="so-computador"><OQueFunciona N={N} /></div>
        </div>
      </div>

      <div className="so-celular"><OQueFunciona N={N} /></div>

      {/* HISTÓRICO */}
      <div className="ma-cartao">
        <h2><Clock size={18} /> Enviadas e resultado</h2>
        <p className="ma-cartao-sub">
          Entregues = confirmação do Google/Apple · Abertas = tocaram na notificação · Pedidos = pelo app, em até 24 h, num celular que recebeu ·
          Desligaram = desligaram as promoções ou apagaram o app em até 48 h.
        </p>
        {N.envios.length === 0 ? (
          <div className="ma-vazio"><div className="ma-vazio-icone"><Radio size={20} /></div><b>Nenhuma notificação ainda</b>O resultado de cada envio aparece aqui.</div>
        ) : (
          <div className="ma-envios">
            {(todas ? N.envios : N.envios.slice(0, 6)).map((e) => {
              const selo = SELO_DO_ENVIO[e.status];
              const top = melhores.get(e.id);
              const entregues = e.entregues || e.aceitos;
              const recente = e.enviadoEm && Date.now() - new Date(e.enviadoEm).getTime() < 24 * 3600_000;
              return (
                <div key={e.id} className={`ma-envio${top ? " top" : ""}`}>
                  <div className="ma-envio-cabeca">
                    <span className="ma-selo" style={{ color: selo.cor, background: selo.fundo }}>{selo.texto}</span>
                    {top && <span className="ma-selo" style={{ color: "#713F12", background: "#FEF08A" }}><Crown size={11} style={{ verticalAlign: -1 }} /> {top}º melhor</span>}
                    <span>{e.status === "AGENDADO" ? `sai em ${dataHora(e.agendadoPara)}` : dataHora(e.enviadoEm || e.agendadoPara || e.criadoEm)}</span>
                    <span>· {e.segmentoRotulo || "Todos"}</span>
                    {(e.produtoNome || e.caminho) && <span>· abre {e.produtoNome || "o cardápio"}</span>}
                    {e.status === "AGENDADO" && <button className="ma-botao-leve" style={{ marginLeft: "auto" }} onClick={() => cancelar(e.id)}><X size={13} /> Cancelar</button>}
                  </div>
                  <div className="ma-envio-titulo">{e.titulo}</div>
                  <div className="ma-envio-texto">{e.mensagem}</div>
                  {(e.status === "ENVIADO" || e.status === "FALHOU") && (
                    <>
                      <div className="ma-envio-numeros">
                        <div className="ma-envio-num"><span>No grupo</span><b>{inteiro(e.alvo)}</b></div>
                        <div className="ma-envio-num" title={e.entregues ? "Confirmação do Google/Apple" : "Aceitas pelo serviço de notificações; a confirmação de entrega chega em ~15 min"}><span>{e.entregues ? "Entregues" : "Enviadas"}</span><b>{inteiro(entregues)}</b></div>
                        <div className="ma-envio-num"><span>Abertas</span><b>{inteiro(e.abertos)}</b><small>{entregues ? pct(e.abertos / entregues, 1) : ""}</small></div>
                        <div className={`ma-envio-num${e.pedidos ? " bom" : ""}`}><span>Pedidos</span><b>{inteiro(e.pedidos)}</b><small>{entregues && e.pedidos ? pct(e.pedidos / entregues, 1) : ""}</small></div>
                        <div className={`ma-envio-num${e.faturamento ? " bom" : ""}`}><span>Vendido</span><b>{reaisCurto(e.faturamento)}</b></div>
                        <div className={`ma-envio-num${entregues && e.desligaram / entregues > 0.02 ? " ruim" : ""}`}><span>Desligaram</span><b>{inteiro(e.desligaram)}</b><small>{entregues ? pct(e.desligaram / entregues, 1) : ""}</small></div>
                      </div>
                      <div className="ma-envio-rodape">
                        <span>{recente ? "Resultado parcial: a conta fecha 24 h depois do envio (desligamentos, 48 h)." : `Pelo WhatsApp oficial custaria ${reais(e.custoNoWhatsApp)}; no app, R$ 0.`}</span>
                        {e.errosNoEnvio + e.errosNaEntrega > 0 && <span>{inteiro(e.errosNoEnvio + e.errosNaEntrega)} não chegaram (celular desligado ou app apagado)</span>}
                      </div>
                    </>
                  )}
                  {e.motivo && e.status !== "ENVIADO" && <div style={{ fontSize: 12.5, color: "#B45309", marginTop: 6 }}>{e.motivo}</div>}
                </div>
              );
            })}
            {N.envios.length > 6 && (
              <button className="ma-botao-leve" style={{ justifySelf: "center" }} onClick={() => setTodas((t) => !t)}>
                {todas ? "Mostrar só as últimas" : `Mostrar todas (${N.envios.length})`}
              </button>
            )}
          </div>
        )}
      </div>

      {confirmar && (
        <div className="ma-fundo" role="dialog" aria-modal="true" aria-labelledby="ma-conf-titulo" onClick={() => !enviando && setConfirmar(false)}>
          <div className="ma-modal" onClick={(e) => e.stopPropagation()}>
            <h3 id="ma-conf-titulo" style={{ margin: "0 0 6px", fontSize: 19, fontWeight: 900 }}>{quando === "agora" ? "Enviar agora?" : "Agendar a notificação?"}</h3>
            <p style={{ margin: "0 0 12px", color: "#475569", fontSize: 14, lineHeight: 1.5 }}>
              {quando === "agora"
                ? <>Vai para <b>{inteiro(alcance)}</b> {alcance === 1 ? "celular" : "celulares"} — <b>{defSeg.rotulo.toLowerCase()}</b>{defSeg.comValor ? ` (${defSeg.comValor === "produto" ? dados.produtos.find((x) => x.id === valorDoSegmento)?.nome : valorDoSegmento})` : ""}. Depois de enviada, não dá para apagar do celular do cliente.</>
                : <>Sai em <b>{dataHora(quandoEnvia.toISOString())}</b> para <b>{defSeg.rotulo.toLowerCase()}</b> (hoje são {inteiro(alcance)}). Até lá você pode cancelar.</>}
            </p>
            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: 12, marginBottom: 12 }}>
              <div style={{ fontWeight: 800 }}>{titulo}</div>
              <div style={{ color: "#475569", fontSize: 13.5, whiteSpace: "pre-wrap" }}>{mensagem}</div>
              <div style={{ color: "#94A3B8", fontSize: 12, marginTop: 6 }}>Ao tocar: {link === "nenhum" ? "abre o app" : link === "produto" ? `abre ${produto?.nome}` : "abre o cardápio"}</div>
            </div>
            {(atencoes.length > 0 || enviosNoDia + 1 >= regras.avisarAPartirDe) && (
              <div className="ma-nota" style={{ marginBottom: 12 }}>
                <b>Antes de mandar, veja:</b>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {atencoes.map((a) => <li key={a.texto}>{a.texto}</li>)}
                  {enviosNoDia + 1 >= regras.avisarAPartirDe && !atencoes.some((a) => a.texto.startsWith("Você já mandou")) && (
                    <li>Esta será a {enviosNoDia + 1}ª de hoje. Muitos envios fazem o cliente desligar as promoções ou apagar o app.</li>
                  )}
                </ul>
              </div>
            )}
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button className="ma-botao-leve" disabled={enviando} onClick={() => setConfirmar(false)}>Voltar e ajustar</button>
              <button className="ma-botao marca" disabled={enviando} onClick={enviar}>
                <Radio size={16} /> {enviando ? "Enviando…" : quando === "agora" ? "Enviar agora" : "Agendar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OQueFunciona({ N }: { N: Dados["painel"]["notificacoes"] }) {
  return (
          <div className="ma-aprende">
      <h3><Lightbulb size={16} color="#FACC15" /> O que funciona na sua loja</h3>
      {N.aprendizado.aprendendo ? (
        <>
          <div style={{ fontSize: ".8rem" }}>Ainda aprendendo com os seus envios: faltam <b>{N.aprendizado.faltam}</b> com resultado para comparar.</div>
          <div className="ma-barra-aprende"><b style={{ width: `${Math.max(6, ((6 - N.aprendizado.faltam) / 6) * 100)}%` }} /></div>
        </>
      ) : N.aprendizado.achados.length ? (
        <ul>{N.aprendizado.achados.map((a) => <li key={a.texto}>{a.texto}</li>)}</ul>
      ) : (
        <div style={{ fontSize: ".8rem" }}>Seus envios renderam parecido entre si. Siga as regras abaixo e varie o horário para descobrir o melhor.</div>
      )}
      <h3 style={{ marginTop: 12 }}>Regras que valem para todo mundo</h3>
      <ul>
        <li>Título até ~40 letras, com um benefício claro.</li>
        <li>Diga o prazo: “só hoje”, “até as 23h”.</li>
        <li>Um emoji no começo; mais de 2 cansa.</li>
        <li>Uma hora antes do pico; nunca de madrugada.</li>
        <li>1 a 2 por semana. Muitos envios fazem desligar as promoções.</li>
      </ul>
    </div>
  );
}

/** A prévia: a notificação na tela de bloqueio de um celular. */
function Celular({ nomeDoApp, logo, titulo, mensagem }: { nomeDoApp: string; logo: string | null; titulo: string; mensagem: string }) {
  const [semLogo, setSemLogo] = useState(false);
  const agora = new Date();
  const dataTexto = agora.toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  return (
    <div className="ma-celular" aria-label="Prévia da notificação no celular">
      <div className="ma-tela">
        <div className="ma-hora">{agora.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</div>
        <div className="ma-data">{dataTexto.charAt(0).toUpperCase() + dataTexto.slice(1)}</div>
        <div className="ma-notif">
          <div className="ma-notif-topo">
            {logo && !semLogo
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={logo} alt="" className="ma-notif-icone" onError={() => setSemLogo(true)} />
              : <span className="ma-notif-icone ma-notif-icone-vazio" />}
            <span className="ma-notif-app">{nomeDoApp}</span>
            <span className="ma-notif-agora">agora</span>
          </div>
          <div className="ma-notif-titulo">{titulo.trim() || "Título da notificação"}</div>
          <div className="ma-notif-texto">{mensagem.trim() || "A mensagem aparece aqui."}</div>
        </div>
      </div>
    </div>
  );
}
