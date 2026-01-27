/* =========================================
   うちの犬 お散歩ダッシュ（ステージ制）
   main.js（ボス150m確実出現 + 画面内強制配置版）
   ========================================= */

(() => {
  // ===== DOM =====
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d", { alpha: true });

  const dogFile = document.getElementById("dogFile");
  const startBtn = document.getElementById("startBtn");
  const retryBtn = document.getElementById("retryBtn");

  const scoreEl = document.getElementById("score");
  const timeEl = document.getElementById("time");
  const stageNameEl = document.getElementById("stageName");
  const dailyEl = document.getElementById("dailyText");
  const dailyBadgeEl = document.getElementById("dailyBadge");
  const bestEl = document.getElementById("bestScore");
  const resultEl = document.getElementById("resultText");
  const shareTextEl = document.getElementById("shareText");
  const copyBtn = document.getElementById("copyBtn");
  const saveBtn = document.getElementById("saveBtn");
  const resultCardImg = document.getElementById("resultCardImg");

  const dexStatusEls = {
    big: document.getElementById("dex_big"),
    chi: document.getElementById("dex_chi"),
    weird: document.getElementById("dex_weird"),
    friend: document.getElementById("dex_friend"),
  };

  // ===== Canvas =====
  const W = 640;
  const H = 360;
  canvas.width = W;
  canvas.height = H;

  const groundY = 310;
  const gravity = 1650;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  function safeGetLS(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  }
  function safeSetLS(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

  // ===== Game state =====
  let raf = 0;
  let lastT = 0;

  let running = false;
  let gameOver = false;

  let elapsed = 0;
  let score = 0;

  let obstacles = [];
  let spawnTimer = 0;
  let spawnQueue = [];

  let popups = [];
  let slowmoT = 0;

  // 画像（プレイヤー犬）
  let dogImg = null;
  let dogImgUrl = "";

  // ===== Player =====
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

  // ===== Stage settings =====
  const STAGES = [
    {
      id: 1,
      name: "公園",
      distanceM: 900,
      baseSpeed: 240,
      densityMul: 0.78,
      gapBase: 260,
      gapMin: 170,
      bossAtRemainM: 150,
      // ✅ 1面ボス：巨大（2段ジャンプでギリギリ）
      boss: { sizeMul: 3.10, vxMul: 1.00, bobAmp: 0,  aura: 0.14 },
    },
    {
      id: 2,
      name: "商店街",
      distanceM: 1000,
      baseSpeed: 265,
      densityMul: 0.92,
      gapBase: 245,
      gapMin: 150,
      bossAtRemainM: 150,
      boss: { sizeMul: 1.28, vxMul: 1.00, bobAmp: 18, aura: 0.17 },
    },
    {
      id: 3,
      name: "ドッグカフェ",
      distanceM: 1100,
      baseSpeed: 285,
      densityMul: 1.00,
      gapBase: 235,
      gapMin: 135,
      bossAtRemainM: 150,
      boss: { sizeMul: 1.35, vxMul: 1.10, bobAmp: 22, aura: 0.22 },
    },
  ];

  const PROG_KEY = "dogdash_stageprog_v1";
  let stageIndex = 0;
  let stage = STAGES[stageIndex];

  let distance = 0;          // m
  let bossMode = false;      // true => new spawns are bosses only
  let bossTriggered = false; // 残り150m到達済み
  let bossInstantSpawned = false; // 到達時の即スポーン済み

  // ✅ ボス出現を「画面内に確実に来る位置」で管理する
  let lastBossSpawnX = -9999;

  // ===== 右端管理（軽量化） =====
  let rightmostX = -9999;
  function recomputeRightmost() {
    rightmostX = -9999;
    for (const o of obstacles) rightmostX = Math.max(rightmostX, o.x + o.w);
    if (!obstacles.length) rightmostX = -9999;
  }

  function stageRemainM() {
    return Math.max(0, Math.ceil(stage.distanceM - distance));
  }

  function setStage(idx, keepScore = true) {
    stageIndex = clamp(idx, 0, STAGES.length - 1);
    stage = STAGES[stageIndex];

    distance = 0;
    bossMode = false;
    bossTriggered = false;
    bossInstantSpawned = false;
    lastBossSpawnX = -9999;

    obstacles = [];
    spawnQueue = [];
    spawnTimer = 0;
    popups.length = 0;
    slowmoT = 0;

    if (!keepScore) score = 0;

    player.x = W * 0.20;
    player.y = groundY - player.h;
    player.vx = 0; player.vy = 0;
    player.onGround = true;
    player.jumpsLeft = 2;

    recomputeRightmost();
    updateHUD();
  }

  function saveProgressCleared(stageId) {
    const prog = safeGetLS(PROG_KEY, { cleared: {} });
    prog.cleared[String(stageId)] = true;
    safeSetLS(PROG_KEY, prog);
  }

  // ===== Popup =====
  function pushPopup(text, x, y, life = 0.85, size = 18, alpha = 1, vy = -28) {
    popups.push({ text, x, y, life, t: 0, size, alpha, vy });
  }

  // ===== Dex =====
  const DEX_KEY = "dogdash_dex_v2";
  const dex = safeGetLS(DEX_KEY, { big: false, chi: false, weird: false, friend: false });

  function setDex(kind) {
    if (!dex[kind]) {
      dex[kind] = true;
      safeSetLS(DEX_KEY, dex);
    }
    updateDexUI();
  }

  function updateDexUI() {
    Object.entries(dexStatusEls).forEach(([k, el]) => {
      if (!el) return;
      if (dex[k]) { el.textContent = "済"; el.classList.add("done"); el.classList.remove("todo"); }
      else { el.textContent = "未"; el.classList.add("todo"); el.classList.remove("done"); }
    });
  }

  // ===== Daily =====
  const DAILY_KEY = "dogdash_daily_v1";
  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  })();

  let daily = safeGetLS(DAILY_KEY, { date: todayStr, done: false });
  if (daily.date !== todayStr) daily = { date: todayStr, done: false };

  const missionCounters = { chiAvoid: 0 };

  function updateDailyUI(inGame) {
    if (!dailyEl || !dailyBadgeEl) return;
    dailyEl.textContent = "ニアミスを3回決めろ";
    if (daily.done) {
      dailyBadgeEl.textContent = "達成";
      dailyBadgeEl.classList.add("done");
      dailyBadgeEl.classList.remove("todo");
    } else {
      dailyBadgeEl.textContent = inGame ? "進行中" : "未達";
      dailyBadgeEl.classList.add("todo");
      dailyBadgeEl.classList.remove("done");
    }
  }

  function checkDailyProgress() {
    if (daily.done) return;
    if (missionCounters.chiAvoid >= 3) {
      daily.done = true;
      safeSetLS(DAILY_KEY, daily);
      updateDailyUI(true);
      pushPopup("デイリー達成！+50", player.x + player.w/2, player.y - 10, 1.1, 20);
      score += 50;
    }
  }

  // ===== Input =====
  const keys = new Set();

  // mouse (desktop): click to jump, hold near left/right to drift (existing behavior)
  let pointerDown = false;
  let pointerX = 0;

  // touch (mobile): swipe/drag to move left-right, tap to jump
  let touchActive = false;
  let touchStartX = 0;
  let touchStartY = 0;
  let touchX = 0;
  let touchY = 0;
  let touchDir = 0;      // -1 left, +1 right
  let touchMoved = false;
  let touchStartT = 0;
  function doJump() {
    if (!running || gameOver) return;
    if (player.jumpsLeft <= 0) return;
    player.vy = -560;
    player.onGround = false;
    player.jumpsLeft--;
  }

  // ===== Helpers (drawing) =====
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x+r, y);
    g.arcTo(x+w, y, x+w, y+h, r);
    g.arcTo(x+w, y+h, x, y+h, r);
    g.arcTo(x, y+h, x, y, r);
    g.arcTo(x, y, x+w, y, r);
    g.closePath();
  }

  // ✅ デフォルト犬Canvasを1回だけ生成して使い回す
  const defaultDogCanvas = (() => {
    const off = document.createElement("canvas");
    off.width = 56; off.height = 56;
    const g = off.getContext("2d");
    g.clearRect(0,0,56,56);
    g.fillStyle = "#fff";
    roundRect(g, 6, 10, 44, 36, 12);
    g.fill();

    g.fillStyle = "#f6d6b8";
    g.beginPath();
    g.ellipse(26, 24, 16, 14, 0, 0, Math.PI*2);
    g.fill();

    g.fillStyle = "#d79a72";
    g.beginPath(); g.ellipse(10, 18, 7, 9, 0.2, 0, Math.PI*2); g.fill();
    g.beginPath(); g.ellipse(36, 18, 7, 9, -0.2, 0, Math.PI*2); g.fill();

    g.fillStyle = "#222";
    g.beginPath(); g.arc(18, 18, 2.2, 0, Math.PI*2); g.fill();
    g.beginPath(); g.arc(30, 18, 2.2, 0, Math.PI*2); g.fill();

    g.fillStyle = "#333";
    g.beginPath(); g.arc(24, 23, 2.2, 0, Math.PI*2); g.fill();

    g.strokeStyle = "#333";
    g.lineWidth = 2;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(24, 25);
    g.quadraticCurveTo(20, 28, 16, 26);
    g.moveTo(24, 25);
    g.quadraticCurveTo(28, 28, 32, 26);
    g.stroke();

    return off;
  })();

  function loadDogImage(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    dogImgUrl = url;
    const img = new Image();
    img.onload = () => { dogImg = img; };
    img.src = url;
  }

  // ===== Enemy dog types =====
  const dogTypes = [
    { id:"pome",     kind:"weird",  palette:{body:"#f7e6c8", ear:"#d7b58b", accent:"#f1d7aa"},  ear:"tri",  tail:"fluffy", face:"smile" },
    { id:"samoyed",  kind:"big",    palette:{body:"#ffffff", ear:"#e8e8e8", accent:"#f5f5f5"},  ear:"tri",  tail:"fluffy", face:"smile" },
    { id:"retr",     kind:"big",    palette:{body:"#f0c27a", ear:"#c8894a", accent:"#f6d39a"},  ear:"drop", tail:"long",   face:"tongue" },
    { id:"corgi",    kind:"weird",  palette:{body:"#f2a65a", ear:"#d07d3d", accent:"#ffffff"},  ear:"tri",  tail:"stub",   face:"smile", legs:"short" },
    { id:"pug",      kind:"chi",    palette:{body:"#f2d2a1", ear:"#3a2f2a", accent:"#3a2f2a"},  ear:"drop", tail:"curl",   face:"pug" },
    { id:"dach",     kind:"weird",  palette:{body:"#b07a44", ear:"#6b4526", accent:"#d1b08a"},  ear:"drop", tail:"long",   face:"smile", body:"long" },
    { id:"poodle",   kind:"friend", palette:{body:"#caa27c", ear:"#b18361", accent:"#e4c7aa"},  ear:"puff", tail:"puff",   face:"smile" },
    { id:"chi_w",    kind:"chi",    palette:{body:"#fff7ef", ear:"#d9b7a0", accent:"#fff7ef"},  ear:"tri",  tail:"thin",   face:"smile" },
    { id:"chi_b",    kind:"chi",    palette:{body:"#2b2b2b", ear:"#1a1a1a", accent:"#f4d3b3"},  ear:"tri",  tail:"thin",   face:"smile", eye:"light" },
  ];

  function pickDogType(t) {
    if (t < 8) return pick([dogTypes[0], dogTypes[7], dogTypes[1]]);
    if (t < 20) return pick([dogTypes[0], dogTypes[7], dogTypes[2], dogTypes[3], dogTypes[4]]);
    return pick(dogTypes);
  }

  function drawEnemyDog(g, o) {
    const p = o.palette;
    const x = o.x, y = o.y, w = o.w, h = o.h;

    // shadow
    const shadowY = groundY - 8;
    g.save();
    g.globalAlpha = 0.20;
    g.fillStyle = "#000";
    g.beginPath();
    g.ellipse(x + w*0.48, shadowY, w*0.22, h*0.08, 0, 0, Math.PI*2);
    g.fill();
    g.restore();

    const phase = (o.anim || 0);
    const legSwing = Math.sin(phase) * 2.2;

    const bodyW = (o.body === "long") ? w*0.70 : w*0.62;
    const bodyH = h*0.36;
    const bodyX = x + w*0.18;
    const bodyY = y + h*0.46;

    const headR = w*0.20;
    const headX = x + w*0.30;
    const headY = y + h*0.36;

    // body
    g.fillStyle = p.body;
    roundRect(g, bodyX, bodyY, bodyW, bodyH, 12);
    g.fill();

    // belly
    g.fillStyle = p.accent;
    roundRect(g, bodyX + bodyW*0.10, bodyY + bodyH*0.26, bodyW*0.55, bodyH*0.60, 10);
    g.fill();

    // head
    g.fillStyle = p.body;
    g.beginPath();
    g.ellipse(headX, headY, headR*1.05, headR, 0, 0, Math.PI*2);
    g.fill();

    // muzzle
    g.fillStyle = (o.id === "chi_b") ? "#d9c5b2" : "#fff";
    g.beginPath();
    g.ellipse(headX + headR*0.10, headY + headR*0.25, headR*0.65, headR*0.55, 0, 0, Math.PI*2);
    g.fill();

    // aura
    if (o.aura) {
      g.save();
      g.globalAlpha = o.aura;
      g.fillStyle = "#fff";
      g.beginPath();
      g.ellipse(x + w*0.45, y + h*0.45, w*0.55, h*0.60, 0, 0, Math.PI*2);
      g.fill();
      g.restore();
    }

    // ears
    g.fillStyle = p.ear;
    if (o.ear === "drop") {
      g.beginPath(); g.ellipse(headX - headR*0.85, headY - headR*0.10, headR*0.48, headR*0.70, 0.3, 0, Math.PI*2); g.fill();
      g.beginPath(); g.ellipse(headX + headR*0.40, headY - headR*0.12, headR*0.48, headR*0.70, -0.2, 0, Math.PI*2); g.fill();
    } else if (o.ear === "puff") {
      g.beginPath(); g.ellipse(headX - headR*0.80, headY - headR*0.20, headR*0.55, headR*0.55, 0, 0, Math.PI*2); g.fill();
      g.beginPath(); g.ellipse(headX + headR*0.35, headY - headR*0.20, headR*0.55, headR*0.55, 0, 0, Math.PI*2); g.fill();
    } else {
      g.beginPath();
      g.moveTo(headX - headR*0.95, headY - headR*0.25);
      g.lineTo(headX - headR*0.55, headY - headR*1.05);
      g.lineTo(headX - headR*0.20, headY - headR*0.30);
      g.closePath();
      g.fill();
      g.beginPath();
      g.moveTo(headX + headR*0.15, headY - headR*0.25);
      g.lineTo(headX + headR*0.45, headY - headR*1.00);
      g.lineTo(headX + headR*0.85, headY - headR*0.35);
      g.closePath();
      g.fill();
    }

    // eyes
    g.fillStyle = (o.eye === "light") ? "#f0f0f0" : "#222";
    g.beginPath(); g.arc(headX - headR*0.28, headY - headR*0.08, headR*0.12, 0, Math.PI*2); g.fill();
    g.beginPath(); g.arc(headX + headR*0.10, headY - headR*0.08, headR*0.12, 0, Math.PI*2); g.fill();

    // nose
    g.fillStyle = "#333";
    g.beginPath(); g.arc(headX - headR*0.05, headY + headR*0.15, headR*0.12, 0, Math.PI*2); g.fill();

    // mouth
    g.strokeStyle = "#333";
    g.lineWidth = 2.2;
    g.lineCap = "round";
    g.beginPath();
    if (o.face === "pug") {
      g.moveTo(headX - headR*0.20, headY + headR*0.30);
      g.quadraticCurveTo(headX - headR*0.05, headY + headR*0.38, headX + headR*0.10, headY + headR*0.30);
    } else {
      g.moveTo(headX - headR*0.18, headY + headR*0.30);
      g.quadraticCurveTo(headX - headR*0.05, headY + headR*0.42, headX + headR*0.08, headY + headR*0.30);
    }
    g.stroke();

    if (o.face === "tongue") {
      g.fillStyle = "#ff7b9e";
      g.beginPath();
      g.ellipse(headX + headR*0.04, headY + headR*0.44, headR*0.16, headR*0.12, 0, 0, Math.PI*2);
      g.fill();
    }

    // legs
    const legY = bodyY + bodyH - 2;
    const legH = h*0.20;
    const legW = w*0.06;
    const legGap = bodyW*0.20;
    const baseLX = bodyX + bodyW*0.18;
    const short = (o.legs === "short") ? 0.75 : 1;

    g.fillStyle = p.body;
    for (let i=0;i<4;i++){
      const lx = baseLX + i*legGap;
      const swing = (i%2===0 ? legSwing : -legSwing);
      roundRect(g, lx, legY + (swing*0.12), legW, legH*short, 6);
      g.fill();
    }

    // tail
    g.fillStyle = p.ear;
    const tailBaseX = bodyX + bodyW*0.92;
    const tailBaseY = bodyY + bodyH*0.35;
    if (o.tail === "fluffy") {
      g.beginPath();
      g.ellipse(tailBaseX + w*0.08, tailBaseY - h*0.10, w*0.16, h*0.18, -0.6, 0, Math.PI*2);
      g.fill();
    } else if (o.tail === "curl") {
      g.beginPath();
      g.ellipse(tailBaseX + w*0.06, tailBaseY - h*0.12, w*0.10, h*0.10, 0, 0, Math.PI*2);
      g.fill();
    } else if (o.tail === "stub") {
      g.beginPath();
      g.ellipse(tailBaseX + w*0.03, tailBaseY, w*0.06, h*0.06, 0, 0, Math.PI*2);
      g.fill();
    } else if (o.tail === "puff") {
      g.beginPath();
      g.ellipse(tailBaseX + w*0.06, tailBaseY - h*0.08, w*0.10, h*0.12, 0, 0, Math.PI*2);
      g.fill();
    } else if (o.tail === "thin") {
      g.beginPath();
      g.ellipse(tailBaseX + w*0.08, tailBaseY - h*0.06, w*0.10, h*0.06, -0.4, 0, Math.PI*2);
      g.fill();
    } else {
      g.beginPath();
      g.ellipse(tailBaseX + w*0.10, tailBaseY - h*0.04, w*0.12, h*0.08, -0.5, 0, Math.PI*2);
      g.fill();
    }
  }

  // ===== Spawning =====
  function currentSpeed() {
    const t = elapsed;
    const ramp = 1 + Math.min(t, 35) / 35 * 0.35; // 1.0 -> 1.35
    return stage.baseSpeed * ramp;
  }

  function minGapPx() {
    const t = elapsed;
    const tighten = Math.min(t, 40) / 40;
    return clamp(stage.gapBase - tighten * (stage.gapBase - stage.gapMin), stage.gapMin, stage.gapBase);
  }

  function spawnXWithGap() {
    return Math.max(W + 40, rightmostX + minGapPx());
  }

  function pushObstacle(o) {
    obstacles.push(o);
    rightmostX = Math.max(rightmostX, o.x + o.w);
  }

  function spawnFence() {
    const sp = currentSpeed();
    const w = rand(26, 34);
    const h = rand(40, 58);
    pushObstacle({
      type: "fence",
      x: spawnXWithGap(),
      y: groundY - h,
      w, h,
      vx: sp,
      passed: false,
      nearDone: false,
      wobble: rand(0, Math.PI * 2),
    });
  }

  function spawnFriendDog() {
    const sp = currentSpeed() * 0.95;
    const w = 58, h = 40;
    const pickT = pickDogType(elapsed);
    pushObstacle({
      type: "friend",
      ...pickT,
      x: spawnXWithGap(),
      y: groundY - h,
      w, h,
      vx: sp,
      passed: false,
      nearDone: false,
      anim: rand(0, Math.PI * 2),
      sparkle: true
    });
    setDex("friend");
  }

  // ✅ xOverride を受け取れるようにする（ボスは強制位置で出す）
  function spawnEnemyDog(forceType = null, extra = {}, xOverride = null) {
    const dtp = forceType || pickDogType(elapsed);
    const sp = currentSpeed() * (extra.vxMul || 1);

    const w0 = 64, h0 = 44;
    const sizeMul = extra.sizeMul || 1;
    const w = Math.round(w0 * sizeMul);
    const h = Math.round(h0 * sizeMul);

    const x = (xOverride != null) ? xOverride : spawnXWithGap();

    pushObstacle({
      type: extra.isBoss ? "boss" : "dog",
      ...dtp,
      x,
      y: groundY - h,
      w, h,
      vx: sp,
      passed: false,
      nearDone: false,
      anim: rand(0, Math.PI * 2),
      bobAmp: extra.bobAmp || 0,
      aura: extra.aura || 0,
      isBoss: !!extra.isBoss,
    });

    setDex(dtp.kind);

    // ✅ ボスの最終出現位置を記録（次のボスの基準にする）
    if (extra.isBoss) lastBossSpawnX = x;
  }

  function spawnBoss(xOverride = null) {
    const boss = stage.boss;
    const baseType = pickDogType(elapsed);
    spawnEnemyDog(baseType, {
      isBoss: true,
      sizeMul: boss.sizeMul,
      vxMul: boss.vxMul,
      bobAmp: boss.bobAmp,
      aura: boss.aura,
    }, xOverride);
  }

  // ✅ ボスが「絶対に画面に来る」強制スポーン位置
  function bossForcedSpawnX() {
    // 既存の右端は無視して、画面右端+少しの位置に固定
    // （これで “生成されたが見えない” が絶対起きない）
    return W + 70;
  }

  // ✅ 残り150m到達した瞬間に「必ず即1体」画面右で出す
  function checkBossTriggerAndSwitch() {
    if (bossTriggered) return;

    const remain = stageRemainM();
    if (remain <= stage.bossAtRemainM) {
      bossTriggered = true;
      bossMode = true;

      // 既存敵は消さない
      // 遅延スポーンだけ止める
      spawnQueue = [];

      // ✅ ここで即出現（強制位置）
      if (!bossInstantSpawned) {
        bossInstantSpawned = true;
        spawnBoss(bossForcedSpawnX());
      }

      // 以降のボス連続に備えてタイマー短め
      spawnTimer = 0.55;

      pushPopup("ボス戦！🐾", W * 0.50, 110, 1.0, 28);
    }
  }

  function updateSpawnQueue(dt) {
    if (!spawnQueue.length) return;
    for (let i = spawnQueue.length - 1; i >= 0; i--) {
      spawnQueue[i].t -= dt;
      if (spawnQueue[i].t <= 0) {
        const fn = spawnQueue[i].fn;
        spawnQueue.splice(i, 1);
        if (running && !gameOver) fn();
      }
    }
  }

  function updateSpawns(dt) {
    const sp = currentSpeed();
    distance += sp * dt * 0.12;

    checkBossTriggerAndSwitch();

    // ===== ボスモード：新規出現はボスのみ（既存敵は流れ続ける）=====
    if (bossMode) {
      spawnTimer -= dt;

      // ✅ “rightmostX” を使わず「最後のボス基準」で近めに出す
      // これでボスが画面外の遥か彼方に湧く問題が消える
      const bossGap = 240; // ボス間隔（詰めすぎず、でも連続感）
      const interval = 0.70;

      if (spawnTimer <= 0) {
        // 最初の連続スポーン時：強制位置 or 最後ボスの後ろ
        const x = (lastBossSpawnX < 0)
          ? bossForcedSpawnX()
          : Math.max(W + 70, lastBossSpawnX + bossGap);

        spawnBoss(x);
        spawnTimer = interval + rand(-0.08, 0.10);
      }
      return;
    }

    // ===== 通常モード =====
    spawnTimer -= dt;
    const baseInterval = 0.62 * (1 / stage.densityMul);
    const t = elapsed;
    const tighten = 1 - Math.min(t, 35) / 35 * 0.28;
    const interval = clamp(baseInterval * tighten, 0.26, 0.95);

    if (spawnTimer <= 0) {
      if (t < 3) {
        spawnFence();
      } else {
        const friendChance = clamp(0.03 + (t - 8) * 0.001, 0.03, 0.07);
        if (Math.random() < friendChance) spawnFriendDog();
        else spawnEnemyDog();
      }

      if (t >= 8) {
        const multiChance = clamp(0.18 + (t - 8) * 0.010, 0.18, 0.45);
        if (Math.random() < multiChance) {
          spawnQueue.push({ t: 0.18, fn: () => spawnEnemyDog() });
        }
      }

      spawnTimer = interval + rand(-0.08, 0.10);
    }
  }

  // ===== Physics =====
  function updatePlayer(dt) {
    let ax = 0;
    if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) ax -= 1;
    if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) ax += 1;    // desktop pointer drift (mouse / pen)
    if (pointerDown) {
      const px = pointerX - canvas.getBoundingClientRect().left;
      if (px < W * 0.45) ax -= 0.35;
      if (px > W * 0.55) ax += 0.35;
    }

    // mobile swipe/drag: move in swipe direction while touching
    if (touchActive) {
      // if user has dragged enough, start moving to that side
      if (touchMoved && touchDir !== 0) {
        ax += touchDir * 0.90;
      } else {
        // small nudge based on current finger position (helps "tap left/right" too)
        const tx = touchX - canvas.getBoundingClientRect().left;
        if (tx < W * 0.45) ax -= 0.20;
        if (tx > W * 0.55) ax += 0.20;
      }
    }
    player.vx = ax * 320;
    player.x += player.vx * dt;
    player.x = clamp(player.x, 20, W - player.w - 20);

    player.vy += gravity * dt;
    player.y += player.vy * dt;

    if (player.y >= groundY - player.h) {
      player.y = groundY - player.h;
      player.vy = 0;
      if (!player.onGround) player.jumpsLeft = 2;
      player.onGround = true;
    } else {
      player.onGround = false;
    }
  }

  function rectHit(x1,y1,w1,h1, x2,y2,w2,h2) {
    return x1 < x2+w2 && x1+w1 > x2 && y1 < y2+h2 && y1+h1 > y2;
  }

  function collide(pl, o) {
    const px = pl.x + 6, py = pl.y + 6, pw = pl.w - 12, ph = pl.h - 12;

    let ox = o.x, oy = o.y, ow = o.w, oh = o.h;
    if (o.type === "dog" || o.type === "friend" || o.type === "boss") {
      ox = o.x + o.w*0.10;
      oy = o.y + o.h*0.18;
      ow = o.w*0.76;
      oh = o.h*0.72;
    } else if (o.type === "fence") {
      ox = o.x + 2;
      oy = o.y + 2;
      ow = o.w - 4;
      oh = o.h - 4;
    }
    return rectHit(px,py,pw,ph, ox,oy,ow,oh);
  }

  function updateObstacles(dt) {
    let removedAny = false;

    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];

      o.x -= o.vx * dt;
      if (o.anim != null) o.anim += dt * 10;

      if (o.bobAmp) {
        const bob = Math.sin((o.anim || 0) * 0.9) * o.bobAmp;
        o.y = (groundY - o.h) + bob;
      }

      if (o.x + o.w < -120) {
        obstacles.splice(i, 1);
        removedAny = true;
        continue;
      }

      if (!o.passed && o.x + o.w < player.x) {
        o.passed = true;
        const add = (o.type === "friend") ? 2 : (o.type === "fence" ? 5 : (o.type === "boss" ? 14 : 8));
        score += add;
      }

      if (!o.nearDone) {
        const nearMargin = 8;
        const near = rectHit(
          player.x - nearMargin, player.y - nearMargin,
          player.w + nearMargin*2, player.h + nearMargin*2,
          o.x - nearMargin, o.y - nearMargin,
          o.w + nearMargin*2, o.h + nearMargin*2
        );
        const hit = collide(player, o);
        if (near && !hit && o.x < player.x + player.w && o.x + o.w > player.x) {
          o.nearDone = true;
          missionCounters.chiAvoid++;
          pushPopup("ニアミス！+4", player.x + player.w/2, player.y - 8, 0.9, 18);
          score += 4;
        }
      }

      if (collide(player, o)) {
        if (o.type === "friend") {
          pushPopup("なでた！+10", player.x + player.w/2, player.y - 10, 1.0, 20);
          score += 10;
          slowmoT = 0.25;
          obstacles.splice(i, 1);
          removedAny = true;
          continue;
        }
        endGame(false);
        return;
      }
    }

    if (removedAny) recomputeRightmost();
  }

  function updatePopups(dt) {
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      p.t += dt;
      p.y += p.vy * dt;
      if (p.t >= p.life) popups.splice(i, 1);
    }
  }

  // ===== Background =====
  const bgCache = (() => {
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");

    const grad = g.createLinearGradient(0,0,0,H);
    grad.addColorStop(0, "#9fd7ff");
    grad.addColorStop(1, "#bfe7ff");
    g.fillStyle = grad;
    g.fillRect(0,0,W,H);

    g.fillStyle = "#bfe6d8";
    g.beginPath();
    g.moveTo(0, groundY-48);
    g.quadraticCurveTo(W*0.35, groundY-92, W*0.65, groundY-58);
    g.quadraticCurveTo(W*0.85, groundY-36, W, groundY-60);
    g.lineTo(W, groundY);
    g.lineTo(0, groundY);
    g.closePath();
    g.fill();

    const cloud = (x, y, s) => {
      g.save();
      g.globalAlpha = 0.9;
      g.fillStyle = "#fff";
      g.beginPath();
      g.ellipse(x, y, 40*s, 22*s, 0, 0, Math.PI*2);
      g.ellipse(x+28*s, y-10*s, 34*s, 18*s, 0, 0, Math.PI*2);
      g.ellipse(x+56*s, y, 40*s, 22*s, 0, 0, Math.PI*2);
      g.fill();
      g.restore();
    };
    cloud(120, 72, 1.0);
    cloud(380, 62, 0.8);
    cloud(520, 92, 1.2);

    g.fillStyle = "#2bb673";
    g.fillRect(0, groundY, W, H-groundY);
    g.fillStyle = "rgba(0,0,0,.08)";
    g.fillRect(0, groundY, W, 12);

    return c;
  })();

  function drawBackground() {
    ctx.drawImage(bgCache, 0, 0);
  }

  function drawPlayer() {
    const x = player.x, y = player.y, w = player.w, h = player.h;

    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(x+w*0.50, groundY-8, w*0.22, h*0.08, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    if (dogImg) {
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, x, y, w, h, 10);
      ctx.clip();
      ctx.drawImage(dogImg, x, y, w, h);
      ctx.restore();
    } else {
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, x, y, w, h, 10);
      ctx.clip();
      ctx.drawImage(defaultDogCanvas, x-6, y-6, w+12, h+12);
      ctx.restore();
    }
  }

  function drawObstacles() {
    for (const o of obstacles) {
      if (o.type === "fence") {
        ctx.save();
        ctx.translate(o.x, o.y);
        ctx.fillStyle = "#8b5a2b";
        roundRect(ctx, 0, 0, o.w, o.h, 6);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.18)";
        roundRect(ctx, 3, 6, o.w-6, 6, 3);
        ctx.fill();
        ctx.restore();
      } else {
        drawEnemyDog(ctx, o);
      }
    }
  }

  function drawPopups() {
    for (const p of popups) {
      const k = p.t / p.life;
      const a = p.alpha * (1 - k);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(0,0,0,.50)";
      ctx.font = `900 ${p.size}px system-ui, -apple-system, Segoe UI, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(p.text, p.x+1, p.y+1);
      ctx.fillStyle = "#fff";
      ctx.fillText(p.text, p.x, p.y);
      ctx.restore();
    }
  }

  // ===== HUD =====
  function updateHUD() {
    if (scoreEl) scoreEl.textContent = String(score|0);
    if (timeEl) timeEl.textContent = (elapsed).toFixed(1);
    if (stageNameEl) stageNameEl.textContent = stage.name;

    const best = safeGetLS("dogdash_best_v1", 0);
    if (bestEl) bestEl.textContent = best ? String(best) : "—";
  }

  // ===== Loop =====
  function tick(ts) {
    raf = requestAnimationFrame(tick);
    if (!lastT) lastT = ts;

    let dt = (ts - lastT) / 1000;
    lastT = ts;
    dt = clamp(dt, 0, 0.033);

    update(dt);
    render();
  }

  function update(dt) {
    if (!running || gameOver) return;

    if (slowmoT > 0) {
      slowmoT -= dt;
      dt *= 0.55;
    }

    elapsed += dt;

    updateSpawnQueue(dt);
    updateSpawns(dt);
    updatePlayer(dt);
    updateObstacles(dt);
    updatePopups(dt);

    checkDailyProgress();
    updateHUD();
    updateDailyUI(true);

    if (stageRemainM() <= 0) {
      endGame(true);
      return;
    }
  }

  function render() {
    drawBackground();
    drawObstacles();
    drawPlayer();
    drawPopups();

    ctx.fillStyle = "rgba(0,0,0,.32)";
    ctx.font = "800 12px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText("←/→ or A/Dで移動 / クリック・Spaceでジャンプ（2段）", 14, 56);

    const remain = stageRemainM();
    ctx.fillStyle = "rgba(0,0,0,.30)";
    ctx.font = "900 13px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText(`STAGE ${stage.id} / ${STAGES.length}　残り ${remain}m`, 14, 96);

    if (bossMode) {
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.font = "900 13px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText("BOSS MODE", 14, 114);
    }

    if (!running && !gameOver) {
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.font = "900 22px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText("スタートを押してね！🐾", 18, 130);
      ctx.font = "900 14px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText("残り150mでボス戦（画面右に確定出現）！", 18, 155);
    }

    if (gameOver) {
      ctx.fillStyle = "rgba(0,0,0,.42)";
      ctx.font = "900 40px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText("RESULT", 22, 110);
      ctx.font = "900 18px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText("右の結果/シェアをチェック！", 26, 138);
    }
  }

  // ===== End / Result =====
  function rankLabel(s) {
    if (s >= 1500) return "SSS：散歩の神";
    if (s >= 1100) return "SS：犬の王";
    if (s >= 800)  return "S：散歩マスター";
    if (s >= 550)  return "A：良い散歩";
    if (s >= 300)  return "B：犬慣れしてきた";
    if (s >= 160)  return "C：公園常連";
    return "D：リード絡まり";
  }

  function makeResultCard(rank, cleared) {
    const cw = 1200, ch = 675;
    const c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    const g = c.getContext("2d");

    const grad = g.createLinearGradient(0,0,0,ch);
    grad.addColorStop(0, "#9fd7ff");
    grad.addColorStop(1, "#bfe7ff");
    g.fillStyle = grad;
    g.fillRect(0,0,cw,ch);

    g.fillStyle = "#2bb673";
    g.fillRect(0, ch-150, cw, 150);

    g.fillStyle = "rgba(0,0,0,.45)";
    g.font = "900 44px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText("うちの犬 お散歩ダッシュ", 60, 120);
    g.fillStyle = "#fff";
    g.fillText("うちの犬 お散歩ダッシュ", 58, 118);

    g.fillStyle = "rgba(0,0,0,.42)";
    g.font = "900 56px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText(`SCORE ${score}`, 60, 210);
    g.fillStyle = "#fff";
    g.fillText(`SCORE ${score}`, 58, 208);

    g.fillStyle = "rgba(0,0,0,.35)";
    g.font = "900 36px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText(`${cleared ? "STAGE CLEAR ✅" : "GAME OVER"}`, 60, 270);
    g.fillStyle = "#fff";
    g.fillText(`${cleared ? "STAGE CLEAR ✅" : "GAME OVER"}`, 58, 268);

    g.fillStyle = "rgba(0,0,0,.35)";
    g.font = "900 34px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText(`${rank}`, 60, 320);
    g.fillStyle = "#fff";
    g.fillText(`${rank}`, 58, 318);

    g.fillStyle = "rgba(0,0,0,.35)";
    g.font = "800 28px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText(`STAGE ${stage.id}/${STAGES.length}：${stage.name} / TIME ${elapsed.toFixed(1)}秒`, 60, 370);

    g.save();
    g.translate(cw-360, 160);
    g.fillStyle = "rgba(0,0,0,.22)";
    roundRect(g, 0, 0, 260, 260, 32);
    g.fill();
    g.beginPath();
    roundRect(g, 10, 10, 240, 240, 28);
    g.clip();

    if (dogImg) g.drawImage(dogImg, 10, 10, 240, 240);
    else g.drawImage(defaultDogCanvas, 10, 10, 240, 240);

    g.restore();

    g.fillStyle = "rgba(0,0,0,.28)";
    g.font = "800 22px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText("わんグル / dognavi.com", 60, ch-40);

    const url = c.toDataURL("image/png");
    if (resultCardImg) resultCardImg.src = url;
  }

  function endGame(cleared) {
    gameOver = true;
    running = false;

    const best = safeGetLS("dogdash_best_v1", 0);
    if (score > best) safeSetLS("dogdash_best_v1", score);

    updateHUD();

    let r = rankLabel(score);
    if (cleared) r = `CLEAR! ${stage.name} ✅ / ${r}`;

    if (resultEl) resultEl.textContent = cleared
      ? `STAGE ${stage.id} クリア！ SCORE ${score}（${r}）`
      : `GAME OVER  SCORE ${score}（${r}）`;

    if (shareTextEl) {
      shareTextEl.value =
`🐶 うちの犬 お散歩ダッシュ（ステージ制）

STAGE：${stage.id}/${STAGES.length}（${stage.name}）
RESULT：${cleared ? "CLEAR" : "GAME OVER"}
TIME：${elapsed.toFixed(1)}秒
SCORE：${score}
残り：${stageRemainM()}m

#わんグル #犬ゲーム #お散歩ダッシュ`;
    }

    makeResultCard(r, cleared);

    if (cleared) {
      saveProgressCleared(stage.id);
      pushPopup("クリア！次の面へ🐾", W*0.50, 150, 1.2, 24);
    }
  }

  // ===== UI flow =====
  function resetGameState() {
    elapsed = 0;
    score = 0;
    missionCounters.chiAvoid = 0;

    setStage(stageIndex, true);

    running = false;
    gameOver = false;
    lastT = 0;

    updateHUD();
    if (resultEl) resultEl.textContent = "";
    if (shareTextEl) shareTextEl.value = "";
    if (resultCardImg) resultCardImg.src = "";

    updateDailyUI(false);
  }

  function startGame() {
    if (running) return;
    updateDailyUI(true);
    running = true;
    gameOver = false;
    lastT = 0;
    spawnTimer = 0.30;
  }

  function retryGame() {
    if (gameOver && stageRemainM() <= 0) {
      const next = stageIndex + 1;
      if (next < STAGES.length) {
        setStage(next, true);
        if (resultEl) resultEl.textContent = "";
        if (shareTextEl) shareTextEl.value = "";
        if (resultCardImg) resultCardImg.src = "";
        gameOver = false;
        startGame();
        return;
      }
    }
    resetGameState();
    startGame();
  }

  // ===== Events =====
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") e.preventDefault();
    keys.add(e.key);
    if (e.code === "Space") doJump();
  }, { passive: false });

  window.addEventListener("keyup", (e) => { keys.delete(e.key); });

  canvas.addEventListener("pointerdown", (e) => {
    // prevent page scroll / gesture on touch
    if (e.pointerType === "touch") e.preventDefault();

    // Desktop (mouse): keep the snappy "click = jump" feel
    if (e.pointerType === "mouse" || e.pointerType === "pen") {
      pointerDown = true;
      pointerX = e.clientX;
      doJump();
      canvas.setPointerCapture?.(e.pointerId);
      return;
    }

    // Mobile (touch): swipe/drag to move, tap to jump (handled on pointerup)
    touchActive = true;
    touchMoved = false;
    touchDir = 0;
    touchStartX = touchX = e.clientX;
    touchStartY = touchY = e.clientY;
    touchStartT = performance.now();
    canvas.setPointerCapture?.(e.pointerId);
  }, { passive: false });

  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") e.preventDefault();

    // desktop drift
    if (pointerDown && (e.pointerType === "mouse" || e.pointerType === "pen")) {
      pointerX = e.clientX;
      return;
    }

    // touch swipe/drag
    if (!touchActive) return;
    touchX = e.clientX;
    touchY = e.clientY;

    const dx = touchX - touchStartX;
    const dy = touchY - touchStartY;

    // treat mostly-horizontal movement as swipe
    const SWIPE_PX = 18; // threshold
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 0.6) {
      touchMoved = true;
      touchDir = dx > 0 ? 1 : -1;
    }
  }, { passive: false });

  canvas.addEventListener("pointerup", (e) => {
    if (e.pointerType === "touch") e.preventDefault();

    // desktop end
    if (e.pointerType === "mouse" || e.pointerType === "pen") {
      pointerDown = false;
      try { canvas.releasePointerCapture?.(e.pointerId); } catch {}
      return;
    }

    // touch end: tap => jump, swipe => just stop moving
    if (touchActive) {
      const t = performance.now() - touchStartT;
      const dx = touchX - touchStartX;
      const dy = touchY - touchStartY;

      const TAP_PX = 14;
      const TAP_MS = 260;

      // "tap" means small movement and short time
      const isTap = (Math.abs(dx) < TAP_PX && Math.abs(dy) < TAP_PX && t < TAP_MS);

      touchActive = false;
      touchMoved = false;
      touchDir = 0;

      if (isTap) doJump();
    }

    try { canvas.releasePointerCapture?.(e.pointerId); } catch {}
  }, { passive: false });

  canvas.addEventListener("pointercancel", (e) => {
    if (e.pointerType === "touch") e.preventDefault();
    pointerDown = false;
    touchActive = false;
    touchMoved = false;
    touchDir = 0;
    try { canvas.releasePointerCapture?.(e.pointerId); } catch {}
  }, { passive: false });

  if (dogFile) {
    dogFile.addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (f) loadDogImage(f);
    });
  }
  if (startBtn) startBtn.addEventListener("click", startGame);
  if (retryBtn) retryBtn.addEventListener("click", retryGame);

  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(shareTextEl.value || "");
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
    });
  }

  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      if (!resultCardImg || !resultCardImg.src) return;
      const a = document.createElement("a");
      a.href = resultCardImg.src;
      a.download = "dogdash_result.png";
      a.click();
    });
  }

  // init
  updateDexUI();
  updateDailyUI(false);
  updateHUD();

  // start loop
  raf = requestAnimationFrame(tick);
})();
