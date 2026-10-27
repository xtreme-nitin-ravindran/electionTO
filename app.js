const DATA_URL = "results.json";
let hasLoadedResults = false;
const expandedRaces = new Set();
const PREVIEW_COUNT = 4;

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
    old.replaceChildren(...row.childNodes);
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

function statsLine(ward) {
  const received = parseInt(ward.pollsReceived, 10);
  const polls = parseInt(ward.polls, 10);
  const votes = parseInt(ward.votesReceived, 10);
  const voters = parseInt(ward.totalVoters, 10) || 1;

  let text = `${nf.format(polls)} polling locations`;
  if (received > 0) {
    const turnout = ((votes / voters) * 100).toFixed(1);
    text += ` · ${nf.format(received)} reported · ${nf.format(votes)} votes · ${turnout}% turnout`;
  } else {
    text += " · results pending";
  }
  return text;
}

function renderResults(data) {
  const meta = document.getElementById("meta-line");
  const updated = new Date(data.fetchedAt);
  meta.textContent = `Data updated ${updated.toLocaleString("en-CA", { timeZone: "America/Toronto" })} Toronto time · ${data.electionDesc}`;

  const officeMap = new Map(data.office.map((o) => [o.name, o]));

  // --- Mayor ---
  const mayor = officeMap.get("Mayor");
  const mayorWard = mayor.ward[0]; // "City-wide"
  document.getElementById("mayor-badge").textContent = hasResults(mayorWard)
    ? "Live"
    : "Awaiting results";
  document.getElementById("mayor-badge").classList.toggle("is-live", hasResults(mayorWard));
  document.getElementById("mayor-stats").textContent = statsLine(mayorWard);

  renderCandidateList(document.getElementById("mayor-candidates"), mayorWard, "mayor", "Mayor");

  // --- Ward 13 (Toronto Centre, Councillor) ---
  const councillor = officeMap.get("Councillor");
  const ward13 = councillor.ward.find((w) => String(w.num) === "13");
  document.getElementById("ward13-badge").textContent = hasResults(ward13)
    ? "Live"
    : "Awaiting results";
  document.getElementById("ward13-badge").classList.toggle("is-live", hasResults(ward13));
  document.getElementById("ward13-stats").textContent = statsLine(ward13);

  renderCandidateList(document.getElementById("ward13-candidates"), ward13, "councillor-13", "Ward 13");

  // --- Ward 4 (Parkdale-High Park, Councillor) ---
  const ward4 = councillor.ward.find((w) => String(w.num) === "4");
  document.getElementById("ward4-badge").textContent = hasResults(ward4)
    ? "Live"
    : "Awaiting results";
  document.getElementById("ward4-badge").classList.toggle("is-live", hasResults(ward4));
  document.getElementById("ward4-stats").textContent = statsLine(ward4);

  renderCandidateList(document.getElementById("ward4-candidates"), ward4, "councillor-4", "Ward 4");

  // --- Ward 14 (Toronto-Danforth, Councillor) ---
  const ward14 = councillor.ward.find((w) => String(w.num) === "14");
  document.getElementById("ward14-badge").textContent = hasResults(ward14)
    ? "Live"
    : "Awaiting results";
  document.getElementById("ward14-badge").classList.toggle("is-live", hasResults(ward14));
  document.getElementById("ward14-stats").textContent = statsLine(ward14);

  renderCandidateList(document.getElementById("ward14-candidates"), ward14, "councillor-14", "Ward 14");

  // --- Everything else ---
  const others = document.getElementById("others");
  others.innerHTML = "";

  data.office.forEach((office) => {
    office.ward.forEach((ward) => {
      // Skip mayor city-wide, Councillor Ward 13, 4 and 14 (already shown above).
      const isMayor = office.name === "Mayor" && String(ward.num) === "0";
      const isWard13 = office.name === "Councillor" && String(ward.num) === "13";
      const isWard4 = office.name === "Councillor" && String(ward.num) === "4";
      const isWard14 = office.name === "Councillor" && String(ward.num) === "14";
      if (isMayor || isWard13 || isWard4 || isWard14) return;

      const card = document.createElement("div");
      card.className = "other";

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
      stat.textContent = statsLine(ward);

      const candidates = document.createElement("div");
      candidates.className = "candidates";
      card.append(title, officeName, stat, badge, candidates);
      others.appendChild(card);
      renderCandidateList(candidates, ward, `${office.id}-${ward.num}`, label);
    });
  });
}

async function load() {
  try {
    const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const data = await res.json();
    renderResults(data);
    hasLoadedResults = true;
  } catch (err) {
    if (hasLoadedResults) {
      document.getElementById("meta-line").textContent += " · Refresh unavailable; showing last loaded results";
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
  }
}

load();
setInterval(load, 30 * 1000);
