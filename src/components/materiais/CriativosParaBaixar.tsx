"use client";

/**
 * Os criativos do FireHub para o parceiro postar (só FireHub — nada de
 * FireCheck): as peças da campanha do Meta (feed, story e os 2 vídeos), as
 * imagens novas e os reels. Os arquivos estão comprimidos em
 * public/materiais/criativos/ (jpg 85, vídeo 720p). Os textos são os
 * aprovados da campanha de 30/10/2026; o "Copiar" junta o link do parceiro.
 */
import { useState, type CSSProperties } from "react";

const PASTA = "/materiais/criativos";
const TEMAS: Record<string, string> = {
  "01-modulos": "Tudo incluído", "02-robo-audio": "Robô anota por áudio", "03-bebida": "Nunca esquecer a bebida",
  "04-canais": "Todos os pedidos num quadro", "05-contingencia": "Internet caiu, loja não para", "06-oferta": "15 dias grátis",
  "07-prazo-ifood": "Prazo do iFood sozinho",
  "fh-entrega": "Entrega", "fh-etiquetas": "Etiquetas e validade", "fh-fidelidade": "Fidelidade", "fh-fiscal": "Nota fiscal",
  "fh-garcom": "App do garçom", "fh-kds": "Tela da cozinha", "fh-mesas": "Mesas", "fh-motoboy": "App do motoboy",
  "fh-roteirizacao": "Roteirização", "fh-contingencia": "Modo contingência", "fh-fiado": "Fiado", "fh-impressoras": "Impressoras",
  "fh-pedidos": "Pedidos", "fh-pizza": "Pizza meio a meio", "fh-prazo-ifood": "Prazo do iFood", "fh-relatorios": "Relatórios",
  "fh-robo": "Robô do WhatsApp", "v1-modulos": "Quanto custa o seu sistema?", "v2-robo": "O robô anota o pedido",
};
const ANUNCIOS = ["01-modulos", "02-robo-audio", "03-bebida", "04-canais", "05-contingencia", "06-oferta", "07-prazo-ifood"];
const IMAGENS = ["fh-entrega", "fh-etiquetas", "fh-fidelidade", "fh-fiscal", "fh-garcom", "fh-kds", "fh-mesas", "fh-motoboy", "fh-roteirizacao"];
const REELS = ["fh-contingencia", "fh-entrega", "fh-etiquetas", "fh-fiado", "fh-fidelidade", "fh-fiscal", "fh-garcom", "fh-impressoras", "fh-kds", "fh-mesas", "fh-motoboy", "fh-pedidos", "fh-pizza", "fh-prazo-ifood", "fh-relatorios", "fh-robo", "fh-roteirizacao"];

type Peca = { nome: string; arquivo: string; miniatura: string; video?: boolean };
const GRUPOS: { titulo: string; explica: string; proporcao: string; pecas: Peca[] }[] = [
  {
    titulo: "Feed", explica: "1080 x 1350 — post do Instagram e do Facebook.", proporcao: "4 / 5",
    pecas: [
      ...ANUNCIOS.map((a) => ({ nome: TEMAS[a], arquivo: `${PASTA}/anuncios/${a}-feed.jpg`, miniatura: `${PASTA}/anuncios/${a}-feed.jpg` })),
      ...IMAGENS.map((a) => ({ nome: TEMAS[a], arquivo: `${PASTA}/imagens/${a}.jpg`, miniatura: `${PASTA}/imagens/${a}.jpg` })),
    ],
  },
  {
    titulo: "Story", explica: "1080 x 1920 — story e status do WhatsApp.", proporcao: "9 / 16",
    pecas: ANUNCIOS.map((a) => ({ nome: TEMAS[a], arquivo: `${PASTA}/anuncios/${a}-story.jpg`, miniatura: `${PASTA}/anuncios/${a}-story.jpg` })),
  },
  {
    titulo: "Reels e vídeos", explica: "Vídeos curtos em pé — reels, story e status.", proporcao: "9 / 16",
    pecas: [
      ...["v1-modulos", "v2-robo"].map((a) => ({ nome: TEMAS[a], arquivo: `${PASTA}/anuncios/${a}.mp4`, miniatura: `${PASTA}/anuncios/${a}-capa.jpg`, video: true })),
      ...REELS.map((a) => ({ nome: TEMAS[a], arquivo: `${PASTA}/reels/${a}.mp4`, miniatura: `${PASTA}/reels/${a}-capa.jpg`, video: true })),
    ],
  },
];

