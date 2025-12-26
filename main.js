/* =========================================
   うちの犬 お散歩ダッシュ（障害物よけ）
   main.js（安定版：左右移動/ジャンプ/障害物/リトライ/結果カードに犬画像）
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

const shareText = document.getElementById("shareText");
const copyBtn = document.getElementById("btnCopyShare");
const saveBtn = document.getElementById("btnSaveCard");
const copyToast = document.getElementById("copyToast");

const resultCardCanvas = document.getElementById("resultCardCanvas");

// ===== サイズ =====
const W = canvas.width;
const H = canvas.height;

// ===== ゲーム定数 =====
const GAME_TIME = 20.0;

// 地面：見た目と当たり判定を安定させる
const GROUND_H = 18;                 // 地面の厚み（見た目）
const GROUND_Y = H - GROUND_H;       // 地面の上端Y

const GRAVITY = 0.9;
const JUMP_V = -14.0;

const MOVE_SPEED = 5.0;              // 左右移動速度
const SCROLL_SPEED = 4.0;            // 障害物の流れる速度（速すぎない）

const OB_MIN_GAP = 0.9;              // 出現間隔（秒）下限
const OB_MAX_GAP = 1.5;              // 出現間隔（秒）上限

// ===== 状態 =====
let running = false;
let ended = false;
let score = 0;
let timeLeft = GAME_TIME;
let lastTs = 0;

// ===== 犬画像 =====
let dogImg = new Image();
let dogReady = false;
let dogDataURL = null;

// ===== 入力 =====
const input = {
  left: false,
  right: false,
};

// ===== プレイヤー =====
const player = {
  x: 120,
  y: 0,        // resetGameで入れる
  w: 52,
  h: 52,
  vy: 0,
  onGround: true,
};

// ===== 障害物 =====
let obstacles = [];
let spawnTimer = 0;

// ===== ユーティリティ =====
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function rand(min, max) { return min + Math.random() * (max - min); }

// ===== 初期化 =====
function resetGame() {
  running = false;
  ended = false;
  score = 0;
  timeLeft = GAME_TIME;
  lastTs = 0;

  player.x = 120;
  player.y = GROUND_Y - player.h;
  player.vy = 0;
  player.onGround = true;

  obstacles = [];
  spawnTimer = rand(OB_MIN_GAP, OB_MAX_GAP);

  scoreEl.textContent = "0";
  timeEl.textContent = GAME_TIME.toFixed(1);
  resultEl.textContent = "";
  if (shareText) shareText.value = "";
}

// ===== スタート =====
function startGame() {
  resetGame();
  running = true;
  requestAnimationFrame(loop);
}

// ===== ランク/称号/煽り文 =====
function judgeRank(s) {
  // ざっくりで中毒性優先（調整しやすい）
  if (s >= 1200) return { rank:"SSS", title:"天才回避犬", taunt:"反射神経バグ。今日も勝ち。" };
  if (s >= 900)  return { rank:"SS",  title:"回避職人",   taunt:"はい優勝。壁を越えた。" };
  if (s >= 600)  return { rank:"S",   title:"俊足の犬",   taunt:"これは拡散案件。強い。" };
  if (s >= 300)  return { rank:"A",   title:"デキる犬",   taunt:"上手い。次はS狙い。" };
  if (s >= 100)  return { rank:"B",   title:"やる犬",     taunt:"伸びしろしかない。" };
  if (s >= 10)   return { rank:"C",   title:"起きたて犬", taunt:"まだ寝ぼけてる説。" };
  return          { rank:"D",   title:"ドボン",     taunt:"まずはジャンプ練習から！" };
}

// ===== 終了 =====
function endGame(reason = "finish") {
  if (ended) return;
  ended = true;
  running = false;

  // ぶつかったら即終了（TIMEを0扱いにしたいならここで0に）
  if (reason === "hit") timeLeft = 0;
  if (timeLeft < 0) timeLeft = 0;

  // 表示更新
  scoreEl.textContent = String(score);
  timeEl.textContent = timeLeft.toFixed(1);

  const j = judgeRank(score);
  resultEl.textContent = `SCORE ${score}（${j.rank}：${j.title}）`;

  // 投稿文
  const share =
`🐶 うちの犬 お散歩ダッシュ（障害物よけ）
RANK ${j.rank}：${j.title}
SCORE ${score}
${j.taunt}

あなたの犬でも挑戦してみて👇
#うちの犬チャレンジ #お散歩ダッシュ`;

  if (shareText) shareText.value = share;

  // 結果カード生成（犬画像を必ず反映）
  drawResultCard(j);
}

// ===== 犬画像読み込み =====
dogFile?.addEventListener("change", (e) => {
  const file = e.target.files?.[0];
  if (!file) return;

  const r = new FileReader();
  r.onload = () => {
    dogDataURL = r.result;

    // 新しい画像に差し替え時は一旦falseにしてからonloadでtrue
    dogReady = false;
    dogImg = new Image();
    dogImg.onload = () => { dogReady = true; };
    dogImg.src = dogDataURL;
  };
  r.readAsDataURL(file);
});

// ===== 入力（キーボード） =====
window.addEventListener("keydown", (e) => {
  // Spaceでページがスクロールしないように
  if (e.code === "Space") e.preventDefault();

  if (e.code === "ArrowLeft" || e.code === "KeyA") input.left = true;
  if (e.code === "ArrowRight" || e.code === "KeyD") input.right = true;

  if (e.code === "Space") tryJump();
}, { passive:false });

window.addEventListener("keyup", (e) => {
  if (e.code === "ArrowLeft" || e.code === "KeyA") input.left = false;
  if (e.code === "ArrowRight" || e.code === "KeyD") input.right = false;
});

// ===== 入力（クリック/タップ） =====
canvas.addEventListener("pointerdown", (e) => {
  // UIの誤爆防止：キャンバス以外で反応しない
  e.preventDefault();
  tryJump();
}, { passive:false });

function tryJump() {
  if (!running) return;        // 終了後にジャンプで再開しない
  if (!player.onGround) return;

  player.vy = JUMP_V;
  player.onGround = false;
}

// ===== 更新 =====
function update(dt) {
  // 残り時間
  timeLeft -= dt;
  if (timeLeft <= 0) {
    timeLeft = 0;
    return endGame("finish");
  }

  // 左右移動
  if (input.left) player.x -= MOVE_SPEED;
  if (input.right) player.x += MOVE_SPEED;
  player.x = clamp(player.x, 0, W - player.w);

  // ジャンプ（重力）
  player.vy += GRAVITY;
  player.y += player.vy;

  // 着地
  const floorY = GROUND_Y - player.h;
  if (player.y >= floorY) {
    player.y = floorY;
    player.vy = 0;
    player.onGround = true;
  }

  // 障害物生成
  spawnTimer -= dt;
  if (spawnTimer <= 0) {
    spawnTimer = rand(OB_MIN_GAP, OB_MAX_GAP);

    // 高さ：地面に置く（飛び越え可能）
    const oH = 44;
    const oW = 32;
    obstacles.push({
      x: W + 10,
      y: GROUND_Y - oH,
      w: oW,
      h: oH,
      passed: false,
    });
  }

  // 障害物移動 & スコア & 当たり判定
  for (const o of obstacles) {
    o.x -= SCROLL_SPEED;

    // 通過で加点
    if (!o.passed && o.x + o.w < player.x) {
      o.passed = true;
      score += 10;
      scoreEl.textContent = String(score);
    }

    // AABB当たり判定
    const hit =
      player.x < o.x + o.w &&
      player.x + player.w > o.x &&
      player.y < o.y + o.h &&
      player.y + player.h > o.y;

    if (hit) {
      return endGame("hit");
    }
  }

  // 画面外の障害物を捨てる
  obstacles = obstacles.filter(o => o.x + o.w > -40);
}

// ===== 描画 =====
function draw() {
  ctx.clearRect(0, 0, W, H);

  // 背景
  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, W, H);

  // 薄い流線（雰囲気）
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#4f79ff";
  for (let i=0;i<12;i++){
    const y = (i*33 + (performance.now()/30)) % (H-40);
    ctx.fillRect((i*70 + (performance.now()/20)) % W, y, 80, 3);
  }
  ctx.globalAlpha = 1.0;

  // 地面
  ctx.fillStyle = "#243a64";
  ctx.fillRect(0, GROUND_Y, W, GROUND_H);

  // 障害物
  ctx.fillStyle = "#ff4d6d";
  for (const o of obstacles) {
    ctx.fillRect(o.x, o.y, o.w, o.h);
  }

  // 犬（未読み込みなら白四角）
  if (dogReady) {
    // 角丸っぽく見せるために軽くクリップ
    ctx.save();
    roundRect(ctx, player.x, player.y, player.w, player.h, 10);
    ctx.clip();
    ctx.drawImage(dogImg, player.x, player.y, player.w, player.h);
    ctx.restore();
  } else {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(player.x, player.y, player.w, player.h);
  }

  // 左上ガイド（軽く）
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = "#cfe0ff";
  ctx.font = "12px system-ui, sans-serif";
  ctx.fillText("←/→ or A/Dで移動 / クリック・Spaceでジャンプ", 14, 18);
  ctx.globalAlpha = 1.0;

  // TIME表示も毎フレ更新（見た目安定）
  timeEl.textContent = timeLeft.toFixed(1);
}

// 角丸rect
function roundRect(c, x, y, w, h, r) {
  const rr = Math.min(r, w/2, h/2);
  c.beginPath();
  c.moveTo(x+rr, y);
  c.arcTo(x+w, y, x+w, y+h, rr);
  c.arcTo(x+w, y+h, x, y+h, rr);
  c.arcTo(x, y+h, x, y, rr);
  c.arcTo(x, y, x+w, y, rr);
  c.closePath();
}

// ===== ループ =====
function loop(ts) {
  if (!running) return;
  if (!lastTs) lastTs = ts;

  const dt = (ts - lastTs) / 1000;
  lastTs = ts;

  update(dt);
  draw();
  requestAnimationFrame(loop);
}

// ===== 結果カード（犬画像入り） =====
function drawResultCard(judge) {
  if (!resultCardCanvas) return;
  const c = resultCardCanvas.getContext("2d");
  const CW = resultCardCanvas.width;
  const CH = resultCardCanvas.height;

  // 背景
  c.clearRect(0, 0, CW, CH);
  const grad = c.createLinearGradient(0, 0, 0, CH);
  grad.addColorStop(0, "#13254a");
  grad.addColorStop(1, "#0b1220");
  c.fillStyle = grad;
  c.fillRect(0, 0, CW, CH);

  // タイトル
  c.fillStyle = "#e6eefc";
  c.font = "800 54px system-ui, -apple-system, 'Segoe UI', sans-serif";
  c.fillText("うちの犬 お散歩ダッシュ", 70, 120);

  // スコア
  c.font = "900 110px system-ui, -apple-system, 'Segoe UI', sans-serif";
  c.fillText(`SCORE ${score}`, 70, 260);

  // ランク
  c.font = "900 86px system-ui, -apple-system, 'Segoe UI', sans-serif";
  c.fillText(judge.rank, 70, 380);

  c.font = "800 42px system-ui, -apple-system, 'Segoe UI', sans-serif";
  c.fillText(judge.title, 70, 440);

  c.font = "700 28px system-ui, -apple-system, 'Segoe UI', sans-serif";
  c.fillStyle = "#9fb2d8";
  c.fillText(judge.taunt, 70, 500);

  // ハッシュタグ
  c.fillStyle = "#cfe0ff";
  c.font = "800 30px system-ui, -apple-system, 'Segoe UI', sans-serif";
  c.fillText("#うちの犬チャレンジ  #お散歩ダッシュ", 70, 580);

  // 犬画像（右側）
  const imgX = 860, imgY = 210, imgS = 300;

  // フレーム
  c.fillStyle = "rgba(255,255,255,0.10)";
  c.beginPath();
  c.roundRect ? c.roundRect(imgX-12, imgY-12, imgS+24, imgS+24, 28) : null;
  if (!c.roundRect) {
    // fallback（角丸なし）
    c.fillRect(imgX-12, imgY-12, imgS+24, imgS+24);
  } else {
    c.fill();
  }

  // 画像（確実に描画：dogReadyなら描く、未準備ならプレースホルダ）
  if (dogReady && dogImg && dogImg.naturalWidth > 0) {
    // 円形っぽく見えるようにクリップ
    c.save();
    c.beginPath();
    c.arc(imgX + imgS/2, imgY + imgS/2, imgS/2, 0, Math.PI * 2);
    c.closePath();
    c.clip();
    c.drawImage(dogImg, imgX, imgY, imgS, imgS);
    c.restore();

    // 縁
    c.strokeStyle = "rgba(255,255,255,0.25)";
    c.lineWidth = 10;
    c.beginPath();
    c.arc(imgX + imgS/2, imgY + imgS/2, imgS/2 + 2, 0, Math.PI * 2);
    c.stroke();
  } else {
    c.fillStyle = "rgba(255,255,255,0.15)";
    c.beginPath();
    c.arc(imgX + imgS/2, imgY + imgS/2, imgS/2, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#e6eefc";
    c.font = "800 26px system-ui, sans-serif";
    c.fillText("画像未選択", imgX + 85, imgY + 165);
  }
}

// ===== シェア操作 =====
copyBtn?.addEventListener("click", async () => {
  const text = shareText?.value || "";
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    if (copyToast) {
      copyToast.style.display = "block";
      setTimeout(() => (copyToast.style.display = "none"), 1200);
    }
  } catch {
    // クリップボードが弾かれた時の保険
    prompt("コピーできない場合は、ここから手動でコピーしてください👇", text);
  }
});

saveBtn?.addEventListener("click", () => {
  if (!resultCardCanvas) return;

  const a = document.createElement("a");
  a.href = resultCardCanvas.toDataURL("image/png");
  a.download = "dog-dash-result.png";
  a.click();
});

// ===== ボタン =====
startBtn.onclick = startGame;
retryBtn.onclick = startGame;

// 初期表示
resetGame();
draw();
