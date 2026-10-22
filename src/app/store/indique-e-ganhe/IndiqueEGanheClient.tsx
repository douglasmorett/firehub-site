"use client";

/**
 * A explicação do Indique e Ganhe, para o lojista entender sem perguntar:
 * o que ganha, quando ganha, o que não vale e onde acompanha. O link, o saldo
 * e a lista de indicados são o cartão da aba Mensalidade (CartaoIndiqueEGanhe),
 * reaproveitado aqui embaixo — um lugar só para a regra e os números.
 */
import Link from "next/link";
import CartaoIndiqueEGanhe from "../financeiro/CartaoIndiqueEGanhe";
import { INDICADOS_PARA_ISENCAO, VALOR_DO_CREDITO } from "@/lib/indique-e-ganhe";

const LARANJA = "#e8590c";
const TINTA = "#15120f";
const TINTA_2 = "#57524c";
const LINHA = "#e9e3dc";
const CLARO = "#fff4ec";
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0 });

const PASSOS = [
  { n: 1, titulo: "Copie o seu link", texto: "Ele está logo abaixo, no cartão \"Indique e ganhe\". É o link da sua conta: quem se cadastrar por ele fica marcado como indicação sua." },
  { n: 2, titulo: "Mande para outro restaurante", texto: "Pelo botão \"Compartilhar no WhatsApp\" a mensagem já vai pronta. O colega se cadastra e usa o teste grátis normalmente." },
  { n: 3, titulo: "Ele paga a 1ª mensalidade", texto: `Na hora em que o restaurante indicado paga a primeira mensalidade, você ganha ${reais(VALOR_DO_CREDITO)} de desconto.` },
  { n: 4, titulo: "O desconto cai no seu boleto", texto: "Os créditos abatem a sua próxima mensalidade sozinhos. Indicou 3 que pagaram? São 3 descontos." },
];

const DUVIDAS = [
  { p: "Quanto eu ganho por indicação?", r: `${reais(VALOR_DO_CREDITO)} de desconto na sua mensalidade para cada restaurante indicado que pagar a primeira mensalidade. Não tem limite de indicações.` },
  { p: "Quando eu fico isento da mensalidade?", r: `A partir de ${INDICADOS_PARA_ISENCAO} restaurantes indicados ativos e pagando a mensalidade em dia, a mensalidade da sua loja principal sai zerada, enquanto continuar assim. Se algum atrasar ou cancelar e você ficar abaixo de ${INDICADOS_PARA_ISENCAO}, volta a cobrar normal.` },
  { p: "O restaurante indicado ganha alguma coisa?", r: "Não. Ele tem o mesmo teste grátis de qualquer cadastro. O prêmio é só de quem indica." },
  { p: "O que não vale como indicação?", r: "Loja do mesmo dono (mesmo CPF ou CNPJ) e filial da sua própria conta não contam. Só vale restaurante de outro dono, que se cadastrou pelo seu link." },
  { p: "E se o indicado ainda está no teste grátis?", r: "Ele aparece na sua lista como \"em teste\". O desconto só é gerado quando ele paga a primeira mensalidade." },
  { p: "Tenho várias lojas. Onde cai o desconto?", r: "O link é da conta. Os descontos e a isenção valem na mensalidade da sua loja principal." },
  { p: "Onde eu acompanho?", r: "Aqui embaixo e em Financeiro › Mensalidade: seu link, os créditos que você tem, quantos faltam para a isenção e a situação de cada restaurante indicado." },
];

