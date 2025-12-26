/* =========================================
   うちの犬 お散歩ダッシュ（障害物よけ）
   main.js（背景：青空＆草原＆雲 / 障害物：木の柵）
   ========================================= */

// ===== DOM =====
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const dogFile = document.getElementById("dogFile");
const startBtn = document.getElementById("startBtn");
const retryBtn = document.getElementById("retryBtn");

const scoreEl = document.getElementById("score");
const timeEl = document.getElementById("time");
const resultEl = document.getElementById("result");

// ある場合だけ拾う（UIが多少違っても落ちないように）
const shareText = document.getElementById("shareText");         // textarea（任意）
const copyBtn = document.getElementById("btnCopyShare");        // 投稿文コピー（任意）
const saveBtn = document.getElementById("btnSaveCard");         // 結果カード保存（任意）
const resultCardCanvas = document.getElementById("resultCardCanvas"); // 結果カードcanvas（任意）

// ===== ゲーム定数 =====
const GAME_TIME = 20.0;
const GRAVITY = 2200;
const JUMP_V = 860;
const MOVE_SPEED = 520;

const GROUND_Y = 300;

// ===== 状態 =====
let running = false;
let ended = false;

let timeLeft = GAME_TIME;
let score = 0;

let keys = { left:false, right:false };

const player = {
  x: 120,
  y: GROUND_Y,
  w: 48,
  h: 48,
  vy: 0,
  onGround: true,
  jumpCount: 0,
};

let obstacles = [];
let spawnTimer = 0;

// 速度（※ここを触ると体感変わるので固定）
const OB_SPEED = 360; // px/sec
const OB_MIN = 0.55;  // sec
const OB_MAX = 1.10;  // sec

// ===== 犬画像 =====
const dogImg = new Image();
let dogImgReady = false;

dogImg.onload = () => { dogImgReady = true; };
dogImg.onerror = () => { dogImgReady = false; };

// 初期のデフォルト（何も選ばれてない時でも表示しやすい）
dogImg.src = "";

// ===== 背景（空・草原・雲） =====
let bgTime = 0;
let clouds = [];
let frameDt = 0;

function initClouds(){
  const n = 7;
  clouds = [];
  for(let i=0;i<n;i++){
    clouds.push({
      x: Math.random()*canvas.width,
      y: 30 + Math.random()*110,
      s: 0.7 + Math.random()*1.2,
      v: 12 + Math.random()*18,
    });
  }
}

function drawCloud(x,y,scale=1){
  ctx.save();
  ctx.translate(x,y);
  ctx.scale(scale,scale);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.beginPath();
  ctx.arc(18, 22, 18, 0, Math.PI*2);
  ctx.arc(42, 18, 22, 0, Math.PI*2);
  ctx.arc(66, 24, 18, 0, Math.PI*2);
  ctx.arc(46, 32, 22, 0, Math.PI*2);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 0.10;
  ctx.fillStyle = "#0b1220";
  ctx.beginPath();
  ctx.ellipse(44, 42, 44, 10, 0, 0, Math.PI*2);
  ctx.fill();

  ctx.restore();
}

