// ---- State ----
let skills = [];
let currentChat = null;
let histories = {};
let editingContact = null;
let voiceConfig = {voices: {}};

// ---- Init ----
async function init() {
  await loadEmojiManifest();
  skills = await fetch('/api/config').then(r => r.json());
  await Promise.all(skills.map(async s => {
    histories[s.id] = await fetch('/api/history/' + s.id).then(r => r.json());
  }));
  try { voiceConfig = await fetch('/api/voice_config').then(r => r.json()); } catch (e) {}
  renderAll();
  _populateSettingsUI(await fetch('/api/settings').then(r => r.json()));
}

function renderAll() {
  renderChatList();
  renderContactsDetail();
}

// ---- Navigation ----
function switchNav(tab) {
  document.querySelectorAll('.nav-icon').forEach(el => el.classList.remove('active'));
  document.getElementById('nav-' + tab).classList.add('active');
  document.getElementById('list-chat').style.display = (tab === 'chat') ? 'flex' : 'none';
  document.getElementById('chat-area').style.display = (tab === 'chat') ? 'flex' : 'none';
  document.getElementById('contacts-panel').classList.toggle('show', tab === 'contacts');
  document.getElementById('settings-panel').classList.toggle('show', tab === 'settings');
  if (tab === 'settings') loadSettingsToUI();
}
function openSettings() { switchNav('settings'); }

function _populateSettingsUI(s) {
  const set = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
  set('sp-api-key', s.api_key); set('sp-base-url', s.base_url); set('sp-model', s.model);
  set('sp-nickname', s.nickname); set('sp-mode', s.mode); set('sp-claude-cli', s.claude_cli);
  set('sp-permission-mode', s.permission_mode); set('sp-add-dirs', s.add_dirs);
  set('sp-gs-dir', (voiceConfig.engine && voiceConfig.engine.gpt_sovits_dir) || '~/GPT-SoVITS');
  if (s.my_avatar) {
    document.getElementById('my-avatar-img').src = s.my_avatar;
    document.getElementById('sp-avatar-img').src = s.my_avatar;
    document.getElementById('sp-avatar-url').value = s.my_avatar;
  }
  onModeChange();
}
async function loadSettingsToUI() {
  _populateSettingsUI(await fetch('/api/settings').then(r => r.json()));
}

async function saveSettings() {
  const val = id => (document.getElementById(id)?.value || '').trim();
  const avatarUrl = val('sp-avatar-url');
  await fetch('/api/settings', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      nickname: val('sp-nickname'), api_key: val('sp-api-key'), base_url: val('sp-base-url'),
      model: val('sp-model'), my_avatar: avatarUrl, mode: document.getElementById('sp-mode').value,
      claude_cli: val('sp-claude-cli'),
      permission_mode: document.getElementById('sp-permission-mode').value,
      add_dirs: val('sp-add-dirs')
    })
  });
  if (avatarUrl) {
    document.getElementById('my-avatar-img').src = avatarUrl;
    document.getElementById('sp-avatar-img').src = avatarUrl;
  }
  const saved = document.getElementById('sp-saved');
  saved.style.display = 'inline';
  setTimeout(() => saved.style.display = 'none', 2000);
}

function onModeChange() {
  const g = document.getElementById('sp-claude-group');
  if (g) g.style.display = document.getElementById('sp-mode').value === 'claude' ? 'block' : 'none';
}

async function checkClaudeCLI() {
  const el = document.getElementById('sp-claude-status');
  el.textContent = '正在检测...'; el.style.color = '';
  try {
    const d = await fetch('/api/settings/check_claude', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({claude_cli: document.getElementById('sp-claude-cli').value.trim() || 'claude'})
    }).then(r => r.json());
    el.textContent = (d.ok ? '✓ ' : '✗ ') + d.version;
    el.style.color = d.ok ? 'var(--green)' : 'var(--danger)';
  } catch (e) { el.textContent = '✗ 检测失败'; el.style.color = 'var(--danger)'; }
}

async function checkVoiceEngine() {
  const el = document.getElementById('sp-voice-status');
  el.textContent = '正在启动本机语音引擎...'; el.style.color = '';
  try {
    const d = await fetch('/api/voice/engine', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({action: 'start'})
    }).then(r => r.json());
    el.textContent = d.ok ? '✓ 引擎已在本机运行' : '✗ ' + (d.error || '启动失败');
    el.style.color = d.ok ? 'var(--green)' : 'var(--danger)';
  } catch (e) { el.textContent = '✗ 启动失败'; el.style.color = 'var(--danger)'; }
}

async function shutdownServer() {
  if (!confirm('确定退出？')) return;
  try { await fetch('/api/shutdown', {method: 'POST'}); } catch (e) {}
  document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;color:#888">已退出，可以关闭窗口。</div>';
}

// ---- Chat list ----
function renderChatList() {
  const list = document.getElementById('chat-contact-list');
  if (!list) return;
  list.innerHTML = '';
  skills.map(s => {
    const h = histories[s.id] || [];
    let last = null;
    for (let i = h.length - 1; i >= 0; i--) if (!h[i].deleted) { last = h[i]; break; }
    return {...s, lastTs: last ? (last.timestamp || 0) : 0, last};
  }).sort((a, b) => b.lastTs - a.lastTs).forEach(s => {
    const div = document.createElement('div');
    div.className = 'contact-item' + (currentChat === s.id ? ' active' : '');
    div.onclick = () => openChat(s.id);
    div.id = 'item-' + s.id;
    const preview = s.last ? (s.last.is_voice ? '[语音]' : s.last.content.substring(0, 30)) : (s.default_note || '');
    div.innerHTML = `<div class="c-avatar"><img src="${s.avatar}" onerror="this.src='${FALLBACK_AVATAR}'"></div>
      <div class="c-info"><div class="c-name">${escapeHtml(s.name)}</div><div class="c-msg">${escapeHtml(preview)}</div></div>
      ${_listRightHTML(s.lastTs)}`;
    list.appendChild(div);
  });
}

