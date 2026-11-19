"use client";

/**
 * Reservas DESLIGADAS: a apresentação do módulo — o que muda para o dono, o
 * "como funciona" desenhado, um sábado de exemplo na tela de verdade, o preço
 * claro (R$ 97/mês à parte, 7 dias grátis) e as dúvidas. Ao ativar, o termo.
 */
import { useState } from "react";
import ResumoDaCobranca from "@/components/modulos/ResumoDaCobranca";
import { CLAUSULAS_DO_TERMO_DAS_RESERVAS, TITULO_DO_TERMO_DAS_RESERVAS, VERSAO_DO_TERMO_DAS_RESERVAS } from "@/lib/reservas/termo";
import { CONFIG_PADRAO, disponibilidadeDoDia, type ReservaParaConta } from "@/lib/reservas/regras";
import { IlustracaoDasReservas } from "./IlustracaoDasReservas";
import { OcupacaoDoDia } from "./VisaoDoDia";
import { BORDA, COR, TINTA, TINTA_2, TINTA_3, cartao, h2, reais, texto, type Dados } from "./comum";

/** Um sábado cheio de exemplo (rodado pela regra de verdade). */
function sabadoDeExemplo() {
  const config = { ...CONFIG_PADRAO, maxReservasSimultaneas: 10 };
  // Das 19:30 às 20:30 são 10 na mesa: lota (e quem chegaria das 18:00 às 20:30 também não cabe, porque ficaria na mesa até esse pico).
  const chegadas: [string, number][] = [["18:00", 2], ["18:30", 2], ["19:00", 3], ["19:30", 3], ["20:00", 2], ["20:30", 2], ["21:00", 1], ["21:30", 1]];
  const reservas: ReservaParaConta[] = chegadas.flatMap(([hora, n]) => Array.from({ length: n }, () => ({ hora, pessoas: 4, status: "CONFIRMADA" as const })));
  return disponibilidadeDoDia(config, reservas, "2026-11-21", { data: "2026-11-01", minutos: 0 }).filter((h) => h.hora >= "18:00");
}

