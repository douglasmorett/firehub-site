#!/usr/bin/env node

/**
 * Cron Runner — substitui os Vercel Cron Jobs na DigitalOcean/Docker.
 * Roda como processo de background chamando endpoints HTTP locais.
 * Consome ~5MB RAM e zero CPU quando idle.
 */

const http = require('http');

// ── 127.0.0.1, NÃO "localhost" (endurecimento, não o bug de 18/09) ────
//
// O Next escuta em 0.0.0.0, que é só IPv4. "localhost" no Node 18+ pode
// resolver para ::1 (IPv6) primeiro — o Node parou de reordenar o resultado do
// DNS — e a conexão morreria com ECONNREFUSED antes de tocar no servidor.
// Endereço numérico não passa por DNS e não tem como escolher a família errada.
// `verifyCronAuth` (src/lib/cron-auth.ts) aceita 127.0.0.1 como chamada
// interna, igual a localhost.
//
// NÃO foi isto que quebrou a internalização de imagens em 18/09 — os outros 16
// jobs rodavam normalmente, e dá para provar: `recuperacao-clientes` carimbou
// `chatbotConfig.ultimaRecuperacaoEm` no mesmo dia. O que derrubava aquele job
// era o ENDEREÇO dele, em /api/admin/* (ver o comentário no job, e src/proxy.ts).
// Esta troca fica porque o silêncio era real e não custa nada.
//
// E se o ambiente já trouxer CRON_BASE_URL com "localhost", trocamos aqui:
// senão a mudança valeria só para quem NÃO tem a variável.
const BASE_URL = (process.env.CRON_BASE_URL || 'http://127.0.0.1:3000')
  .replace('//localhost', '//127.0.0.1');
const CRON_SECRET = process.env.CRON_SECRET || '';

