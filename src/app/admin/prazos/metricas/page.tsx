import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { redirect } from "next/navigation";
import AdminSidebar from "@/components/AdminSidebar";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const metadata = { title: "FireHub Prazos — o que acontece na página de venda" };

/**
 * O painel da página de venda: quem chegou, quanto ficou, até onde leu e
 * onde desistiu.
 *
 * Os números vêm da tabela "PrazoVisita", preenchida por
 * `src/app/prazos/MedidorDaPagina.tsx`. Ela é lida por SQL cru porque não
 * está no schema.prisma de propósito — se a tabela ainda não existir, o que
 * falha é esta tela, e não o site (ver /api/admin/prazos-visitas).
 *
 * As perguntas que esta tela responde, nesta ordem, que é a ordem em que a
 * venda morre:
 *   1. chegou gente? (visitas, por origem)
 *   2. ficou? (tempo visível, mediana — média mente com aba esquecida)
 *   3. leu até o preço? (marco "viu-preco")
 *   4. clicou? (foi-ao-checkout / chamou-no-zap)
 *
 * O que ela NÃO responde: se a venda aconteceu. Isso é a Cakto — e é assim
 * que tem que ser, porque quem conta dinheiro é quem recebe.
 */

type Linha = {
  sessao: string;
  em: Date;
  origem: string | null;
  campanha: string | null;
  gatilho: string | null;
  dispositivo: string | null;
  segundos: number;
  rolagem: number;
  cliquesCta: number;
  cliquesZap: number;
  planoVisto: number | null;
  marcos: string[];
};

function mediana(ns: number[]): number {
  if (ns.length === 0) return 0;
  const o = [...ns].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : Math.round((o[m - 1] + o[m]) / 2);
}

