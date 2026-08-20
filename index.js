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
 * 所有写操作先备份 cordis.patch.yml(.bak-时间戳),再改文件;
 * 宿主 HMR 监听 patch 文件,改动会实时热生效,无需重启。
 */
import { readFileSync, writeFileSync, copyFileSync, readdirSync, existsSync, statSync, renameSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const name = "dsh-plugin-manager";
export const inject = ["webServer"];

const HOME = homedir();
const PATCH_FILE = join(HOME, ".dsh/profiles/web/cordis.patch.yml");
const SKILLS_DIRS = [
  join(HOME, ".dsh/skills"),
  join(HOME, ".agents/skills"), // 通用 agents skills 目录
];
const PLUGINS_DIR = join(HOME, ".dsh/profiles/node_modules/@deepseek-ai");

/* ---------------- cordis.patch.yml 行级解析 ---------------- */

function parseMcpEntries(text) {
  const lines = text.split("\n");
  const entries = [];
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const m = ln.match(/^    - id: (\S+)\s*$/);
    if (m) {
      if (cur) { cur.end = i; entries.push(cur); }
      cur = { id: m[1], start: i, end: lines.length, disabled: false };
      continue;
    }
    if (cur) {
      if (/^-\s/.test(ln) || (ln && !/^\s/.test(ln))) {
        cur.end = i; entries.push(cur); cur = null; continue;
      }
      if (/^\s+disabled:\s*true\s*$/.test(ln)) { cur.disabled = true; cur.disabledLine = i; }
      for (const key of ["serverName", "transport", "command"]) {
        const mm = ln.match(new RegExp("^\\s+" + key + ":\\s*(.+?)\\s*$"));
        if (mm && !(key in cur)) cur[key] = mm[1].replace(/^['"]|['"]$/g, "");
      }
      const mu = ln.match(/^\s+url:\s*(.+?)\s*$/);
      if (mu && !("url" in cur)) cur.url = mu[1].length > 90 ? mu[1].slice(0, 90) + "…" : mu[1];
    }
  }
  if (cur) entries.push(cur);
  return entries;
}

function backup() {
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  copyFileSync(PATCH_FILE, PATCH_FILE + ".bak-" + ts);
}

function toggleMcp(id, disable) {
  const text = readFileSync(PATCH_FILE, "utf8");
  const e = parseMcpEntries(text).find((x) => x.id === id);
  if (!e) return [false, "找不到插件: " + id];
  if (e.disabled === disable) return [true, "状态未变化"];
  backup();
  const lines = text.split("\n");
  if (disable) lines.splice(e.start + 1, 0, "      disabled: true");
  else lines.splice(e.disabledLine, 1);
  writeFileSync(PATCH_FILE, lines.join("\n"));
  return [true, "已" + (disable ? "禁用" : "启用") + " " + id + "(热生效)"];
}

function deleteMcp(id) {
  const text = readFileSync(PATCH_FILE, "utf8");
  const e = parseMcpEntries(text).find((x) => x.id === id);
  if (!e) return [false, "找不到插件: " + id];
  backup();
  const lines = text.split("\n");
  lines.splice(e.start, e.end - e.start);
  writeFileSync(PATCH_FILE, lines.join("\n"));
  return [true, "已删除 " + id + "(热生效;配置块上方的注释行会保留)"];
}

/* ---------------- skills / plugins ---------------- */

function listSkills() {
  return SKILLS_DIRS.flatMap((skillsDir) => {
    if (!existsSync(skillsDir)) return [];
    return readdirSync(skillsDir).sort().flatMap((name) => {
    const d = join(skillsDir, name);
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
  });
}

function deleteSkill(name) {
  if (!/^[\w.\-]+$/.test(name)) return [false, "非法名称"];
  let d = null;
  for (const dir of SKILLS_DIRS) {
    const c = join(dir, name);
    if (existsSync(c) && statSync(c).isDirectory()) { d = c; break; }
  }
  if (!d) return [false, "找不到 skill: " + name];
  const dir = d.slice(0, d.lastIndexOf("/"));
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const trash = join(dir, ".trash-" + ts + "-" + name);
  renameSync(d, trash); // 不真删,可恢复
  return [true, "已移除 " + name + "(移入 " + trash.split("/").pop() + ",可手动恢复)"];
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
  const entries = parseMcpEntries(readFileSync(PATCH_FILE, "utf8"));
  for (const e of entries) { delete e.start; delete e.end; delete e.disabledLine; }
  return { mcp: entries, skills: listSkills(), plugins: listPlugins(), patchFile: PATCH_FILE, skillsDir: SKILLS_DIRS.filter(existsSync).join("  ·  ") };
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
