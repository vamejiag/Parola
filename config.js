// Parola: AI providers and their default models.
// Change "model" to use a different default. You can also change it in the app's Settings.
// "base" is the server address for OpenAI-compatible providers.
const PROVIDERS = {
  gemini:     { model: "gemini-3-flash-preview", help: 'Free key at <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">Google AI Studio</a>. Newer free models are listed there too.' },
  groq:       { model: "llama-3.3-70b-versatile", base: "https://api.groq.com/openai/v1", help: 'Free key at <a href="https://console.groq.com/keys" target="_blank" rel="noopener">console.groq.com</a>.' },
  openrouter: { model: "google/gemini-2.5-flash", base: "https://openrouter.ai/api/v1", help: 'Key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai</a>. Models ending in ":free" cost nothing.' },
  openai:     { model: "gpt-4o-mini", base: "https://api.openai.com/v1", help: 'Paid key at <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener">platform.openai.com</a>.' },
  anthropic:  { model: "claude-haiku-4-5-20251001", help: 'Paid key at <a href="https://console.anthropic.com" target="_blank" rel="noopener">console.anthropic.com</a>.' },
  custom:     { model: "llama3.1", base: "http://localhost:11434/v1", help: "Any OpenAI-compatible server. For Ollama, start it with OLLAMA_ORIGINS=* so the browser can reach it." }
};