const FALLBACK_AVATAR = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 40'%3E%3Crect width='40' height='40' fill='%23d0d0d0'/%3E%3Ccircle cx='20' cy='15' r='7' fill='%23fff'/%3E%3Cellipse cx='20' cy='34' rx='11' ry='8' fill='%23fff'/%3E%3C/svg%3E";

// 时间在上、免打扰铃铛在下 —— 微信列表项右侧就是这个布局
function _listRightHTML(lastTs) {
  return `<div class="c-right">
    <div class="c-time">${lastTs ? fmtContactTime(lastTs) : ''}</div>
    <div class="c-mute" title="消息免打扰"><svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3.4 6a3.6 3.6 0 017.2 0c0 2.4.9 3.4.9 3.4H2.5S3.4 8.4 3.4 6z"/><path d="M5.9 11.3a1.3 1.3 0 002.2 0"/><path d="M1.8 12.2L12.2 1.8"/></svg></div>
  </div>`;
}

function filterChatList(q) {
  q = q.toLowerCase();
  document.querySelectorAll('#chat-contact-list .contact-item').forEach(item => {
    const name = item.querySelector('.c-name').textContent.toLowerCase();
    item.style.display = name.includes(q) ? 'flex' : 'none';
  });
}

// ---- Contacts panel ----
function renderContactsDetail() {
  const c = document.getElementById('contacts-detail-list');
  if (!c) return;
  c.innerHTML = '';
  skills.forEach(s => {
    const v = voiceConfig.voices?.[s.id];
    const on = v && v.enabled && v.verified;
    const div = document.createElement('div');
    div.className = 'cp-item';
    div.innerHTML = `<div class="cp-avatar"><img src="${s.avatar}" onerror="this.src='${FALLBACK_AVATAR}'"></div>
      <span class="cp-name" onclick="openEditModal('${s.id}')">${escapeHtml(s.name)}</span>
      <span class="cp-action ${on ? 'voiced' : ''}" onclick="openVoiceModal('${s.id}')">${on ? '语音 ' + (v.probability ?? 100) + '%' : '语音'}</span>
      <span class="cp-action" onclick="clearContactHistory('${s.id}')">清空聊天</span>
      <span class="cp-del" onclick="deleteSkill('${s.id}')">删除</span>`;
    c.appendChild(div);
  });
}

async function clearContactHistory(id) {
  if (!confirm('清空该联系人的聊天记录？')) return;
  await fetch('/api/clear/' + id, {method: 'POST'});
  histories[id] = [];
  if (currentChat === id) openChat(id);
  renderAll();
}
async function deleteSkill(id) {
  if (!confirm('确定删除该 Skill 及其所有聊天记录？')) return;
  await fetch('/api/delete_skill/' + id, {method: 'POST'});
  skills = skills.filter(s => s.id !== id);
  delete histories[id];
  if (currentChat === id) {
    currentChat = null;
    document.getElementById('chat-area').innerHTML = '<div class="no-chat"></div>';
  }
  renderAll();
}

// ---- Import ----
function openImportModal() {
  document.getElementById('import-modal').classList.add('show');
  document.getElementById('import-error').style.display = 'none';
  document.getElementById('import-path').value = '';
}
function closeImportModal() { document.getElementById('import-modal').classList.remove('show'); }
async function importSkill() {
  const path = document.getElementById('import-path').value.trim();
  const err = document.getElementById('import-error');
  if (!path) { err.textContent = '请输入文件夹路径'; err.style.display = 'block'; return; }
  const d = await fetch('/api/import_skill', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({path})
  }).then(r => r.json());
  if (d.error) { err.textContent = d.error; err.style.display = 'block'; }
  else { skills.push(d.skill); renderAll(); closeImportModal(); }
}

// ---- Emoji (manifest comes from disk, so it can never drift from the assets) ----
let _emojiLookup = {};
const _enToCn = {
  'Smile':'微笑','Grimace':'撇嘴','Drool':'色','Scowl':'发呆','CoolGuy':'得意','Sob':'流泪','Shy':'害羞',
  'Silent':'闭嘴','Sleep':'睡','Cry':'大哭','Awkward':'尴尬','Angry':'发怒','Tongue':'调皮','Grin':'呲牙',
  'Surprise':'惊讶','Frown':'难过','Scream':'抓狂','Puke':'吐','Chuckle':'偷笑','Slight':'白眼','Smug':'傲慢',
  'Drowsy':'困','Panic':'惊恐','Laugh':'憨笑','Scold':'咒骂','Shocked':'疑问','Shhh':'嘘','Dizzy':'晕',
  'Toasted':'衰','Skull':'骷髅','Hammer':'敲打','Bye':'再见','Speechless':'无语','NosePick':'抠鼻','Clap':'鼓掌',
  'Trick':'坏笑','Sly':'阴险','Kiss':'亲亲','Whimper':'可怜','Knife':'菜刀','Beer':'啤酒','Coffee':'咖啡',
  'Pig':'猪头','Rose':'玫瑰','Wilt':'凋谢','Heart':'爱心','HeartBroken':'心碎','Cake':'蛋糕','Bomb':'炸弹',
  'Poop':'便便','Moon':'月亮','Sun':'太阳','Gift':'礼物','Hug':'拥抱','Strong':'强','Weak':'弱','Shake':'握手',
  'Victory':'胜利','Fist':'抱拳','Beckon':'勾引','FistPump':'拳头','Waddle':'跳跳','Tremble':'发抖','Twirl':'转圈',
  'Hey':'嘿哈','Facepalm':'捂脸','Smart':'奸笑','Witty':'机智','BrowFrown':'皱眉','Yeah':'耶','Packet':'红包',
};
// 微信面板里的习惯顺序；磁盘上没有的会被自动过滤掉
const _PICKER_ORDER = ['微笑','撇嘴','色','发呆','得意','流泪','害羞','闭嘴','睡','大哭','尴尬','发怒','调皮','呲牙',
  '惊讶','难过','抓狂','吐','偷笑','白眼','傲慢','困','惊恐','憨笑','咒骂','疑问','嘘','晕','衰','骷髅','敲打',
  '再见','擦汗','抠鼻','鼓掌','坏笑','右哼哼','鄙视','委屈','快哭了','阴险','亲亲','可怜','捂脸','奸笑','机智',
  '皱眉','耶','吃瓜','加油','汗','天啊','Emm','社会社会','旺柴','好的','哇','打脸','破涕为笑','苦涩','裂开',
  '让我看看','叹气','失望','恐惧','悠闲','愉快','生病','脸红','翻白眼','笑脸','囧','666','菜刀','啤酒','咖啡',
  '猪头','玫瑰','凋谢','爱心','心碎','蛋糕','炸弹','便便','月亮','太阳','礼物','红包','發','福','庆祝','烟花',
  '爆竹','拥抱','强','弱','握手','胜利','抱拳','勾引','拳头','OK','合十','发抖','跳跳','转圈','嘴唇'];

