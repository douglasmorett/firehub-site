"use client";

/**
 * Rota 100% automatizada — o botão roxo do quadro "Configurações da
 * Roteirização" e a janela que explica TUDO antes de ligar.
 *
 * Os três modos de hoje (Manual, Automatizada, Inteligente) continuam no
 * seletor ao lado: eles ajudam quem monta a rota à mão. Este botão é outra
 * coisa — com ele ligado, ninguém monta rota: o servidor escolhe o pedido mais
 * urgente, junta os vizinhos, pede prioridade no KDS e chama o motoboy
 * (plano: vault "FireHub - Plano despacho automático").
 *
 * Regra do Douglas (21/10/2026): o interruptor nunca liga direto. Clicar abre
 * esta janela; só "Entendi, ativar" liga, depois de ler as regras, as
 * configurações e a cobrança.
 */
import { useEffect, useState } from "react";

export type QuemPuxa = "chamado" | "qualquer";

export type RotaAutomaticaConfig = {
  ativo: boolean;
  maxEntregasPorRota: number;
  raioDoGrupoKm: number;
  janelaDePrazoMin: number;
  esperaMaxMin: number;
  raioDaLojaM: number;
  quemPuxa: QuemPuxa;
};

export const ROTA_AUTOMATICA_PADRAO: RotaAutomaticaConfig = {
  ativo: false,
  maxEntregasPorRota: 3,
  raioDoGrupoKm: 2,
  janelaDePrazoMin: 15,
  esperaMaxMin: 8,
  raioDaLojaM: 150,
  quemPuxa: "chamado",
};

export type RotaAutomaticaEstado = {
  config: RotaAutomaticaConfig;
  /** Loja na lista de liberação (hoje só a Hakim Centro). Fora dela o botão nem aparece. */
  liberada: boolean;
  cobranca: {
    preco: number;
    diasDeTeste: number;
    /** Fim do teste grátis em andamento (ISO), ou null. */
    testeAte: string | null;
    jaTestou: boolean;
    isento: boolean;
  };
  requisitos: {
    temPino: boolean;
    motoboysAtivos: number;
    temHorario: boolean;
  };
};

const ROXO = "linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)";

const dataCurta = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "";

/** O selo ao lado do botão: o estado escrito, como nos outros módulos pagos. */
function textoDoEstado(e: RotaAutomaticaEstado): string {
  if (!e.config.ativo) return "Desligada";
  if (e.cobranca.isento) return "Ligada · liberada";
  if (e.cobranca.testeAte && new Date(e.cobranca.testeAte) > new Date()) return `Ligada · grátis até ${dataCurta(e.cobranca.testeAte)}`;
  return `Ligada · R$ ${e.cobranca.preco}/mês`;
}

export default function RotaAutomatica({
  estado,
  salvando,
  onSalvar,
}: {
  estado: RotaAutomaticaEstado;
  salvando: boolean;
  onSalvar: (config: RotaAutomaticaConfig) => void;
}) {
  const [aberta, setAberta] = useState(false);
  if (!estado.liberada) return null;

  const ligada = estado.config.ativo;
  return (
    <>
      <button
        type="button"
        onClick={() => setAberta(true)}
        title={ligada ? "Rota 100% automatizada ligada. Toque para ver as regras ou desligar." : "Toque para entender como funciona e ligar."}
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 12, border: 0,
          background: ROXO, color: "#fff", fontWeight: 900, fontSize: "0.9rem", cursor: "pointer",
          boxShadow: ligada ? "0 0 0 3px #DDD6FE, 0 6px 16px rgba(91,33,182,.35)" : "0 4px 12px rgba(91,33,182,.3)",
          whiteSpace: "nowrap",
        }}
      >
        <span style={{ fontSize: 18 }}>🤖</span>
        <span style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", lineHeight: 1.15 }}>
          <span>Rota 100% automatizada</span>
          <span style={{ fontSize: "0.72rem", fontWeight: 700, opacity: 0.9 }}>{textoDoEstado(estado)}</span>
        </span>
        <span
          aria-hidden
          style={{
            marginLeft: 4, width: 40, height: 22, borderRadius: 999, background: ligada ? "#22C55E" : "rgba(255,255,255,.35)",
            position: "relative", flexShrink: 0,
          }}
        >
          <span style={{ position: "absolute", top: 2, left: ligada ? 20 : 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left .2s" }} />
        </span>
      </button>

      {aberta && (
        <JanelaDaRotaAutomatica
          estado={estado}
          salvando={salvando}
          onFechar={() => setAberta(false)}
          onSalvar={(c) => {
            onSalvar(c);
            setAberta(false);
          }}
        />
      )}
    </>
  );
}

