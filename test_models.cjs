const https = require('https');
require('dotenv').config();

const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

if (!apiKey) {
  console.error("API Key não encontrada no .env");
  process.exit(1);
}

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

https.get(url, (res) => {
  let data = '';
  res.on('data', (chunk) => { data += chunk; });
  res.on('end', () => {
    try {
      const json = JSON.parse(data);
      if (json.models) {
        console.log("Modelos Disponíveis:");
        json.models.forEach(m => console.log(`- ${m.name}`));
      } else {
        console.log("Resposta inesperada:", data);
      }
    } catch (e) {
      console.error("Erro ao processar JSON:", e.message);
      console.log("Raw data:", data);
    }
  });
}).on('error', (err) => {
  console.error("Erro na requisição:", err.message);
});
