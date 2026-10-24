import BotaoImprimirCaixa from "@/components/customer/BotaoImprimirCaixa";
import CorrigirCaixaFechado from "@/components/customer/CorrigirCaixaFechado";
import ForaDaGavetaDoCaixaFechado from "@/components/customer/ForaDaGavetaDoCaixaFechado";
import MovimentacoesDoCaixaFechado from "@/components/customer/MovimentacoesDoCaixaFechado";
import { VendasPorTipoDoHistorico } from "@/components/customer/VendasPorTipoDoCaixa";
import { FORMAS_DA_CONFERENCIA, conferenciaGravada, porQueSemConferencia } from "@/lib/conferencia-do-caixa";
import { formasAlteradas, podeEditarCaixa, type RetratoDoContado } from "@/lib/edicao-do-caixa";
import { movimentacoesDosCaixas } from "@/lib/movimentacoes-do-caixa";
import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";

// Com milhar e o sinal antes do "R$": "−R$ 1.234,50" é lido certo na pressa.
const fmt = (v: number) => `${v < -0.004 ? "−" : ""}R$ ${Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// No relógio DA LOJA: o servidor roda em UTC e cada loja tem o seu fuso.
const fmtDateEm = (tz: string | null | undefined) => (d: Date) =>
  new Date(d).toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", year:"numeric", hour:"2-digit", minute:"2-digit", timeZone: tz || "America/Sao_Paulo" });
const fmtHoraEm = (tz: string | null | undefined) => (d: Date) =>
  new Date(d).toLocaleString("pt-BR", { day:"2-digit", month:"2-digit", hour:"2-digit", minute:"2-digit", timeZone: tz || "America/Sao_Paulo" });
const fmtDur = (open: Date, close: Date) => {
  const m = Math.round((new Date(close).getTime() - new Date(open).getTime()) / 60000);
  return m < 60 ? `${m}min` : `${Math.floor(m/60)}h${String(m%60).padStart(2,"0")}`;
};

export const metadata = { title: "Histórico de Caixas — FireHub" };

/**
 * O HISTÓRICO DE CAIXAS.
 *
 * Auditoria de 11/10/2026 (C6), quatro defeitos:
 *  1. A busca era pelo id de QUEM ABRIU a página: o funcionário (conta com
 *     `ownerId`) não via caixa nenhum — 7 contas de funcionário em 5 lojas, 8
 *     caixas fechados por funcionário em 30 dias. É a loja (`ownerId || id`),
 *     como no resto do caixa.
 *  2. `difference || 0` punha ✅ no caixa encerrado SEM conferência (o que se
 *     fecha sozinho ao abrir outro grava diferença nula; NIK, 05/10). Agora diz
 *     "sem conferência" — e o caixa antigo com as cinco formas em zero (ninguém
 *     contou; a "falta" gravada não aconteceu) também.
 *  3. A linha TOTAL comparava o "Sistema" com o online e o troco inicial contra
 *     o "Contado" sem eles (Hakim 10/10: "R$ 2.505,21 | R$ 1.045,20 | +R$ 0,18").
 *     Agora é igual com igual: as formas contadas dos dois lados; o online à parte.
 *  4. "Caixa #N" era a posição na lista (mudava toda semana). O nome agora é a
 *     data e a hora em que o turno abriu.
 *
 * CORREÇÃO DO CAIXA FECHADO (11/10/2026, Nik Esfirraria): quem tem a permissão
 * corrige o contado aqui (lib/edicao-do-caixa.ts). O caixa corrigido diz isso
 * no topo — quando e quem — e guarda como estava antes de cada correção.
 * A entrada ou retirada esquecida (Pizzaria 17, 14/10/2026) se lança no bloco
 * "Entradas e retiradas", com a mesma permissão e o mesmo registro: ela conta
 * neste caixa e refaz o dinheiro esperado e a diferença gravados.
 * A leitura da conferência é a de lib/conferencia-do-caixa.ts — a mesma da 2ª
 * via do papel.
 */
export default async function CaixaHistoricoPage({ searchParams }: { searchParams: Promise<{ voltar?: string }> }) {
  // Volta para a tela de onde veio (o menu do caixa abre em qualquer tela da
  // loja). Só caminho interno da loja, para o link não virar redirecionamento.
  const { voltar: voltarParam } = await searchParams;
  const voltar = voltarParam && /^\/store(\/|$)/.test(voltarParam) ? voltarParam : "/store/venda-presencial";

  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");

  const user = await prisma.user.findUnique({ where: { email: session.user?.email || "" }, select: { id: true, ownerId: true, role: true, permissions: true, storeTimezone: true } });
  if (!user) redirect("/login");
  // O caixa é da LOJA: o funcionário vê os caixas do dono.
  const lojaId = user.ownerId || user.id;
  const dono = user.ownerId
    ? await prisma.user.findUnique({ where: { id: lojaId }, select: { storeTimezone: true } })
    : user;
  const fuso = dono?.storeTimezone || user.storeTimezone;
  const fmtDate = fmtDateEm(fuso);
  const fmtHora = fmtHoraEm(fuso);

  const sessions = await prisma.cashSession.findMany({
    where: { franchiseeId: lojaId, status: "CLOSED" },
    orderBy: { closedAt: "desc" },
    take: 60,
  });

  // As correções feitas depois do fechamento. Consulta à parte e protegida:
  // se a tabela ainda não existir (boot que falhou), o histórico abre igual.
  // O lançamento esquecido (lib/lancamento-tardio-do-caixa.ts) grava também o
  // dinheiro esperado no antes e no depois; a correção de contagem, não.
  type ComEsperado = RetratoDoContado & { expectedCash?: number | null };
  type Edicao = { id: string; cashSessionId: string; editadoPor: string; suporte: string | null; motivo: string | null; antes: ComEsperado; depois: ComEsperado; createdAt: Date };
  const edicoesPorCaixa = new Map<string, Edicao[]>();
  try {
    const edicoes = await prisma.cashSessionEdicao.findMany({
      where: { cashSessionId: { in: sessions.map((s) => s.id) } },
      orderBy: { createdAt: "asc" },
    });
    for (const e of edicoes) {
      const lista = edicoesPorCaixa.get(e.cashSessionId) || [];
      lista.push(e as unknown as Edicao);
      edicoesPorCaixa.set(e.cashSessionId, lista);
    }
  } catch (err: any) {
    console.warn("[Histórico de caixas] Correções não carregadas:", err?.message);
  }
  // As entradas e retiradas de cada caixa (Pizzaria 17, 14/10/2026: "as
  // sangrias não aparecem no relatório"). Uma consulta para os 60; nula se a
  // tabela não puder ser lida — o bloco some em vez de dizer "nenhuma".
  const movimentosPorCaixa = await movimentacoesDosCaixas(lojaId, sessions);
  const podeCorrigir = podeEditarCaixa(user);
  const fmtDif = (d: number | null) => d == null ? "sem conferência" : Math.abs(d) < 0.01 ? "confere" : d < 0 ? `faltou ${fmt(-d)}` : `sobrou ${fmt(d)}`;

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "1.5rem 1rem", fontFamily: "'Inter', sans-serif" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: "1.5rem" }}>
        <a href={voltar} style={{ color: "#64748B", textDecoration: "none", fontSize: "0.85rem" }}>← Voltar</a>
        <h1 style={{ margin: 0, fontSize: "1.3rem", fontWeight: 900, color: "#0F172A" }}>🏦 Histórico de Caixas</h1>
      </div>

      {sessions.length === 0 ? (
        <div style={{ textAlign: "center", padding: "3rem", color: "#94A3B8", background: "#F8FAFC", borderRadius: 16 }}>
          <div style={{ fontSize: "3rem", marginBottom: 12 }}>📭</div>
          <p style={{ margin: 0, fontWeight: 600 }}>Nenhum caixa encerrado ainda.</p>
        </div>
      ) : sessions.map((s) => {
        const conf = conferenciaGravada(s as unknown as Record<string, unknown>);
        const semConferencia = conf.situacao === "SEM_CONFERENCIA";
        const dif = conf.diferenca ?? 0;
        const confere = !semConferencia && Math.abs(dif) < 0.01;
        const cor = semConferencia ? { fundo: "#F8FAFC", forte: "#475569" } : confere ? { fundo: "#F0FDFA", forte: "#0F766E" } : { fundo: "#FEF2F2", forte: "#C92E09" };
        const linhas = conf.linhas.filter((l) => Math.abs(l.esperado) > 0.005 || (l.contado != null && Math.abs(l.contado) > 0.005));
        const edicoes = edicoesPorCaixa.get(s.id) || [];
        const ultima = edicoes[edicoes.length - 1];
        return (
          <div key={s.id} style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, marginBottom: 12, overflow: "hidden", boxShadow: "0 2px 8px rgba(0,0,0,0.04)" }}>
            {/* Header */}
            <div style={{ background: cor.fundo, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: "1.3rem" }}>{semConferencia ? "⏸️" : confere ? "✅" : "⚠️"}</span>
                <div>
                  {/* O nome do caixa é o turno: não muda quando a lista anda. */}
                  <div style={{ fontWeight: 800, fontSize: "0.92rem", color: "#0F172A" }}>
                    Caixa de {fmtDate(s.openedAt)}
                  </div>
                  <div style={{ fontSize: "0.75rem", color: "#64748B" }}>
                    Fechado: {s.closedAt ? fmtHora(s.closedAt) : "—"} {s.closedAt ? `• Duração: ${fmtDur(s.openedAt, s.closedAt)}` : ""}
                    {s.closedBy ? ` • Encerrado por: ${s.closedBy}` : ""}
                  </div>
                  {ultima && (
                    <div style={{ display: "inline-block", marginTop: 4, padding: "2px 8px", borderRadius: 6, background: "#FEF3C7", color: "#92400E", fontSize: "0.72rem", fontWeight: 800 }}>
                      ✏️ Corrigido em {fmtDate(ultima.createdAt)} por {ultima.editadoPor}{ultima.suporte ? ` (${ultima.suporte})` : ""}
                      {edicoes.length > 1 ? ` • ${edicoes.length} correções` : ""}
                    </div>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 900, fontSize: "1.05rem", color: cor.forte }}>
                  {semConferencia ? "Sem conferência" : confere ? "Confere" : dif < 0 ? `Faltou ${fmt(-dif)}` : `Sobrou ${fmt(dif)}`}
                </div>
                <div style={{ fontSize: "0.72rem", color: "#64748B" }}>
                  {semConferencia
                    ? `esperado nas formas ${fmt(conf.esperadoNasFormas)}`
                    : `conferido ${fmt(conf.contado)} de ${fmt(conf.esperadoConferido)}`}
                  {conf.situacao === "PARCIAL" ? ` • ${conf.naoConferidas.length} ${conf.naoConferidas.length === 1 ? "forma" : "formas"} em branco` : ""}
                </div>
              </div>
            </div>

            {semConferencia && (
              <div style={{ padding: "8px 16px", fontSize: "0.78rem", color: "#475569", borderBottom: "1px solid #F1F5F9", lineHeight: 1.5 }}>
                {porQueSemConferencia(conf.motivo)}
                {conf.diferencaGravadaQueNaoVale != null && (
                  <> Gravado na época como {conf.diferencaGravadaQueNaoVale < 0 ? "falta" : "sobra"} de <strong>{fmt(Math.abs(conf.diferencaGravadaQueNaoVale))}</strong>.</>
                )}
              </div>
            )}

            {/* Tabela detalhada: o esperado e o contado de cada forma; a forma
                que ninguém contou diz isso, em vez de "R$ 0,00 | falta". */}
            {(linhas.length > 0 || conf.online > 0.005) && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.83rem" }}>
                <thead>
                  <tr style={{ background: "#F8FAFC" }}>
                    <th style={{ padding: "8px 16px", textAlign: "left", color: "#64748B", fontWeight: 700, borderBottom: "1px solid #E2E8F0" }}>Forma</th>
                    <th style={{ padding: "8px 16px", textAlign: "right", color: "#64748B", fontWeight: 700, borderBottom: "1px solid #E2E8F0" }}>Sistema</th>
                    <th style={{ padding: "8px 16px", textAlign: "right", color: "#64748B", fontWeight: 700, borderBottom: "1px solid #E2E8F0" }}>Contado</th>
                    <th style={{ padding: "8px 16px", textAlign: "right", color: "#64748B", fontWeight: 700, borderBottom: "1px solid #E2E8F0" }}>Dif.</th>
                  </tr>
                </thead>
                <tbody>
                  {linhas.map((l) => (
                    <tr key={l.chave} style={{ borderBottom: "1px solid #F1F5F9" }}>
                      <td style={{ padding: "7px 16px", fontWeight: 600, color: "#334155" }}>{l.nome}</td>
                      <td style={{ padding: "7px 16px", textAlign: "right", color: "#64748B" }}>{fmt(l.esperado)}</td>
                      <td style={{ padding: "7px 16px", textAlign: "right", color: l.contado == null ? "#94A3B8" : "#334155", fontWeight: 700 }}>
                        {l.contado == null ? (semConferencia ? "—" : "não conferido") : fmt(l.contado)}
                        {l.talvezEmBranco && (
                          <span style={{ display: "block", fontSize: "0.66rem", fontWeight: 500, color: "#B45309" }}>pode ter ficado em branco</span>
                        )}
                      </td>
                      <td style={{ padding: "7px 16px", textAlign: "right", fontWeight: 700, color: l.diferenca == null ? "#94A3B8" : Math.abs(l.diferenca) < 0.01 ? "#0F766E" : l.diferenca < 0 ? "#C92E09" : "#B45309" }}>
                        {l.diferenca == null ? "—" : Math.abs(l.diferenca) < 0.01 ? "✓" : l.diferenca > 0 ? `+${fmt(l.diferenca)}` : fmt(l.diferenca)}
                      </td>
                    </tr>
                  ))}
                  {/* O fora da gaveta linha a linha, como no fechamento. */}
                  <ForaDaGavetaDoCaixaFechado sessionId={s.id} />
                </tbody>
                <tfoot>
                  {/* Igual com igual: só as formas contadas, dos dois lados. */}
                  <tr style={{ background: cor.fundo }}>
                    <td style={{ padding: "8px 16px", fontWeight: 900 }}>
                      {semConferencia ? "ESPERADO NAS FORMAS" : "CONFERIDO"}
                      {conf.situacao === "PARCIAL" && <span style={{ display: "block", fontSize: "0.66rem", fontWeight: 500, color: "#64748B" }}>só as formas contadas</span>}
                    </td>
                    <td style={{ padding: "8px 16px", textAlign: "right", fontWeight: 700 }}>{fmt(semConferencia ? conf.esperadoNasFormas : conf.esperadoConferido)}</td>
                    <td style={{ padding: "8px 16px", textAlign: "right", fontWeight: 900, color: cor.forte }}>{semConferencia ? "—" : fmt(conf.contado)}</td>
                    <td style={{ padding: "8px 16px", textAlign: "right", fontWeight: 900, color: cor.forte }}>
                      {semConferencia ? "—" : confere ? "✅ OK" : dif > 0 ? `+${fmt(dif)}` : fmt(dif)}
                    </td>
                  </tr>
                  {!semConferencia && conf.diferencaDasLinhas != null && Math.abs(conf.diferencaDasLinhas - dif) > 0.01 && (
                    <tr>
                      <td colSpan={4} style={{ padding: "4px 16px", fontSize: "0.72rem", color: "#64748B" }}>
                        A diferença gravada inclui {fmt(dif - conf.diferencaDasLinhas)} do pago online: a tela de quem fechou estava desatualizada.
                      </td>
                    </tr>
                  )}
                  {conf.online > 0.005 && (
                    <tr>
                      <td colSpan={4} style={{ padding: "6px 16px", fontSize: "0.75rem", color: "#64748B" }}>
                        Pago online e cobrado pelo app (não se conta na gaveta): <strong>{fmt(conf.online)}</strong> • total do turno {fmt(conf.total)}
                      </td>
                    </tr>
                  )}
                </tfoot>
              </table>
            )}

            {/* Sangria por sangria, reforço por reforço — e a regra do
                dinheiro esperado escrita, para ninguém descontar duas vezes. */}
            <MovimentacoesDoCaixaFechado
              movimentos={movimentosPorCaixa ? movimentosPorCaixa.get(s.id) || [] : null}
              esperadoEmDinheiro={Number(s.expectedCash || 0)}
              trocoInicial={Number(s.openingAmount || 0)}
              fuso={fuso}
              sessionId={s.id}
              caixaDe={fmtHora(s.openedAt)}
              podeLancar={podeCorrigir}
            />

            {/* Como estava antes: cada correção com quem, quando, o motivo e
                o antes → depois de cada forma. A 1ª mostra o fechamento original. */}
            {edicoes.length > 0 && (
              <details style={{ padding: "8px 16px", borderTop: "1px solid #F1F5F9", background: "#FFFBEB" }}>
                <summary style={{ cursor: "pointer", fontSize: "0.78rem", fontWeight: 800, color: "#92400E" }}>
                  Ver como estava antes da correção{edicoes.length > 1 ? ` (${edicoes.length} correções)` : ""}
                </summary>
                {edicoes.map((e, i) => {
                  const mudou = formasAlteradas(e.antes, e.depois);
                  return (
                    <div key={e.id} style={{ marginTop: 10, fontSize: "0.78rem", color: "#334155" }}>
                      <div style={{ fontWeight: 800 }}>
                        {i === 0 ? "Fechamento original" : `Antes da ${i + 1}ª correção`} → corrigido em {fmtDate(e.createdAt)} por {e.editadoPor}{e.suporte ? ` (${e.suporte})` : ""}
                      </div>
                      {e.motivo && <div style={{ color: "#64748B", marginTop: 2 }}>Motivo: {e.motivo}</div>}
                      <table style={{ borderCollapse: "collapse", marginTop: 6, fontSize: "0.78rem" }}>
                        <thead>
                          <tr>
                            <th style={{ padding: "3px 12px 3px 0", textAlign: "left", color: "#64748B" }}>Forma</th>
                            <th style={{ padding: "3px 12px", textAlign: "right", color: "#64748B" }}>Antes</th>
                            <th style={{ padding: "3px 12px", textAlign: "right", color: "#64748B" }}>Depois</th>
                          </tr>
                        </thead>
                        <tbody>
                          {e.antes.expectedCash != null && e.depois.expectedCash != null && Math.abs(e.antes.expectedCash - e.depois.expectedCash) > 0.004 && (
                            <tr>
                              <td style={{ padding: "3px 12px 3px 0", fontWeight: 600 }}>Dinheiro esperado</td>
                              <td style={{ padding: "3px 12px", textAlign: "right", textDecoration: "line-through", color: "#94A3B8" }}>{fmt(e.antes.expectedCash)}</td>
                              <td style={{ padding: "3px 12px", textAlign: "right", fontWeight: 700 }}>{fmt(e.depois.expectedCash)}</td>
                            </tr>
                          )}
                          {mudou.map((l) => (
                            <tr key={l.chave}>
                              <td style={{ padding: "3px 12px 3px 0", fontWeight: 600 }}>{l.nome}</td>
                              <td style={{ padding: "3px 12px", textAlign: "right", textDecoration: "line-through", color: "#94A3B8" }}>{l.antes == null ? "não conferido" : fmt(l.antes)}</td>
                              <td style={{ padding: "3px 12px", textAlign: "right", fontWeight: 700 }}>{l.depois == null ? "não conferido" : fmt(l.depois)}</td>
                            </tr>
                          ))}
                          <tr>
                            <td style={{ padding: "3px 12px 3px 0", fontWeight: 600 }}>Resultado</td>
                            <td style={{ padding: "3px 12px", textAlign: "right", color: "#94A3B8" }}>{fmtDif(e.antes.difference)}</td>
                            <td style={{ padding: "3px 12px", textAlign: "right", fontWeight: 700 }}>{fmtDif(e.depois.difference)}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })}
              </details>
            )}

            <div style={{ padding: "8px 16px", borderTop: "1px solid #F1F5F9", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: "0.75rem", color: "#94A3B8" }}>
                Abertura: {fmt(s.openingAmount || 0)} em troco inicial (dentro do dinheiro esperado)
                {s.justification ? ` • Justificativa: ${s.justification}` : ""}
              </span>
              {/* Segunda via: papel some, e a conferência do dinheiro não pode
                  depender de alguém transcrever a tela à mão. */}
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", flex: "1 1 auto" }}>
                <BotaoImprimirCaixa sessionId={s.id} comPdf />
                {podeCorrigir && (
                  <CorrigirCaixaFechado
                    sessionId={s.id}
                    formas={FORMAS_DA_CONFERENCIA.map((f) => {
                      const raw = s as unknown as Record<string, unknown>;
                      const contado = raw[f.contado];
                      return {
                        chave: f.chave,
                        nome: f.nome,
                        esperado: Number(raw[f.esperado] || 0),
                        // O caixa sem conferência começa em branco; o resto, com o que foi digitado.
                        contado: semConferencia || contado == null ? null : Number(contado),
                      };
                    })}
                  />
                )}
              </div>
            </div>
            {/* O extrato do caixa por tipo de venda (Delivery, Retirada,
                Balcão, Mesas, Totem), apurado só quando o lojista pede — o
                papel reimpresso traz o mesmo, bloco por bloco. */}
            <div style={{ padding: "0 16px 10px" }}>
              <VendasPorTipoDoHistorico sessionId={s.id} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
