const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { pinyin } = require("pinyin-pro");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingTimeout: 20000 });

app.use(express.static("public"));

const PORT = process.env.PORT || 3000;
const rooms = new Map();

const WORDS = [
"苹果","火山","医生","月亮","钢琴","沙漠","企鹅","火车","皇冠","咖啡","森林","机器人","钥匙","海盗","闪电",
"学校","钻石","长城","雨伞","卫星","熊猫","城堡","面包","鲸鱼","机场","镜子","律师","篮球","玫瑰","电脑",
"雪山","船长","蜡烛","马戏团","相机","桥梁","恐龙","蜂蜜","宇宙","厨师","邮票","河流","风筝","宝剑","图书馆",
"太阳","猫","地图","钟表","冰箱","电影","潜水艇","国王","医院","花园","吉他","狮子","云朵","火箭","巧克力",
"灯塔","大象","奶酪","沙发","瀑布","侦探","戒指","海滩","眼镜","自行车","面具","饼干","星星","地铁","博物馆"
];

const ROLE_ORDER = ["red_spy","red_guess","blue_spy","blue_guess"];
const ROLE_NAME = {
  red_spy:"红方知晓者", red_guess:"红方猜测者",
  blue_spy:"蓝方知晓者", blue_guess:"蓝方猜测者"
};

