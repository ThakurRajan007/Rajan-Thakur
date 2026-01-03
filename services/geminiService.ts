
import { GoogleGenAI, Type } from "@google/genai";
import { SessionResult } from "../types";

export const searchTechnologies = async (query: string): Promise<string[]> => {
  if (!query || query.length < 2) return [];
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `List 5 popular or relevant technology names for career interviews that start with or match: "${query}". Return only a JSON array of strings.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: { type: Type.STRING }
      }
    }
  });
  try {
    return JSON.parse(response.text || '[]');
  } catch {
    return [];
  }
};

export const getPrepExplanation = async (topic: string, query: string) => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `Technology: ${topic}\nFocus: ${query}\nExplain this technology like a world-class expert mentor. Be structured, colorful, and include key interview buzzwords.`,
  });
  return response.text;
};

export const generateSessionFeedback = async (history: string[]): Promise<SessionResult> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-pro-preview',
    contents: `Analyze this career interview transcript and provide feedback:\n${history.join('\n')}`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          score: { type: Type.NUMBER },
          strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
          weaknesses: { type: Type.ARRAY, items: { type: Type.STRING } },
          improvementPlan: { type: Type.STRING }
        },
        required: ["score", "strengths", "weaknesses", "improvementPlan"]
      }
    }
  });
  return JSON.parse(response.text || '{}');
};