function tempo(s: number): string {
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}min ${String(s % 60).padStart(2, "0")}s`;
}

function pct(parte: number, total: number): string {
  if (!total) return "—";
  return `${Math.round((parte / total) * 100)}%`;
}

export default async function MetricasPrazosPage({
  searchParams,
}: {
  searchParams: Promise<{ dias?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session) redirect("/login");
  if ((session.user as any)?.role !== "ADMIN") redirect("/store");

  const { dias: diasParam } = await searchParams;
  const dias = Math.max(1, Math.min(90, Number(diasParam) || 7));

  let linhas: Linha[] = [];
  let erro: string | null = null;
  try {
    linhas = await prisma.$queryRawUnsafe<Linha[]>(
      `SELECT "sessao","em","origem","campanha","gatilho","dispositivo","segundos","rolagem",
              "cliquesCta","cliquesZap","planoVisto", "marcos"
         FROM "PrazoVisita"
        WHERE "em" > (CURRENT_TIMESTAMP - ($1 || ' days')::interval)
        ORDER BY "em" DESC
        LIMIT 5000;`,
      String(dias),
    );
  } catch (e: any) {
    erro = e?.message?.includes("PrazoVisita")
      ? 'A tabela ainda não existe. Abra /api/admin/prazos-visitas?criar=sim uma vez.'
      : e?.message || "Falha ao ler";
  }

  const total = linhas.length;
  const tem = (m: string) => linhas.filter((l) => (l.marcos || []).includes(m)).length;
  const comCta = linhas.filter((l) => l.cliquesCta > 0).length;
  const comZap = linhas.filter((l) => l.cliquesZap > 0).length;
  const segundos = linhas.map((l) => l.segundos);
  const rejeicao = linhas.filter((l) => l.segundos < 10).length;
  const celular = linhas.filter((l) => l.dispositivo === "celular").length;

  const porChave = (get: (l: Linha) => string | null) => {
    const m = new Map<string, { visitas: number; cta: number }>();
    for (const l of linhas) {
      const k = get(l) || "—";
      const a = m.get(k) || { visitas: 0, cta: 0 };
      a.visitas += 1;
      if (l.cliquesCta > 0) a.cta += 1;
      m.set(k, a);
    }
    return [...m.entries()].sort((a, b) => b[1].visitas - a[1].visitas).slice(0, 12);
  };

  const cartao: React.CSSProperties = {
    background: "var(--bg-card, #fff)", border: "1px solid #E2E8F0", borderRadius: 14,
    padding: "1rem 1.2rem",
  };
  const rotulo: React.CSSProperties = { fontSize: ".72rem", fontWeight: 800, color: "#64748B", textTransform: "uppercase", letterSpacing: ".4px" };
  const numero: React.CSSProperties = { fontSize: "1.9rem", fontWeight: 900, lineHeight: 1.1, marginTop: 4 };
  const th: React.CSSProperties = { textAlign: "left", fontSize: ".74rem", color: "#64748B", fontWeight: 800, padding: "8px 10px", textTransform: "uppercase" };
  const td: React.CSSProperties = { padding: "8px 10px", borderTop: "1px solid #E2E8F0", fontSize: ".9rem" };

  return (
    <div style={{ display: "flex", minHeight: "100vh", backgroundColor: "var(--bg-body)" }}>
      <AdminSidebar />
      <main style={{ flex: 1, marginLeft: "250px", padding: "2rem" }} className="admin-main-content">
        <h1 style={{ fontSize: "1.6rem", fontWeight: 900, margin: "0 0 4px" }}>Página de venda do Prazos</h1>
        <p style={{ color: "#64748B", margin: "0 0 18px" }}>
          O que acontece em <b>/prazos</b> nos últimos {dias} dias. Venda mesmo, quem conta é a Cakto.
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {[1, 7, 30].map((d) => (
            <a
              key={d}
              href={`/admin/prazos/metricas?dias=${d}`}
              style={{
                padding: "7px 14px", borderRadius: 999, textDecoration: "none", fontWeight: 800, fontSize: ".85rem",
                background: d === dias ? "#E8590C" : "#F1F5F9", color: d === dias ? "#fff" : "#334155",
              }}
            >
              {d === 1 ? "hoje" : `${d} dias`}
            </a>
          ))}
          <a href="/admin/prazos" style={{ padding: "7px 14px", borderRadius: 999, background: "#F1F5F9", color: "#334155", textDecoration: "none", fontWeight: 800, fontSize: ".85rem" }}>
            contas da extensão →
          </a>
        </div>

        {erro && (
          <div style={{ ...cartao, borderColor: "#FECACA", background: "#FEF2F2", color: "#B71C1C", marginBottom: 18 }}>
            <b>Não deu para ler as visitas.</b> {erro}
          </div>
        )}

        {/* O funil, na ordem em que a venda morre. */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12, marginBottom: 18 }}>
          <div style={cartao}>
            <div style={rotulo}>Visitas</div>
            <div style={numero}>{total}</div>
            <div style={{ color: "#64748B", fontSize: ".85rem" }}>{pct(celular, total)} no celular</div>
          </div>
          <div style={cartao}>
            <div style={rotulo}>Tempo na página</div>
            <div style={numero}>{tempo(mediana(segundos))}</div>
            <div style={{ color: "#64748B", fontSize: ".85rem" }}>mediana, só com a aba à vista</div>
          </div>
          <div style={cartao}>
            <div style={rotulo}>Saíram em 10s</div>
            <div style={{ ...numero, color: rejeicao / (total || 1) > 0.5 ? "#C92E09" : undefined }}>{pct(rejeicao, total)}</div>
            <div style={{ color: "#64748B", fontSize: ".85rem" }}>{rejeicao} visitas</div>
          </div>
          <div style={cartao}>
            <div style={rotulo}>Chegaram ao preço</div>
            <div style={numero}>{pct(tem("viu-preco"), total)}</div>
            <div style={{ color: "#64748B", fontSize: ".85rem" }}>{tem("viu-preco")} visitas</div>
          </div>
          <div style={cartao}>
            <div style={rotulo}>Clicaram em assinar</div>
            <div style={{ ...numero, color: "#0F766E" }}>{pct(comCta, total)}</div>
            <div style={{ color: "#64748B", fontSize: ".85rem" }}>{comCta} foram ao checkout</div>
          </div>
          <div style={cartao}>
            <div style={rotulo}>Chamaram no zap</div>
            <div style={numero}>{comZap}</div>
            <div style={{ color: "#64748B", fontSize: ".85rem" }}>{pct(comZap, total)} das visitas</div>
          </div>
        </div>

        {/* Onde a leitura para. Cada linha é uma dobra da página. */}
        <div style={{ ...cartao, marginBottom: 18 }}>
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Até onde a página é lida</div>
          {[
            ["Viu a demonstração do topo", "viu-demonstracao"],
            ["Viu quem indica", "viu-quem-indica"],
            ["Chegou ao preço", "viu-preco"],
            ["Abriu a calculadora", "abriu-calculadora"],
            ["Abriu alguma pergunta do FAQ", "abriu-faq"],
            ["Escolheu uma faixa de lojas", "escolheu-plano"],
            ["Rolou até o fim", "chegou-ao-fim"],
            ["Foi ao checkout", "foi-ao-checkout"],
          ].map(([nome, marco]) => {
            const n = tem(marco);
            const p = total ? (n / total) * 100 : 0;
            return (
              <div key={marco} style={{ display: "flex", alignItems: "center", gap: 12, padding: "5px 0" }}>
                <div style={{ width: 230, fontSize: ".9rem", color: "#334155" }}>{nome}</div>
                <div style={{ flex: 1, height: 12, background: "#F1F5F9", borderRadius: 999, overflow: "hidden" }}>
                  <div style={{ width: `${p}%`, height: "100%", background: marco === "foi-ao-checkout" ? "#0F766E" : "#E8590C" }} />
                </div>
                <div style={{ width: 90, textAlign: "right", fontWeight: 800, fontSize: ".9rem" }}>
                  {n} · {pct(n, total)}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 12, marginBottom: 18 }}>
          {[
            ["De onde vieram", porChave((l) => l.origem)],
            ["Campanha", porChave((l) => l.campanha)],
            ["Gancho do anúncio (?g=)", porChave((l) => l.gatilho)],
          ].map(([titulo, itens]) => (
            <div key={titulo as string} style={cartao}>
              <div style={{ fontWeight: 900, marginBottom: 8 }}>{titulo as string}</div>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr><th style={th}>chave</th><th style={{ ...th, textAlign: "right" }}>visitas</th><th style={{ ...th, textAlign: "right" }}>clicaram</th></tr>
                </thead>
                <tbody>
                  {(itens as [string, { visitas: number; cta: number }][]).map(([k, v]) => (
                    <tr key={k}>
                      <td style={td}>{k}</td>
                      <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{v.visitas}</td>
                      <td style={{ ...td, textAlign: "right", color: v.cta ? "#0F766E" : "#94A3B8", fontWeight: 800 }}>
                        {v.cta} · {pct(v.cta, v.visitas)}
                      </td>
                    </tr>
                  ))}
                  {(itens as unknown[]).length === 0 && (
                    <tr><td style={{ ...td, color: "#94A3B8" }} colSpan={3}>nada ainda</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          ))}
        </div>

        {/* As últimas visitas, uma por linha: é aqui que se vê o caso raro
            (ficou 6 minutos e não clicou) que nenhuma média mostra. */}
        <div style={cartao}>
          <div style={{ fontWeight: 900, marginBottom: 8 }}>Últimas visitas</div>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={th}>quando</th>
                  <th style={th}>origem</th>
                  <th style={th}>aparelho</th>
                  <th style={{ ...th, textAlign: "right" }}>tempo</th>
                  <th style={{ ...th, textAlign: "right" }}>rolagem</th>
                  <th style={th}>o que fez</th>
                </tr>
              </thead>
              <tbody>
                {linhas.slice(0, 60).map((l) => (
                  <tr key={l.sessao}>
                    <td style={td}>{new Date(l.em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                    <td style={td}>{l.origem || "—"}{l.gatilho ? ` · ${l.gatilho}` : ""}</td>
                    <td style={td}>{l.dispositivo === "celular" ? "📱" : "💻"}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 700 }}>{tempo(l.segundos)}</td>
                    <td style={{ ...td, textAlign: "right" }}>{l.rolagem}%</td>
                    <td style={{ ...td, fontSize: ".82rem", color: "#475569" }}>
                      {l.cliquesCta > 0 && <b style={{ color: "#0F766E" }}>foi ao checkout · </b>}
                      {l.cliquesZap > 0 && <b style={{ color: "#0F766E" }}>chamou no zap · </b>}
                      {(l.marcos || []).filter((m) => m !== "foi-ao-checkout" && m !== "chamou-no-zap").join(" · ") || "—"}
                      {l.planoVisto ? ` · olhou ${l.planoVisto} loja(s)` : ""}
                    </td>
                  </tr>
                ))}
                {total === 0 && !erro && (
                  <tr><td style={{ ...td, color: "#94A3B8" }} colSpan={6}>Nenhuma visita registrada nesse período.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
