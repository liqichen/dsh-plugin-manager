/**
 * dsh-plugin-manager — patch 文件定位、解析与写操作(0.1.2-alpha.1 适配)。
 *
 * 配置定位:
 *   alpha.1 的 patch 文件是「顶层 YAML 数组的 loader patch entries」,探测取第一个存在的:
 *   1. $DSH_HOME/profiles/web/cordis.patch.yml — web profile 用户层(原版路径,优先)
 *   2. $DSH_HOME/cordis.patch.yml — home 用户层(alpha.1 新增,机器级)
 *   MCP 服务 = dsh-mcp-client 插件实例,官方写法:
 *     - insert:
 *         - id: mcp-xxx
 *           name: '@deepseek-ai/dsh-mcp-client'
 *           config: { serverName, transport, ... }
 *   禁用 = id-targeted override(合成树里覆盖实例):
 *     - id: mcp-xxx
 *       disabled: true
 *   rc.2 时代直接写 `- id:` + name 的条目在 alpha.1 不再生效(非 insert patch 只覆盖
 *   已存在行),解析器仍会识别显示,便于用户清理无效条目。
 *
 * 所有写操作先备份(.bak-<毫秒时间戳>),宿主 HMR 监听用户 patch 层,改动实时热生效。
 */
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();

/** DSH home(动态读取,便于测试注入)。 */
function dshHome() {
  return process.env.DSH_HOME || join(HOME, ".dsh");
}

/** 从进程 argv 反推当前 profile(`dsh --profile xxx` / `dsh web` 别名,默认 web)。 */
export function profileName() {
  const i = process.argv.indexOf("--profile");
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("-")) return process.argv[i + 1];
  return "web";
}

/** 候选 patch 文件(按优先级):当前 profile 用户层 → home 用户层 → web profile 兜底。 */
export function patchCandidates() {
  const home = dshHome();
  return [
    join(home, "profiles", profileName(), "cordis.patch.yml"),
    join(home, "cordis.patch.yml"),
    join(home, "profiles/web/cordis.patch.yml")
  ];
}

