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
  const s = await fetch('/api/settings').then(r=>r.json());
  if (s.api_key) document.getElementById('sp-api-key').value = s.api_key;
  if (s.base_url) document.getElementById('sp-base-url').value = s.base_url;
  if (s.model) document.getElementById('sp-model').value = s.model;
  if (s.my_avatar) {
    document.getElementById('my-avatar-img').src = s.my_avatar;
    document.getElementById('sp-avatar-img').src = s.my_avatar;
    document.getElementById('sp-avatar-url').value = s.my_avatar;
  }
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

async function loadSettingsToUI() {
  const s = await fetch('/api/settings').then(r=>r.json());
  if (s.api_key) document.getElementById('sp-api-key').value = s.api_key;
  if (s.base_url) document.getElementById('sp-base-url').value = s.base_url;
  if (s.model) document.getElementById('sp-model').value = s.model;
  if (s.my_avatar) document.getElementById('sp-avatar-url').value = s.my_avatar||'';
}

async function saveSettings() {
  const apiKey = document.getElementById('sp-api-key').value.trim();
  const baseUrl = document.getElementById('sp-base-url').value.trim();
  const model = document.getElementById('sp-model').value.trim();
  const avatarUrl = document.getElementById('sp-avatar-url').value.trim();
  await fetch('/api/settings', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({api_key: apiKey, base_url: baseUrl, model: model, my_avatar: avatarUrl})
  });
  // Update all avatar displays
  if (avatarUrl) {
    document.getElementById('my-avatar-img').src = avatarUrl;
    document.getElementById('sp-avatar-img').src = avatarUrl;
  }
  document.getElementById('sp-saved').style.display = 'inline';
  setTimeout(()=>document.getElementById('sp-saved').style.display='none', 2000);
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
      <div class="c-info"><div class="c-name">${s.name}</div><div class="c-msg">${escapeHtml(lastMsg)}</div></div>
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
      <span class="cp-name" onclick="openEditModal('${s.id}')">${s.name}</span>
      <span class="cp-del" onclick="deleteSkill('${s.id}')">删除</span>
    `;
    container.appendChild(div);
  });
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
  _attachedFiles = []; // reset file attachments on chat switch
  currentChat = skillId;
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
    <div class="chat-toolbar">
      <div class="toolbar-btn" title="表情" onclick="event.stopPropagation();toggleEmoji()">
        <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="#666" stroke-width="2"/><circle cx="8.5" cy="10" r="1.5" fill="#666"/><circle cx="15.5" cy="10" r="1.5" fill="#666"/><path d="M8 15c1.5 2 4.5 2 6 0" fill="none" stroke="#666" stroke-width="1.5" stroke-linecap="round"/></svg>
      </div>
      <div class="toolbar-btn" title="文件" onclick="handleFile()">
        <svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" fill="none" stroke="#666" stroke-width="2"/><path d="M14 2v6h6" fill="none" stroke="#666" stroke-width="2"/></svg>
      </div>
      <div class="toolbar-spacer"></div>
      <div class="toolbar-btn" title="语音通话" onclick="handleCall()">
        <svg viewBox="0 0 24 24"><path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.46.57 3.58a1 1 0 01-.25 1.01l-2.2 2.2z" fill="none" stroke="#666" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="toolbar-btn" title="视频通话" onclick="handleCall()">
        <svg viewBox="0 0 24 24"><rect x="1" y="5" width="15" height="13" rx="2" fill="none" stroke="#666" stroke-width="1.8"/><polygon points="18,7 23,4 23,19 18,16" fill="none" stroke="#666" stroke-width="1.8" stroke-linejoin="round"/></svg>
      </div>
    </div>
    <div class="chat-input-box" style="position:relative">
      <div class="emoji-picker" id="emoji-picker"></div>
      <textarea id="msg-input" placeholder="输入消息..." onkeydown="handleKey(event)"></textarea>
      <button class="send-btn" id="send-btn" onclick="sendMessage()">发送</button>
    </div>
    <div class="call-popup-overlay" id="call-popup-overlay" onclick="closeCallPopup()">
      <div class="call-popup">你走火入魔了，还真想给ai打电话啊？</div>
    </div>
  `;
  buildEmojiPicker();

  renderMessages(skillId);
  renderChatList();
  // Resize drag on toolbar top border
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

