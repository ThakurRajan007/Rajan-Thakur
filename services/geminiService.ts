
import { GoogleGenAI, Type } from "@google/genai";
import { SessionResult } from "../types.ts";

export const searchTechnologies = async (query: string): Promise<string[]> => {
  if (!query || query.trim().length < 2) return [];
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: `List 6 accurate technology, software, or career skill names that start with or are highly relevant to: "${query}". Include both the exact matches and common related platforms. Return only a JSON array of strings. Examples: if user types "VMW", return ["VMware vSphere", "VMware Workstation", "Virtualization", "Cloud Computing"].`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: { type: Type.STRING }
      }
    }
  });
  try {
    const text = response.text || '[]';
    return JSON.parse(text);
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
  const text = response.text || '{}';
  return JSON.parse(text);
};
