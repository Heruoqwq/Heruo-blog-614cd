const upstream = "https://tony-journal-heruo.prime-gleam-7947.chatgpt.site";
const ownerAvatar = "/avatars/heruo.jpg";
const methods = new Set(["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"]);
const common = {
  "Cache-Control": "private, no-store",
  "CDN-Cache-Control": "no-store",
  "Netlify-CDN-Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const failure = (error, status) => new Response(JSON.stringify({ error }), {
  status, headers: { ...common, "Content-Type": "application/json; charset=utf-8" },
});
export default async function proxy(request) {
  const url = new URL(request.url);
  const avatar = url.pathname === ownerAvatar;
  if (!avatar && url.pathname !== "/api" && !url.pathname.startsWith("/api/")) return failure("接口不存在", 404);
  if (avatar && !["GET", "HEAD"].includes(request.method)) return failure("不支持此请求方式", 405);
  if (!methods.has(request.method)) return failure("不支持此请求方式", 405);
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin) return failure("此来源未获授权", 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: common });
  const target = new URL(upstream);
  target.pathname = url.pathname;
  target.search = url.search;
  const headers = new Headers({ Origin: upstream });
  for (const key of (avatar ? ["accept"] : ["content-type", "authorization", "accept"])) {
    const value = request.headers.get(key);
    if (value !== null) headers.set(key, value);
  }
  let response;
  try {
    response = await fetch(target, {
      method: request.method, headers, redirect: "manual", credentials: "omit",
      signal: AbortSignal.timeout(35000),
      ...(!["GET", "HEAD"].includes(request.method) ? { body: request.body, duplex: "half" } : {}),
    });
  } catch {
    return failure("后端连接暂时失败，请稍后刷新；提交程序后请先检查提交记录。", 503);
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    return failure("后端返回了意外跳转，请联系管理员。", 502);
  }
  const output = new Headers(common);
  for (const key of ["content-type", "content-disposition", "retry-after"]) {
    const value = response.headers.get(key);
    if (value !== null) output.set(key, value);
  }
  return new Response(request.method === "HEAD" ? null : response.body, { status: response.status, headers: output });
}
