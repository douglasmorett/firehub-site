import { sendEmail } from "@/lib/mail";

const FROM = process.env.EMAIL_FROM || process.env.RESEND_FROM_EMAIL || "FireHub <noreply@firehubfood.com.br>";

// ─── Boas-vindas ao novo lojista ──────────────────────────────────────────────
export async function sendWelcomeEmail(to: string, name: string, storeName: string) {
  return sendEmail({
    from: FROM,
    to,
    subject: `🔥 Bem-vindo ao FireHub, ${name}!`,
    html: `
      <div style="font-family:'Inter',sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0;">
        <div style="background:linear-gradient(135deg,#B71C1C,#C62828);padding:2rem;text-align:center;">
          <h1 style="color:#fff;font-size:1.8rem;margin:0;">🔥 FireHub</h1>
          <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:0.95rem;">A plataforma que faz sua loja crescer</p>
        </div>
        <div style="padding:2rem;">
          <h2 style="color:#1E293B;font-size:1.2rem;">Olá, ${name}! 👋</h2>
          <p style="color:#475569;line-height:1.6;">Sua loja <strong>${storeName}</strong> foi cadastrada com sucesso no FireHub. Agora você tem acesso a tudo que precisa para gerenciar seu negócio.</p>
          <ul style="color:#475569;line-height:2;">
            <li>🛒 Cardápio digital personalizado</li>
            <li>📦 Gestão de pedidos em tempo real</li>
            <li>📊 Dashboard financeiro completo</li>
            <li>🛵 Controle de entregadores</li>
          </ul>
          <a href="https://www.firehubfood.com.br/store" style="display:inline-block;margin-top:1rem;padding:12px 28px;background:linear-gradient(135deg,#B71C1C,#C62828);color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.95rem;">
            Acessar meu painel →
          </a>
        </div>
        <div style="padding:1rem 2rem;background:#F8FAFC;text-align:center;color:#94A3B8;font-size:0.75rem;">
          FireHub · <a href="https://www.firehubfood.com.br" style="color:#C62828;">firehubfood.com.br</a>
        </div>
      </div>
    `,
  });
}

// ─── Novo pedido recebido (para o lojista) ────────────────────────────────────
export async function sendNewOrderEmail(
  to: string,
  storeName: string,
  orderId: string,
  customerName: string,
  items: { name: string; qty: number; price: number }[],
  total: number,
  deliveryType: string
) {
  const itemsHtml = items
    .map(i => `<tr><td style="padding:6px 0;color:#475569;">${i.qty}x ${i.name}</td><td style="text-align:right;font-weight:600;">R$ ${(i.price * i.qty).toFixed(2)}</td></tr>`)
    .join("");

  return sendEmail({
    from: FROM,
    to,
    subject: `🔔 Novo pedido recebido — #${orderId.slice(-6).toUpperCase()}`,
    html: `
      <div style="font-family:'Inter',sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0;">
        <div style="background:linear-gradient(135deg,#1E3A8A,#2563EB);padding:1.5rem 2rem;">
          <h1 style="color:#fff;margin:0;font-size:1.3rem;">🔔 Novo Pedido!</h1>
          <p style="color:rgba(255,255,255,0.8);margin:4px 0 0;font-size:0.85rem;">${storeName}</p>
        </div>
        <div style="padding:1.5rem 2rem;">
          <p style="color:#64748B;font-size:0.85rem;margin:0 0 1rem;">Pedido <strong>#${orderId.slice(-6).toUpperCase()}</strong> · Cliente: <strong>${customerName}</strong> · ${deliveryType === "DELIVERY" ? "🛵 Delivery" : "🏪 Retirada"}</p>
          <table style="width:100%;border-collapse:collapse;border-top:1px solid #F1F5F9;padding-top:8px;">
            ${itemsHtml}
            <tr style="border-top:2px solid #F1F5F9;">
              <td style="padding:10px 0;font-weight:800;font-size:1rem;">Total</td>
              <td style="text-align:right;font-weight:800;font-size:1rem;color:#16A34A;">R$ ${total.toFixed(2)}</td>
            </tr>
          </table>
          <a href="https://www.firehubfood.com.br/store/pedidos-clientes" style="display:inline-block;margin-top:1rem;padding:12px 28px;background:#16A34A;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:0.9rem;">
            Ver pedido →
          </a>
        </div>
      </div>
    `,
  });
}