async function loadEmojiManifest() {
  try { _emojiLookup = await fetch('/api/emoji_manifest').then(r => r.json()); }
  catch (e) { _emojiLookup = {}; }
}

function emojiImg(code, dir) {
  const size = (code === 'Emm' || code === '666') ? 15 : 19;
  return `<img src="/emoji/${dir}/${encodeURIComponent(code)}.png" style="width:${size}px;height:${size}px" title="[${code}]">`;
}

function renderEmoji(text) {
  return text.replace(/\[([^\]]{1,12})\]/g, (match, code) => {
    for (const cand of [_enToCn[code] || code, (_enToCn[code.replace(/[2-9]$/, '')] || code.replace(/[2-9]$/, ''))]) {
      const dir = _emojiLookup[cand];
      if (dir) return emojiImg(cand, dir);
    }
    return match;
  });
}

function buildEmojiPicker() {
  const picker = document.getElementById('emoji-picker');
  if (!picker) return;
  const seen = new Set();
  const codes = _PICKER_ORDER.filter(c => _emojiLookup[c] && !seen.has(c) && seen.add(c) !== false);
  Object.keys(_emojiLookup).forEach(c => { if (!seen.has(c)) { seen.add(c); codes.push(c); } });
  picker.innerHTML = codes.map(c =>
    `<div class="emoji-item" title="[${c}]" onclick="insertEmoji('${c}')"><img src="/emoji/${_emojiLookup[c]}/${encodeURIComponent(c)}.png"></div>`
  ).join('');
}
function insertEmoji(c) {
  const ta = document.getElementById('msg-input');
  if (!ta) return;
  ta.value += `[${c}]`;
  ta.focus();
  ta.dispatchEvent(new Event('input'));
}
function toggleEmoji() {
  document.getElementById('emoji-picker')?.classList.toggle('show');
}
document.addEventListener('click', e => {
  const p = document.getElementById('emoji-picker');
  if (p && p.classList.contains('show') && !p.contains(e.target) && !e.target.closest('.toolbar-btn')) {
    p.classList.remove('show');
  }
});

// ---- Chat view ----
async function openChat(skillId) {
  _attachedFiles = [];
  currentChat = skillId; currentGroup = null;
  if (!histories[skillId]) histories[skillId] = await fetch('/api/history/' + skillId).then(r => r.json());
  const contact = skills.find(s => s.id === skillId);

  document.getElementById('chat-area').innerHTML = `
    <div class="chat-header">
      <div class="ch-name" onclick="openEditModal('${skillId}')" title="修改备注和头像">${escapeHtml(contact ? contact.name : skillId)}</div>
      <div class="ch-spacer"></div>
      ${_headerBtnsHTML(`openVoiceModal('${skillId}')`)}
    </div>
    <div class="chat-messages" id="msg-container"></div>
    ${_composerHTML('sendMessage')}
    <div class="call-popup-overlay" id="call-popup-overlay" onclick="closeCallPopup()">
      <div class="call-popup">你走火入魔了，还真想给 AI 打电话啊？</div>
    </div>`;
  buildEmojiPicker();
  renderMessages(skillId);
  renderChatList();
  _setupResizeDrag();
}

// ---- Message rendering ----
function _bubbleHTML(msg, idx, chatId) {
  if (!msg.is_voice) return `<div class="msg-bubble">${renderEmoji(escapeHtml(msg.content))}</div>`;
  const sec = msg.voice_sec || 0;
  const ready = !!msg.voice_url;
  // 气泡宽度随时长增长，和微信一样
  const width = ready ? Math.min(230, 92 + sec * 6) : 112;
  // 微信语音气泡里就是三道由小到大的声波弧线，没有喇叭盒子
  const wave = `<svg class="voice-wave" viewBox="0 0 20 20" fill="none" stroke="currentColor"
      stroke-width="1.7" stroke-linecap="round">
      <path d="M5.6 8.7a2.1 2.1 0 010 2.6"/>
      <path d="M8.9 6.6a5.4 5.4 0 010 6.8"/>
      <path d="M12.2 4.5a8.7 8.7 0 010 11"/></svg>`;
  const body = ready ? `${wave}<span class="voice-sec">${sec}"</span>`
                     : `${wave}<span class="voice-loading">生成中…</span>`;
  const attr = ready ? `onclick="playVoice(this,'${msg.voice_url}')"` : '';
  return `<div class="msg-bubble voice" style="min-width:${width}px" data-id="${msg.id || ''}" ${attr}>${body}</div>`
       + (msg.voice_shown ? `<div class="voice-text">${renderEmoji(escapeHtml(msg.content))}</div>` : '');
}

