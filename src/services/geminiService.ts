import { GoogleGenAI, Type } from "@google/genai";

const SYSTEM_INSTRUCTION = `
Você é um Engenheiro Jurídico de elite, especializado em análise minuciosa de audiências judiciais e processos complexos.
Sua tarefa é realizar uma auditoria completa do áudio/vídeo da audiência, comparando-o com o texto do processo (PDF) para identificar TODAS as contradições possíveis e fornecer uma síntese conclusiva.

DIRETRIZES DE ANÁLISE:
- Identifique e analise o depoimento de CADA pessoa (Autor, Réu, Testemunha 1, 2, 3, etc.).
- Compare o depoimento com o PDF (Contradição Documental).
- Compare depoimentos entre diferentes testemunhas (Contradição Inter-testemunhal).
- Seja extremamente rigoroso com o TIMESTAMP (minuto:segundo).

REGRAS DE PREENCHIMENTO (CRÍTICO):
1. "resumo_executivo": Forneça um parágrafo conciso resumindo as principais constatações da análise panorâmica do processo.
2. "analise_tendencia": Escreva uma frase ou pequeno parágrafo apontando a tendência geral da prova oral (ex: depoimento confiável, testemunha fragilizada, provas robustas a favor do autor, etc.).
3. Para cada item na lista de "contradicoes":
   - "o_que_foi_dito": Deve conter DE QUEM é a fala e APENAS o que foi afirmado no vídeo/áudio no timestamp, preferencialmente entre aspas. Exemplo: "Testemunha 1: '...'".
   - "o_que_diz_o_processo": Deve conter APENAS a prova documental (PDF) ou depoimento anterior que contradiz a fala acima.
   - "explicacao": Use este cenário para sua análise técnica e o impacto jurídico. Não misture análise nos campos acima.
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

GERAÇÃO DE IMPACTO: Crie também o Resumo Executivo e a Análise de Tendências.

REGRAS DE OURO DA LISTA:
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
        type: Type.OBJECT,
        properties: {
          resumo_executivo: {
            type: Type.STRING,
            description: "Resumo panorâmico das constatações da análise."
          },
          analise_tendencia: {
            type: Type.STRING,
            description: "Tendência geral da prova oral e o grau de confiabilidade das testemunhas."
          },
          contradicoes: {
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
          }
        },
        required: ["resumo_executivo", "analise_tendencia", "contradicoes"],
      },
    },
  });

  return JSON.parse(response.text || "{}");
};
