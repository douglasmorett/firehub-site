"use client";

import { useState } from "react";
import { CheckCircle2, Clock, ChevronDown, ChevronUp, PlayCircle } from "lucide-react";
import { MAQUININHAS_COMPATIVEIS, APP_DA_MAQUININHA, type ProdutoDaMaquininha } from "@/lib/maquininhas-compativeis";

/**
 * Quadro "Use na maquininha" das telas Totem, Garçons e Motoboys: qual app do
 * FireHub instalar, em quais maquininhas ele roda e o passo a passo desenhado
 * (a tela da maquininha em cada etapa). O cadastro em si (o código de 8
 * números) é o MaquininhasClient, logo abaixo deste quadro.
 */

type Passo = { titulo: string; texto: string; tela: React.ReactNode };

function TelaDaMaquininha({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      width: 132, height: 210, borderRadius: 18, background: "#1F2937", padding: "12px 8px 26px",
      boxShadow: "0 6px 16px rgba(15,23,42,.25)", flexShrink: 0, position: "relative",
    }}>
      <div style={{ background: "#fff", borderRadius: 8, height: "100%", overflow: "hidden", fontSize: 9, color: "#0F172A" }}>
        {children}
      </div>
      <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", width: 26, height: 6, borderRadius: 3, background: "#374151" }} />
    </div>
  );
}

function passosDo(produto: ProdutoDaMaquininha): Passo[] {
  const app = APP_DA_MAQUININHA[produto];
  const icone = <img src={app.icone} alt="" style={{ width: 30, height: 30, borderRadius: 7 }} />;
  const loja = (
    <div style={{ padding: 8 }}>
      <div style={{ fontWeight: 800, fontSize: 10, marginBottom: 6 }}>Cielo Store</div>
      <div style={{ border: "1px solid #CBD5E1", borderRadius: 6, padding: "3px 5px", color: "#64748B", marginBottom: 8 }}>🔎 FireHub</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {icone}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700 }}>{app.nome}</div>
          <div style={{ marginTop: 3, background: app.cor, color: "#fff", borderRadius: 4, padding: "1px 0", textAlign: "center", fontWeight: 700 }}>Instalar</div>
        </div>
      </div>
    </div>
  );
  const codigo = (
    <div style={{ padding: 8, textAlign: "center" }}>
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 6 }}>{icone}</div>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>Ligar à loja</div>
      <div style={{ border: "1.5px solid " + app.cor, borderRadius: 6, padding: "4px 0", fontWeight: 800, fontSize: 13, letterSpacing: 2 }}>4821 7730</div>
      <div style={{ marginTop: 8, background: app.cor, color: "#fff", borderRadius: 4, padding: "3px 0", fontWeight: 700 }}>Ligar à loja</div>
    </div>
  );
  const painel = (
    <div style={{ padding: 8 }}>
      <div style={{ fontWeight: 800, fontSize: 10, marginBottom: 4 }}>Painel FireHub</div>
      <div style={{ color: "#64748B", marginBottom: 6 }}>Maquininhas</div>
      <div style={{ background: "#FFF7E6", border: "1px solid #FDE68A", borderRadius: 6, padding: 5, textAlign: "center" }}>
        <div style={{ color: "#92400E", marginBottom: 3 }}>Código (10 min)</div>
        <div style={{ fontWeight: 800, fontSize: 13, letterSpacing: 2 }}>4821 7730</div>
      </div>
    </div>
  );
  const pronto = (
    <div style={{ padding: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 10 }}>
        {icone}<div style={{ fontWeight: 800, fontSize: 10 }}>Sua loja</div>
      </div>
      <div style={{ color: "#0F766E", fontWeight: 700, marginBottom: 14 }}>● Conectado · Cielo</div>
      <div style={{ textAlign: "center", fontWeight: 800, fontSize: 11 }}>
        {produto === "TOTEM" ? "Aguardando pedido" : produto === "GARCOM" ? "Mesas" : "Suas entregas"}
      </div>
    </div>
  );

  const passos: Passo[] = [
    { titulo: "Instale o app", texto: `Na maquininha, abra a Cielo Store, procure "FireHub" e instale o ${app.nome}.`, tela: loja },
    { titulo: "Gere o código", texto: "Aqui embaixo, em Maquininhas, cadastre a maquininha. Aparece um código de 8 números (vale 10 minutos).", tela: painel },
    { titulo: "Ligue à loja", texto: `Abra o ${app.nome} na maquininha, digite os 8 números e toque em "Ligar à loja".`, tela: codigo },
  ];
  if (produto === "GARCOM") {
    passos.push({ titulo: "Entre como garçom", texto: "O garçom entra com o login e a senha dele (cadastre em Garçons, na lista acima). Pronto: mesas, cardápio e cobrança na mão.", tela: pronto });
  } else if (produto === "MOTOBOY") {
    passos.push({ titulo: "Entre como motoboy", texto: "O motoboy entra com o telefone e a senha dele, os mesmos do app do celular. A localização liga sozinha.", tela: pronto });
  } else {
    passos.push({ titulo: "Pronto", texto: 'A maquininha mostra o nome da sua loja e "Conectado". O pedido do totem aparece nela para o cliente pagar.', tela: pronto });
  }
  return passos;
}

