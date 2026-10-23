/**
 * O visual do perfil da loja e do relatório da carteira — um CSS só para o
 * portal do vendedor (areia e tinta, como o PortalDoParceiro) e para o admin
 * (`.pf-admin`, cinza-azulado como o resto do painel). Tudo com prefixo `pf-`.
 */
export const ESTILO_DO_PERFIL = `
.pf {
  --pf-fundo: #F3EEE5; --pf-papel: #FFFDF9; --pf-papel-2: #F9F4EC; --pf-linha: #E7DDCD; --pf-linha-forte: #D8CAB4;
  --pf-tinta: #1C1917; --pf-tinta-2: #44403C; --pf-cinza: #6F675E; --pf-laranja: #E8360C; --pf-laranja-escuro: #C92E09;
  --pf-ok: #15803D; --pf-ok-bg: #E3F4E7; --pf-ok-forte: #22A55A;
  --pf-alerta: #9A5B06; --pf-alerta-bg: #FBF0D9; --pf-alerta-forte: #E8A317;
  --pf-erro: #B91C1C; --pf-erro-bg: #FCE8E6; --pf-erro-forte: #E5484D;
  --pf-novo: #1D4ED8; --pf-novo-bg: #E3EBFD; --pf-novo-forte: #3B82F6;
  --pf-ligado: #0E7490; --pf-ligado-bg: #DDF3F7;
  --pf-neutro: #57534E; --pf-neutro-bg: #EFE8DD; --pf-neutro-forte: #B0A699;
  --pf-venda: #6D28D9; --pf-venda-bg: #EFE9FD;
  color: var(--pf-tinta); font-size: 14px; line-height: 1.45;
}
.pf.pf-admin {
  --pf-fundo: #F6F7F9; --pf-papel: #FFFFFF; --pf-papel-2: #F8FAFC; --pf-linha: #E5E7EB; --pf-linha-forte: #CBD5E1;
  --pf-tinta: #0F172A; --pf-tinta-2: #334155; --pf-cinza: #64748B; --pf-neutro: #475569; --pf-neutro-bg: #F1F5F9; --pf-neutro-forte: #CBD5E1;
}
.pf *, .pf *::before, .pf *::after { box-sizing: border-box; }
.pf :focus-visible { outline: 2px solid var(--pf-laranja); outline-offset: 2px; }
.pf-num { font-variant-numeric: tabular-nums; }
.pf h2, .pf h3, .pf h4 { margin: 0; }

/* ── Peças ── */
.pf-painel { background: var(--pf-papel); border: 1px solid var(--pf-linha); border-radius: 16px; box-shadow: 0 1px 2px rgba(28,25,23,.04); }
.pf-painel-cab { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px 14px; flex-wrap: wrap; padding: 16px 18px 10px; }
.pf-h { font-size: 1rem; font-weight: 800; letter-spacing: -0.01em; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.pf-h small { font-size: 0.76rem; font-weight: 600; color: var(--pf-cinza); letter-spacing: 0; }
.pf-sub { margin: 3px 0 0; color: var(--pf-cinza); font-size: 0.82rem; max-width: 70ch; }
.pf-rotulo { display: block; font-size: 0.72rem; font-weight: 700; color: var(--pf-cinza); text-transform: uppercase; letter-spacing: .04em; }

.pf-pilula { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; font-size: 0.76rem; font-weight: 800; white-space: nowrap; }
.pf-pilula i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; background: currentColor; }
.pf-st-ATIVA { background: var(--pf-ok-bg); color: var(--pf-ok); }
.pf-st-ESFRIANDO { background: var(--pf-alerta-bg); color: var(--pf-alerta); }
.pf-st-PARADA { background: var(--pf-erro-bg); color: var(--pf-erro); }
.pf-st-NOVA { background: var(--pf-novo-bg); color: var(--pf-novo); }
.pf-es-USANDO { background: var(--pf-ok-bg); color: var(--pf-ok); }
.pf-es-LIGADO { background: var(--pf-ligado-bg); color: var(--pf-ligado); }
.pf-es-PARADO { background: var(--pf-alerta-bg); color: var(--pf-alerta); }
.pf-es-NUNCA { background: var(--pf-neutro-bg); color: var(--pf-neutro); }
.pf-tag { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 999px; font-size: 0.7rem; font-weight: 800; white-space: nowrap; }
.pf-tag.venda { background: var(--pf-venda-bg); color: var(--pf-venda); }
.pf-tag.adocao { background: var(--pf-ligado-bg); color: var(--pf-ligado); }
.pf-tend { display: inline-flex; align-items: center; gap: 3px; font-size: 0.76rem; font-weight: 800; }
.pf-tend.sobe { color: var(--pf-ok); } .pf-tend.cai { color: var(--pf-erro); } .pf-tend.igual { color: var(--pf-cinza); }

.pf-botao { display: inline-flex; align-items: center; justify-content: center; gap: 6px; border-radius: 9px; padding: 8px 12px; font: inherit; font-size: 0.8rem; font-weight: 700; cursor: pointer; text-decoration: none; white-space: nowrap; border: 1px solid var(--pf-linha-forte); background: var(--pf-papel); color: var(--pf-tinta); transition: background .15s, border-color .15s, transform .1s; }
.pf-botao:hover:not(:disabled) { background: var(--pf-papel-2); border-color: var(--pf-cinza); }
.pf-botao:active:not(:disabled) { transform: scale(.97); }
.pf-botao:disabled { opacity: .55; cursor: default; }
.pf-botao.escuro { background: var(--pf-tinta); border-color: var(--pf-tinta); color: #fff; }
.pf-botao.escuro:hover:not(:disabled) { background: #2A2622; }
.pf-botao.whats { background: #E6F6EB; border-color: #BCE3C8; color: #14532D; }
.pf-botao.pequeno { padding: 5px 9px; font-size: 0.74rem; border-radius: 8px; }
.pf-botao.fantasma { background: transparent; border-color: transparent; }
.pf-botao.fantasma:hover:not(:disabled) { background: var(--pf-papel-2); border-color: var(--pf-linha); }

.pf-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.pf-chip { border: 1px solid var(--pf-linha-forte); background: var(--pf-papel); color: var(--pf-tinta-2); border-radius: 999px; padding: 5px 11px; font: inherit; font-size: 0.78rem; font-weight: 700; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; transition: background .15s, border-color .15s; }
.pf-chip span { color: var(--pf-cinza); font-weight: 600; }
.pf-chip:hover { border-color: var(--pf-cinza); }
.pf-chip.on { background: var(--pf-tinta); border-color: var(--pf-tinta); color: #fff; }
.pf-chip.on span { color: #D6D3D1; }

/* ── Gaveta ── */
.pf-gaveta-fundo { position: fixed; inset: 0; background: rgba(15,12,10,.42); z-index: 1000; display: flex; justify-content: flex-end; animation: pf-aparece .18s ease-out; }
.pf-gaveta { width: min(820px, 100vw); height: 100%; background: var(--pf-fundo); overflow-y: auto; overscroll-behavior: contain; box-shadow: -18px 0 40px -12px rgba(0,0,0,.25); animation: pf-entra .24s cubic-bezier(.2,.8,.2,1); }
@keyframes pf-aparece { from { opacity: 0; } }
@keyframes pf-entra { from { transform: translateX(32px); opacity: .4; } }
.pf-gaveta-topo { position: sticky; top: 0; z-index: 2; display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 14px; background: var(--pf-tinta); color: #FAFAF9; }
.pf-gaveta-topo strong { font-size: 0.86rem; }
.pf-fechar { background: #2A2622; color: #FAFAF9; border: 1px solid #3A3531; border-radius: 8px; width: 34px; height: 34px; display: grid; place-items: center; cursor: pointer; }
.pf-fechar:hover { background: #3A3531; }
.pf-esqueleto { padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.pf-esqueleto div { background: linear-gradient(90deg, var(--pf-linha) 0%, var(--pf-papel-2) 50%, var(--pf-linha) 100%); background-size: 200% 100%; animation: pf-brilho 1.2s linear infinite; border-radius: 14px; }
@keyframes pf-brilho { to { background-position: -200% 0; } }
.pf-gira { animation: pf-gira 0.9s linear infinite; }
@keyframes pf-gira { to { transform: rotate(360deg); } }

/* ── Perfil ── */
.pf-perfil { padding: 16px; display: flex; flex-direction: column; gap: 14px; }
.pf-cab { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 14px; align-items: center; }
.pf-logo { width: 54px; height: 54px; border-radius: 14px; object-fit: cover; background: var(--pf-papel); border: 1px solid var(--pf-linha); display: grid; place-items: center; font-weight: 900; font-size: 1.3rem; color: var(--pf-laranja); }
.pf-nome { font-size: 1.35rem; font-weight: 900; letter-spacing: -0.02em; line-height: 1.15; overflow-wrap: anywhere; }
.pf-cab-info { color: var(--pf-cinza); font-size: 0.8rem; margin-top: 3px; display: flex; flex-wrap: wrap; gap: 2px 10px; }
.pf-cab-acoes { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }
.pf-faixa { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 12px; align-items: center; padding: 14px 16px; border-radius: 16px; border: 1px solid transparent; }
.pf-faixa.pf-st-ATIVA { border-color: #BFE3C9; } .pf-faixa.pf-st-ESFRIANDO { border-color: #F1D9A6; } .pf-faixa.pf-st-PARADA { border-color: #F3C4BF; } .pf-faixa.pf-st-NOVA { border-color: #C3D3FA; }
.pf-faixa-icone { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; background: rgba(255,255,255,.65); }
.pf-faixa strong { font-size: 1.02rem; font-weight: 900; display: block; }
.pf-faixa p { margin: 1px 0 0; color: var(--pf-tinta-2); font-size: 0.86rem; }
.pf-faixa .pf-sinal { color: var(--pf-cinza); font-size: 0.76rem; margin-top: 4px; }

.pf-kpis { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 10px; }
.pf-kpi { background: var(--pf-papel); border: 1px solid var(--pf-linha); border-radius: 14px; padding: 12px 14px; min-width: 0; }
.pf-kpi-val { font-size: 1.45rem; font-weight: 900; letter-spacing: -0.02em; margin: 2px 0 1px; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.pf-kpi-sub { font-size: 0.74rem; color: var(--pf-cinza); display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.pf-kpi.clicavel { cursor: pointer; text-align: left; font: inherit; color: inherit; transition: border-color .15s, box-shadow .15s; }
.pf-kpi.clicavel:hover { border-color: var(--pf-linha-forte); box-shadow: 0 4px 14px -8px rgba(0,0,0,.2); }
.pf-kpi.clicavel.on { border-color: var(--pf-tinta); box-shadow: inset 0 0 0 1px var(--pf-tinta); }

.pf-barra { display: flex; height: 14px; border-radius: 999px; overflow: hidden; background: var(--pf-neutro-bg); gap: 2px; }
.pf-barra span { display: block; height: 100%; min-width: 4px; }
.pf-canais { padding: 0 18px 16px; }
.pf-canais ul { list-style: none; margin: 12px 0 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 6px 14px; }
.pf-canais li { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 8px; align-items: baseline; font-size: 0.82rem; padding: 4px 0; border-bottom: 1px dashed var(--pf-linha); }
.pf-canais li i { width: 10px; height: 10px; border-radius: 3px; display: inline-block; align-self: center; }
.pf-canais li b { font-variant-numeric: tabular-nums; }
.pf-canais li small { grid-column: 2 / -1; color: var(--pf-cinza); font-size: 0.74rem; margin-top: -3px; }

.pf-ops { list-style: none; margin: 0; padding: 0 12px 12px; display: flex; flex-direction: column; gap: 8px; counter-reset: op; }
.pf-op { border: 1px solid var(--pf-linha); border-radius: 14px; padding: 12px 14px; background: var(--pf-papel); display: grid; grid-template-columns: auto minmax(0,1fr); gap: 4px 12px; }
.pf-op-n { grid-row: span 3; width: 30px; height: 30px; border-radius: 9px; background: var(--pf-tinta); color: #fff; display: grid; place-items: center; font-weight: 900; font-size: 0.86rem; }
.pf-op.adocao .pf-op-n { background: var(--pf-ligado); }
.pf-op-cab { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
.pf-op-cab strong { font-size: 0.95rem; }
.pf-op-motivo { margin: 0; color: var(--pf-tinta-2); font-size: 0.84rem; }
.pf-argumento { margin: 4px 0 0; padding: 9px 12px; border-left: 3px solid var(--pf-laranja); background: var(--pf-papel-2); border-radius: 0 10px 10px 0; font-size: 0.84rem; color: var(--pf-tinta); display: flex; gap: 10px; align-items: flex-start; justify-content: space-between; }
.pf-argumento q { quotes: "“" "”"; font-style: italic; }
.pf-vazio { padding: 20px 18px 22px; color: var(--pf-cinza); text-align: center; font-size: 0.86rem; }

.pf-recursos { padding: 0 12px 12px; display: flex; flex-direction: column; gap: 12px; }
.pf-grupo h4 { font-size: 0.74rem; font-weight: 800; color: var(--pf-cinza); text-transform: uppercase; letter-spacing: .05em; padding: 0 6px 6px; }
.pf-grupo ul { list-style: none; margin: 0; padding: 0; border: 1px solid var(--pf-linha); border-radius: 12px; overflow: hidden; background: var(--pf-papel); }
.pf-rec { display: grid; grid-template-columns: minmax(0, 1.1fr) auto minmax(0, 1.6fr); gap: 4px 12px; align-items: center; padding: 9px 12px; border-top: 1px solid var(--pf-linha); }
.pf-grupo li:first-child { border-top: none; }
.pf-rec-nome { font-weight: 700; font-size: 0.85rem; display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.pf-rec-ev { font-size: 0.8rem; color: var(--pf-tinta-2); }
.pf-rec.NUNCA .pf-rec-ev { color: var(--pf-cinza); }

.pf-ativacao { list-style: none; margin: 0; padding: 0 18px 16px; display: flex; flex-direction: column; gap: 6px; }
.pf-ativacao li { display: grid; grid-template-columns: auto minmax(0,1fr) auto; gap: 10px; align-items: center; font-size: 0.86rem; padding: 6px 0; border-bottom: 1px dashed var(--pf-linha); }
.pf-ativacao li.feito { color: var(--pf-cinza); }
.pf-ativacao li.feito span { text-decoration: line-through; text-decoration-color: var(--pf-neutro-forte); }
.pf-ativacao small { color: var(--pf-cinza); font-size: 0.76rem; }
.pf-progresso { height: 8px; border-radius: 999px; background: var(--pf-neutro-bg); overflow: hidden; margin: 0 18px 10px; }
.pf-progresso span { display: block; height: 100%; background: var(--pf-novo-forte); border-radius: 999px; transition: width .4s ease; }

.pf-duas { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 14px; align-items: start; }
.pf-lista-simples { list-style: none; margin: 0; padding: 0 18px 14px; }
.pf-lista-simples li { display: flex; justify-content: space-between; gap: 10px; padding: 8px 0; border-bottom: 1px dashed var(--pf-linha); font-size: 0.85rem; align-items: baseline; }
.pf-lista-simples li:last-child { border-bottom: none; }
.pf-lista-simples li span { color: var(--pf-tinta-2); }
.pf-lista-simples li b { font-variant-numeric: tabular-nums; text-align: right; }
.pf-lista-simples li .fraco { color: var(--pf-cinza); font-weight: 600; }

/* ── Relatório da carteira ── */
.pf-relatorio { display: flex; flex-direction: column; gap: 16px; }
.pf-rel-cab { display: flex; justify-content: space-between; align-items: flex-end; gap: 10px 16px; flex-wrap: wrap; }
.pf-rel-cab h2 { font-size: 1.25rem; font-weight: 900; letter-spacing: -0.02em; }
.pf-rel-acoes { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.pf-rel-acoes select { font: inherit; font-size: 0.82rem; font-weight: 600; color: var(--pf-tinta); background: var(--pf-papel); border: 1px solid var(--pf-linha-forte); border-radius: 9px; padding: 7px 10px; cursor: pointer; max-width: 240px; }
.pf-rel-kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 10px; }
.pf-rel-kpis .pf-kpi-val { font-size: 1.3rem; }
.pf-kpi-val.dinheiro { font-size: 1.12rem; white-space: nowrap; overflow-wrap: normal; padding-top: 3px; }
.pf-tend { white-space: nowrap; }
.pf-nowrap { white-space: nowrap; }
.pf-ponto { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }

.pf-risco { list-style: none; margin: 0; padding: 0 10px 10px; }
.pf-risco li { display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 4px 12px; padding: 10px 8px; border-top: 1px solid var(--pf-linha); align-items: center; }
.pf-risco li:first-child { border-top: none; }
.pf-risco-nome { font-weight: 800; font-size: 0.9rem; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; background: none; border: none; padding: 0; font: inherit; color: inherit; cursor: pointer; text-align: left; }
.pf-risco-nome:hover { color: var(--pf-laranja-escuro); }
.pf-risco p { margin: 2px 0 0; font-size: 0.8rem; color: var(--pf-tinta-2); }
.pf-risco-perda { text-align: right; font-size: 0.78rem; color: var(--pf-cinza); }
.pf-risco-perda b { display: block; color: var(--pf-erro); font-size: 0.92rem; font-variant-numeric: tabular-nums; }
.pf-risco-acoes { grid-column: 1 / -1; display: flex; gap: 6px; flex-wrap: wrap; }

.pf-produtos { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 10px; padding: 0 14px 14px; }
.pf-produto { border: 1px solid var(--pf-linha); border-radius: 14px; background: var(--pf-papel); overflow: hidden; display: flex; flex-direction: column; }
.pf-produto > button { all: unset; cursor: pointer; padding: 12px 14px; display: grid; grid-template-columns: minmax(0,1fr) auto; gap: 4px 10px; align-items: center; }
.pf-produto > button:hover { background: var(--pf-papel-2); }
.pf-produto > button:focus-visible { outline: 2px solid var(--pf-laranja); outline-offset: -2px; }
.pf-produto-n { font-size: 1.9rem; font-weight: 900; letter-spacing: -0.03em; line-height: 1; font-variant-numeric: tabular-nums; }
.pf-produto-nome { font-weight: 800; font-size: 0.9rem; }
.pf-produto-frase { grid-column: 1 / -1; font-size: 0.78rem; color: var(--pf-cinza); display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.pf-produto ul { list-style: none; margin: 0; padding: 0 10px 10px; border-top: 1px solid var(--pf-linha); max-height: 300px; overflow-y: auto; }
.pf-produto li { padding: 8px 4px; border-bottom: 1px dashed var(--pf-linha); font-size: 0.8rem; }
.pf-produto li:last-child { border-bottom: none; }
.pf-produto li button { all: unset; cursor: pointer; font-weight: 800; color: var(--pf-tinta); }
.pf-produto li button:hover { color: var(--pf-laranja-escuro); text-decoration: underline; }
.pf-produto li p { margin: 1px 0 0; color: var(--pf-tinta-2); }

.pf-ferramentas { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding: 0 18px 12px; }
.pf-busca { display: flex; align-items: center; gap: 8px; background: var(--pf-papel); border: 1px solid var(--pf-linha-forte); border-radius: 10px; padding: 0 10px; width: min(300px, 100%); color: var(--pf-cinza); }
.pf-busca:focus-within { border-color: var(--pf-laranja); box-shadow: 0 0 0 3px rgba(232,54,12,.12); }
.pf-busca input { border: none; outline: none; background: transparent; font: inherit; color: var(--pf-tinta); padding: 8px 0; flex: 1; min-width: 0; }
.pf-tabela-rolagem { overflow-x: auto; }
.pf-tabela { width: 100%; border-collapse: collapse; font-size: 0.83rem; }
.pf-tabela th { text-align: left; font-size: 0.7rem; font-weight: 800; color: var(--pf-cinza); text-transform: uppercase; letter-spacing: .04em; padding: 8px 12px; background: var(--pf-papel-2); border-top: 1px solid var(--pf-linha); border-bottom: 1px solid var(--pf-linha); white-space: nowrap; }
.pf-tabela td { padding: 10px 12px; border-bottom: 1px solid var(--pf-linha); vertical-align: middle; }
.pf-tabela tr:last-child td { border-bottom: none; }
.pf-tabela tbody tr { cursor: pointer; transition: background .12s; }
.pf-tabela tbody tr:hover td { background: var(--pf-papel-2); }
.pf-tabela .dir { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.pf-pos { width: 26px; height: 26px; border-radius: 8px; display: inline-grid; place-items: center; font-weight: 900; font-size: 0.76rem; background: var(--pf-neutro-bg); color: var(--pf-tinta-2); }
.pf-pos.ouro { background: #FCEFC7; color: #8A5A00; }
.pf-mini-barra { height: 6px; border-radius: 999px; background: var(--pf-neutro-bg); margin-top: 4px; overflow: hidden; min-width: 80px; }
.pf-mini-barra span { display: block; height: 100%; background: var(--pf-laranja); border-radius: 999px; }
.pf-loja-cel { display: flex; flex-direction: column; gap: 2px; min-width: 160px; }
.pf-loja-cel strong { font-size: 0.88rem; }
.pf-loja-cel small { color: var(--pf-cinza); font-size: 0.74rem; }
.pf-ops-mini { display: flex; gap: 4px; flex-wrap: wrap; max-width: 280px; }

.pf-novas { list-style: none; margin: 0; padding: 0 10px 10px; }
.pf-novas li { padding: 10px 8px; border-top: 1px solid var(--pf-linha); display: flex; flex-direction: column; gap: 5px; }
.pf-novas li:first-child { border-top: none; }
.pf-novas-topo { display: flex; justify-content: space-between; gap: 8px; align-items: center; flex-wrap: wrap; }
.pf-falta { display: flex; flex-wrap: wrap; gap: 4px; }
.pf-falta span { font-size: 0.72rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--pf-alerta-bg); color: var(--pf-alerta); }
.pf-falta span.ok { background: var(--pf-ok-bg); color: var(--pf-ok); }

.pf-erro-caixa { padding: 16px 18px; border-radius: 14px; background: var(--pf-erro-bg); color: #7F1D1D; border: 1px solid #F3C4BF; display: flex; gap: 10px; align-items: center; justify-content: space-between; flex-wrap: wrap; }

/* ── Selo do cardápio (bem evidente: verde × vermelho cheio) ── */
.pf-selo-cardapio { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px 2px 7px; border-radius: 6px; font-size: 0.7rem; font-weight: 900; letter-spacing: .02em; white-space: nowrap; border: 1.5px solid; line-height: 1.35; }
.pf-selo-cardapio em { font-style: normal; font-weight: 700; opacity: .9; padding-left: 6px; border-left: 1px solid currentColor; text-transform: none; letter-spacing: 0; }
.pf-selo-cardapio.sim { background: #E3F4E7; color: #14532D; border-color: #22A55A; }
.pf-selo-cardapio.nao { background: #B91C1C; color: #fff; border-color: #7F1D1D; text-transform: uppercase; }
.pf-selo-cardapio.grande { font-size: 0.8rem; padding: 4px 10px; border-radius: 8px; }
.pf-selo-cardapio.mini { font-size: 0.64rem; padding: 0 6px; }
.pf-cab-selos { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
.pf-alerta-cardapio { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: 14px; background: #FDECEA; border: 1.5px solid #B91C1C; color: #7F1D1D; }
.pf-alerta-cardapio svg { flex-shrink: 0; margin-top: 1px; }
.pf-alerta-cardapio strong { display: block; font-size: 0.92rem; }
.pf-alerta-cardapio p { margin: 2px 0 0; font-size: 0.82rem; }
.pf-criterio { margin: 0; font-size: 0.78rem; color: var(--pf-tinta-2); display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding: 8px 12px; border-radius: 10px; background: var(--pf-papel); border: 1px solid var(--pf-linha); }
.pf-kpi.kpi-cardapio.tem { border-color: #E7A39C; }
.pf-kpi.kpi-cardapio.tem .pf-kpi-val { color: #B91C1C; }
.pf-chip.chip-sem-cardapio.on { background: #B91C1C; border-color: #B91C1C; }
.pf-produto-loja { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }

/* ── Abas da gaveta (Perfil × Linha do tempo), presas no topo ── */
.pf-gaveta-cabeca { position: sticky; top: 0; z-index: 3; }
.pf-gaveta-abas { display: flex; gap: 2px; background: var(--pf-papel); border-bottom: 1px solid var(--pf-linha-forte); padding: 0 10px; overflow-x: auto; box-shadow: 0 2px 8px -5px rgba(28,25,23,.3); }
.pf-gaveta-abas button { background: none; border: none; border-bottom: 3px solid transparent; padding: 10px 12px 9px; font: inherit; font-size: 0.84rem; font-weight: 800; color: var(--pf-cinza); cursor: pointer; display: inline-flex; gap: 7px; align-items: center; white-space: nowrap; }
.pf-gaveta-abas button:hover { color: var(--pf-tinta); }
.pf-gaveta-abas button.on { color: var(--pf-tinta); border-bottom-color: var(--pf-tinta); }
.pf-gaveta-abas button span { font-size: 0.7rem; background: var(--pf-neutro-bg); color: var(--pf-tinta-2); border-radius: 999px; padding: 1px 7px; }
.pf-ponto-alerta { width: 8px; height: 8px; border-radius: 50%; background: #B91C1C; display: inline-block; }

/* ── Contraste no tema areia (Douglas, 18/10/2026: "fica tudo muito branquinho,
   muito liso, a pessoa fica perdida") — fundo mais fundo, blocos com borda e
   cabeçalho em faixa, título forte. O tema admin não muda. ── */
.pf:not(.pf-admin) { --pf-fundo: #E9E2D5; --pf-papel-2: #F4EEE4; --pf-linha: #DCCFBB; --pf-linha-forte: #C2B196; --pf-cinza: #5F574D; --pf-neutro-bg: #E8DFD1; }
.pf:not(.pf-admin) .pf-painel { border-color: var(--pf-linha-forte); box-shadow: 0 1px 0 rgba(28,25,23,.05), 0 6px 16px -10px rgba(28,25,23,.24); }
.pf:not(.pf-admin) .pf-painel-cab { background: #F1EADE; border-bottom: 1px solid var(--pf-linha-forte); border-radius: 15px 15px 0 0; padding: 13px 18px 12px; margin-bottom: 12px; }
.pf:not(.pf-admin) .pf-h { font-size: 1.04rem; font-weight: 900; }
.pf:not(.pf-admin) .pf-kpi { border-color: var(--pf-linha-forte); border-top: 3px solid var(--pf-tinta); }
.pf:not(.pf-admin) .pf-kpi.kpi-cardapio.tem { border-top-color: #B91C1C; }
.pf:not(.pf-admin) .pf-tabela th { background: #EDE5D7; color: var(--pf-tinta-2); border-color: var(--pf-linha-forte); }
.pf:not(.pf-admin) .pf-rel-cab h2 { font-size: 1.4rem; }
.pf:not(.pf-admin) .pf-op, .pf:not(.pf-admin) .pf-produto, .pf:not(.pf-admin) .pf-grupo ul { border-color: var(--pf-linha-forte); }

@media (max-width: 860px) {
  .pf-duas { grid-template-columns: 1fr; }
  .pf-kpis { grid-template-columns: repeat(2, minmax(0,1fr)); }
}
@media (max-width: 640px) {
  .pf-perfil { padding: 12px; gap: 12px; }
  .pf-cab { grid-template-columns: auto minmax(0,1fr); }
  .pf-cab-acoes { grid-column: 1 / -1; justify-content: flex-start; }
  .pf-nome { font-size: 1.15rem; }
  .pf-logo { width: 46px; height: 46px; }
  .pf-kpi-val { font-size: 1.2rem; }
  .pf-rel-kpis { grid-template-columns: repeat(2, minmax(0,1fr)); }
  .pf-rec { grid-template-columns: minmax(0,1fr) auto; }
  .pf-rec-ev { grid-column: 1 / -1; }
  .pf-painel-cab { padding: 14px 14px 8px; }
  .pf:not(.pf-admin) .pf-painel-cab { padding: 12px 14px 10px; margin-bottom: 10px; }
  .pf-loja-cel .pf-selo-cardapio em { display: none; }
  .pf-tabela th { white-space: normal; }
  .pf-canais, .pf-ativacao, .pf-lista-simples { padding-left: 14px; padding-right: 14px; }
  .pf-ferramentas { padding: 0 14px 12px; }
  .pf-busca { width: 100%; }
  .pf-argumento { flex-direction: column; }
  .pf-tabela .so-largo { display: none; }
  .pf-tabela td, .pf-tabela th { padding: 9px 8px; }
  .pf-loja-cel { min-width: 0; }
  .pf-loja-cel strong { overflow-wrap: anywhere; }
  .pf-mini-barra { min-width: 64px; }
  .pf-produtos { gap: 8px; }
  .pf-produto > button { padding: 10px 12px; }
  .pf-produto-n { font-size: 1.5rem; }
  .pf-produtos { padding: 0 10px 10px; grid-template-columns: 1fr; }
  .pf-rel-acoes { width: 100%; }
  .pf-rel-acoes select { flex: 1 1 100%; max-width: none; }
}
@media (prefers-reduced-motion: reduce) { .pf *, .pf-gaveta, .pf-gaveta-fundo { animation: none !important; transition: none !important; } }
`;

/** A cor de cada canal na barra (a do selo do painel, mais forte). */
export const COR_DO_CANAL: Record<string, string> = {
  IFOOD: "#EA1D2C", "99FOOD": "#F5B800", BRENDI: "#7C3AED", WABIZ: "#65A30D", JOTAJA: "#2563EB", KEETA: "#1F2937",
  CARDAPIOWEB: "#DB2777", AIQFOME: "#6B21A8", WHATSAPP_IA: "#9333EA", PDV: "#4F46E5", TOTEM: "#0891B2", MESA: "#EA580C", SITE: "#16A34A", DESCONHECIDO: "#94A3B8",
};
