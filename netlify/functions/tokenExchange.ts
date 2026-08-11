import type { Handler } from "@netlify/functions";

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v2/userinfo";

type ExchangeBody =
  | { grantType: "authorization_code"; code: string; redirectUri: string }
  | { grantType: "refresh_token"; refreshToken: string };

function jsonResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

/** Proxies Google's OAuth token endpoint so the client secret never reaches the browser. */
export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Method not allowed" });
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return jsonResponse(500, { error: "Google OAuth is not configured on the server" });
  }

  let payload: ExchangeBody;
  try {
    payload = JSON.parse(event.body ?? "{}");
  } catch {
    return jsonResponse(400, { error: "Invalid JSON body" });
  }

  const params = new URLSearchParams({ client_id: clientId, client_secret: clientSecret });

  if (payload.grantType === "authorization_code") {
    if (!payload.code || !payload.redirectUri) {
      return jsonResponse(400, { error: "code and redirectUri are required" });
    }
    params.set("grant_type", "authorization_code");
    params.set("code", payload.code);
    params.set("redirect_uri", payload.redirectUri);
  } else if (payload.grantType === "refresh_token") {
    if (!payload.refreshToken) {
      return jsonResponse(400, { error: "refreshToken is required" });
    }
    params.set("grant_type", "refresh_token");
    params.set("refresh_token", payload.refreshToken);
  } else {
    return jsonResponse(400, { error: "Unknown grantType" });
  }

  const tokenRes = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!tokenRes.ok) {
    const text = await tokenRes.text();
    return jsonResponse(tokenRes.status, { error: `Google token exchange failed: ${text}` });
  }
  const tokenData = (await tokenRes.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };

  if (payload.grantType === "authorization_code") {
    const userRes = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) {
      return jsonResponse(502, { error: "Failed to fetch Google account email" });
    }
    const userData = (await userRes.json()) as { email: string };
    if (!tokenData.refresh_token) {
      return jsonResponse(502, {
        error:
          "Googleがrefresh_tokenを返しませんでした。既に連携済みのアカウントは一度連携を解除してから再度お試しください。",
      });
    }
    return jsonResponse(200, {
      accessToken: tokenData.access_token,
      expiresIn: tokenData.expires_in,
      refreshToken: tokenData.refresh_token,
      email: userData.email,
    });
  }

  return jsonResponse(200, {
    accessToken: tokenData.access_token,
    expiresIn: tokenData.expires_in,
  });
};
