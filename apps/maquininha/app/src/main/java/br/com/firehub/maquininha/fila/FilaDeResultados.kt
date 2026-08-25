package br.com.firehub.maquininha.fila

import android.content.Context
import android.util.Log
import br.com.firehub.maquininha.rede.ResultadoDeCobranca
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream

/**
 * O caderninho da maquininha.
 *
 * Existe por causa de um caso só, e é o pior caso deste app: o cartão foi
 * debitado e a rede caiu antes de o FireHub saber. O dinheiro já saiu; se este
 * resultado se perder, o cliente pagou e o pedido não sai da cozinha.
 *
 * Por isso o resultado é gravado em disco ANTES da primeira tentativa de envio,
 * e só sai daqui quando o servidor confirmar. Reenviar é seguro: a rota é
 * idempotente e responde jaConfirmado para repetição.
 *
 * Três arquivos, todos em filesDir (armazenamento interno do app — o guia do
 * PagBank proíbe SDCARD, e um cartão removível com resultado de cartão dentro
 * seria exatamente o tipo de coisa que reprova homologação):
 *
 *  - pendentes  : esperando o servidor confirmar. Reenviados para sempre.
 *  - travados   : o servidor recusou de forma definitiva (404, 409...), ou o
 *                 terminal nunca disse o que houve com o cartão. Não adianta
 *                 reenviar; precisa de gente olhando.
 *  - marcador   : escrito ANTES de chamar o SDK, apagado só quando se sabe o
 *                 que aconteceu. Se o app for morto no meio da transação, é ele
 *                 que permite descobrir na volta se aquele cartão foi debitado.
 */
class FilaDeResultados(context: Context) {

    private val pasta: File = context.applicationContext.filesDir
    private val arquivoDePendentes = File(pasta, "resultados_pendentes.json")
    private val arquivoDeTravados = File(pasta, "resultados_travados.json")
    private val arquivoDoMarcador = File(pasta, "cobranca_em_andamento.json")

    /**
     * Um resultado que não tem mais conserto automático, guardado com o motivo
     * para o operador conseguir explicar o que houve com aquele cartão.
     */
    data class Travado(val resultado: ResultadoDeCobranca, val motivo: String, val em: Long)

    /**
     * Escrito no disco imediatamente antes de a transação começar no SDK.
     *
     * A referência curta é o texto de até 10 caracteres que foi mandado ao
     * PagBank como código da venda. É por ela que dá para reconhecer, na volta
     * de um desligamento, se a última transação aprovada do terminal foi esta
     * cobrança ou uma anterior.
     */
    data class Marcador(
        val pedidoId: String,
        val referencia: String,
        val referenciaCurta: String,
        val valorEmCentavos: Int,
        val tipo: String,
        val em: Long,
        /**
         * Quantas vezes já se perguntou ao terminal o que houve com este cartão
         * sem obter resposta.
         *
         * O contador existe porque a pergunta pode falhar por um motivo que
         * passa (o serviço do PagBank ainda subindo depois do boot) ou por um
         * que não passa (o serviço quebrado). Sem ele o app ou desistiria na
         * primeira falha — jogando fora a pista de um cartão debitado — ou
         * ficaria perguntando para sempre, sem nunca chamar ninguém.
         */
        val conferencias: Int = 0,
    ) {
        fun paraJson(): JSONObject = JSONObject().apply {
            put("pedidoId", pedidoId)
            put("referencia", referencia)
            put("referenciaCurta", referenciaCurta)
            put("valorEmCentavos", valorEmCentavos)
            put("tipo", tipo)
            put("em", em)
            put("conferencias", conferencias)
        }

        companion object {
            fun deJson(json: JSONObject) = Marcador(
                pedidoId = json.getString("pedidoId"),
                referencia = json.optString("referencia", ""),
                referenciaCurta = json.optString("referenciaCurta", ""),
                valorEmCentavos = json.optInt("valorEmCentavos", 0),
                tipo = json.optString("tipo", ""),
                em = json.optLong("em", 0L),
                conferencias = json.optInt("conferencias", 0),
            )
        }
    }

    // ------------------------------------------------------------- pendentes

    /**
     * Guarda o resultado. Chame ANTES de tentar enviar, sempre.
     *
     * Se já houver um resultado para a mesma tentativa do mesmo pedido, ele é
     * substituído em vez de duplicado: senão uma reinicialização no meio de um
     * reenvio deixaria dois registros do mesmo cartão e o operador veria duas
     * cobranças onde houve uma.
     */
    fun enfileirar(resultado: ResultadoDeCobranca) = synchronized(TRAVA) {
        val atuais = pendentes().filterNot { ehOMesmo(it, resultado) }
        gravarLista(arquivoDePendentes, atuais + resultado)
    }

