package br.com.firehub.maquininha.servico

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.os.Looper
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import br.com.firehub.maquininha.R
import br.com.firehub.maquininha.motoboy.ApiDoMotoboy
import br.com.firehub.maquininha.motoboy.CofreDoMotoboy
import java.util.concurrent.Executors

/**
 * A localização do motoboy, pela maquininha que ele leva (app FireHub Motoboy).
 *
 * A mesma rota do app do celular (POST /api/motoboys/location, a cada 12 s),
 * mas no GPS da maquininha: o motoboy não desliga o GPS do próprio telefone
 * para "sumir" do mapa. Serviço em primeiro plano (aviso fixo) porque é o que o
 * Android deixa rodar com a tela apagada; sobe no login e no boot.
 */
class ServicoDeLocalizacao : Service(), LocationListener {

    private val envio = Executors.newSingleThreadExecutor()
    private var ultimoEnvio = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        criarCanal()
        val aviso = NotificationCompat.Builder(this, CANAL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle(getString(R.string.nome_do_app))
            .setContentText("Localização ligada: a loja vê você no mapa das entregas.")
            .setOngoing(true)
            .build()
        ServiceCompat.startForeground(
            this, AVISO, aviso,
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0,
        )

        if (CofreDoMotoboy.token(this) == null || !temPermissao(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        val gps = getSystemService(Context.LOCATION_SERVICE) as LocationManager
        try {
            gps.removeUpdates(this)
            for (provedor in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                if (gps.isProviderEnabled(provedor)) {
                    gps.requestLocationUpdates(provedor, INTERVALO_MS, 0f, this, Looper.getMainLooper())
                }
            }
        } catch (e: SecurityException) {
            Log.w(ETIQUETA, "Sem permissão de localização.", e)
            stopSelf()
        }
        return START_STICKY
    }

    override fun onLocationChanged(local: Location) {
        // GPS e rede chegam juntos: um envio a cada 12 s basta (o servidor
        // também limita a 20 por minuto).
        val agora = System.currentTimeMillis()
        if (agora - ultimoEnvio < INTERVALO_MS - 1_000) return
        ultimoEnvio = agora
        val token = CofreDoMotoboy.token(this) ?: run { stopSelf(); return }
        envio.execute {
            val r = ApiDoMotoboy.localizacao(token, local.latitude, local.longitude)
            if (r is ApiDoMotoboy.Resposta.SessaoExpirada) stopSelf()
        }
    }

    // LocationListener antigo (Android < 11) exige estes três.
    @Deprecated("API antiga do LocationListener")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}

    override fun onDestroy() {
        (getSystemService(Context.LOCATION_SERVICE) as LocationManager).removeUpdates(this)
        envio.shutdown()
        super.onDestroy()
    }

    private fun criarCanal() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val nm = getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CANAL) == null) {
            nm.createNotificationChannel(NotificationChannel(CANAL, "Localização", NotificationManager.IMPORTANCE_LOW))
        }
    }

    companion object {
        private const val ETIQUETA = "ServicoDeLocalizacao"
        private const val CANAL = "localizacao"
        private const val AVISO = 4207
        private const val INTERVALO_MS = 12_000L

        fun temPermissao(context: Context): Boolean =
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

        fun ligar(context: Context) {
            if (CofreDoMotoboy.token(context) == null || !temPermissao(context)) return
            ContextCompat.startForegroundService(context, Intent(context, ServicoDeLocalizacao::class.java))
        }

        fun desligar(context: Context) {
            context.stopService(Intent(context, ServicoDeLocalizacao::class.java))
        }
    }
}
