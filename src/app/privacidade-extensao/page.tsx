import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade — Extensão FireHub para Chrome",
  description:
    "Quais dados a extensão FireHub — iFood Dynamic ETA usa, para quê, onde ficam guardados e como excluí-los.",
};

const box = {
  background: "#F8FAFC",
  border: "1px solid #E2E8F0",
  borderRadius: 12,
  padding: "1rem 1.25rem",
  lineHeight: 1.8,
  fontSize: "0.92rem",
  margin: "1rem 0",
};

export default function PrivacidadeExtensaoPage() {
  return (
    <div
      style={{
        maxWidth: 800,
        margin: "0 auto",
        padding: "2rem 1.5rem 4rem",
        fontFamily: "system-ui, sans-serif",
        color: "#1E293B",
      }}
    >
      <h1 style={{ fontSize: "2rem", fontWeight: 900, marginBottom: "0.5rem" }}>
        Política de Privacidade — Extensão FireHub para Chrome
      </h1>
      <p style={{ color: "#64748B", marginBottom: "2rem" }}>
        Aplica-se à extensão <strong>FireHub — iFood Dynamic ETA &amp; Automação</strong>, publicada
        na Chrome Web Store pela FireHub Food. Última atualização: 24/08/2026.
      </p>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.75rem" }}>
          1. Finalidade única da extensão
        </h2>
        <p style={{ lineHeight: 1.8, fontSize: "0.95rem", color: "#374151" }}>
          A extensão tem uma única finalidade: <strong>ajustar automaticamente o tempo de entrega
          (ETA) da loja do próprio usuário no Portal do Parceiro iFood</strong>, a partir da carga de
          pedidos em produção no painel FireHub e da quantidade de entregadores disponíveis
          informada pelo operador. Ela é usada por lojistas na própria loja, no computador do caixa.
        </p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.75rem" }}>
          2. Dados que a extensão trata
        </h2>
        <ul style={{ lineHeight: 2, paddingLeft: "1.5rem", fontSize: "0.92rem" }}>
          <li>
            <strong>Credenciais do FireHub:</strong> e-mail e senha digitados pelo lojista no popup
            da extensão são enviados apenas para <code>firehubfood.com.br</code> para autenticar a
            loja. A senha não é armazenada — guarda-se somente o token de sessão retornado.
          </li>
          <li>
            <strong>Dados operacionais da loja:</strong> quantidade de pedidos em produção, número de
            entregadores informado pelo operador, tempo de entrega calculado e identificação da loja.
          </li>
          <li>
            <strong>Preferências de uso:</strong> modo automático ou manual, regras de prazo,
            posição da pílula flutuante na tela.
          </li>
        </ul>
        <div style={box}>
          <strong>A extensão não coleta:</strong> histórico de navegação, dados de outros sites,
          localização, contatos, dados de saúde, dados financeiros do consumidor final nem qualquer
          informação de páginas fora de <code>portal.ifood.com.br</code> e{" "}
          <code>firehubfood.com.br</code>.
        </div>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.75rem" }}>
          3. Onde os dados ficam
        </h2>
        <ul style={{ lineHeight: 2, paddingLeft: "1.5rem", fontSize: "0.92rem" }}>
          <li>
            <strong>No navegador do lojista</strong> (<code>chrome.storage.local</code>): token de
            sessão, preferências e último tempo calculado.
          </li>
          <li>
            <strong>Nos servidores do FireHub</strong> (<code>firehubfood.com.br</code>): os mesmos
            dados operacionais que a loja já possui no painel, sob a política de privacidade da
            plataforma.
          </li>
          <li>
            <strong>No iFood:</strong> a extensão apenas aplica a alteração de tempo na sessão que o
            próprio lojista já tem aberta no Portal do Parceiro. Ela não guarda, não transmite e não
            tem acesso à senha do iFood.
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.75rem" }}>
          4. Compartilhamento
        </h2>
        <p style={{ lineHeight: 1.8, fontSize: "0.95rem", color: "#374151" }}>
          Nenhum dado é vendido, alugado ou compartilhado com terceiros. Não há publicidade, não há
          rastreamento entre sites e os dados não são usados para treinar modelos nem para qualquer
          finalidade diferente da descrita no item 1.
        </p>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.75rem" }}>
          5. Permissões e por que são necessárias
        </h2>
        <ul style={{ lineHeight: 2, paddingLeft: "1.5rem", fontSize: "0.92rem" }}>
          <li>
            <code>storage</code> — guardar sessão e preferências no próprio navegador.
          </li>
          <li>
            <code>alarms</code> — recalcular o tempo de entrega a cada poucos minutos.
          </li>
          <li>
            <code>tabs</code> e <code>activeTab</code> — localizar a aba do Portal iFood já aberta e
            reabri-la se o operador fechar por engano.
          </li>
          <li>
            <code>scripting</code> — aplicar a alteração de tempo na página do Portal iFood.
          </li>
          <li>
            <code>host_permissions</code> em <code>portal.ifood.com.br</code> e{" "}
            <code>firehubfood.com.br</code> — os dois únicos sites onde a extensão funciona.
          </li>
        </ul>
      </section>

      <section style={{ marginBottom: "2rem" }}>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.75rem" }}>
          6. Exclusão dos dados
        </h2>
        <p style={{ lineHeight: 1.8, fontSize: "0.95rem", color: "#374151" }}>
          Remover a extensão pelo Chrome apaga tudo o que está guardado no navegador. Para excluir os
          dados da loja mantidos na plataforma, basta solicitar pelo suporte do FireHub — o pedido é
          atendido em até 30 dias.
        </p>
      </section>

      <section>
        <h2 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.75rem" }}>7. Contato</h2>
        <p style={{ lineHeight: 1.8, fontSize: "0.95rem", color: "#374151" }}>
          Dúvidas sobre privacidade: <strong>contatohakim@gmail.com</strong> ou o suporte dentro do
          painel <a href="https://firehubfood.com.br">firehubfood.com.br</a>.
        </p>
      </section>
    </div>
  );
}