function renderMessages(skillId) {
  const container = document.getElementById('msg-container');
  if (!container) return;
  const history = histories[skillId] || [];
  const contact = skills.find(s => s.id === skillId);
  const avatar = contact ? contact.avatar : '';
  const myAvatar = document.getElementById('my-avatar-img')?.src || '';
  const GAP = 300;
  let html = '';

  history.forEach((msg, i) => {
    const ts = msg.timestamp || 0;
    const prevTs = i > 0 ? (history[i - 1].timestamp || 0) : 0;
    if (i === 0 || ts - prevTs > GAP) html += `<div class="msg-time">${fmtDate(ts, true)}</div>`;

    if (msg.sender === 'system') {
      html += msg._perm
        ? `<div class="msg-row"><div class="perm-card"><div class="perm-body">${renderEmoji(escapeHtml(msg.content)).replace(/\n/g, '<br>')}</div></div></div>`
        : `<div class="msg-time">${escapeHtml(msg.content)}</div>`;
      return;
    }
    const isSelf = msg.sender === 'user';
    html += `<div class="msg-row ${isSelf ? 'self' : 'other'}">`
          + `<div class="msg-avatar"><img src="${isSelf ? myAvatar : avatar}" onerror="this.src='${FALLBACK_AVATAR}'"></div>`
          + `<div class="msg-content-wrap">${_bubbleHTML(msg, i, skillId)}</div></div>`;
  });
  container.innerHTML = html;
  container.scrollTop = container.scrollHeight;
  _fetchPendingVoices(skillId, history);
}

function escapeHtml(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---- Voice playback ----
let _curAudio = null, _curBubble = null;
function playVoice(el, url) {
  if (_curAudio) { _curAudio.pause(); _curBubble?.classList.remove('playing'); }
  if (_curBubble === el && _curAudio && !_curAudio.ended) { _curAudio = null; _curBubble = null; return; }
  const a = new Audio(url);
  _curAudio = a; _curBubble = el;
  el.classList.add('playing');
  a.onended = () => { el.classList.remove('playing'); _curAudio = null; _curBubble = null; };
  a.onerror = () => { el.classList.remove('playing'); };
  a.play().catch(() => el.classList.remove('playing'));
}

const _voicePending = new Set();
function _fetchPendingVoices(chatId, history) {
  history.forEach(msg => {
    if (!msg.is_voice || msg.voice_url || !msg.id) return;
    const key = chatId + ':' + msg.id;
    if (_voicePending.has(key)) return;
    _voicePending.add(key);
    // 用 msg_id 而不是数组下标：历史会截断归档，下标会整体前移，
    // 之前就是因为这个后端一直查不到消息、语音全退回了文字。
    fetch('/api/tts/' + chatId, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({msg_id: msg.id})
    }).then(r => r.json()).then(d => {
      _voicePending.delete(key);
      const h = histories[chatId];
      const target = h && h.find(m => m.id === msg.id);
      if (!target) return;
      if (d.ok) { target.voice_url = d.url; target.voice_sec = d.duration; }
      else { delete target.is_voice; target.voice_failed = d.error; }   // 合成不出来就退回文字
      if (currentChat === chatId) renderMessages(chatId);
      renderChatList();
    }).catch(() => _voicePending.delete(key));
  });
}

// ---- Timestamps ----
const DAY_NAMES = ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'];
function fmtTime(ts, showTime, compact) {
  const d = new Date(ts * 1000), now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((today - target) / 86400000);
  const t = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
  let ds;
  if (diff === 0) ds = '';
  else if (diff === 1) ds = '昨天';
  else if (diff < 7) ds = DAY_NAMES[d.getDay()];
  else if (d.getFullYear() === now.getFullYear()) ds = `${d.getMonth()+1}/${d.getDate()}`;
  else ds = `${d.getFullYear()}/${d.getMonth()+1}/${d.getDate()}`;
  if (!showTime) return ds || t;
  if (!ds) return t;
  return compact ? `${ds}${t}` : `${ds} ${t}`;
}
const fmtDate = (ts, showTime) => fmtTime(ts, showTime, false);
// 侧栏只显示一个信息：今天给时间，更早给日期 —— 微信就是这样，
// 同时给会挤成「7/1005:56」这种读不出来的东西。
const fmtContactTime = ts => fmtTime(ts, false, false);

// ---- Sending ----
let _attachedFiles = [];
let _ccActive = false, _ccAbortCtrl = null;
const _isClaudeMode = () => document.getElementById('sp-mode')?.value === 'claude';

function handleFile(e) {
  if (_isClaudeMode()) {
    fetch('/api/pick_files', {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({folders: !!(e && e.altKey)})
    }).then(r => r.json()).then(d => {
      const ta = document.getElementById('msg-input');
      if (!ta || !d.paths?.length) return;
      ta.value += (ta.value ? '\n' : '') + d.paths.join('\n');
      ta.dispatchEvent(new Event('input'));
    }).catch(() => {});
    return;
  }
  const input = document.createElement('input');
  input.type = 'file'; input.multiple = true;
  input.onchange = () => {
    const ta = document.getElementById('msg-input');
    Array.from(input.files).forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        _attachedFiles.push({name: file.name, content: reader.result.split(',')[1] || reader.result, mime: file.type});
        if (ta) {
          const n = file.name.length > 15 ? file.name.substring(0, 12) + '...' : file.name;
          ta.value += `[文件:${n}]`;
          ta.dispatchEvent(new Event('input'));
        }
      };
      reader.readAsDataURL(file);
    });
  };
  input.click();
}

function handleCall() { document.getElementById('call-popup-overlay').classList.add('show'); }
function closeCallPopup() { document.getElementById('call-popup-overlay').classList.remove('show'); }

// 发送语音：目前只做形态，录音本身还没实现
function startVoiceRec() { document.getElementById('composer')?.classList.add('recording'); }
function stopVoiceRec() { document.getElementById('composer')?.classList.remove('recording'); }

