// Google Ads integration seam — Phase 4 (account linking from the PPC Mastery
// MCC). Per docs/google-ads-api-lessons.md: the developer token is passed as an
// explicit header on EVERY call, and all calls authenticate as the MCC via the
// login-customer-id header — if a call fails with permission errors despite
// valid credentials, check that header first.
//
// Design constraint (declared to Google): no client OAuth. The portal uses ONE
// stored refresh token (MCC admin) and sends link invitations; clients accept
// inside Google Ads.

const API_VERSION = process.env.GOOGLE_ADS_API_VERSION ?? "v24";
const API = `https://googleads.googleapis.com/${API_VERSION}`;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Google Ads is not configured (${name} missing).`);
  return v;
}

// Access tokens last ~1h; cache with a safety margin.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt) return cachedToken.token;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_ADS_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_ADS_CLIENT_SECRET"),
      refresh_token: requireEnv("GOOGLE_ADS_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!data.access_token) {
    throw new Error(`Google OAuth token refresh failed: ${data.error_description ?? "unknown"}`);
  }
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + ((data.expires_in ?? 3600) - 300) * 1000,
  };
  return data.access_token;
}

async function adsHeaders(): Promise<Record<string, string>> {
  return {
    Authorization: `Bearer ${await getAccessToken()}`,
    "developer-token": requireEnv("GOOGLE_ADS_DEVELOPER_TOKEN"),
    "login-customer-id": requireEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID"),
    "Content-Type": "application/json",
  };
}

/** Pull a human-readable message out of a Google Ads REST error payload. */
function extractAdsError(body: unknown): string {
  const b = body as {
    error?: {
      message?: string;
      details?: Array<{ errors?: Array<{ message?: string; errorCode?: Record<string, string> }> }>;
    };
  };
  const detail = b.error?.details?.flatMap((d) => d.errors ?? [])[0];
  return detail?.message ?? b.error?.message ?? "Unknown Google Ads API error";
}

export class GoogleAdsError extends Error {
  constructor(
    message: string,
    /** True when the error indicates the customer ID doesn't exist / isn't reachable. */
    public readonly isInvalidCustomer: boolean,
  ) {
    super(message);
  }
}

/**
 * Send a link invitation from the PPC Mastery MCC to the client's account.
 * Creates a CustomerClientLink with status PENDING — the client must accept it
 * inside Google Ads. Returns the link's resource name (used for status checks).
 */
export async function sendLinkInvitation(clientCustomerId: string): Promise<string> {
  const mcc = requireEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
  const res = await fetch(`${API}/customers/${mcc}/customerClientLinks:mutate`, {
    method: "POST",
    headers: await adsHeaders(),
    body: JSON.stringify({
      operation: {
        create: {
          clientCustomer: `customers/${clientCustomerId}`,
          status: "PENDING",
        },
      },
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    const message = extractAdsError(body);
    const text = JSON.stringify(body);
    const invalid =
      res.status === 404 ||
      /NOT_FOUND|INVALID_CUSTOMER|USER_PERMISSION_DENIED|CUSTOMER_NOT_FOUND|INVALID_ARGUMENT/i.test(
        text,
      );
    throw new GoogleAdsError(message, invalid);
  }
  const result = body as { result?: { resourceName?: string } };
  if (!result.result?.resourceName) {
    throw new GoogleAdsError("Google did not return a link resource name.", false);
  }
  return result.result.resourceName;
}

/**
 * Current status of the MCC→client link: PENDING (invited, awaiting client),
 * ACTIVE (accepted), REFUSED, CANCELLED, INACTIVE — or null when no link exists.
 */
export async function getLinkStatus(clientCustomerId: string): Promise<string | null> {
  const mcc = requireEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID");
  const res = await fetch(`${API}/customers/${mcc}/googleAds:search`, {
    method: "POST",
    headers: await adsHeaders(),
    body: JSON.stringify({
      query: `SELECT customer_client_link.status, customer_client_link.resource_name FROM customer_client_link WHERE customer_client_link.client_customer = 'customers/${clientCustomerId}' ORDER BY customer_client_link.resource_name DESC LIMIT 1`,
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new GoogleAdsError(extractAdsError(body), false);
  const rows = (body as { results?: Array<{ customerClientLink?: { status?: string } }> }).results;
  return rows?.[0]?.customerClientLink?.status ?? null;
}
