package br.com.firehub.maquininha.garcom

import org.json.JSONArray
import org.json.JSONObject

/**
 * O cardápio do salão como o garçom web o vê, e a conta do preço do item.
 *
 * Tudo aqui é PORTE de código do servidor, para a maquininha mostrar o mesmo
 * que o celular do garçom:
 *
 *  - o filtro do que aparece: lib/cardapio-da-mesa.ts (`montarCardapioDaMesa`);
 *  - o preço das escolhas: lib/preco-combo.ts (`somaDosAdicionais`,
 *    `precoDaOpcao`, regras SOMA / MAIOR / MEDIA, bloqueios por escolha);
 *  - as regras do modal de opções: components/customer/ComboModal.tsx
 *    (pré-marcação de grupo sem escolha, item fixo do combo, mínimo/máximo).
 *
 * O preço daqui é só para MOSTRAR. Quem grava é o servidor, que recalcula tudo
 * em lib/lancar-na-mesa.ts a partir das escolhas — e o total que a tela mostra
 * depois de enviar é o que ele devolveu.
 */

/** Uma opção dentro de uma pergunta do produto. */
data class Opcao(
    val nome: String,
    val ativa: Boolean,
    /** Acréscimo no salão (o servidor já aplicou o preço do canal e a promoção). */
    val adicional: Double,
    /** Acréscimo de tabela, só para riscar quando a opção está em promoção. */
    val adicionalDe: Double?,
    val maxPorItem: Int?,
    val nota: String?,
    /** `precoPorEscolha` com valor: com "Grande" escolhido, esta opção custa X. */
    val tabela: List<Pair<String, Double>>,
    /** `precoPorEscolha` com null: com esta escolha feita, a opção some. */
    val bloqueios: List<String>,
)

data class Grupo(
    val id: String,
    val titulo: String,
    val maxQty: Int,
    /** Nulo = regra antiga: exige exatamente maxQty. */
    val minQty: Int?,
    val regra: String,
    val opcoes: List<Opcao>,
) {
    val max: Int get() = maxOf(1, maxQty)

    /** lib/preco-combo.ts, `minimoExigidoDoGrupo`. */
    val minimoExigido: Int
        get() {
            val m = minQty ?: return max
            if (m < 0) return max
            return minOf(m, max)
        }

    val ativas: List<Opcao> get() = opcoes.filter { it.ativa }
}

data class Produto(
    val id: String,
    val nome: String,
    val preco: Double,
    val categoria: String,
    val isCombo: Boolean,
    val descricao: String?,
    val grupos: List<Grupo>,
) {
    val temPerguntas: Boolean get() = grupos.isNotEmpty()
}

/** Escolhas do produto: grupoId -> (nome da opção -> quantidade), na ordem do toque. */
typealias Escolhas = LinkedHashMap<String, LinkedHashMap<String, Int>>

data class CardapioDoSalao(
    val produtos: List<Produto>,
    /** Abas na ordem da loja. "Combos" entra como aba transversal, igual ao web. */
    val categorias: List<String>,
) {
    fun daCategoria(categoria: String): List<Produto> =
        if (categoria == ABA_COMBOS && produtos.none { it.categoria.equals(ABA_COMBOS, ignoreCase = true) }) {
            produtos.filter { it.isCombo }
        } else {
            produtos.filter { it.categoria == categoria }
        }

    companion object {
        const val ABA_COMBOS = "Combos"
    }
}

object Cardapio {

    // ------------------------------------------------------------- leitura

    /** O que /api/garcom/cardapio devolve, filtrado como lib/cardapio-da-mesa.ts. */
    fun montar(lista: JSONArray): CardapioDoSalao {
        val brutos = (0 until lista.length()).mapNotNull { lista.optJSONObject(it) }

        val temBandeira = brutos.any { it.has("apenasOpcaoDeCombo") }
        val soOpcao: Set<String> =
            if (temBandeira) brutos.filter { it.optBoolean("apenasOpcaoDeCombo", false) }.mapNotNull { texto(it, "id") }.toSet()
            else idsSoDeOpcaoDeCombo(brutos)

        val produtos = brutos
            .filter { it.optBoolean("active", true) && !ehDeIntegracao(it) }
            .filter { it.optBoolean("activeGarcom", true) }
            .filter { !it.optBoolean("esgotado", false) }
            .filter { foraDoCardapio(it) == null }
            .filter { texto(it, "id") !in soOpcao }
            .mapNotNull { lerProduto(it) }

        val reais = produtos.map { it.categoria }.distinct()
        val temCombo = produtos.any { it.isCombo }
        val temCategoriaCombos = reais.any { it.trim().equals(CardapioDoSalao.ABA_COMBOS, ignoreCase = true) }
        val categorias = (if (temCombo && !temCategoriaCombos) listOf(CardapioDoSalao.ABA_COMBOS) else emptyList()) + reais
        return CardapioDoSalao(produtos, categorias)
    }