function drawBackground(dt){
  // 空
  const g = ctx.createLinearGradient(0,0,0,canvas.height);
  g.addColorStop(0, "#8bd3ff");
  g.addColorStop(0.55, "#4aa7ff");
  g.addColorStop(1, "#0b4b8a");
  ctx.fillStyle = g;
  ctx.fillRect(0,0,canvas.width,canvas.height);

  // 太陽
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#fff3b0";
  ctx.beginPath();
  ctx.arc(canvas.width-90, 80, 46, 0, Math.PI*2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // 雲
  bgTime += dt;
  for(const c of clouds){
    c.x -= c.v * dt;
    if(c.x < -120) c.x = canvas.width + 120 + Math.random()*160;
    drawCloud(c.x, c.y, c.s);
  }

  // 遠景の丘
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#1d8a4a";
  ctx.beginPath();
  ctx.ellipse(140, canvas.height-40, 240, 90, 0, 0, Math.PI*2);
  ctx.ellipse(520, canvas.height-46, 300, 110, 0, 0, Math.PI*2);
  ctx.ellipse(820, canvas.height-38, 260, 95, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // 草地
  const grassY = GROUND_Y + player.h;
  const gg = ctx.createLinearGradient(0, grassY-40, 0, canvas.height);
  gg.addColorStop(0, "#3bd36b");
  gg.addColorStop(1, "#147a3b");
  ctx.fillStyle = gg;
  ctx.fillRect(0, grassY, canvas.width, canvas.height - grassY);

  // 地面の流れる筋（スピード感）
  ctx.globalAlpha = 0.20;
  ctx.fillStyle = "#0f5f30";
  const stripeH = 6;
  const speed = 160;
  const off = (bgTime*speed) % 80;
  for(let x=-80; x<canvas.width+80; x+=80){
    ctx.fillRect(x - off, grassY + 18, 40, stripeH);
    ctx.fillRect(x - off + 18, grassY + 48, 34, stripeH);
  }
  ctx.globalAlpha = 1;
}

// ===== 障害物（木の柵） =====
function drawFence(o){
  const x = o.x, y = o.y, w = o.w, h = o.h;

  // 影
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#000";
  ctx.fillRect(x+2, y+h-6, w, 6);
  ctx.globalAlpha = 1;

  const wood = ctx.createLinearGradient(x, y, x+w, y+h);
  wood.addColorStop(0, "#b68652");
  wood.addColorStop(0.5, "#a46f3d");
  wood.addColorStop(1, "#8a5a2f");

  const postW = Math.max(6, Math.floor(w*0.22));
  ctx.fillStyle = wood;

  // 柱
  ctx.fillRect(x, y, postW, h);
  ctx.fillRect(x+w-postW, y, postW, h);

  // 横板
  const railH = Math.max(6, Math.floor(h*0.22));
  const railPad = Math.floor(postW*0.6);
  ctx.fillRect(x+railPad, y+Math.floor(h*0.22), w-railPad*2, railH);
  ctx.fillRect(x+railPad, y+Math.floor(h*0.56), w-railPad*2, railH);

  // 釘
  ctx.fillStyle = "rgba(20,10,0,0.35)";
  for(const px of [x+postW-3, x+w-postW+3]){
    for(const py of [y+Math.floor(h*0.30), y+Math.floor(h*0.64)]){
      ctx.beginPath();
      ctx.arc(px, py, 2, 0, Math.PI*2);
      ctx.fill();
    }
  }

  // 縁
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x+1, y+1, w-2, h-2);
}

// ===== 便利 =====
function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function rectHit(a,b){
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}

function setResult(text){
  if(resultEl) resultEl.textContent = text;
}

function updateHUD(){
  scoreEl.textContent = String(score);
  timeEl.textContent = String(Math.max(0, timeLeft).toFixed(1));
}

// ===== 入力 =====
function jump(){
  if(!running || ended) return;

  if(player.onGround){
    player.vy = -JUMP_V;
    player.onGround = false;
    player.jumpCount = 1;
    return;
  }
  // 2段ジャンプ
  if(player.jumpCount < 2){
    player.vy = -JUMP_V * 0.92;
    player.jumpCount++;
  }
}

window.addEventListener("keydown", (e) => {
  if(e.code === "ArrowLeft" || e.code === "KeyA") keys.left = true;
  if(e.code === "ArrowRight" || e.code === "KeyD") keys.right = true;
  if(e.code === "Space") { e.preventDefault(); jump(); }
});

window.addEventListener("keyup", (e) => {
  if(e.code === "ArrowLeft" || e.code === "KeyA") keys.left = false;
  if(e.code === "ArrowRight" || e.code === "KeyD") keys.right = false;
});

canvas.addEventListener("pointerdown", () => jump());

// ===== 画像読み込み =====
dogFile?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if(!file) return;
  const url = URL.createObjectURL(file);
  dogImgReady = false;
  dogImg.onload = () => {
    dogImgReady = true;
    URL.revokeObjectURL(url);
  };
  dogImg.onerror = () => {
    dogImgReady = false;
    URL.revokeObjectURL(url);
  };
  dogImg.src = url;
});

// ===== ゲーム制御 =====
function resetGame(){
  running = false;
  ended = false;
  timeLeft = GAME_TIME;
  score = 0;

  player.x = 120;
  player.y = GROUND_Y;
  player.vy = 0;
  player.onGround = true;
  player.jumpCount = 0;

  obstacles = [];
  spawnTimer = 0;

  // 背景初期化
  bgTime = 0;
  initClouds();

  updateHUD();
  setResult("");

  if(shareText) shareText.value = "";
}