async function _stopCC(chatId) {
  if (!_ccActive) return;
  _ccAbortCtrl?.abort(); _ccAbortCtrl = null; _ccActive = false;
  try { await fetch('/api/stop/' + chatId, {method: 'POST'}); } catch (e) {}
  histories[chatId].push({sender: 'system', content: 'ⓘ 已停止', timestamp: Date.now() / 1000});
  if (currentChat === chatId) renderMessages(chatId);
  renderChatList();
}

async function sendMessage() {
  if (!currentChat || _ccActive) return;
  const input = document.getElementById('msg-input');
  const msg = input.value.trim();
  if (!msg) return;
  const chatId = currentChat;
  input.value = '';

  const sent = {sender: 'user', content: msg, timestamp: Date.now() / 1000};
  (histories[chatId] ||= []).push(sent);
  if (currentChat === chatId) renderMessages(chatId);
  renderChatList();

  _ccAbortCtrl = new AbortController();
  try {
    const body = {message: msg};
    if (_attachedFiles.length && !_isClaudeMode()) body.files = _attachedFiles;
    _attachedFiles = [];
    const res = await fetch('/api/send/' + chatId, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(body), signal: _ccAbortCtrl.signal
    });

    if (_isClaudeMode()) {
      if (!res.ok) {
        const e = await res.json().catch(() => ({error: '请求失败'}));
        histories[chatId].push({sender: 'bot', content: '[错误] ' + (e.error || '请求失败'), timestamp: Date.now() / 1000});
        if (currentChat === chatId) renderMessages(chatId);
        return;
      }
      _ccActive = true;
      await _readSSE(res, d => {
        if (d.type === 'text') histories[chatId].push({id: d.id, sender: 'bot', content: d.content, timestamp: Date.now() / 1000});
        else if (d.type === 'tool_use') _showPermCard(chatId, d);
        else if (d.type === 'error') histories[chatId].push({sender: 'bot', content: '[错误] ' + d.content, timestamp: Date.now() / 1000});
        if (currentChat === chatId) renderMessages(chatId);
      });
      _ccActive = false;
      renderChatList();
      return;
    }

    const data = await res.json();
    if (data.error) {
      histories[chatId].push({sender: 'bot', content: '[错误] ' + data.error, timestamp: Date.now() / 1000});
    } else {
      if (data.user && data.user.id) sent.id = data.user.id;   // 回填乐观插入那条的 id
      data.responses.forEach(r => histories[chatId].push({
        id: r.id, sender: 'bot', content: r.content, time: r.time,
        timestamp: Date.now() / 1000, is_voice: r.is_voice
      }));
    }
    if (currentChat === chatId) renderMessages(chatId);
    renderChatList();
  } catch (e) {
    if (e.name !== 'AbortError') console.error(e);
  } finally {
    _ccActive = false; _ccAbortCtrl = null;
    if (currentChat === chatId) input.focus();
  }
}

async function _readSSE(res, onEvent) {
  const reader = res.body.getReader(), decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const {done, value} = await reader.read();
    if (done) break;
    buf += decoder.decode(value, {stream: true});
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      try { onEvent(JSON.parse(line.slice(6))); } catch (e) {}
    }
  }
}

function _showPermCard(chatId, data) {
  const descs = (data.tools || []).map(t => _describeTool(t.name, t.input)).join('\n');
  histories[chatId].push({sender: 'system', content: '⚙ ' + descs, timestamp: Date.now() / 1000, _perm: true});
}
function _describeTool(name, input) {
  const i = input || {}, n = (name || '').toLowerCase();
  if (n === 'bash') return `运行命令：${i.command || i.cmd || '?'}`;
  if (n === 'read') return `读取文件：${i.file_path || '?'}`;
  if (n === 'write') return `写入文件：${i.file_path || '?'}`;
  if (n === 'edit') return `编辑文件：${i.file_path || '?'}`;
  if (n === 'webfetch') return `访问网页：${i.url || '?'}`;
  if (n === 'websearch') return `搜索：${i.query || '?'}`;
  if (n === 'glob') return `搜索文件：${i.pattern || '?'}`;
  if (n === 'grep') return `搜索代码：${i.pattern || '?'}`;
  return name;
}

function scrollBottom() {
  const mc = document.getElementById('msg-container');
  if (mc) mc.scrollTop = mc.scrollHeight;
}

function _enterKeyHandler(e, sendFn) {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendFn(); }
}
function _keyHandler(e, sendFn) {
  if ((e.ctrlKey || e.metaKey) && e.key === 'c' && !e.target.value && _ccActive) {
    e.preventDefault(); _stopCC(currentChat); return;
  }
  _enterKeyHandler(e, sendFn);
}

