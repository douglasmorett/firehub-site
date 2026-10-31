"use client";

import { useRef, useState } from "react";
import { Flame, ShieldCheck, ExternalLink, Monitor, Play, Check, ClipboardCheck, Clock } from "lucide-react";
import ConexaoDoFirecheck from "@/components/cmv/ConexaoDoFirecheck";
import ModulosNoBoleto from "@/components/firecheck/ModulosNoBoleto";
import { DIAS_DE_TESTE_DO_FIRECHECK, PRECO_DO_COMBO, PRECO_POR_MODULO, type ModuloDoFirecheck } from "@/lib/firecheck-modulos/preco";

// A página de quem ainda não assinou vende como a landing do FireCheck
// (Douglas, 31/10/2026: "tem que ter aquelas três caixinhas... com aquele vídeo
// que a gente fez"): vídeo, os dois módulos, os avisos, os planos e as perguntas.
const reais = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

const MODULOS_A_VENDA: { id: ModuloDoFirecheck; titulo: string; pessoas: string; icone: React.ReactNode; tela: string; legenda: string; itens: string[] }[] = [
  {
    id: "checklists", titulo: "Checklist com IA", pessoas: "até 30 pessoas", icone: <ClipboardCheck size={20} />,
    tela: "/firecheck/tela-checklist.jpg", legenda: "A IA reprovando a foto da bancada",
    itens: [
      "Crie falando ou escrevendo: a IA monta as tarefas",
      "Foto tirada na hora, pela câmera do app",
      "A IA confere a foto, reprova o que saiu do padrão e pede para refazer",
      "Hora limite por tarefa: passou e ninguém fez, o aviso chega no WhatsApp",
      "Estoque mínimo, lista de compras, vistoria de frota e descarte",
      "O descarte lançado vira perda no estoque e no CMV do FireHub",
      "Ranking da equipe e PDF de cada checklist",
    ],
  },
  {
    id: "ponto", titulo: "Controle de ponto", pessoas: "até 30 pessoas", icone: <Clock size={20} />,
    tela: "/firecheck/tela-ponto.jpg", legenda: "Ponto com selfie e GPS",
    itens: [
      "Selfie com reconhecimento facial em cada batida",
      "Localização (GPS) e endereço gravados na batida",
      "Aviso de atraso e ausência no WhatsApp",
      "Todo dia às 8h, o resumo do ponto de ontem no WhatsApp",
      "Escala, banco de horas, atestados e feriados",
      "Tablet da loja como relógio de ponto",
      "Espelho do ponto pronto para o contador",
    ],
  },
];

const AVISOS: [string, string, string][] = [
  ["❌ Reprovado pela IA", "Limpeza da chapa · Carlos: \"crosta de gordura na lateral direita\"", "#DC2626"],
  ["⏰ Checklist atrasado", "Abertura da loja: passou da hora limite (10:00) e ninguém enviou", "#D97706"],
  ["🕐 Ausência no ponto", "João não bateu a entrada das 08:00", "#D97706"],
  ["📊 Ponto de ontem", "6 pessoas · 1 falta · 1 com batida faltando", "#2563EB"],
  ["🗑️ Descarte registrado", "2 kg de muçarela vencida · R$ 64,00", "#64748B"],
];

const PASSOS: [string, string][] = [
  ["Ligue aqui mesmo", "Escolha o plano e toque em testar. A conta do FireCheck é criada na hora, já ligada à sua loja."],
  ["Monte o checklist e chame a equipe", "Grave um áudio ou escreva o que tem que ser feito: a IA monta o checklist com foto obrigatória e horário."],
  ["Acompanhe pelo WhatsApp", "Reprovou, atrasou, faltou, teve descarte: você fica sabendo na hora. O painel guarda tudo com foto, hora e quem fez."],
];

