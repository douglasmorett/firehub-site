package br.com.firehub.maquininha.tela

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.FrameLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import br.com.firehub.maquininha.CofreDoToken
import br.com.firehub.maquininha.R
import br.com.firehub.maquininha.TrabalhoDeTela
import br.com.firehub.maquininha.estado.EstadoDoTerminal
import br.com.firehub.maquininha.fila.FilaDeResultados
import br.com.firehub.maquininha.pagamento.PagamentoNaMaquininha
import br.com.firehub.maquininha.rede.TipoDePagamento
import br.com.firehub.maquininha.servico.ServicoDeCobranca

/**
 * A tela que fica ligada o dia inteiro.
 *
 * Ela não decide nada: quem conduz a cobrança é o serviço, e esta Activity só
 * desenha a situação publicada e devolve os toques do cliente. Essa separação é
 * o que permite o operador sair do app sem a loja parar de receber pedido.
 */
class OperacaoActivity : AppCompatActivity() {

    private lateinit var raiz: FrameLayout
    private lateinit var txtTerminal: TextView
    private lateinit var txtRede: TextView
    private lateinit var txtTitulo: TextView
    private lateinit var txtValor: TextView
    private lateinit var txtDescricao: TextView
    private lateinit var txtAndamento: TextView
    private lateinit var painelEscolha: View

    /**
     * Desabilitar o painel não desabilita os botões: no Android, isEnabled num
     * ViewGroup não desce para os filhos. Sem a lista, o toque duplo do cliente
     * viraria duas escolhas para a mesma cobrança.
     */
    private lateinit var botoesDeForma: List<Button>
    private lateinit var botaoCancelar: Button
    private lateinit var botaoAcao: Button
    private lateinit var txtAvisos: TextView

    /**
     * Abrir a tela de pareamento (ou a de ativação) só uma vez por instância.
     *
     * Sem isto, o operador que voltasse dessas telas sem concluir cairia aqui,
     * seria mandado de volta em onStart, voltaria de novo, e assim por diante:
     * um laço do qual só se sai desligando o aparelho.
     */
    private var jaMandeiParear = false
    private var jaMandeiAtivar = false

    /** Pedir a permissão de notificação uma vez por instância, não a cada volta. */
    private var jaPediNotificacao = false

    private val ouvinte = EstadoDoTerminal.Ouvinte { situacao -> desenhar(situacao) }

    override fun onCreate(estadoSalvo: Bundle?) {
        super.onCreate(estadoSalvo)
        setContentView(R.layout.activity_operacao)

        raiz = findViewById(R.id.raiz)
        txtTerminal = findViewById(R.id.txtTerminal)
        txtRede = findViewById(R.id.txtRede)
        txtTitulo = findViewById(R.id.txtTitulo)
        txtValor = findViewById(R.id.txtValor)
        txtDescricao = findViewById(R.id.txtDescricao)
        txtAndamento = findViewById(R.id.txtAndamento)
        painelEscolha = findViewById(R.id.painelEscolha)
        botaoCancelar = findViewById(R.id.botaoCancelar)
        botaoAcao = findViewById(R.id.botaoAcao)
        txtAvisos = findViewById(R.id.txtAvisos)

        val credito = findViewById<Button>(R.id.botaoCredito)
        val debito = findViewById<Button>(R.id.botaoDebito)
        val voucher = findViewById<Button>(R.id.botaoVoucher)
        botoesDeForma = listOf(credito, debito, voucher)

        credito.setOnClickListener { escolher(TipoDePagamento.CREDITO) }
        debito.setOnClickListener { escolher(TipoDePagamento.DEBITO) }
        voucher.setOnClickListener { escolher(TipoDePagamento.VOUCHER) }
        botaoCancelar.setOnClickListener { cancelar() }

        // A lista de pagamentos que precisam de atenção não se limpa sozinha, e
        // um alerta que fica na tela para sempre é um alerta que o operador
        // aprende a não ler — junto com o contador de pagamentos ainda não
        // confirmados, que mora na mesma área e importa muito.
        //
        // Toque longo, e não toque simples: este canto da tela fica logo abaixo
        // dos botões de forma de pagamento, e um toque solto não pode apagar o
        // registro de um cartão que ninguém conferiu ainda.
        txtAvisos.setOnLongClickListener {
            perguntarSeJaResolveu()
            true
        }

        // A maquininha vive na tomada e precisa estar legível quando o cliente
        // chega. Tela apagada no meio de uma cobrança é o cliente achando que a
        // maquininha travou.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            // Faz a tela de cobrança aparecer mesmo com o aparelho bloqueado,
            // que é como ele fica depois de alguns minutos parado.
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        }