function startGame(){
  resetGame();
  running = true;
}

function endGame(reason="TIMEUP"){
  if(ended) return;
  ended = true;
  running = false;

  const rank = calcRank(score);
  const title = rankTitle(rank, score);

  const resText = `SCORE ${score}（${reason==="HIT" ? "ドボン" : "完走"}）`;
  setResult(resText);

  // 拡散用文面
  const share = makeShareText(score, rank, title, reason);
  if(shareText) shareText.value = share;

  // 結果カード描画
  drawResultCard({
    score,
    rank,
    title,
    reason,
    dogReady: dogImgReady,
  });

  updateHUD();
}

startBtn?.addEventListener("click", startGame);
retryBtn?.addEventListener("click", startGame);

// ===== 障害物生成 =====
function spawnObstacle(){
  obstacles.push({
    x: canvas.width + 10,
    y: GROUND_Y + player.h - 40, // 地面上に置く
    w: 32,
    h: 40,
    passed:false,
  });
}

// ===== ランク/称号/煽り文 =====
function calcRank(s){
  if(s >= 1200) return "SSS";
  if(s >= 900) return "SS";
  if(s >= 650) return "S";
  if(s >= 450) return "A";
  if(s >= 300) return "B";
  if(s >= 180) return "C";
  return "D";
}

function rankTitle(rank, s){
  const map = {
    "SSS":"天才回避犬",
    "SS":"神回避犬",
    "S":"疾風回避犬",
    "A":"上手い犬",
    "B":"なかなか犬",
    "C":"起きたて犬",
    "D":"寝起き犬",
  };
  return map[rank] || "犬";
}

function spicyLine(rank, reason){
  if(reason === "HIT"){
    const hit = [
      "柵に激突…でも伸びしろしかない。",
      "当たった…だが挑戦はここから。",
      "ドボン！次は“回避犬”になろう。",
    ];
    return hit[Math.floor(Math.random()*hit.length)];
  }
  const ok = [
    "完走！この安定感、年末ラリー向き。",
    "完走お見事。回避力は正義。",
    "最後まで逃げ切った。強い。",
  ];
  return ok[Math.floor(Math.random()*ok.length)];
}

function makeShareText(s, rank, title, reason){
  const line = spicyLine(rank, reason);
  return `🐶 うちの犬 お散歩ダッシュ！（障害物よけ）\n` +
         `RANK ${rank}：${title}\n` +
         `SCORE ${s}（${reason==="HIT" ? "ドボン" : "完走"}）\n` +
         `${line}\n\n` +
         `#うちの犬チャレンジ #お散歩ダッシュ`;
}

// ===== ループ =====
let lastTs = 0;

function update(dt){
  if(!running || ended) return;

  timeLeft -= dt;
  if(timeLeft <= 0){
    timeLeft = 0;
    endGame("TIMEUP");
    return;
  }

  // 左右移動
  let vx = 0;
  if(keys.left) vx -= MOVE_SPEED;
  if(keys.right) vx += MOVE_SPEED;
  player.x = clamp(player.x + vx*dt, 0, canvas.width - player.w);

  // 重力
  player.vy += GRAVITY * dt;
  player.y += player.vy * dt;

  // 地面
  const groundTop = GROUND_Y;
  if(player.y >= groundTop){
    player.y = groundTop;
    player.vy = 0;
    player.onGround = true;
    player.jumpCount = 0;
  }else{
    player.onGround = false;
  }

  // 障害物出現
  spawnTimer += dt;
  const next = OB_MIN + Math.random()*(OB_MAX - OB_MIN);
  if(spawnTimer >= next){
    spawnTimer = 0;
    spawnObstacle();
  }

  // 障害物移動＆判定
  for(const o of obstacles){
    o.x -= OB_SPEED * dt;

    // 通過でスコア
    if(!o.passed && o.x + o.w < player.x){
      o.passed = true;
      score += 10;
    }

    // ヒット
    if(rectHit(player, o)){
      endGame("HIT");
      return;
    }
  }

  // 画面外を捨てる
  obstacles = obstacles.filter(o => o.x + o.w > -40);

  updateHUD();
}