// ── Definição dos cron jobs ──────────────────────────────────────────
const jobs = [
  {
    name: 'ifood-poll',
    path: '/api/cron/ifood-poll',
    intervalMs: 60_000, // 1 minuto
  },
  {
    name: 'jotaja-poll',
    path: '/api/cron/jotaja-poll',
    intervalMs: 60_000, // 1 minuto
  },
  {
    // Brendi fala o mesmo Open Delivery do JotaJá, e o polling é a via
    // PRIMÁRIA (o webhook é só acelerador de latência): é este ciclo de 60s
    // que garante o pedido mesmo com o push mudo. Enquanto nenhuma loja tiver
    // brendiConnected=true a rota responde vazio — custo zero.
    name: 'brendi-poll',
    path: '/api/cron/brendi-poll',
    intervalMs: 60_000, // 1 minuto
  },
  {
    // Foody Delivery / Voe Delivery (motoboy terceirizado): status, motoboy e
    // link de rastreio das entregas em curso (POST /orders/checkupdates). A
    // Foody pede no maximo a cada 30 s. Sem entrega em curso a rota responde
    // vazio com uma consulta so (src/lib/foody-no-banco.ts).
    name: 'foody-acompanhamento',
    path: '/api/cron/foody-acompanhamento',
    intervalMs: 60_000, // 1 minuto
  },
  {
    // Wabiz (app com a marca do restaurante) só tem polling: sem webhook, o
    // pedido espera em orders/pending. A doc deles pede consulta a cada 30s.
    // Sem loja com wabizConnected=true a rota responde vazio — custo zero.
    name: 'wabiz-poll',
    path: '/api/cron/wabiz-poll',
    intervalMs: 30_000, // 30 segundos
  },
  {
    // Keeta (Open Delivery dela): rede de segurança do webhook e a fila das
    // chamadas à Keeta que falharam. A Keeta permite 2 pollings por minuto por
    // token — 30 s é o teto, não mexer para baixo. Sem KEETA_CLIENT_ID/SECRET
    // no servidor a rota responde na hora sem tocar no banco — custo zero.
    name: 'keeta-poll',
    path: '/api/cron/keeta-poll',
    intervalMs: 30_000, // 30 segundos
  },
  {
    // Open Delivery de SAÍDA (logística Bem Dito): varre os pedidos de entrega
    // das lojas ligadas, gera os eventos (CREATED, DISPATCHED, CANCELLED...) e
    // manda o webhook com as retentativas. Sem loja ligada é uma leitura numa
    // tabela vazia — custo zero.
    name: 'open-delivery-saida',
    path: '/api/cron/open-delivery-saida',
    intervalMs: 20_000, // 20 segundos
    // Volta que ainda está no ar (parceiro lento) não ganha outra por cima: o
    // mesmo webhook não sai duas vezes.
    exclusivo: true,
  },
  {
    // Rota 100% automatizada: nas lojas que ligaram o interruptor (e estão na
    // liberação), junta os pedidos de entrega que vão juntos, cria a rota e
    // pede prioridade no KDS (src/lib/roteirizacao-automatica/executar.ts). A
    // cada 20 s porque o pedido novo tem de entrar na rota antes de a cozinha
    // começar. Sem loja ligada é uma consulta e volta — custo zero.
    name: 'roteirizacao-automatica',
    path: '/api/cron/roteirizacao-automatica',
    intervalMs: 20_000, // 20 segundos
    // Ciclo ainda no ar não ganha outro por cima; a vez por loja no banco
    // (roteirizacao:<loja>) segura o resto (o "rodar agora", dois servidores).
    exclusivo: true,
  },
  {
    // CardápioWeb: a rede PRINCIPAL dos pedidos dele, não um enfeite — o
    // webhook do CardápioWeb pausa depois de 15 falhas e só volta por e-mail.
    // Lista o que mudou desde o último ciclo, reprocessa aviso parado e repete
    // as ações pendentes. 30 s é o que a doc deles recomenda. Ciclo ainda no ar
    // não ganha outro por cima (o mesmo pedido buscado duas vezes gasta o
    // limite de 300 chamadas a cada 3 min da loja). Sem CARDAPIOWEB_* no
    // servidor a rota responde na hora sem tocar no banco — custo zero.
    name: 'cardapioweb-poll',
    path: '/api/cron/cardapioweb-poll',
    intervalMs: 30_000, // 30 segundos
    exclusivo: true,
  },
  {
    // Anota AI: o caminho INTEIRO dos pedidos dele (a doc recomenda ler a
    // lista a cada ~30 s; o webhook não tem formato documentado). O Anota AI
    // NEGA o pedido que fica 15 min sem aceite — o ciclo é o que aceita a
    // tempo na loja que aceita sozinha. Sem ANOTAAI_* no servidor a rota
    // responde na hora sem tocar no banco.
    name: 'anotaai-poll',
    path: '/api/cron/anotaai-poll',
    intervalMs: 30_000, // 30 segundos
    exclusivo: true,
  },
  {
    // Mantem a loja ABERTA no 99Food sem ninguem abrir o gestor deles.
    //
    // O lojista fechava o app do 99Food e a loja ficava offline la. O swagger
    // deles diz que, uma vez offline, ela so volta por esta API ou abrindo o
    // app na mao. Era esta a reclamacao de "so entra pedido se eu deixar o 99
    // aberto": nunca foi o app que trazia pedido (isso e o webhook, servidor a
    // servidor), era o app que segurava a loja online.
    //
    // De 5 em 5 minutos porque tambem e o que mantem o auth_token vivo: a
    // renovacao do 99Food so acontecia no uso, entao loja parada mais de um dia
    // perto do vencimento perdia o token, e sem token o webhook descarta pedido
    // novo em silencio.
    name: '99food-abertura',
    path: '/api/cron/99food-abertura',
    intervalMs: 5 * 60_000, // 5 minutos
  },
  {
    // NFC-e que não saiu de primeira: consulta as notas "processando" e as de
    // contingência off-line (no ambiente em que cada uma saiu), reemite as que
    // falharam por comunicação (espera dobrando, teto de 5, só no mesmo
    // ambiente e depois de `emissaoLigadaEm`) e varre os pedidos e as contas
    // de mesa que chegaram à hora da nota por um caminho sem gancho. A 2
    // minutos porque é a rede de segurança da nota que tem de estar autorizada
    // antes de a entrega chegar ao cliente. Sem loja com a emissão ligada, a
    // rota faz uma leitura e volta — custo zero. Sem esta linha nada disso
    // rodava em produção (lib/fiscal-automatico → retentarNotasFiscais).
    name: 'fiscal-retentativa',
    path: '/api/cron/fiscal-retentativa',
    intervalMs: 2 * 60_000, // 2 minutos
    // Rodada que ainda está no ar (SEFAZ esperando o timeout) não ganha
    // outra por cima: a de agora é pulada. A proteção de verdade — que vale
    // também quando esta chamada desiste aos 55 s e a rota continua rodando —
    // é a concessão por loja (lib/fiscal-automatico → sqlPegarConcessaoDaRodada).
    exclusivo: true,
  },
  {
    name: 'gateway-keepalive',
    path: '/api/cron/gateway-keepalive',
    intervalMs: 5 * 60_000, // 5 minutos
  },
  {
    name: 'health-check',
    path: '/api/cron/health-check',
    intervalMs: 5 * 60_000, // 5 minutos — monitora saúde + alerta WhatsApp
    // Em TODA instância, líder ou não: mede o próprio processo (memória,
    // banco visto daqui). Os avisos que valem para o cluster inteiro saem uma
    // vez só pela vez do alerta (src/lib/server-monitor.ts).
    todasAsInstancias: true,
  },
  {
    // Fotos de cardápio importado (MenuDino etc.) baixadas para o volume da
    // loja, com a URL trocada no cadastro. Idempotente: sem foto apontando
    // para fora, é uma consulta e nada mais. Cardápio importado não pode
    // depender da plataforma de onde veio.
    name: 'internalizar-imagens',
    // ⚠️ /api/cron/, NÃO /api/admin/. O proxy (src/proxy.ts) exige sessão
    // NextAuth em todo /api/admin/*, e o cron chega com Bearer e sem cookie:
    // levava 401 ANTES da rota. Ficou nove dias assim, sem erro em lugar
    // nenhum, com 439 fotos de cardápio importado servidas pelo concorrente.
    path: '/api/cron/internalizar-imagens',
    intervalMs: 6 * 60 * 60_000, // 6 horas
  },
  {
    // Ensina ao gateway o LID de cada cliente. Sem isso, a PRIMEIRA resposta a
    // quem chega pelo endereço novo do WhatsApp (@lid) não decifra no aparelho.
    // De hora em hora porque o mapa do gateway vive em memória e zera no
    // reinício dele.
    name: 'whatsapp-aprender-contatos',
    path: '/api/cron/whatsapp-aprender-contatos',
    intervalMs: 60 * 60_000, // 1 hora
  },
  {
    // De hora em hora só para pegar cedo o insumo que acabou de cair no mínimo.
    // Quem segura a repetição é a própria rota: um aviso por insumo a cada 24h
    // e nada fora do horário comercial da loja.
    name: 'estoque-alerta',
    path: '/api/cron/estoque-alerta',
    intervalMs: 60 * 60_000, // 1 hora
  },
  {
    // O painel do cliente não pode mostrar um valor e o boleto cobrar outro.
    // De hora em hora porque a cobrança pode ser refeita (com o preço novo do
    // catálogo) depois que o cliente já fechou a tela do pedido.
    name: 'conciliar-cobrancas',
    path: '/api/cron/conciliar-cobrancas',
    intervalMs: 60 * 60_000, // 1 hora
  },
  {
    // Abre e fecha a loja no horario (quem ligou em Minha Loja -> Horarios) e
    // avisa o dono no WhatsApp: loja fechada no horario, caixa nao aberto,
    // iFood fechado. A cada minuto porque a abertura tem hora marcada; a rota
    // segura a repeticao (um aviso por turno) e consulta o iFood a cada 5 min.
    name: 'abertura-da-loja',
    path: '/api/cron/abertura-da-loja',
    intervalMs: 60_000, // 1 minuto
  },
  {
    // Loja sem conexao: a internet da loja caiu no horario (Assistente mudo e
    // nenhum painel aberto) -> pausa iFood, site e robo e avisa o dono; quando
    // volta, desfaz o que fez e avisa de novo (src/lib/loja-sem-conexao.ts).
    // A cada minuto porque a queda e medida em minutos. Rodada que ainda fala
    // com o iFood nao ganha outra por cima.
    name: 'loja-sem-conexao',
    path: '/api/cron/loja-sem-conexao',
    intervalMs: 60_000, // 1 minuto
    exclusivo: true,
  },
  {
    // Pix pelo site (conta Asaas da loja): expira o Pix nao pago em 30 min,
    // confirma o que o webhook perdeu, estorna Pix pago depois do cancelamento
    // e usa a chave de cada loja uma vez por dia (o Asaas desativa chave parada).
    // A cada 2 minutos para o prazo de 30 min nao virar 35.
    name: 'pix-online',
    path: '/api/cron/pix-online',
    intervalMs: 2 * 60_000, // 2 minutos
  },
  {
    // Disparo oficial (API da Meta): manda a fila das campanhas (~45 s por
    // rodada), devolve o credito do que expirou e confere as recargas por Pix
    // que o webhook do Asaas nao avisou (lib/disparo-oficial/servidor.ts).
    name: 'disparo-oficial',
    path: '/api/cron/disparo-oficial',
    intervalMs: 60_000, // 1 minuto
  },
  {
    // Meu aplicativo (app proprio da loja): solta as notificacoes agendadas,
    // confere no Expo se o Google/Apple entregou as de 15 min atras e tira da
    // base o aparelho de onde o app saiu (src/lib/app-da-loja/notificacoes.ts).
    name: 'app-da-loja-notificacoes',
    path: '/api/cron/app-da-loja-notificacoes',
    intervalMs: 60_000, // 1 minuto
  },
  {
    // A cada 5 minutos porque atraso pede reacao rapida — e quem segura a
    // repeticao e a propria rota: um aviso por PEDIDO a cada hora.
    name: 'pedidos-atrasados',
    path: '/api/cron/pedidos-atrasados',
    intervalMs: 5 * 60_000, // 5 minutos
  },
  {
    // Impressao parada: Assistente mudo com pedido entrando, ou comanda presa
    // na impressora. A cada 5 minutos; a rota segura a repeticao (um aviso por
    // parada, e no maximo um por hora para comanda presa).
    name: 'impressao-parada',
    path: '/api/cron/impressao-parada',
    intervalMs: 5 * 60_000, // 5 minutos
  },
  {
    // CRM do FireHub: religa o numero do atendimento se o gateway derrubou,
    // lembra o contato 1 h antes da demonstracao e manda ao vendedor o aviso
    // de agenda que nao saiu na hora (src/lib/crm/lembretes.ts).
    name: 'crm-lembretes',
    path: '/api/cron/crm-lembretes',
    intervalMs: 5 * 60_000, // 5 minutos
  },
  {
    // Distancia da entrega nos pedidos que nasceram sem ela — e o numero que a
    // escada de km do entregador compara no fechamento. Quem chegou com
    // coordenada e conta local; quem so tem o texto do endereco e
    // geocodificado devagar, poucos por ciclo, respeitando o limite do
    // Nominatim. A cada 10 minutos ja chega muito antes do acerto da semana.
    name: 'distancia-pendente',
    path: '/api/cron/distancia-pendente',
    intervalMs: 10 * 60_000, // 10 minutos
  },
  {
    // Stone pela nuvem (Connect 2.0): pedido aberto não expira e a POS trava
    // com 30 abertos. Confere as cobranças Stone vivas (baixa o que o webhook
    // perdeu) e derruba as abandonadas. Sem cobrança viva, não chama a Stone.
    name: 'stone-connect-faxina',
    path: '/api/cron/stone-connect-faxina',
    intervalMs: 5 * 60_000, // 5 minutos
  },
  {
    // Os caches do mapa (endereços e rotas) sem uso há 90 dias saem do banco:
    // eles ganham uma linha por endereço novo e cresceriam com o uso para
    // sempre (src/lib/faxina-dos-caches.ts).
    name: 'faxina-dos-caches',
    path: '/api/cron/faxina-dos-caches',
    intervalMs: 24 * 60 * 60_000, // 1 dia
  },
  {
    name: 'billing-close',
    path: '/api/cron/billing-close',
    intervalMs: 60 * 60_000, // 1 hora (verifica internamente se é dia 1 às 03h)
  },
  {
    // Boleto da mensalidade pago no Asaas vira ciclo PAID (o webhook faz na
    // hora; isto confere o que o webhook perdeu). Sem isso a loja que pagou
    // tinha o painel travado depois do prazo (src/lib/pagamento-da-mensalidade.ts).
    name: 'mensalidades-pagas',
    path: '/api/cron/mensalidades-pagas',
    intervalMs: 30 * 60_000, // 30 minutos
  },
  {
    name: 'meta-ads-sync',
    path: '/api/cron/meta-ads-sync',
    intervalMs: 6 * 60 * 60_000, // 6 horas
  },
  {
    // Traz de volta quem sumiu (7, 15 e 30 dias sem pedir).
    //
    // A tela do lojista prometia esse disparo "automaticamente" desde sempre,
    // com os interruptores ligados — e não existia job nenhum para executá-lo:
    // ninguém nunca recebeu. De hora em hora aqui só para pegar o começo do
    // horário comercial; a própria rota garante UM disparo por loja por dia e
    // não envia nada fora das 10h–20h.
    name: 'recuperacao-clientes',
    path: '/api/cron/recuperacao-clientes',
    intervalMs: 60 * 60_000, // 1 hora
  },
];

