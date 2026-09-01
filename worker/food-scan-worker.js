/*
 * food-scan-worker.js  —  Cloudflare Worker
 *
 * Takes a food photo from the Calorie Deficit Log app, asks Google Gemini
 * (free tier) to estimate the foods, portions, and macros, and returns JSON.
 *
 * The Gemini API key must never reach the browser, so this Worker sits in
 * front of it: the app calls the Worker, the Worker holds the key.
 *
 * Callers are checked: the app sends the signed-in user's Firebase ID token
 * in the Authorization header, and the Worker asks Google's Identity Toolkit
 * whether that token is real and whose it is. Only the allow-listed Google
 * accounts get through. No shared secret to leak.
 *
 * Deploy without any local tooling:
 *   1. Cloudflare dashboard -> Workers & Pages -> Create -> Worker
 *   2. "Edit code", paste this whole file, Deploy
 *   3. Settings -> Variables and Secrets, add:
 *        GEMINI_API_KEY    (Secret)  from https://aistudio.google.com/apikey
 *        FIREBASE_API_KEY  (Text)    the app's public Firebase web API key
 *        ALLOWED_EMAILS    (Text)    comma-separated Google accounts allowed
 *        APP_ORIGIN        (Text)    https://calorie-deficit-log.web.app
 *        GEMINI_MODEL      (Text)    optional — overrides DEFAULT_MODEL below,
 *                                    so a model retirement is a dashboard edit
 *   4. Copy the Worker URL (…workers.dev) and give it to the app
 *
 * See README.md in this folder for the step-by-step.
 */

// Fallback when GEMINI_MODEL isn't set. Google retires model names over time
// (a 404 body names the current one) — set GEMINI_MODEL in the dashboard to
// change it without touching this file.
const DEFAULT_MODEL = "gemini-3.6-flash";

const PROMPT = [
  "You estimate nutrition from a photo of food a person is about to eat.",
  "Identify every distinct food or drink in the image.",
  "For each item, estimate:",
  "- grams: the edible portion in grams. For liquids, grams at about 1 g per mL.",
  "- calories, protein, carbs, fat: for that portion. Macros in grams.",
  "- confidence: low, medium, or high, for how sure the portion estimate is.",
  "Judge quantity from scale cues in the image: a dinner plate is about 26 cm,",
  "a dinner fork about 19 cm, a soda can about 12 cm tall, an adult hand about 18 cm.",
  "Ignore condiments and garnishes under about 5 g.",
  "If you cannot identify something, give your single best guess and set confidence to low.",
  "Put any one-line caveat for the user in 'note'.",
].join("\n");

// A response schema keeps Gemini's output to exactly this shape (no prose,
// no markdown fences) so the app can trust it after a light sanitise pass.
const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          grams: { type: "number" },
          calories: { type: "number" },
          protein: { type: "number" },
          carbs: { type: "number" },
          fat: { type: "number" },
          confidence: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["name", "grams", "calories", "protein", "carbs", "fat", "confidence"],
      },
    },
    note: { type: "string" },
  },
  required: ["items"],
};

export default {
  async fetch(request, env) {
    const cors = {
      "Access-Control-Allow-Origin": env.APP_ORIGIN || "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }
    if (request.method !== "POST") {
      return reply({ error: "POST only" }, 405, cors);
    }

    // --- who's calling: verify the Firebase ID token ---
    const idToken = (request.headers.get("Authorization") || "")
      .replace(/^Bearer\s+/i, "")
      .trim();
    if (!idToken) {
      return reply({ error: "missing token" }, 401, cors);
    }

    let email;
    try {
      const lookup = await fetch(
        "https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=" +
          env.FIREBASE_API_KEY,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken }),
        }
      );
      const lookupData = await lookup.json();
      email =
        lookupData.users && lookupData.users[0] && lookupData.users[0].email;
    } catch (err) {
      return reply({ error: "token check failed" }, 401, cors);
    }

    const allowed = (env.ALLOWED_EMAILS || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!email || !allowed.includes(email.toLowerCase())) {
      return reply({ error: "not allowed" }, 403, cors);
    }

    // --- read the image (base64 JPEG, no data: prefix) ---
    let body;
    try {
      body = await request.json();
    } catch (err) {
      return reply({ error: "bad JSON body" }, 400, cors);
    }
    const image = typeof body.image === "string" ? body.image : "";
    if (!image) {
      return reply({ error: "no image" }, 400, cors);
    }

    // --- call Gemini ---
    // Trim defensively — a stray space or newline pasted into the dashboard
    // variable would otherwise make the key or model URL invalid.
    const geminiKey = (env.GEMINI_API_KEY || "").trim();
    const model = (env.GEMINI_MODEL || "").trim() || DEFAULT_MODEL;
    let geminiRes;
    try {
      geminiRes = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" +
          model +
          ":generateContent?key=" +
          geminiKey,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  { text: PROMPT },
                  { inline_data: { mime_type: "image/jpeg", data: image } },
                ],
              },
            ],
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: SCHEMA,
              temperature: 0.2,
            },
          }),
        }
      );
    } catch (err) {
      console.log("scan: could not reach Gemini —", String(err));
      return reply({ error: "could not reach Gemini" }, 502, cors);
    }

    if (!geminiRes.ok) {
      const detail = await geminiRes.text();
      // Surfaced in Cloudflare's Observability logs and in the response body so
      // a failure is diagnosable instead of just a generic 502.
      console.log("scan: Gemini " + geminiRes.status + " — " + detail.slice(0, 900));
      return reply(
        { error: "Gemini error", status: geminiRes.status, detail: detail.slice(0, 400) },
        502,
        cors
      );
    }

    const data = await geminiRes.json();
    const text =
      data &&
      data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text;

    if (!text) {
      return reply({ error: "empty response from Gemini" }, 502, cors);
    }

    // `text` is already JSON because of responseMimeType. Hand it straight back;
    // the app sanitises it before use.
    return new Response(text, {
      status: 200,
      headers: { "Content-Type": "application/json", ...cors },
    });
  },
};

function reply(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}
