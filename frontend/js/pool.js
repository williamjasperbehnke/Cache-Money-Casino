import { state, showCenterToast, playSfx, triggerBigWin, triggerSmallWin } from "./core.js";

const SOLIDS = new Set([1, 2, 3, 4, 5, 6, 7]);
const STRIPES = new Set([9, 10, 11, 12, 13, 14, 15]);

const POCKETS = {
  tl: { label: "Top Left", x: 0.04, y: 0.05 },
  tc: { label: "Top Center", x: 0.5, y: 0.02 },
  tr: { label: "Top Right", x: 0.96, y: 0.05 },
  bl: { label: "Bottom Left", x: 0.04, y: 0.95 },
  bc: { label: "Bottom Center", x: 0.5, y: 0.98 },
  br: { label: "Bottom Right", x: 0.96, y: 0.95 },
};

const BALL_COLORS = {
  1: "#facc15",
  2: "#3b82f6",
  3: "#ef4444",
  4: "#a855f7",
  5: "#fb923c",
  6: "#22c55e",
  7: "#b91c1c",
  8: "#0f172a",
  9: "#facc15",
  10: "#3b82f6",
  11: "#ef4444",
  12: "#a855f7",
  13: "#fb923c",
  14: "#22c55e",
  15: "#b91c1c",
};

const PHYSICS = {
  friction: 0.98,
  cushionRestitution: 0.883,
  ballRestitution: 0.97,
  minSpeed: 0.01,
  maxShotSpeed: 18,
  maxPull: 140,
};