/** Falhas de conexão seguidas por job — só para não silenciar o que importa. */
const falhasSeguidas = {};
/** Job `exclusivo` com chamada ainda aberta: a próxima rodada é pulada. */
const emAndamento = {};

// ── UM cron-runner dispara por vez no cluster ────────────────────────
//
// Cada container sobe o seu cron-runner (scripts/entrypoint.sh). No deploy o
// velho e o novo ficam vivos juntos, e com dois servidores atrás do
// balanceador, o tempo todo: sem isto TODO job rodava em dobro — a Keeta
// acima do limite de 2 consultas por minuto, o aviso do lojista repetido.
//
// Antes de disparar, o runner pergunta ao PRÓPRIO servidor se é o líder
// (/api/cron/lideranca, que pega ou renova a vez "cron:lider" por 90 s no
// banco). A resposta vale ~30 s; quem não é líder não dispara nada e marca o
// job como pendente — se virar líder (o outro caiu ou foi desligado), roda os
// pendentes logo, como o container novo sempre fez no boot.
//
// Se a pergunta falhar (banco fora, servidor ocupado): segue líder só
// enquanto a vez que já tinha ainda vale — ninguém pode pegá-la antes de
// vencer, então não há risco de dois —, e depois para. Os jobs dependem do
// banco de qualquer jeito; o health-check (que roda em todas as instâncias)
// é quem avisa que o banco caiu.
const LIDERANCA_PATH = '/api/cron/lideranca';
const PERGUNTAR_A_CADA_MS = 30_000;
/** Para de se achar líder um pouco antes de a vez vencer no banco. */
const MARGEM_DA_VEZ_MS = 15_000;
/** A instância que não é a preferida espera esta folga antes da 1ª pergunta. */
const FOLGA_DA_NAO_PREFERIDA_MS = 20_000;
const PREFERIDO = process.env.CRON_PREFERIDO === '1';

