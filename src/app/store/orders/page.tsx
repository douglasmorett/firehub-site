import { prisma } from "@/lib/prisma";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";

export default async function StoreOrdersPage() {
  const session = await getServerSession(authOptions);
  
  if (!session || !session.user || !session.user.email) return null;

  const user = await prisma.user.findUnique({ where: { email: session.user.email } });
  if (!user) return null;

  const orders = await prisma.order.findMany({
    where: { userId: user.id },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: 'desc' }
  });

  return (
    <div className="container">
      <h1 className="font-bold mb-6" style={{ fontSize: "2rem" }}>Meus Pedidos</h1>
      
      {orders.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-muted">Você ainda não realizou nenhum pedido de insumo.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {orders.map(order => (
            <div key={order.id} className="card">
              <div className="flex justify-between items-center" style={{ borderBottom: "1px solid var(--border-color)", paddingBottom: "0.5rem", marginBottom: "0.5rem" }}>
                <div>
                  <h3 className="font-bold text-lg">Pedido #{order.id.slice(-6).toUpperCase()}</h3>
                  <p className="text-muted" style={{ fontSize: "0.9rem" }}>Data: {new Date(order.createdAt).toLocaleDateString('pt-BR')}</p>
                </div>
                <div className="text-right">
                  <span className="font-extrabold gradient-text" style={{ fontSize: "1.2rem" }}>R$ {order.totalAmount.toFixed(2)}</span>
                  
                  {order.isEmergency && (
                    <div style={{ display: "inline-block", backgroundColor: "var(--danger)", color: "white", padding: "0.2rem 0.5rem", borderRadius: "4px", fontSize: "0.7rem", fontWeight: "bold", marginLeft: "0.5rem" }}>
                      🚨 EMERGÊNCIA
                    </div>
                  )}

                  <p style={{ fontSize: "0.85rem", color: order.status === "CANCELADO" || order.emergencyStatus === "REJECTED" ? "var(--danger)" : "var(--primary)", fontWeight: "bold", marginTop: "0.25rem" }}>
                    {order.isEmergency && order.emergencyStatus === "PENDING_APPROVAL" ? "Aguardando Aprovação" :
                     order.isEmergency && order.emergencyStatus === "REJECTED" ? "Reprovado" :
                     order.status === "PENDING_PAYMENT" ? "Aguardando Pagamento" : 
                     order.status === "AGUARDANDO_ENTREGA" ? "Aguardando Entrega" :
                     order.status === "FINALIZADO" ? "Finalizado" :
                     order.status === "CANCELADO" ? "Cancelado" : order.status}
                  </p>
                </div>
              </div>

              {order.isEmergency && order.emergencyStatus === "REJECTED" && order.rejectionReason && (
                <div style={{ backgroundColor: "rgba(239, 68, 68, 0.1)", padding: "0.5rem", borderRadius: "8px", marginBottom: "1rem" }}>
                  <p style={{ color: "var(--danger)", fontSize: "0.85rem" }}>
                    <strong>Motivo da Reprovação:</strong> {order.rejectionReason}
                  </p>
                </div>
              )}
              
              <div>
                <p className="font-semibold text-sm text-muted mb-2">Itens:</p>
                <ul style={{ listStyle: "none", padding: 0, fontSize: "0.9rem" }}>
                  {order.items.map(item => (
                    <li key={item.id}>- {item.quantity}x {item.product.name}</li>
                  ))}
                </ul>
              </div>

              {order.status === "PENDING_PAYMENT" && order.boletoUrl && (
                <div className="mt-4 pt-4 text-right" style={{ borderTop: "1px solid var(--border-color)" }}>
                  <a href={order.boletoUrl} target="_blank" rel="noreferrer" className="btn btn-primary" style={{ fontSize: "0.9rem", padding: "0.5rem 1rem", backgroundColor: "var(--success)", borderColor: "var(--success)" }}>
                    💳 Acessar Link de Pagamento (Pix, Boleto, Cartão)
                  </a>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
