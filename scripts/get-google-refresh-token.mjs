// One-time helper: obtain the Google Ads API refresh token for the MCC admin.
//
// Prereqs (.env.local): GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET
// (a "Desktop app" OAuth client from Google Cloud).
//
// Run:  node scripts/get-google-refresh-token.mjs
// It prints a Google URL — open it, sign in with the account that admins the
// PPC Mastery MCC, approve. The script catches the redirect locally and prints
// the refresh token to paste into .env.local as GOOGLE_ADS_REFRESH_TOKEN.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";

const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
const get = (k) => (env.match(new RegExp("^" + k + "=(.*)$", "m")) || [])[1]?.trim();

const clientId = get("GOOGLE_ADS_CLIENT_ID");
const clientSecret = get("GOOGLE_ADS_CLIENT_SECRET");
if (!clientId || !clientSecret) {
  console.error("Fill GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET in .env.local first.");
  process.exit(1);
}

const PORT = 53682;
const redirectUri = `http://127.0.0.1:${PORT}`;

const authUrl =
  "https://accounts.google.com/o/oauth2/v2/auth" +
  `?client_id=${encodeURIComponent(clientId)}` +
  `&redirect_uri=${encodeURIComponent(redirectUri)}` +
  "&response_type=code" +
  `&scope=${encodeURIComponent("https://www.googleapis.com/auth/adwords")}` +
  "&access_type=offline" +
  "&prompt=consent";

const server = createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end("No code in callback.");
    return;
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const data = await tokenRes.json();
  if (data.refresh_token) {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<h2>Done — go back to the terminal. You can close this tab.</h2>");
    console.log("\n✅ Refresh token obtained. Paste this line into .env.local:\n");
    console.log(`GOOGLE_ADS_REFRESH_TOKEN=${data.refresh_token}\n`);
  } else {
    res.writeHead(500).end("Token exchange failed — see terminal.");
    console.error("Token exchange failed:", JSON.stringify(data, null, 2));
  }
  server.close();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("1. Open this URL in your browser:");
  console.log("\n" + authUrl + "\n");
  console.log("2. Sign in with the Google account that admins the PPC Mastery MCC.");
  console.log("3. Approve. This terminal prints your refresh token when done.");
});
