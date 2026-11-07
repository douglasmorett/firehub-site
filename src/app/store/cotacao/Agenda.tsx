"use client";

/**
 * A agenda da cotação: em que dias e horas a loja pede os preços. Nasce VAZIA
 * (Douglas, 07/11/2026: "segunda e quinta" era só exemplo; cada loja escolhe),
 * com atalhos para marcar rápido e mais de um horário se precisar. A frase de
 * cima diz em português o que vai acontecer, conforme ele marca.
 *
 * Aqui também: para quem vai o resumo da rodada e quanto tempo depois, e a
 * mensagem que o fornecedor recebe (para o lojista ver antes).
 */

import { useMemo, useState } from "react";
import { normalizarAgenda, resumoDaAgenda, type HorarioDaCotacao } from "@/lib/cotacao/agenda";
import { textoDoPedidoDePrecos } from "@/lib/cotacao/mensagens";
import type { DadosDaCotacao } from "./CotacaoClient";
import { telefoneBonito } from "./Fornecedores";
import { COR, COR_CLARA, EscolherDias, S, VERMELHO, pedir, type Aviso } from "./ui";

const ATALHOS: Array<[string, HorarioDaCotacao[]]> = [
  ["Segunda e quinta, 8h", [{ dias: [1, 4], hora: "08:00" }]],
  ["Segunda a sexta, 7h", [{ dias: [1, 2, 3, 4, 5], hora: "07:00" }]],
  ["Toda segunda, 9h", [{ dias: [1], hora: "09:00" }]],
  ["Terça e sexta, 14h", [{ dias: [2, 5], hora: "14:00" }]],
];
const HORAS_DO_RESUMO = [1, 2, 3, 4, 6, 8, 12, 24];