const lideranca = {
  /** Até quando (relógio local) este runner pode disparar. */
  ate: 0,
  perguntadaEm: 0,
  emCurso: null,
  /** Último estado anunciado no log (null = ainda nenhum). */
  era: null,
  falhas: 0,
};

/** GET local que devolve o JSON (ou null em erro de rede/HTTP). */
function pedirJson(path, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    const url = new URL(path, BASE_URL);
    const req = http.request(
      {
        hostname: url.hostname,
        port: url.port || 3000,
        path: url.pathname,
        method: 'GET',
        family: 4,
        timeout: timeoutMs,
        headers: CRON_SECRET ? { Authorization: `Bearer ${CRON_SECRET}` } : {},
      },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(body); } catch {}
          resolve({ status: res.statusCode, json });
        });
      },
    );
    req.on('error', (err) => resolve({ status: 0, json: null, erro: err.message }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, json: null, erro: 'timeout' }); });
    req.end();
  });
}

async function perguntarLideranca() {
  const inicio = Date.now();
  const r = await pedirJson(LIDERANCA_PATH);
  lideranca.perguntadaEm = Date.now();
  if (r.status === 200 && r.json && typeof r.json.lider === 'boolean') {
    lideranca.falhas = 0;
    const validade = Number(r.json.validadeMs) || 90_000;
    lideranca.ate = r.json.lider ? inicio + validade - MARGEM_DA_VEZ_MS : 0;
    return;
  }
  // Falhou: `ate` fica como estava (a vez que já é nossa continua valendo).
  lideranca.falhas++;
  if (lideranca.falhas === 1 || lideranca.falhas % 10 === 0) {
    const motivo =
      r.status === 401
        ? `HTTP 401 — a liderança só responde a chamada local com o CRON_SECRET certo (CRON_BASE_URL tem de ser http://127.0.0.1:<porta>; está ${BASE_URL}; CRON_SECRET ${CRON_SECRET ? "definido" : "NÃO definido"})`
        : r.erro || (r.json && r.json.erro) || `HTTP ${r.status}`;
    const resta = Math.max(0, lideranca.ate - Date.now());
    console.warn(
      `[cron-runner] ⚠️ liderança: não consegui perguntar (${motivo}; ${lideranca.falhas}ª falha seguida) — ` +
        (resta > 0 ? `sigo líder pela vez que já tenho, por mais ${Math.round(resta / 1000)} s.` : 'não disparo nada até responder.'),
    );
  }
}