        desenhar(EstadoDoTerminal.situacao)
    }

    override fun onStart() {
        super.onStart()
        EstadoDoTerminal.observar(ouvinte)

        if (!CofreDoToken.estaPareada(this)) {
            mandarParear()
            return
        }

        pedirPermissaoDeNotificacao()

        // ligar() sobe o serviço se ele não estiver de pé; acordar() faz o laço
        // perguntar agora em vez de esperar o intervalo. Se a tela foi aberta, é
        // porque tem gente esperando alguma coisa.
        ServicoDeCobranca.ligar(this)
        ServicoDeCobranca.acordar(this)
    }

    /**
     * Da API 33 em diante a notificação depende de consentimento — e sem ela não
     * é só a barra de status que fica vazia: o aviso de cobrança chegando é
     * justamente o que traz esta tela para a frente quando o operador está em
     * outro app. Notificação bloqueada é pedido chegando sem ninguém ver.
     *
     * Os terminais de hoje param no Android 11 e nem chegam aqui. Isto é para o
     * dia em que o parque atualizar, e é pedido uma vez só: um diálogo de
     * permissão reaparecendo num aparelho de balcão é pior do que o problema.
     */
    private fun pedirPermissaoDeNotificacao() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
        if (jaPediNotificacao) return
        val concedida = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.POST_NOTIFICATIONS,
        ) == PackageManager.PERMISSION_GRANTED
        if (concedida) return

        jaPediNotificacao = true
        ActivityCompat.requestPermissions(
            this,
            arrayOf(Manifest.permission.POST_NOTIFICATIONS),
            PEDIDO_DE_NOTIFICACAO,
        )
    }

    /**
     * Apaga a lista de pagamentos que precisam de atenção.
     *
     * A confirmação existe porque o que está nessa lista é sempre cartão: ou um
     * resultado que o servidor recusou em definitivo, ou uma transação que a
     * maquininha nunca confirmou. Apagar sem conferir é perder o rastro de
     * dinheiro que já saiu da conta de alguém.
     */
    private fun perguntarSeJaResolveu() {
        if (EstadoDoTerminal.resultadosTravados <= 0) return

        AlertDialog.Builder(this)
            .setTitle(R.string.operacao_limpar_titulo)
            .setMessage(R.string.operacao_limpar_texto)
            .setNegativeButton(R.string.operacao_limpar_nao, null)
            .setPositiveButton(R.string.operacao_limpar_sim) { _, _ ->
                // Disco fora da thread principal, como todo o resto.
                TrabalhoDeTela.fazer(
                    tarefa = { FilaDeResultados(this).limparTravados() },
                    aoTerminar = { ServicoDeCobranca.acordar(this) },
                )
            }
            .show()
    }

    override fun onStop() {
        EstadoDoTerminal.deixarDeObservar(ouvinte)
        super.onStop()
    }

    private fun escolher(tipo: TipoDePagamento) {
        EstadoDoTerminal.escolher(EstadoDoTerminal.Escolha.Forma(tipo))
        // A tela não muda sozinha: quem publica "Cobrando" é o serviço, depois
        // de a thread dele acordar com a escolha. Desabilitar os botões aqui
        // evita o toque duplo virar duas escolhas.
        botoesDeForma.forEach { botao -> botao.isEnabled = false }
    }

    private fun cancelar() {
        when (EstadoDoTerminal.situacao) {
            is EstadoDoTerminal.Situacao.Escolhendo ->
                EstadoDoTerminal.escolher(EstadoDoTerminal.Escolha.Cancelar)

            is EstadoDoTerminal.Situacao.Cobrando -> {
                // A transação já está no pinpad. abort() pede para o terminal
                // interromper, mas NÃO devolve o controle: o doPayment lá no
                // serviço continua bloqueado e vai retornar do jeito dele. Quem
                // registra o resultado continua sendo o serviço.
                botaoCancelar.isEnabled = false
                TrabalhoDeTela.fazer(
                    tarefa = { PagamentoNaMaquininha.abortar() },
                    aoTerminar = { },
                )
            }

            else -> Unit
        }
    }

    private fun mandarParear() {
        if (jaMandeiParear) return
        jaMandeiParear = true
        startActivity(Intent(this, PareamentoActivity::class.java))
    }

    private fun mandarAtivar() {
        if (jaMandeiAtivar) return
        jaMandeiAtivar = true
        startActivity(Intent(this, AtivacaoActivity::class.java))
    }

    // --------------------------------------------------------------- desenho

    private fun desenhar(situacao: EstadoDoTerminal.Situacao) {
        // Todo desenho parte do mesmo ponto neutro. Sem isso, um campo que uma
        // situação mostrou continuaria na tela na situação seguinte — e o campo
        // teimoso mais perigoso aqui é o valor da compra anterior.
        esconderTudo()

        when (situacao) {
            is EstadoDoTerminal.Situacao.Ocioso -> desenharOcioso(situacao)
            is EstadoDoTerminal.Situacao.Escolhendo -> desenharEscolha(situacao)
            is EstadoDoTerminal.Situacao.Cobrando -> desenharCobranca(situacao)
            is EstadoDoTerminal.Situacao.Aprovado -> desenharAprovado(situacao)
            is EstadoDoTerminal.Situacao.Recusado -> desenharRecusado(situacao)

            is EstadoDoTerminal.Situacao.PrecisaParear -> {
                pintar(R.color.fundo, R.color.atencao)
                txtTitulo.text = situacao.mensagem
                botaoAcao.text = getString(R.string.operacao_parear)
                botaoAcao.visibility = View.VISIBLE
                botaoAcao.setOnClickListener { startActivity(Intent(this, PareamentoActivity::class.java)) }
                mandarParear()
            }

            is EstadoDoTerminal.Situacao.PrecisaAtivar -> {
                pintar(R.color.fundo, R.color.atencao)
                txtTitulo.text = situacao.mensagem
                botaoAcao.text = getString(R.string.operacao_ativar)
                botaoAcao.visibility = View.VISIBLE
                botaoAcao.setOnClickListener { startActivity(Intent(this, AtivacaoActivity::class.java)) }
                mandarAtivar()
            }

            is EstadoDoTerminal.Situacao.SemServicoDoPagBank -> {
                pintar(R.color.fundo, R.color.recusado)
                txtTitulo.text = situacao.mensagem
            }
        }

        desenharAvisos()
    }

    private fun desenharOcioso(situacao: EstadoDoTerminal.Situacao.Ocioso) {
        pintar(R.color.fundo, R.color.texto)
        txtTerminal.text = situacao.terminal
            ?: CofreDoToken.rotulo(this)
            ?: getString(R.string.operacao_sem_nome)
        txtRede.text = getString(
            if (situacao.conectado) R.string.operacao_conectado else R.string.operacao_desconectado,
        )
        txtRede.visibility = View.VISIBLE
        txtTitulo.text = getString(R.string.operacao_aguardando)

        situacao.detalhe?.let { detalhe ->
            txtAndamento.text = detalhe
            txtAndamento.visibility = View.VISIBLE
        }
    }

    private fun desenharEscolha(situacao: EstadoDoTerminal.Situacao.Escolhendo) {
        pintar(R.color.fundo, R.color.texto)
        txtTitulo.text = getString(R.string.operacao_escolha)
        mostrarValor(situacao.cobranca.valorFormatado(), descricaoDe(situacao))
        painelEscolha.visibility = View.VISIBLE
        botoesDeForma.forEach { botao -> botao.isEnabled = true }
        botaoCancelar.visibility = View.VISIBLE
        botaoCancelar.isEnabled = true
    }

    private fun desenharCobranca(situacao: EstadoDoTerminal.Situacao.Cobrando) {
        pintar(R.color.fundo, R.color.texto)
        txtTitulo.text = situacao.cobranca.descricao
        mostrarValor(situacao.cobranca.valorFormatado(), null)
        txtAndamento.text = situacao.andamento
        txtAndamento.visibility = View.VISIBLE
        botaoCancelar.visibility = View.VISIBLE
        botaoCancelar.isEnabled = true
    }

    private fun desenharAprovado(situacao: EstadoDoTerminal.Situacao.Aprovado) {
        pintar(R.color.fundo_aprovado, R.color.aprovado)
        txtTitulo.text = getString(R.string.operacao_aprovado)
        mostrarValor(
            situacao.cobranca.valorFormatado(),
            situacao.numeroDoPedido?.let { getString(R.string.operacao_senha, it) },
        )

        // Aprovado com resultado ainda preso na fila significa que o cartão
        // passou mas o FireHub ainda não sabe. Dizer isso é melhor do que
        // deixar o operador achar que o pedido já entrou na cozinha.
        if (EstadoDoTerminal.resultadosPresos > 0) {
            txtAndamento.text = getString(R.string.operacao_confirmando)
            txtAndamento.visibility = View.VISIBLE
        }
    }

    private fun desenharRecusado(situacao: EstadoDoTerminal.Situacao.Recusado) {
        pintar(R.color.fundo_recusado, R.color.recusado)
        txtTitulo.text = getString(R.string.operacao_recusado)
        mostrarValor(situacao.cobranca.valorFormatado(), null)
        situacao.motivo?.let { motivo ->
            txtAndamento.text = motivo
            txtAndamento.visibility = View.VISIBLE
        }
    }

    private fun descricaoDe(situacao: EstadoDoTerminal.Situacao.Escolhendo): String {
        val cobranca = situacao.cobranca
        val cliente = cobranca.cliente
        return if (cliente.isNullOrBlank()) cobranca.descricao
        else cobranca.descricao + " - " + cliente
    }

    private fun mostrarValor(valor: String, descricao: String?) {
        txtValor.text = valor
        txtValor.visibility = View.VISIBLE
        if (!descricao.isNullOrBlank()) {
            txtDescricao.text = descricao
            txtDescricao.visibility = View.VISIBLE
        }
    }

    private fun desenharAvisos() {
        val linhas = mutableListOf<String>()
        if (EstadoDoTerminal.resultadosPresos > 0) {
            linhas += getString(R.string.operacao_presos, EstadoDoTerminal.resultadosPresos)
        }
        if (EstadoDoTerminal.resultadosTravados > 0) {
            linhas += getString(R.string.operacao_travados, EstadoDoTerminal.resultadosTravados)
            // O contador sozinho não diz o que fazer. O motivo diz qual código
            // procurar no extrato do PagBank, ou qual pedido não pode ser
            // cobrado outra vez.
            EstadoDoTerminal.motivoDaAtencao?.let { linhas += it }
            linhas += getString(R.string.operacao_travados_dica)
        }
        // Recado sobre a fila: um pedido que ninguém pagou está sendo devolvido
        // sem parar e segura todo mundo atrás dele. Quem resolve é uma pessoa no
        // painel, então a tela precisa dizer qual pedido é.
        EstadoDoTerminal.avisoDaFila?.let { linhas += it }

        if (linhas.isEmpty()) {
            txtAvisos.visibility = View.GONE
        } else {
            txtAvisos.text = linhas.joinToString("\n")
            txtAvisos.visibility = View.VISIBLE
        }
    }

    private fun pintar(corDoFundo: Int, corDoTitulo: Int) {
        raiz.setBackgroundColor(ContextCompat.getColor(this, corDoFundo))
        txtTitulo.setTextColor(ContextCompat.getColor(this, corDoTitulo))
    }

    private companion object {
        /** Código do pedido de POST_NOTIFICATIONS. Só precisa ser único aqui. */
        const val PEDIDO_DE_NOTIFICACAO = 91
    }

    private fun esconderTudo() {
        txtRede.visibility = View.GONE
        txtValor.visibility = View.GONE
        txtDescricao.visibility = View.GONE
        txtAndamento.visibility = View.GONE
        painelEscolha.visibility = View.GONE
        botaoCancelar.visibility = View.GONE
        botaoAcao.visibility = View.GONE
        txtAvisos.visibility = View.GONE
        txtTitulo.text = getString(R.string.operacao_verificando)
        txtTerminal.text = CofreDoToken.rotulo(this) ?: getString(R.string.operacao_sem_nome)
    }
}
