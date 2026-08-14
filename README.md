<div align="center">

# 🧩 DSH 插件管理器

**dsh-plugin-manager** — 在 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 设置面板里内嵌的图形化管理器,让你像操作普通 App 一样管理 **MCP 服务 / Skills / 内置插件包**,开关、删除实时热生效,**无需重启 dsh web**。

![License](https://img.shields.io/badge/license-MIT-green)
![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey)
![DeepSeek Harness](https://img.shields.io/badge/DSH-web%20plugin-4f8cff)

</div>

---

## 📑 目录

- [✨ 功能特性](#-功能特性)
- [📸 界面预览](#-界面预览)
- [🚀 安装](#-安装)
- [🖥️ 使用说明](#️-使用说明)
- [⚙️ 工作原理](#️-工作原理)
- [📡 API 参考](#-api-参考)
- [🗂️ 目录结构](#️-目录结构)
- [❓ 常见问题](#-常见问题)
- [⚠️ 注意事项](#️-注意事项)
- [📜 许可证](#-许可证)

---

## ✨ 功能特性

| 能力 | 说明 | 生效方式 |
|---|---|---|
| 🎛️ **MCP 开关** | 一键禁用/启用任意 MCP 服务(写入 `disabled: true` 或移除) | **实时热生效**,无需重启 |
| 🗑️ **MCP 删除** | 从 `cordis.patch.yml` 删除整个 MCP 条目(上方注释保留) | **实时热生效**,无需重启 |
| 📚 **Skills 管理** | 浏览全部 skill 及描述;删除 = 移入 `.trash-*` 目录,**可恢复** | 立即生效 |
| 📦 **插件包浏览** | 只读查看 DSH 本体 160+ 内置插件包的名称/版本/说明 | 只读 |
| 🛡️ **自动备份** | 每次写操作前自动备份配置为 `cordis.patch.yml.bak-<时间戳>` | — |
| 🔌 **零额外进程** | 后端内嵌在 dsh web 宿主里,同源 API,不占端口、无 CORS 暴露 | — |

---

## 📸 界面预览

> 管理页位于 **DSH 设置面板 → 「插件管理」**,三个标签页:

| MCP 服务 | Skills | 内置插件包 |
|---|---|---|
| ![MCP 服务页](docs/screenshots/manager.png) | ![Skills 页](docs/screenshots/manager-skills.png) | ![内置插件包页](docs/screenshots/manager-plugins.png) |

---

## 🚀 安装

> **前提**:已安装 DeepSeek Harness(dsh web),并了解 `~/.dsh` 目录结构。

### 方式一:从本仓库安装(推荐)

```bash
# 1. 克隆并放入用户插件目录
git clone https://github.com/liqichen/dsh-plugin-manager.git
mkdir -p ~/.dsh/plugins/dsh-plugin-manager
cp -r dsh-plugin-manager/{index.js,client.js,package.json} ~/.dsh/plugins/dsh-plugin-manager/

# 2. 通过 dsh CLI 注册插件
dsh plugin --profile web add ~/.dsh/plugins/dsh-plugin-manager

# 3. 声明依赖(让 Node 端可解析)
#    编辑 ~/.dsh/profiles/web/package.json,dependencies 加入:
#    "dsh-plugin-manager": "file:../../plugins/dsh-plugin-manager"

# 4. 在 ~/.dsh/profiles/web/cordis.patch.yml 的 plugins 列表加入:
#    - id: plugin-manager-ui
#      name: dsh-plugin-manager

# 5. 重启 dsh web,打开「设置」→「插件管理」即可使用
```

### 方式二:legacy 独立网页版(不依赖插件系统)

如果插件机制不适用,仓库提供了早期独立版 Python 服务:

```bash
python3 legacy/server.py --port 17891
# 浏览器打开 http://127.0.0.1:17891/
```

---

## 🖥️ 使用说明

打开 **DSH 设置 → 插件管理**,你会看到三个标签页:

**🎛️ MCP 服务**
- 每个 MCP 一张卡片,显示名称、传输方式(`stdio`/`http` 徽章)、运行状态、配置 id
- 右侧**开关**:一键禁用/启用;**删除**按钮:移除该条目(有二次确认)
- 顶部显示配置文件路径与总数量

**📚 Skills**
- 列出所有 skill 及 `SKILL.md` 中的描述、目录路径
- 删除 = 移入 `~/.dsh/skills/.trash-*`,可手动恢复

**📦 内置插件包**
- 表格展示 DSH 本体全部插件包(只读),升级请使用 `npm update -g @deepseek-ai/dsh`

操作完成后,页面会提示「✅ 改动已实时热生效」;**已打开的会话建议开新会话**,以刷新工具列表。

---

## ⚙️ 工作原理

本插件是标准 **DSH 双端插件**,随 dsh web 一同启动,无需独立进程:

```
┌─────────────────────────── dsh web 宿主 ───────────────────────────┐
│                                                                     │
│  浏览器端 (client.js)                 Node 端 (index.js)            │
│  ┌───────────────────────┐            ┌─────────────────────────┐  │
│  │ 设置面板「插件管理」页 │   fetch    │ 注册 /plugin-manager/   │  │
│  │ React UI · 同源 API   │ ─────────▶ │ api/* 路由(内嵌后端)     │  │
│  └───────────────────────┘            │ 读 / 写:                │  │
│                                       │  · ~/.dsh/profiles/web/ │  │
│                                       │    cordis.patch.yml     │  │
│                                       │  · ~/.dsh/skills/       │  │
│                                       │  · ~/.dsh/profiles/     │  │
│                                       │    node_modules/@deep-  │  │
│                                       │    seek-ai/             │  │
│                                       └─────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

**涉及的文件路径:**

| 路径 | 作用 |
|---|---|
| `~/.dsh/profiles/web/cordis.patch.yml` | MCP 服务配置(补丁层),修改后宿主 HMR 热生效 |
| `~/.dsh/skills/` | Skill 目录,删除时重命名为 `.trash-<时间戳>-<名称>` |
| `~/.dsh/profiles/node_modules/@deepseek-ai/` | DSH 本体插件包(只读) |

---

## 📡 API 参考

后端内嵌在 dsh web 宿主,同源提供两个接口:

### `GET /plugin-manager/api/state`

返回当前全部状态:

```json
{
  "mcp": [
    { "id": "mcp-scrapling", "serverName": "scrapling", "transport": "stdio", "command": "scrapling", "disabled": false }
  ],
  "skills": [ { "name": "obsidian-cli", "desc": "…", "path": "/Users/me/.dsh/skills/obsidian-cli" } ],
  "plugins": [ { "name": "dsh-client-web", "version": "1.2.3", "desc": "…" } ],
  "patchFile": "/Users/me/.dsh/profiles/web/cordis.patch.yml",
  "skillsDir": "/Users/me/.dsh/skills"
}
```

### `POST /plugin-manager/api/action`

三种操作,`kind` 区分:

```json
{ "kind": "mcp-toggle",  "id": "mcp-scrapling", "disable": true }
{ "kind": "mcp-delete",  "id": "mcp-scrapling" }
{ "kind": "skill-delete", "name": "obsidian-cli" }
```

响应统一为 `{ "ok": true, "message": "已禁用 mcp-scrapling(热生效)" }`。
所有写操作**先备份** `cordis.patch.yml` 为 `.bak-<时间戳>`,再改文件。

---

## 🛠️ 用 DSH 开发(吃自己的狗粮)

本项目**就是用 DeepSeek Harness 开发出来的** —— 从想法到上线,整个开发过程由运行在 DSH 里的 AI 编码智能体完成:

- 通过 DSH 的 MCP 工具(浏览器自动化、文件读写等)逆向研究官方双端插件的扫描与注入机制(`dsh-client-modules`、`dsh-cordis-host-runner`、`settings.section` slot 契约)
- 直接读写 `cordis.patch.yml` / `~/.dsh/skills/` 反复实验,验证「配置改动 → 宿主 HMR 热生效」链路
- 用 Playwright / Chrome DevTools 自动化截图、检查 UI 效果
- 最终产物又作为标准 DSH 插件被安装回 DSH,用来管理 DSH 自己 —— **DSH 管理 DSH 自己**

这正是 DeepSeek Harness 的设计哲学:**Everything is a Plugin**。

## 🗂️ 目录结构

```
dsh-plugin-manager/
├── index.js          # Node 半:内嵌后端,注册 /plugin-manager/api/* 路由
├── client.js         # 浏览器半:设置面板「插件管理」React UI
├── package.json      # DSH 双端插件元数据(dsh.client.inject 声明宿主依赖)
├── docs/
│   └── screenshots/  # 界面截图
├── legacy/
│   └── server.py     # 早期独立 Python 网页服务版本(备用)
├── README.md
└── LICENSE           # MIT
```

---

## ❓ 常见问题

**Q: 页面提示「插件后端未响应」?**
浏览器端连不上 `/plugin-manager/api`。检查安装步骤 3、4 是否都完成,以及 `~/.dsh/profiles/node_modules/dsh-plugin-manager` 是否正确指向插件目录,然后重启 dsh web。

**Q: 开关/删除后工具列表没变?**
配置改动是热生效的,但**当前已打开的会话**仍持有旧的工具列表,请新开一个会话。

**Q: 删掉的 MCP 怎么恢复?**
`mcp-delete` 只删除配置条目,不会卸载 npm 包。用最近的备份 `cordis.patch.yml.bak-*` 恢复,或手动把条目加回 `cordis.patch.yml` 即可。

**Q: 删掉的 Skill 怎么恢复?**
把 `~/.dsh/skills/.trash-<时间戳>-<名称>` 重命名回 `~/.dsh/skills/<名称>` 即可。

**Q: 想彻底删除 Skill?**
管理器只做「移入回收站」;彻底删除请手动 `rm -rf` 对应的 `.trash-*` 目录。

**Q: 能从管理器升级 DSH 本体吗?**
不能。内置插件包页是只读的,DSH 本体升级请用 `npm update -g @deepseek-ai/dsh`。

---

## ⚠️ 注意事项

1. **操作的是真实配置** —— 所有改动直接写 `cordis.patch.yml` 与 `~/.dsh/skills/`。每次写前自动备份,出问题可用最近的 `.bak-*` 恢复。
2. **MCP 删除 ≠ 卸载包** —— 只删配置条目,包体仍在,重新配置即可恢复。
3. **Skill 删除可恢复** —— 是「移入 `.trash-*`」而非真删。
4. **热生效有边界** —— 配置实时生效,但已开会话的工具列表不自动刷新,请开新会话。
5. **只作用于当前 profile** —— 默认管理 `~/.dsh/profiles/web/`,其他 profile 需相应调整路径。

---

## 📜 许可证

[MIT](LICENSE) © [liqichen](https://github.com/liqichen)

---

*觉得好用的话点个 ⭐,有问题欢迎提 [Issue](https://github.com/liqichen/dsh-plugin-manager/issues)。*
