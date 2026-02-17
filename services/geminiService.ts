
import { GoogleGenAI } from "@google/genai";
import { Resource, Project, Allocation } from "../types";

export const getCapacityInsights = async (
  resources: Resource[],
  projects: Project[],
  allocations: Allocation[],
  userPrompt: string
): Promise<string> => {
  const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
  
  // Format context for the model
  const context = `
    You are a PMO Resource Management Expert. Use the following current capacity data:
    
    RESOURCES: ${JSON.stringify(resources)}
    PROJECTS: ${JSON.stringify(projects)}
    ALLOCATIONS: ${JSON.stringify(allocations)}
    
    The user is asking: "${userPrompt}"
    
    Rules:
    - Provide specific recommendations on workload balancing.
    - Identify over-allocated resources (>100%).
    - Suggest who has free cycles for new work.
    - Be concise and professional.
    - Mention contractors separately from permanent staff when relevant.
  `;

  try {
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: context,
    });

    return response.text || "I couldn't generate insights at this moment. Please try again.";
  } catch (error) {
    console.error("Gemini Insight Error:", error);
    return "Error communicating with AI assistant. Ensure API key is valid.";
  }
};
