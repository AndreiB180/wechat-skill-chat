// ---- State ----
let skills = [];
let currentChat = null;
let histories = {};
let editingContact = null;

// ---- Init ----
async function init() {
  skills = await fetch('/api/config').then(r=>r.json());
  // Preload all histories
  await Promise.all(skills.map(async s => {
    const res = await fetch('/api/history/'+s.id);
    histories[s.id] = await res.json();
  }));
  renderAll();
  // Load settings
  _populateSettingsUI(await fetch('/api/settings').then(r=>r.json()));
}

function renderAll() {
  renderChatList();
  renderContactsDetail();
}

// ---- Navigation ----
function switchNav(tab) {
  document.querySelectorAll('.nav-icon').forEach(el=>el.classList.remove('active'));
  document.getElementById('nav-'+tab).classList.add('active');

  document.getElementById('list-chat').style.display = (tab==='chat')?'flex':'none';
  document.getElementById('chat-area').style.display = (tab==='chat')?'flex':'none';
  document.getElementById('contacts-panel').classList.toggle('show', tab==='contacts');
  document.getElementById('settings-panel').classList.toggle('show', tab==='settings');

  if (tab==='settings') loadSettingsToUI();
}

function openSettings() { switchNav('settings'); }

function _populateSettingsUI(s) {
  if (s.api_key) document.getElementById('sp-api-key').value = s.api_key;
  if (s.base_url) document.getElementById('sp-base-url').value = s.base_url;
  if (s.model) document.getElementById('sp-model').value = s.model;
  if (s.my_avatar) {
    document.getElementById('my-avatar-img').src = s.my_avatar;
    document.getElementById('sp-avatar-img').src = s.my_avatar;
    document.getElementById('sp-avatar-url').value = s.my_avatar;
  }
  if (s.nickname) document.getElementById('sp-nickname').value = s.nickname;
  // Mode & Claude CLI
  if (s.mode) document.getElementById('sp-mode').value = s.mode;
  if (s.claude_cli) document.getElementById('sp-claude-cli').value = s.claude_cli;
  if (s.permission_mode) document.getElementById('sp-permission-mode').value = s.permission_mode;
  if (s.add_dirs) document.getElementById('sp-add-dirs').value = s.add_dirs;
  onModeChange();
}

async function loadSettingsToUI() {
  _populateSettingsUI(await fetch('/api/settings').then(r=>r.json()));
}

async function saveSettings() {
  const nickname = document.getElementById('sp-nickname').value.trim();
  const apiKey = document.getElementById('sp-api-key').value.trim();
  const baseUrl = document.getElementById('sp-base-url').value.trim();
  const model = document.getElementById('sp-model').value.trim();
  const avatarUrl = document.getElementById('sp-avatar-url').value.trim();
  const mode = document.getElementById('sp-mode').value;
  const claudeCli = document.getElementById('sp-claude-cli').value.trim();
  const permMode = document.getElementById('sp-permission-mode').value;
  const addDirs = document.getElementById('sp-add-dirs').value.trim();
  await fetch('/api/settings', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({nickname, api_key: apiKey, base_url: baseUrl, model: model, my_avatar: avatarUrl, mode: mode, claude_cli: claudeCli, permission_mode: permMode, add_dirs: addDirs})
  });
  // Update all avatar displays
  if (avatarUrl) {
    document.getElementById('my-avatar-img').src = avatarUrl;
    document.getElementById('sp-avatar-img').src = avatarUrl;
  }
  document.getElementById('sp-saved').style.display = 'inline';
  setTimeout(()=>document.getElementById('sp-saved').style.display='none', 2000);
}

function onModeChange() {
  const mode = document.getElementById('sp-mode').value;
  const group = document.getElementById('sp-claude-group');
  if (group) group.style.display = mode === 'claude' ? 'block' : 'none';
}

async function checkClaudeCLI() {
  const cliPath = document.getElementById('sp-claude-cli').value.trim() || 'ccb';
  const statusEl = document.getElementById('sp-claude-status');
  statusEl.textContent = '正在检测...';
  statusEl.style.color = '#888';
  try {
    const res = await fetch('/api/settings/check_claude', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({claude_cli: cliPath})
    });
    const d = await res.json();
    if (d.ok) {
      statusEl.textContent = '✓ ' + d.version;
      statusEl.style.color = '#07C160';
    } else {
      statusEl.textContent = '✗ ' + d.version;
      statusEl.style.color = '#FA5151';
    }
  } catch(e) {
    statusEl.textContent = '✗ 检测失败';
    statusEl.style.color = '#FA5151';
  }
}

async function shutdownServer() {
  if (!confirm('确定登出并关闭服务器？')) return;
  try { await fetch('/api/shutdown', {method:'POST'}); } catch(e) {}
  document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-size:18px;color:#888;font-family:sans-serif">服务器已关闭，可以关闭此页面。</div>';
}

