const API_KEY = Deno.env.get("GEMINI_API_KEY");
if (!API_KEY) {
  console.error("ERRO: GEMINI_API_KEY não definida!");
  Deno.exit(1);
}

const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${API_KEY}`;

try {
  const response = await fetch(url);
  const data = await response.json();
  if (data.models) {
    console.log("Modelos Disponíveis:");
    data.models.forEach((m: any) => {
      console.log(`- ${m.name} (${m.supportedGenerationMethods.join(', ')})`);
    });
  } else {
    console.error("Resposta inesperada:", JSON.stringify(data, null, 2));
  }
} catch (e: any) {
  console.error("Erro ao listar modelos:", e.message);
}
