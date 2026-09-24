"use client";

import { useEffect, useState } from "react";
import { LOJA_VAZIA, type Loja } from "./loja";
import { LINK_COMPARTILHAR, LINK_FIREHUB, LINK_WHATS, ORDEM_DO_PLANO, PASSOS, type Passo, type PassoId } from "./passos";
import * as M from "./modelos";

/**
 * O kit "a IA indica o seu restaurante": a isca grátis do "comenta IA".
 *
 * Pedido do dono em 24/09/2026: "entregar ouro de graça". A primeira versão
 * ensinava o que fazer; esta FAZ o trabalho — o lojista conta a loja uma vez
 * e sai com a pergunta do teste, a descrição do Google, as respostas de
 * avaliação e a ficha da loja já escritas com o nome dele, para colar.
 *
 * Nada sai do aparelho: o que ele digita e marca fica no localStorage. Se o
 * navegador não deixar gravar, o kit funciona igual e só esquece ao fechar.
 *
 * O que dá trabalho de ler fica fechado: cada passo abre num toque, e a
 * impressão (Salvar em PDF) abre todos — ver o CSS de impressão abaixo.
 */

const LARANJA = "#FF5722";
const LARANJA_LINK = "#C2410C";
const VERDE = "#16A34A";
const CHAVE = "ia-kit-v1";

type ResultadoTeste = "apareci" | "errado" | "nao";

type Estado = {
  loja: Loja;
  feitos: Partial<Record<PassoId, boolean>>;
  teste: ResultadoTeste | null;
  /** Os lugares do passo 5 onde a ficha já foi colada. */
  colados: Record<string, boolean>;
  /** A descrição do Google depois que o lojista mexeu nela; null = a gerada. */
  descricaoEditada: string | null;
};

const INICIAL: Estado = { loja: LOJA_VAZIA, feitos: {}, teste: null, colados: {}, descricaoEditada: null };

const card: React.CSSProperties = {
  background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16,
  padding: "1.1rem 1.15rem", boxShadow: "0 6px 20px rgba(15,23,42,.05)",
};
const secao: React.CSSProperties = { maxWidth: 760, margin: "0 auto", padding: "2rem 1.1rem" };
const textoCinza: React.CSSProperties = { color: "#475569", lineHeight: 1.55, margin: "0 0 12px" };

