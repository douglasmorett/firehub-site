import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade — FireHub Prazos (extensão do Chrome)",
  description:
    "Quais dados a extensão FireHub Prazos usa, para quê, onde ficam guardados e como apagá-los.",
};

/**
 * Política de privacidade da extensão VENDIDA (FireHub Prazos).
 *
 * A da extensão interna (/privacidade-extensao) não serve: aquela lê o painel
 * do FireHub e exige conta de loja FireHub; esta lê o painel de qualquer
 * sistema, tem conta própria e escreve em dois marketplaces. A Chrome Web
 * Store exige uma política que descreva exatamente o item submetido.
 */

const ATUALIZADO = "8 de setembro de 2026";

export default function PrivacidadePrazos() {
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
            <b>FireHub Prazos</b>
          </div>
          <h1 style={{ fontSize: "1.7rem", fontWeight: 900, margin: 0 }}>Política de Privacidade</h1>
          <div style={{ color: "#94A3B8", fontSize: ".85rem", marginTop: 6 }}>Atualizada em {ATUALIZADO}</div>
        </div>
      </div>

      <div style={secao}>
        <p style={{ ...p, marginTop: "1.6rem" }}>
          O FireHub Prazos é uma extensão do Chrome que ajusta o prazo de entrega da loja do próprio
          usuário no Portal do Parceiro (iFood) e o tempo de preparo no 99Food Admin, com base na
          quantidade de pedidos que o usuário já vê no painel de pedidos dele.
        </p>
        <p style={p}>
          Esta política descreve exatamente o que a extensão lê, o que ela envia, o que fica guardado e
          por quanto tempo.
        </p>

        <h2 style={h2}>Onde a extensão funciona</h2>
        <p style={p}>Ela roda apenas em três lugares, e em nenhum outro:</p>
        <div style={caixa}>
          <b>1. No painel de pedidos do próprio usuário.</b> No site que ele indicar, e só depois de ele
          clicar em "Marcar coluna" e aceitar a permissão daquele site. Nada é lido antes disso.
          <br /><br />
          <b>2. No Portal do Parceiro (portal.ifood.com.br).</b> Para ler as faixas de entrega e escrever
          o prazo, na sessão que o próprio usuário já tem aberta.
          <br /><br />
          <b>3. No 99Food Admin (merchant.99app.com).</b> Para ler e escrever o tempo de preparo, também
          na sessão que o usuário já tem aberta.
        </div>
        <p style={p}>
          A extensão não abre abas sozinha, não navega por outros sites e não lê o histórico de
          navegação.
        </p>

        <h2 style={h2}>O que ela lê</h2>
        <ul style={{ ...p, paddingLeft: "1.2rem" }}>
          <li>A <b>quantidade de pedidos</b> nas colunas que o usuário marcou no painel dele, e o texto do cabeçalho dessas colunas (por exemplo "Em preparo").</li>
          <li>A <b>lista de lojas</b> do login do usuário no iFood e no 99Food: nome e identificador de cada loja.</li>
          <li>As <b>faixas de entrega e o tempo de preparo</b> atuais dessas lojas, para saber o que alterar e conferir depois.</li>
        </ul>

        <h2 style={h2}>O que ela NÃO lê</h2>
        <ul style={{ ...p, paddingLeft: "1.2rem" }}>
          <li>Nome, telefone, endereço ou qualquer dado de clientes finais.</li>
          <li>Senhas. A extensão usa a sessão que o navegador já tem; ela não vê nem guarda a senha de nenhum portal.</li>
          <li>Dados de cartão, conta bancária ou faturamento.</li>
          <li>Conteúdo de outras abas, e-mail, mensagens ou histórico de navegação.</li>
        </ul>

        <h2 style={h2}>O que sai do navegador</h2>
        <p style={p}>
          A extensão conversa apenas com o servidor do FireHub (firehubfood.com.br). O que ela envia é
          o mínimo para calcular o prazo e para o suporte conseguir ajudar:
        </p>
        <div style={caixa}>
          e-mail e senha, <b>só no momento do login</b>, para autenticar a conta ·
          quantidade de pedidos por coluna marcada · nome das colunas ·
          endereço (domínio) do painel de pedidos · nome e identificador das lojas marcadas ·
          prazo calculado e o que foi aplicado em cada loja · mensagens de erro · versão da extensão
        </div>
        <p style={p}>
          As alterações de prazo no iFood e no 99Food são feitas <b>direto do navegador do usuário para
          o portal</b>, na sessão dele. Essas informações não passam pelo servidor do FireHub.
        </p>

        <h2 style={h2}>Onde fica guardado, e por quanto tempo</h2>
        <ul style={{ ...p, paddingLeft: "1.2rem" }}>
          <li><b>No navegador</b> (armazenamento local da extensão): a sessão, as colunas marcadas e o último prazo calculado. Sai quando o usuário clica em "Sair" ou remove a extensão.</li>
          <li><b>No servidor do FireHub</b>: a conta (e-mail, nome da loja, WhatsApp se informado), as configurações, as lojas marcadas, o último sinal da extensão e o histórico de mudanças de prazo. O histórico é apagado automaticamente depois de 90 dias.</li>
          <li>A senha é guardada apenas como <i>hash</i> (bcrypt). Ninguém, nem nós, consegue lê-la.</li>
        </ul>

        <h2 style={h2}>Com quem compartilhamos</h2>
        <p style={p}>
          Com ninguém. Não vendemos, não alugamos e não cedemos esses dados a terceiros. Não usamos
          para publicidade, não usamos para avaliar crédito e não usamos para nenhuma finalidade
          diferente de fazer a extensão funcionar e dar suporte a quem assina.
        </p>

        <h2 style={h2}>Como apagar</h2>
        <p style={p}>
          Peça o cancelamento e a exclusão pelo e-mail <a href="mailto:contato@firehubfood.com.br" style={{ color: "#FF5722", fontWeight: 700 }}>contato@firehubfood.com.br</a>.
          Apagamos a conta e tudo o que estiver ligado a ela em até 7 dias, e confirmamos por e-mail.
          Remover a extensão do Chrome já apaga tudo o que estava no navegador.
        </p>

        <h2 style={h2}>Quem é o responsável</h2>
        <p style={p}>
          FireHub · contato@firehubfood.com.br · <a href="https://firehubfood.com.br/prazos" style={{ color: "#FF5722", fontWeight: 700 }}>firehubfood.com.br/prazos</a>
        </p>
        <p style={{ ...p, color: "#64748B", fontSize: ".9rem" }}>
          Produto independente. Não somos iFood nem 99Food e não temos vínculo com essas empresas. As
          marcas citadas pertencem aos seus donos, e são mencionadas apenas para dizer com quais
          sistemas a extensão funciona.
        </p>
      </div>
    </main>
  );
}