const limites: Record<keyof Omit<RotaAutomaticaConfig, "ativo" | "quemPuxa">, { min: number; max: number; passo: number; rotulo: string; ajuda: string }> = {
  maxEntregasPorRota: { min: 1, max: 6, passo: 1, rotulo: "Entregas por rota", ajuda: "Quantas entregas um motoboy leva de uma vez." },
  raioDoGrupoKm: { min: 0.5, max: 10, passo: 0.5, rotulo: "Distância entre as entregas (km)", ajuda: "Só junta pedidos a até esta distância um do outro." },
  janelaDePrazoMin: { min: 5, max: 60, passo: 5, rotulo: "Janela de prazo (min)", ajuda: "Só junta pedidos com prazo até X min depois do mais urgente." },
  esperaMaxMin: { min: 0, max: 30, passo: 1, rotulo: "Espera do pedido pronto (min)", ajuda: "Um pedido pronto espera no máximo isto pelos outros da rota. Depois vai sozinho." },
  raioDaLojaM: { min: 50, max: 500, passo: 10, rotulo: "Raio da loja (m)", ajuda: "Motoboy a até esta distância do pino da loja conta como 'na loja'." },
};

function JanelaDaRotaAutomatica({
  estado,
  salvando,
  onFechar,
  onSalvar,
}: {
  estado: RotaAutomaticaEstado;
  salvando: boolean;
  onFechar: () => void;
  onSalvar: (config: RotaAutomaticaConfig) => void;
}) {
  const [cfg, setCfg] = useState<RotaAutomaticaConfig>(estado.config);
  const [liTudo, setLiTudo] = useState(false);
  const [confirmandoDesligar, setConfirmandoDesligar] = useState(false);
  useEffect(() => setCfg(estado.config), [estado.config]);

  const ligada = estado.config.ativo;
  const { requisitos: req, cobranca } = estado;
  const faltaRequisito = !req.temPino || req.motoboysAtivos === 0;
  const emTeste = !!cobranca.testeAte && new Date(cobranca.testeAte) > new Date();
  const num = (k: keyof typeof limites) => (
    <label key={k} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: "0.8rem", fontWeight: 800, color: "#334155" }}>{limites[k].rotulo}</span>
      <input
        type="number"
        min={limites[k].min}
        max={limites[k].max}
        step={limites[k].passo}
        value={cfg[k]}
        onChange={(e) => setCfg({ ...cfg, [k]: Number(e.target.value) })}
        style={{ padding: "8px 10px", borderRadius: 8, border: "1.5px solid #CBD5E1", fontWeight: 800, fontSize: "0.95rem", width: "100%" }}
      />
      <span style={{ fontSize: "0.72rem", color: "#64748B" }}>{limites[k].ajuda}</span>
    </label>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 10070, background: "rgba(15,23,42,.6)", display: "grid", placeItems: "center", padding: 16 }} onClick={onFechar}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 18, width: "min(760px, 100%)", maxHeight: "92vh", overflowY: "auto", boxShadow: "0 24px 60px rgba(2,6,23,.4)" }}
      >
        <div style={{ background: ROXO, color: "#fff", padding: "18px 22px", borderRadius: "18px 18px 0 0" }}>
          <div style={{ fontSize: "0.78rem", fontWeight: 800, opacity: 0.85, letterSpacing: ".5px" }}>MÓDULO DE ROTEIRIZAÇÃO</div>
          <h2 style={{ margin: "2px 0 6px", fontSize: "1.35rem", fontWeight: 900 }}>🤖 Rota 100% automatizada</h2>
          <p style={{ margin: 0, fontSize: "0.92rem", lineHeight: 1.45 }}>
            Você não monta mais rota. O FireHub olha os pedidos de entrega, junta os que vão para perto um do outro,
            coloca eles na frente da cozinha e chama o motoboy quando tudo está pronto.
          </p>
        </div>

        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 18, color: "#0F172A" }}>
          <Secao titulo="Como funciona, passo a passo">
            <ol style={{ margin: 0, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 8, fontSize: "0.9rem", lineHeight: 1.45 }}>
              <li><b>Escolhe o mais urgente.</b> A cada 20 segundos o sistema olha os pedidos de entrega da sua loja e pega o que tem o menor prazo ("Entregar até"). Pedido em que você pediu prioridade à mão vai primeiro.</li>
              <li><b>Junta os vizinhos.</b> Procura outros pedidos que podem ir na mesma viagem: a até <b>{cfg.raioDoGrupoKm} km</b> um do outro, com prazo parecido (até <b>{cfg.janelaDePrazoMin} min</b> depois do mais urgente) e no máximo <b>{cfg.maxEntregasPorRota}</b> entregas por rota. Pedido sem endereço localizado no mapa fica de fora, para você montar a rota à mão.</li>
              <li><b>Pede prioridade na cozinha.</b> Os pedidos da rota sobem no KDS com o selo "⚡ PRIORIDADE PARA ROTA · Rota #N", para ficarem prontos juntos.</li>
              <li><b>Espera ficar pronto.</b> A rota só é chamada quando a cozinha dá "Pronto" em todos. Se o mais urgente ficou pronto e os outros demoram mais de <b>{cfg.esperaMaxMin} min</b>, ele vai sozinho e os outros voltam para a fila.</li>
              <li><b>Chama o motoboy.</b> O app avisa o motoboy que chegou primeiro na loja (pelo GPS, a até <b>{cfg.raioDaLojaM} m</b> do seu pino): "Rota #7 pronta na loja · 3 entregas". Se ninguém está na loja, avisa todos os motoboys livres: quem chegar primeiro sai com a rota.</li>
              <li><b>Motoboy escaneia e leva.</b> Ele escaneia o QR da primeira comanda (no app ou pelo navegador); o app pergunta "tem mais 2 na rota, puxar também?". Ao confirmar, os pedidos saem para entrega, o cliente é avisado e o iFood/99 recebem o despacho.</li>
            </ol>
          </Secao>

          <Secao titulo="O que NÃO muda">
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: "0.9rem", lineHeight: 1.5 }}>
              <li>Você continua vendo tudo aqui na Roteirização: as rotas automáticas aparecem com o selo 🤖, e você pode desfazer, trocar o motoboy ou despachar à mão.</li>
              <li>Pedido do iFood com entrega do próprio iFood, retirada, mesa e balcão nunca entram em rota.</li>
              <li>Desligar para de criar rotas novas; as que já existem continuam até você desfazer.</li>
            </ul>
          </Secao>

          <Secao titulo="O que precisa para funcionar">
            <Requisito ok={req.temPino} texto="O pino da sua loja no mapa" ajuda="Minha Loja › Endereço. Sem ele não dá para saber quem chegou na loja." />
            <Requisito ok={req.motoboysAtivos > 0} texto={req.motoboysAtivos > 0 ? `Motoboys usando o App Motoboys com a localização ligada (${req.motoboysAtivos} ativo${req.motoboysAtivos > 1 ? "s" : ""})` : "Motoboys usando o App Motoboys com a localização ligada"} ajuda="Cadastre em Motoboys e mande o link do app. Freelancer sem app puxa pelo navegador." />
            <Requisito ok={req.temHorario} texto="Horário de funcionamento cadastrado" ajuda="O GPS do app só roda no horário da loja." />
          </Secao>

          <Secao titulo="Quem pode puxar a rota" sub="Escolha aqui, e troque quando precisar.">
            <Opcao
              marcada={cfg.quemPuxa === "chamado"}
              onClick={() => setCfg({ ...cfg, quemPuxa: "chamado" })}
              titulo="Só o motoboy chamado"
              texto={'Quem chegou primeiro na loja. Outro que escanear é barrado; para trocar, use "Trocar entregador" no card da rota.'}
              selo="recomendado"
            />
            <Opcao
              marcada={cfg.quemPuxa === "qualquer"}
              onClick={() => setCfg({ ...cfg, quemPuxa: "qualquer" })}
              titulo="Quem escanear o QR primeiro"
              texto="Qualquer motoboy da loja puxa o grupo. Use no dia em que tem freelancer sem o app (ele escaneia pelo navegador)."
            />
          </Secao>

          <Secao titulo="As regras" sub="Os números do passo a passo. Pode mudar depois.">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 14 }}>
              {(Object.keys(limites) as (keyof typeof limites)[]).map(num)}
            </div>
          </Secao>

          {!cobranca.isento && (
            <Secao titulo="Cobrança">
              <div style={{ background: "#F5F3FF", border: "1px solid #DDD6FE", borderRadius: 12, padding: "12px 14px", fontSize: "0.9rem", lineHeight: 1.5 }}>
                {ligada ? (
                  emTeste ? (
                    <p style={{ margin: 0 }}><b>Teste grátis até {dataCurta(cobranca.testeAte)}.</b> Depois, R$ {cobranca.preco} por mês na fatura do FireHub. Se desligar antes do fim do teste, para na hora e não paga nada (o teste não volta).</p>
                  ) : (
                    <p style={{ margin: 0 }}><b>R$ {cobranca.preco} por mês</b> na fatura do FireHub. Se desligar, fica funcionando até o último dia do mês: o mês já está no boleto, inteiro, sem proporcional nem devolução.</p>
                  )
                ) : cobranca.jaTestou ? (
                  <p style={{ margin: 0 }}>Você já usou o teste grátis. Ao ligar, <b>este mês entra inteiro</b> na fatura do FireHub: <b>R$ {cobranca.preco}</b>. Depois, R$ {cobranca.preco} por mês enquanto estiver ligada.</p>
                ) : (
                  <>
                    <p style={{ margin: "0 0 6px" }}><b>{cobranca.diasDeTeste} dias grátis</b> para testar com a sua operação. Depois disso, <b>R$ {cobranca.preco} por mês</b> na fatura do FireHub, junto com a mensalidade.</p>
                    <p style={{ margin: 0 }}>Desligar durante o teste: para na hora, R$ 0 (o teste não volta). Desligar depois do teste: fica até o último dia do mês e o mês entra inteiro, sem proporcional.</p>
                  </>
                )}
              </div>
            </Secao>
          )}

          {!ligada && (
            <label style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: "0.9rem", fontWeight: 700, color: "#334155", cursor: "pointer" }}>
              <input type="checkbox" checked={liTudo} onChange={(e) => setLiTudo(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18 }} />
              <span>Li e entendi como a rota automática funciona, as regras acima{cobranca.isento ? "" : " e como é cobrada"}.</span>
            </label>
          )}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end", borderTop: "1px solid #E2E8F0", paddingTop: 14 }}>
            <button type="button" disabled title="Chega na próxima etapa" style={botao("#fff", "#94A3B8", "1px solid #CBD5E1")}>
              🔍 Ver o que o sistema faria agora
            </button>
            {ligada ? (
              <>
                <button type="button" onClick={() => onSalvar({ ...cfg, ativo: true })} disabled={salvando} style={botao("#0F172A", "#fff")}>
                  Salvar regras
                </button>
                {confirmandoDesligar ? (
                  <div style={{ width: "100%", background: "#FEF2F2", border: "1px solid #FECACA", borderRadius: 12, padding: "12px 14px", fontSize: "0.9rem" }}>
                    <p style={{ margin: "0 0 10px", fontWeight: 800, color: "#991B1B" }}>
                      {cobranca.isento
                        ? "Desligar a rota automática? As rotas já criadas continuam até você desfazer."
                        : emTeste
                          ? "Desligar agora encerra o teste grátis: para na hora, não paga nada, e o teste não volta. Tem certeza?"
                          : "Tem certeza? O mês já está no boleto, inteiro, sem proporcional nem devolução. A rota automática continua até o último dia do mês e desliga sozinha na virada."}
                    </p>
                    <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                      <button type="button" onClick={() => setConfirmandoDesligar(false)} style={botao("#fff", "#334155", "1px solid #CBD5E1")}>Continuar ligada</button>
                      <button type="button" onClick={() => onSalvar({ ...cfg, ativo: false })} disabled={salvando} style={botao("#DC2626", "#fff")}>Sim, desligar</button>
                    </div>
                  </div>
                ) : (
                  <button type="button" onClick={() => setConfirmandoDesligar(true)} style={botao("#fff", "#DC2626", "1px solid #FCA5A5")}>
                    Desligar
                  </button>
                )}
              </>
            ) : (
              <>
                <button type="button" onClick={onFechar} style={botao("#fff", "#334155", "1px solid #CBD5E1")}>
                  Agora não
                </button>
                <button
                  type="button"
                  onClick={() => onSalvar({ ...cfg, ativo: true })}
                  disabled={salvando || !liTudo || faltaRequisito}
                  title={faltaRequisito ? "Falta um requisito acima" : !liTudo ? "Marque que leu e entendeu" : ""}
                  style={{ ...botao(ROXO, "#fff"), opacity: salvando || !liTudo || faltaRequisito ? 0.5 : 1 }}
                >
                  {salvando ? "Ligando…" : cobranca.isento || cobranca.jaTestou ? "Entendi, ativar" : `Entendi, ativar · ${cobranca.diasDeTeste} dias grátis`}
                </button>
              </>
            )}
          </div>
          {!ligada && faltaRequisito && (
            <p style={{ margin: "-8px 0 0", fontSize: "0.82rem", color: "#B91C1C", fontWeight: 700, textAlign: "right" }}>
              Resolva os itens com ❌ em "O que precisa para funcionar" para poder ativar.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function Secao({ titulo, sub, children }: { titulo: string; sub?: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 style={{ margin: "0 0 2px", fontSize: "1rem", fontWeight: 900 }}>{titulo}</h3>
      {sub && <p style={{ margin: "0 0 8px", fontSize: "0.8rem", color: "#64748B" }}>{sub}</p>}
      <div style={{ marginTop: sub ? 0 : 8, display: "flex", flexDirection: "column", gap: 8 }}>{children}</div>
    </section>
  );
}

function Requisito({ ok, texto, ajuda }: { ok: boolean; texto: string; ajuda: string }) {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "flex-start", fontSize: "0.9rem" }}>
      <span style={{ fontSize: 16, lineHeight: 1.2 }}>{ok ? "✅" : "❌"}</span>
      <span>
        <b>{texto}</b>
        {!ok && <span style={{ display: "block", color: "#B91C1C", fontSize: "0.8rem" }}>{ajuda}</span>}
      </span>
    </div>
  );
}