function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function distance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export class PoolGame {
  constructor() {
    this.ui = {};
    this.animFrame = null;
    this.lastTs = 0;
    this.tableRect = { width: 0, height: 0 };
    this.ballRadius = 10;
    this.pocketRadius = 18;
    this.borderInset = 10;
    this.shotActive = false;
    this.cueContact = false;
    this.spin = { x: 0, y: 0 };
    this.aim = {
      active: false,
      start: { x: 0, y: 0 },
      current: { x: 0, y: 0 },
      target: { x: 0, y: 0 },
      power: 0,
    };
  }

  cacheElements() {
    this.ui = {
      startBtn: document.getElementById("poolStart"),
      rerackBtn: document.getElementById("poolRerack"),
      status: document.getElementById("poolStatus"),
      foul: document.getElementById("poolFoul"),
      turn: document.getElementById("poolTurn"),
      playerGroup: document.getElementById("poolPlayerGroup"),
      remaining: document.getElementById("poolRemaining"),
      powerReadout: document.getElementById("poolPowerReadout"),
      powerFill: document.getElementById("poolPowerFill"),
      rackP1: document.getElementById("poolRackP1"),
      rackP2: document.getElementById("poolRackP2"),
      rackP1Card: document.getElementById("poolRackP1Card"),
      rackP2Card: document.getElementById("poolRackP2Card"),
      table: document.getElementById("poolTable"),
      balls: document.getElementById("poolBalls"),
      aim: document.getElementById("poolAimLine"),
      preview: document.getElementById("poolPreviewLine"),
      previewBounce: document.getElementById("poolPreviewBounce"),
      ghostPath: document.getElementById("poolGhostPath"),
      ghost: document.getElementById("poolGhostBall"),
      ghostCushion: document.getElementById("poolGhostCushion"),
      spinControl: document.getElementById("poolSpinControl"),
      spinDot: document.getElementById("poolSpinDot"),
    };
  }

  init() {
    this.cacheElements();
    this.bindControls();
    this.resizeTable();
    window.addEventListener("resize", () => this.handleResize());
    this.renderAll();
    this.tick = this.tick.bind(this);
    this.animFrame = requestAnimationFrame(this.tick);
  }

  serializeState() {
    return {
      ...state.pool,
      table: { width: this.tableRect.width, height: this.tableRect.height },
    };
  }

  restoreFromSaved(saved) {
    if (!saved) return;
    Object.assign(state.pool, {
      inRound: Boolean(saved.inRound),
      turn: "player",
      currentPlayer: Number(saved.currentPlayer) || 1,
      player1Group: saved.player1Group || "",
      player2Group: saved.player2Group || "",
      winner: saved.winner || "",
      ballInHand: Boolean(saved.ballInHand),
      calledPocket: saved.calledPocket || "",
      balls: Array.isArray(saved.balls) ? saved.balls : [],
    });
    const prevTable = saved.table || null;
    if (prevTable && prevTable.width && prevTable.height) {
      this.scaleBallPositions(prevTable.width, prevTable.height);
    }
    this.renderAll();
  }

  bindControls() {
    this.ui.startBtn?.addEventListener("click", () => this.startRound());
    this.ui.rerackBtn?.addEventListener("click", () => this.reRack());

    this.ui.table?.addEventListener("click", (event) => this.onTableClick(event));
    this.ui.table?.querySelectorAll(".pool-pocket").forEach((pocket) => {
      pocket.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
      });
      pocket.addEventListener("click", (event) => {
        event.stopPropagation();
        this.onTableClick(event);
      });
    });

    this.ui.table?.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    window.addEventListener("pointermove", (event) => this.onPointerMove(event));
    window.addEventListener("pointerup", () => this.onPointerUp());

    this.ui.spinControl?.addEventListener("pointerdown", (event) =>
      this.onSpinPointer(event)
    );
  }

  getCurrentPlayer() {
    return state.pool.currentPlayer || 1;
  }

  getOtherPlayer() {
    return this.getCurrentPlayer() === 1 ? 2 : 1;
  }

  getCurrentGroup() {
    return this.getCurrentPlayer() === 1 ? state.pool.player1Group : state.pool.player2Group;
  }

  setCurrentGroup(group) {
    if (this.getCurrentPlayer() === 1) {
      state.pool.player1Group = group;
      state.pool.player2Group = group === "solid" ? "stripe" : "solid";
    } else {
      state.pool.player2Group = group;
      state.pool.player1Group = group === "solid" ? "stripe" : "solid";
    }
  }

  switchTurn() {
    state.pool.currentPlayer = this.getOtherPlayer();
  }

  handleResize() {
    if (!this.ui.table) return;
    const prev = { ...this.tableRect };
    this.resizeTable();
    if (prev.width && prev.height) {
      this.scaleBallPositions(prev.width, prev.height);
    }
  }

  resizeTable() {
    if (!this.ui.table) return;
    const rect = this.ui.table.getBoundingClientRect();
    this.tableRect = { width: rect.width, height: rect.height };
    const minDim = Math.min(rect.width, rect.height);
    this.ballRadius = Math.max(10, minDim * 0.03);
    this.pocketRadius = Math.max(this.ballRadius * 1.6, minDim * 0.07);
    this.updatePocketLayout();
  }

  scaleBallPositions(prevWidth, prevHeight) {
    if (!prevWidth || !prevHeight) return;
    const scaleX = this.tableRect.width / prevWidth;
    const scaleY = this.tableRect.height / prevHeight;
    state.pool.balls.forEach((ball) => {
      ball.x *= scaleX;
      ball.y *= scaleY;
      ball.vx *= scaleX;
      ball.vy *= scaleY;
    });
  }

  buildRack() {
    const balls = [];
    const cue = {
      id: "cue",
      number: 0,
      group: "cue",
      x: this.tableRect.width * 0.24,
      y: this.tableRect.height * 0.5,
      vx: 0,
      vy: 0,
      spinSide: 0,
      spinForward: 0,
      pocketed: false,
    };
    balls.push(cue);

    const rackNumbers = shuffle([1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15]);
    const rack = [];
    const spacing = this.ballRadius * 2.05;
    const baseX = this.tableRect.width * 0.68;
    const baseY = this.tableRect.height * 0.5;
    let index = 0;
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col <= row; col += 1) {
        const pos = {
          x: baseX + row * spacing,
          y: baseY - (row * spacing) / 2 + col * spacing,
        };
        if (row === 2 && col === 1) {
          rack.push({ number: 8, ...pos });
        } else {
          rack.push({ number: rackNumbers[index], ...pos });
          index += 1;
        }
      }
    }

    rack.forEach((entry) => {
      balls.push({
        id: `ball-${entry.number}`,
        number: entry.number,
        group: this.getGroup(entry.number),
        x: entry.x,
        y: entry.y,
        vx: 0,
        vy: 0,
        pocketed: false,
      });
    });

    return balls;
  }

  getGroup(number) {
    if (number === 0) return "cue";
    if (number === 8) return "eight";
    if (SOLIDS.has(number)) return "solid";
    return "stripe";
  }

  startRound() {
    if (state.pool.inRound) return;
    state.pool.inRound = true;
    state.pool.currentPlayer = 1;
    state.pool.player1Group = "";
    state.pool.player2Group = "";
    state.pool.winner = "";
    state.pool.ballInHand = false;
    state.pool.calledPocket = "";
    state.pool.balls = this.buildRack();
    playSfx("hit");
    showCenterToast("Break shot!", "win");
    this.renderAll();
  }

  reRack() {
    state.pool.inRound = false;
    state.pool.winner = "";
    state.pool.currentPlayer = 1;
    state.pool.player1Group = "";
    state.pool.player2Group = "";
    state.pool.ballInHand = false;
    state.pool.calledPocket = "";
    state.pool.balls = [];
    this.shotActive = false;
    this.cueContact = false;
    this.shotFoul = false;
    this.shotOwnSunk = false;
    this.aim.active = false;
    this.renderAll();
  }

  updateHUD() {
    if (this.ui.status) {
      if (!state.pool.inRound) {
        this.ui.status.textContent = "Rack the table to start.";
      } else if (state.pool.winner) {
        this.ui.status.textContent =
          state.pool.winner === "player1" ? "Player 1 won the rack." : "Player 2 won the rack.";
      } else if (state.pool.ballInHand) {
        this.ui.status.textContent = "Ball in hand. Click the table to place the cue ball.";
      } else {
        this.ui.status.textContent = "Drag from the cue ball to shoot.";
      }
    }

    if (this.ui.foul) {
      this.ui.foul.textContent = state.pool.ballInHand ? "Ball in hand" : "Clean shot";
    }

    if (this.ui.turn) {
      this.ui.turn.textContent = `Player ${this.getCurrentPlayer()}`;
    }

    if (this.ui.playerGroup) {
      const group = this.getCurrentGroup();
      this.ui.playerGroup.textContent = group
        ? group === "solid"
          ? "Solids"
          : "Stripes"
        : "Unassigned";
    }

    if (this.ui.remaining) {
      const remaining = state.pool.balls.filter(
        (ball) => ball.group !== "cue" && !ball.pocketed
      ).length;
      this.ui.remaining.textContent = String(remaining);
    }

    if (this.ui.powerReadout) {
      this.ui.powerReadout.textContent = `${Math.round(this.aim.power * 100)}%`;
    }
    if (this.ui.powerFill) {
      this.ui.powerFill.style.width = `${Math.round(this.aim.power * 100)}%`;
    }

    this.updateSpinDot();
    this.renderRack();
  }

  updateSpinDot() {
    if (!this.ui.spinControl || !this.ui.spinDot) return;
    const { x, y } = this.spin || { x: 0, y: 0 };
    const radius = this.ui.spinControl.clientWidth / 2;
    const dotX = radius + x * radius * 0.7;
    const dotY = radius + y * radius * 0.7;
    this.ui.spinDot.style.left = `${dotX}px`;
    this.ui.spinDot.style.top = `${dotY}px`;
  }

  renderRack() {
    if (!this.ui.rackP1 || !this.ui.rackP2) return;
    const remaining = state.pool.balls.filter((ball) => !ball.pocketed && ball.group !== "cue");
    const renderFor = (container, group, fallbackLabel) => {
      container.innerHTML = "";
      if (!group) return;
      remaining
        .filter((ball) => ball.group === group)
        .sort((a, b) => a.number - b.number)
        .forEach((ball) => {
          const chip = document.createElement("div");
          chip.className = "pool-rack-ball";
          if (ball.group === "stripe") chip.classList.add("stripe");
          if (ball.group === "solid") chip.classList.add("solid");
          if (ball.group === "eight") chip.classList.add("eight");
          const label = document.createElement("span");
          label.textContent = String(ball.number);
          chip.appendChild(label);
          if (ball.number && BALL_COLORS[ball.number]) {
            chip.style.setProperty("--ball-color", BALL_COLORS[ball.number]);
          }
          container.appendChild(chip);
        });
    };

    renderFor(this.ui.rackP1, state.pool.player1Group, "P1");
    renderFor(this.ui.rackP2, state.pool.player2Group, "P2");

    const renderUnknown = (container) => {
      container.innerHTML = "";
      for (let i = 0; i < 7; i += 1) {
        const chip = document.createElement("div");
        chip.className = "pool-rack-ball unknown";
        const label = document.createElement("span");
        label.textContent = "?";
        chip.appendChild(label);
        container.appendChild(chip);
      }
    };

    if (!state.pool.player1Group) renderUnknown(this.ui.rackP1);
    if (!state.pool.player2Group) renderUnknown(this.ui.rackP2);

    if (this.ui.rackP1Card) {
      this.ui.rackP1Card.classList.toggle("active", this.getCurrentPlayer() === 1);
    }
    if (this.ui.rackP2Card) {
      this.ui.rackP2Card.classList.toggle("active", this.getCurrentPlayer() === 2);
    }
  }

  renderCallPocket() {
    const onEight = this.isOnEightBall();
    this.ui.table?.querySelectorAll(".pool-pocket").forEach((button) => {
      button.classList.toggle("active", onEight && button.dataset.pocket === state.pool.calledPocket);
      button.disabled = !onEight;
      button.classList.toggle("disabled", !onEight);
    });
  }

  isOnEightBall() {
    const group = this.getCurrentGroup();
    if (!group) return false;
    return this.isGroupCleared(group);
  }

  renderBalls() {
    if (!this.ui.balls) return;
    this.ui.balls.innerHTML = "";
    state.pool.balls.forEach((ball) => {
      if (ball.pocketed) return;
      const el = document.createElement("div");
      el.className = `pool-ball ${ball.group}`;
      if (ball.group === "stripe") el.classList.add("stripe");
      if (ball.group === "solid") el.classList.add("solid");
      if (ball.group === "eight") el.classList.add("eight");
      if (ball.group === "cue") el.classList.add("cue");
      el.dataset.id = ball.id;
      el.dataset.number = String(ball.number);
      el.style.left = `${ball.x}px`;
      el.style.top = `${ball.y}px`;
      el.style.width = `${this.ballRadius * 2}px`;
      el.style.height = `${this.ballRadius * 2}px`;
      if (ball.number && BALL_COLORS[ball.number]) {
        el.style.setProperty("--ball-color", BALL_COLORS[ball.number]);
      }
      if (ball.number > 0) {
        const label = document.createElement("span");
        label.textContent = String(ball.number);
        el.appendChild(label);
      }
      this.ui.balls.appendChild(el);
    });
  }

  renderAimLine() {
    if (!this.ui.aim) return;
    const cue = this.getCueBall();
    if (!cue || !state.pool.inRound || state.pool.ballInHand || !this.aim.active) {
      this.ui.aim.style.opacity = "0";
      if (this.ui.preview) this.ui.preview.style.opacity = "0";
      if (this.ui.previewBounce) this.ui.previewBounce.style.opacity = "0";
      if (this.ui.ghostPath) this.ui.ghostPath.style.opacity = "0";
      if (this.ui.ghost) this.ui.ghost.style.opacity = "0";
      if (this.ui.ghostCushion) this.ui.ghostCushion.style.opacity = "0";
      return;
    }
    const dx = cue.x - this.aim.current.x;
    const dy = cue.y - this.aim.current.y;
    const length = Math.hypot(dx, dy);
    if (length < 4) {
      this.ui.aim.style.opacity = "0";
      if (this.ui.preview) this.ui.preview.style.opacity = "0";
      if (this.ui.previewBounce) this.ui.previewBounce.style.opacity = "0";
      if (this.ui.ghostPath) this.ui.ghostPath.style.opacity = "0";
      if (this.ui.ghost) this.ui.ghost.style.opacity = "0";
      if (this.ui.ghostCushion) this.ui.ghostCushion.style.opacity = "0";
      return;
    }
    const angle = Math.atan2(-dy, -dx) * (180 / Math.PI);
    const displayLength = clamp(length, 0, PHYSICS.maxPull);
    this.ui.aim.style.opacity = "1";
    this.ui.aim.style.width = `${displayLength}px`;
    this.ui.aim.style.transform = `translate(${cue.x}px, ${cue.y}px) rotate(${angle}deg)`;
    this.renderShotPreview(cue, dx, dy, length, this.aim.power);
  }

  renderShotPreview(cue, dx, dy, pullLength, power = 0) {
    if (!this.ui.preview || !this.ui.ghost) return;
    const dirX = dx / (pullLength || 1);
    const dirY = dy / (pullLength || 1);
    const radius = this.ballRadius;
    const powerScale = clamp(power, 0.1, 1);
    const estCueSpeed = PHYSICS.maxShotSpeed * powerScale;
    const friction = clamp(PHYSICS.friction, 0.9, 0.999);
    const bounds = {
      minX: radius,
      maxX: this.tableRect.width - radius - 2 * this.borderInset,
      minY: radius,
      maxY: this.tableRect.height - radius - 2 * this.borderInset,
    };
    let closest = null;
    let closestT = Infinity;

    state.pool.balls.forEach((ball) => {
      if (ball.pocketed || ball.group === "cue") return;
      const relX = ball.x - cue.x;
      const relY = ball.y - cue.y;
      const tca = relX * dirX + relY * dirY;
      if (tca <= 0) return;
      const perpX = relX - dirX * tca;
      const perpY = relY - dirY * tca;
      const d2 = perpX * perpX + perpY * perpY;
      const minDist = radius * 2;
      const r2 = minDist * minDist;
      if (d2 <= r2) {
        const thc = Math.sqrt(r2 - d2);
        const tHit = tca - thc > 0 ? tca - thc : tca + thc;
        if (tHit > 0 && tHit < closestT) {
          closestT = tHit;
          closest = ball;
        }
      }
    });

    let wallT = Infinity;
    let wallHit = "";
    if (dirX > 0) {
      const t = (bounds.maxX - cue.x) / dirX;
      if (t > 0 && t < wallT) {
        wallT = t;
        wallHit = "right";
      }
    } else if (dirX < 0) {
      const t = (bounds.minX - cue.x) / dirX;
      if (t > 0 && t < wallT) {
        wallT = t;
        wallHit = "left";
      }
    }
    if (dirY > 0) {
      const t = (bounds.maxY - cue.y) / dirY;
      if (t > 0 && t < wallT) {
        wallT = t;
        wallHit = "bottom";
      }
    } else if (dirY < 0) {
      const t = (bounds.minY - cue.y) / dirY;
      if (t > 0 && t < wallT) {
        wallT = t;
        wallHit = "top";
      }
    }

    const hitBall = closest && closestT < wallT;
    if (hitBall) {
      if (this.ui.previewBounce) this.ui.previewBounce.style.opacity = "0";
      if (this.ui.ghostPath) this.ui.ghostPath.style.opacity = "0";
      if (this.ui.ghostCushion) this.ui.ghostCushion.style.opacity = "0";
      const contactDist = Math.max(0, closestT);
      const contactX = cue.x + dirX * contactDist;
      const contactY = cue.y + dirY * contactDist;

      const angle = Math.atan2(dirY, dirX) * (180 / Math.PI);
      this.ui.preview.style.opacity = "1";
      this.ui.preview.style.width = `${contactDist}px`;
      this.ui.preview.style.transform = `translate(${cue.x}px, ${cue.y}px) rotate(${angle}deg)`;

      this.ui.ghost.style.opacity = "1";
      this.ui.ghost.style.width = `${radius * 2}px`;
      this.ui.ghost.style.height = `${radius * 2}px`;
      this.ui.ghost.style.transform = `translate(${contactX}px, ${contactY}px) translate(-50%, -50%)`;
      if (this.ui.ghostCushion) this.ui.ghostCushion.style.opacity = "0";
      if (this.ui.ghostPath) {
        const outDx = closest.x - contactX;
        const outDy = closest.y - contactY;
        const outLen = Math.hypot(outDx, outDy);
        if (outLen > 0.1) {
          const nX = outDx / outLen;
          const nY = outDy / outLen;
          const cosTheta = clamp(dirX * nX + dirY * nY, 0, 1);
          const contactDecay = Math.pow(friction, contactDist / Math.max(1, radius * 2));
          const estCueAtContact = estCueSpeed * contactDecay;
          const estTargetSpeed = estCueAtContact * cosTheta * PHYSICS.ballRestitution;
          const estRange = estTargetSpeed / Math.max(0.01, 1 - friction);
          const outAngle = Math.atan2(nY, nX) * (180 / Math.PI);
          const outLength = Math.min(estRange, this.tableRect.width * 1.2);
          this.ui.ghostPath.style.opacity = "1";
          this.ui.ghostPath.style.width = `${outLength}px`;
          this.ui.ghostPath.style.transform = `translate(${closest.x}px, ${closest.y}px) rotate(${outAngle}deg)`;
        } else {
          this.ui.ghostPath.style.opacity = "0";
        }
      }
      return;
    }

    if (!Number.isFinite(wallT)) {
      this.ui.preview.style.opacity = "0";
      if (this.ui.previewBounce) this.ui.previewBounce.style.opacity = "0";
      if (this.ui.ghostPath) this.ui.ghostPath.style.opacity = "0";
      this.ui.ghost.style.opacity = "0";
      if (this.ui.ghostCushion) this.ui.ghostCushion.style.opacity = "0";
      return;
    }

    const wallX = cue.x + dirX * wallT;
    const wallY = cue.y + dirY * wallT;
    const angle = Math.atan2(dirY, dirX) * (180 / Math.PI);
    this.ui.preview.style.opacity = "1";
    this.ui.preview.style.width = `${wallT}px`;
    this.ui.preview.style.transform = `translate(${cue.x}px, ${cue.y}px) rotate(${angle}deg)`;
    this.ui.ghost.style.opacity = "0";
    if (this.ui.ghostPath) this.ui.ghostPath.style.opacity = "0";
    if (this.ui.ghostCushion) {
      this.ui.ghostCushion.style.opacity = "1";
      this.ui.ghostCushion.style.width = `${radius * 2}px`;
      this.ui.ghostCushion.style.height = `${radius * 2}px`;
      this.ui.ghostCushion.style.transform = `translate(${wallX}px, ${wallY}px) translate(-50%, -50%)`;
    }

    let bounceDirX = dirX;
    let bounceDirY = dirY;
    if (wallHit === "left" || wallHit === "right") bounceDirX = -dirX;
    if (wallHit === "top" || wallHit === "bottom") bounceDirY = -dirY;

    if (this.ui.previewBounce) {
      const bounceLen = Math.min(180, this.tableRect.width);
      const bounceAngle = Math.atan2(bounceDirY, bounceDirX) * (180 / Math.PI);
      this.ui.previewBounce.style.opacity = "1";
      this.ui.previewBounce.style.width = `${bounceLen}px`;
      this.ui.previewBounce.style.transform = `translate(${wallX}px, ${wallY}px) rotate(${bounceAngle}deg)`;
    }
  }

  renderAll() {
    this.updateHUD();
    this.renderCallPocket();
    this.renderBalls();
    this.renderAimLine();
    const onEight = this.isOnEightBall();
    this.ui.table?.querySelectorAll(".pool-pocket").forEach((button) => {
      button.disabled = !onEight;
      button.classList.toggle("disabled", !onEight);
      button.classList.toggle("active", onEight && button.dataset.pocket === state.pool.calledPocket);
    });
    if (this.ui.startBtn) {
      this.ui.startBtn.disabled = state.pool.inRound;
      this.ui.startBtn.classList.toggle("hidden", state.pool.inRound);
    }
    if (this.ui.rerackBtn) {
      this.ui.rerackBtn.disabled = false;
      this.ui.rerackBtn.classList.toggle("hidden", !state.pool.inRound);
    }
  }

  getCueBall() {
    return state.pool.balls.find((ball) => ball.group === "cue");
  }

  onPointerDown(event) {
    if (!state.pool.inRound || state.pool.winner) return;
    if (event.target.closest && event.target.closest(".pool-pocket")) return;
    if (this.isPointerOnPocket(event)) return;
    if (state.pool.ballInHand) {
      this.placeCueBall(event);
      return;
    }
    if (this.isBallsMoving()) return;
    if (this.isOnEightBall() && !state.pool.calledPocket) {
      showCenterToast("Call a pocket before shooting the 8-ball.", "danger");
      return;
    }
    const cue = this.getCueBall();
    if (!cue) return;
    const pos = this.getPointerPos(event);
    if (!pos) return;
    this.aim.active = true;
    this.aim.start = { x: cue.x, y: cue.y };
    this.aim.current = { ...pos };
    this.aim.target = { ...pos };
    this.aim.power = 0;
    this.renderAimLine();
  }

  isPointerOnPocket(event) {
    const pos = this.getPointerPos(event);
    if (!pos) return false;
    return Object.entries(this.getPocketCenters()).some(([key, pocket]) => {
      const dist = Math.hypot(pos.x - pocket.x, pos.y - pocket.y);
      return dist <= this.getPocketHitRadius(key);
    });
  }

  getPocketCenters() {
    const inset = 20;
    const shift = 6;
    return {
      tl: {
        x: this.ballRadius * 0.8 - shift,
        y: this.ballRadius * 0.8 - shift,
      },
      tc: { x: this.tableRect.width * 0.5, y: this.ballRadius * 0.5 - shift },
      tr: {
        x: this.tableRect.width - this.ballRadius * 0.8 - inset + shift,
        y: this.ballRadius * 0.8 - shift,
      },
      bl: {
        x: this.ballRadius * 0.8 - shift,
        y: this.tableRect.height - this.ballRadius * 0.8 - inset + shift,
      },
      bc: {
        x: this.tableRect.width * 0.5,
        y: this.tableRect.height - this.ballRadius * 0.5 - inset + shift,
      },
      br: {
        x: this.tableRect.width - this.ballRadius * 0.8 - inset + shift,
        y: this.tableRect.height - this.ballRadius * 0.8 - inset + shift,
      },
    };
  }

  getPocketHitRadius(key) {
    const cornerFactor = 1.2;
    const sideFactor = 0.7;
    const isSide = key === "tc" || key === "bc";
    const pocketRadius = this.pocketRadius * (isSide ? sideFactor : cornerFactor);
    return pocketRadius + this.ballRadius;
  }

  updatePocketLayout() {
    if (!this.ui.table) return;
    const centers = this.getPocketCenters();
    this.ui.table.querySelectorAll(".pool-pocket").forEach((pocket) => {
      const key = pocket.dataset.pocket;
      if (!key || !centers[key]) return;
      const hitRadius = this.getPocketHitRadius(key);
      pocket.style.width = `${hitRadius * 2}px`;
      pocket.style.height = `${hitRadius * 2}px`;
      pocket.style.left = `${centers[key].x}px`;
      pocket.style.top = `${centers[key].y}px`;
      pocket.style.transform = "translate(-50%, -50%)";
    });
  }

  onTableClick(event) {
    if (!state.pool.inRound || state.pool.winner) return;
    if (!this.isOnEightBall()) return;
    const pocketButton = event.target.closest(".pool-pocket");
    if (!pocketButton) return;
    const pocket = pocketButton.dataset.pocket;
    if (!pocket) return;
    state.pool.calledPocket = pocket;
    this.renderCallPocket();
    playSfx("hit");
  }

  onPointerMove(event) {
    if (!this.aim.active) return;
    const pos = this.getPointerPos(event);
    if (!pos) return;
    const cue = this.getCueBall();
    if (!cue) return;
    const dx = cue.x - pos.x;
    const dy = cue.y - pos.y;
    const pull = clamp(Math.hypot(dx, dy), 0, PHYSICS.maxPull);
    this.aim.target = { ...pos };
    this.aim.power = pull / PHYSICS.maxPull;
    this.renderAimLine();
    this.updateHUD();
  }


  onPointerUp() {
    if (!this.aim.active) return;
    const cue = this.getCueBall();
    if (!cue) return;
    const dx = cue.x - this.aim.current.x;
    const dy = cue.y - this.aim.current.y;
    const pull = clamp(Math.hypot(dx, dy), 0, PHYSICS.maxPull);
    const power = pull / PHYSICS.maxPull;
    if (power > 0.05) {
      const dirX = dx / (pull || 1);
      const dirY = dy / (pull || 1);
      const speed = PHYSICS.maxShotSpeed * power;
      const spin = this.spin || { x: 0, y: 0 };
      const spinForward = -spin.y;
      const spinSide = spin.x;
      const fwdX = dirX;
      const fwdY = dirY;
      const sideX = -dirY;
      const sideY = dirX;
      cue.vx = dirX * speed + (spinForward * fwdX + spinSide * sideX) * speed * 0.4;
      cue.vy = dirY * speed + (spinForward * fwdY + spinSide * sideY) * speed * 0.4;
      cue.spinSide = spinSide;
      cue.spinForward = spinForward;
      this.spin = { x: 0, y: 0 };
      this.updateSpinDot();
      this.shotActive = true;
      this.cueContact = false;
      this.shotFoul = false;
      this.shotOwnSunk = false;
      playSfx("hit");
    }
    this.aim.active = false;
    this.aim.power = 0;
    this.renderAimLine();
    this.updateHUD();
  }

  onSpinPointer(event) {
    if (!this.ui.spinControl) return;
    const rect = this.ui.spinControl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = event.clientX - cx;
    const dy = event.clientY - cy;
    const radius = rect.width / 2;
    const normX = clamp(dx / (radius * 0.7), -1, 1);
    const normY = clamp(dy / (radius * 0.7), -1, 1);
    this.spin = { x: normX, y: normY };
    this.updateSpinDot();
  }

  getPointerPos(event) {
    if (!this.ui.table) return null;
    const rect = this.ui.table.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return { x, y };
  }

  placeCueBall(event) {
    const cue = this.getCueBall();
    if (!cue) return;
    const pos = this.getPointerPos(event);
    if (!pos) return;
    cue.x = clamp(pos.x, this.ballRadius * 1.2, this.tableRect.width - this.ballRadius * 1.2);
    cue.y = clamp(pos.y, this.ballRadius * 1.2, this.tableRect.height - this.ballRadius * 1.2);
    cue.vx = 0;
    cue.vy = 0;
    cue.pocketed = false;
    state.pool.ballInHand = false;
    this.renderAll();
  }

  isBallsMoving() {
    return state.pool.balls.some((ball) => Math.hypot(ball.vx, ball.vy) > PHYSICS.minSpeed);
  }

  tick(ts) {
    if (!this.lastTs) this.lastTs = ts;
    const delta = Math.min(32, ts - this.lastTs);
    const dt = delta / 16.67;
    this.lastTs = ts;

    if (state.pool.inRound) {
      this.stepPhysics(dt);
    }

    if (this.aim.active && this.aim.target) {
      const lerp = 0.28;
      this.aim.current.x += (this.aim.target.x - this.aim.current.x) * lerp;
      this.aim.current.y += (this.aim.target.y - this.aim.current.y) * lerp;
    }

    this.renderBalls();
    this.renderAimLine();
    if (state.pool.inRound && !this.isBallsMoving() && state.pool.ballInHand) {
      // no-op: hint removed from UI
    }

    this.animFrame = requestAnimationFrame(this.tick);
  }

  stepPhysics(dt) {
    const balls = state.pool.balls.filter((ball) => !ball.pocketed);
    const radius = this.ballRadius;
    const bounds = {
      minX: radius,
      maxX: this.tableRect.width - radius - 2 * this.borderInset,
      minY: radius,
      maxY: this.tableRect.height - radius - 2 * this.borderInset,
    };

    const maxSpeed = balls.reduce(
      (max, ball) => Math.max(max, Math.hypot(ball.vx, ball.vy)),
      0
    );
    const steps = Math.min(4, Math.max(1, Math.ceil(maxSpeed / 8)));
    const stepDt = dt / steps;

    for (let step = 0; step < steps; step += 1) {
      balls.forEach((ball) => {
        ball.x += ball.vx * stepDt;
        ball.y += ball.vy * stepDt;
        ball.vx *= Math.pow(PHYSICS.friction, stepDt);
        ball.vy *= Math.pow(PHYSICS.friction, stepDt);

        if (Math.abs(ball.vx) < PHYSICS.minSpeed) ball.vx = 0;
        if (Math.abs(ball.vy) < PHYSICS.minSpeed) ball.vy = 0;

        if (ball.x < bounds.minX) {
          ball.x = bounds.minX;
          ball.vx = -ball.vx * PHYSICS.cushionRestitution;
        }
        if (ball.x > bounds.maxX) {
          ball.x = bounds.maxX;
          ball.vx = -ball.vx * PHYSICS.cushionRestitution;
        }
        if (ball.y < bounds.minY) {
          ball.y = bounds.minY;
          ball.vy = -ball.vy * PHYSICS.cushionRestitution;
        }
        if (ball.y > bounds.maxY) {
          ball.y = bounds.maxY;
          ball.vy = -ball.vy * PHYSICS.cushionRestitution;
        }
      });

      for (let i = 0; i < balls.length; i += 1) {
        for (let j = i + 1; j < balls.length; j += 1) {
          const a = balls[i];
          const b = balls[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy);
          const minDist = radius * 2;
          if (dist > 0 && dist < minDist) {
            const nx = dx / dist;
            const ny = dy / dist;
            const overlap = minDist - dist;
            a.x -= nx * overlap * 0.5;
            a.y -= ny * overlap * 0.5;
            b.x += nx * overlap * 0.5;
            b.y += ny * overlap * 0.5;

            const dvx = b.vx - a.vx;
            const dvy = b.vy - a.vy;
            const relVel = dvx * nx + dvy * ny;
          if (relVel < 0) {
            const impulse = -(1.0 + PHYSICS.ballRestitution) * relVel / 2;
            const ix = impulse * nx;
            const iy = impulse * ny;
            a.vx -= ix;
            a.vy -= iy;
            b.vx += ix;
            b.vy += iy;
          }
          if (a.group === "cue" || b.group === "cue") {
            this.cueContact = true;
            const cue = a.group === "cue" ? a : b;
            if (cue.spinSide || cue.spinForward) {
              const speed = Math.hypot(cue.vx, cue.vy);
              const normalX = a.group === "cue" ? nx : -nx;
              const normalY = a.group === "cue" ? ny : -ny;
              const tangentX = -normalY;
              const tangentY = normalX;
              const sideFactor = 0.2;
              const forwardFactor = 0.14;
              cue.vx += (tangentX * cue.spinSide + normalX * cue.spinForward) * speed * sideFactor;
              cue.vy += (tangentY * cue.spinSide + normalY * cue.spinForward) * speed * sideFactor;
              cue.spinSide *= 0.6;
              cue.spinForward *= 0.6;
            }
          }
        }
      }
    }
    }

    const pocketed = [];
    const pocketCenters = this.getPocketCenters();
    Object.entries(POCKETS).forEach(([key]) => {
      const pocket = pocketCenters[key];
      const px = pocket.x;
      const py = pocket.y;
      const pocketRadius = this.getPocketHitRadius(key);
      balls.forEach((ball) => {
        if (ball.pocketed) return;
        const dist = Math.hypot(ball.x - px, ball.y - py);
        if (dist <= pocketRadius) {
          ball.pocketed = true;
          ball.vx = 0;
          ball.vy = 0;
          pocketed.push({ ball, pocket: key });
        }
      });
    });

    if (pocketed.length) {
      this.handlePocketed(pocketed);
    }

    if (this.shotActive && !this.isBallsMoving()) {
      let foul = false;
      const wasOnEight = this.isOnEightBall();
      if (!this.cueContact) {
        const cue = this.getCueBall();
        if (!cue || !cue.pocketed) {
          state.pool.ballInHand = true;
          playSfx("lose");
          showCenterToast("No contact! Ball in hand.", "danger");
          if (cue) {
            cue.vx = 0;
            cue.vy = 0;
            cue.pocketed = true;
          }
          foul = true;
        }
      }
      if (this.shotFoul) foul = true;
      const currentGroup = this.getCurrentGroup();
      const ownSunk = Boolean(this.shotOwnSunk);
      if (foul || (currentGroup && !ownSunk) || (!currentGroup && !ownSunk)) {
        this.switchTurn();
      }
      if (wasOnEight) {
        state.pool.calledPocket = "";
      }
      this.shotActive = false;
      this.cueContact = false;
      this.shotFoul = false;
      this.shotOwnSunk = false;
      this.renderAll();
    }
  }

  handlePocketed(entries) {
    const cueEntry = entries.find((entry) => entry.ball.group === "cue");
    if (cueEntry) {
      state.pool.ballInHand = true;
      cueEntry.ball.pocketed = true;
      playSfx("lose");
      showCenterToast("Scratch! Ball in hand.", "danger");
      this.shotFoul = true;
    }

    const objectEntries = entries.filter((entry) => entry.ball.group !== "cue");
    if (!objectEntries.length) {
      return;
    }

    if (!state.pool.player1Group && !state.pool.player2Group) {
      const first = objectEntries.find(
        (entry) => entry.ball.group === "solid" || entry.ball.group === "stripe"
      );
      if (first) {
        this.setCurrentGroup(first.ball.group);
      }
    }

    const currentGroup = this.getCurrentGroup();
    let sankOpponent = false;
    if (currentGroup) {
      sankOpponent = objectEntries.some(
        (entry) =>
          (entry.ball.group === "solid" || entry.ball.group === "stripe") &&
          entry.ball.group !== currentGroup
      );
      if (sankOpponent) {
        playSfx("lose");
      }
      const sunkOwn = objectEntries.some((entry) => entry.ball.group === currentGroup);
      if (sunkOwn) this.shotOwnSunk = true;
    }

    const eightEntry = objectEntries.find((entry) => entry.ball.group === "eight");
    if (eightEntry) {
      const groupCleared = currentGroup ? this.isGroupCleared(currentGroup) : false;
      const calledOk = state.pool.calledPocket === eightEntry.pocket;
      const winner =
        groupCleared && !this.shotFoul && calledOk ? this.getCurrentPlayer() : this.getOtherPlayer();
      state.pool.calledPocket = "";
      this.finishRound(`player${winner}`);
      return;
    }

    if (objectEntries.length) {
      if (!sankOpponent) {
        playSfx("win");
        triggerSmallWin();
      }
      const labels = objectEntries.map((entry) => {
        if (entry.ball.group === "eight") return "8-ball";
        if (entry.ball.group === "cue") return "cue ball";
        return `#${entry.ball.number}`;
      });
      showCenterToast(`Sunk ${labels.join(", ")}.`, sankOpponent ? "danger" : "win");
    }

    if (currentGroup && this.isGroupCleared(currentGroup)) {
      showCenterToast("Eight ball is up.", "win");
    }

    this.renderAll();
  }

  isGroupCleared(group) {
    if (!group) return false;
    return state.pool.balls
      .filter((ball) => ball.group === group)
      .every((ball) => ball.pocketed);
  }

  finishRound(winner) {
    state.pool.winner = winner;
    state.pool.inRound = false;
    state.pool.ballInHand = false;

    if (winner === "player1") {
      playSfx("big");
      triggerBigWin();
      showCenterToast("Player 1 wins!", "win");
    } else {
      playSfx("lose");
      showCenterToast("Player 2 wins.", "danger");
    }

    this.renderAll();
  }
}
