import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade — App da loja",
  description:
    "Quais dados o app de pedidos da loja usa, para quê, onde ficam guardados e como apagá-los.",
};

/**
 * Política de privacidade dos apps próprios das lojas (apps/loja — Hakim e as
 * que assinarem o plano). A Play e a App Store pedem uma política que descreva
 * exatamente o que o app coleta. Os fatos daqui saem do código:
 * - o aparelho é ligado ao PEDIDO (tabela PedidoAparelho), nunca ao telefone;
 * - a lista da aba Pedidos fica guardada só no celular (SecureStore);
 * - a localização é a do navegador da página, só quando o cliente toca em
 *   "usar minha localização" no endereço.
 */

const ATUALIZADO = "12 de outubro de 2026";

export default function PrivacidadeDoApp() {
  const secao: React.CSSProperties = { maxWidth: 780, margin: "0 auto", padding: "0 1.25rem" };
  const h2: React.CSSProperties = { fontSize: "1.25rem", fontWeight: 900, margin: "2rem 0 .6rem" };
  const p: React.CSSProperties = { lineHeight: 1.75, color: "#334155", margin: "0 0 .9rem" };
  const caixa: React.CSSProperties = {
    background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12,
    padding: "1rem 1.25rem", lineHeight: 1.75, fontSize: ".95rem", margin: "1rem 0",
  };

  return (
    <main style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif", color: "#0F172A", background: "#fff", paddingBottom: "3rem" }}>
      <div style={{ background: "linear-gradient(135deg,#0F172A,#1E293B)", color: "#fff", padding: "2rem 0 1.6rem" }}>
        <div style={secao}>
          <h1 style={{ fontSize: "1.7rem", fontWeight: 900, margin: 0 }}>Política de Privacidade do app da loja</h1>
          <div style={{ color: "#94A3B8", fontSize: ".85rem", marginTop: 6 }}>Atualizada em {ATUALIZADO}</div>
        </div>
      </div>

      <div style={secao}>
        <p style={{ ...p, marginTop: "1.6rem" }}>
          Este é o app de pedidos de um restaurante (a <b>loja</b>) que usa o sistema FireHub. Pelo app você
          vê o cardápio, faz o pedido para entrega ou retirada, paga e acompanha o andamento. O cardápio, o
          carrinho e o pagamento são as mesmas páginas do site de pedidos da loja.
        </p>

        <h2 style={h2}>O que usamos quando você faz um pedido</h2>
        <ul style={{ ...p, paddingLeft: "1.2rem" }}>
          <li><b>Seu nome e telefone:</b> para a loja saber de quem é o pedido e falar com você sobre ele.</li>
          <li><b>Endereço de entrega:</b> para calcular a taxa, saber se a loja entrega no seu bairro e o entregador chegar até você.</li>
          <li><b>Itens, observações e forma de pagamento:</b> para a loja preparar e cobrar o pedido.</li>
          <li><b>CPF</b> (só quando você informa): para gerar o Pix e para a nota fiscal.</li>
        </ul>

        <h2 style={h2}>Avisos do pedido</h2>
        <div style={caixa}>
          <b>Para quê:</b> avisar no seu celular quando o pedido é aceito, sai para entrega, fica pronto,
          é entregue ou é cancelado.
          <br /><br />
          <b>Como:</b> se você permitir os avisos, o app gera um identificador do aparelho para notificações
          (serviço do Expo, que usa o Firebase no Android e o serviço da Apple no iPhone) e o liga
          <b> apenas aos pedidos feitos neste celular</b>. Esse identificador não diz quem você é e não
          serve para mandar propaganda.
          <br /><br />
          <b>Desligar:</b> nos ajustes de notificação do celular, a qualquer momento.
        </div>

        <h2 style={h2}>Localização</h2>
        <p style={p}>
          O app só usa a sua localização quando você toca em “usar minha localização” para preencher o
          endereço ou achar a unidade que atende você. Ela não é rastreada nem guardada depois disso, e o app
          não usa localização em segundo plano.
        </p>

        <h2 style={h2}>O que fica no seu celular</h2>
        <p style={p}>
          A lista dos pedidos feitos pelo app (só o número interno de cada pedido, para a aba Pedidos) e o
          carrinho que você ainda não fechou. Tudo some quando você desinstala o app.
        </p>

        <h2 style={h2}>O que o app NÃO faz</h2>
        <ul style={{ ...p, paddingLeft: "1.2rem" }}>
          <li>Não acessa contatos, fotos, arquivos, câmera, microfone ou mensagens do celular.</li>
          <li>Não mostra anúncios e não rastreia você em outros apps ou sites.</li>
          <li>Não vende nem aluga os seus dados.</li>
        </ul>

        <h2 style={h2}>Com quem compartilhamos</h2>
        <p style={p}>
          Com a loja em que você fez o pedido e com quem ajuda a entregá-lo: o entregador da loja, o meio de
          pagamento que você escolheu (por exemplo Asaas ou Mercado Pago) e, quando a loja emite nota, a
          Secretaria da Fazenda. Mais ninguém.
        </p>

        <h2 style={h2}>Onde ficam guardados</h2>
        <p style={p}>
          No servidor do FireHub, com conexão criptografada (HTTPS). Os dados do pedido ficam guardados pelo
          tempo que a lei fiscal exige da loja.
        </p>

        <h2 style={h2}>Como pedir a exclusão</h2>
        <div style={caixa}>
          <b>Se você criou uma conta:</b> no cardápio, toque em <b>Entrar</b> (ou no seu nome, se já estiver
          logado) → <b>Excluir minha conta</b> → digite sua senha. Nome, telefone, endereço e cashback são
          apagados na hora.
        </div>
        <p style={p}>
          Fale com a loja ou escreva para{" "}
          <a href="mailto:contato@firehubfood.com.br" style={{ color: "#DC2626", fontWeight: 700 }}>contato@firehubfood.com.br</a>{" "}
          com o telefone usado no pedido. Atendemos em até 30 dias, exceto o que a lei fiscal obriga a manter
          (e dizemos o quê e por quanto tempo). Para parar os avisos, basta desligá-los no celular ou
          desinstalar o app.
        </p>

        <h2 style={h2}>Quem é o responsável</h2>
        <p style={p}>
          A loja dona do app é a responsável pelos dados dos pedidos feitos nela. O FireHub (HAKIM
          EMPREENDIMENTOS LTDA) opera o sistema por ela · contato@firehubfood.com.br ·{" "}
          <a href="https://firehubfood.com.br/privacidade" style={{ color: "#DC2626", fontWeight: 700 }}>política geral do FireHub</a>
        </p>
      </div>
    </main>
  );
}