export default function IndiqueEGanheClient() {
  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: "1.2rem 1rem 3rem", color: TINTA, fontFamily: "inherit" }}>
      {/* Topo */}
      <section style={{
        borderRadius: 24, padding: "2rem 1.6rem", color: "#fff", overflow: "hidden", position: "relative",
        background: "radial-gradient(800px 380px at 0% 0%, rgba(232,89,12,.45), transparent 60%), radial-gradient(600px 400px at 100% 100%, rgba(240,140,0,.22), transparent 60%), #15100c",
      }}>
        <span style={{ display: "inline-block", background: "rgba(255,255,255,.1)", border: "1px solid rgba(255,255,255,.16)", color: "#ffd8a8", borderRadius: 999, padding: "5px 12px", fontSize: 13, fontWeight: 800 }}>🎁 Indique e ganhe</span>
        <h1 style={{ fontSize: "clamp(26px,4vw,40px)", lineHeight: 1.08, margin: "14px 0 10px", fontWeight: 900 }}>
          Indique o FireHub para outro restaurante<br />
          <span style={{ background: "linear-gradient(90deg,#ffa94d,#ff6b1a)", WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent" }}>
            e ganhe {reais(VALOR_DO_CREDITO)} de desconto por indicação.
          </span>
        </h1>
        <p style={{ fontSize: 17, lineHeight: 1.55, color: "rgba(255,255,255,.82)", maxWidth: 640, margin: 0 }}>
          Cada restaurante que se cadastrar pelo seu link e pagar a primeira mensalidade vira <b style={{ color: "#fff" }}>{reais(VALOR_DO_CREDITO)} de desconto</b> na sua.
          Chegou a <b style={{ color: "#fff" }}>{INDICADOS_PARA_ISENCAO} indicados ativos</b>? Sua mensalidade fica <b style={{ color: "#fff" }}>isenta</b>.
        </p>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 20 }}>
          <a href="#meu-link" style={{ background: LARANJA, color: "#fff", padding: "12px 18px", borderRadius: 12, fontWeight: 800, textDecoration: "none" }}>Pegar meu link ↓</a>
          <a href="#duvidas" style={{ border: "1.5px solid rgba(255,255,255,.6)", color: "#fff", padding: "12px 18px", borderRadius: 12, fontWeight: 800, textDecoration: "none" }}>Tirar dúvidas</a>
        </div>
      </section>

      {/* Os dois prêmios */}
      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 14, marginTop: 16 }}>
        <div style={{ background: "#fff", border: `1px solid ${LINHA}`, borderRadius: 20, padding: "1.3rem" }}>
          <div style={{ fontSize: 34 }}>💸</div>
          <div style={{ fontSize: 13, fontWeight: 900, color: LARANJA, letterSpacing: ".06em", marginTop: 6 }}>POR INDICAÇÃO</div>
          <div style={{ fontSize: 26, fontWeight: 900, margin: "4px 0" }}>{reais(VALOR_DO_CREDITO)} de desconto</div>
          <p style={{ color: TINTA_2, margin: 0, lineHeight: 1.5 }}>Para cada restaurante que pagar a primeira mensalidade. Sem limite: 5 indicados que pagaram são 5 descontos.</p>
        </div>
        <div style={{ background: "#fff", border: `1px solid ${LINHA}`, borderRadius: 20, padding: "1.3rem" }}>
          <div style={{ fontSize: 34 }}>🏆</div>
          <div style={{ fontSize: 13, fontWeight: 900, color: LARANJA, letterSpacing: ".06em", marginTop: 6 }}>A PARTIR DE {INDICADOS_PARA_ISENCAO} INDICADOS</div>
          <div style={{ fontSize: 26, fontWeight: 900, margin: "4px 0" }}>Mensalidade isenta</div>
          <p style={{ color: TINTA_2, margin: 0, lineHeight: 1.5 }}>Com {INDICADOS_PARA_ISENCAO} ou mais restaurantes indicados ativos e pagando em dia, você não paga a mensalidade da loja principal.</p>
        </div>
      </section>

      {/* Como funciona */}
      <section style={{ marginTop: 26 }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: LARANJA, letterSpacing: ".08em" }}>COMO FUNCIONA</div>
        <h2 style={{ fontSize: 26, margin: "4px 0 14px", fontWeight: 900 }}>Quatro passos, sem cadastro extra</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
          {PASSOS.map((p) => (
            <div key={p.n} style={{ background: "#fff", border: `1px solid ${LINHA}`, borderRadius: 18, padding: "1.1rem" }}>
              <div style={{ width: 34, height: 34, borderRadius: "50%", background: p.n === 4 ? LARANJA : TINTA, color: "#fff", display: "grid", placeItems: "center", fontWeight: 900 }}>{p.n}</div>
              <div style={{ fontWeight: 900, fontSize: 16, margin: "10px 0 4px" }}>{p.titulo}</div>
              <p style={{ color: TINTA_2, margin: 0, fontSize: 14, lineHeight: 1.5 }}>{p.texto}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Exemplo */}
      <section style={{ marginTop: 26, background: CLARO, border: "1px solid #ffd8a8", borderRadius: 20, padding: "1.3rem" }}>
        <div style={{ fontWeight: 900, fontSize: 18, marginBottom: 10 }}>📊 Na prática</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
          {[
            { q: "1 indicado pagou", r: `${reais(VALOR_DO_CREDITO)} de desconto` },
            { q: "3 indicados pagaram", r: `${reais(VALOR_DO_CREDITO * 3)} de desconto` },
            { q: `${INDICADOS_PARA_ISENCAO} indicados ativos`, r: "mensalidade isenta" },
          ].map((x) => (
            <div key={x.q} style={{ background: "#fff", borderRadius: 14, padding: "0.9rem 1rem", border: `1px solid ${LINHA}` }}>
              <div style={{ color: TINTA_2, fontWeight: 700, fontSize: 14 }}>{x.q}</div>
              <div style={{ fontWeight: 900, fontSize: 20, color: LARANJA }}>{x.r}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Meu link e meus números */}
      <section id="meu-link" style={{ marginTop: 26, scrollMarginTop: 80 }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: LARANJA, letterSpacing: ".08em" }}>SEU LINK E SEUS NÚMEROS</div>
        <h2 style={{ fontSize: 26, margin: "4px 0 14px", fontWeight: 900 }}>Copie, compartilhe e acompanhe</h2>
        <CartaoIndiqueEGanhe />
        <p style={{ color: TINTA_2, fontSize: 13, marginTop: 8 }}>
          Não apareceu o seu link? Ele fica com quem tem acesso ao Financeiro da loja. Também dá para ver em{" "}
          <Link href="/store/financeiro" style={{ color: LARANJA, fontWeight: 800 }}>Financeiro › Mensalidade</Link>.
        </p>
      </section>

      {/* Dúvidas */}
      <section id="duvidas" style={{ marginTop: 26, scrollMarginTop: 80 }}>
        <div style={{ fontSize: 13, fontWeight: 900, color: LARANJA, letterSpacing: ".08em" }}>DÚVIDAS</div>
        <h2 style={{ fontSize: 26, margin: "4px 0 10px", fontWeight: 900 }}>Perguntas frequentes</h2>
        {DUVIDAS.map((d, i) => (
          <details key={d.p} open={i < 2} style={{ background: "#fff", border: `1px solid ${LINHA}`, borderRadius: 14, padding: "12px 16px", marginTop: 8 }}>
            <summary style={{ fontWeight: 800, cursor: "pointer" }}>{d.p}</summary>
            <p style={{ color: TINTA_2, margin: "8px 0 0", lineHeight: 1.55 }}>{d.r}</p>
          </details>
        ))}
      </section>
    </div>
  );
}
