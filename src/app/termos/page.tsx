import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Termos de Uso — FireHub Food",
  description: "Termos de uso, cobrança e política de pagamento do FireHub Food.",
};

export default function TermosPage() {
  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "2rem 1.5rem 4rem", fontFamily: "system-ui, sans-serif", color: "#1E293B" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 900, marginBottom: "0.5rem" }}>Termos de Uso</h1>
      <p style={{ color: "#64748B", marginBottom: "2rem" }}>Última atualização: {new Date().toLocaleDateString("pt-BR")}</p>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.75rem" }}>1. Modelo de Cobrança — "Pay as You Grow"</h2>
        <p style={{ lineHeight: 1.8, fontSize: "0.95rem", color: "#374151" }}>
          O FireHub Food opera no modelo <strong>"Pay as You Grow"</strong>: você usa o sistema livremente
          e paga ao final do mês proporcionalmente ao quanto faturou <strong>dentro da plataforma FireHub</strong>.
        </p>
        <ul style={{ lineHeight: 2, paddingLeft: "1.5rem", fontSize: "0.92rem" }}>
          <li><strong>Taxa:</strong> 1% do faturamento mensal via FireHub</li>
          <li><strong>Mínimo:</strong> R$ 50,00/mês — <strong>se houve pelo menos 1 venda no mês</strong></li>
          <li><strong>Máximo (teto):</strong> R$ 400,00/mês (para faturamentos ≥ R$ 40.000)</li>
          <li><strong>Sem vendas = sem cobrança:</strong> Se você não faturou NADA no mês, o valor é R$ 0,00</li>
          <li><strong>Período de teste:</strong> 15 dias gratuitos a partir da criação da conta</li>
        </ul>

        <div style={{
          background: "#FFFBEB", border: "2px solid #FDE68A", borderRadius: 12,
          padding: "1rem 1.25rem", margin: "1rem 0", lineHeight: 1.8, fontSize: "0.9rem"
        }}>
          <strong>⚠️ Exemplos práticos:</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: "1.2rem" }}>
            <li>Usou o sistema <strong>1 dia</strong> e fez 1 venda de R$30 → cobrança de <strong>R$50</strong> (mínimo)</li>
            <li>Usou o sistema o mês todo, vendeu R$8.000 → cobrança de <strong>R$80</strong> (1% de R$8.000)</li>
            <li>Usou o sistema mas <strong>não fez nenhuma venda</strong> → <strong>R$0</strong> (sem cobrança)</li>
            <li><strong>Pausou a loja</strong> e não vendeu nada → <strong>R$0</strong> (sem cobrança enquanto pausado)</li>
            <li>Voltou a usar após pausa, fez vendas → cobrança retoma normalmente no próximo fechamento</li>
          </ul>
        </div>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.75rem" }}>2. Ciclo de Fechamento</h2>
        <p style={{ lineHeight: 1.8, fontSize: "0.95rem", color: "#374151" }}>
          O fechamento do ciclo mensal segue <strong>sempre o fuso horário do cliente (Horário de Brasília — UTC-3)</strong>.
        </p>
        <ul style={{ lineHeight: 2, paddingLeft: "1.5rem", fontSize: "0.92rem" }}>
          <li>O mês de referência vai do <strong>dia 1 ao último dia do mês</strong>, no horário de Brasília</li>
          <li>A fatura é gerada automaticamente no <strong>dia 1 do mês seguinte, à meia-noite de Brasília</strong></li>
          <li>A primeira cobrança acontece <strong>30 dias após o fim do período de teste</strong> (15 dias)</li>
          <li>Apenas pedidos feitos pela plataforma FireHub contam — vendas iFood, 99Food, Rappi etc. <strong>não</strong> são contabilizadas</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.75rem" }}>3. Pagamento Online (Obrigatório)</h2>
        <p style={{ lineHeight: 1.8, fontSize: "0.95rem", color: "#374151" }}>
          O módulo de <strong>pagamento online</strong> (PIX e Cartão de Crédito) é <strong>obrigatório</strong> e
          deve permanecer ativo durante todo o período de uso do sistema.
        </p>
        <ul style={{ lineHeight: 2, paddingLeft: "1.5rem", fontSize: "0.92rem" }}>
          <li>Facilita a experiência de compra do seu cliente final</li>
          <li>Permite o <strong>abatimento automático</strong> da mensalidade através das transações processadas</li>
          <li><strong>Caso exista pendência de cobrança</strong>, os recebimentos de pagamento online serão utilizados para abater o saldo devedor automaticamente</li>
          <li>Garante a sustentabilidade e continuidade do serviço</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.75rem" }}>4. Taxas de Transação Online</h2>
        <p style={{ lineHeight: 1.8, fontSize: "0.95rem", color: "#374151", marginBottom: "0.75rem" }}>
          As seguintes taxas são aplicadas por transação de pagamento online processada:
        </p>
        <div style={{ border: "1px solid #E2E8F0", borderRadius: 12, overflow: "hidden" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.9rem" }}>
            <thead>
              <tr style={{ background: "#F8FAFC" }}>
                <th style={{ padding: "10px 16px", textAlign: "left", borderBottom: "1px solid #E2E8F0" }}>Método</th>
                <th style={{ padding: "10px 16px", textAlign: "right", borderBottom: "1px solid #E2E8F0" }}>Taxa</th>
              </tr>
            </thead>
            <tbody>
              {[
                { method: "💰 PIX", fee: "R$ 0,40 + 0,5%" },
                { method: "💳 Cartão de Crédito", fee: "3,99%" },
                { method: "💳 Cartão de Débito", fee: "1,49%" },
                { method: "🎟️ Voucher (VR/Alelo)", fee: "2,49%" },
              ].map((r, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #F1F5F9" }}>
                  <td style={{ padding: "10px 16px" }}>{r.method}</td>
                  <td style={{ padding: "10px 16px", textAlign: "right", fontWeight: 600 }}>{r.fee}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.75rem" }}>5. Abatimento Automático</h2>
        <p style={{ lineHeight: 1.8, fontSize: "0.95rem", color: "#374151" }}>
          A mensalidade do FireHub é <strong>abatida automaticamente</strong> das transações de pagamento online
          processadas durante o mês. Ao final do mês, caso haja saldo devedor restante (diferença entre a
          mensalidade calculada e o valor já abatido), será gerada uma cobrança via PIX/Boleto.
        </p>
        <p style={{ lineHeight: 1.8, fontSize: "0.95rem", color: "#374151" }}>
          <strong>Importante:</strong> Mesmo que você venda majoritariamente pelo iFood ou por outro canal,
          se houver pendências, qualquer pagamento online recebido no FireHub será utilizado para abater
          o saldo devedor antes de ser repassado integralmente.
        </p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.75rem" }}>6. Prazo de Pagamento e Bloqueio</h2>
        <div style={{
          background: "#FEF2F2", border: "2px solid #FCA5A5", borderRadius: 12,
          padding: "1rem 1.25rem", margin: "0.75rem 0 1rem", lineHeight: 1.8, fontSize: "0.9rem"
        }}>
          <strong>🔒 Regras de prazo e bloqueio:</strong>
          <ol style={{ margin: "6px 0 0", paddingLeft: "1.2rem" }}>
            <li>A fatura é gerada no <strong>dia 1 do mês seguinte</strong>, à meia-noite de Brasília</li>
            <li>Você tem <strong>10 dias corridos</strong> para quitar o saldo pendente</li>
            <li>Durante esse prazo, um banner com <strong>contagem regressiva</strong> será exibido no painel</li>
            <li>Se o pagamento online recebido durante esses 10 dias cobrir o saldo, a fatura é quitada automaticamente</li>
            <li>Após os 10 dias sem quitação, o <strong>sistema será bloqueado</strong></li>
            <li>O desbloqueio é <strong>automático e imediato</strong> após a confirmação do pagamento</li>
          </ol>
        </div>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.75rem" }}>7. Tráfego Pago (Meta Ads)</h2>
        <p style={{ lineHeight: 1.8, fontSize: "0.95rem", color: "#374151" }}>
          O módulo de Tráfego Pago cobra uma taxa de <strong>R$ 50,00/semana</strong> pelo <strong>serviço de gestão
          de campanhas</strong>. A cobrança começa <strong>assim que a campanha é ativada</strong>, independentemente
          dos resultados obtidos. Esta taxa é acumulada e incluída na fatura do mês seguinte.
        </p>
        <div style={{
          background: "#FEF2F2", border: "2px solid #FCA5A5", borderRadius: 12,
          padding: "1rem 1.25rem", margin: "0.75rem 0", lineHeight: 1.8, fontSize: "0.9rem"
        }}>
          <strong>🔴 Importante — Leia com atenção:</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: "1.2rem" }}>
            <li>A taxa de <strong>R$50/semana é pela gestão</strong> (criação, otimização e monitoramento da campanha)</li>
            <li><strong>Ativou a campanha = taxa é cobrada</strong>, independente do retorno em vendas</li>
            <li>O <strong>ROAS</strong> (retorno sobre o investimento) depende de diversos fatores como <strong>qualidade do produto,
            atendimento, preços, fotos do cardápio e mercado local</strong> — o FireHub não garante resultados específicos</li>
            <li>Se você <strong>pausar todas as campanhas</strong>, a taxa para de ser contabilizada imediatamente</li>
            <li>O valor investido em mídia vai <strong>direto para sua conta Meta</strong> — o FireHub não retém esse valor</li>
          </ul>
        </div>
        <div style={{
          background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 12,
          padding: "1rem 1.25rem", margin: "0.75rem 0", lineHeight: 1.8, fontSize: "0.9rem"
        }}>
          <strong>⚠️ Exemplos:</strong>
          <ul style={{ margin: "6px 0 0", paddingLeft: "1.2rem" }}>
            <li>Ativou campanha na segunda e pausou na quinta (4 dias) → <strong>R$50</strong> (mínimo semanal)</li>
            <li>Manteve campanha ativa por 3 semanas → <strong>R$150</strong></li>
            <li>Nenhuma campanha ativa no mês → <strong>R$0</strong></li>
          </ul>
        </div>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.75rem" }}>8. Pausa e Cancelamento</h2>
        <ul style={{ lineHeight: 2, paddingLeft: "1.5rem", fontSize: "0.92rem" }}>
          <li>Você pode <strong>pausar sua loja a qualquer momento</strong> sem custos adicionais</li>
          <li>Enquanto pausado e sem vendas, <strong>nenhuma cobrança será gerada</strong></li>
          <li>Ao retomar, a cobrança volta a contar normalmente a partir do próximo pedido confirmado</li>
          <li><strong>Sem contratos de fidelidade</strong> — cancele quando quiser</li>
          <li><strong>Sem multas</strong> de cancelamento ou inatividade</li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem", background: "#F0FDF4", border: "1px solid #BBF7D0", borderRadius: 12, padding: "1.25rem" }}>
        <h2 style={{ fontSize: "1rem", fontWeight: 800, marginBottom: "0.5rem", color: "#166534" }}>✅ Resumo</h2>
        <p style={{ lineHeight: 1.8, fontSize: "0.88rem", color: "#166534", margin: 0 }}>
          Use o FireHub livremente. Pague apenas se faturar. A cobrança é proporcional, transparente e
          automaticamente abatida via pagamento online. Sem contratos de fidelidade, sem taxas surpresa,
          sem multas de cancelamento. O fechamento sempre respeita o horário de Brasília (UTC-3).
          Pausou e não vendeu? Cobrança zerada.
        </p>
      </section>

      <p style={{ textAlign: "center", color: "#9CA3AF", fontSize: "0.82rem", marginTop: "3rem" }}>
        © {new Date().getFullYear()} FireHub Food. Todos os direitos reservados.
      </p>
    </div>
  );
}