    private val CATEGORIAS_DE_INTEGRACAO = setOf("IFOOD", "JOTAJA", "JOTAJÁ", "99FOOD", "ONLINE", "OCULTO")

    private fun ehDeIntegracao(p: JSONObject): Boolean {
        val id = texto(p, "id") ?: ""
        val espelho = id.startsWith("ifood-") || id.startsWith("jotaja-") || id.startsWith("99food-")
        if (espelho && !p.optBoolean("active", true)) return true
        return (texto(p, "category") ?: "").trim().uppercase() in CATEGORIAS_DE_INTEGRACAO
    }

    /**
     * O servidor já anota `foraDoCardapioAgora` no fuso da loja. Sem a bandeira
     * (servidor antigo) o item aparece: quem recusa fora do horário é o
     * servidor, com a mensagem certa, na hora de lançar.
     */
    private fun foraDoCardapio(p: JSONObject): String? = texto(p, "foraDoCardapioAgora")

    /** Reserva de lib/cardapio-interno.ts (`idsSoDeOpcaoDeCombo`) para payload sem a bandeira. */
    private fun idsSoDeOpcaoDeCombo(produtos: List<JSONObject>): Set<String> {
        val emCombo = HashSet<String>()
        for (p in produtos) {
            val grupos = p.optJSONArray("comboGroups") ?: continue
            for (g in 0 until grupos.length()) {
                val itens = grupos.optJSONObject(g)?.optJSONArray("items") ?: continue
                for (i in 0 until itens.length()) {
                    val item = itens.optJSONObject(i) ?: continue
                    val id = item.optJSONObject("menuProduct")?.let { texto(it, "id") } ?: texto(item, "menuProductId")
                    if (id != null) emCombo.add(id)
                }
            }
        }
        val saida = HashSet<String>()
        for (p in produtos) {
            val id = texto(p, "id") ?: continue
            if (p.optBoolean("apenasEmCombo", false)) { saida.add(id); continue }
            if ((p.optJSONArray("comboGroups")?.length() ?: 0) > 0) continue
            val adicionais = (texto(p, "category") ?: "").trim().equals("adicionais", ignoreCase = true)
            val pareceOpcao = id in emCombo || adicionais
            // O garçom recebe só o preço do salão; "sem preço em canal nenhum"
            // vira "sem preço aqui", que é o que importa para lançar.
            if (pareceOpcao && (numero(p, "price") ?: 0.0) <= 0.0) saida.add(id)
        }
        return saida
    }

    private fun lerProduto(p: JSONObject): Produto? {
        val id = texto(p, "id") ?: return null
        return Produto(
            id = id,
            nome = texto(p, "name") ?: "Produto",
            preco = numero(p, "price") ?: 0.0,
            categoria = texto(p, "category") ?: "Outros",
            isCombo = p.optBoolean("isCombo", false),
            descricao = texto(p, "description"),
            grupos = lerGrupos(p),
        )
    }

    /** lib/cardapio-da-mesa.ts, `gruposDoProduto`: comboGroups, ou o comboConfig antigo. */
    private fun lerGrupos(p: JSONObject): List<Grupo> {
        val atuais = p.optJSONArray("comboGroups")
        if (atuais != null && atuais.length() > 0) return lerListaDeGrupos(atuais)

        val bruto = p.opt("comboConfig") ?: return emptyList()
        val config: Any? = when (bruto) {
            is String -> try {
                val t = bruto.trim()
                if (t.startsWith("[")) JSONArray(t) else if (t.startsWith("{")) JSONObject(t) else null
            } catch (e: Exception) {
                null
            }
            else -> bruto
        }
        val lista = when (config) {
            is JSONArray -> config
            is JSONObject -> config.optJSONArray("groups") ?: config.optJSONArray("comboGroups")
            else -> null
        } ?: return emptyList()
        return lerListaDeGrupos(lista)
    }

