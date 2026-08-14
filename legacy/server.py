#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""DSH 插件管理器 — 本地网页 GUI
管理 ~/.dsh 下的 MCP 服务、Skills、内置插件包。
用法: python3 server.py [--port 17891]
"""
import argparse, json, os, re, shutil, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOME = os.path.expanduser("~")
PATCH_FILE = os.path.join(HOME, ".dsh/profiles/web/cordis.patch.yml")
SKILLS_DIR = os.path.join(HOME, ".dsh/skills")
PLUGINS_DIR = os.path.join(HOME, ".dsh/profiles/node_modules/@deepseek-ai")

# ---------------- cordis.patch.yml 行级解析 ----------------

def parse_mcp_entries(text):
    lines = text.splitlines()
    entries, cur = [], None
    for i, ln in enumerate(lines):
        m = re.match(r"^    - id: (\S+)\s*$", ln)
        if m:
            if cur:
                cur["end"] = i
                entries.append(cur)
            cur = {"id": m.group(1), "start": i, "end": len(lines), "disabled": False}
            continue
        if cur is not None:
            if re.match(r"^-\s", ln) or (ln and not ln[0].isspace()):
                cur["end"] = i
                entries.append(cur)
                cur = None
                continue
            if re.match(r"^\s+disabled:\s*true\s*$", ln):
                cur["disabled"] = True
                cur["disabled_line"] = i
            for key in ("serverName", "transport", "command"):
                mm = re.match(r"^\s+" + key + r":\s*(.+?)\s*$", ln)
                if mm and key not in cur:
                    cur[key] = mm.group(1).strip("'\"")
            mm = re.match(r"^\s+url:\s*(.+?)\s*$", ln)
            if mm and "url" not in cur:
                v = mm.group(1)
                cur["url"] = (v[:90] + "…") if len(v) > 90 else v
    if cur:
        entries.append(cur)
    return entries


def backup():
    ts = time.strftime("%Y%m%d-%H%M%S")
    dst = PATCH_FILE + ".bak-" + ts
    shutil.copy2(PATCH_FILE, dst)
    return dst


def toggle_mcp(entry_id, disable):
    with open(PATCH_FILE, encoding="utf-8") as f:
        text = f.read()
    entries = parse_mcp_entries(text)
    e = next((x for x in entries if x["id"] == entry_id), None)
    if not e:
        return False, "找不到插件: " + entry_id
    if e["disabled"] == disable:
        return True, "状态未变化"
    backup()
    lines = text.splitlines()
    if disable:
        lines.insert(e["start"] + 1, "      disabled: true")
    else:
        del lines[e["disabled_line"]]
    with open(PATCH_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return True, "已" + ("禁用" if disable else "启用") + " " + entry_id


def delete_mcp(entry_id):
    with open(PATCH_FILE, encoding="utf-8") as f:
        text = f.read()
    entries = parse_mcp_entries(text)
    e = next((x for x in entries if x["id"] == entry_id), None)
    if not e:
        return False, "找不到插件: " + entry_id
    backup()
    lines = text.splitlines()
    del lines[e["start"]:e["end"]]
    with open(PATCH_FILE, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return True, "已删除 " + entry_id + "(配置块上方的注释行会保留)"

# ---------------- skills / plugins ----------------

def list_skills():
    out = []
    if not os.path.isdir(SKILLS_DIR):
        return out
    for name in sorted(os.listdir(SKILLS_DIR)):
        d = os.path.join(SKILLS_DIR, name)
        md = os.path.join(d, "SKILL.md")
        if not os.path.isdir(d):
            continue
        desc = ""
        if os.path.isfile(md):
            try:
                head = open(md, encoding="utf-8", errors="replace").read(4000)
                m = re.search(r"^description:\s*(.+)$", head, re.M)
                if m:
                    desc = m.group(1).strip().strip("'\"")
            except Exception:
                pass
        out.append({"name": name, "desc": (desc[:160] + "…") if len(desc) > 160 else desc,
                    "path": d})
    return out


def delete_skill(name):
    if not re.match(r"^[\w.\-]+$", name):
        return False, "非法名称"
    d = os.path.join(SKILLS_DIR, name)
    if not os.path.isdir(d):
        return False, "找不到 skill: " + name
    trash = os.path.join(SKILLS_DIR, ".trash-" + time.strftime("%Y%m%d-%H%M%S") + "-" + name)
    os.rename(d, trash)  # 不真删,移入 .trash-* 可恢复
    return True, "已移除 " + name + "(移入回收名 " + os.path.basename(trash) + ",可手动恢复)"


def list_plugins():
    out = []
    if not os.path.isdir(PLUGINS_DIR):
        return out
    for name in sorted(os.listdir(PLUGINS_DIR)):
        pj = os.path.join(PLUGINS_DIR, name, "package.json")
        ver, desc = "", ""
        try:
            meta = json.load(open(pj, encoding="utf-8"))
            ver = meta.get("version", "")
            desc = meta.get("description", "")
        except Exception:
            pass
        out.append({"name": name, "version": ver,
                    "desc": (desc[:110] + "…") if len(desc) > 110 else desc})
    return out


def get_state():
    with open(PATCH_FILE, encoding="utf-8") as f:
        entries = parse_mcp_entries(f.read())
    for e in entries:
        e.pop("start", None); e.pop("end", None); e.pop("disabled_line", None)
    return {"mcp": entries, "skills": list_skills(), "plugins": list_plugins(),
            "patchFile": PATCH_FILE, "skillsDir": SKILLS_DIR}

# ---------------- 网页 ----------------

PAGE = r"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH 插件管理器</title>
<style>
:root{--bg:#0f1115;--card:#1a1d24;--bd:#2a2e38;--fg:#e6e8ee;--mut:#8b90a0;--acc:#4f8cff;--ok:#3fb97c;--warn:#e0a13c;--bad:#e05c5c}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.6 -apple-system,"PingFang SC",sans-serif}
header{padding:18px 28px;border-bottom:1px solid var(--bd);display:flex;align-items:center;gap:14px;position:sticky;top:0;background:var(--bg);z-index:9}
h1{font-size:18px;margin:0}
.tabs button{background:none;border:1px solid var(--bd);color:var(--mut);padding:6px 16px;border-radius:20px;cursor:pointer;margin-right:8px}
.tabs button.on{background:var(--acc);border-color:var(--acc);color:#fff}
main{max-width:980px;margin:0 auto;padding:22px 28px 60px}
.card{background:var(--card);border:1px solid var(--bd);border-radius:12px;padding:14px 18px;margin-bottom:12px;display:flex;gap:14px;align-items:flex-start}
.card.off{opacity:.5}
.info{flex:1;min-width:0}
.name{font-weight:600;font-size:15px}
.meta{color:var(--mut);font-size:12px;word-break:break-all}
.badge{display:inline-block;font-size:11px;padding:1px 8px;border-radius:10px;margin-left:8px;vertical-align:2px}
.b-http{background:#22406e;color:#9cc2ff}.b-stdio{background:#3c3358;color:#c9b8ff}
.b-on{background:#1d4030;color:#7bdca8}.b-off{background:#45262b;color:#f0a0a0}
.sw{position:relative;width:44px;height:24px;flex:none;cursor:pointer;margin-top:2px}
.sw input{display:none}
.sw i{position:absolute;inset:0;background:#3a3f4d;border-radius:12px;transition:.2s}
.sw i:before{content:"";position:absolute;width:18px;height:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}
.sw input:checked+i{background:var(--ok)}
.sw input:checked+i:before{transform:translateX(20px)}
.del{background:none;border:1px solid var(--bd);color:var(--bad);border-radius:8px;padding:4px 10px;cursor:pointer;font-size:12px;flex:none}
.del:hover{border-color:var(--bad)}
#banner{display:none;background:#3a2f18;border:1px solid var(--warn);color:var(--warn);padding:10px 16px;border-radius:10px;margin-bottom:16px}
#toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#232733;border:1px solid var(--bd);padding:10px 20px;border-radius:10px;display:none;max-width:80%}
.count{color:var(--mut);font-size:12px;margin:0 0 12px}
table{width:100%;border-collapse:collapse;font-size:13px}
td,th{padding:6px 10px;border-bottom:1px solid var(--bd);text-align:left;vertical-align:top}
th{color:var(--mut);font-weight:500}
.path{color:var(--mut);font-size:11px;word-break:break-all}
</style></head><body>
<header><h1>🧩 DSH 插件管理器</h1>
<div class="tabs">
<button id="t-mcp" class="on" onclick="show('mcp')">MCP 服务</button>
<button id="t-skills" onclick="show('skills')">Skills</button>
<button id="t-plugins" onclick="show('plugins')">内置插件包</button>
</div></header>
<main>
<div id="banner">✅ 改动已被宿主热重载,<b>无需重启</b>;已打开的会话建议开新会话以刷新工具列表(Skill 目录变动同理)</div>
<div id="c-mcp"></div>
<div id="c-skills" style="display:none"></div>
<div id="c-plugins" style="display:none"></div>
</main>
<div id="toast"></div>
<script>
let S=null;
async function load(){S=await(await fetch('/api/state')).json();render()}
function toast(m,err){const t=document.getElementById('toast');t.textContent=m;t.style.borderColor=err?'var(--bad)':'var(--ok)';t.style.display='block';setTimeout(()=>t.style.display='none',3200)}
function show(k){for(const x of['mcp','skills','plugins']){document.getElementById('c-'+x).style.display=x==k?'':'none';document.getElementById('t-'+x).className=x==k?'on':''}}
function render(){renderMcp();renderSkills();renderPlugins()}
function renderMcp(){
 const el=document.getElementById('c-mcp');
 let h='<p class="count">共 '+S.mcp.length+' 个 MCP 服务 · 配置文件:<span class="path">'+S.patchFile+'</span>(每次修改自动备份 .bak)</p>';
 for(const e of S.mcp){
  h+='<div class="card'+(e.disabled?' off':'')+'">'
   +'<label class="sw"><input type="checkbox" '+(e.disabled?'':'checked')+' onchange="toggle(\''+e.id+'\',this.checked)"><i></i></label>'
   +'<div class="info"><div class="name">'+(e.serverName||e.id)
   +'<span class="badge '+(e.transport==='stdio'?'b-stdio':'b-http')+'">'+(e.transport||'?')+'</span>'
   +'<span class="badge '+(e.disabled?'b-off':'b-on')+'">'+(e.disabled?'已禁用':'运行中')+'</span></div>'
   +'<div class="meta">id: '+e.id+(e.url?' · '+e.url:'')+(e.command?' · '+e.command:'')+'</div></div>'
   +'<button class="del" onclick="delMcp(\''+e.id+'\')">删除</button></div>'}
 el.innerHTML=h}
function renderSkills(){
 const el=document.getElementById('c-skills');
 let h='<p class="count">共 '+S.skills.length+' 个 skill · 目录:<span class="path">'+S.skillsDir+'</span> · 删除=移入 .trash 可恢复</p>';
 for(const s of S.skills){
  h+='<div class="card"><div class="info"><div class="name">'+s.name+'</div>'
   +'<div class="meta">'+s.desc+'</div><div class="path">'+s.path+'</div></div>'
   +'<button class="del" onclick="delSkill(\''+s.name+'\')">删除</button></div>'}
 el.innerHTML=h}
function renderPlugins(){
 const el=document.getElementById('c-plugins');
 let h='<p class="count">共 '+S.plugins.length+' 个内置插件包(DSH 本体零件,只读;升级请用 npm update -g @deepseek-ai/dsh)</p><table><tr><th>名称</th><th>版本</th><th>说明</th></tr>';
 for(const p of S.plugins)h+='<tr><td>'+p.name+'</td><td>'+p.version+'</td><td style="color:var(--mut)">'+p.desc+'</td></tr>';
 el.innerHTML=h+'</table>'}
async function act(body){
 const r=await(await fetch('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
 toast(r.message,!r.ok);
 if(r.ok){document.getElementById('banner').style.display='block';load()}}
function toggle(id,on){act({kind:'mcp-toggle',id:id,disable:!on})}
function delMcp(id){if(confirm('确定从 cordis.patch.yml 删除「'+id+'」?\n(会自动备份,注释行保留)'))act({kind:'mcp-delete',id:id})}
function delSkill(n){if(confirm('确定删除 skill「'+n+'」?\n(移入 .trash 目录,可手动恢复)'))act({kind:'skill-delete',name:n})}
load();
</script></body></html>"""