export function Oferta({ dados, salvando, onAtivar }: { dados: Dados; salvando: boolean; onAtivar: () => void }) {
  const comTeste = !dados.estado.jaTestou;
  const m = dados.mensalidade;
  return (
    <div style={{ display: "grid", gap: 18 }}>
      <section className="rsv-entra" style={{ borderRadius: 24, padding: "28px 24px", color: "#fff", background: "radial-gradient(120% 140% at 100% 0%, #7C3AED 0%, #5B21B6 45%, #2E1065 100%)", position: "relative", overflow: "hidden" }}>
        <div aria-hidden style={{ position: "absolute", right: -30, top: -30, fontSize: 180, opacity: 0.09, transform: "rotate(-12deg)" }}>🍽️</div>
        <span style={{ fontSize: 12, fontWeight: 900, letterSpacing: ".08em", background: "rgba(255,255,255,.16)", padding: "5px 10px", borderRadius: 999 }}>NOVO MÓDULO</span>
        <h1 style={{ margin: "14px 0 8px", fontSize: "clamp(26px, 4vw, 36px)", lineHeight: 1.1, fontWeight: 900, letterSpacing: "-0.02em", maxWidth: 640 }}>
          Seu robô já atende reserva. Agora ele enxerga o salão.
        </h1>
        <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, maxWidth: 620, color: "rgba(255,255,255,.88)" }}>
          Você diz quantas reservas cabem ao mesmo tempo e em que horários. O robô do WhatsApp confere a vaga de verdade, confirma sozinho,
          oferece outro horário quando lota, e tudo aparece aqui num painel claro: o dia, a semana, o mês e quanto as reservas trouxeram.
        </p>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "center", marginTop: 20 }}>
          <div>
            <span style={{ fontSize: 40, fontWeight: 900, letterSpacing: "-0.02em" }}>{reais(dados.preco)}</span>
            <span style={{ fontSize: 15, fontWeight: 700, opacity: 0.9 }}> /mês</span>
            <div style={{ fontSize: 13, opacity: 0.85, fontWeight: 600 }}>{comTeste ? `${dados.diasDeTeste} dias grátis para testar · desliga quando quiser` : "sem taxa de instalação"}</div>
          </div>
          <span style={{ flex: 1 }} />
          {dados.estado.isento ? null : dados.podeContratar ? (
            <button type="button" onClick={onAtivar} disabled={salvando} className="rsv-botao" style={{ padding: "16px 26px", borderRadius: 14, border: "none", background: "#fff", color: COR, fontSize: 17, fontWeight: 900, cursor: "pointer", fontFamily: "inherit", boxShadow: "0 12px 28px rgba(0,0,0,.25)" }}>
              {comTeste ? `Testar ${dados.diasDeTeste} dias grátis` : "Ativar as reservas"}
            </button>
          ) : (
            <b style={{ background: "rgba(255,255,255,.14)", padding: "10px 14px", borderRadius: 12 }}>Quem ativa é o dono da loja.</b>
          )}
        </div>
      </section>

      <div className="rsv-grade">
        {[
          ["🤖", "O robô reserva sozinho", "Confere a vaga, grava e confirma no WhatsApp com dia, hora e pessoas. Sem ficha para alguém digitar."],
          ["🚦", "Nunca passa da capacidade", "Você define quantas reservas cabem ao mesmo tempo e quanto dura cada uma. Lotou, ele oferece o horário livre mais perto."],
          ["📊", "Tudo claro no painel", "Linha do tempo do dia, semana e mês, com cor por ocupação. Chegou, não veio, mover, cancelar: um toque."],
          ["💰", "Resultado em reais", "Reservas e pessoas no mês, comparecimento e quanto as mesas reservadas consumiram."],
        ].map(([icone, titulo, t]) => (
          <div key={titulo} style={{ ...cartao, display: "grid", gap: 6 }}>
            <span aria-hidden style={{ fontSize: 26 }}>{icone}</span>
            <b style={{ fontSize: 15, color: TINTA }}>{titulo}</b>
            <p style={{ ...texto, fontSize: 13.5 }}>{t}</p>
          </div>
        ))}
      </div>

      <IlustracaoDasReservas />

      <section style={cartao}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h2 style={h2}>Assim fica um sábado cheio no seu painel</h2>
          <span style={{ fontSize: 12, fontWeight: 800, color: TINTA_3 }}>EXEMPLO · 10 reservas ao mesmo tempo · 2h cada</span>
        </div>
        <p style={{ ...texto, fontSize: 13.5, margin: "4px 0 10px" }}>
          Cada barra é quantas reservas estão na mesa naquele horário. Das 19:30 às 20:30 o salão lota: quem chegaria a partir das 18:00 pegaria esse pico, então o robô para de aceitar e oferece 21:00 em diante.
        </p>
        <OcupacaoDoDia horarios={sabadoDeExemplo()} />
      </section>

      <section style={cartao}>
        <h2 style={h2}>Dúvidas</h2>
        <div style={{ display: "grid", gap: 2, marginTop: 8 }}>
          {[
            ["E se o cliente quiser um horário lotado?", "O robô diz que está cheio e oferece até 3 horários livres mais perto, no mesmo dia ou nos próximos. Nunca confirma o que não cabe."],
            ["Grupo grande, festa, evento?", "Acima do limite de pessoas por reserva que você define, o robô passa a conversa para a equipe combinar."],
            ["O cliente consegue cancelar?", "Sim, pelo próprio WhatsApp. O robô cancela a reserva dele e você recebe o aviso; a vaga volta a ficar livre na hora."],
            ["E as reservas que chegam por telefone ou no balcão?", "Você lança pelo botão “Nova reserva”, com a mesma conferência de vaga. Se quiser apertar mais uma mesa, dá para encaixar."],
            ["Preciso ter o robô ligado?", "Não. Sem o robô você usa o painel para organizar as reservas; com o robô, ele também reserva sozinho."],
            ["Como é cobrado?", `${reais(dados.preco)} por mês no boleto do FireHub, à parte da mensalidade (${m.percentual}% das vendas, mínimo de ${reais(m.minimo)} e teto de ${reais(m.teto)}). ${comTeste ? `Os ${dados.diasDeTeste} primeiros dias são grátis; desligando dentro deles, nada é cobrado.` : ""} Depois do teste, desligar deixa liberado até o fim do mês, sem valor proporcional.`],
          ].map(([p, r]) => (
            <details key={p} style={{ borderBottom: `1px solid ${BORDA}`, padding: "12px 2px" }}>
              <summary style={{ fontWeight: 800, color: TINTA, cursor: "pointer", fontSize: 14.5 }}>{p}</summary>
              <p style={{ ...texto, fontSize: 13.5, marginTop: 6 }}>{r}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}

export function Termo({ preco, diasDeTeste, comTeste, salvando, onCancelar, onAceitar }: {
  preco: number; diasDeTeste: number; comTeste: boolean; salvando: boolean; onCancelar: () => void; onAceitar: () => void;
}) {
  const [concordo, setConcordo] = useState(false);
  return (
    <div role="dialog" aria-modal="true" aria-label={TITULO_DO_TERMO_DAS_RESERVAS}
      onClick={(ev) => { if (ev.target === ev.currentTarget && !salvando) onCancelar(); }}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: "#fff", borderRadius: 18, width: "100%", maxWidth: 620, maxHeight: "90vh", overflowY: "auto", paddingBottom: 16 }}>
        <div style={{ padding: "18px 20px 0" }}>
          <strong style={{ fontSize: 17 }}>{TITULO_DO_TERMO_DAS_RESERVAS}</strong>
          <div style={{ fontSize: 13, color: "#64748B" }}>{reais(preco)} por mês · versão de {VERSAO_DO_TERMO_DAS_RESERVAS.split("-").reverse().join("/")}</div>
        </div>
        <ResumoDaCobranca preco={preco} diasDeTeste={diasDeTeste} comTeste={comTeste} />
        <ol style={{ margin: "14px 20px 0", paddingLeft: 20, fontSize: 13.5, color: TINTA_2, lineHeight: 1.6 }}>
          {CLAUSULAS_DO_TERMO_DAS_RESERVAS.map((c, i) => <li key={i} style={{ marginBottom: 6 }}>{c}</li>)}
        </ol>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", margin: "14px 20px 0", fontSize: 14, fontWeight: 700, color: TINTA }}>
          <input type="checkbox" checked={concordo} onChange={(ev) => setConcordo(ev.target.checked)} style={{ width: 18, height: 18, marginTop: 2 }} />
          Li e concordo com o termo e autorizo a cobrança de {reais(preco)} por mês no boleto do FireHub, à parte da mensalidade.
        </label>
        <div style={{ display: "flex", gap: 10, margin: "16px 20px 0" }}>
          <button type="button" onClick={onCancelar} disabled={salvando} style={{ flex: 1, padding: 12, borderRadius: 12, border: "1px solid #CBD5E1", background: "#fff", fontWeight: 800, cursor: "pointer", fontFamily: "inherit" }}>Agora não</button>
          <button type="button" onClick={onAceitar} disabled={!concordo || salvando} style={{ flex: 2, padding: 12, borderRadius: 12, border: "none", background: concordo ? COR : "#CBD5E1", color: "#fff", fontWeight: 900, cursor: concordo ? "pointer" : "default", fontFamily: "inherit" }}>
            {salvando ? "Ativando…" : "Concordo e ativar"}
          </button>
        </div>
      </div>
    </div>
  );
}
