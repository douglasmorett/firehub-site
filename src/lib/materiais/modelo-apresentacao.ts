/**
 * O modelo aprovado da apresentação digital (9 páginas A4 em pé), tal como saiu do
 * desenho (HTML puro). As imagens moram em public/materiais/img/.
 * Os pontos que lib/materiais/personalizar.ts troca: `__QR__`, a linha em branco do
 * "Indicado por:" e o WhatsApp do bloco de contato. Mexeu no texto? Mantenha esses três.
 */
export const MODELO_DA_APRESENTACAO = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>FireHub - Conheça o sistema</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
@page { size: 210mm 297mm; margin: 0; }
:root {
  --tinta: #1C1917; --cinza: #57534E; --claro: #78716C; --linha: #E7E5E4;
  --fogo: #FF5A1F; --verm: #E11D2E; --creme: #FFF7F2; --escuro: #140C09;
  --grad: linear-gradient(135deg, #FF7A1A 0%, #FF4D2E 45%, #E11D2E 100%);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { background: #fff; }
body { font-family: 'Inter', sans-serif; color: var(--tinta); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.pg { width: 210mm; height: 297mm; position: relative; overflow: hidden; page-break-after: always; break-after: page; padding: 16mm 15mm 14mm; }
.pg:last-child { page-break-after: auto; break-after: auto; }

/* rodapé de cada página */
.rodape { position: absolute; left: 15mm; right: 15mm; bottom: 8mm; display: flex; justify-content: space-between; align-items: center; font-size: 7.5pt; color: var(--claro); border-top: 1px solid var(--linha); padding-top: 3mm; }
.rodape b { color: var(--tinta); }
.rodape .marca { display: flex; align-items: center; gap: 2mm; font-weight: 800; color: var(--tinta); }
.rodape img { width: 4.2mm; }

/* cabeçalho de seção */
.sobre { display: inline-flex; align-items: center; gap: 2mm; font-size: 8pt; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--fogo); }
.sobre i { display: inline-block; width: 7mm; height: 1.2mm; border-radius: 1mm; background: var(--grad); }
h2 { font-size: 25pt; line-height: 1.05; font-weight: 900; letter-spacing: -.02em; margin: 3mm 0 2.5mm; }
h2 em { font-style: normal; color: #F0461F; }
.lead { font-size: 10.5pt; line-height: 1.5; color: var(--cinza); max-width: 160mm; }

/* blocos de solução */
.sol { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; align-items: center; margin-top: 6mm; }
.sol.inv .txt { order: 2; }
.sol h3 { font-size: 14pt; font-weight: 850; font-weight: 800; letter-spacing: -.01em; margin-bottom: 1.8mm; display: flex; align-items: center; gap: 2.5mm; }
.ico { width: 8mm; height: 8mm; border-radius: 2.4mm; background: var(--grad); color: #fff; display: inline-grid; place-items: center; font-size: 10.5pt; flex: none; }
.sol p { font-size: 9.6pt; line-height: 1.5; color: var(--cinza); }
.sol ul { list-style: none; margin-top: 2.2mm; }
.sol li { font-size: 9.2pt; line-height: 1.45; color: var(--tinta); padding-left: 5mm; position: relative; margin: 1.1mm 0; }
.sol li::before { content: ""; position: absolute; left: 0; top: 1.6mm; width: 2.2mm; height: 2.2mm; border-radius: 50%; background: var(--fogo); }
.shot { border-radius: 3mm; overflow: hidden; border: 1px solid #E7E5E4; box-shadow: 0 3mm 8mm -3mm rgba(28,25,23,.28); background: #fff; }
.shot img { display: block; width: 100%; }
.shot.alto { max-width: 50mm; margin: 0 auto; }

/* lista compacta de recursos */
.grade { display: grid; grid-template-columns: 1fr 1fr; gap: 3mm; margin-top: 5mm; }
.card { border: 1px solid var(--linha); border-radius: 3mm; padding: 3.4mm 4mm; background: #fff; }
.card h4 { font-size: 10.5pt; font-weight: 800; margin-bottom: 1.2mm; display: flex; align-items: center; gap: 2mm; }
.card h4 span { font-size: 11pt; }
.card p { font-size: 8.8pt; line-height: 1.45; color: var(--cinza); }
.preco-tag { display: inline-block; margin-top: 1.6mm; font-size: 7.6pt; font-weight: 800; color: var(--verm); background: #FFF1EC; border-radius: 1.2mm; padding: .6mm 1.8mm; }
.tag-inc { display: inline-block; margin-top: 1.6mm; font-size: 7.6pt; font-weight: 800; color: #15803D; background: #ECFDF3; border-radius: 1.2mm; padding: .6mm 1.8mm; }

/* ---------- capa ---------- */
.capa { background: radial-gradient(120mm 90mm at 85% 8%, rgba(255,90,31,.35), transparent 70%), radial-gradient(90mm 70mm at 0% 100%, rgba(225,29,46,.28), transparent 70%), var(--escuro); color: #fff; padding: 18mm 16mm; }
.capa .logo { display: flex; align-items: center; gap: 3.5mm; }
.capa .logo img { width: 13mm; }
.capa .logo b { font-size: 21pt; font-weight: 900; letter-spacing: -.02em; }
.capa .logo small { display: block; font-size: 7pt; letter-spacing: .22em; color: #FDBA8C; font-weight: 700; }
.capa .gancho { margin-top: 15mm; font-size: 9pt; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: #FDBA8C; }
.capa h1 { font-size: 34pt; line-height: 1.02; font-weight: 900; letter-spacing: -.03em; margin: 3mm 0 5mm; }
.capa .sub b { color: #fff; }
.capa h1 em { font-style: normal; color: #FF6A26; }
.capa .sub { font-size: 12.5pt; line-height: 1.5; color: #E7DCD6; max-width: 150mm; }
.chips { display: flex; flex-wrap: wrap; gap: 2.2mm; margin-top: 7mm; }
.chips span { font-size: 8.6pt; font-weight: 700; padding: 1.6mm 3.4mm; border-radius: 10mm; background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.16); color: #fff; }
.capa .vitrine { position: absolute; left: 16mm; right: -18mm; bottom: 40mm; }
.capa .vitrine .shot { border: 1px solid rgba(255,255,255,.14); box-shadow: 0 8mm 20mm -6mm rgba(0,0,0,.7); border-radius: 3.5mm; }
.capa .celular { position: absolute; right: 12mm; bottom: 22mm; width: 52mm; border-radius: 6mm; overflow: hidden; border: 1.4mm solid #2A211D; box-shadow: 0 8mm 18mm -4mm rgba(0,0,0,.75); }
.capa .celular img { display: block; width: 100%; }
.capa .faixa { position: absolute; left: 16mm; bottom: 14mm; display: flex; gap: 6mm; font-size: 9pt; font-weight: 700; color: #FDE7DC; }
.capa .faixa span::before { content: "✓ "; color: #FF7A1A; font-weight: 900; }

/* ---------- preço ---------- */
.plano { margin-top: 7mm; border-radius: 5mm; padding: 7mm 8mm; color: #fff; background: radial-gradient(90mm 60mm at 100% 0%, rgba(255,122,26,.45), transparent 70%), var(--escuro); display: grid; grid-template-columns: 1.05fr 1fr; gap: 7mm; align-items: center; }
.plano .grande { font-size: 50pt; font-weight: 900; line-height: .95; letter-spacing: -.03em; }
.plano .grande em { font-style: normal; color: #FF6A26; }
.plano .de { font-size: 11pt; font-weight: 700; color: #FDE7DC; margin-top: 1.5mm; }
.plano .limites { display: flex; gap: 3mm; margin-top: 4mm; }
.plano .limites div { background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.15); border-radius: 2.5mm; padding: 2.4mm 3.4mm; font-size: 8pt; color: #E7DCD6; }
.plano .limites b { display: block; font-size: 13pt; color: #fff; }
.plano ul { list-style: none; }
.plano li { font-size: 9.3pt; line-height: 1.4; margin: 1.7mm 0; padding-left: 5.5mm; position: relative; color: #F5EDE8; }
.plano li::before { content: "✓"; position: absolute; left: 0; color: #FF7A1A; font-weight: 900; }
.exemplos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin-top: 4.5mm; }
.exemplos div { border: 1px solid var(--linha); border-radius: 3mm; padding: 3.2mm 3.6mm; }
.exemplos small { display: block; font-size: 7.8pt; color: var(--claro); font-weight: 600; }
.exemplos b { font-size: 12.5pt; font-weight: 900; }
.exemplos span { font-size: 8pt; color: var(--cinza); }
.inclusos { list-style: none; display: grid; grid-template-columns: 1fr 1fr; gap: 1.6mm 5mm; margin-top: 3mm; }
.inclusos li { font-size: 9.2pt; padding-left: 6mm; position: relative; line-height: 1.4; }
.inclusos li::before { content: "✓"; position: absolute; left: 0; top: .2mm; width: 4.2mm; height: 4.2mm; border-radius: 50%; background: #16A34A; color: #fff; font-size: 6.5pt; font-weight: 900; display: grid; place-items: center; }
.extras { display: grid; gap: 2.4mm; margin-top: 3mm; }
.extras div { display: grid; grid-template-columns: 1fr auto; border: 1px solid var(--linha); border-radius: 3mm; padding: 3mm 4mm; }
.extras b { font-size: 10pt; }
.extras span { grid-column: 1; font-size: 8.6pt; color: var(--cinza); }
.extras em { grid-column: 2; grid-row: 1 / span 2; align-self: center; font-style: normal; font-weight: 900; color: var(--verm); font-size: 10.5pt; }
table.mod { width: 100%; border-collapse: collapse; margin-top: 3mm; }
table.mod td { padding: 2.1mm 2mm; border-bottom: 1px solid var(--linha); font-size: 9pt; vertical-align: top; }
table.mod td:first-child { font-weight: 800; width: 37%; }
table.mod td:nth-child(2) { color: var(--cinza); }
table.mod td:last-child { text-align: right; font-weight: 800; white-space: nowrap; color: var(--verm); }
h3.sec { font-size: 12.5pt; font-weight: 850; font-weight: 800; margin-top: 7mm; }
.nota { font-size: 8.2pt; color: var(--claro); line-height: 1.45; margin-top: 2mm; }

/* ---------- começar ---------- */
.passos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4mm; margin-top: 7mm; }
.passo { border: 1px solid var(--linha); border-radius: 4mm; padding: 5mm 4.5mm; }
.passo .n { width: 9mm; height: 9mm; border-radius: 50%; background: var(--grad); color: #fff; font-weight: 900; display: grid; place-items: center; font-size: 12pt; }
.passo h4 { font-size: 11pt; font-weight: 800; margin: 3mm 0 1.4mm; }
.passo p { font-size: 9pt; line-height: 1.45; color: var(--cinza); }
.contato { margin-top: 8mm; border-radius: 5mm; background: var(--escuro); color: #fff; padding: 8mm; display: grid; grid-template-columns: 44mm 1fr; gap: 8mm; align-items: center; background-image: radial-gradient(80mm 60mm at 100% 100%, rgba(225,29,46,.35), transparent 70%); }
.contato .qr { background: #fff; border-radius: 3mm; padding: 3.5mm; }
.contato .qr svg { display: block; width: 100%; height: auto; }
.contato h3 { font-size: 19pt; font-weight: 900; line-height: 1.1; letter-spacing: -.02em; }
.contato p { font-size: 10pt; color: #E7DCD6; margin-top: 2mm; line-height: 1.5; }
.contato .linhas { margin-top: 4mm; display: grid; gap: 1.6mm; font-size: 10.5pt; font-weight: 700; }
.contato .linhas span { color: #FDBA8C; font-weight: 600; font-size: 8.5pt; display: inline-block; width: 22mm; }
.indicado { margin-top: 6mm; border: 1.5px dashed #D6D3D1; border-radius: 3mm; padding: 4mm 5mm; font-size: 9.5pt; color: var(--cinza); display: flex; gap: 3mm; align-items: flex-end; }
.indicado b { color: var(--tinta); white-space: nowrap; }
.indicado i { flex: 1; border-bottom: 1px solid #A8A29E; height: 5mm; }
.uau { margin-top: 5mm; background: var(--escuro); color: #fff; border-radius: 4mm; padding: 5mm 6mm; font-size: 13pt; font-weight: 700; line-height: 1.35; background-image: radial-gradient(70mm 40mm at 100% 0%, rgba(255,122,26,.4), transparent 70%); }
.uau em { font-style: normal; color: #FF7A35; }
.mm-cozinha { margin-top: 5mm; background: var(--creme); border-radius: 4mm; padding: 4.5mm 5mm; }
.mm-cozinha b { font-size: 11pt; }
.mm-cozinha p { font-size: 9.2pt; color: var(--cinza); line-height: 1.5; margin-top: 1mm; }
.lead b { color: var(--tinta); }
.selos { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin-top: 7mm; }
.selos div { background: var(--creme); border-radius: 3mm; padding: 3.6mm; font-size: 8.4pt; color: var(--cinza); line-height: 1.4; }
.selos b { display: block; font-size: 10pt; color: var(--tinta); margin-bottom: .8mm; }
</style>
</head>
<body>

<!-- 1. CAPA -->
<section class="pg capa">
  <div class="logo"><img src="/materiais/img/firehub-flame.png" alt=""><div><b>FireHub</b><small>SISTEMA PARA RESTAURANTES</small></div></div>
  <div class="gancho">Tudo que sua loja precisa, num lugar só</div>
  <h1>Já imaginou o seu WhatsApp <em>tirando pedido sozinho?</em></h1>
  <p class="sub">O cliente manda <b>áudio ou texto</b>, do jeito que preferir, sem entrar em site nenhum. O robô do FireHub entende, anota, fecha o valor e o pedido cai pronto no seu painel. E o resto da loja vem junto: pedidos, entrega, cozinha, salão e gestão.</p>
  <div class="chips">
    <span>Cardápio sem comissão</span><span>Robô no WhatsApp</span><span>iFood e 99Food no mesmo quadro</span><span>Roteirização</span><span>App do motoboy</span><span>KDS e impressão</span><span>Estoque e CMV</span><span>Nota fiscal</span><span>Bill, seu assessor</span><span>Multimarcas</span>
  </div>
  <div class="vitrine"><div class="shot"><img src="/materiais/img/x-pedidos.jpg" alt=""></div></div>
  <div class="celular"><img src="/materiais/img/x-robo.jpg" alt=""></div>
  <div class="faixa"><span>15 dias grátis</span><span>A gente monta sua loja</span><span>Sem taxa por pedido</span></div>
</section>

<!-- 2. VENDER -->
<section class="pg">
  <span class="sobre"><i></i>1 · Vender mais</span>
  <h2>Todo pedido chega <em>no mesmo quadro</em></h2>
  <p class="lead">Site, WhatsApp, iFood, 99Food, balcão e mesa entram numa tela só. Acabou a história de pular de tablet em tablet.</p>

  <div class="sol">
    <div class="txt">
      <h3><span class="ico">🤖</span>Robô no WhatsApp com IA</h3>
      <p>Atende o WhatsApp da sua loja 24 horas, conversa como gente, com o nome e o jeito que você escolher.</p>
      <ul>
        <li>Entende até áudio e anota itens, endereço e pagamento</li>
        <li>Calcula a taxa de entrega e fecha o valor</li>
        <li>O pedido cai pronto na sua tela e o cliente recebe o resumo</li>
        <li>Pediu para falar com alguém? Chama sua equipe na hora</li>
      </ul>
    </div>
    <div class="shot alto"><img src="/materiais/img/x-robo.jpg" alt=""></div>
  </div>

  <div class="sol inv">
    <div class="txt">
      <h3><span class="ico">🧾</span>Pedidos num quadro só</h3>
      <p>Cada pedido mostra o canal, o horário, quanto tempo falta e em que etapa está: novo, em produção, saiu para entrega, finalizado.</p>
      <ul>
        <li>Integração com iFood, 99Food e JotaJá</li>
        <li>Aceite, edição, desconto e cancelamento no mesmo lugar</li>
        <li>Pedido agendado e encomenda</li>
      </ul>
    </div>
    <div class="shot"><img src="/materiais/img/x-pedidos.jpg" alt=""></div>
  </div>

  <div class="grade">
    <div class="card"><h4><span>🍔</span>Cardápio digital próprio</h4><p>Delivery, retirada, mesa e balcão, com fotos, adicionais, combos e pizza meio a meio. Sem comissão por pedido.</p><span class="tag-inc">Incluso</span></div>
    <div class="card"><h4><span>💳</span>Pagamento online</h4><p>Pix e cartão no cardápio, caindo direto na conta da loja. Opcional: quem não quiser recebe na entrega.</p><span class="tag-inc">Opcional</span></div>
    <div class="card"><h4><span>🎁</span>Marketing, fidelidade e cashback</h4><p>Cupons, cashback, cartão fidelidade e recuperação automática de quem parou de pedir.</p><span class="tag-inc">Incluso</span></div>
    <div class="card"><h4><span>📱</span>App próprio da loja</h4><p>Seu aplicativo na Google Play e na App Store, com o seu nome e a sua logo. A gente publica.</p><span class="preco-tag">Pago à parte · consulte o valor</span></div>
  </div>
  <div class="rodape"><span class="marca"><img src="/materiais/img/firehub-flame.png" alt="">FireHub</span><span>firehubfood.com.br · WhatsApp <b>(22) 98111-8514</b></span><span>2</span></div>
</section>

<!-- 3. ENTREGAR -->
<section class="pg">
  <span class="sobre"><i></i>2 · Entregar melhor</span>
  <h2>Da cozinha à porta, <em>com a rota pronta</em></h2>
  <p class="lead">Os pedidos de entrega aparecem no mapa com a cor de cada etapa, e o motoboy recebe tudo no celular dele.</p>

  <div class="sol">
    <div class="txt">
      <h3><span class="ico">🗺️</span>Roteirização</h3>
      <p>Veja onde está cada motoboy: capacete verde está livre, vermelho está com entrega na rua.</p>
      <ul>
        <li>Junte os pedidos que vão para o mesmo lado</li>
        <li>O sistema põe as paradas na melhor ordem</li>
        <li>A rota já mostra o troco e se precisa levar maquininha</li>
        <li>Um clique e ela está despachada</li>
      </ul>
    </div>
    <div class="shot"><img src="/materiais/img/x-mapa.jpg" alt=""></div>
  </div>

  <div class="sol inv">
    <div class="txt">
      <h3><span class="ico">🛵</span>App do motoboy</h3>
      <p>As entregas na ordem da rota, quanto cobrar de cada cliente e quanto levar de troco.</p>
      <ul>
        <li>Abre o caminho no Google Maps ou no Waze com um toque</li>
        <li>Avisa o cliente pelo WhatsApp que está a caminho</li>
        <li>Lembra das bebidas para nada ficar para trás</li>
        <li>No fim do dia, o acerto está pronto: entregas, quanto recebe e quanto devolve</li>
      </ul>
    </div>
    <div class="shot alto"><img src="/materiais/img/x-motoboy.jpg" alt=""></div>
  </div>

  <div class="sol">
    <div class="txt">
      <h3><span class="ico">⏱️</span>Prazo automático no iFood e no 99</h3>
      <p>O tempo de entrega sobe e desce sozinho, conforme a fila da sua cozinha e os motoboys. Menos atraso, menos reclamação.</p>
      <span class="tag-inc">Incluso para quem usa o FireHub</span>
    </div>
    <div class="shot"><img src="/materiais/img/x-prazo.jpg" alt=""></div>
  </div>
  <div class="rodape"><span class="marca"><img src="/materiais/img/firehub-flame.png" alt="">FireHub</span><span>firehubfood.com.br · WhatsApp <b>(22) 98111-8514</b></span><span>3</span></div>
</section>

<!-- 4. COZINHA E SALÃO -->
<section class="pg">
  <span class="sobre"><i></i>3 · Cozinha e salão</span>
  <h2>Cada pedido no lugar certo, <em>na hora certa</em></h2>
  <p class="lead">A cozinha vê o que fazer na TV, a comanda sai na impressora de cada setor e o salão anda sem papelzinho.</p>

  <div class="sol">
    <div class="txt">
      <h3><span class="ico">📺</span>KDS: a cozinha na TV</h3>
      <p>Os pedidos aparecem em cartões grandes, com observações em destaque (“sem cebola”) e o tempo de preparo correndo.</p>
      <ul>
        <li>Pronto num toque, o pedido avança no quadro</li>
        <li>Comanda certa em cada impressora: cozinha, bar, pizzaria</li>
        <li>Painel de senhas na TV do salão, com som</li>
      </ul>
    </div>
    <div class="shot"><img src="/materiais/img/x-kds.jpg" alt=""></div>
  </div>

  <div class="grade">
    <div class="card"><h4><span>🍽️</span>Mesas e QR na mesa</h4><p>Mesas, conta e transferência. O cliente pede pelo QR da mesa e o pedido vai direto para a cozinha.</p><span class="tag-inc">Incluso</span></div>
    <div class="card"><h4><span>🛍️</span>Balcão (PDV)</h4><p>Venda no balcão rápida, com as formas de pagamento e o caixa do dia.</p><span class="tag-inc">Incluso</span></div>
    <div class="card"><h4><span>📲</span>Garçom pelo celular</h4><p>O garçom lança o pedido da mesa no celular e ele sai na impressora certa.</p><span class="tag-inc">Incluso</span></div>
    <div class="card"><h4><span>🖨️</span>Impressão por setor</h4><p>Cada impressora recebe só o que é dela: cozinha, bar, pizzaria. Comanda sai sozinha.</p><span class="tag-inc">Incluso</span></div>
    <div class="card"><h4><span>📺</span>Painel de senhas</h4><p>A TV do salão chama a senha quando o pedido fica pronto, com som e o nome do cliente.</p><span class="tag-inc">Incluso</span></div>
    <div class="card"><h4><span>📅</span>Escala da equipe</h4><p>Turnos com vagas, link de inscrição para o grupo, Pix e pagamentos de quem trabalhou.</p><span class="tag-inc">Incluso</span></div>
  </div>
  <div class="rodape"><span class="marca"><img src="/materiais/img/firehub-flame.png" alt="">FireHub</span><span>firehubfood.com.br · WhatsApp <b>(22) 98111-8514</b></span><span>4</span></div>
</section>

<!-- 5. CONTROLE -->
<section class="pg">
  <span class="sobre"><i></i>4 · Controle e lucro</span>
  <h2>O lucro de verdade, <em>sem planilha</em></h2>
  <p class="lead">Logo na página inicial: quanto vendeu, quantos pedidos, o ticket médio e o lucro líquido do dia, além dos horários de pico e dos produtos campeões.</p>

  <div class="sol">
    <div class="txt">
      <h3><span class="ico">📊</span>Financeiro com lucro de verdade</h3>
      <p>Demonstrativo de resultado, contas a pagar pela foto do boleto, custos fixos e o CMV do mês.</p>
      <ul>
        <li>Receita, custos, taxas e lucro líquido por período</li>
        <li>Formas de pagamento e fechamento do caixa</li>
        <li>Relatórios de vendas, produtos e clientes</li>
      </ul>
    </div>
    <div class="shot"><img src="/materiais/img/x-financeiro.jpg" alt=""></div>
  </div>

  <div class="sol inv">
    <div class="txt">
      <h3><span class="ico">🏷️</span>Validade e etiquetas</h3>
      <p>A cozinha imprime a etiqueta de tudo o que prepara e guarda. Você informa a fabricação e a validade sai sozinha, com QR Code.</p>
      <ul>
        <li>Escaneou o QR, o produto entra no estoque</li>
        <li>Mostra o que está vencendo antes de virar prejuízo</li>
      </ul>
    </div>
    <div class="shot"><img src="/materiais/img/x-validade.jpg" alt=""></div>
  </div>

  <div class="grade">
    <div class="card"><h4><span>📦</span>Estoque, CMV e perdas</h4><p>Ficha técnica, baixa automática na venda, entrada pela foto da nota com IA, contagem e o relatório das perdas em R$ e % da venda.</p><span class="tag-inc">Incluso</span></div>
    <div class="card"><h4><span>🧾</span>Nota fiscal (NFC-e)</h4><p>Emissão da nota fiscal do consumidor direto pelo sistema, sem programa à parte.</p><span class="tag-inc">Incluso</span></div>
    <div class="card"><h4><span>📈</span>Relatórios e caixa</h4><p>Fechamento do caixa, formas de pagamento, horários de pico e os produtos campeões.</p><span class="tag-inc">Incluso</span></div>
    <div class="card"><h4><span>📸</span>Contas a pagar pela foto</h4><p>Tirou foto do boleto, a IA preenche valor, vencimento e código de barras.</p><span class="tag-inc">Incluso</span></div>
  </div>
  <div class="rodape"><span class="marca"><img src="/materiais/img/firehub-flame.png" alt="">FireHub</span><span>firehubfood.com.br · WhatsApp <b>(22) 98111-8514</b></span><span>5</span></div>
</section>

<!-- 6. BILL -->
<section class="pg">
  <span class="sobre"><i></i>5 · Bill, seu assessor</span>
  <h2>Você cuida da loja. <em>O Bill cuida da papelada.</em></h2>
  <p class="lead">O Bill é o gerente que resolve a loja pelo WhatsApp. Você manda um áudio, um texto ou uma foto, como falaria com uma pessoa.</p>
  <div class="uau">Acabou a batata? <b>Um único áudio</b> e ele pausa o item no <em>iFood</em>, na <em>99</em> e no <em>seu site</em>, tudo ao mesmo tempo. Chegou? Outro áudio e ele reativa.</div>
  <div class="shot" style="margin-top:5mm"><img src="/materiais/img/x-bill.jpg" alt="" style="height:104mm;object-fit:cover;object-position:top"></div>
  <div class="grade">
    <div class="card"><h4><span>🥤</span>“Comprei 10 latas de refrigerante”</h4><p>Ele lança no estoque e no financeiro, com o valor e a forma de pagamento.</p></div>
    <div class="card"><h4><span>📷</span>Manda a foto</h4><p>Da nota fiscal, do cupom de compra ou do abastecimento do carro: ele lê e lança na hora.</p></div>
    <div class="card"><h4><span>💸</span>“Paguei o gás, 130 reais”</h4><p>Vira conta paga no financeiro, na categoria certa.</p></div>
    <div class="card"><h4><span>📈</span>Mostra o que fez por você</h4><p>Em reais: tudo o que ele resolveu no dia, na semana e no mês.</p></div>
  </div>
  <p class="nota" style="margin-top:5mm;font-size:10pt"><b style="color:var(--verm)">+ R$ 49,90/mês</b>, com 7 dias grátis para testar. Só o seu número fala com ele.</p>
  <div class="rodape"><span class="marca"><img src="/materiais/img/firehub-flame.png" alt="">FireHub</span><span>firehubfood.com.br · WhatsApp <b>(22) 98111-8514</b></span><span>6</span></div>
</section>

<!-- 6b. MULTIMARCAS -->
<section class="pg">
  <span class="sobre"><i></i>Multimarcas</span>
  <h2>Tem mais de uma marca <em>na mesma cozinha?</em></h2>
  <p class="lead">Imagina um cardápio único onde o cliente pede de <b>todas as suas lojas ao mesmo tempo</b>, paga <b>uma taxa de entrega só</b> e fecha tudo num pedido. Um burguer daqui, um frango dali: o ticket médio sobe sozinho.</p>
  <div class="shot" style="margin-top:7mm"><img src="/materiais/img/x-multimarcas.jpg" alt=""></div>
  <div class="grade" style="grid-template-columns:repeat(3,1fr)">
    <div class="card"><h4><span>🛍️</span>Pedido maior</h4><p>Quem ia pedir só o lanche leva o açaí da outra marca, no mesmo pedido e sem outra taxa.</p></div>
    <div class="card"><h4><span>🚀</span>Marca nova já nasce vendendo</h4><p>Abriu uma pizzaria? Ela entra na página e aparece para todo cliente que já compra das suas marcas.</p></div>
    <div class="card"><h4><span>🔗</span>Um link para divulgar</h4><p>Um anúncio, um QR na embalagem, um link na bio: o cliente vê tudo o que você vende.</p></div>
  </div>
  <div class="mm-cozinha">
    <b>Na sua cozinha, um pedido só no painel</b>
    <p>Cada item sai com o nome da marca, para a equipe saber qual embalagem usar. Um motoboy, uma corrida, e o caixa e os relatórios como sempre.</p>
  </div>
  <p class="nota" style="margin-top:4mm;font-size:10pt"><b style="color:var(--verm)">Pago à parte</b>, com 7 dias grátis para testar. Consulte o valor com a gente.</p>
  <div class="rodape"><span class="marca"><img src="/materiais/img/firehub-flame.png" alt="">FireHub</span><span>firehubfood.com.br · WhatsApp <b>(22) 98111-8514</b></span><span>7</span></div>
</section>

<!-- 7. PREÇO -->
<section class="pg">
  <span class="sobre"><i></i>6 · Quanto custa</span>
  <h2>Um plano só. <em>Você paga conforme vende.</em></h2>
  <p class="lead">Sem taxa por pedido e sem comissão. A mensalidade é uma porcentagem do que a loja vende pelo FireHub, com piso e teto.</p>

  <div class="plano">
    <div>
      <div class="grande"><em>2%</em></div>
      <div class="de">do que a loja vende pelo FireHub</div>
      <div class="limites"><div>mínimo<b>R$ 100</b>por mês</div><div>máximo<b>R$ 400</b>por mês</div></div>
    </div>
    <ul>
      <li>Todas as funções do plano liberadas</li>
      <li>Cardápio, WhatsApp, mesa, balcão, iFood, 99Food e JotaJá na mesma conta</li>
      <li>A partir de R$ 20 mil de venda no mês, nunca passa de R$ 400</li>
      <li>Mês sem vender e sem usar: R$ 0</li>
    </ul>
  </div>

  <div class="exemplos">
    <div><small>Vendeu no mês</small><b>R$ 5.000</b><br><span>paga R$ 100 (o mínimo)</span></div>
    <div><small>Vendeu no mês</small><b>R$ 12.500</b><br><span>paga R$ 250</span></div>
    <div><small>Vendeu no mês</small><b>R$ 30.000</b><br><span>paga R$ 400 (o teto)</span></div>
  </div>

  <h3 class="sec">Já vem no plano, sem pagar nada a mais</h3>
  <ul class="inclusos">
    <li>Robô com IA no WhatsApp</li><li>Cardápio digital próprio</li>
    <li>iFood, 99Food e JotaJá no mesmo quadro</li><li>Roteirização e app do motoboy</li>
    <li>Prazo automático no iFood e no 99</li><li>KDS, impressão por setor e painel de senhas</li>
    <li>Mesas, garçom, QR na mesa e balcão</li><li>Financeiro, relatórios e caixa</li>
    <li>Estoque, CMV e controle de perdas</li><li>Validade e etiquetas com QR</li>
    <li>Nota fiscal (NFC-e)</li><li>Cupons, fidelidade e cashback</li>
    <li>Escala da equipe</li><li>Suporte humano 7 dias por semana</li>
  </ul>
  <h3 class="sec">Pago à parte, só se quiser</h3>
  <div class="extras">
    <div><b>🎙️ Bill, seu assessor</b><span>O gerente da loja no WhatsApp · 7 dias grátis</span><em>+ R$ 49,90/mês</em></div>
    <div><b>📱 App próprio da loja</b><span>Na Google Play e na App Store, com a sua marca</span><em>consulte o valor</em></div>
    <div><b>🏷️ Multimarcas</b><span>Todas as suas marcas num cardápio só, uma taxa de entrega</span><em>consulte o valor</em></div>
  </div>
  <p class="nota">Pagamento online pelo site (Pix e cartão) é opcional e tem uma tarifa por venda paga online. Receber na entrega não tem custo nenhum.</p>
  <div class="rodape"><span class="marca"><img src="/materiais/img/firehub-flame.png" alt="">FireHub</span><span>Valores de novembro de 2026</span><span>8</span></div>
</section>

<!-- 8. COMEÇAR -->
<section class="pg">
  <span class="sobre"><i></i>7 · Como começar</span>
  <h2>Sua loja pronta <em>no mesmo dia</em></h2>
  <p class="lead">Você não precisa cadastrar nada sozinho. A nossa equipe deixa tudo pronto para você vender.</p>

  <div class="passos">
    <div class="passo"><div class="n">1</div><h4>Chama a gente</h4><p>Pelo WhatsApp ou pelo site. O cadastro leva menos de 2 minutos e o teste é de 15 dias grátis, sem cartão.</p></div>
    <div class="passo"><div class="n">2</div><h4>Manda o seu cardápio</h4><p>O link do cardápio que você usa hoje (iFood, site) ou uma foto. A equipe deixa igualzinho: produtos, preços, fotos e adicionais.</p></div>
    <div class="passo"><div class="n">3</div><h4>Começa a vender</h4><p>Bairros, taxas de entrega e horários já configurados. O suporte te ajuda a ligar o robô, o iFood e a impressora.</p></div>
  </div>

  <div class="selos">
    <div><b>Sem fidelidade</b>Cancela quando quiser, sem multa.</div>
    <div><b>Suporte humano</b>Pelo WhatsApp, 7 dias por semana.</div>
    <div><b>Tutoriais em vídeo</b>De cada tela, no painel e no celular.</div>
    <div><b>Sem taxa por pedido</b>Vendeu mais, não paga por pedido.</div>
  </div>

  <div class="contato">
    <div class="qr">__QR__</div>
    <div>
      <h3>Quer ver funcionando na sua loja?</h3>
      <p>Aponte a câmera do celular para o código ou chame a gente no WhatsApp.</p>
      <div class="linhas">
        <div><span>WhatsApp</span>(22) 98111-8514</div>
        <div><span>Site</span>firehubfood.com.br</div>
        <div><span>Teste grátis</span>firehubfood.com.br/cadastro</div>
      </div>
    </div>
  </div>

  <div class="indicado"><b>Indicado por:</b><i></i></div>
  <div class="rodape"><span class="marca"><img src="/materiais/img/firehub-flame.png" alt="">FireHub</span><span>A sua loja vendendo mais e dando menos trabalho.</span><span>9</span></div>
</section>
</body>
</html>
`;
