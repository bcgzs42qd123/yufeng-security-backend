/**
 * 誉峰保安刷题 - 管理后端（Node.js，无第三方依赖，单文件）
 *
 * 功能：
 *   1. 软件更新分发：上传新APK，App检查/下载新版本
 *   2. 打卡记录：App打卡签到，含时间、IP、姓名、备注、位置
 *   3. 登录/访问记录：每次App打开上报，含IP、设备
 *   4. IP查看：聚合每个IP的访问次数
 *   5. 网页管理后台：/admin，密码登录后可查看上述所有数据
 *
 * 启动：node server.js   （监听 3000 端口）
 * 管理后台：浏览器打开 http://服务器IP:3000/admin
 * 数据保存在同目录 data.json（自动生成）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ===================== 配置 ===================== */
const PORT = process.env.PORT || 3000;
const ADMIN_PASS = process.env.ADMIN_PASS || 'yf123456';   // 管理后台密码，可用环境变量覆盖
/* =============================================== */

const DATA_FILE = path.join(__dirname, 'data.json');
const APK_DIR = path.join(__dirname, 'apk');
if (!fs.existsSync(APK_DIR)) fs.mkdirSync(APK_DIR, { recursive: true });

let DATA = { checkins: [], visits: [], version: { v: '1.0', note: '', apkUrl: '', time: 0 } };
if (fs.existsSync(DATA_FILE)) {
  try { DATA = Object.assign(DATA, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); } catch (e) {}
}
function save() { try { fs.writeFileSync(DATA_FILE, JSON.stringify(DATA)); } catch (e) {} }

// 管理后台会话 token（重启失效）
const TOKENS = new Set();
function newToken() { const t = crypto.randomBytes(16).toString('hex'); TOKENS.add(t); return t; }

// 取客户端IP
function clientIp(req) {
  const xf = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  if (xf) return xf;
  return (req.socket.remoteAddress || '').replace(/^::ffff:/, '') || '未知';
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, x-token',
  'Content-Type': 'application/json; charset=utf-8'
};
function json(res, o, status) { res.writeHead(status || 200, CORS); res.end(JSON.stringify(o)); }
function isAdmin(req) { return TOKENS.has((req.headers['x-token'] || '').trim()); }

