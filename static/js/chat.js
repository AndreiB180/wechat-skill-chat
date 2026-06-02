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

init();