    fun pendentes(): List<ResultadoDeCobranca> = synchronized(TRAVA) {
        lerLista(arquivoDePendentes).mapNotNull { json ->
            try {
                ResultadoDeCobranca.deJson(json)
            } catch (erro: Exception) {
                // Uma linha ilegível não pode levar as outras junto: se o
                // arquivo tiver sido cortado por falta de energia, o que restou
                // ainda vale e ainda precisa chegar ao servidor.
                Log.e(ETIQUETA, "Resultado pendente ilegível, descartado.", erro)
                null
            }
        }
    }

    /** O servidor confirmou. Pode sair do caderninho. */
    fun remover(resultado: ResultadoDeCobranca) = synchronized(TRAVA) {
        gravarLista(arquivoDePendentes, pendentes().filterNot { ehOMesmo(it, resultado) })
    }

    /**
     * Só para o operador saber há quantas tentativas aquele resultado está preso
     * e para o app espaçar os reenvios.
     */
    fun contarTentativa(resultado: ResultadoDeCobranca) = synchronized(TRAVA) {
        val novos = pendentes().map {
            if (ehOMesmo(it, resultado)) it.copy(tentativasDeEnvio = it.tentativasDeEnvio + 1) else it
        }
        gravarLista(arquivoDePendentes, novos)
    }

    /**
     * Existe algum resultado APROVADO deste pedido esperando resolução?
     *
     * É a trava contra cobrar o mesmo cliente duas vezes. O cenário concreto:
     * o cartão passa, o POST do resultado não chega ao servidor, e cinco
     * minutos depois o servidor destrava o pedido sozinho e o devolve para a
     * fila — a mesma fila que esta maquininha consulta. Sem esta pergunta, o
     * app pegaria o pedido de novo e mandaria o cliente encostar o cartão numa
     * compra que ele já pagou.
     *
     * Olha nos dois arquivos de propósito. Um resultado travado é justamente
     * aquele que o servidor não aceitou; se o pedido voltar, ele continua sendo
     * um cartão debitado e ainda menos deve ser cobrado outra vez.
     */
    fun aprovadoEmAberto(pedidoId: String): ResultadoDeCobranca? = synchronized(TRAVA) {
        pendentes().firstOrNull { it.pedidoId == pedidoId && it.aprovado }
            ?: travados().firstOrNull { it.resultado.pedidoId == pedidoId && it.resultado.aprovado }
                ?.resultado
    }

    // -------------------------------------------------------------- travados

    /**
     * Tira o resultado da fila de reenvio e põe na lista de atenção.
     *
     * Um resultado travado NÃO bloqueia a maquininha. Bloquear seria pior: a
     * loja inteira pararia de receber pedido por causa de um pedido que já não
     * tem conserto automático. Ele fica visível na tela até alguém resolver.
     */
    fun travar(resultado: ResultadoDeCobranca, motivo: String): Unit = synchronized(TRAVA) {
        remover(resultado)
        val lista = travados().filterNot { ehOMesmo(it.resultado, resultado) } +
            Travado(resultado, motivo, System.currentTimeMillis())
        gravarTravados(lista)
        Log.e(ETIQUETA, "Resultado travado para o pedido " + resultado.pedidoId + ": " + motivo)
        Unit
    }

    fun travados(): List<Travado> = synchronized(TRAVA) {
        lerLista(arquivoDeTravados).mapNotNull { json ->
            try {
                Travado(
                    resultado = ResultadoDeCobranca.deJson(json.getJSONObject("resultado")),
                    motivo = json.optString("motivo", "Sem motivo registrado."),
                    em = json.optLong("em", 0L),
                )
            } catch (erro: Exception) {
                Log.e(ETIQUETA, "Registro travado ilegível, descartado.", erro)
                null
            }
        }
    }

    /**
     * Tira um registro da lista de atenção porque ele acabou dando certo.
     *
     * Acontece quando o servidor rejeitou o resultado em definitivo, o pedido
     * foi corrigido no painel, e o reenvio seguinte passou.
     */
    fun removerTravado(resultado: ResultadoDeCobranca) = synchronized(TRAVA) {
        val restantes = travados().filterNot { ehOMesmo(it.resultado, resultado) }
        gravarTravados(restantes)
    }

    /** Chamado quando o operador confirma na tela que já resolveu. */
    fun limparTravados() = synchronized(TRAVA) {
        arquivoDeTravados.delete()
        Unit
    }

    // -------------------------------------------------------------- marcador

    fun marcarEmAndamento(marcador: Marcador) = synchronized(TRAVA) {
        gravarTexto(arquivoDoMarcador, marcador.paraJson().toString())
    }

