#!/usr/bin/env node
// Migration runner with a target guard, adapted from the app-wmi sibling's
// (their 605718a), whose reason for existing was a migration meant for one
// database being run against another on 2026-07-30.
//
// Our estate has no substrate: the hazard here is three PORTAL databases with
// the SAME schema (ppcmastery, adenergy, demo), which no table fingerprint can
// tell apart. So the guard is:
//
//   1. The FILE declares its family      (-- TARGET: PORTAL)
//   2. The OPERATOR names a database     (--db ppcmastery | adenergy | demo)
//   3. The LIVE IDENTITY must agree with both:
//      a. the connected database has onboarding_state (right family), and
//      b. the connection string carries the named project's Supabase ref.
//         A ref is globally unique and the connection physically lands on that
//         project's host, so unlike a filename or an env-var name this is not
//         a label a human can mislabel: you cannot reach project X through a
//         URL carrying ref Y.
//
// Connection strings live in .env.local (gitignored, values supplied by the
// founder; never in the repo): PPCM_DB_URL, ADENERGY_DB_URL, DEMO_DB_URL.
// Both direct (db.<ref>.supabase.co) and pooler (postgres.<ref>@...pooler...)
// URL shapes carry the ref, so the same check covers both.
//
// Usage:
//   node scripts/migrate.mjs supabase/migrations/0022_x.sql --db ppcmastery
//   node scripts/migrate.mjs supabase/migrations/0022_x.sql --db adenergy --yes
//
// Without --yes it prints what it resolved and stops. That is the intended
// default: look at it, then re-run with --yes.
import { readFileSync, appendFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

// --db name -> env var holding its connection string, and the Supabase project
// ref the connection must prove it belongs to (verified live 2026-08-18 via
// each deployment's /api/diag/env db_ref).
const TARGETS = {
  ppcmastery: {
    envVar: "PPCM_DB_URL",
    ref: "rnhyegybpwyoxubmgvds",
    label: "PPC Mastery portal (app.ppcmastery.ai)",
  },
  adenergy: {
    envVar: "ADENERGY_DB_URL",
    ref: "hwpmxavoxhimhvqiskfq",
    label: "AdEnergy / BJ Command Center (app.adenergy.online)",
  },
  demo: {
    envVar: "DEMO_DB_URL",
    ref: "qvonjwhhyvdqdndjnhds",
    label: "Google-reviewer demo tenant (demo.ppcmastery.ai)",
  },
};

// The family fingerprint: every portal database has onboarding_state. A
// database without it is not one of ours, whatever the URL claims.
const FAMILY_TABLE = "onboarding_state";

function die(msg) {
  console.error(`\n  REFUSED: ${msg}\n`);
  process.exit(1);
}

function readEnvVar(file, name) {
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(new RegExp(`^${name}=(.*)$`));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

/** The target a migration file declares about itself. */
function declaredTarget(sql, path) {
  const head = sql.split("\n").slice(0, 25).join("\n");
  const m = head.match(/--\s*TARGET:\s*(PORTAL)\b/i);
  if (!m) {
    die(
      `${path} does not declare a target.\n` +
        `  Add this as the first line:\n` +
        `    -- TARGET: PORTAL\n` +
        `  (Every migration in this repo is portal-family. A file without the\n` +
        `  header is either foreign or predates the convention; look at it.)`,
    );
  }
  return m[1].toUpperCase();
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const dbIdx = args.indexOf("--db");
  const dbName = dbIdx === -1 ? null : args[dbIdx + 1];
  const confirmed = args.includes("--yes");

  if (!file || !dbName) {
    console.error(
      "\n  usage: node scripts/migrate.mjs <file.sql> --db <ppcmastery|adenergy|demo> [--yes]\n",
    );
    process.exit(2);
  }
  if (!TARGETS[dbName]) {
    die(`unknown database "${dbName}". Choose one of: ${Object.keys(TARGETS).join(", ")}`);
  }
  if (!existsSync(file)) die(`no such file: ${file}`);

  const target = TARGETS[dbName];
  const sql = readFileSync(file, "utf8");
  declaredTarget(sql, file); // dies if the header is missing or foreign

  const url = readEnvVar(join(process.cwd(), ".env.local"), target.envVar);
  if (!url) {
    die(
      `${target.envVar} is not set in .env.local.\n` +
        `  Add the ${target.label} Postgres connection string there (Supabase ->\n` +
        `  Project Settings -> Database -> Connection string), or run this file\n` +
        `  in that project's SQL editor by hand.`,
    );
  }

  // Leg 3b: the connection string must carry the named project's ref. This is
  // the live-identity check for same-schema databases: the ref is where the
  // connection physically lands, not a label.
  if (!url.includes(target.ref)) {
    die(
      `${target.envVar} does not point at ${dbName}.\n` +
        `      expected project ref: ${target.ref}\n` +
        `      connection string carries no such ref.\n\n` +
        `  This is the wrong-database mistake this runner exists to stop.\n` +
        `  Nothing has been executed.`,
    );
  }

  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  // Leg 3a: right family. A database without onboarding_state is not a portal.
  const { rows } = await client.query(
    "select 1 from information_schema.tables where table_schema = 'public' and table_name = $1",
    [FAMILY_TABLE],
  );
  if (!rows.length) {
    await client.end();
    die(
      `the connected database has no ${FAMILY_TABLE} table, so it is not a\n` +
        `  portal database at all. Nothing has been executed.`,
    );
  }

  const host = new URL(url.replace(/^postgres(ql)?:\/\//, "https://")).hostname;
  console.log(`\n  file:     ${file}`);
  console.log(`  declares: PORTAL`);
  console.log(`  database: ${target.label}`);
  console.log(`  host:     ${host}`);
  console.log(`  verified: ref ${target.ref} in the connection, ${FAMILY_TABLE} present`);

  if (!confirmed) {
    console.log(`\n  Nothing executed. Re-run with --yes to apply.\n`);
    await client.end();
    return;
  }

  // One transaction: a migration that fails halfway leaves nothing behind.
  try {
    await client.query("begin");
    await client.query(sql);
    await client.query("commit");
  } catch (e) {
    await client.query("rollback").catch(() => {});
    await client.end();
    die(`migration failed and was rolled back.\n  ${e.message}`);
  }
  await client.end();

  const stamp = new Date().toISOString();
  appendFileSync(
    join(process.cwd(), "docs/migration-log.txt"),
    `${stamp}  PORTAL  ${dbName}  ${host}  ${file}\n`,
  );
  console.log(`\n  Applied. Logged to docs/migration-log.txt\n`);
}

main().catch((e) => {
  console.error(`\n  ERROR: ${e.message}\n`);
  process.exit(1);
});
