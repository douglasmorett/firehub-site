"use client";
import { useState } from "react";
import { Save, Copy, Trash2, Plus, Tag } from "lucide-react";
import { FORMAS_DO_CUPOM, chaveDaPropria, lerFormasDoCupom, lerValesFora } from "@/lib/cupom-por-forma";

/**
 * O cupom como fica gravado em `storeCoupons`. A régua que lê isto é
 * lib/cupons.ts — o servidor valida com ela no checkout e em
 * /api/validate-coupon; esta tela só edita.
 *
 * Os três últimos campos entraram em 17/09/2026 a pedido do dono e são
 * opcionais: cupom antigo sem eles continua valendo exatamente como valia.
 */
export type Coupon = {
  id?: string;
  code: string;
  discount: number;
  type?: "percent" | "fixed" | "free_shipping";
  minOrderValue?: number;
  active: boolean;
  /** Último dia válido ("YYYY-MM-DD", no dia da loja). Vazio = não vence. */
  validade?: string | null;
  /** Quantas vezes o MESMO telefone pode usar. 0/vazio = sem limite. */
  usosPorCliente?: number | null;
  /** O limite de usos por cliente recomeça todo mês (lib/cupons.ts). */
  usosPorMes?: boolean;
  /** Só para quem nunca pediu pelo site; o site aplica sozinho e avisa. */
  primeiroPedido?: boolean;
  /** Em quais formas de pagamento vale (lib/cupom-por-forma.ts). Ausente = todas. */
  formasDePagamento?: string[];
  /** Bandeiras de Vale em que não vale. */
  valesFora?: string[];
};

/**
 * "Vale nas formas de pagamento" do cupom (Ligeiro Lanches, 18/10/2026). Tudo
 * marcado grava o campo AUSENTE — o cupom antigo e o novo sem mexer valem em
 * todas. Desmarcar a última não deixa: cupom que não vale em nada é cupom
 * desligado, e para isso existe o "Ativo".
 */
function FormasDoCupom({ cupom, paymentConfig, onMudar }: {
  cupom: Coupon;
  paymentConfig: any;
  onMudar: (campo: "formasDePagamento" | "valesFora", valor: string[] | undefined) => void;
}) {
  const proprias: string[] = (Array.isArray(paymentConfig?.formasProprias) ? paymentConfig.formasProprias : [])
    .filter((f: any) => f && f.ativo !== false && String(f.nome || "").trim())
    .map((f: any) => String(f.nome).trim());
  const opcoes = [
    ...FORMAS_DO_CUPOM.map((f) => ({ chave: f.chave as string, rotulo: f.rotulo })),
    ...proprias.map((nome) => ({ chave: chaveDaPropria(nome), rotulo: nome })),
  ];
  const todas = opcoes.map((o) => o.chave);
  const marcadas = lerFormasDoCupom(cupom.formasDePagamento) ?? todas;
  const bandeiras: string[] = (Array.isArray(paymentConfig?.VOUCHER?.brands) ? paymentConfig.VOUCHER.brands : [])
    .filter((b: any) => b && b.active !== false && String(b.name || "").trim())
    .map((b: any) => String(b.name).trim());
  const fora = lerValesFora(cupom.valesFora);
  const valeMarcado = marcadas.includes("VALE");

  const alternar = (chave: string) => {
    const proxima = marcadas.includes(chave) ? marcadas.filter((m) => m !== chave) : [...marcadas, chave];
    if (proxima.length === 0) return;
    onMudar("formasDePagamento", todas.every((t) => proxima.includes(t)) ? undefined : proxima);
  };
  const alternarBandeira = (nome: string) => {
    const proxima = fora.includes(nome) ? fora.filter((f) => f !== nome) : [...fora, nome];
    onMudar("valesFora", proxima.length > 0 ? proxima : undefined);
  };
  const caixa = (marcada: boolean, rotulo: string, onClick: () => void, chave: string) => (
    <label key={chave} style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: "0.75rem", color: "#1E293B", cursor: "pointer" }}>
      <input type="checkbox" checked={marcada} onChange={onClick} />
      {rotulo}
    </label>
  );

  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <span style={{ fontSize: "0.75rem", color: "#64748B" }}>Vale nas formas de pagamento:</span>
        {opcoes.map((o) => caixa(marcadas.includes(o.chave), o.rotulo, () => alternar(o.chave), o.chave))}
      </div>
      {valeMarcado && bandeiras.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", paddingLeft: 12 }}>
          <span style={{ fontSize: "0.72rem", color: "#64748B" }}>Bandeiras de vale:</span>
          {bandeiras.map((b) => caixa(!fora.includes(b), b, () => alternarBandeira(b), `vale-${b}`))}
        </div>
      )}
    </div>
  );
}