function Opcao({ marcada, onClick, titulo, texto, selo }: { marcada: boolean; onClick: () => void; titulo: string; texto: string; selo?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        textAlign: "left", display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 12, cursor: "pointer",
        border: marcada ? "2px solid #7C3AED" : "1.5px solid #CBD5E1", background: marcada ? "#F5F3FF" : "#fff",
      }}
    >
      <span style={{ marginTop: 2, width: 18, height: 18, borderRadius: "50%", border: marcada ? "6px solid #7C3AED" : "2px solid #94A3B8", flexShrink: 0, boxSizing: "border-box" }} />
      <span style={{ fontSize: "0.9rem", lineHeight: 1.4 }}>
        <b>{titulo}</b>
        {selo && <span style={{ marginLeft: 8, fontSize: "0.7rem", fontWeight: 900, color: "#5B21B6", background: "#EDE9FE", padding: "2px 8px", borderRadius: 999 }}>{selo}</span>}
        <span style={{ display: "block", color: "#475569" }}>{texto}</span>
      </span>
    </button>
  );
}

const botao = (fundo: string, cor: string, borda = "0"): React.CSSProperties => ({
  height: 42, padding: "0 16px", borderRadius: 10, border: borda, background: fundo, color: cor, fontWeight: 800, fontSize: "0.9rem", cursor: "pointer",
});