/** dsh-mcp-client 的插件名匹配(全名或别名)。 */
export function isMcpName(name) {
  return typeof name === "string" && /(^|\/)dsh-mcp-client$/.test(name.trim().replace(/^['"]|['"]$/g, ""));
}

/** 探测存在的 patch 文件;都不存在时按首选路径报告。 */
export function patchFile() {
  for (const p of patchCandidates()) if (existsSync(p)) return p;
  return patchCandidates()[0];
}

const ITEM_RE = /^(\s*)-\s+(?:id:\s*(\S+)|insert:)(\s*|#.*)$/;
const KEY_RE = /^(\s*)([A-Za-z0-9_-]+):\s*(.*)$/;

/**
 * 解析 patch 文件文本为顶层条目树(只做结构解析,不做 YAML 语义求值,!!js 原样保留)。
 * @returns {{ entries: Array, lines: string[] }}
 */
export function parsePatch(text) {
  const lines = text.split("\n");
  const stack = [];
  const entries = [];
  let top = null;
  let cur = null;

  for (let i = 0; i < lines.length; i++) {
    const mi = lines[i].match(ITEM_RE);
    if (mi) {
      const indent = mi[1].length;
      while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
      const parent = stack[stack.length - 1] || null;
      const entry = {
        indent,
        id: mi[2] || null,
        isInsert: mi[2] === undefined,
        isTop: parent === null,
        start: i,
        end: i,
        parent,
        keyLines: {},
        configLines: {},
        configLine: -1
      };
      if (entry.isTop) {
        if (top) top.end = i - 1; // 前一个顶层条目结束于新顶层条目行前
        top = entry;
        entries.push(entry);
      }
      cur = entry;
      stack.push(entry);
      continue;
    }
    if (!cur || cur.isInsert) continue;
    const mk = lines[i].match(KEY_RE);
    if (!mk || mk[1].length <= cur.indent) continue;
    if (cur.configLine >= 0 && mk[1].length > cur.configLine) {
      if (!(mk[2] in cur.configLines)) cur.configLines[mk[2]] = i;
    } else if (mk[2] === "config") {
      cur.configLine = mk[1].length;
    } else {
      if (!(mk[2] in cur.keyLines)) cur.keyLines[mk[2]] = i;
    }
  }
  for (const e of entries) e.end = lines.length - 1;
  return { entries, lines };
}

/** 顶层条目行范围(含自身,结束于下一个同层 `- ` 行前)。 */
export function entryRange(entry, lines) {
  let end = lines.length - 1;
  for (let i = entry.start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(\s*)-\s/);
    if (m && m[1].length <= entry.indent) { end = i - 1; break; }
  }
  return { start: entry.start, end };
}

function keyValue(line, key) {
  const m = line.match(new RegExp("^\\s*" + key + ":\\s*(.*)$"));
  return m ? m[1].trim() : "";
}

function readBool(line) {
  const m = line.match(/disabled:\s*(\S+)/);
  if (!m) return false;
  const v = m[1];
  return v === "true" || v === "True" || v === "TRUE";
}

/** 解析一个条目的 name/config/disabled(entry 须已填充 keyLines/configLines)。 */
export function parseEntryFields(entry, lines) {
  const name = entry.keyLines.name !== undefined ? keyValue(lines[entry.keyLines.name], "name").replace(/^['"]|['"]$/g, "") : "";
  const config = {};
  for (const k of Object.keys(entry.configLines)) config[k] = keyValue(lines[entry.configLines[k]], k);
  const disabled = entry.keyLines.disabled !== undefined ? readBool(lines[entry.keyLines.disabled]) : false;
  return { name, config, disabled };
}

/**
 * 收集 MCP 实例与 id-targeted override,按 id 合并。
 * @returns {{ mcp: Array, instances: Map, overrides: Map, lines: string[] }}
 *   mcp 项: { id, serverName, transport, command, url, disabled, _inst, _ov }
 */
export function collectMcp(text) {
  const { entries, lines } = parsePatch(text);
  const instances = new Map();
  const overrides = new Map();
  const order = [];

  const scanInstance = (entry, range) => {
    const { name, config, disabled } = parseEntryFields(entry, lines);
    if (!isMcpName(name)) return;
    if (instances.has(entry.id)) return;
    instances.set(entry.id, {
      id: entry.id,
      serverName: config.serverName || entry.id,
      transport: config.transport || "?",
      command: config.command || "",
      url: config.url ? (config.url.length > 90 ? config.url.slice(0, 90) + "…" : config.url) : "",
      disabled,
      range,
      lines: entry
    });
    order.push(entry.id);
  };

  const scanOverride = (entry, range) => {
    if (entry.isInsert || !entry.id || entry.keyLines.name !== undefined) return;
    overrides.set(entry.id, {
      disabled: entry.keyLines.disabled !== undefined ? readBool(lines[entry.keyLines.disabled]) : false,
      range,
      lines: entry
    });
  };

  for (const topEntry of entries) {
    if (topEntry.isInsert) {
      for (let i = topEntry.start + 1; i <= topEntry.end; i++) {
        const m = lines[i].match(/^(\s*)-\s+id:\s*(\S+)/);
        if (!m || m[1].length <= topEntry.indent) continue;
        const child = {
          indent: m[1].length,
          id: m[2],
          isInsert: false,
          isTop: false,
          start: i,
          end: i,
          parent: topEntry,
          keyLines: {},
          configLines: {},
          configLine: -1
        };
        let j = i + 1;
        while (j < lines.length) {
          const mm = lines[j].match(/^(\s*)-\s/);
          if (mm && mm[1].length <= child.indent) break;
          const kk = lines[j].match(KEY_RE);
          if (kk && kk[1].length > child.indent) {
            if (child.configLine >= 0 && kk[1].length > child.configLine) {
              if (!(kk[2] in child.configLines)) child.configLines[kk[2]] = j;
            } else if (kk[2] === "config") {
              child.configLine = kk[1].length;
            } else {
              if (!(kk[2] in child.keyLines)) child.keyLines[kk[2]] = j;
            }
          }
          j++;
        }
        child.end = j - 1;
        scanInstance(child, { start: i, end: j - 1 });
        i = j - 1;
      }
    } else {
      scanInstance(topEntry, entryRange(topEntry, lines));
      scanOverride(topEntry, entryRange(topEntry, lines));
    }
  }

  const mcp = order.map((id) => {
    const inst = instances.get(id);
    const ov = overrides.get(id);
    return {
      id,
      serverName: inst.serverName,
      transport: inst.transport,
      command: inst.command,
      url: inst.url,
      disabled: inst.disabled || (ov ? ov.disabled : false),
      _inst: inst,
      _ov: ov
    };
  });
  return { mcp, instances, overrides, lines };
}

/* ---------------- 写操作(全部先备份) ---------------- */

function backup(file) {
  const ts = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 17);
  copyFileSync(file, file + ".bak-" + ts);
}

function writePatch(file, text) {
  backup(file);
  writeFileSync(file, text);
}

/** 在文件尾追加一条 id-targeted override patch。 */
export function appendOverride(lines, id) {
  let out = lines.join("\n");
  if (!out.endsWith("\n")) out += "\n";
  out += `- id: ${id}\n  disabled: true\n`;
  return out;
}

/** 禁用/启用一个 MCP 服务。返回 [ok, message]。 */
export function toggleMcp(id, disable) {
  const file = patchFile();
  if (!existsSync(file)) return [false, "patch 文件不存在: " + file];
  const text = readFileSync(file, "utf8");
  const { mcp, instances, overrides, lines } = collectMcp(text);
  const found = mcp.find((x) => x.id === id);
  if (!found) return [false, "找不到 MCP 服务: " + id];
  if (found.disabled === disable) return [true, "状态未变化"];

  const edits = [];
  const ov = overrides.get(id);
  if (disable) {
    if (ov) {
      if (ov.lines.keyLines.disabled !== undefined) {
        edits.push([ov.lines.keyLines.disabled, (l) => l.replace(/disabled:\s*\S+/, "disabled: true")]);
      } else {
        edits.push([ov.range.end + 1, () => "  disabled: true"]);
      }
    } else {
      // 追加 override(不动原条目,合成语义最稳)
      const out = appendOverride(lines, id);
      writePatch(file, out);
      return [true, "已禁用 " + id + "(追加 override patch,热生效)"];
    }
  } else {
    // 启用:删 override 条目 + 实例条目内的 disabled 行
    if (ov) edits.push([ov.range.start, null, ov.range.end - ov.range.start + 1]);
    const inst = instances.get(id);
    if (inst && inst.lines.keyLines.disabled !== undefined) {
      edits.push([inst.lines.keyLines.disabled, null, 1]);
    }
  }

  const work = edits.sort((a, b) => b[0] - a[0]);
  for (const [idx, replace, count] of work) {
    if (replace) lines[idx] = replace(lines[idx]);
    else lines.splice(idx, count);
  }
  writePatch(file, lines.join("\n"));
  return [true, "已" + (disable ? "禁用" : "启用") + " " + id + "(热生效)"];
}

/** 删除一个 MCP 服务(实例条目 + 对应 override)。返回 [ok, message]。 */
export function deleteMcp(id) {
  const file = patchFile();
  if (!existsSync(file)) return [false, "patch 文件不存在: " + file];
  const text = readFileSync(file, "utf8");
  const { mcp, instances, overrides, lines } = collectMcp(text);
  const found = mcp.find((x) => x.id === id);
  if (!found) return [false, "找不到 MCP 服务: " + id];
  const edits = [];
  const inst = instances.get(id);
  if (inst) edits.push([inst.range.start, null, inst.range.end - inst.range.start + 1]);
  const ov = overrides.get(id);
  if (ov) edits.push([ov.range.start, null, ov.range.end - ov.range.start + 1]);
  edits.sort((a, b) => b[0] - a[0]);
  for (const [idx, , cnt] of edits) lines.splice(idx, cnt);
  writePatch(file, lines.join("\n"));
  return [true, "已删除 " + id + "(热生效;条目上方的注释行保留)"];
}
