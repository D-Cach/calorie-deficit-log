# Food scan Worker

A Cloudflare Worker that stands between the app and Google Gemini. The app
sends a food photo; the Worker calls Gemini (free tier) and returns estimated
foods, portions, and macros as JSON.

It exists because an API key can't live in a browser app — anyone could read
it and spend against it. The key lives here instead.

## What you need first

1. **A Google Gemini API key** (free)
   - Go to <https://aistudio.google.com/apikey>
   - Sign in with your Google account, "Create API key"
   - Copy it somewhere safe for step 3. This is the secret.

2. **A Cloudflare account** (free) — <https://dash.cloudflare.com/sign-up>

## Deploy the Worker (no install, all in the browser)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Worker**
2. Give it a name (e.g. `food-scan`), **Deploy** the starter, then **Edit code**
3. Delete the starter code, paste all of `food-scan-worker.js`, **Deploy**
4. **Settings → Variables and Secrets**, add these four:

   | Name | Type | Value |
   |------|------|-------|
   | `GEMINI_API_KEY` | Secret | the key from step 1 |
   | `FIREBASE_API_KEY` | Text | the app's public Firebase web API key (in `index.html`, the `firebaseConfig.apiKey` value) |
   | `ALLOWED_EMAILS` | Text | your Google account, comma, Annelyn's Google account — the two that sign into the app |
   | `APP_ORIGIN` | Text | `https://calorie-deficit-log.web.app` |

5. **Deploy** again so the variables take effect
6. Copy the Worker URL (looks like `https://food-scan.<your-subdomain>.workers.dev`)
   and hand it to Zero to wire into the app

## Testing it's alive

A bare `GET` of the URL should return `{"error":"POST only"}` — that means it's
up. Real calls need a POST with a Firebase token and an image; the app does
that part.

## Free tier limits

Gemini 2.5 Flash free tier is well past personal use (hundreds of requests a
day). If Google changes the model name, edit the `MODEL` constant at the top
of `food-scan-worker.js` and redeploy.

## Cost

Zero. Gemini free tier + Cloudflare Workers free tier (100k requests/day).
No card on file for either.
