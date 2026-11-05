"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Heart, Plus, ArrowLeft, MessageCircle, Star } from "lucide-react";
import Markdown from "./markdown";
import { type Api, type User, can, go, time, Author, Loading, ErrorBox, Pager, SearchForm, MarkdownEditor, Confirm, ReplyForm, PageHeading } from "./community-shared";
type Solution = { team_id?: string | null; can_manage?: boolean; id: string; problem_id: number; problem_code: string; problem_title: string; title: string; content: string; excerpt?: string; author_id: number; author_name: string; status: string; featured: boolean; likes: number; comments: number; review_note?: string; created_at: string };
type Comment = { id: string; author_id: number; author_name: string; content: string; created_at: string };
const statuses: Record<string, string> = { draft: "草稿", pending: "待审核", published: "已公开", rejected: "需修改" };
export default function Solutions({ api, user, path }: { api: Api; user: User | null; path: string }) {
  const route = path.split("?")[0], params = new URLSearchParams(path.split("?")[1] || "");
  const match = route.match(/^\/solutions\/([a-f0-9-]{36})(\/edit)?$/), id = match?.[1], editing = route === "/solutions/new" || Boolean(match?.[2]);
  const initialProblem = params.get("problem_id") || "";
  const [bankModerator, setBankModerator] = useState(false);
  const [items, setItems] = useState<Solution[]>([]), [item, setItem] = useState<Solution | null>(null), [comments, setComments] = useState<Comment[]>([]);
  const moderator = item ? Boolean(item.can_manage) : bankModerator;
  const [liked, setLiked] = useState(false), [loading, setLoading] = useState(true), [error, setError] = useState(""), [busy, setBusy] = useState(false), [version, setVersion] = useState(0);
  const [query, setQuery] = useState(""), [filter, setFilter] = useState(params.get("manage") === "1" ? "manage" : "public"), [sort, setSort] = useState("latest");
  const [offset, setOffset] = useState(0), [next, setNext] = useState<number | null>(null), [confirm, setConfirm] = useState<{ text: string; action: () => Promise<unknown> } | null>(null);
  const [title, setTitle] = useState(""), [content, setContent] = useState(""), [problemId, setProblemId] = useState(initialProblem), [problems, setProblems] = useState<{ id: number; code: string; title: string }[]>([]);
  const [review, setReview] = useState("published"), [featured, setFeatured] = useState(false), [note, setNote] = useState("");
  useEffect(() => {
    let alive = true; setLoading(true); setError("");
    const task = async () => {
      if (id) {
        const r = await api<{ solution: Solution; comments: Comment[]; liked: boolean; next_offset: number | null }>("solutions/" + id + "?offset=" + offset);
        if (!alive) return; setItem(r.solution); setComments(r.comments); setLiked(r.liked); setNext(r.next_offset);
        setTitle(r.solution.title); setContent(r.solution.content); setProblemId(String(r.solution.problem_id)); setFeatured(r.solution.featured); setNote(r.solution.review_note || "");
      } else if (!editing) {
        const r = await api<{ solutions: Solution[]; next_offset: number | null; can_manage: boolean }>("solutions?offset=" + offset + "&q=" + encodeURIComponent(query) + "&sort=" + sort + (initialProblem ? "&problem_id=" + initialProblem : "") + (filter === "public" ? "" : "&" + filter + "=1"));
        if (alive) { setItems(r.solutions); setNext(r.next_offset); setBankModerator(r.can_manage); }
      }
      if (editing && !id) {
        const chosen = initialProblem ? await api<{ problem: { id: number; code: string; title: string; team_id?: string | null } }>("oj/problems/" + initialProblem) : null;
        const r = await api<{ problems: { id: number; code: string; title: string }[] }>("oj/problems" + (chosen?.problem.team_id ? "?team_id=" + chosen.problem.team_id : ""));
        if (alive) setProblems(chosen && !r.problems.some((p) => p.id === chosen.problem.id) ? [chosen.problem, ...r.problems] : r.problems);
      }
    };
    void task().catch((e) => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id, editing, query, sort, filter, offset, version]);
  async function act(action: () => Promise<unknown>) {
    if (busy) return false; setBusy(true); setError("");
    try { await action(); setVersion((v) => v + 1); return true; } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); setConfirm(null); }
  }
  async function save(status: string) {
    if (!title.trim() || !content.trim() || !problemId) { setError("请填写题目、标题和正文"); return; }
    await act(async () => { const r = await api<{ solution: Solution }>(id ? "solutions/" + id : "solutions", id ? "PATCH" : "POST", { problem_id: Number(problemId), title, content, status }); go("/solutions/" + r.solution.id); });
  }
  async function reviewSubmit(e: FormEvent) { e.preventDefault(); await act(() => api("solutions/" + id + "/review", "PATCH", { status: review, featured, review_note: note })); }
  return <section className="community-page">
    <PageHeading title={editing ? id ? "编辑题解" : "写题解" : id ? "题解" : "题解区"}>{!editing && !id && user && <a className="button primary" href={"#/solutions/new" + (initialProblem ? "?problem_id=" + initialProblem : "")}><Plus size={16}/>写题解</a>}</PageHeading>
    <ErrorBox error={error}/>
    {loading ? <Loading/> : editing ? !user ? <p className="community-login"><a href="#/login">登录</a>后写题解</p> : id && item?.author_id !== user.id && !moderator ? <p>没有编辑权限</p> : <form className="community-form" onSubmit={(e) => { e.preventDefault(); void save("pending"); }}>
      <a className="back-link" href={id ? "#/solutions/" + id : "#/solutions"}><ArrowLeft size={14}/>返回</a>
      <label>题目{id ? <span>{item?.problem_code} · {item?.problem_title}</span> : <select required value={problemId} onChange={(e) => setProblemId(e.target.value)}><option value="">选择题目</option>{problems.map((p) => <option key={p.id} value={p.id}>{p.code} · {p.title}</option>)}</select>}</label>
      <label>标题<input required maxLength={150} value={title} onChange={(e) => setTitle(e.target.value)}/></label>
      <MarkdownEditor label="题解正文" value={content} onChange={setContent} limit={100000}/><p className="muted">提交后由题解管理员审核；修改公开题解会重新进入审核。</p>
      <div className="community-actions"><button type="button" className="button secondary" disabled={busy} onClick={() => void save("draft")}>保存草稿</button><button className="button primary" disabled={busy}>提交审核</button></div>
    </form> : id && item ? <>
      <a className="back-link" href={"#/oj/problem/" + item.problem_id + "/editorial"}><ArrowLeft size={14}/>{item.problem_code} · {item.problem_title}</a>
      {item.team_id && <p className="team-bank-link"><a href={"#/teams/" + item.team_id}>返回团队</a><span>此题解仅团队成员可见</span></p>}<article className="community-article"><div className="community-meta"><span className={"post-status " + item.status}>{statuses[item.status]}</span>{item.featured && <span className="community-badge"><Star size={12}/>精选</span>}<Author id={item.author_id} name={item.author_name}/><span>{time(item.created_at)}</span></div><h2>{item.title}</h2><Markdown content={item.content}/></article>
      {item.review_note && <p className="review-note">审核意见：{item.review_note}</p>}
      <div className="community-actions">{item.status === "published" && <button className={"button secondary " + (liked ? "liked" : "")} disabled={busy || !user} onClick={() => void act(() => api("solutions/" + id + "/like", liked ? "DELETE" : "POST"))}><Heart size={15} fill={liked ? "currentColor" : "none"}/>{item.likes}</button>}{user && (item.author_id === user.id || moderator) && <><a className="button secondary" href={"#/solutions/" + id + "/edit"}>编辑</a><button className="text-button danger" disabled={busy} onClick={() => setConfirm({ text: "删除这篇题解及评论？", action: async () => { await api("solutions/" + id, "DELETE"); go("/solutions"); } })}>删除</button></>}</div>
      {moderator && <form className="review-form" onSubmit={reviewSubmit}><h3>题解审核</h3><label>审核结果<select value={review} onChange={(e) => setReview(e.target.value)}><option value="published">通过并公开</option><option value="rejected">退回修改</option><option value="pending">设为待审核</option></select></label><label className="inline-check"><input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)}/>精选题解</label><label>审核意见<input value={note} maxLength={1000} onChange={(e) => setNote(e.target.value)}/></label><button className="button primary" disabled={busy}>保存审核</button></form>}
      {item.status === "published" && <div className="community-comments"><h3>评论 · {item.comments}</h3>{comments.map((c) => <article className="reply-card" key={c.id}><div className="community-meta"><Author id={c.author_id} name={c.author_name}/><span>{time(c.created_at)}</span>{user && (c.author_id === user.id || moderator) && <button className="text-button danger" disabled={busy} onClick={() => setConfirm({ text: "删除这条评论？", action: () => api("solutions/" + id + "/comments/" + c.id, "DELETE") })}>删除</button>}</div><Markdown content={c.content}/></article>)}{!comments.length && <p className="muted">暂无评论</p>}<Pager offset={offset} next={next} onChange={setOffset}/><ReplyForm user={user} busy={busy} label="评论" onSubmit={(text) => act(() => api("solutions/" + id + "/comments", "POST", { content: text }))}/></div>}
    </> : !id ? <>
      <div className="community-toolbar"><div className="segmented">{[["public", "公开题解"], ...(user ? [["mine", "我的题解"]] : []), ...(moderator ? [["manage", "题解管理"]] : [])].map(([value, name]) => <button key={value} className={filter === value ? "active" : ""} onClick={() => { setFilter(value); setOffset(0); }}>{name}</button>)}</div><select aria-label="题解排序" value={sort} onChange={(e) => { setSort(e.target.value); setOffset(0); }}><option value="latest">最新</option><option value="popular">最多赞同</option></select></div>
      {initialProblem && <a className="back-link" href={"#/oj/problem/" + initialProblem + "/editorial"}>返回题目</a>}<SearchForm value={query} placeholder="搜索题解或题号" onSearch={(q) => { setQuery(q); setOffset(0); }}/>
      <div className="community-list">{items.map((s) => <article key={s.id} className="community-card"><div className="community-card-main"><div className="community-meta"><a href={"#/oj/problem/" + s.problem_id}>{s.problem_code}</a>{s.featured && <span className="community-badge">精选</span>}<span>{statuses[s.status]}</span></div><h2><a href={"#/solutions/" + s.id}>{s.title}</a></h2><p className="community-excerpt">{s.excerpt?.replace(/[#*`]/g, "")}</p><div className="community-meta"><Author id={s.author_id} name={s.author_name}/><span>{time(s.created_at)}</span></div></div><div className="community-counts"><span><Heart size={14}/>{s.likes}</span><span><MessageCircle size={14}/>{s.comments}</span></div></article>)}</div>{!items.length && !error && <div className="empty-state">暂无题解</div>}<Pager offset={offset} next={next} onChange={setOffset}/>
    </> : null}
    {confirm && <Confirm text={confirm.text} busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void act(confirm.action)}/>}
  </section>;
}
