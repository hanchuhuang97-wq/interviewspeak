/* Supabase email/password gate. Auth only: practice recordings stay local. */
(function () {
  "use strict";

  const AUTH = window.WINNIE_AUTH;
  const gate = document.getElementById("authGate");
  if (!gate) return;

  const loading = document.getElementById("authLoading");
  const configProblem = document.getElementById("authConfigProblem");
  const configReason = document.getElementById("authConfigReason");
  const panel = document.getElementById("authPanel");
  const title = document.getElementById("authTitle");
  const subtitle = document.getElementById("authSub");
  const loginForm = document.getElementById("authLoginForm");
  const signupForm = document.getElementById("authSignupForm");
  const loginUsername = document.getElementById("authUsername");
  const loginPassword = document.getElementById("authPassword");
  const signupUsername = document.getElementById("authSignupUsername");
  const signupPassword = document.getElementById("authSignupPassword");
  const signupConfirm = document.getElementById("authSignupConfirm");
  const loginButton = document.getElementById("authLoginButton");
  const signupButton = document.getElementById("authSignupButton");
  const loginStatus = document.getElementById("authLoginStatus");
  const signupStatus = document.getElementById("authSignupStatus");
  const toggleModeButton = document.getElementById("authToggleMode");
  const switchText = document.getElementById("authSwitchText");
  const authSwitch = document.getElementById("authSwitch");
  const accountChip = document.getElementById("accountChip");
  const accountEmail = document.getElementById("accountEmail");
  const accountSetting = document.getElementById("accountSetting");
  const settingsAccountEmail = document.getElementById("settingsAccountEmail");
  const logoutButton = document.getElementById("logoutButton");
  const openEditorButton = document.getElementById("openEditorButton");
  const manageUnitsButton = document.getElementById("manageUnitsButton");
  const app = document.getElementById("app");
  const topbar = document.querySelector(".topbar");
  const footer = document.querySelector(".footer");

  const state = {
    client: null,
    session: null,
    mode: "login",
    busy: false
  };

  function isTeacherRole(user) {
    return !!(user && user.app_metadata && user.app_metadata.role === "teacher");
  }

  window.WinnieAuth = {
    get client() { return state.client; },
    get session() { return state.session; },
    get user() { return state.session ? state.session.user : null; },
    get accessToken() { return state.session ? state.session.access_token || "" : ""; },
    isTeacher() { return isTeacherRole(state.session && state.session.user); }
  };

  function setInert(locked) {
    [app, topbar, footer].forEach((el) => {
      if (el) el.inert = locked;
    });
    document.body.classList.toggle("auth-locked", locked);
  }

  function hideAccount() {
    if (accountChip) accountChip.hidden = true;
    if (accountSetting) accountSetting.hidden = true;
    if (openEditorButton) openEditorButton.hidden = true;
    if (manageUnitsButton) manageUnitsButton.hidden = true;
    if (accountEmail) accountEmail.textContent = "";
    if (settingsAccountEmail) settingsAccountEmail.textContent = "—";
  }

  function showAccount(email) {
    const label = email || "已登录";
    if (accountChip) {
      accountChip.hidden = false;
      accountChip.title = label;
    }
    if (accountEmail) accountEmail.textContent = label;
    if (accountSetting) accountSetting.hidden = false;
    if (settingsAccountEmail) settingsAccountEmail.textContent = label;
    if (openEditorButton) openEditorButton.hidden = !isTeacherRole(state.session && state.session.user);
    if (manageUnitsButton) manageUnitsButton.hidden = !isTeacherRole(state.session && state.session.user);
  }

  function setStatus(el, message, tone) {
    if (!el) return;
    el.textContent = message || "";
    el.hidden = !message;
    el.className = "auth-status" + (tone ? ` is-${tone}` : "");
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? "请稍候…" : label;
  }

  function validEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
  }

  function validUsername(value) {
    const text = String(value || "").trim();
    if (!text) return false;
    if (text.includes("@")) return validEmail(text);
    return /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,31}$/.test(text);
  }

  function usernameDomain() {
    const configured = String((AUTH && AUTH.usernameDomain) || "").trim().toLowerCase();
    return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(configured)
      ? configured
      : "students.winnie-garden.app";
  }

  // Supabase signs users in by email; the username is mapped to a private,
  // non-deliverable address and displayed back as a username.
  function identifierFor(value) {
    const text = String(value || "").trim().toLowerCase();
    return text.includes("@") ? text : `${text}@${usernameDomain()}`;
  }

  function displayNameFor(user) {
    const metadata = user && user.user_metadata;
    if (metadata && metadata.username) return String(metadata.username);
    const identifier = user && user.email ? user.email : "";
    return identifier.includes("@") ? identifier.split("@")[0] : (identifier || "已登录");
  }

  function isConfigured() {
    const url = String((AUTH && AUTH.supabaseUrl) || "").trim();
    const key = String((AUTH && AUTH.supabaseAnonKey) || "").trim();
    if (!/^https?:\/\//i.test(url) || key.length < 20) return false;
    if (/your[-_ ]?project|replace|example\.supabase/i.test(url)) return false;
    if (/your[-_ ]?anon|replace/i.test(key)) return false;
    return true;
  }

  function mapAuthError(error) {
    const raw = String((error && error.message) || error || "");
    const text = raw.toLowerCase();
    if (text.includes("invalid login credentials")) return "用户名或密码不正确，请再试一次。";
    if (text.includes("email not confirmed")) return "这个账号还没有确认，请联系老师。";
    if (text.includes("user already registered") || text.includes("already registered")) return "这个用户名已经存在，请直接登录或换一个。";
    if (text.includes("signups not allowed") || text.includes("signup") && text.includes("disabled")) return "老师暂时关闭了新账号注册，请使用已有账号或联系老师。";
    if (text.includes("password should be at least") || text.includes("password") && text.includes("6")) return "密码至少需要 6 位。";
    if (text.includes("rate limit") || text.includes("too many requests") || text.includes("only request this after")) return "尝试次数有点多，请等一会儿再试。";
    if (text.includes("failed to fetch") || text.includes("network") || text.includes("load failed")) return "连不上登录服务，请检查网络后再试。";
    if (text.includes("unable to validate email")) return "用户名格式不正确，请检查一下。";
    return "操作没有成功，请稍后再试。";
  }

  function showLoading() {
    if (loading) loading.hidden = false;
    if (configProblem) configProblem.hidden = true;
    if (panel) panel.hidden = true;
  }

  function showConfigProblem(reason) {
    if (loading) loading.hidden = true;
    if (panel) panel.hidden = true;
    if (configProblem) configProblem.hidden = false;
    if (configReason) {
      configReason.textContent = reason || "";
      configReason.hidden = !reason;
    }
  }

  function setMode(mode) {
    state.mode = mode === "signup" && AUTH.allowSignUp !== false ? "signup" : "login";
    const signup = state.mode === "signup";
    if (loginForm) loginForm.hidden = signup;
    if (signupForm) signupForm.hidden = !signup;
    if (title) title.textContent = signup ? "创建家长账号" : "家长 / 老师登录";
    if (subtitle) {
      subtitle.textContent = signup
        ? "由老师统一分配用户名最方便；也可以在这里创建一个。"
        : "用老师设置的用户名登录。账号只用于门禁，录音仍然保存在本机。";
    }
    if (switchText) switchText.textContent = signup ? "已经有账号？" : "还没有账号？";
    if (toggleModeButton) toggleModeButton.textContent = signup ? "返回登录" : "创建家长账号";
    setStatus(loginStatus, "");
    setStatus(signupStatus, "");
    const focusTarget = signup ? signupUsername : loginUsername;
    if (focusTarget) setTimeout(() => focusTarget.focus(), 30);
  }

  function showAuthPanel() {
    if (loading) loading.hidden = true;
    if (configProblem) configProblem.hidden = true;
    if (panel) panel.hidden = false;
    setMode("login");
  }

  function unlock(session) {
    state.session = session || null;
    const username = session && session.user ? displayNameFor(session.user) : "";
    if (accountChip) accountChip.hidden = !username;
    showAccount(username);
    gate.hidden = true;
    setInert(false);
    if (gate.contains(document.activeElement)) document.activeElement.blur();
    window.dispatchEvent(new CustomEvent("winnie:unlock", { detail: { username } }));
  }

  function lock(message) {
    state.session = null;
    setInert(true);
    gate.hidden = false;
    showAuthPanel();
    hideAccount();
    if (message) setStatus(loginStatus, message, "is-err");
    window.dispatchEvent(new CustomEvent("winnie:lock"));
  }

  function bindUiOnce() {
    if (AUTH.allowSignUp === false && authSwitch) authSwitch.hidden = true;

    if (toggleModeButton) {
      toggleModeButton.addEventListener("click", () => {
        if (AUTH.allowSignUp === false) return;
        setMode(state.mode === "signup" ? "login" : "signup");
      });
    }

    document.querySelectorAll("[data-password-toggle]").forEach((button) => {
      button.addEventListener("click", () => {
        const input = document.getElementById(button.dataset.passwordToggle);
        if (!input) return;
        const showing = input.type === "text";
        input.type = showing ? "password" : "text";
        button.textContent = showing ? "显示" : "隐藏";
      });
    });

    if (loginForm) {
      loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (state.busy) return;
        const username = loginUsername.value.trim();
        const password = loginPassword.value;
        setStatus(loginStatus, "");
        if (!validUsername(username)) {
          setStatus(loginStatus, "请输入用户名（或完整邮箱）。", "is-err");
          loginUsername.focus();
          return;
        }
        if (!password) {
          setStatus(loginStatus, "请输入密码。", "is-err");
          loginPassword.focus();
          return;
        }
        if (!state.client) {
          setStatus(loginStatus, "登录服务还没有准备好，请刷新页面。", "is-err");
          return;
        }
        state.busy = true;
        setBusy(loginButton, true, "登录");
        try {
          const { data, error } = await state.client.auth.signInWithPassword({ email: identifierFor(username), password });
          if (error) {
            setStatus(loginStatus, mapAuthError(error), "is-err");
            return;
          }
          if (data && data.session) unlock(data.session);
          else setStatus(loginStatus, "登录成功，但没有取得登录状态，请刷新页面再试。", "is-err");
        } catch (error) {
          console.warn("[auth] sign-in failed", error);
          setStatus(loginStatus, mapAuthError(error), "is-err");
        } finally {
          state.busy = false;
          setBusy(loginButton, false, "登录");
        }
      });
    }

    if (signupForm) {
      signupForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        if (state.busy) return;
        const username = signupUsername.value.trim();
        const password = signupPassword.value;
        const confirm = signupConfirm.value;
        setStatus(signupStatus, "");
        if (!validUsername(username)) {
          setStatus(signupStatus, "用户名需要 2–32 位字母、数字、点、下划线或短横线。", "is-err");
          signupUsername.focus();
          return;
        }
        if (password.length < 6) {
          setStatus(signupStatus, "密码至少需要 6 位。", "is-err");
          signupPassword.focus();
          return;
        }
        if (password !== confirm) {
          setStatus(signupStatus, "两次输入的密码不一样，请再检查一下。", "is-err");
          signupConfirm.focus();
          return;
        }
        if (!state.client) {
          setStatus(signupStatus, "登录服务还没有准备好，请刷新页面。", "is-err");
          return;
        }
        state.busy = true;
        setBusy(signupButton, true, "创建账号");
        try {
          const { data, error } = await state.client.auth.signUp({
            email: identifierFor(username),
            password,
            options: { data: { username } }
          });
          if (error) {
            setStatus(signupStatus, mapAuthError(error), "is-err");
            return;
          }
          if (data && data.session) {
            unlock(data.session);
            return;
          }
          setStatus(signupStatus, "账号已创建，但 Supabase 仍要求邮箱确认。请让管理员在 Supabase 关闭 Confirm email，或在后台手动确认这个账号。", "is-err");
        } catch (error) {
          console.warn("[auth] sign-up failed", error);
          setStatus(signupStatus, mapAuthError(error), "is-err");
        } finally {
          state.busy = false;
          setBusy(signupButton, false, "创建账号");
        }
      });
    }

    if (openEditorButton) {
      openEditorButton.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("winnie:open-editor"));
      });
    }

    if (manageUnitsButton) {
      manageUnitsButton.addEventListener("click", () => {
        window.dispatchEvent(new CustomEvent("winnie:manage-units"));
      });
    }

    if (logoutButton) {
      logoutButton.addEventListener("click", async () => {
        if (!state.client) return;
        if (!window.confirm("退出登录后需要重新输入用户名和密码，确定吗？")) return;
        logoutButton.disabled = true;
        try {
          await state.client.auth.signOut({ scope: "local" });
        } catch (error) {
          console.warn("[auth] sign-out failed", error);
        }
        window.location.reload();
      });
    }
  }

  async function initialize() {
    try {
      const { data, error } = await state.client.auth.getSession();
      if (error) {
        console.warn("[auth] getSession failed", error);
        showAuthPanel();
        setStatus(loginStatus, "读取登录状态失败，请检查网络后重新登录。", "is-err");
      } else if (data && data.session) {
        unlock(data.session);
      } else {
        showAuthPanel();
      }
    } catch (error) {
      console.warn("[auth] getSession threw", error);
      showAuthPanel();
      setStatus(loginStatus, "连不上登录服务，请检查网络后再试。", "is-err");
    }

    state.client.auth.onAuthStateChange((event, session) => {
      if (session) unlock(session);
      else if (event === "SIGNED_OUT") lock();
    });
  }

  if (!AUTH || AUTH.enabled === false) {
    gate.hidden = true;
    setInert(false);
    hideAccount();
    return;
  }

  setInert(true);
  bindUiOnce();

  if (!isConfigured()) {
    showConfigProblem();
    return;
  }
  if (!window.supabase || typeof window.supabase.createClient !== "function") {
    showConfigProblem("Supabase 客户端脚本没有加载成功，请检查 assets/vendor/supabase.js。");
    return;
  }

  try {
    state.client = window.supabase.createClient(
      String(AUTH.supabaseUrl).trim().replace(/\/+$/, ""),
      String(AUTH.supabaseAnonKey).trim(),
      {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      }
    );
  } catch (error) {
    console.warn("[auth] createClient failed", error);
    showConfigProblem("Supabase 配置无法初始化，请检查 URL 和 anon key。");
    return;
  }

  initialize();
})();
