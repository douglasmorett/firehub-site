/**
 * O modelo aprovado do folder da gráfica (2 folhas 303 x 216 mm: A4 deitado, 2 dobras, 3 mm de sangria), tal como saiu do
 * desenho (HTML puro). As imagens moram em public/materiais/img/.
 * Os pontos que lib/materiais/personalizar.ts troca: `__QR__`, a linha em branco do
 * "Indicado por:" e o WhatsApp do bloco de contato. Mexeu no texto? Mantenha esses três.
 */
export const MODELO_DO_FOLDER = String.raw`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>FireHub - Folder 2 dobras</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<style>
/* A4 deitado (297 x 210) + 3 mm de sangria em cada lado = 303 x 216.
   Fora:  [aba que dobra para dentro 97][verso 100][capa 100]
   Dentro: [painel 1 100][painel 2 100][painel 3 97]          */
@page { size: 303mm 216mm; margin: 0; }
:root { --tinta:#1C1917; --cinza:#57534E; --claro:#78716C; --linha:#E7E5E4; --fogo:#F0461F; --verm:#E11D2E; --creme:#FFF7F2; --escuro:#140C09; --grad: linear-gradient(135deg,#FF7A1A 0%,#FF4D2E 45%,#E11D2E 100%); }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Inter', sans-serif; color: var(--tinta); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.folha { width: 303mm; height: 216mm; position: relative; overflow: hidden; page-break-after: always; break-after: page; }
.folha:last-child { page-break-after: auto; break-after: auto; }
.p { position: absolute; top: 0; height: 216mm; padding: 11mm 8mm 10mm; overflow: hidden; }
/* margem segura: 8 mm do corte, 3 mm a mais do lado da sangria */
.sang-esq { padding-left: 11mm; }
.sang-dir { padding-right: 11mm; }

.sobre { display: inline-flex; align-items: center; gap: 1.6mm; font-size: 6.6pt; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; color: var(--fogo); }
.sobre i { width: 5mm; height: 1mm; border-radius: 1mm; background: var(--grad); display: inline-block; }
h2 { font-size: 16.5pt; line-height: 1.05; font-weight: 900; letter-spacing: -.02em; margin: 2.4mm 0 2.4mm; }
h2 em { font-style: normal; color: var(--fogo); }
.lead { font-size: 7.8pt; line-height: 1.45; color: var(--cinza); }
.it { margin-top: 4.4mm; }
.it h3 { font-size: 10pt; font-weight: 800; display: flex; align-items: center; gap: 1.6mm; }
.it h3 span { font-size: 10.5pt; }
.it p { font-size: 8.3pt; line-height: 1.45; color: var(--cinza); margin-top: .8mm; }
.it .pr { color: var(--verm); font-weight: 800; }
.shot { border-radius: 2mm; overflow: hidden; border: .3mm solid #E7E5E4; margin-top: 4mm; box-shadow: 0 1.5mm 4mm -1.5mm rgba(28,25,23,.3); }
.shot img { display: block; width: 100%; }

/* ----- capa ----- */
.capa { background: radial-gradient(70mm 60mm at 100% 0%, rgba(255,90,31,.38), transparent 70%), radial-gradient(60mm 60mm at 0% 100%, rgba(225,29,46,.3), transparent 70%), var(--escuro); color: #fff; }
.logo { display: flex; align-items: center; gap: 2.4mm; }
.logo img { width: 9mm; }
.logo b { font-size: 14pt; font-weight: 900; letter-spacing: -.02em; display: block; line-height: 1; }
.logo small { font-size: 5pt; letter-spacing: .2em; color: #FDBA8C; font-weight: 700; }
.capa h1 { font-size: 19.5pt; line-height: 1.04; font-weight: 900; letter-spacing: -.025em; margin: 9mm 0 3mm; }
.capa h1 em { font-style: normal; color: #FF6A26; }
.capa .sub { font-size: 8pt; line-height: 1.45; color: #E7DCD6; }
.capa .cel { width: 44mm; margin: 6mm auto 0; border-radius: 5mm; overflow: hidden; border: 1.1mm solid #2A211D; box-shadow: 0 5mm 12mm -3mm rgba(0,0,0,.75); }
.capa .cel img { display: block; width: 100%; }
.capa .selo { position: absolute; left: 8mm; right: 11mm; bottom: 10mm; background: var(--grad); border-radius: 3mm; padding: 3mm 4mm; display: flex; justify-content: space-between; align-items: center; }
.capa .selo b { font-size: 11pt; font-weight: 900; }
.capa .selo span { font-size: 6.8pt; font-weight: 700; text-align: right; line-height: 1.3; }

/* ----- aba ----- */
.aba { background: var(--creme); }
.lista { list-style: none; margin-top: 4mm; }
.lista li { font-size: 8.4pt; line-height: 1.42; padding: 3.2mm 0 3.2mm 7.5mm; position: relative; border-bottom: .25mm solid #F3E3D8; }
.lista li b { display: block; font-size: 9.6pt; color: var(--tinta); }
.lista li::before { content: "✓"; position: absolute; left: 0; top: 3.4mm; width: 4.6mm; height: 4.6mm; border-radius: 50%; background: var(--grad); color: #fff; font-size: 7pt; font-weight: 900; display: grid; place-items: center; }
.monta { margin-top: 6mm; background: #fff; border: .3mm solid #F3D9C8; border-radius: 3mm; padding: 3.4mm 3.8mm; }
.monta b { font-size: 9.6pt; display: block; }
.monta p { font-size: 8.2pt; line-height: 1.42; color: var(--cinza); margin-top: .8mm; }

/* ----- verso (preço + contato) ----- */
.plano { margin-top: 3mm; background: var(--escuro); color: #fff; border-radius: 3mm; padding: 4mm; background-image: radial-gradient(50mm 40mm at 100% 0%, rgba(255,122,26,.42), transparent 70%); }
.plano .g { font-size: 30pt; font-weight: 900; line-height: .9; color: #FF6A26; letter-spacing: -.03em; }
.plano .d { font-size: 7.6pt; font-weight: 700; color: #FDE7DC; margin-top: 1mm; }
.plano .lim { display: flex; gap: 2mm; margin-top: 2.6mm; }
.plano .lim div { flex: 1; background: rgba(255,255,255,.08); border: .25mm solid rgba(255,255,255,.16); border-radius: 1.8mm; padding: 1.6mm 2.2mm; font-size: 6.2pt; color: #E7DCD6; }
.plano .lim b { display: block; font-size: 10pt; color: #fff; }
.plano p { font-size: 6.8pt; line-height: 1.4; color: #F5EDE8; margin-top: 2.4mm; }
.mods { margin-top: 2.6mm; }
.mods div { display: flex; justify-content: space-between; font-size: 6.9pt; padding: 1.05mm 0; border-bottom: .25mm solid var(--linha); }
.mods div b { color: var(--verm); }
.mods small { display: block; font-size: 6.2pt; color: var(--claro); margin-top: 1mm; line-height: 1.35; }
.contato { position: absolute; left: 8mm; right: 8mm; bottom: 10mm; }
.contato .linha { display: flex; gap: 3mm; align-items: center; }
.contato .qr { width: 23mm; flex: none; background: #fff; padding: 1.4mm; border: .3mm solid var(--linha); border-radius: 1.6mm; }
.contato .qr svg { display: block; width: 100%; height: auto; }
.contato h4 { font-size: 9pt; font-weight: 900; line-height: 1.15; }
.contato p { font-size: 7pt; color: var(--cinza); line-height: 1.5; margin-top: .8mm; }
.contato p b { color: var(--tinta); }
.indicado { margin-top: 3mm; border: .35mm dashed #C9C4C0; border-radius: 1.8mm; padding: 2.2mm 2.8mm; font-size: 7pt; display: flex; gap: 2mm; align-items: flex-end; color: var(--cinza); }
.indicado b { color: var(--tinta); white-space: nowrap; }
.indicado i { flex: 1; border-bottom: .25mm solid #A8A29E; height: 3.5mm; }

/* ----- dentro ----- */
.dentro .p { background: #fff; }
.dentro .p + .p { border-left: 0; }
.faixa-topo { position: absolute; left: 0; right: 0; top: 0; height: 3mm + 3mm; }
.tag { display: inline-block; margin-top: .8mm; font-size: 6.2pt; font-weight: 800; padding: .3mm 1.4mm; border-radius: 1mm; }
.tag.inc { color: #15803D; background: #ECFDF3; }
.tag.pg { color: var(--verm); background: #FFF1EC; }
/* capa v2: gancho do robô */
.capa .gancho { margin-top: 8mm; font-size: 6.8pt; font-weight: 800; letter-spacing: .13em; text-transform: uppercase; color: #FDBA8C; }
.capa h1 { font-size: 20pt; line-height: 1.04; font-weight: 900; letter-spacing: -.025em; margin: 2.4mm 0 3mm; }
.capa .sub b { color: #fff; }
.capa .palco { position: relative; width: 62mm; margin: 5mm auto 0; }
.capa .palco .cel { width: 40mm; margin: 0 auto; }
.capa .call { position: absolute; font-size: 7pt; font-weight: 800; background: #fff; color: var(--tinta); border-radius: 10mm; padding: 1.4mm 2.8mm; box-shadow: 0 2mm 5mm -1mm rgba(0,0,0,.5); white-space: nowrap; }
.capa .call.c1 { left: -4mm; top: 26mm; }
.capa .call.c2 { right: -6mm; bottom: 12mm; background: #DCFCE7; color: #14532D; }
.capa .selo span { font-size: 6.8pt; }
/* aba v2: o que já vem no plano */
.inclusos { list-style: none; margin-top: 3mm; }
.inclusos li { font-size: 7.6pt; line-height: 1.3; color: var(--cinza); padding: 1.75mm 0 1.75mm 6.5mm; position: relative; border-bottom: .25mm solid #F3E3D8; }
.inclusos li b { display: block; font-size: 8.7pt; color: var(--tinta); }
.inclusos li::before { content: "✓"; position: absolute; left: 0; top: 2.1mm; width: 4.2mm; height: 4.2mm; border-radius: 50%; background: #16A34A; color: #fff; font-size: 6.5pt; font-weight: 900; display: grid; place-items: center; }
.aba .monta { margin-top: 4mm; }
/* verso v2: Bill e app */
.bill { margin-top: 3.4mm; border: .35mm solid #F3D9C8; background: var(--creme); border-radius: 3mm; padding: 3mm 3.4mm; }
.bill-topo { display: flex; justify-content: space-between; align-items: baseline; }
.bill-topo b { font-size: 9.6pt; font-weight: 900; }
.bill-topo span { font-size: 8.4pt; font-weight: 900; color: var(--verm); }
.bill p { font-size: 7.3pt; color: var(--cinza); margin-top: 1mm; line-height: 1.4; }
.bill ul { list-style: none; margin-top: 1.2mm; }
.bill li { font-size: 7.1pt; line-height: 1.35; padding: .7mm 0 .7mm 3.6mm; position: relative; }
.bill li::before { content: ""; position: absolute; left: 0; top: 1.9mm; width: 1.6mm; height: 1.6mm; border-radius: 50%; background: var(--fogo); }
.bill small { display: block; font-size: 6.8pt; font-weight: 700; color: #15803D; margin-top: 1.2mm; }
.app { margin-top: 2.6mm; font-size: 7.3pt; line-height: 1.4; color: var(--cinza); }
.app b { color: var(--tinta); }

.bill-uau { margin-top: 1.6mm; background: var(--escuro); color: #fff; border-radius: 2mm; padding: 2.2mm 2.6mm; font-size: 8pt; font-weight: 700; line-height: 1.35; }
.bill-uau b { color: #FF7A35; }
.bill li b { color: var(--tinta); }
.mm { margin-top: 2.6mm; border: .35mm solid var(--linha); border-radius: 3mm; padding: 2.6mm 3.2mm; }
.mm > b { font-size: 8.4pt; font-weight: 900; display: block; }
.mm p { font-size: 7.1pt; line-height: 1.38; color: var(--cinza); margin-top: .8mm; }
.mm p b { color: var(--tinta); }
.mm-barra { margin-top: 1.8mm; background: var(--escuro); color: #fff; border-radius: 1.6mm; padding: 1.4mm 2mm; display: flex; justify-content: space-between; font-size: 6.6pt; font-weight: 600; }
.mm-barra i { font-style: normal; font-weight: 900; color: #FF7A35; }
.app { margin-top: 2mm; font-size: 6.9pt; }
.plano { padding: 3.4mm 4mm; }
.plano .g { font-size: 26pt; }
.bill { margin-top: 2.6mm; padding: 2.6mm 3.2mm; }
.mm-pe { margin-top: 1.8mm; font-size: 6.8pt; color: var(--cinza); line-height: 1.35; }
.mm-pe b { color: var(--tinta); }
.contato .qr { width: 20mm; }
.indicado { margin-top: 2mm; }
.bill li { padding: .45mm 0 .45mm 3.6mm; }
.bill li::before { top: 1.6mm; }
.mm { margin-top: 2.2mm; }
</style>
</head>
<body>

<!-- ================= LADO DE FORA ================= -->
<section class="folha">
  <!-- aba que dobra para dentro (97): o que já vem no plano -->
  <div class="p aba sang-esq" style="left:0;width:100mm">
    <span class="sobre"><i></i>Já vem no plano</span>
    <h2>Tudo isso <em>sem pagar nada a mais</em></h2>
    <ul class="inclusos">
      <li><b>Robô com IA no WhatsApp</b>atende e tira o pedido 24h</li>
      <li><b>Cardápio digital próprio</b>sem comissão por pedido</li>
      <li><b>iFood, 99Food e JotaJá</b>no mesmo quadro de pedidos</li>
      <li><b>Roteirização e app do motoboy</b>com o acerto do dia</li>
      <li><b>Prazo automático</b>no iFood e no 99</li>
      <li><b>KDS e impressão por setor</b>e painel de senhas na TV</li>
      <li><b>Mesas, garçom e balcão</b>com QR na mesa</li>
      <li><b>Financeiro e lucro do dia</b>sem planilha</li>
      <li><b>Estoque, CMV e etiquetas</b>de validade com QR</li>
      <li><b>Nota fiscal (NFC-e)</b>direto pelo sistema</li>
      <li><b>Cupons, fidelidade e cashback</b>para o cliente voltar</li>
      <li><b>Suporte humano</b>7 dias por semana</li>
    </ul>
    <div class="monta">
      <b>A gente monta sua loja no mesmo dia</b>
      <p>Manda o link do cardápio que você usa hoje (ou uma foto) e a nossa equipe deixa tudo igual: produtos, preços, fotos, adicionais, bairros e taxas. Sem custo.</p>
    </div>
  </div>

  <!-- verso (100): preço, Bill, app e contato -->
  <div class="p" style="left:100mm;width:100mm">
    <span class="sobre"><i></i>Quanto custa</span>
    <h2>Um plano só. <em>Paga conforme vende.</em></h2>
    <div class="plano">
      <div class="g">2%</div>
      <div class="d">do que a loja vende pelo FireHub</div>
      <div class="lim"><div>mínimo<b>R$ 100</b>por mês</div><div>máximo<b>R$ 400</b>por mês</div></div>
      <p>Sem taxa por pedido, sem fidelidade e sem multa. Vendeu R$ 12.500? Paga R$ 250.</p>
    </div>
    <div class="bill">
      <div class="bill-topo"><b>🎙️ Bill, seu assessor</b><span>+ R$ 49,90/mês</span></div>
      <div class="bill-uau">Um único áudio e ele pausa o item no <b>iFood</b>, na <b>99</b> e no <b>seu site</b>, tudo ao mesmo tempo.</div>
      <ul>
        <li><b>Manda a foto</b> da nota, do cupom ou do abastecimento → ele lança na hora</li>
        <li>“Comprei 10 Coca” → entra no estoque e no financeiro</li>
        <li>“Paguei o gás” → vira conta paga</li>
        <li>Mostra em reais tudo o que fez por você</li>
      </ul>
      <small>O gerente da sua loja no WhatsApp · 7 dias grátis</small>
    </div>
    <div class="mm">
      <b>🏷️ Multimarcas: tem mais de uma marca na cozinha?</b>
      <p>Um cardápio único: o cliente pede de todas as suas lojas ao mesmo tempo e paga <b>uma taxa de entrega só</b>. O ticket médio sobe.</p>
      <div class="mm-barra"><span><i>1</i> página</span><span><i>1</i> sacola</span><span><i>1</i> entrega</span><span><i>1</i> pedido</span></div>
      <div class="mm-pe">📱 E o <b>app próprio</b> com a sua marca. Multimarcas e app são pagos à parte: consulte o valor.</div>
    </div>
    
    <div class="contato">
      <div class="linha">
        <div class="qr">__QR__</div>
        <div>
          <h4>15 dias grátis, sem cartão</h4>
          <p>Aponte a câmera e chame a gente.<br>WhatsApp <b>(22) 98111-8514</b><br><b>firehubfood.com.br</b></p>
        </div>
      </div>
      <div class="indicado"><b>Indicado por:</b><i></i></div>
    </div>
  </div>

  <!-- capa (100) -->
  <div class="p capa sang-dir" style="left:200mm;width:103mm">
    <div class="logo"><img src="/materiais/img/firehub-flame.png" alt=""><div><b>FireHub</b><small>SISTEMA PARA RESTAURANTES</small></div></div>
    <div class="gancho">Tudo que sua loja precisa, num lugar só</div>
    <h1>Já imaginou o seu WhatsApp <em>tirando pedido sozinho?</em></h1>
    <p class="sub">O cliente manda <b>áudio ou texto</b>, do jeito que preferir, sem entrar em site nenhum. O robô entende, anota, fecha o valor e o pedido cai pronto no seu painel.</p>
    <div class="palco">
      <div class="cel"><img src="/materiais/img/x-robo.jpg" alt=""></div>
      <span class="call c1">🎧 Entende áudio</span>
      <span class="call c2">✓ Pedido pronto no painel</span>
    </div>
    <div class="selo"><b>15 dias grátis</b><span>Abra e veja tudo o que<br>já vem no plano →</span></div>
  </div>
</section>

<!-- ================= LADO DE DENTRO ================= -->
<section class="folha dentro">
  <!-- painel 1 (100) -->
  <div class="p sang-esq" style="left:0;width:103mm">
    <span class="sobre"><i></i>1 · Vender mais</span>
    <h2>Todo pedido <em>no mesmo quadro</em></h2>
    <div class="shot"><img src="/materiais/img/x-pedidos.jpg" alt=""></div>
    <div class="it"><h3><span>🤖</span>Robô no WhatsApp com IA</h3><p>Atende 24h com o nome e o jeito que você escolher. Entende áudio, anota itens, endereço e pagamento, e o pedido cai pronto na tela.</p></div>
    <div class="it"><h3><span>🧾</span>Pedidos num quadro só</h3><p>Site, WhatsApp, iFood, 99Food, JotaJá, balcão e mesa, cada um com a sua etapa.</p></div>
    <div class="it"><h3><span>🍔</span>Cardápio próprio</h3><p>Delivery, retirada e mesa, com combos e pizza meio a meio. Sem comissão.</p></div>
    <div class="it"><h3><span>🎁</span>Fidelidade e cashback</h3><p>Cupons, cashback e recuperação de quem parou de pedir.</p></div>
    <div class="it"><h3><span>💳</span>Pagamento online</h3><p>Pix e cartão no cardápio, caindo direto na conta da loja. Opcional.</p></div>
    <div class="it"><h3><span>📱</span>App próprio da loja</h3><p>Na Google Play e na App Store, com o seu nome e a sua logo. <span class="pr">Pago à parte: consulte o valor.</span></p></div>
  </div>

  <!-- painel 2 (100) -->
  <div class="p" style="left:103mm;width:100mm;background:var(--creme)">
    <span class="sobre"><i></i>2 · Entregar e produzir</span>
    <h2>Da cozinha à porta, <em>com a rota pronta</em></h2>
    <div class="shot"><img src="/materiais/img/x-mapa.jpg" alt=""></div>
    <div class="it"><h3><span>🗺️</span>Roteirização</h3><p>Pedidos e motoboys no mapa. Junte as entregas do mesmo lado e o sistema põe as paradas na melhor ordem, com o troco.</p></div>
    <div class="it"><h3><span>🛵</span>App do motoboy</h3><p>Rota, Google Maps ou Waze, aviso ao cliente e o acerto do dia pronto.</p></div>
    <div class="it"><h3><span>⏱️</span>Prazo automático no iFood e no 99</h3><p>O tempo de entrega sobe e desce sozinho, conforme a fila da cozinha.</p></div>
    <div class="it"><h3><span>📺</span>KDS e impressão por setor</h3><p>A cozinha na TV e a comanda certa em cada impressora. Painel de senhas no salão.</p></div>
    <div class="it"><h3><span>🍽️</span>Mesas, garçom e balcão</h3><p>Garçom pelo celular, conta da mesa, QR na mesa para o cliente pedir e PDV no balcão.</p></div>
  </div>

  <!-- painel 3 (97, a aba) -->
  <div class="p sang-dir" style="left:203mm;width:100mm">
    <span class="sobre"><i></i>3 · Controle e lucro</span>
    <h2>O lucro de verdade, <em>sem planilha</em></h2>
    <div class="shot"><img src="/materiais/img/x-financeiro.jpg" alt=""></div>
    <div class="it"><h3><span>📊</span>Financeiro</h3><p>Vendas, ticket médio e lucro do dia na tela inicial. Demonstrativo de resultado e contas a pagar pela foto do boleto.</p></div>
    <div class="it"><h3><span>📦</span>Estoque e CMV</h3><p>Ficha técnica, baixa na venda, entrada pela foto da nota e o relatório das perdas.</p></div>
    <div class="it"><h3><span>🏷️</span>Validade e etiquetas</h3><p>Etiqueta com QR e aviso do que está vencendo antes de virar prejuízo.</p></div>
    <div class="it"><h3><span>🧾</span>Nota fiscal (NFC-e)</h3><p>Emissão da nota do consumidor direto pelo sistema.</p></div>
    <div class="it"><h3><span>📈</span>Relatórios e caixa</h3><p>Fechamento do caixa, formas de pagamento, horários de pico e os produtos campeões de venda.</p></div>
  </div>
</section>
</body>
</html>
`;
