import "server-only";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variable d'environnement manquante : ${name} (voir .env.example)`);
  return value;
}

export const env = {
  supabaseUrl: () => required("NEXT_PUBLIC_SUPABASE_URL"),
  supabaseAnonKey: () => required("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
  groqKey: () => process.env.GROQ_API_KEY,
  groqModel: () => process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  groqFastModel: () => process.env.GROQ_FAST_MODEL || "llama-3.1-8b-instant",
  geminiKey: () => process.env.GOOGLE_GENERATIVE_AI_API_KEY,
  geminiModel: () => process.env.GEMINI_MODEL || "gemini-flash-latest",
};
