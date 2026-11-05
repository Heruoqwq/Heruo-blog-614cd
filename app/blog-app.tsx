"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, ArrowLeft, ArrowRight, Search, Plus, X, Check, BookOpen, ListTodo, PenLine, LogOut, Trash2, FileText, Eye, Upload, Moon, Sun, CodeXml as Github, Loader2, Download, Menu, Users } from "lucide-react";
import Markdown from "./markdown";
import OjApp from "./oj-app";
import UserProfile from "./profile";
import PostCard from "./post-card";
import Teams from "./teams";
import Discussions from "./discussions";
import Solutions from "./solutions";
import Sanctions, { UserManagement } from "./moderation";
import { type User, can } from "./community-shared";
import { readSession, saveSession, clearSession, sessionKey } from "./session";

type Post = { featured: boolean; author_id: number; author_name: string; id: string; title: string; content: string; excerpt: string; category: string; tags: string[]; status: "draft" | "published"; created_at: string; updated_at: string };
type Task = { id: string; title: string; done: boolean; created_at: string; updated_at: string };
type Draft = { featured: boolean; id?: string; title: string; content: string; excerpt: string; category: string; tagsText: string; status: "draft" | "published" };
const emptyDraft = (): Draft => ({ featured: false, title: "", content: "", excerpt: "", category: "随笔", tagsText: "", status: "draft" });

