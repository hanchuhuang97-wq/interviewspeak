/* Teacher-only unit editor. Requires Supabase + a deployed /api/tts. */
(function () {
  "use strict";

  const CONFIG = window.WINNIE_CONFIG || {};
  const SCENE = "assets/img/scene-lesson.svg";
  const VOICES = [
    { key: "teacher", voice: "en-US-AvaMultilingualNeural", rate: "-8%", label: "黄老师" },
    { key: "friend", voice: "en-US-AnaNeural", rate: "-2%", label: "小伙伴" },
    { key: "slow", voice: "en-US-AvaMultilingualNeural", rate: "-24%", label: "慢速" }
  ];

  let overlay = null;
  let busy = false;
  let managerOverlay = null;
  let managerBusy = false;
  let managerUnits = [];

  function el(id) {
    return document.getElementById(id);
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function syncBodyLock() {
    const editorOpen = overlay && !overlay.hidden;
    const managerOpen = managerOverlay && !managerOverlay.hidden;
    document.body.classList.toggle("editor-locked", !!(editorOpen || managerOpen));
  }

  function makeUuid() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (char) => {
      const random = Math.floor(Math.random() * 16);
      const value = char === "x" ? random : (random & 0x3) | 0x8;
      return value.toString(16);
    });
  }

  function setStatus(message, tone) {
    const node = el("editorStatus");
    if (!node) return;
    node.textContent = message || "";
    node.hidden = !message;
    node.className = "editor-status" + (tone ? ` is-${tone}` : "");
  }

  function setProgress(done, total, label) {
    const wrap = el("editorProgress");
    const bar = el("editorProgressBar");
    const text = el("editorProgressText");
    if (!wrap || !bar || !text) return;
    wrap.hidden = false;
    bar.style.width = total ? `${Math.round((done / total) * 100)}%` : "0%";
    text.textContent = label || `${done} / ${total}`;
  }

  function setBusy(next) {
    busy = next;
    const save = el("editorSave");
    const close = el("editorClose");
    const cancel = el("editorCancel");
    if (save) {
      save.disabled = next;
      save.textContent = next ? "正在生成…" : "生成并发布";
    }
    if (close) close.disabled = next;
    if (cancel) cancel.disabled = next;
  }

  function build() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "editor-gate";
    overlay.id = "unitEditor";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="editor-card" role="dialog" aria-modal="true" aria-labelledby="editorHeading">
        <header class="editor-head">
          <div>
            <p class="kicker">For teachers</p>
            <h2 id="editorHeading">课程编辑</h2>
          </div>
          <button type="button" class="icon-button icon-button--round" id="editorClose" aria-label="关闭课程编辑">✕</button>
        </header>
        <div class="editor-body">
          <p class="editor-intro">每行一句，最多 20 句；英文和中文用 <code>|</code> 分隔。发布会自动生成黄老师、小伙伴和慢速三条音轨；如果勾选整段挑战，还会生成整段示范音频。</p>
          <div class="field">
            <label for="editorTitle">单元标题</label>
            <input type="text" id="editorTitle" maxlength="60" placeholder="例如：Unit 2 · My Family" />
          </div>
          <div class="field">
            <label for="editorText">句子</label>
            <textarea id="editorText" rows="10" spellcheck="false" placeholder="Hi, my name is Winnie. | 你好，我叫 Winnie。&#10;My favorite foods are ice cream and cake. | 我最喜欢的食物是冰淇淋和蛋糕。"></textarea>
            <p class="field__hint">空行会忽略；中文翻译可省略；建议 10–20 句。</p>
          </div>
          <label class="switch-row">
            <span>
              <strong>添加整段挑战</strong>
              <small>所有句子完成后，让学生完整说一遍整段并评分。</small>
            </span>
            <input type="checkbox" id="editorChallenge" class="switch-input" checked />
            <span class="switch-ui" aria-hidden="true"></span>
          </label>
          <div class="editor-progress" id="editorProgress" hidden>
            <div class="editor-progress__track"><span id="editorProgressBar"></span></div>
            <p id="editorProgressText"></p>
          </div>
          <p class="editor-status" id="editorStatus" role="status" hidden></p>
          <p class="editor-setup">需要 Vercel 的 <code>/api/tts</code>、Supabase 的 <code>units</code> 表和 <code>unit-audio</code> 存储桶。配置见 README。</p>
        </div>
        <footer class="editor-foot">
          <button type="button" class="btn btn--ghost" id="editorCancel">取消</button>
          <button type="button" class="btn btn--primary" id="editorSave">生成并发布</button>
        </footer>
      </div>`;
    document.body.appendChild(overlay);
    el("editorClose").addEventListener("click", close);
    el("editorCancel").addEventListener("click", close);
    el("editorSave").addEventListener("click", publish);
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close();
    });
  }

  function open() {
    const auth = window.WinnieAuth;
    if (!auth || !auth.client || !auth.isTeacher()) {
      window.alert("课程编辑只对老师账号开放。请让管理员在 Supabase 给这个账号设置 app_metadata.role = teacher，然后重新登录。");
      return;
    }
    build();
    if (managerOverlay) managerOverlay.hidden = true;
    overlay.hidden = false;
    syncBodyLock();
    setTimeout(() => el("editorTitle").focus(), 60);
  }

  function close() {
    if (busy) return;
    if (overlay) overlay.hidden = true;
    syncBodyLock();
  }

  function parseLines(text) {
    return String(text || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const [en, ...rest] = line.split("|");
        return {
          id: `s${index + 1}`,
          en: en.trim(),
          zh: rest.join("|").trim()
        };
      })
      .filter((line) => line.en);
  }

  function estimateSeconds(text, challenge) {
    const words = String(text || "").split(/\s+/).filter(Boolean).length;
    if (challenge) return Math.min(150, Math.max(45, Math.round(words * 1.25 + 15)));
    return Math.min(60, Math.max(15, Math.round(words * 1.5 + 8)));
  }

  async function synthesize(text, voice, rate, token) {
    const endpoint = CONFIG.ttsEndpoint || "/api/tts";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ text, voice, rate })
    });
    if (!response.ok) {
      let detail = "";
      try { detail = (await response.text()).slice(0, 300); } catch (error) { /* ignore */ }
      if (response.status === 401 || response.status === 403) throw new Error("TTS 拒绝了这次请求：老师登录状态或角色无效。");
      if (response.status === 404) throw new Error("没有找到 /api/tts，请先把 api/tts.py 部署到 Vercel。");
      throw new Error(`TTS 生成失败（${response.status}）${detail ? "：" + detail : ""}`);
    }
    const blob = await response.blob();
    if (!blob.size || blob.size < 500) throw new Error("TTS 返回的音频为空。");
    return blob;
  }

  async function uploadAudio(client, path, blob) {
    const bucket = CONFIG.audioBucket || "unit-audio";
    const { error } = await client.storage.from(bucket).upload(path, blob, {
      contentType: "audio/mpeg",
      upsert: true
    });
    if (error) throw new Error(`上传音频失败：${error.message}（检查 Storage 策略）`);
    const { data } = client.storage.from(bucket).getPublicUrl(path);
    if (!data || !data.publicUrl) throw new Error("拿不到音频公开地址。");
    return data.publicUrl;
  }

  function durationOf(url) {
    return new Promise((resolve) => {
      const audio = new Audio();
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        audio.removeAttribute("src");
        resolve(Number.isFinite(value) && value > 0 ? Math.round(value * 100) / 100 : 0);
      };
      const timer = setTimeout(() => finish(0), 7000);
      audio.preload = "metadata";
      audio.addEventListener("loadedmetadata", () => finish(audio.duration), { once: true });
      audio.addEventListener("error", () => finish(0), { once: true });
      audio.src = url;
    });
  }

  async function generateTracks(client, token, unitId, item, total, doneRef) {
    item.audio = item.audio || {};
    item.durations = item.durations || {};
    for (const voice of VOICES) {
      doneRef.done += 1;
      setProgress(doneRef.done, total, `正在生成第 ${doneRef.sentenceIndex + 1} 项 · ${voice.label}…`);
      const blob = await synthesize(item.en, voice.voice, voice.rate, token);
      const path = `${unitId}/${item.id}-${voice.key}.mp3`;
      const url = await uploadAudio(client, path, blob);
      item.audio[voice.key] = url;
      const duration = await durationOf(url);
      item.durations[voice.key] = duration || Math.max(3, Math.round(item.en.split(/\s+/).length / 2.4));
    }
  }

  async function publish() {
    if (busy) return;
    const auth = window.WinnieAuth;
    if (!auth || !auth.client || !auth.isTeacher() || !auth.accessToken) {
      setStatus("老师登录状态已失效，请重新登录。", "err");
      return;
    }
    const title = el("editorTitle").value.trim();
    const lines = parseLines(el("editorText").value);
    const withChallenge = el("editorChallenge").checked;
    if (!title) {
      setStatus("请先填写单元标题。", "err");
      el("editorTitle").focus();
      return;
    }
    if (!lines.length) {
      setStatus("请至少输入一句话。", "err");
      el("editorText").focus();
      return;
    }
    if (lines.length > 20) {
      setStatus("一个单元最多 20 句，请拆成两个单元。", "err");
      return;
    }

    const client = auth.client;
    const token = auth.accessToken;
    const userId = auth.user && auth.user.id;
    if (!userId) {
      setStatus("没有拿到老师账号信息，请重新登录。", "err");
      return;
    }
    const unitsTable = CONFIG.unitsTable || "units";
    const unitId = makeUuid();
    const totalCalls = lines.length * VOICES.length + (withChallenge ? VOICES.length : 0);
    const doneRef = { done: 0, sentenceIndex: 0 };

    setBusy(true);
    setStatus("");
    setProgress(0, totalCalls, "准备生成…");

    try {
      const sentences = [];
      for (let index = 0; index < lines.length; index += 1) {
        doneRef.sentenceIndex = index;
        const line = lines[index];
        const sentence = {
          id: line.id,
          en: line.en,
          zh: line.zh,
          scene: SCENE,
          sceneAlt: "An open storybook with stars",
          maxSeconds: estimateSeconds(line.en, false),
          audio: {},
          durations: {}
        };
        await generateTracks(client, token, unitId, sentence, totalCalls, doneRef);
        sentences.push(sentence);
      }

      let challenge = null;
      if (withChallenge) {
        const challengeText = lines.map((line) => line.en).join(" ");
        const challengeZh = lines.map((line) => line.zh).filter(Boolean).join(" ");
        challenge = {
          id: "challenge",
          en: challengeText,
          zh: challengeZh,
          scene: SCENE,
          sceneAlt: "An open storybook with stars",
          maxSeconds: estimateSeconds(challengeText, true),
          audio: {},
          durations: {}
        };
        doneRef.sentenceIndex = lines.length;
        await generateTracks(client, token, unitId, challenge, totalCalls, doneRef);
      }

      setProgress(totalCalls, totalCalls, "音频完成，正在保存课程…");
      const row = {
        id: unitId,
        title,
        title_zh: title,
        sentences,
        challenge,
        active: false,
        created_by: userId
      };
      const { error: insertError } = await client.from(unitsTable).insert(row);
      if (insertError) {
        throw new Error(`保存课程失败：${insertError.message}。请确认已运行 supabase/schema.sql，并给老师账号设置 app_metadata.role=teacher。`);
      }
      const { error: deactivateError } = await client.from(unitsTable).update({ active: false }).eq("active", true);
      if (deactivateError) throw new Error(`停用旧单元失败：${deactivateError.message}`);
      const { error: activateError } = await client.from(unitsTable).update({ active: true }).eq("id", unitId);
      if (activateError) throw new Error(`激活新单元失败：${activateError.message}`);

      setStatus("已发布！正在刷新学生端…", "ok");
      setTimeout(() => window.location.reload(), 1200);
    } catch (error) {
      console.error("[editor]", error);
      setStatus(error.message || "发布失败，请稍后再试。", "err");
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------------ */
  /* existing unit management                                           */
  /* ------------------------------------------------------------------ */

  function managerStatus(message, tone) {
    const node = el("managerStatus");
    if (!node) return;
    node.textContent = message || "";
    node.hidden = !message;
    node.className = "editor-status" + (tone ? ` is-${tone}` : "");
  }

  function setManagerBusy(next) {
    managerBusy = next;
    const list = el("managerList");
    if (list) list.querySelectorAll("button").forEach((button) => { button.disabled = next; });
    const refresh = el("managerRefresh");
    if (refresh) refresh.disabled = next;
  }

  function managerDate(value) {
    if (!value) return "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("zh-CN");
  }

  function buildManager() {
    if (managerOverlay) return;
    managerOverlay = document.createElement("div");
    managerOverlay.className = "editor-gate";
    managerOverlay.id = "unitManager";
    managerOverlay.hidden = true;
    managerOverlay.innerHTML = `
      <div class="editor-card">
        <header class="editor-head">
          <div>
            <p class="kicker">For teachers</p>
            <h2>课程管理</h2>
          </div>
          <button type="button" class="icon-button icon-button--round" id="managerCloseIcon" aria-label="关闭课程管理">✕</button>
        </header>
        <div class="editor-body">
          <p class="editor-intro">学生端只显示标记为「当前」的单元。历史单元可以切换回来或删除；删除当前单元后，学生刷新页面会看到内置课程。</p>
          <p class="editor-status" id="managerStatus" role="status" hidden></p>
          <div class="manager-list" id="managerList">
            <p class="manager-empty">正在读取课程…</p>
          </div>
        </div>
        <footer class="editor-foot">
          <button type="button" class="btn btn--ghost" id="managerRefresh">刷新列表</button>
          <button type="button" class="btn btn--primary" id="managerClose">关闭</button>
        </footer>
      </div>`;
    document.body.appendChild(managerOverlay);
    el("managerCloseIcon").addEventListener("click", closeManager);
    el("managerClose").addEventListener("click", closeManager);
    el("managerRefresh").addEventListener("click", loadUnits);
    el("managerList").addEventListener("click", handleManagerClick);
    managerOverlay.addEventListener("click", (event) => {
      if (event.target === managerOverlay) closeManager();
    });
  }

  async function openManager() {
    const auth = window.WinnieAuth;
    if (!auth || !auth.client || !auth.isTeacher()) {
      window.alert("课程管理只对老师账号开放。");
      return;
    }
    buildManager();
    if (overlay) overlay.hidden = true;
    managerOverlay.hidden = false;
    syncBodyLock();
    managerStatus("");
    await loadUnits();
  }

  function closeManager() {
    if (managerBusy) return;
    if (managerOverlay) managerOverlay.hidden = true;
    syncBodyLock();
  }

  function renderUnits() {
    const list = el("managerList");
    if (!list) return;
    if (!managerUnits.length) {
      list.innerHTML = `<p class="manager-empty">还没有发布过单元。关闭这里，用「课程编辑」创建第一个单元。</p>`;
      return;
    }
    list.innerHTML = managerUnits.map((unit) => {
      const sentenceCount = Array.isArray(unit.sentences) ? unit.sentences.length : 0;
      const challenge = unit.challenge && unit.challenge.en ? " + 整段" : "";
      const active = !!unit.active;
      return `<div class="manager-row ${active ? "is-active" : ""}">
        <div class="manager-info">
          <strong>${esc(unit.title || "未命名单元")}</strong>
          <span class="manager-meta">${sentenceCount} 句${challenge} · ${esc(managerDate(unit.created_at))}</span>
          <span class="manager-id">${esc(unit.id)}</span>
        </div>
        <span class="manager-badge ${active ? "is-active" : ""}">${active ? "当前" : "历史"}</span>
        <div class="manager-actions">
          ${active ? "" : `<button type="button" class="btn btn--soft btn--sm" data-manager-action="activate" data-id="${esc(unit.id)}">设为当前</button>`}
          <button type="button" class="btn btn--ghost btn--sm" data-manager-action="delete" data-id="${esc(unit.id)}">删除</button>
        </div>
      </div>`;
    }).join("");
  }

  async function loadUnits() {
    const auth = window.WinnieAuth;
    if (!auth || !auth.client) {
      managerStatus("登录状态已失效，请重新登录。", "err");
      return;
    }
    const unitsTable = CONFIG.unitsTable || "units";
    setManagerBusy(true);
    managerStatus("");
    const list = el("managerList");
    if (list) list.innerHTML = `<p class="manager-empty">正在读取课程…</p>`;
    try {
      const { data, error } = await auth.client
        .from(unitsTable)
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      managerUnits = Array.isArray(data) ? data : [];
      renderUnits();
    } catch (error) {
      console.warn("[manager]", error);
      managerStatus(`读取课程失败：${error.message}。请确认 units 表和教师 RLS 已创建。`, "err");
      if (list) list.innerHTML = `<p class="manager-empty">暂时读不到课程列表。</p>`;
    } finally {
      setManagerBusy(false);
    }
  }

  async function activateUnit(id) {
    if (managerBusy) return;
    const unit = managerUnits.find((item) => item.id === id);
    if (!unit) return;
    if (!window.confirm(`把「${unit.title || "未命名单元"}」设为当前单元？学生刷新后会看到它。`)) return;
    const auth = window.WinnieAuth;
    if (!auth || !auth.client) return;
    const unitsTable = CONFIG.unitsTable || "units";
    managerBusy = true;
    setManagerBusy(true);
    try {
      const { error: deactivateError } = await auth.client.from(unitsTable).update({ active: false }).eq("active", true);
      if (deactivateError) throw deactivateError;
      const { error: activateError } = await auth.client.from(unitsTable).update({ active: true }).eq("id", id);
      if (activateError) throw activateError;
      await loadUnits();
      managerStatus("已设为当前单元。学生刷新页面后生效。", "ok");
    } catch (error) {
      managerStatus(`切换失败：${error.message}`, "err");
    } finally {
      managerBusy = false;
      setManagerBusy(false);
    }
  }

  async function deleteUnit(id) {
    if (managerBusy) return;
    const unit = managerUnits.find((item) => item.id === id);
    if (!unit) return;
    const activeWarning = unit.active ? "\n这是当前单元；删除后学生刷新页面会回退到内置课程。" : "";
    if (!window.confirm(`删除「${unit.title || "未命名单元"}」及其音频？此操作不能撤销。${activeWarning}`)) return;
    const auth = window.WinnieAuth;
    if (!auth || !auth.client) return;
    const unitsTable = CONFIG.unitsTable || "units";
    const bucket = CONFIG.audioBucket || "unit-audio";
    managerBusy = true;
    setManagerBusy(true);
    let audioWarning = "";
    try {
      const { error: deleteError } = await auth.client.from(unitsTable).delete().eq("id", id);
      if (deleteError) throw deleteError;
      try {
        const { data: files, error: listError } = await auth.client.storage.from(bucket).list(id);
        if (listError) throw listError;
        if (Array.isArray(files) && files.length) {
          const paths = files.map((file) => `${id}/${file.name}`);
          const { error: removeError } = await auth.client.storage.from(bucket).remove(paths);
          if (removeError) throw removeError;
        }
      } catch (error) {
        audioWarning = ` 单元已删除，但音频清理失败：${error.message}`;
      }
      await loadUnits();
      managerStatus(`已删除「${unit.title || "未命名单元"}」。${audioWarning}`, audioWarning ? "err" : "ok");
    } catch (error) {
      managerStatus(`删除失败：${error.message}`, "err");
    } finally {
      managerBusy = false;
      setManagerBusy(false);
    }
  }

  function handleManagerClick(event) {
    const button = event.target.closest("[data-manager-action]");
    if (!button || managerBusy) return;
    const id = button.dataset.id;
    if (button.dataset.managerAction === "activate") activateUnit(id);
    else if (button.dataset.managerAction === "delete") deleteUnit(id);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (managerOverlay && !managerOverlay.hidden) closeManager();
    else if (overlay && !overlay.hidden) close();
  });

  window.addEventListener("winnie:open-editor", open);
  window.addEventListener("winnie:manage-units", openManager);
  window.WinnieEditor = { open, openManager };
})();
