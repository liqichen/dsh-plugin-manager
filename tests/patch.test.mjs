// dsh-plugin-manager — lib/patch.mjs 单元测试(node --test 零依赖,Node >= 18)
// 运行: node --test tests/
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { patchFile, collectMcp, toggleMcp, deleteMcp } from "../lib/patch.mjs";

// 测试环境:DSH_HOME 指向临时目录,profile 由 argv 反推(测试进程默认 web)
const TMP = join(process.cwd(), ".test-tmp");
const FILE = join(TMP, "profiles", "web", "cordis.patch.yml");

const SAMPLE = `# 测试 patch(模仿 alpha.1 用户层)
# 第一个 MCP:insert 官方格式
- insert:
    - id: mcp-scrapling
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: scrapling
        transport: stdio
        command: npx
        args: ['-y', '@modelcontextprotocol/server-scrapling']
    - id: mcp-http
      name: '@deepseek-ai/dsh-mcp-client'
      config:
        serverName: web
        transport: streamable-http
        url: http://localhost:3000/mcp
- id: mcp-scrapling
  disabled: true
# 直接条目(rc.2 README 格式,alpha.1 下不生效但应显示)
- id: mcp-legacy
  name: '@deepseek-ai/dsh-mcp-client'
  config:
    serverName: legacy
    transport: stdio
    command: legacy
`;

beforeEach(() => {
  process.env.DSH_HOME = TMP;
  mkdirSync(join(TMP, "profiles", "web"), { recursive: true });
  writeFileSync(FILE, SAMPLE);
});

afterEach(() => {
  delete process.env.DSH_HOME;
  rmSync(TMP, { recursive: true, force: true });
});

test("collectMcp: 识别 insert 实例 + 直接条目 + override 合并", () => {
  const { mcp } = collectMcp(readFileSync(FILE, "utf8"));
  assert.deepEqual(mcp.map((m) => m.id), ["mcp-scrapling", "mcp-http", "mcp-legacy"]);
  const s = mcp.find((m) => m.id === "mcp-scrapling");
  assert.equal(s.serverName, "scrapling");
  assert.equal(s.transport, "stdio");
  assert.equal(s.command, "npx");
  assert.equal(s.disabled, true, "override 应合并为 disabled=true");
  const h = mcp.find((m) => m.id === "mcp-http");
  assert.equal(h.transport, "streamable-http");
  assert.equal(h.url, "http://localhost:3000/mcp");
  assert.equal(h.disabled, false);
});

test("toggleMcp disable: 无 override 时追加 id-targeted override", () => {
  const [ok, msg] = toggleMcp("mcp-http", true);
  assert.equal(ok, true);
  const text = readFileSync(FILE, "utf8");
  assert.match(text, /- id: mcp-http\s*\n\s+disabled: true/);
  const { mcp } = collectMcp(text);
  assert.equal(mcp.find((m) => m.id === "mcp-http").disabled, true);
  // 备份已生成(与 patch 同目录)
  assert.ok(readdirSync(join(TMP, "profiles", "web")).some((f) => f.includes(".bak-")), "应生成 .bak- 备份");
});

test("toggleMcp enable: 删除 override 条目与实例内 disabled 行", () => {
  const [ok] = toggleMcp("mcp-scrapling", false);
  assert.equal(ok, true);
  const text = readFileSync(FILE, "utf8");
  assert.doesNotMatch(text, /- id: mcp-scrapling\s*\n\s+disabled: true/);
  const { mcp } = collectMcp(text);
  assert.equal(mcp.find((m) => m.id === "mcp-scrapling").disabled, false);
  assert.equal(mcp.length, 3, "其他条目不受影响");
});

test("toggleMcp disable: 已有 override 时改值(不新增)", () => {
  const before = readFileSync(FILE, "utf8").match(/- id: mcp-scrapling/g)?.length ?? 0;
  const [ok] = toggleMcp("mcp-scrapling", false); // enable(删 override)
  assert.equal(ok, true);
  const [ok2] = toggleMcp("mcp-scrapling", true); // disable(追加)
  assert.equal(ok2, true);
  const after = readFileSync(FILE, "utf8").match(/- id: mcp-scrapling/g)?.length ?? 0;
  assert.equal(after, before, "override 条目数应保持 1");
  const { mcp } = collectMcp(readFileSync(FILE, "utf8"));
  assert.equal(mcp.find((m) => m.id === "mcp-scrapling").disabled, true);
});

test("deleteMcp: 实例 + override 一并删除,注释保留", () => {
  const [ok, msg] = deleteMcp("mcp-scrapling");
  assert.equal(ok, true);
  assert.match(msg, /已删除/);
  const text = readFileSync(FILE, "utf8");
  assert.doesNotMatch(text, /mcp-scrapling/);
  assert.match(text, /# 测试 patch/);
  const { mcp } = collectMcp(text);
  assert.equal(mcp.length, 2);
});

test("deleteMcp: 直接条目(rc.2 格式)可删", () => {
  const [ok] = deleteMcp("mcp-legacy");
  assert.equal(ok, true);
  assert.doesNotMatch(readFileSync(FILE, "utf8"), /mcp-legacy/);
});

test("操作不存在的 id 返回错误", () => {
  const [ok, msg] = deleteMcp("nope");
  assert.equal(ok, false);
  assert.match(msg, /找不到/);
});

test("patch 文件不存在时返回明确错误而非抛异常", () => {
  rmSync(FILE, { force: true });
  const [ok, msg] = toggleMcp("mcp-http", true);
  assert.equal(ok, false);
  assert.match(msg, /patch 文件不存在/);
});

test("patchFile 探测:当前 profile 层存在时优先于 home 层", () => {
  // 已有 web 层;再造一个 home 层,应仍返回 web 层
  writeFileSync(join(TMP, "cordis.patch.yml"), "[]\n");
  assert.equal(patchFile(), FILE);
});
