/**
 * O texto dos Termos de Uso do FireHub — UM só, usado pela página /termos e
 * pela tela de aceite do painel (AceiteDosTermos). Duas cópias do contrato
 * viram duas versões do contrato no primeiro ajuste.
 *
 * Sem hooks: renderiza no servidor (página) e dentro do componente client.
 *
 * Números de cobrança aqui têm de bater com o código: percentual, piso e teto
 * em lib/firehub-billing.ts; vencimento, bloqueio, multa e juros em
 * lib/prazo-da-mensalidade.ts; taxa do pagamento online em lib/pix-online.ts.
 * Mudou algo relevante? Troque VERSAO_DOS_TERMOS (lib/termos-versao.ts).
 */
import type { CSSProperties, ReactNode } from "react";
import { DATA_DOS_TERMOS } from "@/lib/termos-versao";
import { FIREHUB_PLAN } from "@/lib/firehub-billing";
import { MULTA_POR_ATRASO_PCT, JUROS_AO_MES_PCT } from "@/lib/prazo-da-mensalidade";
import { SPLIT_FIREHUB_PERCENTUAL } from "@/lib/pix-online";

const reais = (v: number) => `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function TextoDosTermos({ compacto = false }: { compacto?: boolean }) {
  const tam = compacto ? 0.86 : 0.95;
  const p: CSSProperties = { lineHeight: 1.75, fontSize: `${tam}rem`, color: "#374151", margin: "0 0 0.6rem" };
  const h2: CSSProperties = { fontSize: compacto ? "1.02rem" : "1.25rem", fontWeight: 800, color: "#0F172A", margin: compacto ? "1.4rem 0 0.5rem" : "2.2rem 0 0.75rem" };

  function Secao({ n, titulo, children }: { n: string; titulo: string; children: ReactNode }) {
    return (
      <section>
        <h2 style={h2}>{n}. {titulo}</h2>
        {children}
      </section>
    );
  }
  function Item({ n, children }: { n: string; children: ReactNode }) {
    return (
      <p style={p}>
        <strong style={{ color: "#0F172A" }}>{n}</strong> {children}
      </p>
    );
  }
  /** Cláusula que limita direito do lojista: vai em destaque, como a lei pede para contrato de adesão. */
  function Destaque({ children }: { children: ReactNode }) {
    return (
      <div style={{ background: "#FFF7ED", border: "1.5px solid #FDBA74", borderRadius: 12, padding: compacto ? "0.75rem 0.9rem" : "1rem 1.25rem", margin: "0.4rem 0 0.9rem" }}>
        {children}
      </div>
    );
  }

  return (
    <div>
      <p style={{ ...p, color: "#64748B" }}>
        Versão de {DATA_DOS_TERMOS}. Estes Termos são o contrato entre a <strong>GRUPO HAKIM LTDA</strong>, CNPJ
        55.878.184/0001-89, com sede na Estrada Professor Leandro Faria Sarzedas, 1300, Área E 1C, SPRO 1103,
        Village, Rio das Ostras/RJ, CEP 28895-638 (<strong>“FireHub”</strong>), e a empresa ou pessoa que cria uma
        conta para usar o sistema na sua atividade comercial (<strong>“Lojista”</strong>).
      </p>
      <p style={{ ...p, color: "#64748B" }}>
        Ao marcar “Li e aceito” no cadastro ou no painel, o Lojista declara que leu, entendeu e concorda com
        estes Termos e com a <a href="/privacidade" target="_blank" rel="noopener noreferrer" style={{ color: "#C92E09", fontWeight: 700 }}>Política de Privacidade</a>.
        Quem aceita declara ter poderes para representar a empresa cadastrada.
      </p>

      <div style={{ background: "#F8FAFC", border: "1px solid #E2E8F0", borderRadius: 12, padding: compacto ? "0.8rem 1rem" : "1.1rem 1.35rem", margin: "1rem 0" }}>
        <strong style={{ fontSize: `${tam}rem`, color: "#0F172A" }}>Em poucas palavras</strong>
        <ul style={{ ...p, margin: "0.4rem 0 0", paddingLeft: "1.2rem" }}>
          <li>O FireHub é uma <strong>ferramenta</strong>. A venda, o produto, a entrega e o atendimento ao seu cliente são da sua loja.</li>
          <li>Você paga <strong>{FIREHUB_PLAN.PERCENT_RATE}% do que vende pelo sistema</strong>, no mínimo {reais(FIREHUB_PLAN.MIN_MONTHLY)} e no máximo {reais(FIREHUB_PLAN.MAX_MONTHLY)} por mês. Sem fidelidade e sem multa para cancelar.</li>
          <li>Sistema na internet pode cair ou ficar lento. <strong>Tenha sempre um plano B</strong> para receber e anotar pedidos.</li>
          <li>iFood, WhatsApp, Asaas, SEFAZ e outros serviços são de terceiros: o FireHub não responde pelo que eles fazem.</li>
          <li>Robô e IA podem errar: <strong>confira os pedidos</strong>. Cardápio, preços, taxas e dados fiscais são configurados e conferidos por você.</li>
          <li>O FireHub <strong>não responde por lucros cessantes</strong> nem por vendas perdidas, e a responsabilidade dele tem limite de valor (item 9).</li>
        </ul>
      </div>

      <Secao n="1" titulo="O que é o FireHub">
        <Item n="1.1">O FireHub é um software de gestão oferecido pela internet (SaaS) para restaurantes e negócios de comida: cardápio digital, pedidos, balcão, mesas, totem, tela da cozinha (KDS), entregadores, integrações com marketplaces, atendimento automático pelo WhatsApp com inteligência artificial, emissão de nota fiscal, financeiro, estoque, tráfego pago e outras funções.</Item>
        <Item n="1.2">O FireHub é uma ferramenta de gestão. Ele <strong>não é parte das vendas do Lojista</strong>, não é marketplace, não vende, não prepara e não entrega produtos, e não é intermediador de pagamento. A relação com o cliente final, inclusive a de consumo, é exclusivamente do Lojista.</Item>
        <Item n="1.3">O Lojista recebe uma licença de uso não exclusiva, intransferível e revogável, válida enquanto a conta estiver ativa e em dia. O software, a marca, o código e o layout pertencem ao FireHub. É proibido copiar, revender, sublicenciar, fazer engenharia reversa ou acessar o sistema por robôs e meios automatizados não autorizados.</Item>
        <Item n="1.4">O FireHub pode criar, alterar ou retirar funções a qualquer tempo, para melhorar o serviço, por segurança, por exigência legal ou por mudança de serviços de terceiros. Quando possível, avisará antes de retirar uma função em uso.</Item>
      </Secao>

      <Secao n="2" titulo="Relação entre as partes">
        <Item n="2.1">O Lojista contrata o FireHub para usar na sua atividade econômica. A relação é <strong>empresarial</strong>, regida pelo Código Civil e pela Lei da Liberdade Econômica (Lei 13.874/2019), e não é relação de consumo. As partes reconhecem que a divisão de riscos destes Termos foi considerada na formação do preço (art. 421-A do Código Civil).</Item>
        <Item n="2.2">Estes Termos não criam sociedade, franquia, representação, vínculo de emprego ou qualquer outra relação além da prestação do serviço.</Item>
      </Secao>

      <Secao n="3" titulo="Cadastro, acessos e suporte">
        <Item n="3.1">O Lojista informa dados verdadeiros e os mantém atualizados (nome, CNPJ ou CPF, endereço, telefone e e-mail).</Item>
        <Item n="3.2">Login e senha são pessoais. O Lojista responde por tudo o que for feito com os seus acessos e com os acessos que ele criar para funcionários, garçons e entregadores, inclusive pelas permissões que conceder.</Item>
        <Item n="3.3">Suspeitou de acesso indevido? Troque a senha na hora e avise o suporte.</Item>
        <Item n="3.4">O Lojista autoriza a equipe do FireHub a acessar a conta para dar suporte, configurar, montar o cardápio e corrigir falhas, quando pedido ou quando necessário para manter o serviço funcionando. Cardápio, preços e configurações montados pela equipe <strong>devem ser conferidos pelo Lojista antes de começar a vender</strong>.</Item>
        <Item n="3.5">O suporte é prestado pelo WhatsApp, por ordem de chegada e com prioridade para falhas que impedem a operação, sem prazo garantido de resposta.</Item>
      </Secao>

      <Secao n="4" titulo="Preço, cobrança e atraso">
        <Item n="4.1"><strong>Teste grátis:</strong> 15 dias a partir do cadastro, ou o prazo informado na página de cadastro. As vendas feitas durante o teste não entram na cobrança.</Item>
        <Item n="4.2"><strong>Mensalidade:</strong> {FIREHUB_PLAN.PERCENT_RATE}% do faturamento do mês registrado no FireHub, no mínimo {reais(FIREHUB_PLAN.MIN_MONTHLY)} e no máximo {reais(FIREHUB_PLAN.MAX_MONTHLY)}. Entra todo pedido de todos os canais (cardápio digital, WhatsApp, mesa, balcão, totem, iFood, 99Food, Jotajá e demais integrações), pelo valor cheio antes de cupons e descontos. Pedidos cancelados ficam de fora. Até setembro de 2026 o percentual era 1%.</Item>
        <Item n="4.3">Mês sem nenhuma venda e sem uso do sistema: R$ 0,00. Mês sem venda, mas com uso ativo (robô conectado, integrações ligadas, financeiro ou estoque em uso): cobra-se o mínimo.</Item>
        <Item n="4.4"><strong>Serviços adicionais</strong>, cobrados na mesma fatura: cada loja adicional ligada a um mesmo marketplace, {reais(FIREHUB_PLAN.EXTRA_STORE_FEE)} por mês (a primeira é gratuita); totem, R$ 100,00 por mês por totem; tráfego pago, R$ 50,00 por semana de campanha ativa, independentemente do resultado. A verba dos anúncios é paga pelo Lojista diretamente à Meta.</Item>
        <Item n="4.5"><strong>Pagamento online pelo site:</strong> é processado na conta Asaas do próprio Lojista. Sobre cada pedido pago online, o FireHub fica com {SPLIT_FIREHUB_PERCENTUAL}% do valor, além das tarifas do Asaas, que são do Asaas.</Item>
        <Item n="4.6"><strong>Fatura e vencimento:</strong> o mês fecha no dia 1 do mês seguinte (horário de Brasília) e o boleto/Pix sai pelo Asaas com <strong>vencimento no dia 5</strong>. Depois do vencimento incidem multa de {MULTA_POR_ATRASO_PCT}% e juros de {JUROS_AO_MES_PCT}% ao mês, proporcionais aos dias de atraso.</Item>
        <Item n="4.7"><strong>Bloqueio:</strong> sem pagamento até o dia 10, o painel é bloqueado até a compensação, e o desbloqueio é automático. O bloqueio por falta de pagamento não gera direito a indenização.</Item>
        <Item n="4.8">Discordou de algum valor da fatura? Avise o suporte até o vencimento, indicando o pedido ou o valor contestado.</Item>
        <Item n="4.9"><strong>Mudança de preço:</strong> é avisada pelo painel, por e-mail ou pelo WhatsApp. Quem não concordar pode cancelar sem multa. Continuar usando depois do aviso significa concordar.</Item>
      </Secao>

      <Secao n="5" titulo="Funcionamento do sistema e plano B">
        <Destaque>
          <Item n="5.1">O FireHub depende de internet, servidores, hospedagem e serviços de terceiros. Por isso, é fornecido <strong>“no estado em que se encontra” e “conforme a disponibilidade”</strong>. O FireHub se esforça para mantê-lo funcionando, mas <strong>não garante funcionamento ininterrupto, sem lentidão, sem erros ou sem falhas</strong>, nem que o sistema atenderá a toda necessidade específica do Lojista.</Item>
          <Item n="5.2">Podem ocorrer paradas para manutenção e atualização, preferencialmente fora do horário de maior movimento, sem garantia de horário, além de paradas por falhas.</Item>
          <Item n="5.3"><strong>Plano de contingência é responsabilidade do Lojista.</strong> Ele deve manter uma forma alternativa de receber e registrar pedidos (por exemplo, o acesso direto aos portais e aplicativos do iFood e da 99Food, telefone e bloco de comandas), conferir se os pedidos chegaram e foram impressos, e não depender só do sistema para operar.</Item>
          <Item n="5.4"><strong>Compensação por parada:</strong> se o painel ficar totalmente fora do ar por mais de 24 horas seguidas por falha exclusiva do FireHub, o Lojista pode pedir, em até 30 dias, um abatimento proporcional aos dias parados na mensalidade daquele mês. Esse abatimento é a <strong>única e exclusiva compensação</strong> por indisponibilidade do sistema.</Item>
        </Destaque>
      </Secao>

      <Secao n="6" titulo="Serviços de terceiros">
        <Item n="6.1">Várias funções dependem de empresas que o FireHub não controla: marketplaces (iFood, 99Food, Jotajá, Brendi e outros), WhatsApp, Facebook e Instagram (Meta), Asaas e outros meios de pagamento, Secretarias da Fazenda (SEFAZ), Google e serviços de mapas, provedores de inteligência artificial, fabricantes de impressoras e provedores de internet. <strong>O FireHub não garante e não responde</strong> por indisponibilidade, lentidão, mudança de regras, de API ou de preço, bloqueio ou suspensão de conta, perda ou atraso de dados nesses serviços, nem por decisões que eles tomem sobre o Lojista.</Item>
        <Item n="6.2"><strong>WhatsApp:</strong> a conexão do número da loja ao atendimento automático <strong>não usa a API oficial paga da Meta</strong>. A Meta pode limitar, desconectar ou banir o número, principalmente em caso de envio em massa, mensagens não solicitadas ou denúncias. O Lojista assume esse risco, deve usar um número da própria loja e seguir as regras do WhatsApp. O FireHub não responde por número bloqueado ou banido nem por mensagem não entregue.</Item>
        <Item n="6.3"><strong>Marketplaces:</strong> pedidos, status, cancelamentos, repasses, multas, avaliações e regras de cada marketplace seguem o contrato do Lojista com ele. Pode haver atraso de sincronização; o Lojista deve acompanhar também o portal do marketplace.</Item>
        <Item n="6.4"><strong>Pagamentos:</strong> contestações (chargeback), estornos, fraudes, retenção ou bloqueio de saldo seguem o contrato do Lojista com o Asaas ou com o meio de pagamento usado.</Item>
      </Secao>

      <Secao n="7" titulo="Robô, inteligência artificial e automações">
        <Item n="7.1">Atendimento automático, sugestões, textos, descrições, fotos e anúncios gerados por inteligência artificial <strong>podem conter erros</strong>, omissões ou interpretações erradas (por exemplo, de item, endereço, taxa, troco ou horário).</Item>
        <Item n="7.2">O Lojista deve configurar e acompanhar o robô e <strong>conferir os pedidos gerados automaticamente</strong> antes de preparar e entregar. Pode assumir a conversa ou desligar o robô a qualquer momento.</Item>
        <Item n="7.3">O FireHub não responde por informação errada passada pelo robô, por pedido registrado de forma incorreta, por promessa feita ao cliente ou por prejuízo decorrente. A decisão final sobre cada pedido é do Lojista.</Item>
        <Item n="7.4">Em disparos de mensagens (recuperação de clientes, campanhas, avisos), o Lojista responde pelo conteúdo e por ter autorização para contatar seus clientes.</Item>
      </Secao>

      <Secao n="8" titulo="Responsabilidades do Lojista">
        <Item n="8.1"><strong>Tudo o que cadastra e configura:</strong> cardápio, preços, fotos, descrições, ingredientes e alergênicos, promoções, cupons, cashback, taxas e áreas de entrega, horários, formas de pagamento, impressoras e permissões. O Lojista confere antes de vender e sempre que alterar algo.</Item>
        <Item n="8.2">Fotos e textos: o Lojista declara ter direito de usá-los. Imagens geradas por IA são ilustrativas, e cabe ao Lojista garantir que representem o produto que ele entrega.</Item>
        <Item n="8.3">Operação: preparo, qualidade, higiene, embalagem, entrega, atendimento, trocas, reembolsos e o cumprimento do Código de Defesa do Consumidor perante os seus clientes.</Item>
        <Item n="8.4">Distâncias, rotas, tempos e taxas calculados com mapas são estimativas e devem ser conferidos pelo Lojista.</Item>
        <Item n="8.5"><strong>Obrigações fiscais:</strong> a emissão de nota fiscal é uma ferramenta. Os dados fiscais (regime tributário, NCM, CFOP, CST/CSOSN, alíquotas, certificado digital, CSC e numeração) e o cumprimento das obrigações fiscais são do Lojista e do contador dele. Nota rejeitada, emitida com erro ou não emitida, inclusive por falha do sistema ou da SEFAZ, deve ser acompanhada e regularizada pelo Lojista dentro dos prazos legais. <strong>Multas, autuações e tributos não são de responsabilidade do FireHub.</strong> A guarda dos arquivos XML pelo prazo legal é obrigação do contribuinte: o FireHub guarda uma cópia por conveniência, e o Lojista deve manter a sua (por exemplo, enviando-os todo mês ao contador).</Item>
        <Item n="8.6"><strong>Cópia das suas informações:</strong> o FireHub se esforça para preservar os dados, mas não garante a recuperação em caso de falha. O Lojista deve exportar e guardar periodicamente o que considera importante (relatórios, cadastro de clientes, notas fiscais e fotos).</Item>
        <Item n="8.7">Uso dentro da lei: é proibido usar o sistema para vender produtos ilícitos, enviar spam, fraudar, tratar dados pessoais sem base legal, ou tentar invadir ou sobrecarregar o sistema.</Item>
        <Item n="8.8">Equipamentos e conexão: computador, celular, impressora, internet, navegador atualizado e, para imprimir, o Assistente de impressão instalado e ligado.</Item>
        <Destaque>
          <Item n="8.9"><strong>Indenização:</strong> o Lojista mantém o FireHub livre de responsabilidade e o indeniza, inclusive com custas e honorários de advogado, por reclamações, processos ou autuações movidos por clientes, consumidores, funcionários, entregadores, autoridades ou terceiros em razão dos produtos, da operação, do conteúdo cadastrado, das obrigações fiscais e trabalhistas do Lojista ou do descumprimento destes Termos.</Item>
        </Destaque>
      </Secao>

      <Secao n="9" titulo="Limites da responsabilidade do FireHub">
        <Destaque>
          <Item n="9.1">Até onde a lei permite, <strong>o FireHub não responde por</strong>: (a) lucros cessantes, perda de vendas, de faturamento, de pedidos, de clientes ou de oportunidades; (b) danos indiretos ou danos à imagem e à reputação; (c) prejuízos causados por serviços de terceiros (item 6), por caso fortuito ou força maior (art. 393 do Código Civil), como falta de energia ou de internet, ataque hacker, falha de data center e atos de governo; (d) prejuízos causados por uso incorreto, por configuração do Lojista ou pela falta de plano de contingência; (e) multas aplicadas por marketplaces, órgãos fiscais, Procon ou outras autoridades; (f) produtos, entregas e a relação do Lojista com seus clientes.</Item>
          <Item n="9.2">Em qualquer caso, a <strong>responsabilidade total do FireHub</strong>, somadas todas as reclamações ligadas a estes Termos, <strong>fica limitada ao valor que o Lojista efetivamente pagou ao FireHub nos 3 (três) meses anteriores</strong> ao fato que deu origem à reclamação.</Item>
          <Item n="9.3">Estes limites não se aplicam a dolo do FireHub nem aos demais casos em que a lei proíba limitar a responsabilidade.</Item>
          <Item n="9.4">O Lojista reconhece que o preço do FireHub (percentual pequeno e com teto) só é possível com esta divisão de riscos.</Item>
        </Destaque>
        <Item n="9.5">Ao perceber uma falha, o Lojista deve avisar o suporte o quanto antes, para que ela seja corrigida e o prejuízo não aumente.</Item>
      </Secao>

      <Secao n="10" titulo="Dados pessoais">
        <Item n="10.1">A <a href="/privacidade" target="_blank" rel="noopener noreferrer" style={{ color: "#C92E09", fontWeight: 700 }}>Política de Privacidade</a> faz parte destes Termos.</Item>
        <Item n="10.2">Sobre os dados dos clientes da loja, o Lojista é o <strong>controlador</strong> e o FireHub é o <strong>operador</strong> (Lei 13.709/2018, LGPD). O FireHub trata esses dados para prestar o serviço, conforme as configurações do Lojista.</Item>
        <Item n="10.3">O Lojista garante ter base legal para coletar e usar os dados dos seus clientes e para se comunicar com eles.</Item>
        <Item n="10.4">O FireHub adota medidas de segurança razoáveis, mas nenhum sistema é totalmente imune a incidentes. Incidentes relevantes serão comunicados como a lei determina.</Item>
        <Item n="10.5">O FireHub pode usar dados agregados e anonimizados para melhorar o serviço e produzir estatísticas.</Item>
      </Secao>

      <Secao n="11" titulo="Cancelamento, suspensão e encerramento">
        <Item n="11.1">O Lojista pode cancelar a qualquer momento pelo suporte, <strong>sem fidelidade e sem multa</strong>. O uso do mês em curso é cobrado normalmente, pelas regras do item 4, até a data do cancelamento.</Item>
        <Item n="11.2">O FireHub pode suspender ou encerrar a conta por falta de pagamento (item 4.7), descumprimento destes Termos, uso ilícito, risco à segurança do sistema ou ordem judicial; ou, sem motivo, com aviso de 30 dias.</Item>
        <Item n="11.3">Encerrada a conta, o Lojista tem 30 dias para pedir uma cópia dos seus dados. Depois disso, os dados podem ser excluídos, salvo os que a lei obriga guardar. Valores em aberto continuam devidos.</Item>
      </Secao>

      <Secao n="12" titulo="Alterações destes Termos">
        <Item n="12.1">O FireHub pode atualizar estes Termos. A versão em vigor fica em firehubfood.com.br/termos, com a data no topo, e é apresentada no painel para aceite. Quem não concordar pode cancelar sem multa. Continuar usando o sistema depois do aceite, ou depois de 15 dias do aviso, significa concordar com a nova versão.</Item>
      </Secao>

      <Secao n="13" titulo="Aceite eletrônico e comunicações">
        <Item n="13.1">O aceite por clique tem a mesma validade de uma assinatura (Medida Provisória 2.200-2/2001, art. 10, § 2º, e art. 107 do Código Civil). O FireHub registra a data, a hora, o endereço IP, o navegador e a versão dos Termos aceita.</Item>
        <Item n="13.2">São válidas as comunicações feitas pelo painel, pelo e-mail ou pelo WhatsApp cadastrados.</Item>
      </Secao>

      <Secao n="14" titulo="Disposições gerais">
        <Item n="14.1">Deixar de exigir um direito não significa renunciar a ele nem alterar estes Termos.</Item>
        <Item n="14.2">Se alguma cláusula for considerada inválida, as demais continuam valendo.</Item>
        <Item n="14.3">O FireHub pode transferir este contrato em caso de reorganização societária, venda ou incorporação.</Item>
        <Item n="14.4">Fica eleito o foro da <strong>Comarca de Rio das Ostras/RJ</strong> para resolver qualquer questão sobre estes Termos, com renúncia a qualquer outro.</Item>
      </Secao>

      <p style={{ ...p, marginTop: "1.5rem", color: "#64748B" }}>
        Contato: WhatsApp <a href="https://wa.me/5522981118514" target="_blank" rel="noopener noreferrer" style={{ color: "#C92E09", fontWeight: 700 }}>(22) 98111-8514</a> ·
        e-mail <a href="mailto:contatohakim@gmail.com" style={{ color: "#C92E09", fontWeight: 700 }}>contatohakim@gmail.com</a>
      </p>
    </div>
  );
}