/**
 * Tela de cupons de desconto, a mesma em "Minha loja › Cupons" e em
 * "Marketing & cupons › Cupons" (20/11/2026: pelo nome da aba o lojista
 * procurava os cupons no Marketing e não achava). Controlada: quem usa guarda
 * a lista, o "alterado" e o salvar; aqui só se edita.
 */
export default function CuponsEditor({ coupons, dirty, saving, paymentConfig, storeUrl, onChange, onSave }: {
  coupons: Coupon[];
  dirty: boolean;
  saving: boolean;
  paymentConfig: any;
  storeUrl: string;
  onChange: (proxima: Coupon[]) => void;
  onSave: () => void;
}) {
  /** Qual cupom acabou de ter o link copiado (o botão mostra "Copiado!" por 2 s). */
  const [linkDoCupomCopiado, setLinkDoCupomCopiado] = useState<string | null>(null);
  const hojeISO = new Date().toISOString().slice(0, 10);

  const addCoupon = () => onChange([...coupons, { code: "", discount: 10, type: "percent", active: true }]);
  /**
   * O cupom de primeiro pedido: um só por loja (lib/cupons.ts lê o primeiro
   * ativo). Nasce com código pronto porque o cliente nunca vai digitá-lo — o
   * site aplica sozinho quando reconhece um telefone que nunca pediu por aqui.
   */
  const temCupomDePrimeiroPedido = coupons.some(c => c.primeiroPedido && c.active);
  const addCupomPrimeiroPedido = () => {
    if (temCupomDePrimeiroPedido) return;
    onChange([...coupons, { code: "PRIMEIROPEDIDO", discount: 10, type: "percent", active: true, primeiroPedido: true, usosPorCliente: 1 }]);
  };
  const updateCoupon = (idx: number, key: string, val: any) => onChange(coupons.map((c, i) => i === idx ? { ...c, [key]: val } : c));
  const removeCoupon = (idx: number) => onChange(coupons.filter((_, i) => i !== idx));

  return (
    <div className="card mb-4">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.5rem", gap: 8, flexWrap: "wrap" }}>
          <h3 className="font-bold" style={{ margin: 0 }}>🏷️ Cupons de Desconto</h3>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {/* Um por loja: o site aplica "o" cupom de primeiro pedido, não escolhe entre vários. */}
            <button
              onClick={addCupomPrimeiroPedido}
              disabled={temCupomDePrimeiroPedido}
              title={temCupomDePrimeiroPedido ? "Sua loja já tem um cupom de primeiro pedido ativo" : "Desconto automático para quem nunca pediu pelo seu site"}
              className="btn btn-outline"
              style={{ padding: "0.4rem 0.75rem", fontSize: "0.8rem", borderColor: "#B45309", color: "#B45309", opacity: temCupomDePrimeiroPedido ? 0.5 : 1, cursor: temCupomDePrimeiroPedido ? "not-allowed" : "pointer" }}
            >
              🎁 Cupom de 1º pedido
            </button>
            <button onClick={addCoupon} className="btn btn-outline" style={{ padding: "0.4rem 0.75rem", fontSize: "0.8rem" }}><Plus size={14} /> Novo Cupom</button>
          </div>
        </div>
        <p style={{ margin: "0 0 1rem", fontSize: "0.78rem", color: "#64748B", lineHeight: 1.5 }}>
          Validade e limite por cliente são conferidos pelo telefone, na hora de fechar o pedido. O cupom de 1º pedido
          é aplicado sozinho para quem nunca pediu pelo seu site — o cliente vê o desconto sem digitar código.
          Em <strong>Vale nas formas de pagamento</strong>, desmarque onde o cupom não vale (no cardápio e no robô do WhatsApp):
          Pix pelo site conta como Pix, cartão pelo site como Crédito, e no pagamento dividido o cupom só entra se todas as formas estiverem marcadas.
        </p>
        {coupons.length === 0 ? (
          <p style={{ color: "#94A3B8", fontSize: "0.85rem", textAlign: "center", padding: "1rem" }}>Nenhum cupom cadastrado.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {coupons.map((c, idx) => {
              const ehPrimeiro = c.primeiroPedido === true;
              const venceu = !!c.validade && c.validade < hojeISO;
              return (
                <div key={idx} style={{ padding: "0.6rem 0.75rem", backgroundColor: venceu ? "#FEF2F2" : ehPrimeiro ? "#FFF7E6" : c.active ? "#F0FDFA" : "#F8FAFC", borderRadius: "10px", border: `1px solid ${venceu ? "#FECACA" : ehPrimeiro ? "#FDE68A" : "#E2E8F0"}` }}>
                  {/* Linha 1: o que o cupom é */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                    {ehPrimeiro
                      ? <span title="Cupom de primeiro pedido" style={{ fontSize: "0.72rem", fontWeight: 800, color: "#92400E", background: "#FDE68A", padding: "2px 8px", borderRadius: 6, whiteSpace: "nowrap" }}>🎁 1º PEDIDO</span>
                      : <Tag size={16} color={c.active ? "#0F766E" : "#94A3B8"} />}
                    <input placeholder="CÓDIGO" value={c.code} onChange={e => updateCoupon(idx, "code", e.target.value.toUpperCase())} style={{ flex: 1, minWidth: "120px", padding: "0.4rem", borderRadius: "6px", border: "1px solid #E2E8F0", fontSize: "0.85rem", fontWeight: 700, textTransform: "uppercase" }} />
                    <select
                      value={c.type || "percent"}
                      onChange={e => updateCoupon(idx, "type", e.target.value)}
                      style={{ padding: "0.4rem 0.6rem", borderRadius: "6px", border: "1px solid #CBD5E1", fontSize: "0.8rem", fontWeight: 700, color: c.type === "free_shipping" ? "#0F766E" : c.type === "fixed" ? "#475569" : "#1C1917", background: "#fff" }}
                    >
                      <option value="percent">% Porcentagem</option>
                      <option value="fixed">R$ Valor Fixo</option>
                      <option value="free_shipping">🚚 Frete Grátis</option>
                    </select>
                    {c.type === "free_shipping" ? (
                      <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#0F766E", padding: "0.3rem 0.6rem", background: "#F0FDFA", borderRadius: "6px" }}>Frete Grátis</span>
                    ) : c.type === "fixed" ? (
                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <span style={{ fontSize: "0.8rem", color: "#64748B" }}>R$</span>
                        <input type="number" value={c.discount} onChange={e => updateCoupon(idx, "discount", Number(e.target.value))} style={{ width: "65px", padding: "0.4rem", borderRadius: "6px", border: "1px solid #E2E8F0", fontSize: "0.85rem" }} />
                      </div>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <input type="number" value={c.discount} onChange={e => updateCoupon(idx, "discount", Number(e.target.value))} style={{ width: "65px", padding: "0.4rem", borderRadius: "6px", border: "1px solid #E2E8F0", fontSize: "0.85rem" }} />
                        <span style={{ fontSize: "0.8rem", color: "#64748B" }}>%</span>
                      </div>
                    )}
                    <label style={{ display: "flex", alignItems: "center", gap: "3px", cursor: "pointer", marginLeft: "auto" }}>
                      <input type="checkbox" checked={c.active} onChange={e => updateCoupon(idx, "active", e.target.checked)} />
                      <span style={{ fontSize: "0.75rem" }}>Ativo</span>
                    </label>
                    <button onClick={() => removeCoupon(idx)} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px" }}><Trash2 size={16} color="#C92E09" /></button>
                  </div>

                  {/* Linha 2: as regras. Cada uma diz o que "vazio" significa, para
                      ninguém precisar adivinhar se 0 é "zero vezes" ou "sem limite". */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap", marginTop: 8, paddingLeft: ehPrimeiro ? 0 : 24 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ fontSize: "0.75rem", color: "#64748B" }}>Pedido mín. R$</span>
                      <input type="number" placeholder="0" value={c.minOrderValue || 0} onChange={e => updateCoupon(idx, "minOrderValue", Number(e.target.value))} style={{ width: "65px", padding: "0.35rem", borderRadius: "6px", border: "1px solid #E2E8F0", fontSize: "0.82rem" }} />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ fontSize: "0.75rem", color: venceu ? "#B71C1C" : "#64748B", fontWeight: venceu ? 700 : 400 }}>{venceu ? "Venceu em" : "Válido até"}</span>
                      <input type="date" value={c.validade || ""} onChange={e => updateCoupon(idx, "validade", e.target.value || null)} style={{ padding: "0.3rem 0.4rem", borderRadius: "6px", border: `1px solid ${venceu ? "#FECACA" : "#E2E8F0"}`, fontSize: "0.8rem", fontFamily: "inherit", color: venceu ? "#B71C1C" : "#1E293B" }} />
                      {c.validade
                        ? <button type="button" onClick={() => updateCoupon(idx, "validade", null)} title="Sem validade" style={{ background: "none", border: "none", color: "#94A3B8", cursor: "pointer", fontSize: "0.75rem", padding: "0 2px" }}>✕</button>
                        : <span style={{ fontSize: "0.7rem", color: "#94A3B8" }}>(sem prazo)</span>}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                      <span style={{ fontSize: "0.75rem", color: "#64748B" }}>Usos por cliente</span>
                      <input type="number" min={0} placeholder="0" value={c.usosPorCliente || 0} onChange={e => updateCoupon(idx, "usosPorCliente", Math.max(0, Math.floor(Number(e.target.value) || 0)))} style={{ width: "55px", padding: "0.35rem", borderRadius: "6px", border: "1px solid #E2E8F0", fontSize: "0.82rem" }} />
                      <span style={{ fontSize: "0.7rem", color: "#94A3B8" }}>{(c.usosPorCliente || 0) > 0 ? (c.usosPorCliente === 1 ? "(1 vez)" : `(${c.usosPorCliente} vezes)`) : "(sem limite)"}</span>
                      {(c.usosPorCliente || 0) > 0 && (
                        <label style={{ display: "flex", alignItems: "center", gap: 3, fontSize: "0.72rem", color: "#64748B", cursor: "pointer" }} title="O limite recomeça no dia 1 de cada mês">
                          <input type="checkbox" checked={c.usosPorMes === true} onChange={e => updateCoupon(idx, "usosPorMes", e.target.checked)} />
                          por mês
                        </label>
                      )}
                    </div>
                    {ehPrimeiro && (
                      <span style={{ fontSize: "0.72rem", color: "#92400E", fontWeight: 600 }}>
                        Vale só para quem nunca pediu pelo seu site · aplicado automaticamente
                      </span>
                    )}
                  </div>
                  {/* Linha 3: em quais formas de pagamento vale (lib/cupom-por-forma.ts). */}
                  <div style={{ paddingLeft: ehPrimeiro ? 0 : 24 }}>
                    <FormasDoCupom cupom={c} paymentConfig={paymentConfig} onMudar={(campo, valor) => updateCoupon(idx, campo, valor)} />
                  </div>
                  {/* Linha 4: o link que abre o cardápio com o cupom já aplicado
                      (CustomerStorePage lê o ?cupom=) — para anúncio, bio, status. O de 1º pedido já entra sozinho. */}
                  {!ehPrimeiro && c.code && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8, paddingLeft: 24 }}>
                      <button
                        type="button"
                        disabled={dirty || !c.active}
                        onClick={() => {
                          navigator.clipboard.writeText(`${storeUrl}?cupom=${encodeURIComponent(c.code)}`);
                          setLinkDoCupomCopiado(c.code);
                          setTimeout(() => setLinkDoCupomCopiado((atual) => (atual === c.code ? null : atual)), 2000);
                        }}
                        className="btn btn-outline"
                        style={{ padding: "0.35rem 0.7rem", fontSize: "0.78rem", display: "inline-flex", alignItems: "center", gap: 5, opacity: dirty || !c.active ? 0.5 : 1, cursor: dirty || !c.active ? "not-allowed" : "pointer" }}
                      >
                        <Copy size={13} /> {linkDoCupomCopiado === c.code ? "Copiado!" : "Copiar link do cupom"}
                      </button>
                      <span style={{ fontSize: "0.72rem", color: "#64748B" }}>
                        {dirty
                          ? "Salve os cupons para copiar o link."
                          : !c.active
                            ? "Ative o cupom para usar o link."
                            : "Quem abre o link cai no seu cardápio com o cupom já aplicado — bom para anúncio, bio e status."}
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <button onClick={onSave} disabled={saving || !dirty}
          style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12, padding: "8px 16px", background: dirty ? "#C92E09" : "#E2E8F0", color: dirty ? "#fff" : "#94A3B8", border: "none", borderRadius: 10, fontWeight: 700, fontSize: "0.82rem", cursor: (saving || !dirty) ? "not-allowed" : "pointer", fontFamily: "inherit", transition: "all 0.2s" }}>
          <Save size={14} />{saving ? "Salvando..." : "Salvar Cupons"}
        </button>
    </div>
  );
}
