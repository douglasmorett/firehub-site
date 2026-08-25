# O release nao usa minify (ver build.gradle.kts), entao este arquivo so vale se
# alguem ligar isMinifyEnabled algum dia. As regras abaixo existem para que esse
# dia nao termine com a maquininha sem cobrar.

# O WrapperPPS conversa com o servico do PagBank por AIDL e resolve parte das
# classes de resultado pelo nome. Ofuscar qualquer coisa dentro deste pacote
# quebra a cobranca em runtime, nao em tempo de build.
-keep class br.com.uol.pagseguro.** { *; }
-dontwarn br.com.uol.pagseguro.**

# O POM do wrapper nao declara RxJava, mas o bytecode de asyncplugpag referencia.
# Este app nao usa os metodos doAsync*, entao as classes nao existem no APK e o
# R8 reclamaria de referencia faltando sem este dontwarn.
-dontwarn io.reactivex.**

# Tink, usado por baixo do EncryptedSharedPreferences para guardar o token.
-keep class com.google.crypto.tink.** { *; }
-dontwarn com.google.crypto.tink.**
