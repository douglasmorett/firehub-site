package br.com.firehub.maquininha.servico

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import br.com.firehub.maquininha.Ajustes
import br.com.firehub.maquininha.CofreDoToken
import br.com.firehub.maquininha.R
import br.com.firehub.maquininha.estado.EstadoDoTerminal
import br.com.firehub.maquininha.fila.FilaDeResultados
import br.com.firehub.maquininha.pagamento.PagamentoNaMaquininha
import br.com.firehub.maquininha.rede.ApiDoFireHub
import br.com.firehub.maquininha.rede.Cobranca
import br.com.firehub.maquininha.rede.RespostaDaFila
import br.com.firehub.maquininha.rede.RespostaDoResultado
import br.com.firehub.maquininha.rede.ResultadoDeCobranca
import br.com.firehub.maquininha.rede.TipoDePagamento
import br.com.firehub.maquininha.tela.OperacaoActivity

/**
 * Quem realmente faz o trabalho.
 *
 * Fica em primeiro plano porque o app não pode depender da tela estar aberta: o
 * operador vai sair do app para conferir uma coisa, o Android vai matar a
 * Activity, e o pedido pago no totem continua tendo que chegar aqui. Um pedido
 * que espera alguém lembrar de reabrir o app é um cliente parado no balcão.
 *
 * TUDO acontece numa única thread de trabalho, num laço sequencial. Não é
 * simplicidade por preguiça: as operações do PlugPag são bloqueantes e não
 * admitem concorrência (duas ao mesmo tempo devolvem SV03). Um laço sequencial
 * torna impossível, por construção, perguntar por cobrança nova enquanto um
 * cartão está sendo passado.
 */
class ServicoDeCobranca : Service() {

    private lateinit var fila: FilaDeResultados
    private lateinit var ritmo: RitmoDoPolling

    private var descanso: PowerManager.WakeLock? = null
    private var trabalhador: Thread? = null

    @Volatile
    private var rodando = false

    /**
     * Sinaliza que o sono deve terminar antes da hora.
     *
     * notifyAll sozinho não basta: quem acorda de um wait ainda vê o prazo
     * original lá na frente e volta a dormir. A flag é o que distingue "fui
     * acordado de propósito" de "acordei sozinho e ainda falta tempo".
     */
    @Volatile
    private var acordarAgora = false

    /** Usado para acordar o laço antes da hora quando a tela volta ao ar. */
    private val travaDoSono = java.lang.Object()

    /**
     * Resultado da última conferência de prontidão do terminal, com a hora.
     *
     * isAuthenticated() é uma ida ao serviço do PagBank por IPC. Fazer isso a
     * cada volta do laço, de 2 em 2 segundos o dia inteiro, seria conversa
     * inútil entre processos; guardar o resultado por alguns minutos dá o mesmo
     * efeito prático, porque ativação de terminal não muda sozinha.
     */
    @Volatile
    private var prontidao: PagamentoNaMaquininha.Impedimento = PagamentoNaMaquininha.Impedimento.Nenhum

    @Volatile
    private var prontidaoConferidaEm = 0L

    /**
     * Sem isto o app afirma estar pronto durante os primeiros cinco minutos de
     * cada boot sem nunca ter perguntado nada ao terminal.
     *
     * O relógio é elapsedRealtime, que começa em zero no boot. Logo depois de
     * ligar, `agora - 0` é pequeno, a prontidão guardada parece nova, e o valor
     * devolvido é o inicial — "Nenhum", que ninguém conferiu. É justamente o
     * momento em que o terminal pode estar sem ativação e a tela ficaria
     * dizendo "Aguardando pedido" como se estivesse tudo bem.
     */
    @Volatile
    private var prontidaoJaConferida = false

    /**
     * O último pedido que voltou para a fila sem ninguém escolher forma de
     * pagamento, e quantas vezes seguidas isso aconteceu com ele.
     *
     * Fica só em memória de propósito: se o aparelho reiniciou, o cliente que
     * desistiu já foi embora faz tempo e a contagem não interessa mais.
     */
    private var pedidoAbandonado: String? = null
    private var abandonosSeguidos = 0

