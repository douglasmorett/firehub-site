package br.com.firehub.maquininha.pagamento

import android.content.Context
import android.content.pm.PackageManager
import android.os.Looper
import android.util.Log
import br.com.firehub.maquininha.rede.Cobranca
import br.com.firehub.maquininha.rede.TipoDePagamento
import br.com.uol.pagseguro.plugpagservice.wrapper.IPlugPagWrapper
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPag
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagActivationData
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagCustomPrinterLayout
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagEventData
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagEventListener
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagPaymentData
import br.com.uol.pagseguro.plugpagservice.wrapper.PlugPagTransactionResult

/**
 * O ÚNICO lugar do app que fala com o SDK do PagBank.
 *
 * Todo o resto do código conhece "cobrar" e "resultado", nunca PlugPag. Isso
 * existe para que a hora de conferir o comportamento com o terminal de debug na
 * mão seja um arquivo só, e para que nenhuma regra de negócio fique presa dentro
 * de um detalhe da adquirente.
 *
 * REGRA QUE DERRUBA APP DE TOTEM: as operações do PlugPag são BLOQUEANTES e não
 * admitem concorrência. Duas chamadas ao mesmo tempo devolvem SV03 ou PP1047
 * ("serviço ocupado"). Por isso todo método público daqui:
 *   1. exige estar fora da thread principal, e
 *   2. é serializado pelo mesmo cadeado.
 * O laço do serviço de cobrança já é sequencial por construção; o cadeado é a
 * garantia de que uma tela nunca vai atropelar o laço.
 */
object PagamentoNaMaquininha {

    private const val ETIQUETA = "PagamentoPagBank"

    /** O app de pagamento do PagBank. Sem ele instalado, não existe cobrança. */
    private const val PACOTE_DO_SERVICO = "br.com.uol.pagseguro.plugpagservice"

    /** Piso da adquirente. Abaixo disso a transação é recusada pelo terminal. */
    private const val VALOR_MINIMO_EM_CENTAVOS = 100

    /**
     * Segundos até o popup de comprovante do cliente sumir sozinho.
     *
     * Num balcão com operador, um popup esperando toque é só um incômodo. Numa
     * maquininha ao lado de um totem de autoatendimento, é a fila inteira
     * parada, porque ninguém do outro lado sabe que existe um botão para tocar.
     *
     * CONFERIR NO TERMINAL DE DEBUG: não está documentado se o popup chega a
     * aparecer quando printReceipt = false. Se não aparecer, esta linha é
     * inofensiva; se aparecer, ela é o que impede a maquininha de travar.
     */
    private const val SEGUNDOS_ATE_O_POPUP_SUMIR = 60

    private val cadeado = Any()

    @Volatile
    private var contexto: Context? = null

    @Volatile
    private var wrapper: IPlugPagWrapper? = null

    fun guardarContexto(context: Context) {
        contexto = context.applicationContext
    }

    /**
     * Resultado da transação já traduzido para o vocabulário do FireHub, sem
     * nenhum tipo do SDK vazando para fora deste arquivo.
     */
    data class ResultadoDoSdk(
        val aprovado: Boolean,
        val bandeira: String?,
        val nsu: String?,
        val autorizacao: String?,
        val parcelas: Int?,
        val tipo: String?,
        val motivo: String?,
        val codigoDeErro: String?,
        /**
         * Verdadeiro quando NEM O TERMINAL sabe o que aconteceu com o cartão.
         *
         * É diferente de `aprovado = false`. Recusa é uma resposta: o cartão não
         * passou, o pedido volta para a fila e o cliente tenta outro. Incerto é
         * a ausência de resposta — a chamada estourou e o terminal também não
         * soube dizer qual foi a última venda aprovada.
         *
         * Quem recebe isto NÃO pode mandar recusa para o servidor: se o cartão
         * tiver sido debitado, o pedido voltaria para a fila e o cliente pagaria
         * de novo. O caminho certo é segurar o marcador em disco e reconferir
         * nas próximas voltas do laço, que é o que `ServicoDeCobranca` faz.
         */
        val incerto: Boolean = false,
    )

