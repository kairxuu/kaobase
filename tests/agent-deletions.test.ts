import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, applyMigration } from "./helpers/database";

const A = "10000000-0000-0000-0000-000000000001";
const B = "10000000-0000-0000-0000-000000000002";
const CONVERSATION = "20000000-0000-0000-0000-000000000001";
const OTHER_CONVERSATION = "20000000-0000-0000-0000-000000000002";
const TASK = "30000000-0000-0000-0000-000000000001";
const OTHER_TASK = "30000000-0000-0000-0000-000000000002";
const TX = "40000000-0000-0000-0000-000000000001";

describe("confirmations de suppression ciblées et atomiques", () => {
  let db: PGlite;
  let categoryId: string;
  beforeAll(async () => {
    db = await createDatabase();
    await applyMigration(db, "20261017030000_agent_deletion_requests.sql");
    await db.query("insert into auth.users (id, email) values ($1, 'a@example.test'), ($2, 'b@example.test')", [A, B]);
    await db.query("insert into tasks (id, user_id, title, space) values ($1, $2, 'Tâche personnelle', 'perso'), ($3, $4, 'Tâche étrangère', 'pro')", [TASK, A, OTHER_TASK, B]);
    await db.query(`insert into transactions (id, user_id, account_id, booked_at, amount, label_raw, merchant, dedupe_hash)
      select $1, $2, id, '2026-10-17', -12.50, 'Boulangerie', 'BOULANGERIE', 'test' from accounts where user_id = $2 limit 1`, [TX, A]);
    categoryId = (await db.query<{ id: string }>("select id from categories where user_id = $1 and name = 'Alimentation'", [A])).rows[0].id;
    await db.query("insert into budgets (user_id, category_id, monthly_limit) values ($1, $2, 300)", [A, categoryId]);
  }, 30_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec("begin");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [A]);
    await db.exec("set local role authenticated");
  });
  afterEach(async () => { await db.exec("rollback"); });

  async function queue(kind = "task", target = TASK, space = "all") {
    return (await db.query<{ id: string; description: string }>(
      "select * from queue_agent_deletion($1, $2, $3, $4)", [kind, target, CONVERSATION, space],
    )).rows[0];
  }
  async function confirm(id: string, conversation = CONVERSATION) {
    return db.query("select * from confirm_agent_deletion($1, $2)", [id, conversation]);
  }
  async function rejected(action: () => Promise<unknown>) {
    await db.exec("savepoint rejected");
    try { await expect(action()).rejects.toMatchObject({ code: "P0002" }); }
    finally { await db.exec("rollback to savepoint rejected; release savepoint rejected"); }
  }

  it("prépare sans supprimer et réutilise la même demande", async () => {
    const first = await queue();
    expect(first.description).toContain("Tâche personnelle — perso — sans échéance");
    expect((await queue()).id).toBe(first.id);
    expect((await db.query("select id from tasks where id = $1", [TASK])).rows).toHaveLength(1);
  });
  it("supprime exactement la cible et interdit de rejouer la confirmation", async () => {
    const request = await queue();
    await confirm(request.id);
    expect((await db.query("select id from tasks where id = $1", [TASK])).rows).toHaveLength(0);
    expect((await db.query("select content from agent_messages where conversation_id = $1", [CONVERSATION])).rows).toEqual([
      { content: `Suppression confirmée : ${request.description}` },
    ]);
    await rejected(() => confirm(request.id));
  });
  it("refuse une autre conversation sans consommer la demande", async () => {
    const request = await queue();
    await rejected(() => confirm(request.id, OTHER_CONVERSATION));
    await confirm(request.id);
  });
  it("refuse les cibles et confirmations d'un autre utilisateur", async () => {
    await rejected(() => queue("task", OTHER_TASK));
    const request = await queue();
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [B]);
    await rejected(() => confirm(request.id));
  });
  it("refuse une cible hors de l'espace actif", async () => {
    await rejected(() => queue("task", TASK, "pro"));
    await rejected(() => queue("transaction", TX, "pro"));
  });
  it("refuse une demande expirée", async () => {
    const request = await queue();
    await db.query("update agent_deletion_requests set expires_at = now() - interval '1 second' where id = $1", [request.id]);
    await rejected(() => confirm(request.id));
    expect((await db.query("select id from tasks where id = $1", [TASK])).rows).toHaveLength(1);
  });
  it("refuse de supprimer un élément modifié depuis son aperçu", async () => {
    const request = await queue();
    await db.query("update tasks set title = 'Nouvelle tâche' where id = $1", [TASK]);
    await rejected(() => confirm(request.id));
    expect((await db.query("select title from tasks where id = $1", [TASK])).rows).toEqual([{ title: "Nouvelle tâche" }]);
  });
  it("invalide l'ancienne carte lorsqu'un autre onglet renouvelle un aperçu modifié", async () => {
    const old = await queue();
    await db.query("update tasks set title = 'Nouvelle tâche' where id = $1", [TASK]);
    const renewed = await queue();
    expect(renewed.id).not.toBe(old.id);
    await rejected(() => confirm(old.id));
    await confirm(renewed.id);
  });
  it("retire seulement la demande annulée et ne supprime aucune cible", async () => {
    const request = await queue();
    await db.query("delete from agent_deletion_requests where id = $1", [request.id]);
    await rejected(() => confirm(request.id));
    expect((await db.query("select id from tasks where id = $1", [TASK])).rows).toHaveLength(1);
  });
  it.each(["transaction", "budget"])("confirme une suppression %s avec son aperçu exact", async (kind) => {
    const request = await queue(kind, kind === "budget" ? categoryId : TX);
    expect(request.description).toContain(kind === "budget" ? "300.00 EUR/mois" : "-12.50 EUR");
    await confirm(request.id);
    const result = kind === "budget"
      ? await db.query("select id from budgets where category_id = $1", [categoryId])
      : await db.query("select id from transactions where id = $1", [TX]);
    expect(result.rows).toHaveLength(0);
  });
});
