import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Política de Privacidade — FireHub",
  description:
    "Quais dados o FireHub trata, para quê, com quem compartilha, quanto tempo guarda e como pedir exclusão.",
};

/**
 * /privacidade — a política de privacidade do FireHub.
 *
 * Existe porque toda plataforma que se conecta a contas de terceiros precisa
 * declarar publicamente o que faz com esses dados: a Meta exige a URL para
 * publicar o app de anúncios (o campo estava VAZIO e é bloqueio de publicação),
 * e o mesmo vale para iFood, Mercado Pago e Google. Também é o documento que a
 * LGPD pede de qualquer empresa que trate dado de cliente final.
 *
 * A seção 7 tem id="exclusao" de propósito: é o endereço que se informa no
 * campo "instruções de exclusão de dados" dos painéis de desenvolvedor —
 * https://firehubfood.com.br/privacidade#exclusao
 */

const texto = { lineHeight: 1.8, fontSize: "0.95rem", color: "#374151" } as const;

const caixa = {
  background: "#F8FAFC",
  border: "1px solid #E2E8F0",
  borderRadius: 12,
  padding: "1rem 1.25rem",
  lineHeight: 1.8,
  fontSize: "0.92rem",
  margin: "1rem 0",
} as const;

function Secao({ n, titulo, id, children }: { n: string; titulo: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} style={{ marginBottom: "2rem", scrollMarginTop: "1.5rem" }}>
      <h2 style={{ fontSize: "1.3rem", fontWeight: 800, marginBottom: "0.75rem" }}>
        {n}. {titulo}
      </h2>
      {children}
    </section>
  );
}

