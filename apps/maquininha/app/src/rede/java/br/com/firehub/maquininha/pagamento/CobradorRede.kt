package br.com.firehub.maquininha.pagamento

import android.app.Activity
import android.content.Intent
import android.os.Build
import android.util.Log
import br.com.firehub.maquininha.BuildConfig
import br.com.firehub.maquininha.R
import br.com.firehub.maquininha.pagamento.ponte.CanalDaPonte
import br.com.firehub.maquininha.pagamento.ponte.CobradorPorDeeplink
import br.com.firehub.maquininha.rede.Cobranca
import br.com.firehub.maquininha.rede.TipoDePagamento
import rede.smartrede.sdk.FlexTipoPagamento
import rede.smartrede.sdk.RedePayments

/**
 * Cobrança na Rede (Itaú), maquininha "Laranjinha Smart" (Gertec GPOS700; em
 * campo também N960K), pelo SDK 3.0 da Rede (sdk-3.0-release.aar, pacote
 * rede.smartrede.sdk).
 *
 * Fonte: "Manual de Integração App3" em
 * https://portaldodesenvolvedor.docs.apiary.io/
 *
 * Não é deeplink, mas o caminho é o mesmo da Getnet: o SDK devolve uma Intent
 * PRONTA (explícita, para o app "Pagamentos" da Rede), a ponte a abre com
 * startActivityForResult e a resposta volta em onActivityResult. Por isso o
 * cobrador herda de [CobradorPorDeeplink] e reaproveita a [CanalDaPonte]:
 * uma cobrança por vez, prazo de 3 minutos, e as mesmas três saídas
 * (não abriu = recusa; abriu e não voltou = incerto; voltou = lê-se aqui).
 *
 * Ida:
 *   RedePayments.getInstance(ctx)
 *       .intentForPaymentBuilder(FlexTipoPagamento.X, valorEmCentavos)
 *       .build()
 *   Sempre à vista: setInstallments NÃO é chamado (o manual diz que ele lança
 *   exceção em tipo que não parcela, e o FireHub não parcela no balcão).
 *
 * Volta (onActivityResult):
 *   RESULT_CANCELED sem pagamento = o cliente cancelou na tela da Rede.
 *   Senão RedePayments.getPaymentFromIntent(data) -> Payment:
 *     getStatus(): AUTHORIZED | FAILED | DECLINED
 *     getAmount(), getPaymentType(), getInstallments(),
 *     getReceipt(): getNSU(), getAUTO(), getFlag()/getIssuerName(), getCV()
 *
 * O que o manual NÃO diz (se getPaymentFromIntent é estático, o tipo de
 * retorno de getAmount e dos getters do comprovante) é lido por reflexão:
 * assim um palpite errado do esqueleto (:rede-sdk-stub) não vira
 * NoSuchMethodError com o cartão já passado. A parte tipada é só a ida, que é
 * exatamente o exemplo do manual — e se ela falhar, nada foi aberto.
 *
 * Sem o .aar no APK (BuildConfig.SDK_DA_REDE_NO_APK falso, ou a classe não
 * está lá), o cobrador recusa com "SDK da Rede não instalado neste app", sem
 * crash, e a tela de operação mostra o mesmo recado.
 */
object CobradorRede : CobradorPorDeeplink() {

    private const val ETIQUETA = "CobradorRede"
    private const val CLASSE_DO_SDK = "rede.smartrede.sdk.RedePayments"

    override val nome = "Rede"

    override val formasAceitas = listOf(
        TipoDePagamento.CREDITO,
        TipoDePagamento.DEBITO,
        TipoDePagamento.PIX,
        TipoDePagamento.VOUCHER,
    )

    /**
     * A Rede não tem consulta de transação pelo SDK (só estorno e
     * reimpressão): mesma recuperação da Stone e da Cielo — poucas voltas
     * esperando uma resposta atrasada e, sem ela, lista de atenção com
     * "confira no app Pagamentos da Rede". Nunca recusa silenciosa.
     */
    override val conferenciasAntesDeChamarGente = 3

    override val respostaPorResultado = true

    /** O SDK está mesmo dentro deste APK? Lido uma vez. */
    private val sdkNoApk: Boolean by lazy {
        if (!BuildConfig.SDK_DA_REDE_NO_APK) return@lazy false
        try {
            Class.forName(CLASSE_DO_SDK)
            true
        } catch (erro: Throwable) {
            Log.e(ETIQUETA, "SDK da Rede ausente do APK.", erro)
            false
        }
    }