    /**
     * O que o terminal respondeu quando lhe perguntamos se uma venda específica
     * chegou a ser aprovada.
     *
     * As três respostas são diferentes e tratá-las como duas é como se perde
     * dinheiro: "não foi esta" é informação (a venda não aconteceu), enquanto
     * "não deu para conferir" é a falta dela (o cartão pode ter sido debitado e
     * ninguém sabe). Quem trata as duas como "não" apaga a única pista que havia
     * de uma cobrança já paga.
     */
    sealed class ConferenciaDaUltima {
        /** A última venda aprovada do terminal É esta cobrança. */
        data class FoiEsta(val resultado: ResultadoDoSdk) : ConferenciaDaUltima()

        /** A última aprovada é de outra venda: esta não chegou a ser paga. */
        object NaoFoiEsta : ConferenciaDaUltima()

        /** O terminal não respondeu, ou respondeu algo que não dá para ler. */
        data class NaoDeuParaConferir(val motivo: String) : ConferenciaDaUltima()
    }

    /** Por que a maquininha não pode cobrar agora. */
    sealed class Impedimento {
        object Nenhum : Impedimento()
        object ServicoNaoInstalado : Impedimento()
        object TerminalNaoAtivado : Impedimento()
        data class FalhaAoConsultar(val mensagem: String) : Impedimento()
    }

    // ------------------------------------------------------------- prontidão

    /**
     * O serviço de pagamento do PagBank está instalado neste aparelho?
     *
     * Num terminal Smart POS de verdade está sempre. A resposta "não" aparece
     * quando alguém instala este APK num tablet comum para testar a tela — e
     * nesse caso o app precisa DIZER isso, não fingir que cobrou. É consulta
     * barata, então não precisa sair da thread principal.
     */
    fun servicoDoPagBankInstalado(context: Context): Boolean = try {
        context.packageManager.getPackageInfo(PACOTE_DO_SERVICO, 0)
        true
    } catch (erro: PackageManager.NameNotFoundException) {
        false
    }

    /**
     * O terminal já foi ativado junto ao PagBank?
     *
     * Ativação do PagBank e pareamento com o FireHub são coisas DIFERENTES e não
     * devem ser confundidas na tela: a primeira habilita o aparelho a passar
     * cartão, a segunda diz a este app de qual loja ele é. Um terminal pode
     * estar ativado e não pareado, e vice-versa.
     */
    fun impedimentoParaCobrar(): Impedimento {
        exigirThreadDeTrabalho()
        val app = contexto ?: return Impedimento.FalhaAoConsultar("Aplicação não iniciada.")
        if (!servicoDoPagBankInstalado(app)) return Impedimento.ServicoNaoInstalado

        return try {
            synchronized(cadeado) {
                if (obterWrapper().isAuthenticated()) Impedimento.Nenhum
                else Impedimento.TerminalNaoAtivado
            }
        } catch (erro: Throwable) {
            Log.e(ETIQUETA, "Falha ao consultar a ativação do terminal.", erro)
            Impedimento.FalhaAoConsultar(erro.message ?: "Não foi possível falar com o serviço do PagBank.")
        }
    }

