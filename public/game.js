const socket=io();
const $=s=>document.querySelector(s);
let view=null, joined=null, lobbyState=null;
const roleNames={red_spy:"🔴 红方 · 知晓者",red_guess:"🔴 红方 · 猜测者",blue_spy:"🔵 蓝方 · 知晓者",blue_guess:"🔵 蓝方 · 猜测者"};
const roles=Object.keys(roleNames);

const qp=new URLSearchParams(location.search);
if(qp.get("room")) $("#room").value=qp.get("room");

function toast(t){const x=$("#toast");x.textContent=t;x.style.display="block";setTimeout(()=>x.style.display="none",3200)}
function credentials(){return {name:$("#name").value.trim()}}
$("#create").onclick=()=>socket.emit("createRoom",credentials());
$("#join").onclick=()=>socket.emit("joinRoom",{...credentials(),roomId:$("#room").value.trim()});
$("#start").onclick=()=>socket.emit("startGame");
$("#sendClue").onclick=()=>socket.emit("sendClue",{word:$("#clueWord").value.trim(),num:+$("#clueNum").value});
$("#endTurn").onclick=()=>socket.emit("endTurn");
$("#restart").onclick=()=>{$("#modal").classList.add("hidden");socket.emit("restart")};

socket.on("errorMessage",toast);
socket.on("joined",data=>{
  joined=data;
  const old=JSON.parse(sessionStorage.getItem("wg_join")||"{}");
  sessionStorage.setItem("wg_join",JSON.stringify({...data,name:$("#name").value.trim()||old.name}));
  history.replaceState(null,"",`?room=${data.roomId}`);
  $("#roomBadge").textContent=`房间 ${data.roomId}`;
});
socket.on("roleChosen",({role})=>{
  if(joined) joined.role=role;
  const old=JSON.parse(sessionStorage.getItem("wg_join")||"{}");
  sessionStorage.setItem("wg_join",JSON.stringify({...old,role}));
});
socket.on("lobby",r=>{
  lobbyState=r;
  $("#home").classList.add("hidden");$("#game").classList.add("hidden");$("#lobby").classList.remove("hidden");
  $("#lobbyRoom").textContent=r.id;$("#roomBadge").textContent=`房间 ${r.id}`;
  $("#playerList").innerHTML=r.players.map(p=>`<div class="player ${p.connected?"":"offline"}"><span>${esc(p.name)}</span><span>${p.role?roleNames[p.role]:"⚪ 尚未选择"}${p.connected?"":" · 离线"}</span></div>`).join("");
  const picker=$("#rolePicker");picker.innerHTML="";
  roles.forEach(role=>{
    const owner=r.players.find(p=>p.role===role);
    const btn=document.createElement("button");
    btn.className="roleBtn"+(owner?" taken":"");
    if(joined?.role===role) btn.classList.add("mine");
    btn.textContent=owner?`${roleNames[role]} · ${owner.name}`:roleNames[role];
    btn.disabled=!!owner && joined?.role!==role;
    btn.onclick=()=>socket.emit("chooseRole",{role});
    picker.appendChild(btn);
  });
  $("#start").disabled=r.players.length!==4 || r.players.some(p=>!p.role) || new Set(r.players.map(p=>p.role)).size!==4;
});
socket.on("gameState",v=>{view=v;renderGame()});

function renderGame(){
  $("#home").classList.add("hidden");$("#lobby").classList.add("hidden");$("#game").classList.remove("hidden");
  const g=view.game,role=view.me.role,team=role.startsWith("red")?"red":"blue",spy=role.endsWith("_spy"),mine=g.turn===team;
  $("#roomBadge").textContent=`房间 ${view.roomId} · ${roleNames[role]}`;
  $("#redLeft").textContent=g.redLeft;$("#blueLeft").textContent=g.blueLeft;
  $("#turn").textContent=`${g.turn==="red"?"🔴 红方":"🔵 蓝方"}回合 · ${g.phase==="clue"?"等待提示":"正在猜词"}`;
  $("#clue").textContent=g.clue?`${g.clue.word} · ${g.clue.num}`:"等待知晓者出题";
  $("#clueForm").classList.toggle("hidden",!(spy&&mine&&g.phase==="clue"&&!g.winner));
  $("#endTurn").classList.toggle("hidden",!(!spy&&mine&&g.phase==="guess"&&!g.winner));
  $("#gamePlayers").innerHTML=view.players.map(p=>`<div class="${p.connected?"":"offline"}">${esc(p.name)} · ${roleNames[p.role]}${p.name===view.me.name&&p.role===role?" · 你":""}</div>`).join("");
  $("#log").innerHTML=[...g.log].reverse().map(x=>`• ${esc(x)}`).join("<br>");
  const b=$("#board");b.innerHTML="";
  g.words.forEach((w,i)=>{
    const c=document.createElement("div"),owner=g.owners[i];
    c.className="card";if(owner)c.classList.add(owner);if(g.revealed[i])c.classList.add("revealed");
    if(!spy&&mine&&g.phase==="guess"&&!g.revealed[i]&&!g.winner){c.classList.add("can");c.onclick=()=>socket.emit("guessWord",{index:i})}
    c.textContent=(g.revealed[i]&&owner==="death"?"💀 死亡 · ":"")+w;
    if(owner==="death" && (spy||g.revealed[i])){const mark=document.createElement("span");mark.className="deathMark";c.appendChild(mark)}
    b.appendChild(c);
  });
  if(g.winner){$("#winTitle").textContent=g.winner==="red"?"🔴 红方获胜":"🔵 蓝方获胜";$("#winText").textContent=g.endReason;$("#modal").classList.remove("hidden")}
}
function esc(s){return String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}

socket.on("connect",()=>{
  try{
    const old=JSON.parse(sessionStorage.getItem("wg_join")||"null");
    if(old?.roomId&&old?.token) socket.emit("joinRoom",{roomId:old.roomId,name:old.name||"玩家",token:old.token});
  }catch{}
});
