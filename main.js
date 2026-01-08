/* =========================================
   うちの犬 お散歩ダッシュ（障害物よけ）
   main.js  (v3.3)
   - 難易度：時間で上昇（速度＆密度）
   - ニアミス / 連続回避：ポップアップ表示
   - 犬図鑑（遭遇）：localStorageで保存＆UI更新
   - 敵犬：アウトライン無し（塗りだけ）＋種類が分かるデザイン差
   - 追加：敵犬の“上下/ぴょこ”挙動（単調回避）
   - 追加：左上に「わんグル / dognavi.com」を常時表示
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

  // ===== 基本設定 =====
  const W = 640;
  const H = 360;
  canvas.width = W;
  canvas.height = H;

  const groundY = 310;
  const gravity = 1650;

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  function safeGetLS(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
  function safeSetLS(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} }

  // ===== ゲーム状態 =====
  let raf = 0;
  let lastT = 0;

  let running = false;
  let gameOver = false;

  let elapsed = 0;
  let avoided = 0;
  let nearMissCount = 0;
  let avoidStreak = 0;
  let lastAvoidAt = 0;

  let score = 0;
  let eventScore = 0;

  let obstacles = [];
  let spawnTimer = 0;
  let spawnQueue = []; // 追加スポーン（遅延）をフレーム内で処理してラグ回避

  let popups = [];
  let slowmoT = 0;

  // 画像（プレイヤー犬）
  let dogImg = null;
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

  // ポップアップ（ニアミス等）
  function pushPopup(text, x, y, life = 0.85, size = 18, alpha = 1, vy = -28) {
    popups.push({ text, x, y, life, t: 0, size, alpha, vy });
  }

  // ===== 犬図鑑 =====
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
      if (dex[k]) {
        el.textContent = "済";
        el.classList.add("done");
        el.classList.remove("todo");
      } else {
        el.textContent = "未";
        el.classList.add("todo");
        el.classList.remove("done");
      }
    });
  }

  // ===== ステージ名（あるある） =====
  function stageName(t) {
    if (t < 12) return "公園";
    if (t < 28) return "商店街";
    if (t < 45) return "ドッグカフェ";
    if (t < 65) return "河川敷";
    return "神エリア";
  }

  // ===== デイリー（例：ニアミス3回） =====
  const DAILY_KEY = "dogdash_daily_v1";
  const todayStr = (() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,"0");
    const da = String(d.getDate()).padStart(2,"0");
    return `${y}-${m}-${da}`;
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
      eventScore += 50;
    }
  }

  // ===== 難易度 =====
  function difficultyFactor(t) {
    // もっと難しく：序盤から伸びて、後半もしっかり加速（上限は安全にクランプ）
    const early = 1 + (Math.min(t, 20) / 20) * 1.9;                 // 1.0 -> 2.9
    const mid   = t > 10 ? 1 + (Math.min(t - 10, 35) / 35) * 1.2 : 1; // 1.0 -> 2.2
    const late  = t > 30 ? 1 + (Math.min(t - 30, 80) / 80) * 1.0 : 1; // 1.0 -> 2.0
    const df = early * mid * late; // 理論値 〜12.7
    return clamp(df, 1, 8.5);      // 体感は上げつつ理不尽は抑える
  }

  // ===== 入力 =====
  const keys = new Set();
  let pointerDown = false;
  let pointerX = 0;

  function doJump() {
    if (!running || gameOver) return;
    if (player.jumpsLeft <= 0) return;
    player.vy = -560;
    player.onGround = false;
    player.jumpsLeft--;
  }

  // ===== プレイヤー画像生成 =====
  function drawDefaultDogIcon(g) {
    // かわいいデフォ犬（画像未読込時）
    const w = 56, h = 56;
    const cx = w/2, cy = h/2 + 2;

    g.clearRect(0,0,w,h);

    // body
    g.fillStyle = "#fff";
    roundRect(g, 6, 10, 44, 36, 12);
    g.fill();

    // face
    g.fillStyle = "#f6d6b8";
    g.beginPath();
    g.ellipse(cx-2, cy-6, 16, 14, 0, 0, Math.PI*2);
    g.fill();

    // ears
    g.fillStyle = "#d79a72";
    g.beginPath(); g.ellipse(cx-16, cy-10, 7, 9, 0.2, 0, Math.PI*2); g.fill();
    g.beginPath(); g.ellipse(cx+10, cy-10, 7, 9, -0.2, 0, Math.PI*2); g.fill();

    // eyes
    g.fillStyle = "#222";
    g.beginPath(); g.arc(cx-8, cy-8, 2.2, 0, Math.PI*2); g.fill();
    g.beginPath(); g.arc(cx+4, cy-8, 2.2, 0, Math.PI*2); g.fill();

    // nose+mouth
    g.fillStyle = "#333";
    g.beginPath(); g.arc(cx-2, cy-3, 2.2, 0, Math.PI*2); g.fill();
    g.strokeStyle = "#333";
    g.lineWidth = 2;
    g.lineCap = "round";
    g.beginPath();
    g.moveTo(cx-2, cy-1);
    g.quadraticCurveTo(cx-6, cy+2, cx-10, cy);
    g.moveTo(cx-2, cy-1);
    g.quadraticCurveTo(cx+2, cy+2, cx+6, cy);
    g.stroke();
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x+r, y);
    g.arcTo(x+w, y, x+w, y+h, r);
    g.arcTo(x+w, y+h, x, y+h, r);
    g.arcTo(x, y+h, x, y, r);
    g.arcTo(x, y, x+w, y, r);
    g.closePath();
  }

  function loadDogImage(file) {
    if (!file) return;
    const url = URL.createObjectURL(file);
    dogImgUrl = url;
    const img = new Image();
    img.onload = () => { dogImg = img; };
    img.src = url;
  }

  // ===== 敵犬（ゆる可愛い） =====
  const dogTypes = [
    { id:"pome",     label:"ポメ",     kind:"weird",  palette:{body:"#f7e6c8", ear:"#d7b58b", accent:"#f1d7aa"},  ear:"tri",  tail:"fluffy", face:"smile" },
    { id:"samoyed",  label:"サモエド", kind:"big",    palette:{body:"#ffffff", ear:"#e8e8e8", accent:"#f5f5f5"},  ear:"tri",  tail:"fluffy", face:"smile" },
    { id:"retr",     label:"レト",     kind:"big",    palette:{body:"#f0c27a", ear:"#c8894a", accent:"#f6d39a"},  ear:"drop", tail:"long",   face:"tongue" },
    { id:"corgi",    label:"コーギー", kind:"weird",  palette:{body:"#f2a65a", ear:"#d07d3d", accent:"#ffffff"},  ear:"tri",  tail:"stub",   face:"smile", legs:"short" },
    { id:"pug",      label:"パグ",     kind:"chi",    palette:{body:"#f2d2a1", ear:"#3a2f2a", accent:"#3a2f2a"},  ear:"drop", tail:"curl",   face:"pug" },
    { id:"dach",     label:"ダックス", kind:"weird",  palette:{body:"#b07a44", ear:"#6b4526", accent:"#d1b08a"},  ear:"drop", tail:"long",   face:"smile", body:"long" },
    { id:"poodle",   label:"プードル", kind:"friend", palette:{body:"#caa27c", ear:"#b18361", accent:"#e4c7aa"},  ear:"puff", tail:"puff",   face:"smile" },
    { id:"chi_w",    label:"チワワ白", kind:"chi",    palette:{body:"#fff7ef", ear:"#d9b7a0", accent:"#fff7ef"},  ear:"tri",  tail:"thin",   face:"smile" },
    { id:"chi_b",    label:"チワワ黒", kind:"chi",    palette:{body:"#2b2b2b", ear:"#1a1a1a", accent:"#f4d3b3"},  ear:"tri",  tail:"thin",   face:"smile", eye:"light" },
  ];

  function pickDogType(t) {
    // 時間でちょっと偏りを変える（後半はバリエーション増）
    if (t < 8) return pick([dogTypes[0], dogTypes[7], dogTypes[1]]);
    if (t < 20) return pick([dogTypes[0], dogTypes[7], dogTypes[2], dogTypes[3], dogTypes[4]]);
    return pick(dogTypes);
  }

  function drawEnemyDog(g, o) {
    // “走ってる感”を出す：足アニメ + 影
    const p = o.palette;
    const x = o.x, y = o.y, w = o.w, h = o.h;

    // 影（地面基準）
    const shadowY = groundY - 8;
    g.save();
    g.globalAlpha = 0.20;
    g.fillStyle = "#000";
    g.beginPath();
    g.ellipse(x + w*0.48, shadowY, w*0.22, h*0.08, 0, 0, Math.PI*2);
    g.fill();
    g.restore();

    // ランアニメ
    const phase = (o.anim || 0);
    const legSwing = Math.sin(phase) * 2.2;

    const bodyW = (o.body === "long") ? w*0.70 : w*0.62;
    const bodyH = h*0.36;
    const bodyX = x + w*0.18;
    const bodyY = y + h*0.46;

    const headR = w*0.20;
    const headX = x + w*0.30;
    const headY = y + h*0.36;

    // 体
    g.fillStyle = p.body;
    roundRect(g, bodyX, bodyY, bodyW, bodyH, 12);
    g.fill();

    // お腹色（アクセント）
    g.fillStyle = p.accent;
    roundRect(g, bodyX + bodyW*0.10, bodyY + bodyH*0.26, bodyW*0.55, bodyH*0.60, 10);
    g.fill();

    // 頭
    g.fillStyle = p.body;
    g.beginPath();
    g.ellipse(headX, headY, headR*1.05, headR, 0, 0, Math.PI*2);
    g.fill();

    // 口周り（明るめ）
    g.fillStyle = (o.id === "chi_b") ? "#d9c5b2" : "#fff";
    g.beginPath();
    g.ellipse(headX + headR*0.10, headY + headR*0.25, headR*0.65, headR*0.55, 0, 0, Math.PI*2);
    g.fill();

    // 耳
    g.fillStyle = p.ear;
    if (o.ear === "drop") {
      g.beginPath(); g.ellipse(headX - headR*0.85, headY - headR*0.10, headR*0.48, headR*0.70, 0.3, 0, Math.PI*2); g.fill();
      g.beginPath(); g.ellipse(headX + headR*0.40, headY - headR*0.12, headR*0.48, headR*0.70, -0.2, 0, Math.PI*2); g.fill();
    } else if (o.ear === "puff") {
      g.beginPath(); g.ellipse(headX - headR*0.80, headY - headR*0.20, headR*0.55, headR*0.55, 0, 0, Math.PI*2); g.fill();
      g.beginPath(); g.ellipse(headX + headR*0.35, headY - headR*0.20, headR*0.55, headR*0.55, 0, 0, Math.PI*2); g.fill();
    } else { // tri
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

    // 目
    g.fillStyle = (o.eye === "light") ? "#f0f0f0" : "#222";
    g.beginPath(); g.arc(headX - headR*0.28, headY - headR*0.08, headR*0.12, 0, Math.PI*2); g.fill();
    g.beginPath(); g.arc(headX + headR*0.10, headY - headR*0.08, headR*0.12, 0, Math.PI*2); g.fill();

    // 鼻
    g.fillStyle = "#333";
    g.beginPath(); g.arc(headX - headR*0.05, headY + headR*0.15, headR*0.12, 0, Math.PI*2); g.fill();

    // 口
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

    // 舌（tongue）
    if (o.face === "tongue") {
      g.fillStyle = "#ff7b9e";
      g.beginPath();
      g.ellipse(headX + headR*0.04, headY + headR*0.44, headR*0.16, headR*0.12, 0, 0, Math.PI*2);
      g.fill();
    }

    // 足（4本）
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

    // しっぽ
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
    } else { // long
      g.beginPath();
      g.ellipse(tailBaseX + w*0.10, tailBaseY - h*0.04, w*0.12, h*0.08, -0.5, 0, Math.PI*2);
      g.fill();
    }
  }

  // ===== 敵犬の変な動き（上下/ぴょこ）パラメータ付与 =====
  function enemyBobProfile(dtp) {
    // 直線だけだと単調なので、一部に“犬っぽい動き”を混ぜる
    const r = Math.random();
    let bobMode = "none";
    let bobAmp = 0;
    let bobFreq = 0;

    const isHoppy = ["corgi", "chi_w", "chi_b", "dach"].includes(dtp.id);

    if (isHoppy) {
      // 小型はぴょこぴょこ率を上げる
      if (r < 0.38) { bobMode = "hop";  bobAmp = 18 + Math.random() * 10; bobFreq = 6.0 + Math.random() * 3.2; }
      else if (r < 0.55) { bobMode = "wave"; bobAmp = 6 + Math.random() * 7;  bobFreq = 3.0 + Math.random() * 2.3; }
    } else {
      // それ以外はたまに上下
      if (r < 0.16) { bobMode = "wave"; bobAmp = 6 + Math.random() * 9; bobFreq = 2.6 + Math.random() * 2.4; }
    }

    // 友達犬は基本まっすぐ（予測しやすく）→ 必要ならここを true に
    return { bobMode, bobAmp, bobFreq };
  }

  // ===== 障害物生成 =====
  function spawnOne(type = null) {
    const t = elapsed;

    // 0〜3秒は柵中心
    let spawnType = "fence";
    if (t >= 3) spawnType = "dog";

    // たまに友達犬（当たってもOK枠）
    if (spawnType !== "fence") {
      const friendChance = clamp(0.03 + (t - 8) * 0.001, 0.03, 0.07);
      if (Math.random() < friendChance) spawnType = "friend";
    }

    const df = difficultyFactor(t);
    const baseSpeed = 255 * Math.pow(df, 1.08); // 速度UP（後半の伸び強め）

    // 理不尽スポーン抑制：距離保証（ただし後半は詰める）
    const minGapPx = clamp(230 - (df - 1) * 70, 110, 230);
    const rightmost = obstacles.length ? Math.max(...obstacles.map(o => o.x + o.w)) : -9999;
    const spawnX = Math.max(W + 40, rightmost + minGapPx);

    // 柵
    if (spawnType === "fence") {
      const w = rand(26, 34);
      const h = rand(40, 58);
      obstacles.push({
        type: "fence",
        x: spawnX,
        y: groundY - h,
        w, h,
        vx: baseSpeed * 1.00,
        passed: false,
        nearDone: false,
        wobble: rand(0, Math.PI * 2),
      });
      return;
    }

    // 友達犬（当たってもOK）：少し小さく
    if (spawnType === "friend") {
      const w = 58, h = 40;
      const pickT = pickDogType(elapsed);

      // 友達犬は基本まっすぐ（予測しやすい）※欲しければ波だけ少し付けてもOK
      obstacles.push({
        type: "friend",
        id: pickT.id,
        label: pickT.label,
        kind: "friend",
        palette: pickT.palette,
        ear: pickT.ear,
        tail: pickT.tail,
        face: pickT.face,
        legs: pickT.legs,
        body: pickT.body,
        eye: pickT.eye,
        x: spawnX,
        baseY: groundY - h,
        y: groundY - h,
        w, h,
        vx: baseSpeed * 0.95,
        passed: false,
        nearDone: false,
        wobble: rand(0, Math.PI * 2),
        anim: rand(0, Math.PI * 2),
        sparkle: true,

        // bob（友達は原則なし）
        bobMode: "none",
        bobAmp: 0,
        bobFreq: 0,
        bobPhase: 0,
      });
      setDex("friend");
      return;
    }

    // 敵犬（当たり判定は見た目より少し優しく）
    const dtp = type || pickDogType(elapsed);
    const w = 64, h = 44;

    const bob = enemyBobProfile(dtp);

    obstacles.push({
      type: "dog",
      id: dtp.id,
      label: dtp.label,
      kind: dtp.kind,
      palette: dtp.palette,
      ear: dtp.ear,
      tail: dtp.tail,
      face: dtp.face,
      legs: dtp.legs,
      body: dtp.body,
      eye: dtp.eye,
      x: spawnX,
      baseY: groundY - h,
      y: groundY - h,
      w, h,
      vx: baseSpeed,
      passed: false,
      nearDone: false,
      wobble: rand(0, Math.PI * 2),
      anim: rand(0, Math.PI * 2),

      // 追加：変な動き
      bobMode: bob.bobMode,
      bobAmp: bob.bobAmp,
      bobFreq: bob.bobFreq,
      bobPhase: rand(0, Math.PI * 2),
    });
    setDex(dtp.kind);
  }

  function updateSpawnQueue(dt) {
    if (!spawnQueue.length) return;
    for (let i = spawnQueue.length - 1; i >= 0; i--) {
      spawnQueue[i].t -= dt;
      if (spawnQueue[i].t <= 0) {
        const typ = spawnQueue[i].type;
        spawnQueue.splice(i, 1);
        if (running && !gameOver) spawnOne(typ);
      }
    }
  }

  function updateSpawns(dt) {
    const t = elapsed;
    const df = difficultyFactor(t);

    let baseInterval;
    if (t < 3) baseInterval = 0.74;
    else if (t < 8) baseInterval = 0.52;
    else baseInterval = 0.44;

    // 密度UP：下限を下げる
    const interval = clamp(baseInterval / df, 0.12, 0.95);

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnOne();

      // 8秒以降：2体目（確率高め）
      if (t >= 8) {
        const multiChance = clamp(0.20 + (t - 8) * 0.018, 0.20, 0.60);
        if (Math.random() < multiChance) {
          const offset = clamp(0.18 - (df - 1) * 0.020, 0.08, 0.18);
          spawnQueue.push({ t: offset, type: pickDogType(elapsed) });
        }
      }

      // 14秒以降：まれに3体目（中盤から増える）
      if (t >= 14) {
        const tripleChance = clamp(0.06 + (t - 12) * 0.004, 0.06, 0.22);
        if (Math.random() < tripleChance) {
          const offset2 = 0.22;
          spawnQueue.push({ t: offset2, type: pickDogType(elapsed) });
        }
      }

      spawnTimer = interval + rand(-0.08, 0.10);
      spawnTimer = clamp(spawnTimer, 0.12, 1.2);
    }
  }

  // ===== 物理更新 =====
  function updatePlayer(dt) {
    // 左右移動（画面内）
    let ax = 0;
    if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) ax -= 1;
    if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) ax += 1;

    // ポインタ押しで追従（軽め）
    if (pointerDown) {
      const px = pointerX - canvas.getBoundingClientRect().left;
      if (px < W * 0.45) ax -= 0.35;
      if (px > W * 0.55) ax += 0.35;
    }

    player.vx = ax * 320;
    player.x += player.vx * dt;
    player.x = clamp(player.x, 20, W - player.w - 20);

    // 重力
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

  function updateObstacles(dt) {
    const df = difficultyFactor(elapsed);

    for (let i = obstacles.length - 1; i >= 0; i--) {
      const o = obstacles[i];
      o.x -= o.vx * dt;

      if (o.anim != null) o.anim += dt * (8 + df*1.3);

      // 追加：敵犬の上下/ぴょこ挙動
      if ((o.type === "dog" || o.type === "friend") && o.bobAmp && o.bobFreq) {
        o.bobPhase = (o.bobPhase || 0) + dt * o.bobFreq;
        const s = Math.sin(o.bobPhase);

        if (o.bobMode === "hop") {
          // hop: abs(sin) で“地面→上→地面”（浮いて見えにくい）
          o.y = o.baseY - Math.abs(s) * o.bobAmp;
        } else if (o.bobMode === "wave") {
          // wave: ふわっと上下
          o.y = o.baseY + s * o.bobAmp;
        } else {
          o.y = o.baseY;
        }

        // 保険：画面外や地面突き抜け防止
        o.y = clamp(o.y, 30, groundY - o.h);
      } else if (o.baseY != null) {
        // bob無しでも baseY を持ってたら同期
        o.y = o.baseY;
      }

      // 画面外
      if (o.x + o.w < -80) {
        obstacles.splice(i, 1);
        continue;
      }

      // 回避カウント
      if (!o.passed && o.x + o.w < player.x) {
        o.passed = true;
        avoided++;
        avoidStreak = (elapsed - lastAvoidAt < 2.2) ? (avoidStreak + 1) : 1;
        lastAvoidAt = elapsed;

        // スコア
        const add = (o.type === "friend") ? 2 : (o.type === "fence" ? 5 : 8);
        score += add;
      }

      // ニアミス判定（当たり判定より少し広い帯で）
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
          nearMissCount++;
          missionCounters.chiAvoid++;
          pushPopup("ニアミス！+4", player.x + player.w/2, player.y - 8, 0.9, 18);
          score += 4;
        }
      }

      // 衝突
      if (collide(player, o)) {
        if (o.type === "friend") {
          // 友達犬：ちょいボーナス＆スロー
          pushPopup("なでた！+10", player.x + player.w/2, player.y - 10, 1.0, 20);
          score += 10;
          slowmoT = 0.25;
          obstacles.splice(i, 1);
          continue;
        }
        endGame();
        return;
      }
    }
  }

  function updatePopups(dt) {
    for (let i = popups.length - 1; i >= 0; i--) {
      const p = popups[i];
      p.t += dt;
      p.y += p.vy * dt;
      if (p.t >= p.life) popups.splice(i, 1);
    }
  }

  // ===== 当たり判定（敵犬は少し優しく） =====
  function rectHit(x1,y1,w1,h1, x2,y2,w2,h2) {
    return x1 < x2+w2 && x1+w1 > x2 && y1 < y2+h2 && y1+h1 > y2;
  }

  function collide(pl, o) {
    // プレイヤー
    const px = pl.x + 6, py = pl.y + 6, pw = pl.w - 12, ph = pl.h - 12;

    // 障害物（犬は見た目の胴体寄りに縮める）
    let ox = o.x, oy = o.y, ow = o.w, oh = o.h;
    if (o.type === "dog" || o.type === "friend") {
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

  // ===== 描画 =====
  function drawBackground() {
    // 空
    const grad = ctx.createLinearGradient(0,0,0,H);
    grad.addColorStop(0, "#9fd7ff");
    grad.addColorStop(1, "#bfe7ff");
    ctx.fillStyle = grad;
    ctx.fillRect(0,0,W,H);

    // 遠景の丘
    ctx.fillStyle = "#bfe6d8";
    ctx.beginPath();
    ctx.moveTo(0, groundY-48);
    ctx.quadraticCurveTo(W*0.35, groundY-92, W*0.65, groundY-58);
    ctx.quadraticCurveTo(W*0.85, groundY-36, W, groundY-60);
    ctx.lineTo(W, groundY);
    ctx.lineTo(0, groundY);
    ctx.closePath();
    ctx.fill();

    // 雲
    drawCloud(120, 72, 1.0);
    drawCloud(380, 62, 0.8);
    drawCloud(520, 92, 1.2);

    // 地面
    ctx.fillStyle = "#2bb673";
    ctx.fillRect(0, groundY, W, H-groundY);

    // 草の帯
    ctx.fillStyle = "rgba(0,0,0,.08)";
    ctx.fillRect(0, groundY, W, 12);
  }

  function drawCloud(x, y, s) {
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.ellipse(x, y, 40*s, 22*s, 0, 0, Math.PI*2);
    ctx.ellipse(x+28*s, y-10*s, 34*s, 18*s, 0, 0, Math.PI*2);
    ctx.ellipse(x+56*s, y, 40*s, 22*s, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
  }

  // 追加：左上にブランドを常時表示（テキストのみなのでバグりにくい）
  function drawBrandOverlay() {
    ctx.save();
    ctx.globalAlpha = 0.92;
    ctx.font = "900 12px system-ui, -apple-system, Segoe UI, sans-serif";

    // 影
    ctx.fillStyle = "rgba(0,0,0,.28)";
    ctx.fillText("わんグル / dognavi.com", 13, 19);

    ctx.fillStyle = "rgba(255,255,255,.92)";
    ctx.fillText("わんグル / dognavi.com", 12, 18);
    ctx.restore();
  }

  function drawPlayer() {
    const x = player.x, y = player.y, w = player.w, h = player.h;

    // 影
    ctx.save();
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.ellipse(x+w*0.50, groundY-8, w*0.22, h*0.08, 0, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();

    if (dogImg) {
      // 画像を角丸で描画
      ctx.save();
      ctx.beginPath();
      roundRect(ctx, x, y, w, h, 10);
      ctx.clip();
      ctx.drawImage(dogImg, x, y, w, h);
      ctx.restore();
    } else {
      // デフォ犬
      const off = document.createElement("canvas");
      off.width = 56; off.height = 56;
      const g = off.getContext("2d");
      drawDefaultDogIcon(g);

      ctx.save();
      ctx.beginPath();
      roundRect(ctx, x, y, w, h, 10);
      ctx.clip();
      ctx.drawImage(off, x-6, y-6, w+12, h+12);
      ctx.restore();
    }
  }

  function drawObstacles() {
    for (const o of obstacles) {
      if (o.type === "fence") {
        // 木の柵
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
    if (stageNameEl) stageNameEl.textContent = stageName(elapsed);

    // BEST
    const best = safeGetLS("dogdash_best_v1", 0);
    if (bestEl) bestEl.textContent = best ? String(best) : "—";
  }

  // ===== ループ =====
  function tick(ts) {
    raf = requestAnimationFrame(tick);
    if (!lastT) lastT = ts;
    let dt = (ts - lastT) / 1000;
    lastT = ts;

    // 安全
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
  }

  function render() {
    drawBackground();
    drawObstacles();
    drawPlayer();
    drawPopups();

    // ガイド
    ctx.fillStyle = "rgba(0,0,0,.32)";
    ctx.font = "800 12px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText("←/→ or A/Dで移動 / クリック・Spaceでジャンプ（2段）", 14, 56);

    ctx.fillStyle = "rgba(0,0,0,.30)";
    ctx.font = "900 12px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText(`ニアミス:${nearMissCount}  連続:${avoidStreak}`, 14, 74);

    if (!running && !gameOver) {
      ctx.fillStyle = "rgba(0,0,0,.35)";
      ctx.font = "900 22px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText("スタートを押してね！🐾", 18, 98);
    }

    if (gameOver) {
      ctx.fillStyle = "rgba(0,0,0,.42)";
      ctx.font = "900 42px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText("GAME OVER", 22, 110);
      ctx.font = "900 18px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText("リトライで再挑戦！", 26, 138);
    }

    // 追加：ブランドは“常に最前面”
    drawBrandOverlay();
  }

  // ===== 終了処理 =====
  function rankLabel(s) {
    if (s >= 1500) return "SSS：散歩の神";
    if (s >= 1100) return "SS：犬の王";
    if (s >= 800) return "S：散歩マスター";
    if (s >= 550) return "A：良い散歩";
    if (s >= 300) return "B：犬慣れしてきた";
    if (s >= 160) return "C：公園常連";
    return "D：リード絡まり";
  }

  function endGame() {
    gameOver = true;
    running = false;

    // BEST更新
    const best = safeGetLS("dogdash_best_v1", 0);
    if (score > best) safeSetLS("dogdash_best_v1", score);

    updateHUD();

    const r = rankLabel(score);
    if (resultEl) resultEl.textContent = `SCORE ${score}（${r}）`;

    // シェア文
    if (shareTextEl) {
      shareTextEl.value =
`🐶 うちの犬 お散歩ダッシュ

RANK：${r}
TIME：${elapsed.toFixed(1)}秒
SCORE：${score}

#わんグル #犬ゲーム #お散歩ダッシュ`;
    }

    // カード生成
    makeResultCard(r);
  }

  function makeResultCard(rank) {
    const cw = 1200, ch = 675; // 16:9
    const c = document.createElement("canvas");
    c.width = cw; c.height = ch;
    const g = c.getContext("2d");

    // 背景
    const grad = g.createLinearGradient(0,0,0,ch);
    grad.addColorStop(0, "#9fd7ff");
    grad.addColorStop(1, "#bfe7ff");
    g.fillStyle = grad;
    g.fillRect(0,0,cw,ch);

    // 雲
    g.globalAlpha = 0.9;
    g.fillStyle = "#fff";
    const cloud = (x,y,s)=>{
      g.beginPath();
      g.ellipse(x, y, 70*s, 40*s, 0, 0, Math.PI*2);
      g.ellipse(x+50*s, y-18*s, 60*s, 34*s, 0, 0, Math.PI*2);
      g.ellipse(x+100*s, y, 70*s, 40*s, 0, 0, Math.PI*2);
      g.fill();
    };
    cloud(170,120,1.0); cloud(760,90,0.85); cloud(930,160,1.1);
    g.globalAlpha = 1;

    // 地面
    g.fillStyle = "#2bb673";
    g.fillRect(0, ch-150, cw, 150);

    // タイトル
    g.fillStyle = "rgba(0,0,0,.45)";
    g.font = "900 44px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText("うちの犬 お散歩ダッシュ", 60, 120);
    g.fillStyle = "#fff";
    g.fillText("うちの犬 お散歩ダッシュ", 58, 118);

    // スコア
    g.fillStyle = "rgba(0,0,0,.42)";
    g.font = "900 56px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText(`SCORE ${score}`, 60, 210);
    g.fillStyle = "#fff";
    g.fillText(`SCORE ${score}`, 58, 208);

    // ランク
    g.fillStyle = "rgba(0,0,0,.35)";
    g.font = "900 40px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText(`${rank}`, 60, 270);
    g.fillStyle = "#fff";
    g.fillText(`${rank}`, 58, 268);

    // 記録
    g.fillStyle = "rgba(0,0,0,.35)";
    g.font = "800 28px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText(`TIME ${elapsed.toFixed(1)}秒  /  ニアミス ${nearMissCount}`, 60, 320);

    // 犬画像枠
    g.save();
    g.translate(cw-360, 160);
    g.fillStyle = "rgba(0,0,0,.22)";
    roundRect(g, 0, 0, 260, 260, 32);
    g.fill();
    g.beginPath();
    roundRect(g, 10, 10, 240, 240, 28);
    g.clip();

    if (dogImg) {
      g.drawImage(dogImg, 10, 10, 240, 240);
    } else {
      const off = document.createElement("canvas");
      off.width = 56; off.height = 56;
      const gg = off.getContext("2d");
      drawDefaultDogIcon(gg);
      g.drawImage(off, 10, 10, 240, 240);
    }
    g.restore();

    // URL
    g.fillStyle = "rgba(0,0,0,.28)";
    g.font = "800 22px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText("わんグル / dognavi.com", 60, ch-40);

    const url = c.toDataURL("image/png");
    if (resultCardImg) resultCardImg.src = url;
  }

  // ===== UI =====
  function resetGameState() {
    elapsed = 0; avoided = 0; nearMissCount = 0; avoidStreak = 0; lastAvoidAt = 0;
    score = 0; eventScore = 0;
    obstacles = [];
    spawnTimer = 0;
    spawnQueue = [];
    slowmoT = 0;
    popups.length = 0;
    missionCounters.chiAvoid = 0;

    player.x = W * 0.20;
    player.y = groundY - player.h;
    player.vx = 0; player.vy = 0;
    player.onGround = true;
    player.jumpsLeft = 2;

    running = false;
    gameOver = false;
    lastT = 0;

    updateHUD();
    if (resultEl) resultEl.textContent = "";
    if (shareTextEl) shareTextEl.value = "";
    if (resultCardImg) resultCardImg.src = "";

    updateDailyUI(false);
    if (stageNameEl) stageNameEl.textContent = stageName(0);
  }

  function startGame() {
    if (running) return;
    if (gameOver) resetGameState();
    updateDailyUI(true);
    running = true;
    gameOver = false;
    lastT = 0;
    spawnTimer = 0.30;
  }

  function retryGame() {
    resetGameState();
    startGame();
  }

  // ===== イベント =====
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") e.preventDefault();
    keys.add(e.key);
    if (e.code === "Space") doJump();
  }, { passive: false });

  window.addEventListener("keyup", (e) => { keys.delete(e.key); });

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

  canvas.addEventListener("pointerup", (e) => {
    pointerDown = false;
    try { canvas.releasePointerCapture?.(e.pointerId); } catch {}
  });

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

  function saveCard() {
    if (!resultCardImg || !resultCardImg.src) return;
    const a = document.createElement("a");
    a.href = resultCardImg.src;
    a.download = "dogdash_result.png";
    a.click();
  }
  if (saveBtn) saveBtn.addEventListener("click", saveCard);

  // 初期UI
  updateDexUI();
  updateDailyUI(false);
  updateHUD();

  // 起動
  raf = requestAnimationFrame(tick);
})();
