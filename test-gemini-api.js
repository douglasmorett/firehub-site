const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_API_KEY || process.env.VITE_GEMINI_API_KEY;

async function testGemini() {
  console.log("Chave encontrada?", !!key);
  if (!key) return;

  const models = ["gemini-2.5-flash", "gemini-1.5-flash", "gemini-2.0-flash"];
  for (const m of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: "Oi! Você é o atendente Hakim?" }] }]
        })
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`✅ Modelo ${m} FUNCIONOU! Resposta:`, data.candidates?.[0]?.content?.parts?.[0]?.text);
        return;
      } else {
        const errText = await res.text();
        console.log(`❌ Modelo ${m} Erro ${res.status}:`, errText.slice(0, 150));
      }
    } catch (err) {
      console.log(`❌ Erro no modelo ${m}:`, err.message);
    }
  }
}

testGemini();