    /**
     * Ativa o pinpad com o código que o lojista recebeu do PagBank.
     *
     * Existe um segundo caminho, que é o que o app-demo oficial usa: chamar
     * startOnBoarding() e deixar o aplicativo "Boas Vindas" do PagBank conduzir
     * a ativação. Os dois estão disponíveis aqui porque, na prática, o terminal
     * costuma chegar à loja já ativado e o campo de código só serve para o caso
     * em que não chegou.
     */
    fun ativarComCodigo(codigo: String): Result<Unit> {
        exigirThreadDeTrabalho()
        return try {
            synchronized(cadeado) {
                val retorno = obterWrapper()
                    .initializeAndActivatePinpad(PlugPagActivationData(codigo.trim()))
                if (retorno.result == PlugPag.RET_OK) {
                    Result.success(Unit)
                } else {
                    val detalhe = retorno.errorMessage.ifBlank { "Código " + retorno.errorCode }
                    Result.failure(IllegalStateException(detalhe))
                }
            }
        } catch (erro: Throwable) {
            Log.e(ETIQUETA, "Falha na ativação do pinpad.", erro)
            Result.failure(erro)
        }
    }

    /** Abre o aplicativo de ativação do PagBank e devolve o controle a ele. */
    fun abrirAtivacaoDoPagBank(): Result<Unit> {
        exigirThreadDeTrabalho()
        return try {
            synchronized(cadeado) { obterWrapper().startOnBoarding() }
            Result.success(Unit)
        } catch (erro: Throwable) {
            Log.e(ETIQUETA, "Falha ao abrir a ativação do PagBank.", erro)
            Result.failure(erro)
        }
    }

    // --------------------------------------------------- código da venda

    /**
     * DECISÃO DE PRODUTO, tomada aqui porque o contrato do FireHub e a regra do
     * PagBank não cabem um no outro.
     *
     * O FireHub identifica a tentativa por "<pedidoId>:<tentativa>", algo como
     * "ckx8h2j9a0001qw:1". O campo userReference do PagBank aceita no máximo 10
     * caracteres e SÓ letras não acentuadas e números — existe até um código de
     * erro dedicado, INVALID_LENGTH_USER_REFERENCE. Mandar a referência crua não
     * cabe e ainda leva um caractere proibido junto.
     *
     * O que vai para o PagBank: os 6 últimos caracteres do pedido, em maiúsculo,
     * mais "T" e o número da tentativa. Ex.: "A1B2C3T1".
     *
     * Os 6 últimos não são arbitrários: é exatamente o mesmo pedaço que o
     * servidor usa para montar a descrição quando o pedido ainda não tem número
     * ("Pedido A1B2C3"), e no fluxo do totem ele nunca tem — o número só é
     * gerado dentro da transação que confirma o pagamento. Ou seja, o código que
     * aparece no extrato do PagBank é o mesmo que o cliente viu na tela. Quem
     * for conciliar caixa no fim do dia consegue casar os dois sem tabela de
     * conversão.
     *
     * A referência completa NÃO se perde: ela continua sendo guardada do lado do
     * app e volta inteira no POST de resultado.
     */
    fun montarReferenciaCurta(pedidoId: String, tentativa: Int): String {
        val limpo = pedidoId.filter { caractere ->
            caractere in 'a'..'z' || caractere in 'A'..'Z' || caractere in '0'..'9'
        }
        val base = limpo.takeLast(6).uppercase()
        val numero = tentativa.coerceIn(1, 99)
        return (base + "T" + numero).take(10)
    }

    // ----------------------------------------------------------- a cobrança

