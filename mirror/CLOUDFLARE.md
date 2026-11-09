# Heruo OJ · Cloudflare Workers 备用入口

在 Cloudflare 控制台的 Workers & Pages 中，从 GitHub 导入本仓库。选择生产分支 `codex/cloudflare-fallback`。保持 Workers Free 计划即可尝试。

| 设置 | 值 |
| --- | --- |
| Worker 名称 | `heruo-oj` |
| 根目录 | `mirror` |
| 构建命令 | `node build.mjs` |
| 部署命令 | `npx --yes wrangler@4.92.0 deploy --config wrangler.cloudflare.toml` |

新地址使用账号的 `workers.dev` 子域名。站点的 `/api` 继续连接 Heruo OJ 原后端。账号和数据保存在原后端，用户需要在新地址重新登录。每天北京时间 00:05 的发题任务使用同一后端的幂等接口。

切换前从中国大陆普通网络检查题库、登录、普通题提交、后台上传和下载大文件。首次部署从这条分支构建，后续可将最新的前端变更合并到该分支，再触发构建。Cloudflare 入口发布后可与 Netlify 入口并行验证。

相关设置见 [Workers GitHub 集成](https://developers.cloudflare.com/workers/ci-cd/builds/git-integration/github-integration/)。
