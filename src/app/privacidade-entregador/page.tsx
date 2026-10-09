import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade — FireHub Entregador",
  description:
    "Quais dados o app FireHub Entregador usa, para quê, onde ficam guardados e como apagá-los.",
};

/**
 * Política de privacidade do app do entregador (Android e iPhone).
 *
 * A geral (/privacidade) não fala de localização, e a Play e a App Store exigem
 * uma política que descreva exatamente o que o app coleta. Os fatos daqui saem
 * do código: a posição vai para /api/motoboys/location, que só sobrescreve a
 * ÚLTIMA posição do entregador (Motoboy.lastLat/lastLng) — não há histórico.
 */

const ATUALIZADO = "9 de outubro de 2026";

export default function PrivacidadeEntregador() {
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
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,#FF5722,#F44336)", display: "grid", placeItems: "center" }}>🔥</div>
            <b>FireHub Entregador</b>
          </div>
          <h1 style={{ fontSize: "1.7rem", fontWeight: 900, margin: 0 }}>Política de Privacidade</h1>
          <div style={{ color: "#94A3B8", fontSize: ".85rem", marginTop: 6 }}>Atualizada em {ATUALIZADO}</div>
        </div>
      </div>

      <div style={secao}>
        <p style={{ ...p, marginTop: "1.6rem" }}>
          O FireHub Entregador é o app que o entregador de uma loja que usa o FireHub instala para ver
          as entregas que a loja passou para ele, abrir o endereço no mapa, ligar para o cliente,
          confirmar a entrega e consultar o próprio relatório de corridas.
        </p>
        <p style={p}>
          Quem cria o acesso do entregador é a loja, no painel do FireHub. O app não tem cadastro
          aberto: sem o acesso dado pela loja, ele não mostra nada.
        </p>

        <h2 style={h2}>Localização</h2>
        <div style={caixa}>
          <b>Para quê:</b> mostrar à loja onde o entregador está no mapa enquanto faz as entregas, para
          ela saber onde está cada pedido e montar as próximas rotas.
          <br /><br />
          <b>Quando:</b> só com o entregador logado e com a localização ligada no app. No Android fica
          uma notificação fixa avisando que a loja está vendo a localização; no iPhone, o indicador
          azul do sistema. O entregador pode <b>pausar</b> a qualquer momento pelo botão no topo da
          tela, e o envio para quando ele sai da conta.
          <br /><br />
          <b>O que fica guardado:</b> apenas a <b>última posição</b> enviada e a hora dela. Cada envio
          substitui o anterior; não guardamos o trajeto. A posição na hora de confirmar uma entrega
          segue a mesma regra.
          <br /><br />
          <b>Quem vê:</b> só a loja para a qual o entregador trabalha.
        </div>
        <p style={p}>
          O app pede a permissão de localização "durante o uso". Ele não pede a permissão "o tempo
          todo".
        </p>

        <h2 style={h2}>Outros dados que o app usa</h2>
        <ul style={{ ...p, paddingLeft: "1.2rem" }}>
          <li><b>Acesso do entregador:</b> nome, telefone e senha, cadastrados pela loja. A senha é guardada só como <i>hash</i>; ninguém consegue lê-la.</li>
          <li><b>Pedidos da entrega:</b> nome, telefone e endereço do cliente, itens e forma de pagamento — os dados que a loja já tem e passa para o entregador poder entregar.</li>
          <li><b>Código de entrega:</b> o código que o cliente informa na porta, conferido com a plataforma do pedido (iFood ou 99Food) quando ela exige.</li>
          <li><b>Aviso de pedido novo:</b> um identificador do aparelho para notificações (Expo/Firebase), apagado quando o entregador sai da conta.</li>
          <li><b>Câmera:</b> só para ler o QR Code impresso na comanda e puxar o pedido. Nenhuma foto é tirada nem guardada.</li>
          <li><b>Relatório:</b> as entregas feitas e os valores combinados com a loja, para o próprio entregador conferir.</li>
        </ul>

        <h2 style={h2}>O que o app NÃO faz</h2>
        <ul style={{ ...p, paddingLeft: "1.2rem" }}>
          <li>Não grava o trajeto do entregador.</li>
          <li>Não acessa contatos, fotos, arquivos, microfone ou mensagens do celular.</li>
          <li>Não mostra anúncios e não usa os dados para publicidade.</li>
        </ul>

        <h2 style={h2}>Com quem compartilhamos</h2>
        <p style={p}>
          Com a loja para a qual o entregador trabalha. Quando o pedido é de uma plataforma (iFood ou
          99Food), o código de entrega é enviado a ela para a conferência. Não vendemos, não alugamos e
          não cedemos esses dados a mais ninguém.
        </p>

        <h2 style={h2}>Onde ficam guardados</h2>
        <p style={p}>
          No servidor do FireHub, com conexão criptografada (HTTPS). No celular fica só a sessão do
          entregador, apagada quando ele sai da conta ou desinstala o app.
        </p>

        <h2 style={h2}>Como apagar</h2>
        <p style={p}>
          A loja pode desativar ou excluir o acesso do entregador no painel. O entregador também pode
          pedir a exclusão dos dados dele pelo e-mail{" "}
          <a href="mailto:contato@firehubfood.com.br" style={{ color: "#FF5722", fontWeight: 700 }}>contato@firehubfood.com.br</a>.
          Apagamos em até 7 dias e confirmamos por e-mail.
        </p>

        <h2 style={h2}>Quem é o responsável</h2>
        <p style={p}>
          HAKIM EMPREENDIMENTOS LTDA (FireHub) · contato@firehubfood.com.br ·{" "}
          <a href="https://firehubfood.com.br" style={{ color: "#FF5722", fontWeight: 700 }}>firehubfood.com.br</a>
        </p>
      </div>
    </main>
  );
}
