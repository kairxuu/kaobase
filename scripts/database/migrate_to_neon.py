#!/usr/bin/env python3
"""Snapshot, merge and verify Supabase business data without deleting either source.

Requires PostgreSQL client tools. Connection secrets are read from ignored env
files and passed through PG* environment variables, never command arguments.
"""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / ".local/database-migrations"


def read_env(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("\"'")
    return values


def tool(name):
    result = shutil.which(name)
    if result:
        return result
    path = Path("/opt/homebrew/opt/libpq/bin") / name
    if path.exists():
        return str(path)
    raise RuntimeError(f"PostgreSQL client tool missing: {name}")


def pg_env(url, target=False):
    try:
        parsed = urlsplit(url)
        port = parsed.port or 5432
    except ValueError:
        raise RuntimeError("Invalid database connection URL; check the host, numeric port and URL-encoded password") from None
    if parsed.scheme not in ("postgres", "postgresql") or not parsed.hostname:
        raise RuntimeError("Invalid PostgreSQL connection configuration")
    if target and (not parsed.hostname.endswith(".neon.tech") or "-pooler" in parsed.hostname):
        raise RuntimeError("Target must be a direct, unpooled Neon connection")
    env = os.environ.copy()
    env.update(PGHOST=parsed.hostname, PGPORT=str(port),
               PGDATABASE=unquote(parsed.path.lstrip("/")), PGUSER=unquote(parsed.username or ""),
               PGPASSWORD=unquote(parsed.password or ""), PGSSLMODE="require", PGCONNECT_TIMEOUT="20",
               PGAPPNAME="kaobase-database-migration")
    return env


def run(args, env=None, sql=None):
    result = subprocess.run(args, env=env, input=sql, capture_output=True, text=True)
    if result.returncode:
        PRIVATE.mkdir(parents=True, exist_ok=True, mode=0o700)
        log = PRIVATE / "last-error.log"
        log.write_text(result.stderr)
        log.chmod(0o600)
        raise RuntimeError(f"Database command failed; private diagnostic: {log}")
    return result.stdout


def query(env, sql):
    return run([tool("psql"), "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1"], env, sql).strip()


def quoted(value):
    if not re.fullmatch(r"[a-z_][a-z_0-9]*", value):
        raise RuntimeError("Unsupported database identifier")
    return '"' + value + '"'


def dump_blocks(path):
    text = run([tool("pg_restore"), "--data-only", "--no-owner", "--no-acl", "--file=-", str(path)])
    blocks = {}
    for match in re.finditer(r"^COPY ([a-z_]+)\.([a-z_]+) \(([^\n]+)\) FROM stdin;\n(.*?)^\\\.$", text, re.M | re.S):
        schema, table, columns, rows = match.groups()
        blocks[(schema, table)] = ([col.strip().strip('"') for col in columns.split(",")], rows)
    if ("public", "profiles") not in blocks or ("auth", "users") not in blocks:
        raise RuntimeError("Snapshot must include public profiles and auth identities")
    return blocks


METADATA = """
select json_build_object(
 'keys', (select json_object_agg(t.relname, k.cols) from pg_class t
   join pg_namespace n on n.oid=t.relnamespace
   join lateral (select array_agg(a.attname order by u.ord) cols from pg_constraint c,
    unnest(c.conkey) with ordinality u(attnum,ord) join pg_attribute a on a.attrelid=t.oid and a.attnum=u.attnum
    where c.conrelid=t.oid and c.contype='p') k on true
   where n.nspname='public' and t.relkind='r'),
 'foreign', (select coalesce(json_agg(json_build_array(t.relname, p.relname)), '[]')
   from pg_constraint c join pg_class t on t.oid=c.conrelid join pg_class p on p.oid=c.confrelid
   join pg_namespace n on n.oid=t.relnamespace join pg_namespace pn on pn.oid=p.relnamespace
   where n.nspname='public' and pn.nspname='public' and c.contype='f'));
"""


def order_tables(tables, foreign):
    pending = set(tables)
    ordered = []
    while pending:
        ready = sorted(t for t in pending if not any(child == t and parent in pending and parent != t for child, parent in foreign))
        if not ready:
            raise RuntimeError("Cyclic foreign keys require an explicit migration plan")
        ordered.extend(ready)
        pending.difference_update(ready)
    return ordered


def verify_live(source, target):
    tables = json.loads(query(source, "select json_agg(tablename order by tablename) from pg_tables where schemaname='public';"))
    entries = []
    for table in tables:
        name = quoted(table)
        entries.append(f"'{table}',(select json_build_object('rows',count(*),'digest',md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),''))) from public.{name} t)")
    sql = "begin transaction isolation level repeatable read read only; set local timezone='UTC'; select json_build_object(" + ",".join(entries) + "); commit;"
    left = json.loads(query(source, sql))
    right = json.loads(query(target, sql))
    mismatches = [table for table in tables if left[table] != right[table]]
    if mismatches:
        raise RuntimeError("Live verification mismatch: " + ", ".join(mismatches))
    print(json.dumps({"live_verified": True, "tables": len(tables), "rows": sum(value["rows"] for value in left.values())}))


def upsert_block(schema, table, columns, body, keys):
    stage = "kb_" + table
    target = quoted(schema) + "." + quoted(table)
    names = ",".join(map(quoted, columns))
    key_names = ",".join(map(quoted, keys))
    updates = ",".join(f"{quoted(c)}=excluded.{quoted(c)}" for c in columns if c not in keys)
    action = "do update set " + updates if updates else "do nothing"
    key_match = " and ".join(f"t.{quoted(k)}=s.{quoted(k)}" for k in keys)
    left = ",".join("t." + quoted(c) for c in columns)
    right = ",".join("s." + quoted(c) for c in columns)
    return f"""
create temporary table {quoted(stage)} (like {target} including defaults including generated) on commit drop;
copy {quoted(stage)} ({names}) from stdin;
{body}\\.
insert into {target} ({names}) select {names} from {quoted(stage)} on conflict ({key_names}) {action};
do $verify$ begin
 if (select count(*) from {target}) <> (select count(*) from {quoted(stage)})
 then raise exception 'Destination contains additional rows in {schema}.{table}; review before merging'; end if;
 if exists(select 1 from {quoted(stage)} s where not exists(
   select 1 from {target} t where {key_match} and row({left}) is not distinct from row({right})))
 then raise exception 'Migration row verification failed for {schema}.{table}'; end if;
end $verify$;
"""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target-env-file", default=".env.local")
    parser.add_argument("--source-dump", help="Existing snapshot, for isolated validation only")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--verify-only", action="store_true", help="Compare current public data, including counts and canonical row hashes")
    args = parser.parse_args()
    source_values = read_env(ROOT / ".env.local")
    target_values = read_env(ROOT / args.target_env_file)
    if args.source_dump and args.target_env_file == ".env.local":
        raise RuntimeError("Existing snapshots are restricted to an explicitly isolated target")
    source = None if args.source_dump else pg_env(source_values["SUPABASE_DATABASE_URL"])
    target = pg_env(target_values["DATABASE_URL_UNPOOLED"], target=True)
    if source and (source["PGHOST"], source["PGDATABASE"]) == (target["PGHOST"], target["PGDATABASE"]):
        raise RuntimeError("Source and destination must be different databases")
    print("Source and destination connection checks:", query(source, "select 1;") if source else "local snapshot", query(target, "select 1;"))
    if args.verify_only:
        if not source:
            raise RuntimeError("Live verification requires a source connection")
        verify_live(source, target)
        return
    if not args.apply:
        print("Read-only checks passed. --apply creates snapshots, repairs permissions and merges data.")
        return
    PRIVATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    snapshot = ROOT / args.source_dump if args.source_dump else PRIVATE / f"supabase-{stamp}.dump"
    rollback = PRIVATE / f"neon-before-{stamp}.dump"
    backups = [(source, snapshot), (target, rollback)] if source else [(target, rollback)]
    for env, path in backups:
        run([tool("pg_dump"), "-Fc", "--no-owner", "--no-acl", "-f", str(path)], env)
        path.chmod(0o600)
    blocks = dump_blocks(snapshot)
    query(target, (ROOT / "database/neon/20261017080000_supabase_compatibility.sql").read_text())
    if query(target, "select to_regclass('public.app_oauth_connections') is null;") == "t":
        query(target, (ROOT / "supabase/migrations/20261017070000_app_oauth_connections.sql").read_text())
    metadata = json.loads(query(target, METADATA))
    tables = [table for schema, table in blocks if schema == "public"]
    ordered = order_tables(tables, metadata["foreign"])
    sql = "begin;\nset local lock_timeout='15s';\nset local search_path=pg_catalog,public,extensions;\nalter table auth.users disable trigger on_auth_user_created;\n"
    sql += "alter table public.app_shortcuts disable trigger app_shortcuts_updated_at;\n"
    columns, body = blocks[("auth", "users")]
    identity_columns = ["id", "email", "raw_user_meta_data", "created_at", "updated_at"]
    positions = [columns.index(col) for col in identity_columns]
    identity_body = "".join("\t".join(row.split("\t")[i] for i in positions) + "\n" for row in body.splitlines())
    sql += upsert_block("auth", "users", identity_columns, identity_body, ["id"])
    for table in ordered:
        columns, body = blocks[("public", table)]
        keys = metadata["keys"].get(table)
        if not keys:
            raise RuntimeError(f"Missing primary key for public.{table}")
        sql += upsert_block("public", table, columns, body, keys)
    sql += "alter table auth.users enable trigger on_auth_user_created;\nalter table public.app_shortcuts enable trigger app_shortcuts_updated_at;\ncommit;\n"
    query(target, sql)
    report = {"snapshot": str(snapshot.relative_to(ROOT)), "rollback": str(rollback.relative_to(ROOT)),
              "tables": {table: len(blocks[("public", table)][1].splitlines()) for table in sorted(tables)},
              "identity_count": len(identity_body.splitlines()), "verified": True,
              "target_host": target["PGHOST"], "completed_at": stamp}
    path = PRIVATE / f"report-{stamp}.json"
    path.write_text(json.dumps(report, indent=2) + "\n")
    path.chmod(0o600)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, KeyError) as error:
        raise SystemExit(str(error)) from None