// ---- WeChat Emoji PNGs ----
function emojiImg(code, dir) {
  const size = code==='Emm'||code==='666'?15:18;
  return `<img src="/emoji/${dir}/${code}.png" style="width:${size}px;height:${size}px;vertical-align:middle" title="[${code}]">`;
}
// Build lookup at init
let _emojiLookup = {};
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
}
buildEmojiLookup();
function renderEmoji(text) {
  return text.replace(/\[([^\]]+)\]/g, (match, code) => {
    const dir = _emojiLookup[code];
    if (dir) return emojiImg(code, dir);
    // Try stripping trailing numbers (like 表情2)
    const bare = code.replace(/2$/,'');
    const dir2 = _emojiLookup[bare];
    if (dir2) return emojiImg(bare, dir2);
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
function handleFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.multiple = true;
  input.onchange = () => {
    if (!input.files.length) return;
    let loaded = 0;
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
        loaded++;
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
function fmtDate(ts, showTime) {
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

  if (showTime) return dateStr ? `${dateStr} ${timeStr}` : timeStr;
  return dateStr || timeStr;
}
function fmtContactTime(ts) {
  const d = new Date(ts * 1000);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diffDays = Math.round((today - target) / 86400000);
  const timeStr = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;

  if (diffDays === 0) return timeStr;
  if (diffDays === 1) return `昨天${timeStr}`;
  if (diffDays < 7) return DAY_NAMES[d.getDay()];
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth()+1}/${d.getDate()}`;
  return `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
}

async function sendMessage(msgOverride){
  if(!currentChat)return;
  const input=document.getElementById('msg-input');
  const btn=document.getElementById('send-btn');
  const msg = msgOverride || input.value.trim();
  if(!msg)return;

  // Capture chat ID at send time for session isolation
  const chatId = currentChat;
  const now = Date.now()/1000;

  input.value=''; btn.classList.add('active'); btn.textContent='...';
  if(btn) btn.classList.remove('active'); // reset green

  // Optimistic UI: show user message immediately (only once)
  if(!histories[chatId]) histories[chatId]=[];
  histories[chatId].push({sender:'user', content:msg, time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}), timestamp:now});
  if(currentChat===chatId) { renderMessages(chatId); scrollBottom(); }
  renderChatList();

  try{
    const body = {message:msg};
    if (_attachedFiles.length) { body.files = _attachedFiles; _attachedFiles = []; }
    const res=await fetch('/api/send/'+chatId,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const data=await res.json();
    // Only append bot responses (user msg already shown optimistically)
    if(!histories[chatId]) histories[chatId]=[];
    data.responses.forEach(r=>{
      histories[chatId].push({sender:'bot',content:r.content,time:r.time,timestamp:Date.now()/1000});
    });
    if(currentChat===chatId) { renderMessages(chatId); scrollBottom(); }
    renderChatList();
  }catch(e){console.error(e);}
  finally{
    if(currentChat===chatId){ btn.classList.remove('active'); btn.textContent='发送'; input.focus(); }
  }
}

function scrollBottom(){
  const mc=document.getElementById('msg-container');
  if(mc) mc.scrollTop=mc.scrollHeight;
}

function handleKey(e){
  if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();sendMessage();}
}

// ---- Edit Contact ----
function openEditModal(skillId){
  editingContact=skillId;
  const contact=skills.find(s=>s.id===skillId);
  document.getElementById('edit-name').value=contact?contact.name:'';
  document.getElementById('edit-avatar').value=contact?contact.avatar:'';
  document.getElementById('edit-modal').classList.add('show');
}
function closeModal(){document.getElementById('edit-modal').classList.remove('show');editingContact=null;}
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

// ---- Group Chat ----
let groups = [];
let currentGroup = null;
let groupHistories = {};

