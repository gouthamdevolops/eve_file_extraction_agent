import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { defineAgent } from "eve";

const openRouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
});

export default defineAgent({
  model: openRouter("openai/gpt-6-luna"),
  reasoning: "high",
  modelContextWindowTokens: 1000000,
  description: "Classifies one prepared document as flight_info, standalone_assets, consolidated_report, or unknown.",
  tool: false,
  defaultTools: false,
});
