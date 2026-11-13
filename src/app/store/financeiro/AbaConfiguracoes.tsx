"use client";
/**
 * Configurações do Financeiro: a COMISSÃO E AS TAXAS DE CADA APP (que o DRE
 * usa na linha "Comissão e taxas dos apps") e a conta de repasse guardada.
 *
 * Desde 13/11/2026 (Frangoso) cada app tem três campos — comissão sobre os
 * itens, pagamento online só no pedido pago no app e outras taxas — em vez de
 * um percentual único (ver "COMISSÃO DOS APPS" em lib/financeiro/dre.ts). A
 * loja que tinha o percentual único continua com ele como comissão (mesmo
 * DRE) e vê o aviso de que pode separar.
 *
 * O formulário de repasse que morava aqui não gravava nada: os campos não
 * tinham estado e o botão "Salvar Conta de Repasse" só mostrava um alert de
 * sucesso (auditoria de 11/10/2026). A chave fica em Minha Loja, que grava de
 * verdade; aqui ela só aparece, com o aviso de que o repasse automático ainda
 * não existe.
 */
import { useState } from "react";
import { Building2, Percent } from "lucide-react";
import AjudaModulo from "@/components/AjudaModulo";
import { CANAIS_COM_COMISSAO, type ComissoesDosApps, type ResultadoDoDRE, type TaxasDosApps } from "@/lib/financeiro/dre";
import { fmtNum, fmtR } from "./ui";

type CamposDoApp = { comissao: string; online: string; outras: string };
const emTexto = (v: number | undefined) => (typeof v === "number" ? String(v).replace(".", ",") : "");

function CampoPct({ id, rotulo, valor, onChange }: { id: string; rotulo: string; valor: string; onChange: (v: string) => void }) {
  return (
    <label htmlFor={id} style={{ flex: "1 1 150px", display: "flex", flexDirection: "column", gap: 4, fontSize: "0.74rem", fontWeight: 700, color: "#475569" }}>
      {rotulo}
      <span style={{ position: "relative", display: "block" }}>
        <input
          id={id}
          inputMode="decimal"
          placeholder="—"
          value={valor}
          onChange={(e) => onChange(e.target.value.replace(/[^\d,.]/g, ""))}
          style={{ width: "100%", padding: "9px 30px 9px 12px", borderRadius: 10, border: "1.5px solid #E2E8F0", fontSize: "0.9rem", boxSizing: "border-box", fontFamily: "inherit" }}
        />
        <span style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", color: "#64748B", fontWeight: 700 }}>%</span>
      </span>
    </label>
  );
}