function showAddMenu() {
  const btn = document.getElementById('add-btn-top');
  const rect = btn.getBoundingClientRect();
  const menu = document.createElement('div');
  menu.style.cssText = `position:fixed;top:${rect.bottom+4}px;left:${rect.left-100}px;background:#fff;border:1px solid #D9D9D9;border-radius:4px;box-shadow:0 2px 10px rgba(0,0,0,.1);z-index:300;min-width:120px`;
  menu.innerHTML = `<div style="padding:8px 16px;cursor:pointer;font-size:13px" onmouseover="this.style.background='#F0F0F0'" onmouseout="this.style.background=''" id="mi-grp">发起群聊</div>
    <div style="padding:8px 16px;cursor:pointer;font-size:13px" onmouseover="this.style.background='#F0F0F0'" onmouseout="this.style.background=''" id="mi-add">添加 Skill</div>`;
  menu.querySelector('#mi-grp').onclick = () => { menu.remove(); openCreateGroup(); };
  menu.querySelector('#mi-add').onclick = () => { menu.remove(); openImportModal(); };
  document.body.appendChild(menu);
  setTimeout(() => document.addEventListener('click', function f(e) { if (!menu.contains(e.target) && e.target !== btn) { menu.remove(); document.removeEventListener('click', f); } }, {once: true}), 50);
}

function openCreateGroup() {
  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.3);z-index:400;display:flex;justify-content:center;align-items:center';
  let selected = [];
  overlay.innerHTML = `<div style="display:flex;width:520px;height:380px;background:#fff;border-radius:6px;overflow:hidden">
    <div style="flex:1;display:flex;flex-direction:column;border-right:1px solid #EEE">
      <div style="padding:12px;font-size:14px;font-weight:500;border-bottom:1px solid #EEE">选择联系人</div>
      <div style="flex:1;overflow-y:auto;padding:4px" id="gc-list"></div></div>
    <div style="width:200px;display:flex;flex-direction:column">
      <div style="padding:12px;font-size:13px;color:#888">已选: <span id="gc-cnt">0</span></div>
      <div style="flex:1;overflow-y:auto;padding:4px" id="gc-names"></div>
      <div style="display:flex;border-top:1px solid #EEE">
        <button style="flex:1;padding:10px;border:none;background:#F0F0F0;cursor:pointer;font-size:13px" id="gc-cancel">取消</button>
        <button id="gc-done" style="flex:1;padding:10px;border:none;background:#07C160;color:#fff;cursor:pointer;font-size:13px">完成</button></div></div></div>`;
  document.body.appendChild(overlay);
  const lst = overlay.querySelector('#gc-list');
  skills.forEach(s => {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;align-items:center;padding:6px 10px;cursor:pointer;gap:8px';
    d.innerHTML = `<input type="checkbox" style="width:16px;height:16px"><span style="font-size:13px">${s.name}</span>`;
    d.querySelector('input').onchange = (e) => {
      if (e.target.checked) selected.push(s); else selected = selected.filter(x=>x.id!==s.id);
      overlay.querySelector('#gc-cnt').textContent = selected.length;
      overlay.querySelector('#gc-names').innerHTML = selected.map(x => `<span style="display:inline-block;padding:4px 8px;font-size:12px;background:#E8F5E9;border-radius:3px;margin:2px">${x.name}</span>`).join('');
    };
    lst.appendChild(d);
  });
  overlay.querySelector('#gc-cancel').onclick = () => overlay.remove();
  overlay.querySelector('#gc-done').onclick = async () => {
    if (!selected.length) return;
    const res = await fetch('/api/groups', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({members:selected.map(s=>s.id)})});
    const d = await res.json();
    if (d.ok) {
      groups.push(d.group);
      const names = selected.map(s=>s.name).join('、');
      const nick = document.getElementById('sp-nickname')?.value || '微信用户';
      groupHistories[d.group.id] = [{sender:'system',content:`${nick}邀请${names}加入了群聊`,time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),timestamp:Date.now()/1000}];
      renderAll(); openGroupChat(d.group.id);
    }
    overlay.remove();
  };
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
}