const PERGUNTAS: [string, string][] = [
  ["Como é cobrado?", `Na mensalidade do FireHub, numa linha própria do boleto: ${reais(PRECO_POR_MODULO.checklists)} por módulo ou ${reais(PRECO_DO_COMBO)} pelos dois. Não precisa de cartão. O FireCheck é à parte da mensalidade da loja.`],
  ["E se eu não gostar?", `Desligue durante os ${DIAS_DE_TESTE_DO_FIRECHECK} dias grátis: ele para na hora e nada é cobrado. O teste grátis vale uma vez por módulo.`],
  ["Depois do teste, posso desligar?", "Pode, sem multa. O mês em curso já está no boleto (inteiro, sem valor proporcional), então ele fica liberado até o fim do mês e desliga sozinho na virada."],
  ["Funciona no celular da equipe?", "Sim: Android, iPhone e navegador. Você acompanha pelo celular ou pelo computador."],
  ["Quantos funcionários posso ter?", "Até 30 com um módulo e até 50 com os dois."],
  ["Já pago o FireCheck no cartão. E agora?", "Cancele a assinatura do cartão antes de ligar aqui, para não pagar duas vezes. A sua conta continua a mesma: conecte no quadro do fim da página."],
];

const S: Record<string, React.CSSProperties> = {
  titulo: { fontSize: "clamp(1.3rem, 3vw, 1.6rem)", fontWeight: 900, color: "#0F172A", margin: "0 0 6px", letterSpacing: "-0.3px" },
  lead: { fontSize: "0.95rem", color: "#475569", lineHeight: 1.55, margin: "0 0 16px" },
  cartao: { background: "#FFF", border: "1px solid #E2E8F0", borderRadius: 16, padding: 20, boxShadow: "0 4px 6px rgba(0,0,0,0.02)" },
  icone: { width: 40, height: 40, borderRadius: 12, background: "#FFF4EF", color: "#E8590C", display: "grid", placeItems: "center", flexShrink: 0 },
};

