async function test() {
  try {
    const res = await fetch("https://firehubfood.com.br/api/webhook/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "MESSAGES_UPSERT",
        instance: "firehub_f0sb0qk5vr",
        data: {
          key: { remoteJid: "5522998851680@s.whatsapp.net", fromMe: false },
          message: { conversation: "vocês tão abertos agora?" }
        }
      })
    });
    const data = await res.json();
    console.log("Resultado do Teste de Mensagem do Cliente:", data);
  } catch (err) {
    console.error("Erro no teste:", err.message);
  }
}

test();
