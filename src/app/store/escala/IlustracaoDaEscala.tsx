"use client";

/**
 * "Como funciona" desenhado da Escala da equipe: cria o turno → manda o link
 * no grupo → cada um se inscreve → a semana montada. Os rótulos são os da
 * tela real: o formulário de ./JanelaDoTurno.tsx (Novo turno, Data, Começa,
 * Termina, Função, Vagas, Repetir em outros dias, Criar turno), a mensagem
 * pronta de ./LinkDeInscricao.tsx, a página pública de app/escala/[codigo]
 * (N vagas, Quero esta vaga) e a barra/resumo de ./EscalaClient.tsx
 * (📲 Mandar no grupo, 🖨️ Imprimir, Custo previsto (diárias)).
 * Nomes, horários e valores são de exemplo.
 */
import type { ReactNode } from "react";
import { Passos } from "@/components/ilustracoes/Passos";
import { Balao, Botao, Celular, Linha, Painel } from "@/components/ilustracoes/aparelhos";
import { COR } from "./ui";

const botaoDaEscala = { background: COR };
const leve = { background: "#FFF", color: "#334155", border: "1.5px solid #CBD5E1", fontSize: 10 };

function Campo({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <span style={{ display: "block", fontSize: 9, fontWeight: 800, color: "#64748B" }}>{rotulo}</span>
      <span style={{ display: "block", border: "1.5px solid #CBD5E1", borderRadius: 6, padding: "3px 6px", fontWeight: 700 }}>{valor}</span>
    </div>
  );
}

function VagaNoLink({ hora, vagas, escolhida }: { hora: string; vagas: number; escolhida?: boolean }) {
  return (
    <div style={{ background: "#FFF", border: "1px solid #E2E8F0", borderRadius: 8, padding: 7, display: "grid", gap: 4 }}>
      <Linha style={{ alignItems: "center" }}>
        <span><b style={{ display: "block", fontSize: 11 }}>{hora}</b><span style={{ color: "#64748B" }}>Motoboy</span></span>
        <span style={{ background: "#FEF3C7", color: "#92400E", fontWeight: 900, borderRadius: 999, padding: "2px 7px", fontSize: 9 }}>{vagas} vaga{vagas === 1 ? "" : "s"}</span>
      </Linha>
      <Botao style={escolhida ? { background: "#047857" } : botaoDaEscala}>{escolhida ? "✓ Quero esta vaga" : "Quero esta vaga"}</Botao>
    </div>
  );
}

function Dia({ nome, children }: { nome: string; children: ReactNode }) {
  return <div style={{ background: "#F1F5F9", borderRadius: 5, padding: 4, minHeight: 44, fontSize: 9.5 }}><b style={{ display: "block", fontSize: 9, color: "#64748B" }}>{nome}</b>{children}</div>;
}
function Nome({ children, livre }: { children: ReactNode; livre?: boolean }) {
  return <span style={{ display: "block", background: livre ? "#FFEDD5" : "#DCFCE7", color: livre ? "#9A3412" : "#166534", borderRadius: 3, padding: "1px 3px", marginTop: 2, fontWeight: 700 }}>{children}</span>;
}

export function IlustracaoDaEscala() {
  return (
    <Passos passos={[
      {
        legenda: "Você cria os turnos da semana: dia, horário, função e quantas vagas. \"Repetir em outros dias\" preenche a semana de uma vez.",
        desenho: (
          <Painel titulo="Novo turno" largura={280}>
            <Campo rotulo="Data" valor="Sexta, 20/11" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <Campo rotulo="Começa" valor="18:00" />
              <Campo rotulo="Termina" valor="23:30" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <Campo rotulo="Função" valor="Motoboy" />
              <Campo rotulo="Vagas" valor="2" />
            </div>
            <span style={{ fontWeight: 800 }}>☑ Repetir em outros dias</span>
            <Botao style={botaoDaEscala}>Criar turno</Botao>
          </Painel>
        ),
      },
      {
        legenda: "Na aba \"Link de inscrição\", manda o link no grupo da equipe.",
        desenho: (
          <Celular titulo="Motoboys Burger da Vila" sub="grupo · 14 pessoas">
            <Balao eu>📅 <b>Escala da Burger da Vila</b><br />As vagas da semana estão abertas! Escolha o seu turno pelo link:<br /><span style={{ color: "#0284C7" }}>firehubfood.com.br/escala/…</span></Balao>
            <Balao>Vou pegar sexta!</Balao>
            <Balao>Sábado eu</Balao>
          </Celular>
        ),
      },
      {
        legenda: "Cada um entra com o próprio WhatsApp e escolhe o turno pelo celular — sem baixar app.",
        desenho: (
          <Celular titulo="Escala · Burger da Vila" sub="sexta, 20/11" tipo="app">
            <VagaNoLink hora="18:00–23:30" vagas={1} escolhida />
            <VagaNoLink hora="19:00–23:30" vagas={2} />
          </Celular>
        ),
      },
      {
        legenda: "A semana fica montada. Você manda no grupo, imprime e vê o custo das diárias.",
        desenho: (
          <Painel titulo="📅 16/11 a 22/11">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 4 }}>
              <Dia nome="Qui"><Nome livre>1 vaga aberta</Nome></Dia>
              <Dia nome="Sex"><Nome>João</Nome><Nome>Rafa</Nome></Dia>
              <Dia nome="Sáb"><Nome>Léo</Nome><Nome>Dani</Nome></Dia>
              <Dia nome="Dom"><Nome>João</Nome></Dia>
            </div>
            <Linha>
              <Botao style={{ ...leve, flex: 1, color: "#15803D", borderColor: "#BBF7D0" }}>📲 Mandar no grupo</Botao>
              <Botao style={{ ...leve, flex: 1 }}>🖨️ Imprimir</Botao>
            </Linha>
            <Linha style={{ background: "#F8FAFC", borderRadius: 6, padding: "5px 7px" }}><span>Custo previsto (diárias)</span><b style={{ color: COR }}>R$ 400,00</b></Linha>
            <span style={{ color: "#64748B", fontSize: 10 }}>5 turnos × R$ 80,00 (exemplo)</span>
          </Painel>
        ),
      },
    ]} />
  );
}
