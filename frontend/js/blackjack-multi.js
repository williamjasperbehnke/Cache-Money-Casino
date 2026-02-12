import {
  state as coreState,
  updateBalance,
  renderCards,
  handTotal,
  showCenterToast,
  showCenterToasts,
  playSfx,
} from "./core.js";
import { auth } from "./auth.js";

const BET_SYNC_DEBOUNCE_MS = 90;

const getWsBase = () => {
  const fromStorage = localStorage.getItem("casino-ws-base");
  const fromWindow = window.WS_BASE || "";
  const base = (fromStorage || fromWindow || "").trim();
  if (base) {
    const cleaned = base.replace(/\/+$/, "");
    return cleaned;
  }
  return "";
};

export class BlackjackMultiGame {
  constructor() {
    this.ui = {};
    this.socket = null;
    this.roomId = "";
    this.playerId = "";
    this.state = null;
    this.lastInRound = false;
    this.prevMe = null;
    this.sawBustThisRound = false;
    this.authReadyPromise = null;
    this.rooms = [];
    this.localBetDraft = null;
    this.betCommitTimer = null;
    this.connectionReady = false;
    this.roundClearTimer = null;
  }

  cacheElements() {
    this.ui = {
      lobby: document.getElementById("bjMultiLobby"),
      room: document.getElementById("bjMultiRoom"),
      roomId: document.getElementById("bjMultiRoomId"),
      roomName: document.getElementById("bjMultiRoomName"),
      roomPublic: document.getElementById("bjMultiPublic"),
      searchId: document.getElementById("bjMultiSearchId"),
      createBtn: document.getElementById("bjMultiCreate"),
      refreshBtn: document.getElementById("bjMultiRefresh"),
      rooms: document.getElementById("bjMultiRooms"),
      invite: document.getElementById("bjMultiInvite"),
      copyInvite: document.getElementById("bjMultiCopy"),
      leaveBtn: document.getElementById("bjMultiLeave"),
      dealer: document.getElementById("bjMultiDealer"),
      dealerTotal: document.getElementById("bjMultiDealerTotal"),
      players: document.getElementById("bjMultiPlayers"),
      startBtn: document.getElementById("bjMultiStart"),
      hitBtn: document.getElementById("bjMultiHit"),
      standBtn: document.getElementById("bjMultiStand"),
      doubleBtn: document.getElementById("bjMultiDouble"),
      splitBtn: document.getElementById("bjMultiSplit"),
      betAmount: document.getElementById("bjMultiBetAmount"),
      betButtons: document.querySelectorAll("#blackjack-multi .bjmulti-bet-buttons .chip"),
      betClear: document.getElementById("bjMultiBetClear"),
      status: document.getElementById("bjMultiStatus"),
      connecting: document.getElementById("bjMultiConnecting"),
    };
  }

  init() {
    this.cacheElements();
    this.bindControls();
    window.addEventListener("beforeunload", () => this.closeSocket(false));
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room");
    if (room) {
      this.ui.lobby?.classList.add("hidden");
      this.ui.room?.classList.add("hidden");
    }
    void this.bootstrap(room);
  }

  async bootstrap(preferredRoom = "") {
    await this.ensureAuthReady();
    if (preferredRoom) {
      await this.joinRoom(preferredRoom);
      if (this.roomId) {
        void this.loadLobby();
        return;
      }
      this.showLobby();
    }
    await this.loadLobby();
  }

  async ensureAuthReady() {
    if (auth.apiToken || auth.token || auth.guestToken) return;
    if (!this.authReadyPromise) {
      this.authReadyPromise = auth.ensureGuestSession().finally(() => {
        this.authReadyPromise = null;
      });
    }
    await this.authReadyPromise;
  }