export default function AppNaMaquininha({ produto }: { produto: ProdutoDaMaquininha }) {
  const [aberto, setAberto] = useState(true);
  const app = APP_DA_MAQUININHA[produto];
  const maquininhas = MAQUININHAS_COMPATIVEIS.filter((m) => m.produtos.includes(produto));
  const passos = passosDo(produto);

  return (
    <div style={{ background: "#fff", borderRadius: 16, padding: 22, marginTop: 24, border: "1px solid #E2E8F0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <img src={app.icone} alt={app.nome} style={{ width: 56, height: 56, borderRadius: 13 }} />
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: app.cor, textTransform: "uppercase", letterSpacing: 0.5 }}>Use na maquininha</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, margin: "2px 0 4px" }}>{app.nome}</h2>
          <p style={{ margin: 0, color: "#475569", fontSize: 14 }}>{app.serve}</p>
        </div>
        <button onClick={() => setAberto(!aberto)} style={{
          background: "#F1F5F9", border: "none", borderRadius: 10, padding: "8px 12px", fontWeight: 700,
          color: "#334155", cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
        }}>
          {aberto ? <><ChevronUp size={16} /> Esconder</> : <><ChevronDown size={16} /> Como usar</>}
        </button>
      </div>

      {aberto && (
        <>
          <h3 style={{ fontSize: 15, fontWeight: 800, margin: "20px 0 10px" }}>Em quais maquininhas funciona</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 }}>
            {maquininhas.map((m) => (
              <div key={m.adquirente} style={{
                border: "1px solid " + (m.situacao === "disponivel" ? "#99F6E4" : "#E2E8F0"), borderRadius: 12, padding: 12,
                background: m.situacao === "disponivel" ? "#F0FDFA" : m.situacao === "liberando" ? "#FFFBEB" : "#F8FAFC",
              }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <strong style={{ fontSize: 15 }}>{m.adquirente}</strong>
                  <span style={{
                    fontSize: 11, fontWeight: 800, borderRadius: 999, padding: "2px 8px", display: "flex", alignItems: "center", gap: 4,
                    background: m.situacao === "disponivel" ? "#CCFBF1" : m.situacao === "liberando" ? "#FEF3C7" : "#E2E8F0",
                    color: m.situacao === "disponivel" ? "#0F766E" : m.situacao === "liberando" ? "#92400E" : "#475569",
                  }}>
                    {m.situacao === "disponivel" ? <><CheckCircle2 size={12} /> Já funciona</> : m.situacao === "liberando" ? <><Clock size={12} /> Liberando</> : <><Clock size={12} /> Em breve</>}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "#334155", marginTop: 4 }}>{m.modelos}</div>
                <div style={{ fontSize: 12, color: "#64748B", marginTop: 4 }}>{m.ondeBaixar}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: "#64748B", margin: "8px 0 0" }}>
            A maquininha continua sendo da sua conta na adquirente: o dinheiro cai direto para você, como sempre. O FireHub só manda o valor certo e recebe o resultado.
          </p>

          <h3 style={{ fontSize: 15, fontWeight: 800, margin: "22px 0 12px" }}>Passo a passo</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 14 }}>
            {passos.map((p, i) => (
              <div key={p.titulo} style={{ display: "flex", gap: 12, alignItems: "flex-start", background: "#F8FAFC", borderRadius: 14, padding: 12 }}>
                <TelaDaMaquininha>{p.tela}</TelaDaMaquininha>
                <div>
                  <div style={{
                    width: 26, height: 26, borderRadius: "50%", background: app.cor, color: "#fff", fontWeight: 800,
                    display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 6,
                  }}>{i + 1}</div>
                  <div style={{ fontWeight: 800, fontSize: 14, marginBottom: 4 }}>{p.titulo}</div>
                  <div style={{ fontSize: 13, color: "#475569", lineHeight: 1.45 }}>{p.texto}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 14, fontSize: 13, color: "#64748B" }}>
            <PlayCircle size={16} /> Vídeo do passo a passo: em breve nos Tutoriais em vídeo.
          </div>
        </>
      )}
    </div>
  );
}
