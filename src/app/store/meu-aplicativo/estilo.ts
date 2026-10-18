/** O CSS da tela Meu aplicativo (prefixo ma-). Escuro + amarelo-ouro do produto App; o vermelho FireHub só na ação principal. */
export const CSS = `
.ma { --ma-ouro: #FACC15; --ma-ouro-escuro: #CA8A04; --ma-tinta: #0F172A; --ma-t2: #475569; --ma-t3: #94A3B8; --ma-borda: #E2E8F0; --ma-fundo: #F8FAFC; --ma-marca: #C92E09; max-width: 1180px; margin: 0 auto; padding: 20px 16px 64px; box-sizing: border-box; color: var(--ma-tinta); }
.ma *, .ma *::before, .ma *::after { box-sizing: border-box; }
.ma-topo { display: flex; align-items: center; gap: 12px; }
.ma-topo-icone { width: 46px; height: 46px; border-radius: 13px; background: var(--ma-tinta); display: grid; place-items: center; flex-shrink: 0; box-shadow: 0 6px 16px rgba(15,23,42,.18); }
.ma-topo h1 { font-size: 24px; font-weight: 900; margin: 0; letter-spacing: -.01em; }
.ma-topo-sub { font-size: 13px; color: var(--ma-t2); }
.ma-selo-ativo { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; font-weight: 900; letter-spacing: .04em; color: #713F12; background: #FEF9C3; border: 1px solid #FDE047; padding: 3px 8px; border-radius: 999px; vertical-align: 3px; margin-left: 8px; }
.ma-grupo { margin-top: 10px; font-size: 12.5px; color: #1E3A8A; background: #EFF6FF; border: 1px solid #BFDBFE; border-radius: 10px; padding: 8px 12px; }
.ma-barra { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; margin: 18px 0 16px; border-bottom: 1px solid var(--ma-borda); flex-wrap: wrap; }
.ma-abas { display: flex; gap: 2px; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; max-width: 100%; }
.ma-aba { display: inline-flex; align-items: center; gap: 7px; padding: 11px 14px; border: none; background: none; font-weight: 800; font-size: .92rem; color: #64748B; cursor: pointer; border-bottom: 3px solid transparent; margin-bottom: -1px; white-space: nowrap; font-family: inherit; }
.ma-aba:hover { color: var(--ma-tinta); }
.ma-aba.ativa { color: var(--ma-tinta); border-bottom-color: var(--ma-ouro); }
.ma-periodos { display: inline-flex; background: #fff; border: 1px solid var(--ma-borda); border-radius: 10px; padding: 3px; margin-bottom: 8px; overflow-x: auto; max-width: 100%; scrollbar-width: none; }
.ma-periodo { border: none; background: none; padding: 6px 10px; border-radius: 7px; font-size: .78rem; font-weight: 800; color: #64748B; cursor: pointer; white-space: nowrap; font-family: inherit; }
.ma-periodo.ativo { background: var(--ma-tinta); color: #fff; }
.ma-pilha { display: grid; gap: 16px; }
.ma-cartao { background: #fff; border: 1px solid var(--ma-borda); border-radius: 16px; padding: 18px 20px; box-shadow: 0 1px 2px rgba(15,23,42,.04); min-width: 0; }
.ma-cartao h2 { margin: 0 0 4px; font-size: 1.02rem; font-weight: 900; display: flex; align-items: center; gap: 8px; }
.ma-cartao-sub { margin: 0 0 14px; font-size: .82rem; color: #64748B; line-height: 1.5; }
.ma-grade { display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); }
.ma-grade-2 { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
@media (max-width: 420px) { .ma-grade-2 { grid-template-columns: minmax(0, 1fr); } .ma-cartao { padding: 16px; } }
/* A faixa escura do topo */
.ma-hero { background: radial-gradient(120% 140% at 0% 0%, #1E293B 0%, #0F172A 60%); color: #fff; border-radius: 18px; padding: 18px 20px; display: grid; gap: 14px; grid-template-columns: minmax(200px, 1.2fr) repeat(3, minmax(0, 1fr)); align-items: stretch; box-shadow: 0 10px 30px rgba(15,23,42,.18); }
@media (max-width: 900px) { .ma-hero { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.ma-hero-item { min-width: 0; padding: 4px 0; }
.ma-hero-item + .ma-hero-item { border-left: 1px solid rgba(255,255,255,.08); padding-left: 16px; }
@media (max-width: 900px) { .ma-hero-item + .ma-hero-item { border-left: none; padding-left: 0; } }
.ma-hero-rotulo { display: flex; align-items: center; gap: 7px; font-size: .78rem; font-weight: 700; color: #CBD5E1; }
.ma-hero-valor { font-size: 2rem; font-weight: 900; line-height: 1.1; margin-top: 4px; font-variant-numeric: tabular-nums; }
.ma-hero-valor.ouro { color: var(--ma-ouro); font-size: 2.6rem; }
.ma-hero-det { font-size: .74rem; color: #94A3B8; margin-top: 2px; }
.ma-pulso { width: 10px; height: 10px; border-radius: 50%; background: #22C55E; box-shadow: 0 0 0 0 rgba(34,197,94,.6); animation: ma-pulso 1.8s infinite; flex-shrink: 0; }
@keyframes ma-pulso { 0% { box-shadow: 0 0 0 0 rgba(34,197,94,.55); } 70% { box-shadow: 0 0 0 9px rgba(34,197,94,0); } 100% { box-shadow: 0 0 0 0 rgba(34,197,94,0); } }
@media (prefers-reduced-motion: reduce) { .ma-pulso { animation: none; } .ma-esqueleto { animation: none !important; } }
/* Números com variação */
.ma-kpi { background: #fff; border: 1px solid var(--ma-borda); border-radius: 14px; padding: 14px 16px; min-width: 0; position: relative; overflow: hidden; }
.ma-kpi.app::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: var(--ma-ouro); }
.ma-kpi-rotulo { display: flex; align-items: center; gap: 6px; font-size: .78rem; font-weight: 700; color: #64748B; }
.ma-kpi-valor { font-size: 1.65rem; font-weight: 900; margin: 4px 0 6px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; letter-spacing: -.01em; }
.ma-var { display: inline-flex; align-items: center; gap: 4px; font-size: .74rem; font-weight: 800; padding: 2px 7px; border-radius: 999px; }
.ma-var.sobe { color: #047857; background: #D1FAE5; }
.ma-var.desce { color: #B91C1C; background: #FEE2E2; }
.ma-var.neutra { color: #64748B; background: #F1F5F9; font-weight: 700; }
.ma-var-suf { font-weight: 600; opacity: .8; }
/* "Se pagou" */
.ma-pagou { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 18px; align-items: center; }
@media (max-width: 560px) { .ma-pagou { grid-template-columns: minmax(0, 1fr); } }
.ma-pagou-x { font-size: 3.2rem; font-weight: 900; line-height: 1; color: var(--ma-tinta); background: linear-gradient(180deg, #FEF9C3, #FDE68A); border-radius: 16px; padding: 14px 20px; text-align: center; font-variant-numeric: tabular-nums; }
.ma-pagou-x small { display: block; font-size: .72rem; font-weight: 800; color: #713F12; letter-spacing: .03em; margin-top: 4px; }
.ma-pagou-linhas { display: grid; gap: 6px; font-size: .88rem; color: var(--ma-t2); }
.ma-pagou-linhas b { color: var(--ma-tinta); }
.ma-comparo { display: grid; gap: 6px; margin: 6px 0 2px; }
.ma-comparo div { display: grid; grid-template-columns: 112px minmax(0, 1fr) auto; gap: 8px; align-items: center; font-size: .76rem; color: #64748B; }
.ma-comparo i { display: block; height: 10px; border-radius: 5px; }
.ma-comparo b { color: var(--ma-tinta); font-variant-numeric: tabular-nums; }
.ma-taxa { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; font-size: .8rem; color: var(--ma-t2); }
.ma-taxa input { width: 58px; padding: 5px 7px; border: 1.5px solid #CBD5E1; border-radius: 8px; font: inherit; font-weight: 800; text-align: right; }
/* Destaques */
.ma-destaques { display: grid; gap: 10px; }
.ma-destaque { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 12px; align-items: start; padding: 12px 14px; border-radius: 12px; border: 1px solid var(--ma-borda); background: #fff; }
.ma-destaque-icone { width: 34px; height: 34px; border-radius: 10px; display: grid; place-items: center; }
.ma-destaque.ganha .ma-destaque-icone { background: #D1FAE5; color: #047857; }
.ma-destaque.perde .ma-destaque-icone { background: #FEE2E2; color: #B91C1C; }
.ma-destaque.neutro .ma-destaque-icone { background: #FEF9C3; color: #854D0E; }
.ma-destaque b { display: block; font-size: .95rem; }
.ma-destaque span { font-size: .82rem; color: var(--ma-t2); }
.ma-destaque .ma-acao { display: block; margin-top: 4px; color: #9A3412; font-weight: 700; }
/* Gráficos */
.ma-grafico { position: relative; width: 100%; touch-action: pan-y; }
.ma-eixo { font-size: 11px; fill: #94A3B8; font-variant-numeric: tabular-nums; }
.ma-legenda { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: .76rem; color: var(--ma-t2); margin-bottom: 8px; }
.ma-legenda span { display: inline-flex; align-items: center; gap: 6px; }
.ma-legenda i, .ma-dica i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; }
.ma-legenda i.tracejado, .ma-dica i.tracejado { height: 0; width: 14px; border-top: 2px dashed #94A3B8; border-radius: 0; }
.ma-dica { position: absolute; top: 4px; width: 180px; background: #0F172A; color: #fff; border-radius: 10px; padding: 8px 10px; font-size: .75rem; line-height: 1.55; pointer-events: none; box-shadow: 0 8px 20px rgba(15,23,42,.25); z-index: 2; }
.ma-dica i { margin-right: 6px; vertical-align: 0; }
.ma-dica-cinza { color: #94A3B8; }
.ma-grafico-vazio { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; font-size: .85rem; color: #64748B; padding: 20px; background: rgba(255,255,255,.7); }
.ma-funil { display: grid; gap: 8px; }
.ma-funil-linha { display: grid; grid-template-columns: 110px minmax(0, 1fr) 92px; gap: 10px; align-items: center; }
@media (max-width: 420px) { .ma-funil-linha { grid-template-columns: 82px minmax(0, 1fr) 78px; } }
.ma-funil-rotulo { font-size: .8rem; font-weight: 700; color: var(--ma-t2); }
.ma-funil-trilho { height: 22px; background: #F1F5F9; border-radius: 6px; overflow: hidden; }
.ma-funil-barra { height: 100%; border-radius: 6px; transition: width .4s ease; }
.ma-funil-valor { display: flex; gap: 6px; align-items: baseline; justify-content: flex-end; font-variant-numeric: tabular-nums; }
.ma-funil-valor span { font-size: .72rem; color: #64748B; }
.ma-calor-quadro { overflow-x: auto; }
.ma-calor { display: grid; gap: 3px; min-width: 420px; max-width: 900px; }
.ma-calor-hora { font-size: 10px; color: #94A3B8; text-align: center; }
.ma-calor-hora.melhor { color: #854D0E; font-weight: 900; }
.ma-calor-dia { font-size: 11px; color: #64748B; font-weight: 700; display: flex; align-items: center; }
.ma-calor-celula { height: 24px; border-radius: 4px; cursor: pointer; }
@media (max-width: 600px) { .ma-calor-celula { height: 18px; } }
.ma-calor-celula.foco { outline: 2px solid #0F172A; outline-offset: 1px; }
.ma-calor-rodape { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-top: 10px; font-size: .78rem; color: var(--ma-t2); }
.ma-calor-escala { display: inline-flex; align-items: center; gap: 3px; color: #94A3B8; }
.ma-calor-escala i { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
/* Tabela por canal */
.ma-tabela { width: 100%; border-collapse: separate; border-spacing: 0; font-size: .85rem; }
.ma-tabela th { text-align: right; font-size: .72rem; font-weight: 800; color: #64748B; text-transform: uppercase; letter-spacing: .03em; padding: 8px 10px; border-bottom: 1px solid var(--ma-borda); white-space: nowrap; }
.ma-tabela th:first-child, .ma-tabela td:first-child { text-align: left; }
.ma-tabela td { text-align: right; padding: 11px 10px; border-bottom: 1px solid #F1F5F9; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ma-tabela tr.app td { background: #FEFCE8; font-weight: 800; }
.ma-tabela tr.app td:first-child { border-radius: 10px 0 0 10px; }
.ma-tabela tr.app td:last-child { border-radius: 0 10px 10px 0; }
.ma-canal { display: inline-flex; align-items: center; gap: 8px; }
.ma-canal i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; }
.ma-barrinha { display: inline-block; width: 54px; height: 6px; background: #F1F5F9; border-radius: 3px; margin-left: 8px; vertical-align: 2px; overflow: hidden; }
.ma-barrinha b { display: block; height: 100%; border-radius: 3px; }
@media (max-width: 760px) {
  .ma-tabela thead { display: none; }
  .ma-tabela, .ma-tabela tbody, .ma-tabela tr, .ma-tabela td { display: block; width: 100%; }
  .ma-tabela tr { border: 1px solid var(--ma-borda); border-radius: 12px; padding: 8px 12px; margin-bottom: 10px; }
  .ma-tabela tr.app { background: #FEFCE8; border-color: #FDE047; }
  .ma-tabela tr.app td { background: none; }
  .ma-tabela td { display: flex; justify-content: space-between; padding: 5px 0; border: none; white-space: normal; }
  .ma-tabela td::before { content: attr(data-rotulo); color: #64748B; font-weight: 600; font-size: .78rem; }
  .ma-tabela td:first-child::before { content: none; }
  .ma-tabela td:first-child { font-size: .95rem; padding-bottom: 8px; }
}
/* Antes × depois */
.ma-ad { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
.ma-ad-col { border: 1px solid var(--ma-borda); border-radius: 12px; padding: 12px 14px; }
.ma-ad-col.depois { border-color: #FDE047; background: #FEFCE8; }
.ma-ad-col h3 { margin: 0 0 8px; font-size: .78rem; text-transform: uppercase; letter-spacing: .04em; color: #64748B; }
.ma-ad-num { font-size: 1.35rem; font-weight: 900; font-variant-numeric: tabular-nums; }
.ma-ad-num small { font-size: .74rem; color: #64748B; font-weight: 600; margin-left: 4px; }
.ma-explica { font-size: .78rem; color: #64748B; line-height: 1.5; margin-top: 10px; }
/* Estados */
.ma-vazio { text-align: center; padding: 26px 16px; color: #64748B; font-size: .88rem; line-height: 1.55; }
.ma-vazio b { display: block; color: var(--ma-tinta); font-size: 1rem; margin-bottom: 4px; }
.ma-vazio-icone { width: 48px; height: 48px; border-radius: 14px; background: #FEF9C3; color: #854D0E; display: grid; place-items: center; margin: 0 auto 10px; }
.ma-nota { background: #FFFBEB; border: 1px solid #FDE68A; color: #78350F; border-radius: 12px; padding: 12px 14px; font-size: .86rem; line-height: 1.5; }
.ma-esqueleto { background: linear-gradient(90deg, #EEF2F6 25%, #F8FAFC 50%, #EEF2F6 75%); background-size: 200% 100%; animation: ma-brilho 1.3s infinite linear; border-radius: 14px; }
@keyframes ma-brilho { from { background-position: 200% 0; } to { background-position: -200% 0; } }
.ma-botao { padding: 11px 18px; border-radius: 11px; border: none; background: var(--ma-tinta); color: #fff; font-weight: 800; font-size: .88rem; cursor: pointer; display: inline-flex; align-items: center; gap: 8px; font-family: inherit; }
.ma-botao:disabled { background: #E2E8F0; color: #94A3B8; cursor: not-allowed; }
.ma-botao.marca { background: var(--ma-marca); }
.ma-botao.marca:disabled { background: #E2E8F0; color: #94A3B8; }
.ma-botao-leve { padding: 8px 12px; border-radius: 10px; border: 1px solid #CBD5E1; background: #fff; color: #334155; font-weight: 700; font-size: .8rem; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; font-family: inherit; }
.ma-botao-leve:disabled { opacity: .55; cursor: wait; }
.ma-link { background: none; border: none; color: #1D4ED8; font-weight: 800; cursor: pointer; padding: 0; font: inherit; font-size: .82rem; }
.ma-plano { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); margin-top: 8px; }
.ma-plano span { display: block; font-size: .75rem; color: #64748B; font-weight: 700; }
.ma-plano b { font-size: .92rem; }
/* Notificações */
.ma-compor { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(0, 1fr); gap: 16px; align-items: start; }
@media (max-width: 900px) { .ma-compor { grid-template-columns: minmax(0, 1fr); } }
.ma-passo { display: flex; align-items: center; gap: 8px; font-size: .74rem; font-weight: 900; color: #64748B; text-transform: uppercase; letter-spacing: .05em; margin: 18px 0 8px; }
.ma-passo:first-child { margin-top: 0; }
.ma-passo em { font-style: normal; width: 20px; height: 20px; border-radius: 50%; background: var(--ma-tinta); color: var(--ma-ouro); display: grid; place-items: center; font-size: .7rem; }
.ma-chips { display: flex; flex-wrap: wrap; gap: 8px; }
.ma-chip { display: inline-flex; align-items: center; gap: 6px; padding: 8px 12px; border: 1.5px solid #CBD5E1; border-radius: 999px; background: #fff; font-size: .82rem; font-weight: 700; color: #334155; cursor: pointer; font-family: inherit; }
.ma-chip:hover { border-color: #64748B; }
.ma-chip.marcado { border-color: var(--ma-tinta); background: var(--ma-tinta); color: #fff; }
.ma-segmentos { display: grid; gap: 8px; grid-template-columns: repeat(auto-fill, minmax(176px, 1fr)); }
@media (max-width: 520px) { .ma-segmentos { grid-template-columns: repeat(2, minmax(0, 1fr)); } .ma-segmento span { display: none; } }
.so-celular { display: none; }
@media (max-width: 900px) { .so-celular { display: block; } .so-computador { display: none; } }
.ma-segmento { text-align: left; border: 1.5px solid var(--ma-borda); border-radius: 12px; padding: 10px 12px; background: #fff; cursor: pointer; font-family: inherit; display: grid; gap: 2px; min-width: 0; }
.ma-segmento:hover { border-color: #94A3B8; }
.ma-segmento.marcado { border-color: var(--ma-tinta); box-shadow: 0 0 0 1px var(--ma-tinta); background: #F8FAFC; }
.ma-segmento:disabled { opacity: .5; cursor: not-allowed; }
.ma-segmento b { font-size: .84rem; color: var(--ma-tinta); }
.ma-segmento span { font-size: .72rem; color: #64748B; line-height: 1.35; }
.ma-segmento strong { font-size: 1.15rem; font-weight: 900; color: var(--ma-tinta); font-variant-numeric: tabular-nums; }
.ma-campo { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1.5px solid #CBD5E1; font-size: .92rem; outline: none; font-family: inherit; background: #fff; color: var(--ma-tinta); }
.ma-campo:focus { border-color: var(--ma-tinta); }
.ma-rotulo { display: flex; justify-content: space-between; font-size: .8rem; font-weight: 800; color: #334155; margin: 12px 0 6px; }
.ma-rotulo small { font-weight: 700; color: #94A3B8; }
.ma-rotulo small.passou { color: #B45309; }
.ma-produtos { margin-top: 6px; max-height: 210px; overflow-y: auto; border: 1.5px solid #CBD5E1; border-radius: 10px; padding: 4px; display: grid; gap: 2px; }
.ma-produto { display: flex; align-items: center; gap: 10px; width: 100%; padding: 6px 8px; border: 1.5px solid transparent; border-radius: 8px; background: #fff; cursor: pointer; text-align: left; font-family: inherit; }
.ma-produto:hover { background: #F8FAFC; }
.ma-produto.marcado { border-color: var(--ma-tinta); background: #F8FAFC; }
.ma-produto-foto { width: 38px; height: 38px; border-radius: 8px; object-fit: cover; flex-shrink: 0; }
.ma-produto-sem-foto { display: grid; place-items: center; background: #F1F5F9; color: #94A3B8; }
.ma-produto-nome { flex: 1; min-width: 0; font-size: .86rem; font-weight: 700; color: var(--ma-tinta); overflow-wrap: anywhere; }
.ma-produto-preco { font-size: .8rem; color: #475569; white-space: nowrap; }
.ma-ia { border: 1px dashed #C4B5FD; background: #FAF5FF; border-radius: 12px; padding: 10px 12px; margin-top: 10px; display: grid; gap: 8px; }
.ma-ia-variacao { text-align: left; border: 1px solid #DDD6FE; background: #fff; border-radius: 10px; padding: 8px 10px; cursor: pointer; font-family: inherit; }
.ma-ia-variacao:hover { border-color: #7C3AED; }
.ma-ia-variacao b { display: block; font-size: .86rem; color: var(--ma-tinta); }
.ma-ia-variacao span { font-size: .8rem; color: #475569; }
.ma-checklist { display: grid; gap: 6px; margin-top: 12px; }
.ma-check { display: flex; gap: 8px; align-items: flex-start; font-size: .8rem; line-height: 1.4; color: var(--ma-t2); }
.ma-check svg { flex-shrink: 0; margin-top: 1px; }
.ma-check.atencao { color: #92400E; }
.ma-check.bom { color: #065F46; }
.ma-previa { position: sticky; top: 16px; display: grid; gap: 14px; }
@media (max-width: 900px) { .ma-previa { position: static; order: -1; } }
.ma-celular { width: 248px; max-width: 100%; aspect-ratio: 9 / 18.5; margin: 0 auto; border-radius: 36px; background: #0F172A; padding: 10px; box-shadow: 0 18px 40px rgba(15,23,42,.28), inset 0 0 0 2px #334155; position: relative; }
.ma-celular::before { content: ""; position: absolute; top: 18px; left: 50%; transform: translateX(-50%); width: 70px; height: 18px; border-radius: 12px; background: #020617; z-index: 1; }
.ma-tela { height: 100%; border-radius: 28px; background: linear-gradient(165deg, #475569, #1E293B 55%, #0F172A); padding: 46px 10px 10px; overflow: hidden; }
.ma-hora { text-align: center; color: #fff; font-size: 46px; font-weight: 300; line-height: 1; }
.ma-data { text-align: center; color: #CBD5E1; font-size: 12px; margin: 6px 0 18px; }
.ma-notif { background: rgba(255,255,255,.93); border-radius: 16px; padding: 10px 11px; box-shadow: 0 6px 16px rgba(0,0,0,.18); }
.ma-notif-topo { display: flex; align-items: center; gap: 6px; margin-bottom: 4px; }
.ma-notif-icone { width: 18px; height: 18px; border-radius: 5px; object-fit: cover; }
.ma-notif-icone-vazio { display: grid; place-items: center; background: #0F172A; }
.ma-notif-app { font-size: 11px; font-weight: 700; color: #334155; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; text-transform: uppercase; letter-spacing: .02em; }
.ma-notif-agora { font-size: 11px; color: #64748B; }
.ma-notif-titulo { font-size: 13px; font-weight: 800; color: #0F172A; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; }
.ma-notif-texto { font-size: 12.5px; color: #334155; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
@media (max-width: 900px) {
  .ma-celular { aspect-ratio: auto; height: 300px; border-radius: 34px 34px 0 0; padding-bottom: 0; }
  .ma-tela { border-radius: 26px 26px 0 0; padding-top: 40px; }
  .ma-hora { font-size: 38px; }
}
.ma-aprende { border-radius: 14px; padding: 14px; background: linear-gradient(160deg, #0F172A, #1E293B); color: #E2E8F0; }
.ma-aprende h3 { margin: 0 0 8px; font-size: .9rem; color: #fff; display: flex; align-items: center; gap: 8px; }
.ma-aprende ul { margin: 0; padding-left: 18px; display: grid; gap: 6px; font-size: .8rem; line-height: 1.45; }
.ma-aprende .ma-barra-aprende { height: 6px; background: rgba(255,255,255,.12); border-radius: 3px; overflow: hidden; margin: 8px 0 4px; }
.ma-aprende .ma-barra-aprende b { display: block; height: 100%; background: var(--ma-ouro); }
.ma-envios { display: grid; gap: 10px; }
.ma-envio { border: 1px solid var(--ma-borda); border-radius: 14px; padding: 14px; min-width: 0; background: #fff; }
.ma-envio.top { border-color: #FDE047; box-shadow: 0 0 0 1px #FDE047; }
.ma-envio-cabeca { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: .76rem; color: #64748B; }
.ma-selo { font-size: .7rem; font-weight: 900; padding: 3px 8px; border-radius: 999px; }
.ma-envio-titulo { font-weight: 900; margin-top: 8px; overflow-wrap: anywhere; }
.ma-envio-texto { color: #475569; font-size: .85rem; white-space: pre-wrap; overflow-wrap: anywhere; }
.ma-envio-numeros { display: grid; grid-template-columns: repeat(auto-fit, minmax(96px, 1fr)); gap: 8px; margin-top: 12px; }
.ma-envio-num { background: var(--ma-fundo); border-radius: 10px; padding: 8px 10px; min-width: 0; }
.ma-envio-num span { display: block; font-size: .68rem; color: #64748B; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; }
.ma-envio-num b { font-size: 1.02rem; font-variant-numeric: tabular-nums; }
.ma-envio-num small { font-size: .72rem; color: #64748B; margin-left: 4px; }
.ma-envio-num small.bloco { display: block; margin-left: 0; }
.ma-envio-num.bom b { color: #047857; }
.ma-envio-num.ruim b { color: #B91C1C; }
.ma-envio-rodape { display: flex; justify-content: space-between; gap: 8px; flex-wrap: wrap; margin-top: 10px; font-size: .74rem; color: #94A3B8; }
.ma-fundo { position: fixed; inset: 0; background: rgba(15,23,42,.55); z-index: 1200; display: grid; place-items: center; padding: 16px; }
.ma-modal { background: #fff; border-radius: 18px; padding: 20px; width: min(480px, 100%); max-height: calc(100vh - 32px); overflow-y: auto; box-shadow: 0 24px 60px rgba(15,23,42,.35); }
/* Celular — no fim de propósito: vence as regras de cima. */
@media (max-width: 520px) {
  .ma-grade { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .ma-kpi { padding: 12px; }
  .ma-kpi-valor { font-size: 1.22rem; }
  .ma-var-suf { display: none; }
  .ma-aba { padding: 10px 9px; font-size: .84rem; gap: 5px; }
  .ma-aba svg { display: none; }
  .ma { padding: 16px 12px 56px; }
  .ma-hero { padding: 16px; gap: 12px; }
  .ma-hero-valor { font-size: 1.6rem; }
  .ma-hero-valor.ouro { font-size: 2.1rem; }
}
`;