function openGroupChat(gid) {
  currentGroup = gid; currentChat = null;
  if (!groupHistories[gid]) fetch('/api/groups/'+gid+'/history').then(r=>r.json()).then(d=>{groupHistories[gid]=d||[];renderGroupChat(gid);});
  renderGroupChat(gid);
}

function renderGroupChat(gid) {
  const group = groups.find(g=>g.id===gid); if (!group) return;
  const history = groupHistories[gid]||[];
  document.getElementById('chat-area').innerHTML = `<div class="chat-header" style="cursor:pointer"><div class="ch-name" onclick="openGroupRenameModal('${gid}')">${group.name} (${group.members.length+1})</div></div>
    <div class="chat-messages" id="msg-container"></div>
    <div class="chat-toolbar">
      <div class="toolbar-btn" title="表情" onclick="event.stopPropagation();toggleEmoji()"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="#666" stroke-width="2"/><circle cx="8.5" cy="10" r="1.5" fill="#666"/><circle cx="15.5" cy="10" r="1.5" fill="#666"/><path d="M8 15c1.5 2 4.5 2 6 0" fill="none" stroke="#666" stroke-width="1.5" stroke-linecap="round"/></svg></div>
      <div class="toolbar-btn" title="文件" onclick="handleFile()"><svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" fill="none" stroke="#666" stroke-width="2"/><path d="M14 2v6h6" fill="none" stroke="#666" stroke-width="2"/></svg></div>
      <div class="toolbar-spacer"></div>
      <div class="toolbar-btn" title="语音通话" onclick="handleCall()"><svg viewBox="0 0 24 24"><path d="M6.62 10.79a15.05 15.05 0 006.59 6.59l2.2-2.2a1 1 0 011.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 011 1V20a1 1 0 01-1 1A17 17 0 013 4a1 1 0 011-1h3.5a1 1 0 011 1c0 1.25.2 2.46.57 3.58a1 1 0 01-.25 1.01l-2.2 2.2z" fill="none" stroke="#666" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
      <div class="toolbar-btn" title="视频通话" onclick="handleCall()"><svg viewBox="0 0 24 24"><rect x="1" y="5" width="15" height="13" rx="2" fill="none" stroke="#666" stroke-width="1.8"/><polygon points="18,7 23,4 23,19 18,16" fill="none" stroke="#666" stroke-width="1.8" stroke-linejoin="round"/></svg></div>
    </div>
    <div class="chat-input-box" style="position:relative"><div class="emoji-picker" id="emoji-picker"></div><textarea id="msg-input" placeholder="输入消息... @某人" onkeydown="handleGroupKey(event)" oninput="handleGroupInput(event)"></textarea>
    <button class="send-btn" id="send-btn" onclick="sendGroupMessage()">发送</button>
    <div id="mention-popup" style="display:none;position:absolute;bottom:60px;left:16px;background:#fff;border:1px solid #D9D9D9;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.1);z-index:100;max-height:200px;overflow-y:auto;width:160px"></div></div>
    <div class="call-popup-overlay" id="call-popup-overlay" onclick="closeCallPopup()"><div class="call-popup">你走火入魔了，还真想给ai打电话啊？</div></div>`;
  let html=''; const G=300;
  history.forEach((msg,i) => {
    if (msg.sender==='system') { html+=`<div class="msg-time">${msg.content}</div>`; return; }
    const ts=msg.timestamp||0, prevTs=i>0?(history[i-1].timestamp||0):0;
    if (i===0||ts-prevTs>G) { const d=new Date(ts*1000); html+=`<div class="msg-time">${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}</div>`; }
    const isSelf=msg.sender==='user', sn=msg.sender_name||'';
    const c=skills.find(s=>s.id===msg.sender)||skills.find(s=>s.name===msg.sender_name);const av=c?.avatar||'';
    html+=`<div class="msg-row ${isSelf?'self':'other'}">`;
    if (!isSelf) html+=`<div class="msg-avatar"><img src="${av}" onerror="this.style.background='#ddd'"></div>`;
    html+=`<div class="msg-bubble">${renderEmoji(escapeHtml(msg.content))}</div>`;
    if (isSelf) html+=`<div class="msg-avatar"><img id="my-msg-avatar" src="${document.getElementById('my-avatar-img')?.src||''}"></div>`;
    html+='</div>';
  });
  document.getElementById('msg-container').innerHTML=html;
  document.getElementById('msg-container').scrollTop=document.getElementById('msg-container').scrollHeight;
  renderAll();
}