export default function FireCheckClient({ user }: { user: { id: string; storeName?: string | null; email: string } }) {
  // Quando um dos dois muda a ligação, o OUTRO se recarrega. Um contador para
  // cada: recarregar os módulos junto apagava a senha da conta recém-criada.
  const [versaoDaConexao, setVersaoDaConexao] = useState(0);
  const [versaoDosModulos, setVersaoDosModulos] = useState(0);
  const [activeTab, setActiveTab] = useState<"presentation" | "app">("presentation");
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [videoTocando, setVideoTocando] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const tocarVideo = () => {
    videoRef.current?.play().catch(() => null);
    setVideoTocando(true);
  };
  const irParaPlanos = () => document.getElementById("planos-firecheck")?.scrollIntoView({ behavior: "smooth", block: "start" });

  return (
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 0 3rem" }}>
      
      {/* SELETOR DE ABA: APRESENTAÇÃO VS APP INTEGRADO */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.5rem", flexWrap: "wrap", gap: "1rem" }}>
        <div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "#FFF4EF", border: "1px solid #FFF4EF", color: "#E8590C", fontSize: "0.75rem", fontWeight: 800, padding: "4px 12px", borderRadius: 20, marginBottom: 6 }}>
            <Flame size={14} /> MÓDULO PARCEIRO INTEGRADO
          </div>
          <h1 style={{ fontWeight: 900, fontSize: "1.5rem", color: "#0F172A", margin: 0 }}>
            FireCheck — Checklist & Ponto Inteligente
          </h1>
        </div>

        <div style={{ display: "flex", background: "#F1F5F9", padding: "4px", borderRadius: "12px", gap: "4px" }}>
          <button
            onClick={() => setActiveTab("presentation")}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              background: activeTab === "presentation" ? "#FFF" : "transparent",
              color: activeTab === "presentation" ? "#0F172A" : "#64748B",
              fontWeight: 700,
              fontSize: "0.85rem",
              cursor: "pointer",
              boxShadow: activeTab === "presentation" ? "0 2px 4px rgba(0,0,0,0.05)" : "none",
              display: "flex",
              alignItems: "center",
              gap: 6
            }}
          >
            <ShieldCheck size={16} color={activeTab === "presentation" ? "#FF4D00" : "#64748B"} /> Conhecer & Assinar
          </button>
          <button
            onClick={() => setActiveTab("app")}
            style={{
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              background: activeTab === "app" ? "#FFF" : "transparent",
              color: activeTab === "app" ? "#0F172A" : "#64748B",
              fontWeight: 700,
              fontSize: "0.85rem",
              cursor: "pointer",
              boxShadow: activeTab === "app" ? "0 2px 4px rgba(0,0,0,0.05)" : "none",
              display: "flex",
              alignItems: "center",
              gap: 6
            }}
          >
            <Monitor size={16} color={activeTab === "app" ? "#1C1917" : "#64748B"} /> Abrir FireCheck Direct
          </button>
        </div>
      </div>

      {activeTab === "presentation" ? (
        <>
          {/* PROMESSA + VÍDEO (o mesmo clipe da landing do FireCheck) */}
          <div style={{ background: "linear-gradient(135deg, #0F172A 0%, #1E293B 100%)", borderRadius: 24, padding: "clamp(1.25rem, 4vw, 2.5rem)", color: "#FFF", marginBottom: "2rem", position: "relative", overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
            <div style={{ position: "absolute", top: -80, right: -80, width: 360, height: 360, background: "radial-gradient(circle, rgba(255,77,0,0.22) 0%, rgba(0,0,0,0) 70%)", borderRadius: "50%", pointerEvents: "none" }} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: "2rem", alignItems: "center", position: "relative" }}>
              <div>
                <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(255,77,0,0.2)", border: "1px solid rgba(255,77,0,0.4)", color: "#FF7A38", fontSize: "0.78rem", fontWeight: 800, padding: "5px 14px", borderRadius: 20, marginBottom: 14 }}>
                  CHECKLIST COM IA + PONTO COM RECONHECIMENTO FACIAL
                </div>
                <h2 style={{ fontSize: "clamp(1.6rem, 4vw, 2.3rem)", fontWeight: 900, lineHeight: 1.15, margin: "0 0 14px", letterSpacing: "-0.5px" }}>
                  Sua equipe faz. <span style={{ color: "#FF4D00" }}>A IA confere.</span> Você recebe no WhatsApp.
                </h2>
                <p style={{ fontSize: "1rem", color: "#CBD5E1", lineHeight: 1.6, margin: "0 0 22px" }}>
                  A equipe faz o checklist pelo celular, com foto tirada na hora. A inteligência artificial confere cada foto e reprova o que saiu do padrão.
                  O ponto é batido com selfie e reconhecimento facial. E os avisos saem do WhatsApp da sua loja para você e o seu gerente.
                </p>
                <button onClick={irParaPlanos}
                  style={{ background: "#FF4D00", color: "#FFF", padding: "14px 30px", borderRadius: 12, fontWeight: 900, fontSize: "1rem", cursor: "pointer", border: "none", boxShadow: "0 10px 24px rgba(255,77,0,0.4)" }}>
                  Testar {DIAS_DE_TESTE_DO_FIRECHECK} dias grátis
                </button>
                <div style={{ fontSize: "0.85rem", color: "#94A3B8", marginTop: 12, lineHeight: 1.5 }}>
                  {reais(PRECO_POR_MODULO.checklists)} por mês cada módulo · <b style={{ color: "#FFF" }}>os dois por {reais(PRECO_DO_COMBO)}</b><br />
                  Vem no boleto do FireHub. Sem cartão.
                </div>
              </div>
              <div style={{ position: "relative", width: "min(100%, 290px)", aspectRatio: "9 / 16", justifySelf: "center", borderRadius: 26, overflow: "hidden", border: "6px solid #1E293B", boxShadow: "0 24px 60px rgba(0,0,0,0.5)", background: "#000" }}>
                <video ref={videoRef} src="/firecheck/clipe.mp4" poster="/firecheck/clipe-capa.jpg" playsInline preload="none"
                  controls={videoTocando} onEnded={() => setVideoTocando(false)}
                  style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
                {!videoTocando && (
                  <button onClick={tocarVideo} aria-label="Ver o vídeo"
                    style={{ position: "absolute", inset: 0, border: "none", background: "linear-gradient(180deg, rgba(0,0,0,0) 55%, rgba(0,0,0,0.65) 100%)", cursor: "pointer", display: "flex", alignItems: "flex-end", justifyContent: "center", paddingBottom: 22 }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "#FFF", color: "#0F172A", fontWeight: 900, fontSize: "0.9rem", padding: "10px 18px", borderRadius: 999, boxShadow: "0 8px 20px rgba(0,0,0,0.35)" }}>
                      <Play size={16} fill="#FF4D00" color="#FF4D00" /> Veja funcionando · 37 s
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* OS DOIS MÓDULOS */}
          <h2 style={S.titulo}>Dois módulos. <span style={{ color: "#FF4D00" }}>Ligue um ou os dois.</span></h2>
          <p style={S.lead}>Tudo funciona no celular da equipe (Android ou iPhone), e você acompanha pelo celular ou pelo computador.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: "1.25rem", marginBottom: "2.5rem" }}>
            {MODULOS_A_VENDA.map((m) => (
              <div key={m.titulo} style={{ ...S.cartao, display: "grid", gridTemplateColumns: "1fr auto", gap: 16, alignItems: "start" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={S.icone}>{m.icone}</span>
                    <div>
                      <div style={{ fontWeight: 900, fontSize: "1.1rem", color: "#0F172A" }}>{m.titulo}</div>
                      <div style={{ fontSize: "0.8rem", color: "#E8590C", fontWeight: 800 }}>{reais(PRECO_POR_MODULO[m.id])} por mês · {m.pessoas}</div>
                    </div>
                  </div>
                  <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0", display: "grid", gap: 7 }}>
                    {m.itens.map((i) => (
                      <li key={i} style={{ display: "flex", gap: 8, fontSize: "0.88rem", color: "#334155", lineHeight: 1.45 }}>
                        <Check size={16} color="#16A34A" style={{ flexShrink: 0, marginTop: 2 }} /> {i}
                      </li>
                    ))}
                  </ul>
                </div>
                <img src={m.tela} alt={m.legenda} loading="lazy" style={{ width: "clamp(84px, 22vw, 120px)", borderRadius: 14, border: "4px solid #0F172A", boxShadow: "0 8px 20px rgba(15,23,42,0.18)" }} />
              </div>
            ))}
          </div>

          {/* O QUE CHEGA NO WHATSAPP */}
          <div style={{ background: "#0F172A", borderRadius: 24, padding: "clamp(1.25rem, 4vw, 2.25rem)", marginBottom: "2.5rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: "1.5rem", alignItems: "center" }}>
            <div>
              <h2 style={{ ...S.titulo, color: "#FFF" }}>Você fica sabendo <span style={{ color: "#FF4D00" }}>na hora, não no dia seguinte.</span></h2>
              <p style={{ ...S.lead, color: "#CBD5E1", margin: 0 }}>
                Você conecta o WhatsApp da sua loja lendo um QR Code, como no WhatsApp Web. Os avisos saem desse número para você, para o gerente e para até 10 números extras. Você escolhe quais avisos cada um recebe.
              </p>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {AVISOS.map(([titulo, texto, cor]) => (
                <div key={titulo} style={{ background: "#DCF8C6", color: "#111B21", borderRadius: "12px 12px 12px 4px", padding: "10px 14px", fontSize: "0.88rem", lineHeight: 1.45, borderLeft: `4px solid ${cor}`, maxWidth: 440 }}>
                  <b>{titulo}</b><br />{texto}
                </div>
              ))}
            </div>
          </div>

          {/* COMO FUNCIONA */}
          <h2 style={S.titulo}>Como funciona</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 240px), 1fr))", gap: "1rem", margin: "14px 0 2.5rem" }}>
            {PASSOS.map(([titulo, texto], i) => (
              <div key={titulo} style={{ ...S.cartao, display: "flex", gap: 14 }}>
                <span style={{ width: 34, height: 34, borderRadius: "50%", background: "#FF4D00", color: "#FFF", fontWeight: 900, display: "grid", placeItems: "center", flexShrink: 0 }}>{i + 1}</span>
                <div>
                  <div style={{ fontWeight: 800, color: "#0F172A", marginBottom: 4 }}>{titulo}</div>
                  <div style={{ fontSize: "0.86rem", color: "#64748B", lineHeight: 1.5 }}>{texto}</div>
                </div>
              </div>
            ))}
          </div>

          {/* PLANOS: as três caixas e o ligar no boleto do FireHub */}
          <ModulosNoBoleto key={`m${versaoDosModulos}`} onConectou={() => setVersaoDaConexao((v) => v + 1)} />

          {/* PERGUNTAS */}
          <h2 style={{ ...S.titulo, marginTop: "1rem" }}>Perguntas frequentes</h2>
          <div style={{ display: "grid", gap: 8, margin: "12px 0 2.5rem" }}>
            {PERGUNTAS.map(([p, r]) => (
              <details key={p} style={{ ...S.cartao, padding: "14px 18px" }}>
                <summary style={{ fontWeight: 800, color: "#0F172A", cursor: "pointer" }}>{p}</summary>
                <p style={{ fontSize: "0.9rem", color: "#475569", lineHeight: 1.55, margin: "8px 0 0" }}>{r}</p>
              </details>
            ))}
          </div>

          <ConexaoDoFirecheck key={`c${versaoDaConexao}`} onMudou={() => setVersaoDosModulos((v) => v + 1)} />
        </>
      ) : (
        /* ABA APP INTEGRADO / IFRAME DO FIRECHECK */
        <>
        <ConexaoDoFirecheck key={`c${versaoDaConexao}`} onMudou={() => setVersaoDosModulos((v) => v + 1)} />
        <div style={{ background: "#FFF", borderRadius: "20px", border: "1px solid #E2E8F0", padding: "16px", boxShadow: "0 10px 30px rgba(0,0,0,0.05)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px", background: "#F8FAFC", padding: "12px 16px", borderRadius: "12px", border: "1px solid #E2E8F0" }}>
            <div style={{ fontSize: "0.85rem", color: "#475569", fontWeight: 600 }}>
              🌐 Conectado ao <strong>FireCheck Web</strong> ({user.email})
            </div>
            <a
              href="https://www.firecheckapp.com.br/login"
              target="_blank"
              rel="noreferrer"
              style={{ color: "#1C1917", fontWeight: 700, fontSize: "0.82rem", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
            >
              Abrir em Nova Aba <ExternalLink size={14} />
            </a>
          </div>

          <div style={{ position: "relative", width: "100%", height: "720px", borderRadius: "12px", overflow: "hidden", border: "1px solid #CBD5E1", background: "#0F172A" }}>
            {!iframeLoaded && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#FFF", gap: "12px" }}>
                <Flame size={40} className="animate-bounce" color="#FF4D00" />
                <div style={{ fontSize: "0.95rem", fontWeight: 700 }}>Carregando plataforma FireCheck...</div>
              </div>
            )}
            <iframe
              src="https://www.firecheckapp.com.br/login"
              style={{ width: "100%", height: "100%", border: "none" }}
              onLoad={() => setIframeLoaded(true)}
              title="FireCheck App"
            />
          </div>
        </div>
        </>
      )}
    </div>
  );
}
