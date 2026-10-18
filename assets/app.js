/* Winnie's Speaking Garden — app flow, recording, scoring, storage. */
(function () {
  "use strict";

  const RAW_LESSON = window.WINNIE_LESSON;
  let LESSON = null;
  const SCORING = window.WinnieScoring;
  const CONFIG = window.WINNIE_CONFIG || {};
  const PARAMS = new URLSearchParams(location.search);
  const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const AUDIO_VERSION = "20261018v";
  const DB_NAME = "winnie-speaking-garden";
  const DB_VERSION = 1;
  const DB_STORE = "takes";
  const SETTINGS_KEY = "winnie.settings.v1";

  if (!RAW_LESSON || !SCORING) {
    document.body.innerHTML = "<p style='padding:40px;font-family:sans-serif'>练习数据没有加载成功，请刷新页面。</p>";
    return;
  }

  function normalizeLesson(raw) {
    const base = raw && typeof raw === "object" ? raw : {};
    const sentences = Array.isArray(base.sentences) ? base.sentences.map((sentence, index) => ({
      ...sentence,
      id: sentence.id || `s${index + 1}`,
      kind: sentence.kind || "sentence",
      zh: sentence.zh || "",
      scene: sentence.scene || "assets/img/scene-lesson.svg",
      sceneAlt: sentence.sceneAlt || "An open storybook with stars",
      audio: sentence.audio || null,
      durations: sentence.durations || {},
      maxSeconds: Number(sentence.maxSeconds) || 25,
      tip: sentence.tip || "先听黄老师说，再跟着说。"
    })) : [];
    if (base.challenge && base.challenge.en) {
      sentences.push({
        ...base.challenge,
        id: base.challenge.id || "challenge",
        kind: "challenge",
        zh: base.challenge.zh || "整段挑战",
        scene: base.challenge.scene || "assets/img/scene-lesson.svg",
        sceneAlt: base.challenge.sceneAlt || "An open storybook with stars",
        audio: base.challenge.audio || null,
        durations: base.challenge.durations || {},
        maxSeconds: Number(base.challenge.maxSeconds) || 90,
        tip: base.challenge.tip || "把整段完整说一遍，不用着急。"
      });
    }
    return {
      id: base.id || "lesson",
      title: base.title || "Winnie's Practice",
      titleZh: base.titleZh || "",
      child: base.child || "Winnie",
      age: base.age || 5,
      welcomeAudio: base.welcomeAudio || "assets/audio/welcome.wav",
      demoTranscripts: Array.isArray(base.demoTranscripts) ? base.demoTranscripts : null,
      demoDurations: Array.isArray(base.demoDurations) ? base.demoDurations : null,
      sentences
    };
  }

  LESSON = normalizeLesson(RAW_LESSON);

  function regularSentenceCount() {
    return LESSON.sentences.filter((sentence) => sentence.kind !== "challenge").length;
  }

  function hasChallenge() {
    return LESSON.sentences.some((sentence) => sentence.kind === "challenge");
  }

  function sentenceOrdinal(index) {
    let count = 0;
    for (let i = 0; i <= index; i += 1) {
      if (LESSON.sentences[i] && LESSON.sentences[i].kind !== "challenge") count += 1;
    }
    return count;
  }

  function itemLabel(index) {
    const sentence = LESSON.sentences[index];
    if (!sentence) return "";
    return sentence.kind === "challenge" ? "整段挑战" : `第 ${sentenceOrdinal(index)} 句`;
  }

  function nextActionLabel(index) {
    const next = LESSON.sentences[index + 1];
    if (!next) return "看成绩";
    return next.kind === "challenge" ? "整段挑战" : "下一句";
  }

  function sentenceKey(sentence) {
    return `${LESSON.id}:${sentence.id}`;
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const homeScreen = $("#homeScreen");
  const practiceScreen = $("#practiceScreen");
  const summaryScreen = $("#summaryScreen");
  const homeSentences = $("#homeSentences");
  const homeProgress = $("#homeProgress");
  const homeProgressStars = $("#homeProgressStars");
  const homeProgressText = $("#homeProgressText");
  const startButton = $("#startButton");
  const startButtonLabel = $("#startButtonLabel");
  const heroLede = $("#heroLede");
  const heroTaskCount = $("#heroTaskCount");
  const journeyTitle = $("#journeyTitle");
  const welcomeButton = $("#welcomeButton");
  const settingsButton = $("#settingsButton");
  const settingsModal = $("#settingsModal");
  const confirmModal = $("#confirmModal");
  const toastEl = $("#toast");
  const confettiCanvas = $("#confetti");

  const state = {
    screen: "home",
    index: 0,
    demo: PARAMS.has("demo"),
    recordings: new Array(LESSON.sentences.length).fill(null),
    settings: readSettings(),
    hasUserGesture: false,

    welcomeAudio: null,
    modelAudio: null,
    modelButton: null,
    autoPlayTimer: null,
    takePlayer: null,
    summaryAudio: null,
    summaryKey: null,
    summaryButton: null,

    recordingToken: 0,
    isRecording: false,
    preparing: false,
    processing: false,
    stream: null,
    recorder: null,
    chunks: [],
    recordInterval: null,
    recordStartedAt: 0,
    recordSeconds: 0,
    speechRecognition: null,
    speechActive: false,
    speechParts: [],
    speechError: null,
    voiceStartAt: 0,
    lastVoiceAt: 0,
    analyser: null,
    analyserSource: null,
    analyserData: null,
    speechSeconds: 0,

    toastTimer: null,
    confirmHandler: null,
    lastFocus: null,
    demoFinishTimer: null,
    sfxCtx: null
  };

  /* ------------------------------------------------------------------ */
  /* small helpers                                                       */
  /* ------------------------------------------------------------------ */

  function icon(name, className = "") {
    return `<svg class="icon ${className}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatClock(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function formatAudioTime(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  function audioCtx() {
    if (!state.sfxCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      state.sfxCtx = new Ctor();
    }
    if (state.sfxCtx.state === "suspended") state.sfxCtx.resume().catch(() => {});
    return state.sfxCtx;
  }

  function sfx(kind) {
    if (!state.settings.sfx) return;
    const ctx = audioCtx();
    if (!ctx) return;
    const notes = kind === "success"
      ? [523.25, 659.25, 783.99, 1046.5]
      : kind === "pop"
        ? [880, 1174.66]
        : [660, 880];
    const start = ctx.currentTime + 0.02;
    notes.forEach((freq, index) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const at = start + index * (kind === "start" ? 0.09 : 0.11);
      const level = kind === "success" ? 0.055 : 0.035;
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(level, at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.24);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.27);
    });
  }

  function showToast(message, duration = 2600) {
    toastEl.textContent = message;
    toastEl.hidden = false;
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(() => { toastEl.hidden = true; }, duration);
  }

  function asrSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }

  function micSupported() {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  }

  function starIcons(count, max = 5) {
    let html = "";
    for (let i = 0; i < max; i += 1) {
      html += `<span class="${i < count ? "is-on" : ""}">${icon("star")}</span>`;
    }
    return html;
  }

  function starsBlock(count, max = 5) {
    let html = "";
    for (let i = 0; i < max; i += 1) {
      html += `<span class="stars__item ${i < count ? "is-on" : ""}">${icon("star")}</span>`;
    }
    return `<div class="stars" role="img" aria-label="${count} 颗星">${html}</div>`;
  }

  function assetAudio(url) {
    if (!url) return "";
    if (!String(url).startsWith("assets/")) return url;
    return `${url}${url.includes("?") ? "&" : "?"}v=${AUDIO_VERSION}`;
  }

  function audioFor(index, variant) {
    const sentence = LESSON.sentences[index];
    const key = variant === "slow" ? "slow" : state.settings.voice;
    if (sentence && sentence.audio) {
      if (sentence.audio[key]) return assetAudio(sentence.audio[key]);
      if (sentence.audio.teacher) return assetAudio(sentence.audio.teacher);
    }
    return `assets/audio/s${index + 1}-${key}.wav?v=${AUDIO_VERSION}`;
  }

  function modelSecondsFor(index) {
    const durations = LESSON.sentences[index].durations || {};
    return Number(durations[state.settings.voice]) || Number(durations.teacher) || 4.5;
  }

  function completedCount() {
    return state.recordings.filter((entry) => entry && entry.result).length;
  }

  function totalStars() {
    return state.recordings.reduce((sum, entry) => sum + (entry && entry.result ? Number(entry.result.stars) || 0 : 0), 0);
  }

  /* ------------------------------------------------------------------ */
  /* settings                                                            */
  /* ------------------------------------------------------------------ */

  function readSettings() {
    const base = {
      voice: CONFIG.voice === "friend" ? "friend" : "teacher",
      aiEnabled: CONFIG.aiEnabled !== false,
      geminiKey: typeof CONFIG.geminiKey === "string" ? CONFIG.geminiKey : "",
      geminiModel: CONFIG.geminiModel || "gemini-2.5-flash",
      sfx: CONFIG.sfx !== false
    };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        const stored = JSON.parse(raw);
        if (stored && typeof stored === "object") {
          if (stored.voice === "friend" || stored.voice === "teacher") base.voice = stored.voice;
          if (typeof stored.aiEnabled === "boolean") base.aiEnabled = stored.aiEnabled;
          if (typeof stored.geminiKey === "string") base.geminiKey = stored.geminiKey;
          if (typeof stored.geminiModel === "string" && stored.geminiModel.trim()) base.geminiModel = stored.geminiModel.trim();
          if (typeof stored.sfx === "boolean") base.sfx = stored.sfx;
        }
      }
    } catch (error) {
      /* a blocked localStorage should not stop practice */
    }
    return base;
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch (error) {
      showToast("设置只在本次打开中有效：浏览器没有允许本地存储。");
    }
  }

  /* ------------------------------------------------------------------ */
  /* IndexedDB                                                           */
  /* ------------------------------------------------------------------ */

  function openDb() {
    return new Promise((resolve) => {
      if (!window.indexedDB) return resolve(null);
      let request;
      try {
        request = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (error) {
        return resolve(null);
      }
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(DB_STORE)) {
          db.createObjectStore(DB_STORE, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    });
  }

  function serializeResult(result) {
    if (!result) return null;
    return JSON.parse(JSON.stringify(result));
  }

  async function persistTake(index, entry) {
    if (!entry || !entry.blob) return;
    const db = await openDb();
    if (!db) return;
    try {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).put({
        id: sentenceKey(LESSON.sentences[index]),
        blob: entry.blob,
        transcript: entry.transcript || "",
        duration: entry.duration || 0,
        speechSeconds: entry.speechSeconds || 0,
        result: serializeResult(entry.result),
        aiError: entry.aiError || null,
        savedAt: entry.savedAt || Date.now()
      });
    } catch (error) {
      /* persistence is a bonus; never break the practice flow */
    }
  }

  async function loadTakes() {
    const db = await openDb();
    if (!db) return [];
    return new Promise((resolve) => {
      try {
        const request = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE).getAll();
        request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
        request.onerror = () => resolve([]);
      } catch (error) {
        resolve([]);
      }
    });
  }

  async function clearTakes() {
    const db = await openDb();
    if (!db) return;
    try {
      const tx = db.transaction(DB_STORE, "readwrite");
      tx.objectStore(DB_STORE).clear();
    } catch (error) {
      /* ignore */
    }
  }

  async function restoreTakes() {
    const records = await loadTakes();
    records.forEach((record) => {
      if (!record || !record.blob) return;
      const index = LESSON.sentences.findIndex((sentence) => sentenceKey(sentence) === record.id);
      if (index < 0 || state.recordings[index]) return;
      state.recordings[index] = {
        blob: record.blob,
        url: URL.createObjectURL(record.blob),
        transcript: record.transcript || "",
        duration: Number(record.duration) || 0,
        speechSeconds: Number(record.speechSeconds) || 0,
        result: record.result || null,
        aiError: record.aiError || null,
        pending: false,
        savedAt: record.savedAt || Date.now()
      };
    });
    if (state.screen === "home") updateHome();
  }

  /* ------------------------------------------------------------------ */
  /* cloud units                                                         */
  /* ------------------------------------------------------------------ */

  let unitLoadPromise = null;

  function rowToLesson(row) {
    const genericScene = "assets/img/scene-lesson.svg";
    const sentences = (Array.isArray(row.sentences) ? row.sentences : []).map((sentence, index) => ({
      id: sentence.id || `s${index + 1}`,
      en: sentence.en || "",
      zh: sentence.zh || "",
      speech: sentence.speech || sentence.en || "",
      scene: sentence.scene || genericScene,
      sceneAlt: sentence.sceneAlt || "An open storybook with stars",
      audio: sentence.audio || null,
      durations: sentence.durations || {},
      maxSeconds: Number(sentence.maxSeconds) || 25,
      tip: sentence.tip || "先听黄老师说，再跟着说。",
      kind: "sentence"
    })).filter((sentence) => sentence.en);
    return {
      id: row.id,
      title: row.title || "黄老师的口语课",
      titleZh: row.title_zh || row.title || "今天的练习",
      child: "Winnie",
      age: 5,
      welcomeAudio: "assets/audio/welcome.wav",
      sentences,
      challenge: row.challenge && row.challenge.en ? row.challenge : null,
      demoTranscripts: null,
      demoDurations: null
    };
  }

  function applyLesson(raw) {
    teardownSession();
    state.recordings.forEach((entry) => {
      if (entry && entry.url) URL.revokeObjectURL(entry.url);
    });
    LESSON = normalizeLesson(raw);
    state.recordings = new Array(LESSON.sentences.length).fill(null);
    state.index = 0;
    state.screen = "home";
    showScreen("home");
    updateHome();
    restoreTakes();
  }

  async function loadActiveUnit() {
    const auth = window.WinnieAuth;
    if (!auth || !auth.client) return;
    if (unitLoadPromise) return unitLoadPromise;
    unitLoadPromise = (async () => {
      try {
        const { data, error } = await auth.client
          .from("units")
          .select("*")
          .eq("active", true)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) {
          console.warn("[units] could not load active unit", error);
          return;
        }
        if (!data || !Array.isArray(data.sentences) || !data.sentences.length) return;
        if (LESSON.id === data.id) return;
        applyLesson(rowToLesson(data));
      } catch (error) {
        console.warn("[units] load failed", error);
      } finally {
        unitLoadPromise = null;
      }
    })();
    return unitLoadPromise;
  }

  /* ------------------------------------------------------------------ */
  /* home                                                                */
  /* ------------------------------------------------------------------ */

  function renderHomeTiles() {
    homeSentences.innerHTML = LESSON.sentences.map((sentence, index) => {
      const entry = state.recordings[index];
      const stars = entry && entry.result ? Number(entry.result.stars) || 0 : 0;
      const done = !!(entry && entry.result);
      const challenge = sentence.kind === "challenge";
      const label = itemLabel(index);
      return `<button type="button" class="sentence-tile ${done ? "is-done" : ""} ${challenge ? "is-challenge" : ""}" data-start-index="${index}" aria-label="${label}：${escapeHtml(sentence.en)}">
        <span class="sentence-tile__art">
          <span class="sentence-tile__num">${challenge ? "★" : sentenceOrdinal(index)}</span>
          <img src="${sentence.scene}" alt="" />
        </span>
        <span class="sentence-tile__body">
          <span class="sentence-tile__text">${escapeHtml(sentence.en)}</span>
          <span class="sentence-tile__zh">${escapeHtml(sentence.zh)}</span>
          <span class="sentence-tile__stars" aria-label="${stars} 颗星">${starIcons(stars)}</span>
        </span>
        <span class="sentence-tile__go">${icon("arrow-right")}</span>
      </button>`;
    }).join("");
  }

  function updateHome() {
    if (!homeSentences) return;
    renderHomeTiles();
    const total = LESSON.sentences.length;
    const regular = regularSentenceCount();
    if (heroLede) {
      heroLede.innerHTML = `和黄老师一起，听一听、跟着说，收获小星星。<br>今天有 ${regular} 句话${hasChallenge() ? "和整段挑战" : ""}，慢慢来就好。`;
    }
    if (heroTaskCount) {
      heroTaskCount.textContent = hasChallenge() ? `${regular} 句 + 整段` : `${regular} 句话`;
    }
    if (journeyTitle) journeyTitle.textContent = LESSON.titleZh || LESSON.title || "今天的练习";
    const scored = completedCount();
    const started = state.recordings.filter(Boolean).length;
    const stars = totalStars();
    if (started > 0) {
      homeProgress.hidden = false;
      homeProgressStars.innerHTML = `${icon("star")} ${stars} 颗星`;
      homeProgressText.textContent = `${started} / ${total} 个任务`;
    } else {
      homeProgress.hidden = true;
    }
    if (scored >= total) {
      startButtonLabel.textContent = "查看成绩";
    } else if (started > 0) {
      startButtonLabel.textContent = "继续练习";
    } else {
      startButtonLabel.textContent = "开始练习";
    }
  }

  function goHome() {
    teardownSession();
    state.screen = "home";
    showScreen("home");
    updateHome();
  }

  function startPractice(index) {
    const safeIndex = clamp(Number(index) || 0, 0, LESSON.sentences.length - 1);
    teardownSession();
    state.index = safeIndex;
    state.screen = "practice";
    showScreen("practice");
    renderPractice();
    clearTimeout(state.autoPlayTimer);
    state.autoPlayTimer = setTimeout(() => {
      if (state.screen === "practice" && state.index === safeIndex && !state.isRecording && !state.preparing) {
        playModel(false, { auto: true });
      }
    }, 520);
  }

  function startFromHome() {
    const scored = completedCount();
    if (scored >= LESSON.sentences.length) {
      renderSummary();
      return;
    }
    const firstIncomplete = state.recordings.findIndex((entry) => !entry || !entry.result);
    startPractice(firstIncomplete >= 0 ? firstIncomplete : 0);
  }

  function showScreen(name) {
    homeScreen.hidden = name !== "home";
    practiceScreen.hidden = name !== "practice";
    summaryScreen.hidden = name !== "summary";
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  /* ------------------------------------------------------------------ */
  /* practice screen                                                     */
  /* ------------------------------------------------------------------ */

  function progressSteps() {
    return LESSON.sentences.map((sentence, index) => {
      const entry = state.recordings[index];
      const done = !!(entry && entry.result);
      const current = index === state.index;
      const challenge = sentence.kind === "challenge";
      const className = [
        "progress__step",
        current ? "is-current" : "",
        done ? "is-done" : "",
        challenge ? "is-challenge" : ""
      ].filter(Boolean).join(" ");
      const label = `${itemLabel(index)}${done ? "，已完成" : ""}${current ? "，正在练习" : ""}`;
      const mark = done ? icon("star") : challenge ? "★" : sentenceOrdinal(index);
      return `<li class="${className}" ${current ? 'aria-current="step"' : ""} aria-label="${label}">
        ${mark}
      </li>`;
    }).join("");
  }

  function progressHtml() {
    const total = LESSON.sentences.length;
    if (total > 6) {
      const percent = Math.round(((state.index + 1) / total) * 100);
      return `<div class="progress-track" role="progressbar" aria-label="练习进度" aria-valuemin="1" aria-valuemax="${total}" aria-valuenow="${state.index + 1}" aria-valuetext="${itemLabel(state.index)}">
        <span style="width:${percent}%"></span>
      </div>`;
    }
    return `<ol class="progress__steps" aria-label="练习进度">${progressSteps()}</ol>`;
  }

  function renderPractice() {
    const sentence = LESSON.sentences[state.index];
    const entry = state.recordings[state.index];
    const isLast = state.index === LESSON.sentences.length - 1;
    const hasTake = !!entry;
    const challenge = sentence.kind === "challenge";
    const regular = regularSentenceCount();
    const metaLabel = challenge ? "整段挑战" : `第 ${state.index + 1} 句 / ${regular}`;
    const demoActive = state.demo && !!LESSON.demoTranscripts;
    practiceScreen.innerHTML = `
      <div class="practice-top">
        <button type="button" class="round-button" data-action="home" aria-label="返回首页">${icon("arrow-left")}</button>
        <div class="practice-progress">
          <div class="progress__meta">
            <strong>${metaLabel}</strong>
            <span>${demoActive ? "演示模式 · " : ""}Listen · Repeat · Shine</span>
          </div>
          ${progressHtml()}
        </div>
        <button type="button" class="icon-button icon-button--round" data-open-settings aria-label="家长设置">${icon("gear")}</button>
      </div>

      <article class="sentence-card ${challenge ? "sentence-card--challenge" : ""}">
        <div class="sentence-card__art">
          <span class="sentence-badge">${itemLabel(state.index)}</span>
          <img src="${sentence.scene}" alt="${escapeHtml(sentence.sceneAlt)}" />
        </div>
        <div class="sentence-card__copy">
          <p class="sentence-eyebrow">
            <span>${challenge ? "Whole Paragraph" : "Listen &amp; Repeat"}</span>
            <span id="voiceLabel">${state.settings.voice === "friend" ? "小伙伴" : "黄老师"}示范</span>
          </p>
          <h1 class="sentence-text ${challenge ? "sentence-text--challenge" : ""}">${escapeHtml(sentence.en)}</h1>
          <p class="sentence-zh">${escapeHtml(sentence.zh)}</p>

          <div class="listen-row">
            <button type="button" class="listen-button" id="listenButton" data-action="listen" aria-label="听示范">
              <span class="listen-button__icon">
                ${icon("speaker")}
                <span class="bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
              </span>
              <span>听一听</span>
            </button>
            <button type="button" class="listen-button listen-button--slow" id="slowButton" data-action="slow" aria-label="慢速听示范">
              <span class="listen-button__icon">
                ${icon("turtle")}
                <span class="bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>
              </span>
              <span>慢速</span>
            </button>
          </div>
          <p class="listen-status" id="listenStatus">${escapeHtml(sentence.tip)}</p>

          <div class="record-zone" id="recordZone">
            <div class="mic-wrap">
              <button type="button" class="mic-button" id="micButton" data-action="record" aria-label="开始录音">
                ${icon("mic")}
              </button>
            </div>
            <div class="record-copy">
              <h3 id="recordTitle">${hasTake ? "想再棒一点？再录一次" : challenge ? "整段挑战开始啦！" : "轮到你啦！"}</h3>
              <p id="recordText">${hasTake ? "点一下麦克风，再跟读一次。" : challenge ? "把整段完整说一遍，慢慢来就好。" : "点一下麦克风，准备好就大声说。"}</p>
              <div class="record-timer" aria-hidden="true">
                <span class="record-timer__time" id="recordTime">00:00</span>
                <span class="record-wave"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></span>
              </div>
            </div>
            <button type="button" class="record-stop" id="stopRecordButton" data-action="stop-recording">${icon("check")}说完了</button>
          </div>
          <p class="record-hint" id="recordHint">小提示：靠近麦克风，慢慢说，不用着急。</p>
          <div class="mic-error" id="micError" hidden></div>
        </div>
      </article>

      <div id="takeZone"></div>`;

    renderTakeZone(entry);
    const nextSentence = LESSON.sentences[state.index + 1];
    if (nextSentence) practiceScreen.dataset.nextLine = nextSentence.en;

    // If a take exists, it is already mounted above. Otherwise the result
    // area is intentionally absent until the child records.
    if (isLast) practiceScreen.dataset.last = "true";
  }

  function renderTakeZone(entry) {
    const zone = $("#takeZone", practiceScreen);
    if (!zone) return;
    if (!entry) {
      zone.innerHTML = "";
      if (state.takePlayer) {
        state.takePlayer.audio.pause();
        state.takePlayer = null;
      }
      return;
    }
    zone.innerHTML = `
      <div class="take-panel" id="takePanel">
        <div class="take-top">
          <p class="take-label"><span class="take-label__dot"></span>你的声音</p>
          <div class="take-actions">
            <button type="button" class="btn btn--ghost btn--sm" data-action="play-model">${icon("speaker")}听示范</button>
            <button type="button" class="btn btn--ghost btn--sm" data-action="download-take">${icon("download")}下载</button>
            <button type="button" class="btn btn--soft btn--sm" data-action="retry-recording">${icon("mic")}再录一次</button>
          </div>
        </div>
        <div class="audio-player" id="takePlayer">
          <button type="button" class="audio-player__button" data-player-toggle aria-label="播放我的录音">${icon("play")}</button>
          <input type="range" min="0" max="100" step="0.1" value="0" aria-label="我的录音进度" />
          <span class="audio-player__time" data-player-time>0:00</span>
        </div>
        <div class="result-section" id="resultMount">${resultHtml(entry)}</div>
      </div>`;
    setupTakePlayer(entry);
    animateMetrics($("#resultMount", practiceScreen));
  }

  function setupTakePlayer(entry) {
    const player = $("#takePlayer", practiceScreen);
    if (!player || !entry.url) return;
    if (state.takePlayer && state.takePlayer.audio) {
      state.takePlayer.audio.pause();
    }
    const audio = new Audio(entry.url);
    audio.preload = "metadata";
    const fallbackDuration = Number(entry.duration) || 0;
    const totalForDisplay = () => {
      const actual = audio.duration;
      return Number.isFinite(actual) && actual > 0 ? actual : fallbackDuration;
    };
    const button = $("[data-player-toggle]", player);
    const range = $("input[type='range']", player);
    const time = $("[data-player-time]", player);
    const setIcon = (playing) => {
      button.innerHTML = icon(playing ? "pause" : "play");
      button.setAttribute("aria-label", playing ? "暂停我的录音" : "播放我的录音");
    };
    const paintRange = () => {
      const total = totalForDisplay();
      const current = audio.currentTime || 0;
      const pct = total ? clamp((current / total) * 100, 0, 100) : 0;
      range.style.background = `linear-gradient(to right, var(--mint-dark) ${pct}%, #efe4e8 ${pct}%)`;
    };
    const refresh = () => {
      const total = totalForDisplay();
      const current = audio.currentTime || 0;
      if (!range.matches(":active")) {
        range.max = total || 100;
        range.value = total ? clamp(current, 0, total) : 0;
      }
      time.textContent = total
        ? `${formatAudioTime(current)} / ${formatAudioTime(total)}`
        : formatAudioTime(current);
      paintRange();
    };
    button.addEventListener("click", () => {
      stopAllAudioTargets(["takePlayer"]);
      if (audio.paused) {
        const result = audio.play();
        if (result && result.catch) {
          result.catch(() => showToast("录音没有加载成功，再录一次试试。"));
        }
      } else {
        audio.pause();
      }
    });
    audio.addEventListener("play", () => setIcon(true));
    audio.addEventListener("pause", () => setIcon(false));
    audio.addEventListener("loadedmetadata", refresh);
    audio.addEventListener("timeupdate", refresh);
    audio.addEventListener("ended", () => {
      setIcon(false);
      audio.currentTime = 0;
      refresh();
    });
    range.addEventListener("input", () => {
      const total = totalForDisplay();
      if (total) {
        try { audio.currentTime = (Number(range.value) / 100) * total; } catch (error) { /* seek may be unavailable */ }
      }
      refresh();
      paintRange();
    });
    state.takePlayer = { audio, button, range, time, setIcon };
    refresh();
  }

  function animateMetrics(root) {
    if (!root) return;
    requestAnimationFrame(() => {
      $$(".metric__fill", root).forEach((fill) => {
        const value = Number(fill.dataset.value);
        if (Number.isFinite(value)) fill.style.width = `${clamp(value, 0, 100)}%`;
      });
    });
  }

  /* ------------------------------------------------------------------ */
  /* result HTML                                                         */
  /* ------------------------------------------------------------------ */

  function scoreSubtitle(result) {
    const stars = Number(result.stars) || 0;
    if (result.completeness != null && result.completeness < 45 && stars <= 2) {
      return "有几个词溜走了，再听一遍完整句，再来一次。";
    }
    if (stars >= 3 && Number(result.completeness) >= 95 && Number(result.fluency) < 78) {
      return "每个词都听对啦，把节奏放稳一点，就满星。";
    }
    if (stars >= 5) return "整句话完整又自然，真有精神！";
    if (stars >= 4) return "几乎全部说对啦，再清楚一点点就满星。";
    if (stars >= 3) return "大部分都听到啦，慢一点会更棒。";
    if (stars >= 2) return "已经勇敢开口啦，跟着黄老师再来一次。";
    return "再靠近麦克风，大声一点试试看。";
  }

  function scoreTitle(result) {
    const stars = Number(result.stars) || 0;
    if (stars >= 5) return "太棒啦，满星！";
    if (stars >= 4) return "好厉害，快满星啦！";
    if (stars >= 3) return "说得不错，再来一次！";
    if (stars >= 2) return "勇敢开口，就值得表扬！";
    return "再试一次，你可以的！";
  }

  function wordChip(word) {
    const status = ["great", "almost", "missed"].includes(word.status) ? word.status : "almost";
    const label = status === "great" ? "说得很棒" : status === "almost" ? "再清楚一点" : "漏掉了或没说对";
    const title = word.tip || label;
    return `<span class="word-chip is-${status}" title="${escapeHtml(title)}">${escapeHtml(word.word)}</span>`;
  }

  function resultHtml(entry) {
    const errorHtml = entry.aiError ? aiErrorHtml(entry.aiError) : "";
    if (entry.pending) {
      return `${errorHtml}
        <div class="score-loading" role="status">
          <span class="score-loading__dots" aria-hidden="true"><i></i><i></i><i></i></span>
          <div>
            <p>黄老师正在听你的声音…</p>
            <small>听完就会送出小星星。网络不顺利时会先用快速评分。</small>
          </div>
        </div>`;
    }
    const result = entry.result;
    if (!result) {
      return `${errorHtml}${noScoreHtml()}`;
    }
    const isGemini = result.provider === "gemini";
    const metrics = Array.isArray(result.metrics) && result.metrics.length
      ? result.metrics
      : [
          { label: "发音", value: result.pronunciation || result.overall || 0 },
          { label: "流利度", value: result.fluency || result.overall || 0 },
          { label: "完整度", value: result.completeness || result.overall || 0 }
        ];
    const words = Array.isArray(result.words) ? result.words : [];
    const focus = Array.isArray(result.focus) ? result.focus.filter(Boolean).slice(0, 3) : [];
    const isLast = state.index === LESSON.sentences.length - 1;
    return `${errorHtml}
      <div class="result-head">
        <h3>给你的一点小点评</h3>
        <span class="provider-pill ${isGemini ? "provider-pill--ai" : "provider-pill--local"}">${isGemini ? "Gemini AI 评分" : "本机快速评分"}</span>
      </div>
      <div class="score-hero">
        <div class="score-hero__main">
          ${starsBlock(Number(result.stars) || 0)}
          <p class="score-title">${escapeHtml(scoreTitle(result))}</p>
          <p class="score-sub">${escapeHtml(scoreSubtitle(result))}</p>
        </div>
        <div class="score-number">
          <strong>${Math.round(Number(result.overall) || 0)}</strong>
          <span>分 · ${Number(result.stars) || 0} / 5 星</span>
        </div>
      </div>
      <div class="metrics">
        ${metrics.map((metric) => `<div class="metric">
          <div class="metric__top">
            <span class="metric__label">${escapeHtml(metric.label)}</span>
            <span class="metric__value">${Math.round(Number(metric.value) || 0)}</span>
          </div>
          <div class="metric__bar"><span class="metric__fill" data-value="${clamp(Number(metric.value) || 0, 0, 100)}"></span></div>
        </div>`).join("")}
      </div>
      <div class="words-block">
        <div class="words-head">
          <p class="words-title">逐词小检查</p>
          <div class="words-legend" aria-hidden="true">
            <span><i class="is-great"></i>很棒</span>
            <span><i class="is-almost"></i>再清楚点</span>
            <span><i class="is-missed"></i>漏掉</span>
          </div>
        </div>
        <div class="word-chips">${words.map(wordChip).join("")}</div>
        ${result.transcript ? `<p class="transcript-line"><strong>我听到：</strong>“${escapeHtml(result.transcript)}”</p>` : ""}
      </div>
      <div class="coach-note">
        <span class="coach-note__avatar"><img src="assets/img/logo.svg" alt="" /></span>
        <div class="coach-note__body">
          <span class="coach-note__name">黄老师 · 陪你练口语</span>
          <p class="coach-note__zh">${escapeHtml(result.commentZh || "")}</p>
          ${result.commentEn ? `<p class="coach-note__en">${escapeHtml(result.commentEn)}</p>` : ""}
        </div>
      </div>
      ${focus.length ? `<div class="focus-row">
        <span class="focus-row__label">跟我读：</span>
        ${focus.map((word) => `<button type="button" class="focus-word" data-action="speak-word" data-word="${escapeHtml(word)}">${icon("speaker")}${escapeHtml(word)}</button>`).join("")}
      </div>` : ""}
      <div class="result-actions">
        <button type="button" class="btn btn--ghost" data-action="retry-recording">${icon("refresh")}再试一次</button>
        <button type="button" class="btn btn--primary btn--next" data-action="next">${nextActionLabel(state.index)}${icon("arrow-right")}</button>
      </div>
      <p class="result-note">${
        isGemini
          ? "由 Gemini 根据这段录音生成，仅供练习参考。"
          : "快速评分：比较你说的单词和原句，不评价口音。" + (state.settings.geminiKey ? "" : " 家长连接 Gemini 免费 API 后，可以得到发音点评。")
      }</p>`;
  }

  function aiErrorHtml(message) {
    return `<div class="ai-error" role="status">
      ${icon("sparkle")}
      <span>${escapeHtml(message)}</span>
      ${state.settings.geminiKey ? `<button type="button" class="btn btn--soft btn--sm" data-action="retry-ai">让 AI 再听一次</button>` : ""}
    </div>`;
  }

  function noScoreHtml() {
    const supported = asrSupported();
    const key = !!state.settings.geminiKey;
    const hint = supported
      ? "再录一次，靠近麦克风、大声一点。"
      : key
        ? "这个浏览器不能在本机听写，但可以请 Gemini 听录音评分。再录一次试试。"
        : "这个浏览器不能在本机听写。请用 Chrome 或 Edge，或者请家长在设置里连接 Gemini 免费 API。";
    const isLast = state.index === LESSON.sentences.length - 1;
    return `<div class="no-score">
      <span class="no-score__icon">${icon("mic")}</span>
      <h3>这一次，麦克风没听清</h3>
      <p>${hint}</p>
      <div class="result-actions">
        <button type="button" class="btn btn--primary" data-action="retry-recording">${icon("refresh")}再录一次</button>
        <button type="button" class="btn btn--ghost" data-action="next">${nextActionLabel(state.index)}${icon("arrow-right")}</button>
      </div>
    </div>`;
  }

  function updateResultMount(entry, scroll = false) {
    const mount = $("#resultMount", practiceScreen);
    if (!mount) return;
    mount.innerHTML = resultHtml(entry);
    animateMetrics(mount);
    if (scroll) {
      const panel = $("#takePanel", practiceScreen);
      if (panel) {
        setTimeout(() => panel.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "start" }), 80);
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* audio playback                                                      */
  /* ------------------------------------------------------------------ */

  function resetListenUI() {
    const listen = $("#listenButton");
    const slow = $("#slowButton");
    if (listen) listen.classList.remove("is-playing");
    if (slow) slow.classList.remove("is-playing");
    const status = $("#listenStatus");
    if (status && state.screen === "practice") {
      const sentence = LESSON.sentences[state.index];
      if (sentence) status.textContent = sentence.tip;
    }
  }

  function stopAllAudioTargets(except = []) {
    if (!except.includes("model") && state.modelAudio) {
      state.modelAudio.pause();
      state.modelAudio = null;
    }
    if (!except.includes("welcome") && state.welcomeAudio) {
      state.welcomeAudio.pause();
      state.welcomeAudio = null;
      welcomeButton.classList.remove("is-playing");
    }
    if (!except.includes("take") && state.takePlayer && state.takePlayer.audio) {
      state.takePlayer.audio.pause();
      if (state.takePlayer.setIcon) state.takePlayer.setIcon(false);
    }
    if (!except.includes("summary") && state.summaryAudio) {
      state.summaryAudio.pause();
      state.summaryAudio = null;
      state.summaryKey = null;
      if (state.summaryButton) state.summaryButton.innerHTML = icon("play");
      state.summaryButton = null;
    }
    if (!except.includes("model")) resetListenUI();
  }

  function playModel(slow = false, options = {}) {
    if (state.isRecording || state.preparing) {
      showToast("先说完这一段，再听黄老师哦。");
      return;
    }
    const index = state.index;
    const sentence = LESSON.sentences[index];
    if (!sentence) return;
    stopAllAudioTargets();
    clearTimeout(state.autoPlayTimer);
    const audio = new Audio(audioFor(index, slow ? "slow" : "normal"));
    audio.preload = "auto";
    audio.volume = 1;
    state.modelAudio = audio;
    const button = slow ? $("#slowButton") : $("#listenButton");
    state.modelButton = button || null;
    if (button) button.classList.add("is-playing");
    const status = $("#listenStatus");
    if (status) status.textContent = slow ? "慢慢听，跟着每个词。" : "正在播放 Winnie 的声音…";
    const finish = () => {
      if (state.modelAudio !== audio) return;
      if (button) button.classList.remove("is-playing");
      resetListenUI();
    };
    audio.addEventListener("ended", () => {
      finish();
      state.modelAudio = null;
    });
    audio.addEventListener("error", () => {
      if (state.modelAudio === audio) state.modelAudio = null;
      finish();
      showToast("示范音频没有加载成功，请刷新页面再试。");
    });
    const result = audio.play();
    if (result && result.catch) {
      result.catch(() => {
        if (state.modelAudio === audio) state.modelAudio = null;
        finish();
        if (!options.auto) showToast("浏览器需要点一下才能播放，请再点「听一听」。");
        else showToast("点一下「听一听」，就能听见 Winnie 啦。");
      });
    }
  }

  function playWelcome() {
    if (state.welcomeAudio) {
      state.welcomeAudio.pause();
      state.welcomeAudio = null;
      welcomeButton.classList.remove("is-playing");
      return;
    }
    stopAllAudioTargets();
    const audio = new Audio(assetAudio(LESSON.welcomeAudio));
    audio.preload = "auto";
    state.welcomeAudio = audio;
    welcomeButton.classList.add("is-playing");
    audio.addEventListener("ended", () => {
      if (state.welcomeAudio === audio) {
        state.welcomeAudio = null;
        welcomeButton.classList.remove("is-playing");
      }
    });
    const result = audio.play();
    if (result && result.catch) {
      result.catch(() => {
        state.welcomeAudio = null;
        welcomeButton.classList.remove("is-playing");
        showToast("点一下「听听 Winnie」就可以播放啦。");
      });
    }
  }

  function speakWord(word) {
    const text = String(word || "").trim();
    if (!text) return;
    if (!("speechSynthesis" in window)) {
      showToast("这个浏览器不支持朗读单词，跟着黄老师的录音再听一遍吧。");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.68;
    utterance.pitch = 1.04;
    const voices = window.speechSynthesis.getVoices();
    const preferred = state.settings.voice === "friend"
      ? ["Flo", "Samantha", "Google US English", "Ava"]
      : ["Samantha", "Ava", "Google US English", "Daniel"];
    const chosen = preferred.map((name) => voices.find((voice) => voice.name.includes(name))).find(Boolean);
    if (chosen) utterance.voice = chosen;
    window.speechSynthesis.speak(utterance);
  }

  /* ------------------------------------------------------------------ */
  /* local + Gemini grading                                              */
  /* ------------------------------------------------------------------ */

  function localResultFor(index, entry) {
    if (!entry || !entry.transcript || !entry.transcript.trim()) return null;
    try {
      const result = SCORING.localScore({
        reference: LESSON.sentences[index].en,
        transcript: entry.transcript,
        speechSeconds: entry.speechSeconds,
        modelSeconds: modelSecondsFor(index)
      });
      return result && result.available ? result : null;
    } catch (error) {
      return null;
    }
  }

  async function blobToWav(blob) {
    if (!blob || !blob.size) throw new Error("empty audio");
    if (blob.type && blob.type.includes("wav")) return blob;
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) throw new Error("AudioContext unavailable");
    const arrayBuffer = await blob.arrayBuffer();
    const ctx = new AudioContextCtor();
    let decoded;
    try {
      decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      ctx.close().catch(() => {});
    }
    const rate = 16000;
    const length = Math.max(1, Math.ceil(decoded.duration * rate));
    const OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineCtor) return blob;
    const offline = new OfflineCtor(1, length, rate);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start(0);
    const rendered = await offline.startRendering();
    const channel = rendered.getChannelData(0);
    const buffer = new ArrayBuffer(44 + channel.length * 2);
    const view = new DataView(buffer);
    const writeString = (offset, text) => {
      for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
    };
    writeString(0, "RIFF");
    view.setUint32(4, 36 + channel.length * 2, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, rate, true);
    view.setUint32(28, rate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, channel.length * 2, true);
    let offset = 44;
    for (let i = 0; i < channel.length; i += 1) {
      const sample = clamp(channel[i], -1, 1);
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
    return new Blob([buffer], { type: "audio/wav" });
  }

  async function runAiGrading(index, entry, fallback, scroll) {
    const sentence = LESSON.sentences[index];
    const apiKey = state.settings.geminiKey;
    const model = state.settings.geminiModel;
    try {
      let audioBlob = entry.blob;
      let mimeType = entry.blob.type || "audio/webm";
      try {
        audioBlob = await blobToWav(entry.blob);
        mimeType = "audio/wav";
      } catch (conversionError) {
        /* Some browsers cannot decode their own container; send it as-is. */
      }
      const result = await SCORING.geminiScore({
        apiKey,
        model,
        audioBlob,
        mimeType,
        reference: sentence.en,
        transcript: entry.transcript || "",
        speechSeconds: entry.speechSeconds,
        modelSeconds: modelSecondsFor(index),
        childName: LESSON.child,
        age: LESSON.age
      });
      if (state.recordings[index] !== entry) return;
      entry.result = result;
      entry.pending = false;
      entry.aiError = null;
      persistTake(index, entry);
      updateHome();
      if (state.screen === "practice" && state.index === index) updateResultMount(entry, scroll);
      sfx("success");
    } catch (error) {
      if (state.recordings[index] !== entry) return;
      entry.pending = false;
      entry.aiError = error && error.message ? error.message : "黄老师现在有点忙，先用快速评分吧。";
      entry.result = fallback || null;
      persistTake(index, entry);
      updateHome();
      if (state.screen === "practice" && state.index === index) updateResultMount(entry, scroll);
      showToast(entry.aiError, 3600);
      if (entry.result) sfx("pop");
    }
  }

  function retryAi() {
    const index = state.index;
    const entry = state.recordings[index];
    if (!entry || !entry.blob) return;
    if (!state.settings.geminiKey) {
      showToast("先请家长在设置里填写 Gemini API Key。");
      return;
    }
    const fallback = localResultFor(index, entry);
    entry.pending = true;
    entry.aiError = null;
    updateResultMount(entry, false);
    runAiGrading(index, entry, fallback, false);
  }

  /* ------------------------------------------------------------------ */
  /* recording                                                           */
  /* ------------------------------------------------------------------ */

  function setMicButton(recording) {
    const button = $("#micButton");
    if (!button) return;
    button.innerHTML = icon(recording ? "stop" : "mic");
    button.setAttribute("aria-label", recording ? "结束录音" : "开始录音");
  }

  function setListenEnabled(enabled) {
    const listen = $("#listenButton");
    const slow = $("#slowButton");
    if (listen) listen.disabled = !enabled;
    if (slow) slow.disabled = !enabled;
  }

  function setRecordingUI() {
    const zone = $("#recordZone");
    if (!zone) return;
    zone.classList.remove("is-preparing", "is-processing");
    zone.classList.add("is-recording");
    setMicButton(true);
    setListenEnabled(false);
    const title = $("#recordTitle");
    const text = $("#recordText");
    const hint = $("#recordHint");
    if (title) title.textContent = "我在听啦，大声说！";
    if (text) text.textContent = "说完点「说完了」，或者再点一下麦克风。";
    if (hint) hint.textContent = "不用着急，慢慢说完整句。";
    const mic = $("#micButton");
    if (mic) mic.disabled = false;
    const time = $("#recordTime");
    if (time) time.textContent = "00:00";
  }

  function setPreparingUI() {
    const zone = $("#recordZone");
    if (!zone) return;
    zone.classList.remove("is-recording", "is-processing");
    zone.classList.add("is-preparing");
    setMicButton(false);
    const mic = $("#micButton");
    if (mic) mic.disabled = true;
    setListenEnabled(false);
    const title = $("#recordTitle");
    const text = $("#recordText");
    const hint = $("#recordHint");
    if (title) title.textContent = "正在打开麦克风…";
    if (text) text.textContent = "如果浏览器询问，请点「允许」。";
    if (hint) hint.textContent = "第一次使用时，只要允许一次就好。";
  }

  function setProcessingUI() {
    const zone = $("#recordZone");
    if (!zone) return;
    zone.classList.remove("is-recording", "is-preparing");
    zone.classList.add("is-processing");
    const mic = $("#micButton");
    if (mic) mic.disabled = true;
    setListenEnabled(false);
    const title = $("#recordTitle");
    const text = $("#recordText");
    const hint = $("#recordHint");
    if (title) title.textContent = "收好你的声音啦…";
    if (text) text.textContent = "马上就能听到自己的录音和星星。";
    if (hint) hint.textContent = "黄老师可能在听，稍等一下下。";
  }

  function resetRecordUI(hasTake) {
    const zone = $("#recordZone");
    if (!zone) return;
    zone.classList.remove("is-recording", "is-preparing", "is-processing");
    setMicButton(false);
    const mic = $("#micButton");
    if (mic) mic.disabled = false;
    setListenEnabled(true);
    const title = $("#recordTitle");
    const text = $("#recordText");
    const hint = $("#recordHint");
    if (title) title.textContent = hasTake ? "想再棒一点？再录一次" : "轮到你啦！";
    if (text) text.textContent = hasTake ? "点一下麦克风，再跟读一次。" : "点一下麦克风，准备好就大声说。";
    if (hint) hint.textContent = "小提示：靠近麦克风，慢慢说，不用着急。";
    const time = $("#recordTime");
    if (time) time.textContent = "00:00";
    hideMicError();
    resetListenUI();
  }

  function showMicError(kind, detail) {
    const box = $("#micError");
    if (!box) return;
    let title = "麦克风没有打开";
    let text = "请检查浏览器的麦克风权限，然后再试一次。";
    if (kind === "not-allowed") {
      title = "麦克风被挡住啦";
      text = "点浏览器地址栏左边的锁或麦克风图标，把权限改成「允许」，然后再试一次。";
    } else if (kind === "not-found") {
      title = "没有找到麦克风";
      text = "请确认电脑或耳机上连着麦克风，然后再试一次。";
    } else if (kind === "busy") {
      title = "麦克风正在被别的应用使用";
      text = "关掉正在录音或开会的应用，然后再试一次。";
    } else if (kind === "insecure") {
      title = "需要在本机页面打开";
      text = "录音需要 https 或 localhost。请用本地服务器打开这个页面（例如 python3 -m http.server），不要直接双击 HTML 文件。";
    } else if (kind === "unsupported") {
      title = "这个浏览器不能录音";
      text = "请用 Chrome 或 Edge 打开这个页面。Safari 也可以录音，但本机听写需要 Chrome/Edge。";
    } else if (detail) {
      text = detail;
    }
    box.innerHTML = `<span class="mic-error__icon">${icon("mic")}</span>
      <div class="mic-error__body">
        <h4>${escapeHtml(title)}</h4>
        <p>${escapeHtml(text)}</p>
        <div class="mic-error__actions">
          <button type="button" class="btn btn--soft btn--sm" data-action="record">${icon("refresh")}再试一次</button>
        </div>
      </div>`;
    box.hidden = false;
    const zone = $("#recordZone");
    if (zone) zone.classList.remove("is-preparing", "is-recording", "is-processing");
    setMicButton(false);
    const mic = $("#micButton");
    if (mic) mic.disabled = false;
    setListenEnabled(true);
    const titleEl = $("#recordTitle");
    const textEl = $("#recordText");
    if (titleEl) titleEl.textContent = "麦克风遇到一点小问题";
    if (textEl) textEl.textContent = "看看下面的提示，再试一次。";
    const hint = $("#recordHint");
    if (hint) hint.textContent = "也可以先点「听一听」继续听示范。";
  }

  function hideMicError() {
    const box = $("#micError");
    if (box) box.hidden = true;
  }

  function micErrorKind(error) {
    if (!error) return "unknown";
    if (error.name === "NotAllowedError" || error.name === "SecurityError") return "not-allowed";
    if (error.name === "NotFoundError" || error.name === "OverconstrainedError") return "not-found";
    if (error.name === "NotReadableError" || error.name === "AbortError") return "busy";
    return "unknown";
  }

  function releaseStream(stream) {
    if (!stream) return;
    stream.getTracks().forEach((track) => track.stop());
  }

  function stopMetering() {
    if (state.analyserSource) {
      try { state.analyserSource.disconnect(); } catch (error) { /* already disconnected */ }
    }
    state.analyserSource = null;
    state.analyser = null;
    state.analyserData = null;
  }

  function startMetering(stream) {
    try {
      const ctx = audioCtx();
      if (!ctx) return;
      state.analyserSource = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      state.analyserSource.connect(analyser);
      state.analyser = analyser;
      state.analyserData = new Uint8Array(analyser.fftSize);
    } catch (error) {
      state.analyser = null;
    }
  }

  function sampleVoice() {
    if (!state.analyser || !state.analyserData) return;
    state.analyser.getByteTimeDomainData(state.analyserData);
    let peak = 0;
    for (let i = 0; i < state.analyserData.length; i += 1) {
      peak = Math.max(peak, Math.abs(state.analyserData[i] - 128) / 128);
    }
    if (peak > 0.045) {
      const now = performance.now();
      if (!state.voiceStartAt) state.voiceStartAt = now;
      state.lastVoiceAt = now;
    }
  }

  function startSpeechRecognition() {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    state.speechParts = [];
    state.speechError = null;
    if (!Ctor) return;
    let recognition;
    try {
      recognition = new Ctor();
    } catch (error) {
      return;
    }
    state.speechRecognition = recognition;
    state.speechActive = true;
    recognition.lang = "en-US";
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.addEventListener("result", (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) {
          const text = (result[0] && result[0].transcript ? result[0].transcript : "").trim();
          if (text) state.speechParts.push(text);
        }
      }
    });
    recognition.addEventListener("error", (event) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        state.speechActive = false;
        state.speechError = "not-allowed";
      } else if (event.error === "network") {
        state.speechError = "network";
      }
    });
    recognition.addEventListener("end", () => {
      if (state.speechActive && state.isRecording) {
        setTimeout(() => {
          if (!state.speechActive || !state.isRecording || !state.speechRecognition) return;
          try { state.speechRecognition.start(); } catch (error) { /* already started */ }
        }, 260);
      }
    });
    try {
      recognition.start();
    } catch (error) {
      state.speechActive = false;
    }
  }

  function stopSpeechRecognition() {
    state.speechActive = false;
    if (state.speechRecognition) {
      try { state.speechRecognition.stop(); } catch (error) { /* already stopped */ }
    }
  }

  function getMicStream() {
    return new Promise((resolve, reject) => {
      const options = [
        { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false },
        { audio: true, video: false }
      ];
      let index = 0;
      const attempt = () => {
        navigator.mediaDevices.getUserMedia(options[index]).then(resolve).catch((error) => {
          index += 1;
          if (index < options.length) attempt();
          else reject(error);
        });
      };
      attempt();
    });
  }

  function withTimeout(promise, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Object.assign(new Error("麦克风打开超时"), { name: "TimeoutError" })), ms);
      promise.then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); }
      );
    });
  }

  async function beginRecording() {
    if (state.isRecording || state.preparing) return;
    if (state.processing) return;
    if (state.demo && LESSON.demoTranscripts) {
      runDemoRecording();
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
      showMicError(window.isSecureContext === false ? "insecure" : "unsupported");
      return;
    }
    clearTimeout(state.autoPlayTimer);
    stopAllAudioTargets();
    hideMicError();
    state.recordingToken += 1;
    const token = state.recordingToken;
    const index = state.index;
    state.preparing = true;
    state.isRecording = false;
    setPreparingUI();
    const microphone = getMicStream();
    try {
      const stream = await withTimeout(microphone, 12000);
      if (token !== state.recordingToken || state.screen !== "practice") {
        releaseStream(stream);
        return;
      }
      state.stream = stream;
      state.preparing = false;
      state.isRecording = true;
      state.speechError = null;
      state.speechParts = [];
      state.voiceStartAt = 0;
      state.lastVoiceAt = 0;
      state.recordStartedAt = performance.now();
      state.recordSeconds = 0;
      setRecordingUI();
      sfx("start");

      let recorder;
      try {
        const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
        const mimeType = candidates.find((type) => {
          try { return MediaRecorder.isTypeSupported(type); } catch (error) { return false; }
        });
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      } catch (error) {
        throw error;
      }
      state.recorder = recorder;
      state.chunks = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size) state.chunks.push(event.data);
      });
      recorder.addEventListener("error", () => {
        showToast("录音出了点小问题，请再录一次。");
      });
      try {
        recorder.start(250);
      } catch (error) {
        throw error;
      }
      startMetering(stream);
      startSpeechRecognition();
      state.recordInterval = setInterval(() => {
        if (!state.isRecording) return;
        const elapsed = (performance.now() - state.recordStartedAt) / 1000;
        state.recordSeconds = elapsed;
        sampleVoice();
        const timeEl = $("#recordTime");
        if (timeEl) timeEl.textContent = formatClock(elapsed);
        const max = Number(LESSON.sentences[index].maxSeconds) || 20;
        if (elapsed >= max) {
          stopRecording();
        }
      }, 100);
    } catch (error) {
      // The browser permission prompt can resolve after we stop waiting; do not
      // leave that late stream open.
      microphone.then((lateStream) => releaseStream(lateStream)).catch(() => {});
      releaseStream(state.stream);
      state.stream = null;
      state.preparing = false;
      state.isRecording = false;
      if (token !== state.recordingToken) return;
      state.recordingToken += 1;
      showMicError(error && error.name === "TimeoutError" ? "unknown" : micErrorKind(error), error && error.name === "TimeoutError" ? "麦克风打开得有点慢，再试一次吧。" : "");
    }
  }

  function demoRecordTick() {
    if (!state.isRecording) return;
    const elapsed = (performance.now() - state.recordStartedAt) / 1000;
    const timeEl = $("#recordTime");
    if (timeEl) timeEl.textContent = formatClock(elapsed);
    if (elapsed >= 2.2) finishDemoRecording();
  }

  function runDemoRecording() {
    clearTimeout(state.autoPlayTimer);
    stopAllAudioTargets();
    state.recordingToken += 1;
    state.isRecording = true;
    state.preparing = false;
    state.processing = false;
    state.recordStartedAt = performance.now();
    setRecordingUI();
    sfx("start");
    clearInterval(state.recordInterval);
    state.recordInterval = setInterval(demoRecordTick, 100);
  }

  async function finishDemoRecording() {
    if (!state.isRecording) return;
    const token = state.recordingToken;
    const index = state.index;
    state.isRecording = false;
    clearInterval(state.recordInterval);
    state.recordInterval = null;
    setProcessingUI();
    sfx("stop");
    try {
      const response = await fetch(`assets/audio/demo-${index + 1}.wav?v=${AUDIO_VERSION}`);
      const blob = await response.blob();
      await wait(420);
      if (token !== state.recordingToken) return;
      const duration = Number((LESSON.demoDurations || [])[index]) || modelSecondsFor(index);
      acceptTake(blob, LESSON.demoTranscripts[index] || "", duration, duration * 0.94, token, index);
    } catch (error) {
      if (token !== state.recordingToken) return;
      resetRecordUI(!!state.recordings[index]);
      showToast("演示音频没有加载成功，请刷新页面。");
    }
  }

  function stopRecording() {
    if (state.demo) {
      finishDemoRecording();
      return;
    }
    if (!state.isRecording) return;
    const token = state.recordingToken;
    const index = state.index;
    state.isRecording = false;
    clearInterval(state.recordInterval);
    state.recordInterval = null;
    const elapsed = Math.max(0.4, (performance.now() - state.recordStartedAt) / 1000);
    const speechSeconds = state.voiceStartAt && state.lastVoiceAt
      ? Math.max(0.4, (state.lastVoiceAt - state.voiceStartAt) / 1000)
      : elapsed;
    const recorder = state.recorder;
    const stream = state.stream;
    state.recorder = null;
    state.stream = null;
    stopSpeechRecognition();
    stopMetering();
    setProcessingUI();
    setMicButton(false);
    sfx("stop");

    const finalize = async (blob) => {
      releaseStream(stream);
      if (token !== state.recordingToken) return;
      if (!blob || !blob.size) {
        state.processing = false;
        resetRecordUI(!!state.recordings[index]);
        showMicError("unknown", "这次没有录到声音，请再试一次。");
        return;
      }
      await wait(680);
      if (token !== state.recordingToken) return;
      const transcript = state.speechParts.join(" ").replace(/\s+/g, " ").trim();
      let playable = blob;
      try {
        playable = await blobToWav(blob);
      } catch (error) {
        /* keep the browser's own container when decoding is unavailable */
      }
      if (token !== state.recordingToken) return;
      acceptTake(playable, transcript, elapsed, speechSeconds, token, index);
    };

    if (!recorder || recorder.state === "inactive") {
      finalize(null);
      return;
    }
    recorder.addEventListener("stop", () => {
      const blob = new Blob(state.chunks, { type: recorder.mimeType || "audio/webm" });
      state.chunks = [];
      finalize(blob);
    }, { once: true });
    try {
      recorder.stop();
    } catch (error) {
      finalize(null);
    }
  }

  function acceptTake(blob, transcript, duration, speechSeconds, token, index) {
    if (token !== state.recordingToken) return;
    state.processing = false;
    const old = state.recordings[index];
    if (old && old.url) URL.revokeObjectURL(old.url);
    const entry = {
      blob,
      url: URL.createObjectURL(blob),
      transcript: String(transcript || "").trim(),
      duration: Number(duration) || 0,
      speechSeconds: Number(speechSeconds) || 0,
      result: null,
      aiError: null,
      pending: false,
      savedAt: Date.now()
    };
    state.recordings[index] = entry;
    const useAi = !!(state.settings.aiEnabled && state.settings.geminiKey);
    const local = localResultFor(index, entry);
    entry.result = useAi ? null : local;
    entry.pending = useAi;
    persistTake(index, entry);
    resetRecordUI(true);
    renderTakeZone(entry);
    if (useAi) {
      updateResultMount(entry, true);
      runAiGrading(index, entry, local, true);
    } else {
      if (entry.result) sfx(entry.result.stars >= 4 ? "success" : "pop");
      updateResultMount(entry, false);
      scrollToTake();
    }
    updateHome();
  }

  function scrollToTake() {
    if (state.screen !== "practice") return;
    const panel = $("#takePanel", practiceScreen);
    if (!panel) return;
    setTimeout(() => {
      if (state.screen !== "practice") return;
      panel.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "start" });
    }, 90);
  }

  function teardownSession() {
    clearTimeout(state.autoPlayTimer);
    state.recordingToken += 1;
    state.isRecording = false;
    state.preparing = false;
    state.processing = false;
    clearInterval(state.recordInterval);
    state.recordInterval = null;
    stopSpeechRecognition();
    state.speechRecognition = null;
    state.speechParts = [];
    stopMetering();
    if (state.recorder && state.recorder.state !== "inactive") {
      try { state.recorder.stop(); } catch (error) { /* ignore */ }
    }
    state.recorder = null;
    releaseStream(state.stream);
    state.stream = null;
    stopAllAudioTargets();
    if (state.takePlayer) {
      state.takePlayer.audio.pause();
      state.takePlayer = null;
    }
    if (window.speechSynthesis) window.speechSynthesis.cancel();
  }

  /* ------------------------------------------------------------------ */
  /* practice event routing                                              */
  /* ------------------------------------------------------------------ */

  function handlePracticeClick(event) {
    const actionEl = event.target.closest("[data-action]");
    if (!actionEl || !practiceScreen.contains(actionEl)) return;
    const action = actionEl.dataset.action;
    const entry = state.recordings[state.index];
    switch (action) {
      case "home":
        goHome();
        break;
      case "listen":
        playModel(false);
        break;
      case "slow":
        playModel(true);
        break;
      case "record":
        if (state.isRecording) stopRecording();
        else beginRecording();
        break;
      case "stop-recording":
        stopRecording();
        break;
      case "retry-recording": {
        if (state.processing) return;
        hideMicError();
        const zone = $("#recordZone", practiceScreen);
        if (zone) zone.scrollIntoView({ behavior: REDUCED_MOTION ? "auto" : "smooth", block: "center" });
        beginRecording();
        break;
      }
      case "play-model":
        playModel(false);
        break;
      case "download-take":
        downloadEntry(state.index);
        break;
      case "retry-ai":
        retryAi();
        break;
      case "next": {
        const next = state.index + 1;
        if (next >= LESSON.sentences.length) {
          renderSummary();
        } else {
          startPractice(next);
        }
        break;
      }
      case "speak-word":
        speakWord(actionEl.dataset.word);
        break;
      default:
        break;
    }
  }

  /* ------------------------------------------------------------------ */
  /* recording downloads                                                 */
  /* ------------------------------------------------------------------ */

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let value = i;
      for (let bit = 0; bit < 8; bit += 1) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      table[i] = value >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function dosDateTime(date = new Date()) {
    const year = Math.max(1980, Math.min(2107, date.getFullYear()));
    return {
      time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
      date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
    };
  }

  function dateStamp(date = new Date()) {
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function extensionForBlob(blob) {
    const type = String((blob && blob.type) || "").toLowerCase();
    if (type.includes("wav")) return "wav";
    if (type.includes("mpeg") || type.includes("mp3")) return "mp3";
    if (type.includes("mp4") || type.includes("m4a") || type.includes("aac")) return "m4a";
    if (type.includes("ogg") || type.includes("opus")) return "ogg";
    return "webm";
  }

  function takeFileName(index, extension) {
    const sentence = LESSON.sentences[index];
    return `Winnie_${String(index + 1).padStart(2, "0")}_${sentence.id}.${extension}`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  function downloadEntry(index) {
    const entry = state.recordings[index];
    if (!entry || !entry.blob) {
      showToast("这一句还没有可下载的录音。");
      return;
    }
    downloadBlob(entry.blob, takeFileName(index, extensionForBlob(entry.blob)));
    showToast("录音已开始下载。");
  }

  function recordingNotes() {
    const lines = [
      "Winnie 口语小花园 · 跟读录音",
      `导出时间：${new Date().toLocaleString("zh-CN")}`,
      ""
    ];
    LESSON.sentences.forEach((sentence, index) => {
      const entry = state.recordings[index];
      if (!entry) {
        lines.push(`${index + 1}. ${sentence.en}`, "   没有录音");
      } else {
        const result = entry.result;
        lines.push(
          `${index + 1}. ${sentence.en}`,
          `   得分：${result ? `${Math.round(Number(result.overall) || 0)} 分 / ${Number(result.stars) || 0} 星` : "未评分"}`
        );
      }
      lines.push("");
    });
    lines.push("这些录音来自本机练习，仅用于回听和留存。");
    return lines.join("\n");
  }

  async function buildRecordingsZip() {
    const files = [];
    for (let index = 0; index < state.recordings.length; index += 1) {
      const entry = state.recordings[index];
      if (!entry || !entry.blob) continue;
      const bytes = new Uint8Array(await entry.blob.arrayBuffer());
      files.push({ name: takeFileName(index, extensionForBlob(entry.blob)), bytes });
    }
    files.push({ name: "README.txt", bytes: new TextEncoder().encode(recordingNotes()) });
    if (!files.length) throw new Error("no recordings");

    const { time, date } = dosDateTime();
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    files.forEach((file) => {
      const name = new TextEncoder().encode(file.name);
      const checksum = crc32(file.bytes);
      const local = new Uint8Array(30 + name.length);
      const localView = new DataView(local.buffer);
      localView.setUint32(0, 0x04034b50, true);
      localView.setUint16(4, 20, true);
      localView.setUint16(6, 0x0800, true);
      localView.setUint16(8, 0, true);
      localView.setUint16(10, time, true);
      localView.setUint16(12, date, true);
      localView.setUint32(14, checksum, true);
      localView.setUint32(18, file.bytes.length, true);
      localView.setUint32(22, file.bytes.length, true);
      localView.setUint16(26, name.length, true);
      localView.setUint16(28, 0, true);
      local.set(name, 30);
      localParts.push(local, file.bytes);

      const central = new Uint8Array(46 + name.length);
      const centralView = new DataView(central.buffer);
      centralView.setUint32(0, 0x02014b50, true);
      centralView.setUint16(4, 20, true);
      centralView.setUint16(6, 20, true);
      centralView.setUint16(8, 0x0800, true);
      centralView.setUint16(10, 0, true);
      centralView.setUint16(12, time, true);
      centralView.setUint16(14, date, true);
      centralView.setUint32(16, checksum, true);
      centralView.setUint32(20, file.bytes.length, true);
      centralView.setUint32(24, file.bytes.length, true);
      centralView.setUint16(28, name.length, true);
      centralView.setUint16(30, 0, true);
      centralView.setUint16(32, 0, true);
      centralView.setUint16(34, 0, true);
      centralView.setUint16(36, 0, true);
      centralView.setUint32(38, 0, true);
      centralView.setUint32(42, offset, true);
      central.set(name, 46);
      centralParts.push(central);
      offset += local.length + file.bytes.length;
    });

    const centralSize = centralParts.reduce((total, part) => total + part.length, 0);
    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);
    endView.setUint32(0, 0x06054b50, true);
    endView.setUint16(4, 0, true);
    endView.setUint16(6, 0, true);
    endView.setUint16(8, files.length, true);
    endView.setUint16(10, files.length, true);
    endView.setUint32(12, centralSize, true);
    endView.setUint32(16, offset, true);
    endView.setUint16(20, 0, true);

    return new Blob([...localParts, ...centralParts, end], { type: "application/zip" });
  }

  async function downloadAllRecordings(button) {
    if (!state.recordings.some((entry) => entry && entry.blob)) {
      showToast("还没有可下载的录音。");
      return;
    }
    if (button && button.dataset.busy === "true") return;
    const original = button ? button.innerHTML : "";
    if (button) {
      button.dataset.busy = "true";
      button.disabled = true;
      button.innerHTML = `${icon("download")}正在打包…`;
    }
    try {
      const zip = await buildRecordingsZip();
      downloadBlob(zip, `Winnie_recordings_${dateStamp()}.zip`);
      showToast("录音已打包下载。");
    } catch (error) {
      console.warn("[download] zip failed", error);
      showToast("打包失败，请用每句旁边的下载按钮。");
    } finally {
      if (button) {
        button.disabled = false;
        button.dataset.busy = "";
        button.innerHTML = original;
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* summary                                                             */
  /* ------------------------------------------------------------------ */

  function summaryRows() {
    return LESSON.sentences.map((sentence, index) => {
      const entry = state.recordings[index];
      const result = entry && entry.result;
      const stars = result ? Number(result.stars) || 0 : 0;
      const challenge = sentence.kind === "challenge";
      const label = itemLabel(index);
      return `<div class="summary-row ${entry ? "" : "is-empty"} ${challenge ? "is-challenge" : ""}">
        <div class="summary-row__art">
          <span class="summary-row__num">${challenge ? "★" : sentenceOrdinal(index)}</span>
          <img src="${sentence.scene}" alt="" />
        </div>
        <div class="summary-row__text">
          <p class="summary-row__en">${escapeHtml(sentence.en)}</p>
          <div class="summary-row__meta">
            <span class="summary-row__label">${label}</span>
            ${result ? `<span class="summary-row__stars" aria-label="${stars} 颗星">${starIcons(stars)}</span><span class="summary-row__score">${Math.round(Number(result.overall) || 0)} 分</span><span>${result.provider === "gemini" ? "Gemini 点评" : "快速评分"}</span>` : `<span>${entry ? "录音已保存，还没有评分" : "这一项还没练"}</span>`}
          </div>
        </div>
        <div class="summary-row__actions">
          ${entry ? `<button type="button" class="mini-button" data-summary-take="${index}" aria-label="听${label}我的录音">${icon("play")}</button>` : ""}
          <button type="button" class="mini-button" data-summary-model="${index}" aria-label="听${label}示范">${icon("speaker")}</button>
          ${entry ? `<button type="button" class="mini-button" data-summary-download="${index}" aria-label="下载${label}我的录音">${icon("download")}</button>` : ""}
          <button type="button" class="summary-row__retry" data-summary-retry="${index}">${entry ? "再练" : "去练"}</button>
        </div>
      </div>`;
    }).join("");
  }

  function renderSummary() {
    teardownSession();
    state.screen = "summary";
    const scoredEntries = state.recordings.filter((entry) => entry && entry.result);
    const stars = totalStars();
    const taken = state.recordings.filter(Boolean).length;
    const average = scoredEntries.length
      ? Math.round(scoredEntries.reduce((sum, entry) => sum + (Number(entry.result.overall) || 0), 0) / scoredEntries.length)
      : null;
    const taskCount = LESSON.sentences.length;
    const maxStars = taskCount * 5;
    const allDone = scoredEntries.length === taskCount;
    const allFull = allDone && scoredEntries.every((entry) => Number(entry.result.stars) === 5);
    const allStrong = allDone && scoredEntries.every((entry) => Number(entry.result.stars) >= 4);
    const title = !taken
      ? "准备好开始了吗？"
      : allFull
        ? "闪亮小主播，<span class=\"title-tail\">满星啦！</span>"
        : allStrong
          ? "闪亮小主播，<span class=\"title-tail\">太棒啦！</span>"
          : allDone
            ? `${taskCount} 个任务，全部完成！`
            : "今天也勇敢开口啦！";
    const focusEntry = scoredEntries
      .filter((entry) => Array.isArray(entry.result.focus) && entry.result.focus.length)
      .sort((a, b) => Number(a.result.overall) - Number(b.result.overall))[0];
    let nextTip = "慢一点、大声一点，就是最棒的练习。";
    if (focusEntry) {
      const sentenceIndex = state.recordings.indexOf(focusEntry);
      nextTip = `下次可以再练：${itemLabel(sentenceIndex)}里的 ${focusEntry.result.focus.slice(0, 2).join("、")}。`;
    }

    summaryScreen.innerHTML = `
      <div class="summary-banner">
        <img class="summary-mascot" src="assets/img/winnie-hero.svg" alt="" />
        <p class="kicker">Great work, Winnie!</p>
        <h1>${title}</h1>
        <p>${taken ? "每一次开口，都会让英语变得更勇敢、更清楚。" : `听一听黄老师的示范，然后大声跟着说。${regularSentenceCount()} 句话${hasChallenge() ? "加整段挑战" : ""}，慢慢来。`}</p>
        <div class="summary-stats">
          <div class="summary-stat summary-stat--stars">
            <strong>${icon("star")} ${stars}</strong>
            <span>星星 · 满分 ${maxStars}</span>
          </div>
          <div class="summary-stat">
            <strong>${average === null ? "—" : average}</strong>
            <span>平均分</span>
          </div>
          <div class="summary-stat">
            <strong>${scoredEntries.length}<small style="font-size:15px;color:var(--muted)"> / ${taskCount}</small></strong>
            <span>完成的任务</span>
          </div>
        </div>
      </div>

      <section class="summary-section" aria-labelledby="summaryListTitle">
        <div class="section-head">
          <div>
            <p class="kicker">Your practice</p>
            <h2 id="summaryListTitle">一项一项看过来</h2>
          </div>
        </div>
        <div class="summary-list">${summaryRows()}</div>
        <p class="summary-note">${icon("leaf")} ${escapeHtml(nextTip)}</p>
      </section>

      <div class="summary-actions">
        <button type="button" class="btn btn--primary" data-summary-action="download-all">${icon("download")}一键下载全部录音</button>
        <button type="button" class="btn btn--soft" data-summary-action="restart">${icon("refresh")}再练一次</button>
        <button type="button" class="btn btn--ghost" data-summary-action="print">${icon("printer")}保存成绩单</button>
        <button type="button" class="btn btn--ghost" data-summary-action="home">回到首页</button>
      </div>
      <p class="summary-download-note">录音只保存在本机。下载会把有录音的句子打包成一个 ZIP，存到浏览器的下载文件夹。</p>`;

    showScreen("summary");
    window.scrollTo({ top: 0, behavior: "auto" });
    if (taken) launchConfetti();
  }

  function handleSummaryClick(event) {
    const takeButton = event.target.closest("[data-summary-take]");
    if (takeButton) {
      const index = Number(takeButton.dataset.summaryTake);
      toggleSummaryAudio(index, "take", takeButton);
      return;
    }
    const modelButton = event.target.closest("[data-summary-model]");
    if (modelButton) {
      const index = Number(modelButton.dataset.summaryModel);
      toggleSummaryAudio(index, "model", modelButton);
      return;
    }
    const downloadButton = event.target.closest("[data-summary-download]");
    if (downloadButton) {
      downloadEntry(Number(downloadButton.dataset.summaryDownload));
      return;
    }
    const retry = event.target.closest("[data-summary-retry]");
    if (retry) {
      startPractice(Number(retry.dataset.summaryRetry));
      return;
    }
    const action = event.target.closest("[data-summary-action]");
    if (!action) return;
    if (action.dataset.summaryAction === "restart") startPractice(0);
    else if (action.dataset.summaryAction === "home") goHome();
    else if (action.dataset.summaryAction === "download-all") downloadAllRecordings(action);
    else if (action.dataset.summaryAction === "print") {
      showToast("打开打印窗口后，可以选择「存储为 PDF」。");
      setTimeout(() => window.print(), 300);
    }
  }

  function toggleSummaryAudio(index, kind, button) {
    const key = `${kind}:${index}`;
    if (state.summaryAudio && state.summaryKey === key && !state.summaryAudio.paused) {
      state.summaryAudio.pause();
      button.innerHTML = icon("play");
      return;
    }
    stopAllAudioTargets();
    const entry = state.recordings[index];
    const src = kind === "take" && entry ? entry.url : audioFor(index, "normal");
    const audio = new Audio(src);
    state.summaryAudio = audio;
    state.summaryKey = key;
    state.summaryButton = button;
    button.innerHTML = icon("pause");
    audio.addEventListener("ended", () => {
      if (state.summaryAudio === audio) {
        state.summaryAudio = null;
        state.summaryKey = null;
        state.summaryButton = null;
      }
      button.innerHTML = icon("play");
    });
    audio.addEventListener("error", () => {
      button.innerHTML = icon("play");
      showToast("这段声音没有加载成功。");
    });
    audio.play().catch(() => {
      button.innerHTML = icon("play");
      showToast("点一下再播放试试。");
    });
  }

  /* ------------------------------------------------------------------ */
  /* settings modal                                                      */
  /* ------------------------------------------------------------------ */

  function modelOptions() {
    const models = Array.isArray(CONFIG.geminiModels) && CONFIG.geminiModels.length
      ? CONFIG.geminiModels.slice()
      : ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"];
    if (!models.includes(state.settings.geminiModel)) models.unshift(state.settings.geminiModel);
    return models.map((model) => `<option value="${escapeHtml(model)}">${escapeHtml(model)}</option>`).join("");
  }

  function renderDeviceChips() {
    const row = $("#deviceRow");
    if (!row) return;
    const hasMic = micSupported();
    const hasAsr = asrSupported();
    const key = $("#geminiKey") ? $("#geminiKey").value.trim() : state.settings.geminiKey;
    row.innerHTML = `
      <span class="device-chip ${hasMic ? "is-ok" : "is-no"}">${hasMic ? "✓" : "×"} 麦克风${hasMic ? "可用" : "不可用"}</span>
      <span class="device-chip ${hasAsr ? "is-ok" : "is-no"}">${hasAsr ? "✓" : "×"} 本机听写${hasAsr ? "可用" : "换 Chrome/Edge"}</span>
      <span class="device-chip ${key && $("#aiEnabled").checked ? "is-ok" : ""}">${key && $("#aiEnabled").checked ? "✓" : "—"} Gemini${key && $("#aiEnabled").checked ? " Key 已填写" : key ? " 评分已关闭" : " 未连接"}</span>`;
  }

  function openSettings() {
    state.lastFocus = document.activeElement;
    const voiceButtons = $$("#voiceSegment button");
    voiceButtons.forEach((button) => {
      const active = button.dataset.voice === state.settings.voice;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    $("#aiEnabled").checked = state.settings.aiEnabled;
    $("#geminiKey").value = state.settings.geminiKey;
    $("#geminiModel").innerHTML = modelOptions();
    $("#geminiModel").value = state.settings.geminiModel;
    $("#sfxToggle").checked = state.settings.sfx;
    $("#geminiStatus").hidden = true;
    $("#geminiKey").type = "password";
    $("#toggleKey").innerHTML = icon("eye");
    renderDeviceChips();
    settingsModal.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => {
      const close = settingsModal.querySelector(".modal__head [data-close-settings]");
      if (close) close.focus();
    }, 30);
  }

  function closeSettings() {
    settingsModal.hidden = true;
    if (confirmModal.hidden) document.body.style.overflow = "";
    if (state.lastFocus && typeof state.lastFocus.focus === "function") {
      state.lastFocus.focus();
    }
    state.lastFocus = null;
  }

  function saveSettingsFromForm() {
    const activeVoice = $("#voiceSegment button.is-active");
    const key = $("#geminiKey").value.trim();
    state.settings.voice = activeVoice && activeVoice.dataset.voice === "friend" ? "friend" : "teacher";
    state.settings.aiEnabled = $("#aiEnabled").checked;
    state.settings.geminiKey = key;
    state.settings.geminiModel = $("#geminiModel").value;
    state.settings.sfx = $("#sfxToggle").checked;
    saveSettings();
    closeSettings();
    showToast(state.settings.geminiKey && state.settings.aiEnabled
      ? "设置已保存。接下来会用 Gemini 听发音了。"
      : "设置已保存。现在使用本机快速评分。");
    if (state.screen === "practice") {
      const label = $("#voiceLabel");
      if (label) label.textContent = state.settings.voice === "friend" ? "小伙伴示范" : "黄老师示范";
    }
  }

  function setGeminiStatus(message, tone = "") {
    const el = $("#geminiStatus");
    if (!el) return;
    el.hidden = false;
    el.textContent = message;
    el.classList.remove("is-ok", "is-err", "is-wait");
    if (tone) el.classList.add(tone);
  }

  async function testGemini() {
    const key = $("#geminiKey").value.trim();
    const model = $("#geminiModel").value;
    if (!key) {
      setGeminiStatus("请先粘贴 Gemini API Key。", "is-err");
      $("#geminiKey").focus();
      return;
    }
    const button = $("#testGeminiButton");
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "正在连接…";
    setGeminiStatus("正在连接 Gemini，请稍等…", "is-wait");
    try {
      await SCORING.testGemini({ apiKey: key, model });
      setGeminiStatus("连接成功！保存后，下一段录音就可以请 Gemini 评分了。", "is-ok");
      renderDeviceChips();
    } catch (error) {
      setGeminiStatus(error && error.message ? error.message : "连接失败，请检查 Key 和网络。", "is-err");
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  function askConfirm({ title, text, label, onConfirm }) {
    $("#confirmTitle").textContent = title;
    $("#confirmText").textContent = text;
    $("#confirmClearButton").textContent = label || "清除";
    state.confirmHandler = onConfirm;
    confirmModal.hidden = false;
    document.body.style.overflow = "hidden";
    setTimeout(() => $("#confirmClearButton").focus(), 30);
  }

  function closeConfirm() {
    confirmModal.hidden = true;
    state.confirmHandler = null;
    if (settingsModal.hidden) document.body.style.overflow = "";
  }

  function clearAllTakes() {
    state.recordings.forEach((entry) => {
      if (entry && entry.url) URL.revokeObjectURL(entry.url);
    });
    state.recordings = new Array(LESSON.sentences.length).fill(null);
    stopAllAudioTargets();
    clearTakes();
    if (state.takePlayer) {
      state.takePlayer.audio.pause();
      state.takePlayer = null;
    }
    updateHome();
  }

  /* ------------------------------------------------------------------ */
  /* confetti                                                            */
  /* ------------------------------------------------------------------ */

  function launchConfetti() {
    if (REDUCED_MOTION) return;
    const canvas = confettiCanvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = ["#f47c9c", "#b79be8", "#ffc94d", "#7acbb8", "#ff9dbb", "#fff0b8"];
    const pieces = Array.from({ length: 110 }, () => ({
      x: innerWidth * (0.15 + Math.random() * 0.7),
      y: -20 - Math.random() * innerHeight * 0.3,
      w: 6 + Math.random() * 7,
      h: 8 + Math.random() * 9,
      vx: -1.2 + Math.random() * 2.4,
      vy: 2 + Math.random() * 3.5,
      rot: Math.random() * Math.PI,
      vr: -0.12 + Math.random() * 0.24,
      color: colors[Math.floor(Math.random() * colors.length)],
      shape: Math.random() > 0.35 ? "rect" : "circle"
    }));
    const started = performance.now();
    const draw = (now) => {
      const age = now - started;
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      pieces.forEach((piece) => {
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.vy += 0.035;
        piece.rot += piece.vr;
        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate(piece.rot);
        ctx.fillStyle = piece.color;
        ctx.globalAlpha = age > 2600 ? Math.max(0, 1 - (age - 2600) / 500) : 1;
        if (piece.shape === "circle") {
          ctx.beginPath();
          ctx.arc(0, 0, piece.w / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
        }
        ctx.restore();
      });
      if (age < 3200) {
        requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, innerWidth, innerHeight);
      }
    };
    requestAnimationFrame(draw);
  }

  /* ------------------------------------------------------------------ */
  /* boot + bindings                                                     */
  /* ------------------------------------------------------------------ */

  function bindEvents() {
    startButton.addEventListener("click", startFromHome);
    welcomeButton.addEventListener("click", playWelcome);
    settingsButton.addEventListener("click", openSettings);
    homeSentences.addEventListener("click", (event) => {
      const tile = event.target.closest("[data-start-index]");
      if (!tile) return;
      startPractice(Number(tile.dataset.startIndex));
    });
    practiceScreen.addEventListener("click", handlePracticeClick);
    summaryScreen.addEventListener("click", handleSummaryClick);

    document.addEventListener("click", (event) => {
      if (event.target.closest("[data-open-settings]")) openSettings();
    });
    $$("[data-close-settings]").forEach((button) => button.addEventListener("click", closeSettings));
    $$("[data-close-confirm]").forEach((button) => button.addEventListener("click", closeConfirm));
    $("#saveSettingsButton").addEventListener("click", saveSettingsFromForm);
    $("#testGeminiButton").addEventListener("click", testGemini);
    $("#toggleKey").addEventListener("click", () => {
      const input = $("#geminiKey");
      const showing = input.type === "text";
      input.type = showing ? "password" : "text";
      $("#toggleKey").innerHTML = icon(showing ? "eye" : "eye-off");
      $("#toggleKey").setAttribute("aria-label", showing ? "显示 API Key" : "隐藏 API Key");
    });
    $("#geminiKey").addEventListener("input", renderDeviceChips);
    $("#aiEnabled").addEventListener("change", renderDeviceChips);
    $("#voiceSegment").addEventListener("click", (event) => {
      const button = event.target.closest("[data-voice]");
      if (!button) return;
      $$("#voiceSegment button").forEach((item) => {
        item.classList.toggle("is-active", item === button);
        item.setAttribute("aria-pressed", String(item === button));
      });
    });
    $("#clearDataButton").addEventListener("click", () => {
      askConfirm({
        title: "清除本机录音？",
        text: "这台设备上保存的录音和成绩会被删除，不能恢复。API Key 和设置不会受影响。",
        label: "清除录音",
        onConfirm: () => {
          clearAllTakes();
          closeSettings();
          closeConfirm();
          goHome();
          showToast("本机录音和成绩已经清除了。");
        }
      });
    });
    $("#confirmClearButton").addEventListener("click", () => {
      const handler = state.confirmHandler;
      closeConfirm();
      if (typeof handler === "function") handler();
    });

    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      if (!confirmModal.hidden) {
        closeConfirm();
      } else if (!settingsModal.hidden) {
        closeSettings();
      }
    });

    document.addEventListener("pointerdown", () => {
      if (state.hasUserGesture) return;
      state.hasUserGesture = true;
      const ctx = audioCtx();
      if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
    }, { once: true });

    window.addEventListener("winnie:lock", () => {
      if (!settingsModal.hidden) closeSettings();
      if (!confirmModal.hidden) closeConfirm();
      try { goHome(); } catch (error) { /* app may still be booting */ }
    });

    window.addEventListener("winnie:unlock", () => {
      loadActiveUnit();
    });

    window.addEventListener("pagehide", () => {
      releaseStream(state.stream);
      if (state.recorder && state.recorder.state !== "inactive") {
        try { state.recorder.stop(); } catch (error) { /* ignore */ }
      }
    });
  }

  function boot() {
    bindEvents();
    updateHome();
    showScreen("home");
    if (state.demo) {
      setTimeout(() => showToast("演示模式：点麦克风会用示范音频模拟一次跟读。", 3800), 700);
    }
    restoreTakes();
    // If auth is configured, the Supabase client appears after the auth module
    // initializes; load the teacher's active unit once it is available.
    setTimeout(() => {
      if (window.WinnieAuth && window.WinnieAuth.client) loadActiveUnit();
    }, 800);
  }

  boot();
})();