// 输入区：一个带边框的圆角容器，工具栏在容器内底部 —— 和 Mac 微信一致。
// sendFn 用名字传，群聊和单聊各用各的发送函数。
function _composerHTML(sendFn, extra) {
  const S = 'fill="none" stroke="currentColor" stroke-width="1.6"';
  return `<div class="composer" id="composer">
    <div class="emoji-picker" id="emoji-picker"></div>
    ${extra || ''}
    <textarea id="msg-input" onkeydown="_keyHandler(event, ${sendFn})"
      ${sendFn === 'sendGroupMessage' ? 'oninput="handleGroupInput(event)"' : ''}></textarea>
    <div class="composer-bar">
      <div class="toolbar-btn" title="表情" onclick="event.stopPropagation();toggleEmoji()">
        <svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="9"/><circle cx="8.8" cy="10" r="1.1" fill="currentColor" stroke="none"/><circle cx="15.2" cy="10" r="1.1" fill="currentColor" stroke="none"/><path d="M8.2 14.4c1.6 1.9 6 1.9 7.6 0" stroke-linecap="round"/></svg></div>
      <div class="toolbar-btn only-normal" title="表情包" onclick="notReady('表情包')">
        <svg viewBox="0 0 24 24" ${S} stroke-linejoin="round"><path d="M12 2.9l8.1 4.5v9L12 21l-8.1-4.6v-9z"/><path d="M4.1 7.5L12 12l7.9-4.5M12 12v9"/></svg></div>
      <div class="toolbar-btn" title="文件" onclick="handleFile(event)">
        <svg viewBox="0 0 24 24" ${S} stroke-linejoin="round"><path d="M3 7.5A1.5 1.5 0 014.5 6h4l1.8 2.2h7.2A1.5 1.5 0 0119 9.7v8.3a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 013 18z"/></svg></div>
      <div class="toolbar-btn with-chev only-normal" title="截图" onclick="notReady('截图')">
        <svg viewBox="0 0 24 24" ${S} stroke-linecap="round"><circle cx="6.5" cy="17.5" r="2.6"/><circle cx="17.5" cy="17.5" r="2.6"/><path d="M8.4 15.6L18.5 3.6M15.6 15.6L5.5 3.6"/></svg>
        <svg class="chev" viewBox="0 0 12 12" ${S}><path d="M2.5 4.5L6 8l3.5-3.5" stroke-linecap="round"/></svg></div>
      <div class="toolbar-btn" title="语音输入" onclick="notReady('语音输入')">
        <svg viewBox="0 0 24 24" ${S} stroke-linecap="round"><rect x="9" y="2.8" width="6" height="11.4" rx="3"/><path d="M5.4 11.6a6.6 6.6 0 0013.2 0M12 18.2v3"/></svg></div>
      <div class="toolbar-btn only-rec" title="更多" onclick="notReady('更多')">
        <svg viewBox="0 0 24 24" ${S} stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 6.5l5.5 5.5-5.5 5.5M13.5 6.5L19 12l-5.5 5.5"/></svg></div>
      <div class="toolbar-spacer"></div>
      <div class="toolbar-btn only-normal" title="发送语音" onclick="startVoiceRec()">
        <svg viewBox="0 0 24 24" ${S} stroke-linecap="round"><circle cx="12" cy="12" r="8.7" stroke-width="1.3"/>
          <path d="M8.9 10.7v2.6"/><path d="M11.7 9.4a4.1 4.1 0 010 5.2"/><path d="M14.5 8a7.2 7.2 0 010 8"/></svg></div>
      <div class="rec-cancel only-rec" title="取消" onclick="stopVoiceRec()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg></div>
      <div class="rec-wave only-rec">${Array.from({length: 8}, (_, i) =>
        `<span class="rec-dot" style="animation-delay:${i * 0.12}s"></span>`).join('')}</div>
      <div class="rec-send only-rec" title="发送" onclick="notReady('发送语音')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 18.5v-13M6.2 11.3L12 5.5l5.8 5.8"/></svg></div>
    </div>
  </div>`;
}

// 头部右侧按钮，和 Mac 微信一致：聊天记录 / 视频通话 / 更多
function _headerBtnsHTML(moreFn) {
  const S = 'fill="none" stroke="currentColor" stroke-width="1.6"';
  return `<div class="ch-btn" title="聊天记录" onclick="notReady('聊天记录')">
      <svg viewBox="0 0 24 24" ${S} stroke-linejoin="round"><path d="M12 4C7 4 3 7.2 3 11.2c0 2.2 1.2 4.2 3.2 5.5L5.4 20l3.7-1.8c.9.2 1.9.3 2.9.3 5 0 9-3.2 9-7.2S17 4 12 4z"/></svg>
      <svg class="chev" viewBox="0 0 12 12" ${S}><path d="M2.5 4.5L6 8l3.5-3.5" stroke-linecap="round"/></svg></div>
    <div class="ch-btn" title="视频通话" onclick="handleCall()">
      <svg viewBox="0 0 24 24" ${S} stroke-linejoin="round"><rect x="2.5" y="6" width="13" height="12" rx="2.4"/><path d="M15.5 11l6-3v8l-6-3z"/></svg></div>
    <div class="ch-btn" title="更多" onclick="${moreFn}">
      <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg></div>`;
}

