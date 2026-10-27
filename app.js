const DATA_URL = "https://electionto-results.nitin-ravindran.workers.dev/";
const BACKUP_URL = "results.json";
let hasLoadedResults = false;
const expandedRaces = new Set();
const PREVIEW_COUNT = 4;
const REFRESH_INTERVAL = 30 * 1000;
let nextRefreshAt = Date.now() + REFRESH_INTERVAL;
let isRefreshing = false;
let refreshFailed = false;
let lastCheckedAt = null;
let lastFeedTimestamp = null;
let receivedNewData = false;
let lastResultsSignature = null;
let usingBackup = false;

function updateClock() {
  const now = new Date();
  document.getElementById("current-time").textContent = `Current time ${now.toLocaleTimeString("en-CA", { timeZone: "America/Toronto" })} Toronto time`;
  const remaining = Math.max(0, Math.ceil((nextRefreshAt - now.getTime()) / 1000));
  const countdown = `${String(Math.floor(remaining / 60)).padStart(2, "0")}:${String(remaining % 60).padStart(2, "0")}`;
  document.getElementById("next-refresh").textContent = isRefreshing
    ? "Checking for updates…"
    : `Next results check in ${countdown}`;
  const stale = lastFeedTimestamp && now.getTime() - new Date(lastFeedTimestamp).getTime() > 10 * 60 * 1000;
  document.getElementById("last-check").textContent = lastCheckedAt
    ? `Last checked ${new Date(lastCheckedAt).toLocaleTimeString("en-CA", { timeZone: "America/Toronto" })} · ${receivedNewData ? "New data received" : "No newer published data"}`
    : "";
  document.getElementById("refresh-status").textContent = refreshFailed
    ? (hasLoadedResults ? "Refresh unavailable; showing last loaded results." : "Results unavailable; retrying automatically.")
    : (usingBackup ? "Live feed unavailable; showing backup published results." : (stale ? "The City’s feed has not updated for over 10 minutes." : ""));
}

const nf = new Intl.NumberFormat("en-CA");

function fmtVotes(v) {
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? "—" : nf.format(n);
}

function fmtPct(p) {
  const f = parseFloat(p);
  return Number.isNaN(f) ? "—" : f.toFixed(1) + "%";
}

function hasResults(ward) {
  return parseInt(ward.votesReceived, 10) > 0;
}

function progressPct(candidate, ward) {
  if (!ward || !hasResults(ward)) return 0;
  const total = parseFloat(ward.votesReceived);
  const votes = parseFloat(candidate.votesReceived);
  if (!total || Number.isNaN(votes)) return 0;
  return Math.max(0, Math.min(100, (votes / total) * 100));
}

// Sort candidates by votes (desc), stable for ties.
function sortedCandidates(candidates) {
  return [...candidates].sort(
    (a, b) => parseFloat(b.votesReceived) - parseFloat(a.votesReceived)
  );
}