/** Este runner pode disparar agora? Pergunta ao servidor no máximo a cada ~30 s. */
async function souLider() {
  if (Date.now() - lideranca.perguntadaEm >= PERGUNTAR_A_CADA_MS) {
    if (!lideranca.emCurso) {
      lideranca.emCurso = perguntarLideranca().finally(() => { lideranca.emCurso = null; });
    }
    await lideranca.emCurso;
  }
  const agora = Date.now() < lideranca.ate;
  if (agora !== lideranca.era) {
    lideranca.era = agora;
    console.log(
      agora
        ? `[cron-runner] 👑 este container é o LÍDER do cron — dispara os jobs${PREFERIDO ? ' (preferido)' : ''}.`
        : lideranca.falhas > 0
          ? `[cron-runner] 💤 sem resposta da liderança e a vez venceu — este container não dispara até responder (só o health-check).`
          : `[cron-runner] 💤 outro container é o líder do cron — este não dispara (só o health-check).`,
    );
    if (agora) dispararPendentes();
  }
  return agora;
}

/** Os jobs que deixaram de rodar enquanto este runner não era o líder. */
function dispararPendentes() {
  for (const job of jobs) {
    if (!job.pendente) continue;
    job.pendente = false;
    setTimeout(() => { tick(job); }, Math.random() * 10_000);
  }
}

