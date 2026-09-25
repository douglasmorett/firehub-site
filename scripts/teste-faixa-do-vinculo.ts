/**
 * A FAIXA DA SAÚDE DO VÍNCULO na tela do robô (src/app/store/chatbot/saude-do-vinculo-na-tela.ts).
 *
 *   npx tsx scripts/teste-faixa-do-vinculo.ts
 *
 * O caso real (Divinos Burger, 24–25/09/2026): a tela dizia "Conectado e
 * Operacional" e "WhatsApp Vinculado com Sucesso!" enquanto 100% dos clientes
 * recebiam "Aguardando mensagem"; a conta tinha um aparelho HOSPEDADO (API
 * oficial em coexistência) e, na terça, o QR tinha sido lido no WhatsApp
 * PESSOAL do dono ("iphone"). O gateway já sabia; a tela não mostrava.
 *
 * Os estados do gateway aqui saem do MONITOR DE VERDADE
 * (whatsapp-gateway/saude-do-vinculo.js) e passam pelos mesmos formatos das
 * rotas — GET /instance/connectionState → saudeDoVinculoNoGateway (lib/
 * whatsapp-evolution.ts) → GET /api/chatbot/qrcode; e o evento
 * SAUDE_DO_VINCULO/abertura → webhook → chatbotConfig. Se um tipo de aviso
 * mudar de nome no gateway, este teste quebra.
 *
 * Sem rede e sem banco.
 */
export {};

let ok = 0, falhou = 0;
function conferir(nome: string, cond: boolean, detalhe?: unknown) {
  if (cond) { ok++; console.log(`  ok   ${nome}`); }
  else { falhou++; console.log(`  FALHOU ${nome}${detalhe !== undefined ? `\n         ${JSON.stringify(detalhe)}` : ""}`); }
}