  bindControls() {
    this.ui.createBtn?.addEventListener("click", () => this.createRoom());
    this.ui.refreshBtn?.addEventListener("click", () => this.loadLobby());
    this.ui.searchId?.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        this.searchAndMaybeJoin();
      }
    });
    this.ui.searchId?.addEventListener("input", () => this.searchRooms());
    this.ui.leaveBtn?.addEventListener("click", () => this.leaveRoom());
    this.ui.copyInvite?.addEventListener("click", () => this.copyInvite());
    this.ui.startBtn?.addEventListener("click", () => this.sendAction("START"));
    this.ui.hitBtn?.addEventListener("click", () => this.sendAction("HIT"));
    this.ui.standBtn?.addEventListener("click", () => this.sendAction("STAND"));
    this.ui.doubleBtn?.addEventListener("click", () => this.sendAction("DOUBLE"));
    this.ui.splitBtn?.addEventListener("click", () => this.sendAction("SPLIT"));
    this.ui.betButtons?.forEach((btn) => {
      const amount = Number(btn.dataset.amount) || 0;
      btn.addEventListener("click", () => {
        this.adjustLocalBet(amount);
        playSfx("hit");
      });
      btn.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.adjustLocalBet(-amount);
        playSfx("hit");
      });
    });
    this.ui.betClear?.addEventListener("click", () => {
      this.setLocalBet(0);
    });
  }

  async loadLobby() {
    try {
      await this.ensureAuthReady();
      const payload = await auth.request("/api/games/blackjack-multi/rooms", { method: "GET" });
      this.rooms = Array.isArray(payload.rooms) ? payload.rooms : [];
      this.searchRooms();
    } catch (err) {
      console.error("Failed to load multiplayer rooms", err);
      showCenterToast("Unable to load rooms.", "danger");
    }
  }

  searchRooms() {
    const query = (this.ui.searchId?.value || "").trim().toLowerCase();
    if (!query) {
      this.renderRoomList(this.rooms);
      return;
    }
    const filtered = this.rooms.filter((room) =>
      String(room.roomId || "")
        .toLowerCase()
        .includes(query) ||
      String(room.name || "")
        .toLowerCase()
        .includes(query)
    );
    this.renderRoomList(filtered, query);
  }

  async searchAndMaybeJoin() {
    const query = (this.ui.searchId?.value || "").trim().toLowerCase();
    if (!query) {
      this.renderRoomList(this.rooms);
      return;
    }
    const filtered = this.rooms.filter((room) =>
      String(room.roomId || "")
        .toLowerCase()
        .includes(query) ||
      String(room.name || "")
        .toLowerCase()
        .includes(query)
    );
    if (filtered.length > 0) {
      this.renderRoomList(filtered, query);
      return;
    }
    this.renderRoomList([], query);
  }

  renderRoomList(rooms, query = "") {
    if (!this.ui.rooms) return;
    this.ui.rooms.innerHTML = "";
    if (!rooms.length) {
      const empty = document.createElement("div");
      empty.className = "bjmulti-empty";
      empty.textContent = query
        ? `No tables found for ID: ${query}`
        : "No public tables yet.";
      this.ui.rooms.appendChild(empty);
      return;
    }
    rooms.forEach((room) => {
      const card = document.createElement("div");
      card.className = "bjmulti-room-card";
      const meta = document.createElement("div");
      meta.className = "bjmulti-room-meta";
      const roomName = String(room.name || "").trim() || "Blackjack Table";
      meta.innerHTML = `
        <div class="title">${roomName}</div>
        <div class="details">
          <span class="bjmulti-id-tag">ID</span> ${room.roomId}
          <span class="bjmulti-host-tag">HOST</span> ${room.host}
          <span class="bjmulti-count-tag">${room.playerCount}/${room.maxPlayers}</span>
        </div>
      `;
      const btn = document.createElement("button");
      btn.className = "btn ghost";
      btn.textContent = "Join";
      btn.addEventListener("click", () => this.joinRoom(room.roomId));
      card.appendChild(meta);
      card.appendChild(btn);
      this.ui.rooms.appendChild(card);
    });
  }

  async createRoom() {
    const name = this.ui.roomName?.value?.trim() || "Blackjack Table";
    const isPublic = Boolean(this.ui.roomPublic?.checked);
    try {
      await this.ensureAuthReady();
      const payload = await auth.request("/api/games/blackjack-multi/rooms", {
        method: "POST",
        body: JSON.stringify({ name, public: isPublic }),
      });
      if (payload.roomId) {
        await this.joinRoom(payload.roomId);
      }
    } catch (err) {
      console.error("Failed to create multiplayer room", err);
      showCenterToast("Unable to create room.", "danger");
    }
  }

  async joinRoom(roomId) {
    try {
      await this.ensureAuthReady();
      const payload = await auth.request(`/api/games/blackjack-multi/rooms/${roomId}/join`, {
        method: "POST",
      });
      this.roomId = roomId;
      this.syncRoomQuery(roomId);
      this.playerId = payload.playerId || this.playerId;
      this.setConnectionReady(false);
      this.applyState(payload.state);
      this.connectSocket();
      this.showRoom();
      this.setInviteLink(roomId);
    } catch (err) {
      console.error("Failed to join multiplayer room", { roomId, err });
      showCenterToast("Unable to join room.", "danger");
    }
  }

  async leaveRoom() {
    if (!this.roomId) return;
    try {
      await auth.request(`/api/games/blackjack-multi/rooms/${this.roomId}/leave`, {
        method: "POST",
      });
    } catch (err) {
      // ignore
    }
    this.closeSocket(true);
    this.clearLocalBetDraft();
    this.clearRoundClearTimer();
    this.setConnectionReady(false);
    this.roomId = "";
    this.syncRoomQuery("");
    this.playerId = "";
    this.state = null;
    this.showLobby();
    this.loadLobby();
  }

  syncRoomQuery(roomId) {
    try {
      const url = new URL(window.location.href);
      if (roomId) url.searchParams.set("room", roomId);
      else url.searchParams.delete("room");
      window.history.replaceState({}, "", url.toString());
    } catch (err) {
      // ignore history/url failures
    }
  }

  connectSocket() {
    if (this.socket || !this.roomId) return;
    const base = getWsBase();
    if (!base) {
      showCenterToast("Missing WebSocket endpoint.", "danger");
      return;
    }
    const token = encodeURIComponent(auth.apiToken || "");
    const ws = new WebSocket(`${base}?token=${token}`);
    this.socket = ws;
    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ action: "join", roomId: this.roomId }));
    });
    ws.addEventListener("message", (event) => {
      let msg = null;
      try {
        msg = JSON.parse(event.data || "{}");
      } catch (err) {
        return;
      }
      if (msg.type === "ROOM_JOINED") {
        this.setConnectionReady(true);
        return;
      }
      if (msg.type === "BLACKJACK_MULTI_STATE" && msg.roomId === this.roomId) {
        this.applyState(msg.state);
      } else if (msg.type === "BALANCE_UPDATE" && Number.isFinite(Number(msg.balance))) {
        coreState.balance = Number(msg.balance);
        updateBalance();
      } else if (msg.error) {
        showCenterToast(msg.error, "danger");
      }
    });
    ws.addEventListener("close", () => {
      this.socket = null;
    });
  }

  closeSocket(sendLeave = true) {
    this.clearLocalBetDraft();
    this.clearRoundClearTimer();
    this.setConnectionReady(false);
    if (!this.socket) return;
    if (sendLeave) {
      try {
        this.socket.send(JSON.stringify({ action: "leave" }));
      } catch (err) {
        // ignore
      }
    }
    this.socket.close();
    this.socket = null;
  }

  sendAction(type, payload = {}) {
    if (!this.connectionReady) return;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      showCenterToast("Connection not ready.", "danger");
      return;
    }
    if (type === "START") playSfx("deal");
    if (type === "HIT" || type === "DOUBLE" || type === "SPLIT") playSfx("hit");
    if (type === "STAND") playSfx("stop");
    this.socket.send(
      JSON.stringify({
        action: "action",
        payload: { game: "blackjack-multi", type, roomId: this.roomId, ...payload },
      })
    );
  }

  setLocalBet(nextAmount) {
    if (!this.state || this.state.inRound) return;
    const me = this.state.players?.find((entry) => entry.id === this.playerId);
    if (!me) return;
    const bank = Math.max(0, Number(coreState.balance || 0));
    const cap = bank;
    const next = Math.min(cap, Math.max(0, Number(nextAmount) || 0));
    me.betAmount = next;
    me.status = next > 0 ? "waiting" : "sitting";
    this.localBetDraft = next;
    this.updateBet(this.state);
    this.queueBetCommit();
  }

  adjustLocalBet(delta) {
    if (!this.state || this.state.inRound) return;
    const me = this.state.players?.find((entry) => entry.id === this.playerId);
    if (!me) return;
    const current = Math.max(0, Number(me.betAmount || 0));
    this.setLocalBet(current + Number(delta || 0));
  }

  queueBetCommit() {
    if (this.betCommitTimer) {
      clearTimeout(this.betCommitTimer);
      this.betCommitTimer = null;
    }
    this.betCommitTimer = setTimeout(() => {
      this.betCommitTimer = null;
      if (this.localBetDraft === null) return;
      const amount = Math.max(0, Number(this.localBetDraft) || 0);
      this.sendAction("BET", { amount });
    }, BET_SYNC_DEBOUNCE_MS);
  }

  clearLocalBetDraft() {
    this.localBetDraft = null;
    if (this.betCommitTimer) {
      clearTimeout(this.betCommitTimer);
      this.betCommitTimer = null;
    }
  }

  clearRoundClearTimer() {
    if (this.roundClearTimer) {
      clearTimeout(this.roundClearTimer);
      this.roundClearTimer = null;
    }
  }

  getRoundClearAtMs(state) {
    const ms = Date.parse(state?.roundClearAt || "");
    return Number.isFinite(ms) ? ms : 0;
  }

  isRoundCooldownActive(state) {
    if (!state || state.phase !== "complete") return false;
    const clearAtMs = this.getRoundClearAtMs(state);
    return clearAtMs > Date.now();
  }

  shouldHideCompletedHands(state) {
    if (!state || state.phase !== "complete") return false;
    const clearAtMs = this.getRoundClearAtMs(state);
    return clearAtMs > 0 && clearAtMs <= Date.now();
  }

  scheduleRoundClearRefresh(state) {
    this.clearRoundClearTimer();
    if (!state || state.phase !== "complete") return;
    const clearAtMs = this.getRoundClearAtMs(state);
    if (!clearAtMs) return;
    const waitMs = clearAtMs - Date.now();
    if (waitMs <= 0) return;
    this.roundClearTimer = setTimeout(() => {
      this.roundClearTimer = null;
      if (!this.state || this.state.phase !== "complete") return;
      this.renderRoom();
    }, waitMs + 20);
  }

  setConnectionReady(ready) {
    this.connectionReady = Boolean(ready);
    if (this.ui.connecting) {
      this.ui.connecting.classList.toggle("hidden", this.connectionReady);
    }
    if (this.state) {
      this.updateControls(this.state);
      this.updateStatus(this.state);
    }
  }

  applyState(state) {
    const prevInRound = this.lastInRound;
    const nextState = state || null;
    if (nextState?.inRound) {
      this.clearLocalBetDraft();
    } else if (nextState && this.localBetDraft !== null) {
      const meFromServer = nextState.players?.find((entry) => entry.id === this.playerId);
      if (meFromServer) {
        const serverBet = Math.max(0, Number(meFromServer.betAmount || 0));
        const draftBet = Math.max(0, Number(this.localBetDraft || 0));
        if (serverBet === draftBet) {
          this.localBetDraft = null;
        } else {
          meFromServer.betAmount = draftBet;
          meFromServer.status = draftBet > 0 ? "waiting" : "sitting";
        }
      }
    }
    this.state = nextState;
    if (!this.state) {
      this.showLobby();
      this.loadLobby();
      return;
    }
    this.scheduleRoundClearRefresh(this.state);
    const me = this.state.players?.find((entry) => entry.id === this.playerId) || null;
    this.lastInRound = Boolean(this.state.inRound);
    if (this.lastInRound) {
      this.sawBustThisRound = false;
    }
    if (this.lastInRound && me) {
      const prevBusted = Array.isArray(this.prevMe?.busted) ? this.prevMe.busted : [];
      const nextBusted = Array.isArray(me.busted) ? me.busted : [];
      const newBusts = nextBusted
        .map((busted, index) => (busted && !prevBusted[index] ? index : -1))
        .filter((index) => index >= 0);
      if (newBusts.length > 0) {
        const multiple = nextBusted.length > 1;
        const messages = newBusts.map((index) => ({
          text: multiple ? `Hand ${index + 1} busts.` : "You bust.",
          tone: "danger",
        }));
        showCenterToasts(messages);
        playSfx("lose");
        this.sawBustThisRound = true;
      }
    }
    if (prevInRound && !this.lastInRound) {
      if (!this.sawBustThisRound && me) {
        const hasHands = Array.isArray(me.hands) && me.hands.length > 0;
        if (!hasHands) {
          // Player sat out; no outcome toasts or sounds.
        } else if (Array.isArray(me.busted) && me.busted.some(Boolean)) {
          const multiple = me.busted.length > 1;
          const messages = me.busted
            .map((busted, index) => (busted ? index : -1))
            .filter((index) => index >= 0)
            .map((index) => ({
              text: multiple ? `Hand ${index + 1} busts.` : "You bust.",
              tone: "danger",
            }));
          if (messages.length > 0) {
            showCenterToasts(messages);
            playSfx("lose");
          }
        } else if (!me.busted?.some(Boolean)) {
          const outcomes = Array.isArray(me.lastOutcomes) ? me.lastOutcomes : [];
          if (outcomes.length > 0) {
            const multiple = outcomes.length > 1;
            const messages = outcomes.map((outcome) => {
              const prefix = multiple ? `Hand ${outcome.index + 1} ` : "";
              if (outcome.result === "win") {
                return { text: multiple ? `${prefix}wins!` : "You win!", tone: "win" };
              }
              if (outcome.result === "push") {
                return { text: multiple ? `${prefix}pushes.` : "Push.", tone: "win" };
              }
              return { text: multiple ? `${prefix}loses.` : "You lose.", tone: "danger" };
            });
            showCenterToasts(messages);
            const hasWin = outcomes.some((o) => o.result === "win");
            const hasPush = outcomes.some((o) => o.result === "push");
            playSfx(hasWin || hasPush ? "win" : "lose");
          } else if (me.lastResult === "win") {
            showCenterToasts([{ text: "You win!", tone: "win" }]);
            playSfx("win");
          } else if (me.lastResult === "push") {
            showCenterToasts([{ text: "Push.", tone: "win" }]);
            playSfx("win");
          } else if (me.lastResult) {
            showCenterToasts([{ text: "You lose.", tone: "danger" }]);
            playSfx("lose");
          }
        }
      }
    }
    this.prevMe = me ? { busted: me.busted, hands: me.hands } : null;
    this.renderRoom();
  }

  setInviteLink(roomId) {
    if (!this.ui.invite) return;
    const url = new URL(window.location.href);
    url.searchParams.set("room", roomId);
    this.ui.invite.value = url.toString();
  }

  copyInvite() {
    if (!this.ui.invite) return;
    this.ui.invite.select();
    document.execCommand("copy");
    showCenterToast("Invite link copied.", "win");
  }

  showRoom() {
    this.ui.lobby?.classList.add("hidden");
    this.ui.room?.classList.remove("hidden");
  }

  showLobby() {
    this.ui.lobby?.classList.remove("hidden");
    this.ui.room?.classList.add("hidden");
  }

  renderRoom() {
    const state = this.state;
    if (!state) return;
    if (this.ui.roomId) this.ui.roomId.textContent = state.roomId || this.roomId;
    if (this.ui.dealer) {
      const hideFirst = state.inRound && !state.revealDealer;
      renderCards(this.ui.dealer, state.dealer || [], hideFirst);
    }
    if (this.ui.dealerTotal) {
      if (state.inRound && !state.revealDealer) {
        this.ui.dealerTotal.textContent = "Total: ?";
      } else {
        this.ui.dealerTotal.textContent = `Total: ${handTotal(state.dealer || [])}`;
      }
    }
    this.renderPlayers(state, this.shouldHideCompletedHands(state));
    this.updateControls(state);
    this.updateStatus(state);
    this.updateBet(state);
  }

  renderPlayers(state, hideHands = false) {
    if (!this.ui.players) return;
    this.ui.players.innerHTML = "";
    const players = Array.isArray(state.players) ? state.players : [];
    players.forEach((player, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "bjmulti-player";
      if (index === state.turnIndex && state.inRound) wrapper.classList.add("active");
      const header = document.createElement("div");
      header.className = "bjmulti-player-header";
      const hands = Array.isArray(player.hands) ? player.hands : [];
      const outcomes = Array.isArray(player.lastOutcomes) ? player.lastOutcomes : [];
      const busted = Array.isArray(player.busted) ? player.busted : [];
      const name = document.createElement("div");
      name.className = "name";
      const username = document.createElement("span");
      username.className = "player-name-text";
      username.textContent = player.username || "Guest";
      name.appendChild(username);
      if (player.id === this.playerId) {
        const youTag = document.createElement("span");
        youTag.className = "player-role-tag is-you";
        youTag.textContent = "You";
        name.appendChild(youTag);
      }
      if (state.hostId && player.id === state.hostId) {
        const hostTag = document.createElement("span");
        hostTag.className = "player-role-tag is-host";
        hostTag.textContent = "Host";
        name.appendChild(hostTag);
      }
      const bet = document.createElement("div");
      bet.className = "status";
      const betTotal = Array.isArray(player.bets) && state.inRound
        ? player.bets.reduce((sum, val) => sum + Number(val || 0), 0)
        : Number(player.betAmount || 0);
      const isSittingOut =
        player.status === "sitting" || (!state.inRound && betTotal <= 0 && hands.length === 0);
      if (isSittingOut) wrapper.classList.add("sitting-out");
      const hasBet = betTotal > 0;
      bet.textContent = isSittingOut ? "Sitting out" : betTotal > 0 ? `Bet $${betTotal}` : "No bet";
      if (isSittingOut) bet.classList.add("is-sitting");
      if (hasBet) bet.classList.add("is-bet");
      header.appendChild(name);
      header.appendChild(bet);
      const showLabels = hands.length > 1;
      const cardsWrap = document.createElement("div");
      cardsWrap.className = "bjmulti-hands";
      if (!hideHands) {
        hands.forEach((hand, idx) => {
          const block = document.createElement("div");
          block.className = "hand-block";
          if (idx === player.activeHand) block.classList.add("active-hand");
          const showHandLabel = showLabels || Boolean(busted[idx]);
          if (showHandLabel) {
            const label = document.createElement("div");
            label.className = "hand-label";
            if (busted[idx]) {
              label.textContent = "BUST";
              label.classList.add("bust");
            } else {
              label.textContent = `Hand ${idx + 1}`;
            }
            block.appendChild(label);
          }
          if (!state.inRound) {
            const outcome = outcomes.find((entry) => Number(entry?.index) === idx) || null;
            let resultLabel = "";
            if (busted[idx]) {
              resultLabel = "BUST";
            } else if (outcome?.result === "win") {
              resultLabel = "WIN";
            } else if (outcome?.result === "push") {
              resultLabel = "PUSH";
            } else if (outcome?.result === "loss") {
              resultLabel = "LOSS";
            }
            if (resultLabel) {
              const result = document.createElement("div");
              result.className = `bjmulti-result ${resultLabel.toLowerCase()}`;
              result.textContent = resultLabel;
              block.appendChild(result);
            }
          }
          const cards = document.createElement("div");
          cards.className = "cards";
          renderCards(cards, hand);
          const total = document.createElement("div");
          total.className = "total";
          total.textContent = `Total: ${handTotal(hand)}`;
          block.appendChild(cards);
          block.appendChild(total);
          cardsWrap.appendChild(block);
        });
      }
      if (!hands.length || hideHands) {
        const empty = document.createElement("div");
        const isWaitingForCards = !hideHands && !isSittingOut;
        empty.className = `total ${isSittingOut ? "bjmulti-sitting-note" : ""} ${
          isWaitingForCards ? "bjmulti-waiting-note" : ""
        }`;
        empty.textContent = hideHands
          ? "Waiting for next round"
          : isSittingOut
            ? "Sitting out - place a bet to join next round"
            : "Waiting for cards - bet to be dealt in";
        cardsWrap.appendChild(empty);
      }
      wrapper.appendChild(header);
      wrapper.appendChild(cardsWrap);
      this.ui.players.appendChild(wrapper);
    });
  }

  updateControls(state) {
    const players = Array.isArray(state.players) ? state.players : [];
    const current = players[state.turnIndex] || null;
    const myTurn = Boolean(state.inRound && current && current.id === this.playerId);
    const isHost = state.hostId ? state.hostId === this.playerId : false;
    const roundCooldown = this.isRoundCooldownActive(state);
    const controlsEnabled = this.connectionReady;
    if (this.ui.startBtn) {
      this.ui.startBtn.disabled =
        !controlsEnabled || roundCooldown || state.inRound || players.length === 0 || !isHost;
      this.ui.startBtn.classList.toggle("hidden", state.inRound || !isHost);
    }
    if (this.ui.hitBtn) {
      this.ui.hitBtn.disabled = !controlsEnabled || !myTurn;
      this.ui.hitBtn.classList.toggle("hidden", !myTurn);
    }
    if (this.ui.standBtn) {
      this.ui.standBtn.disabled = !controlsEnabled || !myTurn;
      this.ui.standBtn.classList.toggle("hidden", !myTurn);
    }
    const canDouble =
      myTurn &&
      current &&
      Array.isArray(current.hands) &&
      current.hands[current.activeHand]?.length === 2 &&
      !current.doubled?.[current.activeHand];
    const canSplit =
      myTurn &&
      current &&
      Array.isArray(current.hands) &&
      !current.splitUsed &&
      current.hands[current.activeHand]?.length === 2 &&
      current.hands[current.activeHand]?.[0]?.rank === current.hands[current.activeHand]?.[1]?.rank;
    if (this.ui.doubleBtn) {
      this.ui.doubleBtn.disabled = !controlsEnabled || !canDouble;
      this.ui.doubleBtn.classList.toggle("hidden", !canDouble);
    }
    if (this.ui.splitBtn) {
      this.ui.splitBtn.disabled = !controlsEnabled || !canSplit;
      this.ui.splitBtn.classList.toggle("hidden", !canSplit);
    }
    if (this.ui.betButtons) {
      this.ui.betButtons.forEach((btn) => {
        btn.disabled = !controlsEnabled || roundCooldown || state.inRound;
      });
    }
    if (this.ui.betClear) this.ui.betClear.disabled = !controlsEnabled || roundCooldown || state.inRound;
  }

  updateStatus(state) {
    if (!this.ui.status) return;
    if (!this.connectionReady) {
      this.ui.status.textContent = "Connecting to table...";
      return;
    }
    if (this.isRoundCooldownActive(state)) {
      this.ui.status.textContent = "Round complete. Next hand in a moment...";
      return;
    }
    if (!state.inRound) {
      this.ui.status.textContent = "Waiting for the next round.";
      return;
    }
    const current = state.players?.[state.turnIndex];
    this.ui.status.textContent = current
      ? `Turn: ${current.username}`
      : "Round in progress.";
  }

  updateBet(state) {
    const me = state.players?.find((entry) => entry.id === this.playerId);
    if (this.ui.betAmount) {
      const betTotal = Array.isArray(me?.bets)
        ? me.bets.reduce((sum, val) => sum + Number(val || 0), 0)
        : 0;
      const next = state.inRound ? betTotal : Number(me?.betAmount || 0);
      this.ui.betAmount.textContent = `$${next}`;
    }
  }
}