function draw() {
  // 背景（空・雲・草原）
  drawBackground(frameDt);

  // プレイヤーの影
  const groundY = GROUND_Y + player.h;
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.ellipse(player.x + player.w*0.5, groundY + 6, player.w*0.38, 6, 0, 0, Math.PI*2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // 障害物（木の柵）
  for (const o of obstacles) {
    drawFence(o);
  }

  // 犬（画像 or 絵文字）
  if (dogImgReady) {
    const r = 10;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(player.x + r, player.y);
    ctx.arcTo(player.x + player.w, player.y, player.x + player.w, player.y + player.h, r);
    ctx.arcTo(player.x + player.w, player.y + player.h, player.x, player.y + player.h, r);
    ctx.arcTo(player.x, player.y + player.h, player.x, player.y, r);
    ctx.arcTo(player.x, player.y, player.x + player.w, player.y, r);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(dogImg, player.x, player.y, player.w, player.h);
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 2;
    ctx.strokeRect(player.x, player.y, player.w, player.h);
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.font = "28px system-ui, sans-serif";
    ctx.fillText("🐶", player.x + 4, player.y + 30);
  }

  // ヒント
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(14, 14, 240, 26);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#ffffff";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText("←→ or A/Dで移動 / クリック・Spaceでジャンプ", 22, 32);
}

function loop(ts){
  if(!lastTs) lastTs = ts;
  const dt = Math.min(0.033, (ts - lastTs) / 1000);
  frameDt = dt;
  lastTs = ts;

  update(dt);
  draw();

  requestAnimationFrame(loop);
}

// ===== 結果カード描画 =====
function drawResultCard({score, rank, title, reason, dogReady}){
  if(!resultCardCanvas) return;
  const c = resultCardCanvas.getContext("2d");

  c.clearRect(0,0,1200,630);

  // 背景
  const bg = c.createLinearGradient(0,0,0,630);
  bg.addColorStop(0, "#0b1b3a");
  bg.addColorStop(1, "#071024");
  c.fillStyle = bg;
  c.fillRect(0,0,1200,630);

  // タイトル
  c.fillStyle = "#fff";
  c.font = "800 56px system-ui, sans-serif";
  c.fillText("うちの犬 お散歩ダッシュ", 64, 110);

  // スコア
  c.font = "900 88px system-ui, sans-serif";
  c.fillText(`SCORE ${score}`, 64, 260);

  // ランク
  c.font = "900 100px system-ui, sans-serif";
  c.fillText(`${rank}`, 64, 380);

  c.font = "800 40px system-ui, sans-serif";
  c.fillStyle = "rgba(255,255,255,0.90)";
  c.fillText(`${title}`, 64, 450);

  c.font = "700 28px system-ui, sans-serif";
  c.fillStyle = "rgba(255,255,255,0.75)";
  c.fillText(`#うちの犬チャレンジ  #お散歩ダッシュ`, 64, 560);

  // 犬画像（右側）
  if(dogReady){
    // 角丸枠
    const x=860, y=210, w=260, h=260, r=32;
    c.save();
    c.beginPath();
    c.moveTo(x+r, y);
    c.arcTo(x+w, y, x+w, y+h, r);
    c.arcTo(x+w, y+h, x, y+h, r);
    c.arcTo(x, y+h, x, y, r);
    c.arcTo(x, y, x+w, y, r);
    c.closePath();
    c.clip();
    c.drawImage(dogImg, x, y, w, h);
    c.restore();

    c.strokeStyle = "rgba(255,255,255,0.25)";
    c.lineWidth = 6;
    c.strokeRect(x, y, w, h);
  }else{
    c.font = "120px system-ui, sans-serif";
    c.fillStyle = "#fff";
    c.fillText("🐶", 930, 380);
  }
}

// ===== 拡散UI =====
copyBtn?.addEventListener("click", async () => {
  try{
    await navigator.clipboard.writeText(shareText?.value || "");
  }catch(e){}
});

saveBtn?.addEventListener("click", () => {
  if(!resultCardCanvas) return;
  const a = document.createElement("a");
  a.href = resultCardCanvas.toDataURL("image/png");
  a.download = "dog-dash-result.png";
  a.click();
});

// 初期化
resetGame();
requestAnimationFrame(loop);
