import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const role = (session.user as any).role;
  
  // APENAS ADMIN pode acessar este módulo
  if (role !== "ADMIN") {
    return NextResponse.json({ error: "Acesso restrito ao administrador." }, { status: 403 });
  }

  const { message, history } = await req.json();

  if (!message) {
    return NextResponse.json({ error: "Mensagem é obrigatória" }, { status: 400 });
  }

  try {
    // Buscar dados do sistema para contexto — sem dados pessoais sensíveis (LGPD)
    const [users, products, orders, payables, invoices, routes] = await Promise.all([
      prisma.user.findMany({ select: { id: true, name: true, email: true, role: true, city: true, permissions: true, createdAt: true } }),
      prisma.product.findMany({ select: { id: true, name: true, description: true, price: true, active: true, imageUrl: true, createdAt: true } }),
      prisma.order.findMany({ 
        include: { 
          items: { include: { product: { select: { name: true } } } },
          user: { select: { name: true, email: true, city: true } }
        },
        orderBy: { createdAt: "desc" },
        take: 100, // limitar para evitar full scan em produção
      }),
      prisma.payable.findMany({ orderBy: { dueDate: "desc" }, take: 200 }),
      prisma.purchaseInvoice.findMany({ orderBy: { createdAt: "desc" }, take: 100 }),
      prisma.routeSchedule.findMany({ take: 50 }),
    ]);

    // Calcular métricas
    const totalInvoices = invoices.reduce((acc, inv) => acc + (inv.aiValue || 0), 0);
    const totalPayables = payables.reduce((acc, p) => acc + p.value, 0);
    const pendingPayables = payables.filter(p => p.status === "PENDING");
    const paidPayables = payables.filter(p => p.status === "PAID");
    const totalOrders = orders.reduce((acc, o) => acc + o.totalAmount, 0);
    const pendingOrders = orders.filter(o => o.status === "PENDING_PAYMENT");
    const confirmedOrders = orders.filter(o => o.status === "CONFIRMED" || o.status === "PAID");
    const franchisees = users.filter(u => u.role === "FRANCHISEE");
    const staff = users.filter(u => u.role === "STAFF");

    const today = new Date();
    const thisMonth = today.getMonth();
    const thisYear = today.getFullYear();
    
    const ordersThisMonth = orders.filter(o => {
      const d = new Date(o.createdAt);
      return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });
    const revenueThisMonth = ordersThisMonth.reduce((acc, o) => acc + o.totalAmount, 0);

    const invoicesThisMonth = invoices.filter(inv => {
      const d = new Date(inv.createdAt);
      return d.getMonth() === thisMonth && d.getFullYear() === thisYear;
    });
    const spentThisMonth = invoicesThisMonth.reduce((acc, inv) => acc + (inv.aiValue || 0), 0);

    const systemContext = `
SISTEMA: Portal Hakim — Distribuidora de Alimentos
DATA ATUAL: ${today.toLocaleDateString("pt-BR")} ${today.toLocaleTimeString("pt-BR")}
ADMINISTRADOR: ${session.user?.name} (${session.user?.email})

═══ RESUMO EXECUTIVO ═══
• Lojistas cadastrados: ${franchisees.length}
• Funcionários (equipe): ${staff.length}
• Produtos no catálogo: ${products.length} (${products.filter(p => p.active).length} ativos)
• Total de pedidos: ${orders.length}
• Receita total de pedidos: R$ ${totalOrders.toFixed(2)}
• Receita este mês: R$ ${revenueThisMonth.toFixed(2)} (${ordersThisMonth.length} pedidos)
• Gastos com notas fiscais (total): R$ ${totalInvoices.toFixed(2)}
• Gastos este mês (notas): R$ ${spentThisMonth.toFixed(2)} (${invoicesThisMonth.length} notas)
• Contas a pagar pendentes: ${pendingPayables.length} (R$ ${pendingPayables.reduce((a, p) => a + p.value, 0).toFixed(2)})
• Contas já pagas: ${paidPayables.length} (R$ ${paidPayables.reduce((a, p) => a + p.value, 0).toFixed(2)})

═══ LOJISTAS ═══
${franchisees.map(f => `• ${f.name} (${f.email}) — Cidade: ${f.city || "N/I"} — Desde: ${new Date(f.createdAt).toLocaleDateString("pt-BR")}`).join("\n")}

═══ EQUIPE / FUNCIONÁRIOS ═══
${staff.map(s => `• ${s.name} (${s.email}) — Permissões: ${s.permissions || "nenhuma"}`).join("\n") || "Nenhum funcionário cadastrado."}

═══ PRODUTOS ═══
${products.map(p => `• ${p.name} — R$ ${p.price.toFixed(2)} — ${p.active ? "✅ Ativo" : "❌ Inativo"} — Foto: ${p.imageUrl ? "Sim" : "Não"}`).join("\n")}

═══ TODOS OS PEDIDOS (HISTÓRICO COMPLETO) ═══
${orders.map(o => {
  const items = o.items.map((i: any) => `${i.quantity}x ${i.product?.name || "?"}`).join(", ");
  return `• #${o.id.slice(-6)} | ${(o.user as any)?.name} (${(o.user as any)?.city || "?"}) | R$ ${o.totalAmount.toFixed(2)} | Status: ${o.status} | ${new Date(o.createdAt).toLocaleDateString("pt-BR")} | Itens: ${items}`;
}).join("\n") || "Nenhum pedido."}