async function sendGroupMessage() {
  if (!currentGroup) return;
  const input=document.getElementById('msg-input'), msg=input.value.trim(); if (!msg) return;
  const chatId=currentGroup, now=Date.now()/1000;
  let mention=null; const mm=msg.match(/^@(\S+)\s/);
  if (mm) { const name=mm[1]; if (name==='所有人') mention='all'; else { const grp=groups.find(g=>g.id===chatId); const mb=skills.find(s=>s.name===name&&grp?.members.includes(s.id)); if (mb) mention=mb.id; } }
  input.value=''; const btn=document.getElementById('send-btn'); btn.classList.add('active'); btn.textContent='...'; btn.classList.remove('active');

  // Optimistic UI
  if (!groupHistories[chatId]) groupHistories[chatId]=[];
  groupHistories[chatId].push({sender:'user',sender_name:'',content:msg,time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),timestamp:now});
  if (currentGroup===chatId) renderGroupChat(chatId);
  renderAll();

  const res=await fetch('/api/groups/'+chatId+'/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,mention})});
  const data=await res.json();
  if (currentGroup===chatId) {
    for (const r of data.responses) {
      groupHistories[chatId].push({sender:r.sender,sender_name:r.sender_name,content:r.content,time:r.time,timestamp:Date.now()/1000});
      renderGroupChat(chatId);
      await new Promise(r=>setTimeout(r, 200)); // incremental render
    }
  }
  renderAll();
  if (currentGroup===chatId) { btn.classList.remove('active'); btn.textContent='发送'; input.focus(); }
}

function handleGroupKey(e) { if (e.key==='Enter'&&!e.shiftKey&&!e.isComposing) { e.preventDefault(); sendGroupMessage(); } }

function handleGroupInput(e) {
  handleMentionInput(e);
  const btn=document.getElementById('send-btn');
  if (btn) btn.classList.toggle('active', e.target.value.trim().length>0);
}

function handleMentionInput(e) {
  const input=e.target, val=input.value, cp=input.selectionStart, before=val.substring(0,cp), atIdx=before.lastIndexOf('@');
  const popup=document.getElementById('mention-popup'); if (!popup) return;
  if (atIdx>=0&&(atIdx===0||before[atIdx-1]===' ')) {
    const q=before.substring(atIdx+1).toLowerCase(), grp=groups.find(g=>g.id===currentGroup); if (!grp) return;
    const members=['所有人',...grp.members.map(mid=>skills.find(s=>s.id===mid)?.name||mid)];
    const filtered=members.filter(n=>n.toLowerCase().includes(q));
    if (filtered.length) { popup.style.display='block'; popup.innerHTML=filtered.map(n=>`<div style="padding:6px 12px;cursor:pointer;font-size:13px" onmouseover="this.style.background='#F0F0F0'" onmouseout="this.style.background=''" onclick="selectMention('${n}')">${n==='所有人'?'@所有人':'@'+n}</div>`).join(''); }
    else popup.style.display='none';
  } else popup.style.display='none';
}

function selectMention(name) {
  const input=document.getElementById('msg-input'); if (!input) return;
  const val=input.value, cp=input.selectionStart, before=val.substring(0,cp), atIdx=before.lastIndexOf('@');
  input.value=val.substring(0,atIdx)+'@'+name+' '+val.substring(cp);
  document.getElementById('mention-popup').style.display='none'; input.focus();
}

