// Application access checks using a dedicated Neon account and the Neon Data API.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { NeonPostgrestClient } from "@neondatabase/postgrest-js";

function dotenv(text) {
  return Object.fromEntries(text.split(/\r?\n/).filter((line) => line.includes("=") && !line.trimStart().startsWith("#"))
    .map((line) => { const i = line.indexOf("="); return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^['"]|['"]$/g, "")]; }));
}
const env = { ...dotenv(await readFile(".env.local", "utf8")), ...dotenv(await readFile(".env.test.local", "utf8")) };
const url = process.argv[2] ?? env.NEON_DATA_API_URL;
assert(url && new URL(url).protocol === "https:", "A Neon Data API URL is required");
const headers={"content-type":"application/json",origin:env.APP_ORIGIN??"https://kaobase.vercel.app"};
const login=await fetch(env.NEON_AUTH_BASE_URL+"/sign-in/email",{method:"POST",headers,body:JSON.stringify({email:env.E2E_EMAIL,password:env.E2E_PASSWORD})});
assert(login.ok,"The dedicated Neon test account must authenticate successfully");
const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
const issued=await fetch(env.NEON_AUTH_BASE_URL+"/token",{headers:{...headers,cookie}});
assert(issued.ok,"Neon must issue a signed JWT");
const {token}=await issued.json();
const client=new NeonPostgrestClient({dataApiUrl:url,options:{global:{fetch,headers:{Authorization:`Bearer ${token}`}}}});
const identity = await client.rpc("ensure_app_user");
assert.equal(identity.error, null, "The verified identity must initialize successfully");
assert.equal(identity.data, true);
const current=await client.rpc("current_identity").single();
assert.equal(current.error,null);
const userId=current.data.app_user_id;
const profile = await client.from("profiles").select("id,currency,onboarding_completed_at");
assert.equal(profile.error, null, "Profile access failed");
assert.equal(profile.data.length, 1);
assert.equal(profile.data[0].id, userId, "Another user's profile was exposed");
for (const table of ["accounts", "categories", "transactions", "subscriptions", "tasks", "imports", "agent_runs", "agent_memories", "agent_messages", "app_shortcuts", "app_oauth_connections"]) {
  const result = await client.from(table).select("id,user_id");
  assert.equal(result.error, null, `Read access failed for ${table}`);
  assert(result.data.every((row) => row.user_id === userId), `Owner isolation failed for ${table}`);
}
const accounts = await client.from("accounts").select("id");
const balances = await client.from("account_balances").select("id,balance");
assert.equal(balances.error, null);
assert(balances.data.every((row) => accounts.data.some((account) => account.id === row.id)), "A view exposed another user's data");
assert.equal((await client.from("agent_performance").select("*")).error, null);
assert.notEqual((await client.schema("auth").from("users").select("id")).error, null, "The authentication schema must stay private");
const denied = await fetch(`${url}/profiles?select=id`);
assert(denied.status >= 400 && denied.status < 500, "Anonymous requests must be refused");
const segments = token.split(".");
const claims = JSON.parse(Buffer.from(segments[1], "base64url").toString("utf8"));
claims.sub = "ffffffff-ffff-4fff-8fff-ffffffffffff";
segments[1] = Buffer.from(JSON.stringify(claims)).toString("base64url");
const forged = await fetch(`${url}/profiles?select=id`, { headers: { Authorization: `Bearer ${segments.join(".")}` } });
assert(forged.status >= 400 && forged.status < 500, "JWT signatures must be verified");
const vector = `[${[1, ...Array(383).fill(0)].join(",")}]`;
const memories = await client.rpc("match_memories", { p_agent: "finance", p_embedding: vector, p_count: 1 });
assert.equal(memories.error, null, "Vector search RPC must retain its privileges");
console.log("Neon verification passed: real login, profile, 11 tables, private views, vector RPC, anonymous rejection and JWT signature checks.");