export default function Agenda({ dados, onAviso, onSalvou }: { dados: DadosDaCotacao; onAviso: (a: Aviso) => void; onSalvou: (d: DadosDaCotacao) => void }) {
  const [horarios, setHorarios] = useState<HorarioDaCotacao[]>(dados.config.agenda.length ? dados.config.agenda : []);
  const [horas, setHoras] = useState(dados.config.horasParaResumo || 4);
  const [comprador, setComprador] = useState(dados.config.compradorTelefone ? telefoneBonito(dados.config.compradorTelefone) : "");
  const [compradorNome, setCompradorNome] = useState(dados.config.compradorNome || "");
  const [salvando, setSalvando] = useState(false);

  const limpa = useMemo(() => normalizarAgenda(horarios), [horarios]);
  const frase = resumoDaAgenda(limpa, dados.loja.nome);
  const incompletos = horarios.filter((h) => !h.dias.length).length;
  const exemplo = textoDoPedidoDePrecos({ loja: dados.loja.nome, contato: "João", itens: ["Tomate", "Cebola", "Mussarela"], minutos: Number((limpa[0]?.hora || "08:00").slice(0, 2)) * 60 });
  const digitos = (t: string | null) => String(t || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "");
  const mudou = JSON.stringify(limpa) !== JSON.stringify(normalizarAgenda(dados.config.agenda)) || horas !== dados.config.horasParaResumo
    || digitos(comprador) !== digitos(dados.config.compradorTelefone) || compradorNome !== (dados.config.compradorNome || "");

  const muda = (i: number, h: Partial<HorarioDaCotacao>) => setHorarios((l) => l.map((x, j) => (j === i ? { ...x, ...h } : x)));

  async function salvar() {
    if (incompletos) return onAviso({ tipo: "atencao", titulo: "Marque pelo menos um dia em cada horário", detalhe: "Ou tire o horário que ficou sem dia." });
    setSalvando(true);
    try {
      const d = await pedir<DadosDaCotacao>("/api/store/cotacao", "PUT", { agenda: limpa, horasParaResumo: horas, compradorTelefone: comprador, compradorNome });
      onSalvou(d);
      setHorarios(d.config.agenda);
      onAviso({ tipo: "ok", titulo: "Agenda salva!", detalhe: d.frase });
    } catch (e: any) {
      onAviso({ tipo: "erro", titulo: "Não deu para salvar", detalhe: e.message });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <section style={{ ...S.cartao, borderColor: "#C7D2FE", background: COR_CLARA }}>
        <div style={{ fontSize: 12, fontWeight: 900, color: COR, letterSpacing: ".04em" }}>COMO VAI FICAR</div>
        <div style={{ fontSize: 18, fontWeight: 900, color: "#1E1B4B", marginTop: 4, lineHeight: 1.35 }}>{frase}</div>
      </section>

      <section style={S.cartao}>
        <h2 style={S.h2}>Quando a loja pede os preços</h2>
        <p style={{ ...S.texto, fontSize: 13, marginTop: 2 }}>Marque os dias e a hora. Precisa de mais de um horário (ex.: segunda cedo e quinta à tarde)? Adicione outro.</p>

        {horarios.length === 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13, fontWeight: 800, color: "#334155", marginBottom: 6 }}>Comece por um destes, ou monte o seu:</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {ATALHOS.map(([nome, h]) => (
                <button key={nome} type="button" style={{ ...S.botaoPequeno, height: 38, borderColor: "#C7D2FE", color: COR }} onClick={() => setHorarios(h.map((x) => ({ ...x, dias: [...x.dias] })))}>{nome}</button>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          {horarios.map((h, i) => (
            <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: 12, borderRadius: 14, border: `1.5px solid ${h.dias.length ? "#E2E8F0" : "#FECACA"}`, background: "#F8FAFC" }}>
              <EscolherDias dias={h.dias} onMudar={(dias) => muda(i, { dias })} />
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontWeight: 800, color: "#334155" }}>às</span>
                <input type="time" value={h.hora} onChange={(e) => muda(i, { hora: e.target.value })} aria-label="Hora" style={{ ...S.campo, width: 120, height: 40, fontWeight: 800 }} />
              </div>
              <button type="button" onClick={() => setHorarios((l) => l.filter((_, j) => j !== i))} style={{ ...S.botaoPequeno, color: VERMELHO, marginLeft: "auto" }}>Tirar</button>
              {!h.dias.length && <div style={{ width: "100%", fontSize: 12, color: VERMELHO, fontWeight: 700 }}>Marque pelo menos um dia.</div>}
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setHorarios((l) => [...l, { dias: [], hora: "08:00" }])} style={{ ...S.botaoLeve, marginTop: 10 }}>+ {horarios.length ? "Outro horário" : "Montar meu horário"}</button>
      </section>

      <section style={S.cartao}>
        <h2 style={S.h2}>O resumo da cotação</h2>
        <p style={{ ...S.texto, fontSize: 13, marginTop: 2 }}>Depois de pedir os preços, a loja manda no WhatsApp do comprador quantos responderam, o que caiu e o que subiu, com o link do comparativo.</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: 12 }}>
          <div>
            <label style={S.rotulo}>Mandar quanto tempo depois</label>
            <select value={horas} onChange={(e) => setHoras(Number(e.target.value))} style={S.campo}>
              {HORAS_DO_RESUMO.map((h) => <option key={h} value={h}>{h} hora{h === 1 ? "" : "s"} depois (ou antes, se todos responderem)</option>)}
            </select>
          </div>
          <div>
            <label style={S.rotulo}>WhatsApp do comprador</label>
            <input value={comprador} onChange={(e) => setComprador(e.target.value)} inputMode="tel" placeholder={dados.loja.telefoneDoDono ? `${telefoneBonito(dados.loja.telefoneDoDono)} (o do proprietário)` : "(22) 99999-8888"} style={S.campo} />
            <div style={{ fontSize: 11.5, color: "#94A3B8", marginTop: 3 }}>Em branco = o WhatsApp do proprietário (Minha loja).</div>
          </div>
          <div>
            <label style={S.rotulo}>Nome do comprador</label>
            <input value={compradorNome} onChange={(e) => setCompradorNome(e.target.value)} placeholder="Opcional" style={S.campo} />
          </div>
        </div>
      </section>

      <section style={S.cartao}>
        <h2 style={S.h2}>O que o fornecedor recebe</h2>
        <p style={{ ...S.texto, fontSize: 13, marginTop: 2 }}>Pelo WhatsApp da loja, com os itens que ele fornece. Quando ele responde, recebe só um “Recebido, obrigado! 🙏”.</p>
        <div style={{ marginTop: 10, maxWidth: 420, background: "#E7FFDB", borderRadius: "14px 14px 14px 4px", padding: "10px 12px", fontSize: 14, color: "#111B21", whiteSpace: "pre-line", lineHeight: 1.45, boxShadow: "0 1px 1px rgba(0,0,0,.08)" }}>
          {exemplo}
        </div>
      </section>

      <div style={{ position: "sticky", bottom: 12, display: "flex", justifyContent: "flex-end" }}>
        <button type="button" onClick={salvar} disabled={salvando || !mudou} style={{ ...S.botao, height: 48, fontSize: 15.5, background: mudou ? COR : "#CBD5E1", boxShadow: mudou ? "0 10px 24px rgba(67,56,202,.3)" : undefined }}>
          {salvando ? "Salvando…" : mudou ? "Salvar agenda" : "Agenda salva ✓"}
        </button>
      </div>
    </div>
  );
}