async function main() {
  const tela = await import("../src/app/store/chatbot/saude-do-vinculo-na-tela");
  const modGateway: any = await import("../whatsapp-gateway/saude-do-vinculo.js");
  const gateway = modGateway.default ?? modGateway;
  const {
    saudeDoVinculoNaTela, leituraAoVivoDaResposta, momentoDaResposta, nomeDaPlataforma,
    TITULO_VINCULO_DOENTE, TITULO_APARELHO_HOSPEDADO, TITULO_NUMERO_ERRADO,
  } = tela;

  const INST = "firehub_010pmo1e0w";
  const T0 = Date.UTC(2026, 8, 25, 0, 0, 0);

  // ── Os formatos das rotas (espelho do código de produção) ─────────────────
  /** GET /instance/connectionState do gateway (server.js), loja conectada. */
  const connectionState = (e: any) => ({
    instance: {
      state: "open", ownerJid: "5522999990000@s.whatsapp.net",
      vinculoDoente: e.vinculoDoente, motivo: e.motivo, contatosQueNaoLeram: e.contatosQueNaoLeram,
      aparelhoId: e.aparelhoId, plataforma: e.plataforma, tipoDePlataforma: e.tipoDePlataforma,
      aparelhoHospedado: e.aparelhoHospedado, avisos: e.avisos,
    },
  });
  /** O que GET /api/chatbot/qrcode devolve (getEvolutionQRCode + saudeDoVinculoNoGateway). */
  const respostaDoQr = (e: any) => {
    const inst = connectionState(e).instance;
    return {
      connected: true, phone: "+55 22999990000", battery: 99, status: "ONLINE",
      vinculoDoente: inst.vinculoDoente === true,
      motivoDoVinculo: typeof inst.motivo === "string" ? inst.motivo.slice(0, 600) : null,
      aparelhoHospedado: inst.aparelhoHospedado === true,
      plataforma: typeof inst.plataforma === "string" ? inst.plataforma.slice(0, 20) : null,
      avisosDoVinculo: inst.avisos,
    };
  };
  /** chatbotConfig.saudeDoVinculo, como o webhook grava (evento SAUDE_DO_VINCULO). */
  const saudeGravada = (e: any, em: number) => ({
    vinculoDoente: e.vinculoDoente === true,
    motivo: e.motivo ?? null,
    contatosQueNaoLeram: e.contatosQueNaoLeram || 0,
    aparelhoHospedado: e.aparelhoHospedado === true,
    avisos: e.avisos,
    em: new Date(em).toISOString(),
  });
  /** chatbotConfig.vinculoDoAparelho, como o webhook grava na abertura. */
  const aparelhoGravado = (e: any, em: number, extras: any[] = []) => ({
    plataforma: e.plataforma, tipoDePlataforma: e.tipoDePlataforma, aparelhoId: e.aparelhoId,
    avisos: [...e.avisos, ...extras], em: new Date(em).toISOString(),
  });

  // ── Estados de verdade do monitor ─────────────────────────────────────────
  const sadio = (() => {
    const m = gateway.criarMonitorDoVinculo();
    return m.registrarAparelho(INST, { plataforma: "smba", aparelhoId: 12 });
  })();
  const doenteComHospedado = (() => {
    const m = gateway.criarMonitorDoVinculo();
    m.registrarAparelho(INST, { plataforma: "smba", aparelhoId: 12, deviceList: [{ id: 0 }, { id: 12 }, { id: 99, isHosted: true }] });
    for (let i = 0; i < 10; i++) {
      m.registrarRetransmissao(INST, { contato: `55229990000${i}`, ehPropriaConta: false, dispositivo: 0 }, T0 + i * 1000);
    }
    return m.estado(INST, T0 + 20_000);
  })();
  const pessoal = (() => {
    const m = gateway.criarMonitorDoVinculo();
    return m.registrarAparelho(INST, { plataforma: "iphone", aparelhoId: 7 });
  })();
  conferir("monitor: o cenário da Divinos é doente e tem aparelho hospedado",
    doenteComHospedado.vinculoDoente === true && doenteComHospedado.aparelhoHospedado === true, doenteComHospedado);

  // 1. Desconectado: nada (a faixa de "robô fora do ar" é outra).
  {
    const r = saudeDoVinculoNaTela({
      conectado: false,
      aoVivo: leituraAoVivoDaResposta(respostaDoQr(doenteComHospedado), T0),
      saudeSalva: saudeGravada(doenteComHospedado, T0),
    });
    conferir("desconectado: nenhum aviso de vínculo", r.problemas.length === 0, r);
  }

  // 2. Sadio: nenhuma faixa, e o aplicativo aparece em português.
  {
    const r = saudeDoVinculoNaTela({
      conectado: true,
      aoVivo: leituraAoVivoDaResposta(respostaDoQr(sadio), T0),
      aparelhoSalvo: aparelhoGravado(sadio, T0 - 60_000),
    });
    conferir("sadio: nenhum aviso", r.problemas.length === 0, r.problemas);
    conferir("sadio: plataforma smba → WhatsApp Business (Android)", r.nomeDaPlataforma === "WhatsApp Business (Android)", r);
  }

  // 3. A noite da Divinos, lida AO VIVO: doente + hospedado.
  {
    const r = saudeDoVinculoNaTela({
      conectado: true,
      aoVivo: leituraAoVivoDaResposta(respostaDoQr(doenteComHospedado), T0 + 30_000),
    });
    const tipos = r.problemas.map((p) => p.tipo);
    conferir("Divinos ao vivo: doente primeiro, depois o aparelho hospedado",
      JSON.stringify(tipos) === JSON.stringify(["vinculo-doente", "aparelho-hospedado"]), tipos);
    const doente = r.problemas[0];
    conferir("Divinos: título do doente é o texto pedido", doente?.titulo === TITULO_VINCULO_DOENTE, doente?.titulo);
    conferir("Divinos: título do hospedado é o texto pedido", r.problemas[1]?.titulo === TITULO_APARELHO_HOSPEDADO, r.problemas[1]?.titulo);
    conferir("Divinos: com hospedado, o 1º passo do doente é desligar o outro sistema (religar não cura)",
      /desligue a integração/i.test(doente?.passos[0] || ""), doente?.passos);
    conferir("Divinos: o motivo do gateway vai no detalhe", /contatos diferentes não conseguiram ler/.test(doente?.detalhes[0] || ""), doente?.detalhes);
    conferir("Divinos: o detalhe do hospedado é o aviso do gateway", /API oficial/.test(r.problemas[1]?.detalhes[0] || ""), r.problemas[1]?.detalhes);
    conferir("Divinos: nada é dispensável", r.problemas.every((p) => !p.dispensavel));
    conferir("Divinos: vistoEm é a hora da leitura ao vivo", r.vistoEm === T0 + 30_000, r.vistoEm);
  }

  // 4. Só doente (sem hospedado): o passo a passo começa em Aparelhos conectados.
  {
    const m = gateway.criarMonitorDoVinculo();
    m.registrarAparelho(INST, { plataforma: "smbi", aparelhoId: 3 });
    for (let i = 0; i < 4; i++) m.registrarRetransmissao(INST, { contato: `5521988880${i}`, ehPropriaConta: false, dispositivo: 0 }, T0 + i);
    const e = m.estado(INST, T0 + 10);
    const r = saudeDoVinculoNaTela({ conectado: true, aoVivo: leituraAoVivoDaResposta(respostaDoQr(e), T0 + 10) });
    conferir("só doente: um aviso", r.problemas.length === 1 && r.problemas[0].tipo === "vinculo-doente", r.problemas);
    conferir("só doente: 1º passo é Aparelhos conectados", /Aparelhos conectados/.test(r.problemas[0]?.passos[0] || ""), r.problemas[0]?.passos);
  }

  // 5. Três contatos NÃO é doente (limite do gateway é "mais que 3").
  {
    const m = gateway.criarMonitorDoVinculo();
    for (let i = 0; i < 3; i++) m.registrarRetransmissao(INST, { contato: `5521977770${i}`, ehPropriaConta: false, dispositivo: 0 }, T0 + i);
    const e = m.estado(INST, T0 + 10);
    const r = saudeDoVinculoNaTela({ conectado: true, aoVivo: leituraAoVivoDaResposta(respostaDoQr(e), T0 + 10) });
    conferir("3 contatos: sem faixa", r.problemas.length === 0, r.problemas);
  }

  // 6. QR lido no WhatsApp comum (iphone): aviso de número, dispensável.
  {
    const base = {
      conectado: true,
      aoVivo: leituraAoVivoDaResposta(respostaDoQr(pessoal), T0),
      aparelhoSalvo: aparelhoGravado(pessoal, T0 - 1000),
    };
    const r = saudeDoVinculoNaTela(base);
    conferir("WhatsApp comum: aviso de número errado com o texto pedido",
      r.problemas.length === 1 && r.problemas[0].titulo === TITULO_NUMERO_ERRADO, r.problemas);
    conferir("WhatsApp comum: dispensável", r.problemas[0]?.dispensavel === true);
    conferir("WhatsApp comum: detalhe traz a plataforma", /iphone/.test(r.problemas[0]?.detalhes.join(" ") || ""), r.problemas[0]?.detalhes);
    conferir("WhatsApp comum: nome da plataforma", r.nomeDaPlataforma === "WhatsApp comum (iPhone)", r.nomeDaPlataforma);
    const dispensado = saudeDoVinculoNaTela({ ...base, numeroComumConfirmado: true });
    conferir("WhatsApp comum confirmado pelo lojista: some", dispensado.problemas.length === 0, dispensado.problemas);
  }

  // 7. Número do DONO (conferido pelo FireHub): não se dispensa.
  {
    const doDono = {
      tipo: "numero-do-dono",
      mensagem: "O robô está conectado no WhatsApp do proprietário (final 0207), não no número da loja (final 1680). Quem escreve para o número da loja não chega ao robô. Desconecte e leia o QR com o WhatsApp da loja.",
    };
    const r = saudeDoVinculoNaTela({
      conectado: true,
      aoVivo: leituraAoVivoDaResposta(respostaDoQr(pessoal), T0),
      aparelhoSalvo: aparelhoGravado(pessoal, T0 - 1000, [doDono]),
      numeroComumConfirmado: true,
    });
    conferir("número do dono: aviso continua mesmo com 'é da loja' marcado",
      r.problemas.length === 1 && r.problemas[0].tipo === "numero-errado" && !r.problemas[0].dispensavel, r.problemas);
    conferir("número do dono: os dois detalhes (dono e WhatsApp comum)", r.problemas[0]?.detalhes.length === 2, r.problemas[0]?.detalhes);
    // Mesmo com a leitura ao vivo mais nova (que não conhece o "número do dono"), ele fica.
    const soDono = saudeDoVinculoNaTela({
      conectado: true,
      aoVivo: leituraAoVivoDaResposta(respostaDoQr(sadio), T0 + 60_000),
      aparelhoSalvo: aparelhoGravado(sadio, T0, [doDono]),
    });
    conferir("número do dono vem sempre do vinculoDoAparelho", soDono.problemas.map((p) => p.tipo).join() === "numero-errado", soDono.problemas);
  }

  // 8. A leitura mais NOVA decide doente/sadio.
  {
    // O gateway avisou "doente" às T0; a tela leu ao vivo às T0+2h (a janela passou): sadio.
    const r1 = saudeDoVinculoNaTela({
      conectado: true,
      aoVivo: leituraAoVivoDaResposta(respostaDoQr(sadio), T0 + 2 * 3600_000),
      saudeSalva: saudeGravada(doenteComHospedado, T0),
    });
    conferir("ao vivo mais nova e sadia apaga o doente gravado antes", !r1.problemas.some((p) => p.tipo === "vinculo-doente"), r1.problemas);
    // A tela leu ao vivo às T0 (sadio); com ela aberta, o gateway avisou "doente" às T0+10min.
    const r2 = saudeDoVinculoNaTela({
      conectado: true,
      aoVivo: leituraAoVivoDaResposta(respostaDoQr(sadio), T0),
      saudeSalva: saudeGravada(doenteComHospedado, T0 + 10 * 60_000),
    });
    conferir("aviso do gateway depois da leitura ao vivo acende o doente", r2.problemas.some((p) => p.tipo === "vinculo-doente"), r2.problemas);
    conferir("… e o hospedado que veio junto", r2.problemas.some((p) => p.tipo === "aparelho-hospedado"), r2.problemas);
    conferir("vistoEm é a hora do aviso gravado", r2.vistoEm === T0 + 10 * 60_000, r2.vistoEm);
    // Sem leitura ao vivo (gateway fora na carga da tela): vale o que foi gravado.
    const r3 = saudeDoVinculoNaTela({ conectado: true, aoVivo: null, saudeSalva: saudeGravada(doenteComHospedado, T0) });
    conferir("sem leitura ao vivo, vale a saúde gravada", r3.problemas.length === 2, r3.problemas);
  }

  // 9. leituraAoVivoDaResposta: só com loja conectada E saúde presente.
  {
    const erro = { connected: false, qrCodeUrl: null, error: "Servidor de WhatsApp indisponível no momento.", status: "DISCONNECTED" };
    conferir("resposta de erro do QR não vira 'sadio'", leituraAoVivoDaResposta(erro, T0) === null);
    conferir("resposta com QR (desconectada) não vira leitura", leituraAoVivoDaResposta({ connected: false, qrCodeUrl: "data:image/png;base64,xxx" }, T0) === null);
    conferir("conectada sem campos de saúde (rota antiga) não vira 'sadio'", leituraAoVivoDaResposta({ connected: true, phone: "+55 21" }, T0) === null);
    const sujo = leituraAoVivoDaResposta({
      connected: true, vinculoDoente: true, motivoDoVinculo: 42, aparelhoHospedado: "sim", plataforma: { x: 1 },
      avisosDoVinculo: [null, { tipo: "aparelho-hospedado" }, { tipo: "numero-pessoal", mensagem: "ok" }, "lixo"],
    }, T0);
    conferir("campos sujos: tipos saneados",
      sujo !== null && sujo.vinculoDoente === true && sujo.motivo === null && sujo.aparelhoHospedado === false &&
        sujo.plataforma === null && sujo.avisos.length === 1 && sujo.avisos[0].tipo === "numero-pessoal", sujo);
  }

  // 10. Config gravado com lixo não derruba a tela.
  {
    let quebrou = false;
    try {
      const r = saudeDoVinculoNaTela({ conectado: true, saudeSalva: "doente", aparelhoSalvo: [1, 2] });
      conferir("lixo no config: sem aviso", r.problemas.length === 0, r);
      const r2 = saudeDoVinculoNaTela({ conectado: true, saudeSalva: { vinculoDoente: true, em: "ontem" } });
      conferir("saúde gravada sem data válida ainda vale quando é a única", r2.problemas.some((p) => p.tipo === "vinculo-doente"), r2);
    } catch (e) {
      quebrou = true;
      console.log(e);
    }
    conferir("lixo no config: não lança", !quebrou);
  }

  // 11. Hora da resposta pelo relógio do servidor.
  {
    const agora = T0 + 999;
    conferir("cabeçalho Date é lido", momentoDaResposta("Fri, 25 Sep 2026 00:00:00 GMT", agora) === T0);
    conferir("sem cabeçalho, a hora local", momentoDaResposta(null, agora) === agora);
    conferir("cabeçalho ilegível, a hora local", momentoDaResposta("amanhã", agora) === agora);
  }

  // 12. Nomes dos aplicativos.
  {
    conferir("smbi", nomeDaPlataforma("smbi") === "WhatsApp Business (iPhone)");
    conferir("android", nomeDaPlataforma("android") === "WhatsApp comum (Android)");
    conferir("desconhecida", nomeDaPlataforma("web") === "WhatsApp (web)");
    conferir("vazia", nomeDaPlataforma(null) === null && nomeDaPlataforma("") === null);
  }

  // 13. A faixa renderizada (React no servidor, sem navegador).
  {
    const React = await import("react");
    const { renderToStaticMarkup } = await import("react-dom/server");
    const { default: FaixaDoVinculo } = await import("../src/app/store/chatbot/FaixaDoVinculo");
    const nada = () => {};
    const html = (saude: any, comDispensa: boolean) =>
      renderToStaticMarkup(
        React.createElement(FaixaDoVinculo, {
          saude, ocupado: false, onRelerQr: nada, onNumeroComumEhDaLoja: comDispensa ? nada : undefined,
        }),
      );
    const divinos = saudeDoVinculoNaTela({
      conectado: true,
      aoVivo: leituraAoVivoDaResposta(respostaDoQr(doenteComHospedado), T0),
    });
    const h1 = html(divinos, true);
    const escapar = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    conferir("faixa: mostra o título do doente", h1.includes(escapar(TITULO_VINCULO_DOENTE)));
    conferir("faixa: mostra o título do hospedado", h1.includes(escapar(TITULO_APARELHO_HOSPEDADO)));
    conferir("faixa: tem o botão de reler o QR", h1.includes("Desconectar e ler o QR de novo"));
    conferir("faixa: detalhe do servidor fica atrás de <details>", h1.includes("<details"));
    conferir("faixa: sem aviso dispensável, sem botão de dispensar", !h1.includes("não avisar mais"));
    const comum = saudeDoVinculoNaTela({ conectado: true, aoVivo: leituraAoVivoDaResposta(respostaDoQr(pessoal), T0) });
    conferir("faixa: WhatsApp comum com número conhecido oferece dispensar", html(comum, true).includes("não avisar mais"));
    conferir("faixa: sem número conhecido, não oferece dispensar", !html(comum, false).includes("não avisar mais"));
    conferir("faixa: vínculo sadio não renderiza nada",
      html(saudeDoVinculoNaTela({ conectado: true, aoVivo: leituraAoVivoDaResposta(respostaDoQr(sadio), T0) }), true) === "");
  }

  console.log(`\n${ok} ok, ${falhou} falha(s)`);
  if (falhou > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
