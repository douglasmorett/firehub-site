"use client";
/**
 * FireHub — Onboarding Wizard (estilo Brendi)
 * Timeline horizontal de fases + tarefas com subtarefas e tempo estimado.
 * Substitui o checklist básico anterior.
 */
import { useState, useEffect } from "react";
import { Check, ChevronRight, Clock, ExternalLink, Trophy, Star, Zap } from "lucide-react";

// ─── TIPOS ────────────────────────────────────────────────────────────────
type SubTask = { id: string; label: string };
type Task = {
  id: string;
  icon: string;
  title: string;
  description: string;
  minutes: number;
  href: string;
  subTasks?: SubTask[];
};
type Phase = {
  id: string;
  label: string;
  shortLabel: string;
  icon: string;
  tasks: Task[];
};

// ─── FASES & TAREFAS ─────────────────────────────────────────────────────
const PHASES: Phase[] = [
  {
    id: "configurar_loja",
    label: "Configurar Loja",
    shortLabel: "Config. Loja",
    icon: "🏪",
    tasks: [
      {
        id: "logo",
        icon: "🖼️",
        title: "Adicione logo e banner da loja",
        description: "Lojas com identidade visual vendem até 3x mais. Configure sua aparência agora.",
        minutes: 3,
        href: "/store/minha-loja",
        subTasks: [
          { id: "logo_upload", label: "Fazer upload do logo" },
          { id: "banner_upload", label: "Fazer upload do banner" },
        ],
      },
      {
        id: "hours",
        icon: "🕐",
        title: "Configure seus horários",
        description: "Seus clientes precisam saber quando você está aberto. Defina dias e horários.",
        minutes: 2,
        href: "/store/minha-loja#horarios",
        subTasks: [
          { id: "hours_set", label: "Definir horários por dia da semana" },
          { id: "hours_test", label: "Verificar exibição na loja" },
        ],
      },
      {
        id: "payment",
        icon: "💳",
        title: "Configure formas de pagamento",
        description: "Aceite PIX, cartão e dinheiro. Mais opções = mais vendas garantidas.",
        minutes: 2,
        href: "/store/minha-loja#pagamento",
      },
      {
        id: "delivery",
        icon: "🛵",
        title: "Configure sua zona de entrega",
        description: "Defina bairros ou raio de entrega com taxas por região.",
        minutes: 5,
        href: "/store/minha-loja#entrega",
        subTasks: [
          { id: "delivery_type", label: "Escolher tipo: bairros ou raio (km)" },
          { id: "delivery_fee", label: "Definir taxas de entrega" },
          { id: "delivery_min", label: "Definir pedido mínimo" },
        ],
      },
    ],
  },
  {
    id: "montar_cardapio",
    label: "Montar Cardápio",
    shortLabel: "Cardápio",
    icon: "🍽️",
    tasks: [
      {
        id: "import_ifood",
        icon: "⚡",
        title: "Importe seu cardápio do iFood",
        description: "Cole o link do seu restaurante no iFood e importamos tudo em segundos.",
        minutes: 1,
        href: "/store/cardapio",
      },
      {
        id: "menu",
        icon: "🍔",
        title: "Cadastre seus produtos",
        description: "Adicione nome, foto, preço e categoria para cada item do seu menu.",
        minutes: 10,
        href: "/store/cardapio",
        subTasks: [
          { id: "menu_cat", label: "Criar categorias (ex: Lanches, Bebidas)" },
          { id: "menu_prod", label: "Adicionar pelo menos 5 produtos" },
          { id: "menu_foto", label: "Adicionar fotos dos produtos" },
        ],
      },
      {
        id: "combo",
        icon: "🎁",
        title: "Crie combos irresistíveis",
        description: "Combos aumentam o ticket médio em até 40%. Monte seu primeiro combo agora.",
        minutes: 5,
        href: "/store/cardapio",
      },
    ],
  },
  {
    id: "ativar_loja",
    label: "Teste e Ativação",
    shortLabel: "Ativação",
    icon: "🚀",
    tasks: [
      {
        id: "test_order",
        icon: "🧪",
        title: "Faça um pedido de teste",
        description: "Teste o fluxo completo como seu cliente. Pedidos de teste não entram na mensalidade.",
        minutes: 3,
        href: "/store",
        subTasks: [
          { id: "test_open", label: "Abrir a loja em outro navegador/aba" },
          { id: "test_add", label: "Adicionar produto ao carrinho" },
          { id: "test_checkout", label: "Finalizar pedido de teste" },
        ],
      },
      {
        id: "share_link",
        icon: "📤",
        title: "Compartilhe seu link da loja",
        description: "Envie no WhatsApp, Instagram e stories para começar a receber pedidos.",
        minutes: 2,
        href: "/store",
      },
    ],
  },
  {
    id: "crescimento",
    label: "Crescimento",
    shortLabel: "Crescimento",
    icon: "📈",
    tasks: [
      {
        id: "meta_ads",
        icon: "🎯",
        title: "Ative o tráfego pago com IA",
        description: "Meta Ads no piloto automático — anúncios no Facebook e Instagram para sua região.",
        minutes: 5,
        href: "/store/meta-ads",
      },
      {
        id: "coupon",
        icon: "🏷️",
        title: "Crie seu primeiro cupom de desconto",
        description: "Cupons são a forma mais rápida de conquistar novos clientes.",
        minutes: 2,
        href: "/store/minha-loja#cupons",
      },
      {
        id: "first_order",
        icon: "🎉",
        title: "Receba seu 1° pedido real",
        description: "O grande momento! Depois disso você vira Loja Campeã.",
        minutes: 0,
        href: "/store/pedidos-clientes",
      },
    ],
  },
  {
    id: "loja_campea",
    label: "Loja Campeã",
    shortLabel: "Campeã",
    icon: "🏆",
    tasks: [],
  },
];

