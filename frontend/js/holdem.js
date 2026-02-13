import {
  state as coreState,
  updateBalance,
  renderCards,
  renderHiddenCards,
  makeChipStack,
  showCenterToast,
  playSfx,
} from "./core.js";
import { auth } from "./auth.js";

const getWsBase = () => {
  const fromStorage = localStorage.getItem("casino-ws-base");
  const fromWindow = window.WS_BASE || "";
  const base = (fromStorage || fromWindow || "").trim();
  return base ? base.replace(/\/+$/, "") : "";
};

export class HoldemGame {
  constructor() {
    this.ui = {};
    this.socket = null;
    this.roomId = "";
    this.playerId = "";
    this.state = null;
    this.connectionReady = false;
    this.rooms = [];
    this.authReadyPromise = null;
    this.raiseAmount = 0;
    this.lastOutcomeToastKey = "";
    this.lastActionLabelByPlayer = {};
  }

  cacheElements() {
    this.ui = {
      lobby: document.getElementById("holdemLobby"),
      room: document.getElementById("holdemRoom"),
      connecting: document.getElementById("holdemConnecting"),
      roomId: document.getElementById("holdemRoomId"),
      roomName: document.getElementById("holdemRoomName"),
      roomPublic: document.getElementById("holdemPublic"),
      searchId: document.getElementById("holdemSearchId"),
      createBtn: document.getElementById("holdemCreate"),
      refreshBtn: document.getElementById("holdemRefresh"),
      rooms: document.getElementById("holdemRooms"),
      invite: document.getElementById("holdemInvite"),
      copyInvite: document.getElementById("holdemCopy"),
      leaveBtn: document.getElementById("holdemLeave"),
      community: document.getElementById("holdemCommunity"),
      pot: document.getElementById("holdemPot"),
      potBreakdown: document.getElementById("holdemPotBreakdown"),
      players: document.getElementById("holdemPlayers"),
      startBtn: document.getElementById("holdemStart"),
      betBtn: document.getElementById("holdemBet"),
      foldBtn: document.getElementById("holdemFold"),
      betRow: document.querySelector("#holdemRoom .multi-bet-row"),
      betAmount: document.getElementById("holdemBetAmount"),
      betButtons: document.querySelectorAll("#holdemBetButtons .chip"),
      betClear: document.getElementById("holdemBetClear"),
      status: document.getElementById("holdemStatus"),
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
    this.ui.searchId?.addEventListener("input", () => this.searchRooms());
    this.ui.leaveBtn?.addEventListener("click", () => this.leaveRoom());
    this.ui.copyInvite?.addEventListener("click", () => this.copyInvite());
    this.ui.startBtn?.addEventListener("click", () => this.sendAction("START"));
    this.ui.betBtn?.addEventListener("click", () => this.handleBetAction());
    this.ui.foldBtn?.addEventListener("click", () => this.sendAction("FOLD"));
    this.ui.betButtons?.forEach((btn) => {
      const amount = Number(btn.dataset.amount) || 0;
      btn.addEventListener("click", () => this.adjustBet(amount));
      btn.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.adjustBet(-amount);
      });
    });
    this.ui.betClear?.addEventListener("click", () => this.setBet(0));
  }

  async loadLobby() {
    try {
      await this.ensureAuthReady();
      const payload = await auth.request("/api/games/holdem/rooms", { method: "GET" });
      this.rooms = Array.isArray(payload.rooms) ? payload.rooms : [];
      this.searchRooms();
    } catch (err) {
      showCenterToast("Unable to load rooms.", "danger");
    }
  }

  searchRooms() {
    const query = (this.ui.searchId?.value || "").trim().toLowerCase();
    this.renderRoomList(this.filterRoomsByQuery(query), query);
  }

  filterRoomsByQuery(query) {
    if (!query) return this.rooms;
    return this.rooms.filter((room) =>
      String(room.roomId || "").toLowerCase().includes(query) ||
      String(room.name || "").toLowerCase().includes(query)
    );
  }

  renderRoomList(rooms, query = "") {
    if (!this.ui.rooms) return;
    this.ui.rooms.innerHTML = "";
    if (!rooms.length) {
      const empty = document.createElement("div");
      empty.className = "multi-empty";
      empty.textContent = query ? `No tables found for: ${query}` : "No public tables yet.";
      this.ui.rooms.appendChild(empty);
      return;
    }
    rooms.forEach((room) => {
      const card = document.createElement("div");
      card.className = "multi-room-card";
      const meta = document.createElement("div");
      meta.className = "multi-room-meta";
      const roomName = String(room.name || "").trim() || "Hold'em Table";
      meta.innerHTML = `
        <div class="title">${roomName}</div>
        <div class="details">
          <span class="multi-id-tag">ID</span> ${room.roomId}
          <span class="multi-host-tag">HOST</span> ${room.host}
          <span class="multi-count-tag">${room.playerCount}/${room.maxPlayers}</span>
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
    const name = this.ui.roomName?.value?.trim() || "Hold'em Table";
    const isPublic = Boolean(this.ui.roomPublic?.checked);
    try {
      await this.ensureAuthReady();
      const payload = await auth.request("/api/games/holdem/rooms", {
        method: "POST",
        body: JSON.stringify({ name, public: isPublic }),
      });
      if (payload.roomId) await this.joinRoom(payload.roomId);
    } catch (err) {
      showCenterToast("Unable to create room.", "danger");
    }
  }

  async joinRoom(roomId) {
    try {
      await this.ensureAuthReady();
      const payload = await auth.request(`/api/games/holdem/rooms/${roomId}/join`, {
        method: "POST",
      });
      this.roomId = roomId;
      this.playerId = payload.playerId || this.playerId;
      this.syncRoomQuery(roomId);
      this.setConnectionReady(false);
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
      await auth.request(`/api/games/holdem/rooms/${this.roomId}/leave`, { method: "POST" });
    } catch (err) {
      // ignore
    }
    this.closeSocket(true);
    this.roomId = "";
    this.playerId = "";
    this.state = null;
    this.lastActionLabelByPlayer = {};
    this.syncRoomQuery("");
    this.showLobby();
    void this.loadLobby();
  }

  syncRoomQuery(roomId) {
    try {
      const url = new URL(window.location.href);
      if (roomId) url.searchParams.set("room", roomId);
      else url.searchParams.delete("room");
      window.history.replaceState({}, "", url.toString());
    } catch (err) {
      // ignore
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
      if (msg.type === "HOLDEM_STATE" && msg.roomId === this.roomId) {
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
      this.setConnectionReady(false);
    });
  }

  closeSocket(sendLeave = true) {
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
    this.setConnectionReady(false);
  }

  sendAction(type, payload = {}) {
    if (!this.connectionReady || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    if (type === "START") playSfx("deal");
    if (type === "CHECK" || type === "CALL" || type === "RAISE" || type === "FOLD") playSfx("hit");
    this.socket.send(
      JSON.stringify({
        action: "action",
        payload: { game: "holdem", type, roomId: this.roomId, ...payload },
      })
    );
  }

  setBet(amount) {
    if (!this.state || this.state.phase === "showdown") return;
    if (!this.state.inRound) return;
    const { me, current, maxRaiseBy } = this.getPlayerTurnContext();
    if (!me || !current || current.id !== this.playerId) return;
    this.raiseAmount = Math.min(Math.max(0, Number(amount) || 0), maxRaiseBy);
    this.updateBet();
    this.updateControls();
  }

  adjustBet(delta) {
    this.setBet(Number(this.raiseAmount || 0) + Number(delta || 0));
  }

  applyState(state) {
    const prevTurn = this.state?.turnIndex;
    const prevState = this.state;
    this.state = state || null;
    if (!this.state) {
      this.lastActionLabelByPlayer = {};
      this.showLobby();
      return;
    }
    if (!this.state.inRound) this.lastActionLabelByPlayer = {};
    const current = this.state.players?.[this.state.turnIndex];
    const myTurn = Boolean(this.state.inRound && current && current.id === this.playerId);
    if (!this.state.inRound || !myTurn || prevTurn !== this.state.turnIndex) this.raiseAmount = 0;
    this.maybeShowOutcomeToast(prevState, this.state);
    this.renderRoom();
  }

  maybeShowOutcomeToast(prevState, nextState) {
    if (!nextState || nextState.phase !== "showdown" || !nextState.settled) return;
    const me = nextState.players?.find((entry) => entry.id === this.playerId);
    if (!me) return;
    const roundKey = `${nextState.roomId || this.roomId}:${nextState.roundClearAt || ""}:${me.lastResult || ""}:${Number(me.lastPayout || 0)}`;
    if (!roundKey || roundKey === this.lastOutcomeToastKey) return;
    const wasAlreadyShowdown =
      prevState &&
      prevState.phase === "showdown" &&
      prevState.settled &&
      `${prevState.roomId || this.roomId}:${prevState.roundClearAt || ""}:${me.lastResult || ""}:${Number(me.lastPayout || 0)}` === roundKey;
    if (wasAlreadyShowdown) return;

    const myLabel = String(me.bestLabel || "").trim();
    const winningEntry =
      Array.isArray(nextState.players)
        ? nextState.players.find((entry) => entry.lastResult === "win" && entry.bestLabel)
        : null;
    const winningLabel = String(winningEntry?.bestLabel || "").trim();
    if (me.lastResult === "win") {
      playSfx("win");
      showCenterToast(myLabel ? `You win with ${myLabel}!` : "You win!", "win", 3000);
    } else if (me.lastResult === "loss") {
      playSfx("lose");
      if (String(me.lastAction || "").toLowerCase() === "fold") {
        showCenterToast("You folded.", "danger", 3000);
      } else if (winningLabel) {
        showCenterToast(`You lose. Winning hand: ${winningLabel}.`, "danger", 3000);
      } else if (myLabel) {
        showCenterToast(`You lose with ${myLabel}.`, "danger", 3000);
      } else {
        showCenterToast("You lose.", "danger", 3000);
      }
    } else if (me.lastResult === "push") {
      playSfx("win");
      showCenterToast(myLabel ? `Push with ${myLabel}. Pot split.` : "Push. Pot split.", "win", 3000);
    }
    this.lastOutcomeToastKey = roundKey;
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

  setConnectionReady(ready) {
    this.connectionReady = Boolean(ready);
    this.ui.connecting?.classList.toggle("hidden", this.connectionReady);
    this.updateControls();
  }

  getPlayerTurnContext() {
    const players = Array.isArray(this.state?.players) ? this.state.players : [];
    const me = players.find((entry) => entry.id === this.playerId) || null;
    const current = players[this.state?.turnIndex] || null;
    const toCall = Math.max(0, Number(this.state?.currentBet || 0) - Number(me?.roundBet || 0));
    const maxRaiseBy = Math.max(0, Number(me?.stack || 0) - toCall);
    return { players, me, current, toCall, maxRaiseBy };
  }

  updateBet() {
    if (this.ui.betAmount) {
      if (!this.state || !this.state.inRound) {
        this.ui.betAmount.textContent = "+$0";
        return;
      }
      const { toCall } = this.getPlayerTurnContext();
      const effectiveRaiseBy = Math.max(0, Number(this.raiseAmount || 0));
      this.ui.betAmount.textContent = `+$${toCall + effectiveRaiseBy}`;
    }
  }

  renderRoom() {
    const state = this.state;
    if (!state) return;
    if (this.ui.roomId) this.ui.roomId.textContent = state.roomId || this.roomId;
    renderCards(this.ui.community, state.community || []);
    if (this.ui.pot) {
      const potAmount = Number(state.pot || 0);
      makeChipStack(this.ui.pot, potAmount);
    }
    this.renderPotBreakdown();
    this.renderPlayers();
    this.updateBet();
    this.updateControls();
    this.updateStatus();
  }

  renderPotBreakdown() {
    if (!this.ui.potBreakdown || !this.state) return;
    const segments = Array.isArray(this.state.potBreakdown) ? this.state.potBreakdown : [];
    this.ui.potBreakdown.innerHTML = "";
    if (!segments.length) return;
    segments.forEach((segment) => {
      const row = document.createElement("div");
      row.className = "he-pot-row";
      const winners = Array.isArray(segment.winnerNames) ? segment.winnerNames.filter(Boolean) : [];
      row.textContent = winners.length
        ? `${segment.label}: $${Number(segment.amount || 0)} • Winner: ${winners.join(", ")}`
        : `${segment.label}: $${Number(segment.amount || 0)}`;
      this.ui.potBreakdown.appendChild(row);
    });
  }

  renderPlayers() {
    if (!this.ui.players || !this.state) return;
    this.ui.players.innerHTML = "";
    const players = Array.isArray(this.state.players) ? this.state.players : [];
    const blindPositions = this.getBlindPositions(players);
    const me = players.find((entry) => entry.id === this.playerId) || null;
    const toneClass =
      me?.lastResult === "push" ? "push" : me?.lastResult === "loss" ? "lose" : "win";
    players.forEach((player, index) => {
      const wrapper = document.createElement("div");
      wrapper.className = "multi-player";
      if (this.state.inRound && index === this.state.turnIndex) wrapper.classList.add("active");
      const header = document.createElement("div");
      header.className = "multi-player-header";

      const name = document.createElement("div");
      name.className = "name";
      const txt = document.createElement("span");
      txt.className = "player-name-text";
      txt.textContent = player.username || "Guest";
      name.appendChild(txt);
      if (player.id === this.playerId) {
        const youTag = document.createElement("span");
        youTag.className = "player-role-tag is-you";
        youTag.textContent = "You";
        name.appendChild(youTag);
      }
      if (this.state.hostId && player.id === this.state.hostId) {
        const hostTag = document.createElement("span");
        hostTag.className = "player-role-tag is-host";
        hostTag.textContent = "Host";
        name.appendChild(hostTag);
      }
      if (index === blindPositions.buttonIndex) {
        const dTag = document.createElement("span");
        dTag.className = "player-role-tag is-dealer";
        dTag.textContent = "Dealer";
        name.appendChild(dTag);
      }
      if (index === blindPositions.smallBlindIndex) {
        const sbTag = document.createElement("span");
        sbTag.className = "player-role-tag is-small-blind";
        sbTag.textContent = "Small";
        name.appendChild(sbTag);
      }
      if (index === blindPositions.bigBlindIndex) {
        const bbTag = document.createElement("span");
        bbTag.className = "player-role-tag is-big-blind";
        bbTag.textContent = "Big";
        name.appendChild(bbTag);
      }
      const status = document.createElement("div");
      status.className = "status";
      if (player.folded) {
        status.textContent = "Folded";
      } else if (this.state.inRound && player.status === "playing") {
        const isActiveTurn = index === this.state.turnIndex;
        const isMe = player.id === this.playerId;
        const actionLabel = player.lastAction ? String(player.lastAction).toUpperCase() : "";
        const cachedAction = String(this.lastActionLabelByPlayer[player.id] || "");
        if (actionLabel) this.lastActionLabelByPlayer[player.id] = actionLabel;
        status.textContent = actionLabel || cachedAction || (isActiveTurn && isMe ? "YOUR TURN" : "THEIR TURN");
      } else if (player.lastResult) {
        status.textContent = player.lastResult.toUpperCase();
        const resultTone = String(player.lastResult).toLowerCase();
        if (resultTone === "win" || resultTone === "loss" || resultTone === "push") {
          status.classList.add("is-result", `is-${resultTone}`);
        }
      } else {
        status.textContent = "Waiting";
      }
      header.appendChild(name);
      header.appendChild(status);

      const block = document.createElement("div");
      block.className = "hand-block";
      const cards = document.createElement("div");
      cards.className = "cards";
      const isShowdown = this.state.phase === "showdown";
      const isMe = player.id === this.playerId;
      const cardCount = Array.isArray(player.cards) ? player.cards.length : 0;
      if (!isShowdown && !isMe && cardCount > 0) {
        renderHiddenCards(cards, cardCount);
      } else {
        renderCards(cards, player.cards || []);
      }
      if (
        this.state.phase === "showdown" &&
        (player.lastResult === "win" || player.lastResult === "push")
      ) {
        const winnerIndexes = Array.isArray(player.bestIndexes) ? player.bestIndexes : [];
        const holeSet = new Set(winnerIndexes.filter((idx) => idx < 2));
        cards.querySelectorAll(".card").forEach((cardEl, cardIdx) => {
          cardEl.classList.remove("win", "lose", "push");
          if (holeSet.has(cardIdx)) cardEl.classList.add(toneClass);
        });
      }
      block.appendChild(cards);
      if (this.state.inRound && player.status === "playing") {
        const meta = document.createElement("div");
        meta.className = "he-player-meta";
        const stackPill = document.createElement("span");
        stackPill.className = "he-status-pill he-status-stack";
        stackPill.textContent = `STACK $${Number(player.stack || 0)}`;
        meta.appendChild(stackPill);

        const inPill = document.createElement("span");
        inPill.className = "he-status-pill he-status-in";
        inPill.textContent = `IN $${Number(player.committed || 0)}`;
        meta.appendChild(inPill);
        block.appendChild(meta);
      }
      if (this.state.phase === "showdown" && player.lastResult) {
        if (player.bestLabel) {
          const resultWrap = document.createElement("div");
          resultWrap.className = "he-result-wrap";
          const hand = document.createElement("div");
          hand.className = "he-result-hand";
          hand.textContent = player.bestLabel;
          resultWrap.appendChild(hand);
          block.appendChild(resultWrap);
        }
      }
      wrapper.appendChild(header);
      wrapper.appendChild(block);
      this.ui.players.appendChild(wrapper);
    });

    if (this.ui.community) {
      const allWinningSets = players
        .filter((entry) => entry.lastResult === "win" || entry.lastResult === "push")
        .flatMap((entry) => (Array.isArray(entry.bestIndexes) ? entry.bestIndexes : []));
      const communitySet = new Set(
        allWinningSets.filter((idx) => idx >= 2).map((idx) => idx - 2)
      );
      this.ui.community.querySelectorAll(".card").forEach((cardEl, idx) => {
        cardEl.classList.remove("win", "lose", "push");
        if (this.state.phase === "showdown" && communitySet.has(idx)) {
          cardEl.classList.add(toneClass);
        }
      });
    }
  }

  updateControls() {
    if (!this.state) return;
    const { players, me, current, toCall } = this.getPlayerTurnContext();
    const myTurn = Boolean(this.state.inRound && current && current.id === this.playerId);
    const isHost = this.state.hostId ? this.state.hostId === this.playerId : false;
    const inCooldown = this.state.phase === "showdown";
    const canRaise = myTurn && Number(me?.stack || 0) > toCall;

    if (this.ui.startBtn) {
      this.ui.startBtn.disabled = !this.connectionReady || inCooldown || this.state.inRound || !isHost;
      this.ui.startBtn.classList.toggle("hidden", inCooldown || this.state.inRound || !isHost);
    }
    if (this.ui.betRow) {
      this.ui.betRow.classList.toggle("hidden", !this.state.inRound || inCooldown || !myTurn);
    }
    if (this.ui.betBtn) {
      this.ui.betBtn.disabled = !this.connectionReady || !myTurn;
      this.ui.betBtn.classList.toggle("hidden", !myTurn);
      const maxRaiseBy = Math.max(0, Number(me?.stack || 0) - toCall);
      const effectiveRaiseBy = Math.min(Math.max(0, Number(this.raiseAmount || 0)), maxRaiseBy);
      if (effectiveRaiseBy > 0 && canRaise) {
        this.ui.betBtn.textContent = `Raise $${effectiveRaiseBy}`;
      } else if (toCall > 0) {
        this.ui.betBtn.textContent = `Call $${toCall}`;
      } else {
        this.ui.betBtn.textContent = "Check";
      }
    }
    if (this.ui.foldBtn) {
      this.ui.foldBtn.disabled = !this.connectionReady || !myTurn;
      this.ui.foldBtn.classList.toggle("hidden", !myTurn);
    }
    this.ui.betButtons?.forEach((btn) => {
      btn.disabled = !this.connectionReady || inCooldown || !myTurn;
    });
    if (this.ui.betClear) {
      this.ui.betClear.disabled = !this.connectionReady || inCooldown || !myTurn;
    }
  }

  getBlindPositions(players) {
    const list = Array.isArray(players) ? players : [];
    if (!list.length) {
      return { buttonIndex: -1, smallBlindIndex: -1, bigBlindIndex: -1 };
    }

    if (this.state?.inRound) {
      return {
        buttonIndex: Number(this.state.buttonIndex ?? -1),
        smallBlindIndex: Number(this.state.smallBlindIndex ?? -1),
        bigBlindIndex: Number(this.state.bigBlindIndex ?? -1),
      };
    }

    const nextSeat = (start) => {
      for (let step = 0; step < list.length; step += 1) {
        const idx = (start + step + list.length) % list.length;
        if (list[idx]) return idx;
      }
      return -1;
    };

    const currentButton = Number(this.state?.buttonIndex ?? -1);
    const buttonIndex = nextSeat(currentButton + 1);
    const smallBlindIndex = nextSeat(buttonIndex + 1);
    const bigBlindIndex = nextSeat(smallBlindIndex + 1);
    return { buttonIndex, smallBlindIndex, bigBlindIndex };
  }

  handleBetAction() {
    if (!this.state || !this.state.inRound) return;
    const { me, current, toCall, maxRaiseBy } = this.getPlayerTurnContext();
    if (!me || !current || current.id !== this.playerId) return;
    const raiseBy = Math.min(Math.max(0, Number(this.raiseAmount || 0)), maxRaiseBy);
    if (raiseBy > 0) {
      this.sendAction("RAISE", { amount: raiseBy });
    } else if (toCall > 0) {
      this.sendAction("CALL");
    } else {
      this.sendAction("CHECK");
    }
  }

  updateStatus() {
    if (!this.ui.status || !this.state) return;
    if (!this.connectionReady) {
      this.ui.status.textContent = "Connecting to table...";
      return;
    }
    if (this.state.phase === "showdown") {
      this.ui.status.textContent = "Round complete. Clearing soon...";
      return;
    }
    if (!this.state.inRound) {
      const isHost = this.state.hostId ? this.state.hostId === this.playerId : false;
      this.ui.status.textContent = isHost
        ? "PRESS START ROUND TO BEGIN NEXT ROUND"
        : "WAITING FOR HOST TO START NEXT ROUND";
      return;
    }
    const current = this.state.players?.[this.state.turnIndex];
    const phase = String(this.state.phase || "preflop").toUpperCase();
    const bet = Number(this.state.currentBet || 0);
    this.ui.status.textContent = current
      ? `${phase} • Bet $${bet} • Turn: ${current.username}`
      : `${phase} • Round in progress.`;
  }
}
