import { isStrongPassword } from "./password.js";
import { DEFAULT_BALANCE, BALANCE_STORAGE_KEY } from "./constants.js";

const STORAGE_TOKEN = "casino-token";
const STORAGE_GUEST_TOKEN = "casino-guest-token";
const STORAGE_USER = "casino-user";
const STORAGE_API = "casino-api-base";

const getApiBase = () => {
  const fromStorage = localStorage.getItem(STORAGE_API);
  const fromWindow = window.API_BASE || "";
  const base = (fromStorage || fromWindow || "").trim();
  return base ? base.replace(/\/+$/, "") : "";
};

const request = async (path, options = {}, tokenOverride = "") => {
  const base = getApiBase();
  const url = base ? `${base}${path}` : path;
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  const token = tokenOverride || auth.apiToken || auth.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "Request failed.");
  }
  return res.json();
};

const updateBankUi = (balance) => {
  const balanceEl = document.getElementById("balance");
  if (balanceEl) balanceEl.textContent = `$${balance}`;
};

const showBalanceDelta = (amount) => {
  const deltaEl = document.getElementById("balanceDelta");
  if (!deltaEl || !Number.isFinite(amount) || amount === 0) return;
  deltaEl.textContent = amount > 0 ? `+${amount}` : `${amount}`;
  deltaEl.classList.remove("positive", "negative", "show");
  deltaEl.classList.add(amount > 0 ? "positive" : "negative");
  void deltaEl.offsetWidth;
  deltaEl.classList.add("show");
  setTimeout(() => deltaEl.classList.remove("show"), 1200);
};

