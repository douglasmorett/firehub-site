"use client";
/**
 * O passo a passo DESENHADO de cada integração (Integrações → modal), no mesmo
 * jeito do Asaas (PassoAPassoAsaas): um desenho por passo, quase nada para ler.
 * Pedido do Douglas em 20/11/2026, para a loja conectar sozinha e o suporte cair.
 *
 * Desenhos esquemáticos, de propósito: os portais dos parceiros mudam de cara
 * de vez em quando, e o que a loja precisa é saber O QUE fazer em cada tela,
 * não achar um botão idêntico. Os passos de cada parceiro estão em PASSOS e
 * seguem o que o próprio modal já explica em texto.
 *
 * Aberto para quem ainda vai conectar; recolhido ("Ver passo a passo") para
 * quem já está conectado.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import { MousePointerClick, Copy, CheckCircle2 } from "lucide-react";
import { Destaque } from "@/components/customer/PassoAPassoAsaas";

type Linha = { tipo: "campo" | "lista" | "marcar" | "menu"; texto: string; rotulo?: string };
type Desenho =
  /** Um botão do FireHub, aqui no modal. */
  | { tipo: "botao"; texto: string; cor: string; corTexto?: string }
  /** Uma tela no site do parceiro (barra de endereço de mentira). */
  | { tipo: "fora"; onde: string; titulo?: string; linhas?: Linha[]; botao?: { texto: string; cor: string; corTexto?: string } }
  /** O código/chave que o parceiro mostra e a loja copia. */
  | { tipo: "copiar"; onde: string; titulo: string; valor: string; cor: string; destaque: string }
  /** Os campos daqui onde a loja cola e o botão de concluir. */
  | { tipo: "colar"; campos: string[]; botao: string }
  /** A tela daqui ficando verde sozinha. */
  | { tipo: "verde"; texto: string }
  /** Uma opção para DESLIGAR no painel do parceiro. */
  | { tipo: "desligar"; onde: string; texto: string }
  /** Uma mensagem para mandar ao suporte do parceiro. */
  | { tipo: "mensagem"; para: string; texto: string };
type Passo = { titulo: ReactNode; desenho: Desenho; nota?: string };
type Guia = { titulo: string; subtitulo?: string; cor: string; fundo: string; borda: string; passos: Passo[] };

const IFOOD = "#EA1D2C";