    private fun motivoSemSdk(): String =
        contexto?.getString(R.string.sdk_da_rede_ausente) ?: "SDK da Rede não instalado neste app."

    /** Só para a checagem de prontidão; não abre nada. */
    override fun intentDeTeste(): Intent =
        montarIntentDoSdk(FlexTipoPagamento.DEBITO, 100L) ?: Intent()

    override fun impedimentoParaCobrar(): Impedimento {
        val app = contexto ?: return Impedimento.FalhaAoConsultar("Aplicação não iniciada.")
        if (!sdkNoApk) return Impedimento.FalhaAoConsultar(motivoSemSdk())

        val teste = montarIntentDoSdk(FlexTipoPagamento.DEBITO, 100L)
            ?: return Impedimento.FalhaAoConsultar("O SDK da Rede não montou a cobrança.")
        val existe = try {
            app.packageManager.resolveActivity(teste, 0) != null
        } catch (erro: Exception) {
            Log.w(ETIQUETA, "resolveActivity falhou.", erro)
            true
        }
        if (existe) return Impedimento.Nenhum

        // Do Android 11 em diante, "não achei" pode ser só a filtragem de
        // pacotes (o pacote do app Pagamentos não está no <queries>, ver o
        // manifesto do flavor). Aí não se bloqueia: a abertura decide, e se o
        // app não existir ela recusa com segurança (nada foi aberto).
        return if (Build.VERSION.SDK_INT >= 30) Impedimento.Nenhum else Impedimento.ServicoNaoInstalado
    }

    override fun montarSaida(
        cobranca: Cobranca,
        tipo: TipoDePagamento,
        identificador: String,
    ): Pair<Intent?, String?> {
        if (!sdkNoApk) return null to motivoSemSdk()
        val tipoRede = when (tipo) {
            TipoDePagamento.CREDITO -> FlexTipoPagamento.CREDITO_A_VISTA
            TipoDePagamento.DEBITO -> FlexTipoPagamento.DEBITO
            TipoDePagamento.VOUCHER -> FlexTipoPagamento.VOUCHER
            TipoDePagamento.PIX -> FlexTipoPagamento.PIX
        }
        // Centavos direto do inteiro, sem double ("valor multiplicado por 100").
        val intent = montarIntentDoSdk(tipoRede, cobranca.valorEmCentavos.toLong())
            ?: return null to "O SDK da Rede não montou a cobrança."
        return intent to null
    }

    private fun montarIntentDoSdk(tipo: FlexTipoPagamento, valorEmCentavos: Long): Intent? {
        val app = contexto ?: return null
        if (!sdkNoApk) return null
        return try {
            RedePayments.getInstance(app).intentForPaymentBuilder(tipo, valorEmCentavos).build()
        } catch (erro: Throwable) {
            // Throwable de propósito: LinkageError (assinatura diferente da do
            // esqueleto) também cai aqui. Nada foi aberto: recusar é seguro.
            Log.e(ETIQUETA, "O SDK da Rede não montou a Intent.", erro)
            null
        }
    }

    override fun interpretar(
        resposta: CanalDaPonte.Resposta,
        identificador: String,
        valorEmCentavos: Int,
        tipo: TipoDePagamento?,
    ): ResultadoDoSdk {
        val porResultado = resposta as? CanalDaPonte.Resposta.PorResultado
            ?: return ResultadoDoSdk.incerto("A Rede respondeu num formato inesperado.", tipo)
        val dados = porResultado.dados

        val pagamento: Any? = dados?.let { lerPagamento(it) }

        if (pagamento == null) {
            // DECISÃO: o manual da Rede diz que RESULT_CANCELED é o cliente
            // cancelando. Diferente da Getnet, aqui se segue o manual: a Rede
            // não tem consulta, e tratar todo cancelamento como incerto
            // mandaria cada desistência para a lista de atenção. O risco que
            // sobra (app da Rede morrer DEPOIS de autorizar e devolver
            // CANCELED) é o do desfazimento: venda não confirmada é desfeita
            // pelo próprio app Pagamentos. CONFERIR NO TERMINAL.
            if (porResultado.codigo == Activity.RESULT_CANCELED) {
                return ResultadoDoSdk.recusa("Cancelado na maquininha.", "CANCELED", tipo)
            }
            Log.w(ETIQUETA, "Volta sem pagamento (resultCode=" + porResultado.codigo + ").")
            return ResultadoDoSdk.incerto("A Rede voltou sem dizer o resultado.", tipo)
        }

        val status = texto(chamar(pagamento, "getStatus"))?.uppercase()
        return when (status) {
            "AUTHORIZED" -> aprovado(pagamento, valorEmCentavos, tipo)
            "DECLINED" -> ResultadoDoSdk.recusa("Transação negada.", "DECLINED", tipo)
            "FAILED" -> ResultadoDoSdk.recusa("Falha na transação.", "FAILED", tipo)
            // Status vazio ou novo: ninguém sabe. Incerto.
            else -> ResultadoDoSdk.incerto(
                "A Rede não confirmou o pagamento (status " + (status ?: "vazio") + ").",
                tipo,
            )
        }
    }