// ---- Chat List (sorted by last message time) ----
function renderChatList() {
  const list = document.getElementById('chat-contact-list');
  list.innerHTML = '';

  // Sort skills by last message timestamp
  const sorted = skills.map(s => {
    const h = histories[s.id] || [];
    const lastTs = h.length>0 ? h[h.length-1].timestamp||0 : 0;
    return {...s, lastTs};
  }).sort((a,b)=>b.lastTs - a.lastTs);

  sorted.forEach(s => {
    const div = document.createElement('div');
    div.className = 'contact-item';
    if (currentChat===s.id) div.classList.add('active');
    div.onclick = ()=>openChat(s.id);
    div.id = 'item-'+s.id;
    const h = histories[s.id]||[];
    const lastMsg = h.length>0 ? h[h.length-1].content.substring(0,30) : (s.default_note||'');
    const lastTs = h.length>0 ? (h[h.length-1].timestamp||0) : 0;
    const lastTime = lastTs ? fmtContactTime(lastTs) : '';
    div.innerHTML = `
      <div class="c-avatar"><img src="${s.avatar}" onerror="this.style.background='#ddd';this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 38 38%22%3E%3Ccircle cx=%2219%22 cy=%2213%22 r=%228%22 fill=%22%23ccc%22/%3E%3Cellipse cx=%2219%22 cy=%2233%22 rx=%2212%22 ry=%229%22 fill=%22%23ccc%22/%3E%3C/svg%3E'"></div>
      <div class="c-info"><div class="c-name">${escapeHtml(s.name)}</div><div class="c-msg">${escapeHtml(lastMsg)}</div></div>
      <div class="c-time">${lastTime}</div>
    `;
    list.appendChild(div);
  });
}

function filterChatList(query) {
  const items = document.querySelectorAll('#chat-contact-list .contact-item');
  items.forEach(item => {
    const name = item.querySelector('.c-name').textContent.toLowerCase();
    item.style.display = name.includes(query.toLowerCase()) ? 'flex' : 'none';
  });
}

// ---- Contacts Detail Panel ----
function renderContactsDetail() {
  const container = document.getElementById('contacts-detail-list');
  container.innerHTML = '';
  skills.forEach(s => {
    const div = document.createElement('div');
    div.className = 'cp-item';
    div.innerHTML = `
      <div class="cp-avatar"><img src="${s.avatar}" onerror="this.style.background='#ddd'"></div>
      <span class="cp-name" onclick="openEditModal('${s.id}')">${escapeHtml(s.name)}</span>
      <span class="cp-action" onclick="clearContactHistory('${s.id}')">清空聊天</span>
      <span class="cp-action" onclick="clearCCSession('${s.id}')">清空Session</span>
      <span class="cp-del" onclick="deleteSkill('${s.id}')">删除</span>
    `;
    container.appendChild(div);
  });
}

async function clearContactHistory(skillId) {
  if (!confirm('清空该联系人的聊天记录？')) return;
  await fetch('/api/clear/'+skillId, {method:'POST'});
  delete histories[skillId];
  if (currentChat===skillId) { openChat(skillId); }
  renderAll();
}

async function clearCCSession(skillId) {
  if (!confirm('清空 CC Session？下次发消息将创建新会话。')) return;
  await fetch('/api/clear_session/'+skillId, {method:'POST'});
}

async function deleteSkill(skillId) {
  if (!confirm('确定删除该 Skill 及其所有聊天记录？')) return;
  await fetch('/api/delete_skill/'+skillId, {method:'POST'});
  skills = skills.filter(s=>s.id!==skillId);
  delete histories[skillId];
  if (currentChat===skillId) {
    currentChat = null;
    document.getElementById('chat-area').innerHTML = '<div class="no-chat">选择一个聊天开始</div>';
  }
  renderAll();
}

// ---- Import Skill ----
function openImportModal() {
  document.getElementById('import-modal').classList.add('show');
  document.getElementById('import-error').style.display = 'none';
  document.getElementById('import-path').value = '';
}
function closeImportModal() { document.getElementById('import-modal').classList.remove('show'); }

async function importSkill() {
  const path = document.getElementById('import-path').value.trim();
  const errEl = document.getElementById('import-error');
  if (!path) { errEl.textContent='请输入文件夹路径'; errEl.style.display='block'; return; }

  const res = await fetch('/api/import_skill', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({path})
  });
  const data = await res.json();
  if (data.error) {
    errEl.textContent = data.error;
    errEl.style.display = 'block';
  } else {
    skills.push(data.skill);
    renderAll();
    closeImportModal();
  }
}

