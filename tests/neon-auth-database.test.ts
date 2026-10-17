import{beforeAll,afterAll,beforeEach,afterEach,describe,expect,it}from'vitest';
import{readFile}from'node:fs/promises';
import{PGlite}from'@electric-sql/pglite';
import{createDatabase,applyMigration}from'./helpers/database';
let db:PGlite;let migration:string;
const A='10000000-0000-4000-8000-000000000001',B='10000000-0000-4000-8000-000000000002',N='20000000-0000-4000-8000-000000000001',C='30000000-0000-4000-8000-000000000001';
async function auth(id:string){await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);await db.exec('set local role authenticated');}
async function denied(sql:string){await db.exec('savepoint denied');try{await expect(db.exec(sql)).rejects.toHaveProperty('code','42501');}finally{await db.exec('rollback to savepoint denied;release savepoint denied');}}
beforeAll(async()=>{
 db=await createDatabase();
 await applyMigration(db,'20261017050000_onboarding.sql');
 await db.exec(`create role anonymous nologin;create schema neon_auth;
 alter table auth.users add column created_at timestamptz default now(),add column updated_at timestamptz default now(),add column email_confirmed_at timestamptz,add column deleted_at timestamptz,add column is_anonymous boolean default false;
 create table neon_auth.user(id uuid primary key,name text not null,email text not null unique,"emailVerified" boolean not null,"createdAt" timestamptz not null,"updatedAt" timestamptz not null,banned boolean);
 `);
 await db.query("insert into auth.users(id,email,email_confirmed_at)values($1,'a@example.test',now()),($2,'b@example.test',now())",[A,B]);
 await db.query('insert into neon_auth.user(id,name,email,"emailVerified","createdAt","updatedAt")values($1,\'Neon A\',\'a@example.test\',false,now(),now()),($2,\'New C\',\'c@example.test\',true,now(),now())',[N,C]);
 migration=await readFile(new URL('../database/neon/20261017190000_neon_auth.sql',import.meta.url),'utf8');await db.exec(migration);
});
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback;reset role');});
describe('identités Neon : migration et isolation',()=>{
 it('importe les identifiants historiques sans copier de mot de passe',async()=>{expect((await db.query('select id from neon_auth.user where email=\'b@example.test\'')).rows).toEqual([{id:B}]);expect((await db.query('select neon_user_id,app_user_id from public.identity_mapping')).rows).toEqual([{neon_user_id:N,app_user_id:A}]);});
 it('bloque le compte recréé tant que son email n’est pas vérifié',async()=>{await auth(N);expect((await db.query('select auth.uid() as id')).rows).toEqual([{id:null}]);expect((await db.query('select id from public.profiles')).rows).toEqual([]);await denied('select public.ensure_app_user()');});
 it('récupère le profil historique après vérification et conserve l’isolation',async()=>{await db.query('update neon_auth.user set "emailVerified"=true where id=$1',[N]);await auth(N);expect((await db.query('select public.ensure_app_user() as ok')).rows).toEqual([{ok:true}]);expect((await db.query('select app_user_id from public.current_identity()')).rows).toEqual([{app_user_id:A}]);expect((await db.query('select id from public.profiles')).rows).toEqual([{id:A}]);await denied('select * from public.identity_mapping');await denied('select * from neon_auth.user');});
 it('initialise un nouvel utilisateur et ses comptes une seule fois',async()=>{await auth(C);await db.exec('select public.ensure_app_user();select public.ensure_app_user();');expect((await db.query('select id from public.profiles')).rows).toEqual([{id:C}]);expect((await db.query('select count(*)::int as count from public.accounts')).rows).toEqual([{count:1}]);});
 it('répare un profil manquant sans recréer les comptes existants',async()=>{await auth(B);await db.exec('delete from public.profiles;select public.ensure_app_user();');expect((await db.query('select count(*)::int as count from public.accounts')).rows).toEqual([{count:1}]);expect((await db.query('select count(*)::int as count from public.categories')).rows).toEqual([{count:14}]);});
 it('refuse un ancien identifiant sans identité Neon correspondante',async()=>{await auth(A);expect((await db.query('select auth.uid() as id')).rows).toEqual([{id:null}]);await denied('select public.ensure_app_user()');});
 it('une réapplication préserve les préférences modifiées',async()=>{await db.query("update public.profiles set last_name='Conservé' where id=$1",[A]);await db.exec(migration);expect((await db.query('select last_name from public.profiles where id=$1',[A])).rows).toEqual([{last_name:'Conservé'}]);});
});
