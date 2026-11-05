"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, Check, Code, FileText, Loader2, Plus, RefreshCw, Search, Trash2, Upload } from "lucide-react";
import Markdown from "./markdown";
import { CaseField, TestResult } from "./oj-details";
import { MAX_FILE, MAX_DATA, pairTestFiles } from "./oj-data";
import { type User, can } from "./community-shared";
import { ProblemSolutions } from "./problem-community";
type Case = { group?: number; input: string; output: string; weight: number; input_file?: string | null; output_file?: string | null; input_name?: string | null; output_name?: string | null; input_size?: number; output_size?: number };
type Sample = { input: string; output: string };
type Assessment = { difficulty: number; difficulty_tier: number; quality: number; quality_note: string };
type Problem = Assessment & { team_id?: string | null; can_manage?: boolean; can_editorial?: boolean; checker: "text" | "casefold"; scoring: "weighted" | "all" | "groups"; id: number; code: string; title: string; statement: string; editorial?: string; editorial_published?: boolean; samples: Sample[]; cases?: Case[]; time_limit: number; memory_limit: number; published: boolean; revision: number };
type Detail = { group?: number; index: number; status: string; time: number; memory: number; weight: number };
type Submission = { team_id?: string | null; checker?: string; scoring?: string; id: string; user_id: number; username: string; problem_id: number; problem_code: string; problem_title: string; revision: number; language: string; status: string; score: number; passed: number; total: number; time: number; memory: number; source?: string; time_limit?: number; memory_limit?: number; compile_log?: string; judge_error?: string; details?: Detail[]; created_at: string };
type Api = <T>(route: string, method?: string, data?: unknown) => Promise<T>;
type Edit = Omit<Problem, "id" | "revision"> & { id?: number; cases: Case[] };
const levels = ["暂无评定", "入门", "普及−", "普及/提高−", "普及+/提高", "提高+/省选−", "省选/NOI−", "NOI/NOI+/CTSC"];
const tiers = ["", "下位", "中位", "上位"];
const qualities = ["未评价", "C", "B", "A", "S"];
const emptyAssessment = (): Assessment => ({ difficulty: 0, difficulty_tier: 0, quality: 0, quality_note: "" });
const empty = (): Edit => ({ ...emptyAssessment(), checker: "text", scoring: "weighted", code: "", title: "", statement: "", samples: [{ input: "", output: "" }], cases: [{ input: "", output: "", weight: 1 }], time_limit: 1000, memory_limit: 256, published: false });
const verdicts: Record<string, string> = { QUEUED: "等待评测", JUDGING: "评测中", AC: "答案正确", WA: "答案错误", TLE: "运行超时", MLE: "内存超限", RE: "运行错误", CE: "编译错误", JE: "评测服务异常" };
const waiting = (s: string) => ["QUEUED", "JUDGING"].includes(s);
const stamp = (s: string) => new Date(s).toLocaleString("zh-CN", { hour12: false });
const memory = (kb: number) => (kb / 1024).toFixed(1) + " MB";
const go = (path: string) => { window.location.hash = path; window.scrollTo({ top: 0, behavior: "smooth" }); };
function Verdict({ status }: { status: string }) { return <span className={"oj-verdict " + status} title={verdicts[status] || status}>{waiting(status) && <Loader2 size={12} className="spin"/>}{status === "AC" && <Check size={12}/>}<span>{waiting(status) ? verdicts[status] : status}</span></span>; }
function DifficultyBadge({ problem }: { problem: Assessment }) {
  const level = problem.difficulty || 0;
  return <span className="oj-difficulty" data-level={level}>{levels[level]}{level > 0 && tiers[problem.difficulty_tier] && " · " + tiers[problem.difficulty_tier]}</span>;
}
function QualityBadge({ quality }: { quality: number }) {
  return quality > 0 ? <span className="oj-quality" data-quality={quality}>质量 {qualities[quality]}</span> : null;
}
function AssessmentFields({ value, onChange }: { value: Assessment; onChange: (patch: Partial<Assessment>) => void }) {
  return <div className="oj-assessment-fields">
    <label>难度<select value={value.difficulty} onChange={(e) => {
      const difficulty = Number(e.target.value);
      onChange({ difficulty, difficulty_tier: difficulty ? value.difficulty_tier || 2 : 0 });
    }}>{levels.map((name, i) => <option key={i} value={i}>{name}</option>)}</select></label>
    <label>难度档位<select value={value.difficulty_tier} disabled={!value.difficulty} onChange={(e) => onChange({ difficulty_tier: Number(e.target.value) })}>
      {!value.difficulty && <option value={0}>未评定</option>}{tiers.slice(1).map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}
    </select></label>
    <label>质量等级<select value={value.quality} onChange={(e) => onChange({ quality: Number(e.target.value) })}>{qualities.map((name, i) => <option key={i} value={i}>{name}</option>)}</select></label>
    <label className="oj-quality-note-field">质量简评<textarea maxLength={1000} rows={3} value={value.quality_note} onChange={(e) => onChange({ quality_note: e.target.value })} placeholder="评价核心想法、完成度和适用场景"/></label>
  </div>;
}
function ProblemAssessment({ api, problem, canEdit, onSave }: { api: Api; problem: Problem; canEdit: boolean; onSave: (problem: Problem) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Assessment>(emptyAssessment);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const result = await api<{ problem: Problem }>(`oj/problems/${problem.id}/assessment`, "PATCH", draft);
      onSave(result.problem); setEditing(false); setSaved(true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  if (!canEdit && !problem.quality && !problem.quality_note) return null;
  return <div className="oj-assessment">
    {canEdit && <div className="oj-assessment-heading"><span>题目评价</span>{!editing && <button className="text-button" onClick={() => {
      setDraft({ difficulty: problem.difficulty, difficulty_tier: problem.difficulty_tier, quality: problem.quality, quality_note: problem.quality_note });
      setSaved(false); setError(""); setEditing(true);
    }}>编辑评价</button>}</div>}
    {saved && <p className="oj-notice" role="status">评价已保存</p>}
    {canEdit && editing ? <form onSubmit={save}><fieldset className="oj-assessment-editor" disabled={busy}>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <AssessmentFields value={draft} onChange={(patch) => setDraft({ ...draft, ...patch })}/>
      <div className="oj-assessment-actions"><button className="text-button" type="button" onClick={() => setEditing(false)}>取消</button><button className="button primary">{busy && <Loader2 size={14} className="spin"/>}保存评价</button></div>
    </fieldset></form> : problem.quality_note && <p className="oj-quality-note">{problem.quality_note}</p>}
  </div>;
}
function ProblemEditorial({ api, problem, canEdit, onSave }: { api: Api; problem: Problem; canEdit: boolean; onSave: (problem: Problem) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [published, setPublished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const isPublic = problem.published && problem.editorial_published;
  const content = canEdit || isPublic ? problem.editorial : "";

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ problem: Problem }>(`oj/problems/${problem.id}/editorial`, "PATCH", { editorial: draft, published });
      onSave(result.problem);
      setEditing(false);
      setSaved(true);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return <section>
    <div className="oj-section-heading">
      <h2>题解 {canEdit && <small>{isPublic ? problem.team_id ? "团队内已发布" : "已公开" : "仅题解管理员可见"}</small>}</h2>
      {canEdit && !editing && <button className="text-button" onClick={() => {
        setDraft(content || "");
        setPublished(Boolean(problem.editorial_published));
        setSaved(false);
        setEditing(true);
      }}>编辑题解</button>}
    </div>
    {saved && <p className="oj-notice" role="status">题解已保存</p>}
    {canEdit && editing ? <form onSubmit={save}>
      {error && <p className="error-banner" role="alert">{error}</p>}
      <textarea aria-label="Markdown 题解" className="oj-statement-input" value={draft} onChange={(e) => setDraft(e.target.value)} disabled={busy} maxLength={100000} placeholder="Markdown 题解，可填写思路、证明和参考代码"/>
      <div className="oj-submit-footer">
        <label className="oj-publish"><input type="checkbox" checked={published} disabled={busy} onChange={(e) => setPublished(e.target.checked)}/>{problem.team_id ? "向团队成员发布题解" : "公开题解"}{!problem.published && "（题目发布后可见）"}</label>
        <div className="oj-data-tools">
          <button type="button" className="text-button" disabled={busy} onClick={() => { setEditing(false); setError(""); }}>取消</button>
          <button className="button primary" disabled={busy || (published && !draft.trim())}>{busy && <Loader2 size={15} className="spin"/>}保存题解</button>
        </div>
      </div>
    </form> : content ? <Markdown content={content}/> : <p className="empty-state">{canEdit ? "暂无题解" : "暂无公开题解"}</p>}
  </section>;
}
export default function OjApp({ api, user, path: address }: { api: Api; user: User | null; path: string }) {
  const path = address.split("?")[0], params = new URLSearchParams(address.split("?")[1] || "");
  const bank = path.match(/^\/oj\/team\/([a-f0-9-]{36})(\/admin)?$/), teamId = bank?.[1] || params.get("team_id");
  const [teamManage, setTeamManage] = useState(false), [teamName, setTeamName] = useState("");
  const [problems, setProblems] = useState<Problem[]>([]);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState("");
  const [tierFilter, setTierFilter] = useState("");
  const [qualityFilter, setQualityFilter] = useState("");
  const [source, setSource] = useState("");
  const [edit, setEdit] = useState<Edit | null>(null);
  const [preview, setPreview] = useState(false);
  const [mine, setMine] = useState(false);
  const [offset, setOffset] = useState(0);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const file = useRef<HTMLInputElement>(null);
  const dataFiles = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState("");
  const codeFile = useRef<HTMLInputElement>(null);
  const current = useRef("");
  const superuser = user?.id === 1 && user.role === "superadmin";
  const problemManager = problem?.team_id ? Boolean(problem.can_manage) : teamId ? teamManage : can(user, "problems"), solutionManager = problem?.team_id ? Boolean(problem.can_editorial) : can(user, "solutions");
  const scope = problem?.team_id || submission?.team_id || teamId;
  const bankPath = scope ? "/oj/team/" + scope : "/oj";
  const admin = path === "/oj/admin" || Boolean(bank?.[2]);
  const records = path === "/oj/submissions";
  const detailId = path.match(/^\/oj\/submission\/([a-f0-9-]{36})$/)?.[1];
  const problemMatch = path.match(/^\/oj\/problem\/([1-9]\d*)(\/editorial)?$/);
  const problemId = problemMatch?.[1];
  const editorialTab = Boolean(problemMatch?.[2]);
  const dataPath = problemId ? `/oj/problem/${problemId}` : path;
  const routeKey = dataPath + ":" + (teamId || "") + ":" + (user?.permissions || []).join(",") + ":" + (user?.id || 0) + ":" + mine + ":" + offset;
  current.current = routeKey;
  async function load(key = routeKey) {
    setLoading(true); setError("");
    try {
      if (problemId) {
        const v = await api<{ problem: Problem }>("oj/problems/" + problemId);
        if (current.current === key) setProblem(v.problem);
      } else if (detailId) {
        const v = await api<{ submission: Submission }>("oj/submissions/" + detailId);
        if (current.current === key) setSubmission(v.submission);
      } else if (records) {
        const v = await api<{ submissions: Submission[]; next_offset: number | null }>("oj/submissions?offset=" + offset + (mine ? "&mine=1" : "") + (teamId ? "&team_id=" + teamId : ""));
        if (current.current === key) { setSubmissions(v.submissions); setNextOffset(v.next_offset); }
      } else {
        if (admin && !problemManager && !teamId) return;
        const v = await api<{ problems: Problem[]; team?: { name: string; can_manage: boolean } }>("oj/problems?all=" + Number(admin) + (teamId ? "&team_id=" + teamId : ""));
        if (current.current === key) { setProblems(v.problems); setTeamManage(Boolean(v.team?.can_manage)); setTeamName(v.team?.name || ""); }
      }
    } catch (e) { if (current.current === key) setError((e as Error).message); }
    finally { if (current.current === key) setLoading(false); }
  }
  useEffect(() => {
    setProblem(null); setSubmission(null); setEdit(null); setNotice(""); setError("");
    if (problemId) {
      try { setSource(localStorage.getItem("oj-code-" + (user?.id || "visitor") + "-" + problemId) || localStorage.getItem("oj-code-visitor-" + problemId) || ""); } catch { setSource(""); }
    }
    void load(routeKey);
  }, [routeKey]);
  useEffect(() => {
    if (!problemId) return;
    try { localStorage.setItem("oj-code-" + (user?.id || "visitor") + "-" + problemId, source); } catch {}
  }, [source]);
  useEffect(() => {
    if (!detailId || !submission || !waiting(submission.status)) return;
    let alive = true;
    const key = routeKey;
    const timer = window.setTimeout(() => {
      void api<{ submission: Submission }>("oj/submissions/" + detailId).then((v) => { if (alive && current.current === key) { setSubmission(v.submission); setError(""); } }).catch((e) => { if (alive && current.current === key) setError(e.message); });
    }, 3500);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [submission, detailId]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!problem || !source.trim()) { setError("请填写代码"); return; }
    setBusy(true); setError("");
    try {
      const v = await api<{ submission: Submission }>("oj/submissions", "POST", { problem_id: problem.id, language: "cpp17", source });
      go("/oj/submission/" + v.submission.id);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function rejudge() {
    if (!submission) return;
    setBusy(true); setError("");
    try {
      const v = await api<{ submission: Submission }>("oj/submissions/" + submission.id + "/rejudge", "POST");
      setSubmission({ ...v.submission, username: submission.username });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function editProblem(p: Problem) {
    setBusy(true); setError(""); setNotice("");
    try {
      const v = await api<{ problem: Problem }>("oj/problems/" + p.id + "?edit=1");
      setEdit({ ...v.problem, cases: v.problem.cases || [] }); setPreview(false);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function upload(f: Blob, name: string) {
    if (f.size > MAX_FILE) throw new Error(name + " 超过 16 MiB");
    return (await api<{ file: { id: string; name: string; size: number } }>("oj/files?name=" + encodeURIComponent(name) + ((edit?.team_id || teamId) ? "&team_id=" + (edit?.team_id || teamId) : ""), "POST", f)).file;
  }
  async function prepareCases(cases: Case[]) {
    const encode = new TextEncoder();
    let total = 0;
    for (const c of cases) {
      if (!c || typeof c.input !== "string" || typeof c.output !== "string" || !Number.isInteger(c.weight) || c.weight < 1 || c.weight > 100) throw new Error("测试点格式或权重不正确");
      const bytes = (c.input_file ? c.input_size || 0 : encode.encode(c.input).byteLength) + (c.output_file ? c.output_size || 0 : encode.encode(c.output).byteLength);
      if (bytes > MAX_FILE) throw new Error("每点输入与输出合计不能超过 16 MiB");
      total += bytes;
    }
    if (total > MAX_DATA) throw new Error("测试数据合计不能超过 256 MiB");
    const result: Case[] = [];
    for (let i = 0; i < cases.length; i++) {
      const c = { ...cases[i] };
      for (const kind of ["input", "output"] as const) {
        // Keep metadata requests small; larger text goes to object storage.
        if (!c[kind + "_file" as "input_file" | "output_file"] && encode.encode(c[kind]).byteLength > 4000) {
          setProgress("上传测试点 " + (i + 1) + " / " + cases.length);
          const f = await upload(new Blob([c[kind]], { type: "text/plain" }), "test" + (i + 1) + (kind === "input" ? ".in" : ".out"));
          Object.assign(c, { [kind]: "", [kind + "_file"]: f.id, [kind + "_name"]: f.name, [kind + "_size"]: f.size });
        }
      }
      result.push(c);
    }
    return result;
  }
  async function save(e: FormEvent) {
    e.preventDefault(); if (!edit || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const cases = await prepareCases(edit.cases);
      setEdit({ ...edit, cases });
      await api(edit.id ? "oj/problems/" + edit.id : "oj/problems", edit.id ? "PATCH" : "POST", { ...edit, cases, team_id: edit.team_id || teamId || null });
      setEdit(null); setNotice("已保存"); await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setProgress(""); }
  }
  async function importData(f?: File) {
    if (!f || !edit || busy) return;
    setBusy(true); setError("");
    try {
      if (f.size > 64 * 1024 * 1024) throw new Error("JSON 不能超过 64 MiB，请使用 .in/.out 文件上传");
      const value = JSON.parse(await f.text());
      const cases = Array.isArray(value) ? value : value.cases;
      if (!Array.isArray(cases) || cases.length < 1 || cases.length > 50 || cases.some((c) => !c || typeof c.input !== "string" || typeof c.output !== "string" || (c.weight !== undefined && (!Number.isInteger(c.weight) || c.weight < 1 || c.weight > 100)))) throw new Error("需包含 1～50 组 input、output，可选 weight");
      if (!Array.isArray(value) && (
        (value.difficulty !== undefined && (!Number.isInteger(value.difficulty) || value.difficulty < 0 || value.difficulty > 7)) ||
        (value.difficulty_tier !== undefined && (!Number.isInteger(value.difficulty_tier) || value.difficulty_tier < 0 || value.difficulty_tier > 3)) ||
        (value.quality !== undefined && (!Number.isInteger(value.quality) || value.quality < 0 || value.quality > 4)) ||
        (value.quality_note !== undefined && (typeof value.quality_note !== "string" || value.quality_note.length > 1000))
      )) throw new Error("题目评价格式不正确");
      const prepared = await prepareCases(cases.map((c) => ({ input: c.input, output: c.output, weight: c.weight ?? 1, group: c.group ?? 1 })));
      const imported = !Array.isArray(value) && typeof value.code === "string" && typeof value.title === "string" && typeof value.statement === "string";
      if (imported && ((value.checker && !["text", "casefold"].includes(value.checker)) || (value.scoring && !["weighted", "all", "groups"].includes(value.scoring)))) throw new Error("评测规则不正确");
      setEdit(imported ? { ...edit, code: value.code, title: value.title, statement: value.statement, difficulty: value.difficulty ?? edit.difficulty, difficulty_tier: (value.difficulty ?? edit.difficulty) ? value.difficulty_tier || edit.difficulty_tier || 2 : 0, quality: value.quality ?? edit.quality, quality_note: value.quality_note ?? edit.quality_note, samples: value.samples ?? [], time_limit: value.time_limit ?? 1000, memory_limit: value.memory_limit ?? 256, checker: value.checker ?? "text", scoring: value.scoring ?? "weighted", published: value.published === true, cases: prepared } : { ...edit, cases: prepared });
      setNotice(imported ? "已导入题面和数据，保存后生效" : "已导入，保存后生效");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setProgress(""); }
  }
  async function importFiles(files: File[]) {
    if (!edit || busy || !files.length) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const pairs = pairTestFiles(files);
      const cases: Case[] = [];
      for (let i = 0; i < pairs.length; i++) {
        const pair = pairs[i];
        setProgress("上传 " + (i * 2 + 1) + " / " + (pairs.length * 2) + " · " + pair.input.name);
        const input = await upload(pair.input, pair.input.name);
        setProgress("上传 " + (i * 2 + 2) + " / " + (pairs.length * 2) + " · " + pair.output.name);
        const output = await upload(pair.output, pair.output.name);
        cases.push({ input: "", output: "", weight: 1, input_file: input.id, input_name: input.name, input_size: input.size, output_file: output.id, output_name: output.name, output_size: output.size });
      }
      setEdit({ ...edit, cases }); setNotice("已导入 " + cases.length + " 点，保存后生效");
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setProgress(""); }
  }
  async function uploadPoint(index: number, kind: "input" | "output", f: File) {
    if (!edit || busy) return;
    setBusy(true); setError(""); setProgress("上传 " + f.name);
    try {
      const other = kind === "input" ? "output" : "input";
      const c = edit.cases[index];
      const size = c[other + "_file" as "input_file" | "output_file"] ? c[other + "_size" as "input_size" | "output_size"] || 0 : new TextEncoder().encode(c[other]).byteLength;
      if (size + f.size > MAX_FILE) throw new Error("每点输入与输出合计不能超过 16 MiB");
      const stored = await upload(f, f.name);
      setEdit({ ...edit, cases: edit.cases.map((v, i) => i === index ? { ...v, [kind]: "", [kind + "_file"]: stored.id, [kind + "_name"]: stored.name, [kind + "_size"]: stored.size } : v) });
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setProgress(""); }
  }
  async function downloadData() {
    if (!edit || busy) return;
    setBusy(true); setError("");
    try {
      const parts: BlobPart[] = [JSON.stringify({ code: edit.code, title: edit.title, statement: edit.statement, difficulty: edit.difficulty, difficulty_tier: edit.difficulty_tier, quality: edit.quality, quality_note: edit.quality_note, samples: edit.samples, time_limit: edit.time_limit, memory_limit: edit.memory_limit, checker: edit.checker, scoring: edit.scoring, published: edit.published, cases: [] }).slice(0, -2)];
      for (let i = 0; i < edit.cases.length; i++) {
        setProgress("导出 " + (i + 1) + " / " + edit.cases.length);
        const c = edit.cases[i];
        const input = c.input_file ? await (await api<Blob>("oj/files/" + c.input_file)).text() : c.input;
        const output = c.output_file ? await (await api<Blob>("oj/files/" + c.output_file)).text() : c.output;
        parts.push((i ? "," : "") + JSON.stringify({ input, output, weight: c.weight, group: c.group ?? 1 }));
      }
      parts.push("]}");
      const url = URL.createObjectURL(new Blob(parts, { type: "application/json" }));
      const a = document.createElement("a"); a.href = url; a.download = (edit.code || "testdata") + ".json"; a.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setProgress(""); }
  }
  const visible = problems.filter((p) =>
    (p.code + " " + p.title).toLowerCase().includes(query.toLowerCase()) &&
    (difficultyFilter === "" || (p.difficulty || 0) === Number(difficultyFilter)) &&
    (tierFilter === "" || (p.difficulty_tier || 0) === Number(tierFilter)) &&
    (qualityFilter === "" || (p.quality || 0) === Number(qualityFilter))
  );
  const loader = <div className="empty-state"><Loader2 className="spin"/><span>加载中</span></div>;
  return <section className="oj-page">
    <div className="oj-nav"><a className={!records && !detailId && !admin ? "active" : ""} href={"#" + bankPath}>{scope ? "团队题库" : "题库"}</a><a className={records || detailId ? "active" : ""} href={"#/oj/submissions" + (scope ? "?team_id=" + scope : "")}>提交记录</a>{problemManager && <a className={admin ? "active" : ""} href={"#" + bankPath + "/admin"}>题目管理</a>}</div>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => void load()}>重试</button></div>}
    {progress && <p className="oj-progress" role="status"><Loader2 className="spin" size={14}/>{progress}</p>}{notice && <p className="oj-notice" role="status">{notice}</p>}
    {scope && <p className="team-bank-link"><a href={"#/teams/" + scope}>← 返回{teamName || "团队"}</a><span>团队专属题库 · 仅团队成员可见</span></p>}
    {admin && !problemManager && !loading ? <div className="empty-state"><h1>题目管理</h1><p>需要题目管理权限</p>{!user && <a className="button primary" href="#/admin">登录</a>}</div>
      : loading ? loader
      : problemId ? problem?.id === Number(problemId) && (problem.published || superuser || problem.can_manage) ? <><a className="back-link" href={"#" + bankPath}><ArrowLeft size={14}/>{scope ? "团队题库" : "题库"}</a><div className="oj-heading"><h1><span className="oj-problem-code">{problem.code}</span>{problem.title}</h1><div className="oj-limits"><DifficultyBadge problem={problem}/><QualityBadge quality={problem.quality}/><span>{problem.time_limit} ms</span><span>{problem.memory_limit} MB</span><span>C++17</span>{problem.checker === "casefold" && <span>答案忽略大小写</span>}{problem.scoring === "all" && <span>全部通过得分</span>}{problem.scoring === "groups" && <span>捆绑计分</span>}{!problem.published && <span>未发布</span>}</div></div>
        <ProblemAssessment key={"assessment-" + problem.id} api={api} problem={problem} canEdit={problemManager} onSave={(updated) => {
          if (current.current === routeKey) setProblem((previous) => previous ? { ...previous, ...updated } : updated);
        }}/>
        {<nav className="oj-nav" aria-label="题目页签">
          <a className={!editorialTab ? "active" : ""} aria-current={!editorialTab ? "page" : undefined} href={"#" + dataPath}>题面</a>
          <a className={editorialTab ? "active" : ""} aria-current={editorialTab ? "page" : undefined} href={"#" + dataPath + "/editorial"}>题解</a><a href={"#/discussions?problem_id=" + problem.id}>讨论</a>
        </nav>}
        {editorialTab ? <><ProblemEditorial key={"editorial-" + problem.id} api={api} problem={problem} canEdit={solutionManager} onSave={(updated) => {
          if (current.current === routeKey) setProblem((previous) => previous ? { ...previous, ...updated } : updated);
        }}/><ProblemSolutions api={api} problemId={problem.id} user={user}/></> : <><Markdown content={problem.statement}/>{problem.samples.length > 0 && <section className="oj-samples"><h2>样例</h2>{problem.samples.map((s, i) => <div className="oj-sample" key={i}><div><h3>输入 {i + 1}</h3><pre>{s.input}</pre></div><div><h3>输出 {i + 1}</h3><pre>{s.output}</pre></div></div>)}</section>}<form className="oj-submit" onSubmit={submit}><div className="oj-section-heading"><h2>提交代码</h2><button type="button" className="text-button" onClick={() => codeFile.current?.click()}><Upload size={14}/>导入代码</button></div><input type="file" ref={codeFile} hidden accept=".cpp,.cc,.cxx,text/plain" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return; if (f.size > 150000) { setError("代码过长"); return; } setSource(await f.text()); e.target.value = ""; }}/><textarea aria-label="C++17 代码" className="oj-code-input" value={source} maxLength={50000} placeholder="C++17" spellCheck={false} onChange={(e) => setSource(e.target.value)} onKeyDown={(e) => { if (e.key === "Tab") { e.preventDefault(); const el = e.currentTarget, a = el.selectionStart, b = el.selectionEnd; setSource(source.slice(0, a) + "    " + source.slice(b)); requestAnimationFrame(() => { el.selectionStart = el.selectionEnd = a + 4; }); } }}/><div className="oj-submit-footer"><span>评测服务：Judge0 · C++17 / O2</span>{user ? <button className="button primary" disabled={busy || !source.trim()}>{busy ? <Loader2 size={15} className="spin"/> : <Code size={15}/>}提交</button> : <a className="button primary" href="#/admin">登录后提交</a>}</div></form></>}
      </> : null
      : detailId && submission ? <><a className="back-link" href="#/oj/submissions"><ArrowLeft size={14}/>提交记录</a><div className="oj-heading"><h1>评测结果</h1><a className="text-button" href={"#/oj/problem/" + submission.problem_id}>{submission.problem_code} · {submission.problem_title}</a></div><div className="oj-result"><Verdict status={submission.status}/><strong>{submission.score}<small> / 100</small></strong><div><span>通过 {submission.passed} / {submission.total}</span><span>{submission.time} ms · {memory(submission.memory)}</span></div><button className="icon-button" onClick={() => void load()} aria-label="刷新评测结果"><RefreshCw size={16}/></button></div><div className="oj-meta"><a className="author-link" href={"#/user/" + submission.user_id}>{submission.username} · ID {submission.user_id}</a><span>{stamp(submission.created_at)}</span><span>C++17 · 题目版本 {submission.revision}</span></div>{submission.status === "JE" && <div className="oj-service-error"><span>{submission.judge_error || "评测服务暂不可用"}</span>{submission.source !== undefined && <button className="button secondary" disabled={busy} onClick={() => void rejudge()}>{busy && <Loader2 size={14} className="spin"/>}重新评测</button>}</div>}{submission.details && <section className="oj-points"><h2>测试点</h2>{submission.details.map((d) => <TestResult key={d.index + ":" + submission.id} api={api} id={submission.id} point={d} totalWeight={submission.scoring === "groups" ? [...new Map(submission.details!.map((c) => [c.group || 1, c.weight])).values()].reduce((a, w) => a + w, 0) : submission.details!.reduce((a, c) => a + c.weight, 0)} grouped={submission.scoring === "groups"} timeLimit={submission.time_limit} memoryLimit={submission.memory_limit} verdict={verdicts[d.status] || d.status}/>)}</section>}{submission.compile_log && <section className="oj-output"><h2>编译信息</h2><pre>{submission.compile_log}</pre></section>}{submission.source !== undefined && <section className="oj-output"><h2>提交代码</h2><pre><code>{submission.source}</code></pre></section>}</>
      : records ? <><div className="oj-section-heading"><h1>提交记录</h1><div className="oj-record-tools">{user && <label><input type="checkbox" checked={mine} onChange={(e) => { setMine(e.target.checked); setOffset(0); }}/>我的提交</label>}<button className="icon-button" onClick={() => void load()} aria-label="刷新提交记录"><RefreshCw size={16}/></button></div></div>{submissions.length ? <div className="oj-record-list">{submissions.map((s) => <div className="oj-record" key={s.id}><div><a href={"#/oj/submission/" + s.id}><strong>{s.problem_code} · {s.problem_title}</strong></a><small><a className="author-link" href={"#/user/" + s.user_id}>{s.username}</a> · {stamp(s.created_at)}</small></div><a href={"#/oj/submission/" + s.id}><Verdict status={s.status}/></a><a className="oj-record-score" href={"#/oj/submission/" + s.id}>{s.score} 分</a><span className="oj-record-time">{s.time} ms</span></div>)}</div> : <div className="empty-state">暂无提交</div>}<div className="oj-pagination">{offset > 0 && <button className="button secondary" onClick={() => setOffset(Math.max(0, offset - 30))}>上一页</button>}{nextOffset !== null && <button className="button secondary" onClick={() => setOffset(nextOffset)}>下一页</button>}</div></>
      : admin && edit ? <form className="oj-editor" onSubmit={save}><fieldset disabled={busy} className="oj-editor-fields"><div className="oj-section-heading"><h1>{edit.id ? "编辑题目" : "新建题目"}</h1><div className="editor-actions"><button className="button secondary" type="button" disabled={busy} onClick={() => setEdit(null)}>返回</button><button className="button primary" disabled={busy}>{busy && <Loader2 size={15} className="spin"/>}保存</button></div></div><div className="oj-fields"><label>题号<input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value })} placeholder="P1000" required maxLength={24}/></label><label className="oj-title-field">题目名称<input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} required maxLength={100}/></label><label>时间限制（ms）<input type="number" min={100} max={5000} step={100} value={edit.time_limit} onChange={(e) => setEdit({ ...edit, time_limit: Number(e.target.value) })} required/></label><label>内存限制（MB）<input type="number" min={16} max={512} value={edit.memory_limit} onChange={(e) => setEdit({ ...edit, memory_limit: Number(e.target.value) })} required/></label><label>答案比较<select value={edit.checker} onChange={(e) => setEdit({ ...edit, checker: e.target.value as Edit["checker"] })}><option value="text">文本</option><option value="casefold">忽略大小写</option></select></label><label>计分<select value={edit.scoring} onChange={(e) => setEdit({ ...edit, scoring: e.target.value as Edit["scoring"] })}><option value="weighted">逐点</option><option value="all">全部通过</option><option value="groups">捆绑</option></select></label></div><AssessmentFields value={edit} onChange={(patch) => setEdit({ ...edit, ...patch })}/><div className="oj-section-heading"><h2>题面</h2><button className="text-button" type="button" onClick={() => setPreview(!preview)}>{preview ? "编辑" : "预览"}</button></div>{preview ? <div className="oj-statement-preview"><Markdown content={edit.statement}/></div> : <textarea aria-label="Markdown 题面" className="oj-statement-input" value={edit.statement} onChange={(e) => setEdit({ ...edit, statement: e.target.value })} required maxLength={100000} placeholder="Markdown 题面"/>}<div className="oj-section-heading"><h2>{scope ? "样例" : "公开样例"}</h2><button type="button" className="text-button" disabled={edit.samples.length >= 5} onClick={() => setEdit({ ...edit, samples: [...edit.samples, { input: "", output: "" }] })}><Plus size={14}/>添加</button></div>{edit.samples.map((s, i) => <div className="oj-data-row" key={i}><label>样例输入 {i + 1}<textarea value={s.input} onChange={(e) => setEdit({ ...edit, samples: edit.samples.map((v, j) => i === j ? { ...v, input: e.target.value } : v) })}/></label><label>样例输出 {i + 1}<textarea value={s.output} onChange={(e) => setEdit({ ...edit, samples: edit.samples.map((v, j) => i === j ? { ...v, output: e.target.value } : v) })}/></label><button type="button" className="icon-button delete-button" aria-label={"删除样例 " + (i + 1)} onClick={() => setEdit({ ...edit, samples: edit.samples.filter((_, j) => i !== j) })}><Trash2 size={15}/></button></div>)}<div className="oj-section-heading"><h2>测试点 <small>最多 50 点 · 每点 ≤16 MiB · 合计 ≤256 MiB</small></h2><div className="oj-data-tools"><button disabled={busy} type="button" className="text-button" onClick={() => dataFiles.current?.click()}>上传 .in/.out</button><button disabled={busy} type="button" className="text-button" onClick={() => file.current?.click()}>导入 JSON</button><button disabled={busy} type="button" className="text-button" onClick={() => void downloadData()}>导出</button><button type="button" className="text-button" disabled={busy || edit.cases.length >= 50} onClick={() => setEdit({ ...edit, cases: [...edit.cases, { input: "", output: "", weight: 1 }] })}><Plus size={14}/>添加</button></div></div><p className="oj-data-hint">同名 .in/.out 配对，按文件名排序；批量导入替换当前测试点。</p><input type="file" ref={dataFiles} hidden multiple accept=".in,.out" onChange={(e) => { void importFiles(Array.from(e.target.files || [])); e.target.value = ""; }}/><input type="file" ref={file} hidden accept=".json,application/json" onChange={(e) => { void importData(e.target.files?.[0]); e.target.value = ""; }}/>{edit.cases.map((c, i) => <div className="oj-data-row" key={i}><CaseField api={api} label={"输入 " + (i + 1)} value={c.input} file={c.input_file} name={c.input_name} size={c.input_size} busy={busy} onUpload={(f) => void uploadPoint(i, "input", f)} onChange={(text) => setEdit({ ...edit, cases: edit.cases.map((v, j) => i === j ? { ...v, input: text, input_file: null, input_name: null, input_size: 0 } : v) })}/><CaseField api={api} label={"输出 " + (i + 1)} value={c.output} file={c.output_file} name={c.output_name} size={c.output_size} busy={busy} onUpload={(f) => void uploadPoint(i, "output", f)} onChange={(text) => setEdit({ ...edit, cases: edit.cases.map((v, j) => i === j ? { ...v, output: text, output_file: null, output_name: null, output_size: 0 } : v) })}/>{edit.scoring === "groups" && <label className="oj-weight">子任务<input disabled={busy} type="number" min={1} max={50} required value={c.group || 1} onChange={(e) => setEdit({ ...edit, cases: edit.cases.map((v, j) => i === j ? { ...v, group: Number(e.target.value) } : v) })}/></label>}<label className="oj-weight">{edit.scoring === "groups" ? "组分值" : "权重"}<input disabled={busy} type="number" min={1} max={100} required value={c.weight} onChange={(e) => setEdit({ ...edit, cases: edit.cases.map((v, j) => i === j ? { ...v, weight: Number(e.target.value) } : v) })}/></label><button type="button" className="icon-button delete-button" aria-label={"删除测试点 " + (i + 1)} disabled={busy || edit.cases.length <= 1} onClick={() => setEdit({ ...edit, cases: edit.cases.filter((_, j) => i !== j) })}><Trash2 size={15}/></button></div>)}<div className="oj-submit-footer"><label className="oj-publish"><input type="checkbox" checked={edit.published} disabled={!scope && !superuser} onChange={(e) => setEdit({ ...edit, published: e.target.checked })}/>{scope ? "向团队成员发布" : "公开题目"}</label><button className="button primary" disabled={busy}>{busy && <Loader2 size={15} className="spin"/>}保存</button></div></fieldset></form>
      : <><div className="oj-section-heading"><h1>{admin ? "题目管理" : "题库"}</h1>{admin && <button className="button primary" onClick={() => { setEdit({ ...empty(), published: !teamId && !superuser }); setPreview(false); setNotice(""); }}><Plus size={15}/>新建题目</button>}</div><div className="oj-filters"><label className="search-box oj-search"><Search size={16}/><input aria-label="搜索题目" placeholder="题号 / 题目" value={query} onChange={(e) => setQuery(e.target.value)}/></label>
        <select aria-label="筛选难度" value={difficultyFilter} onChange={(e) => setDifficultyFilter(e.target.value)}><option value="">全部难度</option>{levels.map((name, i) => <option key={i} value={i}>{name}</option>)}</select>
        <select aria-label="筛选难度档位" value={tierFilter} onChange={(e) => setTierFilter(e.target.value)}><option value="">全部档位</option>{tiers.slice(1).map((name, i) => <option key={i + 1} value={i + 1}>{name}</option>)}</select>
        <select aria-label="筛选质量" value={qualityFilter} onChange={(e) => setQualityFilter(e.target.value)}><option value="">全部质量</option>{qualities.map((name, i) => <option key={i} value={i}>{name}</option>)}</select>
      </div>{visible.length ? <div className="oj-problem-list">{visible.map((p) => <div className="oj-problem-row" key={p.id}><a href={"#/oj/problem/" + p.id}><span className="oj-problem-code">{p.code}</span><strong>{p.title}</strong></a><span className="oj-row-assessment"><DifficultyBadge problem={p}/><QualityBadge quality={p.quality}/></span><span className="oj-row-limits">{p.time_limit} ms / {p.memory_limit} MB</span>{admin && <><span className="post-status">{p.published ? "公开" : "未发布"}</span><button className="button secondary" disabled={busy} onClick={() => void editProblem(p)}>编辑</button></>}</div>)}</div> : <div className="empty-state"><FileText size={26}/>{query || difficultyFilter || tierFilter || qualityFilter ? "暂无符合条件的题目" : "暂无题目"}</div>}</>}
  </section>;
}