    /**
     * Passa o cartão. Bloqueia até o cliente terminar (ou desistir).
     *
     * `aoProgredir` recebe as mensagens do próprio terminal, já em português e
     * em caixa alta ("APROXIME O CARTÃO", "DIGITE A SENHA"). Elas vêm prontas do
     * PagBank de propósito: reescrevê-las na mão faria a tela do app divergir do
     * que o pinpad está de fato esperando.
     *
     * NUNCA devolve sucesso inventado. Se qualquer coisa der errado, o retorno
     * diz recusado com o motivo — exceto no caso em que a transação pode ter
     * passado sem o app saber, que é tratado consultando a última aprovada.
     */
    fun cobrar(
        cobranca: Cobranca,
        tipo: TipoDePagamento,
        referenciaCurta: String,
        aoProgredir: (String) -> Unit,
    ): ResultadoDoSdk {
        exigirThreadDeTrabalho()

        if (cobranca.valorEmCentavos < VALOR_MINIMO_EM_CENTAVOS) {
            // Melhor recusar aqui, com um motivo que o operador entende, do que
            // deixar o terminal devolver um código numérico depois de o cliente
            // já ter aproximado o cartão.
            return recusa("Valor abaixo do mínimo aceito pela maquininha (R$ 1,00).", null, tipo)
        }

        val dados = PlugPagPaymentData(
            type = codigoDoTipo(tipo),
            amount = cobranca.valorEmCentavos,
            installmentType = PlugPag.INSTALLMENT_TYPE_A_VISTA,
            installments = PlugPag.A_VISTA_INSTALLMENT_QUANTITY,
            userReference = referenciaCurta,
            // A via do estabelecimento não é impressa: quem imprime o pedido é o
            // FireHub, na impressora da cozinha, e bobina de terminal é
            // consumível que acaba no meio do movimento.
            printReceipt = false,
            partialPay = false,
            isCarne = false,
        )

        return synchronized(cadeado) {
            val plugPag = try {
                obterWrapper()
            } catch (erro: Throwable) {
                Log.e(ETIQUETA, "Não foi possível falar com o serviço do PagBank.", erro)
                // Não chegou a existir transação: o vínculo com o serviço nem
                // abriu. Recusar aqui é seguro e devolve o pedido para a fila.
                return@synchronized recusa("A maquininha não respondeu. Chame o operador.", null, tipo)
            }

            prepararPopupDeComprovante(plugPag)

            // O ouvinte é um só, permanente, e lê para onde mandar o andamento
            // num campo que esta função troca. A alternativa — registrar um
            // ouvinte novo a cada venda — deixava o ouvinte da venda ANTERIOR
            // registrado depois que ela terminava, e qualquer operação seguinte
            // que emitisse evento (a conferência da última aprovada, por
            // exemplo) fazia a tela voltar a mostrar o valor da compra passada.
            // Numa tela cujo único trabalho é mostrar o valor certo antes de o
            // cartão ser encostado, isso é grave.
            synchronized(senhaDigitada) { senhaDigitada.setLength(0) }
            andamentoAtual = aoProgredir
            plugPag.setEventListener(ouvinteDoPinpad)

            try {
                traduzir(plugPag.doPayment(dados), tipo)
            } catch (erro: Throwable) {
                // Aqui mora o pior caso do app: a chamada estourou, mas ninguém
                // sabe se foi ANTES ou DEPOIS de o cartão ser debitado. Dizer
                // "recusado" agora seria mandar o cliente pagar de novo uma
                // compra que já pagou. Antes de decidir, pergunta ao terminal
                // qual foi a última venda aprovada.
                Log.e(ETIQUETA, "Exceção durante a transação; conferindo a última aprovada.", erro)
                when (val conferencia = conferirUltimaAprovada(referenciaCurta, cobranca.valorEmCentavos, tipo)) {
                    is ConferenciaDaUltima.FoiEsta -> conferencia.resultado

                    // O terminal sabe qual foi a última venda aprovada e não é
                    // esta. O cartão não foi debitado: recusar é honesto e
                    // devolve o pedido para a fila na hora.
                    is ConferenciaDaUltima.NaoFoiEsta ->
                        recusa("A transação foi interrompida.", null, tipo)

                    // Nem o terminal sabe. NÃO é recusa: quem chamou tem que
                    // segurar o marcador e perguntar de novo daqui a pouco.
                    is ConferenciaDaUltima.NaoDeuParaConferir -> {
                        Log.e(ETIQUETA, "Transação sem resposta: " + conferencia.motivo)
                        recusa("A maquininha não confirmou o resultado.", null, tipo)
                            .copy(incerto = true)
                    }
                }
            } finally {
                // Sem isto o ouvinte continua apontando para a tela desta venda.
                andamentoAtual = null
            }
        }
    }