// ---- Chat ----
async function openChat(skillId) {
  _attachedFiles = [];
  currentChat = skillId; currentGroup = null;
  if (!histories[skillId]) {
    histories[skillId] = await fetch('/api/history/'+skillId).then(r=>r.json());
  }
  const contact = skills.find(s=>s.id===skillId);
  const avatar = contact?contact.avatar:'';

  const chatArea = document.getElementById('chat-area');
  chatArea.innerHTML = `
    <div class="chat-header" onclick="openEditModal('${skillId}')" title="点击修改备注和头像">
      <div class="ch-name">${contact?contact.name:skillId}</div>
    </div>
    <div class="chat-messages" id="msg-container"></div>
    ${_toolbarHTML()}
    <div class="chat-input-box" style="position:relative">
      <div class="emoji-picker" id="emoji-picker"></div>
      <textarea id="msg-input" placeholder="输入消息..." onkeydown="_keyHandler(event, sendMessage)"></textarea>
      <button class="send-btn" id="send-btn" onclick="sendMessage()">发送</button>
    </div>
    <div class="call-popup-overlay" id="call-popup-overlay" onclick="closeCallPopup()">
      <div class="call-popup">你走火入魔了，还真想给ai打电话啊？</div>
    </div>
  `;
  buildEmojiPicker();
  renderMessages(skillId);
  renderChatList();
  _setupResizeDrag();
}

// ---- WeChat Emoji PNGs ----
function emojiImg(code, dir) {
  // WeChat-style: most emojis render at 18px, but text-like codes ("Emm", "666") are narrower at 15px
  const size = code==='Emm'||code==='666'?15:18;
  return `<img src="/emoji/${dir}/${code}.png" style="width:${size}px;height:${size}px;vertical-align:middle" title="[${code}]">`;
}
// Build lookup at init
let _emojiLookup = {};
let _enToCn = {};
function buildEmojiLookup() {
  // All codes from the downloaded PNGs, mapped to their directories
  const map = {};
  // face/
  '666 Emm 亲亲 偷笑 傲慢 再见 加油 发呆 发怒 可怜 右哼哼 叹气 吃瓜 吐 呲牙 咒骂 哇 嘘 嘿哈 囧 困 坏笑 大哭 天啊 失望 奸笑 好的 委屈 害羞 尴尬 得意 微笑 快哭了 恐惧 悠闲 惊恐 惊讶 愉快 憨笑 打脸 抓狂 抠鼻 捂脸 撇嘴 擦汗 敲打 无语 旺柴 晕 机智 汗 流泪 生病 疑问 白眼 皱眉 睡 破涕为笑 社会社会 笑脸 翻白眼 耶 脸红 色 苦涩 衰 裂开 让我看看 调皮 鄙视 闭嘴 阴险 难过 骷髅 鼓掌'.split(' ').forEach(c=>{map[c]='face';});
  // gesture/
  'OK 勾引 合十 弱 强 抱拳 拥抱 拳头 握手 胜利'.split(' ').forEach(c=>{map[c]='gesture';});
  // animal/
  '发抖 猪头 跳跳 转圈'.split(' ').forEach(c=>{map[c]='animal';});
  // blessing/
  '庆祝 烟花 爆竹 發 礼物 福 红包'.split(' ').forEach(c=>{map[c]='blessing';});
  // other/
  '便便 凋谢 咖啡 啤酒 嘴唇 太阳 心碎 月亮 炸弹 爱心 玫瑰 菜刀 蛋糕'.split(' ').forEach(c=>{map[c]='other';});
  _emojiLookup = map;
  // English -> Chinese aliases (separate from directory lookup to get correct filenames)
  _enToCn = {
    'Smile':'微笑','Grimace':'撇嘴','Drool':'色','Scowl':'发呆','CoolGuy':'得意','Sob':'流泪','Shy':'害羞','Silent':'闭嘴','Sleep':'睡','Cry':'大哭','Awkward':'尴尬','Angry':'发怒','Tongue':'调皮','Grin':'呲牙','Surprise':'惊讶','Frown':'难过','Ruthless':'酷','Blush':'冷汗','Scream':'抓狂','Puke':'吐','Chuckle':'偷笑','Joyful':'可爱','Slight':'白眼','Smug':'傲慢','Hungry':'饥饿','Drowsy':'困','Panic':'惊恐','Sweat':'流汗','Laugh':'憨笑','Commando':'大兵','Determined':'奋斗','Scold':'咒骂','Shocked':'疑问','Shhh':'嘘','Dizzy':'晕','Tormented':'折磨','Toasted':'衰','Skull':'骷髅','Hammer':'敲打','Bye':'再见','Speechless':'无语','NosePick':'抠鼻','Clap':'鼓掌','Embarrassed':'糗大了','Trick':'坏笑','Yawn':'哈欠','Shrunken':'委屈','TearUp':'快哭了','Sly':'阴险','Kiss':'亲亲','Startled':'吓','Whimper':'可怜','Knife':'菜刀','Watermelon':'西瓜','Beer':'啤酒','Basketball':'篮球','PingPong':'乒乓','Coffee':'咖啡','Rice':'饭','Pig':'猪头','Rose':'玫瑰','Wilt':'凋谢','LipService':'示爱','Heart':'爱心','HeartBroken':'心碎','Cake':'蛋糕','Lightning':'闪电','Bomb':'炸弹','Soccer':'足球','Ladybug':'瓢虫','Poop':'便便','Moon':'月亮','Sun':'太阳','Gift':'礼物','Hug':'拥抱','Strong':'强','Weak':'弱','Shake':'握手','Victory':'胜利','Fist':'抱拳','Beckon':'勾引','FistPump':'拳头','Inferior':'差劲','Love':'爱你','No':'NO','InLove':'爱情','BlowKiss':'飞吻','Waddle':'跳跳','Tremble':'发抖','Aaagh！':'怄火','Twirl':'转圈','Kowtow':'磕头','LookBack':'回头','JumpRope':'跳绳','Surrender':'投降','Excited':'激动','Hooray':'乱舞','OfferLove':'献吻','Hey':'嘿哈','Facepalm':'捂脸','Smart':'奸笑','Witty':'机智','BrowFrown':'皱眉','Yeah':'耶','Packet':'红包','Chicken':'鸡',
  };
}
buildEmojiLookup();
function renderEmoji(text) {
  return text.replace(/\[([^\]]+)\]/g, (match, code) => {
    // Resolve English alias -> Chinese code for correct image filename
    const cn=_enToCn[code];
    const lookup=cn||code;
    const dir=_emojiLookup[lookup];
    if(dir)return emojiImg(lookup,dir);
    // Emoji variants may have numeric suffix (e.g. "捂脸2"), strip trailing digit to match base name
    const bare=code.replace(/[2-9]$/,'');
    const cn2=_enToCn[bare];
    const lookup2=cn2||bare;
    const dir2=_emojiLookup[lookup2];
    if(dir2)return emojiImg(lookup2,dir2);
    return match;
  });
}