export default function AbaConfiguracoes({
  comissoes, taxasDosApps, onSalvo, dre, repasseConfig,
}: {
  comissoes: ComissoesDosApps;
  taxasDosApps: TaxasDosApps;
  onSalvo: (c: ComissoesDosApps, t: TaxasDosApps) => void;
  dre: ResultadoDoDRE | null;
  repasseConfig: any;
}) {
  const [campos, setCampos] = useState<Record<string, CamposDoApp>>(() => {
    const t: Record<string, CamposDoApp> = {};
    for (const { chave } of CANAIS_COM_COMISSAO) {
      const tx = taxasDosApps[chave];
      t[chave] = {
        comissao: emTexto(comissoes[chave]),
        // Zero gravado aparece em branco: "não cobra" e "não sei" dão a mesma conta.
        online: tx?.pagamentoOnline ? emTexto(tx.pagamentoOnline) : "",
        outras: tx?.outras ? emTexto(tx.outras) : "",
      };
    }
    return t;
  });
  const [salvando, setSalvando] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  const vendasNoPeriodo = new Map((dre?.comissoes || []).map((c) => [c.canal as string, c]));
  // A loja que cadastrou o percentual único (antes de 13/11/2026) e ainda não separou.
  const percentualUnico = (chave: string) => typeof comissoes[chave as keyof ComissoesDosApps] === "number" && !taxasDosApps[chave as keyof TaxasDosApps];
  const algumUnico = CANAIS_COM_COMISSAO.some(({ chave }) => percentualUnico(chave));
  const mudar = (chave: string, campo: keyof CamposDoApp, v: string) => setCampos((t) => ({ ...t, [chave]: { ...t[chave], [campo]: v } }));

  async function salvar() {
    setSalvando(true);
    setAviso(null);
    try {
      const comissoesDoForm: Record<string, string> = {};
      const taxas: Record<string, { pagamentoOnline: string; outras: string }> = {};
      for (const [chave, c] of Object.entries(campos)) {
        comissoesDoForm[chave] = c.comissao;
        taxas[chave] = { pagamentoOnline: c.online, outras: c.outras };
      }
      const res = await fetch("/api/store/financeiro/comissao-dos-apps", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comissoes: comissoesDoForm, taxas }),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) { setAviso({ ok: false, texto: j?.error || "Não foi possível salvar. Tente de novo." }); return; }
      onSalvo(j?.comissoes || {}, j?.taxas || {});
      setAviso({ ok: true, texto: "Percentuais salvos. O DRE já usa os novos valores." });
    } catch {
      setAviso({ ok: false, texto: "Sem conexão. Tente de novo." });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div style={{ maxWidth: 760 }}>
      <AjudaModulo
        icone="⚙️"
        titulo="Configurações do financeiro"
        oQueE="Aqui você informa quanto cada app (iFood, 99Food, Keeta…) cobra da loja, para o DRE descontar do resultado."
        paraQueServe="Sem a comissão, o DRE não sabe quanto o app fica de cada venda — e mostra o resultado como incompleto em vez de inventar um número."
        passos={[
          { titulo: "Pegue o contrato ou o extrato do app", texto: "veja a comissão do seu plano e a taxa de pagamento online (o iFood chama de taxa de transação)." },
          { titulo: "Separe os percentuais", texto: "comissão num campo, pagamento online no outro. Exemplo: iFood plano Entrega = 23% de comissão + 3,2% de pagamento online." },
          { titulo: "Salve", texto: "o DRE cobra a comissão de todo pedido do app e o pagamento online só dos pedidos pagos dentro do app." },
        ]}
      />

      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: "1.5rem", marginBottom: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "0.5rem" }}>
          <Percent size={20} color="#C92E09" />
          <h4 style={{ fontWeight: 800, fontSize: "1rem", margin: 0, color: "#0F172A" }}>Comissão e taxas dos apps</h4>
        </div>
        <div style={{ fontSize: "0.8rem", color: "#64748B", margin: "0 0 1rem", lineHeight: 1.6 }}>
          <p style={{ margin: "0 0 6px" }}>Cada app cobra de um jeito, e cada loja tem o seu plano. Preencha o que o seu contrato diz:</p>
          <ul style={{ margin: "0 0 6px", paddingLeft: 18 }}>
            <li><strong>Comissão da plataforma</strong>: sobre o valor dos itens, em todo pedido do app.</li>
            <li><strong>Pagamento online no app</strong>: só nos pedidos que o cliente pagou dentro do app.</li>
            <li><strong>Outras taxas / antecipação</strong> (se tiver): sobre o valor dos itens, em todo pedido do app.</li>
          </ul>
          <p style={{ margin: "0 0 6px" }}>Exemplo: <strong>iFood plano Entrega: 23% comissão + 3,2% pagamento online</strong>. Confira no seu contrato — cada loja negocia o seu. Deixe em branco o app que você não usa.</p>
          <p style={{ margin: 0 }}>
            Pedido do app pago <strong>na entrega</strong> não paga o pagamento online do app: no cartão, paga a taxa da sua maquininha,
            que você cadastra em <a href="/store/minha-loja#pagamento" style={{ color: "#0F766E", fontWeight: 700 }}>Minha Loja › Pagamentos</a>.
            Dinheiro e Pix na entrega não têm taxa de cartão.
          </p>
        </div>
        {algumUnico && (
          <div role="status" style={{ margin: "0 0 1rem", padding: "10px 12px", borderRadius: 10, fontSize: "0.8rem", lineHeight: 1.55, background: "#FFFBEB", color: "#92400E", border: "1px solid #FDE68A" }}>
            <strong>Agora dá para separar.</strong> O percentual que você já tinha cadastrado continua valendo como está: o DRE cobra ele de todo
            pedido do app, e nada mudou nos seus números. Se ele já soma o pagamento online (ex.: 26,2 = 23 + 3,2), deixe só a comissão no primeiro
            campo e o pagamento online no segundo — o DRE passa a cobrar o online só dos pedidos pagos dentro do app.
          </div>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {CANAIS_COM_COMISSAO.map(({ chave, nome }) => {
            const doPeriodo = vendasNoPeriodo.get(chave);
            const c = campos[chave] || { comissao: "", online: "", outras: "" };
            return (
              <div key={chave} style={{ borderTop: "1px solid #F1F5F9", paddingTop: 12 }}>
                <div style={{ fontWeight: 800, fontSize: "0.9rem", color: "#334155", marginBottom: 6 }}>
                  {nome}
                  {doPeriodo && (
                    <span style={{ display: "block", fontWeight: 500, fontSize: "0.74rem", color: doPeriodo.pct === null ? "#B45309" : "#64748B" }}>
                      {fmtNum(doPeriodo.pedidos)} pedidos no período · itens de {fmtR(doPeriodo.base)}
                      {doPeriodo.online.pedidos > 0 ? ` · ${fmtNum(doPeriodo.online.pedidos)} pagos no app` : ""}
                      {doPeriodo.naEntrega.cartao.pedidos + doPeriodo.naEntrega.semCartao.pedidos > 0 ? ` · ${fmtNum(doPeriodo.naEntrega.cartao.pedidos + doPeriodo.naEntrega.semCartao.pedidos)} pagos na entrega` : ""}
                      {doPeriodo.pct === null ? " · sem comissão" : ""}
                    </span>
                  )}
                  {percentualUnico(chave) && (
                    <span style={{ display: "block", fontWeight: 600, fontSize: "0.74rem", color: "#B45309" }}>
                      Percentual único (comissão + taxas juntas): separe se ele inclui o pagamento online.
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <CampoPct id={`comissao-${chave}`} rotulo="Comissão da plataforma" valor={c.comissao} onChange={(v) => mudar(chave, "comissao", v)} />
                  <CampoPct id={`online-${chave}`} rotulo="Pagamento online no app" valor={c.online} onChange={(v) => mudar(chave, "online", v)} />
                  <CampoPct id={`outras-${chave}`} rotulo="Outras taxas / antecipação" valor={c.outras} onChange={(v) => mudar(chave, "outras", v)} />
                </div>
              </div>
            );
          })}
        </div>
        {aviso && (
          <div role={aviso.ok ? "status" : "alert"} style={{
            marginTop: 12, padding: "9px 12px", borderRadius: 10, fontSize: "0.82rem", fontWeight: 700,
            background: aviso.ok ? "#F0FDFA" : "#FEF2F2", color: aviso.ok ? "#0F766E" : "#B71C1C", border: `1px solid ${aviso.ok ? "#99F6E4" : "#FECACA"}`,
          }}>
            {aviso.texto}
          </div>
        )}
        <button onClick={salvar} disabled={salvando} style={{
          marginTop: 14, padding: "11px 18px", borderRadius: 10, border: "none", background: salvando ? "#94A3B8" : "#C92E09",
          color: "#fff", fontWeight: 800, cursor: salvando ? "wait" : "pointer", fontFamily: "inherit",
        }}>
          {salvando ? "Salvando…" : "Salvar percentuais"}
        </button>
      </div>

      <div style={{ background: "#fff", border: "1px solid #E2E8F0", borderRadius: 16, padding: "1.5rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "0.5rem" }}>
          <Building2 size={20} color="#0F766E" />
          <h4 style={{ fontWeight: 800, fontSize: "1rem", margin: 0, color: "#0F172A" }}>Conta de repasse</h4>
        </div>
        <p style={{ fontSize: "0.82rem", color: "#475569", margin: "0 0 10px", lineHeight: 1.6 }}>
          O repasse automático <strong>ainda não está ativo</strong>. Hoje o Pix e o cartão pagos pelo site caem direto na sua conta Asaas, e
          o dinheiro dos apps chega pelo repasse de cada app — o FireHub não guarda dinheiro da loja.
        </p>
        <div style={{ fontSize: "0.84rem", color: "#334155", background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 10, padding: "10px 12px" }}>
          {repasseConfig?.chavePix
            ? <>Chave Pix guardada: <strong>{repasseConfig.chavePix}</strong>{repasseConfig.titular ? <> · titular {repasseConfig.titular}</> : null}</>
            : "Nenhuma chave Pix guardada."}
        </div>
        <a href="/store/minha-loja" style={{ display: "inline-block", marginTop: 10, fontSize: "0.82rem", fontWeight: 700, color: "#0F766E" }}>
          Alterar a chave em Minha Loja →
        </a>
      </div>
    </div>
  );
}