export const auth = {
  token: localStorage.getItem(STORAGE_TOKEN) || "",
  guestToken: localStorage.getItem(STORAGE_GUEST_TOKEN) || "",
  apiToken: localStorage.getItem(STORAGE_TOKEN) || localStorage.getItem(STORAGE_GUEST_TOKEN) || "",
  user: localStorage.getItem(STORAGE_USER) || "",
  balanceSync: null,
  onBalanceUpdate: null,
  getBalance: null,
  initialized: false,
  ui: {},

  isAuthed() {
    return Boolean(this.token);
  },

  setSession(token, user) {
    this.token = token || "";
    this.apiToken = this.token || this.guestToken || "";
    this.user = user || "";
    if (token) localStorage.setItem(STORAGE_TOKEN, token);
    else localStorage.removeItem(STORAGE_TOKEN);
    if (user) localStorage.setItem(STORAGE_USER, user);
    else localStorage.removeItem(STORAGE_USER);
    this.updateUi();
  },

  setGuestToken(token) {
    this.guestToken = token || "";
    if (token) localStorage.setItem(STORAGE_GUEST_TOKEN, token);
    else localStorage.removeItem(STORAGE_GUEST_TOKEN);
    if (!this.token) this.apiToken = this.guestToken || "";
  },

  async login(username, password) {
    const payload = await request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    this.setSession(payload.token, payload.user.username);
    localStorage.setItem(BALANCE_STORAGE_KEY, String(payload.user.balance));
    if (this.onBalanceUpdate) this.onBalanceUpdate(payload.user.balance);
    updateBankUi(payload.user.balance);
    return payload.user;
  },

  async register(username, password) {
    const payload = await request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    });
    this.setSession(payload.token, payload.user.username);
    localStorage.setItem(BALANCE_STORAGE_KEY, String(payload.user.balance));
    if (this.onBalanceUpdate) this.onBalanceUpdate(payload.user.balance);
    updateBankUi(payload.user.balance);
    return payload.user;
  },

  async logout() {
    this.setSession("", "");
    this.apiToken = this.guestToken || "";
    localStorage.setItem(BALANCE_STORAGE_KEY, String(DEFAULT_BALANCE));
    if (this.onBalanceUpdate) this.onBalanceUpdate(DEFAULT_BALANCE);
    updateBankUi(DEFAULT_BALANCE);
    if (window.location.pathname.endsWith("account.html")) {
      window.location.reload();
    }
    await this.ensureGuestSession();
  },

  async ensureGuestSession() {
    if (this.isAuthed()) return;
    if (this.guestToken) {
      try {
        await request("/api/me", {}, this.guestToken);
        this.apiToken = this.guestToken;
        return;
      } catch (err) {
        this.setGuestToken("");
      }
    }
    const payload = await request("/api/auth/guest", { method: "POST" });
    this.setGuestToken(payload.token);
    localStorage.setItem(BALANCE_STORAGE_KEY, String(payload.user.balance));
    if (this.onBalanceUpdate) this.onBalanceUpdate(payload.user.balance);
    updateBankUi(payload.user.balance);
  },

  async fetchMe() {
    if (!this.isAuthed()) return null;
    const payload = await request("/api/me");
    if (this.onBalanceUpdate) this.onBalanceUpdate(payload.user.balance);
    return payload.user;
  },

  async updateBalance() {
    if (!this.isAuthed()) return;
    if (!this.getBalance) return;
    const balance = this.getBalance();
    await request("/api/balance", {
      method: "POST",
      body: JSON.stringify({ balance }),
    });
  },

  queueBalanceUpdate() {
    if (!this.isAuthed()) return;
    if (this.balanceSync) return;
    this.balanceSync = setTimeout(async () => {
      this.balanceSync = null;
      try {
        await this.updateBalance();
      } catch (err) {
        // silent
      }
    }, 500);
  },

  async recordResult({ game, bet, net, result }) {
    if (!this.isAuthed()) return;
    await request("/api/stats/record", {
      method: "POST",
      body: JSON.stringify({ game, bet, net, result }),
    });
  },

  request(path, options = {}) {
    return request(path, options, this.apiToken);
  },

  cacheUi() {
    this.ui = {
      signInBtn: document.getElementById("signInBtn"),
      signOutBtn: document.getElementById("signOutBtn"),
      freeCreditsBtn: document.getElementById("freeCreditsBtn"),
      accountLink: document.getElementById("accountLink"),
      modal: document.getElementById("authModal"),
      backdrop: document.getElementById("authBackdrop"),
      form: document.getElementById("authForm"),
      title: document.getElementById("authTitle"),
      username: document.getElementById("authUsername"),
      password: document.getElementById("authPassword"),
      togglePassword: document.getElementById("authTogglePassword"),
      toggle: document.getElementById("authToggle"),
      message: document.getElementById("authMessage"),
    };
  },

  updateUi() {
    const { signInBtn, signOutBtn, freeCreditsBtn, accountLink } = this.ui;
    const authed = this.isAuthed();
    if (signInBtn) signInBtn.classList.toggle("hidden", authed);
    if (signOutBtn) signOutBtn.classList.toggle("hidden", !authed);
    if (freeCreditsBtn) freeCreditsBtn.classList.toggle("hidden", !authed);
    if (accountLink) accountLink.classList.toggle("hidden", !authed);
  },

  openModal(mode = "login") {
    const { modal, backdrop, title, toggle, message, username, password } = this.ui;
    if (!modal || !backdrop) return;
    modal.classList.remove("hidden");
    backdrop.classList.remove("hidden");
    if (message) message.textContent = "";
    if (title) title.textContent = mode === "login" ? "Sign In" : "Create Account";
    if (toggle) toggle.textContent = mode === "login" ? "Create account" : "Have an account?";
    modal.dataset.mode = mode;
    username?.focus();
    if (password) password.value = "";
  },

  closeModal() {
    const { modal, backdrop } = this.ui;
    if (!modal || !backdrop) return;
    modal.classList.add("hidden");
    backdrop.classList.add("hidden");
  },

  bindEvents() {
    const {
      signInBtn,
      signOutBtn,
      freeCreditsBtn,
      accountLink,
      backdrop,
      form,
      toggle,
      togglePassword,
      modal,
      message,
    } = this.ui;
      this.ui;
    signInBtn?.addEventListener("click", () => this.openModal("login"));
    signOutBtn?.addEventListener("click", () => this.logout());
    freeCreditsBtn?.addEventListener("click", async () => {
      if (!this.isAuthed()) return;
      const stored = Number(localStorage.getItem(BALANCE_STORAGE_KEY));
      const current =
        (this.getBalance && Number(this.getBalance())) ||
        (Number.isFinite(stored) ? stored : DEFAULT_BALANCE);
      const next = current + 100;
      localStorage.setItem(BALANCE_STORAGE_KEY, String(next));
      if (this.onBalanceUpdate) this.onBalanceUpdate(next);
      updateBankUi(next);
      showBalanceDelta(100);
      try {
        await request("/api/balance", {
          method: "POST",
          body: JSON.stringify({ balance: next }),
        });
      } catch (err) {
        // ignore
      }
    });
    accountLink?.addEventListener("click", (event) => {
      event.preventDefault();
      window.location.href = "account.html";
    });
    backdrop?.addEventListener("click", () => this.closeModal());
    toggle?.addEventListener("click", () => {
      if (!modal) return;
      const mode = modal.dataset.mode === "login" ? "register" : "login";
      this.openModal(mode);
    });
    togglePassword?.addEventListener("click", () => {
      const input = this.ui.password;
      if (!input) return;
      const next = input.type === "password" ? "text" : "password";
      input.type = next;
      togglePassword.textContent = next === "password" ? "Show" : "Hide";
    });
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!modal) return;
      const mode = modal.dataset.mode || "login";
      const username = this.ui.username?.value.trim();
      const password = this.ui.password?.value;
      if (!username || !password) {
        if (message) message.textContent = "Enter a username and password.";
        return;
      }
      if (mode === "register") {
        if (!isStrongPassword(password)) {
          if (message) {
            message.textContent =
              "Password must be 8+ chars with upper, lower, number, and symbol.";
          }
          return;
        }
      }
      try {
        if (mode === "login") await this.login(username, password);
        else await this.register(username, password);
        this.closeModal();
        if (window.location.pathname.endsWith("account.html")) {
          window.location.reload();
        }
      } catch (err) {
        if (message) message.textContent = err.message || "Unable to sign in.";
      }
    });
  },

  async init({ onBalanceUpdate, getBalance } = {}) {
    this.onBalanceUpdate = onBalanceUpdate;
    this.getBalance = getBalance;
    if (!this.initialized) {
      this.cacheUi();
      this.bindEvents();
      this.initialized = true;
    }
    this.updateUi();
    if (this.isAuthed()) {
      try {
        await this.fetchMe();
      } catch (err) {
        this.setSession("", "");
      }
    } else {
      try {
        await this.ensureGuestSession();
      } catch (err) {
        // ignore
      }
    }
  },
};