    private fun lerListaDeGrupos(lista: JSONArray): List<Grupo> =
        (0 until lista.length()).mapNotNull { indice ->
            val g = lista.optJSONObject(indice) ?: return@mapNotNull null
            val itens = g.optJSONArray("items") ?: JSONArray()
            Grupo(
                // Grupo sem id (comboConfig muito antigo) ganha um, só para a
                // tela: as escolhas vão para o servidor por NOME.
                id = texto(g, "id") ?: ("grupo-$indice"),
                titulo = texto(g, "title") ?: "Escolha",
                maxQty = g.optInt("maxQty", 1),
                minQty = if (g.has("minQty") && !g.isNull("minQty")) g.optInt("minQty") else null,
                regra = regraDe(texto(g, "priceRule")),
                opcoes = (0 until itens.length()).mapNotNull { i -> itens.optJSONObject(i)?.let { lerOpcao(it) } },
            )
        }

    private fun lerOpcao(item: JSONObject): Opcao? {
        val produto = item.optJSONObject("menuProduct")
        val nome = (produto?.let { texto(it, "name") } ?: texto(item, "name"))?.trim() ?: return null
        val (tabela, bloqueios) = lerPrecoPorEscolha(item.opt("precoPorEscolha"))
        return Opcao(
            nome = nome,
            ativa = produto?.optBoolean("active", true) ?: true,
            adicional = numero(item, "additionalPrice") ?: 0.0,
            adicionalDe = numero(item, "adicionalDe"),
            maxPorItem = if (item.has("maxPerItem") && !item.isNull("maxPerItem")) item.optInt("maxPerItem").takeIf { it > 0 } else null,
            nota = texto(item, "optionNote"),
            tabela = tabela,
            bloqueios = bloqueios,
        )
    }

    /** lib/preco-combo.ts: `tabelaDaOpcao` e `bloqueiosDaOpcao`. */
    private fun lerPrecoPorEscolha(bruto: Any?): Pair<List<Pair<String, Double>>, List<String>> {
        val obj: JSONObject = when (bruto) {
            is JSONObject -> bruto
            is String -> try { JSONObject(bruto) } catch (e: Exception) { null }
            else -> null
        } ?: return Pair(emptyList(), emptyList())

        val tabela = ArrayList<Pair<String, Double>>()
        val bloqueios = ArrayList<String>()
        for (chave in obj.keys()) {
            if (chave.isEmpty()) continue
            val v = obj.opt(chave)
            when {
                v == null || v == JSONObject.NULL -> bloqueios.add(chave)
                v is Number -> tabela.add(chave to v.toDouble())
                v is String && v.isNotBlank() -> v.trim().toDoubleOrNull()?.let { tabela.add(chave to it) }
            }
        }
        return Pair(tabela, bloqueios)
    }

    private fun regraDe(bruto: String?): String {
        val r = (bruto ?: "").trim().uppercase()
        return if (r == "MAIOR" || r == "MEDIA") r else "SOMA"
    }

    // ------------------------------------------------- regras do modal (web)

    /** lib/meio-a-meio.ts, `ehPerguntaDeMeio`. */
    fun ehPerguntaDeMeio(titulo: String): Boolean =
        Regex("^meio a meio\\?", RegexOption.IGNORE_CASE).containsMatchIn(titulo.trim())

    fun nomesEscolhidos(escolhas: Escolhas): Set<String> =
        escolhas.values.flatMap { g -> g.filter { it.value > 0 }.keys }.toSet()

    fun opcaoDisponivel(o: Opcao, escolhidas: Set<String>): Boolean = o.bloqueios.none { it in escolhidas }

    fun precoDaOpcao(o: Opcao, escolhidas: Set<String>): Double {
        for ((nome, valor) in o.tabela) if (nome in escolhidas) return valor
        return o.adicional
    }

    private fun menorPrecoDaOpcao(o: Opcao): Double =
        (listOf(o.adicional) + o.tabela.map { it.second }).minOrNull() ?: 0.0

