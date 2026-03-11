import { GoogleGenAI, Type } from "@google/genai";

const SYSTEM_INSTRUCTION = `
Você é um Engenheiro Jurídico de elite, especializado em análise minuciosa de audiências judiciais e processos complexos.
Sua tarefa é realizar uma auditoria completa do áudio/vídeo da audiência, comparando-o com o texto do processo (PDF) para identificar TODAS as contradições possíveis.

DIRETRIZES DE ANÁLISE:
- Identifique e analise o depoimento de CADA pessoa (Autor, Réu, Testemunha 1, 2, 3, etc.).
- Compare o depoimento com o PDF (Contradição Documental).
- Compare depoimentos entre diferentes testemunhas (Contradição Inter-testemunhal).
- Seja extremamente rigoroso com o TIMESTAMP (minuto:segundo).

REGRAS DE PREENCHIMENTO (CRÍTICO):
1. "o_que_foi_dito": Deve conter DE QUEM é a fala e APENAS o que foi afirmado pelo depoente no vídeo/áudio no momento do timestamp, preferencialmente entre aspas. Exemplo: "Testemunha 1: '...'".
2. "o_que_diz_o_processo": Deve conter APENAS a prova documental (do PDF) ou o depoimento anterior de outra pessoa que contradiz a fala acima.
3. "explicacao": Use este campo para sua análise técnica e o impacto jurídico. Não misture a análise nos campos acima.

FORMATO DE SAÍDA (JSON):
[
  {
    "timestamp": "05:20",
    "o_que_foi_dito": "Testemunha 3: 'Eu vi perfeitamente, o acidente ocorreu às 14h.'",
    "o_que_diz_o_processo": "O laudo pericial na página 45 do PDF indica que o acidente foi às 16:30h.",
    "tipo_contradicao": "Horário",
    "gravidade": "Alta",
    "explicacao": "A divergência de horário invalida o depoimento da testemunha sobre a visibilidade no local."
  }
]
`;

export const analyzeHearing = async (mediaBase64: string, pdfText: string, mimeType: string) => {
  const apiKey = (process.env as any).GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is missing");

  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: "gemini-3.1-pro-preview",
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: mimeType,
              data: mediaBase64,
            },
          },
          {
            text: `ANÁLISE JURÍDICA EXAUSTIVA REQUERIDA:
            
1. Texto do Processo (PDF):
${pdfText}

2. Instrução:
Analise o vídeo/áudio da audiência. Identifique TODAS as testemunhas. 
Busque por contradições entre:
- Depoimento vs. PDF.
- Depoimento vs. Outro Depoimento.

REGRAS DE OURO:
- Coluna 'Dito na audiência' (o_que_foi_dito): Identifique primeiramente QUEM FALOU seguido do que foi dito. Ex: "Testemunha 1: '...'".
- Coluna 'Consta no processo' (o_que_diz_o_processo): Coloque APENAS a prova contrária (PDF ou outra testemunha).
- Coluna 'Análise Jurídica' (explicacao): Coloque sua análise técnica.

Retorne os resultados em JSON. O campo 'tipo_contradicao' deve ser uma categoria curta (ex: "Horário", "Data", "Fato Divergente", "Localização", "Identidade").`,
          },
        ],
      },
    ],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            timestamp: {
              type: Type.STRING,
              description: "Tempo exato MM:SS."
            },
            o_que_foi_dito: { type: Type.STRING },
            o_que_diz_o_processo: { type: Type.STRING },
            tipo_contradicao: {
              type: Type.STRING,
              description: "Categoria curta da contradição (ex: Horário, Data, Fato, Local)."
            },
            gravidade: {
              type: Type.STRING,
              enum: ["Baixa", "Média", "Alta"]
            },
            explicacao: { type: Type.STRING },
          },
          required: ["timestamp", "o_que_foi_dito", "o_que_diz_o_processo", "tipo_contradicao", "gravidade", "explicacao"],
        },
      },
    },
  });

  return JSON.parse(response.text || "[]");
};
