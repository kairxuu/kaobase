import "server-only";

export const env = {
  groqKey: () => process.env.GROQ_API_KEY,
  groqModel: () => process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  groqFastModel: () => process.env.GROQ_FAST_MODEL || "llama-3.1-8b-instant",
  groqFallbackModel: () => process.env.GROQ_FALLBACK_MODEL || "openai/gpt-oss-20b",
  geminiKey: () => process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  geminiModel: () => process.env.GEMINI_MODEL || "gemini-flash-latest",
};