function openGroupRenameModal(gid) {
  const g=groups.find(g=>g.id===gid); if (!g) return;
  document.getElementById('edit-name').value=g.name;
  document.getElementById('edit-avatar').style.display='none';
  document.querySelector('#edit-modal label') && (document.querySelector('#edit-modal label').textContent='群聊名称');
  editingContact=gid; _editingGroup=true;
  document.getElementById('edit-modal').classList.add('show');
}
let _editingGroup=false;
const _origSaveContact=saveContact;
saveContact=async function(){
  if (_editingGroup&&editingContact){
    const name=document.getElementById('edit-name').value.trim();
    await fetch('/api/groups/'+editingContact+'/rename',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
    const g=groups.find(g=>g.id===editingContact); if (g) g.name=name;
    renderAll(); if (currentGroup===editingContact) renderGroupChat(editingContact);
    _editingGroup=false; closeModal(); return;
  }
  _origSaveContact();
};

async function deleteGroup(gid) { if (!confirm('删除此群聊？')) return; await fetch('/api/groups/'+gid,{method:'DELETE'}); groups=groups.filter(g=>g.id!==gid); delete groupHistories[gid]; if (currentGroup===gid) { currentGroup=null; document.getElementById('chat-area').innerHTML='<div class="no-chat">选择一个聊天开始</div>'; } renderAll(); }

// Load groups + override render
fetch('/api/groups').then(r=>r.json()).then(d=>{groups=d||[];renderAll();});

const _origInit2=init;
init=async function(){await _origInit2();const s=await fetch('/api/settings').then(r=>r.json());if(s.nickname&&document.getElementById('sp-nickname'))document.getElementById('sp-nickname').value=s.nickname;};

const _origRCL=renderChatList;
renderChatList=function(){
  _origRCL();const list=document.getElementById('chat-contact-list');if(!list)return;
  let items=[];
  skills.forEach(s=>{const h=histories[s.id]||[];const lt=h.length>0?(h[h.length-1].timestamp||0):0;items.push({type:'contact',id:s.id,name:s.name,avatar:s.avatar,lastMsg:h.length>0?h[h.length-1].content.substring(0,30):(s.default_note||''),lastTs:lt,lastTime:lt?fmtContactTime(lt):''});});
  groups.forEach(g=>{const h=groupHistories[g.id]||[];const lt=h.length>0?(h[h.length-1].timestamp||0):0;items.push({type:'group',id:g.id,name:g.name,lastMsg:h.length>0?h[h.length-1].content.substring(0,30):'',lastTs:lt,lastTime:lt?fmtContactTime(lt):''});});
  items.sort((a,b)=>b.lastTs-a.lastTs);list.innerHTML='';
  items.forEach(item=>{const d=document.createElement('div');d.className='contact-item';
    if(item.type==='group'){d.onclick=()=>openGroupChat(item.id);d.innerHTML=`<div class="c-avatar" style="background:#07C160;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:bold">群</div><div class="c-info"><div class="c-name">${item.name}</div><div class="c-msg">${escapeHtml(item.lastMsg)}</div></div><div class="c-time">${item.lastTime}</div>`;}
    else {d.onclick=()=>openChat(item.id);d.id='item-'+item.id;d.innerHTML=`<div class="c-avatar"><img src="${item.avatar}" onerror="this.style.background='#ddd';this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 38 38%22%3E%3Ccircle cx=%2219%22 cy=%2213%22 r=%228%22 fill=%22%23ccc%22/%3E%3Cellipse cx=%2219%22 cy=%2233%22 rx=%2212%22 ry=%229%22 fill=%22%23ccc%22/%3E%3C/svg%3E'"></div><div class="c-info"><div class="c-name">${item.name}</div><div class="c-msg">${escapeHtml(item.lastMsg)}</div></div><div class="c-time">${item.lastTime}</div>`;}
    list.appendChild(d);
  });
};

const _origRCD=renderContactsDetail;
renderContactsDetail=function(){_origRCD();const c=document.getElementById('contacts-detail-list');if(!c)return;groups.forEach(g=>{const d=document.createElement('div');d.className='cp-item';d.innerHTML=`<div class="cp-avatar" style="background:#07C160;display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;font-weight:bold">群</div><span class="cp-name" onclick="openGroupRenameModal('${g.id}')">${g.name}</span><span class="cp-del" onclick="deleteGroup('${g.id}')">删除</span>`;c.appendChild(d);});};

init();