function shuffle(a) {
  a = [...a];
  for (let i=a.length-1;i>0;i--) {
    const j=Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}
function code() {
  let c;
  do c=String(Math.floor(100000+Math.random()*900000)); while(rooms.has(c));
  return c;
}
function teamOf(role){ return role?.startsWith("red") ? "red" : role?.startsWith("blue") ? "blue" : null; }
function roomOf(socket){ return rooms.get(socket.data.roomId); }

function lobbyView(room) {
  return {
    id: room.id,
    players: room.players.map(p=>({name:p.name, role:p.role, connected:p.connected})),
    started: !!room.game
  };
}
function remaining(game, team) {
  return game.owners.reduce((n,o,i)=>n+(o===team && !game.revealed[i] ? 1:0),0);
}
function playerView(room, player) {
  const g=room.game;
  const spy=player.role.endsWith("_spy");
  return {
    roomId:room.id,
    me:{name:player.name,role:player.role},
    players:room.players.map(p=>({name:p.name,role:p.role,connected:p.connected})),
    game:{
      words:g.words,
      revealed:g.revealed,
      // Only spies receive the secret map. Guessers get null for unrevealed cards.
      owners:g.owners.map((o,i)=> spy || g.revealed[i] ? o : null),
      turn:g.turn,
      phase:g.phase,
      clue:g.clue,
      redLeft:remaining(g,"red"),
      blueLeft:remaining(g,"blue"),
      winner:g.winner,
      endReason:g.endReason,
      log:g.log.slice(-30)
    }
  };
}
function emitLobby(room){ io.to(room.id).emit("lobby", lobbyView(room)); }
function emitGame(room){
  for (const p of room.players) {
    if (!p.socketId) continue;
    const s=io.sockets.sockets.get(p.socketId);
    if (s) s.emit("gameState", playerView(room,p));
  }
}
function fail(socket,msg){ socket.emit("errorMessage",msg); }

function addPlayer(socket, room, name, token) {
  name=String(name||"").trim().slice(0,16);
  if(!name) return fail(socket,"请输入玩家名。");

  if(token){
    const old=room.players.find(p=>p.token===token);
    if(old){
      old.socketId=socket.id; old.connected=true;
      socket.data.roomId=room.id; socket.data.token=token;
      socket.join(room.id);
      socket.emit("joined",{roomId:room.id,token:old.token,role:old.role});
      room.game ? emitGame(room) : emitLobby(room);
      return;
    }
  }

  if(room.game) return fail(socket,"游戏已经开始。");
  if(room.players.length>=4) return fail(socket,"房间已满。");
  const p={name,role:null,token:cryptoRandom(),socketId:socket.id,connected:true};
  room.players.push(p);
  socket.data.roomId=room.id; socket.data.token=p.token;
  socket.join(room.id);
  socket.emit("joined",{roomId:room.id,token:p.token,role:null});
  emitLobby(room);
}
function cryptoRandom(){
  return [...Array(4)].map(()=>Math.random().toString(36).slice(2)).join("");
}
function newGame(){
  const words=shuffle(WORDS).slice(0,25);
  const first=Math.random()<.5?"red":"blue";
  let owners=[
    ...Array(first==="red"?9:8).fill("red"),
    ...Array(first==="blue"?9:8).fill("blue"),
    "death",
    ...Array(7).fill("neutral")
  ];
  owners=shuffle(owners);
  return {
    words, owners, revealed:Array(25).fill(false),
    turn:first, phase:"clue", clue:null, winner:null, endReason:null,
    log:[`${first==="red"?"红":"蓝"}方拥有 9 个目标词并先手。`]
  };
}
function currentPlayer(socket, room){
  return room.players.find(p=>p.token===socket.data.token);
}
function switchTurn(g){
  g.turn=g.turn==="red"?"blue":"red";
  g.phase="clue"; g.clue=null;
}


function normText(s){
  return String(s||"").trim().toLowerCase().replace(/[\s\-_，。！？、,.!?'"“”‘’]/g,"");
}
function py(s){
  return pinyin(String(s||""), { toneType:"none", type:"array" })
    .join("").toLowerCase().replace(/[^a-z0-9üv]/g,"").replace(/ü/g,"v");
}
function invalidClue(word, words){
  const n=normText(word), cluePy=py(word);
  if(!n) return "提示词不能为空。";
  for(const boardWord of words){
    const b=normText(boardWord);
    if(n===b || n.includes(b) || b.includes(n))
      return `提示词不能与场上的「${boardWord}」相同、包含或被其包含。`;
    if(cluePy && cluePy===py(boardWord))
      return `提示词不能与场上的「${boardWord}」拼音相同。`;
  }
  return null;
}

io.on("connection", socket=>{
  socket.on("createRoom", ({name})=>{
    const id=code();
    const room={id,players:[],game:null};
    rooms.set(id,room);
    addPlayer(socket,room,name);
  });

  socket.on("joinRoom", ({roomId,name,token})=>{
    roomId=String(roomId||"").trim();
    const room=rooms.get(roomId);
    if(!room) return fail(socket,"房间不存在。");
    addPlayer(socket,room,name,token);
  });

  socket.on("chooseRole", ({role})=>{
    const room=roomOf(socket), p=room&&currentPlayer(socket,room);
    if(!room||!p||room.game) return;
    if(!ROLE_ORDER.includes(role)) return fail(socket,"请选择有效角色。");
    if(room.players.some(x=>x!==p && x.role===role)) return fail(socket,"这个位置已经有人选择了。");
    p.role=role;
    socket.emit("roleChosen",{role});
    emitLobby(room);
  });

  socket.on("startGame", ()=>{
    const room=roomOf(socket); if(!room) return;
    if(room.players.length!==4) return fail(socket,"需要 4 位玩家才能开始。");
    if(room.players.some(p=>!p.role) || new Set(room.players.map(p=>p.role)).size!==4) return fail(socket,"请先让四位玩家各自选择一个不同的阵营角色。");
    room.game=newGame();
    emitGame(room);
  });

  socket.on("sendClue", ({word,num})=>{
    const room=roomOf(socket), p=room&&currentPlayer(socket,room), g=room?.game;
    if(!p||!g||g.winner) return;
    const team=teamOf(p.role);
    if(!p.role.endsWith("_spy")||g.turn!==team||g.phase!=="clue") return fail(socket,"现在不能发送提示。");
    word=String(word||"").trim().slice(0,20); num=Number(num);
    if(!word||!Number.isInteger(num)||num<1||num>9) return fail(socket,"请输入有效的提示词和数字（1-9）。");
    const clueError=invalidClue(word,g.words);
    if(clueError) return fail(socket,clueError);
    g.clue={word,num}; g.phase="guess";
    g.log.push(`${team==="red"?"红":"蓝"}方提示：${word} · ${num}`);
    emitGame(room);
  });

  socket.on("guessWord", ({index})=>{
    const room=roomOf(socket), p=room&&currentPlayer(socket,room), g=room?.game;
    if(!p||!g||g.winner) return;
    const team=teamOf(p.role);
    index=Number(index);
    if(!p.role.endsWith("_guess")||g.turn!==team||g.phase!=="guess") return fail(socket,"现在不能猜词。");
    if(!Number.isInteger(index)||index<0||index>=25||g.revealed[index]) return fail(socket,"这个词不能选择。");

    g.revealed[index]=true;
    const owner=g.owners[index], word=g.words[index];
    g.log.push(`${team==="red"?"红":"蓝"}方选择「${word}」。`);

    if(owner==="death"){
      g.winner=team==="red"?"blue":"red";
      g.endReason=`${team==="red"?"红":"蓝"}方猜中了死亡词「${word}」。`;
    } else if(remaining(g,team)===0){
      g.winner=team;
      g.endReason=`${team==="red"?"红":"蓝"}方找出了全部目标词。`;
    } else if(owner!==team){
      g.log.push("猜错，回合转移。");
      switchTurn(g);
    }
    emitGame(room);
  });

  socket.on("endTurn", ()=>{
    const room=roomOf(socket), p=room&&currentPlayer(socket,room), g=room?.game;
    if(!p||!g||g.winner) return;
    const team=teamOf(p.role);
    if(!p.role.endsWith("_guess")||g.turn!==team||g.phase!=="guess") return fail(socket,"现在不能结束回合。");
    g.log.push(`${team==="red"?"红":"蓝"}方主动结束回合。`);
    switchTurn(g); emitGame(room);
  });

  socket.on("restart", ()=>{
    const room=roomOf(socket); if(!room||!room.game) return;
    if(room.players.length!==4) return fail(socket,"需要 4 位玩家。");
    room.game=newGame(); emitGame(room);
  });

  socket.on("disconnect", ()=>{
    const room=roomOf(socket); if(!room) return;
    const p=currentPlayer(socket,room);
    if(p){ p.connected=false; p.socketId=null; }
    room.game ? emitGame(room) : emitLobby(room);
    // Empty, unstarted rooms are cleaned up.
    if(!room.game && room.players.every(p=>!p.connected)) rooms.delete(room.id);
  });
});

server.listen(PORT, ()=>console.log(`Word game running on http://localhost:${PORT}`));
