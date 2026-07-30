"use client";
import DeliveryZoneMap from "@/components/customer/DeliveryZoneMap";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Save, Copy, ExternalLink, Upload, Trash2, Plus, Tag, CreditCard, Banknote, Smartphone, ChevronDown, ChevronUp, ToggleLeft, ToggleRight, Ticket, Calendar, Clock, AlertTriangle, ShieldCheck } from "lucide-react";

const DAYS = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"];
// Padrão 18h-23h — foco em delivery de jantar, igual Brendi
const defaultHours = () => DAYS.map(d => ({ day: d, open: "18:00", close: "23:00", active: true, shifts: [{ open: "18:00", close: "23:00" }] }));

type Coupon = { id?: string; code: string; discount: number; type?: "percent" | "fixed" | "free_shipping"; minOrderValue?: number; active: boolean };

// Botão de salvar inline por seção
function SectionSaveBtn({ dirty, saving, onSave, label = "Salvar alterações" }: { dirty: boolean; saving: boolean; onSave: () => void; label?: string }) {
  return (
    <button onClick={onSave} disabled={saving || !dirty}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 12, padding: "8px 16px", background: dirty ? "#C62828" : "#E2E8F0", color: dirty ? "#fff" : "#94A3B8", border: "none", borderRadius: 10, fontWeight: 700, fontSize: "0.82rem", cursor: (saving || !dirty) ? "not-allowed" : "pointer", fontFamily: "inherit", transition: "all 0.2s" }}>
      <Save size={14} />{saving ? "Salvando..." : label}
    </button>
  );
}

