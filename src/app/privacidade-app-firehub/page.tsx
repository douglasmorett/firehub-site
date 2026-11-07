import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade — App FireHub",
  description:
    "Quais dados o app FireHub (loja, garçom e tablet da mesa) usa, para quê, onde ficam guardados e como apagá-los.",
};

/**
 * Política de privacidade do App FireHub (apps/firehub, br.com.firehub.app).
 *
 * A Play e a App Store exigem uma política que descreva exatamente o que o app
 * coleta. Os fatos daqui saem do código: o aparelho é guardado em LojaAparelho
 * (usuário, loja, token de notificação, plataforma e versão do app — sem
 * modelo nem localização); a sessão, a impressora Bluetooth escolhida e o modo
 * do aparelho ficam no SecureStore do celular (apps/firehub/src/lib/guardado.ts).
 */

const ATUALIZADO = "6 de novembro de 2026";

export default function PrivacidadeAppFireHub() {
  const secao: React.CSSProperties = { maxWidth: 780, margin: "0 auto", padding: "0 1.25rem" };
  const h2: React.CSSProperties = { fontSize: "1.25rem", fontWeight: 900, margin: "2rem 0 .6rem" };
  const p: React.CSSProperties = { lineHeight: 1.75, color: "#334155", margin: "0 0 .9rem" };

  return (
    <main style={{ fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif", color: "#0F172A", background: "#fff", paddingBottom: "3rem" }}>
      <div style={{ background: "linear-gradient(135deg,#0F172A,#1E293B)", color: "#fff", padding: "2rem 0 1.6rem" }}>
        <div style={secao}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg,#FF5722,#F44336)", display: "grid", placeItems: "center" }}>🔥</div>
            <b>App FireHub</b>
          </div>
          <h1 style={{ fontSize: "1.7rem", fontWeight: 900, margin: 0 }}>Política de Privacidade</h1>
          <div style={{ color: "#94A3B8", fontSize: ".85rem", marginTop: 6 }}>Atualizada em {ATUALIZADO}</div>
        </div>
      </div>

      <div style={secao}>
        <p style={{ ...p, marginTop: "1.6rem" }}>
          O App FireHub é o aplicativo das lojas que usam o FireHub. No mesmo app o aparelho escolhe
          como vai ser usado: <b>loja</b> (painel de pedidos, aviso de pedido novo e impressora
          Bluetooth), <b>garçom</b> (mesas e pedidos do salão) ou <b>tablet da mesa</b> (o cardápio
          para o cliente pedir sozinho).
        </p>
        <p style={p}>
          O app não tem cadastro aberto. Quem cria os acessos é a loja, no painel do FireHub; os dados
          dos pedidos e dos clientes que aparecem nas telas são os mesmos do painel e seguem a{" "}
          <a href="/privacidade" style={{ color: "#FF5722", fontWeight: 700 }}>Política de Privacidade do FireHub</a>.
        </p>

        <h2 style={h2}>O que o app usa</h2>
        <ul style={{ ...p, paddingLeft: "1.2rem" }}>
          <li><b>Login:</b> o e-mail e a senha da loja ou da equipe, cadastrados pela loja. A senha é guardada no servidor só como <i>hash</i>; no celular fica apenas a sessão.</li>
          <li><b>Aviso de pedido novo:</b> um identificador do aparelho para notificações (Expo/Firebase/Apple), ligado ao login, com o sistema (Android ou iPhone) e a versão do app. É apagado quando a pessoa sai da conta.</li>
          <li><b>Impressora Bluetooth (Android):</b> o nome e o endereço da impressora escolhida, guardados só no celular, para imprimir as comandas. O app não procura nem guarda outros aparelhos.</li>
          <li><b>Tablet da mesa:</b> o número de pareamento que a loja gera no painel, que liga o tablet a uma mesa. Os pedidos feitos no tablet entram na conta daquela mesa.</li>
        </ul>

        <h2 style={h2}>O que o app NÃO faz</h2>
        <ul style={{ ...p, paddingLeft: "1.2rem" }}>
          <li>Não usa a localização do aparelho.</li>
          <li>Não acessa contatos, fotos, arquivos, microfone, câmera ou mensagens do celular.</li>
          <li>Não mostra anúncios e não usa os dados para publicidade.</li>
        </ul>

        <h2 style={h2}>Com quem compartilhamos</h2>
        <p style={p}>
          Com ninguém além da própria loja. As notificações passam pelos serviços de aviso do Expo, do
          Google (Firebase) e da Apple, que recebem só o identificador do aparelho e o texto do aviso.
          Não vendemos, não alugamos e não cedemos esses dados.
        </p>

        <h2 style={h2}>Onde ficam guardados</h2>
        <p style={p}>
          No servidor do FireHub, com conexão criptografada (HTTPS). No celular ficam só a sessão, o
          modo do aparelho e a impressora escolhida, apagados quando a pessoa sai da conta ou desinstala
          o app.
        </p>

        <h2 style={h2}>Como apagar</h2>
        <p style={p}>
          A loja pode excluir o acesso de qualquer pessoa da equipe no painel. Também é possível pedir a
          exclusão dos dados pelo e-mail{" "}
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
