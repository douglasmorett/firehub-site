"use client";
/**
 * O cartão "Indique e ganhe" da aba Mensalidade (lib/indique-e-ganhe.ts).
 *
 * Mora aqui porque é na mensalidade que o prêmio aparece: o desconto de
 * R$ 100 sai no boleto desta aba, e a isenção também. Lê de
 * /api/store/indique-e-ganhe; se a rota falhar, o cartão some — a aba
 * Mensalidade continua inteira.
 */
import { useEffect, useState } from "react";
import { TEXTO_DA_SITUACAO, type SituacaoDaIndicacao } from "@/lib/indique-e-ganhe";
import { fmtR } from "./ui";

type Dados = {
  link: string;
  mensagem: string;
  valorDoCredito: number;
  indicadosParaIsencao: number;
  lojaPrincipal: string | null;
  saldo: number;
  ativosPagantes: number;
  isenta: boolean;
  indicacoes: { loja: string; cadastradaEm: string; situacao: SituacaoDaIndicacao; motivo: string | null }[];
};

const COR_DA_SITUACAO: Record<SituacaoDaIndicacao, { fundo: string; texto: string }> = {
  EM_TESTE: { fundo: "#FFF7E6", texto: "#92400E" },
  AGUARDANDO_PAGAMENTO: { fundo: "#EFF6FF", texto: "#1D4ED8" },
  CREDITO_GERADO: { fundo: "#ECFDF5", texto: "#047857" },
  CREDITO_USADO: { fundo: "#F1F5F9", texto: "#334155" },
  NAO_VALEU: { fundo: "#FEF2F2", texto: "#B91C1C" },
};

export default function CartaoIndiqueEGanhe() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch("/api/store/indique-e-ganhe", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => vivo && j && setDados(j))
      .catch(() => {});
    return () => { vivo = false; };
  }, []);

  if (!dados) return null;

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(dados.link);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      // Navegador sem permissão de área de transferência: o link está na
      // caixa, selecionável à mão.
    }
  };
  const whatsapp = `https://wa.me/?text=${encodeURIComponent(dados.mensagem)}`;
  const meta = dados.indicadosParaIsencao;
  const progresso = Math.min(100, Math.round((dados.ativosPagantes / meta) * 100));

  return (
    <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 20, padding: "1.5rem", color: "#0F172A" }}>
      <span style={{ background: "#FEF2F2", color: "#B91C1C", padding: "4px 12px", borderRadius: 20, fontSize: "0.78rem", fontWeight: 900 }}>🎁 Indique e ganhe</span>
      <h2 style={{ fontSize: "1.3rem", fontWeight: 900, margin: "8px 0 4px" }}>
        Ganhe {fmtR(dados.valorDoCredito)} de desconto na sua mensalidade
      </h2>
      <p style={{ margin: 0, fontSize: "0.88rem", color: "#475569" }}>
        Ganhe {fmtR(dados.valorDoCredito)} de desconto na sua mensalidade para cada restaurante indicado que pagar a primeira mensalidade.
        A partir de {meta} indicados ativos e pagantes, você fica isento da mensalidade{dados.lojaPrincipal ? " da loja principal" : ""}.
      </p>
      {dados.lojaPrincipal && (
        <p style={{ margin: "6px 0 0", fontSize: "0.8rem", color: "#64748B" }}>
          O link é da sua conta: o desconto e a isenção valem na mensalidade da loja principal ({dados.lojaPrincipal}).
        </p>
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: "1rem" }}>
        <input
          readOnly
          value={dados.link}
          onFocus={(e) => e.currentTarget.select()}
          aria-label="Seu link de indicação"
          style={{ flex: "1 1 260px", minWidth: 0, padding: "11px 12px", border: "1px solid #CBD5E1", borderRadius: 10, fontSize: "0.86rem", color: "#0F172A", background: "#F8FAFC", fontFamily: "inherit" }}
        />
        <button onClick={copiar} style={{ background: copiado ? "#047857" : "#0F172A", color: "#fff", border: "none", padding: "11px 18px", borderRadius: 10, fontWeight: 800, fontSize: "0.88rem", cursor: "pointer", fontFamily: "inherit" }}>
          {copiado ? "✓ Link copiado" : "Copiar link"}
        </button>
        <a href={whatsapp} target="_blank" rel="noreferrer" style={{ background: "#15803D", color: "#fff", textDecoration: "none", padding: "11px 18px", borderRadius: 10, fontWeight: 800, fontSize: "0.88rem" }}>
          Compartilhar no WhatsApp
        </a>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginTop: "1.1rem" }}>
        <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 14, padding: "0.9rem 1rem" }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748B" }}>CRÉDITO GUARDADO</div>
          <div style={{ fontSize: "1.3rem", fontWeight: 900 }}>{fmtR(dados.saldo)}</div>
          <div style={{ fontSize: "0.74rem", color: "#64748B" }}>
            {dados.isenta && dados.saldo > 0 ? "fica guardado enquanto a mensalidade estiver isenta" : "abate na próxima mensalidade gerada"}
          </div>
        </div>
        <div style={{ background: dados.isenta ? "#ECFDF5" : "#F8FAFC", border: `1px solid ${dados.isenta ? "#A7F3D0" : "#E2E8F0"}`, borderRadius: 14, padding: "0.9rem 1rem" }}>
          <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#64748B" }}>ISENÇÃO DA MENSALIDADE</div>
          {dados.isenta ? (
            <div style={{ fontSize: "1rem", fontWeight: 900, color: "#047857", marginTop: 2 }}>Você está isento da mensalidade 🎉</div>
          ) : (
            <div style={{ fontSize: "0.95rem", fontWeight: 800, marginTop: 2 }}>
              {dados.ativosPagantes} de {meta} indicações ativas para ficar isento da mensalidade
            </div>
          )}
          <div style={{ height: 6, background: "#E2E8F0", borderRadius: 4, marginTop: 8, overflow: "hidden" }}>
            <div style={{ width: `${progresso}%`, height: "100%", background: dados.isenta ? "#047857" : "#EF4444" }} />
          </div>
          <div style={{ fontSize: "0.72rem", color: "#64748B", marginTop: 6 }}>ativa = saiu do teste, já pagou e está com a mensalidade em dia</div>
        </div>
      </div>

      <div style={{ marginTop: "1.1rem" }}>
        <div style={{ fontSize: "0.8rem", fontWeight: 800, color: "#334155", marginBottom: 6 }}>Suas indicações</div>
        {dados.indicacoes.length === 0 ? (
          <div style={{ fontSize: "0.84rem", color: "#64748B" }}>Nenhum restaurante se cadastrou pelo seu link ainda.</div>
        ) : (
          <div style={{ border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden" }}>
            {dados.indicacoes.map((i, n) => (
              <div key={n} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, padding: "9px 12px", borderTop: n ? "1px solid #F1F5F9" : "none", flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: "0.86rem" }}>{i.loja}</div>
                  <div style={{ fontSize: "0.72rem", color: "#64748B" }}>cadastro em {new Date(i.cadastradaEm).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}</div>
                </div>
                <span style={{ background: COR_DA_SITUACAO[i.situacao].fundo, color: COR_DA_SITUACAO[i.situacao].texto, padding: "3px 10px", borderRadius: 20, fontSize: "0.74rem", fontWeight: 800, whiteSpace: "nowrap" }}>
                  {TEXTO_DA_SITUACAO[i.situacao]}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