/** Uma rodada do job: só no líder (exceto os de todas as instâncias). */
async function tick(job) {
  if (!job.todasAsInstancias && !(await souLider())) {
    job.pendente = true;
    return;
  }
  job.pendente = false;
  return callEndpoint(job);
}

// ── Função para chamar um endpoint ───────────────────────────────────
function callEndpoint(job) {
  if (job.exclusivo) {
    if (emAndamento[job.name]) {
      console.warn(`[cron-runner] ⏭️ ${job.name}: a rodada anterior ainda está no ar — esta fica para a próxima.`);
      return Promise.resolve();
    }
    emAndamento[job.name] = true;
    return chamar(job).finally(() => { emAndamento[job.name] = false; });
  }
  return chamar(job);
}

function chamar(job) {
  return new Promise((resolve) => {
    const url = new URL(job.path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: url.pathname,
      method: 'GET',
      // Cinto e suspensório do 127.0.0.1 acima: se alguém apontar CRON_BASE_URL
      // para um nome, ainda assim resolvemos em IPv4, que é onde o Next escuta.
      family: 4,
      timeout: 55_000, // 55s timeout
      headers: {},
    };

    if (CRON_SECRET) {
      options.headers['Authorization'] = `Bearer ${CRON_SECRET}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        const status = res.statusCode;
        if (status >= 200 && status < 300) {
          falhasSeguidas[job.name] = 0;
          // Log sucinto de sucesso para confirmar que o cron está rodando
          const ts = new Date().toISOString().slice(11, 19);
          console.log(`[cron-runner] ✅ ${ts} ${job.name} ok (${status}) ${body.slice(0, 120)}`);
        } else if (status === 401) {
          console.error(`[cron-runner] 🔒 ${job.name} REJEITADO com 401 — CRON_SECRET ${CRON_SECRET ? 'está definido mas pode estar errado' : 'NÃO ESTÁ DEFINIDO (chamadas locais devem funcionar)'}`);
        } else {
          console.warn(`[cron-runner] ⚠️ ${job.name} retornou ${status}: ${body.slice(0, 200)}`);
        }
        resolve();
      });
    });

    req.on('error', (err) => {
      // ── ERRO DE CONEXÃO NÃO PODE SER INVISÍVEL ────────────────────────
      //
      // ECONNREFUSED era engolido em silêncio porque "o servidor pode não estar
      // pronto ainda". É verdade nos primeiros segundos — e mentira do segundo
      // minuto em diante. Foi assim que 17 jobs ficaram fora do ar sem uma
      // linha de log: o cron-runner dizia "agendado a cada 600s" no boot e
      // depois nunca mais falava.
      //
      // Agora a primeira falha sai sempre, e as seguintes de dez em dez, para
      // não virar enxurrada num servidor que esteja mesmo subindo.
      falhasSeguidas[job.name] = (falhasSeguidas[job.name] || 0) + 1;
      const n = falhasSeguidas[job.name];
      if (err.code !== 'ECONNREFUSED' || n === 1 || n % 10 === 0) {
        console.warn(`[cron-runner] ❌ ${job.name} erro: ${err.message} (${n}ª falha seguida em ${BASE_URL})`);
      }
      resolve();
    });

    req.on('timeout', () => {
      console.warn(`[cron-runner] ⏱️ ${job.name} timeout`);
      req.destroy();
      resolve();
    });

    req.end();
  });
}

// ── Aguardar servidor Next.js ficar pronto ───────────────────────────
function waitForServer(maxWaitMs = 120_000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const req = http.request(
        // Sonda de prontidao: /api/health. Antes usava /api/debug/env, que
        // vazava dados das lojas e agora responde 404 em producao.
        // 127.0.0.1 pelo mesmo motivo do BASE_URL: "localhost" pode ir para ::1
        // e esta sonda nunca enxergaria um servidor que está de pé em IPv4.
        // A porta é a do BASE_URL (3000 no container; outra no teste com dois
        // servidores na mesma máquina).
        { hostname: '127.0.0.1', family: 4, port: new URL(BASE_URL).port || 3000, path: '/api/health', method: 'GET', timeout: 3000 },
        (res) => {
          res.resume();
          console.log('[cron-runner] ✅ Servidor Next.js pronto!');
          resolve();
        }
      );
      req.on('error', () => {
        if (Date.now() - start > maxWaitMs) {
          console.warn('[cron-runner] ⚠️ Timeout esperando servidor, iniciando mesmo assim...');
          resolve();
        } else {
          setTimeout(check, 2000);
        }
      });
      req.on('timeout', () => {
        req.destroy();
        setTimeout(check, 2000);
      });
      req.end();
    };
    check();
  });
}

// ── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log('[cron-runner] 🚀 Iniciando cron-runner com', jobs.length, 'jobs...');
  console.log(`[cron-runner] 🔑 CRON_SECRET: ${CRON_SECRET ? 'definido (' + CRON_SECRET.length + ' chars)' : 'NÃO DEFINIDO — chamadas locais usam bypass'}`);
  console.log(`[cron-runner] 🌐 BASE_URL: ${BASE_URL}`);
  
  await waitForServer();

  // A liderança é renovada no seu próprio ritmo, não só quando um job bate:
  // a vez no banco não pode vencer num intervalo sem job.
  if (!PREFERIDO) {
    // A não preferida dá a folga antes da 1ª pergunta: subindo as duas juntas,
    // a preferida pega a vez primeiro.
    lideranca.perguntadaEm = Date.now() - PERGUNTAR_A_CADA_MS + FOLGA_DA_NAO_PREFERIDA_MS;
  }
  setInterval(() => { souLider().catch(() => {}); }, 5_000);

  // Agendar cada job com seu intervalo
  for (const job of jobs) {
    // Primeira execução com delay escalonado (evita thundering herd)
    const initialDelay = Math.random() * 10_000;

    setTimeout(() => {
      // Executar imediatamente (se este runner for o líder; senão fica pendente)
      tick(job);

      // Agendar repetição
      setInterval(() => {
        tick(job);
      }, job.intervalMs);
    }, initialDelay);

    console.log(`[cron-runner] ⏰ ${job.name} agendado a cada ${job.intervalMs / 1000}s${job.todasAsInstancias ? ' (em todas as instâncias)' : ''}`);
  }
}

// Exportado para scripts/teste-cron-runner.ts; no container roda o main.
module.exports = { jobs, lideranca, souLider, tick, dispararPendentes, PERGUNTAR_A_CADA_MS, MARGEM_DA_VEZ_MS };

if (require.main === module) main().catch(console.error);
