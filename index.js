const MODEL = (process.env.GEMINI_MODEL || "gemini-2.5-flash").trim();
const URL =
  "https://generativelanguage.googleapis.com/v1beta/models/" +
  MODEL +
  ":generateContent";

const SYSTEM_PROMPT =
  "Ты Джарвис, голосовой помощник в Алисе. Отвечай по-русски, коротко: " +
  "1-2 предложения, без списков, markdown и эмодзи, так чтобы удобно читать вслух.";

const TIMEOUT_MS = 2600;

function trim(history) {
  let h = history.slice(-6);
  while (h.length && Buffer.byteLength(JSON.stringify(h)) > 900) h = h.slice(1);
  return h;
}

async function askGemini(history, text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const generationConfig = { maxOutputTokens: 300, temperature: 0.7 };
    if (MODEL.includes("flash")) generationConfig.thinkingConfig = { thinkingBudget: 0 };

    const r = await fetch(URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": (process.env.GEMINI_API_KEY || "").trim(),
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [
          ...history.map((m) => ({ role: m.r, parts: [{ text: m.t }] })),
          { role: "user", parts: [{ text }] },
        ],
        generationConfig,
      }),
      signal: controller.signal,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error("Gemini error:", r.status, "model=" + MODEL, JSON.stringify(data.error || data));
      return null;
    }
    const out = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "";
    return out.trim() || null;
  } catch (e) {
    console.error("Gemini failed:", e.name, e.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(200).send("OK");

  const body = req.body || {};
  const text = (body.request?.original_utterance || "").trim();
  const history = Array.isArray(body.state?.session?.history) ? body.state.session.history : [];

  const reply = (t, state) =>
    res.status(200).json({
      version: body.version || "1.0",
      session: body.session,
      response: { text: t, tts: t, end_session: false },
      session_state: { history: state || history },
    });

  if (text.toLowerCase() === "ping") return reply("pong");
  if (!text) return reply("Привет! Я Джарвис. Что вас интересует?");

  const answer = await askGemini(history, text);
  if (!answer) return reply("Не получилось ответить. Спросите ещё раз.");

  return reply(answer, trim([...history, { r: "user", t: text }, { r: "model", t: answer }]));
};
