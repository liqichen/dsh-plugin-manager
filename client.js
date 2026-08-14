/**
 * DSH 插件管理器 — 浏览器半(手写 __ModuleLoader__ bundle,无需构建)。
 * 在设置面板注册一个「插件管理」section,UI 用 React 渲染,
 * 数据走 DSH 宿主内嵌的同源 API(/plugin-manager/api/*,由本包 node 半提供)。
 */
window.__ModuleLoader__.load({
	id: "dsh-plugin-manager",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		const React = require("react");
		const h = React.createElement;
		const API = "/plugin-manager";
		const NS = "plugin-manager";
		const zh = { nav: "插件管理" };
		const en = { nav: "Plugin Manager" };

		const css = ""
			+ ".pm-wrap{max-width:860px;color:var(--dsw-alias-label-primary,#e6e8ee);display:flex;flex-direction:column;gap:12px;font-size:14px;line-height:1.6}"
			+ ".pm-heading{margin:0;font-size:18px;font-weight:600}"
			+ ".pm-banner{background:#3a2f18;border:1px solid #e0a13c;color:#e0a13c;padding:10px 16px;border-radius:10px;font-size:13px}"
			+ ".pm-tabs{display:flex;gap:8px;margin-bottom:4px}"
			+ ".pm-tab{background:none;border:1px solid var(--dsw-alias-border-l2,#2a2e38);color:var(--dsw-alias-label-tertiary,#8b90a0);padding:6px 16px;border-radius:20px;cursor:pointer;font-size:13px}"
			+ ".pm-tab.pm-on{background:#4f8cff;border-color:#4f8cff;color:#fff}"
			+ ".pm-card{background:var(--dsw-alias-bg-module-platform,#1a1d24);border:1px solid var(--dsw-alias-border-l2,#2a2e38);border-radius:12px;padding:14px 18px;display:flex;gap:14px;align-items:flex-start}"
			+ ".pm-card.pm-off{opacity:.5}"
			+ ".pm-info{flex:1;min-width:0}"
			+ ".pm-name{font-weight:600;font-size:15px}"
			+ ".pm-meta{color:var(--dsw-alias-label-tertiary,#8b90a0);font-size:12px;word-break:break-all}"
			+ ".pm-path{color:var(--dsw-alias-label-tertiary,#8b90a0);font-size:11px;word-break:break-all}"
			+ ".pm-badge{display:inline-block;font-size:11px;padding:1px 8px;border-radius:10px;margin-left:8px;vertical-align:2px}"
			+ ".pm-b-http{background:#22406e;color:#9cc2ff}.pm-b-stdio{background:#3c3358;color:#c9b8ff}"
			+ ".pm-b-on{background:#1d4030;color:#7bdca8}.pm-b-off{background:#45262b;color:#f0a0a0}"
			+ ".pm-sw{position:relative;width:44px;height:24px;flex:none;cursor:pointer;margin-top:2px;display:inline-block}"
			+ ".pm-sw input{display:none}"
			+ ".pm-sw i{position:absolute;inset:0;background:#3a3f4d;border-radius:12px;transition:.2s}"
			+ ".pm-sw i:before{content:'';position:absolute;width:18px;height:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}"
			+ ".pm-sw input:checked+i{background:#3fb97c}"
			+ ".pm-sw input:checked+i:before{transform:translateX(20px)}"
			+ ".pm-del{background:none;border:1px solid var(--dsw-alias-border-l2,#2a2e38);color:#e05c5c;border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px;flex:none}"
			+ ".pm-del:hover{border-color:#e05c5c}"
			+ ".pm-count{color:var(--dsw-alias-label-tertiary,#8b90a0);font-size:12px;margin:0}"
			+ ".pm-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#232733;border:1px solid #3fb97c;color:var(--dsw-alias-label-primary,#e6e8ee);padding:10px 20px;border-radius:10px;z-index:99;max-width:80%;font-size:13px}"
			+ ".pm-table{width:100%;border-collapse:collapse;font-size:13px}"
			+ ".pm-table td,.pm-table th{padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,#2a2e38);text-align:left;vertical-align:top}"
			+ ".pm-table th{color:var(--dsw-alias-label-tertiary,#8b90a0);font-weight:500}"
			+ ".pm-err{background:var(--dsw-alias-bg-module-platform,#1a1d24);border:1px solid #e0a13c;border-radius:12px;padding:18px;font-size:13px}"
			+ ".pm-err code{background:#000;padding:2px 8px;border-radius:6px;display:inline-block;margin-top:6px}"
			+ ".pm-retry{margin-top:10px;background:#4f8cff;border:none;color:#fff;padding:6px 18px;border-radius:8px;cursor:pointer}";
		const tagId = "dsh-plugin-manager/styles";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-plugin-manager";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		function Badge(props) {
			return h("span", { className: "pm-badge " + props.kind }, props.text);
		}

		function Switch(props) {
			return h("label", { className: "pm-sw" },
				h("input", { type: "checkbox", checked: props.on, onChange: function (ev) { props.onChange(ev.target.checked); } }),
				h("i", null));
		}

		function McpCard(props) {
			const e = props.e;
			return h("div", { className: "pm-card" + (e.disabled ? " pm-off" : "") },
				h(Switch, { on: !e.disabled, onChange: function (on) { props.onToggle(e.id, on); } }),
				h("div", { className: "pm-info" },
					h("div", { className: "pm-name" }, e.serverName || e.id,
						h(Badge, { text: e.transport || "?", kind: e.transport === "stdio" ? "pm-b-stdio" : "pm-b-http" }),
						h(Badge, { text: e.disabled ? "已禁用" : "运行中", kind: e.disabled ? "pm-b-off" : "pm-b-on" })),
					h("div", { className: "pm-meta" }, "id: " + e.id + (e.url ? " · " + e.url : "") + (e.command ? " · " + e.command : ""))),
				h("button", { className: "pm-del", onClick: function () { props.onDelete(e.id); } }, "删除"));
		}

		function SkillCard(props) {
			const s = props.s;
			return h("div", { className: "pm-card" },
				h("div", { className: "pm-info" },
					h("div", { className: "pm-name" }, s.name),
					h("div", { className: "pm-meta" }, s.desc),
					h("div", { className: "pm-path" }, s.path)),
				h("button", { className: "pm-del", onClick: function () { props.onDelete(s.name); } }, "删除"));
		}

		function ManagerSection() {
			const st = React.useState(null), state = st[0], setState = st[1];
			const er = React.useState(null), error = er[0], setError = er[1];
			const tb = React.useState("mcp"), tab = tb[0], setTab = tb[1];
			const ts = React.useState(null), toast = ts[0], setToast = ts[1];
			const dr = React.useState(false), dirty = dr[0], setDirty = dr[1];

			const load = React.useCallback(function () {
				fetch(API + "/api/state").then(function (r) { return r.json(); })
					.then(function (s) { setState(s); setError(null); })
					.catch(function (e) { setError(String(e)); });
			}, []);
			React.useEffect(function () { load(); }, [load]);

			function act(body) {
				fetch(API + "/api/action", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
					.then(function (r) { return r.json(); })
					.then(function (r) {
						setToast(r.message);
						if (r.ok) { setDirty(true); load(); }
						setTimeout(function () { setToast(null); }, 3500);
					})
					.catch(function (e) { setToast("请求失败: " + e); });
			}
			function toggleMcp(id, on) { act({ kind: "mcp-toggle", id: id, disable: !on }); }
			function deleteMcp(id) {
				if (window.confirm("确定从 cordis.patch.yml 删除「" + id + "」?\n(会自动备份,注释行保留)")) act({ kind: "mcp-delete", id: id });
			}
			function deleteSkill(name) {
				if (window.confirm("确定删除 skill「" + name + "」?\n(移入 .trash 目录,可手动恢复)")) act({ kind: "skill-delete", name: name });
			}

			const children = [];
			children.push(h("h2", { key: "h", className: "pm-heading" }, "插件管理器"));
			if (dirty) children.push(h("div", { key: "b", className: "pm-banner" }, "✅ 改动已实时热生效,无需重启;已打开的会话建议开新会话以刷新工具列表"));

			if (error) {
				children.push(h("div", { key: "e", className: "pm-err" },
					h("div", null, "插件后端未响应(同源 /plugin-manager/api)。后端已内嵌在 DSH 宿主里,请重启 dsh web 后重试。"),
					h("br", null),
					h("button", { className: "pm-retry", onClick: load }, "重试")));
				return h("div", { className: "pm-wrap" }, children);
			}
			if (!state) {
				children.push(h("p", { key: "l", className: "pm-count" }, "加载中…"));
				return h("div", { className: "pm-wrap" }, children);
			}

			children.push(h("div", { key: "tabs", className: "pm-tabs" },
				h("button", { className: "pm-tab" + (tab === "mcp" ? " pm-on" : ""), onClick: function () { setTab("mcp"); } }, "MCP 服务"),
				h("button", { className: "pm-tab" + (tab === "skills" ? " pm-on" : ""), onClick: function () { setTab("skills"); } }, "Skills"),
				h("button", { className: "pm-tab" + (tab === "plugins" ? " pm-on" : ""), onClick: function () { setTab("plugins"); } }, "内置插件包")));

			if (tab === "mcp") {
				children.push(h("p", { key: "c", className: "pm-count" },
					"共 " + state.mcp.length + " 个 MCP 服务 · 配置文件 " + state.patchFile + "(每次修改自动备份 .bak)"));
				state.mcp.forEach(function (e) {
					children.push(h(McpCard, { key: e.id, e: e, onToggle: toggleMcp, onDelete: deleteMcp }));
				});
			} else if (tab === "skills") {
				children.push(h("p", { key: "c", className: "pm-count" },
					"共 " + state.skills.length + " 个 skill · 目录 " + state.skillsDir + " · 删除=移入 .trash 可恢复"));
				state.skills.forEach(function (s) {
					children.push(h(SkillCard, { key: s.name, s: s, onDelete: deleteSkill }));
				});
			} else {
				children.push(h("p", { key: "c", className: "pm-count" },
					"共 " + state.plugins.length + " 个内置插件包(DSH 本体零件,只读;升级请用 npm update -g @deepseek-ai/dsh)"));
				children.push(h("table", { key: "t", className: "pm-table" },
					h("thead", null, h("tr", null, h("th", null, "名称"), h("th", null, "版本"), h("th", null, "说明"))),
					h("tbody", null, state.plugins.map(function (p) {
						return h("tr", { key: p.name },
							h("td", null, p.name),
							h("td", null, p.version),
							h("td", { style: { color: "var(--dsw-alias-label-tertiary,#8b90a0)" } }, p.desc));
					}))));
			}
			if (toast) children.push(h("div", { key: "toast", className: "pm-toast" }, toast));
			return h("div", { className: "pm-wrap" }, children);
		}

		function apply(ctx) {
			const t = ctx.locale.bind(NS);
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "plugin-manager: dictionaries");
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "plugin-manager",
				order: 16,
				label: () => t("nav"),
				locale: NS
			}, ManagerSection));
		}
		const inject = ["slots", "locale"];
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