    /** lib/preco-combo.ts, `grupoAguardaEscolha`: a borda que só existe depois do tamanho. */
    fun grupoAguardaEscolha(ativas: List<Opcao>, escolhidas: Set<String>): Boolean {
        if (ativas.isEmpty() || !ativas.all { it.bloqueios.isNotEmpty() }) return false
        val citados = ativas.flatMap { it.bloqueios + it.tabela.map { t -> t.first } }
        return citados.none { it in escolhidas }
    }

    /** ComboModal.tsx, `preenchimentoForcado`: grupo sem escolha nenhuma já vem marcado. */
    fun preenchimentoForcado(g: Grupo): LinkedHashMap<String, Int> {
        val itens = g.ativas
        if (itens.isEmpty()) return LinkedHashMap()
        if (g.minimoExigido != g.max) return LinkedHashMap()
        val tetos = itens.map { it.maxPorItem ?: g.max }
        if (tetos.sum() != g.max) return LinkedHashMap()
        val saida = LinkedHashMap<String, Int>()
        itens.forEachIndexed { i, o -> saida[o.nome] = tetos[i] }
        return saida
    }

    /** lib/combo-e-pergunta.ts, `itemFixoDoGrupo`: "4× X-Salada" não é pergunta. */
    fun itemFixo(g: Grupo): Pair<String, Int>? {
        if (g.opcoes.size != 1) return null
        if (g.minimoExigido != g.max) return null
        val teto = g.opcoes[0].maxPorItem
        if (teto != null && teto < g.max) return null
        return g.opcoes[0].nome to g.max
    }

    fun escolhasIniciais(produto: Produto): Escolhas {
        val e = Escolhas()
        produto.grupos.forEach { g -> e[g.id] = preenchimentoForcado(g) }
        return e
    }

    // ------------------------------------------------------- preço (servidor)

    /** lib/preco-combo.ts, `somaDosAdicionais` + `adicionaisDetalhados`, com grupoId conhecido. */
    fun somaDosAdicionais(produto: Produto, escolhas: Escolhas): Double {
        val escolhidas = nomesEscolhidos(escolhas)
        if (escolhidas.isEmpty()) return 0.0
        var total = 0.0
        for (g in produto.grupos) {
            val doGrupo = escolhas[g.id] ?: continue
            val linhas = doGrupo.filter { it.value > 0 }.map { (nome, qtd) ->
                val opcao = g.opcoes.firstOrNull { it.nome == nome }
                Pair(opcao?.let { precoDaOpcao(it, escolhidas) } ?: 0.0, qtd)
            }
            if (linhas.isEmpty()) continue
            total += when (g.regra) {
                "MAIOR" -> Dinheiro.arredondar(linhas.maxOf { it.first })
                "MEDIA" -> {
                    val unidades = linhas.sumOf { it.second }
                    Dinheiro.arredondar(linhas.sumOf { it.first * it.second } / unidades)
                }
                else -> Dinheiro.arredondar(linhas.sumOf { it.first * it.second })
            }
        }
        return Dinheiro.arredondar(total)
    }

    fun precoUnitario(produto: Produto, escolhas: Escolhas): Double =
        Dinheiro.arredondar(produto.preco + somaDosAdicionais(produto, escolhas))

    /** lib/preco-combo.ts, `precoMinimoDoProduto`: o "a partir de" da lista. */
    fun precoMinimo(produto: Produto): Double {
        var minimo = produto.preco
        for (g in produto.grupos) {
            if (g.opcoes.isEmpty()) continue
            val quantos = g.minimoExigido
            if (quantos <= 0) continue
            val maisBarato = g.opcoes.minOf { menorPrecoDaOpcao(it) }
            minimo += if (g.regra == "SOMA") maisBarato * quantos else maisBarato
        }
        return Dinheiro.arredondar(minimo)
    }

    /** lib/preco-combo.ts, `precoVariaPorEscolha`. */
    fun precoVaria(produto: Produto): Boolean =
        produto.grupos.any { g -> g.opcoes.any { o -> o.adicional > 0 || o.tabela.any { it.second > 0 } } }

    /** A frase do ComboModal que diz como a pizza de dois sabores é cobrada. */
    fun explicacaoDaRegra(g: Grupo): String? {
        if (g.max < 2) return null
        return when (g.regra) {
            "MAIOR" -> "Escolhendo 2, vale o preço do sabor mais caro — não soma os dois."
            "MEDIA" -> "Escolhendo 2, o preço é a média dos dois sabores."
            else -> null
        }
    }
}
