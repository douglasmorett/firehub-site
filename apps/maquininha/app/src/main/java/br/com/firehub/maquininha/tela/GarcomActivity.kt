package br.com.firehub.maquininha.tela

import android.content.Intent
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.Editable
import android.text.InputType
import android.text.TextWatcher
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import br.com.firehub.maquininha.CofreDoToken
import br.com.firehub.maquininha.R
import br.com.firehub.maquininha.estado.EstadoDoTerminal
import br.com.firehub.maquininha.garcom.ApiDoGarcom
import br.com.firehub.maquininha.garcom.Cardapio
import br.com.firehub.maquininha.garcom.CardapioDoSalao
import br.com.firehub.maquininha.garcom.CofreDoGarcom
import br.com.firehub.maquininha.garcom.Dinheiro
import br.com.firehub.maquininha.garcom.Escolhas
import br.com.firehub.maquininha.garcom.Grupo
import br.com.firehub.maquininha.garcom.ModoGarcom
import br.com.firehub.maquininha.garcom.Produto
import br.com.firehub.maquininha.garcom.numero
import br.com.firehub.maquininha.garcom.texto
import br.com.firehub.maquininha.servico.ServicoDeCobranca
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Modo garçom: tirar o pedido da mesa e cobrar, tudo na maquininha.
 *
 * Telas nativas (Cielo e PagBank reprovam WebView em app de maquininha), uma
 * Activity só com uma pilha de telas desenhadas por código. Fala com as MESMAS
 * rotas do garçom web (/garcom/<slug>/mesas), com o cookie do garçom e o
 * cabeçalho `x-operador: garcom` — ver garcom/ApiDoGarcom.kt.
 *
 * O que esta tela NÃO faz: cobrar. "Cobrar" manda a cobrança da mesa para a
 * fila do servidor endereçada a ESTA maquininha e acorda o serviço de cobrança,
 * que a pega como pega qualquer outra (com fila em disco e recuperação) e abre
 * a tela de cobrança por cima desta. Ver garcom/ModoGarcom.kt.
 *
 * Vive numa task própria (taskAffinity no manifesto): quando o serviço traz a
 * OperacaoActivity para a frente — inclusive por um pedido do totem, que tem
 * prioridade —, esta tela fica intacta atrás e volta quando a cobrança acaba.
 */
class GarcomActivity : AppCompatActivity() {

    // ------------------------------------------------------------- telas

    /** Mesa com conta aberta, como as telas a carregam de uma para outra. */
    private data class MesaAberta(val tableId: String, val sessaoId: String, val numero: Int, val rotulo: String?)

    private class ItemDoCarrinho(
        val produto: Produto,
        var quantidade: Int,
        /** [{name, quantity}] — a lista que o MesasApp manda em comboSelections. */
        val escolhas: List<Pair<String, Int>>,
        val unitario: Double,
        val observacao: String?,
    )

    private sealed class Tela {
        object Login : Tela()
        object Mesas : Tela()
        class Mesa(val mesa: MesaAberta) : Tela()
        class Categorias(val mesa: MesaAberta) : Tela()
        class Produtos(val mesa: MesaAberta, val categoria: String) : Tela()
        class Opcoes(val mesa: MesaAberta, val produto: Produto) : Tela() {
            val escolhas: Escolhas = Cardapio.escolhasIniciais(produto)
            var quantidade = 1
            var observacao = ""
            var tentouConcluir = false
        }
        class Carrinho(val mesa: MesaAberta) : Tela()
        class Cobrar(val mesa: MesaAberta, val falta: Long, val valorSugerido: Long) : Tela()
        class Acompanhando(val mesa: MesaAberta, val cobrancaId: String, val valor: Long) : Tela() {
            var terminou = false
        }
    }

    // ------------------------------------------------------------- views

    private lateinit var pecas: Pecas
    private lateinit var botaoVoltar: Button
    private lateinit var txtTituloDaTela: TextView
    private lateinit var txtQuemEsta: TextView
    private lateinit var txtRecado: TextView
    private lateinit var rolagem: ScrollView
    private lateinit var conteudo: LinearLayout
    private lateinit var rodape: LinearLayout
    private lateinit var painelCarregando: View
    private lateinit var txtCarregando: TextView

    // ------------------------------------------------------------- estado

    /**
     * Rede numa thread própria, e não na de TrabalhoDeTela: aquela é a fila das
     * chamadas ao SDK da adquirente (abortar, ativar), e uma consulta de mesa
     * lenta não pode ficar na frente do "cancelar" de um pagamento.
     */
    private val rede: ExecutorService = Executors.newSingleThreadExecutor { tarefa ->
        Thread(tarefa, "garcom-rede").apply { isDaemon = true }
    }
    private val principal = Handler(Looper.getMainLooper())

    private val pilha = ArrayList<Tela>()

    /** Muda a cada troca de tela: resposta de rede de uma tela velha é descartada. */
    private var geracao = 0
    private var iniciada = false

    private var taxaDaLoja: Double = 10.0

    /**
     * Permissão do cadastro do garçom. Hoje /api/garcom/me não manda as
     * permissões, então vale o padrão (pode) e quem barra é o servidor, com 403
     * e a mensagem dele. Se um dia /me mandar `podeFecharConta`, o botão de
     * cobrar já some sozinho para quem não pode.
     */
    private var podeFecharConta: Boolean = true
    private var jaConferiuOAcesso = false
    private var cardapio: CardapioDoSalao? = null
    private val carrinhos = HashMap<String, MutableList<ItemDoCarrinho>>()

    private val ouvinte = EstadoDoTerminal.Ouvinte { situacao -> chegouCobranca(situacao) }

    // --------------------------------------------------------- ciclo de vida