export default function Kit() {
  const [e, setE] = useState<Estado>(INICIAL);
  const [pronto, setPronto] = useState(false);
  const [abertos, setAbertos] = useState<Partial<Record<PassoId, boolean>>>({ cardapio: true });

  useEffect(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE) || "null");
      if (salvo && typeof salvo === "object") {
        setE({ ...INICIAL, ...salvo, loja: { ...LOJA_VAZIA, ...(salvo.loja || {}) } });
      }
    } catch { /* sem armazenamento: começa vazio */ }
    setPronto(true);
  }, []);

  useEffect(() => {
    if (!pronto) return;
    try { localStorage.setItem(CHAVE, JSON.stringify(e)); } catch { /* segue sem gravar */ }
  }, [e, pronto]);

  // O pixel do Meta já carrega no layout do site. Aqui só dizemos a ele as
  // duas saídas que importam: foi testar o FireHub (Lead) ou chamou o Douglas
  // no WhatsApp (Contact). Sem pixel (bloqueador), segue sem ele.
  useEffect(() => {
    function aoClicar(ev: MouseEvent) {
      const a = (ev.target as HTMLElement | null)?.closest?.("a") as HTMLAnchorElement | null;
      const fbq = (window as unknown as { fbq?: (...args: unknown[]) => void }).fbq;
      if (!a || typeof fbq !== "function") return;
      if (a.href.includes("/cadastro")) fbq("track", "Lead", { content_name: "Kit IA" });
      else if (a.href.startsWith("https://wa.me/55")) fbq("track", "Contact", { content_name: "Kit IA" });
    }
    document.addEventListener("click", aoClicar, true);
    return () => document.removeEventListener("click", aoClicar, true);
  }, []);

  const l = e.loja;
  const mudarLoja = (campo: keyof Loja) => (v: string) => setE((s) => ({ ...s, loja: { ...s.loja, [campo]: v } }));
  // Um passo aberto por vez: no celular, dois passos abertos já são três telas
  // de rolagem. Ao abrir, o cartão vem para o topo, porque o que fechou acima
  // dele encolhe a página e o empurraria para fora da tela.
  const irPara = (id: PassoId) => {
    setAbertos({ [id]: true });
    requestAnimationFrame(() => document.getElementById(`passo-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const alternar = (id: PassoId) => (abertos[id] ? setAbertos({}) : irPara(id));
  // Marcou que já faz: o passo recolhe, e o próximo fica logo abaixo.
  const marcar = (id: PassoId, v: boolean) => {
    setE((s) => ({ ...s, feitos: { ...s.feitos, [id]: v } }));
    if (v) setAbertos({});
  };

  const nota = PASSOS.reduce((t, p) => t + (e.feitos[p.id] ? p.peso : 0), 0);
  const feitos = PASSOS.filter((p) => e.feitos[p.id]).length;
  const nivel =
    nota >= 70 ? { texto: "Pronta para ser indicada", cor: VERDE }
    : nota >= 40 ? { texto: "A IA te enxerga pela metade", cor: "#D97706" }
    : { texto: "A IA quase não te enxerga", cor: "#DC2626" };
  const faltam = ORDEM_DO_PLANO.filter((id) => !e.feitos[id]).map((id) => PASSOS.find((p) => p.id === id) as Passo);

  const pergunta = M.perguntaDoTeste(l);
  const podeTestar = !!(l.comida.trim() && l.cidade.trim());
  const links = M.linksDoTeste(pergunta);

  const descricao = e.descricaoEditada ?? M.descricaoGoogle(l);

  function ferramentas(id: PassoId) {
    switch (id) {
      case "cardapio":
        return (
          <>
            <div style={{ display: "grid", gap: 8, margin: "4px 0 14px" }}>
              <div style={{ background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ fontSize: ".75rem", fontWeight: 900, color: "#B91C1C", letterSpacing: ".05em" }}>ANTES</div>
                <div style={{ fontWeight: 700 }}>Esfirra de carne</div>
              </div>
              <div style={{ background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 12, padding: "10px 12px" }}>
                <div style={{ fontSize: ".75rem", fontWeight: 900, color: "#15803D", letterSpacing: ".05em" }}>DEPOIS</div>
                <div style={{ fontWeight: 700 }}>Esfirra aberta de carne moída temperada, massa fina assada na hora.</div>
              </div>
            </div>
            <Bloco
              titulo="Prompt que reescreve o seu cardápio inteiro"
              texto={M.promptCardapio(l)}
              dica="Cole no ChatGPT e, no lugar indicado, a lista dos pratos com ingredientes e preço. Confira cada descrição antes de usar."
            />
            <Atalho href={LINK_FIREHUB}>No FireHubFood o cardápio digital já é uma página em texto, com endereço próprio. Teste 15 dias grátis</Atalho>
          </>
        );
      case "google":
        return (
          <>
            <Grade>
              <Campo id="kit-horario" rotulo="Horário" valor={l.horario} aoMudar={mudarLoja("horario")} exemplo="de terça a domingo, das 18h às 23h30" />
              <Campo id="kit-dif-g" rotulo="O que vocês fazem de diferente" valor={l.diferencial} aoMudar={mudarLoja("diferencial")} exemplo="massa fina assada na hora" />
            </Grade>
            <div style={{ ...caixaTexto, marginTop: 12 }}>
              <div style={cabecalhoBloco}>
                <b>Descrição pronta do seu Perfil</b>
                <BotaoCopiar texto={descricao} />
              </div>
              <textarea
                value={descricao}
                onChange={(ev) => setE((s) => ({ ...s, descricaoEditada: ev.target.value }))}
                rows={6}
                aria-label="Descrição do Perfil da Empresa no Google"
                style={{ width: "100%", boxSizing: "border-box", border: "1px solid #CBD5E1", borderRadius: 10, padding: 10, font: "inherit", lineHeight: 1.5, resize: "vertical" }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, fontSize: ".85rem", marginTop: 6 }}>
                <span style={{ color: descricao.length > M.LIMITE_DESCRICAO_GOOGLE ? "#B91C1C" : "#64748B", fontWeight: 700 }}>
                  {descricao.length}/{M.LIMITE_DESCRICAO_GOOGLE} caracteres
                </span>
                {e.descricaoEditada !== null && (
                  <button type="button" className="nao-imprime" onClick={() => setE((s) => ({ ...s, descricaoEditada: null }))} style={botaoLink}>
                    Refazer com os meus dados
                  </button>
                )}
              </div>
            </div>
            <Atalho href="https://business.google.com/" externo>Abrir o Perfil da Empresa no Google</Atalho>
          </>
        );
      case "fotos":
        return (
          <>
            <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
              {M.calendarioDeFotos(l).map(([semana, oQue]) => (
                <div key={semana} style={{ display: "flex", gap: 10, alignItems: "baseline", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: "9px 12px" }}>
                  <span style={{ fontWeight: 900, color: LARANJA_LINK, whiteSpace: "nowrap", fontSize: ".9rem" }}>{semana}</span>
                  <span style={{ lineHeight: 1.45 }}>{oQue}</span>
                </div>
              ))}
            </div>
            <Bloco titulo="Legenda pronta" texto={M.legendaDeFoto(l)} />
          </>
        );
      case "avaliacoes":
        return (
          <>
            <Campo id="kit-zap-a" rotulo="WhatsApp da loja (entra na resposta de reclamação)" valor={l.whatsapp} aoMudar={mudarLoja("whatsapp")} exemplo="(22) 99999-9999" />
            <Bloco titulo="Mensagem para pedir avaliação (WhatsApp)" texto={M.mensagemPedirAvaliacao(l)} />
            <Bloco
              titulo="Bilhete para a embalagem"
              texto={M.bilheteDaEmbalagem(l)}
              dica="Transforme o seu link de avaliação em QR code num gerador grátis e imprima junto."
            />
            <Bloco titulo="Resposta para elogio" texto={M.respostaElogio(l)} />
            <Bloco titulo="Resposta para reclamação" texto={M.respostaReclamacao(l)} />
            <Bloco titulo="Resposta para nota sem comentário" texto={M.respostaNeutra(l)} />
            <Bloco titulo="Prompt para a avaliação difícil" texto={M.promptAvaliacaoDificil(l)} dica="Cole no ChatGPT com a avaliação. Leia antes de publicar." />
          </>
        );
      case "igual":
        return (
          <>
            <Grade>
              <Campo id="kit-end" rotulo="Endereço" valor={l.endereco} aoMudar={mudarLoja("endereco")} exemplo="Rua X, 123, Centro — ou: só delivery" />
              <Campo id="kit-zap" rotulo="WhatsApp" valor={l.whatsapp} aoMudar={mudarLoja("whatsapp")} exemplo="(22) 99999-9999" />
              <Campo id="kit-hora" rotulo="Horário" valor={l.horario} aoMudar={mudarLoja("horario")} exemplo="de terça a domingo, das 18h às 23h30" />
              <Campo id="kit-link" rotulo="Link do cardápio" valor={l.linkCardapio} aoMudar={mudarLoja("linkCardapio")} exemplo="firehubfood.com.br/loja/sua-loja" />
            </Grade>
            <Bloco titulo="Sua ficha única" texto={M.fichaUnica(l)} />
            <div style={{ fontWeight: 900, margin: "4px 0 8px" }}>Onde colar (marque quando colar):</div>
            <div style={{ display: "grid", gap: 6 }}>
              {M.ONDE_COLAR.map(([id, rotulo]) => (
                <label key={id} style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "6px 2px" }}>
                  <input
                    type="checkbox"
                    checked={!!e.colados[id]}
                    onChange={(ev) => setE((s) => ({ ...s, colados: { ...s.colados, [id]: ev.target.checked } }))}
                    style={{ width: 20, height: 20, accentColor: VERDE, flex: "0 0 auto" }}
                  />
                  <span style={{ textDecoration: e.colados[id] ? "line-through" : "none", color: e.colados[id] ? "#64748B" : "inherit" }}>{rotulo}</span>
                </label>
              ))}
            </div>
          </>
        );
      case "diferente":
        return (
          <>
            <div style={{ display: "grid", gap: 10 }}>
              <Campo id="kit-dif" rotulo="1. O que você faz diferente?" valor={l.diferencial} aoMudar={mudarLoja("diferencial")} exemplo="de massa fina assada na hora" />
              <Campo id="kit-ref" rotulo="2. Como o cliente acha a sua loja?" valor={l.referencia} aoMudar={mudarLoja("referencia")} exemplo="em frente à praça da Baleia" />
              <Campo id="kit-oca" rotulo="3. Para quem ou para quando?" valor={l.ocasiao} aoMudar={mudarLoja("ocasiao")} exemplo="o lanche da família no fim de semana" />
            </div>
            <div style={{ marginTop: 12 }}>
              <Bloco
                titulo="Sua frase-assinatura"
                texto={M.fraseAssinatura(l)}
                dica="Use na bio do Instagram, no Google, no topo do cardápio e no fim das respostas de avaliação."
              />
              <Bloco
                titulo="Perguntas frequentes prontas"
                texto={M.perguntasFrequentes(l)}
                dica="Troque o que estiver entre colchetes e coloque no cardápio e na mensagem automática do WhatsApp."
              />
            </div>
            <Atalho href={LINK_WHATS} externo>Quer que eu escreva isso junto com você?</Atalho>
          </>
        );
    }
  }

  return (
    <div className="kit">
      <style>{`
        .kit input:focus-visible, .kit textarea:focus-visible, .kit button:focus-visible, .kit a:focus-visible {
          outline: 3px solid ${LARANJA}; outline-offset: 2px;
        }
        .corpo-passo[data-aberto="false"] { display: none; }
        @media print {
          .nao-imprime { display: none !important; }
          .corpo-passo { display: block !important; }
          .cartao-passo { break-inside: avoid; box-shadow: none !important; }
          .barra-nota { position: static !important; }
        }
      `}</style>

      {/* ─────────── 1. A LOJA ─────────── */}
      <section id="sua-loja" style={secao}>
        <Titulo n={1}>Conte a sua loja</Titulo>
        <p style={textoCinza}>Tudo o que vem abaixo sai escrito com os seus dados. Fica só neste aparelho: a gente não recebe nada.</p>
        <div style={card}>
          <Grade>
            <Campo id="kit-nome" rotulo="Nome da loja" valor={l.nome} aoMudar={mudarLoja("nome")} exemplo="Hakim" />
            <Campo id="kit-comida" rotulo="O que você vende" valor={l.comida} aoMudar={mudarLoja("comida")} exemplo="esfirra" />
            <Campo id="kit-prato" rotulo="Prato mais vendido" valor={l.prato} aoMudar={mudarLoja("prato")} exemplo="esfirra de carne" />
            <Campo id="kit-cidade" rotulo="Cidade" valor={l.cidade} aoMudar={mudarLoja("cidade")} exemplo="Rio das Ostras" />
            <Campo id="kit-bairro" rotulo="Bairro" valor={l.bairro} aoMudar={mudarLoja("bairro")} exemplo="Centro" />
          </Grade>
        </div>
      </section>

      {/* ─────────── 2. O TESTE ─────────── */}
      <section style={{ ...secao, paddingTop: 0 }}>
        <Titulo n={2}>Faça o teste em 1 toque</Titulo>
        <p style={textoCinza}>O botão abre a IA já com a pergunta feita. Veja se a sua loja aparece.</p>
        <div style={{ ...card, background: "#FFF7ED", border: "1px solid #FED7AA" }}>
          <div style={{ background: "#fff", border: "1px dashed #FDBA74", borderRadius: 12, padding: "12px 14px", fontWeight: 900, fontSize: "1.1rem", marginBottom: 12 }}>
            “{pergunta}”
          </div>
          {!podeTestar && (
            <p style={{ margin: "0 0 10px", color: "#9A3412", fontWeight: 700 }}>Preencha “o que você vende” e a cidade para liberar o teste.</p>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 8 }} className="nao-imprime">
            <BotaoIA href={links.chatgpt} ativo={podeTestar}>ChatGPT</BotaoIA>
            <BotaoIA href={links.google} ativo={podeTestar}>Google (Modo IA)</BotaoIA>
            <BotaoIA href={links.perplexity} ativo={podeTestar}>Perplexity</BotaoIA>
            <BotaoIA href={links.gemini} ativo={podeTestar} copiar={pergunta}>Gemini (cola a pergunta)</BotaoIA>
          </div>
          <p style={{ margin: "10px 0 14px", color: "#7C2D12", fontSize: ".9rem" }}>
            Dica: numa aba anônima você vê o que um cliente novo vê, sem o seu histórico.
          </p>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>E aí, apareceu?</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {([
              ["apareci", "Apareci"],
              ["errado", "Apareci com informação errada"],
              ["nao", "Não apareci"],
            ] as [ResultadoTeste, string][]).map(([valor, rotulo]) => {
              const ativo = e.teste === valor;
              return (
                <button
                  key={valor}
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => setE((s) => ({ ...s, teste: ativo ? null : valor }))}
                  style={{
                    font: "inherit", fontWeight: 800, padding: "9px 14px", borderRadius: 999, cursor: "pointer",
                    border: `2px solid ${ativo ? "#0F172A" : "#FDBA74"}`, background: ativo ? "#0F172A" : "#fff", color: ativo ? "#fff" : "#0F172A",
                  }}
                >
                  {rotulo}
                </button>
              );
            })}
          </div>
          {e.teste && (
            <p style={{ margin: "12px 0 0", fontWeight: 700, lineHeight: 1.5 }}>
              {e.teste === "apareci" && "Ótimo. Agora o trabalho é continuar aparecendo: confira se os 6 passos abaixo estão todos feitos."}
              {e.teste === "errado" && "Informação errada costuma vir de dado diferente em cada lugar. O passo 5 resolve isso."}
              {e.teste === "nao" && "É o normal no começo. Os 6 passos abaixo são o porquê, e o plano no fim diz por onde começar."}
            </p>
          )}
        </div>
      </section>

      {/* ─────────── 3. OS 6 PASSOS ─────────── */}
      <section style={{ ...secao, paddingTop: 0 }}>
        <Titulo n={3}>Os 6 passos, com o trabalho pronto</Titulo>
        <p style={textoCinza}>Toque no passo para abrir. Marque “Já faço isso” no que você já faz.</p>

        <div
          className="barra-nota"
          style={{ position: "sticky", top: 0, zIndex: 3, background: "#F8FAFC", padding: "10px 0 12px", display: "flex", alignItems: "center", gap: 12 }}
          aria-live="polite"
        >
          <div style={{ fontWeight: 900, whiteSpace: "nowrap" }}>
            Nota {nota}/100 <span style={{ color: "#64748B", fontWeight: 700 }}>· {feitos} de 6</span>
          </div>
          <div style={{ flex: 1, height: 10, background: "#E2E8F0", borderRadius: 99, overflow: "hidden" }} aria-hidden="true">
            <div style={{ width: `${nota}%`, height: "100%", background: nivel.cor, transition: "width .3s" }} />
          </div>
        </div>

        <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 12 }}>
          {PASSOS.map((p, i) => {
            const feito = !!e.feitos[p.id];
            const aberto = !!abertos[p.id];
            return (
              <li
                key={p.id}
                id={`passo-${p.id}`}
                className="cartao-passo"
                style={{ ...card, padding: 0, borderLeft: `5px solid ${feito ? VERDE : LARANJA}`, scrollMarginTop: 60 }}
              >
                <button
                  type="button"
                  onClick={() => alternar(p.id)}
                  aria-expanded={aberto}
                  aria-controls={`corpo-${p.id}`}
                  style={{ all: "unset", boxSizing: "border-box", width: "100%", cursor: "pointer", display: "flex", gap: 12, alignItems: "center", padding: "1rem 1.1rem" }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      flex: "0 0 auto", width: 34, height: 34, borderRadius: 999, display: "grid", placeItems: "center", fontWeight: 900, color: "#fff",
                      background: feito ? VERDE : `linear-gradient(135deg, ${LARANJA}, #E64A19)`,
                    }}
                  >
                    {feito ? "✓" : i + 1}
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 900, fontSize: "1.08rem", lineHeight: 1.25 }}>{p.titulo}</span>
                    <span style={{ display: "block", color: "#64748B", fontSize: ".88rem", marginTop: 2 }}>⏱ {p.tempo} · vale {p.peso} pontos</span>
                  </span>
                  <span aria-hidden="true" className="nao-imprime" style={{ fontSize: "1.3rem", color: "#94A3B8", transform: aberto ? "rotate(180deg)" : "none", transition: "transform .2s" }}>⌄</span>
                </button>

                <div id={`corpo-${p.id}`} className="corpo-passo" data-aberto={aberto ? "true" : "false"} style={{ padding: "0 1.1rem 1.1rem" }}>
                  <p style={{ ...textoCinza, fontWeight: 600, color: "#334155" }}>{p.porque}</p>
                  <div style={{ fontWeight: 900, marginBottom: 6 }}>Faça assim</div>
                  <ol style={{ margin: "0 0 14px", paddingLeft: "1.25rem", display: "grid", gap: 6, lineHeight: 1.5 }}>
                    {p.faca.map((f) => <li key={f}>{f}</li>)}
                  </ol>
                  {ferramentas(p.id)}
                  <p style={{ margin: "14px 0 12px", color: "#334155", lineHeight: 1.5, fontSize: ".95rem", background: "#F1F5F9", borderRadius: 10, padding: "9px 12px" }}>
                    <b>Como conferir:</b> {p.confere}
                  </p>
                  <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer", fontWeight: 900, background: feito ? "#F0FDF4" : "#fff", border: `2px solid ${feito ? VERDE : "#CBD5E1"}`, borderRadius: 12, padding: "9px 14px" }}>
                    <input type="checkbox" checked={feito} onChange={(ev) => marcar(p.id, ev.target.checked)} style={{ width: 20, height: 20, accentColor: VERDE }} />
                    Já faço isso
                  </label>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* ─────────── 4. NOTA E PLANO ─────────── */}
      <section style={{ ...secao, paddingTop: 0 }}>
        <Titulo n={4}>Sua nota e o seu plano de 7 dias</Titulo>
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
            <div style={{ fontSize: "3rem", fontWeight: 900, lineHeight: 1, color: nivel.cor }}>
              {nota}<span style={{ fontSize: "1.2rem", color: "#94A3B8" }}>/100</span>
            </div>
            <div>
              <div style={{ fontWeight: 900, fontSize: "1.1rem", color: nivel.cor }}>{nivel.texto}</div>
              <div style={{ color: "#64748B", fontSize: ".9rem" }}>Pelo que você marcou nos 6 passos.</div>
            </div>
          </div>

          <div style={{ borderTop: "1px dashed #CBD5E1", margin: "16px 0 12px" }} />

          {faltam.length === 0 ? (
            <p style={{ margin: 0, lineHeight: 1.55 }}>
              <b>Você fez os 6 passos.</b> Agora é manter: foto nova toda semana e resposta em toda avaliação. Refaça o teste a cada 15 dias:
              a IA pode levar semanas para atualizar o que sabe sobre você.
            </p>
          ) : (
            <ol style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {faltam.map((p, i) => (
                <li key={p.id} style={{ display: "flex", gap: 12, alignItems: "center" }}>
                  <span style={{ flex: "0 0 auto", fontWeight: 900, color: LARANJA_LINK, width: 52 }}>Dia {i + 1}</span>
                  <button type="button" onClick={() => irPara(p.id)} style={{ ...botaoLink, textDecoration: "none", textAlign: "left", fontWeight: 800 }}>
                    <span style={{ textDecoration: "underline", textUnderlineOffset: 3 }}>{p.titulo}</span>{" "}
                    <span style={{ color: "#64748B", fontWeight: 600 }}>· {p.tempo}</span>
                  </button>
                </li>
              ))}
              <li style={{ display: "flex", gap: 12, alignItems: "center" }}>
                <span style={{ flex: "0 0 auto", fontWeight: 900, color: LARANJA_LINK, width: 52 }}>Dia {faltam.length + 1}</span>
                <span style={{ fontWeight: 800 }}>
                  Refaça o teste. <span style={{ color: "#64748B", fontWeight: 600 }}>A IA pode levar semanas para atualizar: repita a cada 15 dias.</span>
                </span>
              </li>
            </ol>
          )}

          <div className="nao-imprime" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8, marginTop: 18 }}>
            <button type="button" onClick={() => window.print()} style={{ ...botaoCheio, background: "#0F172A" }}>
              Salvar em PDF ou imprimir
            </button>
            <a href={LINK_COMPARTILHAR} target="_blank" rel="noopener noreferrer" style={{ ...botaoCheio, background: "#15803D" }}>
              Mandar para o sócio
            </a>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── pedaços da tela ──────────────────────────────────────────────────────────