// Highlight only displayed values that changed after the first render.
function updateValue(element, text) {
  const previous = element.textContent;
  if (previous === text) return;
  element.textContent = text;
  if (!previous || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  element.getAnimations().forEach((animation) => animation.cancel());
  element.animate([
    { backgroundColor: "#c9e7ff", color: "#0849b5", transform: "translateY(-2px)" },
    { backgroundColor: "transparent", color: "inherit", transform: "translateY(0)" }
  ], { duration: 1000, easing: "ease-out" });
}

function candidateRow(candidate, ward, leading) {
  const row = document.createElement("div");
  row.className = "candidate" + (leading ? " candidate--lead" : "");
  row.dataset.name = candidate.name;

  const name = document.createElement("div");
  name.className = "candidate__name";
  name.textContent = candidate.name;

  const votes = document.createElement("div");
  votes.className = "candidate__votes";
  votes.textContent = fmtVotes(candidate.votesReceived);

  const pct = document.createElement("div");
  pct.className = "candidate__pct";
  pct.textContent = fmtPct(candidate.percentage);

  const bar = document.createElement("div");
  bar.className = "candidate__bar";
  const fill = document.createElement("span");
  fill.style.width = progressPct(candidate, ward) + "%";
  bar.appendChild(fill);

  row.append(name, votes, pct, bar);
  return row;
}

// Animate candidate rows into their new sorted position using the FLIP technique.
// Existing rows slide, new rows fade in, removed rows fade out.
function animateList(list, buildRow) {
  const oldChildren = [...list.querySelectorAll(".candidate")];
  const oldByName = new Map(oldChildren.map((el) => [el.dataset.name, el]));

  // Capture first positions before mutating the DOM.
  const first = new Map();
  oldChildren.forEach((el) => {
    const r = el.getBoundingClientRect();
    first.set(el, r);
  });

  // Build the new (sorted) set of rows.
  const newRows = buildRow();

  // Reuse existing DOM nodes for candidates that remain, so CSS transitions work.
  const merged = newRows.map((row) => {
    const old = oldByName.get(row.dataset.name);
    if (!old) return row;
    old.className = row.className;
    updateValue(old.querySelector(".candidate__votes"), row.querySelector(".candidate__votes").textContent);
    updateValue(old.querySelector(".candidate__pct"), row.querySelector(".candidate__pct").textContent);
    old.querySelector(".candidate__bar > span").style.width = row.querySelector(".candidate__bar > span").style.width;
    return old;
  });

  list.innerHTML = "";
  merged.forEach((row) => list.appendChild(row));

  // Invert + play, and give brand-new rows a fade-in.
  merged.forEach((row) => {
    const old = oldByName.get(row.dataset.name);
    if (!old) {
      row.classList.add("candidate--enter");
      return;
    }
    const firstRect = first.get(old);
    if (!firstRect) return;
    const lastRect = row.getBoundingClientRect();
    const dx = firstRect.left - lastRect.left;
    const dy = firstRect.top - lastRect.top;
    if (dx !== 0 || dy !== 0) {
      row.style.transform = `translate(${dx}px, ${dy}px)`;
      row.style.transition = "none";
      // Force reflow so the transform applies before we animate back to 0.
      void row.offsetWidth;
      row.style.transition = "";
      row.style.transform = "";
    }
  });
}

// Each race keeps its expansion choice when fresh results arrive.
function renderCandidateList(list, ward, key, label) {
  const ranked = sortedCandidates(ward.candidate || []);
  if (!list.id) list.id = `candidates-${encodeURIComponent(key)}`;
  animateList(list, () => ranked.map((candidate, index) =>
    candidateRow(candidate, ward, hasResults(ward) && index === 0)
  ));

  let button = list.nextElementSibling;
  if (!button || !button.classList.contains("show-more")) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "show-more";
    button.setAttribute("aria-controls", list.id);
    list.after(button);
  }
  const update = () => {
    const expanded = expandedRaces.has(key);
    [...list.children].forEach((row, index) => {
      row.hidden = !expanded && index >= PREVIEW_COUNT;
    });
    button.hidden = ranked.length <= PREVIEW_COUNT;
    button.textContent = expanded ? "Show less" : `Show more (${ranked.length - PREVIEW_COUNT})`;
    button.setAttribute("aria-expanded", String(expanded));
    button.setAttribute("aria-label", `${expanded ? "Show fewer" : "Show all"} candidates for ${label}`);
  };
  button.onclick = () => {
    if (expandedRaces.has(key)) expandedRaces.delete(key);
    else expandedRaces.add(key);
    update();
  };
  update();
  if (!ranked.length) {
    const empty = document.createElement("p");
    empty.className = "race__stats";
    empty.textContent = "Candidate results have not been published yet.";
    list.appendChild(empty);
  }
}

function renderStats(element, ward) {
  const received = parseInt(ward.pollsReceived, 10) || 0;
  const polls = parseInt(ward.polls, 10) || 0;
  const votes = parseInt(ward.votesReceived, 10) || 0;
  const voters = parseInt(ward.totalVoters, 10) || 0;
  const counted = polls > 0 ? ((received / polls) * 100).toFixed(1) + "%" : "—";
  const turnout = voters > 0 ? ((votes / voters) * 100).toFixed(1) + "%" : "—";
  const values = [nf.format(received), nf.format(polls), counted, turnout];
  const labels = [" of ", " polls reported · ", " counted · ", " turnout"];
  if (!element.querySelector(".stat-value")) {
    element.replaceChildren();
    labels.forEach((label) => {
      const value = document.createElement("span");
      value.className = "stat-value";
      element.append(value, document.createTextNode(label));
    });
  }
  element.querySelectorAll(".stat-value").forEach((value, index) => updateValue(value, values[index]));
}