export default function StoreSettingsForm({ user, initialTab }: { user: any; initialTab?: string }) {
  const router = useRouter();
  // Tab ativo — determina qual seção mostrar (undefined = mostra tudo)
  const tab = initialTab ?? "all";
  const show = (t: string) => tab === "all" || tab === t;
  const [storeName, setStoreName] = useState(user.storeName || "");
  const [storePhone, setStorePhone] = useState(user.storePhone || "");
  const [storeAddress, setStoreAddress] = useState(user.storeAddress || "");
  const [city, setCity] = useState(user.city || "");
  const [storeTimezone, setStoreTimezone] = useState(user.storeTimezone || "America/Sao_Paulo");
  const [storeBanner, setStoreBanner] = useState(user.storeBanner || "");
  const [storeLogo, setStoreLogo] = useState(user.storeLogo || "");
  const [storeDeliveryOnly, setStoreDeliveryOnly] = useState(user.storeDeliveryOnly || false);
  const [storeHours, setStoreHours] = useState<any[]>(user.storeHours || defaultHours());
  const [coupons, setCoupons] = useState<Coupon[]>(user.storeCoupons || []);
  // Agendar Pausa
  const todayStr = new Date().toISOString().slice(0, 10);
  const [pauseActive, setPauseActive] = useState<boolean>(false);
  const [pauseSavedActive, setPauseSavedActive] = useState<boolean>(false);
  const [pauseFrom, setPauseFrom] = useState<string>(user.storePause?.from || todayStr);
  const [pauseTo, setPauseTo] = useState<string>(user.storePause?.to || todayStr);
  const [pauseReason, setPauseReason] = useState<string>(user.storePause?.reason || "Férias");
  const [savingPause, setSavingPause] = useState(false);
  const [dirtyPause, setDirtyPause] = useState(false);
  // Dirty states por seção
  const [dirtyInfo, setDirtyInfo] = useState(false);
  const [dirtyHours, setDirtyHours] = useState(false);
  const [dirtyCoupons, setDirtyCoupons] = useState(false);
  const [dirtyPayment, setDirtyPayment] = useState(false);
  const [syncIfoodHours, setSyncIfoodHours] = useState(true); // Refletir horários no iFood
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [hoursSyncMsg, setHoursSyncMsg] = useState<string | null>(null);
  // Saving states por seção
  const [savingInfo, setSavingInfo] = useState(false);
  const [savingHours, setSavingHours] = useState(false);
  const [savingCoupons, setSavingCoupons] = useState(false);
  const [savingPayment, setSavingPayment] = useState(false);

  const defaultPaymentConfig = {
    PIX: { rate: 0, active: true },
    DINHEIRO: { rate: 0, active: true },
    DEBITO: { rate: 0, active: true, brands: [
      { name: "Mastercard", rate: 1.5, active: true },
      { name: "Elo", rate: 2.0, active: true },
      { name: "Visa", rate: 1.5, active: true },
      { name: "Hipercard", rate: 2.0, active: true },
      { name: "American Express", rate: 2.5, active: true },
    ] },
    CREDITO: { rate: 0, active: true, brands: [
      { name: "Mastercard", rate: 3.0, active: true },
      { name: "Elo", rate: 3.5, active: true },
      { name: "Visa", rate: 3.0, active: true },
      { name: "Hipercard", rate: 3.5, active: true },
      { name: "American Express", rate: 4.0, active: true },
    ] },
    VOUCHER: { rate: 0, active: true, surcharge: 0, brands: [
      { name: "Ticket", rate: 5.0, active: true },
      { name: "VR", rate: 5.0, active: true },
      { name: "Sodexo", rate: 5.0, active: true },
      { name: "Pluxee", rate: 4.5, active: true },
    ] },
  };
  const [paymentConfig, setPaymentConfig] = useState<any>(() => {
    const saved = user.paymentFees;
    if (saved && saved.PIX && typeof saved.PIX === 'object') return { ...defaultPaymentConfig, ...saved };
    // Migrar formato antigo
    if (saved && typeof saved.PIX === 'number') {
      return { ...defaultPaymentConfig, PIX: { ...defaultPaymentConfig.PIX, rate: saved.PIX }, DINHEIRO: { ...defaultPaymentConfig.DINHEIRO, rate: saved.DINHEIRO || 0 }, DEBITO: { ...defaultPaymentConfig.DEBITO, rate: saved.DEBITO || 0 }, CREDITO: { ...defaultPaymentConfig.CREDITO, rate: saved.CREDITO || 0 } };
    }
    return defaultPaymentConfig;
  });
  // Repasse (Configurações financeiras de repasse Brendi Flow)
  const defaultRepasse = {
    tipoChave: "CPF",
    chavePix: "",
    titular: user.name || user.storeName || "",
    cpfCnpj: user.cpfCnpj || "",
    banco: "",
    frequencia: "DAILY",
    horario: "03:00",
    status: "ATIVO"
  };
  const [repasseConfig, setRepasseConfig] = useState<any>(() => user.repasseConfig || defaultRepasse);
  const [showRepasseModal, setShowRepasseModal] = useState(false);
  const [savingRepasse, setSavingRepasse] = useState(false);
  const [dirtyRepasse, setDirtyRepasse] = useState(false);

  const handleSaveRepasse = async () => {
    setSavingRepasse(true);
    try {
      const res = await fetch("/api/store-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repasseConfig }),
      });
      if (res.ok) {
        setDirtyRepasse(false);
        alert("✅ Configurações de repasse salvas com sucesso!");
        setShowRepasseModal(false);
        router.refresh();
      } else {
        const d = await res.json();
        alert(`❌ Erro: ${d.error || "Erro ao salvar repasse"}`);
      }
    } catch {
      alert("❌ Erro de conexão ao salvar repasse.");
    } finally {
      setSavingRepasse(false);
    }
  };

  const [expandedPM, setExpandedPM] = useState<string | null>(null);
  const [newBrandName, setNewBrandName] = useState("");
  const [loading, setLoading] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const storeUrl = `${window.location.origin}/loja/${user.slug}`;
  // Delivery zones
  const [deliveryZoneType, setDeliveryZoneType] = useState<string>(user.deliveryZoneType || "");
  const [deliveryZones, setDeliveryZones] = useState<any[]>(user.deliveryZones || []);
  const [newNeighborhood, setNewNeighborhood] = useState("");
  const [newNeighborhoodFee, setNewNeighborhoodFee] = useState("");

  // Helper: salvar campos específicos
  const saveFields = async (fields: Record<string, any>) => {
    const res = await fetch("/api/store-settings", {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    if (res.ok) router.refresh();
    else throw new Error("Erro ao salvar");
  };

  const DAY_MAP: Record<string, string> = {
    "Segunda": "MONDAY", "Terça": "TUESDAY", "Quarta": "WEDNESDAY",
    "Quinta": "THURSDAY", "Sexta": "FRIDAY", "Sábado": "SATURDAY", "Domingo": "SUNDAY"
  };

  const saveInfo = async () => { setSavingInfo(true); try { await saveFields({ storeName, storePhone, storeAddress, storeDeliveryOnly, city, storeTimezone }); setDirtyInfo(false); } finally { setSavingInfo(false); } };

  // Valida sobreposição de turnos no mesmo dia
  const validateShifts = (): string | null => {
    for (const h of storeHours) {
      if (!h.active) continue;
      const shifts = h.shifts || [{ open: h.open, close: h.close }];
      for (let i = 0; i < shifts.length; i++) {
        const [aStart] = [shifts[i].open].map((t: string) => { const [h,m] = t.split(":").map(Number); return h * 60 + m; });
        const [aEnd] = [shifts[i].close].map((t: string) => { const [h,m] = t.split(":").map(Number); return h * 60 + m; });
        for (let j = i + 1; j < shifts.length; j++) {
          const [bStart] = [shifts[j].open].map((t: string) => { const [h,m] = t.split(":").map(Number); return h * 60 + m; });
          const [bEnd] = [shifts[j].close].map((t: string) => { const [h,m] = t.split(":").map(Number); return h * 60 + m; });
          if (aStart < bEnd && bStart < aEnd) {
            return `${h.day}: Turno ${i+1} (${shifts[i].open}-${shifts[i].close}) se sobrepõe ao Turno ${j+1} (${shifts[j].open}-${shifts[j].close}). Insira um horário diferente.`;
          }
        }
      }
    }
    return null;
  };

  const saveHours = async () => {
    const overlap = validateShifts();
    if (overlap) { setHoursError(overlap); return; }
    setHoursError(null);
    setSavingHours(true);
    try {
      await saveFields({ storeHours });
      setDirtyHours(false);
      // Sync com iFood somente se marcado
      if (syncIfoodHours) {
        try {
          const ifoodShifts: any[] = [];
          storeHours
            .filter((h: any) => h.active && DAY_MAP[h.day])
            .forEach((h: any) => {
              const shifts = h.shifts || [{ open: h.open, close: h.close }];
              shifts.forEach((s: any) => {
                const [oH, oM] = (s.open || "00:00").split(":").map(Number);
                const [cH, cM] = (s.close || "23:59").split(":").map(Number);
                const dur = Math.max(1, (cH * 60 + cM) - (oH * 60 + oM));
                ifoodShifts.push({
                  dayOfWeek: DAY_MAP[h.day],
                  start: `${String(oH).padStart(2,"0")}:${String(oM).padStart(2,"0")}:00`,
                  duration: dur,
                });
              });
            });
          const syncRes = await fetch("/api/ifood/opening-hours", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shifts: ifoodShifts }),
          });
          if (syncRes.ok) {
            setHoursSyncMsg("✅ Horários salvos no site e sincronizados com o iFood!");
          } else {
            const errData = await syncRes.json().catch(() => ({}));
            const errDetailsStr = JSON.stringify(errData);
            if (syncRes.status === 403 || errDetailsStr.includes("Forbidden") || errDetailsStr.includes("forbidden")) {
              setHoursSyncMsg("⚠️ Horários salvos no site! (Obs: O iFood retornou Erro 403 Forbidden porque sua loja/chave iFood não possui permissão para alterar horários via API. Ajuste diretamente no Portal do Parceiro iFood se necessário).");
            } else {
              setHoursSyncMsg(`⚠️ Horários salvos no site! (iFood não sincronizou: ${errData?.error || syncRes.status})`);
            }
          }
          setTimeout(() => setHoursSyncMsg(null), 10000);
        } catch(e: any) {
          setHoursSyncMsg(`⚠️ Horários salvos no site! (Falha na conexão iFood: ${e.message})`);
          setTimeout(() => setHoursSyncMsg(null), 10000);
        }
      }
    } finally { setSavingHours(false); }
  };

  const saveCoupons = async () => { setSavingCoupons(true); try { await saveFields({ storeCoupons: coupons }); setDirtyCoupons(false); } finally { setSavingCoupons(false); } };
  const savePayment = async () => { setSavingPayment(true); try { await saveFields({ paymentFees: paymentConfig }); setDirtyPayment(false); } finally { setSavingPayment(false); } };

  const savePause = async () => {
    setSavingPause(true);
    try {
      await saveFields({ storePause: { active: pauseActive, from: pauseFrom, to: pauseTo, reason: pauseReason } });
      setPauseSavedActive(pauseActive);
      setDirtyPause(false);
      // Sync com iFood
      try {
        if (pauseActive) {
          // Criar interrupção no iFood
          await fetch("/api/ifood/interruptions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              description: pauseReason,
              start: `${pauseFrom}T00:00:00`,
              end:   `${pauseTo}T23:59:00`,
            }),
          });
        } else {
          // Remover todas as interrupções ativas no iFood
          const listRes = await fetch("/api/ifood/interruptions");
          if (listRes.ok) {
            const items = await listRes.json();
            for (const item of (Array.isArray(items) ? items : [])) {
              if (item.id) await fetch(`/api/ifood/interruptions/${item.id}`, { method: "DELETE" });
            }
          }
        }
      } catch { /* iFood sync falhou silenciosamente */ }
    } finally { setSavingPause(false); }
  };


  const updateHour = (idx: number, key: string, val: any) => {
    setStoreHours(prev => prev.map((h, i) => i === idx ? { ...h, [key]: val } : h));
    setDirtyHours(true);
  };

  const handleUpload = async (file: File, type: "logo" | "banner") => {
    const setter = type === "logo" ? setStoreLogo : setStoreBanner;
    const setUploading = type === "logo" ? setUploadingLogo : setUploadingBanner;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("type", type);
      const res = await fetch("/api/upload-store-image", { method: "POST", body: formData });
      if (res.ok) {
        const d = await res.json();
        setter(d.url);
        // Auto-save to database
        const saveKey = type === "logo" ? "storeLogo" : "storeBanner";
        await fetch("/api/store-settings", {
          method: "PUT", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [saveKey]: d.url })
        });
      } else { alert("Erro no upload."); }
    } catch { alert("Erro no upload."); } finally { setUploading(false); }
  };

  const addCoupon = () => { setCoupons(prev => [...prev, { code: "", discount: 10, type: "percent", active: true }]); setDirtyCoupons(true); };
  const updateCoupon = (idx: number, key: string, val: any) => { setCoupons(prev => prev.map((c, i) => i === idx ? { ...c, [key]: val } : c)); setDirtyCoupons(true); };
  const removeCoupon = (idx: number) => { setCoupons(prev => prev.filter((_, i) => i !== idx)); setDirtyCoupons(true); };

  const handleSave = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/store-settings", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeName, storePhone, storeAddress, storeBanner, storeLogo, storeHours, storeDeliveryOnly, storeCoupons: coupons, paymentFees: paymentConfig, deliveryZoneType: deliveryZoneType || null, deliveryZones: deliveryZones.length > 0 ? deliveryZones : null })
      });
      if (res.ok) { alert("Configurações salvas!"); router.refresh(); } else alert("Erro ao salvar.");
    } catch { alert("Erro ao salvar."); } finally { setLoading(false); }
  };

  const UploadBox = ({ label, value, type, uploading }: { label: string; value: string; type: "logo" | "banner"; uploading: boolean }) => (
    <div style={{ flex: type === "banner" ? 2 : 1 }}>
      <label style={{ fontWeight: 600, fontSize: "0.85rem", display: "block", marginBottom: "6px" }}>{label}</label>
      {value ? (
        <div style={{ position: "relative", borderRadius: "12px", overflow: "hidden", border: "1.5px solid #E2E8F0" }}>
          <img src={value} alt={label} style={{ width: "100%", height: type === "logo" ? "100px" : "120px", objectFit: "cover", display: "block" }} />
          <div style={{ position: "absolute", top: "6px", right: "6px", display: "flex", gap: "4px" }}>
            <label style={{ width: "30px", height: "30px", borderRadius: "8px", background: "rgba(255,255,255,0.9)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }}>
              <Upload size={14} />
              <input type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], type)} />
            </label>
            <button onClick={() => type === "logo" ? setStoreLogo("") : setStoreBanner("")} style={{ width: "30px", height: "30px", borderRadius: "8px", background: "rgba(255,255,255,0.9)", border: "none", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 2px 6px rgba(0,0,0,0.15)" }}>
              <Trash2 size={14} color="#EF4444" />
            </button>
          </div>
        </div>
      ) : (
        <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: type === "logo" ? "100px" : "120px", borderRadius: "12px", border: "2px dashed #CBD5E1", cursor: "pointer", background: "#F8FAFC", transition: "border-color 0.2s" }}>
          <Upload size={24} color="#94A3B8" />
          <span style={{ fontSize: "0.8rem", color: "#94A3B8", marginTop: "6px" }}>{uploading ? "Enviando..." : `Upload ${label}`}</span>
          <input type="file" accept="image/*" hidden onChange={e => e.target.files?.[0] && handleUpload(e.target.files[0], type)} />
        </label>
      )}
      <input className="input-field" placeholder="Ou cole a URL da imagem..." value={value} onChange={e => { type === "logo" ? setStoreLogo(e.target.value) : setStoreBanner(e.target.value); setDirtyInfo(true); }} style={{ marginTop: "6px", fontSize: "0.8rem" }} />
    </div>
  );

  return (
    <div style={{ maxWidth: "700px" }}>
      {/* LINK DA LOJA */}
      {show("info") && <div className="card mb-4" style={{ background: "linear-gradient(135deg, #FFF4E5, #FEF3C7)", border: "1.5px solid #F59E0B" }}>
        <p className="font-bold" style={{ marginBottom: "0.5rem" }}>🔗 Link da sua Loja</p>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <code style={{ flex: 1, padding: "0.5rem", backgroundColor: "white", borderRadius: "8px", fontSize: "0.8rem", wordBreak: "break-all" }}>{storeUrl}</code>
          <button onClick={() => { navigator.clipboard.writeText(storeUrl); alert("Copiado!"); }} className="btn btn-outline" style={{ padding: "0.5rem" }}><Copy size={16} /></button>
          <a href={storeUrl} target="_blank" className="btn btn-primary" style={{ padding: "0.5rem" }}><ExternalLink size={16} /></a>
        </div>
      </div>}

      {/* IMAGENS */}
      {show("info") && <div className="card mb-4">
        <h3 className="font-bold mb-4">🖼️ Imagens da Loja</h3>
        <div style={{ display: "flex", gap: "1rem" }}>
          <UploadBox label="Logo" value={storeLogo} type="logo" uploading={uploadingLogo} />
          <UploadBox label="Banner / Capa" value={storeBanner} type="banner" uploading={uploadingBanner} />
        </div>
      </div>}

      {/* INFO */}
      {show("info") && <div className="card mb-4">
        <h3 className="font-bold mb-4">📋 Informações da Loja</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div className="input-group"><label>Nome da Loja</label><input className="input-field" value={storeName} onChange={e => { setStoreName(e.target.value); setDirtyInfo(true); }} /></div>
          <div className="input-group"><label>Telefone / WhatsApp</label><input className="input-field" value={storePhone} onChange={e => { setStorePhone(e.target.value); setDirtyInfo(true); }} /></div>
          <div className="input-group"><label>Cidade / Estado (UF)</label><input className="input-field" placeholder="Ex: Rio de Janeiro - RJ" value={city} onChange={e => { setCity(e.target.value); setDirtyInfo(true); }} /></div>
          <div className="input-group"><label>Fuso Horário (Timezone)</label>
            <select className="input-field" value={storeTimezone} onChange={e => { setStoreTimezone(e.target.value); setDirtyInfo(true); }} style={{ background: "#fff", cursor: "pointer" }}>
              <option value="America/Sao_Paulo">🇧🇷 Brasília / Rio de Janeiro / São Paulo (GMT-3)</option>
              <option value="America/Bahia">🇧🇷 Bahia / Nordeste (GMT-3)</option>
              <option value="America/Fortaleza">🇧🇷 Ceará / Fortaleza (GMT-3)</option>
              <option value="America/Recife">🇧🇷 Pernambuco / Recife (GMT-3)</option>
              <option value="America/Belem">🇧🇷 Pará / Belém (GMT-3)</option>
              <option value="America/Manaus">🇧🇷 Amazonas / Manaus (GMT-4)</option>
              <option value="America/Cuiaba">🇧🇷 Mato Grosso / Cuiabá (GMT-4)</option>
              <option value="America/Rio_Branco">🇧🇷 Acre / Rio Branco (GMT-5)</option>
              <option value="America/Noronha">🇧🇷 Fernando de Noronha (GMT-2)</option>
            </select>
          </div>
          <div className="input-group" style={{ gridColumn: "span 2" }}><label>Endereço Completo</label><input className="input-field" value={storeAddress} onChange={e => { setStoreAddress(e.target.value); setDirtyInfo(true); }} /></div>
        </div>
        <label style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "0.75rem", cursor: "pointer" }}>
          <input type="checkbox" checked={storeDeliveryOnly} onChange={e => { setStoreDeliveryOnly(e.target.checked); setDirtyInfo(true); }} />
          <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>🛵 Somente Delivery</span>
        </label>
        <SectionSaveBtn dirty={dirtyInfo} saving={savingInfo} onSave={saveInfo} label="Salvar Informações" />
      </div>}

      {/* HORÁRIOS */}
      {show("hours") && <div className="card mb-4">
        <h3 className="font-bold mb-4">⏰ Horário de Funcionamento</h3>
        <p style={{ fontSize: "0.78rem", color: "#64748B", marginBottom: "0.75rem" }}>Configure múltiplos turnos por dia (ex: Almoço e Jantar)</p>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {storeHours.map((h: any, idx: number) => (
            <div key={idx} style={{ padding: "0.6rem 0.75rem", backgroundColor: h.active ? "#F0FDF4" : "#FEF2F2", borderRadius: "10px", border: `1px solid ${h.active ? "#BBF7D0" : "#FECACA"}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: h.active && h.shifts?.length > 0 ? "0.5rem" : 0 }}>
                <label style={{ display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", minWidth: "90px" }}>
                  <input type="checkbox" checked={h.active} onChange={e => {
                    const updated = [...storeHours];
                    updated[idx] = { ...h, active: e.target.checked, shifts: h.shifts?.length ? h.shifts : [{ open: "10:00", close: "22:00" }] };
                    setStoreHours(updated);
                    setDirtyHours(true);
                  }} />
                  <span style={{ fontSize: "0.85rem", fontWeight: 600 }}>{h.day}</span>
                </label>
                {!h.active && <span style={{ fontSize: "0.8rem", color: "#EF4444", fontWeight: 600 }}>Fechado</span>}
                {h.active && (
                  <button onClick={() => {
                    const updated = [...storeHours];
                    const shifts = [...(h.shifts || [{ open: h.open || "10:00", close: h.close || "22:00" }])];
                    shifts.push({ open: "18:00", close: "23:00" });
                    updated[idx] = { ...h, shifts };
                    setStoreHours(updated);
                    setDirtyHours(true);
                  }} style={{ marginLeft: "auto", padding: "2px 8px", borderRadius: "6px", border: "1px solid #BBF7D0", background: "#fff", cursor: "pointer", fontSize: "0.72rem", fontWeight: 600, color: "#16A34A" }}>
                    + Turno
                  </button>
                )}
              </div>
              {h.active && (h.shifts || [{ open: h.open || "10:00", close: h.close || "22:00" }]).map((shift: any, sIdx: number) => (
                <div key={sIdx} style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "4px", paddingLeft: "1.5rem" }}>
                  <span style={{ fontSize: "0.72rem", color: "#64748B", minWidth: "50px" }}>Turno {sIdx + 1}</span>
                  <input type="time" value={shift.open} onChange={e => {
                    const updated = [...storeHours];
                    const shifts = [...(h.shifts || [{ open: h.open, close: h.close }])];
                    shifts[sIdx] = { ...shifts[sIdx], open: e.target.value };
                    updated[idx] = { ...h, shifts, open: shifts[0]?.open, close: shifts[shifts.length - 1]?.close };
                    setStoreHours(updated);
                    setDirtyHours(true);
                  }} style={{ padding: "0.3rem", borderRadius: "6px", border: "1px solid #E2E8F0", fontSize: "0.85rem" }} />
                  <span style={{ fontSize: "0.8rem" }}>às</span>
                  <input type="time" value={shift.close} onChange={e => {
                    const updated = [...storeHours];
                    const shifts = [...(h.shifts || [{ open: h.open, close: h.close }])];
                    shifts[sIdx] = { ...shifts[sIdx], close: e.target.value };
                    updated[idx] = { ...h, shifts, open: shifts[0]?.open, close: shifts[shifts.length - 1]?.close };
                    setStoreHours(updated);
                    setDirtyHours(true);
                  }} style={{ padding: "0.3rem", borderRadius: "6px", border: "1px solid #E2E8F0", fontSize: "0.85rem" }} />
                  {(h.shifts?.length || 1) > 1 && (
                    <button onClick={() => {
                      const updated = [...storeHours];
                      const shifts = [...(h.shifts || [])].filter((_, i) => i !== sIdx);
                      updated[idx] = { ...h, shifts };
                      setStoreHours(updated);
                      setDirtyHours(true);
                    }} style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", color: "#EF4444" }}>
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
        <SectionSaveBtn dirty={dirtyHours} saving={savingHours} onSave={saveHours} label="Salvar Horários" />
        {hoursError && (
          <div style={{ marginTop: 10, padding: "10px 14px", background: "#FEF2F2", border: "1.5px solid #FECACA", borderRadius: 10, display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle size={16} color="#DC2626" />
            <span style={{ fontSize: "0.82rem", color: "#DC2626", fontWeight: 600 }}>{hoursError}</span>
          </div>
        )}
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: "0.82rem", color: "#475569", cursor: "pointer" }}>
          <input type="checkbox" checked={syncIfoodHours} onChange={e => setSyncIfoodHours(e.target.checked)} style={{ width: 18, height: 18, accentColor: "#E8360C" }} />
          <span><strong>Refletir horários do site no iFood</strong> — ao salvar, os mesmos horários serão enviados para o iFood automaticamente</span>
        </label>
        {hoursSyncMsg && (
          <div style={{ marginTop: 8, padding: "10px 14px", background: hoursSyncMsg.startsWith("✅") ? "#F0FDF4" : "#FEF2F2", border: `1.5px solid ${hoursSyncMsg.startsWith("✅") ? "#BBF7D0" : "#FECACA"}`, borderRadius: 10, fontSize: "0.82rem", fontWeight: 600, color: hoursSyncMsg.startsWith("✅") ? "#16A34A" : "#DC2626" }}>
            {hoursSyncMsg}
          </div>
        )}
      </div>}

      {/* AGENDAR PAUSA */}
      {show("hours") && <div className="card mb-4" style={{ border: pauseSavedActive ? "1.5px solid #FCA5A5" : "1.5px solid #E2E8F0", background: pauseSavedActive ? "#FFF5F5" : "#fff" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Calendar size={18} color={pauseSavedActive ? "#DC2626" : "#64748B"} />
            <h3 className="font-bold" style={{ margin: 0, color: pauseSavedActive ? "#DC2626" : "inherit" }}>
              📅 Agendar Pausa / Férias
            </h3>
            {pauseSavedActive && <span style={{ padding: "2px 8px", background: "#FEE2E2", color: "#DC2626", borderRadius: "20px", fontSize: "0.72rem", fontWeight: 700 }}>ATIVO</span>}
          </div>
          <button
            onClick={async () => {
              setPauseActive(v => {
                const newVal = !v;
                if (!newVal) {
                  // Desativando: salva imediatamente como inativo
                  setSavingPause(true);
                  saveFields({ storePause: { active: false, from: pauseFrom, to: pauseTo, reason: pauseReason } })
                    .then(() => {
                      setPauseSavedActive(false);
                      setDirtyPause(false);
                      // Remove interrupções do iFood
                      fetch("/api/ifood/interruptions").then(r => r.json()).then(items => {
                        for (const item of (Array.isArray(items) ? items : [])) {
                          if (item.id) fetch(`/api/ifood/interruptions/${item.id}`, { method: "DELETE" }).catch(() => {});
                        }
                      }).catch(() => {});
                    })
                    .finally(() => setSavingPause(false));
                } else {
                  setDirtyPause(true);
                }
                return newVal;
              });
            }}
            style={{ background: "none", border: "none", cursor: "pointer" }}
          >
            {pauseActive ? <ToggleRight size={28} color="#DC2626" /> : <ToggleLeft size={28} color="#CBD5E1" />}
          </button>
        </div>

        <p style={{ fontSize: "0.8rem", color: "#64748B", marginBottom: "1rem" }}>
          Quando ativado, a loja ficará automaticamente fechada no período configurado, mesmo que o horário normal esteja aberto.
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
          <div className="input-group">
            <label>📅 Data de início</label>
            <input type="date" className="input-field" value={pauseFrom}
              onChange={e => { setPauseFrom(e.target.value); setDirtyPause(true); }}
              style={{ opacity: pauseActive ? 1 : 0.5 }} disabled={!pauseActive} />
          </div>
          <div className="input-group">
            <label>📅 Data de retorno</label>
            <input type="date" className="input-field" value={pauseTo}
              onChange={e => { setPauseTo(e.target.value); setDirtyPause(true); }}
              style={{ opacity: pauseActive ? 1 : 0.5 }} disabled={!pauseActive} />
          </div>
          <div className="input-group" style={{ gridColumn: "span 2" }}>
            <label>💬 Motivo (exibido para clientes)</label>
            <select className="input-field" value={pauseReason}
              onChange={e => { setPauseReason(e.target.value); setDirtyPause(true); }}
              disabled={!pauseActive} style={{ opacity: pauseActive ? 1 : 0.5 }}>
              <option>Férias</option>
              <option>Evento particular</option>
              <option>Reforma / Manutenção</option>
              <option>Feriado</option>
              <option>Outros</option>
            </select>
          </div>
        </div>

        {pauseActive && (
          <div style={{ marginTop: "0.75rem", padding: "10px 14px", background: "#FEE2E2", borderRadius: "10px", display: "flex", alignItems: "center", gap: "8px" }}>
            <AlertTriangle size={16} color="#DC2626" />
            <span style={{ fontSize: "0.8rem", color: "#DC2626", fontWeight: 600 }}>
              Loja pausada de {new Date(pauseFrom + "T12:00").toLocaleDateString("pt-BR")} até {new Date(pauseTo + "T12:00").toLocaleDateString("pt-BR")} — Motivo: {pauseReason}
            </span>
          </div>
        )}
        <SectionSaveBtn dirty={dirtyPause} saving={savingPause} onSave={savePause} label="Salvar Pausa" />
      </div>}

      {/* CUPONS */}
      {show("coupons") && <div className="card mb-4">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
          <h3 className="font-bold" style={{ margin: 0 }}>🏷️ Cupons de Desconto</h3>
          <button onClick={addCoupon} className="btn btn-outline" style={{ padding: "0.4rem 0.75rem", fontSize: "0.8rem" }}><Plus size={14} /> Novo Cupom</button>
        </div>
        {coupons.length === 0 ? (
          <p style={{ color: "#94A3B8", fontSize: "0.85rem", textAlign: "center", padding: "1rem" }}>Nenhum cupom cadastrado.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {coupons.map((c, idx) => (
              <div key={idx} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.75rem", backgroundColor: c.active ? "#F0FDF4" : "#F8FAFC", borderRadius: "10px", border: "1px solid #E2E8F0", flexWrap: "wrap" }}>
                <Tag size={16} color={c.active ? "#16A34A" : "#94A3B8"} />
                <input placeholder="CÓDIGO" value={c.code} onChange={e => updateCoupon(idx, "code", e.target.value.toUpperCase())} style={{ flex: 1, minWidth: "120px", padding: "0.4rem", borderRadius: "6px", border: "1px solid #E2E8F0", fontSize: "0.85rem", fontWeight: 700, textTransform: "uppercase" }} />
                <select
                  value={c.type || "percent"}
                  onChange={e => updateCoupon(idx, "type", e.target.value)}
                  style={{ padding: "0.4rem 0.6rem", borderRadius: "6px", border: "1px solid #CBD5E1", fontSize: "0.8rem", fontWeight: 700, color: c.type === "free_shipping" ? "#16A34A" : c.type === "fixed" ? "#7C3AED" : "#2563EB", background: "#fff" }}
                >
                  <option value="percent">% Porcentagem</option>
                  <option value="fixed">R$ Valor Fixo</option>
                  <option value="free_shipping">🚚 Frete Grátis</option>
                </select>
                {c.type === "free_shipping" ? (
                  <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "#16A34A", padding: "0.3rem 0.6rem", background: "#DCFCE7", borderRadius: "6px" }}>Frete Grátis</span>
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
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ fontSize: "0.75rem", color: "#64748B" }}>Mín: R$</span>
                  <input type="number" placeholder="0" value={c.minOrderValue || 0} onChange={e => updateCoupon(idx, "minOrderValue", Number(e.target.value))} style={{ width: "65px", padding: "0.4rem", borderRadius: "6px", border: "1px solid #E2E8F0", fontSize: "0.85rem" }} />
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: "3px", cursor: "pointer" }}>
                  <input type="checkbox" checked={c.active} onChange={e => updateCoupon(idx, "active", e.target.checked)} />
                  <span style={{ fontSize: "0.75rem" }}>Ativo</span>
                </label>
                <button onClick={() => removeCoupon(idx)} style={{ background: "none", border: "none", cursor: "pointer", padding: "4px" }}><Trash2 size={16} color="#EF4444" /></button>
              </div>
            ))}
          </div>
        )}
        <SectionSaveBtn dirty={dirtyCoupons} saving={savingCoupons} onSave={saveCoupons} label="Salvar Cupons" />
      </div>}

      {/* TAXAS DE PAGAMENTO */}
      {show("payment") && <div className="card mb-4">
        <h3 className="font-bold mb-2">💳 Formas de Pagamento</h3>
        <p style={{ fontSize: "0.82rem", color: "#64748B", marginBottom: "1.25rem" }}>Gerencie suas formas de pagamento online e na entrega do pedido.</p>

        {/* ── ALERTA DE OBRIGATORIEDADE ── */}
        <div style={{ background: "#EFF6FF", border: "1.5px solid #BFDBFE", borderRadius: "14px", padding: "1rem 1.25rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <ShieldCheck size={20} color="#1D4ED8" style={{ marginTop: 2, flexShrink: 0 }} />
            <div style={{ fontSize: "0.83rem", color: "#1E40AF", lineHeight: 1.6 }}>
              <strong>🔒 Pagamento Online no FireHub:</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: "1.2rem" }}>
                <li>O <strong>Pix Online</strong> é <strong>obrigatório e permanece sempre ativo</strong> para garantir praticidade ao cliente final e permitir o abatimento automático da sua fatura mensal.</li>
                <li>O <strong>Cartão de Crédito Online</strong> pode ser ativado ou desativado por você a qualquer momento.</li>
                <li>Pendências de mensalidade do sistema são <strong>descontadas automaticamente</strong> das vendas online recebidas.</li>
              </ul>
            </div>
          </div>
        </div>

        {/* ── SEÇÃO PAGAMENTO ONLINE ── */}
        <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "16px", padding: "1.25rem", marginBottom: "1.5rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: "1rem" }}>
            <ShieldCheck size={20} color="#16A34A" />
            <div>
              <h4 style={{ fontWeight: 800, fontSize: "0.95rem", margin: 0, color: "#0F172A" }}>Pagamento online</h4>
              <span style={{ fontSize: "0.76rem", color: "#64748B" }}>Sempre disponível para seus clientes. Não podem ser desativados.</span>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
            {/* PIX Online */}
            <div style={{ background: "#fff", border: "1.5px solid #00BFA530", borderRadius: "12px", padding: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <Smartphone size={18} color="#00BFA5" />
                  <strong style={{ fontSize: "0.9rem", color: "#0F172A" }}>Pix</strong>
                </div>
                <span style={{ padding: "3px 8px", borderRadius: 99, background: "#E6F4EA", color: "#137333", fontSize: "0.72rem", fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>🔒 Sempre ativo</span>
              </div>
              <div style={{ fontSize: "0.78rem", color: "#475569", lineHeight: 1.7 }}>
                <div><strong>Taxa:</strong> 0,5% + R$ 0,40 por pedido</div>
                <div><strong>Recebimento:</strong> Conforme suas configurações de repasse</div>
                <div style={{ color: "#166534", fontWeight: 600, marginTop: 4 }}>⚡ <strong>Estorno:</strong> Automático em até 24h na conta do cliente ao cancelar</div>
              </div>
              <button
                type="button"
                onClick={() => setShowRepasseModal(true)}
                style={{ marginTop: "12px", width: "100%", padding: "7px 12px", borderRadius: "10px", border: "1.5px solid #00BFA5", background: "#E6F4EA", color: "#00796B", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: "inherit" }}
              >
                <Upload size={14} /> Configurar repasse
              </button>
            </div>

            {/* Cartão de Crédito Online */}
            <div style={{ background: "#fff", border: "1.5px solid #9C27B030", borderRadius: "12px", padding: "1rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <CreditCard size={18} color="#9C27B0" />
                  <strong style={{ fontSize: "0.9rem", color: "#0F172A" }}>Cartão de crédito online</strong>
                </div>
                <span style={{ padding: "3px 8px", borderRadius: 99, background: "#FEF3C7", color: "#92400E", fontSize: "0.72rem", fontWeight: 700, whiteSpace: "nowrap", flexShrink: 0 }}>⚡ D+30 / D+0</span>
              </div>
              <div style={{ fontSize: "0.78rem", color: "#475569", lineHeight: 1.7 }}>
                <div><strong>Taxa:</strong> 3,99% por transação</div>
                <div><strong>Recebimento:</strong> D+30, ou no mesmo dia (D+0) com +1,7% de adiantamento</div>
                <div style={{ color: "#166534", fontWeight: 600, marginTop: 4 }}>⚡ <strong>Estorno:</strong> Automático na fatura do cartão ao cancelar</div>
              </div>
              <button
                type="button"
                onClick={() => setShowRepasseModal(true)}
                style={{ marginTop: "12px", width: "100%", padding: "7px 12px", borderRadius: "10px", border: "1.5px solid #9C27B0", background: "#F3E5F5", color: "#7B1FA2", fontWeight: 700, fontSize: "0.78rem", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, fontFamily: "inherit" }}
              >
                <Upload size={14} /> Configurar repasse
              </button>
            </div>
          </div>
        </div>

        {/* ── SEÇÃO PAGAMENTO NA ENTREGA ── */}
        <h4 style={{ fontWeight: 800, fontSize: "0.9rem", color: "#0F172A", marginBottom: "0.85rem" }}>Pagamento na entrega (Maquininha / Dinheiro)</h4>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>

          {/* DINHEIRO */}
          {(() => {
            const cfg = paymentConfig.DINHEIRO || { rate: 0, active: true };
            return (
              <div style={{ borderRadius: "12px", border: `1.5px solid ${cfg.active ? '#4CAF5030' : '#E2E8F020'}`, background: cfg.active ? '#4CAF5005' : '#F8FAFC', overflow: 'hidden' }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", padding: "0.75rem 1rem" }}>
                  <div style={{ width: "36px", height: "36px", borderRadius: "10px", background: "#4CAF5015", display: "flex", alignItems: "center", justifyContent: "center" }}><Banknote size={17} color="#4CAF50" /></div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 700, fontSize: "0.92rem", color: "#0F172A", display: "block" }}>Dinheiro</span>
                    <span style={{ fontSize: "0.72rem", color: "#64748B" }}>Ative esta opção para aceitar pagamentos em dinheiro na entrega.</span>
                  </div>
                  <button onClick={() => { setPaymentConfig((p: any) => ({ ...p, DINHEIRO: { ...p.DINHEIRO, active: !p.DINHEIRO.active } })); setDirtyPayment(true); }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                    {cfg.active ? <ToggleRight size={32} color="#4CAF50" /> : <ToggleLeft size={32} color="#CBD5E1" />}
                  </button>
                </div>
              </div>
            );
          })()}

          {/* DÉBITO, CRÉDITO, VOUCHER - com bandeiras no estilo Brendi */}
          {[
            { key: "CREDITO", label: "Cartão de crédito", desc: "Maquininha na entrega. Escolha as bandeiras aceitas.", icon: CreditCard, color: "#9C27B0", defaultBrands: ["Mastercard", "Elo", "Visa", "Hipercard", "American Express"] },
            { key: "DEBITO", label: "Cartão de débito", desc: "Maquininha na entrega. Escolha as bandeiras aceitas.", icon: CreditCard, color: "#2196F3", defaultBrands: ["Mastercard", "Elo", "Visa", "Hipercard", "American Express"] },
            { key: "VOUCHER", label: "Voucher / Vale", desc: "Maquininha na entrega. Escolha as bandeiras de vale aceitas.", icon: Ticket, color: "#E65100", defaultBrands: ["Ticket", "VR", "Sodexo", "Pluxee"] },
          ].map(pm => {
            const Icon = pm.icon;
            const cfg = paymentConfig[pm.key] || { rate: 0, active: true, brands: [] };
            const isOpen = expandedPM === pm.key;
            const brands = cfg.brands || [];

            const updateBrand = (idx: number, field: string, val: any) => {
              setPaymentConfig((p: any) => {
                const updated = { ...p[pm.key] };
                updated.brands = [...updated.brands];
                updated.brands[idx] = { ...updated.brands[idx], [field]: val };
                return { ...p, [pm.key]: updated };
              });
              setDirtyPayment(true);
            };
            const removeBrand = (idx: number) => {
              setPaymentConfig((p: any) => {
                const updated = { ...p[pm.key] };
                updated.brands = updated.brands.filter((_: any, i: number) => i !== idx);
                return { ...p, [pm.key]: updated };
              });
              setDirtyPayment(true);
            };
            const addBrand = () => {
              if (!newBrandName.trim()) return;
              setPaymentConfig((p: any) => {
                const updated = { ...p[pm.key] };
                updated.brands = [...(updated.brands || []), { name: newBrandName.trim(), rate: 0, active: true }];
                return { ...p, [pm.key]: updated };
              });
              setNewBrandName("");
              setDirtyPayment(true);
            };

            return (
              <div key={pm.key} style={{ borderRadius: "14px", border: `1.5px solid ${cfg.active ? pm.color + '25' : '#E2E8F0'}`, background: cfg.active ? '#fff' : '#F8FAFC', padding: "1.25rem", boxShadow: "0 1px 3px rgba(0,0,0,0.03)" }}>
                {/* Header */}
                <div style={{ display: "flex", alignItems: "center", gap: "0.85rem", marginBottom: "0.85rem" }}>
                  <div style={{ width: "40px", height: "40px", borderRadius: "12px", background: pm.color + '12', display: "flex", alignItems: "center", justifyContent: "center" }}><Icon size={19} color={pm.color} /></div>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 800, fontSize: "0.95rem", color: "#0F172A", display: "block" }}>{pm.label}</span>
                    <span style={{ fontSize: "0.76rem", color: "#64748B" }}>{pm.desc}</span>
                  </div>
                  <button onClick={() => { setPaymentConfig((p: any) => ({ ...p, [pm.key]: { ...p[pm.key], active: !cfg.active } })); setDirtyPayment(true); }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                    {cfg.active ? <ToggleRight size={32} color={pm.color} /> : <ToggleLeft size={32} color="#CBD5E1" />}
                  </button>
                </div>

                {/* Bandeiras estilo Chip Pills (igual à Brendi) */}
                {cfg.active && (
                  <div style={{ borderTop: "1px solid #F1F5F9", paddingTop: "0.85rem" }}>
                    <p style={{ fontSize: "0.74rem", fontWeight: 700, color: "#475569", marginBottom: "0.6rem", textTransform: "uppercase", letterSpacing: 0.5 }}>Bandeiras aceitas</p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                      {brands.map((brand: any, idx: number) => (
                        <div key={idx} onClick={() => updateBrand(idx, 'active', !brand.active)}
                          style={{
                            display: "inline-flex", alignItems: "center", gap: 6,
                            padding: "6px 14px", borderRadius: 99, cursor: "pointer",
                            fontSize: "0.82rem", fontWeight: 700, transition: "all 0.2s",
                            border: brand.active ? "1.5px solid #EF4444" : "1.5px solid #E2E8F0",
                            background: brand.active ? "#FEF2F2" : "#F8FAFC",
                            color: brand.active ? "#DC2626" : "#94A3B8",
                          }}>
                          <span style={{ width: 14, height: 14, borderRadius: "50%", background: brand.active ? "#DC2626" : "#CBD5E1", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.65rem", color: "#fff" }}>
                            {brand.active ? "✓" : ""}
                          </span>
                          {brand.name}
                        </div>
                      ))}

                      {/* Botão + Nova bandeira */}
                      <button onClick={() => setExpandedPM(isOpen ? null : pm.key)}
                        style={{
                          display: "inline-flex", alignItems: "center", gap: 4,
                          padding: "6px 14px", borderRadius: 99, cursor: "pointer",
                          fontSize: "0.82rem", fontWeight: 700, border: "1.5px dashed #EF4444",
                          background: "#fff", color: "#EF4444", transition: "all 0.2s",
                        }}>
                        + Nova bandeira
                      </button>
                    </div>

                    {/* Input para adicionar nova bandeira customizada */}
                    {isOpen && (
                      <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.85rem', background: '#F8FAFC', padding: '0.75rem', borderRadius: '10px', border: '1px solid #E2E8F0' }}>
                        <input type="text" placeholder={pm.key === 'VOUCHER' ? 'Nome do voucher...' : 'Nome da nova bandeira (ex: Hiper)'}
                          value={newBrandName} onChange={e => setNewBrandName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addBrand()}
                          style={{ flex: 1, padding: '0.5rem 0.75rem', borderRadius: '8px', border: '1px solid #CBD5E1', fontSize: '0.84rem' }} />
                        <button onClick={addBrand} style={{ padding: '0.5rem 1rem', borderRadius: '8px', background: "#EF4444", color: '#fff', border: 'none', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}><Plus size={14} /> Adicionar</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <p style={{ fontSize: "0.72rem", color: "#94A3B8", marginTop: "0.75rem" }}>💡 Ative/desative cada forma e bandeira. A taxa % será usada para calcular seu lucro líquido real.</p>
        {paymentConfig?.VOUCHER?.active && (
          <div style={{ marginTop: 12, padding: "10px 14px", background: "#FFF7ED", border: "1px solid #FED7AA", borderRadius: 10 }}>
            <p style={{ fontSize: "0.8rem", fontWeight: 700, color: "#C2410C", marginBottom: 6 }}>💳 Acréscimo automático para Voucher/Vale</p>
            <p style={{ fontSize: "0.75rem", color: "#92400E", marginBottom: 8 }}>Quando o cliente pagar com voucher, este % será cobrado a mais no total do pedido (aparece no PDV e nos pedidos online).</p>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="number" step="0.1" min="0" max="20" value={paymentConfig.VOUCHER?.surcharge ?? 0}
                onChange={e => { setPaymentConfig((p: any) => ({ ...p, VOUCHER: { ...p.VOUCHER, surcharge: Number(e.target.value) } })); setDirtyPayment(true); }}
                style={{ width: 80, padding: "6px 10px", borderRadius: 8, border: "1.5px solid #FED7AA", fontSize: "0.9rem", textAlign: "center" }} />
              <span style={{ fontWeight: 700, color: "#C2410C" }}>% de acréscimo</span>
            </div>
          </div>
        )}
        <SectionSaveBtn dirty={dirtyPayment} saving={savingPayment} onSave={savePayment} label="Salvar Formas de Pagamento" />
      </div>}

      {/* ===== DELIVERY ZONES - MAP ===== */}
      {show("delivery") && <div style={{ marginTop: "1.5rem" }}>
        <DeliveryZoneMap
          initialAddress={storeAddress}
          initialLatLng={(user.storeLatLng as any) || null}
          initialZones={(user.deliveryZones as any) || []}
          zoneType={user.deliveryZoneType || "KM"}
          initialIfoodSyncDeliveryTime={(user as any).ifoodSyncDeliveryTime ?? false}
          onSave={async (data) => {
            const res = await fetch("/api/store-settings", {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                storeLatLng: data.storeLatLng,
                deliveryZones: data.deliveryZones,
                deliveryZoneType: data.deliveryZoneType,
                storeAddress: data.storeAddress,
                ifoodSyncDeliveryTime: data.ifoodSyncDeliveryTime,
              }),
            });
            const result = await res.json();
            if (result.ifoodSync && !result.ifoodSync.success) {
              throw new Error(`iFood: ${result.ifoodSync.error || "Erro desconhecido"}`);
            }
            if (result.ifoodSync && result.ifoodSync.success) {
              (window as any).__ifoodSyncOk = result.ifoodSync.sentMinutes;
            }
            router.refresh();
          }}
        />
      </div>}

      {/* Salvar Tudo — só mostra quando modo "all" (sem aba específica) */}
      {tab === "all" && (
        <button onClick={handleSave} disabled={loading} className="btn btn-primary" style={{ width: "100%", marginTop: "1rem" }}>
          <Save size={16} style={{ marginRight: "6px" }} /> {loading ? "Salvando..." : "Salvar Tudo"}
        </button>
      )}

      {/* ===== MODAL CONFIGURAÇÕES FINANCEIRAS DE REPASSE (ESTILO BRENDI) ===== */}
      {showRepasseModal && (
        <div onClick={() => setShowRepasseModal(false)} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.6)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: "16px", backdropFilter: "blur(4px)" }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "20px", padding: "28px", maxWidth: "600px", width: "100%", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 25px 60px rgba(0,0,0,0.3)", border: "1px solid #E2E8F0" }}>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px", borderBottom: "1px solid #F1F5F9", paddingBottom: "14px" }}>
              <div>
                <h3 style={{ fontWeight: 900, fontSize: "1.15rem", color: "#0F172A", margin: 0 }}>Configurações financeiras de repasse</h3>
                <span style={{ fontSize: "0.78rem", color: "#64748B" }}>Configure a conta e a frequência para receber suas vendas online.</span>
              </div>
              <button onClick={() => setShowRepasseModal(false)} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1.2rem", color: "#64748B", fontWeight: 700 }}>✕</button>
            </div>

            {/* Banner de status / aviso */}
            <div style={{ background: "#FFFBEB", border: "1.5px solid #FCD34D", borderRadius: "14px", padding: "14px 16px", marginBottom: "20px" }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                <ShieldCheck size={22} color="#D97706" style={{ marginTop: 2, flexShrink: 0 }} />
                <div style={{ fontSize: "0.82rem", color: "#92400E", lineHeight: 1.5 }}>
                  <strong>Ativação da sua conta bancária na FireHub</strong>
                  <div style={{ marginTop: 4 }}>Acompanhe o progresso da sua conta. Quando estiver tudo certo, você receberá seus repasses automaticamente no Pix cadastrado!</div>
                </div>
              </div>
            </div>

            {/* CARD 1: Conta de repasse */}
            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "16px", padding: "1.25rem", marginBottom: "1.25rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "0.75rem" }}>
                <Banknote size={20} color="#16A34A" />
                <div>
                  <h4 style={{ fontWeight: 800, fontSize: "0.95rem", margin: 0, color: "#0F172A" }}>Conta de repasse</h4>
                  <span style={{ fontSize: "0.76rem", color: "#64748B" }}>Configure a conta para recebimento do saldo disponível das vendas online da sua loja.</span>
                </div>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "14px" }}>
                <div>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>Tipo de Chave Pix</label>
                  <select
                    value={repasseConfig.tipoChave || "CPF"}
                    onChange={e => setRepasseConfig({ ...repasseConfig, tipoChave: e.target.value })}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid #CBD5E1", fontSize: "0.88rem", background: "#fff" }}
                  >
                    <option value="CPF">CPF</option>
                    <option value="CNPJ">CNPJ</option>
                    <option value="EMAIL">E-mail</option>
                    <option value="TELEFONE">Celular / Telefone</option>
                    <option value="ALEATORIA">Chave Aleatória (EVP)</option>
                    <option value="DADOS_BANCARIOS">Dados Bancários (Conta Corrente / Poupança)</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>Chave Pix ou Dados da Conta</label>
                  <input
                    type="text"
                    placeholder="Digite sua Chave Pix..."
                    value={repasseConfig.chavePix || ""}
                    onChange={e => setRepasseConfig({ ...repasseConfig, chavePix: e.target.value })}
                    style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid #CBD5E1", fontSize: "0.88rem", background: "#fff" }}
                  />
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>Nome do Titular</label>
                    <input
                      type="text"
                      placeholder="Nome completo ou Razão Social"
                      value={repasseConfig.titular || ""}
                      onChange={e => setRepasseConfig({ ...repasseConfig, titular: e.target.value })}
                      style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid #CBD5E1", fontSize: "0.88rem", background: "#fff" }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>CPF / CNPJ do Titular</label>
                    <input
                      type="text"
                      placeholder="000.000.000-00"
                      value={repasseConfig.cpfCnpj || ""}
                      onChange={e => setRepasseConfig({ ...repasseConfig, cpfCnpj: e.target.value })}
                      style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid #CBD5E1", fontSize: "0.88rem", background: "#fff" }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* CARD 2: Frequência do repasse */}
            <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: "16px", padding: "1.25rem", marginBottom: "1.5rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: "0.75rem" }}>
                <Clock size={20} color="#2563EB" />
                <div>
                  <h4 style={{ fontWeight: 800, fontSize: "0.95rem", margin: 0, color: "#0F172A" }}>Frequência do repasse</h4>
                  <span style={{ fontSize: "0.76rem", color: "#64748B" }}>De quanto em quanto tempo e a que horas você quer receber o saldo disponível da sua loja.</span>
                </div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginTop: "14px" }}>
                <label
                  onClick={() => setRepasseConfig({ ...repasseConfig, frequencia: "DAILY" })}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: "12px", border: `2px solid ${repasseConfig.frequencia === "DAILY" ? "#EF4444" : "#E2E8F0"}`, background: repasseConfig.frequencia === "DAILY" ? "#FEF2F2" : "#fff", cursor: "pointer" }}
                >
                  <input type="radio" checked={repasseConfig.frequencia === "DAILY"} readOnly />
                  <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#0F172A" }}>Todos os dias</span>
                </label>

                <label
                  onClick={() => setRepasseConfig({ ...repasseConfig, frequencia: "WEEKLY" })}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", borderRadius: "12px", border: `2px solid ${repasseConfig.frequencia === "WEEKLY" ? "#EF4444" : "#E2E8F0"}`, background: repasseConfig.frequencia === "WEEKLY" ? "#FEF2F2" : "#fff", cursor: "pointer" }}
                >
                  <input type="radio" checked={repasseConfig.frequencia === "WEEKLY"} readOnly />
                  <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#0F172A" }}>Uma vez por semana</span>
                </label>
              </div>

              <div style={{ marginTop: "14px" }}>
                <label style={{ fontSize: "0.78rem", fontWeight: 700, color: "#334155", display: "block", marginBottom: 4 }}>Horário do repasse (Horário de Brasília)</label>
                <select
                  value={repasseConfig.horario || "03:00"}
                  onChange={e => setRepasseConfig({ ...repasseConfig, horario: e.target.value })}
                  style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid #CBD5E1", fontSize: "0.88rem", background: "#fff" }}
                >
                  <option value="03:00">03:00 (Madrugada)</option>
                  <option value="06:00">06:00 (Manhã)</option>
                  <option value="12:00">12:00 (Meio-dia)</option>
                  <option value="18:00">18:00 (Fim de Tarde)</option>
                  <option value="22:00">22:00 (Noite)</option>
                </select>
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                type="button"
                onClick={() => setShowRepasseModal(false)}
                style={{ flex: 1, padding: "12px", borderRadius: "10px", border: "1px solid #CBD5E1", background: "#F8FAFC", fontWeight: 700, cursor: "pointer" }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveRepasse}
                disabled={savingRepasse}
                style={{ flex: 2, padding: "12px", borderRadius: "10px", border: "none", background: "#EF4444", color: "#fff", fontWeight: 700, cursor: savingRepasse ? "not-allowed" : "pointer" }}
              >
                {savingRepasse ? "Salvando..." : "Salvar Configurações de Repasse"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