export const PASSOS: Record<string, Guia> = {
  ifood: {
    titulo: "Como conectar o iFood em 4 passos",
    subtitulo: "Leva uns 2 minutos. Faça do passo 1 ao 4 em até 10 minutos.",
    cor: "#E8590C", fundo: "#FFF7F2", borda: "#FED7C3",
    passos: [
      { titulo: "Clique no botão laranja aqui embaixo", desenho: { tipo: "botao", texto: "Passo 1 · Abrir o iFood para autorizar", cor: "#E8590C" }, nota: "O iFood abre numa aba nova." },
      { titulo: <>Entre com o login da loja e clique em <span style={{ color: IFOOD }}>Autorizar</span></>, desenho: { tipo: "fora", onde: "portal.ifood.com.br", titulo: "FireHub quer acessar sua loja", linhas: [{ tipo: "lista", rotulo: "Loja", texto: "Sua loja" }], botao: { texto: "Autorizar", cor: IFOOD } }, nota: "O código do FireHub já vem preenchido. Não precisa digitar nada." },
      { titulo: "O iFood mostra um código NOVO. Copie esse.", desenho: { tipo: "copiar", onde: "portal.ifood.com.br", titulo: "Integração autorizada", valor: "HSXD-CWHG", cor: IFOOD, destaque: "é este que você cola" } },
      { titulo: "Volte aqui, cole o código e clique em Concluir Vinculação", desenho: { tipo: "colar", campos: ["HSXD-CWHG"], botao: "Concluir" }, nota: "Pronto: os pedidos do iFood começam a entrar sozinhos." },
    ],
  },
  "99food": {
    titulo: "Como conectar o 99Food em 3 passos",
    subtitulo: "Leva menos de um minuto. Não precisa de código nem senha.",
    cor: "#B45309", fundo: "#FFFBEB", borda: "#FDE68A",
    passos: [
      { titulo: "Clique em Conectar com o 99Food, aqui embaixo", desenho: { tipo: "botao", texto: "Conectar com o 99Food", cor: "#FFC700", corTexto: "#1C1917" }, nota: "Abre o site do 99Food." },
      { titulo: "Entre com a conta do 99Food onde você vê os pedidos e autorize", desenho: { tipo: "fora", onde: "99Food", titulo: "Autorizar o FireHub", linhas: [{ tipo: "campo", rotulo: "Conta", texto: "a conta da sua loja" }], botao: { texto: "Autorizar", cor: "#FFC700", corTexto: "#1C1917" } } },
      { titulo: "Volte aqui: a tela fica verde sozinha", desenho: { tipo: "verde", texto: "Loja autorizada no 99Food" }, nota: "Use o botão desta tela: link aberto no painel de outra loja liga a loja errada." },
    ],
  },
  keeta: {
    titulo: "Como conectar a Keeta em 3 passos",
    subtitulo: "Leva menos de um minuto. Não precisa de código nem senha.",
    cor: "#111827", fundo: "#FEFCE8", borda: "#FDE68A",
    passos: [
      { titulo: "Clique em Conectar com a Keeta, aqui embaixo", desenho: { tipo: "botao", texto: "Conectar com a Keeta", cor: "#FFD100", corTexto: "#111827" }, nota: "Abre o site da Keeta." },
      { titulo: "Entre na Keeta, marque a sua loja e confirme", desenho: { tipo: "fora", onde: "Keeta", titulo: "Autorizar o FireHub", linhas: [{ tipo: "marcar", texto: "Sua loja" }], botao: { texto: "Confirmar", cor: "#FFD100", corTexto: "#111827" } } },
      { titulo: "A Keeta te traz de volta já conectado", desenho: { tipo: "verde", texto: "Loja conectada na Keeta" } },
    ],
  },
  cardapioweb: {
    titulo: "Como conectar o CardápioWeb em 4 passos",
    subtitulo: "Tem mais de uma marca? Repita para cada uma.",
    cor: "#7C3AED", fundo: "#F5F3FF", borda: "#DDD6FE",
    passos: [
      { titulo: "Clique em Conectar loja do CardápioWeb, aqui embaixo", desenho: { tipo: "botao", texto: "Conectar loja do CardápioWeb", cor: "#7C3AED" } },
      { titulo: "Entre como Proprietário da loja e autorize", desenho: { tipo: "fora", onde: "CardápioWeb", titulo: "Autorizar o FireHub", linhas: [{ tipo: "campo", rotulo: "Entrar como", texto: "Proprietário" }], botao: { texto: "Autorizar", cor: "#7C3AED" } } },
      { titulo: "Volte aqui: a loja aparece como conectada", desenho: { tipo: "verde", texto: "Conectada — recebendo pedidos" } },
      { titulo: "No CardápioWeb, desligue a impressão e o aceite automático", desenho: { tipo: "desligar", onde: "CardápioWeb", texto: "Imprimir e aceitar pedidos automaticamente" }, nota: "Assim a comanda não sai duas vezes." },
    ],
  },
  anotaai: {
    titulo: "Como conectar o Anota AI em 3 passos",
    subtitulo: "Tem mais de uma marca? Conecte a chave de cada uma.",
    cor: "#0284C7", fundo: "#F0F9FF", borda: "#BAE6FD",
    passos: [
      { titulo: "No painel do Anota AI, abra Configuração Geral › Integrações", desenho: { tipo: "fora", onde: "Anota AI", linhas: [{ tipo: "menu", texto: "Configuração Geral" }, { tipo: "menu", texto: "Integrações" }] } },
      { titulo: "Copie a Chave de integração (Token)", desenho: { tipo: "copiar", onde: "Anota AI", titulo: "Chave de integração", valor: "eyJhbGci••••••••", cor: "#0284C7", destaque: "copie esta chave" } },
      { titulo: "Cole aqui embaixo e clique em Conectar", desenho: { tipo: "colar", campos: ["eyJhbGci••••••••"], botao: "Conectar" } },
    ],
  },
  aiqfome: {
    titulo: "Como conectar o aiqfome em 4 passos",
    subtitulo: "Use sempre o e-mail de dono da loja.",
    cor: "#7E22CE", fundo: "#FAF5FF", borda: "#E9D5FF",
    passos: [
      { titulo: "No Geraldo (painel do aiqfome), vincule a loja ao ID Magalu", desenho: { tipo: "fora", onde: "Geraldo · aiqfome", linhas: [{ tipo: "menu", texto: "Integrações" }, { tipo: "campo", rotulo: "ID Magalu", texto: "dono@sualoja.com" }], botao: { texto: "Vincular", cor: "#7E22CE" } } },
      { titulo: "Aqui, clique em Conectar loja do aiqfome", desenho: { tipo: "botao", texto: "Conectar loja do aiqfome", cor: "#7E22CE" } },
      { titulo: "Entre no ID Magalu com o mesmo e-mail e autorize", desenho: { tipo: "fora", onde: "ID Magalu", linhas: [{ tipo: "campo", rotulo: "E-mail", texto: "dono@sualoja.com" }], botao: { texto: "Autorizar", cor: "#0086FF" } } },
      { titulo: "Volte aqui: a loja aparece como conectada", desenho: { tipo: "verde", texto: "Conectada — recebendo pedidos" } },
    ],
  },
  brendi: {
    titulo: "Como conectar a Brendi em 3 passos",
    cor: "#334155", fundo: "#F8FAFC", borda: "#CBD5E1",
    passos: [
      { titulo: "No painel da Brendi, abra Integrações › API Pública e crie a integração", desenho: { tipo: "fora", onde: "app.brendi.com.br", linhas: [{ tipo: "menu", texto: "Integrações" }, { tipo: "menu", texto: "API Pública" }], botao: { texto: "Criar integração", cor: "#334155" } } },
      { titulo: "Copie o Client ID e o Client Secret", desenho: { tipo: "copiar", onde: "app.brendi.com.br", titulo: "Client Secret", valor: "••••••••••••", cor: "#334155", destaque: "aparece uma vez só" }, nota: "Cole aqui na mesma hora: a Brendi não mostra o Secret de novo." },
      { titulo: "Cole os dois aqui embaixo e clique em Salvar e Ativar", desenho: { tipo: "colar", campos: ["Client ID", "Client Secret"], botao: "Salvar e Ativar" } },
    ],
  },
  wabiz: {
    titulo: "Como conectar a Wabiz em 2 passos",
    cor: "#0D9488", fundo: "#F0FDFA", borda: "#99F6E4",
    passos: [
      { titulo: "Peça ao suporte da Wabiz o usuário e a senha da API", desenho: { tipo: "mensagem", para: "Suporte Wabiz", texto: "Oi! Preciso do usuário e da senha da API da minha loja para integrar com o FireHub." } },
      { titulo: "Cole aqui embaixo e clique em Salvar e Conectar", desenho: { tipo: "colar", campos: ["Usuário da API", "Senha da API"], botao: "Salvar e Conectar" }, nota: "Os pedidos do app passam a entrar sozinhos." },
    ],
  },
};

