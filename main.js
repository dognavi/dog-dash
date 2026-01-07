/* =========================================
   うちの犬 お散歩ダッシュ（障害物よけ）
   main.js  (v3.2)
   - 難易度：時間で上昇（速度＆密度）
   - ニアミス / 連続回避：ポップアップ表示
   - 犬図鑑（遭遇）：localStorageで保存＆UI更新
   - 敵犬：アウトライン無し（塗りだけ）＋種類が分かるデザイン差
   ========================================= */

(() => {
  // ===== DOM =====
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const dogFile = document.getElementById("dogFile");
  const startBtn = document.getElementById("startBtn");
  const retryBtn = document.getElementById("retryBtn");

  const scoreEl = document.getElementById("score");
  const timeEl  = document.getElementById("time");
  const resultEl = document.getElementById("result");

  const stageNameEl = document.getElementById("stageName");
  const dailyStatusEl = document.getElementById("dailyStatus");
  const bestScoreEl = document.getElementById("bestScore");

  const dailyTextEl = document.getElementById("dailyText");
  const dailyBadgeEl = document.getElementById("dailyBadge");
  const stampCountEl = document.getElementById("stampCount");

  const dexBigEl = document.getElementById("dex_big");
  const dexChiEl = document.getElementById("dex_chi");
  const dexWeirdEl = document.getElementById("dex_weird");
  const dexFriendEl = document.getElementById("dex_friend");

  const shareTextEl = document.getElementById("shareText");
  const btnCopyShare = document.getElementById("btnCopyShare");
  const btnSaveCard  = document.getElementById("btnSaveCard");
  const resultCardCanvas = document.getElementById("resultCardCanvas"); // 1200x675

  // 結果カード表示img（無ければJSで作る）
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
    const shareBox = shareTextEl?.closest(".shareBox") || null;
    (shareBox?.parentElement || document.body).appendChild(resultCardImg);
  }

  // ===== サイズ/物理 =====
  const W = canvas.width;
  const H = canvas.height;
  const GROUND_H = 52;
  const groundY = H - GROUND_H;

  const GRAV = 1600;
  const JUMP_V = 720;
  const MOVE_V = 360;

  // ===== localStorage keys =====
  const LS = {
    BEST:   "dogdash_bestScore_v3",
    STAMPS: "dogdash_stamps_v3",
    DEX:    "dogdash_dex_v3",
    DAILY:  "dogdash_daily_v3",
  };

  // ===== util =====
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rand  = (a, b) => a + Math.random() * (b - a);
  const randi = (a, b) => Math.floor(rand(a, b + 1));

  function safeJSONParse(str, fallback) { try { return JSON.parse(str); } catch { return fallback; } }

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

  // 短いスロー演出
  let slowmoT = 0;

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

  // ポップアップ（ニアミスなど）
  const popups = []; // {x,y,text,life,vy}
  function addPopup(text, x, y) {
    popups.push({ x, y, text, life: 0.80, vy: -26 });
  }
  function updatePopups(dt) {
    for (const p of popups) {
      p.life -= dt;
      p.y += p.vy * dt;
    }
    for (let i = popups.length - 1; i >= 0; i--) if (popups[i].life <= 0) popups.splice(i, 1);
  }
  function drawPopups() {
    if (!popups.length) return;
    ctx.save();
    ctx.font = "900 13px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.textAlign = "center";
    for (const p of popups) {
      const a = clamp(p.life / 0.8, 0, 1);
      ctx.lineWidth = 4;
      ctx.strokeStyle = `rgba(0,0,0,${0.28 * a})`;
      ctx.fillStyle = `rgba(255,255,255,${0.92 * a})`;
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }

  // ===== ベスト/図鑑/デイリー =====
  function loadBestScore() {
    const best = Number(localStorage.getItem(LS.BEST) || "0");
    if (bestScoreEl) bestScoreEl.textContent = best > 0 ? String(best) : "—";
    return best;
  }
  function setBestScore(v) {
    const cur = loadBestScore();
    if (v > cur) {
      localStorage.setItem(LS.BEST, String(v));
      if (bestScoreEl) bestScoreEl.textContent = String(v);
      return true;
    }
    return false;
  }

  function loadStamps() {
    const n = Number(localStorage.getItem(LS.STAMPS) || "0");
    if (stampCountEl) stampCountEl.textContent = String(n);
    return n;
  }
  function addStamp() {
    const n = loadStamps() + 1;
    localStorage.setItem(LS.STAMPS, String(n));
    if (stampCountEl) stampCountEl.textContent = String(n);
  }

  function loadDex() {
    const dex = safeJSONParse(localStorage.getItem(LS.DEX) || "{}", {});
    const norm = {
      big: !!dex.big,
      chi: !!dex.chi,
      weird: !!dex.weird,
      friend: !!dex.friend,
    };
    localStorage.setItem(LS.DEX, JSON.stringify(norm));
    return norm;
  }
  function setDex(kind) {
    const dex = loadDex();
    if (!dex[kind]) {
      dex[kind] = true;
      localStorage.setItem(LS.DEX, JSON.stringify(dex));
    }
    renderDex();
  }
  function setDexBadge(el, ok) {
    if (!el) return;
    el.textContent = ok ? "済" : "未";
    el.className = ok ? "badge ok" : "badge";
  }
  function renderDex() {
    const dex = loadDex();
    setDexBadge(dexBigEl, dex.big);
    setDexBadge(dexChiEl, dex.chi);
    setDexBadge(dexWeirdEl, dex.weird);
    setDexBadge(dexFriendEl, dex.friend);
  }

  function nowDateKey() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }
  function seededRand(seed) {
    let x = seed | 0;
    return () => {
      x ^= x << 13; x |= 0;
      x ^= x >>> 17; x |= 0;
      x ^= x << 5; x |= 0;
      return ((x >>> 0) % 1000000) / 1000000;
    };
  }
  function getDaily() {
    const key = nowDateKey();
    const saved = safeJSONParse(localStorage.getItem(LS.DAILY) || "{}", {});
    if (saved && saved.key === key) return saved;

    let seed = 0;
    for (let i = 0; i < key.length; i++) seed = (seed * 31 + key.charCodeAt(i)) | 0;
    const r = seededRand(seed);

    const pool = [
      { id: "near",   text: "ニアミスを3回決めろ", target: 3 },
      { id: "chi",    text: "凶暴チワワを5回回避せよ", target: 5 },
      { id: "streak", text: "連続回避を20まで繋げろ", target: 20 },
      { id: "time",   text: "20.0秒以上生き残れ", target: 20.0 },
      { id: "score",  text: "スコア300を超えろ", target: 300 },
    ];
    const pick = pool[Math.floor(r() * pool.length)];
    const daily = { key, mission: pick, done: false };
    localStorage.setItem(LS.DAILY, JSON.stringify(daily));
    return daily;
  }
  function updateDailyUI(inGame = false) {
    const d = getDaily();
    if (dailyTextEl) dailyTextEl.textContent = d.mission.text;
    if (dailyBadgeEl) {
      dailyBadgeEl.textContent = d.done ? "達成" : "未達";
      dailyBadgeEl.className = d.done ? "badge ok" : "badge";
    }
    if (dailyStatusEl) dailyStatusEl.textContent = d.done ? "達成" : (inGame ? "挑戦中" : "未達");
  }
  function setDailyDone() {
    const d = getDaily();
    if (d.done) return;
    d.done = true;
    localStorage.setItem(LS.DAILY, JSON.stringify(d));
    addStamp();
    updateDailyUI(true);
  }

  const missionCounters = { chiAvoid: 0 };

  function checkDailyProgress() {
    const d = getDaily();
    if (d.done) return;
    const m = d.mission;

    let ok = false;
    if (m.id === "near")   ok = nearMissCount >= m.target;
    if (m.id === "chi")    ok = missionCounters.chiAvoid >= m.target;
    if (m.id === "streak") ok = avoidStreak >= m.target;
    if (m.id === "time")   ok = elapsed >= m.target;
    if (m.id === "score")  ok = score >= m.target;

    if (ok) {
      setDailyDone();
      addPopup("デイリー達成！ +スタンプ", player.x + player.w / 2, player.y - 28);
    }
  }

  // ===== HUD =====
  function updateHUD() {
    if (timeEl) timeEl.textContent = elapsed.toFixed(1);
    if (scoreEl) scoreEl.textContent = String(score);
  }

  // ===== 難易度 =====
  function difficultyFactor(t) {
    // 体感を上げる：前半から伸び、後半も伸び続ける
    const a = 1 + (Math.min(t, 60) / 60) * 1.65;      // max 2.65
    const b = t > 15 ? 1 + (Math.min(t - 15, 60) / 60) * 0.60 : 1; // max 1.60
    return a * b; // max ~4.24
  }
  function phase(t) {
    if (t < 3) return 0;
    if (t < 8) return 1;
    return 2;
  }
  function stageName(t) {
    if (t < 10) return "公園";
    if (t < 20) return "商店街";
    if (t < 30) return "テラス席";
    return "ドッグカフェ";
  }

  // ===== 入力 =====
  function doJump() {
    if (!running || gameOver) return;
    if (player.jumpsLeft > 0) {
      player.vy = -JUMP_V;
      player.onGround = false;
      player.jumpsLeft -= 1;
    }
  }

  // ===== 背景 =====
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

    // watermark
    ctx.fillStyle = "rgba(0,0,0,.35)";
    ctx.font = "700 12px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText("わんグル / dognavi.com", 12, 18);

    const st = stageName(elapsed);
    if (stageNameEl) stageNameEl.textContent = st;
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.font = "900 12px system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillText(`STAGE：${st}`, 12, 36);
  }

  // ===== 当たり判定（甘め） =====
  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }
  function hitTestPlayerObs(obs) {
    const padP = 6;
        const padO = (obs.type === "fence") ? 6 : 14; // 犬は当たり判定を画像寄りに（小さめ）
    const px = player.x + padP, py = player.y + padP, pw = player.w - padP * 2, ph = player.h - padP * 2;
    const ox = obs.x + padO, oy = obs.y + padO, ow = obs.w - padO * 2, oh = obs.h - padO * 2;
    return aabb(px, py, pw, ph, ox, oy, ow, oh);
  }

  // ===== ニアミス =====
  function checkNearMiss(obs) {
    if (obs.nearDone) return false;
    if (obs.passed) return false;
    if (obs.type === "friend") return false;

    const px1 = player.x, px2 = player.x + player.w;
    const ox1 = obs.x,    ox2 = obs.x + obs.w;
    const xClose = (ox1 < px2 + 8) && (ox2 > px1 - 8);
    if (!xClose) return false;

    const pyBottom = player.y + player.h;
    const oyTop = obs.y;
    const dy = Math.abs(pyBottom - oyTop);

    if (player.y < obs.y && dy <= 14) {
      obs.nearDone = true;
      nearMissCount += 1;
      eventScore += 4;
      addPopup("ニアミス +4", player.x + player.w / 2, player.y - 10);
      return true;
    }
    return false;
  }

  // ===== 障害物生成 =====
  function pickDogType(t) {
    const r = Math.random();
    // 種類を“見た目で分かる”比率に
    if (t < 10) {
      if (r < 0.40) return "big";    // もふ大型（薄ゴールド）
      if (r < 0.70) return "weird";  // コーギー風（茶/白）
      return "chi";                  // チワワ（ピンク）
    } else {
      if (r < 0.30) return "big";
      if (r < 0.62) return "weird";
      return "chi";
    }
  }

  // 犬種バリエーション（見た目差分用）
  function pickBreed(dogType) {
    const pools = {
      big:    ["samoyed", "pomeranian", "retriever"],
      chi:    ["chiCream", "chiBlack"],
      weird:  ["corgi", "pug", "dachshund", "poodle"],
      friend: ["shiba", "beagle"],
    };
    const arr = pools[dogType] || ["samoyed"];
    return arr[(Math.random() * arr.length) | 0];
  }


  function spawnOne(typeOverride = null) {
    const t = elapsed;
    const p = phase(t);
    let type = typeOverride;

    if (!type) {
      if (p === 0) type = "fence";
      else if (p === 1) type = Math.random() < 0.62 ? pickDogType(t) : "fence";
      else type = Math.random() < 0.76 ? pickDogType(t) : "fence";
    }

    // フレンド犬（緑）低確率
    if (t >= 8 && type !== "fence") {
      const friendChance = clamp(0.03 + (t - 8) * 0.001, 0.03, 0.07);
      if (Math.random() < friendChance) type = "friend";
    }

    const df = difficultyFactor(t);
    const baseSpeed = 240 * df; // 速度UP

    // 理不尽スポーン抑制：距離保証（ただし後半は詰める）
    const minGapPx = clamp(250 - (df - 1) * 55, 150, 250);
    const rightmost = obstacles.length ? Math.max(...obstacles.map(o => o.x + o.w)) : -9999;
    const spawnX = Math.max(W + 20, rightmost + minGapPx);

    if (type === "fence") {
      const h = randi(44, 78);
      const w = randi(42, 60);
      obstacles.push({ type, x: spawnX, y: groundY - h, w, h, vx: baseSpeed, passed: false, nearDone: false });
      return;
    }

    if (type === "big") {
      const breed = pickBreed(type);
      const w = 92, h = 74; // ちょい大きめに（犬っぽさUP）
      obstacles.push({
        type,
        dogType: type,
        breed,
        x: spawnX,
        y: groundY - h,
        w, h,
        vx: baseSpeed * 0.92,
        passed: false,
        nearDone: false,
        anim: rand(0, Math.PI * 2),
      });
      setDex("big");
      return;
    }

    if (type === "chi") {
      const breed = pickBreed(type);
      const w = 66, h = 54; // 大きめ＆犬感
      obstacles.push({
        type,
        dogType: type,
        breed,
        x: spawnX,
        y: groundY - h,
        w, h,
        vx: baseSpeed * 1.20,
        passed: false,
        nearDone: false,
        feint: { done: false, t: 0, triggerX: W * rand(0.55, 0.70) },
        anim: rand(0, Math.PI * 2),
      });
      setDex("chi");
      return;
    }

    if (type === "weird") {
      const breed = pickBreed(type);
      const w = 76, h = 60;
      const baseY = groundY - h - randi(10, 46);
      obstacles.push({
        type,
        dogType: type,
        breed,
        x: spawnX,
        y: baseY,
        w, h,
        vx: baseSpeed * 1.05,
        passed: false,
        nearDone: false,
        wobble: rand(0, Math.PI * 2),
        anim: rand(0, Math.PI * 2),
      });
      setDex("weird");
      return;
    }

    if (type === "friend") {
      const breed = pickBreed(type);
      const w = 66, h = 54;
      obstacles.push({
        type,
        dogType: type,
        breed,
        x: spawnX,
        y: groundY - h,
        w, h,
        vx: baseSpeed * 1.00,
        passed: false,
        nearDone: false,
        wobble: rand(0, Math.PI * 2),
        anim: rand(0, Math.PI * 2),
        sparkle: true
      });
      setDex("friend");
      return;
    }
  }

  function updateSpawns(dt) {
    const t = elapsed;
    const df = difficultyFactor(t);

    let baseInterval;
    if (t < 3) baseInterval = 0.82;
    else if (t < 8) baseInterval = 0.62;
    else baseInterval = 0.52;

    // 密度UP：下限を下げる
    const interval = clamp(baseInterval / df, 0.16, 0.95);

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnOne();

      // 8秒以降：2体目（確率高め）
      if (t >= 8) {
        const multiChance = clamp(0.14 + (t - 8) * 0.014, 0.14, 0.42);
        if (Math.random() < multiChance) {
          const offset = clamp(0.22 - (df - 1) * 0.03, 0.11, 0.22);
          setTimeout(() => {
            if (running && !gameOver) spawnOne(pickDogType(elapsed));
          }, offset * 1000);
        }
      }

      // 14秒以降：まれに3体目（詰み回避のため低め）
      if (t >= 14) {
        const tripleChance = clamp(0.04 + (t - 14) * 0.003, 0.04, 0.12);
        if (Math.random() < tripleChance) {
          const offset2 = 0.26;
          setTimeout(() => {
            if (running && !gameOver) spawnOne(pickDogType(elapsed));
          }, offset2 * 1000);
        }
      }

      spawnTimer = interval + rand(-0.10, 0.12);
      spawnTimer = clamp(spawnTimer, 0.16, 1.2);
    }
  }

  // ===== 描画（丸角） =====
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
  
  function drawDefaultPup(x, y, w, h) {
    // デフォルト（画像未読込時）：ゆる可愛いワンチャン（輪郭線なし／塗りだけ）
    const cx = x + w * 0.50;
    const cy = y + h * 0.56;

    // body
    ctx.fillStyle = "#F2C48C";
    ctx.beginPath();
    ctx.ellipse(cx + w*0.06, cy + h*0.05, w*0.30, h*0.22, 0, 0, Math.PI*2);
    ctx.fill();

    // belly
    ctx.fillStyle = "#FFF3DA";
    ctx.beginPath();
    ctx.ellipse(cx + w*0.03, cy + h*0.09, w*0.22, h*0.16, 0, 0, Math.PI*2);
    ctx.fill();

    // head
    ctx.fillStyle = "#F2C48C";
    ctx.beginPath();
    ctx.ellipse(cx - w*0.10, cy - h*0.05, w*0.25, h*0.21, 0, 0, Math.PI*2);
    ctx.fill();

    // muzzle
    ctx.fillStyle = "#FFF3DA";
    ctx.beginPath();
    ctx.ellipse(cx - w*0.12, cy + h*0.02, w*0.18, h*0.14, 0, 0, Math.PI*2);
    ctx.fill();

    // ears（垂れ耳）
    ctx.fillStyle = "#C98D58";
    ctx.beginPath();
    ctx.ellipse(cx - w*0.27, cy - h*0.05, w*0.12, h*0.15, 0.15, 0, Math.PI*2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + w*0.02, cy - h*0.07, w*0.11, h*0.14, -0.15, 0, Math.PI*2);
    ctx.fill();

    // tail
    ctx.fillStyle = "#F2C48C";
    ctx.beginPath();
    ctx.ellipse(cx + w*0.31, cy + h*0.00, w*0.10, h*0.16, -0.7, 0, Math.PI*2);
    ctx.fill();

    // legs（地面感）
    ctx.fillStyle = "#F2C48C";
    const legY = y + h*0.79;
    const legW = w*0.065, legH = h*0.11, r = legW*0.55;
    const legs = [x + w*0.46, x + w*0.56, x + w*0.66];
    for (const lx of legs) {
      ctx.beginPath();
      ctx.moveTo(lx + r, legY);
      ctx.lineTo(lx + legW - r, legY);
      ctx.quadraticCurveTo(lx + legW, legY, lx + legW, legY + r);
      ctx.lineTo(lx + legW, legY + legH - r);
      ctx.quadraticCurveTo(lx + legW, legY + legH, lx + legW - r, legY + legH);
      ctx.lineTo(lx + r, legY + legH);
      ctx.quadraticCurveTo(lx, legY + legH, lx, legY + legH - r);
      ctx.lineTo(lx, legY + r);
      ctx.quadraticCurveTo(lx, legY, lx + r, legY);
      ctx.closePath();
      ctx.fill();
    }

    // face
    ctx.fillStyle = "#2B1F1A";
    const eyeR = Math.max(2.6, w*0.037);
    ctx.beginPath(); ctx.arc(cx - w*0.18, cy - h*0.04, eyeR, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx - w*0.07, cy - h*0.04, eyeR, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(cx - w*0.125, cy + h*0.03, Math.max(2.8, w*0.04), 0, Math.PI*2); ctx.fill();

    ctx.strokeStyle = "#2B1F1A";
    ctx.lineWidth = Math.max(2.1, w*0.032);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx - w*0.125, cy + h*0.06, w*0.06, 0.2, Math.PI-0.2);
    ctx.stroke();

    ctx.fillStyle = "#FF7A95";
    ctx.beginPath();
    ctx.ellipse(cx - w*0.12, cy + h*0.10, w*0.04, h*0.035, 0, 0, Math.PI*2);
    ctx.fill();
  }

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
      // デフォルト（画像未読込時）は可愛いワンチャン
      ctx.save();
      ctx.beginPath();
      roundRectPath(x, y, w, h, 10);
      ctx.fillStyle = "#fff";
      ctx.fill();
      drawDefaultPup(x, y, w, h);
      ctx.restore();
    }
  }

  // ===== 敵犬（塗りだけ / 種類差） =====
  function drawObstacle(o) {
    if (o.type === "fence") return drawFence(o);
    return drawDogEnemy(o);
  }

  function drawFence(o) {
    const x = o.x, y = o.y, w = o.w, h = o.h;
    ctx.fillStyle = "rgba(0,0,0,.16)";
    ctx.fillRect(x + 3, y + 6, w, h);

    const wood = ctx.createLinearGradient(x, y, x + w, y + h);
    wood.addColorStop(0, "#b9834b");
    wood.addColorStop(1, "#8a5d33");
    ctx.fillStyle = wood;
    ctx.beginPath();
    roundRectPath(x, y, w, h, 10);
    ctx.fill();

    ctx.strokeStyle = "rgba(0,0,0,.18)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const yy = y + 10 + i * (h / 4);
      ctx.beginPath();
      ctx.moveTo(x + 8, yy);
      ctx.lineTo(x + w - 8, yy + rand(-2, 2));
      ctx.stroke();
    }

    ctx.fillStyle = "rgba(255,255,255,.18)";
    ctx.beginPath();
    roundRectPath(x + 3, y + 3, w - 6, 10, 8);
    ctx.fill();
  }

  // 手描き風：塗りの“縁ふわ”を内側で作る（黒縁なし）
  function fuzzyFill(drawPathFn, baseColor, passes = 5, jitter = 1.2) {
    for (let i = 0; i < passes; i++) {
      const jx = rand(-jitter, jitter);
      const jy = rand(-jitter, jitter);
      ctx.beginPath();
      drawPathFn(jx, jy);
      ctx.fillStyle = baseColor;
      ctx.globalAlpha = 0.22;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.beginPath();
    drawPathFn(0, 0);
    ctx.fillStyle = baseColor;
    ctx.fill();
  }

    function drawDogEnemy(o) {
  const x = o.x, y = o.y, w = o.w, h = o.h;
  const dogType = o.dogType || o.type;
  const style = getDogStyle(dogType, o.breed);

  // "輪郭線なし"：塗りのみ（同色の薄ズラしでふんわり）
  const t = (elapsed * 6) + (o.bobble || 0);
  const bob = Math.sin(t) * 1.1;
  const trot = Math.sin(t * 1.9);

  // breed/proportion knobs (make the silhouette more "dog-like")
  const isCorgi = o.breed === "corgi";
  const isDach  = o.breed === "dachshund";
  const isChi   = (o.breed === "chiCream" || o.breed === "chiBlack");
  const isPug   = o.breed === "pug";
  const isPoo   = o.breed === "poodle";
  const isSamo  = o.breed === "samoyed";
  const isPom   = o.breed === "pomeranian";
  const isRet   = o.breed === "retriever";
  const isBea   = o.breed === "beagle";
  const isShiba = o.breed === "shiba";

  const longBody = isDach ? 1.18 : (isCorgi ? 1.06 : 1.0);
  const shortLeg = (isCorgi || isDach || isPug) ? 0.78 : (isChi ? 0.82 : 1.0);
  const headBig  = isChi ? 1.10 : (isPom || isSamo ? 1.05 : 1.0);
  const snoutLen = isPug ? 0.55 : (isChi ? 0.75 : 1.0);

  // helper: soft edge fill (no outline)
  function softFill(pathFn, color) {
    // base
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = color;
    pathFn(0, 0);
    ctx.fill();
    // gentle "airbrush" edge: same color, tiny offsets, low alpha
    ctx.globalAlpha = 0.12;
    for (let k = 0; k < 4; k++) {
      const ox = (k === 0 ? 1 : k === 1 ? -1 : 0) * 0.9;
      const oy = (k === 2 ? 1 : k === 3 ? -1 : 0) * 0.9;
      pathFn(ox, oy);
      ctx.fill();
    }
    ctx.restore();
  }

  function ellipse(cx, cy, rx, ry, color, a = 1) {
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.translate(x, y);
  const bobBody = bob; // body/headだけ上下（足は地面固定）

  // shadow (ground contact)
    const groundLine = h * 0.90;
  ellipse(w * 0.50, groundLine + h*0.02, w * 0.28, h * 0.09, "rgba(0,0,0,.22)", 1);

  // main anchors
  const baseY = h * 0.12 + bobBody;
  const bodyRx = w * 0.30 * longBody;
  const bodyRy = h * 0.22;
  const bodyCx = w * 0.50;
  const bodyCy = baseY + h * 0.46;

  const headRx = w * 0.18 * headBig;
  const headRy = h * 0.17 * headBig;
  const headCx = w * 0.33;
  const headCy = baseY + h * 0.36 + trot * 0.6;

  // --- legs (give "dog-ness") ---
  const legW = w * 0.075;
  const legH = h * 0.18 * shortLeg;
    const legY = groundLine - legH;
  const step = trot * w * 0.012;

  function leg(x0, phase) {
    const sway = (phase ? step : -step);
    ctx.beginPath();
    const r = legW * 0.55;
    const lx = x0 + sway;
    const ly = legY;
    // rounded rect leg
    ctx.moveTo(lx + r, ly);
    ctx.lineTo(lx + legW - r, ly);
    ctx.quadraticCurveTo(lx + legW, ly, lx + legW, ly + r);
    ctx.lineTo(lx + legW, ly + legH - r);
    ctx.quadraticCurveTo(lx + legW, ly + legH, lx + legW - r, ly + legH);
    ctx.lineTo(lx + r, ly + legH);
    ctx.quadraticCurveTo(lx, ly + legH, lx, ly + legH - r);
    ctx.lineTo(lx, ly + r);
    ctx.quadraticCurveTo(lx, ly, lx + r, ly);
    ctx.closePath();
  }

  // rear legs behind
  softFill(() => { leg(w * 0.52, false); }, style.body);
  softFill(() => { leg(w * 0.62, true);  }, style.body);

  // --- tail ---
  function tailPath(ox = 0, oy = 0) {
    const tx = w * 0.72 + ox;
    const ty = baseY + h * 0.44 + Math.sin(t * 2.4) * 1.0 + oy;
    ctx.beginPath();
    if (style.tail === "stub") {
      ctx.ellipse(tx + w * 0.08, ty + 1, w * 0.085, h * 0.06, 0.2, 0, Math.PI * 2);
    } else if (style.tail === "curl") {
      ctx.arc(tx + w * 0.10, ty, w * 0.10, 0, Math.PI * 2);
    } else if (style.tail === "pom" || style.tail === "puff") {
      ctx.arc(tx + w * 0.11, ty, w * 0.085, 0, Math.PI * 2);
      ctx.arc(tx + w * 0.07, ty + h * 0.03, w * 0.07, 0, Math.PI * 2);
    } else {
      // soft
      ctx.ellipse(tx + w * 0.10, ty, w * 0.10, h * 0.07, -0.2, 0, Math.PI * 2);
    }
  }
  softFill((ox, oy) => tailPath(ox, oy), style.body);

  // --- body (more dog-shaped than a blob) ---
  function bodyPath(ox = 0, oy = 0) {
    const cx = bodyCx + ox;
    const cy = bodyCy + oy + trot * 0.4;
    const rx = bodyRx;
    const ry = bodyRy;

    ctx.beginPath();
    // capsule + slight back arch
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    // add a small "chest" bump in front to look like a dog torso
    ctx.ellipse(cx - rx * 0.42, cy + ry * 0.10, rx * 0.62, ry * 0.72, 0, 0, Math.PI * 2);
    // hip bump
    ctx.ellipse(cx + rx * 0.38, cy + ry * 0.08, rx * 0.55, ry * 0.65, 0, 0, Math.PI * 2);
  }
  softFill(bodyPath, style.body);

  // belly tint (helps silhouette read)
  function bellyPath(ox = 0, oy = 0) {
    const cx = bodyCx - w * 0.03 + ox;
    const cy = bodyCy + h * 0.06 + oy;
    ctx.beginPath();
    ctx.ellipse(cx, cy, bodyRx * 0.78, bodyRy * 0.62, 0, 0, Math.PI * 2);
  }
  softFill(bellyPath, style.belly);

  // front legs in front
  softFill(() => { leg(w * 0.33, true);  }, style.body);
  softFill(() => { leg(w * 0.42, false); }, style.body);

  // paws (tiny darker dots)
  const pawY = legY + legH;
  ellipse(w * 0.36, pawY + 2, w * 0.035, h * 0.020, "rgba(0,0,0,.10)", 1);
  ellipse(w * 0.45, pawY + 2, w * 0.035, h * 0.020, "rgba(0,0,0,.10)", 1);
  ellipse(w * 0.55, pawY + 2, w * 0.035, h * 0.020, "rgba(0,0,0,.10)", 1);
  ellipse(w * 0.65, pawY + 2, w * 0.035, h * 0.020, "rgba(0,0,0,.10)", 1);

  // --- head + snout (this makes it read as "dog") ---
  function headPath(ox = 0, oy = 0) {
    ctx.beginPath();
    ctx.ellipse(headCx + ox, headCy + oy, headRx, headRy, 0, 0, Math.PI * 2);
  }
  softFill(headPath, style.body);

  // snout / muzzle
  function snoutPath(ox = 0, oy = 0) {
    const sx = headCx - headRx * 0.95 + ox;
    const sy = headCy + headRy * 0.25 + oy;
    ctx.beginPath();
    ctx.ellipse(sx, sy, headRx * 0.55 * snoutLen, headRy * 0.42, 0, 0, Math.PI * 2);
  }
  softFill(snoutPath, style.belly);

  // ears (breed)
  function earPath(side, ox = 0, oy = 0) {
    const sign = side === "L" ? -1 : 1;
    const ex = headCx + sign * headRx * 0.45 + ox;
    const ey = headCy - headRy * 0.85 + oy;
    const eW = headRx * (isChi ? 0.55 : 0.45);
    const eH = headRy * (isChi ? 0.80 : 0.65);

    ctx.beginPath();
    if (isPug) {
      ctx.ellipse(ex, ey + eH * 0.55, eW * 0.55, eH * 0.40, 0.2 * sign, 0, Math.PI * 2);
    } else {
      ctx.moveTo(ex, ey + eH);
      ctx.quadraticCurveTo(ex + sign * eW, ey + eH * 0.45, ex + sign * eW * 0.20, ey);
      ctx.quadraticCurveTo(ex - sign * eW * 0.10, ey + eH * 0.20, ex, ey + eH);
      ctx.closePath();
    }
  }
  softFill((ox, oy) => earPath("L", ox, oy), style.ear || style.body);
  softFill((ox, oy) => earPath("R", ox, oy), style.ear || style.body);

  // markings (mask / blaze / tan)
  if (style.mask === "blaze") {
    // corgi face blaze
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.beginPath();
    ctx.ellipse(headCx, headCy + headRy * 0.05, headRx * 0.22, headRy * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (style.mask === "pug") {
    // pug face mask
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(70,55,45,.55)";
    ctx.beginPath();
    ctx.ellipse(headCx - headRx * 0.15, headCy + headRy * 0.15, headRx * 0.70, headRy * 0.65, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (style.mask === "tan") {
    // black-tan chihuahua cheeks
    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = "rgba(210,160,105,.70)";
    ctx.beginPath();
    ctx.ellipse(headCx - headRx * 0.18, headCy + headRy * 0.25, headRx * 0.30, headRy * 0.28, 0, 0, Math.PI * 2);
    ctx.ellipse(headCx + headRx * 0.05, headCy + headRy * 0.28, headRx * 0.24, headRy * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // simple face (keep it clean)
  const eyeY = headCy + headRy * 0.02;
  const eyeDX = headRx * 0.35;
  const eyeR = Math.max(1.6, Math.min(3.2, w * 0.020));
  ellipse(headCx - eyeDX, eyeY, eyeR, eyeR, "rgba(0,0,0,.72)", 1);
  ellipse(headCx + eyeDX * 0.55, eyeY, eyeR, eyeR, "rgba(0,0,0,.72)", 1);

  // nose + tiny smile
  ellipse(headCx - headRx * 0.48, headCy + headRy * 0.23, eyeR * 0.95, eyeR * 0.80, "rgba(0,0,0,.55)", 1);
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,.38)";
  ctx.lineWidth = Math.max(1.2, w * 0.010);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(headCx - headRx * 0.22, headCy + headRy * 0.33, headRx * 0.20, 0.10 * Math.PI, 0.75 * Math.PI);
  ctx.stroke();
  ctx.restore();

  // breed extras (subtle but readable)
  if (isPoo) {
    // poodle fluff pom on head + tail
    ellipse(headCx + headRx * 0.45, headCy - headRy * 0.10, headRx * 0.28, headRy * 0.28, "rgba(255,255,255,.30)", 1);
  }
  if (isPom || isSamo) {
    // fluffy neck ruff
    ctx.save();
    ctx.globalAlpha = 0.20;
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(headCx + headRx * 0.35, headCy + headRy * 0.55, headRx * 0.85, headRy * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (isBea) {
    // beagle ear tip
    ctx.save();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = "rgba(120,85,60,.60)";
    ctx.beginPath();
    ctx.ellipse(headCx + headRx * 0.62, headCy - headRy * 0.45, headRx * 0.25, headRy * 0.35, 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  if (isShiba) {
    // shiba cheek blush
    ellipse(headCx - headRx * 0.05, headCy + headRy * 0.35, headRx * 0.22, headRy * 0.16, "rgba(255,160,160,.18)", 1);
  }

  // tiny caption pop (optional, low noise)
  if (o.pop && o.pop.t && o.pop.life > 0) {
    const a = clamp(o.pop.life / o.pop.max, 0, 1);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ctx.font = `${Math.max(10, Math.floor(w * 0.20))}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(o.pop.t, w * 0.52, h * 0.12);
    ctx.restore();
  }

  ctx.restore();
}

function getDogStyle(type, breed) {
    const B = {
      samoyed:    { label: "サモエド",   body: "#ffffff", belly: "#f3f6ff", accent: "#e9eef7", ear: "#f1f1f1", mask: null, spot: null, tail: "puff" },
      pomeranian: { label: "ポメ",       body: "#f6c36a", belly: "#fff1d6", accent: "#f0ad4e", ear: "#f3b55d", mask: null, spot: "cheek", tail: "puff" },
      retriever:  { label: "レトリバー", body: "#f2c27b", belly: "#fff0d7", accent: "#d9a25d", ear: "#d39a55", mask: null, spot: null, tail: "soft" },

      chiCream:   { label: "チワワ",     body: "#f6e3c7", belly: "#fff7ea", accent: "#e7c9a5", ear: "#f2d5b4", mask: null, spot: null, tail: "soft" },
      chiBlack:   { label: "チワワ",     body: "#2f2a2a", belly: "#f7e7d1", accent: "#1f1c1c", ear: "#2a2525", mask: "tan", spot: null, tail: "soft" },

      corgi:      { label: "コーギー",   body: "#f0b35b", belly: "#fff3dd", accent: "#e49a3b", ear: "#e7a047", mask: "blaze", spot: "butt", tail: "stub" },
      pug:        { label: "パグ",       body: "#f1d08c", belly: "#fff4dc", accent: "#d7b06a", ear: "#c9a262", mask: "pug", spot: null, tail: "curl" },
      dachshund:  { label: "ダックス",   body: "#8b5a3c", belly: "#f7e2cd", accent: "#6d432b", ear: "#6d432b", mask: null, spot: "back", tail: "soft" },
      poodle:     { label: "プードル",   body: "#e9b37b", belly: "#fff0dd", accent: "#d89b60", ear: "#d89b60", mask: "poodle", spot: null, tail: "pom" },

      shiba:      { label: "柴",         body: "#e8b46b", belly: "#fff2dc", accent: "#d59a45", ear: "#d59a45", mask: null, spot: null, tail: "curl" },
      beagle:     { label: "ビーグル",   body: "#f2c27b", belly: "#ffffff", accent: "#cc8f47", ear: "#7a4a35", mask: "beagle", spot: null, tail: "soft" },
    };

    const def = { big: "samoyed", chi: "chiCream", weird: "corgi", friend: "shiba" };
    return B[breed] || B[def[type]] || { label: "わんこ", body: "#f6e6c9", belly: "#fff3df", accent: "#e6d2aa", ear: "#e6d2aa", mask: null, spot: null, tail: "soft" };
  }

  function pickBreed(type) {
    const r = Math.random();
    if (type === "big") {
      if (r < 0.45) return "samoyed";
      if (r < 0.75) return "pomeranian";
      return "retriever";
    }
    if (type === "chi") {
      return r < 0.55 ? "chiCream" : "chiBlack";
    }
    if (type === "weird") {
      if (r < 0.30) return "corgi";
      if (r < 0.55) return "pug";
      if (r < 0.80) return "dachshund";
      return "poodle";
    }
    return r < 0.55 ? "shiba" : "beagle";
  }


  // ===== プレイヤー更新 =====
  function updatePlayer(dt) {
    let dir = 0;
    if (keys.has("ArrowLeft") || keys.has("a") || keys.has("A")) dir -= 1;
    if (keys.has("ArrowRight") || keys.has("d") || keys.has("D")) dir += 1;

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
  function recalcScore() {
    const base = avoided * 10 + Math.floor(elapsed * 5) + nearMissCount * 2;
    score = base + eventScore;
  }

  function updateObstacles(dt) {
    // 位置更新＆固有挙動
    for (const o of obstacles) {
      if (o.type === "weird") {
        // 変な犬：足は地面固定（空に浮かない）＋ちょい上下だけ
        o.wobble += dt * 4.2;
        // baseY は生成時の地面基準だが、地面高さが変わっても追従させる
        const baseY = groundY - o.h;
        o.baseY = baseY;
        o.y = baseY + Math.sin(o.wobble) * 4.0; // 小さめ
        // 上に飛びすぎないよう制限
        o.y = clamp(o.y, baseY - 6, baseY + 2);
      }
      if (o.type === "friend") {
        // フレンド犬：地面固定のまま、ふわっと上下（ドリフトしない）
        o.wobble += dt * 5.0;
        const baseY = groundY - o.h;
        o.baseY = baseY;
        o.y = baseY + Math.sin(o.wobble) * 3.0;
        o.y = clamp(o.y, baseY - 6, baseY + 2);
      }
      if (o.type === "chi" && o.feint && !o.feint.done) {
        if (o.x < o.feint.triggerX) {
          o.feint.t += dt;
          if (o.feint.t < 0.12) o.vx *= 0.92;
          else if (o.feint.t < 0.22) o.vx *= 1.06;
          else o.feint.done = true;
        }
      }

      o.x -= o.vx * dt;
      checkNearMiss(o);
    }

    // 通過判定 & streak
    for (const o of obstacles) {
      if (!o.passed && o.x + o.w < player.x) {
        o.passed = true;
        avoided += 1;

        if (o.type === "chi") missionCounters.chiAvoid += 1;

        const nowT = elapsed;
        if (nowT - lastAvoidAt > 2.0) avoidStreak = 0;
        avoidStreak += 1;
        lastAvoidAt = nowT;

        if (avoidStreak > 0 && avoidStreak % 10 === 0) {
          eventScore += 12;
          addPopup(`ナイス！ x${avoidStreak} (+12)`, player.x + player.w / 2, player.y - 14);
          slowmoT = 0.25;
        }
      }
    }

    obstacles = obstacles.filter(o => o.x + o.w > -60);

    // 衝突/フレンド
    for (const o of obstacles) {
      if (o.type === "friend") {
        if (!o.touched && hitTestPlayerObs(o)) {
          o.touched = true;
          eventScore += 25;
          addPopup("フレンド！ +25", player.x + player.w / 2, player.y - 18);
          slowmoT = 0.20;
        }
        continue;
      }
      if (hitTestPlayerObs(o)) {
        endGame();
        break;
      }
    }

    recalcScore();
  }

  // ===== update/render =====
  function update(dt) {
    if (!running || gameOver) return;

    if (slowmoT > 0) {
      slowmoT -= dt;
      dt *= 0.55;
    }

    elapsed += dt;
    updateSpawns(dt);
    updatePlayer(dt);
    updateObstacles(dt);
    updatePopups(dt);

    checkDailyProgress();
    updateHUD();
  }

  function render() {
    drawBackground();
    for (const o of obstacles) drawObstacle(o);
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
      ctx.font = "900 18px system-ui, -apple-system, Segoe UI, sans-serif";
      ctx.fillText("スタートを押してね！🐾", 14, 102);
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

  // ===== ランク/拡散 =====
  function calcRank(sc, sec) {
    const v = sec * 11 + sc * 0.62 + avoidStreak * 0.8 + nearMissCount * 2.2;

    if (v < 90)  return { rank: "E",   title: "初めてのお散歩" };
    if (v < 160) return { rank: "D",   title: "リード絡まり" };
    if (v < 240) return { rank: "C",   title: "公園常連" };
    if (v < 340) return { rank: "B",   title: "犬慣れしてきた" };
    if (v < 480) return { rank: "A",   title: "テラス席の守護者" };
    if (v < 640) return { rank: "S",   title: "わんグル公認散歩犬" };
    if (v < 760) return { rank: "SS",  title: "超ベテラン散歩犬" };
    if (v < 900) return { rank: "SSS", title: "伝説の散歩犬" };
    return { rank: "∞", title: "散歩の神" };
  }

  function pickComment(rank) {
    const map = {
      "E": ["散歩開始3秒で終了は草。", "まだ玄関で転んでる。", "まずリード持とう。"],
      "D": ["リード絡まり職人。", "犬に犬でやられた。", "今日の敵は自分。"],
      "C": ["公園なら勝てる。…たぶん。", "犬密度が高すぎる。", "まだ逃げ切れてる説。"],
      "B": ["犬慣れしてきた（なおチワワ）。", "散歩とは戦い。", "いい反射神経してる。"],
      "A": ["テラス席、完全制圧。", "大型犬も怖くない。", "飼い主力が高い。"],
      "S": ["チワワ？何それ。", "わんグル公認でOK。", "犬社会を支配してる。"],
      "SS": ["もうプロ散歩。", "散歩で飯が食える。", "ご褒美おやつ確定。"],
      "SSS": ["あなたが散歩、そのもの。", "犬の世界線を超えた。", "散歩の神候補。"],
      "∞": ["もう帰ってこなくていい（誉めてる）。", "散歩の神、降臨。", "今日の伝説、確定。"],
    };
    const arr = map[rank] || ["また来てね！"];
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function buildShareText(rankObj, sec, sc, comment) {
    const d = getDaily();
    const dailyLine = d.done ? "✅ 今日のデイリー達成" : "🎯 今日のデイリー挑戦中";
    return `🐶 うちの犬 お散歩ダッシュ\n\nRANK：${rankObj.rank}（${rankObj.title}）\nTIME：${sec.toFixed(1)}秒\nSCORE：${sc}\n${dailyLine}\n\n${comment}\n#わんグル #うちの犬お散歩ダッシュ`;
  }

  // ===== 結果カード 1200x675 =====
  function drawResultCard(rankObj, sec, sc, comment) {
    if (!resultCardCanvas) return null;

    const c = resultCardCanvas;
    const g = c.getContext("2d");
    const CW = c.width, CH = c.height;

    const bg = g.createLinearGradient(0, 0, 0, CH);
    bg.addColorStop(0, "#0b1b3e");
    bg.addColorStop(1, "#0a1226");
    g.fillStyle = bg;
    g.fillRect(0, 0, CW, CH);

    g.fillStyle = "rgba(79,121,255,.18)";
    g.beginPath();
    g.moveTo(-120, 0);
    g.lineTo(CW * 0.58, 0);
    g.lineTo(CW * 0.36, CH);
    g.lineTo(-120, CH);
    g.closePath();
    g.fill();

    g.fillStyle = "rgba(255,255,255,.94)";
    g.font = "900 54px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText("うちの犬 お散歩ダッシュ", 56, 108);

    g.fillStyle = "rgba(255,255,255,.72)";
    g.font = "900 26px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText("犬は可愛い。障害物は容赦ない。", 56, 152);

    g.fillStyle = "#ffffff";
    g.font = "900 120px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText(rankObj.rank, 56, 290);

    g.fillStyle = "rgba(255,255,255,.88)";
    g.font = "900 40px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText(rankObj.title, 56, 345);

    g.fillStyle = "rgba(255,255,255,.94)";
    g.font = "900 52px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText(`TIME ${sec.toFixed(1)}s`, 56, 430);
    g.fillText(`SCORE ${sc}`, 56, 492);

    g.fillStyle = "rgba(207,224,255,.94)";
    g.font = "900 30px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText(comment, 56, 552);

    g.fillStyle = "rgba(159,178,216,.95)";
    g.font = "900 26px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText("#わんグル  #うちの犬お散歩ダッシュ", 56, 625);

    // 右側：犬画像丸抜き
    const imgX = CW - 360, imgY = 188, imgS = 270;

    g.fillStyle = "rgba(255,255,255,.10)";
    g.beginPath();
    roundRectPath2(g, imgX - 18, imgY - 18, imgS + 36, imgS + 36, 36);
    g.fill();

    g.save();
    g.beginPath();
    g.arc(imgX + imgS / 2, imgY + imgS / 2, imgS / 2, 0, Math.PI * 2);
    g.clip();
    if (dogImgReady) g.drawImage(dogImg, imgX, imgY, imgS, imgS);
    else {
      g.fillStyle = "rgba(255,255,255,.90)";
      g.fillRect(imgX, imgY, imgS, imgS);
    }
    g.restore();

    g.strokeStyle = "rgba(255,255,255,.25)";
    g.lineWidth = 10;
    g.beginPath();
    g.arc(imgX + imgS / 2, imgY + imgS / 2, imgS / 2 + 6, 0, Math.PI * 2);
    g.stroke();

    g.fillStyle = "rgba(255,255,255,.16)";
    g.font = "900 24px system-ui, -apple-system, Segoe UI, sans-serif";
    g.fillText("Powered by わんグル", CW - 350, 155);

    try { return c.toDataURL("image/png"); } catch { return null; }

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

  function endGame() {
    if (gameOver) return;
    gameOver = true;
    running = false;

    setBestScore(score);

    const rankObj = calcRank(score, elapsed);
    const comment = pickComment(rankObj.rank);

    if (resultEl) resultEl.textContent = `SCORE ${score}（${rankObj.rank}：${rankObj.title}）`;

    const shareText = buildShareText(rankObj, elapsed, score, comment);
    if (shareTextEl) shareTextEl.value = shareText;

    const url = drawResultCard(rankObj, elapsed, score, comment);
    if (url && resultCardImg) resultCardImg.src = url;

    updateDailyUI(false);
    updateHUD();
  }

  // ===== コピー＆保存 =====
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
    a.download = "dogdash-result.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  // ===== 画像読み込み =====
  function setDogImageFromFile(file) {
    if (!file) return;
    if (dogImgUrl) URL.revokeObjectURL(dogImgUrl);
    dogImgUrl = URL.createObjectURL(file);
    dogImg = new Image();
    dogImgReady = false;
    dogImg.onload = () => { dogImgReady = true; };
    dogImg.onerror = () => { dogImgReady = false; };
    dogImg.src = dogImgUrl;
  }

  // ===== リセット/開始 =====
  function resetGameState() {
    elapsed = 0; avoided = 0; nearMissCount = 0; avoidStreak = 0; lastAvoidAt = 0;
    score = 0; eventScore = 0;
    obstacles = [];
    spawnTimer = 0;
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
    spawnTimer = 0.35;
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
  canvas.addEventListener("pointermove", (e) => { if (pointerDown) pointerX = e.clientX; });
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
  let acc = 0;
  function updateAndRender(ts) {
    try {
      if (!lastT) lastT = ts;
      let frameDt = (ts - lastT) / 1000;
      lastT = ts;

      // タブ復帰などの巨大dtを制限
      frameDt = Math.min(0.10, frameDt);

      // 固定ステップで更新して、dtスパイク由来の“空中ガク”を抑える
      const STEP = 1 / 120; // 120Hz
      acc += frameDt;

      let n = 0;
      while (acc >= STEP && n < 12) {
        if (running && !gameOver) update(STEP);
        acc -= STEP;
        n++;
      }

      render();
    } catch (err) {
      console.error(err);
      if (resultEl) resultEl.textContent = "⚠️ JSエラー: " + (err?.message || err);
      running = false;
      gameOver = true;
    }

    raf = requestAnimationFrame(updateAndRender);
  }

  // ===== init =====
  function init() {
    resetGameState();
    loadBestScore();
    loadStamps();
    renderDex();
    updateDailyUI(false);
    raf = requestAnimationFrame(updateAndRender);
  }

  init();
})();