const summary = (p: Post) => p.excerpt || p.content.replace(/[#*`>$\[\]~_]/g, "").replace(/\s+/g, " ").slice(0, 110);
const date = (d: string, full = false) => new Date(d).toLocaleDateString("zh-CN", { year: "numeric", month: full ? "long" : "2-digit", day: "2-digit" });
const reading = (s: string) => Math.max(1, Math.ceil(s.length / 500));
const navigate = (path: string) => { window.location.hash = path; window.scrollTo({ top: 0, behavior: "smooth" }); };
export default function BlogApp({ apiBase = "" }: { apiBase?: string }) {
  const [path, setPath] = useState("/");
  const [posts, setPosts] = useState<Post[]>([]);
  const [allPosts, setAllPosts] = useState<Post[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [auth, setAuth] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [username, setUsername] = useState("");
  const [passwordAgain, setPasswordAgain] = useState("");
  const isSuper = user?.id === 1 && user.role === "superadmin";
  const canPosts = can(user, "posts"), canUsers = can(user, "users"), canProblems = can(user, "problems");
  const [sessionError, setSessionError] = useState("");
  const [authReady, setAuthReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [toast, setToast] = useState("");
  const [dark, setDark] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [feed, setFeed] = useState("featured");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState("tasks");
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [view, setView] = useState("split");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskFilter, setTaskFilter] = useState("active");
  const [taskBusy, setTaskBusy] = useState(false);
  const [adminError, setAdminError] = useState("");
  const [adminLoading, setAdminLoading] = useState(false);
  const [confirm, setConfirm] = useState<{ label: string; action: () => Promise<void> } | null>(null);
  const [post, setPost] = useState<Post | null>(null);
  const [postLoading, setPostLoading] = useState(false);
  const [postError, setPostError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const tokenRef = useRef("");
  async function api<T>(route: string, method = "GET", data?: unknown): Promise<T> {
    const requestToken = tokenRef.current;
    const binary = data instanceof Blob;
    const response = await fetch(`${apiBase}/api/${route}`, { method, headers: { ...(data !== undefined ? { "Content-Type": binary ? "application/octet-stream" : "application/json" } : {}), ...(requestToken ? { Authorization: `Bearer ${requestToken}` } : {}) }, ...(data !== undefined ? { body: binary ? data as Blob : JSON.stringify(data) } : {}) });
    const result = (response.ok && response.headers.get("Content-Type")?.startsWith("application/octet-stream") ? await response.blob() : await response.json()) as T & { error?: string };
    if (!response.ok) {
      if (response.status === 401 && !route.startsWith("auth/") && tokenRef.current === requestToken) {
        tokenRef.current = ""; clearSession(); setAuth(false); setUser(null); setConfirm(null); setPost(null);
        setTasks([]); setAllPosts([]); setDraft(emptyDraft());
      }
      throw new Error(result.error || "请求失败");
    }
    if (requestToken && !route.startsWith("auth/") && tokenRef.current !== requestToken) throw new Error("会话已更改，请重试");
    return result;
  }
  async function loadPosts() {
    setLoading(true); setLoadError("");
    try { const result = await api<{ posts: Post[] }>("posts"); setPosts(result.posts); }
    catch (e) { setLoadError((e as Error).message); }
    finally { setLoading(false); }
  }
  async function loadAdmin() {
    const currentToken = tokenRef.current;
    setAdminLoading(true); setAdminError("");
    try {
      const [p, t] = await Promise.all([api<{ posts: Post[] }>("posts?all=1"), api<{ tasks: Task[] }>("tasks")]);
      if (tokenRef.current === currentToken) { setAllPosts(p.posts); setTasks(t.tasks); }
    } catch (e) { if (tokenRef.current === currentToken) setAdminError((e as Error).message); }
    finally { if (tokenRef.current === currentToken) setAdminLoading(false); }
  }
  useEffect(() => {
    const route = () => { setPath(window.location.hash.slice(1) || "/"); setMobileMenu(false); };
    route(); window.addEventListener("hashchange", route);
    const theme = localStorage.getItem("tony-theme") === "dark";
    setDark(theme); document.documentElement.dataset.theme = theme ? "dark" : "light";
    tokenRef.current = readSession();
    void loadPosts();
    void restoreSession();
    const refresh = () => { if (document.visibilityState === "visible" && tokenRef.current) void restoreSession(); };
    const storage = (event: StorageEvent) => { if (event.key === sessionKey) { tokenRef.current = readSession(); setUser(null); setAuth(false); setTasks([]); setAllPosts([]); setDraft(emptyDraft()); setConfirm(null); setPost(null); void restoreSession(); } };
    const interval = window.setInterval(refresh, 15 * 60 * 1000);
    window.addEventListener("focus", refresh); window.addEventListener("online", refresh);
    window.addEventListener("storage", storage); document.addEventListener("visibilitychange", refresh);
    return () => { window.removeEventListener("hashchange", route); window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh); window.removeEventListener("storage", storage); document.removeEventListener("visibilitychange", refresh); window.clearInterval(interval); };
  }, []);
  useEffect(() => { if (auth) { setAllPosts([]); void loadAdmin(); } }, [auth, user?.id, canPosts]);
  useEffect(() => {
    if (!toast) return; const t = window.setTimeout(() => setToast(""), 4000); return () => window.clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!path.startsWith("/post/")) return;
    const id = path.split("/")[2];
    let alive = true; setPostLoading(true); setPostError(""); setPost(null);
    void api<{ post: Post }>(`posts/${id}`).then((v) => { if (alive) setPost(v.post); }).catch((e) => { if (alive) setPostError(e.message); }).finally(() => { if (alive) setPostLoading(false); });
    return () => { alive = false; };
  }, [path, user?.id]);
  useEffect(() => { document.title = post && path.startsWith("/post/") ? `${post.title} · Heruo OJ` : "Heruo OJ"; }, [post, path]);
  async function restoreSession() {
    const token = tokenRef.current;
    try {
      const v = await api<{ authenticated: boolean; user: User | null }>("auth/session");
      if (tokenRef.current !== token) return;
      setSessionError(""); setAuth(v.authenticated && Boolean(v.user)); setUser(v.user);
      if (!v.authenticated) { tokenRef.current = ""; clearSession(); setTasks([]); setAllPosts([]); setDraft(emptyDraft()); setConfirm(null); setPost(null); }
    } catch { if (tokenRef.current === token && token) setSessionError("连接暂时中断，登录凭据已保留。"); }
    finally { if (tokenRef.current === token || !tokenRef.current) setAuthReady(true); }
  }
  const notifyError = (e: unknown) => setToast((e as Error).message || "操作失败");
  async function login(e: FormEvent) {
    e.preventDefault();
    const register = path === "/register";
    setLoginError("");
    if (register && password !== passwordAgain) { setLoginError("两次密码不一致"); return; }
    setBusy(true);
    try {
      const v = await api<{ token: string; user: User }>(register ? "auth/register" : "auth/login", "POST", { username, password });
      tokenRef.current = v.token; saveSession(v.token); setSessionError("");
      setUser(v.user); setAuth(true); setPassword(""); setPasswordAgain(""); setPanel("tasks");
      setToast(register ? "注册成功" : "登录成功"); navigate("/admin");
    } catch (e) { setLoginError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function logout() {
    try { await api("auth/logout", "POST"); }
    catch (e) { notifyError(e); return; }
    tokenRef.current = ""; clearSession(); setAuth(false); setUser(null); setConfirm(null); setPanel("tasks"); setTaskTitle(""); setLoginError(""); setTasks([]); setAllPosts([]); setDraft(emptyDraft()); setPost(null); navigate("/"); setToast("已退出");
  }
  async function savePost(status: "draft" | "published") {
    if (!draft.title.trim() || !draft.content.trim()) { setToast("请填写标题和正文"); return; }
    setBusy(true);
    try {
      const data = { title: draft.title, content: draft.content, excerpt: draft.excerpt, category: draft.category, ...(canPosts ? { featured: draft.featured } : {}), tags: draft.tagsText.split(/[,，]/).map((t) => t.trim()).filter(Boolean), status };
      const v = await api<{ post: Post }>(draft.id ? `posts/${draft.id}` : "posts", draft.id ? "PATCH" : "POST", data);
      setDraft({ ...draft, id: v.post.id, status }); setToast(status === "published" ? "已发布" : "已保存");
      await Promise.all([loadPosts(), loadAdmin()]);
    } catch (e) { notifyError(e); }
    finally { setBusy(false); }
  }
  async function addTask(e: FormEvent) {
    e.preventDefault(); if (!taskTitle.trim()) return; setTaskBusy(true);
    try { const v = await api<{ task: Task }>("tasks", "POST", { title: taskTitle }); setTasks((t) => [v.task, ...t]); setTaskTitle(""); setToast("已添加"); }
    catch (e) { notifyError(e); } finally { setTaskBusy(false); }
  }
  async function toggleTask(t: Task) {
    setTaskBusy(true);
    try { const v = await api<{ task: Task }>(`tasks/${t.id}`, "PATCH", { done: !t.done }); setTasks((ts) => ts.map((x) => x.id === t.id ? v.task : x)); }
    catch (e) { notifyError(e); } finally { setTaskBusy(false); }
  }
  function editPost(p: Post) {
    setDraft({ featured: p.featured, id: p.id, title: p.title, content: p.content, excerpt: p.excerpt, category: p.category, tagsText: p.tags.join(", "), status: p.status }); setPanel("editor"); navigate("/admin");
  }
  function newPost() { setDraft(emptyDraft()); setPanel("editor"); navigate("/admin"); }
  async function featurePost(p: Post) {
    setBusy(true);
    try {
      await api("posts/" + p.id + "/feature", "PATCH", { featured: !p.featured });
      await Promise.all([loadPosts(), loadAdmin()]);
      setPost((old) => old?.id === p.id ? { ...old, featured: !p.featured } : old);
      setToast(p.featured ? "已取消推荐" : "已推荐");
    } catch (e) { notifyError(e); }
    finally { setBusy(false); }
  }
  function deletePost(p: Post) {
    setConfirm({ label: `删除文章「${p.title}」？`, action: async () => { await api(`posts/${p.id}`, "DELETE"); await Promise.all([loadPosts(), loadAdmin()]); if (draft.id === p.id) setDraft(emptyDraft()); setToast("已删除"); } });
  }
  function deleteTask(t: Task) {
    setConfirm({ label: `删除任务「${t.title}」？`, action: async () => { await api(`tasks/${t.id}`, "DELETE"); setTasks((ts) => ts.filter((x) => x.id !== t.id)); setToast("已删除"); } });
  }
  function toggleTheme() { const next = !dark; setDark(next); localStorage.setItem("tony-theme", next ? "dark" : "light"); document.documentElement.dataset.theme = next ? "dark" : "light"; }
  function exportMarkdown(p: Post) {
    const url = URL.createObjectURL(new Blob([`# ${p.title}\n\n${p.content}`], { type: "text/markdown;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `${p.title.replace(/[\\/:*?"<>|]/g, "-")}.md`; a.click(); URL.revokeObjectURL(url);
  }
  const feedPosts = posts.filter((p) => feed === "featured" ? p.featured : !p.featured);
  const categories = ["全部", ...new Set(feedPosts.map((p) => p.category))];
  const visiblePosts = feedPosts.filter((p) => (category === "全部" || p.category === category) && `${p.title} ${p.excerpt} ${p.content} ${p.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()));
  const pending = tasks.filter((t) => !t.done).length;
  const visibleTasks = tasks.filter((t) => taskFilter === "all" || (taskFilter === "done" ? t.done : !t.done));
  const registerPage = path === "/register";
  const adminPage = path.startsWith("/admin") || path === "/login" || registerPage;
  const postPage = path.startsWith("/post/");
  const ojPage = path === "/oj" || path.startsWith("/oj/");
  const about = path === "/about";
  const community = path.split("?")[0].match(/^\/(teams|discussions|solutions|sanctions)(?:\/|$)/)?.[1];
  const communityProps = { api, user, path };
  const communityKey = path + ":" + (user?.id || 0) + ":" + (user?.permissions || []).join(",");
  const profileId = path.match(/^\/user\/([1-9]\d{0,14})(?:\?tab=(?:posts|solved))?$/)?.[1];
  useEffect(() => { setLoginError(""); setPassword(""); setPasswordAgain(""); }, [path]);
  const loader = <div className="empty-state"><Loader2 className="spin" /><p>正在加载…</p></div>;
  return <div className="site">
    <header className="header"><div className="header-inner"><a className="brand" href="#/">Heruo OJ</a>
      <nav className={mobileMenu ? "main-nav mobile-open" : "main-nav"} aria-label="主导航"><a className={!adminPage && !about && !ojPage && !profileId && !community ? "active" : ""} href="#/">文章</a><a className={ojPage ? "active" : ""} href="#/oj">题库</a><a className={community === "solutions" ? "active" : ""} href="#/solutions">题解</a><a className={community === "discussions" ? "active" : ""} href="#/discussions">讨论</a><a className={community === "teams" ? "active" : ""} href="#/teams">团队</a><a className={community === "sanctions" ? "active" : ""} href="#/sanctions">陶片放逐</a><a className={about ? "active" : ""} href="#/about">关于</a></nav>
      <div className="header-actions"><button className="icon-button theme-button" onClick={toggleTheme} aria-label={dark ? "切换浅色模式" : "切换深色模式"}>{dark ? <Sun size={18} /> : <Moon size={18} />}</button><a className={`admin-link ${adminPage ? "selected" : ""}`} href="#/admin">{auth ? "我的" : "登录"}<ArrowUpRight size={15} /></a>{!auth && <a className="register-link" href="#/register">注册</a>}<button className="icon-button menu-button" aria-label="打开导航" onClick={() => setMobileMenu(!mobileMenu)}><Menu size={20} /></button></div>
    </div></header>
    <main>
      {sessionError && <div className="session-banner" role="status">{sessionError}<button onClick={() => void restoreSession()}>重试连接</button></div>}
      {community === "teams" ? <Teams key={communityKey} {...communityProps}/> : community === "discussions" ? <Discussions key={communityKey} {...communityProps}/> : community === "solutions" ? <Solutions key={communityKey} {...communityProps}/> : community === "sanctions" ? <Sanctions key={communityKey} {...communityProps}/> : profileId ? <UserProfile key={profileId} id={profileId} api={api}/> : ojPage ? <OjApp api={api} user={user} path={path}/> : adminPage ? !authReady ? loader : !auth ? <section className="login-wrap"><form className="login-form" onSubmit={login}>
        <h1>{registerPage ? "注册" : "登录"}</h1>
        <label htmlFor="username">{registerPage ? "用户名" : "用户名 / ID"}</label>
        <input id="username" autoComplete="username" placeholder={registerPage ? "字母开头，3–24 位" : "用户名或 ID"} value={username} onChange={(e) => setUsername(e.target.value)} required maxLength={24} pattern={registerPage ? "[A-Za-z][A-Za-z0-9_]{2,23}" : undefined}/>
        <label htmlFor="password">密码</label>
        <input id="password" type="password" autoComplete={registerPage ? "new-password" : "current-password"} placeholder={registerPage ? "至少 8 位" : "密码"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={registerPage ? 8 : 1} maxLength={200}/>
        {registerPage && <><label htmlFor="password-again">确认密码</label><input id="password-again" type="password" autoComplete="new-password" placeholder="确认密码" value={passwordAgain} onChange={(e) => setPasswordAgain(e.target.value)} required minLength={8} maxLength={200}/></>}
        {loginError && <p className="field-error" role="alert">{loginError}</p>}
        <button className="button primary full" type="submit" disabled={busy}>{busy ? <Loader2 size={18} className="spin"/> : registerPage ? "注册" : "登录"}</button>
        <div className="auth-links"><a href={registerPage ? "#/admin" : "#/register"}>{registerPage ? "登录" : "注册"}</a><a href="#/">返回</a></div>
      </form></section> : <section className="workspace"><aside className="workspace-sidebar"><div className="account-summary"><a className="author-link" href={"#/user/" + user?.id}><strong>{user?.display_name}</strong></a><span>ID {user?.id} · {isSuper ? "超级管理员" : user?.permissions?.length ? "管理员" : "用户"}</span></div><a className="sidebar-item" href={"#/user/" + user?.id}><Users size={18}/>个人主页</a><button className={panel === "tasks" ? "sidebar-item active" : "sidebar-item"} onClick={() => setPanel("tasks")}><ListTodo size={18}/>待办清单<span className="sidebar-count">{pending}</span></button><button className={panel === "posts" ? "sidebar-item active" : "sidebar-item"} onClick={() => setPanel("posts")}><FileText size={18}/>文章管理</button><button className={panel === "editor" ? "sidebar-item active" : "sidebar-item"} onClick={newPost}><PenLine size={18}/>写文章</button>{canProblems && <a className="sidebar-item" href="#/oj/admin"><BookOpen size={18}/>题目管理</a>}{canUsers && <button className={panel === "users" ? "sidebar-item active" : "sidebar-item"} onClick={() => setPanel("users")}><Users size={18}/>用户管理</button>}{can(user, "solutions") && <a className="sidebar-item" href="#/solutions?manage=1"><FileText size={18}/>题解管理</a>}{can(user, "discussions") && <a className="sidebar-item" href="#/discussions?manage=1"><FileText size={18}/>讨论区管理</a>}<div className="sidebar-bottom"><button className="sidebar-item" onClick={() => void logout()}><LogOut size={17}/>退出</button></div></aside><div className="workspace-content">
        {adminError && <div className="error-banner" role="alert">{adminError}<button onClick={() => void loadAdmin()}>重试</button></div>}
        {panel === "tasks" && <><div className="workspace-heading"><div><h1>待办</h1></div></div><div className="task-overview"><div><span>待完成</span><strong>{pending.toString().padStart(2, "0")}</strong></div><div><span>已完成</span><strong>{(tasks.length - pending).toString().padStart(2, "0")}</strong></div></div><form className="task-add" onSubmit={addTask}><Plus size={20}/><input aria-label="新任务" value={taskTitle} onChange={(e) => setTaskTitle(e.target.value)} maxLength={250} placeholder="任务名称" required/><button className="button primary" disabled={taskBusy} type="submit">{taskBusy ? <Loader2 size={16} className="spin"/> : "添加"}</button></form><div className="task-toolbar"><div className="segmented">{[["active", "待完成"], ["done", "已完成"], ["all", "全部"]].map(([v, label]) => <button key={v} className={taskFilter === v ? "active" : ""} onClick={() => setTaskFilter(v)}>{label}</button>)}</div><span>{visibleTasks.length} 个任务</span></div>{adminLoading ? loader : visibleTasks.length ? <div className="task-list">{visibleTasks.map((t) => <div key={t.id} className={`task-row ${t.done ? "done" : ""}`}><button className="task-check" aria-label={t.done ? "撤销完成" : "完成任务"} aria-pressed={t.done} disabled={taskBusy} onClick={() => void toggleTask(t)}>{t.done && <Check size={15}/>}</button><div><strong>{t.title}</strong><small>{date(t.created_at)}</small></div><button className="icon-button delete-button" aria-label={`删除任务 ${t.title}`} disabled={taskBusy} onClick={() => deleteTask(t)}><Trash2 size={16}/></button></div>)}</div> : <div className="empty-state task-empty"><h3>{taskFilter === "done" ? "暂无已完成任务" : taskFilter === "active" ? "暂无待办" : "暂无任务"}</h3></div>}</>}
        {panel === "posts" && <><div className="workspace-heading"><div><h1>文章管理</h1></div><button className="button primary" onClick={newPost}><Plus size={17}/>新建文章</button></div><div className="management-summary"><span>{allPosts.length} 篇文章</span><span><span className="status-dot"/>{allPosts.filter((p) => p.status === "published").length} 已发布</span><span>{allPosts.filter((p) => p.status === "draft").length} 草稿</span></div>{adminLoading ? loader : allPosts.length ? <div className="management-list">{allPosts.map((p) => <div className="manage-row" key={p.id}><span className="manage-icon"><FileText size={20}/></span><div><button className="text-button manage-title" onClick={() => editPost(p)}>{p.title}</button><p><a className="author-link" href={"#/user/" + p.author_id}>{p.author_name}</a><span>·</span>{date(p.created_at)}<span>·</span>{p.category}</p></div><span className={`post-status ${p.status}`}>{p.status === "published" ? "已发布" : "草稿"}</span>{canPosts && p.status === "published" && <button className={"feature-button " + (p.featured ? "active" : "")} disabled={busy} onClick={() => void featurePost(p)}>{p.featured ? "取消推荐" : "推荐"}</button>}<button className="icon-button" aria-label="编辑文章" onClick={() => editPost(p)}><PenLine size={16}/></button><button className="icon-button" aria-label="导出文章" onClick={() => exportMarkdown(p)}><Download size={16}/></button><button className="icon-button delete-button" aria-label="删除文章" onClick={() => deletePost(p)}><Trash2 size={16}/></button></div>)}</div> : <div className="empty-state"><BookOpen size={30}/><h3>暂无文章</h3><button className="button primary" onClick={newPost}>新建文章<ArrowRight size={16}/></button></div>}</>}
        {panel === "users" && canUsers && user && <UserManagement api={api} user={user}/>}
        {panel === "editor" && <><div className="workspace-heading editor-heading"><div><h1>{draft.id ? "编辑文章" : "写文章"}</h1></div><div className="editor-actions"><button className="button secondary" disabled={busy} onClick={() => void savePost("draft")}>保存草稿</button><button className="button primary" disabled={busy} onClick={() => void savePost("published")}>{busy ? <Loader2 size={16} className="spin"/> : <><ArrowUpRight size={16}/>{draft.status === "published" ? "更新" : "发布"}</>}</button></div></div><div className="editor-card"><input className="title-input" aria-label="文章标题" placeholder="文章标题" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={150}/><div className="editor-meta"><label>分类<input value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} placeholder="随笔" maxLength={30}/></label><label>标签<input value={draft.tagsText} onChange={(e) => setDraft({ ...draft, tagsText: e.target.value })} placeholder="标签（逗号分隔）"/></label></div>{canPosts && <label className="feature-check"><input type="checkbox" checked={draft.featured} onChange={(e) => setDraft({ ...draft, featured: e.target.checked })}/>主站推荐</label>}<label className="excerpt-label">摘要<textarea value={draft.excerpt} onChange={(e) => setDraft({ ...draft, excerpt: e.target.value })} placeholder="摘要（选填）" maxLength={400} rows={2}/></label><div className="editor-toolbar"><span>正文</span><div className="editor-tools"><button className="text-button" onClick={() => fileRef.current?.click()}><Upload size={14}/>导入</button><input ref={fileRef} type="file" accept=".md,.markdown,.txt,text/markdown,text/plain" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 500000) { setToast("文件不能超过 500 KB。"); return; } const text = await f.text(); setDraft((d) => ({ ...d, content: text, title: d.title || text.match(/^#\s+(.+)$/m)?.[1] || f.name.replace(/\.[^.]+$/, "") })); e.target.value = ""; }}/><div className="segmented compact">{[["write", "编辑"], ["split", "分屏"], ["preview", "预览"]].map(([v, l]) => <button key={v} className={view === v ? "active" : ""} onClick={() => setView(v)}>{l}</button>)}</div></div></div><div className={`editor-body ${view}`}>{view !== "preview" && <textarea className="markdown-input" aria-label="正文" spellCheck={false} placeholder="正文" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} maxLength={150000} onKeyDown={(e) => { if (e.key === "Tab") { e.preventDefault(); const el = e.currentTarget; const s = el.selectionStart, end = el.selectionEnd; const next = draft.content.slice(0, s) + "    " + draft.content.slice(end); setDraft({ ...draft, content: next }); requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = s + 4; }); } }}/>}{view !== "write" && <div className="markdown-preview"><span className="preview-label"><Eye size={12}/>预览</span>{draft.content ? <Markdown content={draft.content}/> : <p className="preview-empty">暂无内容</p>}</div>}</div><div className="editor-footer"><span>{draft.content.length.toLocaleString()} 字符</span><span>{draft.id ? (draft.status === "published" ? "已发布" : "草稿") : "未保存"}</span></div></div></>}
      </div></section>
      : postPage ? <section className="reading-page"><a href="#/" className="back-link"><ArrowLeft size={15}/>返回</a>{postLoading ? loader : postError ? <div className="empty-state"><h2>文章不存在</h2><p>{postError}</p></div> : post && <article><div className="article-kicker"><span className="category-label">{post.category}</span><span>{date(post.created_at, true)}</span><span>{reading(post.content)} 分钟阅读</span>{post.status === "draft" && <span className="post-status draft">草稿</span>}</div><h1>{post.title}</h1>{post.excerpt && <p className="article-excerpt">{post.excerpt}</p>}<div className="article-author"><a className="avatar" href={"#/user/" + post.author_id}>{post.author_name.slice(0, 1)}</a><a className="author-link" href={"#/user/" + post.author_id}><strong>{post.author_name}</strong><small>ID {post.author_id}</small></a>{auth && (canPosts || user?.id === post.author_id) && <button className="button secondary" onClick={() => editPost(post)}><PenLine size={14}/>编辑文章</button>}</div>{canPosts && post.status === "published" && <button className={"feature-button " + (post.featured ? "active" : "")} disabled={busy} onClick={() => void featurePost(post)}>{post.featured ? "取消推荐" : "推荐到主站"}</button>}<Markdown content={post.content}/><div className="article-bottom"><div className="tags">{post.tags.map((t) => <span key={t}>#{t}</span>)}</div><button className="text-button" onClick={() => exportMarkdown(post)}><Download size={14}/>导出</button></div><div className="article-end"><a href="#/">文章列表<ArrowRight size={14}/></a></div></article>}</section>
      : about ? <section className="about-page"><h1>关于</h1><p>Heruo OJ</p><a className="text-button" href="https://github.com/Heruoqwq/Heruo-blog" target="_blank" rel="noopener noreferrer"><Github size={16}/>源码<ArrowUpRight size={14}/></a></section>
      : <div className="public-content"><section className="articles-section" id="articles"><div className="section-header"><div><h2>文章<span className="count-badge">{feedPosts.length}</span></h2></div><label className="search-box"><Search size={16}/><input aria-label="搜索文章" placeholder="搜索" value={query} onChange={(e) => setQuery(e.target.value)}/>{query && <button className="icon-button" aria-label="清空搜索" onClick={() => setQuery("")}><X size={14}/></button>}</label></div><div className="feed-tabs"><button className={feed === "featured" ? "active" : ""} onClick={() => { setFeed("featured"); setCategory("全部"); }}>主站推荐</button><button className={feed === "personal" ? "active" : ""} onClick={() => { setFeed("personal"); setCategory("全部"); }}>个人文章</button></div><div className="category-tabs">{categories.map((c) => <button className={category === c ? "active" : ""} onClick={() => setCategory(c)} key={c}>{c}</button>)}</div>
      {loading ? loader : loadError ? <div className="empty-state" role="alert"><p>{loadError}</p><button className="button secondary" onClick={() => void loadPosts()}>重试</button></div> : visiblePosts.length ? <div className="post-list">{visiblePosts.map((p) => <PostCard post={p} key={p.id}/>)}</div> : <div className="empty-state"><BookOpen size={29}/><h3>{feedPosts.length ? "未找到文章" : feed === "featured" ? "暂无推荐" : "暂无文章"}</h3>{!feedPosts.length && feed === "featured" && <button className="button secondary" onClick={() => setFeed("personal")}>个人文章</button>}{!posts.length && <a className="button secondary" href="#/admin">新建文章<PenLine size={15}/></a>}</div>}
      </section></div>}
    </main>
    <footer className="footer"><div><span>© {new Date().getFullYear()} Heruo</span></div><a href="https://github.com/Heruoqwq/Heruo-blog" target="_blank" rel="noopener noreferrer"><Github size={16}/>源码<ArrowUpRight size={13}/></a></footer>
    {toast && <div className="toast" role="status">{toast}<button className="icon-button" onClick={() => setToast("")} aria-label="关闭提示"><X size={15}/></button></div>}
    {confirm && <div className="modal-backdrop" onClick={() => !busy && setConfirm(null)}><div className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="confirm-label" onClick={(e) => e.stopPropagation()}><span className="delete-modal-icon"><Trash2 size={25}/></span><h2 id="confirm-label">{confirm.label}</h2><div><button className="button secondary" autoFocus disabled={busy} onClick={() => setConfirm(null)}>取消</button><button className={panel === "users" ? "button primary" : "button danger"} disabled={busy} onClick={async () => { setBusy(true); try { await confirm.action(); setConfirm(null); } catch (e) { notifyError(e); } finally { setBusy(false); } }}>{busy ? <Loader2 size={16} className="spin"/> : panel === "users" ? "确认" : "确认删除"}</button></div></div></div>}
  </div>;
}
