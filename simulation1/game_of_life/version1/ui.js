"use strict";

(() => {
  // ---------- state ----------

  let engine = new LifeEngine();
  let running = false;
  let followGrowth = false;
  let showExtent = true;
  let tool = "draw"; // draw | erase | pan

  const camera = { cx: 0, cy: 0, scale: 14 }; // world center + px per cell
  const MIN_SCALE = 0.05;
  const MAX_SCALE = 80;

  let stepAccumulator = 0;
  let lastFrameTime = performance.now();
  let stepsThisSecond = 0;
  let gpsWindowStart = performance.now();
  let measuredGps = 0;

  const SAVES_KEY = "gol.saves.v1";

  // ---------- dom ----------

  const $ = (id) => document.getElementById(id);
  const canvas = $("canvas");
  const ctx = canvas.getContext("2d");
  const viewport = $("viewport");

  const btnRun = $("btn-run");
  const speedSlider = $("speed");
  const speedValue = $("speed-value");
  const statGen = $("stat-gen");
  const statPop = $("stat-pop");
  const statExtent = $("stat-extent");
  const statGps = $("stat-gps");
  const toast = $("toast");

  // ---------- helpers ----------

  function gpsFromSlider() {
    // 0..99 -> ~0.5..500 gens/sec, exponential; 100 -> unlimited (compute-bound)
    if (+speedSlider.value === 100) return Infinity;
    return Math.pow(10, -0.3 + (speedSlider.value / 100) * 3);
  }

  function fmtGps(v) {
    if (!isFinite(v)) return "MAX";
    if (v >= 1000) return (v / 1000).toFixed(1) + "k g/s";
    return (v >= 10 ? Math.round(v) : v.toFixed(1)) + " g/s";
  }

  let toastTimer = null;
  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 2200);
  }

  function screenToWorld(sx, sy) {
    return [
      (sx - canvas.clientWidth / 2) / camera.scale + camera.cx,
      (sy - canvas.clientHeight / 2) / camera.scale + camera.cy,
    ];
  }

  function fitToPattern(instant) {
    const bb = engine.boundingBox();
    if (!bb) return;
    const margin = 4;
    const w = bb.width + margin * 2;
    const h = bb.height + margin * 2;
    const targetScale = Math.min(
      MAX_SCALE,
      Math.max(MIN_SCALE, Math.min(canvas.clientWidth / w, canvas.clientHeight / h))
    );
    const tx = bb.minX + bb.width / 2;
    const ty = bb.minY + bb.height / 2;
    if (instant) {
      camera.scale = targetScale;
      camera.cx = tx;
      camera.cy = ty;
    } else {
      // smooth approach, used by follow-growth mode
      camera.scale += (targetScale - camera.scale) * 0.08;
      camera.cx += (tx - camera.cx) * 0.08;
      camera.cy += (ty - camera.cy) * 0.08;
    }
  }

  // ---------- canvas sizing ----------

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(viewport.clientWidth * dpr);
    canvas.height = Math.round(viewport.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener("resize", resizeCanvas);

  // ---------- rendering ----------

  function render() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    ctx.fillStyle = "#080a0f";
    ctx.fillRect(0, 0, w, h);

    const s = camera.scale;
    const halfW = w / 2;
    const halfH = h / 2;
    const worldLeft = camera.cx - halfW / s;
    const worldTop = camera.cy - halfH / s;
    const worldRight = camera.cx + halfW / s;
    const worldBottom = camera.cy + halfH / s;

    // grid
    if (s >= 10) {
      ctx.strokeStyle = "rgba(36, 44, 58, 0.55)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = Math.floor(worldLeft); x <= worldRight; x++) {
        const sx = Math.round((x - camera.cx) * s + halfW) + 0.5;
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, h);
      }
      for (let y = Math.floor(worldTop); y <= worldBottom; y++) {
        const sy = Math.round((y - camera.cy) * s + halfH) + 0.5;
        ctx.moveTo(0, sy);
        ctx.lineTo(w, sy);
      }
      ctx.stroke();
    }

    // origin crosshair
    {
      const ox = (0 - camera.cx) * s + halfW;
      const oy = (0 - camera.cy) * s + halfH;
      if (ox > -20 && ox < w + 20 && oy > -20 && oy < h + 20) {
        ctx.strokeStyle = "rgba(126, 136, 153, 0.35)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ox - 9, oy); ctx.lineTo(ox + 9, oy);
        ctx.moveTo(ox, oy - 9); ctx.lineTo(ox, oy + 9);
        ctx.stroke();
      }
    }

    // cells
    const gap = s >= 6 ? 1 : 0;
    const size = Math.max(s - gap, 0.75);
    ctx.fillStyle = "#ffb454";
    for (const key of engine.cells) {
      const x = Math.floor(key / 2097152) - 1048576;
      const y = (key % 2097152) - 1048576;
      if (x + 1 < worldLeft || x > worldRight || y + 1 < worldTop || y > worldBottom) continue;
      ctx.fillRect((x - camera.cx) * s + halfW, (y - camera.cy) * s + halfH, size, size);
    }

    // extent box
    if (showExtent) {
      const bb = engine.boundingBox();
      if (bb) {
        const bx = (bb.minX - camera.cx) * s + halfW;
        const by = (bb.minY - camera.cy) * s + halfH;
        const bw = bb.width * s;
        const bh = bb.height * s;
        ctx.strokeStyle = "rgba(255, 180, 84, 0.35)";
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 5]);
        ctx.strokeRect(bx - 3.5, by - 3.5, bw + 7, bh + 7);
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(255, 180, 84, 0.75)";
        ctx.font = "10px 'IBM Plex Mono', monospace";
        ctx.fillText(`${bb.width} × ${bb.height}`, bx - 3, by - 9);
      }
    }
  }

  // ---------- stats ----------

  function updateStats() {
    statGen.textContent = engine.generation.toLocaleString();
    statPop.textContent = engine.population.toLocaleString();
    const bb = engine.boundingBox();
    statExtent.textContent = bb ? `${bb.width} × ${bb.height}` : "—";
    statGps.textContent = running ? fmtGps(measuredGps) : "0 g/s";
  }

  // ---------- main loop ----------

  function frame(now) {
    const dt = Math.min((now - lastFrameTime) / 1000, 0.25);
    lastFrameTime = now;

    if (running) {
      const gps = gpsFromSlider();
      const budget = performance.now() + 28; // keep the frame responsive
      if (!isFinite(gps)) {
        // MAX mode: run as many generations as the frame budget allows
        stepAccumulator = 0;
        while (performance.now() < budget) {
          engine.step();
          stepsThisSecond++;
        }
      } else {
        stepAccumulator += dt * gps;
        let steps = Math.floor(stepAccumulator);
        stepAccumulator -= steps;
        while (steps-- > 0 && performance.now() < budget) {
          engine.step();
          stepsThisSecond++;
        }
      }
    }

    if (now - gpsWindowStart >= 1000) {
      measuredGps = stepsThisSecond / ((now - gpsWindowStart) / 1000);
      stepsThisSecond = 0;
      gpsWindowStart = now;
    }

    if (followGrowth && engine.population > 0) fitToPattern(false);

    render();
    updateStats();
    requestAnimationFrame(frame);
  }

  // ---------- transport controls ----------

  function setRunning(v) {
    running = v;
    btnRun.textContent = running ? "Stop" : "Start";
    btnRun.classList.toggle("running", running);
    if (!running) stepAccumulator = 0;
  }

  btnRun.addEventListener("click", () => setRunning(!running));
  $("btn-step").addEventListener("click", () => { setRunning(false); engine.step(); });
  $("btn-clear").addEventListener("click", () => {
    setRunning(false);
    engine.clear();
    showToast("field cleared");
  });

  speedSlider.addEventListener("input", () => {
    speedValue.textContent = fmtGps(gpsFromSlider());
  });
  speedValue.textContent = fmtGps(gpsFromSlider());

  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
    if (e.code === "Space") { e.preventDefault(); setRunning(!running); }
  });

  // ---------- view controls ----------

  function zoomAt(sx, sy, factor) {
    const [wx, wy] = screenToWorld(sx, sy);
    camera.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, camera.scale * factor));
    // keep the world point under the cursor fixed
    camera.cx = wx - (sx - canvas.clientWidth / 2) / camera.scale;
    camera.cy = wy - (sy - canvas.clientHeight / 2) / camera.scale;
  }

  $("btn-zoom-in").addEventListener("click", () =>
    zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1.4));
  $("btn-zoom-out").addEventListener("click", () =>
    zoomAt(canvas.clientWidth / 2, canvas.clientHeight / 2, 1 / 1.4));
  $("btn-fit").addEventListener("click", () => fitToPattern(true));

  const btnFollow = $("btn-follow");
  btnFollow.addEventListener("click", () => {
    followGrowth = !followGrowth;
    btnFollow.classList.toggle("toggled", followGrowth);
  });

  const btnExtent = $("btn-extent");
  btnExtent.addEventListener("click", () => {
    showExtent = !showExtent;
    btnExtent.classList.toggle("toggled", showExtent);
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    // Zoom proportional to scroll delta: mouse wheels send large discrete
    // deltas, touchpads send many small ones -> both feel smooth.
    let delta = e.deltaY;
    if (e.deltaMode === 1) delta *= 16;      // line-mode wheels -> pixels
    else if (e.deltaMode === 2) delta *= 240; // page-mode -> pixels
    const sensitivity = e.ctrlKey ? 0.0085 : 0.0022; // ctrlKey = touchpad pinch
    const factor = Math.min(1.6, Math.max(0.625, Math.exp(-delta * sensitivity)));
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
  }, { passive: false });

  // ---------- tools / pointer ----------

  const toolButtons = { draw: $("tool-draw"), erase: $("tool-erase"), pan: $("tool-pan") };
  function setTool(t) {
    tool = t;
    for (const [name, btn] of Object.entries(toolButtons)) {
      btn.classList.toggle("toggled", name === t);
    }
    canvas.classList.toggle("panning", t === "pan");
  }
  toolButtons.draw.addEventListener("click", () => setTool("draw"));
  toolButtons.erase.addEventListener("click", () => setTool("erase"));
  toolButtons.pan.addEventListener("click", () => setTool("pan"));

  let dragging = false;
  let lastPointer = null;
  let lastPaintCell = null;

  function paintAt(sx, sy) {
    const [wx, wy] = screenToWorld(sx, sy);
    const cx = Math.floor(wx);
    const cy = Math.floor(wy);
    // interpolate between paint events so fast strokes leave no gaps
    if (lastPaintCell) {
      const [px, py] = lastPaintCell;
      const steps = Math.max(Math.abs(cx - px), Math.abs(cy - py));
      for (let i = 1; i <= steps; i++) {
        const ix = Math.round(px + ((cx - px) * i) / steps);
        const iy = Math.round(py + ((cy - py) * i) / steps);
        engine.setCell(ix, iy, tool === "draw");
      }
    } else {
      engine.setCell(cx, cy, tool === "draw");
    }
    lastPaintCell = [cx, cy];
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 && e.button !== 1) return;
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    lastPointer = [sx, sy];
    const panning = tool === "pan" || e.button === 1;
    if (!panning) {
      lastPaintCell = null;
      paintAt(sx, sy);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const panning = tool === "pan" || (e.buttons & 4);
    if (panning) {
      camera.cx -= (sx - lastPointer[0]) / camera.scale;
      camera.cy -= (sy - lastPointer[1]) / camera.scale;
    } else {
      paintAt(sx, sy);
    }
    lastPointer = [sx, sy];
  });

  window.addEventListener("pointerup", () => {
    dragging = false;
    lastPaintCell = null;
  });

  // ---------- seeding ----------

  const patternSelect = $("pattern-select");
  for (const [id, p] of Object.entries(PATTERNS)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = p.label;
    patternSelect.appendChild(opt);
  }

  $("btn-place").addEventListener("click", () => {
    const p = PATTERNS[patternSelect.value];
    if (!p) return;
    let maxX = 0, maxY = 0;
    for (const [dx, dy] of p.cells) {
      if (dx > maxX) maxX = dx;
      if (dy > maxY) maxY = dy;
    }
    const ox = Math.round(camera.cx - maxX / 2);
    const oy = Math.round(camera.cy - maxY / 2);
    engine.placePattern(p.cells, ox, oy);
    showToast(`${p.label} placed`);
  });

  const soupDensity = $("soup-density");
  const soupDensityValue = $("soup-density-value");
  soupDensity.addEventListener("input", () => {
    soupDensityValue.textContent = soupDensity.value + "%";
  });

  $("btn-soup").addEventListener("click", () => {
    const w = Math.max(2, Math.min(2000, parseInt($("soup-w").value, 10) || 80));
    const h = Math.max(2, Math.min(2000, parseInt($("soup-h").value, 10) || 60));
    const d = soupDensity.value / 100;
    const soup = new LifeEngine();
    soup.randomSoup(w, h, d);
    const ox = Math.round(camera.cx);
    const oy = Math.round(camera.cy);
    for (const [x, y] of soup.cellList()) engine.setCell(x + ox, y + oy, true);
    showToast(`soup ${w}×${h} @ ${soupDensity.value}% sown`);
  });

  // ---------- archive (save / resume) ----------

  function readSaves() {
    try {
      const raw = localStorage.getItem(SAVES_KEY);
      const list = raw ? JSON.parse(raw) : [];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function writeSaves(list) {
    localStorage.setItem(SAVES_KEY, JSON.stringify(list));
  }

  function renderSaveList() {
    const list = readSaves();
    const container = $("save-list");
    container.innerHTML = "";
    $("save-empty").style.display = list.length ? "none" : "block";

    list.forEach((save, i) => {
      const item = document.createElement("div");
      item.className = "save-item";

      const name = document.createElement("div");
      name.className = "name";
      name.textContent = save.name;

      const meta = document.createElement("div");
      meta.className = "meta";
      const when = new Date(save.savedAt).toLocaleString();
      meta.textContent = `gen ${save.generation.toLocaleString()} · ${save.cells.length.toLocaleString()} cells · ${when}`;

      const actions = document.createElement("div");
      actions.className = "actions";

      const loadBtn = document.createElement("button");
      loadBtn.textContent = "Resume";
      loadBtn.addEventListener("click", () => {
        loadState(save);
        showToast(`resumed "${save.name}" at gen ${save.generation.toLocaleString()}`);
      });

      const exportBtn = document.createElement("button");
      exportBtn.textContent = "Export";
      exportBtn.addEventListener("click", () => downloadJson(save));

      const delBtn = document.createElement("button");
      delBtn.textContent = "Delete";
      delBtn.className = "danger";
      delBtn.addEventListener("click", () => {
        const next = readSaves();
        next.splice(i, 1);
        writeSaves(next);
        renderSaveList();
      });

      actions.append(loadBtn, exportBtn, delBtn);
      item.append(name, meta, actions);
      container.appendChild(item);
    });
  }

  function loadState(data) {
    setRunning(false);
    engine = LifeEngine.deserialize(data);
    fitToPattern(true);
  }

  function downloadJson(data) {
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(data.name || "life").replace(/[^\w-]+/g, "_")}_gen${data.generation}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  $("btn-save").addEventListener("click", () => {
    const name = $("save-name").value.trim() || `run ${new Date().toLocaleString()}`;
    const state = engine.serialize(name);
    const list = readSaves();
    list.unshift(state);
    try {
      writeSaves(list);
    } catch {
      showToast("storage full — use Export instead");
      return;
    }
    renderSaveList();
    showToast(`saved "${name}" (gen ${state.generation.toLocaleString()})`);
  });

  $("btn-export").addEventListener("click", () => {
    const name = $("save-name").value.trim() || "life";
    downloadJson(engine.serialize(name));
  });

  $("btn-import").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        loadState(data);
        showToast(`imported "${data.name}" at gen ${engine.generation.toLocaleString()}`);
      } catch (err) {
        showToast("import failed: " + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  });

  // ---------- boot ----------

  resizeCanvas();
  renderSaveList();
  engine.placePattern(PATTERNS.gosperGun.cells, -18, -5);
  fitToPattern(true);
  requestAnimationFrame(frame);
})();
