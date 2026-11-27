// Rural Greece admin panel for ETAM. Plain JS, no build step. Talks only to /v1/admin/*.
"use strict";

const $ = (sel, el = document) => el.querySelector(sel);
const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fmtDate = (s) => (s ? new Date(s).toLocaleString("el-GR", { dateStyle: "short", timeStyle: "short" }) : "—");
const tag = (s) => `<span class="tag ${esc(s)}">${esc(STATUS[s] ?? s)}</span>`;
const STATUS = { verified: "επαληθεύτηκε", rejected: "απορρίφθηκε", duplicate: "διπλό", cancelled: "ακυρώθηκε", active: "ενεργή", pending: "σε αναμονή", declined: "απορρίφθηκε" };
const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const ulidish = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);

const TOKEN_KEY = "rve.admin.token";
let token = "";
try {
  token = sessionStorage.getItem(TOKEN_KEY) || "";
} catch {}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove("show"), 2600);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || "GET",
    headers: { authorization: `Bearer ${token}`, ...(opts.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  if (res.status === 401) {
    logout();
    throw new Error("Μη έγκυρο κλειδί");
  }
  const type = res.headers.get("content-type") || "";
  const data = type.includes("json") ? await res.json() : await res.text();
  if (!res.ok) throw new Error((data && data.error) || `HTTP ${res.status}`);
  return data;
}

async function qrImageUrl(id) {
  const res = await fetch(`/v1/admin/qr-targets/${encodeURIComponent(id)}/svg`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

function logout() {
  token = "";
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {}
  $("#nav").hidden = true;
  $("#login").hidden = false;
  $("#view").innerHTML = "";
}

// ---------- views ----------

const views = {
  async overview(v) {
    const o = await api("/v1/admin/overview");
    v.innerHTML = `
      <h2>Επισκόπηση</h2>
      <div class="stats">
        ${stat(o.members, "Μέλη (επιχειρήσεις)")}
        ${stat(o.members_without_qr, "Μέλη χωρίς QR")}
        ${stat(o.pois, "Σημεία ενδιαφέροντος")}
        ${stat(o.packages, "Θεματικά πακέτα")}
        ${stat(o.visitors, "Επισκέπτες")}
        ${stat(o.events_24h, "Συμβάντα (24 ώρες)")}
        ${stat(o.rejected_24h, "Απορρίψεις (24 ώρες)")}
        ${stat(o.pending_partnerships, "Συνεργασίες σε αναμονή")}
      </div>
      <h3>Συγχρονισμός με ruralgreece.gr</h3>
      <div class="card">
        <div class="row no-print">
          <button id="sync-inc">Συγχρονισμός αλλαγών</button>
          <button id="sync-full" class="secondary">Πλήρης συγχρονισμός</button>
          <span id="sync-out" class="muted"></span>
        </div>
        <div class="table-wrap"><table>
          <tr><th>Πηγή</th><th>Τελευταία αλλαγή</th><th>Τελευταίος πλήρης</th><th>Τελευταία εκτέλεση</th></tr>
          ${o.sync.map((s) => `<tr><td>${esc(s.source)}</td><td>${fmtDate(s.last_modified)}</td><td>${fmtDate(s.last_full_at)}</td><td>${fmtDate(s.last_run_at)}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">Δεν έχει γίνει ακόμα συγχρονισμός.</td></tr>`}
        </table></div>
      </div>`;
    const run = (full) => async (e) => {
      e.target.disabled = true;
      $("#sync-out").textContent = "Σε εξέλιξη…";
      try {
        const r = await api("/v1/admin/sync", { method: "POST", body: { full } });
        const u = r.report.upserted;
        $("#sync-out").textContent = `Ενημερώθηκαν ${u.business} επιχειρήσεις, ${u.route} διαδρομές, ${u.poi} σημεία · διαγραφές ${r.report.deleted}`;
      } catch (err) {
        $("#sync-out").textContent = err.message === "sync_not_configured" ? "Δεν έχει οριστεί RURALGREECE_URL." : err.message;
      } finally {
        e.target.disabled = false;
      }
    };
    $("#sync-inc").onclick = run(false);
    $("#sync-full").onclick = run(true);
  },

  async members(v) {
    v.innerHTML = `
      <h2>Μέλη</h2>
      <p class="muted">Κάθε επιχείρηση του ruralgreece.gr είναι μέλος. Συνδέονται με το email της επιχείρησης· εδώ μπορείτε να προσθέσετε κι άλλο email.</p>
      <div class="row no-print">
        <input id="mq" placeholder="Αναζήτηση ονόματος" size="28">
        <button id="bulk-qr" class="secondary">Δημιουργία QR για όσα μέλη δεν έχουν</button>
      </div>
      <div id="mlist"></div>
      <div class="card no-print">
        <h3>Επιπλέον email σύνδεσης</h3>
        <div class="row">
          <input id="mu-member" placeholder="Κωδικός μέλους (π.χ. business-123)" size="28">
          <input id="mu-email" type="email" placeholder="email" size="28">
          <button id="mu-add">Προσθήκη</button>
        </div>
      </div>`;
    const load = async () => {
      const q = $("#mq").value.trim();
      const r = await api(`/v1/admin/members?limit=500${q ? `&q=${encodeURIComponent(q)}` : ""}`);
      $("#mlist").innerHTML = `<div class="table-wrap"><table>
        <tr><th>Όνομα</th><th>Κωδικός</th><th>Email επιχείρησης</th><th>QR</th><th>Πόντοι</th><th>Επιπλέον logins</th></tr>
        ${r.members
          .map(
            (m) => `<tr><td>${esc(m.name)}</td><td><code>${esc(m.id)}</code></td><td>${esc(m.email) || '<span class="error">λείπει</span>'}</td>
              <td>${m.qr_target ? `<a href="#qr/${encodeURIComponent(m.qr_target)}">εκτύπωση</a>` : `<button class="secondary" data-qr="${esc(m.id)}">Δημιουργία</button>`}</td>
              <td>${m.points}</td><td>${m.extra_logins}</td></tr>`,
          )
          .join("")}
      </table></div>`;
      $("#mlist").querySelectorAll("[data-qr]").forEach((b) => {
        b.onclick = async () => {
          const id = b.dataset.qr;
          await api(`/v1/admin/qr-targets/${encodeURIComponent(id)}`, { method: "PUT", body: { kind: "member", member_ids: [id] } });
          toast("Ο κωδικός QR δημιουργήθηκε");
          load();
        };
      });
    };
    let timer;
    $("#mq").oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 250);
    };
    $("#bulk-qr").onclick = async () => {
      const r = await api("/v1/admin/qr-targets/bulk-members", { method: "POST", body: {} });
      toast(`Δημιουργήθηκαν ${r.created} κωδικοί QR`);
      load();
    };
    $("#mu-add").onclick = async () => {
      await api("/v1/admin/member-users", { method: "PUT", body: { member_id: $("#mu-member").value.trim(), email: $("#mu-email").value.trim() } });
      toast("Το email προστέθηκε");
      $("#mu-email").value = "";
      load();
    };
    await load();
  },

  async pois(v) {
    const r = await api("/v1/admin/pois");
    v.innerHTML = `
      <h2>Σημεία ενδιαφέροντος</h2>
      <p class="muted">Τα σημεία χωρίς QR καταγράφονται με GPS: ο επισκέπτης μένει μέσα στην ακτίνα για 2 λεπτά. Αν τοποθετηθεί QR, δημιουργήστε τον εδώ.</p>
      <div class="table-wrap"><table>
        <tr><th>Όνομα</th><th>Κωδικός</th><th>Ακτίνα (μ.)</th><th>QR</th></tr>
        ${r.pois
          .map(
            (p) => `<tr><td>${esc(p.name)}</td><td><code>${esc(p.id)}</code></td>
            <td><input type="number" min="10" max="1000" value="${esc(p.radius_m)}" data-radius="${esc(p.id)}" class="narrow-input"></td>
            <td>${p.has_qr ? `<a href="#qr/${encodeURIComponent(p.id)}">εκτύπωση</a>` : `<button class="secondary" data-qr="${esc(p.id)}">Δημιουργία</button>`}</td></tr>`,
          )
          .join("")}
      </table></div>`;
    const byId = Object.fromEntries(r.pois.map((p) => [p.id, p]));
    v.querySelectorAll("[data-qr]").forEach((b) => {
      b.onclick = async () => {
        const p = byId[b.dataset.qr];
        await api(`/v1/admin/qr-targets/${encodeURIComponent(p.id)}`, { method: "PUT", body: { kind: "poi", poi_id: p.id, lat: p.lat, lng: p.lng } });
        toast("Ο κωδικός QR δημιουργήθηκε");
        views.pois(v);
      };
    });
    v.querySelectorAll("[data-radius]").forEach((i) => {
      i.onchange = async () => {
        const p = byId[i.dataset.radius];
        await api(`/v1/admin/pois/${encodeURIComponent(p.id)}`, { method: "PUT", body: { name: p.name, lat: p.lat, lng: p.lng, radius_m: Number(i.value) } });
        toast("Η ακτίνα αποθηκεύτηκε");
      };
    });
  },

  async qr(v, only) {
    const r = await api("/v1/admin/qr-targets");
    const list = r.qr_targets.filter((t) => t.active && (!only || t.id === only));
    const KIND = { member: "Επιχείρηση", poi: "Σημείο", shared: "Κοινή εμπειρία" };
    v.innerHTML = `
      <h2>Κωδικοί QR</h2>
      <div class="row no-print">
        <button id="print">Εκτύπωση</button>
        ${only ? `<a href="#qr">Όλοι οι κωδικοί</a>` : ""}
        <span class="muted">${list.length} κωδικοί</span>
      </div>
      <div class="qr-sheet">
        ${list
          .map(
            (t) => `<div class="qr-card"><img alt="QR ${esc(t.label)}" data-img="${esc(t.id)}">
              <div class="name">${esc(t.label || t.id)}</div>
              <div class="hint">${esc(KIND[t.kind] || t.kind)} · Σαρώστε με την εφαρμογή Rural Greece</div></div>`,
          )
          .join("")}
      </div>`;
    $("#print").onclick = () => window.print();
    for (const img of v.querySelectorAll("[data-img]")) {
      qrImageUrl(img.dataset.img).then((u) => (img.src = u)).catch(() => (img.alt = "σφάλμα"));
    }
  },

  async packages(v) {
    const r = await api("/v1/admin/packages");
    v.innerHTML = `
      <h2>Θεματικά πακέτα</h2>
      <p class="muted">Ένα πακέτο είναι μια σειρά στάσεων (κωδικοί μελών ή σημείων). Όποιος τις ολοκληρώσει όλες κερδίζει +30 πόντους.</p>
      <div class="table-wrap"><table>
        <tr><th>Τίτλος</th><th>Στάσεις</th><th>Κατάσταση</th><th></th></tr>
        ${r.packages
          .map(
            (p) => `<tr><td>${esc(p.title_el)}<div class="muted">${esc(p.title_en)}</div></td><td>${p.stops.map((s) => `<code>${esc(s)}</code>`).join(" → ")}</td>
            <td>${tag(p.active ? "active" : "cancelled")}</td><td><button class="secondary" data-edit="${esc(p.id)}">Επεξεργασία</button></td></tr>`,
          )
          .join("") || `<tr><td colspan="4" class="muted">Κανένα πακέτο ακόμα.</td></tr>`}
      </table></div>
      <div class="card" id="pkg-form">
        <h3 id="pkg-h">Νέο πακέτο</h3>
        <div class="grid2">
          <label>Κωδικός<input id="p-id" placeholder="π.χ. wine-route"></label>
          <label>Τίτλος (ελληνικά)<input id="p-el"></label>
          <label>Τίτλος (αγγλικά)<input id="p-en"></label>
          <label>Ενεργό<select id="p-active"><option value="1">Ναι</option><option value="0">Όχι</option></select></label>
        </div>
        <label class="muted">Περιγραφή (ελληνικά)<textarea id="p-del"></textarea></label>
        <label class="muted">Περιγραφή (αγγλικά)<textarea id="p-den"></textarea></label>
        <label class="muted">Στάσεις, με τη σειρά, χωρισμένες με κόμμα (τουλάχιστον 2)<textarea id="p-stops" placeholder="business-12, poi-40, business-7"></textarea></label>
        <div class="row"><button id="p-save">Αποθήκευση</button><span id="p-err" class="error"></span></div>
      </div>`;
    const byId = Object.fromEntries(r.packages.map((p) => [p.id, p]));
    $("#p-el").oninput = () => {
      if (!$("#p-id").dataset.locked) $("#p-id").value = slug($("#p-el").value);
    };
    v.querySelectorAll("[data-edit]").forEach((b) => {
      b.onclick = () => {
        const p = byId[b.dataset.edit];
        $("#pkg-h").textContent = "Επεξεργασία πακέτου";
        $("#p-id").value = p.id;
        $("#p-id").dataset.locked = "1";
        $("#p-el").value = p.title_el;
        $("#p-en").value = p.title_en || "";
        $("#p-del").value = (p.description && p.description.el) || "";
        $("#p-den").value = (p.description && p.description.en) || "";
        $("#p-stops").value = p.stops.join(", ");
        $("#p-active").value = p.active ? "1" : "0";
        $("#pkg-form").scrollIntoView({ behavior: "smooth" });
      };
    });
    $("#p-save").onclick = async () => {
      $("#p-err").textContent = "";
      const stops = $("#p-stops").value.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
      try {
        await api(`/v1/admin/packages/${encodeURIComponent($("#p-id").value.trim())}`, {
          method: "PUT",
          body: {
            title_el: $("#p-el").value.trim(),
            title_en: $("#p-en").value.trim() || undefined,
            description: { el: $("#p-del").value.trim() || null, en: $("#p-den").value.trim() || null },
            stops,
            active: $("#p-active").value === "1",
          },
        });
        toast("Το πακέτο αποθηκεύτηκε");
        views.packages(v);
      } catch (e) {
        $("#p-err").textContent = e.message === "invalid_request" ? "Ελέγξτε κωδικό (πεζά λατινικά και παύλες), τίτλο και τουλάχιστον 2 στάσεις." : e.message;
      }
    };
  },

  async rewards(v) {
    const r = await api("/v1/admin/rewards");
    v.innerHTML = `
      <h2>Ανταμοιβές</h2>
      <p class="muted">Οι ανταμοιβές του δικτύου (χωρίς μέλος) εξαργυρώνονται σε οποιοδήποτε μέλος. Οι πόντοι δεν είναι χρήματα.</p>
      <div class="table-wrap"><table>
        <tr><th>Τίτλος</th><th>Μέλος</th><th>Πόντοι</th><th>Εξαργυρώσεις</th><th>Κατάσταση</th><th></th></tr>
        ${r.rewards
          .map(
            (w) => `<tr><td>${esc(w.title_el)}<div class="muted">${esc(w.title_en)}</div></td><td>${esc(w.member_name) || "Δίκτυο"}</td>
            <td>${w.cost}</td><td>${w.redeemed}</td><td>${tag(w.active ? "active" : "cancelled")}</td>
            <td><button class="secondary" data-toggle="${esc(w.id)}">${w.active ? "Απόσυρση" : "Ενεργοποίηση"}</button></td></tr>`,
          )
          .join("") || `<tr><td colspan="6" class="muted">Καμία ανταμοιβή ακόμα.</td></tr>`}
      </table></div>
      <div class="card">
        <h3>Νέα ανταμοιβή δικτύου</h3>
        <div class="grid2">
          <label>Τίτλος (ελληνικά)<input id="w-el"></label>
          <label>Τίτλος (αγγλικά)<input id="w-en"></label>
          <label>Πόντοι<input id="w-cost" type="number" min="1"></label>
        </div>
        <div class="row spaced"><button id="w-save">Δημιουργία</button><span id="w-err" class="error"></span></div>
      </div>`;
    const byId = Object.fromEntries(r.rewards.map((w) => [w.id, w]));
    v.querySelectorAll("[data-toggle]").forEach((b) => {
      b.onclick = async () => {
        const w = byId[b.dataset.toggle];
        await api(`/v1/admin/rewards/${encodeURIComponent(w.id)}`, {
          method: "PUT",
          body: { member_id: w.member_id, title_el: w.title_el, title_en: w.title_en || undefined, cost: w.cost, active: !w.active },
        });
        views.rewards(v);
      };
    });
    $("#w-save").onclick = async () => {
      $("#w-err").textContent = "";
      try {
        await api(`/v1/admin/rewards/net-${ulidish()}`, {
          method: "PUT",
          body: { member_id: null, title_el: $("#w-el").value.trim(), title_en: $("#w-en").value.trim() || undefined, cost: Number($("#w-cost").value) },
        });
        toast("Η ανταμοιβή δημιουργήθηκε");
        views.rewards(v);
      } catch (e) {
        $("#w-err").textContent = e.message === "invalid_request" ? "Συμπληρώστε τίτλο και πόντους." : e.message;
      }
    };
  },

  async partnerships(v) {
    const r = await api("/v1/admin/partnerships");
    v.innerHTML = `
      <h2>Συνεργασίες (epaithros Connect)</h2>
      <div class="table-wrap"><table>
        <tr><th>Μέλος</th><th>Μέλος</th><th>Κατάσταση</th><th>Σημείωση</th><th>Αίτημα</th><th>Επιβεβαίωση</th></tr>
        ${r.partnerships
          .map(
            (p) => `<tr><td>${esc(p.member_a_name)}</td><td>${esc(p.member_b_name)}</td><td>${tag(p.status)}</td><td>${esc(p.note)}</td>
            <td>${fmtDate(p.created_at)}</td><td>${fmtDate(p.confirmed_at)}</td></tr>`,
          )
          .join("") || `<tr><td colspan="6" class="muted">Καμία συνεργασία ακόμα.</td></tr>`}
      </table></div>`;
  },

  async events(v) {
    v.innerHTML = `
      <h2>Συμβάντα</h2>
      <p class="muted">Κάθε σάρωση, επίσκεψη GPS, σύσταση και εξαργύρωση. Η ακύρωση αφαιρεί τους πόντους (και όσους προέκυψαν από αυτό)· τίποτα δεν διαγράφεται.</p>
      <div class="row no-print">
        <select id="e-status"><option value="">Όλες οι καταστάσεις</option>${Object.keys(STATUS).slice(0, 4).map((s) => `<option value="${s}">${STATUS[s]}</option>`).join("")}</select>
        <select id="e-type"><option value="">Όλοι οι τύποι</option>${["checkin.qr", "checkin.geo", "referral.redeemed", "route.completed", "partnership.created", "wallet.redeemed", "cancellation", "correction"].map((t) => `<option>${t}</option>`).join("")}</select>
        <input id="e-member" placeholder="Κωδικός μέλους" size="18">
        <input id="e-visitor" placeholder="Κωδικός επισκέπτη" size="18">
        <button id="e-go" class="secondary">Φιλτράρισμα</button>
      </div>
      <div id="elist"></div>`;
    const load = async () => {
      const p = new URLSearchParams({ limit: "200" });
      for (const [k, id] of [["status", "#e-status"], ["type", "#e-type"], ["member_id", "#e-member"], ["visitor_id", "#e-visitor"]]) {
        const val = $(id).value.trim();
        if (val) p.set(k, val);
      }
      const r = await api(`/v1/admin/events?${p}`);
      $("#elist").innerHTML = `<div class="table-wrap"><table>
        <tr><th>Ώρα</th><th>Τύπος</th><th>Κατάσταση</th><th>Επισκέπτης</th><th>Μέλη / σημείο</th><th>Πόντοι</th><th></th></tr>
        ${r.events
          .map(
            (e) => `<tr><td>${fmtDate(e.occurred_at)}</td><td>${esc(e.type)}</td><td>${tag(e.status)}${e.reason ? `<div class="muted">${esc(e.reason)}</div>` : ""}</td>
            <td><code>${esc(e.visitor_id)}</code></td><td>${esc((e.member_ids || []).join(", "))}${e.poi_id ? ` <code>${esc(e.poi_id)}</code>` : ""}</td>
            <td>${e.points}</td>
            <td>${e.status === "verified" && !["cancellation", "correction"].includes(e.type) ? `<button class="danger" data-cancel="${esc(e.event_id)}">Ακύρωση</button>` : ""}</td></tr>`,
          )
          .join("") || `<tr><td colspan="7" class="muted">Κανένα συμβάν.</td></tr>`}
      </table></div>`;
      $("#elist").querySelectorAll("[data-cancel]").forEach((b) => {
        b.onclick = async () => {
          const note = prompt("Λόγος ακύρωσης (θα καταγραφεί):");
          if (note === null) return;
          const r = await api("/v1/admin/events", {
            method: "POST",
            body: { event_id: `adm-${ulidish()}`, type: "cancellation", occurred_at: new Date().toISOString(), refers_to_event_id: b.dataset.cancel, payload: { note } },
          });
          const res = r.results && r.results[0];
          toast(res && res.status === "verified" ? "Ακυρώθηκε" : `Δεν ακυρώθηκε: ${(res && res.reason) || "σφάλμα"}`);
          load();
        };
      });
    };
    $("#e-go").onclick = load;
    await load();
  },

  async analytics(v) {
    v.innerHTML = `
      <h2>Στατιστικά δικτύου</h2>
      <div class="row no-print"><select id="a-days"><option value="7">7 ημέρες</option><option value="30" selected>30 ημέρες</option><option value="90">90 ημέρες</option><option value="365">1 έτος</option></select></div>
      <div id="aout"></div>`;
    const load = async () => {
      const a = await api(`/v1/admin/analytics?days=${$("#a-days").value}`);
      $("#aout").innerHTML = `
        <div class="stats">
          ${stat(a.totals.visitors, "Επισκέπτες (σύνολο)")}
          ${stat(a.totals.active_visitors, "Ενεργοί επισκέπτες")}
          ${stat(a.totals.active_partnerships, "Ενεργές συνεργασίες")}
          ${stat(a.totals.points_issued, "Πόντοι που δόθηκαν")}
        </div>
        <h3>Περισσότερες επισκέψεις</h3>
        <div class="table-wrap"><table><tr><th>Μέλος</th><th>Επισκέψεις</th></tr>
          ${a.top_members.map((m) => `<tr><td>${esc(m.name)}</td><td>${m.visits}</td></tr>`).join("") || `<tr><td colspan="2" class="muted">—</td></tr>`}
        </table></div>
        <h3>Συμβάντα ανά τύπο</h3>
        <div class="table-wrap"><table><tr><th>Τύπος</th><th>Κατάσταση</th><th>Πλήθος</th></tr>
          ${a.events.map((e) => `<tr><td>${esc(e.type)}</td><td>${tag(e.status)}</td><td>${e.n}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">—</td></tr>`}
        </table></div>
        <h3>Λόγοι απόρριψης</h3>
        <div class="table-wrap"><table><tr><th>Λόγος</th><th>Πλήθος</th></tr>
          ${a.rejected_reasons.map((e) => `<tr><td>${esc(e.reason)}</td><td>${e.n}</td></tr>`).join("") || `<tr><td colspan="2" class="muted">—</td></tr>`}
        </table></div>`;
    };
    $("#a-days").onchange = load;
    await load();
  },
};

const stat = (n, label) => `<div class="stat"><b>${esc(n)}</b><span>${esc(label)}</span></div>`;

async function route() {
  if (!token) return logout();
  $("#login").hidden = true;
  $("#nav").hidden = false;
  const [name, arg] = (location.hash.slice(1) || "overview").split("/");
  const view = views[name] ? name : "overview";
  document.querySelectorAll("#nav a").forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${view}`));
  const v = $("#view");
  v.innerHTML = `<p class="muted">Φόρτωση…</p>`;
  try {
    await views[view](v, arg ? decodeURIComponent(arg) : undefined);
  } catch (e) {
    if (token) v.innerHTML = `<p class="error">Σφάλμα: ${esc(e.message)}</p>`;
  }
}

$("#login-form").onsubmit = async (e) => {
  e.preventDefault();
  token = $("#token").value.trim();
  $("#login-error").textContent = "";
  try {
    await api("/v1/admin/overview");
    try {
      sessionStorage.setItem(TOKEN_KEY, token);
    } catch {}
    $("#token").value = "";
    route();
  } catch {
    $("#login-error").textContent = "Το κλειδί δεν είναι σωστό.";
  }
};
$("#logout").onclick = logout;
window.addEventListener("hashchange", route);
window.addEventListener("unhandledrejection", (e) => toast(`Σφάλμα: ${e.reason && e.reason.message ? e.reason.message : e.reason}`));
route();
