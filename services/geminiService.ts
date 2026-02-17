
import { GoogleGenAI } from "@google/genai";
import { Resource, Project, Allocation } from "../types";

export const getCapacityInsights = async (
  resources: Resource[],
  projects: Project[],
  allocations: Allocation[],
  userPrompt: string
): Promise<string> => {
  const apiKey = process.env.API_KEY || '';

  // If no API key is set, return a quick mocked response for demo purposes.
  if (!apiKey) {
    const overAllocated = resources.filter(r => {
      const total = allocations.filter(a => a.resourceId === r.id).reduce((s, a) => s + a.percentage, 0);
      return total > 100;
    }).map(r => r.name);

    const freeResources = resources.filter(r => {
      const total = allocations.filter(a => a.resourceId === r.id).reduce((s, a) => s + a.percentage, 0);
      return total < 60;
    }).map(r => r.name);

    let reply = `Quick demo insights for: "${userPrompt}"\n\n`;
    if (overAllocated.length) {
      reply += `Over-allocated: ${overAllocated.join(', ')}. Recommend rebalancing or hiring additional FTEs.\n`;
    } else {
      reply += `No immediate over-allocations detected.\n`;
    }
    if (freeResources.length) {
      reply += `Resources with available capacity: ${freeResources.join(', ')}. Consider assigning new tasks here.`;
    }

    return new Promise(resolve => setTimeout(() => resolve(reply), 700));
  }

  // Otherwise attempt to call the real GenAI client
  try {
    const ai = new GoogleGenAI({ apiKey });
    const context = `You are a PMO Resource Management Expert. RESOURCES: ${JSON.stringify(resources)} PROJECTS: ${JSON.stringify(projects)} ALLOCATIONS: ${JSON.stringify(allocations)} The user: "${userPrompt}"`;
    const response = await ai.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: context,
    });

    return (response as any).text || "I couldn't generate insights at this moment. Please try again.";
  } catch (error) {
    console.error("Gemini Insight Error:", error);
    return "Error communicating with AI assistant. Ensure API key is valid.";
  }
};