/* ===================== 管理后台页面 ===================== */
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>誉峰保安刷题 · 管理后台</title>
<style>
*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif}
body{background:#f2f4f9;color:#0f1b2d;padding:16px;max-width:900px;margin:auto}
h1{font-size:20px;margin-bottom:4px}.sub{color:#64748b;font-size:13px;margin-bottom:18px}
.card{background:#fff;border:1px solid #e8ebf2;border-radius:14px;padding:16px;margin-bottom:16px;box-shadow:0 2px 12px rgba(24,34,64,.05)}
.card h2{font-size:15px;margin-bottom:12px}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{text-align:left;padding:8px 6px;border-bottom:1px solid #eef1f6;white-space:nowrap}
th{color:#64748b;font-weight:600}
.tab{display:inline-block;padding:8px 16px;border-radius:20px;cursor:pointer;font-size:13px;margin-right:6px;background:#fff;border:1px solid #e8ebf2;color:#64748b}
.tab.on{background:#3b5bff;color:#fff;border-color:#3b5bff}
.pane{display:none}.pane.on{display:block}
input[type=text],input[type=password]{width:100%;border:1.5px solid #e8ebf2;border-radius:10px;padding:10px 12px;font-size:14px;margin-bottom:10px}
button{border:none;border-radius:10px;padding:10px 18px;font-size:14px;cursor:pointer;background:#3b5bff;color:#fff;font-weight:600}
button.ghost{background:#eef1f6;color:#64748b}
.warn{color:#e5484d}.okc{color:#17a34a}
.login-box{max-width:360px;margin:80px auto;background:#fff;border:1px solid #e8ebf2;border-radius:16px;padding:24px;box-shadow:0 8px 28px rgba(24,34,64,.08)}
.login-box h2{font-size:18px;margin-bottom:16px}
.stat{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
.stat div{background:#fff;border:1px solid #e8ebf2;border-radius:12px;padding:12px;text-align:center}
.stat b{font-size:22px;display:block}.stat span{font-size:12px;color:#64748b}
</style></head><body>
<div id="login"><div class="login-box"><h2>管理后台登录</h2><input type="password" id="pwd" placeholder="请输入管理密码"><button onclick="doLogin()">登 录</button></div></div>
<div id="panel" style="display:none">
<h1>誉峰保安刷题 · 管理后台</h1><div class="sub">软件更新 · 打卡记录 · 登录/访问记录 · IP统计</div>
<div class="stat">
<div><b id="sCheck">0</b><span>打卡次数</span></div>
<div><b id="sVisit">0</b><span>访问/登录</span></div>
<div><b id="sIp">0</b><span>IP数</span></div>
<div><b id="sVer">-</b><span>当前版本</span></div>
</div>
<div class="card"><div class="tab on" data-p="upd">软件更新</div><div class="tab" data-p="check">打卡记录</div><div class="tab" data-p="visit">登录记录</div><div class="tab" data-p="ip">IP查看</div></div>

<div class="pane on" id="p-upd">
  <div class="card"><h2>版本信息</h2>
    <input type="text" id="v" placeholder="版本号，如 1.1"><input type="text" id="note" placeholder="更新说明">
    <button onclick="saveVer()">保存版本信息</button>
  </div>
  <div class="card"><h2>上传新版APK</h2>
    <input type="file" id="apkFile" accept=".apk"><br><br>
    <button onclick="upApk()">上传并设为最新版</button>
    <p id="apkInfo" class="sub" style="margin-top:10px"></p>
  </div>
</div>

<div class="pane card" id="p-check"><table id="tCheck"><tr><th>时间</th><th>姓名</th><th>IP</th><th>备注</th></tr></table></div>
<div class="pane card" id="p-visit"><table id="tVisit"><tr><th>时间</th><th>IP</th><th>设备</th><th>来源</th></tr></table></div>
<div class="pane card" id="p-ip"><table id="tIp"><tr><th>IP</th><th>次数</th><th>最近时间</th></tr></table></div>
</div>
<script>
var TOK='';
function api(p,o){return fetch(p,{method:'POST',headers:{'Content-Type':'application/json','x-token':TOK},body:o?JSON.stringify(o):'{}'}).then(r=>r.json());}
function doLogin(){api('/api/auth',{pass:document.getElementById('pwd').value}).then(d=>{if(d.ok){TOK=d.token;document.getElementById('login').style.display='none';document.getElementById('panel').style.display='block';load();}else{alert('密码错误');}});}
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));t.classList.add('on');document.querySelectorAll('.pane').forEach(p=>p.classList.remove('on'));document.getElementById('p-'+t.dataset.p).classList.add('on');});
function load(){
 api('/api/data').then(d=>{if(!d.ok)return;
   var c=d.checkins||[],v=d.visits||[],ips=d.ips||[];
   document.getElementById('sCheck').textContent=c.length;
   document.getElementById('sVisit').textContent=v.length;
   document.getElementById('sIp').textContent=ips.length;
   document.getElementById('sVer').textContent=d.version.v||'-';
   document.getElementById('apkInfo').textContent=d.version.apkUrl?('最新：'+d.version.v+'　'+(d.version.apkUrl||'')):'尚未上传APK';
   document.getElementById('tCheck').innerHTML='<tr><th>时间</th><th>姓名</th><th>IP</th><th>备注</th></tr>'+c.map(x=>'<tr><td>'+x.time+'</td><td>'+x.name+'</td><td>'+x.ip+'</td><td>'+(x.note||'')+'</td></tr>').join('');
   document.getElementById('tVisit').innerHTML='<tr><th>时间</th><th>IP</th><th>设备</th><th>来源</th></tr>'+v.map(x=>'<tr><td>'+x.time+'</td><td>'+x.ip+'</td><td>'+(x.device||'')+'</td><td>'+(x.src||'打开')+'</td></tr>').join('');
   document.getElementById('tIp').innerHTML='<tr><th>IP</th><th>次数</th><th>最近时间</th></tr>'+ips.map(x=>'<tr><td>'+x.ip+'</td><td>'+x.n+'</td><td>'+(x.last||'')+'</td></tr>').join('');
 });
}
function saveVer(){var v=document.getElementById('v').value.trim(),n=document.getElementById('note').value.trim();api('/api/update',{v,n}).then(d=>{alert(d.ok?'已保存':'失败:'+d.msg);load();});}
function upApk(){var f=document.getElementById('apkFile').files[0];if(!f){alert('请选择APK文件');return;}fetch('/api/upload',{method:'POST',headers:{'x-token':TOK,'x-fname':f.name},body:f}).then(r=>r.json()).then(d=>{alert(d.ok?'上传成功，已设为最新版':'失败:'+d.msg);load();});}
</script></body></html>`;

/* ===================== HTTP 服务 ===================== */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.apk': 'application/vnd.android.package-archive' };
http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  const url = req.url.split('?')[0];

  /* ---- 管理后台页 ---- */
  if (url === '/admin' || url === '/admin/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(ADMIN_HTML); return; }

  /* ---- 静态 APK 下载 ---- */
  if (url.startsWith('/apk/')) {
    const file = path.join(APK_DIR, path.basename(url));
    if (fs.existsSync(file)) { const st = fs.statSync(file); res.writeHead(200, { 'Content-Type': 'application/vnd.android.package-archive', 'Content-Length': st.size }); fs.createReadStream(file).pipe(res); }
    else json(res, { ok: false, msg: '文件不存在' }, 404);
    return;
  }

  /* ---- API ---- */
  let body = [];
  req.on('data', c => body.push(c));
  req.on('end', () => {
    const buf = Buffer.concat(body);
    const ip = clientIp(req);

    /* 管理登录 */
    if (url === '/api/auth') {
      let o = {}; try { o = JSON.parse(buf.toString()); } catch (e) {}
      if (o.pass === ADMIN_PASS) json(res, { ok: true, token: newToken() });
      else json(res, { ok: false, msg: '密码错误' }, 401);
      return;
    }
    /* 拉取全部数据（管理） */
    if (url === '/api/data') {
      if (!isAdmin(req)) return json(res, { ok: false, msg: '未授权' }, 401);
      const ipmap = {};
      DATA.visits.forEach(x => { ipmap[x.ip] = (ipmap[x.ip] || 0) + 1; });
      const ips = Object.keys(ipmap).map(ip => ({ ip, n: ipmap[ip], last: DATA.visits.filter(v => v.ip === ip).slice(-1)[0].time }));
      json(res, { ok: true, checkins: DATA.checkins.slice(-200).reverse(), visits: DATA.visits.slice(-300).reverse(), ips, version: DATA.version });
      return;
    }
    /* 保存版本信息（管理） */
    if (url === '/api/update') {
      if (!isAdmin(req)) return json(res, { ok: false, msg: '未授权' }, 401);
      let o = {}; try { o = JSON.parse(buf.toString()); } catch (e) {}
      if (o.v) DATA.version.v = String(o.v).trim();
      if (typeof o.n !== 'undefined') DATA.version.note = String(o.n);
      DATA.version.time = Date.now();
      save(); json(res, { ok: true }); return;
    }
    /* 上传APK（管理，raw body = APK字节） */
    if (url === '/api/upload') {
      if (!isAdmin(req)) return json(res, { ok: false, msg: '未授权' }, 401);
      const name = req.headers['x-fname'] || ('update_' + Date.now() + '.apk');
      const safe = path.basename(String(name));
      fs.writeFileSync(path.join(APK_DIR, safe), buf);
      DATA.version.apkUrl = req.headers.host ? 'http://' + req.headers.host + '/apk/' + safe : '/apk/' + safe;
      DATA.version.time = Date.now();
      save(); json(res, { ok: true, apkUrl: DATA.version.apkUrl }); return;
    }
    /* App 上报：打开/访问 */
    if (url === '/api/report') {
      let o = {}; try { o = JSON.parse(buf.toString()); } catch (e) {}
      DATA.visits.push({ time: new Date().toLocaleString('zh-CN', { hour12: false }), ip, device: String((req.headers['user-agent'] || '').slice(0, 80)), src: o.type || '打开' });
      if (DATA.visits.length > 2000) DATA.visits = DATA.visits.slice(-2000);
      save(); json(res, { ok: true }); return;
    }
    /* App 打卡签到 */
    if (url === '/api/checkin') {
      let o = {}; try { o = JSON.parse(buf.toString()); } catch (e) {}
      DATA.checkins.push({ time: new Date().toLocaleString('zh-CN', { hour12: false }), ip, name: String(o.name || '').slice(0, 20), note: String(o.note || '').slice(0, 40), lat: o.lat || '', lng: o.lng || '' });
      if (DATA.checkins.length > 2000) DATA.checkins = DATA.checkins.slice(-2000);
      save(); json(res, { ok: true }); return;
    }
    /* App 检查更新 */
    if (url === '/api/version') { json(res, { ok: true, version: DATA.version }); return; }

    json(res, { ok: false, msg: '未知接口' }, 404);
  });
}).listen(PORT, () => {
  console.log('誉峰保安刷题 管理后端已启动');
  console.log('端口：' + PORT);
  console.log('管理后台：http://<服务器地址>:' + PORT + '/admin');
  console.log('管理密码：' + ADMIN_PASS + '（请在 server.js 里改成自己的）');
});
