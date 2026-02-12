import { renderCards, handTotal, showCenterToast, showCenterToasts, playSfx } from "./core.js";
import { auth } from "./auth.js";

const ROOM_POLL_INTERVAL = 8000;

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
  }

  cacheElements() {
    this.ui = {
      lobby: document.getElementById("bjMultiLobby"),
      room: document.getElementById("bjMultiRoom"),
      roomId: document.getElementById("bjMultiRoomId"),
      roomName: document.getElementById("bjMultiRoomName"),
      roomPublic: document.getElementById("bjMultiPublic"),
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
    };
  }

  init() {
    this.cacheElements();
    this.bindControls();
    window.addEventListener("beforeunload", () => this.closeSocket());
    void this.bootstrap();
  }

  async bootstrap() {
    await this.ensureAuthReady();
    await this.loadLobby();
    const params = new URLSearchParams(window.location.search);
    const room = params.get("room");
    if (room) await this.joinRoom(room);
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
    this.ui.leaveBtn?.addEventListener("click", () => this.leaveRoom());
    this.ui.copyInvite?.addEventListener("click", () => this.copyInvite());
    this.ui.startBtn?.addEventListener("click", () => this.sendAction("START"));
    this.ui.hitBtn?.addEventListener("click", () => this.sendAction("HIT"));
    this.ui.standBtn?.addEventListener("click", () => this.sendAction("STAND"));
    this.ui.doubleBtn?.addEventListener("click", () => this.sendAction("DOUBLE"));
    this.ui.splitBtn?.addEventListener("click", () => this.sendAction("SPLIT"));
    this.ui.betButtons?.forEach((btn) => {
      btn.addEventListener("click", () => {
        const amount = Number(btn.dataset.amount) || 0;
        this.applyLocalBet(amount);
        this.sendAction("BET", { amount });
        playSfx("hit");
      });
    });
    this.ui.betClear?.addEventListener("click", () => {
      this.applyLocalBet(0);
      this.sendAction("BET", { amount: 0 });
    });
  }

  async loadLobby() {
    try {
      await this.ensureAuthReady();
      const payload = await auth.request("/api/games/blackjack-multi/rooms", { method: "GET" });
      this.renderRoomList(payload.rooms || []);
    } catch (err) {
      showCenterToast("Unable to load rooms.", "danger");
    }
  }

  renderRoomList(rooms) {
    if (!this.ui.rooms) return;
    this.ui.rooms.innerHTML = "";
    if (!rooms.length) {
      const empty = document.createElement("div");
      empty.className = "bjmulti-empty";
      empty.textContent = "No public tables yet.";
      this.ui.rooms.appendChild(empty);
      return;
    }
    rooms.forEach((room) => {
      const card = document.createElement("div");
      card.className = "bjmulti-room-card";
      const meta = document.createElement("div");
      meta.className = "bjmulti-room-meta";
      meta.innerHTML = `
        <div class="title">${room.name}</div>
        <div class="details">Host: ${room.host} · ${room.playerCount}/${room.maxPlayers}</div>
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
      this.playerId = payload.playerId || this.playerId;
      this.applyState(payload.state);
      this.connectSocket();
      this.showRoom();
      this.setInviteLink(roomId);
    } catch (err) {
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
    this.closeSocket();
    this.roomId = "";
    this.playerId = "";
    this.state = null;
    this.showLobby();
    this.loadLobby();
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
        return;
      }
      if (msg.type === "BLACKJACK_MULTI_STATE" && msg.roomId === this.roomId) {
        this.applyState(msg.state);
      } else if (msg.error) {
        showCenterToast(msg.error, "danger");
      }
    });
    ws.addEventListener("close", () => {
      this.socket = null;
    });
  }

  closeSocket() {
    if (!this.socket) return;
    try {
      this.socket.send(JSON.stringify({ action: "leave" }));
    } catch (err) {
      // ignore
    }
    this.socket.close();
    this.socket = null;
  }

  sendAction(type, payload = {}) {
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

  applyLocalBet(amount) {
    if (!this.state || this.state.inRound) return;
    const me = this.state.players?.find((entry) => entry.id === this.playerId);
    if (!me) return;
    me.betAmount = Math.max(0, Number(amount) || 0);
    this.updateBet(this.state);
    this.renderPlayers(this.state, false);
  }

  applyState(state) {
    const prevInRound = this.lastInRound;
    this.state = state || null;
    if (!this.state) {
      this.showLobby();
      this.loadLobby();
      return;
    }
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
    this.renderPlayers(state, false);
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
      if (!state.inRound && !hideHands && hands.length > 0) {
        const results = document.createElement("div");
        results.className = "bjmulti-results";
        const outcomes = Array.isArray(player.lastOutcomes) ? player.lastOutcomes : [];
        const busted = Array.isArray(player.busted) ? player.busted : [];
        if (outcomes.length > 0) {
          outcomes.forEach((outcome) => {
            const label = busted[outcome.index]
              ? "BUST"
              : outcome.result === "win"
                ? "WIN"
                : outcome.result === "push"
                  ? "PUSH"
                  : "LOSS";
            const tag = document.createElement("div");
            tag.className = `bjmulti-result ${label.toLowerCase()}`;
            tag.textContent = label;
            results.appendChild(tag);
          });
        }
        if (results.childNodes.length > 0) header.appendChild(results);
      }
      const name = document.createElement("div");
      name.className = "name";
      const baseName =
        player.id === this.playerId ? `${player.username} (You)` : player.username;
      name.textContent =
        state.hostId && player.id === state.hostId ? `${baseName} (Host)` : baseName;
      const bet = document.createElement("div");
      bet.className = "status";
      const betTotal = Array.isArray(player.bets) && state.inRound
        ? player.bets.reduce((sum, val) => sum + Number(val || 0), 0)
        : Number(player.betAmount || 0);
      bet.textContent = betTotal > 0 ? `Bet $${betTotal}` : "No bet";
      header.appendChild(name);
      header.appendChild(bet);
      const hands = Array.isArray(player.hands) ? player.hands : [];
      const showLabels = hands.length > 1;
      const cardsWrap = document.createElement("div");
      cardsWrap.className = "bjmulti-hands";
      if (!hideHands) {
        hands.forEach((hand, idx) => {
          const block = document.createElement("div");
          block.className = "hand-block";
          if (idx === player.activeHand) block.classList.add("active-hand");
          if (showLabels) {
            const label = document.createElement("div");
            label.className = "hand-label";
            if (Array.isArray(player.busted) && player.busted[idx]) {
              label.textContent = "BUST";
              label.classList.add("bust");
            } else {
              label.textContent = `Hand ${idx + 1}`;
            }
            block.appendChild(label);
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
        empty.className = "total";
        empty.textContent = hideHands ? "Waiting for next round" : "Sitting out";
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
    if (this.ui.startBtn) {
      this.ui.startBtn.disabled = state.inRound || players.length === 0 || !isHost;
      this.ui.startBtn.classList.toggle("hidden", state.inRound || !isHost);
    }
    if (this.ui.hitBtn) {
      this.ui.hitBtn.disabled = !myTurn;
      this.ui.hitBtn.classList.toggle("hidden", !myTurn);
    }
    if (this.ui.standBtn) {
      this.ui.standBtn.disabled = !myTurn;
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
      this.ui.doubleBtn.disabled = !canDouble;
      this.ui.doubleBtn.classList.toggle("hidden", !canDouble);
    }
    if (this.ui.splitBtn) {
      this.ui.splitBtn.disabled = !canSplit;
      this.ui.splitBtn.classList.toggle("hidden", !canSplit);
    }
    if (this.ui.betButtons) {
      this.ui.betButtons.forEach((btn) => {
        btn.disabled = state.inRound;
      });
    }
    if (this.ui.betClear) this.ui.betClear.disabled = state.inRound;
  }

  updateStatus(state) {
    if (!this.ui.status) return;
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