// 没做的功能：保留图标位，点了给个提示，不要静默无反应
let _toastTimer = null;
function notReady(name) {
  let el = document.getElementById('app-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'app-toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = `「${name}」还没做，位置先占着`;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function _setupResizeDrag() {
  setTimeout(() => {
    const composer = document.getElementById('composer'), ta = document.getElementById('msg-input');
    if (!composer || !ta) return;
    let dragging = false, startY, startH;
    composer.addEventListener('mousedown', e => {
      if (e.target === composer && e.offsetY < 9) {
        dragging = true; startY = e.clientY; startH = ta.offsetHeight; e.preventDefault();
      }
    });
    document.addEventListener('mousemove', e => {
      if (dragging) ta.style.height = Math.max(60, Math.min(280, startH - (e.clientY - startY))) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });
    ta.focus();
  }, 40);
}

// ---- Edit contact ----
function openEditModal(skillId) {
  editingContact = skillId; _editingGroup = false;
  const c = skills.find(s => s.id === skillId);
  document.getElementById('edit-modal-title').textContent = '修改备注和头像';
  document.getElementById('edit-name-label').textContent = '备注名';
  document.getElementById('edit-name').value = c ? c.name : '';
  document.getElementById('edit-avatar').value = c ? c.avatar : '';
  document.getElementById('edit-avatar-group').style.display = 'block';
  document.getElementById('edit-realname-group').style.display = 'block';
  document.getElementById('edit-realname').value = c ? (c.real_name || '') : '';
  document.getElementById('edit-modal').classList.add('show');
}
function closeModal() {
  document.getElementById('edit-modal').classList.remove('show');
  editingContact = null; _editingGroup = false;
}
async function saveContact() {
  if (!editingContact) return;
  const name = document.getElementById('edit-name').value.trim();
  const avatar = document.getElementById('edit-avatar').value.trim();
  await fetch('/api/update_contact/' + editingContact, {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({name, avatar})
  });
  const c = skills.find(s => s.id === editingContact);
  if (c) { if (name) c.name = name; if (avatar) c.avatar = avatar; }
  const wasEditing = editingContact;
  renderAll(); closeModal();
  if (currentChat === wasEditing) openChat(wasEditing);
}

// ---- Voice settings ----
let _voiceSkillId = null;
function openVoiceModal(skillId) {
  _voiceSkillId = skillId;
  const s = skills.find(x => x.id === skillId);
  const v = voiceConfig.voices?.[skillId] || {};
  document.getElementById('vm-name').textContent = s ? s.name : skillId;
  document.getElementById('vm-gpt').value = v.gpt_weights || '';
  document.getElementById('vm-sovits').value = v.sovits_weights || '';
  document.getElementById('vm-ref').value = v.ref_audio || '';
  document.getElementById('vm-reftext').value = v.ref_text || '';
  document.getElementById('vm-prob').value = v.probability ?? 30;
  document.getElementById('vm-prob-val').textContent = v.probability ?? 30;
  document.getElementById('vm-enabled').checked = !!v.enabled;
  document.getElementById('vm-audio').style.display = 'none';
  document.getElementById('vm-test-status').textContent = '';
  _setVoiceGate(!!v.verified);
  document.getElementById('voice-modal').classList.add('show');
}
function closeVoiceModal() {
  document.getElementById('voice-modal').classList.remove('show');
  _voiceSkillId = null;
}
function _setVoiceGate(unlocked) {
  document.getElementById('vm-gate').classList.toggle('unlocked', unlocked);
  document.getElementById('vm-enabled').disabled = !unlocked;
}

async function pickVoiceFile(kind) {
  const d = await fetch('/api/voice/pick', {
    method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({kind})
  }).then(r => r.json()).catch(() => ({}));
  if (!d.path) return;
  const map = {gpt: 'vm-gpt', sovits: 'vm-sovits', audio: 'vm-ref'};
  document.getElementById(map[kind]).value = d.path;
  _setVoiceGate(false);   // 换了文件就要重测
  document.getElementById('vm-enabled').checked = false;
}

async function testVoice() {
  if (!_voiceSkillId) return;
  const btn = document.getElementById('vm-test-btn');
  const st = document.getElementById('vm-test-status');
  btn.disabled = true;
  st.style.color = ''; st.textContent = '首次合成要加载模型，约十几秒…';
  try {
    const d = await fetch('/api/voice/test/' + _voiceSkillId, {
      method: 'POST', headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        gpt_weights: document.getElementById('vm-gpt').value.trim(),
        sovits_weights: document.getElementById('vm-sovits').value.trim(),
        ref_audio: document.getElementById('vm-ref').value.trim(),
        ref_text: document.getElementById('vm-reftext').value.trim(),
      })
    }).then(r => r.json());
    if (d.ok) {
      st.textContent = `✓ 合成成功（${d.duration}秒），可以启用了`;
      st.style.color = 'var(--green)';
      const a = document.getElementById('vm-audio');
      a.src = d.url; a.style.display = 'inline-block'; a.play().catch(() => {});
      voiceConfig.voices[_voiceSkillId] = d.voice;
      _setVoiceGate(true);
    } else {
      st.textContent = '✗ ' + (d.error || '合成失败');
      st.style.color = 'var(--danger)';
      _setVoiceGate(false);
    }
  } catch (e) {
    st.textContent = '✗ 请求失败'; st.style.color = 'var(--danger)';
  } finally { btn.disabled = false; }
}

async function saveVoiceConfig() {
  if (!_voiceSkillId) return;
  const d = await fetch('/api/voice_config/' + _voiceSkillId, {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      gpt_weights: document.getElementById('vm-gpt').value.trim(),
      sovits_weights: document.getElementById('vm-sovits').value.trim(),
      ref_audio: document.getElementById('vm-ref').value.trim(),
      ref_text: document.getElementById('vm-reftext').value.trim(),
      probability: parseInt(document.getElementById('vm-prob').value, 10),
      enabled: document.getElementById('vm-enabled').checked,
    })
  }).then(r => r.json());
  if (d.error) {
    const st = document.getElementById('vm-test-status');
    st.textContent = '✗ ' + d.error; st.style.color = 'var(--danger)';
    return;
  }
  voiceConfig.voices[_voiceSkillId] = d.voice;
  renderContactsDetail();
  closeVoiceModal();
}

// ---- Deleted messages ----
function _renderSkipDeleted(store, key, renderFn) {
  if (store[key]) {
    const orig = store[key];
    store[key] = orig.filter(m => !m.deleted);
    renderFn(key);
    store[key] = orig;
  } else renderFn(key);
}
const _origRenderMessages = renderMessages;
renderMessages = function (skillId) { _renderSkipDeleted(histories, skillId, _origRenderMessages); };