function renderResults(data) {
  const meta = document.getElementById("data-updated");
  const updated = new Date(data.sourceUpdatedAt || data.fetchedAt);
  meta.textContent = `Data updated ${updated.toLocaleString("en-CA", { timeZone: "America/Toronto" })} Toronto time · ${data.electionDesc}`;

  const officeMap = new Map(data.office.map((o) => [o.name, o]));

  // --- Mayor ---
  const mayor = officeMap.get("Mayor");
  const mayorWard = mayor.ward[0]; // "City-wide"
  document.getElementById("mayor-badge").textContent = hasResults(mayorWard)
    ? "Live"
    : "Awaiting results";
  document.getElementById("mayor-badge").classList.toggle("is-live", hasResults(mayorWard));
  renderStats(document.getElementById("mayor-stats"), mayorWard);

  renderCandidateList(document.getElementById("mayor-candidates"), mayorWard, "mayor", "Mayor");

  // --- Ward 13 (Toronto Centre, Councillor) ---
  const councillor = officeMap.get("Councillor");
  const ward13 = councillor.ward.find((w) => String(w.num) === "13");
  document.getElementById("ward13-badge").textContent = hasResults(ward13)
    ? "Live"
    : "Awaiting results";
  document.getElementById("ward13-badge").classList.toggle("is-live", hasResults(ward13));
  renderStats(document.getElementById("ward13-stats"), ward13);

  renderCandidateList(document.getElementById("ward13-candidates"), ward13, "councillor-13", "Ward 13");

  // --- Ward 4 (Parkdale-High Park, Councillor) ---
  const ward4 = councillor.ward.find((w) => String(w.num) === "4");
  document.getElementById("ward4-badge").textContent = hasResults(ward4)
    ? "Live"
    : "Awaiting results";
  document.getElementById("ward4-badge").classList.toggle("is-live", hasResults(ward4));
  renderStats(document.getElementById("ward4-stats"), ward4);

  renderCandidateList(document.getElementById("ward4-candidates"), ward4, "councillor-4", "Ward 4");

  // --- Ward 14 (Toronto-Danforth, Councillor) ---
  const ward14 = councillor.ward.find((w) => String(w.num) === "14");
  document.getElementById("ward14-badge").textContent = hasResults(ward14)
    ? "Live"
    : "Awaiting results";
  document.getElementById("ward14-badge").classList.toggle("is-live", hasResults(ward14));
  renderStats(document.getElementById("ward14-stats"), ward14);

  renderCandidateList(document.getElementById("ward14-candidates"), ward14, "councillor-14", "Ward 14");

  // --- Everything else ---
  const others = document.getElementById("others");
  const existingCards = new Map([...others.children].map((card) => [card.dataset.race, card]));
  const activeCards = new Set();

  data.office.forEach((office) => {
    office.ward.forEach((ward) => {
      // Skip mayor city-wide, Councillor Ward 13, 4 and 14 (already shown above).
      const isMayor = office.name === "Mayor" && String(ward.num) === "0";
      const isWard13 = office.name === "Councillor" && String(ward.num) === "13";
      const isWard4 = office.name === "Councillor" && String(ward.num) === "4";
      const isWard14 = office.name === "Councillor" && String(ward.num) === "14";
      if (isMayor || isWard13 || isWard4 || isWard14) return;

      const key = `${office.id}-${ward.num}`;
      let card = existingCards.get(key);
      activeCards.add(key);
      if (card) {
        const badge = card.querySelector(".race__badge");
        badge.textContent = hasResults(ward) ? "Live" : "Awaiting";
        badge.classList.toggle("is-live", hasResults(ward));
        renderStats(card.querySelector(".race__stats"), ward);
        renderCandidateList(card.querySelector(".candidates"), ward, key, card.querySelector("h3").textContent);
        return;
      }
      card = document.createElement("div");
      card.className = "other";
      card.dataset.race = key;

      const title = document.createElement("h3");
      const label =
        office.name === "Councillor"
          ? `Ward ${ward.num} · ${ward.name}`
          : `${office.name} · Ward ${ward.num}`;
      title.textContent = label;

      const officeName = document.createElement("p");
      officeName.className = "other__office";
      officeName.textContent = office.name === "Councillor" ? "Councillor" : office.name;

      const badge = document.createElement("span");
      badge.className = "race__badge";
      badge.textContent = hasResults(ward) ? "Live" : "Awaiting";
      badge.classList.toggle("is-live", hasResults(ward));

      const stat = document.createElement("p");
      stat.className = "race__stats";
      stat.style.margin = "0 0 10px";
      stat.style.fontSize = "12px";
      renderStats(stat, ward);

      const candidates = document.createElement("div");
      candidates.className = "candidates";
      card.append(title, officeName, stat, badge, candidates);
      others.appendChild(card);
      renderCandidateList(candidates, ward, key, label);
    });
  });
  existingCards.forEach((card, key) => {
    if (!activeCards.has(key)) card.remove();
  });
}

async function fetchResults(url) {
  const res = await fetch(`${url}?t=${Date.now()}`, { cache: "no-store", signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  if (!Array.isArray(data.office)) throw new Error("Invalid results feed");
  return data;
}

async function load() {
  isRefreshing = true;
  updateClock();
  try {
    let data;
    try {
      data = await fetchResults(DATA_URL);
      usingBackup = false;
    } catch (liveError) {
      console.warn("Live feed unavailable; trying published backup", liveError);
      data = await fetchResults(BACKUP_URL);
      usingBackup = true;
    }
    renderResults(data);
    const signature = JSON.stringify(data.office);
    receivedNewData = signature !== lastResultsSignature;
    lastResultsSignature = signature;
    lastFeedTimestamp = data.sourceUpdatedAt || data.fetchedAt;
    lastCheckedAt = Date.now();
    hasLoadedResults = true;
    refreshFailed = false;
  } catch (err) {
    refreshFailed = true;
    if (hasLoadedResults) {
      console.error(err);
      return;
    }
    const mayor = document.getElementById("mayor-candidates");
    mayor.innerHTML = "";
    const div = document.createElement("div");
    div.className = "error";
    div.textContent = "Unable to load results. Please try again shortly.";
    mayor.appendChild(div);
    console.error(err);
  } finally {
    isRefreshing = false;
    nextRefreshAt = Date.now() + REFRESH_INTERVAL;
    updateClock();
    setTimeout(load, REFRESH_INTERVAL);
  }
}

load();
setInterval(updateClock, 1000);