    /**
     * Pergunta ao terminal qual foi a última venda aprovada e responde se ela é
     * esta cobrança.
     *
     * Usado em dois momentos, os dois de recuperação:
     *  - quando doPayment estoura sem dizer o que houve com o cartão;
     *  - quando o app volta de um desligamento e encontra um marcador em aberto.
     *
     * A comparação é pela referência curta, que é única por pedido e tentativa.
     * O valor entra como segunda conferência: se a última aprovada tiver a mesma
     * referência mas valor diferente, alguma coisa está muito errada e é melhor
     * não confirmar nada.
     */
    fun conferirUltimaAprovada(
        referenciaCurta: String,
        valorEmCentavos: Int,
        tipo: TipoDePagamento?,
    ): ConferenciaDaUltima {
        exigirThreadDeTrabalho()
        if (referenciaCurta.isBlank()) {
            return ConferenciaDaUltima.NaoDeuParaConferir("O marcador não trazia o código da venda.")
        }

        val app = contexto
            ?: return ConferenciaDaUltima.NaoDeuParaConferir("Aplicação não iniciada.")
        if (!servicoDoPagBankInstalado(app)) {
            return ConferenciaDaUltima.NaoDeuParaConferir("O serviço do PagBank não está no aparelho.")
        }

        val ultima: PlugPagTransactionResult = try {
            synchronized(cadeado) { obterWrapper().getLastApprovedTransaction() }
        } catch (erro: Throwable) {
            // Acontece de verdade logo depois de o aparelho ligar: o app sobe
            // pelo BOOT_COMPLETED e o serviço do PagBank ainda não está no ar,
            // então esta chamada estoura. É exatamente o momento em que existe
            // marcador em aberto para conferir — por isso "não deu" tem que ser
            // uma resposta própria, e não virar "não foi esta venda".
            Log.e(ETIQUETA, "Não foi possível consultar a última transação aprovada.", erro)
            return ConferenciaDaUltima.NaoDeuParaConferir(
                erro.message ?: "O serviço do PagBank não respondeu.",
            )
        }

        val referenciaDela: String? = ultima.userReference?.trim()?.ifBlank { null }
        if (referenciaDela == null) {
            // Sem código da venda não dá para afirmar nada nos dois sentidos.
            return ConferenciaDaUltima.NaoDeuParaConferir(
                "O terminal não devolveu o código da última venda.",
            )
        }
        if (!referenciaDela.equals(referenciaCurta.trim(), ignoreCase = true)) {
            Log.i(ETIQUETA, "A última aprovada é de outra venda (" + referenciaDela + ").")
            return ConferenciaDaUltima.NaoFoiEsta
        }

        // O valor vem como texto e há terminais que o devolvem com zeros à
        // esquerda. Tirar tudo que não for dígito cobre as duas formas.
        val valorDela = ultima.amount?.filter { it.isDigit() }?.toIntOrNull()
        if (valorDela != null && valorDela != valorEmCentavos) {
            // Código da venda bate e valor não bate é contradição, não é
            // resposta. Pode ser tanto o formato do campo (se algum terminal
            // devolver "12.34" em vez de "1234", os dígitos dariam 1234 e o
            // casamento falharia à toa) quanto algo de fato errado. Nos dois
            // casos, gente tem que olhar — não se apaga o marcador por isto.
            Log.e(
                ETIQUETA,
                "Referência bate mas o valor não: esperado " + valorEmCentavos +
                    ", veio " + valorDela + " (bruto: " + ultima.amount + ").",
            )
            return ConferenciaDaUltima.NaoDeuParaConferir(
                "O terminal devolveu esta venda com valor diferente do cobrado.",
            )
        }

        // getLastApprovedTransaction devolve, por definição, uma venda APROVADA.
        // Não dá para reaproveitar o teste de aprovação do doPayment aqui: os
        // campos `result` e `errorCode` são todos anuláveis no SDK e, quando
        // vêm vazios nesta consulta, aquele teste concluiria "recusado" e o app
        // jogaria fora um cartão que foi debitado de verdade.
        //
        // O único caso em que se recusa a conclusão é o terminal dizer, com
        // todas as letras, um código de erro diferente de "0000" — aí a resposta
        // se contradiz e ninguém deveria confirmar nada.
        val codigo: String? = ultima.errorCode?.trim()?.ifBlank { null }
        if (codigo != null && codigo != PlugPag.ERROR_CODE_OK) {
            Log.e(ETIQUETA, "A última aprovada veio com código de erro " + codigo + ".")
            return ConferenciaDaUltima.NaoDeuParaConferir(
                "O terminal devolveu esta venda com o código de erro " + codigo + ".",
            )
        }

        Log.w(ETIQUETA, "Transação recuperada pela última aprovada: " + referenciaCurta)
        val traduzida = traduzir(ultima, tipo)
        return ConferenciaDaUltima.FoiEsta(
            traduzida.copy(aprovado = true, motivo = null, incerto = false),
        )
    }