    override fun onCreate(estadoSalvo: Bundle?) {
        super.onCreate(estadoSalvo)
        setContentView(R.layout.activity_garcom)
        pecas = Pecas(this)

        botaoVoltar = findViewById(R.id.botaoVoltar)
        txtTituloDaTela = findViewById(R.id.txtTituloDaTela)
        txtQuemEsta = findViewById(R.id.txtQuemEsta)
        txtRecado = findViewById(R.id.txtRecado)
        rolagem = findViewById(R.id.rolagem)
        conteudo = findViewById(R.id.conteudo)
        rodape = findViewById(R.id.rodape)
        painelCarregando = findViewById(R.id.painelCarregando)
        txtCarregando = findViewById(R.id.txtCarregando)

        botaoVoltar.setOnClickListener { voltar() }
        txtRecado.setOnClickListener { txtRecado.visibility = View.GONE }
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() = voltar()
        })

        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        if (!CofreDoToken.estaPareada(this)) {
            // Sem pareamento não há loja nem fila; a tela de operação resolve.
            irParaAMaquininha()
            return
        }

        pilha.add(if (sessaoValeParaEstaLoja()) Tela.Mesas else Tela.Login)
    }

    override fun onStart() {
        super.onStart()
        iniciada = true
        EstadoDoTerminal.observar(ouvinte)
        // O serviço tem que estar de pé: é ele que cobra o que o garçom mandar.
        ServicoDeCobranca.ligar(this)
        // Ao voltar de uma cobrança, a tela de cima recarrega (a mesa mudou).
        pilha.lastOrNull()?.let { mostrar(it) }
        if (!jaConferiuOAcesso && pilha.lastOrNull() !is Tela.Login) conferirAcesso()
    }

    override fun onStop() {
        iniciada = false
        EstadoDoTerminal.deixarDeObservar(ouvinte)
        // Saiu da frente por causa de uma cobrança: no fim dela, a tela de
        // operação devolve a frente para cá.
        if (ModoGarcom.ehCobranca(EstadoDoTerminal.situacao)) ModoGarcom.voltarAoGarcom = true
        geracao++
        super.onStop()
    }

    override fun onDestroy() {
        rede.shutdown()
        super.onDestroy()
    }

    /**
     * Chegou cobrança no serviço (do garçom ou do totem) com esta tela na frente.
     * O serviço já pede para abrir a tela de cobrança; pedir daqui também cobre
     * o caso em que o Android segurou a abertura vinda do serviço.
     */
    private fun chegouCobranca(situacao: EstadoDoTerminal.Situacao) {
        if (!iniciada) return
        if (situacao is EstadoDoTerminal.Situacao.Escolhendo || situacao is EstadoDoTerminal.Situacao.Cobrando) {
            ModoGarcom.voltarAoGarcom = true
            startActivity(
                Intent(this, OperacaoActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            )
        }
    }

    /**
     * Confere a sessão em /api/garcom/me ao abrir: atualiza o nome e lê as
     * permissões, se o servidor mandar. Não cobre a tela: se a sessão caiu, a
     * primeira chamada de mesa já leva ao login com o motivo.
     */
    private fun conferirAcesso() {
        val c = cookie() ?: return
        jaConferiuOAcesso = true
        try {
            rede.execute {
                val r = ApiDoGarcom.get("/api/garcom/me", c)
                principal.post {
                    if (isFinishing || isDestroyed) return@post
                    val garcom = (r as? ApiDoGarcom.Resposta.Ok)?.json?.optJSONObject("garcom") ?: return@post
                    CofreDoGarcom.atualizarNome(this, texto(garcom, "name"))
                    if (garcom.has("podeFecharConta")) podeFecharConta = garcom.optBoolean("podeFecharConta", true)
                    txtQuemEsta.text = CofreDoGarcom.nome(this)?.let { getString(R.string.garcom_logado_como, it) } ?: ""
                }
            }
        } catch (erro: java.util.concurrent.RejectedExecutionException) {
            // Activity sendo destruída.
        }
    }

    private fun sessaoValeParaEstaLoja(): Boolean {
        if (CofreDoGarcom.cookie(this) == null) return false
        val daMaquininha = CofreDoToken.lojaSlug(this) ?: return true
        // A maquininha foi pareada em outra loja: o garçom de lá não vale aqui.
        return CofreDoGarcom.slug(this) == daMaquininha
    }

    // ------------------------------------------------------------ navegação

    private fun abrir(tela: Tela) {
        pilha.add(tela)
        mostrar(tela)
    }

    /** Troca a tela de cima (ex.: "Cobrar" vira "Acompanhando"). */
    private fun trocarPor(tela: Tela) {
        if (pilha.isNotEmpty()) pilha.removeAt(pilha.size - 1)
        abrir(tela)
    }

    /** Volta até a última tela da mesa (depois de enviar o pedido ou receber). */
    private fun voltarParaAMesa() {
        while (pilha.size > 1 && pilha.last() !is Tela.Mesa) pilha.removeAt(pilha.size - 1)
        mostrar(pilha.last())
    }

    private fun voltar() {
        if (painelCarregando.visibility == View.VISIBLE) return
        if (pilha.size > 1) {
            pilha.removeAt(pilha.size - 1)
            mostrar(pilha.last())
        } else {
            irParaAMaquininha()
        }
    }

    /** Sai do modo garçom (a sessão fica guardada) e volta à tela de operação. */
    private fun irParaAMaquininha() {
        ModoGarcom.voltarAoGarcom = false
        startActivity(
            Intent(this, OperacaoActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        )
        finish()
    }

    private fun mostrar(tela: Tela) {
        geracao++
        esconderTeclado()
        esconderCarregando()
        // Erro da tela anterior não vale para esta; recado bom some sozinho.
        if (recadoDeErro) txtRecado.visibility = View.GONE
        conteudo.removeAllViews()
        rodape.removeAllViews()
        rodape.visibility = View.GONE
        rolagem.scrollTo(0, 0)
        txtQuemEsta.text = CofreDoGarcom.nome(this)?.let { getString(R.string.garcom_logado_como, it) } ?: ""
        botaoVoltar.text = getString(if (pilha.size > 1) R.string.garcom_voltar else R.string.garcom_sair_do_modo)

        when (tela) {
            is Tela.Login -> telaDeLogin(null)
            is Tela.Mesas -> telaDeMesas()
            is Tela.Mesa -> telaDaMesa(tela)
            is Tela.Categorias -> telaDeCategorias(tela)
            is Tela.Produtos -> telaDeProdutos(tela)
            is Tela.Opcoes -> telaDeOpcoes(tela)
            is Tela.Carrinho -> telaDoCarrinho(tela)
            is Tela.Cobrar -> telaDeCobrar(tela)
            is Tela.Acompanhando -> telaDeAcompanhar(tela)
        }
    }

    // ------------------------------------------------------- rede e avisos

    /**
     * Roda `tarefa` na thread de rede e entrega na principal, se a tela ainda
     * for a mesma. `carregando` cobre a tela e segura o toque duplo.
     */
    private fun <T> emSegundoPlano(carregando: String?, tarefa: () -> T, aoTerminar: (T) -> Unit) {
        val minha = geracao
        if (carregando != null) mostrarCarregando(carregando)
        try {
            rede.execute {
                val resultado = try {
                    Result.success(tarefa())
                } catch (erro: Throwable) {
                    Result.failure(erro)
                }
                principal.post {
                    if (isFinishing || isDestroyed || minha != geracao) return@post
                    if (carregando != null) esconderCarregando()
                    resultado
                        .onSuccess(aoTerminar)
                        .onFailure { erro -> avisar(getString(R.string.garcom_falha_inesperada, erro.message ?: erro.javaClass.simpleName)) }
                }
            }
        } catch (erro: java.util.concurrent.RejectedExecutionException) {
            // Activity sendo destruída.
        }
    }

    private fun cookie(): String? = CofreDoGarcom.cookie(this)

    /** Chamada à API do garçom; sessão vencida volta ao login sozinha. */
    private fun chamar(
        carregando: String?,
        chamada: (cookie: String) -> ApiDoGarcom.Resposta,
        seRecusada: ((ApiDoGarcom.Resposta.Recusada) -> Boolean)? = null,
        aoTerminar: (ApiDoGarcom.Resposta.Ok) -> Unit,
    ) {
        val c = cookie()
        if (c == null) {
            sessaoExpirou(null)
            return
        }
        emSegundoPlano(carregando, { chamada(c) }) { resposta ->
            when (resposta) {
                is ApiDoGarcom.Resposta.Ok -> aoTerminar(resposta)
                is ApiDoGarcom.Resposta.SessaoExpirada -> sessaoExpirou(resposta.mensagem)
                is ApiDoGarcom.Resposta.Recusada ->
                    if (seRecusada?.invoke(resposta) != true) avisar(resposta.mensagem)
                is ApiDoGarcom.Resposta.SemRede -> avisar(getString(R.string.garcom_sem_rede, resposta.mensagem))
            }
        }
    }

    /**
     * 401 numa rota de mesa é um "não autorizado" seco. /api/garcom/me diz o
     * porquê (senha trocada, caixa fechado, acesso desativado), e é esse motivo
     * que vai para a tela de login.
     */
    private fun sessaoExpirou(mensagem: String?) {
        val c = cookie()
        val padrao = getString(R.string.garcom_sessao_expirou)
        if (c == null) {
            irParaOLogin(mensagem ?: padrao)
            return
        }
        geracao++
        emSegundoPlano(getString(R.string.garcom_conferindo_sessao), { ApiDoGarcom.get("/api/garcom/me", c) }) { r ->
            val motivo = when (r) {
                is ApiDoGarcom.Resposta.SessaoExpirada -> r.mensagem
                is ApiDoGarcom.Resposta.Recusada -> r.mensagem
                else -> null
            }
            irParaOLogin(motivo ?: mensagem?.takeIf { it.length > 20 } ?: padrao)
        }
    }

    private fun irParaOLogin(motivo: String?) {
        CofreDoGarcom.esquecerSessao(this)
        carrinhos.clear()
        pilha.clear()
        pilha.add(Tela.Login)
        mostrar(Tela.Login)
        if (motivo != null) avisar(motivo)
    }

    /** O recado na tela é de erro (fica até a próxima tela) ou bom (some sozinho). */
    private var recadoDeErro = false

    private fun avisar(texto: String) {
        recadoDeErro = true
        txtRecado.text = texto
        txtRecado.setBackgroundColor(pecas.cor(R.color.fundo_recusado))
        txtRecado.visibility = View.VISIBLE
        principal.removeCallbacks(esconderRecado)
    }

    /** Recado bom (pedido enviado, item somado): some sozinho. */
    private fun informar(texto: String) {
        recadoDeErro = false
        txtRecado.text = texto
        txtRecado.setBackgroundColor(pecas.cor(R.color.fundo_aprovado))
        txtRecado.visibility = View.VISIBLE
        principal.removeCallbacks(esconderRecado)
        principal.postDelayed(esconderRecado, 2_500L)
    }

    private val esconderRecado = Runnable { txtRecado.visibility = View.GONE }

    private fun mostrarCarregando(texto: String) {
        txtCarregando.text = texto
        painelCarregando.visibility = View.VISIBLE
    }

    private fun esconderCarregando() {
        painelCarregando.visibility = View.GONE
    }

    private fun esconderTeclado() {
        val teclado = getSystemService(INPUT_METHOD_SERVICE) as? InputMethodManager ?: return
        currentFocus?.let { teclado.hideSoftInputFromWindow(it.windowToken, 0) }
    }

    private fun titulo(texto: String) {
        txtTituloDaTela.text = texto
    }

    private fun noRodape(vararg views: View) {
        rodape.visibility = View.VISIBLE
        views.forEachIndexed { i, v ->
            (v.layoutParams as? LinearLayout.LayoutParams)?.topMargin = if (i == 0) 0 else pecas.dp(8)
            rodape.addView(v)
        }
    }

    private fun nomeDaMesa(mesa: MesaAberta): String =
        if (!mesa.rotulo.isNullOrBlank()) getString(R.string.garcom_mesa_com_nome, mesa.numero, mesa.rotulo)
        else getString(R.string.garcom_mesa_numero, mesa.numero)

    // ================================================================ LOGIN

    private fun telaDeLogin(motivo: String?) {
        titulo(getString(R.string.garcom_login_titulo))
        txtQuemEsta.text = ""
        motivo?.let { avisar(it) }

        conteudo.addView(pecas.texto(getString(R.string.garcom_login_explicacao), 16f, R.color.texto_fraco))

        val slugDaMaquininha = CofreDoToken.lojaSlug(this)
        val campoLoja: EditText?
        if (slugDaMaquininha != null) {
            conteudo.addView(pecas.texto(getString(R.string.garcom_login_loja, slugDaMaquininha), 18f, negrito = true, margemTopo = 14))
            campoLoja = null
        } else {
            // Servidor ainda não contou a loja (primeira volta do polling não
            // aconteceu, ou servidor antigo). O garçom digita o final do link.
            conteudo.addView(pecas.texto(getString(R.string.garcom_login_sem_loja), 15f, R.color.atencao, margemTopo = 14))
            campoLoja = pecas.campo(
                getString(R.string.garcom_login_campo_loja),
                InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or InputType.TYPE_TEXT_VARIATION_URI,
                maximo = 80,
            ).also { it.setText(CofreDoGarcom.slug(this) ?: "") }
            conteudo.addView(campoLoja)
            ServicoDeCobranca.acordar(this)
        }

        val campoUsuario = pecas.campo(
            getString(R.string.garcom_login_campo_usuario),
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
            maximo = 30,
            margemTopo = 14,
        ).also { it.setText(CofreDoGarcom.ultimoLogin(this) ?: "") }
        val campoSenha = pecas.campo(
            getString(R.string.garcom_login_campo_senha),
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD,
            maximo = 100,
        )
        conteudo.addView(campoUsuario)
        conteudo.addView(campoSenha)

        val entrar = pecas.botao(getString(R.string.garcom_login_entrar)) {
            val slug = (campoLoja?.text?.toString()?.trim()?.trim('/')?.substringAfterLast('/') ?: slugDaMaquininha).orEmpty()
            val login = campoUsuario.text.toString().trim().lowercase()
            val senha = campoSenha.text.toString()
            when {
                slug.isEmpty() -> avisar(getString(R.string.garcom_login_falta_loja))
                login.isEmpty() || senha.isEmpty() -> avisar(getString(R.string.garcom_login_falta_dados))
                else -> entrar(slug, login, senha)
            }
        }
        noRodape(entrar)
    }

    private fun entrar(slug: String, login: String, senha: String) {
        esconderTeclado()
        txtRecado.visibility = View.GONE
        emSegundoPlano(getString(R.string.garcom_login_entrando), { ApiDoGarcom.entrar(slug, login, senha) }) { r ->
            when (r) {
                is ApiDoGarcom.Entrada.Ok -> {
                    CofreDoGarcom.guardar(this, r.cookie, r.nome, slug, login)
                    podeFecharConta = true
                    conferirAcesso()
                    carrinhos.clear()
                    cardapio = null
                    pilha.clear()
                    pilha.add(Tela.Mesas)
                    mostrar(Tela.Mesas)
                }
                is ApiDoGarcom.Entrada.Recusada -> avisar(r.mensagem)
                is ApiDoGarcom.Entrada.SemRede -> avisar(getString(R.string.garcom_sem_rede, r.mensagem))
            }
        }
    }

    private fun perguntarSeSai() {
        AlertDialog.Builder(this)
            .setTitle(R.string.garcom_sair_titulo)
            .setMessage(R.string.garcom_sair_texto)
            .setNegativeButton(R.string.garcom_nao, null)
            .setPositiveButton(R.string.garcom_sair_sim) { _, _ ->
                val c = cookie()
                emSegundoPlano(getString(R.string.garcom_saindo), { if (c != null) ApiDoGarcom.sair(c) }) {
                    irParaOLogin(null)
                }
            }
            .show()
    }

    // ================================================================ MESAS

    private fun telaDeMesas() {
        titulo(getString(R.string.garcom_mesas_titulo))
        noRodape(
            pecas.botao(getString(R.string.garcom_atualizar), principal = false) { mostrar(Tela.Mesas) },
            pecas.botao(getString(R.string.garcom_trocar_garcom), principal = false, alturaDp = 52) { perguntarSeSai() },
        )

        chamar(getString(R.string.garcom_carregando_mesas), { c -> ApiDoGarcom.get("/api/store/tables", c) }) { ok ->
            val json = ok.json ?: return@chamar avisar(getString(R.string.garcom_resposta_estranha))
            numero(json, "taxaServicoPadrao")?.let { taxaDaLoja = it }
            val mesas = json.optJSONArray("tables") ?: JSONArray()
            desenharMesas(mesas)
        }
    }

    private fun desenharMesas(mesas: JSONArray) {
        conteudo.removeAllViews()
        val ativas = (0 until mesas.length()).mapNotNull { mesas.optJSONObject(it) }
            .filter { it.optBoolean("isActive", true) }

        if (ativas.isEmpty()) {
            conteudo.addView(pecas.texto(getString(R.string.garcom_sem_mesas), 18f, R.color.texto_fraco, centralizado = true, margemTopo = 24))
            return
        }

        val abertas = ativas.count { it.optJSONObject("openSession") != null }
        conteudo.addView(pecas.texto(getString(R.string.garcom_mesas_resumo, abertas, ativas.size), 15f, R.color.texto_fraco))

        // Três por linha: numa tela de 5" cada mesa fica com ~100dp, o dedo
        // acerta e o número se lê de longe.
        var linha: LinearLayout? = null
        ativas.forEachIndexed { i, mesa ->
            if (i % COLUNAS_DE_MESA == 0) {
                linha = pecas.linha().also {
                    (it.layoutParams as LinearLayout.LayoutParams).topMargin = pecas.dp(8)
                    conteudo.addView(it)
                }
            }
            linha!!.addView(cartaoDaMesa(mesa, i % COLUNAS_DE_MESA))
        }
        // Completa a última linha para as células não esticarem.
        val sobra = (COLUNAS_DE_MESA - ativas.size % COLUNAS_DE_MESA) % COLUNAS_DE_MESA
        repeat(sobra) {
            linha!!.addView(View(this).apply {
                layoutParams = LinearLayout.LayoutParams(0, 1, 1f).apply { marginStart = pecas.dp(8) }
                visibility = View.INVISIBLE
            })
        }
    }

    private fun cartaoDaMesa(mesa: JSONObject, coluna: Int): View {
        val numeroDaMesa = mesa.optInt("number")
        val rotulo = texto(mesa, "label")
        val sessao = mesa.optJSONObject("openSession")
        val ocupada = sessao != null

        val caixa = pecas.coluna().apply {
            layoutParams = LinearLayout.LayoutParams(0, pecas.dp(96), 1f).apply {
                if (coluna > 0) marginStart = pecas.dp(8)
            }
            gravity = Gravity.CENTER
            background = pecas.fundoArredondado(
                if (ocupada) R.color.destaque_apagado else R.color.fundo_cartao,
                if (ocupada) R.color.destaque else R.color.cinza_botao,
                if (ocupada) 2 else 1,
            )
            isClickable = true
            isFocusable = true
            setPadding(pecas.dp(4), pecas.dp(4), pecas.dp(4), pecas.dp(4))
        }
        caixa.addView(pecas.texto(numeroDaMesa.toString(), 28f, negrito = true, centralizado = true))
        val legenda = when {
            ocupada -> Dinheiro.formatarReais(numero(sessao!!, "totalAmount") ?: 0.0)
            !rotulo.isNullOrBlank() -> rotulo
            else -> getString(R.string.garcom_mesa_livre)
        }
        caixa.addView(
            pecas.texto(legenda, 14f, if (ocupada) R.color.texto else R.color.texto_fraco, centralizado = true).apply {
                maxLines = 1
            },
        )

        caixa.setOnClickListener {
            val tableId = texto(mesa, "id") ?: return@setOnClickListener
            if (sessao != null) {
                val id = texto(sessao, "id") ?: return@setOnClickListener
                abrir(Tela.Mesa(MesaAberta(tableId, id, numeroDaMesa, rotulo)))
            } else {
                perguntarSeAbre(tableId, numeroDaMesa, rotulo)
            }
        }
        return caixa
    }

    private fun perguntarSeAbre(tableId: String, numeroDaMesa: Int, rotulo: String?) {
        AlertDialog.Builder(this)
            .setTitle(getString(R.string.garcom_abrir_titulo, numeroDaMesa))
            .setMessage(R.string.garcom_abrir_texto)
            .setNegativeButton(R.string.garcom_nao, null)
            .setPositiveButton(R.string.garcom_abrir_sim) { _, _ -> abrirMesa(tableId, numeroDaMesa, rotulo) }
            .show()
    }

    /** POST /api/store/table-sessions { tableId }, como o garçom web abre a mesa. */
    private fun abrirMesa(tableId: String, numeroDaMesa: Int, rotulo: String?) {
        val corpo = JSONObject().put("tableId", tableId)
        chamar(
            getString(R.string.garcom_abrindo_mesa),
            { c -> ApiDoGarcom.post("/api/store/table-sessions", corpo, c) },
            seRecusada = { r ->
                // Outro garçom abriu a mesma mesa um segundo antes: recarrega e
                // a mesa aparece aberta, com a conta dele.
                if (r.status == 400 && r.mensagem.contains("already", ignoreCase = true)) {
                    informar(getString(R.string.garcom_mesa_ja_aberta))
                    mostrar(Tela.Mesas)
                    true
                } else {
                    false
                }
            },
        ) { ok ->
            val id = ok.json?.let { texto(it, "id") }
            if (id == null) {
                mostrar(Tela.Mesas)
            } else {
                abrir(Tela.Mesa(MesaAberta(tableId, id, numeroDaMesa, rotulo)))
            }
        }
    }

    // ================================================================= MESA

    private class ContaDaMesa(
        val linhas: List<Triple<String, Int, Double>>,
        val consumo: Double,
        val desconto: Double,
        val taxaPct: Double,
        val taxaValor: Double,
        val gorjeta: Double,
        val total: Double,
        val pago: Double,
        val cobrancaViva: JSONObject?,
    ) {
        val falta: Long get() = maxOf(0L, Dinheiro.centavos(total) - Dinheiro.centavos(pago))
    }

    private fun telaDaMesa(tela: Tela.Mesa) {
        val mesa = tela.mesa
        titulo(nomeDaMesa(mesa))

        val taxa = taxaDaLoja
        chamar(getString(R.string.garcom_carregando_conta), { c ->
            val base = "/api/store/table-sessions/" + ApiDoGarcom.codificar(mesa.sessaoId)
            val conta = ApiDoGarcom.get("$base/conta?taxa=$taxa", c)
            if (conta !is ApiDoGarcom.Resposta.Ok) return@chamar conta
            val pagamentos = ApiDoGarcom.get("$base/pagamentos", c)
            val maquininha = ApiDoGarcom.get("$base/maquininha", c)
            val juntos = JSONObject()
            juntos.put("conta", conta.json ?: JSONObject())
            (pagamentos as? ApiDoGarcom.Resposta.Ok)?.json?.let { juntos.put("pagamentos", it) }
            (maquininha as? ApiDoGarcom.Resposta.Ok)?.json?.let { juntos.put("maquininha", it) }
            ApiDoGarcom.Resposta.Ok(200, juntos, null)
        }, seRecusada = { r ->
            if (r.status == 404) {
                // A mesa foi fechada pelo caixa enquanto o garçom olhava.
                pilha.clear()
                pilha.add(Tela.Mesas)
                mostrar(Tela.Mesas)
                avisar(getString(R.string.garcom_mesa_fechada))
                true
            } else {
                false
            }
        }) { ok ->
            val conta = lerConta(ok.json ?: JSONObject())
            desenharMesa(tela, conta)
        }
    }

    private fun lerConta(juntos: JSONObject): ContaDaMesa {
        val c = juntos.optJSONObject("conta") ?: JSONObject()
        val linhas = ArrayList<Triple<String, Int, Double>>()
        fun lerLinhas(lista: JSONArray?) {
            if (lista == null) return
            for (i in 0 until lista.length()) {
                val l = lista.optJSONObject(i) ?: continue
                linhas += Triple(texto(l, "nome") ?: "Item", l.optInt("quantidade", 1), numero(l, "valor") ?: 0.0)
            }
        }
        lerLinhas(c.optJSONObject("itensDaMesa")?.optJSONArray("itens"))
        val pessoas = c.optJSONArray("pessoas")
        if (pessoas != null) for (i in 0 until pessoas.length()) lerLinhas(pessoas.optJSONObject(i)?.optJSONArray("itens"))

        val cobrancas = juntos.optJSONObject("maquininha")?.optJSONArray("cobrancas")
        var viva: JSONObject? = null
        if (cobrancas != null) for (i in 0 until cobrancas.length()) {
            val cb = cobrancas.optJSONObject(i) ?: continue
            if (texto(cb, "status") in STATUS_VIVOS) { viva = cb; break }
        }

        return ContaDaMesa(
            linhas = linhas,
            consumo = numero(c, "consumo") ?: 0.0,
            desconto = c.optJSONObject("desconto")?.let { numero(it, "valor") } ?: 0.0,
            taxaPct = c.optJSONObject("taxaServico")?.let { numero(it, "percentual") } ?: 0.0,
            taxaValor = c.optJSONObject("taxaServico")?.let { numero(it, "valor") } ?: 0.0,
            gorjeta = numero(c, "gorjeta") ?: 0.0,
            total = numero(c, "total") ?: 0.0,
            pago = juntos.optJSONObject("pagamentos")?.let { numero(it, "totalPago") } ?: 0.0,
            cobrancaViva = viva,
        )
    }

    private fun desenharMesa(tela: Tela.Mesa, conta: ContaDaMesa) {
        conteudo.removeAllViews()
        val mesa = tela.mesa

        // Cobrança na maquininha ainda viva (a tela foi fechada no meio, ou
        // outra pessoa mandou): mostrar antes de tudo, para ninguém mandar outra.
        conta.cobrancaViva?.let { cb ->
            val valor = Dinheiro.centavos(numero(cb, "valor") ?: 0.0)
            val caixa = pecas.cartao(margemTopo = 0, destaque = true)
            caixa.addView(pecas.texto(getString(R.string.garcom_cobranca_viva, Dinheiro.formatar(valor)), 17f, negrito = true))
            caixa.addView(pecas.botao(getString(R.string.garcom_acompanhar), principal = false, alturaDp = 56) {
                texto(cb, "id")?.let { abrir(Tela.Acompanhando(mesa, it, valor)) }
            })
            conteudo.addView(caixa)
        }

        val itens = pecas.cartao()
        itens.addView(pecas.texto(getString(R.string.garcom_itens_lancados), 15f, R.color.texto_fraco, negrito = true))
        if (conta.linhas.isEmpty()) {
            itens.addView(pecas.texto(getString(R.string.garcom_sem_itens), 17f, R.color.texto_fraco, margemTopo = 6))
        } else {
            for ((nome, qtd, valor) in conta.linhas) {
                itens.addView(pecas.linhaDeValor(qtd.toString() + "× " + nome, Dinheiro.formatarReais(valor)))
            }
        }
        conteudo.addView(itens)

        val resumo = pecas.cartao()
        resumo.addView(pecas.linhaDeValor(getString(R.string.garcom_consumo), Dinheiro.formatarReais(conta.consumo)))
        if (conta.desconto > 0.0) {
            resumo.addView(pecas.linhaDeValor(getString(R.string.garcom_desconto), "- " + Dinheiro.formatarReais(conta.desconto)))
        }
        if (conta.taxaValor > 0.0) {
            resumo.addView(pecas.linhaDeValor(getString(R.string.garcom_taxa, formatarPct(conta.taxaPct)), Dinheiro.formatarReais(conta.taxaValor)))
        }
        if (conta.gorjeta > 0.0) {
            resumo.addView(pecas.linhaDeValor(getString(R.string.garcom_gorjeta), Dinheiro.formatarReais(conta.gorjeta)))
        }
        resumo.addView(pecas.linhaDeValor(getString(R.string.garcom_total), Dinheiro.formatarReais(conta.total), grande = true))
        if (conta.pago > 0.0) {
            resumo.addView(pecas.linhaDeValor(getString(R.string.garcom_ja_pago), Dinheiro.formatarReais(conta.pago), corId = R.color.aprovado))
        }
        resumo.addView(
            pecas.linhaDeValor(
                getString(R.string.garcom_falta_pagar),
                Dinheiro.formatar(conta.falta),
                grande = true,
                corId = if (conta.falta > 0) R.color.destaque else R.color.aprovado,
            ),
        )
        conteudo.addView(resumo)

        val carrinho = carrinhos[mesa.sessaoId].orEmpty()
        if (carrinho.isNotEmpty()) {
            val caixa = pecas.cartao(destaque = true)
            caixa.addView(pecas.texto(getString(R.string.garcom_carrinho_pendente, carrinho.sumOf { it.quantidade }), 16f, R.color.atencao))
            caixa.addView(pecas.botao(getString(R.string.garcom_ver_carrinho), principal = false, alturaDp = 56) {
                abrir(Tela.Carrinho(mesa))
            })
            conteudo.addView(caixa)
        }

        conteudo.addView(pecas.botao(getString(R.string.garcom_atualizar), principal = false, alturaDp = 52, margemTopo = 12) {
            mostrar(tela)
        })

        val lancar = pecas.botao(getString(R.string.garcom_lancar_itens)) { abrir(Tela.Categorias(mesa)) }
        val cobrar = pecas.botao(
            if (conta.falta > 0) getString(R.string.garcom_cobrar_valor, Dinheiro.formatar(conta.falta))
            else getString(R.string.garcom_nada_a_cobrar),
            principal = false,
        ) {
            if (conta.cobrancaViva != null) {
                avisar(getString(R.string.garcom_ja_tem_cobranca))
            } else {
                abrir(Tela.Cobrar(mesa, conta.falta, conta.falta))
            }
        }
        // Valor mínimo da maquininha é R$ 1,00 (lib/cobranca-da-mesa-na-maquininha.ts).
        pecas.habilitar(cobrar, conta.falta >= VALOR_MINIMO && podeFecharConta)
        if (!podeFecharConta) cobrar.text = getString(R.string.garcom_sem_permissao_de_cobrar)
        noRodape(lancar, cobrar)
    }

    private fun formatarPct(pct: Double): String =
        if (pct == Math.floor(pct)) pct.toLong().toString() else pct.toString().replace('.', ',')

    // ============================================================ CARDÁPIO

    private fun comCardapio(seguir: (CardapioDoSalao) -> Unit) {
        cardapio?.let { return seguir(it) }
        chamar(getString(R.string.garcom_carregando_cardapio), { c -> ApiDoGarcom.get("/api/garcom/cardapio", c) }) { ok ->
            val lista = ok.lista ?: return@chamar avisar(getString(R.string.garcom_resposta_estranha))
            val montado = Cardapio.montar(lista)
            cardapio = montado
            seguir(montado)
        }
    }

    private fun botaoDoCarrinho(mesa: MesaAberta): View? {
        val itens = carrinhos[mesa.sessaoId].orEmpty()
        if (itens.isEmpty()) return null
        val total = itens.sumOf { Dinheiro.centavos(it.unitario) * it.quantidade }
        return pecas.botao(getString(R.string.garcom_ver_pedido, itens.sumOf { it.quantidade }, Dinheiro.formatar(total))) {
            abrir(Tela.Carrinho(mesa))
        }
    }

    private fun telaDeCategorias(tela: Tela.Categorias) {
        titulo(getString(R.string.garcom_lancar_em, nomeDaMesa(tela.mesa)))
        botaoDoCarrinho(tela.mesa)?.let { noRodape(it) }

        comCardapio { c ->
            conteudo.removeAllViews()
            if (c.produtos.isEmpty()) {
                conteudo.addView(pecas.texto(getString(R.string.garcom_cardapio_vazio), 17f, R.color.texto_fraco, margemTopo = 16))
            }
            for (categoria in c.categorias) {
                val quantos = c.daCategoria(categoria).size
                if (quantos == 0) continue
                conteudo.addView(pecas.botao(getString(R.string.garcom_categoria, categoria, quantos), principal = false, alturaDp = 64) {
                    abrir(Tela.Produtos(tela.mesa, categoria))
                }.apply { gravity = Gravity.START or Gravity.CENTER_VERTICAL })
            }
            conteudo.addView(pecas.botao(getString(R.string.garcom_atualizar_cardapio), principal = false, alturaDp = 48, margemTopo = 18) {
                cardapio = null
                mostrar(tela)
            })
        }
    }

    private fun telaDeProdutos(tela: Tela.Produtos) {
        titulo(tela.categoria)
        botaoDoCarrinho(tela.mesa)?.let { noRodape(it) }

        comCardapio { c ->
            conteudo.removeAllViews()
            conteudo.addView(pecas.texto(getString(R.string.garcom_dica_produto), 14f, R.color.texto_fraco))
            for (produto in c.daCategoria(tela.categoria)) {
                val preco = if (produto.temPerguntas && Cardapio.precoVaria(produto)) {
                    getString(R.string.garcom_a_partir_de, Dinheiro.formatarReais(Cardapio.precoMinimo(produto)))
                } else {
                    Dinheiro.formatarReais(produto.preco)
                }
                val botao = pecas.botao(produto.nome + "\n" + preco, principal = false, alturaDp = 68) {
                    tocarNoProduto(tela.mesa, produto)
                }
                botao.gravity = Gravity.START or Gravity.CENTER_VERTICAL
                botao.setOnLongClickListener {
                    abrir(Tela.Opcoes(tela.mesa, produto))
                    true
                }
                conteudo.addView(botao)
            }
        }
    }

    /**
     * Como o garçom web (MesasApp, handleProductClick): produto com pergunta
     * abre as opções; produto simples soma UM no pedido a cada toque. Toque
     * longo abre a tela do item para quantidade e observação.
     */
    private fun tocarNoProduto(mesa: MesaAberta, produto: Produto) {
        if (produto.temPerguntas) {
            abrir(Tela.Opcoes(mesa, produto))
            return
        }
        val lista = carrinhos.getOrPut(mesa.sessaoId) { ArrayList() }
        val existente = lista.firstOrNull { it.produto.id == produto.id && it.escolhas.isEmpty() && it.observacao == null }
        if (existente != null) existente.quantidade = minOf(99, existente.quantidade + 1)
        else lista.add(ItemDoCarrinho(produto, 1, emptyList(), produto.preco, null))
        informar(getString(R.string.garcom_somado, produto.nome, existente?.quantidade ?: 1))
        // Atualiza o botão do carrinho no rodapé sem redesenhar a lista (e
        // sem perder a rolagem).
        rodape.removeAllViews()
        botaoDoCarrinho(mesa)?.let { noRodape(it) }
    }

    // =============================================================== OPÇÕES

    private var containerDosGrupos: LinearLayout? = null
    private var botaoAdicionar: Button? = null
    private var txtQuantidade: TextView? = null
    private val viewsDosGrupos = HashMap<String, View>()

    private fun telaDeOpcoes(tela: Tela.Opcoes) {
        val produto = tela.produto
        titulo(produto.nome)

        produto.descricao?.let { conteudo.addView(pecas.texto(it, 15f, R.color.texto_fraco)) }

        val grupos = pecas.coluna()
        containerDosGrupos = grupos
        conteudo.addView(grupos)

        // Quantidade
        val caixaQtd = pecas.cartao()
        caixaQtd.addView(pecas.texto(getString(R.string.garcom_quantidade), 15f, R.color.texto_fraco, negrito = true))
        val linhaQtd = pecas.linha().apply { gravity = Gravity.CENTER }
        val qtd = pecas.texto(tela.quantidade.toString(), 26f, negrito = true, centralizado = true).apply {
            layoutParams = LinearLayout.LayoutParams(pecas.dp(90), ViewGroup.LayoutParams.WRAP_CONTENT)
        }
        txtQuantidade = qtd
        linhaQtd.addView(pecas.botaoDeQuantidade("−") {
            if (tela.quantidade > 1) tela.quantidade--
            atualizarOpcoes(tela)
        })
        linhaQtd.addView(qtd)
        linhaQtd.addView(pecas.botaoDeQuantidade("+") {
            if (tela.quantidade < 99) tela.quantidade++
            atualizarOpcoes(tela)
        })
        caixaQtd.addView(linhaQtd)
        conteudo.addView(caixaQtd)

        // Observação ("sem cebola"): vai para a cozinha e para a comanda.
        val obs = pecas.campo(
            getString(R.string.garcom_observacao),
            InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES,
            maximo = 140,
            margemTopo = 12,
        )
        obs.setText(tela.observacao)
        obs.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = Unit
            override fun afterTextChanged(s: Editable?) {
                tela.observacao = s?.toString() ?: ""
            }
        })
        conteudo.addView(obs)

        val adicionar = pecas.botao("") { concluirOpcoes(tela) }
        botaoAdicionar = adicionar
        noRodape(adicionar)

        atualizarOpcoes(tela)
    }

    /** Tira da escolha o que outra escolha bloqueou (o useEffect do ComboModal). */
    private fun limparBloqueadas(tela: Tela.Opcoes) {
        var mudou = true
        while (mudou) {
            mudou = false
            val escolhidas = Cardapio.nomesEscolhidos(tela.escolhas)
            for (g in tela.produto.grupos) {
                val doGrupo = tela.escolhas[g.id] ?: continue
                for (o in g.opcoes) {
                    if ((doGrupo[o.nome] ?: 0) > 0 && !Cardapio.opcaoDisponivel(o, escolhidas)) {
                        doGrupo.remove(o.nome)
                        mudou = true
                    }
                }
            }
        }
    }

    private fun grupoEscondido(g: Grupo, escolhidas: Set<String>): Boolean {
        val ativas = g.ativas
        if (ativas.isEmpty()) return false
        val visiveis = ativas.filter { Cardapio.opcaoDisponivel(it, escolhidas) }
        return visiveis.isEmpty() ||
            (!Cardapio.ehPerguntaDeMeio(g.titulo) && Cardapio.grupoAguardaEscolha(ativas, escolhidas))
    }

    private fun fixoDoGrupo(tela: Tela.Opcoes, g: Grupo): Pair<String, Int>? {
        if (!tela.produto.isCombo) return null
        val fixo = Cardapio.itemFixo(g) ?: return null
        if (!g.opcoes[0].ativa) return null
        return if ((tela.escolhas[g.id]?.get(fixo.first) ?: 0) == fixo.second) fixo else null
    }

    private fun totalDoGrupo(tela: Tela.Opcoes, g: Grupo): Int = tela.escolhas[g.id]?.values?.sum() ?: 0

    private fun grupoCompleto(tela: Tela.Opcoes, g: Grupo): Boolean {
        val total = totalDoGrupo(tela, g)
        return total >= g.minimoExigido && total <= g.max
    }

    private fun atualizarOpcoes(tela: Tela.Opcoes) {
        limparBloqueadas(tela)
        val container = containerDosGrupos ?: return
        container.removeAllViews()
        viewsDosGrupos.clear()

        val escolhidas = Cardapio.nomesEscolhidos(tela.escolhas)
        val naTela = tela.produto.grupos.filter { !grupoEscondido(it, escolhidas) }
        val fixos = naTela.mapNotNull { fixoDoGrupo(tela, it) }
        val perguntas = naTela.filter { fixoDoGrupo(tela, it) == null }

        if (fixos.isNotEmpty()) {
            val caixa = pecas.cartao(margemTopo = 6)
            caixa.addView(pecas.texto(getString(R.string.garcom_vem_no_combo), 15f, R.color.texto_fraco, negrito = true))
            fixos.forEach { (nome, qtd) -> caixa.addView(pecas.texto(qtd.toString() + "× " + nome, 17f, margemTopo = 4)) }
            container.addView(caixa)
        }

        perguntas.forEachIndexed { indice, g -> container.addView(desenharGrupo(tela, g, indice + 1, escolhidas)) }

        txtQuantidade?.text = tela.quantidade.toString()
        val unitario = Cardapio.precoUnitario(tela.produto, tela.escolhas)
        val total = Dinheiro.centavos(unitario) * tela.quantidade
        botaoAdicionar?.text = getString(R.string.garcom_adicionar, Dinheiro.formatar(total))
    }

    private fun desenharGrupo(tela: Tela.Opcoes, g: Grupo, ordem: Int, escolhidas: Set<String>): View {
        val total = totalDoGrupo(tela, g)
        val completo = grupoCompleto(tela, g)
        val pendente = tela.tentouConcluir && !completo

        val caixa = pecas.cartao(destaque = pendente)
        viewsDosGrupos[g.id] = caixa

        caixa.addView(pecas.texto(ordem.toString() + ". " + g.titulo, 18f, negrito = true))
        val regra = when {
            g.minimoExigido == 0 -> getString(R.string.garcom_grupo_opcional, g.max)
            g.minimoExigido == g.max -> getString(R.string.garcom_grupo_exato, g.max)
            else -> getString(R.string.garcom_grupo_faixa, g.minimoExigido, g.max)
        }
        caixa.addView(
            pecas.texto(
                regra + "  ·  " + total + "/" + g.max,
                14f,
                when {
                    pendente -> R.color.recusado
                    completo && total > 0 -> R.color.aprovado
                    else -> R.color.texto_fraco
                },
                margemTopo = 2,
            ),
        )
        Cardapio.explicacaoDaRegra(g)?.let { caixa.addView(pecas.texto(it, 14f, R.color.atencao, margemTopo = 2)) }

        val visiveis = g.ativas.filter { Cardapio.opcaoDisponivel(it, escolhidas) }
        for (o in visiveis) {
            val qtd = tela.escolhas[g.id]?.get(o.nome) ?: 0
            val preco = Cardapio.precoDaOpcao(o, escolhidas)
            val precoTexto = if (preco > 0.0) "+ " + Dinheiro.formatarReais(preco)
            else if (preco < 0.0) "- " + Dinheiro.formatarReais(-preco) else ""
            val nomeTexto = o.nome + (o.nota?.let { " ($it)" } ?: "")

            if (g.max == 1) {
                // Escolha única: a opção inteira é o botão, e tocar de novo desmarca.
                val botao = pecas.botao(
                    (if (qtd > 0) "✓ " else "") + nomeTexto + (if (precoTexto.isNotEmpty()) "   $precoTexto" else ""),
                    principal = false,
                    alturaDp = 56,
                    margemTopo = 6,
                ) {
                    val doGrupo = tela.escolhas.getOrPut(g.id) { LinkedHashMap() }
                    if ((doGrupo[o.nome] ?: 0) == 1) doGrupo.clear()
                    else { doGrupo.clear(); doGrupo[o.nome] = 1 }
                    atualizarOpcoes(tela)
                }
                botao.gravity = Gravity.START or Gravity.CENTER_VERTICAL
                if (qtd > 0) botao.background = pecas.fundoArredondado(R.color.destaque_apagado, R.color.destaque, 2)
                caixa.addView(botao)
            } else {
                val linha = pecas.linha().apply {
                    setPadding(0, pecas.dp(6), 0, 0)
                }
                val rotulo = pecas.coluna().apply {
                    layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
                }
                rotulo.addView(pecas.texto(nomeTexto, 17f, if (qtd > 0) R.color.texto else R.color.texto, negrito = qtd > 0))
                val detalhe = listOfNotNull(
                    precoTexto.ifEmpty { null },
                    o.maxPorItem?.takeIf { it < g.max }?.let { getString(R.string.garcom_maximo_da_opcao, it) },
                ).joinToString("  ·  ")
                if (detalhe.isNotEmpty()) rotulo.addView(pecas.texto(detalhe, 14f, R.color.texto_fraco))
                linha.addView(rotulo)

                linha.addView(pecas.botaoDeQuantidade("−") { mudarQuantidade(tela, g, o.nome, -1) }.also {
                    pecas.habilitar(it, qtd > 0)
                })
                linha.addView(pecas.texto(qtd.toString(), 20f, negrito = true, centralizado = true).apply {
                    layoutParams = LinearLayout.LayoutParams(pecas.dp(40), ViewGroup.LayoutParams.WRAP_CONTENT)
                })
                val tetoDaOpcao = o.maxPorItem ?: g.max
                linha.addView(pecas.botaoDeQuantidade("+") { mudarQuantidade(tela, g, o.nome, +1) }.also {
                    pecas.habilitar(it, total < g.max && qtd < tetoDaOpcao)
                })
                caixa.addView(linha)
            }
        }
        return caixa
    }

    /** ComboModal.tsx, `updateQty`: respeita o teto do grupo e o "Máx N" da opção. */
    private fun mudarQuantidade(tela: Tela.Opcoes, g: Grupo, nome: String, delta: Int) {
        val doGrupo = tela.escolhas.getOrPut(g.id) { LinkedHashMap() }
        val totalAtual = doGrupo.values.sum()
        val atual = doGrupo[nome] ?: 0
        val novo = atual + delta
        val tetoDaOpcao = g.opcoes.firstOrNull { it.nome == nome }?.maxPorItem ?: g.max
        if (novo < 0 || (delta > 0 && totalAtual >= g.max)) return
        if (delta > 0 && novo > tetoDaOpcao) return
        if (novo == 0) doGrupo.remove(nome) else doGrupo[nome] = novo
        atualizarOpcoes(tela)
    }

    private fun concluirOpcoes(tela: Tela.Opcoes) {
        limparBloqueadas(tela)
        val escolhidas = Cardapio.nomesEscolhidos(tela.escolhas)
        val naTela = tela.produto.grupos.filter { !grupoEscondido(it, escolhidas) }
        val pendente = naTela.firstOrNull { !grupoCompleto(tela, it) }
        if (pendente != null) {
            tela.tentouConcluir = true
            atualizarOpcoes(tela)
            avisar(getString(R.string.garcom_falta_escolher, pendente.titulo))
            viewsDosGrupos[pendente.id]?.let { v -> rolagem.post { rolagem.smoothScrollTo(0, maxOf(0, v.top - pecas.dp(8))) } }
            return
        }

        // A lista [{name, quantity}] que o MesasApp monta a partir do
        // { grupoId: { nome: qtd } } do modal — só o que foi escolhido.
        val lista = ArrayList<Pair<String, Int>>()
        for (g in tela.produto.grupos) {
            if (grupoEscondido(g, escolhidas)) continue
            tela.escolhas[g.id]?.forEach { (nome, qtd) -> if (qtd > 0) lista += nome to qtd }
        }
        val obs = tela.observacao.trim().ifEmpty { null }
        val unitario = Cardapio.precoUnitario(tela.produto, tela.escolhas)

        val carrinho = carrinhos.getOrPut(tela.mesa.sessaoId) { ArrayList() }
        val igual = if (lista.isEmpty() && obs == null) {
            carrinho.firstOrNull { it.produto.id == tela.produto.id && it.escolhas.isEmpty() && it.observacao == null }
        } else null
        if (igual != null) igual.quantidade = minOf(99, igual.quantidade + tela.quantidade)
        else carrinho.add(ItemDoCarrinho(tela.produto, tela.quantidade, lista, unitario, obs))

        informar(getString(R.string.garcom_adicionado, tela.quantidade, tela.produto.nome))
        voltar()
    }

    // ============================================================= CARRINHO

    private fun telaDoCarrinho(tela: Tela.Carrinho) {
        val mesa = tela.mesa
        titulo(getString(R.string.garcom_pedido_da, nomeDaMesa(mesa)))
        val itens = carrinhos.getOrPut(mesa.sessaoId) { ArrayList() }

        if (itens.isEmpty()) {
            conteudo.addView(pecas.texto(getString(R.string.garcom_carrinho_vazio), 18f, R.color.texto_fraco, centralizado = true, margemTopo = 24))
            noRodape(pecas.botao(getString(R.string.garcom_lancar_itens)) { trocarPor(Tela.Categorias(mesa)) })
            return
        }

        for (item in itens.toList()) {
            val caixa = pecas.cartao(margemTopo = 8)
            caixa.addView(
                pecas.linhaDeValor(
                    item.quantidade.toString() + "× " + item.produto.nome,
                    Dinheiro.formatar(Dinheiro.centavos(item.unitario) * item.quantidade),
                ),
            )
            item.escolhas.forEach { (nome, qtd) ->
                caixa.addView(pecas.texto("   " + qtd + "× " + nome, 15f, R.color.texto_fraco))
            }
            item.observacao?.let { caixa.addView(pecas.texto(getString(R.string.garcom_obs, it), 15f, R.color.atencao)) }

            val linha = pecas.linha().apply { setPadding(0, pecas.dp(6), 0, 0) }
            linha.addView(pecas.botaoDeQuantidade("−") {
                if (item.quantidade > 1) item.quantidade-- else itens.remove(item)
                mostrar(tela)
            })
            linha.addView(pecas.texto(item.quantidade.toString(), 20f, negrito = true, centralizado = true).apply {
                layoutParams = LinearLayout.LayoutParams(pecas.dp(48), ViewGroup.LayoutParams.WRAP_CONTENT)
            })
            linha.addView(pecas.botaoDeQuantidade("+") {
                if (item.quantidade < 99) item.quantidade++
                mostrar(tela)
            })
            linha.addView(View(this).apply { layoutParams = LinearLayout.LayoutParams(0, 1, 1f) })
            linha.addView(pecas.botao(getString(R.string.garcom_remover), principal = false, alturaDp = 52, margemTopo = 0) {
                itens.remove(item)
                mostrar(tela)
            }.apply {
                layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            })
            caixa.addView(linha)
            conteudo.addView(caixa)
        }

        val estimado = itens.sumOf { Dinheiro.centavos(it.unitario) * it.quantidade }
        conteudo.addView(pecas.cartao().apply {
            addView(pecas.linhaDeValor(getString(R.string.garcom_total_estimado), Dinheiro.formatar(estimado), grande = true))
            addView(pecas.texto(getString(R.string.garcom_total_estimado_dica), 13f, R.color.texto_fraco))
        })

        noRodape(
            pecas.botao(getString(R.string.garcom_enviar_pedido)) { enviarPedido(tela) },
            pecas.botao(getString(R.string.garcom_mais_itens), principal = false, alturaDp = 52) {
                trocarPor(Tela.Categorias(mesa))
            },
        )
    }

    /**
     * POST /api/store/table-sessions/[id]/add-order com o MESMO corpo do
     * MesasApp. O preço vai junto por compatibilidade, mas quem decide é o
     * servidor (lib/lancar-na-mesa.ts recalcula pelo canal salão); o total
     * mostrado depois é o que ele devolveu.
     */
    private fun enviarPedido(tela: Tela.Carrinho) {
        val itens = carrinhos[tela.mesa.sessaoId].orEmpty()
        if (itens.isEmpty()) return
        val corpo = JSONObject().put("items", JSONArray().apply {
            for (item in itens) {
                put(JSONObject().apply {
                    put("menuProductId", item.produto.id)
                    put("quantity", item.quantidade)
                    put("price", item.unitario)
                    if (item.escolhas.isEmpty()) {
                        put("comboSelections", JSONObject.NULL)
                    } else {
                        val lista = JSONArray()
                        item.escolhas.forEach { (nome, qtd) -> lista.put(JSONObject().put("name", nome).put("quantity", qtd)) }
                        // String com o JSON dentro, como o MesasApp manda.
                        put("comboSelections", lista.toString())
                    }
                    put("tableGuestId", JSONObject.NULL)
                    put("notes", item.observacao ?: JSONObject.NULL)
                })
            }
        })

        val caminho = "/api/store/table-sessions/" + ApiDoGarcom.codificar(tela.mesa.sessaoId) + "/add-order"
        chamar(getString(R.string.garcom_enviando_pedido), { c -> ApiDoGarcom.post(caminho, corpo, c) }) { ok ->
            carrinhos.remove(tela.mesa.sessaoId)
            val total = ok.json?.optJSONObject("order")?.let { numero(it, "totalAmount") }
            informar(
                if (total != null) getString(R.string.garcom_pedido_enviado_valor, Dinheiro.formatarReais(total))
                else getString(R.string.garcom_pedido_enviado),
            )
            voltarParaAMesa()
        }
    }

    // ================================================================ COBRAR

    private fun telaDeCobrar(tela: Tela.Cobrar) {
        titulo(getString(R.string.garcom_cobrar_titulo, nomeDaMesa(tela.mesa)))
        // A maquininha pode estar no degrau lento do polling (chip, loja
        // parada). Acordar agora faz o servidor vê-la viva antes do POST — a
        // rota recusa cobrança para maquininha calada há mais de 2 minutos.
        ServicoDeCobranca.acordar(this)

        conteudo.addView(pecas.linhaDeValor(getString(R.string.garcom_falta_pagar), Dinheiro.formatar(tela.falta), grande = true, corId = R.color.destaque))
        conteudo.addView(pecas.texto(getString(R.string.garcom_valor_a_cobrar), 15f, R.color.texto_fraco, negrito = true, margemTopo = 14))

        val campo = pecas.campo("0,00", InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL, maximo = 12)
        campo.keyListener = android.text.method.DigitsKeyListener.getInstance("0123456789,.")
        campo.setText(Dinheiro.paraCampo(tela.valorSugerido))
        campo.textSize = 28f
        conteudo.addView(campo)

        // Atalhos do MesasApp: tudo que falta, metade, um terço (arredondando
        // para baixo — o último paga o centavo que sobra).
        val atalhos = pecas.linha().apply { setPadding(0, pecas.dp(8), 0, 0) }
        fun atalho(rotulo: String, valor: Long, primeiro: Boolean) = pecas.botao(rotulo, principal = false, alturaDp = 56, margemTopo = 0) {
            campo.setText(Dinheiro.paraCampo(valor))
        }.apply {
            layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
                if (!primeiro) marginStart = pecas.dp(8)
            }
        }
        atalhos.addView(atalho(getString(R.string.garcom_atalho_tudo), tela.falta, true))
        atalhos.addView(atalho("÷ 2", tela.falta / 2, false))
        atalhos.addView(atalho("÷ 3", tela.falta / 3, false))
        conteudo.addView(atalhos)

        val rotulo = CofreDoToken.rotulo(this) ?: getString(R.string.operacao_sem_nome)
        conteudo.addView(pecas.texto(getString(R.string.garcom_cobra_nesta, rotulo), 15f, R.color.texto_fraco, margemTopo = 16))

        noRodape(pecas.botao(getString(R.string.garcom_cobrar_agora)) {
            val valor = Dinheiro.lerCampo(campo.text.toString())
            when {
                valor == null -> avisar(getString(R.string.garcom_valor_invalido))
                valor < VALOR_MINIMO -> avisar(getString(R.string.garcom_valor_minimo))
                valor > tela.falta -> AlertDialog.Builder(this)
                    .setTitle(R.string.garcom_valor_maior_titulo)
                    .setMessage(getString(R.string.garcom_valor_maior_texto, Dinheiro.formatar(valor), Dinheiro.formatar(tela.falta)))
                    .setNegativeButton(R.string.garcom_nao, null)
                    .setPositiveButton(R.string.garcom_cobrar_mesmo_assim) { _, _ -> mandarCobranca(tela, valor, tentarDeNovo = true) }
                    .show()
                else -> mandarCobranca(tela, valor, tentarDeNovo = true)
            }
        })
    }

    /**
     * Manda a cobrança para a fila, endereçada a esta maquininha, e acorda o
     * serviço. NÃO há outro caminho de pagamento: o serviço pega da fila em
     * segundos e cobra pelo caminho de sempre.
     */
    private fun mandarCobranca(tela: Tela.Cobrar, valor: Long, tentarDeNovo: Boolean) {
        esconderTeclado()
        val terminalId = CofreDoToken.terminalId(this)
        if (terminalId == null) {
            ServicoDeCobranca.acordar(this)
            avisar(getString(R.string.garcom_sem_terminal_id))
            return
        }
        val corpo = JSONObject().put("valor", Dinheiro.reais(valor)).put("terminalId", terminalId)
        val caminho = "/api/store/table-sessions/" + ApiDoGarcom.codificar(tela.mesa.sessaoId) + "/maquininha"
        chamar(getString(R.string.garcom_mandando_cobranca), { c -> ApiDoGarcom.post(caminho, corpo, c) }, seRecusada = { r ->
            when (r.codigo) {
                "TERMINAL_OFFLINE" -> if (tentarDeNovo) {
                    // O servidor não viu esta maquininha nos últimos 2 minutos
                    // (polling no degrau lento). Acorda, espera uma volta e
                    // tenta UMA vez de novo.
                    ServicoDeCobranca.acordar(this)
                    mostrarCarregando(getString(R.string.garcom_acordando_maquininha))
                    val minha = geracao
                    principal.postDelayed({
                        if (minha == geracao && !isFinishing) mandarCobranca(tela, valor, tentarDeNovo = false)
                    }, ESPERA_PARA_REENVIAR_MS)
                    true
                } else false
                "COBRANCA_EM_ANDAMENTO" -> {
                    voltarParaAMesa()
                    avisar(r.mensagem)
                    true
                }
                else -> false
            }
        }) { ok ->
            val cobranca = ok.json?.optJSONObject("cobranca")
            val id = cobranca?.let { texto(it, "id") }
            if (id == null) {
                avisar(getString(R.string.garcom_resposta_estranha))
                return@chamar
            }
            // A tela de cobrança vai abrir por cima desta; no fim, volta.
            ModoGarcom.voltarAoGarcom = true
            ServicoDeCobranca.acordar(this)
            trocarPor(Tela.Acompanhando(tela.mesa, id, valor))
        }
    }

    // ========================================================== ACOMPANHAR

    private fun telaDeAcompanhar(tela: Tela.Acompanhando) {
        titulo(getString(R.string.garcom_cobrando_titulo, nomeDaMesa(tela.mesa)))
        conteudo.addView(pecas.texto(Dinheiro.formatar(tela.valor), 44f, R.color.destaque, negrito = true, centralizado = true, margemTopo = 24))
        val status = pecas.texto(getString(R.string.garcom_status_aguardando), 20f, negrito = true, centralizado = true, margemTopo = 16)
        val detalhe = pecas.texto(getString(R.string.garcom_status_dica), 16f, R.color.texto_fraco, centralizado = true, margemTopo = 10)
        conteudo.addView(status)
        conteudo.addView(detalhe)
        consultarCobranca(tela, status, detalhe)
    }

    private fun consultarCobranca(tela: Tela.Acompanhando, status: TextView, detalhe: TextView) {
        val c = cookie() ?: return sessaoExpirou(null)
        val minha = geracao
        val caminho = "/api/store/table-sessions/" + ApiDoGarcom.codificar(tela.mesa.sessaoId) + "/maquininha"
        emSegundoPlano(null, { ApiDoGarcom.get(caminho, c) }) { r ->
            when (r) {
                is ApiDoGarcom.Resposta.SessaoExpirada -> return@emSegundoPlano sessaoExpirou(r.mensagem)
                is ApiDoGarcom.Resposta.Ok -> {
                    val lista = r.json?.optJSONArray("cobrancas") ?: JSONArray()
                    val cb = (0 until lista.length()).mapNotNull { lista.optJSONObject(it) }
                        .firstOrNull { texto(it, "id") == tela.cobrancaId }
                    if (cb != null) desenharStatus(tela, cb, status, detalhe)
                }
                // Rede caída no meio: segue tentando, a cobrança está na fila.
                else -> detalhe.text = getString(R.string.garcom_status_sem_rede)
            }
            if (!tela.terminou && iniciada) {
                principal.postDelayed({
                    if (minha == geracao && iniciada && !isFinishing) consultarCobranca(tela, status, detalhe)
                }, INTERVALO_DE_CONSULTA_MS)
            }
        }
    }

    private fun desenharStatus(tela: Tela.Acompanhando, cb: JSONObject, status: TextView, detalhe: TextView) {
        rodape.removeAllViews()
        rodape.visibility = View.GONE
        when (texto(cb, "status")) {
            "AGUARDANDO_TERMINAL" -> {
                status.text = getString(R.string.garcom_status_aguardando)
                status.setTextColor(pecas.cor(R.color.texto))
                detalhe.text = getString(R.string.garcom_status_dica)
                // Só dá para cancelar daqui enquanto a maquininha não pegou:
                // depois disso quem cancela é o cliente, na tela do cartão.
                noRodape(pecas.botao(getString(R.string.garcom_cancelar_cobranca), principal = false) { cancelarCobranca(tela) })
            }
            "NO_TERMINAL" -> {
                status.text = getString(R.string.garcom_status_no_terminal)
                status.setTextColor(pecas.cor(R.color.texto))
                detalhe.text = getString(R.string.garcom_status_no_terminal_dica)
            }
            "PAGO" -> {
                tela.terminou = true
                status.text = getString(R.string.garcom_status_pago)
                status.setTextColor(pecas.cor(R.color.aprovado))
                detalhe.text = texto(cb, "bandeira") ?: ""
                val minha = geracao
                principal.postDelayed({ if (minha == geracao) voltarParaAMesa() }, MOSTRAR_APROVADO_MS)
                noRodape(pecas.botao(getString(R.string.garcom_voltar_a_mesa)) { voltarParaAMesa() })
            }
            "RECUSADO", "CANCELADO", "EXPIRADO" -> {
                tela.terminou = true
                val recusado = texto(cb, "status") == "RECUSADO"
                status.text = getString(if (recusado) R.string.garcom_status_recusado else R.string.garcom_status_cancelado)
                status.setTextColor(pecas.cor(R.color.recusado))
                detalhe.text = texto(cb, "motivo") ?: ""
                noRodape(
                    pecas.botao(getString(R.string.garcom_tentar_de_novo)) {
                        // Recusa na mesa não volta para a fila sozinha: o garçom
                        // decide se manda de novo (lib/cobranca-da-mesa-na-maquininha.ts).
                        trocarPor(Tela.Cobrar(tela.mesa, tela.valor, tela.valor))
                    },
                    pecas.botao(getString(R.string.garcom_voltar_a_mesa), principal = false) { voltarParaAMesa() },
                )
            }
        }
    }

    private fun cancelarCobranca(tela: Tela.Acompanhando) {
        val caminho = "/api/store/table-sessions/" + ApiDoGarcom.codificar(tela.mesa.sessaoId) +
            "/maquininha?cobranca=" + ApiDoGarcom.codificar(tela.cobrancaId)
        chamar(getString(R.string.garcom_cancelando), { c -> ApiDoGarcom.delete(caminho, c) }) {
            tela.terminou = true
            ModoGarcom.voltarAoGarcom = false
            informar(getString(R.string.garcom_cobranca_cancelada))
            voltarParaAMesa()
        }
    }

    private companion object {
        const val COLUNAS_DE_MESA = 3
        const val VALOR_MINIMO = 100L
        const val INTERVALO_DE_CONSULTA_MS = 2_000L
        const val MOSTRAR_APROVADO_MS = 2_500L
        const val ESPERA_PARA_REENVIAR_MS = 4_000L
        val STATUS_VIVOS = setOf("AGUARDANDO_TERMINAL", "NO_TERMINAL")
    }
}
