import { VercelRequest, VercelResponse } from "@vercel/node";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

type ExchangeBody =
  | { grantType: "authorization_code"; code: string; redirectUri: string }
  | { grantType: "refresh_token"; refreshToken: string };

function jsonResponse(res: VercelResponse, statusCode: number, body: unknown) {
  res.status(statusCode).json(body);
}

/** Reads the `email` claim out of the ID token JWT Google returns alongside the
 * access token when the `openid email` scopes are granted — avoids a second,
 * separately-authenticated call to a userinfo endpoint. Signature isn't verified
 * since the token came directly from Google's token endpoint over TLS, not from
 * an untrusted client. */
function readEmailFromIdToken(idToken: string): string | null {
  const payloadSegment = idToken.split(".")[1];
  if (!payloadSegment) return null;
  try {
    const payload = JSON.parse(Buffer.from(payloadSegment, "base64url").toString("utf8")) as { email?: string };
    return payload.email ?? null;
  } catch {
    return null;
  }
}

/** Proxies Google's OAuth token endpoint so the client secret never reaches the browser. */
export default async (req: VercelRequest, res: VercelResponse) => {
  if (req.method !== "POST") {
    return jsonResponse(res, 405, { error: "Method not allowed" });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return jsonResponse(res, 500, { error: "Google OAuth is not configured on the server" });
  }

  let payload: ExchangeBody;
  try {
    payload = req.body ?? {};
    if (typeof payload === "string") {
      payload = JSON.parse(payload);
    }
  } catch {
    return jsonResponse(res, 400, { error: "Invalid JSON body" });
  }

  const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret });

  if (payload.grantType === "authorization_code") {
    if (!payload.code || !payload.redirectUri) {
      return jsonResponse(res, 400, { error: "code and redirectUri are required" });
    }
    params.set("grant_type", "authorization_code");
    params.set("code", payload.code);
    params.set("redirect_uri", payload.redirectUri);
  } else if (payload.grantType === "refresh_token") {
    if (!payload.refreshToken) {
      return jsonResponse(res, 400, { error: "refreshToken is required" });
    }
    params.set("grant_type", "refresh_token");
    params.set("refresh_token", payload.refreshToken);
  } else {
    return jsonResponse(res, 400, { error: "Unknown grantType" });
  }

  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    return jsonResponse(res, tokenRes.status, { error: `Google token exchange failed: ${text}` });
  }
  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    id_token?: string;
  };

  if (payload.grantType === "authorization_code") {
    if (!tokenData.refresh_token) {
      return jsonResponse(res, 502, {
        error:
          "Googleがrefresh_tokenを返しませんでした。既に連携済みのアカウントは一度連携を解除してから再度お試しください。",
      });
    }
    const email = tokenData.id_token ? readEmailFromIdToken(tokenData.id_token) : null;
    if (!email) {
      return jsonResponse(res, 502, { error: "Googleのレスポンスからメールアドレスを取得できませんでした" });
    }
    return jsonResponse(res, 200, {
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in,
      refreshToken: tokenData.refresh_token,
      email,
    });
  }

  return jsonResponse(res, 200, {
    accessToken: tokenData.access_token,
    expiresIn: tokenData.expires_in,
  });
};