═══ CONTAS A PAGAR (TODAS) ═══
${payables.map(p => `• ${p.supplierName} | R$ ${p.value.toFixed(2)} | Status: ${p.status} | Vence: ${new Date(p.dueDate).toLocaleDateString("pt-BR")} | Recebido: ${new Date(p.receivedDate).toLocaleDateString("pt-BR")}${p.barcode ? " | Cód. barras: Sim" : ""}`).join("\n") || "Nenhuma conta pendente."}

═══ NOTAS FISCAIS DE COMPRAS (TODAS) ═══
${invoices.map(inv => `• ${inv.description} | R$ ${(inv.aiValue || 0).toFixed(2)} | Categoria: ${inv.aiCategory || "N/I"} | Data NF: ${inv.invoiceDate ? new Date(inv.invoiceDate).toLocaleDateString("pt-BR") : "N/I"} | Status: ${inv.status} | Por: ${inv.uploadedBy} | Em: ${new Date(inv.createdAt).toLocaleDateString("pt-BR")}`).join("\n") || "Nenhuma nota."}

═══ ROTAS DE ENTREGA ═══
${routes.map(r => {
  const dias = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const dayStr = typeof r.deliveryDay === "number" ? dias[r.deliveryDay] : "";
  return `• ${r.cityName || r.routeNumber} — ${dayStr || r.deliveryDay || ""}`;
}).join("\n") || "Nenhuma rota configurada."}
`;

    // Montar histórico de conversação
    const chatHistory = (history || []).map((msg: any) => ({
      role: msg.role === "user" ? "user" : "model",
      parts: [{ text: msg.content }]
    }));

    const systemPrompt = `Você é o assistente administrativo inteligente do Portal Hakim, uma distribuidora de alimentos.
Seu nome é "Hakim IA" e você é extremamente competente em gestão empresarial, finanças e análise de dados.

REGRAS:
1. Responda SEMPRE em português do Brasil.
2. Seja direto, objetivo e profissional.
3. Quando perguntado sobre dados do sistema, use EXCLUSIVAMENTE os dados reais fornecidos no contexto abaixo.
4. Formate valores monetários como R$ X.XXX,XX.
5. Use emojis com moderação para tornar as respostas mais visuais.
6. Se o admin pedir um relatório, faça em formato organizado com tópicos e totais.
7. Se perguntarem algo que não está nos dados, diga que não tem essa informação disponível no sistema.
8. Você pode fazer análises, sugerir melhorias, identificar padrões e dar insights de negócio baseados nos dados reais.

${systemContext}`;

    const response = await ai.models.generateContent({
      model: "gemini-1.5-pro",
      contents: [
        { role: "user", parts: [{ text: systemPrompt }] },
        { role: "model", parts: [{ text: "Entendido! Sou o Hakim IA, assistente administrativo do Portal Hakim. Estou com todos os dados do sistema carregados e pronto para ajudar. O que precisa?" }] },
        ...chatHistory,
        { role: "user", parts: [{ text: message }] }
      ],
    });

    const aiText = response.text ?? "Desculpe, não consegui processar sua solicitação.";

    return NextResponse.json({ reply: aiText });
  } catch (error: any) {
    console.error("Erro no AI Chat:", error?.message || error);
    return NextResponse.json({ error: `Erro: ${error?.message || "Falha interna"}` }, { status: 500 });
  }
}