    private fun aprovado(pagamento: Any, valorEmCentavos: Int, tipo: TipoDePagamento?): ResultadoDoSdk {
        // Única conferência de que a resposta é desta cobrança: a Rede não
        // devolve identificador nosso (como na Stone). Se o valor não bater,
        // incerto. CONFERIR NO TERMINAL que getAmount vem em centavos; se vier
        // em outra unidade, toda aprovação cai na lista de atenção (lado seguro).
        val valorDeVolta = (chamar(pagamento, "getAmount") as? Number)?.toLong()
        if (valorDeVolta != null && valorDeVolta != valorEmCentavos.toLong()) {
            Log.e(ETIQUETA, "Aprovado com valor $valorDeVolta, esperado $valorEmCentavos.")
            return ResultadoDoSdk.incerto("A Rede aprovou um valor diferente do cobrado.", tipo)
        }

        val comprovante = chamar(pagamento, "getReceipt")
        fun doComprovante(vararg metodos: String): String? =
            comprovante?.let { c -> metodos.firstNotNullOfOrNull { texto(chamar(c, it)) } }

        val ids = linkedMapOf<String, String>()
        doComprovante("getCV")?.let { ids["cv"] = it }
        doComprovante("getTerminalNumber")?.let { ids["terminal"] = it }
        doComprovante("getOperationType")?.let { ids["tipoDeOperacao"] = it }

        val parcelas = (chamar(pagamento, "getInstallments") as? Number)?.toInt()?.takeIf { it > 0 } ?: 1
        val tipoDeVolta = when (texto(chamar(pagamento, "getPaymentType"))?.uppercase()) {
            "CREDITO_A_VISTA", "CREDITO_PARCELADO", "CREDITO_PARCELADO_EMISSOR" -> TipoDePagamento.CREDITO
            "DEBITO" -> TipoDePagamento.DEBITO
            "VOUCHER" -> TipoDePagamento.VOUCHER
            "PIX" -> TipoDePagamento.PIX
            else -> tipo
        }

        return ResultadoDoSdk(
            aprovado = true,
            bandeira = doComprovante("getFlag", "getIssuerName"),
            nsu = doComprovante("getNSU") ?: ids["cv"],
            autorizacao = doComprovante("getAUTO"),
            parcelas = parcelas,
            tipo = tipoDeVolta?.codigoNoContrato,
            motivo = null,
            codigoDeErro = null,
            idsDaAdquirente = ids,
        )
    }

    /**
     * RedePayments.getPaymentFromIntent(data), estático ou de instância (o
     * manual não diz). Nulo se não houver pagamento ou o SDK não estiver aqui.
     */
    private fun lerPagamento(dados: Intent): Any? {
        if (!sdkNoApk) return null
        return try {
            val classe = Class.forName(CLASSE_DO_SDK)
            val metodo = classe.getMethod("getPaymentFromIntent", Intent::class.java)
            val dono = if (java.lang.reflect.Modifier.isStatic(metodo.modifiers)) {
                null
            } else {
                RedePayments.getInstance(contexto ?: return null)
            }
            metodo.invoke(dono, dados)
        } catch (erro: Throwable) {
            Log.e(ETIQUETA, "Não foi possível ler o pagamento da Rede.", erro)
            null
        }
    }

    /** Getter sem parâmetro, por nome. Nulo se não existir ou falhar. */
    private fun chamar(alvo: Any, metodo: String): Any? = try {
        alvo.javaClass.getMethod(metodo).invoke(alvo)
    } catch (erro: Throwable) {
        null
    }

    /** Enum vira o nome; texto vazio vira nulo. */
    private fun texto(valor: Any?): String? = when (valor) {
        null -> null
        is Enum<*> -> valor.name
        else -> valor.toString().trim().ifBlank { null }
    }

    override fun conferir(
        identificador: String,
        valorEmCentavos: Int,
        tipo: TipoDePagamento?,
    ): ConferenciaDaUltima = conferirPelaRespostaAtrasada(identificador, valorEmCentavos, tipo, "Rede")
}
