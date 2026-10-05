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
const https = require('https');
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

let DATA = {
  checkins: [], visits: [],
  version: { v: '2.0', note: '', apkUrl: '', time: 0, push: true },
  cardkeys: [],
  announcement: { title: '', content: '', on: false, updatedAt: 0 },
  settings: { appName: '誉峰保安刷题', primary: '#3b5bff', requireCard: false }
};
if (fs.existsSync(DATA_FILE)) {
  try { DATA = Object.assign(DATA, JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))); } catch (e) {}
  delete DATA.videos; /* 视频功能已下线 */
}
function save() {
  try { fs.writeFileSync(DATA_FILE, JSON.stringify(DATA)); } catch (e) {}
  if (PG) { PG.query("INSERT INTO kv(key,val) VALUES('data',$1) ON CONFLICT(key) DO UPDATE SET val=$1", [JSON.stringify(DATA)]).catch(function(e){ console.log('pg save err: ' + e.message); }); }
}
/* 持久化：优先用 Postgres（PGURL 环境变量），失败则退回本地文件 */
let PG = null;
if (process.env.PGURL) {
  try {
    const { Client } = require('pg');
    PG = new Client({ connectionString: process.env.PGURL, ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false } });
  } catch (e) { PG = null; }
}
function loadPG(cb) {
  if (!PG) { return cb(); }
  PG.connect(function(err){
    if (err) { console.log('PG connect fail, use local file: ' + err.message); PG = null; return cb(); }
    PG.query('CREATE TABLE IF NOT EXISTS kv(key text primary key, val text)').then(function(){
      return PG.query("SELECT val FROM kv WHERE key='data'");
    }).then(function(r){
      if (r && r.rows && r.rows[0] && r.rows[0].val) {
        try { DATA = Object.assign(DATA, JSON.parse(r.rows[0].val)); } catch (e) {}
        delete DATA.videos; /* 视频功能已下线 */
      }
      cb();
    }).catch(function(e){ console.log('pg load err: ' + e.message); cb(); });
  });
}

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
textarea{width:100%;border:1.5px solid #e8ebf2;border-radius:10px;padding:10px 12px;font-size:14px;margin-bottom:10px;font-family:inherit}
input[type=color]{width:60px;height:36px;border:1.5px solid #e8ebf2;border-radius:8px;padding:2px;background:#fff}
button{border:none;border-radius:10px;padding:10px 18px;font-size:14px;cursor:pointer;background:#3b5bff;color:#fff;font-weight:600}
button.mini{padding:5px 10px;font-size:12px;border-radius:8px;background:#e5484d}
button.ghost{background:#eef1f6;color:#64748b}
.kcode{font-family:monospace;font-weight:700;letter-spacing:.5px}
label.chk{display:flex;align-items:center;gap:8px;font-size:14px;margin-bottom:12px}
label.chk input{width:18px;height:18px}
.warn{color:#e5484d}.okc{color:#17a34a}
.login-box{max-width:360px;margin:80px auto;background:#fff;border:1px solid #e8ebf2;border-radius:16px;padding:24px;box-shadow:0 8px 28px rgba(24,34,64,.08)}
.login-box h2{font-size:18px;margin-bottom:16px}
.stat{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
.stat div{background:#fff;border:1px solid #e8ebf2;border-radius:12px;padding:12px;text-align:center}
.stat b{font-size:22px;display:block}.stat span{font-size:12px;color:#64748b}
</style></head><body>
<div id="login"><div class="login-box"><h2>管理后台登录</h2><input type="password" id="pwd" placeholder="请输入管理密码"><button id="loginBtn" onclick="doLogin()">登 录</button><p class="sub" style="margin-top:10px;color:#a3acc2;font-size:12px">免费服务闲置会休眠，首次登录请稍等片刻</p></div></div>
<div id="panel" style="display:none">
<h1>誉峰保安刷题 · 管理后台</h1><div class="sub">软件更新 · 打卡记录 · 登录/访问记录 · IP统计 · 卡密 · 公告 · UI设置</div>
<div class="stat">
<div><b id="sCheck">0</b><span>打卡次数</span></div>
<div><b id="sVisit">0</b><span>访问/登录</span></div>
<div><b id="sIp">0</b><span>IP数</span></div>
<div><b id="sVer">-</b><span>当前版本</span></div>
</div>
<div class="card"><div class="tab on" data-p="upd">软件更新</div><div class="tab" data-p="check">打卡记录</div><div class="tab" data-p="visit">登录记录</div><div class="tab" data-p="ip">IP查看</div><div class="tab" data-p="card">卡密管理</div><div class="tab" data-p="ann">公告</div><div class="tab" data-p="ui">UI设置</div></div>

<div class="pane on" id="p-upd">
  <div class="card"><h2>版本信息</h2>
    <input type="text" id="v" placeholder="版本号，如 1.1"><input type="text" id="note" placeholder="更新说明">
    <label style="display:flex;align-items:center;gap:8px;margin:10px 0;font-size:14px;cursor:pointer"><input type="checkbox" id="vPush" checked style="width:18px;height:18px;accent-color:var(--blue)"> 开启版本推送（开启后App会提示更新、停用旧版本）</label>
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

<div class="pane card" id="p-card">
  <div class="card"><h2>生成卡密</h2>
    <input type="text" id="genN" placeholder="生成数量，如 20">
    <button onclick="genKeys()">生成卡密</button>
    <p id="genOut" class="sub" style="margin-top:10px"></p>
  </div>
  <div class="card"><h2>添加自定义卡密</h2>
    <textarea id="cusCodes" rows="3" placeholder="每行一个卡密，或用逗号/分号分隔"></textarea>
    <button onclick="addCustom()">添加自定义卡密</button>
  </div>
  <div class="card"><h2>卡密列表 <span id="cardStat" class="sub"></span></h2>
    <table id="tCard"><tr><th>卡密</th><th>状态</th><th>使用人</th><th>操作</th></tr></table>
  </div>
</div>

<div class="pane card" id="p-ann">
  <h2>发布公告</h2>
  <input type="text" id="annTitle" placeholder="公告标题">
  <textarea id="annContent" rows="4" placeholder="公告内容"></textarea>
  <label class="chk"><input type="checkbox" id="annOn"> 启用公告（前端启动时弹窗显示）</label>
  <button onclick="saveAnn()">保存公告</button>
</div>

<div class="pane card" id="p-ui">
  <h2>UI 设置</h2>
  <input type="text" id="setName" placeholder="应用名称（前端显示的品牌名）">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><label style="font-size:14px;color:#64748b">主题色</label><input type="color" id="setPrimary"></div>
  <label class="chk"><input type="checkbox" id="setRequire"> <b>卡密开关</b>（开启后 App 需输入卡密才能使用）</label>
  <button onclick="saveUI()">保存UI设置</button>
</div>
</div>
<script>
var TOK='';
function api(p,o){return fetch(p,{method:'POST',headers:{'Content-Type':'application/json','x-token':TOK},body:o?JSON.stringify(o):'{}'}).then(r=>r.json());}
function doLogin(){
  var b=document.getElementById('loginBtn'), p=document.getElementById('pwd').value.trim();
  if(!p){alert('请输入管理密码');return;}
  b.disabled=true; b.textContent='登录中…';
  fetch('/api/auth',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pass:p})})
    .then(function(r){return r.json();})
    .then(function(d){
      b.disabled=false; b.textContent='登 录';
      if(d.ok){TOK=d.token;document.getElementById('login').style.display='none';document.getElementById('panel').style.display='block';load();}
      else{alert('密码错误');}
    })
    .catch(function(){ b.disabled=false; b.textContent='登 录'; alert('连接失败，请重试（免费服务首次访问可能需等待数十秒）'); });
}
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('on'));t.classList.add('on');document.querySelectorAll('.pane').forEach(p=>p.classList.remove('on'));document.getElementById('p-'+t.dataset.p).classList.add('on');});
function load(){
 api('/api/data').then(d=>{if(!d.ok)return;
   var c=d.checkins||[],v=d.visits||[],ips=d.ips||[];
   document.getElementById('sCheck').textContent=c.length;
   document.getElementById('sVisit').textContent=v.length;
   document.getElementById('sIp').textContent=ips.length;
   document.getElementById('sVer').textContent=d.version.v||'-';
   document.getElementById('apkInfo').textContent=d.version.apkUrl?('最新：'+d.version.v+'　'+(d.version.apkUrl||'')):'尚未上传APK';
   var vp=document.getElementById('vPush'); if(vp) vp.checked = d.version.push!==false;
   document.getElementById('tCheck').innerHTML='<tr><th>时间</th><th>姓名</th><th>IP</th><th>备注</th></tr>'+c.map(x=>'<tr><td>'+x.time+'</td><td>'+x.name+'</td><td>'+x.ip+'</td><td>'+(x.note||'')+'</td></tr>').join('');
   document.getElementById('tVisit').innerHTML='<tr><th>时间</th><th>IP</th><th>设备</th><th>来源</th></tr>'+v.map(x=>'<tr><td>'+x.time+'</td><td>'+x.ip+'</td><td>'+(x.device||'')+'</td><td>'+(x.src||'打开')+'</td></tr>').join('');
   document.getElementById('tIp').innerHTML='<tr><th>IP</th><th>次数</th><th>最近时间</th></tr>'+ips.map(x=>'<tr><td>'+x.ip+'</td><td>'+x.n+'</td><td>'+(x.last||'')+'</td></tr>').join('');
   document.getElementById('cardStat').textContent='（共'+(d.card.total||0)+'个 · 已用'+(d.card.used||0)+'）';
   var s=d.settings||{};
   document.getElementById('setName').value=s.appName||'';
   document.getElementById('setPrimary').value=/^#[0-9a-f]{6}$/i.test(s.primary||'')?s.primary:'#3b5bff';
   document.getElementById('setRequire').checked=!!s.requireCard;
   var a=d.announcement||{};
   document.getElementById('annTitle').value=a.title||'';
   document.getElementById('annContent').value=a.content||'';
   document.getElementById('annOn').checked=!!a.on;
   loadCard();
 });
}
function loadCard(){api('/api/cardkeys/list').then(d=>{if(!d.ok)return;document.getElementById('tCard').innerHTML='<tr><th>卡密</th><th>状态</th><th>绑定设备</th><th>操作</th></tr>'+d.keys.map(x=>'<tr><td class="kcode">'+x.code+'</td><td>'+(x.status==='used'?'<span class="warn">已用</span>':'<span class="okc">未用</span>')+'</td><td style="font-size:12px;color:#666">'+String(x.bindDev||x.usedBy||'').replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</td><td><button class="mini" onclick="delKey('+x.code+')">删除</button></td></tr>').join('')||'<tr><td colspan="4" class="sub">暂无卡密</td></tr>';});}
function genKeys(){var n=document.getElementById('genN').value.trim();api('/api/cardkeys/gen',{n:n||1}).then(d=>{if(!d.ok){alert('失败:'+d.msg);return;}document.getElementById('genOut').textContent='已生成 '+(d.codes||[]).length+' 个：'+((d.codes||[]).slice(0,5).join('  ') + ((d.codes||[]).length>5?' …':'') );load();});}
function addCustom(){var s=document.getElementById('cusCodes').value;api('/api/cardkeys/custom',{codes:s}).then(d=>{alert(d.ok?('成功添加 '+d.added+' 个，重复 '+(d.dup||[]).length+' 个'):('失败:'+d.msg));document.getElementById('cusCodes').value='';load();});}
function delKey(code){if(!confirm('删除卡密 '+code+' ？'))return;api('/api/cardkeys/del',{code:code}).then(d=>{if(d.ok)loadCard();});}
function saveAnn(){var t=document.getElementById('annTitle').value,c=document.getElementById('annContent').value,on=document.getElementById('annOn').checked;api('/api/announcement',{title:t,content:c,on:on}).then(d=>{alert(d.ok?'公告已保存':'失败:'+d.msg);});}
function saveUI(){var n=document.getElementById('setName').value,p=document.getElementById('setPrimary').value,r=document.getElementById('setRequire').checked;api('/api/settings',{appName:n,primary:p,requireCard:r}).then(d=>{alert(d.ok?'UI设置已保存':'失败:'+d.msg);});}
function saveVer(){var v=document.getElementById('v').value.trim(),n=document.getElementById('note').value.trim(),push=document.getElementById('vPush').checked;api('/api/update',{v,n,push}).then(d=>{alert(d.ok?'已保存':'失败:'+d.msg);load();});}
function upApk(){var f=document.getElementById('apkFile').files[0];if(!f){alert('请选择APK文件');return;}var ver=document.getElementById('v').value.trim();if(!ver){if(!confirm('未填写版本号，将沿用当前版本号，确定继续？'))return;}fetch('/api/upload',{method:'POST',headers:{'x-token':TOK,'x-fname':f.name,'x-ver':ver},body:f}).then(r=>r.json()).then(d=>{alert(d.ok?'上传成功，已设为最新版 v'+(d.v||ver||'-'):'失败:'+d.msg);load();});}
</script></body></html>`;

/* ===================== HTTP 服务 ===================== */
/* 在线中文女声朗读：代理 Google 翻译 TTS（从海外后端取音频，供国内用户播放） */
function gttsChunk(text) {
  return new Promise(function (resolve, reject) {
    const gurl = 'https://translate.googleapis.com/translate_tts?ie=UTF-8&client=tw-ob&tl=zh-CN&q=' + encodeURIComponent(text);
    const rq = https.get(gurl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://translate.google.com/' } }, function (r) {
      if (r.statusCode !== 200) { r.resume(); reject(new Error('tts ' + r.statusCode)); return; }
      const c = []; r.on('data', function (x) { c.push(x); }); r.on('end', function () { resolve(Buffer.concat(c)); });
    });
    rq.on('error', reject);
  });
}
function ttsProxy(text) {
  const chunks = [];
  for (let i = 0; i < text.length; i += 180) chunks.push(text.slice(i, i + 180));
  return (async function () {
    const parts = [];
    for (const c of chunks) { parts.push(await gttsChunk(c)); await new Promise(function (r) { setTimeout(r, 130); }); }
    return Buffer.concat(parts);
  })();
}
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.apk': 'application/vnd.android.package-archive' };
const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
  const url = req.url.split('?')[0];

  /* ---- 在线朗读 TTS（公开） ---- */
  if (url === '/api/tts') {
    const raw = (req.url.split('?')[1] || '').replace(/^text=/, '');
    const text = (decodeURIComponent(raw.replace(/\+/g, '%20')) || '').trim();
    if (!text) { json(res, { ok: false, msg: 'no text' }); return; }
    ttsProxy(text).then(function (buf) {
      if (!buf.length) { json(res, { ok: false, msg: 'empty audio' }); return; }
      res.writeHead(200, Object.assign({}, CORS, { 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length, 'Cache-Control': 'no-store' }));
      res.end(buf);
    }).catch(function (e) { json(res, { ok: false, msg: String((e && e.message) || e) }); });
    return;
  }

  /* ---- 管理后台页 ---- */
  if (url === '/admin' || url === '/admin/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(ADMIN_HTML); return; }

  /* ---- 静态 APK 下载 ---- */
  if (url.startsWith('/apk/')) {
    let name = path.basename(url);
    try { name = decodeURIComponent(name); } catch (e) {}
    const file = path.join(APK_DIR, name);
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
      json(res, { ok: true, checkins: DATA.checkins.slice(-200).reverse(), visits: DATA.visits.slice(-300).reverse(), ips, version: DATA.version, card: { total: DATA.cardkeys.length, used: DATA.cardkeys.filter(k => k.status === 'used').length }, settings: DATA.settings, announcement: DATA.announcement });
      return;
    }
    /* 保存版本信息（管理） */
    if (url === '/api/update') {
      if (!isAdmin(req)) return json(res, { ok: false, msg: '未授权' }, 401);
      let o = {}; try { o = JSON.parse(buf.toString()); } catch (e) {}
      if (o.v) DATA.version.v = String(o.v).trim();
      if (typeof o.n !== 'undefined') DATA.version.note = String(o.n);
      if (typeof o.push !== 'undefined') DATA.version.push = !!o.push;
      DATA.version.time = Date.now();
      save(); json(res, { ok: true }); return;
    }
    /* 上传APK（管理，raw body = APK字节；可带 x-ver 同步新版本号） */
    if (url === '/api/upload') {
      if (!isAdmin(req)) return json(res, { ok: false, msg: '未授权' }, 401);
      const name = req.headers['x-fname'] || ('update_' + Date.now() + '.apk');
      const safe = path.basename(String(name));
      fs.writeFileSync(path.join(APK_DIR, safe), buf);
      const ver = req.headers['x-ver'];
      if (ver && String(ver).trim()) DATA.version.v = String(ver).trim();
      DATA.version.apkUrl = req.headers.host ? 'http://' + req.headers.host + '/apk/' + safe : '/apk/' + safe;
      DATA.version.time = Date.now();
      save(); json(res, { ok: true, apkUrl: DATA.version.apkUrl, v: DATA.version.v }); return;
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
    if (url === '/api/version') {
      let apkName = '';
      try {
        const files = fs.readdirSync(APK_DIR).filter(function (f) { return f.toLowerCase().endsWith('.apk'); });
        if (files.length) {
          apkName = files.map(function (f) { return { f: f, t: fs.statSync(path.join(APK_DIR, f)).mtimeMs }; }).sort(function (a, b) { return b.t - a.t; })[0].f;
        }
      } catch (e) {}
      const v = DATA.version || {};
      const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
      const host = req.headers.host || 'yufeng-security-backend.onrender.com';
      json(res, { ok: true, version: { v: v.v || '1.0', note: v.note || '', push: v.push !== false, apkUrl: apkName ? (proto + '://' + host + '/apk/' + encodeURIComponent(apkName)) : '' } });
      return;
    }

    /* 公开配置：设置 + 公告 + 版本（App 启动拉取，用于停用旧版+更新提示） */
    if (url === '/api/config') {
      const apkName = fs.existsSync(APK_DIR) && fs.readdirSync(APK_DIR).filter(f => f.endsWith('.apk')).sort().slice(-1)[0];
      const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
      const host = req.headers.host || 'yufeng-security-backend.onrender.com';
      json(res, {
        ok: true, settings: DATA.settings, announcement: DATA.announcement,
        version: { v: DATA.version.v || '1.0', note: DATA.version.note || '', push: DATA.version.push !== false, apkUrl: apkName ? (proto + '://' + host + '/apk/' + encodeURIComponent(apkName)) : (DATA.version.apkUrl || '') }
      }); return;
    }

    /* 卡密验证（App）—— 一机一码：每个卡密只能绑定一台设备 */
    if (url === '/api/verify') {
      let o = {}; try { o = JSON.parse(buf.toString()); } catch (e) {}
      if (!DATA.settings.requireCard) { json(res, { ok: true, msg: '无需卡密' }); return; }
      const code = String(o.code || '').trim().toUpperCase();
      const dev = String(o.device || '未知设备').slice(0, 64);
      if (!code) return json(res, { ok: false, msg: '请输入卡密' });
      const k = DATA.cardkeys.find(x => x.code === code);
      if (!k) return json(res, { ok: false, msg: '卡密不存在' });
      if (k.status === 'used') {
        /* 同一台设备再次验证（如清缓存重装后）：放行 */
        if (k.bindDev && k.bindDev === dev) { json(res, { ok: true, msg: '已验证' }); return; }
        if (!k.bindDev) return json(res, { ok: false, msg: '该卡密已被使用' });
        return json(res, { ok: false, msg: '该卡密已绑定其他设备（一机一码），无法在本机使用' });
      }
      k.status = 'used'; k.bindDev = dev; k.usedBy = dev; k.usedAt = Date.now();
      save(); json(res, { ok: true, msg: '激活成功' }); return;
    }

    /* 卡密管理（管理） */
    if (url === '/api/cardkeys/gen') {
      if (!isAdmin(req)) return json(res, { ok: false, msg: '未授权' }, 401);
      let o = {}; try { o = JSON.parse(buf.toString()); } catch (e) {}
      const n = Math.min(parseInt(o.n) || 1, 1000);
      const AL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; const arr = [];
      for (let i = 0; i < n; i++) { let s = ''; while (s.length < 16) s += AL[crypto.randomInt(AL.length)]; arr.push(s.slice(0, 4) + '-' + s.slice(4, 8) + '-' + s.slice(8, 12) + '-' + s.slice(12, 16)); }
      arr.forEach(c => DATA.cardkeys.push({ code: c, status: 'unused', usedBy: '', usedAt: 0, createdAt: Date.now() }));
      save(); json(res, { ok: true, codes: arr }); return;
    }
    if (url === '/api/cardkeys/custom') {
      if (!isAdmin(req)) return json(res, { ok: false, msg: '未授权' }, 401);
      let o = {}; try { o = JSON.parse(buf.toString()); } catch (e) {}
      const list = String(o.codes || '').split(/[\s,;\n]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
      const dup = [];
      list.forEach(c => { if (DATA.cardkeys.find(x => x.code === c)) dup.push(c); else DATA.cardkeys.push({ code: c, status: 'unused', usedBy: '', usedAt: 0, createdAt: Date.now() }); });
      save(); json(res, { ok: true, added: list.length - dup.length, dup }); return;
    }
    if (url === '/api/cardkeys/list') {
      if (!isAdmin(req)) return json(res, { ok: false, msg: '未授权' }, 401);
      json(res, { ok: true, keys: DATA.cardkeys.slice().reverse().slice(0, 2000) }); return;
    }
    if (url === '/api/cardkeys/del') {
      if (!isAdmin(req)) return json(res, { ok: false, msg: '未授权' }, 401);
      let o = {}; try { o = JSON.parse(buf.toString()); } catch (e) {}
      DATA.cardkeys = DATA.cardkeys.filter(x => x.code !== String(o.code || '').trim().toUpperCase());
      save(); json(res, { ok: true }); return;
    }

    /* 公告（管理：编辑发布） */
    if (url === '/api/announcement') {
      if (!isAdmin(req)) return json(res, { ok: false, msg: '未授权' }, 401);
      let o = {}; try { o = JSON.parse(buf.toString()); } catch (e) {}
      DATA.announcement = { title: String(o.title || '').slice(0, 80), content: String(o.content || '').slice(0, 2000), on: !!o.on, updatedAt: Date.now() };
      save(); json(res, { ok: true }); return;
    }

    /* UI 设置（管理） */
    if (url === '/api/settings') {
      if (!isAdmin(req)) return json(res, { ok: false, msg: '未授权' }, 401);
      let o = {}; try { o = JSON.parse(buf.toString()); } catch (e) {}
      if (typeof o.appName === 'string' && o.appName.trim()) DATA.settings.appName = o.appName.trim().slice(0, 20);
      if (typeof o.primary === 'string' && /^#[0-9a-fA-F]{6}$/.test(o.primary)) DATA.settings.primary = o.primary;
      if (typeof o.requireCard === 'boolean') DATA.settings.requireCard = o.requireCard;
      save(); json(res, { ok: true, settings: DATA.settings }); return;
    }

    json(res, { ok: false, msg: '未知接口' }, 404);
  });
});
loadPG(function(){
  server.listen(PORT, () => {
    console.log('誉峰保安刷题 管理后端已启动');
    console.log('端口：' + PORT);
    console.log('管理后台：http://<服务器地址>:' + PORT + '/admin');
    console.log('管理密码：' + ADMIN_PASS + '（请在 server.js 里改成自己的）');
  });
});
