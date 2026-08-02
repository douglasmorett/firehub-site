"use client";
import { useState } from "react";
import { ShieldCheck, Key, Webhook, Code, Terminal, CheckCircle2, Copy, Check, Server, ArrowRight } from "lucide-react";

export default function ApiDocsPage() {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  function copyCode(text: string, idx: number) {
    navigator.clipboard.writeText(text);
    setCopiedIndex(idx);
    setTimeout(() => setCopiedIndex(null), 2500);
  }

  const ENDPOINTS = [
    {
      method: "GET",
      path: "/api/v1/ping",
      title: "1. Teste de Conexão e Autenticação",
      desc: "Valida se a Chave de API está ativa e retorna o nome da loja conectada.",
      curl: `curl -X GET https://firehubfood.com.br/api/v1/ping \\
  -H "Authorization: Bearer fh_live_SUA_CHAVE_AQUI"`,
      response: `{
  "ok": true,
  "message": "Conexão com a API Aberta do FireHub estabelecida com sucesso!",
  "store": {
    "id": "cmpx96phr0000ujf0sb0qk5vr",
    "name": "Hakim Rio das Ostras",
    "slug": "hakim-rio-das-ostras"
  },
  "keyName": "PDV Caixa 01",
  "permissions": ["orders:read", "orders:write", "menu:read", "menu:write"],
  "timestamp": "2026-08-01T23:30:00.000Z"
}`,
    },
    {
      method: "GET",
      path: "/api/v1/merchant",
      title: "2. Informações do Restaurante",
      desc: "Retorna dados da loja, horário de funcionamento, status de caixa e áreas de entrega.",
      curl: `curl -X GET https://firehubfood.com.br/api/v1/merchant \\
  -H "Authorization: Bearer fh_live_SUA_CHAVE_AQUI"`,
      response: `{
  "id": "cmpx96phr0000ujf0sb0qk5vr",
  "storeName": "Hakim Rio das Ostras",
  "slug": "hakim-rio-das-ostras",
  "phone": "219981118514",
  "isOpen": true,
  "isCashOpen": true
}`,
    },
    {
      method: "GET",
      path: "/api/v1/menu",
      title: "3. Obter Cardápio Completo",
      desc: "Retorna todas as categorias, produtos, preços, fotos e opções de combos cadastrados na loja.",
      curl: `curl -X GET https://firehubfood.com.br/api/v1/menu \\
  -H "Authorization: Bearer fh_live_SUA_CHAVE_AQUI"`,
      response: `{
  "categories": [
    { "id": "cat_123", "name": "Esfirras Promocionais", "emoji": "🍕" }
  ],
  "products": [
    {
      "id": "prod_456",
      "name": "Combo 6 Esfirras Mix",
      "price": 26.90,
      "category": "Esfirras Promocionais",
      "active": true,
      "isCombo": true
    }
  ]
}`,
    },
    {
      method: "PATCH",
      path: "/api/v1/menu/products/{productId}",
      title: "4. Atualizar Produto (Preço / Estoque / Ativo)",
      desc: "Altera o preço ou o status (ativo/pausado) de um item no cardápio digital.",
      curl: `curl -X PATCH https://firehubfood.com.br/api/v1/menu/products/prod_456 \\
  -H "Authorization: Bearer fh_live_SUA_CHAVE_AQUI" \\
  -H "Content-Type: application/json" \\
  -d '{
    "price": 28.90,
    "active": true
  }'`,
      response: `{
  "success": true,
  "product": {
    "id": "prod_456",
    "name": "Combo 6 Esfirras Mix",
    "price": 28.90,
    "active": true
  }
}`,
    },
    {
      method: "GET",
      path: "/api/v1/orders",
      title: "5. Listar Pedidos do Restaurante",
      desc: "Retorna a lista de pedidos com suporte a filtros de status (`NOVO`, `ACEITO`, `SAIU_ENTREGA`, `ENTREGUE`, `CANCELADO`) e paginação.",
      curl: `curl -X GET "https://firehubfood.com.br/api/v1/orders?status=NOVO&limit=20" \\
  -H "Authorization: Bearer fh_live_SUA_CHAVE_AQUI"`,
      response: `{
  "page": 1,
  "limit": 20,
  "totalCount": 1,
  "orders": [
    {
      "id": "ord_789",
      "firehubOrderNumber": "#171",
      "dailyOrderNumber": 171,
      "channel": "Jotajá",
      "status": "ACEITO",
      "customerName": "Stephany",
      "customerPhone": "219981576036",
      "totalAmount": 82.71
    }
  ]
}`,
    },
    {
      method: "POST",
      path: "/api/v1/orders",
      title: "6. Injetar / Criar Pedido de Canal Externo",
      desc: "Permite que seu sistema injete um pedido diretamente no FireHub (envia para o KDS/Cozinha, gera a comanda e dispara WhatsApp).",
      curl: `curl -X POST https://firehubfood.com.br/api/v1/orders \\
  -H "Authorization: Bearer fh_live_SUA_CHAVE_AQUI" \\
  -H "Content-Type: application/json" \\
  -d '{
    "customerName": "Paulo Victor",
    "customerPhone": "219981576036",
    "customerAddress": "Avenida das Palmeiras, 129",
    "deliveryType": "DELIVERY",
    "paymentMethod": "CARTAO_CREDITO",
    "deliveryFee": 5.99,
    "externalReference": "32653126",
    "externalChannel": "Jotaja",
    "items": [
      {
        "name": "16x Esfirra de Calabresa",
        "quantity": 1,
        "price": 30.40
      }
    ]
  }'`,
      response: `{
  "success": true,
  "order": {
    "id": "ord_abc123",
    "dailyOrderNumber": 214,
    "firehubOrderNumber": "#214",
    "status": "NOVO",
    "customerName": "Paulo Victor",
    "totalAmount": 36.39
  }
}`,
    },
    {
      method: "PATCH",
      path: "/api/v1/orders/{orderId}/status",
      title: "7. Atualizar Status do Pedido",
      desc: "Atualiza o status de um pedido (`ACEITO`, `EM_PREPARO`, `SAIU_ENTREGA`, `ENTREGUE`, `CANCELADO`). Ao passar para `SAIU_ENTREGA` ou `ENTREGUE`, o robô do WhatsApp avisa o cliente automaticamente!",
      curl: `curl -X PATCH https://firehubfood.com.br/api/v1/orders/ord_abc123/status \\
  -H "Authorization: Bearer fh_live_SUA_CHAVE_AQUI" \\
  -H "Content-Type: application/json" \\
  -d '{
    "status": "SAIU_ENTREGA"
  }'`,
      response: `{
  "success": true,
  "order": {
    "id": "ord_abc123",
    "dailyOrderNumber": 214,
    "status": "SAIU_ENTREGA",
    "updatedAt": "2026-08-01T23:30:00.000Z"
  }
}`,
    },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#0F172A", color: "#F8FAFC", fontFamily: "sans-serif" }}>
      
      {/* Top Header */}
      <header style={{ borderBottom: "1px solid #1E293B", background: "#020617", padding: "1.5rem 2rem" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#6366F1,#4F46E5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <ShieldCheck size={26} color="#FFFFFF" />
            </div>
            <div>
              <h1 style={{ fontSize: "1.3rem", fontWeight: 900, margin: 0, color: "#FFFFFF" }}>
                FireHub Open API v1.0
              </h1>
              <span style={{ fontSize: "0.8rem", color: "#94A3B8" }}>Documentação Oficial para Desenvolvedores & Integrações</span>
            </div>
          </div>

          <a
            href="https://firehubfood.com.br/login"
            style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", background: "#1E293B", color: "#F8FAFC", border: "1px solid #334155", borderRadius: 8, textDecoration: "none", fontWeight: 700, fontSize: "0.85rem" }}
          >
            Acessar Painel FireHub <ArrowRight size={14} />
          </a>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ maxWidth: 1100, margin: "0 auto", padding: "2.5rem 1.5rem" }}>
        
        {/* Intro Banner */}
        <section style={{ background: "linear-gradient(135deg, #1E1B4B 0%, #0F172A 100%)", border: "1px solid #312E81", borderRadius: 16, padding: "2rem", marginBottom: "3rem" }}>
          <span style={{ display: "inline-block", padding: "4px 12px", background: "rgba(99,102,241,0.2)", color: "#818CF8", borderRadius: 20, fontSize: "0.78rem", fontWeight: 800, textTransform: "uppercase", letterSpacing: 1, marginBottom: 12 }}>
            Padrão REST & OpenDelivery
          </span>
          <h2 style={{ fontSize: "1.75rem", fontWeight: 900, color: "#FFFFFF", margin: "0 0 10px" }}>
            Integre seu PDV, ERP ou App de Entregadores ao FireHub
          </h2>
          <p style={{ fontSize: "0.95rem", color: "#94A3B8", lineHeight: 1.6, margin: 0, maxWidth: 750 }}>
            A API Aberta do FireHub utiliza arquitetura REST, JSON e suporte nativo às especificações de delivery do mercado. Gerencie cardápios, receba pedidos e atualize o status da cozinha de forma autônoma.
          </p>
        </section>

        {/* Authentication Guide */}
        <section style={{ marginBottom: "3rem" }}>
          <h3 style={{ fontSize: "1.25rem", fontWeight: 800, color: "#FFFFFF", marginBottom: "1rem", display: "flex", alignItems: "center", gap: 10 }}>
            <Key color="#6366F1" size={22} /> Autenticação via Chave de API (API Key)
          </h3>

          <div style={{ background: "#1E293B", borderRadius: 12, padding: "1.5rem", border: "1px solid #334155" }}>
            <p style={{ fontSize: "0.9rem", color: "#CBD5E1", lineHeight: 1.6, margin: "0 0 1rem" }}>
              Todas as requisições para a API do FireHub devem conter a sua Chave de API no cabeçalho HTTP da requisição. Você pode gerar suas chaves no painel em <b>Minha Loja &gt; API Aberta & Webhooks</b>.
            </p>

            <div style={{ background: "#090D16", padding: "12px 16px", borderRadius: 8, fontFamily: "monospace", fontSize: "0.88rem", color: "#38BDF8", border: "1px solid #1E293B" }}>
              Authorization: Bearer fh_live_SUA_CHAVE_SECRET_AQUI
            </div>
            <p style={{ fontSize: "0.78rem", color: "#64748B", margin: "6px 0 0" }}>
              Ou utilize o header alternativo: <code>X-FireHub-API-Key: fh_live_...</code>
            </p>
          </div>
        </section>

        {/* Webhooks Section */}
        <section style={{ marginBottom: "3rem" }}>
          <h3 style={{ fontSize: "1.25rem", fontWeight: 800, color: "#FFFFFF", marginBottom: "1rem", display: "flex", alignItems: "center", gap: 10 }}>
            <Webhook color="#10B981" size={22} /> Webhooks de Saída & Assinatura HMAC-SHA256
          </h3>

          <div style={{ background: "#1E293B", borderRadius: 12, padding: "1.5rem", border: "1px solid #334155" }}>
            <p style={{ fontSize: "0.9rem", color: "#CBD5E1", lineHeight: 1.6, margin: "0 0 1rem" }}>
              Sempre que um pedido for criado ou alterar de status, o FireHub envia um evento POST em tempo real para a URL cadastrada no seu painel. Para garantir a autenticidade, verificamos cada mensagem com uma assinatura <b>HMAC-SHA256</b> enviada no header <code>X-FireHub-Signature</code>.
            </p>

            <div style={{ background: "#090D16", padding: "12px 16px", borderRadius: 8, fontFamily: "monospace", fontSize: "0.85rem", color: "#34D399", border: "1px solid #1E293B" }}>
              X-FireHub-Event: order.status_updated<br />
              X-FireHub-Signature: 8f3a9... (HMAC-SHA256 do body usando seu segredo de webhook)
            </div>
          </div>
        </section>

        {/* Endpoints List */}
        <section>
          <h3 style={{ fontSize: "1.25rem", fontWeight: 800, color: "#FFFFFF", marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: 10 }}>
            <Terminal color="#818CF8" size={22} /> Endpoints da API v1
          </h3>

          <div style={{ display: "flex", flexDirection: "column", gap: "1.75rem" }}>
            {ENDPOINTS.map((ep, idx) => (
              <div key={idx} style={{ background: "#1E293B", border: "1px solid #334155", borderRadius: 14, overflow: "hidden" }}>
                {/* Endpoint Header */}
                <div style={{ padding: "1rem 1.25rem", background: "#0F172A", borderBottom: "1px solid #334155", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span
                      style={{
                        padding: "4px 10px", borderRadius: 6, fontWeight: 900, fontSize: "0.78rem",
                        background: ep.method === "GET" ? "#0284C7" : ep.method === "POST" ? "#16A34A" : "#D97706",
                        color: "#FFFFFF"
                      }}
                    >
                      {ep.method}
                    </span>
                    <span style={{ fontFamily: "monospace", fontSize: "0.95rem", fontWeight: 700, color: "#F1F5F9" }}>
                      {ep.path}
                    </span>
                  </div>
                  <span style={{ fontSize: "0.85rem", color: "#94A3B8", fontWeight: 600 }}>{ep.title}</span>
                </div>

                {/* Endpoint Body */}
                <div style={{ padding: "1.25rem" }}>
                  <p style={{ fontSize: "0.88rem", color: "#CBD5E1", margin: "0 0 1rem" }}>{ep.desc}</p>

                  <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 16 }}>
                    {/* cURL Example */}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>Exemplo de Requisição (cURL)</span>
                        <button
                          onClick={() => copyCode(ep.curl, idx * 2)}
                          style={{ background: "none", border: "none", color: "#818CF8", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                        >
                          {copiedIndex === idx * 2 ? <Check size={14} /> : <Copy size={14} />}
                          {copiedIndex === idx * 2 ? "Copiado!" : "Copiar"}
                        </button>
                      </div>
                      <pre style={{ background: "#090D16", padding: "12px", borderRadius: 8, fontSize: "0.78rem", color: "#E2E8F0", overflowX: "auto", margin: 0, border: "1px solid #1E293B" }}>
                        {ep.curl}
                      </pre>
                    </div>

                    {/* JSON Response */}
                    <div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                        <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase" }}>Resposta de Sucesso (HTTP 200/201)</span>
                        <button
                          onClick={() => copyCode(ep.response, idx * 2 + 1)}
                          style={{ background: "none", border: "none", color: "#818CF8", fontSize: "0.75rem", fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
                        >
                          {copiedIndex === idx * 2 + 1 ? <Check size={14} /> : <Copy size={14} />}
                          {copiedIndex === idx * 2 + 1 ? "Copiado!" : "Copiar"}
                        </button>
                      </div>
                      <pre style={{ background: "#090D16", padding: "12px", borderRadius: 8, fontSize: "0.78rem", color: "#34D399", overflowX: "auto", margin: 0, border: "1px solid #1E293B" }}>
                        {ep.response}
                      </pre>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

      </main>

      {/* Footer */}
      <footer style={{ borderTop: "1px solid #1E293B", padding: "2rem 1.5rem", textAlign: "center", fontSize: "0.82rem", color: "#64748B", marginTop: "4rem" }}>
        FireHub Open API v1.0 · Desenvolvido com suporte nativo ao padrão OpenDelivery ABRASEL.
      </footer>
    </div>
  );
}
