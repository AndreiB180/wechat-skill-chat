// ---- Group Chat ----
// State, avatar, functions, and overrides for group chat.
// Loads after chat.js — all shared helpers and state are available.

let groups = [];
let currentGroup = null;
let groupHistories = {};

// WeChat-style group avatar: square tiles arranged in grid, includes user's own avatar
// Grid cell layout (0-indexed row-major):
//   2×2: 0 1    3×3: 0 1 2
//         2 3         3 4 5
//                     6 7 8
// Which cells are filled per total count (user + members):
const _GRP_CELLS = {
  2: [0,1], 3: [1,2,3], 4: [0,1,2,3],
  5: [1,2,6,7,8], 6: [3,4,5,6,7,8], 7: [1,3,4,5,6,7,8], 8: [1,2,3,4,5,6,7,8], 9: [0,1,2,3,4,5,6,7,8]
};
function renderGroupAvatarHTML(group, cls) {
  cls = cls || 'c-avatar';
  const sz = cls === 'cp-avatar' ? 40 : 38;
  // Include user's own avatar as first member
  const userAv = document.getElementById('my-avatar-img')?.src || '';
  const memberAvs = (group.members || []).map(mid => {const s=skills.find(si=>si.id===mid); return s?s.avatar:'';});
  const allAvs = [userAv, ...memberAvs].slice(0, 9);
  const total = allAvs.length;
  if (total <= 1) return `<div class="${cls}" style="background:#07C160;display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px;font-weight:bold">群</div>`;
  const G = total <= 4 ? 2 : 3;
  const gap = 1, margin = 1;
  const tile = Math.floor((sz - margin*2 - gap*(G-1)) / G);
  const gridPx = tile * G + gap * (G-1);
  const off = Math.floor((sz - gridPx) / 2);
  const cells = _GRP_CELLS[total] || _GRP_CELLS[9];
  // Group cells by row, compute per-row centering
  const byRow = {}; for (const c of cells) { const r = Math.floor(c / G); if (!byRow[r]) byRow[r] = []; byRow[r].push(c); }
  let html = `<div class="${cls}" style="position:relative;overflow:hidden;background:#ddd">`;
  let idx = 0;
  for (const [row, rowCells] of Object.entries(byRow)) {
    const cnt = rowCells.length;
    const rowWidth = tile * cnt + gap * (cnt - 1);
    const rowStart = off + Math.floor((gridPx - rowWidth) / 2);
    for (let ci = 0; ci < cnt && idx < total; ci++) {
      const l = rowStart + ci * (tile + gap);
      const t = off + parseInt(row) * (tile + gap);
      html += `<img src="${allAvs[idx] || ''}" style="position:absolute;top:${t}px;left:${l}px;width:${tile}px;height:${tile}px;object-fit:cover" onerror="this.style.background='#ccc'">`;
      idx++;
    }
  }
  html += '</div>';
  return html;
}

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
    const rn=s.real_name&&s.real_name!==s.name?` (${s.real_name})`:''; d.innerHTML = `<input type="checkbox" style="width:16px;height:16px"><span style="font-size:13px">${s.name}${rn}</span>`;
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