const caixaTexto: React.CSSProperties = { background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: "10px 12px", marginBottom: 10 };
const cabecalhoBloco: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 };
const botaoLink: React.CSSProperties = { all: "unset", cursor: "pointer", color: LARANJA_LINK, fontWeight: 800, textDecoration: "underline", textUnderlineOffset: 3 };
const botaoCheio: React.CSSProperties = {
  display: "block", textAlign: "center", color: "#fff", fontWeight: 900, padding: "13px 16px", borderRadius: 12,
  border: "none", font: "inherit", cursor: "pointer", textDecoration: "none",
};

function Titulo({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h2 style={{ display: "flex", alignItems: "center", gap: 10, fontSize: "clamp(1.3rem, 4.5vw, 1.7rem)", fontWeight: 900, margin: "0 0 6px", lineHeight: 1.2 }}>
      <span aria-hidden="true" style={{ flex: "0 0 auto", width: 30, height: 30, borderRadius: 9, background: "#0F172A", color: "#fff", display: "grid", placeItems: "center", fontSize: ".95rem" }}>{n}</span>
      {children}
    </h2>
  );
}

function Grade({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 10 }}>{children}</div>;
}

function Campo({ id, rotulo, valor, aoMudar, exemplo }: { id: string; rotulo: string; valor: string; aoMudar: (v: string) => void; exemplo: string }) {
  return (
    <label htmlFor={id} style={{ display: "grid", gap: 4, fontWeight: 800, fontSize: ".9rem", color: "#334155" }}>
      {rotulo}
      <input
        id={id}
        value={valor}
        onChange={(ev) => aoMudar(ev.target.value)}
        placeholder={`ex.: ${exemplo}`}
        autoComplete="off"
        style={{ font: "inherit", fontWeight: 500, fontSize: "1rem", color: "#0F172A", padding: "11px 12px", border: "1px solid #CBD5E1", borderRadius: 10, background: "#fff", minWidth: 0 }}
      />
    </label>
  );
}

function BotaoCopiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
    } catch {
      // Navegador sem permissão de área de transferência: o jeito antigo.
      const ta = document.createElement("textarea");
      ta.value = texto;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); } catch { /* sem cópia: o texto segue na tela para selecionar */ }
      ta.remove();
    }
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1600);
  }
  return (
    <button
      type="button"
      onClick={copiar}
      className="nao-imprime"
      style={{
        flex: "0 0 auto", font: "inherit", fontWeight: 900, fontSize: ".85rem", padding: "7px 12px", borderRadius: 9, cursor: "pointer",
        border: `2px solid ${copiado ? VERDE : LARANJA}`, background: copiado ? "#F0FDF4" : "#fff", color: copiado ? VERDE : LARANJA_LINK,
      }}
    >
      {copiado ? "Copiado ✓" : "Copiar"}
    </button>
  );
}

function Bloco({ titulo, texto, dica }: { titulo: string; texto: string; dica?: string }) {
  return (
    <div style={caixaTexto}>
      <div style={cabecalhoBloco}>
        <b>{titulo}</b>
        <BotaoCopiar texto={texto} />
      </div>
      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.5, background: "#fff", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 12px", overflowWrap: "anywhere" }}>
        {texto}
      </div>
      {dica && <div style={{ color: "#64748B", fontSize: ".88rem", marginTop: 6, lineHeight: 1.45 }}>{dica}</div>}
    </div>
  );
}