    companion object {
        private const val ETIQUETA = "ServicoDeCobranca"

        private const val CANAL_OPERACAO = "operacao"
        private const val CANAL_CHAMADA = "chamada"
        private const val AVISO_FIXO = 1
        private const val AVISO_DE_COBRANCA = 2

        private const val ACAO_ACORDAR = "br.com.firehub.maquininha.ACORDAR"

        /** De quanto em quanto tempo reconferir se o terminal segue ativado. */
        private const val VALIDADE_DA_PRONTIDAO_MS = 5 * 60_000L

        /**
         * Quanto tempo o "aprovado" ou o "recusado" fica na tela antes de o app
         * voltar a aguardar. Menos que isso e o cliente não chega a ler.
         */
        private const val TEMPO_MOSTRANDO_RESULTADO_MS = 6_000L

        /**
         * Quantas vezes se pergunta ao terminal o que houve com um cartão antes
         * de desistir e chamar gente.
         *
         * Doze tentativas a cada cinco segundos dão um minuto — tempo de sobra
         * para o serviço do PagBank terminar de subir depois de um boot, que é o
         * motivo pelo qual esta pergunta falha na prática. Passou disso, o
         * problema não é tempo: é um cartão que pode ter sido debitado e ninguém
         * do lado do software consegue descobrir.
         */
        private const val CONFERENCIAS_ANTES_DE_CHAMAR_GENTE = 12

        fun ligar(context: Context) {
            ContextCompat.startForegroundService(
                context,
                Intent(context, ServicoDeCobranca::class.java),
            )
        }

        /**
         * Faz o laço perguntar agora, sem esperar o intervalo acabar.
         *
         * Chamado quando a tela de operação volta ao ar: se o app estava no
         * degrau de 30 segundos e o operador abriu a tela, é porque tem alguém
         * esperando alguma coisa.
         */
        fun acordar(context: Context) {
            val intent = Intent(context, ServicoDeCobranca::class.java).setAction(ACAO_ACORDAR)
            ContextCompat.startForegroundService(context, intent)
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        fila = FilaDeResultados(this)
        ritmo = RitmoDoPolling(this)

        criarCanais()

        // O aviso de "cobrança chegando" é ongoing e sobrevive à morte do
        // processo. Se o app foi derrubado no meio de uma venda, ele ficou na
        // barra piscando por uma cobrança que já não existe — e o operador toca
        // nele esperando ver o pedido.
        limparChamado()

        // Da API 29 em diante o serviço precisa declarar de que tipo ele é, e o
        // tipo passado aqui tem que bater com o foregroundServiceType do
        // manifesto. Se divergirem, o Android derruba o serviço na subida.
        val aviso = avisoFixo(getString(R.string.aviso_iniciando))
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ServiceCompat.startForeground(
                this,
                AVISO_FIXO,
                aviso,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE,
            )
        } else {
            startForeground(AVISO_FIXO, aviso)
        }

        // Sem wake lock parcial o Android suspende a CPU com a tela apagada e o
        // laço simplesmente para. O aparelho vive na tomada; o custo é zero e o
        // benefício é a maquininha continuar recebendo pedido de madrugada, com
        // a tela apagada, sem ninguém por perto.
        val energia = getSystemService(Context.POWER_SERVICE) as? PowerManager
        descanso = energia?.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "FireHubMaquininha:cobranca",
        )?.also { it.acquire() }

