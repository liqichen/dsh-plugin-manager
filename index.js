/**
 * DSH 插件管理器 — node 半(内嵌后端,随 dsh web 同生共死)。
 *
 * 在宿主 webServer 上注册 /plugin-manager/api/* 路由,浏览器半(client.js)
 * 同源 fetch 即可,不再需要独立的 python 服务。
 *
 * 管理能力:
 *   GET  /plugin-manager/api/state   → { mcp, skills, plugins, patchFile, skillsDir }
 *   POST /plugin-manager/api/action  → { kind: "mcp-toggle" | "mcp-delete" | "skill-delete", ... }
 *
 * 配置定位与 patch 解析见 lib/patch.mjs(0.1.2-alpha.1 适配):
 *   - 探测 web profile 用户层 / home 用户层,取第一个存在的
 *   - MCP = dsh-mcp-client 插件实例(insert 格式),禁用 = id-targeted override
 *   - 所有写操作先备份 .bak-<毫秒时间戳>,宿主 HMR 监听 patch 文件,改动实时热生效
 */
import { readdirSync, existsSync, statSync, renameSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { patchFile, collectMcp, toggleMcp, deleteMcp } from "./lib/patch.mjs";

export const name = "dsh-plugin-manager";
export const inject = ["webServer"];

const HOME = homedir();
const DSH_HOME = process.env.DSH_HOME || join(HOME, ".dsh");
const SKILLS_DIR = join(DSH_HOME, "skills");
const PLUGINS_DIR = join(DSH_HOME, "profiles/node_modules/@deepseek-ai");

/* ---------------- skills / plugins ---------------- */

function listSkills() {
  if (!existsSync(SKILLS_DIR)) return [];
  return readdirSync(SKILLS_DIR).sort().flatMap((name) => {
    const d = join(SKILLS_DIR, name);
    if (!statSync(d).isDirectory() || name.startsWith(".trash-")) return [];
    let desc = "";
    const md = join(d, "SKILL.md");
    if (existsSync(md)) {
      try {
        const head = readFileSync(md, "utf8").slice(0, 4000);
        const m = head.match(/^description:\s*(.+)$/m);
        if (m) desc = m[1].trim().replace(/^['"]|['"]$/g, "");
      } catch {}
    }
    return [{ name, desc: desc.length > 160 ? desc.slice(0, 160) + "…" : desc, path: d }];
  });
}

function deleteSkill(name) {
  if (!/^[\w.\-]+$/.test(name)) return [false, "非法名称"];
  const d = join(SKILLS_DIR, name);
  if (!existsSync(d)) return [false, "找不到 skill: " + name];
  const ts = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 17);
  const trash = join(SKILLS_DIR, ".trash-" + ts + "-" + name);
  renameSync(d, trash); // 不真删,可恢复
  return [true, "已移除 " + name + "(移入 " + trash.split(/[\\/]/).pop() + ",可手动恢复)"];
}

function listPlugins() {
  if (!existsSync(PLUGINS_DIR)) return [];
  return readdirSync(PLUGINS_DIR).sort().map((name) => {
    let version = "", desc = "";
    try {
      const meta = JSON.parse(readFileSync(join(PLUGINS_DIR, name, "package.json"), "utf8"));
      version = meta.version || "";
      desc = meta.description || "";
    } catch {}
    return { name, version, desc: desc.length > 110 ? desc.slice(0, 110) + "…" : desc };
  });
}

function getState() {
  const file = patchFile();
  let mcp = [];
  if (existsSync(file)) {
    mcp = collectMcp(readFileSync(file, "utf8")).mcp.map(({ _inst, _ov, ...rest }) => rest);
  }
  return { mcp, skills: listSkills(), plugins: listPlugins(), patchFile: file, skillsDir: SKILLS_DIR };
}

/* ---------------- HTTP ---------------- */

function sendJson(res, code, obj) {
  const data = Buffer.from(JSON.stringify(obj), "utf8");
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Content-Length": data.length });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}")); } catch (e) { reject(e); } });
    req.on("error", reject);
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/plugin-manager/api/state") {
      return sendJson(res, 200, getState());
    }
    if (req.method === "POST" && url.pathname === "/plugin-manager/api/action") {
      const body = await readBody(req);
      let ok, msg;
      if (body.kind === "mcp-toggle") [ok, msg] = toggleMcp(String(body.id), !!body.disable);
      else if (body.kind === "mcp-delete") [ok, msg] = deleteMcp(String(body.id));
      else if (body.kind === "skill-delete") [ok, msg] = deleteSkill(String(body.name));
      else { ok = false; msg = "未知操作"; }
      return sendJson(res, 200, { ok, message: msg });
    }
    sendJson(res, 404, { ok: false, message: "not found" });
  } catch (e) {
    sendJson(res, 500, { ok: false, message: "出错: " + String(e && e.message || e) });
  }
}

export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({ kind: "prefix", path: "/plugin-manager", handler: handleApi }),
    "plugin-manager: api routes");
  ctx.logger?.info?.("plugin-manager: API ready at /plugin-manager/api/*");
}
