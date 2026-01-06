/* =========================================
   わんグル お散歩ダッシュ地獄（障害物よけ）
   main.js（安定版）
   - 0-3秒: 柵のみ
   - 3-8秒: 犬が混ざる（基本1体）
   - 8秒〜: 犬増加（2体同時も）
   - 難易度: 時間で速度/出現頻度UP
   - 結果カード: 読み込んだ犬画像をカード内に描画
   - 修正: Spaceでも2段ジャンプOK / 敵犬を可愛く犬っぽく
   ========================================= */

(() => {
  // ===== DOM =====
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const dogFile = document.getElementById("dogFile");
  const startBtn = document.getElementById("startBtn");
  const retryBtn = document.getElementById("retryBtn");

  const scoreEl = document.getElementById("score");
  const timeEl = document.getElementById("time");
  const resultEl = document.getElementById("result");

  // 拡散UI（index.html側のIDに合わせる）
  const shareTextEl = document.getElementById("shareText");
  const btnCopyShare = document.getElementById("btnCopyShare");
  const btnSaveCard = document.getElementById("btnSaveCard");
  const resultCardCanvas = document.getElementById("resultCardCanvas"); // 1200x630 hidden

  // 結果カード表示（無ければJSで作る）
  let resultCardImg = document.getElementById("resultCardImg");
  if (!resultCardImg) {
    resultCardImg = document.createElement("img");
    resultCardImg.id = "resultCardImg";
    resultCardImg.alt = "結果カード";
    resultCardImg.style.width = "100%";
    resultCardImg.style.display = "block";
    resultCardImg.style.marginTop = "10px";
    resultCardImg.style.borderRadius = "14px";
    resultCardImg.style.border = "1px solid rgba(255,255,255,.10)";
    resultCardImg.style.background = "rgba(0,0,0,.2)";

    // なるべく shareBox の下に出す
    const shareBox = shareTextEl?.closest(".shareBox") || null;
    const insertTarget = shareBox?.parentElement || document.body;
    insertTarget.appendChild(resultCardImg);
  }

  // ===== 基本設定 =====
  const W = canvas.width;
  const H = canvas.height;

  const GROUND_H = 52;
  const groundY = H - GROUND_H;

  const GRAV = 1600;
  const JUMP_V = 720;
  const MOVE_V = 360;

  // ===== ゲーム状態 =====
  let raf = 0;
  let lastT = 0;

  let running = false;
  let gameOver = false;

  let elapsed = 0;
  let avoided = 0;
  let score = 0;

  let obstacles = [];
  let spawnTimer = 0;

  // 入力
  const keys = new Set();
  let pointerDown = false;
  let pointerX = 0;

  // 犬画像（プレイヤー）
  let dogImg = new Image();
  let dogImgReady = false;
  let dogImgUrl = "";

  // プレイヤー
  const player = {
    x: W * 0.20,
    y: groundY - 44,
    w: 44,
    h: 44,
    vx: 0,
    vy: 0,
    onGround: true,
    jumpsLeft: 2,
  };

  // ===== ヘルパ =====
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));

  function updateHUD() {
    if (timeEl) timeEl.textContent = elapsed.toFixed(1);
    if (scoreEl) scoreEl.textContent = String(score);
  }

  function resetGameState() {
    elapsed = 0;
    avoided = 0;
    score = 0;

    obstacles = [];
    spawnTimer = 0;

    player.x = W * 0.20;
    player.y = groundY - player.h;
    player.vx = 0;
    player.vy = 0;
    player.onGround = true;
    player.jumpsLeft = 2;

    running = false;
    gameOver = false;
    lastT = 0;

    updateHUD();
    if (resultEl) resultEl.textContent = "";
    if (shareTextEl) shareTextEl.value = "";
    if (resultCardImg) resultCardImg.src = "";
  }

  function difficultyFactor(t) {
    // 時間でじわじわ上げる（速すぎを防ぐために上限あり）
    const a = 1 + (Math.min(t, 40) / 40) * 1.2; // 最大2.2倍
    const b = t > 12 ? 1 + (Math.min(t - 12, 25) / 25) * 0.35 : 1; // 追加で最大1.35倍
    return a * b;
  }

  function phase(t) {
    if (t < 3) return 0;  // 柵のみ
    if (t < 8) return 1;  // 犬混ざる
    return 2;             // 犬増える
  }

  // ===== 入力（ジャンプ）=====
  function doJump() {
    if (!running || gameOver) return;
    if (player.jumpsLeft > 0) {
      player.vy = -JUMP_V;
      player.onGround = false;
      player.jumpsLeft -= 1;
    }
  }

  // ===== 描画（背景/地面） =====
  function drawBackground() {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#7fd1ff");
    sky.addColorStop(0.55, "#bfeaff");
    sky.addColorStop(1, "#e9fbff");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    drawCloud(90, 70, 1.0);
    drawCloud(320, 55, 0.85);
    drawCloud(560, 85, 1.15);

    ctx.fillStyle = "rgba(30,170,90,.22)";
    ctx.beginPath();
    ctx.moveTo(0, groundY - 40);
    ctx.quadraticCurveTo(W * 0.25, groundY - 80, W * 0.50, groundY - 45);
    ctx.quadraticCurveTo(W * 0.75, groundY - 10, W, groundY - 60);
    ctx.lineTo(W, groundY);
    ctx.lineTo(0, groundY);
    ctx.closePath();
    ctx.fill();

    const grass = ctx.createLinearGradient(0, groundY - 10, 0, H);
    grass.addColorStop(0, "#42c46a");
    grass.addColorStop(1, "#17934a");
    ctx.fillStyle = grass;
    ctx.fillRect(0, groundY, W, GROUND_H);

    ctx.fillStyle = "rgba(255,255,255,.22)";
    ctx.fillRect(0, groundY, W, 6);

    ctx.strokeStyle = "rgba(0,0,0,.08)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 18; i++) {
      const y = groundY + 10 + i * 2;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.font = "700 12px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText("わんグル / dognavi.com", 12, 18);
  }

  function drawCloud(x, y, s) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = "rgba(255,255,255,.90)";
    blob(-30, 0, 30);
    blob(0, -10, 34);
    blob(28, 0, 26);
    blob(8, 12, 28);
    ctx.restore();

    function blob(cx, cy, r) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ===== 障害物生成 =====
  function pickDogType(t) {
    // ちょい可愛い寄り。チワワは増えやすい（鬱陶しい）
    if (t < 10) {
      const r = Math.random();
      if (r < 0.35) return "big";
      if (r < 0.65) return "weird";
      return "chi";
    } else {
      const r = Math.random();
      if (r < 0.25) return "big";
      if (r < 0.50) return "weird";
      return "chi";
    }
  }

  function spawnOne(typeOverride = null) {
    const t = elapsed;
    const p = phase(t);

    let type = typeOverride;
    if (!type) {
      if (p === 0) type = "fence";
      else if (p === 1) type = Math.random() < 0.60 ? pickDogType(t) : "fence";
      else {
        const r = Math.random();
        if (r < 0.70) type = pickDogType(t);
        else type = "fence";
      }
    }

    const df = difficultyFactor(t);
    const baseSpeed = 220 * df;

    if (type === "fence") {
      const h = randi(44, 78);
      const w = randi(42, 60);
      obstacles.push({
        type,
        x: W + 20,
        y: groundY - h,
        w,
        h,
        vx: baseSpeed,
        passed: false,
      });
      return;
    }

    if (type === "big") {
      const w = 68, h = 56;
      obstacles.push({
        type,
        x: W + 20,
        y: groundY - h,
        w, h,
        vx: baseSpeed * 0.92,
        passed: false,
        wobble: 0,
      });
      return;
    }

    if (type === "chi") {
      const w = 48, h = 40;
      obstacles.push({
        type,
        x: W + 20,
        y: groundY - h - randi(0, 12),
        w, h,
        vx: baseSpeed * 1.22,
        passed: false,
        wobble: 0,
      });
      return;
    }

    if (type === "weird") {
      const w = 56, h = 46;
      const baseY = groundY - h - randi(12, 50);
      obstacles.push({
        type,
        x: W + 20,
        y: baseY,
        baseY,
        w, h,
        vx: baseSpeed * 1.04,
        passed: false,
        wobble: rand(0, Math.PI * 2),
      });
      return;
    }
  }

  function updateSpawns(dt) {
    const t = elapsed;
    const df = difficultyFactor(t);

    let baseInterval;
    if (t < 3) baseInterval = 0.85;
    else if (t < 8) baseInterval = 0.65;
    else baseInterval = 0.55;

    const interval = clamp(baseInterval / df, 0.26, 0.95);

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnOne();

      // 8秒以降はたまに2体目
      if (t >= 8) {
        const multiChance = clamp(0.10 + (t - 8) * 0.012, 0.10, 0.38);
        if (Math.random() < multiChance) {
          const offset = clamp(0.22 - (df - 1) * 0.03, 0.10, 0.22);
          setTimeout(() => {
            if (running && !gameOver) spawnOne(pickDogType(elapsed));
          }, offset * 1000);
        }
      }

      spawnTimer = interval + rand(-0.10, 0.12);
      spawnTimer = clamp(spawnTimer, 0.22, 1.20);
    }
  }

  // ===== 当たり判定 =====
  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function hitTestPlayerObs(obs) {
    const padP = 4;
    const padO = 4;

    const px = player.x + padP;
    const py = player.y + padP;
    const pw = player.w - padP * 2;
    const ph = player.h - padP * 2;

    const ox = obs.x + padO;
    const oy = obs.y + padO;
    const ow = obs.w - padO * 2;
    const oh = obs.h - padO * 2;

    return aabb(px, py, pw, ph, ox, oy, ow, oh);
  }

  // ===== 角丸パス =====
  function roundRectPath(x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  }

  // ===== プレイヤー描画 =====
  function drawPlayer() {
    // 影
    ctx.fillStyle = "rgba(0,0,0,.18)";
    ctx.beginPath();
    ctx.ellipse(player.x + player.w / 2, groundY + 10, 18, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    const x = player.x, y = player.y, w = player.w, h = player.h;

    // 白フチ
    ctx.save();
    ctx.beginPath();
    roundRectPath(x - 2, y - 2, w + 4, h + 4, 12);
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.fill();
    ctx.restore();

    if (dogImgReady) {
      ctx.save();
      ctx.beginPath();
      roundRectPath(x, y, w, h, 10);
      ctx.clip();
      ctx.drawImage(dogImg, x, y, w, h);
      ctx.restore();
    } else {
      // 代替の犬アイコン
      ctx.save();
      ctx.beginPath();
      roundRectPath(x, y, w, h, 10);
      ctx.fillStyle = "#fff";
      ctx.fill();

      ctx.fillStyle = "#f4c9a5";
      ctx.beginPath();
      ctx.arc(x + w * 0.52, y + h * 0.58, w * 0.26, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#d89a6e";
      ctx.beginPath();
      ctx.ellipse(x + w * 0.34, y + h * 0.38, w * 0.12, h * 0.16, -0.5, 0, Math.PI * 2);
      ctx.ellipse(x + w * 0.62, y + h * 0.34, w * 0.12, h * 0.16, 0.4, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#111";
      ctx.beginPath();
      ctx.arc(x + w * 0.45, y + h * 0.55, 2.3, 0, Math.PI * 2);
      ctx.arc(x + w * 0.59, y + h * 0.55, 2.3, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = "rgba(0,0,0,.45)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + w * 0.52, y + h * 0.63, 6, 0.2, Math.PI - 0.2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // ===== 障害物描画 =====
  function drawObstacle(o) {
    if (o.type === "fence") return drawFence(o);
    if (o.type === "big") return drawDogEnemy(o, "big");
    if (o.type === "chi") return drawDogEnemy(o, "chi");
    if (o.type === "weird") return drawDogEnemy(o, "weird");
  }

  function drawFence(o) {
    const x = o.x, y = o.y, w = o.w, h = o.h;

    // 影
    ctx.fillStyle = "rgba(0,0,0,.16)";
    ctx.fillRect(x + 3, y + 6, w, h);

    // 木
    const wood = ctx.createLinearGradient(x, y, x + w, y + h);
    wood.addColorStop(0, "#b9834b");
    wood.addColorStop(1, "#8a5d33");
    ctx.fillStyle = wood;
    ctx.beginPath();
    roundRectPath(x, y, w, h, 10);
    ctx.fill();

    // 木目
    ctx.strokeStyle = "rgba(0,0,0,.18)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const yy = y + 10 + i * (h / 4);
      ctx.beginPath();
      ctx.moveTo(x + 8, yy);
      ctx.lineTo(x + w - 8, yy + rand(-2, 2));
      ctx.stroke();
    }

    // ハイライト
    ctx.fillStyle = "rgba(255,255,255,.18)";
    ctx.beginPath();
    roundRectPath(x + 3, y + 3, w - 6, 10, 8);
    ctx.fill();
  }

  // ===== 可愛い敵犬描画 =====
  function drawDogEnemy(o, kind) {
    const x = o.x, y = o.y, w = o.w, h = o.h;

    // 影
    ctx.fillStyle = "rgba(0,0,0,.18)";
    ctx.beginPath();
    ctx.ellipse(x + w / 2, groundY + 10, w * 0.34, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // 本体グラデ
    let bodyGrad;
    if (kind === "big") {
      bodyGrad = ctx.createLinearGradient(x, y, x + w, y + h);
      bodyGrad.addColorStop(0, "#fff3dd");
      bodyGrad.addColorStop(1, "#f2b989");
    } else if (kind === "chi") {
      bodyGrad = ctx.createLinearGradient(x, y, x + w, y + h);
      bodyGrad.addColorStop(0, "#ffe6ec");
      bodyGrad.addColorStop(1, "#ff6f8a");
    } else {
      bodyGrad = ctx.createLinearGradient(x, y, x + w, y + h);
      bodyGrad.addColorStop(0, "#e6fbff");
      bodyGrad.addColorStop(1, "#6ad0ff");
    }

    // 体（丸角）
    ctx.save();
    ctx.beginPath();
    roundRectPath(x, y, w, h, 16);
    ctx.fillStyle = bodyGrad;
    ctx.fill();

    // ほっぺ（可愛さ）
    ctx.fillStyle = "rgba(255,140,160,.35)";
    ctx.beginPath();
    ctx.arc(x + w * 0.30, y + h * 0.60, w * 0.10, 0, Math.PI * 2);
    ctx.arc(x + w * 0.70, y + h * 0.60, w * 0.10, 0, Math.PI * 2);
    ctx.fill();

    // 耳（犬っぽく）
    ctx.fillStyle = "rgba(0,0,0,.10)";
    ctx.beginPath();
    ctx.ellipse(x + w * 0.22, y + h * 0.22, w * 0.13, h * 0.20, -0.8, 0, Math.PI * 2);
    ctx.ellipse(x + w * 0.78, y + h * 0.22, w * 0.13, h * 0.20, 0.8, 0, Math.PI * 2);
    ctx.fill();

    // 目（キラ）
    const eyeY = y + h * 0.45;
    ctx.fillStyle = "#141414";
    ctx.beginPath();
    ctx.arc(x + w * 0.38, eyeY, 3.0, 0, Math.PI * 2);
    ctx.arc(x + w * 0.62, eyeY, 3.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.beginPath();
    ctx.arc(x + w * 0.36, eyeY - 1.0, 1.1, 0, Math.PI * 2);
    ctx.arc(x + w * 0.60, eyeY - 1.0, 1.1, 0, Math.PI * 2);
    ctx.fill();

    // 鼻
    ctx.fillStyle = "rgba(0,0,0,.55)";
    ctx.beginPath();
    ctx.arc(x + w * 0.50, y + h * 0.56, 2.6, 0, Math.PI * 2);
    ctx.fill();

    // 口（にこ）
    ctx.strokeStyle = "rgba(0,0,0,.45)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x + w * 0.50, y + h * 0.64, 8, 0.2, Math.PI - 0.2);
    ctx.stroke();

    // しっぽ（犬っぽさ）
    ctx.strokeStyle = "rgba(0,0,0,.14)";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    const tx = x + w * 0.92;
    const ty = y + h * 0.58;
    ctx.moveTo(tx, ty);
    ctx.quadraticCurveTo(tx + w * 0.12, ty - h * 0.10, tx + w * 0.05, ty - h * 0.26);
    ctx.stroke();

    // 種別で個性
    if (kind === "chi") {
      // チワワは眉毛＋ちょい牙（可愛いムカつき）
      ctx.strokeStyle = "rgba(0,0,0,.55)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x + w * 0.28, y + h * 0.36);
      ctx.lineTo(x + w * 0.44, y + h * 0.40);
      ctx.moveTo(x + w * 0.72, y + h * 0.36);
      ctx.lineTo(x + w * 0.56, y + h * 0.40);
      ctx.stroke();

      ctx.fillStyle = "rgba(255,255,255,.95)";
      ctx.beginPath();
      ctx.moveTo(x + w * 0.46, y + h * 0.70);
      ctx.lineTo(x + w * 0.50, y + h * 0.78);
      ctx.lineTo(x + w * 0.54, y + h * 0.70);
      ctx.closePath();
      ctx.fill();
    }

    if (kind === "weird") {
      // 変な犬＝ブチ柄＋舌
      ctx.fillStyle = "rgba(0,0,0,.10)";
      ctx.beginPath();
      ctx.ellipse(x + w * 0.35, y + h * 0.30, w * 0.11, h * 0.10, 0.2, 0, Math.PI * 2);
      ctx.ellipse(x + w * 0.65, y + h * 0.28, w * 0.12, h * 0.12, -0.4, 0, Math.PI * 2);
      ctx.ellipse(x + w * 0.52, y + h * 0.78, w * 0.13, h * 0.10, 0.1, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "rgba(255,90,120,.85)";
      ctx.beginPath();
      ctx.ellipse(x + w * 0.52, y + h * 0.72, w * 0.07, h * 0.10, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // ラベル（小さめ）
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.font = "800 10px system-ui, -apple-system, Segoe UI, sans-serif";
    const label = kind === "big" ? "大型犬" : kind === "chi" ? "凶暴チワワ" : "変な犬";
    ctx.fillText(label, x + 6, y + h - 8);

    ctx.restore();
  }

  // ===== プレイヤー更新 =====
  function updatePlayer(dt) {
    let dir = 0;
    if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) dir -= 1;
    if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) dir += 1;

    // タップ長押し移動（指の位置に寄せる）
    if (pointerDown) {
      const rect = canvas.getBoundingClientRect();
      const target = ((pointerX - rect.left) / rect.width) * W;
      const center = player.x + player.w / 2;
      const diff = target - center;
      if (Math.abs(diff) > 10) dir = diff > 0 ? 1 : -1;
    }

    player.vx = dir * MOVE_V;

    player.x += player.vx * dt;
    player.x = clamp(player.x, 8, W - player.w - 8);

    player.vy += GRAV * dt;
    player.y += player.vy * dt;

    if (player.y >= groundY - player.h) {
      player.y = groundY - player.h;
      player.vy = 0;
      if (!player.onGround) {
        player.onGround = true;
        player.jumpsLeft = 2;
      }
    } else {
      player.onGround = false;
    }
  }

  // ===== 障害物更新 =====
  function updateObstacles(dt) {
    for (const o of obstacles) {
      o.x -= o.vx * dt;

      if (o.type === "weird") {
        o.wobble += dt * 4.2;
        o.y = o.baseY + Math.sin(o.wobble) * 18;
        o.y = clamp(o.y, 40, groundY - o.h);
      }
    }

    for (const o of obstacles) {
      if (!o.passed && o.x + o.w < player.x) {
        o.passed = true;
        avoided += 1;
      }
    }

    obstacles = obstacles.filter(o => o.x + o.w > -40);

    score = avoided * 10 + Math.floor(elapsed * 5);

    for (const o of obstacles) {
      if (hitTestPlayerObs(o)) {
        endGame("crash");
        break;
      }
    }
  }

  // ===== ループ更新 =====
  function update(dt) {
    if (!running || gameOver) return;

    elapsed += dt;
    updateSpawns(dt);
    updatePlayer(dt);
    updateObstacles(dt);
    updateHUD();
  }

  function render() {
    drawBackground();
    for (const o of obstacles) drawObstacle(o);
    drawPlayer();

    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.font = "800 12px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText("←/→ or A/Dで移動 / クリック・Spaceでジャンプ（2段）", 14, 36);

    if (!running && !gameOver) {
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.font = "900 18px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText("スタートを押してね！🐾", 14, 60);
    }

    if (gameOver) {
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(255,255,255,.92)";
      ctx.font = "900 28px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText("GAME OVER", 14, 70);
      ctx.font = "800 14px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText("リトライで再挑戦！", 14, 95);
    }
  }

  function loop(ts) {
    if (!lastT) lastT = ts;
    const dt = Math.min(0.033, (ts - lastT) / 1000);
    lastT = ts;

    if (running && !gameOver) update(dt);
    render();

    raf = requestAnimationFrame(loop);
  }

  // ===== 結果・ランク =====
  function calcRank(sc, sec) {
    const v = sec * 10 + sc * 0.6;
    if (v < 80)  return { rank: "E", title: "初めてのお散歩" };
    if (v < 140) return { rank: "D", title: "リード絡まり" };
    if (v < 210) return { rank: "C", title: "公園常連" };
    if (v < 300) return { rank: "B", title: "犬慣れしてきた" };
    if (v < 420) return { rank: "A", title: "ドッグラン覇者" };
    if (v < 560) return { rank: "S", title: "わんグル公認散歩犬" };
    return { rank: "SSS", title: "伝説の散歩犬" };
  }

  function pickComment(rank) {
    const map = {
      "E": ["散歩開始3秒で終了は草。", "まだ玄関で転んでる。", "まずリード持とう。"],
      "D": ["リード絡まり職人。", "犬に犬でやられた。", "今日の敵は自分。"],
      "C": ["公園なら勝てる。…たぶん。", "犬密度が高すぎる。", "まだ逃げ切れてる説。"],
      "B": ["犬慣れしてきた（なおチワワ）。", "散歩とは戦い。", "いい反射神経してる。"],
      "A": ["ドッグランで王になれる。", "大型犬も怖くない。", "わんグル適性高め。"],
      "S": ["チワワ？何それ。", "わんグル公認でOK。", "犬社会を支配してる。"],
      "SSS": ["あなたが散歩、そのもの。", "犬の世界線を超えた。", "散歩の神、降臨。"],
    };
    const arr = map[rank] || ["また来てね！"];
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function buildShareText(rankObj, sec, sc, comment) {
    const secTxt = sec.toFixed(1) + "秒";
    return `🐾 わんグル お散歩ダッシュ地獄\n\nRANK：${rankObj.rank}（${rankObj.title}）\nTIME：${secTxt}\nSCORE：${sc}\n\n${comment}\n#わんグル #犬ゲー #お散歩ダッシュ`;
  }

  // ===== 結果カード生成 =====
  function drawResultCard(rankObj, sec, sc, comment) {
    if (!resultCardCanvas) return null;

    const c = resultCardCanvas;
    const g = c.getContext("2d");
    const CW = c.width;
    const CH = c.height;

    const bg = g.createLinearGradient(0, 0, 0, CH);
    bg.addColorStop(0, "#0b1b3e");
    bg.addColorStop(1, "#0a1226");
    g.fillStyle = bg;
    g.fillRect(0, 0, CW, CH);

    g.fillStyle = "rgba(79,121,255,.18)";
    g.beginPath();
    g.moveTo(-100, 0);
    g.lineTo(CW * 0.55, 0);
    g.lineTo(CW * 0.35, CH);
    g.lineTo(-100, CH);
    g.closePath();
    g.fill();

    g.fillStyle = "rgba(255,255,255,.92)";
    g.font = "900 54px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText("わんグル お散歩ダッシュ地獄", 60, 110);

    g.fillStyle = "rgba(255,255,255,.70)";
    g.font = "800 26px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText("可愛い犬しか出てこないのに、異常に難しい。", 60, 155);

    g.fillStyle = "#ffffff";
    g.font = "900 120px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText(rankObj.rank, 60, 290);

    g.fillStyle = "rgba(255,255,255,.86)";
    g.font = "900 40px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText(rankObj.title, 60, 345);

    g.fillStyle = "rgba(255,255,255,.92)";
    g.font = "900 54px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText(`TIME ${sec.toFixed(1)}s`, 60, 430);
    g.fillText(`SCORE ${sc}`, 60, 495);

    g.fillStyle = "rgba(207,224,255,.92)";
    g.font = "900 30px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText(comment, 60, 555);

    g.fillStyle = "rgba(159,178,216,.95)";
    g.font = "800 26px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText("#わんグル   #犬ゲー   #お散歩ダッシュ", 60, 605);

    const imgX = CW - 360;
    const imgY = 190;
    const imgS = 270;

    g.fillStyle = "rgba(255,255,255,.10)";
    g.beginPath();
    roundRectPath2(g, imgX - 18, imgY - 18, imgS + 36, imgS + 36, 36);
    g.fill();

    g.save();
    g.beginPath();
    g.arc(imgX + imgS / 2, imgY + imgS / 2, imgS / 2, 0, Math.PI * 2);
    g.clip();

    if (dogImgReady) {
      g.drawImage(dogImg, imgX, imgY, imgS, imgS);
    } else {
      g.fillStyle = "rgba(255,255,255,.90)";
      g.fillRect(imgX, imgY, imgS, imgS);
      g.fillStyle = "#f4c9a5";
      g.beginPath();
      g.arc(imgX + imgS * 0.55, imgY + imgS * 0.58, imgS * 0.22, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#111";
      g.beginPath();
      g.arc(imgX + imgS * 0.48, imgY + imgS * 0.55, 8, 0, Math.PI * 2);
      g.arc(imgX + imgS * 0.62, imgY + imgS * 0.55, 8, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "rgba(0,0,0,.45)";
      g.lineWidth = 5;
      g.beginPath();
      g.arc(imgX + imgS * 0.55, imgY + imgS * 0.66, 18, 0.2, Math.PI - 0.2);
      g.stroke();
    }
    g.restore();

    g.strokeStyle = "rgba(255,255,255,.25)";
    g.lineWidth = 10;
    g.beginPath();
    g.arc(imgX + imgS / 2, imgY + imgS / 2, imgS / 2 + 6, 0, Math.PI * 2);
    g.stroke();

    g.fillStyle = "rgba(255,255,255,.16)";
    g.font = "900 24px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText("Powered by わんグル", CW - 340, 160);

    try {
      return c.toDataURL("image/png");
    } catch {
      return null;
    }

    function roundRectPath2(g2, x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      g2.moveTo(x + rr, y);
      g2.arcTo(x + w, y, x + w, y + h, rr);
      g2.arcTo(x + w, y + h, x, y + h, rr);
      g2.arcTo(x, y + h, x, y, rr);
      g2.arcTo(x, y, x + w, y, rr);
      g2.closePath();
    }
  }

  // ===== 終了処理 =====
  function endGame() {
    if (gameOver) return;
    gameOver = true;
    running = false;

    const rankObj = calcRank(score, elapsed);
    const comment = pickComment(rankObj.rank);

    if (resultEl) {
      resultEl.textContent = `SCORE ${score}（${rankObj.rank}：${rankObj.title}）`;
    }

    const shareText = buildShareText(rankObj, elapsed, score, comment);
    if (shareTextEl) shareTextEl.value = shareText;

    const url = drawResultCard(rankObj, elapsed, score, comment);
    if (url && resultCardImg) resultCardImg.src = url;

    updateHUD();
  }

  // ===== UI：コピー＆保存 =====
  async function copyShare() {
    if (!shareTextEl) return;
    const text = shareTextEl.value || "";
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      const toast = document.getElementById("copyToast");
      if (toast) {
        toast.style.display = "block";
        setTimeout(() => (toast.style.display = "none"), 1200);
      }
    } catch {
      shareTextEl.focus();
      shareTextEl.select();
      document.execCommand("copy");
    }
  }

  function saveCard() {
    if (!resultCardImg || !resultCardImg.src) return;
    const a = document.createElement("a");
    a.href = resultCardImg.src;
    a.download = "wanguru-dogdash-result.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ===== 画像読み込み =====
  function setDogImageFromFile(file) {
    if (!file) return;
    if (dogImgUrl) {
      URL.revokeObjectURL(dogImgUrl);
      dogImgUrl = "";
    }
    dogImgUrl = URL.createObjectURL(file);
    dogImg = new Image();
    dogImgReady = false;
    dogImg.onload = () => { dogImgReady = true; };
    dogImg.onerror = () => { dogImgReady = false; };
    dogImg.src = dogImgUrl;
  }

  // ===== 開始/リトライ =====
  function startGame() {
    if (running) return;
    if (gameOver) resetGameState();

    running = true;
    gameOver = false;
    lastT = 0;

    spawnTimer = 0.35;
  }

  // リトライ押下で即スタート
  function retryGame() {
    resetGameState();
    startGame();
  }

  // ===== イベント =====
  // ★ここが大事：Spaceでもクリックでも同じ doJump() を呼ぶ
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") e.preventDefault(); // ページスクロール抑止
    keys.add(e.key);

    if (e.code === "Space") doJump(); // ← Spaceでもジャンプ（2段OK）
  }, { passive: false });

  window.addEventListener("keyup", (e) => {
    keys.delete(e.key);
  });

  canvas.addEventListener("pointerdown", (e) => {
    pointerDown = true;
    pointerX = e.clientX;
    doJump();
    canvas.setPointerCapture?.(e.pointerId);
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!pointerDown) return;
    pointerX = e.clientX;
  });

  canvas.addEventListener("pointerup", () => { pointerDown = false; });
  canvas.addEventListener("pointercancel", () => { pointerDown = false; });

  dogFile?.addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) setDogImageFromFile(f);
  });

  startBtn?.addEventListener("click", startGame);
  retryBtn?.addEventListener("click", retryGame);

  btnCopyShare?.addEventListener("click", copyShare);
  btnSaveCard?.addEventListener("click", saveCard);

  // ===== メインループ =====
  function updateAndRender(ts) {
    if (!lastT) lastT = ts;
    const dt = Math.min(0.033, (ts - lastT) / 1000);
    lastT = ts;

    if (running && !gameOver) update(dt);
    render();

    raf = requestAnimationFrame(updateAndRender);
  }

  // ===== 初期化＆開始 =====
  resetGameState();
  raf = requestAnimationFrame(updateAndRender);

})();