        rodando = true
        trabalhador = Thread({ laco() }, "fila-de-cobranca").apply {
            // Prioridade normal: esta thread fica bloqueada dentro do SDK
            // durante a transação, e é ela que alimenta a tela com o andamento.
            isDaemon = false
            start()
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACAO_ACORDAR) {
            ritmo.houveMovimento()
            // A tela voltou ao ar. Se o lojista acabou de ativar o terminal, a
            // prontidão guardada está velha e seguraria a maquininha parada por
            // até cinco minutos sem motivo nenhum.
            prontidaoJaConferida = false
            prontidaoConferidaEm = 0L
            synchronized(travaDoSono) {
                acordarAgora = true
                travaDoSono.notifyAll()
            }
        }
        // START_STICKY: se o Android matar o serviço por pressão de memória, ele
        // volta sozinho. Numa maquininha de balcão não há quem perceba que
        // parou.
        return START_STICKY
    }

    override fun onDestroy() {
        rodando = false
        synchronized(travaDoSono) {
            acordarAgora = true
            travaDoSono.notifyAll()
        }
        // De propósito NÃO se interrompe a thread: ela pode estar dentro de um
        // doPayment, com o cliente digitando a senha. Interromper ali deixaria a
        // transação sem dono, e é justamente a transação sem dono que faz o
        // cliente pagar e o pedido não sair.
        try {
            descanso?.takeIf { it.isHeld }?.release()
        } catch (erro: Exception) {
            Log.w(ETIQUETA, "Falha ao liberar o wake lock.", erro)
        }
        descanso = null
        super.onDestroy()
    }

    // ------------------------------------------------------------------ laço

    private fun laco() {
        while (rodando) {
            val espera = try {
                umaVolta()
            } catch (erro: Throwable) {
                // Uma volta que estoura não pode derrubar o serviço: no dia
                // seguinte a loja abriria com a maquininha morta e ninguém
                // saberia por quê.
                Log.e(ETIQUETA, "Falha na volta do laço.", erro)
                Ajustes.ESPERA_MAXIMA_DE_REENVIO_MS
            }
            dormir(espera)
        }
    }

    private fun dormir(milissegundos: Long) {
        if (!rodando || milissegundos <= 0L) return
        synchronized(travaDoSono) {
            acordarAgora = false
            val prazo = SystemClock.elapsedRealtime() + milissegundos
            while (rodando && !acordarAgora) {
                val restante = prazo - SystemClock.elapsedRealtime()
                if (restante <= 0L) return
                try {
                    travaDoSono.wait(restante)
                } catch (interrompida: InterruptedException) {
                    Thread.currentThread().interrupt()
                    return
                }
            }
        }
    }

    /**
     * Uma volta do laço. Devolve quanto tempo dormir antes da próxima.
     *
     * A ordem importa: resultado preso é despachado ANTES de pegar cobrança
     * nova. Um resultado preso é dinheiro que já saiu do cartão do cliente; uma
     * cobrança nova é dinheiro que ainda nem começou a sair.
     */
    private fun umaVolta(): Long {
        val token = CofreDoToken.token(this)
        if (token == null) {
            exigirPareamento(getString(R.string.erro_sem_pareamento))
            return 0L
        }

        if (!drenarFila(token)) {
            mostrarOcioso(conectado = false, detalhe = getString(R.string.aviso_reenviando))
            return esperaDeReenvio()
        }
        atualizarContadores()

        // Antes de pegar cobrança nova, fecha a conta da anterior. Enquanto
        // existir marcador em aberto há um cartão que pode ter sido debitado sem
        // que ninguém saiba, e pegar outro pedido nesse estado é a receita para
        // cobrar duas vezes o mesmo cliente.
        if (!resolverMarcadorEmAberto(token)) {
            // Espera fixa, não o ritmo do polling: quem manda aqui é o tempo de
            // o serviço do PagBank terminar de subir, não a franquia de dados.
            return Ajustes.ESPERA_ENTRE_CONFERENCIAS_MS
        }

        // Terminal sem ativação não cobra. O pedido fica na fila de propósito:
        // outra maquininha da mesma loja, se houver, ainda pode dar conta dele,
        // e tirar da fila só para recusar em seguida apenas atrasaria isso.
        val impedimento = conferirProntidao(reconferirAgora = false)
        if (impedimento !is PagamentoNaMaquininha.Impedimento.Nenhum) {
            publicarImpedimento(impedimento)
            return ritmo.intervaloMs()
        }

        // Cobrança que a tela de pareamento capturou ao validar o token. Ela já
        // está reservada no servidor, então tem que ser cobrada aqui e não pode
        // esperar a próxima consulta.
        val adiantada = EstadoDoTerminal.cobrancaAdiantada
        if (adiantada != null) {
            EstadoDoTerminal.cobrancaAdiantada = null
            processarCobranca(token, adiantada)
            return 0L
        }

        return when (val resposta = ApiDoFireHub.buscarCobranca(token)) {
            is RespostaDaFila.ComCobranca -> {
                CofreDoToken.atualizarRotulo(this, resposta.terminal)
                processarCobranca(token, resposta.cobranca)
                // Volta na hora, sem dormir: em restaurante pedido vem em
                // rajada, e o cliente seguinte já está esperando na maquininha.
                0L
            }

            is RespostaDaFila.SemCobranca -> {
                CofreDoToken.atualizarRotulo(this, resposta.terminal)
                mostrarOcioso(conectado = true, detalhe = null)
                ritmo.intervaloMs()
            }

            is RespostaDaFila.CredencialInvalida -> {
                exigirPareamento(resposta.mensagem)
                0L
            }

            is RespostaDaFila.FalhaDeRede -> {
                mostrarOcioso(conectado = false, detalhe = resposta.mensagem)
                ritmo.intervaloMs()
            }

            is RespostaDaFila.ErroDoServidor -> {
                Log.w(ETIQUETA, "Servidor respondeu " + resposta.status + ": " + resposta.mensagem)
                mostrarOcioso(conectado = false, detalhe = resposta.mensagem)
                ritmo.intervaloMs()
            }
        }
    }

    /**
     * Reenvia o que está preso. Devolve false quando a rede falhou e o laço deve
     * recuar.
     */
    private fun drenarFila(token: String): Boolean {
        for (resultado in fila.pendentes()) {
            if (!rodando) return false

            when (val resposta = ApiDoFireHub.enviarResultado(token, resultado)) {
                is RespostaDoResultado.Confirmado,
                is RespostaDoResultado.JaConfirmado,
                is RespostaDoResultado.RecusaRegistrada,
                -> {
                    fila.remover(resultado)
                    ritmo.houveMovimento()
                }

                is RespostaDoResultado.CredencialInvalida -> {
                    // O token NÃO é apagado aqui. Se este resultado for uma
                    // aprovação, ele ainda precisa chegar ao servidor, e o
                    // caminho para isso é o lojista gerar um código novo no
                    // painel: o código novo pertence à mesma maquininha, então
                    // a fila drena sozinha logo depois do repareamento. Apagar
                    // o token agora não adiantaria nada e o pendente
                    // continuaria preso do mesmo jeito.
                    exigirPareamento(resposta.mensagem)
                    return false
                }

                is RespostaDoResultado.RejeitadoDefinitivamente -> {
                    fila.travar(
                        resultado,
                        resposta.mensagem + " (HTTP " + resposta.status + ")",
                    )
                }

                is RespostaDoResultado.FalhaDeRede -> {
                    fila.contarTentativa(resultado)
                    Log.w(ETIQUETA, "Resultado preso: " + resposta.mensagem)
                    return false
                }
            }
        }
        return true
    }

    private fun esperaDeReenvio(): Long {
        val tentativas = fila.pendentes().maxOfOrNull { it.tentativasDeEnvio } ?: 0
        // Dobra a cada tentativa até o teto. Nunca desiste: do outro lado deste
        // reenvio existe um cartão que já foi debitado.
        val fator = 1L shl tentativas.coerceIn(0, 5)
        return (Ajustes.ESPERA_INICIAL_DE_REENVIO_MS * fator)
            .coerceAtMost(Ajustes.ESPERA_MAXIMA_DE_REENVIO_MS)
    }

    // ------------------------------------------------------------- cobrança

    private fun processarCobranca(token: String, cobranca: Cobranca) {
        ritmo.houveMovimento()

        // A trava contra cobrar o mesmo cliente duas vezes.
        //
        // O cenário é este: o cartão passou, o POST do resultado não chegou ao
        // servidor, e cinco minutos depois o servidor destravou o pedido sozinho
        // e o devolveu para a fila — a mesma fila que esta maquininha consulta.
        // Sem esta conferência, o app pegaria o pedido de novo e mandaria o
        // cliente encostar o cartão numa compra que ele já pagou.
        //
        // Vale para o pedido inteiro, não para a tentativa: o servidor não
        // incrementa `posTentativas` quando devolve um pedido recusado, então a
        // referência que volta é a mesma de antes e comparar por tentativa não
        // separaria nada.
        val jaCobrado = fila.aprovadoEmAberto(cobranca.pedidoId)
        if (jaCobrado != null) {
            reapresentarPagamentoJaFeito(token, cobranca, jaCobrado)
            return
        }

        val impedimento = conferirProntidao(reconferirAgora = true)
        if (impedimento !is PagamentoNaMaquininha.Impedimento.Nenhum) {
            // A cobrança já está reservada no servidor. Se este app não pode
            // cobrar, o mínimo é dizer isso e devolver o pedido para a fila na
            // hora, para outra maquininha da loja poder pegar.
            publicarImpedimento(impedimento)
            entregarResultado(token, recusaDe(cobranca, textoDoImpedimento(impedimento)), cobranca)
            return
        }

        EstadoDoTerminal.prepararEscolha()
        EstadoDoTerminal.publicar(EstadoDoTerminal.Situacao.Escolhendo(cobranca))
        chamarOperador(cobranca)

        // Pedido que já voltou para a fila sem ninguém escolher nada ganha um
        // prazo curto. A fila do servidor é atendida por ordem de criação, então
        // o pedido abandonado é sempre o próximo que esta maquininha recebe: com
        // os dois minutos cheios, um cliente que desistiu e foi embora prende o
        // terminal em ciclos de dois minutos e ninguém atrás dele consegue pagar.
        val repetido = cobranca.pedidoId == pedidoAbandonado
        val prazo =
            if (repetido) Ajustes.TEMPO_PARA_REESCOLHER_MS else Ajustes.TEMPO_PARA_ESCOLHER_MS

        val escolha = EstadoDoTerminal.aguardarEscolha(prazo)
        limparChamado()

        val tipo: TipoDePagamento = when (escolha) {
            is EstadoDoTerminal.Escolha.Forma -> {
                esquecerAbandono()
                escolha.tipo
            }

            // Cancelamento e desistência viram recusa no servidor de propósito.
            // O servidor devolve o pedido para a fila na hora, com
            // podeTentarDeNovo. A alternativa seria não avisar ninguém e deixar
            // o pedido preso pelos cinco minutos do destravamento automático,
            // com o cliente parado esperando.
            is EstadoDoTerminal.Escolha.Cancelar -> {
                entregarResultado(token, recusaDe(cobranca, getString(R.string.recusa_cancelado)), cobranca)
                // Sem respiro: quem tocou em "Cancelar" está na frente da
                // maquininha e pode querer tentar de novo em seguida. Prender a
                // tela por meio minuto aqui seria castigar quem está presente.
                anotarAbandono(cobranca, comRespiro = false)
                return
            }

            null -> {
                entregarResultado(token, recusaDe(cobranca, getString(R.string.recusa_sem_resposta)), cobranca)
                // Ninguém tocou em nada: o cliente foi embora. O respiro evita
                // que o laço gire em vazio com este pedido para sempre.
                anotarAbandono(cobranca, comRespiro = true)
                return
            }
        }

        val referenciaCurta =
            PagamentoNaMaquininha.montarReferenciaCurta(cobranca.pedidoId, cobranca.tentativa)

        // O marcador vai para o disco ANTES de o cartão ser tocado. Se faltar
        // energia no meio da transação, é por ele que o app descobre, na volta,
        // que existiu uma cobrança e consegue perguntar ao terminal se ela foi
        // aprovada.
        fila.marcarEmAndamento(
            FilaDeResultados.Marcador(
                pedidoId = cobranca.pedidoId,
                referencia = cobranca.referencia,
                referenciaCurta = referenciaCurta,
                valorEmCentavos = cobranca.valorEmCentavos,
                tipo = tipo.codigoNoContrato,
                em = System.currentTimeMillis(),
            ),
        )

        EstadoDoTerminal.publicar(
            EstadoDoTerminal.Situacao.Cobrando(cobranca, getString(R.string.andamento_inicial)),
        )

        val doSdk = PagamentoNaMaquininha.cobrar(cobranca, tipo, referenciaCurta) { andamento ->
            EstadoDoTerminal.publicar(EstadoDoTerminal.Situacao.Cobrando(cobranca, andamento))
        }

        if (doSdk.incerto) {
            // Nem o terminal sabe o que houve com o cartão. Mandar recusa agora
            // devolveria o pedido para a fila, e se o cartão tiver sido debitado
            // o cliente pagaria a mesma compra de novo. O marcador FICA no
            // disco: as próximas voltas do laço voltam a perguntar ao terminal,
            // e é `resolverMarcadorEmAberto` que fecha a conta — para um lado ou
            // para o outro.
            Log.e(ETIQUETA, "Transação sem resposta no pedido " + cobranca.pedidoId + ".")
            EstadoDoTerminal.publicar(
                EstadoDoTerminal.Situacao.Recusado(
                    cobranca,
                    getString(R.string.erro_sem_resposta_do_terminal),
                ),
            )
            dormir(TEMPO_MOSTRANDO_RESULTADO_MS)
            return
        }

        val resultado = ResultadoDeCobranca(
            pedidoId = cobranca.pedidoId,
            referencia = cobranca.referencia,
            aprovado = doSdk.aprovado,
            bandeira = doSdk.bandeira,
            nsu = doSdk.nsu,
            autorizacao = doSdk.autorizacao,
            parcelas = doSdk.parcelas,
            tipo = doSdk.tipo,
            motivoRecusa = doSdk.motivo,
        )

        // Grava primeiro, apaga o marcador depois. Na ordem inversa, uma queda
        // entre as duas linhas perderia o resultado de um cartão já debitado.
        fila.enfileirar(resultado)
        fila.limparMarcador()

        entregarResultado(token, resultado, cobranca)
        ritmo.houveMovimento()

        // Segura o resultado na tela para o cliente conseguir ler antes de a
        // maquininha voltar a "aguardando pedido".
        dormir(TEMPO_MOSTRANDO_RESULTADO_MS)
    }

    private fun recusaDe(cobranca: Cobranca, motivo: String) = ResultadoDeCobranca(
        pedidoId = cobranca.pedidoId,
        referencia = cobranca.referencia,
        aprovado = false,
        bandeira = null,
        nsu = null,
        autorizacao = null,
        parcelas = null,
        tipo = null,
        motivoRecusa = motivo,
    )

    /**
     * Grava, envia e conta para a tela o que aconteceu.
     *
     * enfileirar é chamado de novo aqui de propósito: ele substitui o registro
     * do mesmo pedido e da mesma tentativa em vez de duplicar, então chamar duas
     * vezes é inofensivo e garante que nenhum caminho chegue ao envio sem ter
     * passado pelo disco antes.
     */
    private fun entregarResultado(
        token: String,
        resultado: ResultadoDeCobranca,
        cobranca: Cobranca,
    ) {
        fila.enfileirar(resultado)

        when (val resposta = ApiDoFireHub.enviarResultado(token, resultado)) {
            is RespostaDoResultado.Confirmado -> {
                fila.remover(resultado)
                // Também sai da lista de atenção: se este resultado já tinha
                // sido travado por uma rejeição definitiva e agora passou (o
                // pedido foi corrigido no painel), deixar o alerta na tela
                // ensina o operador a ignorar a área de avisos.
                fila.removerTravado(resultado)
                EstadoDoTerminal.publicar(
                    EstadoDoTerminal.Situacao.Aprovado(cobranca, resposta.numeroDoPedido),
                )
            }

            is RespostaDoResultado.JaConfirmado -> {
                fila.remover(resultado)
                fila.removerTravado(resultado)
                EstadoDoTerminal.publicar(EstadoDoTerminal.Situacao.Aprovado(cobranca, null))
            }

            is RespostaDoResultado.RecusaRegistrada -> {
                fila.remover(resultado)
                EstadoDoTerminal.publicar(
                    EstadoDoTerminal.Situacao.Recusado(
                        cobranca,
                        resultado.motivoRecusa ?: resposta.motivo,
                    ),
                )
            }

            is RespostaDoResultado.CredencialInvalida -> exigirPareamento(resposta.mensagem)

            is RespostaDoResultado.RejeitadoDefinitivamente -> {
                fila.travar(resultado, resposta.mensagem + " (HTTP " + resposta.status + ")")
                EstadoDoTerminal.publicar(
                    EstadoDoTerminal.Situacao.Recusado(
                        cobranca,
                        // Aprovação recusada pelo servidor é o caso mais grave
                        // que este app conhece: o cartão passou e o pedido não
                        // vai ser liberado por nenhum caminho automático.
                        if (resultado.aprovado) getString(R.string.erro_aprovado_sem_registro)
                        else resposta.mensagem,
                    ),
                )
            }

            is RespostaDoResultado.FalhaDeRede -> {
                fila.contarTentativa(resultado)
                EstadoDoTerminal.publicar(
                    if (resultado.aprovado) {
                        // Para o cliente o pagamento passou, porque passou
                        // mesmo. O que falta é o FireHub saber, e o app vai
                        // insistir nisso sozinho. O contador de resultados
                        // presos aparece na tela de ocioso.
                        EstadoDoTerminal.Situacao.Aprovado(cobranca, null)
                    } else {
                        EstadoDoTerminal.Situacao.Recusado(cobranca, resultado.motivoRecusa)
                    },
                )
            }
        }

        atualizarContadores()
    }

    /**
     * Fecha a conta de uma transação que ficou sem resposta.
     *
     * Dois cenários chegam aqui, e são o mesmo problema:
     *  - o cliente encostou o cartão, o terminal aprovou e o aparelho desligou
     *    (cabo chutado, queda de energia) antes de o app registrar qualquer
     *    coisa;
     *  - a chamada de pagamento estourou e nem o terminal soube dizer o que
     *    aconteceu.
     *
     * Nos dois existe marcador em aberto e nenhuma certeza. `getLastApproved` +
     * `Transaction()` responde qual foi a última venda aprovada do terminal: se
     * for a do marcador, aquele cartão foi debitado e o resultado entra na fila;
     * se for outra, a transação não aconteceu e a recusa devolve o pedido para a
     * fila na hora, sem esperar os cinco minutos do servidor.
     *
     * O caso que este código existe para tratar é o terceiro: a pergunta em si
     * falhar. Acontece de verdade logo depois do boot, quando o app sobe pelo
     * BOOT_COMPLETED e o serviço do PagBank ainda não está no ar. Apagar o
     * marcador aí seria jogar fora a única pista de um cartão possivelmente
     * debitado — por isso ele fica, e a pergunta se repete a cada volta do laço.
     *
     * Devolve false quando o laço deve esperar em vez de pegar cobrança nova.
     */
    private fun resolverMarcadorEmAberto(token: String): Boolean {
        val marcador = fila.marcadorEmAberto() ?: return true
        Log.w(ETIQUETA, "Marcador em aberto do pedido " + marcador.pedidoId + "; conferindo.")

        val conferencia = try {
            PagamentoNaMaquininha.conferirUltimaAprovada(
                marcador.referenciaCurta,
                marcador.valorEmCentavos,
                null,
            )
        } catch (erro: Throwable) {
            Log.e(ETIQUETA, "Falha ao conferir a última transação aprovada.", erro)
            PagamentoNaMaquininha.ConferenciaDaUltima.NaoDeuParaConferir(
                erro.message ?: "O serviço do PagBank não respondeu.",
            )
        }

        when (conferencia) {
            is PagamentoNaMaquininha.ConferenciaDaUltima.FoiEsta -> {
                Log.w(ETIQUETA, "Pagamento recuperado do pedido " + marcador.pedidoId + ".")
                val recuperado = conferencia.resultado
                // Grava primeiro, apaga o marcador depois. Na ordem inversa, uma
                // queda entre as duas linhas perderia o cartão já debitado.
                fila.enfileirar(
                    ResultadoDeCobranca(
                        pedidoId = marcador.pedidoId,
                        referencia = marcador.referencia,
                        aprovado = true,
                        bandeira = recuperado.bandeira,
                        nsu = recuperado.nsu,
                        autorizacao = recuperado.autorizacao,
                        parcelas = recuperado.parcelas,
                        tipo = recuperado.tipo ?: marcador.tipo,
                        motivoRecusa = null,
                    ),
                )
                fila.limparMarcador()
            }

            is PagamentoNaMaquininha.ConferenciaDaUltima.NaoFoiEsta -> {
                // A última aprovada é de outra venda: esta não foi paga. A
                // recusa devolve o pedido para a fila agora, em vez de deixar o
                // cliente parado até o destravamento automático do servidor.
                Log.w(ETIQUETA, "O pedido " + marcador.pedidoId + " não chegou a ser pago.")
                fila.enfileirar(
                    ResultadoDeCobranca(
                        pedidoId = marcador.pedidoId,
                        referencia = marcador.referencia,
                        aprovado = false,
                        bandeira = null,
                        nsu = null,
                        autorizacao = null,
                        parcelas = null,
                        tipo = marcador.tipo.ifBlank { null },
                        motivoRecusa = getString(R.string.recusa_interrompida),
                    ),
                )
                fila.limparMarcador()
            }

            is PagamentoNaMaquininha.ConferenciaDaUltima.NaoDeuParaConferir -> {
                if (marcador.conferencias + 1 < CONFERENCIAS_ANTES_DE_CHAMAR_GENTE) {
                    fila.contarConferencia(marcador)
                    EstadoDoTerminal.publicar(
                        EstadoDoTerminal.Situacao.Ocioso(
                            terminal = CofreDoToken.rotulo(this),
                            conectado = true,
                            detalhe = getString(R.string.aviso_conferindo_cartao),
                        ),
                    )
                    // Não pega cobrança nova enquanto isto não fechar.
                    return false
                }

                // Acabaram as tentativas. Não se manda recusa (o cartão pode ter
                // sido debitado) nem aprovação (pode não ter). O registro vai
                // para a lista de atenção com o código da venda, que é por onde
                // uma pessoa consegue procurar no extrato do PagBank.
                Log.e(
                    ETIQUETA,
                    "Desistindo de conferir o pedido " + marcador.pedidoId + ": " + conferencia.motivo,
                )
                fila.travar(
                    ResultadoDeCobranca(
                        pedidoId = marcador.pedidoId,
                        referencia = marcador.referencia,
                        aprovado = false,
                        bandeira = null,
                        nsu = null,
                        autorizacao = null,
                        parcelas = null,
                        tipo = marcador.tipo.ifBlank { null },
                        motivoRecusa = null,
                    ),
                    getString(
                        R.string.travado_sem_conferencia,
                        marcador.referenciaCurta,
                        conferencia.motivo,
                    ),
                )
                fila.limparMarcador()
                // O texto para o balcão sai do próprio motivo do travado, que
                // `atualizarContadores` publica logo abaixo. Repeti-lo no aviso
                // da fila faria a mensagem sobre cartão sumir na primeira venda
                // seguinte, que é exatamente quando ela ainda importa.
            }
        }

        atualizarContadores()
        // O resultado recém-gravado sai na drenagem da próxima volta; devolver
        // true aqui deixaria a maquininha pegar cobrança nova antes disso.
        return drenarFila(token)
    }

    /**
     * O pedido que chegou já foi cobrado e o cartão passou. Não se cobra de
     * novo: tenta-se entregar ao servidor o resultado que já existe.
     */
    private fun reapresentarPagamentoJaFeito(
        token: String,
        cobranca: Cobranca,
        jaCobrado: ResultadoDeCobranca,
    ) {
        Log.e(
            ETIQUETA,
            "O pedido " + cobranca.pedidoId + " voltou para a fila mas já tem cartão aprovado aqui.",
        )

        when (val resposta = ApiDoFireHub.enviarResultado(token, jaCobrado)) {
            is RespostaDoResultado.Confirmado, is RespostaDoResultado.JaConfirmado -> {
                fila.remover(jaCobrado)
                fila.removerTravado(jaCobrado)
                EstadoDoTerminal.publicar(EstadoDoTerminal.Situacao.Aprovado(cobranca, null))
                esquecerAbandono()
            }

            is RespostaDoResultado.CredencialInvalida -> exigirPareamento(resposta.mensagem)

            // A rede caiu de novo. Não é caso de alarme: o resultado continua na
            // fila e o app insiste sozinho. O que NÃO pode acontecer é o cartão
            // passar outra vez, e isso já foi evitado ao chegar aqui.
            is RespostaDoResultado.FalhaDeRede -> {
                fila.contarTentativa(jaCobrado)
                EstadoDoTerminal.publicar(EstadoDoTerminal.Situacao.Aprovado(cobranca, null))
            }

            // O servidor entendeu e continua dizendo não. Este é o caso grave:
            // existe cartão debitado e o pedido não vai ser liberado por nenhum
            // caminho automático. Deixar o pedido voltar para a fila numa recusa
            // faria a maquininha oferecê-lo de novo, e alguém pagaria duas vezes.
            is RespostaDoResultado.RejeitadoDefinitivamente,
            is RespostaDoResultado.RecusaRegistrada,
            -> {
                fila.travar(jaCobrado, getString(R.string.travado_ja_pago, cobranca.descricao))
                EstadoDoTerminal.publicar(
                    EstadoDoTerminal.Situacao.Recusado(
                        cobranca,
                        getString(R.string.erro_aprovado_sem_registro),
                    ),
                )
            }
        }

        atualizarContadores()
        dormir(TEMPO_MOSTRANDO_RESULTADO_MS)
    }

    /** Ninguém pagou. Conta quantas vezes seguidas foi o mesmo pedido. */
    private fun anotarAbandono(cobranca: Cobranca, comRespiro: Boolean) {
        if (cobranca.pedidoId == pedidoAbandonado) abandonosSeguidos++
        else {
            pedidoAbandonado = cobranca.pedidoId
            abandonosSeguidos = 1
        }

        if (abandonosSeguidos < 2) return

        // Do segundo abandono em diante, o pedido está travando a fila: ele é o
        // mais antigo, então o servidor devolve sempre ele, e quem pediu depois
        // não consegue pagar. O app não pode tirá-lo da fila — quem pode é uma
        // pessoa no painel — então diz qual é e para de girar em vazio.
        EstadoDoTerminal.publicarAviso(
            getString(R.string.aviso_pedido_abandonado, cobranca.descricao, abandonosSeguidos),
        )
        if (comRespiro) dormir(Ajustes.ESPERA_APOS_ABANDONO_MS)
    }

    private fun esquecerAbandono() {
        if (pedidoAbandonado == null) return
        pedidoAbandonado = null
        abandonosSeguidos = 0
        EstadoDoTerminal.publicarAviso(null)
    }

    // ------------------------------------------------------------- prontidão

    private fun conferirProntidao(reconferirAgora: Boolean): PagamentoNaMaquininha.Impedimento {
        val agora = SystemClock.elapsedRealtime()
        val vencida = agora - prontidaoConferidaEm >= VALIDADE_DA_PRONTIDAO_MS
        if (!reconferirAgora && prontidaoJaConferida && !vencida) return prontidao

        prontidao = PagamentoNaMaquininha.impedimentoParaCobrar()
        prontidaoJaConferida = true
        prontidaoConferidaEm = agora
        return prontidao
    }

    private fun publicarImpedimento(impedimento: PagamentoNaMaquininha.Impedimento) {
        val situacao = when (impedimento) {
            is PagamentoNaMaquininha.Impedimento.ServicoNaoInstalado ->
                EstadoDoTerminal.Situacao.SemServicoDoPagBank(getString(R.string.erro_sem_servico_pagbank))

            is PagamentoNaMaquininha.Impedimento.TerminalNaoAtivado ->
                EstadoDoTerminal.Situacao.PrecisaAtivar(getString(R.string.erro_terminal_nao_ativado))

            is PagamentoNaMaquininha.Impedimento.FalhaAoConsultar ->
                EstadoDoTerminal.Situacao.SemServicoDoPagBank(impedimento.mensagem)

            is PagamentoNaMaquininha.Impedimento.Nenhum -> return
        }
        EstadoDoTerminal.publicar(situacao)
    }

    private fun textoDoImpedimento(impedimento: PagamentoNaMaquininha.Impedimento): String =
        when (impedimento) {
            is PagamentoNaMaquininha.Impedimento.ServicoNaoInstalado ->
                getString(R.string.recusa_sem_servico)
            is PagamentoNaMaquininha.Impedimento.TerminalNaoAtivado ->
                getString(R.string.recusa_nao_ativado)
            is PagamentoNaMaquininha.Impedimento.FalhaAoConsultar ->
                getString(R.string.recusa_maquininha_muda)
            is PagamentoNaMaquininha.Impedimento.Nenhum -> ""
        }

    // ----------------------------------------------------------------- telas

    /**
     * Para o laço e manda a tela pedir o pareamento de novo.
     *
     * Continuar perguntando com um crachá recusado seria bater no servidor a
     * cada dois segundos para ouvir 401 até alguém ir até a loja. Quem resolve
     * isso é uma pessoa no painel do FireHub, então o app cala a boca e diz o
     * que precisa ser feito.
     */
    private fun exigirPareamento(mensagem: String) {
        EstadoDoTerminal.publicar(EstadoDoTerminal.Situacao.PrecisaParear(mensagem))
        rodando = false
        stopSelf()
    }

    private fun mostrarOcioso(conectado: Boolean, detalhe: String?) {
        val rotulo = CofreDoToken.rotulo(this)
        EstadoDoTerminal.publicar(
            EstadoDoTerminal.Situacao.Ocioso(rotulo, conectado, detalhe),
        )
        atualizarAvisoFixo(
            if (conectado) getString(R.string.aviso_aguardando) + " - " + ritmo.descricao()
            else getString(R.string.aviso_sem_conexao),
        )
    }

    private fun atualizarContadores() {
        val travados = fila.travados()
        EstadoDoTerminal.publicarContadores(
            presos = fila.pendentes().size,
            travados = travados.size,
            // O motivo do mais recente, e não uma lista: a tela tem uma faixa de
            // texto pequena, e o registro mais novo é o que ainda dá para
            // resolver olhando o extrato do dia.
            motivo = travados.lastOrNull()?.motivo,
        )
    }

    // --------------------------------------------------------- notificações

    private fun notificador(): NotificationManager =
        getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private fun criarCanais() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return

        // Canal silencioso: o aviso fixo do serviço fica o dia inteiro na barra
        // e não pode apitar a cada atualização de texto.
        val operacao = NotificationChannel(
            CANAL_OPERACAO,
            getString(R.string.canal_operacao),
            NotificationManager.IMPORTANCE_LOW,
        ).apply { setShowBadge(false) }

        // Canal de alta importância, e só ele. É o que autoriza o
        // fullScreenIntent que traz a tela de cobrança para a frente quando o
        // operador está em outro app.
        val chamada = NotificationChannel(
            CANAL_CHAMADA,
            getString(R.string.canal_chamada),
            NotificationManager.IMPORTANCE_HIGH,
        )

        notificador().createNotificationChannel(operacao)
        notificador().createNotificationChannel(chamada)
    }

    private fun telaDeOperacao(): PendingIntent {
        val intent = Intent(this, OperacaoActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        return PendingIntent.getActivity(
            this,
            0,
            intent,
            // FLAG_IMMUTABLE é obrigatório da API 31 em diante e já existe
            // desde a 23, então não precisa de desvio por versão.
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
    }

    private fun avisoFixo(texto: String): Notification =
        NotificationCompat.Builder(this, CANAL_OPERACAO)
            .setSmallIcon(R.drawable.ic_aviso)
            .setContentTitle(getString(R.string.nome_do_app))
            .setContentText(texto)
            .setOngoing(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(telaDeOperacao())
            .build()

    @Volatile
    private var ultimoTextoDoAviso: String? = null

    private fun atualizarAvisoFixo(texto: String) {
        // Reemitir a notificação a cada volta do laço acordaria a barra de
        // status de 2 em 2 segundos sem nada de novo para dizer.
        if (texto == ultimoTextoDoAviso) return
        ultimoTextoDoAviso = texto
        notificador().notify(AVISO_FIXO, avisoFixo(texto))
    }

    /**
     * Traz a tela de cobrança para a frente.
     *
     * Dois caminhos, porque nenhum funciona sozinho em todas as versões:
     *
     *  - startActivity direto resolve até o Android 9 e é instantâneo;
     *  - da API 29 em diante o sistema bloqueia abrir tela a partir do
     *    background, e o fullScreenIntent é a via oficial que continua valendo.
     *
     * Sem isso, o operador que saiu do app não vê a cobrança chegar, e o pedido
     * fica reservado numa maquininha que ninguém está olhando.
     *
     * SYSTEM_ALERT_WINDOW resolveria de outro jeito e está na lista de
     * permissões PROIBIDAS pelo PagBank, então não é opção.
     */
    private fun chamarOperador(cobranca: Cobranca) {
        val pendente = telaDeOperacao()

        val aviso = NotificationCompat.Builder(this, CANAL_CHAMADA)
            .setSmallIcon(R.drawable.ic_aviso)
            .setContentTitle(getString(R.string.chamada_titulo))
            .setContentText(cobranca.valorFormatado() + " - " + cobranca.descricao)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setOngoing(true)
            .setAutoCancel(false)
            .setContentIntent(pendente)
            .setFullScreenIntent(pendente, true)
            .build()

        try {
            notificador().notify(AVISO_DE_COBRANCA, aviso)
        } catch (erro: Exception) {
            // A partir da API 33 a notificação depende de permissão do usuário.
            // Se ela faltar, a venda não pode parar por causa disso.
            Log.w(ETIQUETA, "Não foi possível avisar pela barra de status.", erro)
        }

        try {
            startActivity(
                Intent(this, OperacaoActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            )
        } catch (erro: Exception) {
            Log.i(ETIQUETA, "Abertura direta bloqueada; a tela vai pelo aviso.", erro)
        }
    }

    private fun limparChamado() {
        try {
            notificador().cancel(AVISO_DE_COBRANCA)
        } catch (erro: Exception) {
            Log.w(ETIQUETA, "Falha ao limpar o aviso de cobrança.", erro)
        }
    }
}