const moldura: CSSProperties = {
  background: "#FFF", border: "1px solid #CBD5E1", borderRadius: 10, padding: 10,
  boxShadow: "0 6px 16px rgba(15,23,42,0.08)", boxSizing: "border-box", textAlign: "left", fontSize: 11, color: "#0F172A",
};
const campo: CSSProperties = { border: "1.5px solid #CBD5E1", borderRadius: 6, padding: "4px 7px", display: "flex", justifyContent: "space-between", gap: 6 };
const realce: CSSProperties = { outline: "3px solid #F59E0B", outlineOffset: 2 };

function BotaoDesenhado({ texto, cor, corTexto = "#FFF" }: { texto: string; cor: string; corTexto?: string }) {
  return <span style={{ background: cor, color: corTexto, fontWeight: 800, fontSize: 10.5, padding: "5px 11px", borderRadius: 7, whiteSpace: "nowrap", ...realce }}>{texto}</span>;
}

function TelaDeFora({ onde, children }: { onde: string; children: ReactNode }) {
  return (
    <div style={{ ...moldura, padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 8px", background: "#F1F5F9", borderBottom: "1px solid #E2E8F0" }}>
        <span style={{ width: 6, height: 6, borderRadius: 9, background: "#F87171" }} />
        <span style={{ width: 6, height: 6, borderRadius: 9, background: "#FBBF24" }} />
        <span style={{ width: 6, height: 6, borderRadius: 9, background: "#34D399" }} />
        <span style={{ marginLeft: 4, fontSize: 9.5, color: "#64748B", fontFamily: "monospace" }}>{onde}</span>
      </div>
      <div style={{ padding: 10, display: "flex", flexDirection: "column", gap: 7 }}>{children}</div>
    </div>
  );
}

function Desenhar({ d }: { d: Desenho }) {
  switch (d.tipo) {
    case "botao":
      return (
        <div style={{ ...moldura, display: "flex", alignItems: "center", justifyContent: "center", gap: 6, flexWrap: "wrap" }}>
          <BotaoDesenhado texto={d.texto} cor={d.cor} corTexto={d.corTexto} />
          <Destaque><MousePointerClick size={11} /> clique</Destaque>
        </div>
      );
    case "fora":
      return (
        <TelaDeFora onde={d.onde}>
          {d.titulo && <div style={{ fontWeight: 800 }}>{d.titulo}</div>}
          {d.linhas?.map((l, i) => (
            <div key={i}>
              {l.rotulo && <div style={{ fontSize: 9.5, color: "#64748B", marginBottom: 2 }}>{l.rotulo}</div>}
              {l.tipo === "menu" ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700 }}>
                  <span style={{ color: "#94A3B8" }}>›</span> {l.texto}
                </div>
              ) : l.tipo === "marcar" ? (
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ width: 12, height: 12, borderRadius: 3, background: "#0F766E", color: "#FFF", fontSize: 9, display: "grid", placeItems: "center" }}>✓</span> {l.texto}
                </div>
              ) : (
                <div style={campo}><span>{l.texto}</span>{l.tipo === "lista" && <span style={{ color: "#94A3B8" }}>▾</span>}</div>
              )}
            </div>
          ))}
          {d.botao && (
            <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6, marginTop: 2 }}>
              <Destaque><MousePointerClick size={11} /> clique</Destaque>
              <BotaoDesenhado texto={d.botao.texto} cor={d.botao.cor} corTexto={d.botao.corTexto} />
            </div>
          )}
        </TelaDeFora>
      );
    case "copiar":
      return (
        <TelaDeFora onde={d.onde}>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontWeight: 800, color: "#047857" }}>
            <CheckCircle2 size={13} /> {d.titulo}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ ...campo, flex: 1, fontFamily: "monospace", fontWeight: 800, letterSpacing: "0.06em", minWidth: 0, overflow: "hidden" }}>{d.valor}</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 3, background: d.cor, color: "#FFF", fontWeight: 800, fontSize: 10, padding: "5px 8px", borderRadius: 7, ...realce }}>
              <Copy size={10} /> Copiar
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}><Destaque>{d.destaque}</Destaque></div>
        </TelaDeFora>
      );
    case "colar":
      return (
        <div style={{ ...moldura, display: "flex", flexDirection: "column", gap: 6 }}>
          {d.campos.map((c) => (
            <span key={c} style={{ ...campo, borderColor: "#99F6E4", fontFamily: "monospace", fontWeight: 800 }}>{c}</span>
          ))}
          <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 6 }}>
            <Destaque>cole e clique</Destaque>
            <BotaoDesenhado texto={d.botao} cor="#0F766E" />
          </div>
        </div>
      );
    case "verde":
      return (
        <div style={{ ...moldura, background: "#F0FDFA", borderColor: "#99F6E4", display: "flex", alignItems: "center", gap: 7, fontWeight: 800, color: "#0F766E" }}>
          <CheckCircle2 size={15} /> {d.texto}
        </div>
      );
    case "desligar":
      return (
        <TelaDeFora onde={d.onde}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontWeight: 700 }}>{d.texto}</span>
            <span aria-hidden style={{ flexShrink: 0, width: 30, height: 17, borderRadius: 999, background: "#CBD5E1", position: "relative", ...realce }}>
              <span style={{ position: "absolute", left: 2, top: 2, width: 13, height: 13, borderRadius: 999, background: "#FFF" }} />
            </span>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end" }}><Destaque>deixe desligado</Destaque></div>
        </TelaDeFora>
      );
    case "mensagem":
      return (
        <div style={{ ...moldura, background: "#ECE5DD" }}>
          <div style={{ fontSize: 9.5, fontWeight: 800, color: "#475569", marginBottom: 5 }}>Para: {d.para}</div>
          <div style={{ background: "#DCF8C6", borderRadius: "9px 9px 2px 9px", padding: "6px 8px", marginLeft: 18, lineHeight: 1.4 }}>{d.texto}</div>
        </div>
      );
  }
}