# ---------------- HTTP ----------------

class H(BaseHTTPRequestHandler):
    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.end_headers()
        self.wfile.write(data)

    def do_OPTIONS(self):
        self._send(204, "")

    def do_GET(self):
        if self.path == "/" or self.path.startswith("/?"):
            self._send(200, PAGE, "text/html; charset=utf-8")
        elif self.path.startswith("/api/state"):
            try:
                self._send(200, json.dumps(get_state(), ensure_ascii=False))
            except Exception as e:
                self._send(500, json.dumps({"ok": False, "message": str(e)}, ensure_ascii=False))
        else:
            self._send(404, "{}")

    def do_POST(self):
        if not self.path.startswith("/api/action"):
            return self._send(404, "{}")
        try:
            n = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(n) or b"{}")
            kind = body.get("kind")
            if kind == "mcp-toggle":
                ok, msg = toggle_mcp(body["id"], bool(body.get("disable")))
            elif kind == "mcp-delete":
                ok, msg = delete_mcp(body["id"])
            elif kind == "skill-delete":
                ok, msg = delete_skill(body["name"])
            else:
                ok, msg = False, "未知操作"
            self._send(200, json.dumps({"ok": ok, "message": msg}, ensure_ascii=False))
        except Exception as e:
            self._send(500, json.dumps({"ok": False, "message": "出错: %s" % e}, ensure_ascii=False))

    def log_message(self, *a):
        pass


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=17891)
    args = ap.parse_args()
    srv = ThreadingHTTPServer(("127.0.0.1", args.port), H)
    print("DSH 插件管理器: http://127.0.0.1:%d" % args.port, flush=True)
    srv.serve_forever()