export default function PrivacidadePage() {
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
        Política de Privacidade — FireHub
      </h1>
      <p style={{ color: "#64748B", marginBottom: "2rem" }}>
        Aplica-se ao sistema FireHub (firehubfood.com.br), operado por{" "}
        <strong>GRUPO HAKIM LTDA</strong>, e a todos os seus módulos: cardápio digital, gestão de
        pedidos, PDV, totem de autoatendimento, KDS, motoboys, emissão fiscal, chatbot de WhatsApp e
        Tráfego Pago. Última atualização: 28/08/2026.
      </p>

      <Secao n="1" titulo="Quem somos e a quem esta política se aplica">
        <p style={texto}>
          O FireHub é um sistema de gestão vendido a restaurantes. Isso cria duas relações
          diferentes, e elas não se confundem:
        </p>
        <div style={caixa}>
          <strong>O restaurante</strong> contrata o FireHub e é quem decide o que fazer com os dados
          dos clientes dele. Perante a LGPD, ele é o <em>controlador</em> desses dados.
          <br />
          <br />
          <strong>O FireHub</strong> processa esses dados para entregar o serviço contratado — e
          apenas para isso. Somos o <em>operador</em>.
          <br />
          <br />
          Para os dados da <strong>conta do próprio restaurante</strong> (cadastro, faturamento do
          sistema, cobrança), o FireHub é o controlador.
        </div>
      </Secao>

      <Secao n="2" titulo="Dados que tratamos">
        <p style={texto}>
          <strong>Do restaurante (nosso cliente):</strong> nome da loja, CNPJ, endereço, telefone,
          e-mail, dados de acesso, dados de cobrança e uso do sistema.
        </p>
        <p style={texto}>
          <strong>Do cliente final (quem faz o pedido):</strong> nome, telefone, endereço de entrega,
          itens do pedido, forma de pagamento e observações. Coletados quando a pessoa faz um pedido
          pelo cardápio online, pelo WhatsApp, pelo totem ou quando o pedido chega de uma plataforma
          integrada.
        </p>
        <p style={texto}>
          <strong>Nunca guardamos</strong> número completo de cartão de crédito, código de segurança
          nem senha de plataformas de terceiros. Pagamentos com cartão são processados diretamente
          pelo gateway (Mercado Pago, Pagar.me, Asaas) — o cartão não passa pelos nossos servidores.
        </p>
      </Secao>

      <Secao n="3" titulo="Contas conectadas: iFood, Meta (Facebook e Instagram), WhatsApp e outras">
        <p style={texto}>
          O restaurante pode conectar contas dele a plataformas de terceiros. Em todos os casos a
          conexão é feita <strong>por ele, com autorização explícita</strong>, e pode ser revogada a
          qualquer momento — no FireHub ou no painel da própria plataforma.
        </p>
        <div style={caixa}>
          <strong>Meta (Facebook e Instagram) — módulo Tráfego Pago.</strong> Quando o restaurante
          conecta o Facebook, recebemos um token de acesso e usamos apenas para: listar as contas de
          anúncio e Páginas <em>dele</em>, para que escolha qual usar; criar, pausar e ajustar as
          campanhas que ele contratou; e ler as métricas dessas campanhas (gasto, alcance, cliques,
          resultados) para mostrar no painel dele.
          <br />
          <br />
          Não acessamos contas de anúncio que não tenham sido concedidas nesse fluxo, não publicamos
          nada sem ação dele e não usamos esses dados para nenhuma outra finalidade — nem para
          treinar modelos, nem para vender a terceiros. A conta de anúncios continua sendo do
          restaurante, e as campanhas ficam visíveis no Gerenciador de Anúncios dele.
        </div>
        <p style={texto}>
          <strong>iFood, JotaJá, 99Food e Brendi:</strong> recebemos os pedidos feitos nessas
          plataformas para exibi-los no painel, imprimir a comanda e sincronizar o status.{" "}
          <strong>WhatsApp:</strong> o número conectado é usado para o atendimento automático da
          loja com os clientes dela. <strong>Mercado Pago e demais gateways:</strong> processam os
          pagamentos.
        </p>
      </Secao>

      <Secao n="4" titulo="Para que usamos">
        <p style={texto}>
          Exclusivamente para operar o serviço contratado: registrar e roteirizar pedidos, imprimir
          comandas, calcular entregas, emitir documento fiscal, atender pelo WhatsApp, gerir
          campanhas de anúncio contratadas, gerar relatórios para o lojista, cobrar a mensalidade e
          dar suporte.
        </p>
        <p style={texto}>
          <strong>Não vendemos dados</strong>, não os cedemos para publicidade de terceiros e não os
          usamos para treinar modelos de inteligência artificial. Recursos de IA do sistema (como o
          atendente de WhatsApp e a geração de textos de anúncio) processam o conteúdo necessário
          para responder naquele momento.
        </p>
      </Secao>

      <Secao n="5" titulo="Com quem compartilhamos">
        <p style={texto}>
          Apenas com quem é necessário para o serviço funcionar: provedores de infraestrutura e
          banco de dados, gateways de pagamento, provedor de emissão fiscal, plataformas de pedido
          que o próprio lojista conectou, provedores de IA para os recursos que dependem disso, e
          autoridades quando houver obrigação legal. Cada um recebe apenas o dado necessário para a
          sua função.
        </p>
      </Secao>

      <Secao n="6" titulo="Por quanto tempo guardamos">
        <p style={texto}>
          Dados de pedido e financeiros ficam pelo prazo exigido pela legislação fiscal e contábil
          (em regra, cinco anos). Dados de acesso e de suporte, enquanto o contrato estiver ativo.
          Encerrado o contrato, os dados do restaurante são apagados ou anonimizados em até 90 dias,
          salvo o que a lei obrigue a manter.
        </p>
      </Secao>

      <Secao n="7" titulo="Seus direitos e como pedir a exclusão dos seus dados" id="exclusao">
        <p style={texto}>
          Você pode pedir a qualquer momento: confirmação de que tratamos seus dados, acesso a eles,
          correção, portabilidade, revogação de consentimento e <strong>exclusão</strong>.
        </p>
        <div style={caixa}>
          <strong>Como pedir a exclusão dos seus dados</strong>
          <br />
          <br />
          <strong>Você é cliente de um restaurante</strong> que usa o FireHub (fez um pedido pelo
          cardápio, WhatsApp ou totem): fale com o restaurante, que é quem controla esses dados. Se
          preferir, escreva para{" "}
          <a href="mailto:contatohakim@gmail.com" style={{ color: "#DC2626", fontWeight: 700 }}>
            contatohakim@gmail.com
          </a>{" "}
          com o telefone usado no pedido, que encaminhamos e acompanhamos a exclusão.
          <br />
          <br />
          <strong>Você é o restaurante:</strong> escreva para{" "}
          <a href="mailto:contatohakim@gmail.com" style={{ color: "#DC2626", fontWeight: 700 }}>
            contatohakim@gmail.com
          </a>{" "}
          do e-mail cadastrado, informando o nome da loja e o CNPJ.
          <br />
          <br />
          <strong>Quer só desconectar uma plataforma</strong> (Facebook, iFood, WhatsApp): faça
          direto no FireHub, na tela de Integrações ou de Tráfego Pago — a desconexão apaga o token
          de acesso imediatamente. No caso da Meta, você também pode remover o app em
          Facebook → Configurações → Aplicativos e sites.
          <br />
          <br />
          Respondemos em até <strong>15 dias</strong>. Pedidos de exclusão são atendidos em até{" "}
          <strong>30 dias</strong>, exceto pelos dados que a lei fiscal nos obriga a guardar — nesse
          caso informamos quais são e por quanto tempo.
        </div>
      </Secao>

      <Secao n="8" titulo="Segurança">
        <p style={texto}>
          Todo o tráfego é criptografado (HTTPS). Senhas são guardadas com hash e nunca em texto
          legível. O acesso aos dados de cada loja é isolado por conta, e credenciais de plataformas
          conectadas nunca são exibidas de volta na tela depois de salvas.
        </p>
      </Secao>

      <Secao n="9" titulo="Cookies">
        <p style={texto}>
          Usamos cookies necessários para manter a sessão de quem faz login e cookies de medição
          (como o pixel da Meta e ferramentas de análise) para entender o uso do site. Você pode
          bloqueá-los no navegador; os de sessão são necessários para o sistema funcionar.
        </p>
      </Secao>

      <Secao n="10" titulo="Alterações e contato">
        <p style={texto}>
          Mudanças relevantes são comunicadas aos lojistas pelo painel ou por e-mail, com a data de
          atualização revisada no topo desta página.
        </p>
        <div style={caixa}>
          <strong>Encarregado de dados (DPO) — GRUPO HAKIM LTDA</strong>
          <br />
          E-mail:{" "}
          <a href="mailto:contatohakim@gmail.com" style={{ color: "#DC2626", fontWeight: 700 }}>
            contatohakim@gmail.com
          </a>
          <br />
          WhatsApp:{" "}
          <a
            href="https://wa.me/5522981118514"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "#DC2626", fontWeight: 700 }}
          >
            (22) 98111-8514
          </a>
        </div>
      </Secao>

      <p style={{ fontSize: "0.85rem", color: "#94A3B8", marginTop: "2.5rem" }}>
        Veja também os{" "}
        <a href="/termos" style={{ color: "#64748B", fontWeight: 600 }}>
          Termos de Uso
        </a>{" "}
        e a{" "}
        <a href="/privacidade-extensao" style={{ color: "#64748B", fontWeight: 600 }}>
          política da extensão para Chrome
        </a>
        .
      </p>
    </div>
  );
}
