"use client";
import { useEffect, useState } from "react";
import { type Api, type User, Author } from "./community-shared";
export function ProblemSolutions({ api, problemId, user }: { api: Api; problemId: number; user: User | null }) {
  const [items, setItems] = useState<{ id: string; title: string; author_id: number; author_name: string; likes: number }[]>([]), [error, setError] = useState("");
  useEffect(() => { let alive = true; void api<{ solutions: typeof items }>("solutions?problem_id=" + problemId + "&sort=popular").then((r) => { if (alive) setItems(r.solutions.slice(0, 5)); }).catch((e) => { if (alive) setError(e.message); }); return () => { alive = false; }; }, [problemId]);
  return <section className="problem-community"><div className="oj-section-heading"><h2>社区题解</h2><a className="button secondary" href={"#/solutions/new?problem_id=" + problemId}>{user ? "写题解" : "登录后投稿"}</a></div>{error && <p className="field-error" role="alert">{error}</p>}{items.map((s) => <div className="team-problem" key={s.id}><a href={"#/solutions/" + s.id}>{s.title}</a><Author id={s.author_id} name={s.author_name}/><span className="muted">{s.likes} 赞同</span></div>)}{!items.length && !error && <p className="muted">暂无公开的社区题解</p>}<a className="text-button" href={"#/solutions?problem_id=" + problemId}>查看全部题解 →</a></section>;
}
