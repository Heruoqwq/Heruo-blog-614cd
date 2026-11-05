type Bindings = { DB?: D1Database; BUCKET?: R2Bucket; ADMIN_PASSWORD_HASH?: string; BLOG_ALLOWED_ORIGIN?: string; JUDGE0_URL?: string; JUDGE0_TOKEN?: string; JUDGE0_LANGUAGE_ID?: string };
type Permission = "users" | "posts" | "solutions" | "problems" | "discussions";
type Account = { id: number; username: string; display_name: string; role: "user" | "superadmin"; disabled: number; password_hash: string; created_at: string; permissions?: Permission[]; session_expires?: number };
const permissions: Permission[] = ["users", "posts", "solutions", "problems", "discussions"];
const encoder = new TextEncoder();
const DAY = 86400000;
const owners = new WeakMap<D1Database, Promise<void>>();
class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
const hex = (buf: ArrayBuffer | Uint8Array) => [...new Uint8Array(buf)].map((v) => v.toString(16).padStart(2, "0")).join("");
const sha = async (value: string) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
const account = (u: Account) => ({ id: u.id, username: u.username, display_name: u.display_name, role: u.role, permissions: superuser(u) ? permissions : u.permissions || [] });
const superuser = (u: Account | null) => u?.id === 1 && u.role === "superadmin";
const can = (u: Account | null, permission: Permission) => Boolean(u && !u.disabled && (superuser(u) || u.permissions?.includes(permission)));
async function loadPermissions(db: D1Database, u: Account) {
  u.permissions = (await db.prepare("SELECT permission FROM user_permissions WHERE user_id=? ORDER BY permission").bind(u.id).all<{ permission: Permission }>()).results.map((r) => r.permission);
  return u;
}
async function activeSanction(db: D1Database, id: number, kind: string, now = Date.now()) {
  return db.prepare("SELECT id,reason,expires_at FROM sanctions WHERE user_id=? AND kind=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?) LIMIT 1").bind(id, kind, now).first();
}
async function writable(db: D1Database, u: Account) {
  if (await activeSanction(db, u.id, "mute")) throw new ApiError(403, "账号正在禁言中");
}
async function protectAccount(db: D1Database, actor: Account, target: number) {
  if (target === 1 || target === actor.id) throw new ApiError(400, "不能对自己或超级管理员执行此操作");
  if (!superuser(actor) && await db.prepare("SELECT user_id FROM user_permissions WHERE user_id=? LIMIT 1").bind(target).first()) throw new ApiError(403, "管理人员的账号只能由超级管理员处理");
}
const postSelect = "SELECT p.*,COALESCE(p.author_id,1) AS author_id,COALESCE(u.display_name,'Heruo') AS author_name FROM posts p LEFT JOIN users u ON u.id=COALESCE(p.author_id,1)";
function equal(a: string, b: string) {
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}
async function derive(password: string, salt: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", salt: encoder.encode(salt), iterations: 100000, hash: "SHA-256" }, key, 256));
}
async function checkPassword(password: string, stored: string) {
  const [kind, rounds, salt, expected] = stored.split(":");
  if (kind !== "pbkdf2" || !salt || !/^[a-f0-9]{64}$/.test(expected || "") || +rounds !== 100000) return false;
  return equal(await derive(password, salt), expected);
}
async function passwordHash(password: string) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
  return "pbkdf2:100000:" + salt + ":" + await derive(password, salt);
}
async function ensureOwner(db: D1Database, hash: string, stamp: string) {
  let ready = owners.get(db);
  if (!ready) {
    ready = db.prepare("INSERT INTO users(id,username,display_name,password_hash,role,disabled,created_at) VALUES(1,'heruo','Heruo',?,'superadmin',0,?) ON CONFLICT(id) DO NOTHING").bind(hash, stamp).run().then(() => {});
    owners.set(db, ready);
    ready.catch(() => owners.delete(db));
  }
  await ready;
}
async function body(request: Request) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new ApiError(415, "提交格式不正确");
  const raw = await request.text();
  if (encoder.encode(raw).byteLength > 600000) throw new ApiError(413, "内容不能超过 500 KB");
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch { throw new ApiError(400, "提交格式不正确"); }
}
function field(value: unknown, name: string, limit: number, required = true) {
  if (typeof value !== "string" || (required && !value.trim()) || value.length > limit) throw new ApiError(400, name + "不能为空或超过 " + limit + " 个字符");
  return value.trim();
}
function passwordInput(value: unknown, register: boolean) {
  if (typeof value !== "string" || !value || value.length > 200 || (register && value.length < 8)) throw new ApiError(400, register ? "密码需要 8–200 个字符" : "密码不正确");
  return value;
}
function postInput(value: Record<string, unknown>) {
  const title = field(value.title, "标题", 150);
  const content = field(value.content, "正文", 150000);
  const excerpt = field(value.excerpt ?? "", "摘要", 400, false);
  const category = field(value.category || "随笔", "分类", 30);
  if (!Array.isArray(value.tags) || value.tags.length > 10 || value.tags.some((t) => typeof t !== "string" || t.length > 25)) throw new ApiError(400, "最多 10 个标签，每个不超过 25 字");
  const tags = JSON.stringify([...new Set((value.tags as string[]).map((t) => t.trim()).filter(Boolean))]);
  if (value.status !== "published" && value.status !== "draft") throw new ApiError(400, "文章状态不正确");
  return { title, content, excerpt, category, tags, status: value.status };
}
function unpack(row: Record<string, unknown>) { return { ...row, featured: Boolean(row.featured), tags: JSON.parse(String(row.tags || "[]")) }; }
async function rateLimit(db: D1Database, request: Request, kind: string, max: number, now: number) {
  const key = await sha(kind + ":" + (request.headers.get("cf-connecting-ip") || "shared"));
  const start = now - 15 * 60 * 1000;
  const row = await db.prepare("INSERT INTO login_limits(key,window_start,attempts) VALUES(?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END,attempts=CASE WHEN window_start<? THEN 1 ELSE attempts+1 END RETURNING attempts").bind(key, now, start, start).first<{ attempts: number }>();
  if ((row?.attempts || 0) > max) throw new ApiError(429, "操作频繁，请 15 分钟后重试");
}
async function createSession(db: D1Database, u: Account, now: number) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at<=?").bind(now),
    db.prepare("DELETE FROM login_limits WHERE window_start<?").bind(now - DAY),
    db.prepare("INSERT INTO sessions(token_hash,expires_at,user_id) VALUES(?,?,?)").bind(await sha(token), now + 30 * DAY, u.id),
  ]);
  return { token, expiresAt: now + 30 * DAY, user: account(await loadPermissions(db, u)) };
}
export async function handleApi(request: Request, env: Bindings): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("origin");
  const allowed = !origin || origin === url.origin || origin === env.BLOG_ALLOWED_ORIGIN;
  const headers: Record<string, string> = {
    "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff", "Vary": "Origin", "Referrer-Policy": "no-referrer",
  };
  if (allowed && origin) headers["Access-Control-Allow-Origin"] = origin;
  headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization";
  const reply = (data: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers });
  try {
    if (!allowed) throw new ApiError(403, "此来源未获授权");
    if (request.method === "OPTIONS") return reply(null, 204);
    if (!env.DB) throw new ApiError(503, "数据库尚未就绪");
    const db = env.DB;
    const path = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
    const now = Date.now();
    const stamp = new Date(now).toISOString();
    await ensureOwner(db, env.ADMIN_PASSWORD_HASH || "", stamp);
    const token = request.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    const tokenHash = token ? await sha(token) : "";
    let user = tokenHash ? await db.prepare("SELECT u.*,s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id=COALESCE(s.user_id,1) WHERE s.token_hash=? AND s.expires_at>? AND u.disabled=0 AND NOT EXISTS(SELECT 1 FROM sanctions b WHERE b.user_id=u.id AND b.kind='ban' AND b.revoked_at IS NULL AND (b.expires_at IS NULL OR b.expires_at>?))").bind(tokenHash, now, now).first<Account>() : null;
    if (user) {
      await loadPermissions(db, user);
      if ((user.session_expires || 0) < now + 23 * DAY) {
        await db.prepare("UPDATE sessions SET expires_at=? WHERE token_hash=? AND expires_at>?").bind(now + 30 * DAY, tokenHash, now).run();
        user.session_expires = now + 30 * DAY;
      }
    }
    const signedIn = () => { if (!user) throw new ApiError(401, "请先登录"); return user; };
    const administrator = () => { signedIn(); if (!superuser(user)) throw new ApiError(403, "需要超级管理员权限"); };
    const manager = (permission: Permission) => { signedIn(); if (!can(user, permission)) throw new ApiError(403, "没有此项管理权限"); };
    if (/^(teams|discussions|solutions|sanctions)(\/|$)/.test(path)) return await handleCommunity(request, db, user, path, reply);
    if (path === "oj" || path.startsWith("oj/")) return await handleOj(request, env, db, user, path.slice(2).replace(/^\//, ""), reply);
    if (path === "auth/session" && request.method === "GET") return reply({ authenticated: Boolean(user), user: user ? account(user) : null, expiresAt: user?.session_expires || null });
    if (path === "auth/register" && request.method === "POST") {
      await rateLimit(db, request, "register", 10, now);
      const value = await body(request);
      const name = field(value.username, "用户名", 24);
      if (!/^[a-zA-Z][a-zA-Z0-9_]{2,23}$/.test(name)) throw new ApiError(400, "用户名需以字母开头，含 3–24 位字母、数字或下划线");
      const password = passwordInput(value.password, true);
      if (await db.prepare("SELECT id FROM users WHERE username=?").bind(name.toLowerCase()).first()) throw new ApiError(409, "用户名已存在");
      const u = await db.prepare("INSERT INTO users(username,display_name,password_hash,role,disabled,created_at) VALUES(?,?,?,'user',0,?) ON CONFLICT(username) DO NOTHING RETURNING *").bind(name.toLowerCase(), name, await passwordHash(password), stamp).first<Account>();
      if (!u) throw new ApiError(409, "用户名已存在");
      return reply(await createSession(db, u, now), 201);
    }
    if (path === "auth/login" && request.method === "POST") {
      await rateLimit(db, request, "login", 10, now);
      const value = await body(request);
      // The previous password-only login continues to mean the owner's account.
      const name = value.username === undefined ? "heruo" : field(value.username, "用户名或 ID", 24).toLowerCase();
      const password = passwordInput(value.password, false);
      const u = /^\d+$/.test(name) && Number.isSafeInteger(Number(name))
        ? await db.prepare("SELECT * FROM users WHERE id=?").bind(Number(name)).first<Account>()
        : await db.prepare("SELECT * FROM users WHERE username=?").bind(name).first<Account>();
      const stored = u?.password_hash || (u?.id === 1 ? env.ADMIN_PASSWORD_HASH : "") || "pbkdf2:100000:unconfigured:" + "0".repeat(64);
      const valid = await checkPassword(password, stored);
      if (!u || !valid || u.disabled) throw new ApiError(401, "账号或密码不正确");
      if (await activeSanction(db, u.id, "ban", now)) throw new ApiError(403, "账号已被封禁，请查看陶片放逐记录");
      return reply(await createSession(db, u, now));
    }
    if (path === "auth/logout" && request.method === "POST") {
      if (tokenHash) await db.prepare("DELETE FROM sessions WHERE token_hash=?").bind(tokenHash).run();
      return reply({ ok: true });
    }
    if (path === "users") {
      manager("users");
      if (request.method === "GET") {
        const rows = await db.prepare("SELECT id,username,display_name,role,disabled,created_at FROM users ORDER BY id").all();
        const grants = (await db.prepare("SELECT user_id,permission FROM user_permissions").all<{ user_id: number; permission: string }>()).results;
        return reply({ users: rows.results.map((u) => ({ ...u, disabled: Boolean(u.disabled), permissions: u.id === 1 ? permissions : grants.filter((g) => g.user_id === u.id).map((g) => g.permission) })) });
      }
    }
    const userMatch = path.match(/^users\/([1-9]\d{0,14})(\/permissions)?$/);
    if (userMatch) {
      manager("users");
      if (request.method === "PATCH") {
        const id = Number(userMatch[1]);
        if (userMatch[2]) {
          administrator();
          if (id === 1) throw new ApiError(400, "超级管理员始终拥有全部权限");
          const grants = (await body(request)).permissions;
          if (!Array.isArray(grants) || grants.length > 5 || grants.some((p) => !permissions.includes(p as Permission))) throw new ApiError(400, "权限列表不正确");
          if (!await db.prepare("SELECT id FROM users WHERE id=?").bind(id).first()) throw new ApiError(404, "账号不存在");
          await db.batch([db.prepare("DELETE FROM user_permissions WHERE user_id=?").bind(id), ...[...new Set(grants)].map((p) => db.prepare("INSERT INTO user_permissions(user_id,permission) VALUES(?,?)").bind(id, p))]);
          return reply({ ok: true });
        }
        if (id === 1) throw new ApiError(400, "不能停用超级管理员");
        const disabled = (await body(request)).disabled;
        if (typeof disabled !== "boolean") throw new ApiError(400, "账号状态不正确");
        const u = await db.prepare("SELECT id FROM users WHERE id=?").bind(id).first();
        if (!u) throw new ApiError(404, "账号不存在");
        await protectAccount(db, user!, id);
        const changes = [db.prepare("UPDATE users SET disabled=? WHERE id=?").bind(disabled ? 1 : 0, id)];
        if (disabled) changes.push(db.prepare("DELETE FROM sessions WHERE user_id=?").bind(id));
        await db.batch(changes);
        return reply({ ok: true });
      }
    }
    const profileMatch = path.match(/^profiles\/([1-9]\d{0,14})$/);
    if (profileMatch && request.method === "GET") {
      const id = Number(profileMatch[1]);
      const profile = await db.prepare("SELECT id,username,display_name,role,created_at FROM users WHERE id=? AND disabled=0").bind(id).first();
      if (!profile) throw new ApiError(404, "用户不存在");
      const articles = await db.prepare(postSelect + " WHERE COALESCE(p.author_id,1)=? AND p.status='published' ORDER BY p.created_at DESC,p.id DESC").bind(id).all();
      const solved = await db.prepare("SELECT p.id,p.code,p.title,MIN(s.created_at) AS solved_at FROM oj_submissions s JOIN oj_problems p ON p.id=s.problem_id WHERE s.user_id=? AND s.status='AC' AND p.published=1 AND p.team_id IS NULL GROUP BY p.id ORDER BY p.id").bind(id).all();
      return reply({ user: profile, posts: articles.results.map(unpack), solved: solved.results });
    }
    const featureMatch = path.match(/^posts\/([a-z0-9-]{36})\/feature$/);
    if (featureMatch && request.method === "PATCH") {
      manager("posts");
      const featured = (await body(request)).featured;
      if (typeof featured !== "boolean") throw new ApiError(400, "推荐状态不正确");
      const post = await db.prepare("SELECT status FROM posts WHERE id=?").bind(featureMatch[1]).first<{ status: string }>();
      if (!post) throw new ApiError(404, "文章不存在");
      if (featured && post.status !== "published") throw new ApiError(400, "请先发布文章");
      await db.prepare("UPDATE posts SET featured=? WHERE id=?").bind(featured ? 1 : 0, featureMatch[1]).run();
      return reply({ ok: true });
    }
    if (path === "posts" && request.method === "GET") {
      const all = url.searchParams.get("all") === "1";
      const mine = url.searchParams.get("mine") === "1";
      if (all || mine) signedIn();
      const where = all ? (can(user, "posts") && !mine ? "" : " WHERE COALESCE(p.author_id,1)=?") : mine ? " WHERE COALESCE(p.author_id,1)=?" : " WHERE p.status='published'";
      const query = db.prepare(postSelect + where + " ORDER BY p.created_at DESC,p.id DESC");
      const rows = await (where.includes("?") ? query.bind(user!.id) : query).all();
      return reply({ posts: rows.results.map(unpack) });
    }
    if (path === "posts" && request.method === "POST") {
      const u = signedIn();
      await writable(db, u);
      const value = await body(request);
      if (value.featured && !can(user, "posts")) throw new ApiError(403, "需要文章管理权限");
      const p = postInput(value);
      const featured = can(user, "posts") && value.featured === true && p.status === "published" ? 1 : 0;
      const id = crypto.randomUUID();
      await db.prepare("INSERT INTO posts(id,title,content,excerpt,category,tags,status,created_at,updated_at,author_id,featured) VALUES(?,?,?,?,?,?,?,?,?,?,?)").bind(id, p.title, p.content, p.excerpt, p.category, p.tags, p.status, stamp, stamp, u.id, featured).run();
      return reply({ post: unpack({ id, ...p, created_at: stamp, updated_at: stamp, author_id: u.id, author_name: u.display_name, featured }) }, 201);
    }
    const postMatch = path.match(/^posts\/([a-z0-9-]{36})$/);
    if (postMatch) {
      const id = postMatch[1];
      const row = await db.prepare(postSelect + " WHERE p.id=?").bind(id).first<Record<string, unknown>>();
      const owns = row && user?.id === row.author_id;
      if (request.method !== "GET") signedIn();
      if (!row || ((request.method !== "GET" || row.status !== "published") && !owns && !can(user, "posts"))) throw new ApiError(404, "文章不存在");
      if (request.method === "GET") return reply({ post: unpack(row) });
      if (request.method === "PATCH") {
        await writable(db, user!);
        const value = await body(request);
        if (value.featured !== undefined && Boolean(value.featured) !== Boolean(row.featured) && !can(user, "posts")) throw new ApiError(403, "需要文章管理权限");
        const p = postInput(value);
        const featured = p.status !== "published" ? 0 : can(user, "posts") && typeof value.featured === "boolean" ? Number(value.featured) : Number(row.featured);
        await db.prepare("UPDATE posts SET title=?,content=?,excerpt=?,category=?,tags=?,status=?,updated_at=?,featured=? WHERE id=?").bind(p.title, p.content, p.excerpt, p.category, p.tags, p.status, stamp, featured, id).run();
        return reply({ post: unpack({ ...row, ...p, featured, updated_at: stamp }) });
      }
      if (request.method === "DELETE") {
        await db.prepare("DELETE FROM posts WHERE id=?").bind(id).run();
        return reply({ ok: true });
      }
    }
    if (path === "tasks") {
      const u = signedIn();
      if (request.method === "GET") {
        const rows = await db.prepare("SELECT *,COALESCE(user_id,1) AS user_id FROM tasks WHERE COALESCE(user_id,1)=? ORDER BY created_at DESC,id DESC").bind(u.id).all();
        return reply({ tasks: rows.results.map((t) => ({ ...t, done: Boolean(t.done) })) });
      }
      if (request.method === "POST") {
        const title = field((await body(request)).title, "任务", 250);
        const id = crypto.randomUUID();
        await db.prepare("INSERT INTO tasks(id,title,done,created_at,updated_at,user_id) VALUES(?,?,0,?,?,?)").bind(id, title, stamp, stamp, u.id).run();
        return reply({ task: { id, title, done: false, created_at: stamp, updated_at: stamp, user_id: u.id } }, 201);
      }
    }
    const taskMatch = path.match(/^tasks\/([a-z0-9-]{36})$/);
    if (taskMatch) {
      const u = signedIn();
      const id = taskMatch[1];
      const row = await db.prepare("SELECT * FROM tasks WHERE id=? AND COALESCE(user_id,1)=?").bind(id, u.id).first();
      if (!row) throw new ApiError(404, "任务不存在");
      if (request.method === "PATCH") {
        const done = (await body(request)).done;
        if (typeof done !== "boolean") throw new ApiError(400, "任务状态不正确");
        await db.prepare("UPDATE tasks SET done=?,updated_at=? WHERE id=? AND COALESCE(user_id,1)=?").bind(done ? 1 : 0, stamp, id, u.id).run();
        return reply({ task: { ...row, done, updated_at: stamp } });
      }
      if (request.method === "DELETE") {
        await db.prepare("DELETE FROM tasks WHERE id=? AND COALESCE(user_id,1)=?").bind(id, u.id).run();
        return reply({ ok: true });
      }
    }
    throw new ApiError(404, "接口不存在");
  } catch (error) {
    if (error instanceof ApiError) return reply({ error: error.message }, error.status);
    console.error("Blog API error", error instanceof Error ? error.message : "Unknown failure");
    return reply({ error: "服务暂时不可用，请稍后重试" }, 500);
  }
}
type OjProblem = { team_id: string | null; checker: string; scoring: string; id: number; code: string; title: string; statement: string; editorial: string; editorial_published: number; difficulty: number; difficulty_tier: number; quality: number; quality_note: string; samples: string; time_limit: number; memory_limit: number; published: number; revision: number; created_at: string; updated_at: string };
type OjFile = { team_id: string | null; id: string; user_id: number; name: string; size: number };
type OjCase = { group?: number; input: string; output: string; weight: number; position: number; input_file?: string | null; output_file?: string | null; input_size?: number; output_size?: number; input_name?: string | null; output_name?: string | null };
const MAX_FILE = 16 * 1024 * 1024;
const MAX_DATA = 256 * 1024 * 1024;
const caseSelect = "SELECT c.input,c.output,c.weight,c.position,c.group_id AS [group],c.input_file,c.output_file,i.name AS input_name,o.name AS output_name,COALESCE(i.size,length(CAST(c.input AS BLOB))) AS input_size,COALESCE(o.size,length(CAST(c.output AS BLOB))) AS output_size FROM oj_cases c LEFT JOIN oj_files i ON i.id=c.input_file LEFT JOIN oj_files o ON o.id=c.output_file";
type OjDetail = { group?: number; index: number; weight: number; status: string; time: number; memory: number };
type OjSubmission = { checker: string; scoring: string; expected_outputs: string; id: string; user_id: number; problem_id: number; problem_code: string; problem_title: string; source: string; revision: number; status: string; score: number; passed: number; total: number; time: number; memory: number; details: string; compile_log: string; judge_tokens: string; judge_error: string; judge_attempts: number; judge_started_at: number; judge_url: string; time_limit: number; memory_limit: number; lease_until: number; created_at: string; updated_at: string };
const ojSeeds = new WeakMap<D1Database, Promise<void>>();
const waitingJudge = (s: string) => s === "QUEUED" || s === "JUDGING";
function integer(value: unknown, label: string, lo: number, hi: number) {
  if (!Number.isInteger(value) || Number(value) < lo || Number(value) > hi) throw new ApiError(400, label + "须在 " + lo + "～" + hi + " 之间");
  return Number(value);
}
async function problemRights(db: D1Database, p: { team_id?: string | null; published: number }, user: Account | null) {
  if (!p.team_id) return { view: Boolean(p.published) || Boolean(superuser(user)), manage: can(user, "problems"), editorial: can(user, "solutions") };
  const t = await teamAccess(db, p.team_id, user, true);
  return { view: Boolean(p.published) || teamStaff(t), manage: teamStaff(t), editorial: teamStaff(t) };
}
function plainText(value: unknown, label: string, max: number) {
  if (typeof value !== "string" || value.length > max) throw new ApiError(400, label + "格式不正确或过长");
  return value;
}
function ojAssessment(value: Record<string, unknown>, previous?: OjProblem) {
  const difficulty = integer(value.difficulty === undefined ? previous?.difficulty ?? 0 : value.difficulty, "难度", 0, 7);
  const defaultTier = difficulty ? previous?.difficulty_tier || 2 : 0;
  const difficulty_tier = integer(value.difficulty_tier === undefined ? defaultTier : value.difficulty_tier, "难度档位", 0, 3);
  if (Boolean(difficulty) !== Boolean(difficulty_tier)) throw new ApiError(400, "请为已评定难度选择下位、中位或上位");
  const quality = integer(value.quality === undefined ? previous?.quality ?? 0 : value.quality, "质量等级", 0, 4);
  const quality_note = field(value.quality_note === undefined ? previous?.quality_note ?? "" : value.quality_note, "质量简评", 1000, false);
  return { difficulty, difficulty_tier, quality, quality_note };
}
async function ojInput(value: Record<string, unknown>, db: D1Database, previous?: OjProblem, actor?: Account | null, teamId: string | null = null) {
  const checker = value.checker ?? "text", scoring = value.scoring ?? "weighted";
  if (!["text", "casefold"].includes(String(checker)) || !["weighted", "all", "groups"].includes(String(scoring))) throw new ApiError(400, "评测规则不正确");
  const code = field(value.code, "题号", 24).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9_-]{0,23}$/.test(code)) throw new ApiError(400, "题号只能包含字母、数字、下划线和连字符");
  const title = field(value.title, "题目名称", 100);
  const statement = field(value.statement, "题面", 100000);
  const time_limit = integer(value.time_limit, "时间限制（毫秒）", 100, 5000);
  const memory_limit = integer(value.memory_limit, "内存限制（MB）", 16, 512);
  if (typeof value.published !== "boolean") throw new ApiError(400, "发布状态不正确");
  if (!Array.isArray(value.samples) || value.samples.length > 5) throw new ApiError(400, "最多 5 组样例");
  const samples = value.samples.map((s) => {
    if (!s || typeof s !== "object") throw new ApiError(400, "样例格式不正确");
    return { input: plainText(s.input, "样例输入", 10000), output: plainText(s.output, "样例输出", 10000) };
  });
  if (!Array.isArray(value.cases) || value.cases.length < 1 || value.cases.length > 50) throw new ApiError(400, "测试点需要 1～50 组");
  const cases: OjCase[] = value.cases.map((s, i) => {
    if (!s || typeof s !== "object") throw new ApiError(400, "测试点格式不正确");
    const ref = (v: unknown) => { if (v == null || v === "") return null; if (typeof v !== "string" || !/^[a-f0-9-]{36}$/.test(v)) throw new ApiError(400, "测试文件编号不正确"); return v; };
    const input_file = ref(s.input_file), output_file = ref(s.output_file);
    return { input: input_file ? "" : plainText(s.input, "测试输入", 400000), output: output_file ? "" : plainText(s.output, "测试输出", 400000), input_file, output_file, group: integer(s.group ?? 1, "子任务编号", 1, 50), weight: integer(s.weight ?? 1, "权重", 1, 100), position: i + 1 };
  });
  if (encoder.encode(JSON.stringify(cases)).byteLength > 500000) throw new ApiError(400, "文本数据过大，请使用文件上传");
  const refs = [...new Set(cases.flatMap((c) => [c.input_file, c.output_file]).filter((v): v is string => Boolean(v)))];
  const files = refs.length ? (await db.prepare("SELECT f.id,f.size FROM oj_files f WHERE f.team_id IS ? AND (f.user_id=? OR ?=1 OR ? IS NOT NULL OR EXISTS(SELECT 1 FROM oj_cases c JOIN oj_problems p ON p.id=c.problem_id WHERE p.published=1 AND p.team_id IS NULL AND (c.input_file=f.id OR c.output_file=f.id))) AND f.id IN (" + refs.map(() => "?").join(",") + ")").bind(teamId, actor?.id || 1, Number(!actor || superuser(actor)), teamId, ...refs).all<{ id: string; size: number }>()).results : [];
  const sizes = new Map(files.map((f) => [f.id, f.size]));
  if (files.length !== refs.length) throw new ApiError(400, "测试文件不存在，请重新上传");
  let total = 0;
  const groups = new Map<number, number>();
  for (const c of cases) {
    if (scoring === "groups") {
      const previous = groups.get(c.group!);
      if (previous !== undefined && previous !== c.weight) throw new ApiError(400, "同一子任务的分值必须一致");
      groups.set(c.group!, c.weight);
    }
    if (checker === "casefold" && (c.output_file ? sizes.get(c.output_file)! : encoder.encode(c.output).byteLength) > 4000) throw new ApiError(400, "忽略大小写模式下每点预期输出不能超过 4000 字节");
    const size = (c.input_file ? sizes.get(c.input_file)! : encoder.encode(c.input).byteLength) + (c.output_file ? sizes.get(c.output_file)! : encoder.encode(c.output).byteLength);
    if (size > MAX_FILE) throw new ApiError(400, "每点输入与输出合计不能超过 16 MiB");
    total += size;
  }
  if (total > MAX_DATA) throw new ApiError(400, "测试数据合计不能超过 256 MiB");
  return { ...ojAssessment(value, previous), code, title, statement, time_limit, memory_limit, checker: String(checker), scoring: String(scoring), published: value.published ? 1 : 0, samples: JSON.stringify(samples), cases };
}
function splitDraftEditorial(statement: string) {
  const marker = "\n\n:::info[出题备忘 · 公开前移除]\n";
  const end = "\n:::";
  const content = statement.trimEnd();
  const start = content.lastIndexOf(marker);
  if (start < 0 || !content.endsWith(end)) return { statement, draft: "" };
  return { statement: content.slice(0, start).trimEnd(), draft: content.slice(start + marker.length, -end.length).trim() };
}
function publicProblem(p: OjProblem, canEdit = false) {
  const { editorial, editorial_published, ...problem } = p;
  const { statement, draft } = splitDraftEditorial(problem.statement);
  const isPublic = Boolean(problem.published && editorial_published && editorial);
  return {
    ...problem, code: p.team_id ? p.code.slice(38) : p.code, statement, samples: JSON.parse(problem.samples), published: Boolean(problem.published),
    ...(canEdit || isPublic ? { editorial: editorial || draft, editorial_published: Boolean(editorial && editorial_published) } : {}),
  };
}
function publicSubmission(s: OjSubmission, owner: boolean) {
  return { id: s.id, user_id: s.user_id, problem_id: s.problem_id, problem_code: s.problem_code, problem_title: s.problem_title, revision: s.revision, language: "C++17", checker: s.checker, scoring: s.scoring, status: s.status, score: s.score, passed: s.passed, total: s.total, time: s.time, memory: s.memory, created_at: s.created_at, updated_at: s.updated_at, ...(owner ? { source: s.source, time_limit: s.time_limit, memory_limit: s.memory_limit, details: JSON.parse(s.details), compile_log: s.compile_log, judge_error: s.judge_error } : {}) };
}
async function ensureOj(db: D1Database) {
  let ready = ojSeeds.get(db);
  if (!ready) {
    ready = (async () => {
      const stamp = new Date().toISOString();
      const statement = "## 题目描述\n\n给定两个整数 $a,b$，输出它们的和。\n\n## 输入格式\n\n一行两个整数 $a,b$。\n\n## 输出格式\n\n输出一个整数 $a+b$。\n\n## 数据范围\n\n$-10^9\\le a,b\\le10^9$。\n\n## 说明/提示\n\n样例中 $1+2=3$。";
      const row = await db.prepare("INSERT INTO oj_problems(id,code,title,statement,samples,time_limit,memory_limit,published,created_at,updated_at) VALUES(1,'A1000','A+B',?,?,1000,256,1,?,?) ON CONFLICT(id) DO NOTHING RETURNING id").bind(statement, JSON.stringify([{ input: "1 2\n", output: "3\n" }]), stamp, stamp).first();
      if (row) await db.batch([["1 2\n", "3\n"], ["-5 8\n", "3\n"], ["0 0\n", "0\n"], ["1000000000 1000000000\n", "2000000000\n"]].map(([input, output], i) => db.prepare("INSERT INTO oj_cases(id,problem_id,position,input,output,weight) VALUES(?,1,?,?,?,1)").bind(crypto.randomUUID(), i + 1, input, output)));
    })();
    ojSeeds.set(db, ready);
    ready.catch(() => ojSeeds.delete(db));
  }
  await ready;
}
function judgeUrl(env: Bindings) {
  let url: URL;
  try { url = new URL(env.JUDGE0_URL || "https://ce.judge0.com"); } catch { throw new ApiError(503, "评测服务配置不正确"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new ApiError(503, "评测服务需要有效的 HTTPS 地址");
  return url.href.replace(/\/$/, "");
}
function base64(value: string) {
  const bytes = encoder.encode(value);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
function compileText(value: unknown) {
  if (typeof value !== "string" || value.length > 50000) return "";
  try { return new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0))).slice(0, 8000); } catch { return ""; }
}
class JudgeServiceError extends Error {}
function judgeFailure(error: unknown) {
  if (error instanceof JudgeServiceError) return error.message;
  if (error instanceof Error && /timeout|timed out|abort/i.test(error.name + " " + error.message)) return "连接评测服务超时";
  return "无法连接评测服务";
}
async function dispatchJudge(db: D1Database, env: Bindings, submission: OjSubmission, tests: OjCase[]) {
  const now = Date.now();
  const details: OjDetail[] = JSON.parse(submission.details).map((d: OjDetail) => ({ ...d, status: "QUEUED", time: 0, memory: 0 }));
  const claimed = await db.prepare("UPDATE oj_submissions SET status='QUEUED',judge_tokens='[]',details=?,score=0,passed=0,time=0,memory=0,compile_log='',judge_error='',judge_started_at=?,judge_attempts=judge_attempts+1,lease_until=? WHERE id=? AND judge_attempts=? AND status IN ('QUEUED','JE') RETURNING *").bind(JSON.stringify(details), now, now + 600000, submission.id, submission.judge_attempts).first<OjSubmission>();
  if (!claimed) return (await db.prepare("SELECT * FROM oj_submissions WHERE id=?").bind(submission.id).first<OjSubmission>()) || submission;
  try {
    const language = Number(env.JUDGE0_LANGUAGE_ID || 105);
    if (!Number.isInteger(language) || language < 1) throw new JudgeServiceError("评测语言配置不正确");
    const tokens: string[] = [];
    for (let start = 0; start < tests.length;) {
      const group: OjCase[] = [];
      let bytes = 0;
      while (start < tests.length && group.length < 20) {
        const c = tests[start];
        const size = (c.input_size ?? encoder.encode(c.input).byteLength) + (c.output_size ?? encoder.encode(c.output).byteLength);
        if (group.length && bytes + size > 2 * 1024 * 1024) break;
        bytes += size; group.push(c); start++;
      }
      const jobs = [];
      for (const c of group) {
        const read = async (file: string | null | undefined, text: string) => {
          if (!file) return text;
          const object = await env.BUCKET?.get("oj/data/" + file);
          if (!object) throw new JudgeServiceError("测试文件不存在");
          return object.text();
        };
        jobs.push({ source_code: base64(submission.source), language_id: language, stdin: base64(await read(c.input_file, c.input)), expected_output: base64(await read(c.output_file, c.output)), cpu_time_limit: submission.time_limit / 1000, cpu_extra_time: 0.5, wall_time_limit: Math.min(30, submission.time_limit / 1000 * 2 + 2), memory_limit: submission.memory_limit * 1024, stack_limit: Math.min(128000, submission.memory_limit * 1024), compiler_options: "-std=c++17 -O2", max_file_size: 16384, number_of_runs: 1, enable_network: false });
      }
      const result = await judgeRequest(env, submission.judge_url, "/submissions/batch?base64_encoded=true", "POST", { submissions: jobs });
      if (!Array.isArray(result) || result.length !== group.length || result.some((r) => !/^[a-f0-9-]{36}$/.test(r?.token || ""))) throw new JudgeServiceError("评测服务未返回有效任务编号");
      tokens.push(...result.map((r) => r.token));
    }
    await db.prepare("UPDATE oj_submissions SET judge_tokens=?,status='JUDGING',details=?,score=0,passed=0,time=0,memory=0,compile_log='',judge_error='',lease_until=0,updated_at=? WHERE id=? AND judge_attempts=? AND status='QUEUED'").bind(JSON.stringify(tokens), JSON.stringify(details), new Date().toISOString(), submission.id, claimed.judge_attempts).run();
  } catch (error) {
    const message = judgeFailure(error);
    console.error("OJ dispatch failed", JSON.stringify({ submission_id: submission.id, attempt: claimed.judge_attempts, reason: message }));
    await db.prepare("UPDATE oj_submissions SET status='JE',details=?,judge_error=?,lease_until=0,updated_at=? WHERE id=? AND judge_attempts=? AND status='QUEUED'").bind(JSON.stringify(details.map((d) => ({ ...d, status: "JE" }))), message, new Date().toISOString(), submission.id, claimed.judge_attempts).run();
  }
  return (await db.prepare("SELECT * FROM oj_submissions WHERE id=?").bind(submission.id).first<OjSubmission>()) || claimed;
}
async function retryJudge(db: D1Database, env: Bindings, submission: OjSubmission) {
  const p = await db.prepare("SELECT revision FROM oj_problems WHERE id=?").bind(submission.problem_id).first<{ revision: number }>();
  if (!p || p.revision !== submission.revision) {
    await db.prepare("UPDATE oj_submissions SET judge_attempts=judge_attempts+1,judge_error=? WHERE id=? AND judge_attempts=? AND status='JE'").bind("题目已更新，请按新版本重新提交", submission.id, submission.judge_attempts).run();
    return { ...submission, judge_attempts: submission.judge_attempts + 1, judge_error: "题目已更新，请按新版本重新提交" };
  }
  const tests = (await db.prepare(caseSelect + " WHERE c.problem_id=? ORDER BY c.position").bind(submission.problem_id).all<OjCase>()).results;
  const previous: OjDetail[] = JSON.parse(submission.details);
  const current = await db.prepare("SELECT revision FROM oj_problems WHERE id=?").bind(submission.problem_id).first<{ revision: number }>();
  if (current?.revision !== submission.revision || tests.length !== submission.total || tests.some((c, i) => c.weight !== previous[i]?.weight)) throw new ApiError(409, "题目已更新，请重新提交");
  return dispatchJudge(db, env, submission, tests);
}
async function judgeRequest(env: Bindings, base: string, route: string, method = "GET", data?: unknown, limit = 2000000): Promise<any> {
  const response = await fetch(base + route, { method, redirect: "manual", signal: AbortSignal.timeout(18000), headers: { "Content-Type": "application/json", ...(env.JUDGE0_TOKEN && base === judgeUrl(env) ? { "X-Auth-Token": env.JUDGE0_TOKEN } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
  if (!response.ok) throw new JudgeServiceError("评测服务请求失败（HTTP " + response.status + "）");
  const text = await response.text();
  if (text.length > limit) throw new JudgeServiceError("评测服务返回内容过长");
  try { return JSON.parse(text); } catch { throw new JudgeServiceError("评测服务返回格式不正确"); }
}
export function judgeSummary(results: any[], previous: OjDetail[], tokens: string[], timeLimit: number, memoryLimit: number, scoring = "weighted", expected?: string[]) {
  const map = new Map<string, any>(results.filter((r) => r && typeof r.token === "string").map((r) => [r.token, r]));
  let log = "";
  const details = previous.map((old, i) => {
    const r = map.get(tokens[i]);
    if (!r || !Number.isInteger(r.status?.id)) return { ...old, status: "JUDGING" };
    const id = r.status.id;
    const time = Number.isFinite(Number(r.time)) ? Math.max(0, Math.ceil(Number(r.time) * 1000)) : 0;
    const memory = Number.isFinite(Number(r.memory)) ? Math.max(0, Math.ceil(Number(r.memory))) : 0;
    let status = id <= 2 ? "JUDGING" : id === 3 ? "AC" : id === 4 ? "WA" : id === 5 ? "TLE" : id === 6 ? "CE" : id >= 7 && id <= 12 ? "RE" : "JE";
    if (status === "WA" && expected && typeof expected[i] === "string" && typeof r.stdout === "string") {
      const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
      if (r.stdout.length <= 50000 && normalize(compileText(r.stdout)) === normalize(expected[i])) status = "AC";
    }
    if (status === "AC" && time > timeLimit) status = "TLE";
    if (["AC", "RE"].includes(status) && (memory > memoryLimit * 1024 || /memory limit|out of memory|cg-oom/i.test(String(r.message || "")))) status = "MLE";
    if (id === 6 && !log) log = compileText(r.compile_output);
    return { ...old, status, time, memory };
  });
  const pending = details.some((d) => d.status === "JUDGING" || d.status === "QUEUED");
  const status = pending ? "JUDGING" : details.some((d) => d.status === "CE") ? "CE" : details.some((d) => d.status === "JE") ? "JE" : details.find((d) => d.status !== "AC")?.status || "AC";
  const passed = details.filter((d) => d.status === "AC").length;
  const weight = details.reduce((a, d) => a + d.weight, 0);
  let score = status === "CE" || status === "JE" ? 0 : Math.floor(100 * details.filter((d) => d.status === "AC").reduce((a, d) => a + d.weight, 0) / Math.max(1, weight));
  if (scoring === "all") score = status === "AC" ? 100 : 0;
  if (scoring === "groups") {
    const groups = new Map<number, { weight: number; accepted: boolean }>();
    for (const d of details) {
      const old = groups.get(d.group || 1);
      groups.set(d.group || 1, { weight: d.weight, accepted: (!old || old.accepted) && d.status === "AC" });
    }
    const total = [...groups.values()].reduce((sum, group) => sum + group.weight, 0);
    const accepted = [...groups.values()].filter((group) => group.accepted).reduce((sum, group) => sum + group.weight, 0);
    score = status === "CE" || status === "JE" ? 0 : Math.floor(100 * accepted / Math.max(1, total));
  }
  return { details, status, passed, score, time: Math.max(0, ...details.map((d) => d.time)), memory: Math.max(0, ...details.map((d) => d.memory)), compile_log: log };
}
async function refreshJudge(db: D1Database, env: Bindings, submission: OjSubmission) {
  if (submission.status === "JE" && submission.judge_attempts === 0 && submission.judge_tokens === "[]") submission = await retryJudge(db, env, submission);
  if (!["QUEUED", "JUDGING"].includes(submission.status)) return submission;
  const now = Date.now();
  if (now - (submission.judge_started_at || Date.parse(submission.created_at)) > 10 * 60 * 1000) {
    const details = JSON.stringify((JSON.parse(submission.details) as OjDetail[]).map((d) => ({ ...d, status: waitingJudge(d.status) ? "JE" : d.status })));
    await db.prepare("UPDATE oj_submissions SET status='JE',score=0,details=?,judge_error='评测等待超时，可点击重新评测',lease_until=0,updated_at=? WHERE id=? AND status IN ('QUEUED','JUDGING')").bind(details, new Date(now).toISOString(), submission.id).run();
    return { ...submission, status: "JE", score: 0, details, judge_error: "评测等待超时，可点击重新评测" };
  }
  const tokens = JSON.parse(submission.judge_tokens) as string[];
  if (!tokens.length) return submission;
  const lease = await db.prepare("UPDATE oj_submissions SET lease_until=? WHERE id=? AND lease_until<? AND status IN ('QUEUED','JUDGING') RETURNING id").bind(now + 22000, submission.id, now).first();
  if (!lease) return submission;
  try {
    const results: any[] = [];
    for (let i = 0; i < tokens.length; i += 20) {
      const result = await judgeRequest(env, submission.judge_url, "/submissions/batch?base64_encoded=true&tokens=" + tokens.slice(i, i + 20).join(",") + "&fields=token,status,time,memory,compile_output,message" + (submission.checker === "casefold" ? ",stdout" : ""));
      if (!Array.isArray(result.submissions)) throw new JudgeServiceError("评测服务返回结果格式不正确");
      results.push(...result.submissions);
    }
    const summary = judgeSummary(results, JSON.parse(submission.details), tokens, submission.time_limit, submission.memory_limit, submission.scoring, submission.checker === "casefold" ? JSON.parse(submission.expected_outputs) : undefined);
    const stamp = new Date().toISOString();
    await db.prepare("UPDATE oj_submissions SET status=?,score=?,passed=?,time=?,memory=?,details=?,compile_log=?,lease_until=?,judge_error='',updated_at=? WHERE id=? AND lease_until=?").bind(summary.status, summary.score, summary.passed, summary.time, summary.memory, JSON.stringify(summary.details), summary.compile_log, now + 2500, stamp, submission.id, now + 22000).run();
    return { ...submission, ...summary, details: JSON.stringify(summary.details), updated_at: stamp };
  } catch (error) {
    const message = judgeFailure(error);
    console.error("OJ result lookup failed", JSON.stringify({ submission_id: submission.id, reason: message }));
    await db.prepare("UPDATE oj_submissions SET lease_until=?,judge_error=? WHERE id=? AND lease_until=?").bind(now + 6000, message, submission.id, now + 22000).run();
    return { ...submission, judge_error: message };
  }
}
async function handleOj(request: Request, env: Bindings, db: D1Database, user: Account | null, path: string, reply: (data: unknown, status?: number) => Response): Promise<Response> {
  const url = new URL(request.url);
  const now = Date.now();
  const stamp = new Date(now).toISOString();
  const requireUser = () => { if (!user) throw new ApiError(401, "请先登录"); return user; };
  const requireSuper = () => { requireUser(); if (!can(user, "problems")) throw new ApiError(403, "需要题目管理权限"); };
  if (path === "files" && request.method === "POST") {
    const teamId = url.searchParams.get("team_id");
    if (teamId) { requireUser(); if (!teamStaff(await teamAccess(db, teamId, user, true))) throw new ApiError(403, "需要团队管理权限"); }
    else requireSuper();
    if (!env.BUCKET) throw new ApiError(503, "文件存储尚未就绪");
    const name = field(url.searchParams.get("name"), "文件名", 160).replace(/[\/\\]/g, "-");
    const limit = Number(request.headers.get("content-length") || 0);
    if (limit > MAX_FILE) throw new ApiError(413, "文件不能超过 16 MiB");
    const reader = request.body?.getReader();
    if (!reader) throw new ApiError(400, "文件内容为空");
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FILE) { await reader.cancel(); throw new ApiError(413, "文件不能超过 16 MiB"); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    try {
      for (const chunk of chunks) { decoder.decode(chunk, { stream: true }); bytes.set(chunk, offset); offset += chunk.byteLength; }
      decoder.decode();
    } catch { throw new ApiError(400, "请上传 UTF-8 文本测试数据"); }
    const id = crypto.randomUUID();
    await env.BUCKET.put("oj/data/" + id, bytes, { httpMetadata: { contentType: "text/plain; charset=utf-8" } });
    try { await db.prepare("INSERT INTO oj_files(id,user_id,name,size,created_at,team_id) VALUES(?,?,?,?,?,?)").bind(id, user!.id, name, size, stamp, teamId).run(); }
    catch (error) { await env.BUCKET.delete("oj/data/" + id); throw error; }
    return reply({ file: { id, name, size } }, 201);
  }
  const fm = path.match(/^files\/([a-f0-9-]{36})(\/preview)?$/);
  if (fm && request.method === "GET") {
    requireUser();
    const file = await db.prepare("SELECT * FROM oj_files WHERE id=?").bind(fm[1]).first<OjFile>();
    if (!file) throw new ApiError(404, "文件不存在");
    if (file.team_id) { if (!teamStaff(await teamAccess(db, file.team_id, user, true))) throw new ApiError(403, "需要团队管理权限"); }
    else {
      requireSuper();
      if (file.user_id !== user!.id && !superuser(user) && !await db.prepare("SELECT c.id FROM oj_cases c JOIN oj_problems p ON p.id=c.problem_id WHERE p.published=1 AND p.team_id IS NULL AND (c.input_file=? OR c.output_file=?) LIMIT 1").bind(file.id, file.id).first()) throw new ApiError(404, "文件不存在");
    }
    if (fm[2] && file.size === 0) return reply({ content: "", truncated: false });
    const object = await env.BUCKET?.get("oj/data/" + file.id, fm[2] ? { range: { offset: 0, length: 4096 } } : undefined);
    if (!object) throw new ApiError(404, "文件不存在");
    if (fm[2]) return reply({ content: await object.text(), truncated: file.size > 4096 });
    const headers = new Headers(reply(null).headers);
    headers.set("Content-Type", "application/octet-stream");
    headers.set("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(file.name));
    return new Response(object.body, { headers });
  }
  await ensureOj(db);
  if (path === "problems" && request.method === "GET") {
    const all = url.searchParams.get("all") === "1", teamId = url.searchParams.get("team_id");
    const team = teamId ? await teamAccess(db, teamId, user, true) : null;
    if (all) { if (team) { if (!teamStaff(team)) throw new ApiError(403, "需要团队管理权限"); } else requireSuper(); }
    const hidden = all && (team ? teamStaff(team) : superuser(user));
    const rows = await db.prepare("SELECT id,code,title,team_id,time_limit,memory_limit,published,difficulty,difficulty_tier,quality,revision,created_at FROM oj_problems WHERE team_id IS ?" + (hidden ? "" : " AND published=1") + " ORDER BY id LIMIT 200").bind(teamId).all();
    return reply({ problems: rows.results.map((p) => ({ ...p, code: p.team_id ? String(p.code).slice(38) : p.code, published: Boolean(p.published) })), ...(team ? { team: { id: team.id, name: team.name, can_manage: teamStaff(team) } } : {}) });
  }
  if (path === "problems" && request.method === "POST") {
    requireUser();
    const value = await body(request), teamId = value.team_id == null ? null : field(value.team_id, "团队编号", 36);
    if (teamId) { if (!teamStaff(await teamAccess(db, teamId, user, true))) throw new ApiError(403, "需要团队管理权限"); } else requireSuper();
    const p = await ojInput(value, db, undefined, user, teamId);
    if (teamId) p.code = teamId + "::" + p.code;
    if (!teamId && !superuser(user) && !p.published) throw new ApiError(403, "隐藏题仅超级管理员可管理");
    if (await db.prepare("SELECT id FROM oj_problems WHERE code=?").bind(p.code).first()) throw new ApiError(409, "题号已存在");
    const row = await db.prepare("INSERT INTO oj_problems(code,title,statement,samples,time_limit,memory_limit,published,created_at,updated_at,checker,scoring,difficulty,difficulty_tier,quality,quality_note,team_id) VALUES(?,?,?,?,?,?,0,?,?,?,?,?,?,?,?,?) RETURNING *").bind(p.code, p.title, p.statement, p.samples, p.time_limit, p.memory_limit, stamp, stamp, p.checker, p.scoring, p.difficulty, p.difficulty_tier, p.quality, p.quality_note, teamId).first<OjProblem>();
    if (!row) throw new ApiError(500, "题目保存失败");
    await db.batch([...p.cases.map((c) => db.prepare("INSERT INTO oj_cases(id,problem_id,position,input,output,weight,input_file,output_file,group_id) VALUES(?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), row.id, c.position, c.input, c.output, c.weight, c.input_file || null, c.output_file || null, c.group || 1)), db.prepare("UPDATE oj_problems SET published=? WHERE id=?").bind(p.published, row.id)]);
    return reply({ problem: publicProblem({ ...row, published: p.published }) }, 201);
  }
  const pm = path.match(/^problems\/([1-9]\d{0,8})(\/editorial|\/assessment)?$/);
  if (pm) {
    const id = Number(pm[1]);
    if (request.method !== "GET") requireUser();
    const row = await db.prepare("SELECT * FROM oj_problems WHERE id=?").bind(id).first<OjProblem>();
    if (!row) throw new ApiError(404, "题目不存在");
    const rights = await problemRights(db, row, user);
    if (!rights.view) throw new ApiError(404, "题目不存在");
    if (request.method !== "GET" && !(pm[2] === "/editorial" ? rights.editorial : rights.manage)) throw new ApiError(403, "没有此项管理权限");
    if (pm[2] === "/assessment") {
      if (request.method !== "PATCH") throw new ApiError(404, "接口不存在");
      const a = ojAssessment(await body(request), row);
      const saved = await db.prepare("UPDATE oj_problems SET difficulty=?,difficulty_tier=?,quality=?,quality_note=?,updated_at=? WHERE id=? RETURNING *")
        .bind(a.difficulty, a.difficulty_tier, a.quality, a.quality_note, stamp, id).first<OjProblem>();
      if (!saved) throw new ApiError(404, "题目不存在");
      return reply({ problem: { ...publicProblem(saved, rights.editorial), can_manage: rights.manage, can_editorial: rights.editorial } });
    }
    if (pm[2] === "/editorial") {
      if (request.method !== "PATCH") throw new ApiError(404, "接口不存在");
      const value = await body(request);
      const editorial = field(value.editorial, "题解", 100000, false);
      if (typeof value.published !== "boolean" || (value.published && !editorial)) throw new ApiError(400, "公开题解前请填写内容");
      const { statement } = splitDraftEditorial(row.statement);
      const saved = await db.prepare("UPDATE oj_problems SET editorial=?,editorial_published=?,statement=?,updated_at=? WHERE id=? AND statement=? RETURNING *")
        .bind(editorial, Number(value.published), statement, stamp, id, row.statement).first<OjProblem>();
      if (!saved) throw new ApiError(409, "题面已变更，请刷新后再保存题解");
      return reply({ problem: publicProblem(saved, true) });
    }
    if (request.method === "GET") {
      if (url.searchParams.get("edit") === "1") {
        requireUser(); if (!rights.manage) throw new ApiError(403, "需要题目管理权限");
        const cases = await db.prepare(caseSelect + " WHERE c.problem_id=? ORDER BY c.position").bind(id).all();
        return reply({ problem: { ...publicProblem(row), statement: superuser(user) ? row.statement : splitDraftEditorial(row.statement).statement, cases: cases.results } });
      }
      return reply({ problem: { ...publicProblem(row, rights.editorial), can_manage: rights.manage, can_editorial: rights.editorial } });
    }
    if (request.method === "PATCH") {
      const p = await ojInput(await body(request), db, row, user, row.team_id);
      if (row.team_id) p.code = row.team_id + "::" + p.code;
      if (!row.team_id && !superuser(user) && !p.published) throw new ApiError(403, "隐藏题仅超级管理员可管理");
      const other = await db.prepare("SELECT id FROM oj_problems WHERE code=? AND id<>?").bind(p.code, id).first();
      if (other) throw new ApiError(409, "题号已存在");
      await db.batch([db.prepare("UPDATE oj_problems SET code=?,title=?,statement=?,samples=?,time_limit=?,memory_limit=?,published=?,checker=?,scoring=?,difficulty=?,difficulty_tier=?,quality=?,quality_note=?,revision=revision+1,updated_at=? WHERE id=?").bind(p.code, p.title, p.statement, p.samples, p.time_limit, p.memory_limit, p.published, p.checker, p.scoring, p.difficulty, p.difficulty_tier, p.quality, p.quality_note, stamp, id), db.prepare("DELETE FROM oj_cases WHERE problem_id=?").bind(id), ...p.cases.map((c) => db.prepare("INSERT INTO oj_cases(id,problem_id,position,input,output,weight,input_file,output_file,group_id) VALUES(?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), id, c.position, c.input, c.output, c.weight, c.input_file || null, c.output_file || null, c.group || 1))]);
      return reply({ problem: publicProblem({ ...row, ...p, revision: row.revision + 1, updated_at: stamp }) });
    }
  }
  if (path === "submissions" && request.method === "POST") {
    const u = requireUser();
    await rateLimit(db, request, "oj-submit-user-" + u.id, 5, now);
    const global = await db.prepare("INSERT INTO login_limits(key,window_start,attempts) VALUES('oj-global',?,1) ON CONFLICT(key) DO UPDATE SET window_start=CASE WHEN window_start<? THEN excluded.window_start ELSE window_start END,attempts=CASE WHEN window_start<? THEN 1 ELSE attempts+1 END RETURNING attempts").bind(now, now - 900000, now - 900000).first<{ attempts: number }>();
    if ((global?.attempts || 0) > 30) throw new ApiError(429, "评测繁忙，请稍后提交");
    const value = await body(request);
    const problemId = integer(value.problem_id, "题目编号", 1, 100000000);
    if (value.language !== "cpp17") throw new ApiError(400, "首版支持 C++17");
    const source = field(value.source, "代码", 50000);
    const p = await db.prepare("SELECT * FROM oj_problems WHERE id=?").bind(problemId).first<OjProblem>();
    if (!p || !(await problemRights(db, p, user)).view) throw new ApiError(404, "题目不存在");
    const tests = (await db.prepare(caseSelect + " WHERE c.problem_id=? ORDER BY c.position").bind(problemId).all<OjCase>()).results;
    if (!tests.length || tests.length > 50) throw new ApiError(400, "题目尚未配置测试数据");
    const current = await db.prepare("SELECT revision FROM oj_problems WHERE id=?").bind(problemId).first<{ revision: number }>();
    if (current?.revision !== p.revision) throw new ApiError(409, "题目已更新，请重新提交");
    const id = crypto.randomUUID();
    const base = judgeUrl(env);
    const details: OjDetail[] = tests.map((c, i) => ({ index: i + 1, group: c.group || 1, weight: c.weight, status: "QUEUED", time: 0, memory: 0 }));
    const expected: string[] = [];
    if (p.checker === "casefold") for (const c of tests) {
      if (c.output_file) {
        const object = await env.BUCKET?.get("oj/data/" + c.output_file);
        if (!object || object.size > 4000) throw new ApiError(400, "预期输出文件不存在或过大");
        expected.push(await object.text());
      } else expected.push(c.output);
    }
    await db.prepare("INSERT INTO oj_submissions(id,user_id,problem_id,problem_code,problem_title,source,revision,total,details,judge_url,created_at,updated_at,time_limit,memory_limit,checker,scoring,expected_outputs) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(id, u.id, p.id, p.team_id ? p.code.slice(38) : p.code, p.title, source, p.revision, tests.length, JSON.stringify(details), base, stamp, stamp, p.time_limit, p.memory_limit, p.checker, p.scoring, JSON.stringify(expected)).run();
    const saved = await db.prepare("SELECT * FROM oj_submissions WHERE id=?").bind(id).first<OjSubmission>();
    const submission = await dispatchJudge(db, env, saved!, tests);
    return reply({ submission: publicSubmission(submission!, true) }, 201);
  }
  if (path === "submissions" && request.method === "GET") {
    const mine = url.searchParams.get("mine") === "1";
    if (mine) requireUser();
    const offset = integer(Number(url.searchParams.get("offset") || 0), "分页位置", 0, 10000);
    const teamId = url.searchParams.get("team_id"), team = teamId ? await teamAccess(db, teamId, user, true) : null;
    const q = db.prepare("SELECT s.*,u.display_name AS username FROM oj_submissions s JOIN users u ON u.id=s.user_id JOIN oj_problems p ON p.id=s.problem_id WHERE p.team_id IS ? AND " + (team ? (teamStaff(team) ? "1=1" : "(p.published=1 OR s.user_id=?)") : superuser(user) ? "1=1" : "(p.published=1 OR s.user_id=?)") + (mine ? " AND s.user_id=?" : "") + " ORDER BY s.created_at DESC,s.id DESC LIMIT 30 OFFSET ?");
    const values: (number | string | null)[] = [teamId];
    if (team ? !teamStaff(team) : !superuser(user)) values.push(user?.id || 0);
    if (mine) values.push(user!.id);
    values.push(offset);
    const rows = await q.bind(...values).all<OjSubmission & { username: string }>();
    const updates = await Promise.all(rows.results.filter((s) => waitingJudge(s.status) || (s.status === "JE" && s.judge_attempts === 0 && s.judge_tokens === "[]")).slice(0, 3).map((s) => refreshJudge(db, env, s)));
    const latest = new Map(updates.map((s) => [s.id, s]));
    return reply({ submissions: rows.results.map((s) => ({ ...publicSubmission(latest.get(s.id) || s, false), username: s.username })), next_offset: rows.results.length === 30 && offset + 30 <= 10000 ? offset + 30 : null });
  }
  const point = path.match(/^submissions\/([a-f0-9-]{36})\/cases\/([1-9]\d?)$/);
  if (point && request.method === "GET") {
    const u = requireUser();
    const row = await db.prepare("SELECT * FROM oj_submissions WHERE id=?").bind(point[1]).first<OjSubmission>();
    if (!row) throw new ApiError(404, "提交不存在");
    const p = await db.prepare("SELECT team_id,published FROM oj_problems WHERE id=?").bind(row.problem_id).first<OjProblem>();
    const staff = p?.team_id ? teamStaff(await teamAccess(db, p.team_id, user, true)) : Boolean(superuser(user));
    if (row.user_id !== u.id && !staff) throw new ApiError(404, "提交不存在");
    const index = Number(point[2]);
    const detail = (JSON.parse(row.details) as OjDetail[])[index - 1];
    if (!detail || index > row.total) throw new ApiError(404, "测试点不存在");
    const token = (JSON.parse(row.judge_tokens) as string[])[index - 1];
    if (!token || waitingJudge(detail.status)) return reply({ ...detail, message: row.judge_error, stdout: "", stderr: "", pending: waitingJudge(detail.status) });
    try {
      const result = await judgeRequest(env, row.judge_url, "/submissions/" + token + "?base64_encoded=true&fields=" + (staff ? "stdout,stderr," : "") + "message,exit_code,exit_signal", "GET", undefined, 48000000);
      const decode = (value: unknown) => { if (typeof value !== "string") return ""; try { return new TextDecoder().decode(Uint8Array.from(atob(value.slice(0, 8192)), (c) => c.charCodeAt(0))).slice(0, 4000); } catch { return ""; } };
      return reply({ ...detail, stdout: staff ? decode(result.stdout) : "", stderr: staff ? decode(result.stderr) : "", message: decode(result.message), exit_code: result.exit_code ?? null, exit_signal: result.exit_signal ?? null, truncated: staff && [result.stdout, result.stderr].some((v) => typeof v === "string" && v.length > 5332) });
    } catch { return reply({ ...detail, stdout: "", stderr: "", message: "运行日志暂不可用，判定结果仍有效" }); }
  }
  const retry = path.match(/^submissions\/([a-f0-9-]{36})\/rejudge$/);
  if (retry && request.method === "POST") {
    const u = requireUser();
    const row = await db.prepare("SELECT * FROM oj_submissions WHERE id=?").bind(retry[1]).first<OjSubmission>();
    if (!row) throw new ApiError(404, "提交不存在");
    const p = await db.prepare("SELECT team_id,published FROM oj_problems WHERE id=?").bind(row.problem_id).first<OjProblem>();
    const staff = p?.team_id ? teamStaff(await teamAccess(db, p.team_id, user, true)) : Boolean(superuser(user));
    if (row.user_id !== u.id && !staff) throw new ApiError(404, "提交不存在");
    if (row.status !== "JE") throw new ApiError(409, "当前提交无需重评");
    await rateLimit(db, request, "oj-retry-user-" + u.id, 5, now);
    const result = await retryJudge(db, env, row);
    return reply({ submission: publicSubmission(result, true) });
  }
  const sm = path.match(/^submissions\/([a-f0-9-]{36})$/);
  if (sm && request.method === "GET") {
    const row = await db.prepare("SELECT s.*,u.display_name AS username,p.published,p.team_id FROM oj_submissions s JOIN users u ON u.id=s.user_id JOIN oj_problems p ON p.id=s.problem_id WHERE s.id=?").bind(sm[1]).first<OjSubmission & { username: string; published: number; team_id: string | null }>();
    const teamStaffAccess = row?.team_id ? teamStaff(await teamAccess(db, row.team_id, user, true)) : false;
    if (row?.team_id && !row.published && row.user_id !== user?.id && !teamStaffAccess) throw new ApiError(404, "提交不存在");
    if (!row || (!row.team_id && !row.published && row.user_id !== user?.id && !superuser(user))) throw new ApiError(404, "提交不存在");
    const result = await refreshJudge(db, env, row);
    return reply({ submission: { ...publicSubmission(result, user?.id === row.user_id || (row.team_id ? teamStaffAccess : Boolean(superuser(user)))), username: row.username, team_id: row.team_id } });
  }
  throw new ApiError(404, "接口不存在");
}
type Reply = (data: unknown, status?: number) => Response;
type Row = Record<string, any>;
const uuidPath = "([a-f0-9-]{36})";
function pagination(url: URL) { return integer(Number(url.searchParams.get("offset") || 0), "分页位置", 0, 10000); }
function page(rows: Row[], offset: number, key: string) { return { [key]: rows.slice(0, 30), next_offset: rows.length > 30 ? offset + 30 : null }; }
async function communityProblem(db: D1Database, id: unknown, user: Account | null) {
  const row = await db.prepare("SELECT id,code,title,published,team_id FROM oj_problems WHERE id=?").bind(integer(id, "题目编号", 1, 100000000)).first<Row>();
  if (!row || !(await problemRights(db, row as OjProblem, user)).view) throw new ApiError(404, "题目不存在");
  return row;
}
async function teamAccess(db: D1Database, id: string, user: Account | null, membersOnly = false) {
  const team = await db.prepare("SELECT t.*,m.role AS my_role,m.status AS my_status FROM teams t LEFT JOIN team_members m ON m.team_id=t.id AND m.user_id=? WHERE t.id=? AND t.archived=0").bind(user?.id || 0, id).first<Row>();
  if (!team || ((membersOnly && team.my_status !== "active") || (team.visibility === "private" && !team.my_status))) throw new ApiError(404, "团队不存在或尚未加入");
  return team;
}
const teamStaff = (t: Row) => t.my_status === "active" && ["owner", "admin"].includes(t.my_role);
const teamPublic = (t: Row) => { const { join_code, ...value } = t; return { ...value, ...(teamStaff(t) ? { join_code } : {}) }; };
const discussionSelect = "SELECT d.*,u.display_name AS author_name,CASE WHEN p.team_id IS NULL THEN p.code ELSE substr(p.code,39) END AS problem_code,p.title AS problem_title,(SELECT count(*) FROM discussion_replies r WHERE r.discussion_id=d.id) AS reply_count FROM discussions d JOIN users u ON u.id=d.author_id LEFT JOIN oj_problems p ON p.id=d.problem_id";
async function discussionAccess(db: D1Database, id: string, user: Account | null) {
  const thread = await db.prepare(discussionSelect + " WHERE d.id=?").bind(id).first<Row>();
  if (!thread) throw new ApiError(404, "讨论不存在");
  const team = thread.team_id ? await teamAccess(db, thread.team_id, user, true) : null;
  const moderate = team ? teamStaff(team) : can(user, "discussions");
  if (thread.problem_id) await communityProblem(db, thread.problem_id, user);
  if (thread.hidden && !moderate && thread.author_id !== user?.id) throw new ApiError(404, "讨论不存在");
  return { thread, moderate };
}
const solutionSelect = "SELECT s.*,u.display_name AS author_name,CASE WHEN p.team_id IS NULL THEN p.code ELSE substr(p.code,39) END AS problem_code,p.title AS problem_title,p.published AS problem_published,p.team_id AS problem_team_id,(SELECT count(*) FROM solution_likes l WHERE l.solution_id=s.id) AS likes,(SELECT count(*) FROM solution_comments c WHERE c.solution_id=s.id) AS comments FROM solutions s JOIN users u ON u.id=s.author_id JOIN oj_problems p ON p.id=s.problem_id";
async function solutionAccess(db: D1Database, id: string, user: Account | null) {
  const s = await db.prepare(solutionSelect + " WHERE s.id=?").bind(id).first<Row>();
  if (!s) throw new ApiError(404, "题解不存在");
  const rights = await problemRights(db, { team_id: s.problem_team_id, published: s.problem_published }, user);
  if (!rights.view) throw new ApiError(404, "题解不存在");
  s.can_manage = rights.editorial;
  if (s.status !== "published" && s.author_id !== user?.id && !rights.editorial) throw new ApiError(404, "题解不存在");
  return s;
}
const publicSolution = (s: Row, user: Account | null) => {
  const { problem_published, problem_team_id, review_note, ...data } = s;
  return { ...data, team_id: problem_team_id || null, featured: Boolean(s.featured), ...(s.author_id === user?.id || s.can_manage || (!problem_team_id && can(user, "solutions")) ? { review_note } : {}) };
};
async function handleCommunity(request: Request, db: D1Database, user: Account | null, path: string, reply: Reply): Promise<Response> {
  const url = new URL(request.url), method = request.method, now = Date.now(), stamp = new Date(now).toISOString();
  const signed = () => { if (!user) throw new ApiError(401, "请先登录"); return user; };
  const manager = (permission: Permission) => { const u = signed(); if (!can(u, permission)) throw new ApiError(403, "没有此项管理权限"); return u; };
  const writer = async () => { const u = signed(); await writable(db, u); return u; };
  if (method === "POST" && user) await rateLimit(db, request, "community-write-" + user.id, 40, now);
  if (path === "sanctions") {
    if (method === "GET") {
      const offset = pagination(url);
      const rows = await db.prepare("SELECT s.*,u.display_name AS user_name,u.username,a.display_name AS actor_name,CASE WHEN s.revoked_at IS NULL AND (s.expires_at IS NULL OR s.expires_at>?) THEN 1 ELSE 0 END AS active FROM sanctions s JOIN users u ON u.id=s.user_id JOIN users a ON a.id=s.actor_id ORDER BY s.created_at DESC,s.id DESC LIMIT 31 OFFSET ?").bind(now, offset).all();
      return reply(page(rows.results, offset, "sanctions"));
    }
    if (method === "POST") {
      const u = manager("users"), v = await body(request), id = integer(v.user_id, "用户 ID", 1, 100000000);
      await protectAccount(db, u, id);
      if (!await db.prepare("SELECT id FROM users WHERE id=?").bind(id).first()) throw new ApiError(404, "用户不存在");
      if (!["mute", "ban"].includes(String(v.kind))) throw new ApiError(400, "处罚类型不正确");
      const reason = field(v.reason, "处罚原因", 1000), days = integer(v.days, "期限（0 表示永久）", 0, 3650), record = crypto.randomUUID();
      const changes = [db.prepare("INSERT INTO sanctions(id,user_id,actor_id,kind,reason,expires_at,created_at) VALUES(?,?,?,?,?,?,?)").bind(record, id, u.id, v.kind, reason, days ? now + days * DAY : null, stamp)];
      if (v.kind === "ban") changes.push(db.prepare("DELETE FROM sessions WHERE user_id=?").bind(id));
      await db.batch(changes);
      return reply({ ok: true, id: record }, 201);
    }
  }
  const sanctionMatch = path.match(new RegExp("^sanctions/" + uuidPath + "/revoke$"));
  if (sanctionMatch && method === "POST") {
    const u = manager("users"), row = await db.prepare("SELECT user_id FROM sanctions WHERE id=?").bind(sanctionMatch[1]).first<{ user_id: number }>();
    if (!row) throw new ApiError(404, "记录不存在");
    await protectAccount(db, u, row.user_id);
    await db.prepare("UPDATE sanctions SET revoked_at=? WHERE id=? AND revoked_at IS NULL").bind(stamp, sanctionMatch[1]).run();
    return reply({ ok: true });
  }
  if (path === "teams") {
    if (method === "GET") {
      const offset = pagination(url), mine = url.searchParams.get("mine") === "1", q = (url.searchParams.get("q") || "").slice(0, 100);
      if (mine) signed();
      const rows = await db.prepare("SELECT t.id,t.name,t.description,t.owner_id,t.visibility,t.join_policy,t.created_at,m.role AS my_role,m.status AS my_status,(SELECT count(*) FROM team_members a WHERE a.team_id=t.id AND a.status='active') AS member_count FROM teams t LEFT JOIN team_members m ON m.team_id=t.id AND m.user_id=? WHERE t.archived=0 AND " + (mine ? "m.user_id IS NOT NULL" : "(t.visibility='public' OR m.status='active')") + " AND t.name LIKE ? ORDER BY t.created_at DESC,t.id DESC LIMIT 31 OFFSET ?").bind(user?.id || 0, "%" + q + "%", offset).all();
      return reply(page(rows.results, offset, "teams"));
    }
    if (method === "POST") {
      const u = await writer(), v = await body(request), name = field(v.name, "团队名称", 60), description = field(v.description ?? "", "简介", 2000, false);
      if (!["public", "private"].includes(String(v.visibility)) || !["open", "approval"].includes(String(v.join_policy))) throw new ApiError(400, "团队设置不正确");
      const owned = await db.prepare("SELECT count(*) AS n FROM teams WHERE owner_id=? AND archived=0").bind(u.id).first<{ n: number }>();
      if ((owned?.n || 0) >= 20) throw new ApiError(400, "最多创建 20 个团队");
      const id = crypto.randomUUID();
      await db.batch([db.prepare("INSERT INTO teams(id,name,description,owner_id,visibility,join_policy,join_code,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(id, name, description, u.id, v.visibility, v.join_policy, hex(crypto.getRandomValues(new Uint8Array(16))), stamp, stamp), db.prepare("INSERT INTO team_members(team_id,user_id,role,status,joined_at) VALUES(?,?,'owner','active',?)").bind(id, u.id, stamp)]);
      return reply({ team: teamPublic(await teamAccess(db, id, u)) }, 201);
    }
  }
  const tm = path.match(new RegExp("^teams/" + uuidPath + "(?:/(join|members|problems)(?:/([1-9]\\d{0,8}))?)?$"));
  if (tm) {
    const id = tm[1], action = tm[2], target = tm[3] ? Number(tm[3]) : 0;
    if (action === "join" && method === "POST") {
      const u = await writer(), v = await body(request), team = await db.prepare("SELECT * FROM teams WHERE id=? AND archived=0").bind(id).first<Row>();
      if (!team || (team.visibility === "private" && (typeof v.code !== "string" || !equal(v.code, team.join_code)))) throw new ApiError(404, "团队不存在或邀请码不正确");
      const status = team.join_policy === "open" ? "active" : "pending";
      await db.prepare("INSERT INTO team_members(team_id,user_id,role,status,joined_at) VALUES(?,?,'member',?,?) ON CONFLICT(team_id,user_id) DO NOTHING").bind(id, u.id, status, stamp).run();
      const membership = await db.prepare("SELECT status FROM team_members WHERE team_id=? AND user_id=?").bind(id, u.id).first();
      return reply({ membership });
    }
    const team = await teamAccess(db, id, user);
    if (!action && method === "GET") {
      const active = team.my_status === "active", staff = teamStaff(team);
      const members = active ? (await db.prepare("SELECT m.user_id,m.role,m.status,m.joined_at,u.display_name AS name FROM team_members m JOIN users u ON u.id=m.user_id WHERE m.team_id=? AND (m.status='active' OR ?=1) ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END,m.joined_at LIMIT 500").bind(id, Number(staff)).all()).results : [];
      const problems = active ? (await db.prepare("SELECT p.id,p.code,p.title,(SELECT count(DISTINCT s.user_id) FROM oj_submissions s JOIN team_members m ON m.user_id=s.user_id AND m.team_id=? AND m.status='active' WHERE s.problem_id=p.id AND s.status='AC') AS solved FROM team_problems t JOIN oj_problems p ON p.id=t.problem_id WHERE t.team_id=? AND p.published=1 ORDER BY t.added_at,p.id").bind(id, id).all()).results : [];
      const ranking = active ? (await db.prepare("SELECT m.user_id,u.display_name AS name,count(DISTINCT CASE WHEN s.status='AC' AND p.published=1 AND (tp.problem_id IS NOT NULL OR p.team_id=m.team_id) THEN s.problem_id END) AS solved FROM team_members m JOIN users u ON u.id=m.user_id LEFT JOIN oj_submissions s ON s.user_id=m.user_id LEFT JOIN oj_problems p ON p.id=s.problem_id LEFT JOIN team_problems tp ON tp.problem_id=p.id AND tp.team_id=m.team_id WHERE m.team_id=? AND m.status='active' GROUP BY m.user_id ORDER BY solved DESC,m.user_id LIMIT 500").bind(id).all()).results : [];
      return reply({ team: teamPublic(team), members, problems, ranking });
    }
    if (!action && method === "PATCH") {
      signed(); if (!teamStaff(team)) throw new ApiError(403, "需要团队管理权限");
      const v = await body(request), name = field(v.name, "团队名称", 60), description = field(v.description ?? "", "简介", 2000, false);
      if (!["public", "private"].includes(String(v.visibility)) || !["open", "approval"].includes(String(v.join_policy))) throw new ApiError(400, "团队设置不正确");
      if (team.my_role !== "owner" && (v.visibility !== team.visibility || v.join_policy !== team.join_policy || v.rotate_code)) throw new ApiError(403, "入队规则只能由队长修改");
      if (v.rotate_code !== undefined && typeof v.rotate_code !== "boolean") throw new ApiError(400, "邀请码设置不正确");
      await db.prepare("UPDATE teams SET name=?,description=?,visibility=?,join_policy=?,join_code=?,updated_at=? WHERE id=?").bind(name, description, v.visibility, v.join_policy, v.rotate_code ? hex(crypto.getRandomValues(new Uint8Array(16))) : team.join_code, stamp, id).run();
      return reply({ team: teamPublic(await teamAccess(db, id, user)) });
    }
    if (!action && method === "DELETE") {
      signed(); if (team.my_role !== "owner") throw new ApiError(403, "只有队长可以解散团队");
      await db.prepare("UPDATE teams SET archived=1 WHERE id=?").bind(id).run(); return reply({ ok: true });
    }
    if (action === "members" && target) {
      const u = signed(), member = await db.prepare("SELECT * FROM team_members WHERE team_id=? AND user_id=?").bind(id, target).first<Row>();
      if (!member) throw new ApiError(404, "成员不存在");
      if (member.role === "owner") throw new ApiError(400, "队长不能被移除；可选择解散团队");
      if (method === "DELETE") {
        if (target !== u.id && (!teamStaff(team) || (member.role === "admin" && team.my_role !== "owner"))) throw new ApiError(403, "没有此项成员管理权限");
        await db.prepare("DELETE FROM team_members WHERE team_id=? AND user_id=?").bind(id, target).run(); return reply({ ok: true });
      }
      if (method === "PATCH") {
        if (!teamStaff(team)) throw new ApiError(403, "需要团队管理权限");
        const v = await body(request), role = v.role ?? member.role, status = v.status ?? member.status;
        if (!["member", "admin"].includes(String(role)) || !["pending", "active"].includes(String(status))) throw new ApiError(400, "成员设置不正确");
        if (role !== member.role && team.my_role !== "owner") throw new ApiError(403, "只有队长可以任免管理员");
        if (member.role === "admin" && team.my_role !== "owner") throw new ApiError(403, "只有队长可以管理管理员");
        await db.prepare("UPDATE team_members SET role=?,status=? WHERE team_id=? AND user_id=?").bind(role, status, id, target).run(); return reply({ ok: true });
      }
    }
    if (action === "problems") {
      signed(); if (!teamStaff(team)) throw new ApiError(403, "需要团队管理权限");
      if (method === "POST" && !target) {
        const v = await body(request), p = await communityProblem(db, v.problem_id, user);
        if (!p.published || p.team_id) throw new ApiError(400, "训练题单只能引用主站公开题目；团队专属题目请放入团队题库");
        await db.prepare("INSERT INTO team_problems(team_id,problem_id,added_at) VALUES(?,?,?) ON CONFLICT(team_id,problem_id) DO NOTHING").bind(id, p.id, stamp).run(); return reply({ ok: true }, 201);
      }
      if (method === "DELETE" && target) { await db.prepare("DELETE FROM team_problems WHERE team_id=? AND problem_id=?").bind(id, target).run(); return reply({ ok: true }); }
    }
  }
  if (path === "discussions") {
    if (method === "GET") {
      const offset = pagination(url), problemId = url.searchParams.get("problem_id"), manage = url.searchParams.get("manage") === "1", q = (url.searchParams.get("q") || "").slice(0, 100);
      const problem = problemId ? await communityProblem(db, Number(problemId), user) : null;
      const teamId = url.searchParams.get("team_id") || problem?.team_id || null;
      if (problem?.team_id && teamId !== problem.team_id) throw new ApiError(404, "讨论不存在");
      const team = teamId ? await teamAccess(db, teamId, user, true) : null;
      if (manage && !(team ? teamStaff(team) : can(user, "discussions"))) { signed(); throw new ApiError(403, "没有此项管理权限"); }
      const where = [teamId ? "d.team_id=?" : "d.team_id IS NULL", "(d.problem_id IS NULL OR p.published=1 OR ?=1)", "d.title LIKE ?"];
      const values: unknown[] = [...(teamId ? [teamId] : []), Number(team ? teamStaff(team) : superuser(user)), "%" + q + "%"];
      if (!manage) { where.push("(d.hidden=0 OR d.author_id=?)"); values.push(user?.id || 0); }
      if (problemId) { where.push("d.problem_id=?"); values.push(Number(problemId)); }
      const rows = await db.prepare(discussionSelect.replace("d.*", "d.id,d.title,d.author_id,d.problem_id,d.team_id,d.category,d.pinned,d.locked,d.hidden,d.created_at,d.updated_at") + " WHERE " + where.join(" AND ") + " ORDER BY d.pinned DESC,d.created_at DESC,d.id DESC LIMIT 31 OFFSET ?").bind(...values, offset).all();
      return reply({ ...page(rows.results, offset, "discussions"), can_moderate: team ? teamStaff(team) : can(user, "discussions") });
    }
    if (method === "POST") {
      const u = await writer(), v = await body(request), title = field(v.title, "标题", 150), content = field(v.content, "正文", 50000), category = field(v.category ?? "交流", "分类", 20);
      if (!["交流", "题目", "站务"].includes(category)) throw new ApiError(400, "分类不正确");
      const problem = v.problem_id != null ? await communityProblem(db, v.problem_id, u) : null;
      const teamId = v.team_id != null ? field(v.team_id, "团队编号", 36) : problem?.team_id || null;
      if (problem?.team_id && teamId !== problem.team_id) throw new ApiError(400, "题目所属团队不一致");
      if (teamId) await teamAccess(db, teamId, u, true);
      if (teamId && problem && !problem.team_id && !problem.published) throw new ApiError(400, "团队讨论不能引用主站隐藏题");
      const id = crypto.randomUUID();
      await db.prepare("INSERT INTO discussions(id,author_id,problem_id,team_id,title,content,category,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(id, u.id, v.problem_id ?? null, teamId, title, content, category, stamp, stamp).run();
      return reply({ discussion: (await discussionAccess(db, id, u)).thread }, 201);
    }
  }
  const dm = path.match(new RegExp("^discussions/" + uuidPath + "(?:/(replies)(?:/" + uuidPath + ")?)?$"));
  if (dm) {
    const { thread, moderate } = await discussionAccess(db, dm[1], user);
    if (!dm[2]) {
      if (method === "GET") {
        const offset = pagination(url), rows = await db.prepare("SELECT r.*,u.display_name AS author_name FROM discussion_replies r JOIN users u ON u.id=r.author_id WHERE r.discussion_id=? ORDER BY r.created_at,r.id LIMIT 31 OFFSET ?").bind(thread.id, offset).all();
        return reply({ discussion: thread, can_moderate: moderate, ...page(rows.results, offset, "replies") });
      }
      const u = signed();
      if (u.id !== thread.author_id && !moderate) throw new ApiError(403, "没有编辑权限");
      if (method === "PATCH") {
        await writable(db, u); const v = await body(request);
        if ((thread.locked || thread.hidden) && !moderate) throw new ApiError(403, "此讨论已锁定或隐藏");
        for (const key of ["pinned", "locked", "hidden"]) if (v[key] !== undefined && (!moderate || typeof v[key] !== "boolean")) throw new ApiError(403, "需要讨论管理权限");
        await db.prepare("UPDATE discussions SET title=?,content=?,pinned=?,locked=?,hidden=?,updated_at=? WHERE id=?").bind(field(v.title ?? thread.title, "标题", 150), field(v.content ?? thread.content, "正文", 50000), v.pinned === undefined ? thread.pinned : Number(v.pinned), v.locked === undefined ? thread.locked : Number(v.locked), v.hidden === undefined ? thread.hidden : Number(v.hidden), stamp, thread.id).run();
        return reply({ discussion: (await discussionAccess(db, thread.id, user)).thread });
      }
      if (method === "DELETE") { await db.prepare("DELETE FROM discussions WHERE id=?").bind(thread.id).run(); return reply({ ok: true }); }
    }
    if (dm[2] === "replies") {
      const u = signed();
      if (method === "POST" && !dm[3]) {
        await writable(db, u); if (thread.locked || thread.hidden) throw new ApiError(403, "此讨论已锁定或隐藏，不能回复");
        const content = field((await body(request)).content, "回复", 20000), id = crypto.randomUUID();
        await db.prepare("INSERT INTO discussion_replies(id,discussion_id,author_id,content,created_at) VALUES(?,?,?,?,?)").bind(id, thread.id, u.id, content, stamp).run(); return reply({ ok: true, id }, 201);
      }
      if (method === "DELETE" && dm[3]) {
        const r = await db.prepare("SELECT author_id FROM discussion_replies WHERE id=? AND discussion_id=?").bind(dm[3], thread.id).first<Row>();
        if (!r) throw new ApiError(404, "回复不存在");
        if (r.author_id !== u.id && !moderate) throw new ApiError(403, "不能删除其他人的回复");
        await db.prepare("DELETE FROM discussion_replies WHERE id=?").bind(dm[3]).run(); return reply({ ok: true });
      }
    }
  }
  if (path === "solutions") {
    if (method === "GET") {
      const offset = pagination(url), manage = url.searchParams.get("manage") === "1", mine = url.searchParams.get("mine") === "1", problemId = url.searchParams.get("problem_id"), q = (url.searchParams.get("q") || "").slice(0, 100);
      const problem = problemId ? await communityProblem(db, Number(problemId), user) : null;
      const teamId = url.searchParams.get("team_id") || problem?.team_id || null, team = teamId ? await teamAccess(db, teamId, user, true) : null;
      if (problem?.team_id && problem.team_id !== teamId) throw new ApiError(404, "题解不存在");
      if (manage) { if (team) { if (!teamStaff(team)) throw new ApiError(403, "需要团队管理权限"); } else manager("solutions"); }
      if (mine) signed();
      const where = ["p.team_id IS ?", "(p.published=1 OR ?=1)", "(s.title LIKE ? OR p.code LIKE ? OR p.title LIKE ?)"];
      const values: unknown[] = [teamId, Number(team ? teamStaff(team) : superuser(user)), "%" + q + "%", "%" + q + "%", "%" + q + "%"];
      if (mine) { where.push("s.author_id=?"); values.push(user!.id); } else if (!manage) where.push("s.status='published'");
      if (problemId) { where.push("s.problem_id=?"); values.push(Number(problemId)); }
      const rows = await db.prepare(solutionSelect.replace("s.*", "s.id,s.problem_id,s.author_id,s.title,s.status,s.featured,s.created_at,s.updated_at,substr(s.content,1,180) AS excerpt") + " WHERE " + where.join(" AND ") + " ORDER BY s.featured DESC," + (url.searchParams.get("sort") === "popular" ? "likes DESC," : "") + "s.created_at DESC,s.id DESC LIMIT 31 OFFSET ?").bind(...values, offset).all();
      return reply({ ...page(rows.results.map((s) => publicSolution(s, user)), offset, "solutions"), can_manage: team ? teamStaff(team) : can(user, "solutions") });
    }
    if (method === "POST") {
      const u = await writer(), v = await body(request); await communityProblem(db, v.problem_id, u);
      const title = field(v.title, "标题", 150), content = field(v.content, "题解正文", 100000);
      if (!["draft", "pending"].includes(String(v.status))) throw new ApiError(400, "请选择保存草稿或提交审核");
      const id = crypto.randomUUID();
      await db.prepare("INSERT INTO solutions(id,problem_id,author_id,title,content,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)").bind(id, v.problem_id, u.id, title, content, v.status, stamp, stamp).run();
      return reply({ solution: publicSolution(await solutionAccess(db, id, u), u) }, 201);
    }
  }
  const sm = path.match(new RegExp("^solutions/" + uuidPath + "(?:/(review|like|comments)(?:/" + uuidPath + ")?)?$"));
  if (sm) {
    const s = await solutionAccess(db, sm[1], user), action = sm[2];
    if (!action && method === "GET") {
      const offset = pagination(url), rows = s.status === "published" ? await db.prepare("SELECT c.*,u.display_name AS author_name FROM solution_comments c JOIN users u ON u.id=c.author_id WHERE c.solution_id=? ORDER BY c.created_at,c.id LIMIT 31 OFFSET ?").bind(s.id, offset).all() : { results: [] };
      const liked = user ? Boolean(await db.prepare("SELECT user_id FROM solution_likes WHERE solution_id=? AND user_id=?").bind(s.id, user.id).first()) : false;
      return reply({ solution: publicSolution(s, user), liked, ...page(rows.results, offset, "comments") });
    }
    const u = signed();
    if (!action && (method === "PATCH" || method === "DELETE")) {
      if (s.author_id !== u.id && !s.can_manage) throw new ApiError(403, "没有编辑权限");
      if (method === "DELETE") { await db.prepare("DELETE FROM solutions WHERE id=?").bind(s.id).run(); return reply({ ok: true }); }
      await writable(db, u); const v = await body(request);
      if (!["draft", "pending"].includes(String(v.status))) throw new ApiError(400, "修改后请重新提交审核");
      await db.prepare("UPDATE solutions SET title=?,content=?,status=?,featured=0,review_note='',updated_at=? WHERE id=?").bind(field(v.title, "标题", 150), field(v.content, "题解正文", 100000), v.status, stamp, s.id).run();
      return reply({ solution: publicSolution(await solutionAccess(db, s.id, u), u) });
    }
    if (action === "review" && method === "PATCH") {
      if (!s.can_manage) throw new ApiError(403, "需要题解管理权限"); const v = await body(request);
      if (!["published", "rejected", "pending"].includes(String(v.status)) || typeof v.featured !== "boolean") throw new ApiError(400, "审核设置不正确");
      await db.prepare("UPDATE solutions SET status=?,featured=?,review_note=?,updated_at=? WHERE id=?").bind(v.status, v.status === "published" ? Number(v.featured) : 0, field(v.review_note ?? "", "审核意见", 1000, false), stamp, s.id).run();
      return reply({ solution: publicSolution(await solutionAccess(db, s.id, u), u) });
    }
    if (action === "like" && ["POST", "DELETE"].includes(method)) {
      if (s.status !== "published") throw new ApiError(400, "题解尚未公开");
      if (method === "POST") { await writable(db, u); await db.prepare("INSERT INTO solution_likes(solution_id,user_id) VALUES(?,?) ON CONFLICT(solution_id,user_id) DO NOTHING").bind(s.id, u.id).run(); }
      else await db.prepare("DELETE FROM solution_likes WHERE solution_id=? AND user_id=?").bind(s.id, u.id).run();
      return reply({ ok: true });
    }
    if (action === "comments") {
      if (method === "POST" && !sm[3]) {
        await writable(db, u); if (s.status !== "published") throw new ApiError(400, "题解尚未公开");
        const id = crypto.randomUUID(), content = field((await body(request)).content, "评论", 10000);
        await db.prepare("INSERT INTO solution_comments(id,solution_id,author_id,content,created_at) VALUES(?,?,?,?,?)").bind(id, s.id, u.id, content, stamp).run(); return reply({ ok: true, id }, 201);
      }
      if (method === "DELETE" && sm[3]) {
        const c = await db.prepare("SELECT author_id FROM solution_comments WHERE id=? AND solution_id=?").bind(sm[3], s.id).first<Row>();
        if (!c) throw new ApiError(404, "评论不存在");
        if (c.author_id !== u.id && !s.can_manage) throw new ApiError(403, "不能删除其他人的评论");
        await db.prepare("DELETE FROM solution_comments WHERE id=?").bind(sm[3]).run(); return reply({ ok: true });
      }
    }
  }
  throw new ApiError(404, "接口不存在");
}