// ---- Context menu ----
function copyMsgText(el) {
  let text = '';
  el.childNodes.forEach(n => {
    if (n.nodeType === 3) text += n.textContent;
    else if (n.tagName === 'IMG') text += n.title || '';
    else if (n.nodeType === 1) text += copyMsgText(n);
  });
  return text;
}
let _ctxMenu = null;
function hideCtxMenu() { _ctxMenu?.remove(); _ctxMenu = null; }
document.addEventListener('click', hideCtxMenu);
document.addEventListener('contextmenu', function (e) {
  const bubble = e.target.closest('.msg-bubble');
  if (!bubble) { hideCtxMenu(); return; }
  const row = bubble.closest('.msg-row');
  if (!row) return;
  hideCtxMenu(); e.preventDefault();

  const container = document.getElementById('msg-container');
  if (!container) return;
  const msgIdx = Array.from(container.querySelectorAll('.msg-row')).indexOf(row);
  if (msgIdx < 0) return;

  const isGroup = !!currentGroup;
  const chatId = isGroup ? currentGroup : currentChat;
  const history = (isGroup ? groupHistories[chatId] : histories[chatId]) || [];
  let origIdx = -1, visible = 0;
  for (let i = 0; i < history.length; i++) {
    if (history[i].deleted || history[i].sender === 'system') continue;
    if (visible === msgIdx) { origIdx = i; break; }
    visible++;
  }
  if (origIdx < 0) return;

  const isVoice = history[origIdx].is_voice;
  const menu = document.createElement('div');
  menu.className = 'msg-context-menu';
  menu.style.top = e.clientY + 'px';
  menu.style.left = e.clientX + 'px';
  menu.innerHTML = (isVoice ? `<div class="ctx-item" id="ctx-t2t">转文字</div>` : '')
    + `<div class="ctx-item" id="ctx-copy">复制</div><div class="ctx-item" id="ctx-del">删除</div>`;

  menu.querySelector('#ctx-copy').onclick = () => {
    navigator.clipboard.writeText(isVoice ? history[origIdx].content : copyMsgText(bubble)).catch(() => {});
    hideCtxMenu();
  };
  menu.querySelector('#ctx-t2t')?.addEventListener('click', () => {
    history[origIdx].voice_shown = !history[origIdx].voice_shown;
    isGroup ? renderGroupChat(chatId) : renderMessages(chatId);
    hideCtxMenu();
  });
  menu.querySelector('#ctx-del').onclick = async () => {
    history[origIdx].deleted = true;
    await fetch(isGroup ? `/api/groups/${chatId}/delete_message` : `/api/history/${chatId}/delete`, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({msg_id: history[origIdx].id})
    });
    isGroup ? renderGroupChat(chatId) : renderMessages(chatId);
    renderChatList();
    hideCtxMenu();
  };
  document.body.appendChild(menu);
  _ctxMenu = menu;
  const r = menu.getBoundingClientRect();
  if (r.right > window.innerWidth) menu.style.left = (e.clientX - r.width) + 'px';
  if (r.bottom > window.innerHeight) menu.style.top = (e.clientY - r.height) + 'px';
});

// ---- Avatar drag & drop ----
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
      const d = await fetch('/api/upload_avatar', {method: 'POST', body: fd}).then(r => r.json());
      if (d.ok && d.path) { el.value = d.path; el.dispatchEvent(new Event('input')); }
    } catch (ex) {}
  });
}
setTimeout(() => { _setupAvatarDrop('sp-avatar-url'); _setupAvatarDrop('edit-avatar'); }, 100);

// ---- 搜索聊天记录 ----
// 侧栏搜索框搜的是**消息内容**（微信就是这样），不是联系人名字。
let _searchTimer = null, _searchData = null, _swChat = null;

function _hl(h) {   // 命中词标绿；三段都要转义
  return escapeHtml(h.pre) + `<span class="hl">${escapeHtml(h.hit)}</span>` + escapeHtml(h.post);
}
function _chatAvatar(c) {
  if (c.type === 'group') return renderGroupAvatarHTML({members: c.members || []}, 'sr-avatar');
  return `<div class="sr-avatar"><img src="${c.avatar}" onerror="this.src='${FALLBACK_AVATAR}'"></div>`;
}

function onSearchInput(q) {
  document.getElementById('search-clear').classList.toggle('show', q.trim().length > 0);
  clearTimeout(_searchTimer);
  if (!q.trim()) { hideSearchPanel(); return; }
  _searchTimer = setTimeout(() => runSearch(q.trim()), 180);
}

function clearSearch() {
  const el = document.getElementById('search-input');
  el.value = '';
  document.getElementById('search-clear').classList.remove('show');
  hideSearchPanel();
}
function hideSearchPanel() { document.getElementById('search-panel').classList.remove('show'); }

async function runSearch(q) {
  let d;
  try { d = await fetch('/api/search?q=' + encodeURIComponent(q)).then(r => r.json()); }
  catch (e) { return; }
  _searchData = d;
  const panel = document.getElementById('search-panel');
  const box = document.getElementById('search-box').getBoundingClientRect();
  panel.style.top = (box.bottom + 6) + 'px';
  panel.style.left = box.left + 'px';

  if (!d.chats.length) {
    panel.innerHTML = `<div class="sp-empty">没有找到「${escapeHtml(q)}」相关的聊天记录</div>`;
  } else {
    const rows = d.chats.slice(0, 3).map(c => {   // 微信下拉就显示 3 条，再多点「查看全部」
      const h = c.preview[0];
      return `<div class="sr-item" onclick="openSearchWindow('${c.id}')">
        ${_chatAvatar(c)}
        <div class="sr-main">
          <div class="sr-top"><div class="sr-name">${escapeHtml(c.name)}</div>
            <div class="sr-time">${fmtContactTime(c.latest_ts)}</div></div>
          <div class="sr-snip">${_hl(h)}</div>
          <div class="sr-count">共 <span class="hl">${c.count}</span> 条相关聊天记录</div>
        </div></div>`;
    }).join('');
    panel.innerHTML = `<div class="sp-group-title">聊天记录</div><div class="sp-divider"></div>${rows}`
      // 括号里是命中的**会话数**，不是消息总条数
      + `<div class="sp-more" onclick="openSearchWindow()">查看全部(${d.chats.length})</div>`;
  }
  panel.classList.add('show');
}

document.addEventListener('click', e => {
  if (!e.target.closest('#search-panel') && !e.target.closest('#search-box')) hideSearchPanel();
});

// ---- 「搜索聊天记录」窗口 ----
// 微信开的是一个真正的系统窗口（自带红绿灯和标题栏），不是页面内浮层，
// 所以原生模式下让 Python 那边 create_window；浏览器里退化成新标签页。
function openSearchWindow() {
  const q = document.getElementById('search-input').value.trim();
  if (!q) return;
  hideSearchPanel();
  if (window.pywebview && window.pywebview.api && window.pywebview.api.open_search_window) {
    window.pywebview.api.open_search_window(q);
  } else {
    window.open('/search_window?q=' + encodeURIComponent(q), '_blank');
  }
}

// init() 在 group-chat.js 末尾调用 —— 那时所有覆盖都已就位
