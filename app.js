const state = {
  user: null,
};

// Tab switching
document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    document.getElementById(btn.dataset.tab).classList.add("active");
  });
});

// Helper: serialize form to FormData or JSON
function formToJSON(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  return data;
}
async function api(path, method = "GET", data = null, isMultipart = false) {
  const opts = { method };
  if (data) {
    if (isMultipart) {
      opts.body = data;
    } else {
      opts.headers = { "Content-Type": "application/json" };
      opts.body = JSON.stringify(data);
    }
  }
  const res = await fetch(path, opts);
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || res.statusText);
  }
  return res.json();
}
function showUser() {
  const el = document.getElementById("currentUser");
  if (state.user) {
    el.textContent = `Logged in as: ${state.user.name} (${state.user.email}) [role: ${state.user.role}]`;
  } else {
    el.textContent = "Not logged in.";
  }
}

// Register
document.getElementById("registerForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = formToJSON(e.target);
  try {
    const user = await api("/api/register", "POST", data);
    alert("Registered! Please login.");
    e.target.reset();
  } catch (err) {
    alert("Register error: " + err.message);
  }
});

// Login
document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const data = formToJSON(e.target);
  try {
    const user = await api("/api/login", "POST", data);
    state.user = user;
    showUser();
    alert("Logged in!");
  } catch (err) {
    alert("Login error: " + err.message);
  }
});
showUser();

// Report Lost
document.getElementById("lostForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.user) return alert("Please login first.");
  const fd = new FormData(e.target);
  fd.append("user_id", state.user.id);
  try {
    const res = await api("/api/lost", "POST", fd, true);
    const m = res.matches || [];
    const container = document.getElementById("lostMatches");
    container.innerHTML = "<h3>Possible Matches</h3>" + (m.length ? "" : "<p>No strong matches yet.</p>");
    for (const mm of m) {
      const f = mm.item;
      const card = document.createElement("div");
      card.className = "item-card";
      card.innerHTML = `
        ${f.photo_url ? `<img src="${f.photo_url}" alt="found photo"/>` : ""}
        <h4>[Found #${f.id}] ${f.item_name}</h4>
        <p>${f.description || ""}</p>
        <small class="muted">Category: ${f.category || "—"} | Location: ${f.location || "—"} | Score: ${(mm.score*100).toFixed(0)}%</small>
      `;
      container.appendChild(card);
    }
    e.target.reset();
    alert("Lost report submitted!");
  } catch (err) {
    alert("Submit error: " + err.message);
  }
});

// Report Found
document.getElementById("foundForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.user) return alert("Please login first.");
  const fd = new FormData(e.target);
  fd.append("user_id", state.user.id);
  try {
    const res = await api("/api/found", "POST", fd, true);
    const m = res.matches || [];
    const container = document.getElementById("foundMatches");
    container.innerHTML = "<h3>Possible Matches</h3>" + (m.length ? "" : "<p>No strong matches yet.</p>");
    for (const mm of m) {
      const l = mm.item;
      const card = document.createElement("div");
      card.className = "item-card";
      card.innerHTML = `
        ${l.photo_url ? `<img src="${l.photo_url}" alt="lost photo"/>` : ""}
        <h4>[Lost #${l.id}] ${l.item_name}</h4>
        <p>${l.description || ""}</p>
        <small class="muted">Category: ${l.category || "—"} | Location: ${l.location || "—"} | Score: ${(mm.score*100).toFixed(0)}%</small>
      `;
      container.appendChild(card);
    }
    e.target.reset();
    alert("Found report submitted!");
  } catch (err) {
    alert("Submit error: " + err.message);
  }
});

// Search
document.getElementById("searchBtn").addEventListener("click", async () => {
  const q = document.getElementById("searchQuery").value;
  const location = document.getElementById("searchLocation").value;
  const category = document.getElementById("searchCategory").value;
  const type = document.getElementById("searchType").value;
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (location) params.set("location", location);
  if (category) params.set("category", category);
  const url = type === "lost" ? "/api/lost?" + params.toString() : "/api/found?" + params.toString();
  try {
    const rows = await api(url);
    const container = document.getElementById("results");
    container.innerHTML = "";
    for (const r of rows) {
      const card = document.createElement("div");
      card.className = "item-card";
      card.innerHTML = `
        ${r.photo_url ? `<img src="${r.photo_url}" alt="photo"/>` : ""}
        <h4>[#${r.id}] ${r.item_name}</h4>
        <p>${r.description || ""}</p>
        <small class="muted">Type: ${type.toUpperCase()} | Category: ${r.category || "—"} | Date: ${r.date_lost || r.date_found || "—"} | Location: ${r.location || "—"} | Status: ${r.status}</small>
      `;
      container.appendChild(card);
    }
  } catch (err) {
    alert("Search error: " + err.message);
  }
});

// Claims
document.getElementById("claimForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.user) return alert("Please login first.");
  const fd = new FormData(e.target);
  fd.append("claimer_id", state.user.id);
  try {
    const res = await api("/api/claims", "POST", fd, true);
    alert("Claim submitted!");
    e.target.reset();
    loadMyClaims();
  } catch (err) {
    alert("Claim error: " + err.message);
  }
});

async function loadMyClaims() {
  if (!state.user) return;
  const rows = await api("/api/claims");
  const mine = rows.filter(r => r.claimer_id === state.user.id);
  const container = document.getElementById("myClaims");
  container.innerHTML = "";
  for (const c of mine) {
    const card = document.createElement("div");
    card.className = "item-card";
    card.innerHTML = `
      ${c.proof_photo_url ? `<img src="${c.proof_photo_url}" alt="proof"/>` : ""}
      <h4>Claim #${c.id}</h4>
      <p>${c.proof_text || ""}</p>
      <small class="muted">Status: ${c.status}</small>
    `;
    container.appendChild(card);
  }
}

// Admin
document.getElementById("loadStats").addEventListener("click", async () => {
  const s = await api("/api/admin/stats");
  document.getElementById("stats").innerHTML = `
    <div class="grid">
      <div class="item-card"><h3>Users</h3><p>${s.users}</p></div>
      <div class="item-card"><h3>Lost</h3><p>${s.lost}</p></div>
      <div class="item-card"><h3>Found</h3><p>${s.found}</p></div>
      <div class="item-card"><h3>Claims</h3><p>${s.claims}</p></div>
    </div>
  `;
});

document.getElementById("loadClaims").addEventListener("click", async () => {
  const rows = await api("/api/claims?status=pending");
  const container = document.getElementById("adminClaims");
  container.innerHTML = "";
  for (const c of rows) {
    const card = document.createElement("div");
    card.className = "item-card";
    card.innerHTML = `
      ${c.proof_photo_url ? `<img src="${c.proof_photo_url}" alt="proof"/>` : ""}
      <h4>Claim #${c.id} by ${c.claimer_name}</h4>
      <p>${c.proof_text || ""}</p>
      <div class="grid">
        <button data-act="approve" data-id="${c.id}">Approve</button>
        <button data-act="reject" data-id="${c.id}">Reject</button>
      </div>
    `;
    container.appendChild(card);
  }
  container.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const act = btn.dataset.act;
      const path = act === "approve" ? `/api/admin/claims/${id}/approve` : `/api/admin/claims/${id}/reject`;
      await api(path, "POST");
      alert(`Claim #${id} ${act}d.`);
      document.getElementById("loadClaims").click();
    });
  });
});

// Load claims after login automatically
setInterval(loadMyClaims, 5000);