    /**
     * Pede ao terminal para interromper a transação em andamento.
     *
     * abort() NÃO encerra a chamada anterior: doPayment continua bloqueado e vai
     * retornar do jeito dele. Quem chamou doPayment tem que esperar esse retorno
     * de qualquer forma — chamar outra operação antes disso é o caminho direto
     * para o SV03.
     *
     * Por isso este método é o único que NÃO pega o cadeado: ele precisa rodar
     * enquanto o cadeado está na mão do doPayment.
     */
    fun abortar() {
        exigirThreadDeTrabalho()
        try {
            wrapper?.abort()
        } catch (erro: Throwable) {
            Log.e(ETIQUETA, "Falha ao abortar a transação.", erro)
        }
    }

    // ------------------------------------------------------------- tradução

    /**
     * Aprovado ou não?
     *
     * Há duas fontes e elas não são a mesma coisa: os exemplos oficiais do KDoc
     * conferem result == RET_OK, e o app-demo do PagBank confere a string
     * errorCode == "0000". Normalmente concordam.
     *
     * Quando discordam, este código considera APROVADO. A escolha é assimétrica
     * de propósito, porque os dois erros possíveis não custam a mesma coisa:
     *
     *  - dizer "aprovado" sem ter debitado deixa um pedido sem lastro, que
     *    aparece na conciliação do fim do dia e alguém resolve;
     *  - dizer "recusado" tendo debitado manda o cliente passar o cartão de
     *    novo, e ele paga duas vezes uma compra só, na frente do caixa.
     *
     * A divergência fica no log justamente porque não deveria acontecer: se
     * aparecer no terminal de debug, é sinal de que uma das duas fontes está
     * sendo lida errado e isto aqui precisa ser revisto.
     */
    private fun traduzir(resultado: PlugPagTransactionResult, tipo: TipoDePagamento?): ResultadoDoSdk {
        val codigo: String? = resultado.errorCode?.trim()?.ifBlank { null }
        val retorno: Int? = resultado.result

        val okPeloRetorno = retorno == PlugPag.RET_OK
        val okPeloCodigo = codigo == PlugPag.ERROR_CODE_OK
        if (okPeloRetorno != okPeloCodigo) {
            Log.e(
                ETIQUETA,
                "Divergência no retorno da transação: result=" + retorno + ", errorCode=" + codigo,
            )
        }
        val aprovado = okPeloRetorno || okPeloCodigo

        val parcelas: Int? = resultado.installments?.takeIf { it > 0 }

        return ResultadoDoSdk(
            aprovado = aprovado,
            bandeira = resultado.cardBrand?.trim()?.ifBlank { null },
            nsu = resultado.nsu?.trim()?.ifBlank { null },
            autorizacao = resultado.autoCode?.trim()?.ifBlank { null },
            parcelas = parcelas,
            tipo = nomeDoTipo(resultado.paymentType, tipo),
            motivo = if (aprovado) null else mensagemAmigavel(codigo, resultado.message),
            codigoDeErro = codigo,
        )
    }

