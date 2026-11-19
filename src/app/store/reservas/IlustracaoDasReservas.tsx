"use client";

/**
 * "Como funciona" desenhado das Reservas de mesa: o cliente pede no WhatsApp →
 * o robô confere a vaga e confirma → lotado, oferece o mais perto → a reserva
 * cai no painel com o aviso no WhatsApp do dono → na hora, "Chegou" e a mesa.
 * As frases do robô são as de lib/reservas/robo.ts (confirmacaoParaOCliente,
 * respostaDeNaoCabe, avisoDeReservaAoDono) e os botões os desta tela.
 */
import { Passos } from "@/components/ilustracoes/Passos";
import { Balao, Celular, Painel, Seta } from "@/components/ilustracoes/aparelhos";

const LOJA = "Cantina da Praça";

function Barrinhas({ valores, max }: { valores: number[]; max: number }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 3, height: 54 }}>
      {valores.map((v, i) => {
        const cheio = v >= max;
        return <i key={i} style={{ flex: 1, height: `${Math.max(8, (v / max) * 100)}%`, borderRadius: "3px 3px 0 0", background: cheio ? "#DC2626" : v / max >= 0.7 ? "#F59E0B" : "#16A34A" }} />;
      })}
    </div>
  );
}

export function IlustracaoDasReservas() {
  return (
    <Passos titulo="Como funciona" altura={330} passos={[
      {
        legenda: "O cliente pergunta no WhatsApp se tem mesa. O robô consulta a ocupação de verdade, responde e já reserva sozinho, pedindo só o que falta.",
        desenho: (
          <Celular titulo={LOJA} sub="online">
            <Balao eu>Oi! Tem mesa pra sábado às 20h? Somos 4</Balao>
            <Balao>Tem sim! Sábado (21/11) às 20:00 tem mesa para 4 pessoas. Quer que eu reserve? Me diz o nome de quem reserva.</Balao>
            <Balao eu>João Silva</Balao>
            <Balao><b>Reserva confirmada! ✅</b><br />📅 Sábado, 21/11 às 20:00<br />👥 4 pessoas, no nome de João Silva</Balao>
          </Celular>
        ),
      },
      {
        legenda: "Horário lotado? O robô não promete o que não tem: oferece os horários livres mais perto.",
        desenho: (
          <Celular titulo={LOJA} sub="online">
            <Balao eu>E pra sábado 20h30, 6 pessoas?</Balao>
            <Balao>Às 20:30 de sábado (21/11) já estamos lotados 😕 Tenho livre: <b>21:00, 19:30 ou 21:30</b>. Qual fica melhor?</Balao>
            <Balao eu>21h então!</Balao>
            <Balao><b>Reserva confirmada! ✅</b><br />📅 Sábado, 21/11 às 21:00</Balao>
          </Celular>
        ),
      },
      {
        legenda: "A reserva cai no painel na hora, com a ocupação de cada horário, e você recebe o aviso no seu WhatsApp.",
        desenho: (<>
          <Painel titulo="📅 Reservas · Sábado, 21/11" sub="Ocupação por horário (reservas ao mesmo tempo)" largura={260}>
            <Barrinhas valores={[3, 5, 8, 10, 10, 9, 6, 4]} max={10} />
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#64748B" }}><span>18:00</span><span>20:00</span><span>21:30</span></div>
            <div style={{ display: "flex", gap: 6, fontSize: 10 }}>
              <b style={{ color: "#166534" }}>● Livre</b><b style={{ color: "#B45309" }}>● Enchendo</b><b style={{ color: "#B91C1C" }}>● Lotado</b>
            </div>
          </Painel>
          <Celular titulo="Você (dono)" sub="aviso do FireHub">
            <Balao><b>📅 Reserva nova pelo robô</b><br /><br />João Silva<br />Sábado, 21/11 às 20:00 · 4 pessoas<br />Nesse horário: 8 de 10 reservas ao mesmo tempo.</Balao>
          </Celular>
        </>),
      },
      {
        legenda: "Na hora, marque “Chegou” e a mesa. No fim do mês você vê quantas pessoas vieram por reserva e quanto essas mesas consumiram.",
        desenho: (<>
          <Painel titulo="20:00 · João Silva · 👥 4" sub="🤖 Robô do WhatsApp" largura={210}>
            <div style={{ display: "flex", gap: 6 }}>
              <span style={{ flex: 1, background: "#16A34A", color: "#fff", borderRadius: 7, padding: 6, textAlign: "center", fontWeight: 800 }}>✅ Chegou</span>
              <span style={{ flex: 1, background: "#F1F5F9", borderRadius: 7, padding: 6, textAlign: "center", fontWeight: 700 }}>Mesa 12</span>
            </div>
          </Painel>
          <Seta />
          <Painel titulo="Novembro" largura={190}>
            <div style={{ fontSize: 22, fontWeight: 900, color: "#0F172A" }}>R$ 18.430</div>
            <div style={{ color: "#64748B" }}>consumidos nas mesas reservadas</div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Reservas</span><b>128</b></div>
            <div style={{ display: "flex", justifyContent: "space-between" }}><span>Vieram</span><b>91%</b></div>
          </Painel>
        </>),
      },
    ]} />
  );
}
