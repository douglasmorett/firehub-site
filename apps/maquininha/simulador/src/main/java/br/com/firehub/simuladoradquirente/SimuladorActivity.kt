package br.com.firehub.simuladoradquirente

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Bundle
import android.util.Base64
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import kotlin.random.Random

/**
 * Faz o papel do app de pagamento da Stone, da Cielo ou da Getnet, conforme o
 * deeplink que abriu a tela, e devolve a resposta no formato de cada uma.
 *
 * Formatos (os mesmos que o app FireHub Maquininha lê):
 *  - Stone: volta por deeplink <return_scheme>://pay-response?code=0&...
 *  - Cielo: volta por deeplink <urlCallback>?response=<Base64(JSON)>
 *  - Getnet: volta por setResult com extras result/nsu/cvNumber/...; a
 *    consulta checkstatus responde o que foi registrado para o callerId.
 *
 * "Fechar sem responder" existe para testar o caminho que importa: o app de
 * pagamento sumir sem dizer o que houve (a cobrança tem que ficar INCERTA,
 * nunca recusada).
 */
class SimuladorActivity : Activity() {

    private lateinit var coluna: LinearLayout

    override fun onCreate(estadoSalvo: Bundle?) {
        super.onCreate(estadoSalvo)
        coluna = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(32, 48, 32, 32)
        }
        setContentView(ScrollView(this).apply { addView(coluna) })
        montar(intent)
    }

    override fun onNewIntent(novo: Intent) {
        super.onNewIntent(novo)
        setIntent(novo)
        coluna.removeAllViews()
        montar(novo)
    }

    private fun montar(recebido: Intent) {
        val uri = recebido.data
        when {
            uri == null -> titulo(
                "Simulador de adquirente\n\nAbra uma cobrança no app FireHub Maquininha " +
                    "(flavor stone, cielo ou getnet). Esta tela aparece no lugar do app de pagamento.",
            )
            uri.scheme == "payment-app" -> telaStone(uri)
            uri.scheme == "lio" -> telaCielo(uri)
            uri.scheme == "getnet" && uri.path.orEmpty().contains("checkstatus") -> telaGetnetConsulta(uri)
            uri.scheme == "getnet" -> telaGetnet(uri, recebido)
            else -> titulo("Deeplink desconhecido: $uri")
        }
    }

    // ------------------------------------------------------------- Stone

    private fun telaStone(uri: Uri) {
        val volta = uri.getQueryParameter("return_scheme")
        val valor = uri.getQueryParameter("amount")
        val tipo = uri.getQueryParameter("transaction_type") ?: "CREDIT"
        titulo("STONE (simulada)")
        texto("Valor: ${reais(valor)}  ($valor centavos)\nTipo: $tipo\nURI recebida:\n$uri")

        if (volta.isNullOrBlank()) {
            texto("Sem return_scheme: a Stone de verdade não teria para onde responder.")
            return
        }

        fun responder(parametros: Map<String, String>) {
            val construtor = Uri.Builder().scheme(volta).authority("pay-response")
            parametros.forEach { (chave, v) -> construtor.appendQueryParameter(chave, v) }
            startActivity(Intent(Intent.ACTION_VIEW, construtor.build()).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            finish()
        }

        botao("Aprovar") {
            responder(
                linkedMapOf(
                    "code" to "0",
                    "amount" to (valor ?: "0"),
                    "brand" to "MASTERCARD",
                    "authorization_code" to numero(6),
                    "atk" to numero(16),
                    "itk" to numero(16),
                    "pan" to "5412",
                    "type" to tipo,
                    "installment_count" to "1",
                    "order_id" to "",
                    "authorization_date_time" to agora(),
                    "cardholder_name" to "CLIENTE TESTE",
                ),
            )
        }
        botao("Recusar") {
            responder(
                linkedMapOf(
                    "code" to "-6",
                    "reason" to "1016",
                    "response_code" to "-6",
                    "success" to "false",
                    "message" to "Não autorizada",
                ),
            )
        }
        botao("Cancelar (cliente fechou)") {
            responder(linkedMapOf("code" to "2", "message" to "Usuário encerrou o aplicativo"))
        }
        botao("Fechar sem responder") { finish() }
    }

    // ------------------------------------------------------------- Cielo

    private fun telaCielo(uri: Uri) {
        val callback = uri.getQueryParameter("urlCallback")
        val pedido = uri.getQueryParameter("request")?.let { b64 ->
            try {
                JSONObject(String(Base64.decode(b64.replace(' ', '+'), Base64.DEFAULT), Charsets.UTF_8))
            } catch (erro: Exception) {
                null
            }
        }
        titulo("CIELO (simulada)")
        if (pedido == null) {
            texto("Não deu para ler o request em Base64.\n$uri")
            return
        }
        val valor = pedido.optString("value")
        // Mostra o JSON sem o accessToken: é credencial.
        val visivel = JSONObject(pedido.toString()).apply {
            if (has("accessToken")) put("accessToken", "***")
        }
        texto("Valor: ${reais(valor)}\nPagamento: ${pedido.optString("paymentCode")}\nPedido:\n${visivel.toString(2)}")

        if (callback.isNullOrBlank()) {
            texto("Sem urlCallback: a Cielo de verdade não teria para onde responder.")
            return
        }

        fun responder(json: JSONObject) {
            val base64 = Base64.encodeToString(json.toString().toByteArray(Charsets.UTF_8), Base64.NO_WRAP)
            val destino = Uri.parse(callback).buildUpon().appendQueryParameter("response", base64).build()
            startActivity(Intent(Intent.ACTION_VIEW, destino).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            finish()
        }

        botao("Aprovar") {
            val centavos = valor.toLongOrNull() ?: 0L
            val codigoCielo = numero(12)
            val pagamento = JSONObject()
                .put("id", "pag-" + numero(8))
                .put("amount", centavos)
                .put("authCode", numero(6))
                .put("brand", "Visa")
                .put("cieloCode", codigoCielo)
                .put("mask", "************1234")
                .put("terminal", "12345678")
                .put(
                    "paymentFields",
                    JSONObject()
                        .put("brand", "VISA")
                        .put("nsu", numero(6))
                        .put("authCode", numero(6))
                        .put("cieloCode", codigoCielo)
                        .put("numberOfQuotas", "0")
                        .put("primaryProductName", pedido.optString("paymentCode"))
                        .put("statusCode", "1"),
                )
            responder(
                JSONObject()
                    .put("id", "pedido-" + numero(8))
                    .put("reference", pedido.optString("reference"))
                    .put("price", centavos)
                    .put("paidAmount", centavos)
                    .put("status", "PAID")
                    .put("payments", JSONArray().put(pagamento)),
            )
        }
        botao("Recusar") { responder(JSONObject().put("code", 1).put("reason", "Transação negada")) }
        botao("Cancelar (cliente cancelou)") {
            responder(JSONObject().put("code", 2).put("reason", "Operação cancelada pelo usuário"))
        }
        botao("Fechar sem responder") { finish() }
    }

    // ------------------------------------------------------------ Getnet

    private fun telaGetnet(uri: Uri, recebido: Intent) {
        fun parametro(nome: String): String? =
            uri.getQueryParameter(nome) ?: recebido.getStringExtra(nome)

        val valor = parametro("amount")
        val tipo = parametro("paymentType") ?: "credit"
        val callerId = parametro("callerId")
        titulo("GETNET (simulada)")
        texto("Valor: ${reais(valor)}  (amount=$valor)\nTipo: $tipo\ncallerId: $callerId\nURI:\n$uri")

        fun responder(extras: Map<String, String>) {
            if (callerId != null) registrar(callerId, extras)
            val dados = Intent()
            extras.forEach { (chave, v) -> dados.putExtra(chave, v) }
            setResult(RESULT_OK, dados)
            finish()
        }

        botao("Aprovar") {
            responder(
                linkedMapOf(
                    "result" to "0",
                    "resultDetails" to "Transação aprovada",
                    "amount" to (valor ?: ""),
                    "callerId" to (callerId ?: ""),
                    "nsu" to numero(9),
                    "nsuLocal" to numero(6),
                    "cvNumber" to numero(9),
                    "type" to tipo,
                    "brand" to "Mastercard",
                    "inputType" to "071",
                    "installments" to "1",
                    "gmtDateTime" to agora(),
                    "authorizationCode" to numero(6),
                    "cardBin" to "541200",
                    "cardLastDigits" to "1234",
                ),
            )
        }
        botao("Negar (result=1)") {
            responder(linkedMapOf("result" to "1", "resultDetails" to "Transação negada", "callerId" to (callerId ?: "")))
        }
        botao("Cancelar (result=2)") {
            responder(linkedMapOf("result" to "2", "resultDetails" to "Cancelada pelo usuário", "callerId" to (callerId ?: "")))
        }
        botao("Pendente (result=5)") {
            responder(linkedMapOf("result" to "5", "resultDetails" to "Transação pendente", "callerId" to (callerId ?: "")))
        }
        botao("Voltar sem dados (RESULT_CANCELED)") {
            setResult(RESULT_CANCELED)
            finish()
        }
    }

    private fun telaGetnetConsulta(uri: Uri) {
        val callerId = uri.getQueryParameter("callerId")
        val registrado = callerId?.let { lerRegistro(it) }
        titulo("GETNET checkstatus (simulada)")
        texto("callerId: $callerId\nRegistrado: ${registrado ?: "nada"}")

        fun responder(extras: Map<String, String>) {
            val dados = Intent()
            extras.forEach { (chave, v) -> dados.putExtra(chave, v) }
            setResult(RESULT_OK, dados)
            finish()
        }

        if (registrado != null) {
            botao("Devolver o registrado") { responder(registrado) }
        }
        botao("Devolver 'não encontrada' (result=3)") {
            responder(linkedMapOf("result" to "3", "resultDetails" to "Transação não encontrada", "callerId" to (callerId ?: "")))
        }
        botao("Devolver 'desconhecido' (result=4)") {
            responder(linkedMapOf("result" to "4", "resultDetails" to "Status desconhecido", "callerId" to (callerId ?: "")))
        }
    }

    private fun registrar(callerId: String, extras: Map<String, String>) {
        val json = JSONObject()
        extras.forEach { (chave, v) -> json.put(chave, v) }
        getSharedPreferences("getnet", Context.MODE_PRIVATE).edit().putString(callerId, json.toString()).apply()
    }

    private fun lerRegistro(callerId: String): Map<String, String>? {
        val texto = getSharedPreferences("getnet", Context.MODE_PRIVATE).getString(callerId, null) ?: return null
        val json = JSONObject(texto)
        return json.keys().asSequence().associateWith { json.optString(it) }
    }

    // --------------------------------------------------------- utilidades

    private fun titulo(texto: String) {
        coluna.addView(
            TextView(this).apply {
                text = texto
                textSize = 22f
                setTypeface(typeface, Typeface.BOLD)
                setPadding(0, 0, 0, 24)
            },
        )
    }

    private fun texto(texto: String) {
        coluna.addView(TextView(this).apply { text = texto; textSize = 14f; setPadding(0, 0, 0, 24) })
    }

    private fun botao(rotulo: String, acao: () -> Unit) {
        coluna.addView(
            Button(this).apply {
                text = rotulo
                setOnClickListener { acao() }
            },
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT),
        )
    }

    private fun numero(digitos: Int): String = (1..digitos).joinToString("") { Random.nextInt(10).toString() }

    private fun agora(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.ROOT).format(Date())

    private fun reais(centavos: String?): String {
        val n = centavos?.filter { it.isDigit() }?.toLongOrNull() ?: return "?"
        return "R$ " + (n / 100) + "," + (n % 100).toString().padStart(2, '0')
    }
}