    private fun recusa(motivo: String, codigo: String?, tipo: TipoDePagamento?) = ResultadoDoSdk(
        aprovado = false,
        bandeira = null,
        nsu = null,
        autorizacao = null,
        parcelas = null,
        tipo = tipo?.codigoNoContrato,
        motivo = motivo,
        codigoDeErro = codigo,
    )

    private fun codigoDoTipo(tipo: TipoDePagamento): Int = when (tipo) {
        TipoDePagamento.CREDITO -> PlugPag.TYPE_CREDITO
        TipoDePagamento.DEBITO -> PlugPag.TYPE_DEBITO
        TipoDePagamento.VOUCHER -> PlugPag.TYPE_VOUCHER
    }

    /**
     * O que o terminal diz ter processado vale mais do que o que o app pediu: o
     * cliente pode ter escolhido crédito na tela e passado um cartão que só
     * roda como débito.
     */
    private fun nomeDoTipo(doTerminal: Int?, escolhido: TipoDePagamento?): String? = when (doTerminal) {
        PlugPag.TYPE_CREDITO -> TipoDePagamento.CREDITO.codigoNoContrato
        PlugPag.TYPE_DEBITO -> TipoDePagamento.DEBITO.codigoNoContrato
        PlugPag.TYPE_VOUCHER -> TipoDePagamento.VOUCHER.codigoNoContrato
        else -> escolhido?.codigoNoContrato
    }

    /**
     * Traduz o código de erro do terminal para uma frase que diz o que fazer.
     *
     * A lista veio dos comentários do app-demo oficial do PagBank; a tabela
     * completa do portal é carregada por JavaScript e não sai em texto. O que
     * não estiver aqui cai na mensagem do próprio terminal, que já vem em
     * português.
     *
     * Repare no espaço em "R 05": o formato é mesmo a letra, um espaço e o
     * número. Sem o espaço, nenhuma recusa seria reconhecida.
     */
    private fun mensagemAmigavel(codigo: String?, mensagemDoTerminal: String?): String {
        val doTerminal = mensagemDoTerminal?.trim()?.ifBlank { null }
        val chave = codigo?.trim().orEmpty()

        return when (chave) {
            "C13", "B018" -> "Cancelado no terminal."
            "R 55" -> "Senha incorreta."
            "R 05", "R 14", "R 51", "R 57", "R 59", "R 62", "R 63", "R 65",
            "R 75", "R 78", "R 82", "R 91", "B024", "M3011",
            -> "Cartão não autorizado. Tente outro cartão."
            "M831", "M815", "M826" -> "Não autorizado. Tente inserindo o cartão no chip."
            "C83", "C87" -> "Falha na aproximação. Insira o cartão no chip."
            "C70", "C84" -> "Este cartão não funciona na forma escolhida. Tente a outra opção."
            "C40", "C60", "C61" -> "Não foi possível ler o cartão. Tente de novo."
            "C43" -> "O cartão foi retirado antes do fim. Tente de novo."
            "C12" -> "Tempo esgotado esperando o cartão."
            "S20" -> "Pagamento repetido: mesmo valor e mesmo cartão há pouco tempo."
            "S46" -> "Cartão bloqueado por excesso de tentativas."
            "A050", "A306", "A307", "A019", "B028", "A011", "A053",
            -> "Falha de comunicação da maquininha. Verifique a internet."
            "A012" -> "A maquininha não conseguiu resolver o endereço do servidor."
            "SV03", "PP1047" -> "A maquininha está ocupada com outra operação."
            else -> doTerminal ?: ("Não autorizado" + if (chave.isNotBlank()) " (" + chave + ")." else ".")
        }
    }

