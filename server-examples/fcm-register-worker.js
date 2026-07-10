/**
 * Beispiel: Cloudflare Worker zum Speichern von FCM Web Tokens.
 *
 * Erwartete Bindings:
 * - FCM_TOKENS: KV Namespace
 *
 * Route-Beispiel:
 * - POST /api/fcm/register
 *
 * Wichtig: Dieser Worker prueft das Firebase ID Token noch nicht.
 * Fuer Produktion sollte der Authorization: Bearer <Firebase-ID-Token> Header serverseitig validiert werden.
 */
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(request) });
    }

    if (request.method !== "POST" || url.pathname !== "/api/fcm/register") {
      return json({ error: "Not found" }, 404, request);
    }

    const payload = await request.json().catch(() => null);
    const token = payload?.token;
    if (!token || typeof token !== "string") {
      return json({ error: "Missing FCM token" }, 400, request);
    }

    const userId = payload?.user?.uid || "anonymous";
    const key = `fcm:${userId}:${await sha256(token)}`;
    const value = {
      token,
      provider: "firebase-cloud-messaging",
      topic: payload.topic || "patchnotes",
      user: payload.user || null,
      userAgent: payload.userAgent || "",
      notificationPermission: payload.notificationPermission || "",
      createdAt: payload.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await env.FCM_TOKENS.put(key, JSON.stringify(value));
    return json({ ok: true }, 200, request);
  },
};

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "https://eskyna.com";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data, status, request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function sha256(input) {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
