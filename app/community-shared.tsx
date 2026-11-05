"use client";
import { useState, type FormEvent, type ReactNode } from "react";
import { Loader2, Search } from "lucide-react";
import Markdown from "./markdown";
export type Permission = "users" | "posts" | "solutions" | "problems" | "discussions";
export type User = { id: number; username: string; display_name: string; role: "user" | "superadmin"; permissions?: Permission[] };
export type Api = <T>(route: string, method?: string, data?: unknown) => Promise<T>;
export const permissionNames: Record<Permission, string> = { users: "用户管理", posts: "文章管理", solutions: "题解管理", problems: "题目管理", discussions: "讨论区管理" };
export const can = (u: User | null, p: Permission) => Boolean(u && ((u.id === 1 && u.role === "superadmin") || u.permissions?.includes(p)));
export const time = (s: string) => new Date(s).toLocaleString("zh-CN", { hour12: false });
export const go = (s: string) => { window.location.hash = s; window.scrollTo({ top: 0, behavior: "smooth" }); };
export function Author({ id, name }: { id: number; name: string }) { return <a className="author-link" href={"#/user/" + id}>{name}</a>; }
export function Loading() { return <div className="empty-state" role="status"><Loader2 className="spin"/><span>加载中…</span></div>; }
export function ErrorBox({ error }: { error: string }) { return error ? <div className="error-banner" role="alert">{error}</div> : null; }
export function Pager({ offset, next, onChange }: { offset: number; next: number | null; onChange: (n: number) => void }) { return offset || next !== null ? <div className="community-pager"><button className="button secondary" disabled={!offset} onClick={() => onChange(Math.max(0, offset - 30))}>上一页</button><span>第 {offset / 30 + 1} 页</span><button className="button secondary" disabled={next === null} onClick={() => next !== null && onChange(next)}>下一页</button></div> : null; }
export function SearchForm({ value, onSearch, placeholder }: { value: string; onSearch: (s: string) => void; placeholder: string }) {
  const [text, setText] = useState(value);
  return <form className="community-search" onSubmit={(e) => { e.preventDefault(); onSearch(text); }}><Search size={16}/><input aria-label={placeholder} placeholder={placeholder} value={text} maxLength={100} onChange={(e) => setText(e.target.value)}/><button className="button secondary">搜索</button></form>;
}
export function MarkdownEditor({ value, onChange, label = "正文", limit = 50000 }: { value: string; onChange: (s: string) => void; label?: string; limit?: number }) {
  const [preview, setPreview] = useState(false);
  return <div className="community-editor"><div className="editor-toolbar"><span>{label} · Markdown</span><div className="segmented"><button type="button" className={!preview ? "active" : ""} onClick={() => setPreview(false)}>编辑</button><button type="button" className={preview ? "active" : ""} onClick={() => setPreview(true)}>预览</button></div></div>{preview ? <div className="markdown-preview">{value ? <Markdown content={value}/> : <p className="muted">暂无内容</p>}</div> : <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} rows={10} maxLength={limit} required spellCheck={false}/>}</div>;
}
export function Confirm({ text, busy, onCancel, onConfirm }: { text: string; busy: boolean; onCancel: () => void; onConfirm: () => void }) { return <div className="modal-overlay"><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-label="确认操作"><h2>{text}</h2><div className="modal-actions"><button className="button secondary" disabled={busy} onClick={onCancel}>取消</button><button className="button primary" disabled={busy} onClick={onConfirm}>{busy && <Loader2 size={14} className="spin"/>}确认</button></div></section></div>; }
export function ReplyForm({ user, busy, onSubmit, label = "回复" }: { user: User | null; busy: boolean; onSubmit: (s: string) => Promise<boolean>; label?: string }) {
  const [text, setText] = useState("");
  async function submit(e: FormEvent) { e.preventDefault(); if (await onSubmit(text)) setText(""); }
  return user ? <form className="community-reply-form" onSubmit={submit}><MarkdownEditor label={label} value={text} onChange={setText} limit={10000}/><button className="button primary" disabled={busy || !text.trim()}>{busy && <Loader2 size={14} className="spin"/>}发表{label}</button></form> : <p className="community-login"><a href="#/login">登录</a>后参与{label}</p>;
}
export function PageHeading({ title, children }: { title: string; children?: ReactNode }) { return <div className="workspace-heading"><h1>{title}</h1><div className="community-actions">{children}</div></div>; }