/**
 * O quadro "Como conectar X em N passos". `conectada` recolhe o quadro (a loja
 * já fez isso uma vez); quem ainda vai conectar vê aberto.
 */
export default function GuiaDeConexao({ id, conectada }: { id: keyof typeof PASSOS; conectada: boolean }) {
  const guia = PASSOS[id];
  const [ver, setVer] = useState(false);
  if (!guia) return null;
  const aberto = !conectada || ver;
  return (
    <div style={{ marginBottom: 14, padding: aberto ? 14 : "10px 14px", borderRadius: 16, background: guia.fundo, border: `1.5px solid ${guia.borda}` }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: aberto ? 12 : 0 }}>
        <div>
          <div style={{ fontWeight: 900, fontSize: "0.92rem", color: "#0F172A" }}>{guia.titulo}</div>
          {aberto && guia.subtitulo && <div style={{ fontSize: "0.74rem", color: "#475569", marginTop: 2 }}>{guia.subtitulo}</div>}
        </div>
        {conectada && (
          <button
            type="button"
            onClick={() => setVer((v) => !v)}
            style={{ border: `1px solid ${guia.borda}`, background: "#fff", color: "#334155", fontWeight: 800, fontSize: "0.76rem", padding: "6px 12px", borderRadius: 10, cursor: "pointer", fontFamily: "inherit" }}
          >
            {aberto ? "Esconder" : "Ver passo a passo"}
          </button>
        )}
      </div>
      {aberto && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10 }}>
          {guia.passos.map((p, i) => (
            <div key={i} style={{ background: "rgba(255,255,255,0.7)", border: "1px solid #E2E8F0", borderRadius: 14, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span style={{ flexShrink: 0, width: 24, height: 24, borderRadius: 999, background: guia.cor, color: "#FFF", fontWeight: 900, fontSize: 12.5, display: "grid", placeItems: "center" }}>{i + 1}</span>
                <span style={{ fontWeight: 800, fontSize: "0.82rem", color: "#0F172A", lineHeight: 1.35 }}>{p.titulo}</span>
              </div>
              <Desenhar d={p.desenho} />
              {p.nota && <div style={{ fontSize: "0.72rem", color: "#64748B" }}>{p.nota}</div>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