    /**
     * Para onde mandar o andamento do pinpad AGORA.
     *
     * Fica nulo fora de uma transação. É o que garante que evento atrasado — ou
     * evento de outra operação do SDK, como a conferência da última aprovada —
     * não desenhe nada na tela: sem venda em curso, não há para onde mandar.
     */
    @Volatile
    private var andamentoAtual: ((String) -> Unit)? = null

    private val senhaDigitada = StringBuilder()

    /**
     * Repassa o andamento do pinpad para a tela.
     *
     * Registrado uma vez só, no primeiro pagamento, e nunca trocado: o SDK
     * guarda o último ouvinte que recebeu, e trocá-lo por venda deixava o
     * ouvinte da venda anterior vivo depois que ela acabava.
     *
     * A documentação não garante em qual thread onEvent chega. Este ouvinte não
     * toca em View nenhuma justamente por isso: ele só entrega texto, e quem
     * recebe é que leva para a thread principal.
     */
    private val ouvinteDoPinpad = object : PlugPagEventListener {
        override fun onEvent(data: PlugPagEventData) {
            val destino = andamentoAtual ?: return
            when (data.eventCode) {
                // Um asterisco por tecla. Sem esse retorno visual o cliente
                // não sabe se o pinpad registrou o toque e digita de novo,
                // o que costuma terminar em senha errada.
                PlugPagEventData.EVENT_CODE_DIGIT_PASSWORD -> {
                    val mascara = synchronized(senhaDigitada) {
                        senhaDigitada.append('*')
                        senhaDigitada.toString()
                    }
                    destino("DIGITE A SENHA\n" + mascara)
                }
                PlugPagEventData.EVENT_CODE_NO_PASSWORD -> {
                    synchronized(senhaDigitada) { senhaDigitada.setLength(0) }
                    destino("DIGITE A SENHA")
                }
                // As demais mensagens já vêm do terminal em português e em
                // caixa alta. Reescrevê-las faria a tela do app dizer uma
                // coisa e o pinpad esperar outra.
                else -> destino(data.customMessage)
            }
        }
    }

    private fun prepararPopupDeComprovante(plugPag: IPlugPagWrapper) {
        try {
            plugPag.setPlugPagCustomPrinterLayout(
                PlugPagCustomPrinterLayout(maxTimeShowPopup = SEGUNDOS_ATE_O_POPUP_SUMIR),
            )
        } catch (erro: Throwable) {
            // Não vale derrubar uma venda por causa da aparência de um popup.
            Log.w(ETIQUETA, "Não foi possível ajustar o popup de comprovante.", erro)
        }
    }

    /**
     * Uma instância por processo, criada na primeira chamada de verdade.
     *
     * PlugPag(context) abre o vínculo com o serviço do PagBank. Criar um por
     * tela faria esse vínculo ser refeito o tempo todo, e o sintoma seria SV03
     * no meio de uma venda.
     */
    private fun obterWrapper(): IPlugPagWrapper {
        wrapper?.let { return it }
        val app = contexto ?: throw IllegalStateException("Aplicação não iniciada.")
        return PlugPag(app).also { wrapper = it }
    }

    /**
     * Guarda-corpo. Toda operação do PlugPag bloqueia por dezenas de segundos —
     * o tempo de o cliente achar o cartão e digitar a senha. Na thread principal
     * isso é ANR na cara do cliente, com a tela congelada e o Android oferecendo
     * fechar o app no meio de um pagamento.
     *
     * Estourar aqui é proposital: o erro aparece na primeira execução de quem
     * escrever a chamada no lugar errado, em vez de virar uma tela travada que
     * só aparece em loja movimentada.
     */
    private fun exigirThreadDeTrabalho() {
        if (Looper.myLooper() == Looper.getMainLooper()) {
            throw IllegalStateException(
                "O SDK do PagBank bloqueia: chame isto de uma thread de trabalho.",
            )
        }
    }
}