// ─── Cobrança mensal (billing) ────────────────────────────────────────────────
export async function sendBillingEmail(
  to: string,
  name: string,
  storeName: string,
  amount: number,
  dueDate: string,
  paymentLink?: string
) {
  return sendEmail({
    from: FROM,
    to,
    subject: `💳 Cobrança FireHub — ${storeName}`,
    html: `
      <div style="font-family:'Inter',sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0;">
        <div style="background:linear-gradient(135deg,#B71C1C,#C62828);padding:1.5rem 2rem;">
          <h1 style="color:#fff;margin:0;font-size:1.3rem;">💳 Fatura FireHub</h1>
        </div>
        <div style="padding:1.5rem 2rem;">
          <p style="color:#475569;">Olá <strong>${name}</strong>, sua mensalidade do FireHub está disponível.</p>
          <div style="background:#F8FAFC;border-radius:12px;padding:1.25rem;margin:1rem 0;border:1px solid #E2E8F0;">
            <p style="margin:0 0 4px;color:#94A3B8;font-size:0.8rem;">LOJA</p>
            <p style="margin:0 0 12px;font-weight:700;">${storeName}</p>
            <p style="margin:0 0 4px;color:#94A3B8;font-size:0.8rem;">VALOR</p>
            <p style="margin:0 0 12px;font-weight:800;font-size:1.4rem;color:#C62828;">R$ ${amount.toFixed(2)}</p>
            <p style="margin:0 0 4px;color:#94A3B8;font-size:0.8rem;">VENCIMENTO</p>
            <p style="margin:0;font-weight:600;">${dueDate}</p>
          </div>
          ${paymentLink ? `<a href="${paymentLink}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#B71C1C,#C62828);color:#fff;border-radius:10px;text-decoration:none;font-weight:700;">Pagar agora →</a>` : ""}
        </div>
        <div style="padding:1rem 2rem;background:#F8FAFC;text-align:center;color:#94A3B8;font-size:0.75rem;">
          FireHub · <a href="https://www.firehubfood.com.br" style="color:#C62828;">firehubfood.com.br</a>
        </div>
      </div>
    `,
  });
}

// ─── Pedido entregue + convite de avaliação ───────────────────────────────────
export async function sendOrderDeliveredEmail(
  to: string,
  customerName: string,
  storeName: string,
  orderId: string,
  slug: string
) {
  return sendEmail({
    from: FROM,
    to,
    subject: `📦 Seu pedido foi entregue! Avalie ${storeName}`,
    html: `
      <div style="font-family:'Inter',sans-serif;max-width:560px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #E2E8F0;">
        <div style="background:linear-gradient(135deg,#15803D,#16A34A);padding:1.5rem 2rem;text-align:center;">
          <div style="font-size:3rem;">🎉</div>
          <h1 style="color:#fff;margin:8px 0 0;font-size:1.3rem;">Pedido Entregue!</h1>
        </div>
        <div style="padding:1.5rem 2rem;text-align:center;">
          <p style="color:#475569;">Olá <strong>${customerName}</strong>! Seu pedido em <strong>${storeName}</strong> foi entregue. Bom apetite! 😋</p>
          <p style="color:#475569;margin-top:1.25rem;">O que achou? Avalie sua experiência:</p>
          <a href="https://www.firehubfood.com.br/loja/${slug}/pedido/${orderId}" style="display:inline-block;margin-top:8px;padding:12px 28px;background:linear-gradient(135deg,#F59E0B,#EF4444);color:#fff;border-radius:10px;text-decoration:none;font-weight:700;">
            ⭐ Avaliar pedido
          </a>
        </div>
      </div>
    `,
  });
}

