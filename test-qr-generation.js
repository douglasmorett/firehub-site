async function testQR() {
  try {
    const res = await fetch("http://localhost:8080/instance/connect/firehub_test");
    console.log("Status:", res.status);
    const data = await res.json();
    console.log("QR Code recebido:", Boolean(data.base64 || data.code));
    if (data.code || data.base64) {
      console.log("QR Code Base64 preview:", (data.code || data.base64).slice(0, 50));
    }
  } catch (e) {
    console.error("Erro ao conectar no gateway local:", e.message);
  }
}

testQR();