const TEXTOS = [
  { titulo: "Tudo incluído por 2% do faturamento", texto: "Quanto você paga por mês no sistema da sua loja? No FireHub vem tudo incluído: 2% do faturamento, máx. R$ 400/mês. Teste 15 dias grátis, sem cartão." },
  { titulo: "Máximo R$ 400/mês. Tudo liberado.", texto: "Cardápio, robô do WhatsApp, mesas, nota fiscal, etiquetas… no FireHub vem tudo incluído por 2% do faturamento (máx. R$ 400/mês). Teste 15 dias grátis, sem cartão." },
  { titulo: "Robô que anota pedido por áudio", texto: "Seu cliente manda áudio e o robô do FireHub anota o pedido, confirma e manda pra cozinha. Direto no WhatsApp da loja, 24h. Teste 15 dias grátis." },
  { titulo: "Nunca mais esqueça a bebida", texto: "A bebida esquecida na geladeira é o maior motivo de avaliação 1 estrela no delivery. O FireHub acha a bebida no pedido (até dentro do combo) e carimba na comanda. Teste 15 dias grátis." },
  { titulo: "Prazo do iFood ajustado sozinho", texto: "Cozinha lotou e o prazo no iFood continua 35 min? O FireHub lê a fila real da cozinha e os motoboys na rua e sobe o prazo sozinho. Menos atraso, menos cancelamento. Grátis por 15 dias." },
  { titulo: "Todos os pedidos num quadro só", texto: "iFood, 99Food, WhatsApp, site próprio, mesa e balcão: todos os pedidos num quadro só. Aceita, imprime, despacha e fecha o caixa no mesmo lugar. 15 dias grátis." },
  { titulo: "A internet caiu. A loja não para.", texto: "A internet caiu na sexta à noite? Com o Modo Contingência do FireHub as telas passam para o computador do caixa e a loja continua lançando pedido, mesa e imprimindo. Incluído no plano." },
];

const TINTA = "var(--pp-tinta, #15120f)";
const TINTA_2 = "var(--pp-cinza, #57524c)";
const LINHA = "var(--pp-linha-forte, #e9e3dc)";
const PAPEL = "var(--pp-papel, #fff)";
const cartao: CSSProperties = { background: PAPEL, border: `1px solid ${LINHA}`, borderRadius: 18, padding: "1.1rem", minWidth: 0 };
const botaoPequeno: CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "7px 10px", borderRadius: 10,
  fontWeight: 800, fontSize: 12.5, textDecoration: "none", border: `1.5px solid ${LINHA}`, color: TINTA, background: PAPEL, cursor: "pointer", fontFamily: "inherit",
};

const nomeDoArquivo = (p: Peca) => `FireHub - ${p.nome}${p.arquivo.includes("-story") ? " (story)" : ""}${p.arquivo.slice(p.arquivo.lastIndexOf("."))}`;

export default function CriativosParaBaixar({ linkDeCadastro }: { linkDeCadastro?: string }) {
  const [copiado, setCopiado] = useState<number | null>(null);
  const copiar = async (i: number) => {
    const t = TEXTOS[i].texto + (linkDeCadastro ? `\n\nTeste grátis: ${linkDeCadastro}` : "");
    try {
      await navigator.clipboard.writeText(t);
      setCopiado(i);
      setTimeout(() => setCopiado((c) => (c === i ? null : c)), 2200);
    } catch {
      setCopiado(-1 - i); // sem permissão de área de transferência: o texto fica à vista para selecionar
    }
  };

  return (
    <div style={{ ...cartao, display: "flex", flexDirection: "column", gap: 18 }}>
      <div>
        <h3 style={{ fontWeight: 900, fontSize: 17, margin: 0 }}>📣 Criativos para postar</h3>
        <p style={{ color: TINTA_2, margin: "4px 0 0", fontSize: 14, lineHeight: 1.5 }}>
          As peças oficiais do FireHub. Baixe e poste no seu Instagram, Facebook ou status; o texto vai logo abaixo, já com o seu link.
        </p>
      </div>

      {GRUPOS.map((g) => (
        <section key={g.titulo}>
          <div style={{ fontWeight: 900, fontSize: 15 }}>{g.titulo} <span style={{ color: TINTA_2, fontWeight: 600, fontSize: 13 }}>· {g.explica}</span></div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(min(132px,42%),1fr))", gap: 10, marginTop: 8 }}>
            {g.pecas.map((p) => (
              <figure key={p.arquivo} style={{ margin: 0, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                <a href={p.arquivo} target="_blank" rel="noreferrer" style={{ position: "relative", display: "block", aspectRatio: g.proporcao, borderRadius: 10, overflow: "hidden", border: `1px solid ${LINHA}`, background: "#1C1917" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.miniatura} alt={p.nome} loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                  {p.video && <span aria-hidden style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: 30, color: "#fff", textShadow: "0 2px 8px rgba(0,0,0,.6)" }}>▶</span>}
                </a>
                <figcaption style={{ fontSize: 12.5, fontWeight: 700, lineHeight: 1.3, overflowWrap: "anywhere" }}>{p.nome}</figcaption>
                <a href={p.arquivo} download={nomeDoArquivo(p)} style={botaoPequeno}>⬇ Baixar</a>
              </figure>
            ))}
          </div>
        </section>
      ))}

      <section>
        <div style={{ fontWeight: 900, fontSize: 15 }}>Textos para a legenda</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(280px,100%),1fr))", gap: 10, marginTop: 8 }}>
          {TEXTOS.map((t, i) => (
            <div key={t.titulo} style={{ border: `1px solid ${LINHA}`, borderRadius: 12, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
              <b style={{ fontSize: 14 }}>{t.titulo}</b>
              <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: TINTA_2, userSelect: "text" }}>{t.texto}</p>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" onClick={() => copiar(i)} style={botaoPequeno}>{copiado === i ? "✓ Copiado" : "Copiar texto"}</button>
                {copiado === -1 - i && <span style={{ fontSize: 12.5, color: "#B91C1C" }}>Não deu para copiar: selecione o texto acima.</span>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