// ---- Emoji Picker ----
function buildEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  if (!picker) return;
  picker.innerHTML = '';
  const codes = ['微笑','撇嘴','色','发呆','得意','流泪','害羞','闭嘴','睡','大哭','尴尬','发怒','调皮','呲牙','惊讶','难过','酷','冷汗','抓狂','吐','偷笑','可爱','白眼','傲慢','饥饿','困','惊恐','流汗','憨笑','大兵','奋斗','咒骂','疑问','嘘','晕','折磨','衰','骷髅','敲打','再见','擦汗','抠鼻','鼓掌','糗大了','坏笑','左哼哼','右哼哼','哈欠','鄙视','委屈','快哭了','阴险','亲亲','吓','可怜','菜刀','西瓜','啤酒','篮球','乒乓','咖啡','饭','猪头','玫瑰','凋谢','示爱','爱心','心碎','蛋糕','闪电','炸弹','刀','足球','瓢虫','便便','月亮','太阳','礼物','拥抱','强','弱','握手','胜利','抱拳','勾引','拳头','差劲','爱你','NO','OK','爱情','飞吻','跳跳','发抖','怄火','转圈','磕头','回头','跳绳','投降','激动','乱舞','献吻','左太极','右太极','嘿哈','捂脸','奸笑','机智','皱眉','耶','红包','鸡'];
  codes.forEach(c => {
    const dir = _emojiLookup[c];
    if (!dir) return;
    const div = document.createElement('div');
    div.className = 'emoji-item';
    div.title = `[${c}]`;
    div.innerHTML = `<img src="/emoji/${dir}/${c}.png">`;
    div.onclick = () => {
      const ta = document.getElementById('msg-input');
      if (ta) {
        ta.value += `[${c}]`;
        ta.focus();
        ta.dispatchEvent(new Event('input'));
      }
    };
    picker.appendChild(div);
  });
}

function toggleEmoji() {
  const p = document.getElementById('emoji-picker');
  if (p) p.classList.toggle('show');
}
// Close emoji picker when clicking outside
document.addEventListener('click', e => {
  const picker = document.getElementById('emoji-picker');
  if (picker && picker.classList.contains('show') && !picker.contains(e.target) && !e.target.closest('.toolbar-btn')) {
    picker.classList.remove('show');
  }
});

let _attachedFiles = []; // [{name, content, mime}]

// Track file input for CC mode path detection
let _lastFileInput = null;