async function openGroupChat(gid) {
  _attachedFiles = []; currentGroup = gid; currentChat = null;
  if (!groupHistories[gid]) {
    const d = await fetch('/api/groups/'+gid+'/history').then(r=>r.json());
    groupHistories[gid] = d || [];
  }
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
    <div class="chat-input-box" style="position:relative"><div class="emoji-picker" id="emoji-picker"></div><textarea id="msg-input" placeholder="输入消息... @某人" onkeydown="_enterKeyHandler(event, sendGroupMessage)" oninput="handleGroupInput(event)"></textarea>
    <button class="send-btn" id="send-btn" onclick="sendGroupMessage()">发送</button>
    <div id="mention-popup" style="display:none;position:absolute;bottom:60px;left:16px;background:#fff;border:1px solid #D9D9D9;border-radius:4px;box-shadow:0 2px 8px rgba(0,0,0,.1);z-index:100;max-height:200px;overflow-y:auto;width:160px"></div></div>
    <div class="call-popup-overlay" id="call-popup-overlay" onclick="closeCallPopup()"><div class="call-popup">你走火入魔了，还真想给ai打电话啊？</div></div>`;
  buildEmojiPicker();
  let html=''; const G=300;
  history.forEach((msg,i) => {
    if (msg.sender==='system') { const sts=msg.timestamp||0, prevSts=i>0?(history[i-1].timestamp||0):0; if(i===0||sts-prevSts>G)html+=`<div class="msg-time">${fmtDate(sts,true)}</div>`; html+=`<div class="msg-time">${msg.content}</div>`; return; }
    const ts=msg.timestamp||0, prevTs=i>0?(history[i-1].timestamp||0):0;
    if (i===0||ts-prevTs>G) { html+=`<div class="msg-time">${fmtDate(ts, true)}</div>`; }
    const isSelf=msg.sender==='user', sn=msg.sender_name||'';
    const c=skills.find(s=>s.id===msg.sender)||skills.find(s=>s.name===msg.sender_name);const av=c?.avatar||'';
    html+=`<div class="msg-row ${isSelf?'self':'other'}">`;
    if (!isSelf) {
      html+=`<div class="msg-avatar"><img src="${av}" onerror="this.style.background='#ddd'"></div>`;
      html+=`<div class="msg-content-wrap"><div class="msg-sender-name">${escapeHtml(sn)}</div><div class="msg-bubble">${renderEmoji(escapeHtml(msg.content))}</div></div>`;
    } else {
      html+=`<div class="msg-content-wrap"><div class="msg-bubble">${renderEmoji(escapeHtml(msg.content))}</div></div>`;
      html+=`<div class="msg-avatar"><img id="my-msg-avatar" src="${document.getElementById('my-avatar-img')?.src||''}"></div>`;
    }
    html+='</div>';
  });
  document.getElementById('msg-container').innerHTML=html;
  document.getElementById('msg-container').scrollTop=document.getElementById('msg-container').scrollHeight;
  renderAll();
  _setupResizeDrag();
}

async function sendGroupMessage() {
  if (!currentGroup) return;
  const input=document.getElementById('msg-input'), msg=input.value.trim(); if (!msg) return;
  const chatId=currentGroup, now=Date.now()/1000;
  let mention=null; const mm=msg.match(/^@(\S+)\s/);
  if (mm) { const name=mm[1]; if (name==='所有人') mention='all'; else { const grp=groups.find(g=>g.id===chatId); const mb=skills.find(s=>s.name===name&&grp?.members.includes(s.id)); if (mb) mention=mb.id; } }
  input.value=''; const btn=document.getElementById('send-btn'); btn.classList.add('active'); btn.textContent='...';

  // Optimistic UI
  const nick = document.getElementById('sp-nickname')?.value || '微信用户';
  if (!groupHistories[chatId]) groupHistories[chatId]=[];
  groupHistories[chatId].push({sender:'user',sender_name:nick,content:msg,time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),timestamp:now});
  if (currentGroup===chatId) renderGroupChat(chatId);
  renderAll();

  try{
    const res=await fetch('/api/groups/'+chatId+'/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,mention})});
    // Handle non-SSE error responses (e.g. Claude Code mode rejection)
    if (!res.ok) {
      const errData = await res.json().catch(()=>({error:'请求失败'}));
      groupHistories[chatId].push({sender:'system',content:errData.error||'请求失败',time:new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'}),timestamp:Date.now()/1000});
      if (currentGroup===chatId) renderGroupChat(chatId);
      renderAll();
      return;
    }
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
          if(d.done)break;
          groupHistories[chatId].push({sender:d.sender,sender_name:d.sender_name,content:d.content,time:d.time,timestamp:Date.now()/1000});
          if(currentGroup===chatId) renderGroupChat(chatId);
          renderAll();
        }
      }
    }
  }catch(e){console.error(e);}
  finally{
    if(currentGroup===chatId){btn.classList.remove('active');btn.textContent='发送';input.focus();}
  }
}

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
    const members=['所有人',...grp.members.map(mid=>{
      const s=skills.find(s=>s.id===mid);
      return s?{name:s.name,real_name:s.real_name||''}:{name:mid,real_name:''};
    })];
    const filtered=members.filter(n=>{
      if (typeof n==='string') return n.toLowerCase().includes(q);
      return n.name.toLowerCase().includes(q) || n.real_name.toLowerCase().includes(q);
    });
    if (filtered.length) {
      popup.style.display='block';
      popup.innerHTML=filtered.map(n=>{
        const label=typeof n==='string'?n:(n.real_name&&n.real_name!==n.name?`@${escapeHtml(n.name)} (${escapeHtml(n.real_name)})`:`@${escapeHtml(n.name)}`);
        const mentionName=typeof n==='string'?n:n.name;
        return `<div style="padding:6px 12px;cursor:pointer;font-size:13px" onmouseover="this.style.background='#F0F0F0'" onmouseout="this.style.background=''" onclick="selectMention('${mentionName}')">${label}</div>`;
      }).join('');
    }
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
  document.getElementById('edit-modal-title').textContent='修改群聊名称';
  document.getElementById('edit-name-label').textContent='群聊名称';
  document.getElementById('edit-name').value=g.name;
  document.getElementById('edit-avatar-group').style.display='none';
  document.getElementById('edit-realname-group').style.display='none';
  editingContact=gid; _editingGroup=true;
  document.getElementById('edit-modal').classList.add('show');
}
let _editingGroup=false;
const _originalSaveContact=saveContact;
saveContact=async function(){
  if (_editingGroup&&editingContact){
    const name=document.getElementById('edit-name').value.trim();
    await fetch('/api/groups/'+editingContact+'/rename',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name})});
    const g=groups.find(g=>g.id===editingContact); if (g) g.name=name;
    renderAll(); if (currentGroup===editingContact) renderGroupChat(editingContact);
    _editingGroup=false; closeModal(); return;
  }
  _originalSaveContact();
};

async function deleteGroup(gid) { if (!confirm('删除此群聊？')) return; await fetch('/api/groups/'+gid,{method:'DELETE'}); groups=groups.filter(g=>g.id!==gid); delete groupHistories[gid]; if (currentGroup===gid) { currentGroup=null; document.getElementById('chat-area').innerHTML='<div class="no-chat">选择一个聊天开始</div>'; } renderAll(); }

// Load groups + override render
const _originalInit=init;
init=async function(){
  await _originalInit();
  const s=await fetch('/api/settings').then(r=>r.json());
  if(s.nickname&&document.getElementById('sp-nickname'))document.getElementById('sp-nickname').value=s.nickname;
  // Load groups before first render
  const gd=await fetch('/api/groups').then(r=>r.json());
  groups=gd||[];
  // Preload all group histories
  await Promise.all(groups.map(async g=>{
    const d=await fetch('/api/groups/'+g.id+'/history').then(r=>r.json());
    groupHistories[g.id]=d||[];
  }));
  renderAll();
};

const _originalRenderChatList=renderChatList;
renderChatList=function(){
  const list=document.getElementById('chat-contact-list');if(!list)return;
  let items=[];
  skills.forEach(s=>{const h=histories[s.id]||[];let lastM=null;for(let i=h.length-1;i>=0;i--){if(!h[i].deleted){lastM=h[i];break;}}const lt=lastM?lastM.timestamp||0:0;items.push({type:'contact',id:s.id,name:s.name,avatar:s.avatar,lastMsg:lastM?lastM.content.substring(0,30):(s.default_note||''),lastTs:lt,lastTime:lt?fmtContactTime(lt):''});});
  groups.forEach(g=>{const h=groupHistories[g.id]||[];let lastM=null;for(let i=h.length-1;i>=0;i--){if(!h[i].deleted){lastM=h[i];break;}}const lt=lastM?lastM.timestamp||0:0;let lastMsg='';if(lastM){if(lastM.sender==='user'){lastMsg=lastM.content.substring(0,30);}else if(lastM.sender==='system'){lastMsg=lastM.content.substring(0,30);}else{lastMsg=(lastM.sender_name||'?')+': '+lastM.content.substring(0,30);}}items.push({type:'group',id:g.id,name:g.name,lastMsg:lastMsg,lastTs:lt,lastTime:lt?fmtContactTime(lt):'',groupRef:g});});
  items.sort((a,b)=>b.lastTs-a.lastTs);list.innerHTML='';
  items.forEach(item=>{const d=document.createElement('div');d.className='contact-item';
    if(item.type==='group'){d.onclick=()=>openGroupChat(item.id);if(currentGroup===item.id)d.classList.add('active');d.innerHTML=`${renderGroupAvatarHTML(item.groupRef)}<div class="c-info"><div class="c-name">${escapeHtml(item.name)}</div><div class="c-msg">${escapeHtml(item.lastMsg)}</div></div><div class="c-time">${item.lastTime}</div>`;}
    else {d.onclick=()=>openChat(item.id);d.id='item-'+item.id;if(currentChat===item.id)d.classList.add('active');d.innerHTML=`<div class="c-avatar"><img src="${item.avatar}" onerror="this.style.background='#ddd';this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 38 38%22%3E%3Ccircle cx=%2219%22 cy=%2213%22 r=%228%22 fill=%22%23ccc%22/%3E%3Cellipse cx=%2219%22 cy=%2233%22 rx=%2212%22 ry=%229%22 fill=%22%23ccc%22/%3E%3C/svg%3E'"></div><div class="c-info"><div class="c-name">${item.name}</div><div class="c-msg">${escapeHtml(item.lastMsg)}</div></div><div class="c-time">${item.lastTime}</div>`;}
    list.appendChild(d);
  });
};

const _originalRenderContactsDetail=renderContactsDetail;
renderContactsDetail=function(){_originalRenderContactsDetail();const c=document.getElementById('contacts-detail-list');if(!c)return;groups.forEach(g=>{const d=document.createElement('div');d.className='cp-item';d.innerHTML=`${renderGroupAvatarHTML(g,'cp-avatar')}<span class="cp-name" onclick="openGroupRenameModal('${g.id}')">${g.name}</span><span class="cp-action" onclick="clearGroupHistory('${g.id}')">清空聊天</span><span class="cp-del" onclick="deleteGroup('${g.id}')">删除</span>`;c.appendChild(d);});};
async function clearGroupHistory(gid){if(!confirm('清空该群聊的聊天记录？'))return;await fetch('/api/groups/'+gid+'/clear',{method:'POST'});delete groupHistories[gid];if(currentGroup===gid)renderGroupChat(gid);renderAll();}


// Override renderGroupChat to skip deleted messages
const __origRenderGroupChat = renderGroupChat;
renderGroupChat = function(gid) { _renderSkipDeleted(groupHistories, gid, __origRenderGroupChat); };

init();