// ─── MAPEAMENTO: step do servidor → IDs do wizard ─────────────────────────
const SERVER_TO_WIZARD: Record<string, string[]> = {
  logo:        ["logo"],
  hours:       ["hours"],
  payment:     ["payment"],
  delivery:    ["delivery"],
  menu:        ["import_ifood", "menu"],
  first_order: ["test_order", "share_link", "first_order"],
};

// ─── COMPONENTE PRINCIPAL ────────────────────────────────────────────────
export default function OnboardingChecklist({
  completedSteps = [],
}: {
  completedSteps?: string[];
}) {
  const [dismissed, setDismissed]   = useState(false);
  const [activePhase, setActivePhase] = useState(0);
  const [done, setDone]             = useState<Set<string>>(new Set());

  // Inicializa done a partir dos steps do servidor + localStorage
  useEffect(() => {
    const initial = new Set<string>();

    // Converte steps do servidor
    completedSteps.forEach(step => {
      SERVER_TO_WIZARD[step]?.forEach(id => initial.add(id));
    });

    // Merge com localStorage
    const saved = localStorage.getItem("firehub_wizard_done");
    if (saved) {
      JSON.parse(saved).forEach((id: string) => initial.add(id));
    }

    setDone(initial);

    // Determina a fase ativa pelo progresso
    let phase = 0;
    for (let i = 0; i < PHASES.length - 1; i++) {
      const tasks = PHASES[i].tasks;
      if (tasks.length === 0) continue;
      const phaseDone = tasks.filter(t => initial.has(t.id)).length;
      if (phaseDone === tasks.length) phase = i + 1;
      else { phase = i; break; }
    }
    setActivePhase(Math.min(phase, PHASES.length - 1));
  }, [completedSteps]);

  function toggleTask(taskId: string) {
    setDone(prev => {
      const next = new Set(prev);
      next.has(taskId) ? next.delete(taskId) : next.add(taskId);
      localStorage.setItem("firehub_wizard_done", JSON.stringify([...next]));
      return next;
    });
  }

  // Métricas globais
  const allTasks = PHASES.flatMap(p => p.tasks);
  const totalTasks = allTasks.length;
  const doneTasks = allTasks.filter(t => done.has(t.id)).length;
  const globalPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const allComplete = doneTasks === totalTasks;

  // Tarefas da fase ativa
  const phase = PHASES[activePhase];
  const phaseDoneCount = phase.tasks.filter(t => done.has(t.id)).length;

  if (dismissed) return null;
  if (allComplete && globalPct === 100) return (
    <div style={{ background: "linear-gradient(135deg,#F59E0B,#EF4444)", borderRadius: 20, padding: "1.5rem", marginBottom: "1.5rem", textAlign: "center", color: "#fff" }}>
      <div style={{ fontSize: "3rem", marginBottom: 8 }}>🏆</div>
      <h3 style={{ fontWeight: 900, fontSize: "1.2rem", margin: "0 0 4px" }}>Loja Campeã! Configuração 100% completa.</h3>
      <p style={{ opacity: 0.85, fontSize: "0.85rem", margin: 0 }}>Continue crescendo com Meta Ads e acompanhe seus resultados no Financeiro.</p>
    </div>
  );

  return (
    <div style={{ background: "#fff", borderRadius: 20, boxShadow: "0 4px 24px rgba(0,0,0,0.08)", border: "1px solid #E2E8F0", overflow: "hidden", marginBottom: "1.5rem" }}>

      {/* ── TOP HEADER ─────────────────────────────────────────────── */}
      <div style={{ background: "linear-gradient(135deg,#0F172A,#1E293B)", padding: "1rem 1.25rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Zap size={18} color="#F59E0B" />
            <span style={{ fontWeight: 800, color: "#fff", fontSize: "0.95rem" }}>Sua jornada FireHub</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: "0.72rem", color: "rgba(255,255,255,0.5)" }}>
              Faltam <strong style={{ color: "#F59E0B" }}>{totalTasks - doneTasks} passos</strong> para completar
            </span>
            <button onClick={() => setDismissed(true)} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: 6, padding: "3px 8px", color: "rgba(255,255,255,0.4)", cursor: "pointer", fontSize: "0.7rem" }}>
              Ocultar
            </button>
          </div>
        </div>

        {/* Barra de progresso global */}
        <div style={{ background: "rgba(255,255,255,0.1)", borderRadius: 100, height: 5, marginBottom: "0.85rem" }}>
          <div style={{ width: `${globalPct}%`, height: "100%", background: "linear-gradient(90deg,#E63946,#F59E0B)", borderRadius: 100, transition: "width 0.5s" }} />
        </div>

        {/* Timeline de fases */}
        <div style={{ display: "flex", gap: 0, overflowX: "auto", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" } as any}>
          {PHASES.map((ph, idx) => {
            const phTasks = ph.tasks;
            const phDone = phTasks.filter(t => done.has(t.id)).length;
            const phComplete = phTasks.length > 0 && phDone === phTasks.length;
            const isCurrent = idx === activePhase;
            const isPast = idx < activePhase || phComplete;
            const isLast = idx === PHASES.length - 1;

            return (
              <div key={ph.id} style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                <button
                  onClick={() => setActivePhase(idx)}
                  style={{
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 4,
                    background: "none", border: "none", cursor: "pointer", padding: "0 6px",
                    opacity: isPast || isCurrent ? 1 : 0.45,
                  }}
                >
                  <div style={{
                    width: 30, height: 30, borderRadius: "50%",
                    background: phComplete ? "#16A34A" : isCurrent ? "#E63946" : "rgba(255,255,255,0.12)",
                    border: isCurrent ? "2px solid #E63946" : phComplete ? "2px solid #16A34A" : "2px solid rgba(255,255,255,0.2)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: phComplete ? "0.7rem" : "0.85rem",
                    transition: "all 0.2s",
                  }}>
                    {phComplete ? <Check size={14} color="#fff" strokeWidth={3} /> : ph.icon}
                  </div>
                  <span style={{ fontSize: "0.6rem", color: isCurrent ? "#fff" : "rgba(255,255,255,0.55)", fontWeight: isCurrent ? 800 : 500, whiteSpace: "nowrap" }}>
                    {ph.shortLabel}
                  </span>
                </button>
                {!isLast && (
                  <div style={{ width: 20, height: 2, background: isPast && !isCurrent ? "#16A34A" : "rgba(255,255,255,0.15)", marginBottom: 14, flexShrink: 0 }} />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── FASE ATIVA ─────────────────────────────────────────────── */}
      <div style={{ padding: "1.25rem" }}>
        <div style={{ marginBottom: "1rem" }}>
          <span style={{ fontSize: "0.68rem", fontWeight: 700, color: "#E63946", textTransform: "uppercase", letterSpacing: "0.8px" }}>ETAPA ATUAL</span>
          <h2 style={{ fontWeight: 900, fontSize: "1.1rem", margin: "2px 0 0", color: "#0F172A" }}>{phase.icon} {phase.label}</h2>
          {phase.tasks.length > 0 && (
            <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "2px 0 0" }}>
              {phaseDoneCount} de {phase.tasks.length} tarefas completas
            </p>
          )}
          {phase.id === "loja_campea" && (
            <p style={{ fontSize: "0.85rem", color: "#D97706", margin: "4px 0 0", fontWeight: 700 }}>
              🎊 Complete todas as fases anteriores para se tornar uma Loja Campeã!
            </p>
          )}
        </div>

        {/* Lista de tarefas */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {phase.tasks.map(task => {
            const isDone = done.has(task.id);
            const subDone = task.subTasks?.filter(s => done.has(`${task.id}_${s.id}`)).length ?? 0;
            const subTotal = task.subTasks?.length ?? 0;

            return (
              <div
                key={task.id}
                style={{
                  borderRadius: 14, border: `1.5px solid ${isDone ? "#BBF7D0" : "#E2E8F0"}`,
                  background: isDone ? "#F0FDF4" : "#FAFAFA",
                  overflow: "hidden", transition: "all 0.2s",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 14px" }}>
                  {/* Status button */}
                  <button
                    onClick={() => toggleTask(task.id)}
                    style={{
                      width: 30, height: 30, borderRadius: "50%", flexShrink: 0, cursor: "pointer",
                      border: isDone ? "2px solid #16A34A" : "2px solid #CBD5E1",
                      background: isDone ? "#16A34A" : "#fff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "all 0.2s",
                    }}
                    title={isDone ? "Marcar como pendente" : "Marcar como concluído"}
                  >
                    {isDone
                      ? <Check size={14} color="#fff" strokeWidth={3} />
                      : <span style={{ fontSize: "0.8rem" }}>{task.icon}</span>
                    }
                  </button>

                  {/* Conteúdo */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <p style={{
                        margin: 0, fontWeight: 700, fontSize: "0.875rem",
                        color: isDone ? "#15803D" : "#0F172A",
                        textDecoration: isDone ? "line-through" : "none",
                        opacity: isDone ? 0.75 : 1,
                      }}>
                        {task.title}
                      </p>
                      {task.minutes > 0 && (
                        <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: "0.68rem", color: "#64748B", background: "#F1F5F9", padding: "1px 7px", borderRadius: 20, fontWeight: 600, flexShrink: 0 }}>
                          <Clock size={10} /> {task.minutes} min
                        </span>
                      )}
                    </div>
                    {!isDone && (
                      <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "#64748B", lineHeight: 1.5 }}>
                        {task.description}
                      </p>
                    )}
                    {/* Progresso de subtarefas */}
                    {subTotal > 0 && !isDone && (
                      <div style={{ marginTop: 6 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                          <span style={{ fontSize: "0.68rem", color: "#94A3B8" }}>{subDone}/{subTotal} etapas</span>
                        </div>
                        <div style={{ background: "#E2E8F0", borderRadius: 100, height: 4, width: 120 }}>
                          <div style={{ width: `${subTotal > 0 ? (subDone / subTotal) * 100 : 0}%`, height: "100%", background: "#E63946", borderRadius: 100, transition: "width 0.3s" }} />
                        </div>
                        <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                          {task.subTasks?.map(sub => {
                            const subId = `${task.id}_${sub.id}`;
                            const isSubDone = done.has(subId);
                            return (
                              <label key={subId} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: "0.75rem", color: isSubDone ? "#16A34A" : "#475569" }}>
                                <input
                                  type="checkbox"
                                  checked={isSubDone}
                                  onChange={() => {
                                    setDone(prev => {
                                      const next = new Set(prev);
                                      next.has(subId) ? next.delete(subId) : next.add(subId);
                                      localStorage.setItem("firehub_wizard_done", JSON.stringify([...next]));
                                      return next;
                                    });
                                  }}
                                  style={{ accentColor: "#E63946", width: 13, height: 13 }}
                                />
                                {sub.label}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* CTA */}
                  {!isDone && (
                    <a
                      href={task.href}
                      style={{
                        flexShrink: 0, display: "flex", alignItems: "center", gap: 5,
                        padding: "7px 14px", borderRadius: 10,
                        background: "#0F172A", color: "#fff",
                        fontSize: "0.75rem", fontWeight: 700, textDecoration: "none",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Ir <ChevronRight size={12} />
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* Navegação entre fases */}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: "1rem", gap: 8 }}>
          {activePhase > 0 && (
            <button onClick={() => setActivePhase(p => p - 1)} style={{ padding: "8px 14px", borderRadius: 10, border: "1.5px solid #E2E8F0", background: "#fff", color: "#64748B", fontWeight: 600, fontSize: "0.8rem", cursor: "pointer" }}>
              ← {PHASES[activePhase - 1].shortLabel}
            </button>
          )}
          <div style={{ flex: 1 }} />
          {activePhase < PHASES.length - 1 && (
            <button onClick={() => setActivePhase(p => p + 1)} style={{ padding: "8px 14px", borderRadius: 10, border: "none", background: "#0F172A", color: "#fff", fontWeight: 700, fontSize: "0.8rem", cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
              {PHASES[activePhase + 1].shortLabel} →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
