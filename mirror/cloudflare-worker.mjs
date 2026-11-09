import proxy from "./netlify/edge-functions/api.js";
import release from "./netlify/functions/daily-release.mjs";

export default {
  fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api" || pathname.startsWith("/api/") || pathname === "/avatars/heruo.jpg") return proxy(request);
    return env.ASSETS.fetch(request);
  },

  async scheduled() {
    await release();
  },
};