    fun marcadorEmAberto(): Marcador? = synchronized(TRAVA) {
        if (!arquivoDoMarcador.exists()) return@synchronized null
        try {
            Marcador.deJson(JSONObject(arquivoDoMarcador.readText(Charsets.UTF_8)))
        } catch (erro: Exception) {
            Log.e(ETIQUETA, "Marcador ilegível, descartado.", erro)
            arquivoDoMarcador.delete()
            null
        }
    }

    /** Registra que mais uma conferência falhou, sem apagar o marcador. */
    fun contarConferencia(marcador: Marcador) = synchronized(TRAVA) {
        gravarTexto(
            arquivoDoMarcador,
            marcador.copy(conferencias = marcador.conferencias + 1).paraJson().toString(),
        )
    }

    fun limparMarcador() = synchronized(TRAVA) {
        arquivoDoMarcador.delete()
        Unit
    }

    // ---------------------------------------------------------------- disco

    /**
     * Dois resultados são o mesmo quando são do mesmo pedido e da mesma
     * tentativa. O pedidoId sozinho não serve: quando um cartão é recusado, o
     * servidor devolve o pedido para a fila e a próxima cobrança do MESMO pedido
     * volta com tentativa maior. São dois eventos distintos, e os dois precisam
     * chegar ao servidor.
     */
    private fun ehOMesmo(a: ResultadoDeCobranca, b: ResultadoDeCobranca): Boolean =
        a.pedidoId == b.pedidoId && a.referencia == b.referencia

    private fun gravarTravados(lista: List<Travado>) {
        val json = JSONArray()
        lista.forEach { travado ->
            json.put(
                JSONObject().apply {
                    put("resultado", travado.resultado.paraJson())
                    put("motivo", travado.motivo)
                    put("em", travado.em)
                },
            )
        }
        gravarTexto(arquivoDeTravados, json.toString())
    }

    private fun gravarLista(arquivo: File, itens: List<ResultadoDeCobranca>) {
        val json = JSONArray()
        itens.forEach { json.put(it.paraJson()) }
        gravarTexto(arquivo, json.toString())
    }

    private fun lerLista(arquivo: File): List<JSONObject> {
        if (!arquivo.exists()) return emptyList()
        return try {
            val json = JSONArray(arquivo.readText(Charsets.UTF_8))
            (0 until json.length()).mapNotNull { json.optJSONObject(it) }
        } catch (erro: Exception) {
            Log.e(ETIQUETA, "Arquivo " + arquivo.name + " ilegível.", erro)
            emptyList()
        }
    }

    /**
     * Grava num arquivo temporário, força a descida para a memória do aparelho e
     * só então renomeia por cima do definitivo.
     *
     * Escrever direto no arquivo final significa que uma queda de energia no
     * meio da escrita deixaria metade de um JSON no lugar do caderninho inteiro
     * — e um JSON pela metade é um arquivo ilegível, ou seja, TODOS os
     * resultados pendentes perdidos de uma vez. Numa maquininha de balcão, onde
     * o cabo é chutado com alguma frequência, isso não é hipótese remota.
     *
     * O sync() é o que importa de verdade: sem ele o rename pode chegar ao disco
     * antes do conteúdo, e o resultado é um arquivo novo e vazio.
     */
    private fun gravarTexto(arquivo: File, texto: String) {
        val temporario = File(arquivo.parentFile, arquivo.name + ".tmp")
        try {
            FileOutputStream(temporario).use { saida ->
                saida.write(texto.toByteArray(Charsets.UTF_8))
                saida.flush()
                saida.fd.sync()
            }
            if (!temporario.renameTo(arquivo)) {
                // renameTo por cima de arquivo existente funciona no Linux, mas
                // não é garantido pela API do Java. O plano B abre uma janela de
                // milissegundos sem o arquivo; ainda assim é melhor do que
                // desistir e perder a gravação.
                arquivo.delete()
                if (!temporario.renameTo(arquivo)) {
                    Log.e(ETIQUETA, "Não foi possível renomear " + temporario.name)
                }
            }
        } catch (erro: Exception) {
            Log.e(ETIQUETA, "Falha ao gravar " + arquivo.name, erro)
        } finally {
            temporario.delete()
        }
    }

    private companion object {
        const val ETIQUETA = "FilaDeResultados"

        /**
         * O cadeado é de CLASSE, não de instância.
         *
         * Os três arquivos são um só caderninho, e quem escreve neles pode ser
         * mais de um objeto: o serviço tem a sua fila, e a tela precisa de outra
         * para o operador conseguir limpar a lista de atenção. Com cadeado de
         * instância, `synchronized` em objetos diferentes não impede nada — duas
         * escritas simultâneas se atropelariam e o arquivo perdido seria o de
         * pagamentos ainda não confirmados.
         */
        val TRAVA = Any()
    }
}