function handleFile(e) {
  // CC mode: use native OS file picker via backend. Hold Option/Alt for folders.
  if (_isClaudeMode()) {
    const folders = !!(e && e.altKey);
    fetch('/api/pick_files', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folders})}).then(r=>r.json()).then(data => {
      const ta = document.getElementById('msg-input');
      if (!ta || !data.paths || !data.paths.length) return;
      ta.value += (ta.value ? '\n' : '') + data.paths.join('\n');
      ta.dispatchEvent(new Event('input'));
    }).catch(e=>console.error('pick_files failed:',e));
    return;
  }

  // API mode: read file contents as base64
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.onchange = () => {
    if (!input.files.length) return;
    const ta = document.getElementById('msg-input');
    Array.from(input.files).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = reader.result.split(',')[1] || reader.result;
        _attachedFiles.push({name: file.name, content: base64, mime: file.type});
        if (ta) {
          const fname = file.name.length > 15 ? file.name.substring(0,12)+'...' : file.name;
          ta.value += `[文件:${fname}]`;
          ta.dispatchEvent(new Event('input'));
        }
      };
      reader.readAsDataURL(file);
    });
  };
  input.click();
}

function handleCall() {
  document.getElementById('call-popup-overlay').classList.add('show');
}
function closeCallPopup() {
  document.getElementById('call-popup-overlay').classList.remove('show');
}

function renderMessages(skillId) {
  const container = document.getElementById('msg-container');
  if (!container) return;
  const history = histories[skillId]||[];
  const contact = skills.find(s=>s.id===skillId);
  const avatar = contact?contact.avatar:'';
  let html='';
  const GAP=300;
  history.forEach((msg,i)=>{
    const ts=msg.timestamp||0;
    const prevTs=i>0?(history[i-1].timestamp||0):0;
    if(i===0||ts-prevTs>GAP){
      const d=new Date(ts*1000);
      const ft = fmtDate(ts, true);
      html+=`<div class="msg-time">${ft}</div>`;
    }
    const isSelf=msg.sender==='user';
    const isSystem=msg.sender==='system';
    if(isSystem && msg._perm){
      html+=`<div class="msg-row"><div class="perm-card">
        <div class="perm-body">${renderEmoji(escapeHtml(msg.content).replace(/\n/g,'<br>'))}</div>
      </div></div>`;
      return;
    }
    if(isSystem){
      html+=`<div class="msg-time">${msg.content}</div>`;
      return;
    }
    html+=`<div class="msg-row ${isSelf?'self':'other'}">`;
    if(!isSelf) html+=`<div class="msg-avatar"><img src="${avatar}" onerror="this.style.background='#ddd'"></div>`;
    html+=`<div class="msg-bubble">${renderEmoji(escapeHtml(msg.content))}</div>`;
    if(isSelf) html+=`<div class="msg-avatar"><img id="my-msg-avatar" src="${document.getElementById('my-avatar-img')?.src||''}"></div>`;
    html+='</div>';
  });
  container.innerHTML=html;
  container.scrollTop=container.scrollHeight;
}

