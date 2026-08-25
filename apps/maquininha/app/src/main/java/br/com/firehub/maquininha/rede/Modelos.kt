package br.com.firehub.maquininha.rede

import org.json.JSONObject

/**
 * As três formas de pagamento que este app oferece.
 *
 * A lista é curta de propósito e não vai crescer sem conversa: aplicação
 * embarcada em terminal PagBank não pode oferecer nem mencionar outras formas de
 * pagamento além das que o próprio terminal processa por cartão. Isso é regra de
 * homologação, não preferência de produto.
 */
enum class TipoDePagamento(val rotulo: String, val codigoNoContrato: String) {
    CREDITO("Crédito", "CREDITO"),
    DEBITO("Débito", "DEBITO"),
    VOUCHER("Voucher", "VOUCHER"),
}

/**
 * Uma cobrança que o servidor reservou para esta maquininha.
 *
 * Ela já saiu da fila no instante em que chegou aqui: o servidor marcou o pedido
 * como NO_TERMINAL na mesma consulta que a entregou. Ou seja, ninguém mais vai
 * cobrar este pedido enquanto o app não devolver um resultado — ou enquanto os
 * cinco minutos de destravamento automático não passarem.
 */
data class Cobranca(
    val pedidoId: String,
    val valorEmCentavos: Int,
    val descricao: String,
    val cliente: String?,
    val tentativa: Int,
    /** Formato "<pedidoId>:<tentativa>". Volta inteira no POST de resultado. */
    val referencia: String,
) {
    /**
     * "R$ 1.234,56" a partir de 123456.
     *
     * Feito na unha em cima do inteiro em centavos: NumberFormat depende da
     * locale do aparelho, e ponto flutuante em dinheiro é como se descobre, seis
     * meses depois, que um pedido saiu um centavo diferente do que o cartão
     * debitou. O valor chega do servidor em centavos e nunca vira double aqui.
     */
    fun valorFormatado(): String {
        val reais = valorEmCentavos / 100
        val centavos = valorEmCentavos % 100

        val digitos = reais.toString()
        val comMilhar = StringBuilder()
        for ((posicao, digito) in digitos.withIndex()) {
            if (posicao > 0 && (digitos.length - posicao) % 3 == 0) comMilhar.append('.')
            comMilhar.append(digito)
        }

        val centavosTexto = if (centavos < 10) "0" + centavos else centavos.toString()
        return "R$ " + comMilhar + "," + centavosTexto
    }
}

/**
 * O que aconteceu com o cartão, pronto para virar corpo do POST.
 *
 * Este objeto é gravado em disco ANTES de qualquer tentativa de envio. É a peça
 * central do app: quando ele existe e diz `aprovado = true`, o dinheiro já saiu
 * da conta do cliente. Perder este registro é o cliente pagar e o pedido não
 * sair da cozinha.
 */
data class ResultadoDeCobranca(
    val pedidoId: String,
    val referencia: String,
    val aprovado: Boolean,
    val bandeira: String?,
    val nsu: String?,
    val autorizacao: String?,
    val parcelas: Int?,
    val tipo: String?,
    val motivoRecusa: String?,
    /** Só para o operador saber há quanto tempo um resultado está preso. */
    val criadoEm: Long = System.currentTimeMillis(),
    val tentativasDeEnvio: Int = 0,
) {
    fun corpoDoPost(token: String): JSONObject = JSONObject().apply {
        put("token", token)
        put("pedidoId", pedidoId)
        put("aprovado", aprovado)
        put("referencia", referencia)
        // put(chave, null) no org.json REMOVE a chave em vez de gravar null, o
        // que é exatamente o que se quer: o servidor trata campo ausente e campo
        // nulo do mesmo jeito (`bandeira ?? null`).
        put("bandeira", bandeira)
        put("nsu", nsu)
        put("autorizacao", autorizacao)
        put("parcelas", parcelas)
        put("tipo", tipo)
        put("motivoRecusa", motivoRecusa)
    }

    fun paraJson(): JSONObject = JSONObject().apply {
        put("pedidoId", pedidoId)
        put("referencia", referencia)
        put("aprovado", aprovado)
        put("bandeira", bandeira)
        put("nsu", nsu)
        put("autorizacao", autorizacao)
        put("parcelas", parcelas)
        put("tipo", tipo)
        put("motivoRecusa", motivoRecusa)
        put("criadoEm", criadoEm)
        put("tentativasDeEnvio", tentativasDeEnvio)
    }

    companion object {
        fun deJson(json: JSONObject): ResultadoDeCobranca = ResultadoDeCobranca(
            pedidoId = json.getString("pedidoId"),
            referencia = json.optString("referencia", ""),
            aprovado = json.optBoolean("aprovado", false),
            bandeira = json.textoOuNulo("bandeira"),
            nsu = json.textoOuNulo("nsu"),
            autorizacao = json.textoOuNulo("autorizacao"),
            parcelas = if (json.isNull("parcelas")) null else json.optInt("parcelas"),
            tipo = json.textoOuNulo("tipo"),
            motivoRecusa = json.textoOuNulo("motivoRecusa"),
            criadoEm = json.optLong("criadoEm", System.currentTimeMillis()),
            tentativasDeEnvio = json.optInt("tentativasDeEnvio", 0),
        )
    }
}

/**
 * optString devolve a string "null" quando o campo veio nulo do servidor, e é
 * exatamente esse texto que acabaria impresso na tela como motivo da recusa.
 */
fun JSONObject.textoOuNulo(chave: String): String? {
    if (!has(chave) || isNull(chave)) return null
    val valor = optString(chave, "")
    return valor.ifBlank { null }
}

/** Resposta de GET /api/pos/terminal/pendente. */
sealed class RespostaDaFila {
    data class SemCobranca(val terminal: String?) : RespostaDaFila()
    data class ComCobranca(val cobranca: Cobranca, val terminal: String?) : RespostaDaFila()

    /**
     * 401 TERMINAL_DESCONHECIDO ou 403 TERMINAL_DESATIVADO. Nos dois casos
     * insistir não resolve: quem resolve é alguém no painel do FireHub.
     */
    data class CredencialInvalida(val codigo: String, val mensagem: String) : RespostaDaFila()

    data class FalhaDeRede(val mensagem: String) : RespostaDaFila()
    data class ErroDoServidor(val status: Int, val mensagem: String) : RespostaDaFila()
}

/** Resposta de POST /api/pos/terminal/resultado. */
sealed class RespostaDoResultado {
    /** Pagamento confirmado. `numeroDoPedido` é a senha que o cliente vai ouvir. */
    data class Confirmado(val numeroDoPedido: String?) : RespostaDoResultado()

    /** O servidor já tinha confirmado este pedido. Reenvio não faz mal nenhum. */
    object JaConfirmado : RespostaDoResultado()

    /** A recusa foi registrada; o pedido voltou para a fila. */
    data class RecusaRegistrada(val podeTentarDeNovo: Boolean, val motivo: String?) : RespostaDoResultado()

    data class CredencialInvalida(val codigo: String, val mensagem: String) : RespostaDoResultado()

    /**
     * 400, 403, 404 ou 409: o servidor entendeu e disse não. Reenviar vai dar a
     * mesma resposta amanhã. Resultado assim vai para a lista de atenção, porque
     * se ele era uma aprovação existe um cartão debitado sem pedido liberado.
     */
    data class RejeitadoDefinitivamente(val status: Int, val mensagem: String) : RespostaDoResultado()

    data class FalhaDeRede(val mensagem: String) : RespostaDoResultado()
}
