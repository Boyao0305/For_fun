"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  const api = (p) => fetch(p).then((r) => {
    if (!r.ok) throw new Error(`${p}: ${r.status}`);
    return r.json();
  });

  let currentRun = null;
  let generations = [];
  let currentGen = null;
  let currentSimId = null;

  // ---------- runs ----------

  const runSelect = $("run-select");

  async function loadRuns() {
    const runs = await api("/api/runs");
    runSelect.innerHTML = "";
    for (const r of runs) {
      const opt = document.createElement("option");
      opt.value = r.id;
      opt.textContent = `#${r.id} ${r.name}`;
      runSelect.appendChild(opt);
    }
    if (runs.length && currentRun === null) {
      currentRun = Number(runs[0].id);
      runSelect.value = currentRun;
      await loadGenerations(true);
    }
  }

  runSelect.addEventListener("change", async () => {
    currentRun = Number(runSelect.value);
    currentGen = null;
    await loadGenerations(true);
  });

  // ---------- generations ----------

  async function loadGenerations(selectLatest) {
    if (currentRun === null) return;
    generations = await api(`/api/runs/${currentRun}/generations`);
    drawChart();
    renderGenList();
    if (generations.length && (selectLatest || currentGen === null)) {
      selectGen(Number(generations[generations.length - 1].gen));
    }
  }

  function renderGenList() {
    const el = $("gen-list");
    el.innerHTML = "";
    for (let i = generations.length - 1; i >= 0; i--) {
      const g = generations[i];
      const row = document.createElement("div");
      row.className = "gen-item" + (Number(g.gen) === currentGen ? " active" : "");
      const stats = g.stats_json ? JSON.parse(g.stats_json) : {};
      row.innerHTML =
        `<span class="g">r${g.gen}</span>` +
        `<span>${g.incumbent_fitness == null ? "soup" : Number(g.incumbent_fitness).toFixed(0)}</span>` +
        `<span>${stats.gps ? (stats.gps / 1000).toFixed(1) + "k g/s" : ""}</span>`;
      row.addEventListener("click", () => selectGen(Number(g.gen)));
      el.appendChild(row);
    }
  }

  async function selectGen(gen) {
    currentGen = gen;
    $("gen-label").textContent = gen;
    renderGenList();
    const sims = await api(`/api/runs/${currentRun}/gens/${gen}/sims`);
    const tbody = $("sim-table").querySelector("tbody");
    tbody.innerHTML = "";
    for (const s of sims) {
      const tr = document.createElement("tr");
      if (Number(s.selected) === 1) tr.classList.add("selected-sim");
      if (Number(s.id) === currentSimId) tr.classList.add("active");
      tr.innerHTML =
        `<td>${s.id}</td><td>${s.origin}</td>` +
        `<td class="cls-${s.class}">${s.class}</td>` +
        `<td>${Number(s.lifespan).toLocaleString()}</td>` +
        `<td>${Number(s.peak_pop).toLocaleString()}</td>` +
        `<td>${Number(s.final_pop).toLocaleString()}</td>` +
        `<td>${s.extent_w}×${s.extent_h}</td>` +
        `<td>${Number(s.fitness).toFixed(1)}</td>`;
      tr.addEventListener("click", () => loadReplay(Number(s.id), tr));
      tbody.appendChild(tr);
    }
  }

  // ---------- fitness chart ----------

  function drawChart() {
    const canvas = $("chart");
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = 140;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (generations.length < 2) return;

    const alltime = generations.map((g) => Number(g.alltime_fitness) || 0);
    const best = generations.map((g) => {
      const s = g.stats_json ? JSON.parse(g.stats_json) : {};
      return Number(g.incumbent_fitness) || 0;
    });
    const maxV = Math.max(...alltime, 1);
    const px = (i) => (i / (generations.length - 1)) * (w - 8) + 4;
    const py = (v) => h - 6 - (v / maxV) * (h - 16);

    const line = (data, color, width) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      data.forEach((v, i) => (i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v))));
      ctx.stroke();
    };
    line(best, "rgba(126,136,153,0.55)", 1);
    line(alltime, "#ffb454", 1.5);

    ctx.fillStyle = "rgba(255,180,84,0.85)";
    ctx.font = "10px 'IBM Plex Mono', monospace";
    ctx.fillText(maxV.toFixed(0), 6, 12);
  }

  // ---------- replay player (client-side re-simulation) ----------

  const player = $("player");
  const pctx = player.getContext("2d");
  let replayEngine = null;
  let replayCells = null;
  let replayMeta = null;
  let playing = false;
  let acc = 0;
  let lastT = performance.now();

  const speedOf = () => Math.pow(10, ($("p-speed").value / 100) * 3); // 1..1000 g/s
  $("p-speed").addEventListener("input", () => {
    $("p-speed-val").textContent = Math.round(speedOf()) + " g/s";
  });

  async function loadReplay(simId, tr) {
    currentSimId = simId;
    document.querySelectorAll("#sim-table tr.active").forEach((r) => r.classList.remove("active"));
    if (tr) tr.classList.add("active");
    const sim = await api(`/api/sims/${simId}`);
    replayMeta = sim;
    replayCells = sim.cells;
    $("replay-label").textContent = `— sim ${simId} (gen ${sim.gen}, ${sim.class})`;
    $("p-class").textContent = `${sim.class} · lifespan ${Number(sim.lifespan).toLocaleString()}`;
    restartReplay();
    playing = true;
    $("p-play").textContent = "Pause";
  }

  function restartReplay() {
    replayEngine = new LifeEngine();
    for (const [x, y] of replayCells) replayEngine.setCell(x, y, true);
    acc = 0;
  }

  $("p-play").addEventListener("click", () => {
    if (!replayEngine) return;
    playing = !playing;
    $("p-play").textContent = playing ? "Pause" : "Play";
  });
  $("p-restart").addEventListener("click", () => { if (replayCells) restartReplay(); });

  function renderReplay() {
    const dpr = window.devicePixelRatio || 1;
    const w = player.clientWidth;
    const h = player.clientHeight;
    if (player.width !== w * dpr) { player.width = w * dpr; player.height = h * dpr; }
    pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    pctx.fillStyle = "#080a0f";
    pctx.fillRect(0, 0, w, h);
    if (!replayEngine) {
      pctx.fillStyle = "#4d5665";
      pctx.font = "11px 'IBM Plex Mono', monospace";
      pctx.fillText("select a simulation to replay", 16, 24);
      return;
    }
    const bb = replayEngine.boundingBox();
    if (!bb) return;
    const scale = Math.min(w / (bb.width + 8), h / (bb.height + 8), 20);
    const cx = bb.minX + bb.width / 2;
    const cy = bb.minY + bb.height / 2;
    const size = Math.max(scale - (scale >= 6 ? 1 : 0), 0.75);
    pctx.fillStyle = "#ffb454";
    for (const key of replayEngine.cells) {
      const x = Math.floor(key / 2097152) - 1048576;
      const y = (key % 2097152) - 1048576;
      pctx.fillRect((x - cx) * scale + w / 2, (y - cy) * scale + h / 2, size, size);
    }
  }

  function frame(now) {
    const dt = Math.min((now - lastT) / 1000, 0.25);
    lastT = now;
    if (replayEngine && playing) {
      acc += dt * speedOf();
      let steps = Math.floor(acc);
      acc -= steps;
      const budget = performance.now() + 20;
      while (steps-- > 0 && performance.now() < budget) replayEngine.step();
      $("p-gen").textContent = replayEngine.generation.toLocaleString();
      $("p-pop").textContent = replayEngine.population.toLocaleString();
    }
    renderReplay();
    requestAnimationFrame(frame);
  }

  // ---------- live tail (SSE) ----------

  const pill = $("live-pill");
  const es = new EventSource("/api/events");
  es.onopen = () => { pill.classList.add("live"); $("live-text").textContent = "live"; };
  es.onerror = () => { pill.classList.remove("live"); $("live-text").textContent = "reconnecting"; };
  es.addEventListener("sims", async (e) => {
    const rows = JSON.parse(e.data);
    const forThisRun = rows.filter((r) => Number(r.run_id) === currentRun);
    if (forThisRun.length === 0) return;
    const latestGen = Math.max(...forThisRun.map((r) => Number(r.gen)));
    const knownLatest = generations.length ? Number(generations[generations.length - 1].gen) : -1;
    if (latestGen > knownLatest) {
      const followLatest = currentGen === knownLatest; // follow the head only if already there
      await loadGenerations(followLatest);
    } else if (Number(latestGen) === currentGen) {
      selectGen(currentGen); // refresh the table in place
    }
  });

  // ---------- boot ----------

  loadRuns().catch((err) => {
    $("live-text").textContent = "no data yet";
    console.error(err);
  });
  setInterval(() => loadRuns().catch(() => {}), 15000); // pick up new runs
  requestAnimationFrame(frame);
})();