function escapeHtml(t){return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');}

// ---- Smart Timestamp ----
const DAY_NAMES = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
function fmtTime(ts, showTime, compact) {
  // compact: no space between date and time (used in narrow sidebar cards)
  const d = new Date(ts * 1000);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today - target) / 86400000);
  const timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

  let dateStr;
  if (diffDays === 0) dateStr = '';
  else if (diffDays === 1) dateStr = '昨天';
  else if (diffDays < 7) dateStr = DAY_NAMES[d.getDay()];
  else if (d.getFullYear() === now.getFullYear()) dateStr = `${d.getMonth()+1}/${d.getDate()}`;
  else dateStr = `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;

  if (!showTime) return dateStr || timeStr;
  if (!dateStr) return timeStr;
  return compact ? `${dateStr}${timeStr}` : `${dateStr} ${timeStr}`;
}
function fmtDate(ts, showTime) { return fmtTime(ts, showTime, false); }
function fmtContactTime(ts) { return fmtTime(ts, true, true); }

let _ccActive = false;       // true while CC SSE stream is open
let _ccAbortCtrl = null;     // AbortController for current CC fetch

function _isClaudeMode() {
  try { return document.getElementById('sp-mode')?.value === 'claude'; } catch(e) { return false; }
}

async function _stopCC(chatId) {
  if (!_ccActive) return;
  if (_ccAbortCtrl) { _ccAbortCtrl.abort(); _ccAbortCtrl = null; }
  _ccActive = false;
  try { await fetch('/api/stop/'+chatId, {method:'POST'}); } catch(e) {}
  histories[chatId].push({sender:'system',content:'\u24D8 \u5DF2\u505C\u6B62',time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),timestamp:Date.now()/1000});
  if (currentChat===chatId) { renderMessages(chatId); scrollBottom(); }
  renderChatList();
  const btn=document.getElementById('send-btn');
  if (btn) { btn.classList.remove('active'); btn.textContent='\u53D1\u9001'; }
}

async function sendMessage(msgOverride){
  if(!currentChat)return;
  if(_ccActive)return; // CC is processing or waiting for permission — don't interleave
  const input=document.getElementById('msg-input');
  const btn=document.getElementById('send-btn');
  const msg = msgOverride || input.value.trim();
  if(!msg)return;

  const chatId = currentChat;
  const now = Date.now()/1000;

  input.value=''; btn.classList.add('active'); btn.textContent='...';

  if(!histories[chatId]) histories[chatId]=[];
  histories[chatId].push({sender:'user', content:msg, time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}), timestamp:now});
  if(currentChat===chatId) { renderMessages(chatId); scrollBottom(); }
  renderChatList();

  // Abort controller for Ctrl+C
  _ccAbortCtrl = new AbortController();

  try{
    const body = {message:msg};
    if (_attachedFiles.length && !_isClaudeMode()) { body.files = _attachedFiles; }
    _attachedFiles = [];

    const res=await fetch('/api/send/'+chatId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:_ccAbortCtrl.signal});

    // ---- Claude Code mode: SSE stream ----
    if (_isClaudeMode()) {
      if (!res.ok) {
        const err = await res.json().catch(()=>({error:'请求失败'}));
        histories[chatId].push({sender:'bot',content:'[错误] '+(err.error||'请求失败'),time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),timestamp:Date.now()/1000});
        if (currentChat===chatId) renderMessages(chatId);
        return;
      }
      _ccActive = true;
      const reader=res.body.getReader();
      const decoder=new TextDecoder();
      let buf='';
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        buf+=decoder.decode(value,{stream:true});
        const lines=buf.split('\n');
        buf=lines.pop()||'';
        for(const line of lines){
          if(line.startsWith('data: ')){
            const d=JSON.parse(line.slice(6));
            if(d.type==='text'){
              histories[chatId].push({sender:'bot',content:d.content,time:d.time,timestamp:Date.now()/1000});
              if(currentChat===chatId) { renderMessages(chatId); scrollBottom(); }
            } else if(d.type==='tool_use'){
              _showPermCard(chatId, d);
              if(currentChat===chatId) { renderMessages(chatId); scrollBottom(); }
              // CC is now waiting for permission response — user must click approve/deny
            } else if(d.type==='error'){
              histories[chatId].push({sender:'bot',content:'[错误] '+d.content,time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),timestamp:Date.now()/1000});
              if(currentChat===chatId) { renderMessages(chatId); scrollBottom(); }
            }
          }
        }
      }
      _ccActive = false;
      _ccAbortCtrl = null;
      renderChatList();
      if(currentChat===chatId){ btn.classList.remove('active'); btn.textContent='发送'; input.focus(); }
      return;
    }

    // ---- API mode: JSON response ----
    const data=await res.json();
    if(!histories[chatId]) histories[chatId]=[];
    data.responses.forEach(r=>{
      histories[chatId].push({sender:'bot',content:r.content,time:r.time,timestamp:Date.now()/1000});
    });
    if(currentChat===chatId) { renderMessages(chatId); scrollBottom(); }
    renderChatList();
  }catch(e){
    if (e.name==='AbortError') {
      // Ctrl+C: _stopCC already called via keydown handler
      _ccActive = false;
      _ccAbortCtrl = null;
      return;
    }
    console.error(e);
  }
  finally{
    _ccActive = false;
    _ccAbortCtrl = null;
    if(currentChat===chatId){ btn.classList.remove('active'); btn.textContent='发送'; input.focus(); }
  }
}

// ---- Permission card ----
function _showPermCard(chatId, data) {
  const tools = data.tools || [{id: data.id, name: data.name, input: data.input}];
  const ids = tools.map(t => t.id);
  const descs = tools.map(t => _describeTool(t.name, t.input)).join('\n');
  const paused = data.paused;
  histories[chatId].push({
    sender: 'system',
    content: paused ? `\uD83D\uDD27 CC \u9700\u8981\u6279\u51C6\uFF1A\n${descs}` : `\u2699 ${descs}`,
    time: new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),
    timestamp: Date.now()/1000,
    _perm: true, _paused: paused, _toolIds: ids
  });
}






function _describeTool(name, input) {
  const inp = input || {};
  if (name === 'Bash' || name === 'bash') return `\u8FD0\u884C\u547D\u4EE4\uFF1A${inp.command || inp.cmd || '?'}`;
  if (name === 'Read' || name === 'read') return `\u8BFB\u53D6\u6587\u4EF6\uFF1A${inp.file_path || '?'}`;
  if (name === 'Write' || name === 'write') return `\u5199\u5165\u6587\u4EF6\uFF1A${inp.file_path || '?'}`;
  if (name === 'Edit' || name === 'edit') return `\u7F16\u8F91\u6587\u4EF6\uFF1A${inp.file_path || '?'}`;
  if (name === 'WebFetch' || name === 'web_fetch') return `\u8BBF\u95EE\u7F51\u9875\uFF1A${inp.url || '?'}`;
  if (name === 'WebSearch' || name === 'web_search') return `\u641C\u7D22\uFF1A${inp.query || '?'}`;
  if (name === 'Glob' || name === 'glob') return `\u641C\u7D22\u6587\u4EF6\uFF1A${inp.pattern || '?'}`;
  if (name === 'Grep' || name === 'grep') return `\u641C\u7D22\u4EE3\u7801\uFF1A${inp.pattern || '?'}`;
  return `${name}`;
}

function scrollBottom(){
  const mc=document.getElementById('msg-container');
  if(mc) mc.scrollTop=mc.scrollHeight;
}

function _enterKeyHandler(e, sendFn){
  if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();sendFn();}
}

function _keyHandler(e, sendFn) {
  // Ctrl+C: stop CC
  if ((e.ctrlKey||e.metaKey) && e.key==='c' && !e.target.value && _ccActive) {
    e.preventDefault();
    _stopCC(currentChat);
    return;
  }
  _enterKeyHandler(e, sendFn);
}

// Shared toolbar HTML used by both private and group chat
function _toolbarHTML() {
  return `<div class="chat-toolbar">
      <div class="toolbar-btn" title="表情" onclick="event.stopPropagation();toggleEmoji()"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="#666" stroke-width="2"/><circle cx="8.5" cy="10" r="1.5" fill="#666"/><circle cx="15.5" cy="10" r="1.5" fill="#666"/><path d="M8 15c1.5 2 4.5 2 6 0" fill="none" stroke="#666" stroke-width="1.5" stroke-linecap="round"/></svg></div>
      <div class="toolbar-btn" title="文件/文件夹" onclick="handleFile(event)"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" fill="none" stroke="#666" stroke-width="2"/><path d="M14 2v6h6" fill="none" stroke="#666" stroke-width="2"/></svg></div>
      <div class="toolbar-spacer"></div>
      <div class="toolbar-btn" title="语音通话" onclick="handleCall()"><svg viewBox="0 0 24 24"><path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.46.57 3.58a1 1 0 01-.25 1.01l-2.2 2.2z" fill="none" stroke="#666" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div class="toolbar-btn" title="视频通话" onclick="handleCall()"><svg viewBox="0 0 24 24"><rect x="1" y="5" width="15" height="13" rx="2" fill="none" stroke="#666" stroke-width="1.8"/><polygon points="18,7 23,4 23,19 18,16" fill="none" stroke="#666" stroke-width="1.8" stroke-linejoin="round"/></svg></div>
    </div>`;
}

// Shared textarea resize-drag setup
function _setupResizeDrag() {
  setTimeout(()=>{
    const toolbar=document.querySelector('.chat-toolbar');
    const ta=document.getElementById('msg-input');
    if(!toolbar||!ta)return;
    let dragging=false, startY, startH;
    toolbar.addEventListener('mousedown',e=>{
      if(e.offsetY<8){dragging=true;startY=e.clientY;startH=ta.offsetHeight;e.preventDefault();}
    });
    document.addEventListener('mousemove',e=>{
      if(!dragging)return;
      const nh=Math.max(52,Math.min(120,startH-(e.clientY-startY)));
      ta.style.height=nh+'px';
    });
    document.addEventListener('mouseup',()=>{dragging=false;});
    ta.addEventListener('input',()=>{
      const btn=document.getElementById('send-btn');
      if(btn)btn.classList.toggle('active',ta.value.trim().length>0);
    });
  },50);
}

// ---- Edit Contact ----
function openEditModal(skillId){
  editingContact=skillId; _editingGroup=false;
  const contact=skills.find(s=>s.id===skillId);
  document.getElementById('edit-modal-title').textContent='修改备注和头像';
  document.getElementById('edit-name-label').textContent='备注名';
  document.getElementById('edit-name').value=contact?contact.name:'';
  document.getElementById('edit-avatar').value=contact?contact.avatar:'';
  document.getElementById('edit-avatar-group').style.display='block';
  document.getElementById('edit-realname-group').style.display='block';
  document.getElementById('edit-realname').value=contact?(contact.real_name||''):'';
  document.getElementById('edit-modal').classList.add('show');
}
function closeModal(){document.getElementById('edit-modal').classList.remove('show');editingContact=null;_editingGroup=false;}
async function saveContact(){
  if(!editingContact)return;
  const name=document.getElementById('edit-name').value.trim();
  const avatar=document.getElementById('edit-avatar').value.trim();
  await fetch('/api/update_contact/'+editingContact,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,avatar})});
  const contact=skills.find(s=>s.id===editingContact);
  if(contact){if(name)contact.name=name;if(avatar)contact.avatar=avatar;}
  renderAll();
  closeModal();
  if(currentChat===editingContact)openChat(editingContact);
}


// ---- Deleted messages (JSON-backed, persists across server restarts) ----
// Wrapper: temporarily filter out deleted messages before rendering, then restore original array.
function _renderSkipDeleted(store, key, renderFn) {
  if (store[key]) {
    const orig = store[key];
    store[key] = orig.filter(m => !m.deleted);
    renderFn(key);
    store[key] = orig;
  } else {
    renderFn(key);
  }
}

const _origRenderMessages = renderMessages;
renderMessages = function(skillId) { _renderSkipDeleted(histories, skillId, _origRenderMessages); };
// ---- Copy message with emoji as [text] ----
function copyMsgText(bubbleEl) {
  let text = '';
  bubbleEl.childNodes.forEach(n => {
    if (n.nodeType === 3) { text += n.textContent; }
    else if (n.tagName === 'IMG') { text += n.title || ''; }
    else if (n.nodeType === 1) { text += copyMsgText(n); }
  });
  return text;
}

// ---- Right-click context menu on messages ----
let _ctxMenu = null;
function hideCtxMenu() { if (_ctxMenu) { _ctxMenu.remove(); _ctxMenu = null; } }
document.addEventListener('click', hideCtxMenu);
document.addEventListener('contextmenu', function(e) {
  const bubble = e.target.closest('.msg-bubble');
  if (!bubble) { hideCtxMenu(); return; }
  const row = bubble.closest('.msg-row');
  if (!row) return;
  hideCtxMenu();
  e.preventDefault();

  // Find message index in the current chat
  const container = document.getElementById('msg-container');
  if (!container) return;
  const rows = Array.from(container.querySelectorAll('.msg-row'));
  const msgIdx = rows.indexOf(row);
  if (msgIdx < 0) return;
  // Map visual row index back to original history index (counting non-deleted messages)
  const isGroup = !!currentGroup;
  const chatId = isGroup ? currentGroup : currentChat;
  const history = isGroup ? (groupHistories[chatId] || []) : (histories[chatId] || []);
  let origIdx = -1, visibleCount = 0;
  for (let i = 0; i < history.length; i++) {
    if (history[i].deleted || history[i].sender === 'system') continue;
    if (visibleCount === msgIdx) { origIdx = i; break; }
    visibleCount++;
  }
  if (origIdx < 0) return;

  const menu = document.createElement('div');
  menu.className = 'msg-context-menu';
  menu.style.top = e.clientY + 'px';
  menu.style.left = e.clientX + 'px';
  menu.innerHTML = `<div class="ctx-item" id="ctx-copy">复制</div><div class="ctx-item" id="ctx-del">删除</div>`;
  menu.querySelector('#ctx-copy').onclick = () => {
    const txt = copyMsgText(bubble);
    navigator.clipboard.writeText(txt).catch(() => {});
    hideCtxMenu();
  };
  menu.querySelector('#ctx-del').onclick = async () => {
    history[origIdx].deleted = true;
    const url = isGroup ? `/api/groups/${chatId}/delete_message` : `/api/history/${chatId}/delete`;
    await fetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({index:origIdx})});
    if (isGroup) renderGroupChat(chatId);
    else renderMessages(chatId);
    hideCtxMenu();
  };
  document.body.appendChild(menu);
  _ctxMenu = menu;
  // Prevent menu going off-screen
  const mr = menu.getBoundingClientRect();
  if (mr.right > window.innerWidth) menu.style.left = (e.clientX - mr.width) + 'px';
  if (mr.bottom > window.innerHeight) menu.style.top = (e.clientY - mr.height) + 'px';
});

// ---- Drag-and-drop avatar upload ----
function _setupAvatarDrop(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('avatar-drop-active'); });
  el.addEventListener('dragleave', () => el.classList.remove('avatar-drop-active'));
  el.addEventListener('drop', async e => {
    e.preventDefault(); el.classList.remove('avatar-drop-active');
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    const fd = new FormData(); fd.append('file', file);
    try {
      const res = await fetch('/api/upload_avatar', { method: 'POST', body: fd });
      const d = await res.json();
      if (d.ok && d.path) {
        el.value = d.path;
        el.dispatchEvent(new Event('input'));
      }
    } catch(ex) { console.error(ex); }
  });
}
// After DOM ready, bind to avatar inputs
setTimeout(() => { _setupAvatarDrop('sp-avatar-url'); _setupAvatarDrop('edit-avatar'); }, 100);

// init() is called at the end of group-chat.js — after all overrides are in place