function Atalho({ href, externo, children }: { href: string; externo?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 8 }}>
      <a
        href={href}
        {...(externo ? { target: "_blank", rel: "noopener noreferrer" } : {})}
        style={{ color: LARANJA_LINK, fontWeight: 800, textUnderlineOffset: 3, lineHeight: 1.45 }}
      >
        {children} →
      </a>
    </div>
  );
}

function BotaoIA({ href, ativo, copiar, children }: { href: string; ativo: boolean; copiar?: string; children: React.ReactNode }) {
  return (
    <a
      href={ativo ? href : undefined}
      target="_blank"
      rel="noopener noreferrer"
      aria-disabled={!ativo}
      onClick={(ev) => {
        if (!ativo) { ev.preventDefault(); return; }
        // O Gemini não aceita a pergunta no link: ela vai para a área de
        // transferência e o lojista só cola.
        if (copiar) navigator.clipboard?.writeText(copiar).catch(() => {});
      }}
      style={{
        display: "block", textAlign: "center", fontWeight: 900, padding: "12px 10px", borderRadius: 12, textDecoration: "none",
        background: ativo ? `linear-gradient(135deg, ${LARANJA} 0%, #E64A19 100%)` : "#E2E8F0",
        color: ativo ? "#fff" : "#94A3B8", cursor: ativo ? "pointer" : "not-allowed",
        boxShadow: ativo ? "0 8px 20px rgba(255,87,34,.25)" : "none",
      }}
    >
      {children}
    </a>
  );
}
