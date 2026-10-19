import { auth, rtdb, functions, isFirebaseConfigured } from "../UserStudent/firebaseConfig.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { ref, onValue, off, get, set } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

(() => {
  "use strict";

  const APPROVER_DIRECTORY_DEFAULTS = {
    event_head: { key: "event_head", label: "Event Head", stage: 1, defaultOn: true, required: true },
    vp_doc: { key: "vp_doc", label: "VP for Documentation", stage: 2, defaultOn: true, required: true },
    vp_ext: { key: "vp_ext", label: "VP for External", stage: 3, defaultOn: false, required: false, suggestIf: "outsideGuests" },
    org_pres: { key: "org_pres", label: "Org President", stage: 4, defaultOn: true, required: true },
    org_adv: { key: "org_adv", label: "Org Adviser", stage: 5, defaultOn: true, required: true },
    sir_abelida: { key: "sir_abelida", label: "Sir Abelida", stage: 6, defaultOn: true, required: true },
    hap: { key: "hap", label: "HAP", stage: 7, defaultOn: true, required: true },
    osas: { key: "osas", label: "OSAS", stage: 8, defaultOn: true, required: true },
  };

  const root = document.getElementById("approvalRoot");
  const pageHeadingTitle = document.getElementById("pageHeadingTitle");
  const toastElement = document.querySelector(".admin-toast");

  // Application State
  let currentAdminUid = null;
  let currentAdminProfile = null;
  let currentAdminKey = null; // e.g. "org_adv"
  let approverDirectory = { ...APPROVER_DIRECTORY_DEFAULTS };

  let queueItems = [];
  let recentDecisions = [];
  let activeReviewEventId = null;
  let activeEvent = null;
  let activeApproval = null;

  let queueListenerRef = null;
  let decisionsListenerRef = null;
  let activeEventRef = null;
  let activeApprovalRef = null;
  let toastTimer = null;

  // Initialize Page Header Today's Date
  const todayElement = document.querySelector("[data-today]");
  if (todayElement) {
    todayElement.textContent = new Date().toLocaleDateString("en-US", {
      timeZone: "Asia/Manila",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  }

  // Logout Handler
  const logoutBtn = document.querySelector(".admin-logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        if (auth) await signOut(auth);
      } catch {}
      localStorage.removeItem("recovibeAdminId");
      location.href = "AdminLogin.html";
    });
  }

  function esc(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (ch) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[ch]
    );
  }

  function showToast(message) {
    if (!toastElement) return;
    toastElement.textContent = message;
    toastElement.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastElement.hidden = true;
    }, 4000);
  }

  // 1. Auth Guard (Must be admin)
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      const localAdminId = localStorage.getItem("recovibeAdminId");
      if (!localAdminId && isFirebaseConfigured) {
        location.replace("AdminLogin.html");
        return;
      }
      currentAdminUid = localAdminId || "admin-demo-uid";
    } else {
      currentAdminUid = user.uid;
      // Verify role in RTDB
      if (rtdb) {
        try {
          const roleSnap = await get(ref(rtdb, `roles/${user.uid}`));
          const role = roleSnap.val();
          if (role && role !== "admin") {
            alert("Access restricted to administrators.");
            location.replace("AdminLogin.html");
            return;
          }
        } catch (err) {
          console.warn("Admin role verification notice:", err);
        }
      }
    }

    try {
      currentAdminProfile = JSON.parse(localStorage.getItem("recovibeAdminProfile") || "{}");
    } catch {
      currentAdminProfile = {};
    }

    const adminName = currentAdminProfile.name || auth?.currentUser?.displayName || "Administrator";
    const nameEl = document.querySelector("[data-name]");
    const avatarEl = document.querySelector("[data-avatar]");
    const roleEl = document.querySelector("[data-role]");

    if (nameEl) nameEl.textContent = adminName.toUpperCase();
    if (avatarEl) {
      avatarEl.textContent = adminName
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((p) => p[0])
        .join("")
        .toUpperCase() || "AD";
    }

    await initAdminData();
  });

  async function initAdminData() {
    await loadApproverDirectory();
    findOrAssignAdminKey();

    // Check URL parameters for direct review link: ?review={eventId}
    const urlParams = new URLSearchParams(window.location.search);
    const reviewId = urlParams.get("review") || urlParams.get("event") || urlParams.get("id");

    subscribeReviewQueue();
    subscribeRecentDecisions();

    if (reviewId) {
      openReviewScreen(reviewId);
    } else {
      renderReviewQueue();
    }
  }

  async function loadApproverDirectory() {
    if (!rtdb) return;
    try {
      const snap = await get(ref(rtdb, "approverDirectory"));
      const data = snap.val();
      if (data && typeof data === "object") {
        approverDirectory = data;
      }
    } catch (err) {
      console.warn("Could not load approver directory:", err);
    }
  }

  function findOrAssignAdminKey() {
    // 1. Look for matching UID in approverDirectory
    let matchedKey = null;
    Object.entries(approverDirectory).forEach(([k, item]) => {
      if (item && item.uid === currentAdminUid) {
        matchedKey = k;
      }
    });

    // 2. If not matched by UID, check localStorage preference or default to org_adv (Org Adviser)
    if (!matchedKey) {
      const savedKey = localStorage.getItem("recovibeAdminKey");
      if (savedKey && approverDirectory[savedKey]) {
        matchedKey = savedKey;
      } else {
        matchedKey = "org_adv"; // Default to Step 5: Org Adviser
      }
      // Link admin UID to this key
      claimApproverRole(matchedKey, false);
    }

    currentAdminKey = matchedKey;
    localStorage.setItem("recovibeAdminKey", currentAdminKey);

    const roleEl = document.querySelector("[data-role]");
    if (roleEl && approverDirectory[currentAdminKey]) {
      roleEl.textContent = approverDirectory[currentAdminKey].label;
    }
  }

  async function claimApproverRole(key, shouldReRender = true) {
    if (!key || !approverDirectory[key]) return;
    currentAdminKey = key;
    localStorage.setItem("recovibeAdminKey", key);

    const roleEl = document.querySelector("[data-role]");
    if (roleEl) roleEl.textContent = approverDirectory[key].label;

    if (rtdb && currentAdminUid) {
      try {
        if (functions && navigator.onLine) {
          const linkFn = httpsCallable(functions, "linkAdminToApprover");
          await linkFn({ key });
        } else {
          await set(ref(rtdb, `approverDirectory/${key}/uid`), currentAdminUid);
        }
      } catch (err) {
        console.warn("Link admin to approver notice:", err);
      }
    }

    if (shouldReRender) {
      if (activeReviewEventId) {
        renderReviewScreen();
      } else {
        renderReviewQueue();
      }
    }
  }

  // 2. Real-time Subscription to approverQueue/{uid}
  function subscribeReviewQueue() {
    if (queueListenerRef) {
      off(queueListenerRef);
      queueListenerRef = null;
    }

    if (!rtdb || !currentAdminUid) {
      // Demo fallback
      queueItems = [];
      updateQueueBadge(0);
      return;
    }

    queueListenerRef = ref(rtdb, `approverQueue/${currentAdminUid}`);
    onValue(queueListenerRef, (snap) => {
      const data = snap.val();
      const items = [];
      if (data && typeof data === "object") {
        Object.entries(data).forEach(([eventId, item]) => {
          if (item && typeof item === "object") {
            items.push({
              eventId: item.eventId || eventId,
              name: item.name || item.title || `Event #${eventId}`,
              date: item.date || item.startAt || "Date TBA",
              venue: item.venue || item.location || "PUP Biñan Campus",
              category: item.category || "Academic & Learning",
              step: item.step || (approverDirectory[currentAdminKey]?.stage || 1),
              status: item.status || "pending",
              paused: Boolean(item.paused || item.status === "paused"),
              updatedAt: item.updatedAt || Date.now(),
            });
          }
        });
      }

      // Sort newest first
      items.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt));
      queueItems = items;

      const activeWaitingCount = items.filter((it) => !it.paused).length;
      updateQueueBadge(activeWaitingCount);

      if (!activeReviewEventId) {
        renderReviewQueue();
      }
    }, (err) => {
      console.warn("approverQueue listener error:", err);
    });
  }

  function updateQueueBadge(count) {
    document.querySelectorAll("[data-queue-count]").forEach((badge) => {
      badge.textContent = count ? String(count) : "";
      badge.hidden = count === 0;
    });
  }

  // 3. Real-time Subscription to approverDecisions/{uid}
  function subscribeRecentDecisions() {
    if (decisionsListenerRef) {
      off(decisionsListenerRef);
      decisionsListenerRef = null;
    }

    if (!rtdb || !currentAdminUid) return;

    decisionsListenerRef = ref(rtdb, `approverDecisions/${currentAdminUid}`);
    onValue(decisionsListenerRef, (snap) => {
      const data = snap.val();
      const list = [];
      if (data && typeof data === "object") {
        Object.entries(data).forEach(([eventId, row]) => {
          if (row && typeof row === "object") {
            list.push({
              eventId,
              name: row.name || "Event",
              decision: row.decision || "Approved",
              note: row.note || "",
              decidedAt: row.decidedAt || Date.now(),
            });
          }
        });
      }
      list.sort((a, b) => Number(b.decidedAt) - Number(a.decidedAt));
      recentDecisions = list.slice(0, 10);

      if (!activeReviewEventId) {
        renderReviewQueue();
      }
    });
  }

  // =========================================================================
  // VIEW 1: REVIEW QUEUE
  // =========================================================================
  function renderReviewQueue() {
    if (!root) return;
    if (pageHeadingTitle) pageHeadingTitle.textContent = "Review Queue";

    const adminLabel = approverDirectory[currentAdminKey]?.label || "Admin Approver";

    // Build Role Selector Options
    const roleOptions = Object.entries(approverDirectory)
      .sort((a, b) => (a[1].stage || 0) - (b[1].stage || 0))
      .map(([k, item]) => {
        const isSel = k === currentAdminKey ? "selected" : "";
        return `<option value="${esc(k)}" ${isSel}>${esc(item.label)} (Stage ${item.stage})</option>`;
      })
      .join("");

    let cardsHtml = "";
    if (queueItems.length === 0) {
      cardsHtml = `
        <div class="queue-empty-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="#a8a29e" stroke-width="1.5" width="40" height="40" style="margin-bottom:12px;">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          <h3>Nothing waiting on you</h3>
          <p>You have no event proposals currently awaiting your review.</p>
        </div>
      `;
    } else {
      cardsHtml = `
        <div class="queue-cards-grid">
          ${queueItems
            .map((item) => {
              const isPaused = item.paused || item.status === "paused";
              return `
                <article class="queue-card" data-event-id="${esc(item.eventId)}">
                  <div>
                    <div class="queue-card-header">
                      <span class="queue-step-tag">Step ${item.step}</span>
                      ${
                        isPaused
                          ? `<span class="queue-paused-badge">Paused for revision</span>`
                          : ""
                      }
                    </div>
                    <h3 class="queue-card-title">${esc(item.name)}</h3>
                    <div class="queue-card-meta">
                      <div class="queue-card-meta-item">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" width="14" height="14">
                          <rect x="2.5" y="3.5" width="15" height="13.5" rx="1.6"/>
                          <path d="M2.5 8H17.5M6 2v3M14 2v3"/>
                        </svg>
                        <span>${esc(item.date)}</span>
                      </div>
                      <div class="queue-card-meta-item">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" width="14" height="14">
                          <path d="M10 2a6 6 0 0 0-6 6c0 4.5 6 10 6 10s6-5.5 6-10a6 6 0 0 0-6-6Z"/>
                          <circle cx="10" cy="8" r="2"/>
                        </svg>
                        <span>${esc(item.venue)}</span>
                      </div>
                      <div class="queue-card-meta-item">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4" width="14" height="14">
                          <circle cx="10" cy="10" r="7"/>
                          <path d="M10 6v4l3 2"/>
                        </svg>
                        <span>${esc(item.category)}</span>
                      </div>
                    </div>
                  </div>
                  <div class="queue-card-footer">
                    ${
                      isPaused
                        ? `<span style="font-size:12px; color:#92400e; font-style:italic;">Awaiting organizer updates</span>`
                        : `<button type="button" class="btn-queue-review" data-action="review" data-id="${esc(item.eventId)}">Review Proposal</button>`
                    }
                  </div>
                </article>
              `;
            })
            .join("")}
        </div>
      `;
    }

    // Recent Decisions HTML
    let recentHtml = "";
    if (recentDecisions.length > 0) {
      recentHtml = `
        <section class="recent-decisions-section">
          <h3>Your Recent Decisions</h3>
          <div class="recent-decisions-list">
            ${recentDecisions
              .map((d) => {
                const badgeClass =
                  d.decision === "Approved"
                    ? "approved"
                    : d.decision === "Asked for changes"
                    ? "asked-for-changes"
                    : "rejected";
                const dDate = new Date(d.decidedAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                });
                return `
                  <div class="recent-decision-item">
                    <div>
                      <strong>${esc(d.name)}</strong>
                      <small style="display:block; color:#786f70; font-size:11.5px; margin-top:2px;">${dDate}${d.note ? ` · "${esc(d.note)}"` : ""}</small>
                    </div>
                    <span class="decision-badge ${badgeClass}">${esc(d.decision)}</span>
                  </div>
                `;
              })
              .join("")}
          </div>
        </section>
      `;
    }

    root.innerHTML = `
      <div class="queue-header-row">
        <div class="queue-title-block">
          <h2>Review queue</h2>
          <p>Proposals waiting for your decision.</p>
        </div>
        <div class="approver-role-switcher">
          <label for="adminRoleSelect">Acting as:</label>
          <select id="adminRoleSelect">
            ${roleOptions}
          </select>
        </div>
      </div>

      ${cardsHtml}
      ${recentHtml}
    `;

    // Hook up role switcher
    const roleSelect = root.querySelector("#adminRoleSelect");
    if (roleSelect) {
      roleSelect.addEventListener("change", (e) => {
        claimApproverRole(e.target.value);
      });
    }

    // Hook up review buttons
    root.querySelectorAll('[data-action="review"]').forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.dataset.id;
        if (id) openReviewScreen(id);
      });
    });
  }

  // =========================================================================
  // VIEW 2: REVIEW SCREEN
  // =========================================================================
  function openReviewScreen(eventId) {
    activeReviewEventId = eventId;
    window.history.pushState(null, "", `AdminApproval.html?review=${encodeURIComponent(eventId)}`);

    if (activeEventRef) off(activeEventRef);
    if (activeApprovalRef) off(activeApprovalRef);

    if (!rtdb) return;

    activeEventRef = ref(rtdb, `events/${eventId}`);
    onValue(activeEventRef, (snap) => {
      activeEvent = snap.val();
      renderReviewScreen();
    });

    activeApprovalRef = ref(rtdb, `approvals/${eventId}`);
    onValue(activeApprovalRef, (snap) => {
      activeApproval = snap.val();
      renderReviewScreen();
    });
  }

  function closeReviewScreen() {
    activeReviewEventId = null;
    activeEvent = null;
    activeApproval = null;

    if (activeEventRef) {
      off(activeEventRef);
      activeEventRef = null;
    }
    if (activeApprovalRef) {
      off(activeApprovalRef);
      activeApprovalRef = null;
    }

    window.history.pushState(null, "", "AdminApproval.html");
    renderReviewQueue();
  }

  function renderReviewScreen() {
    if (!root || !activeReviewEventId) return;
    if (pageHeadingTitle) pageHeadingTitle.textContent = "Proposal Review";

    if (!activeEvent || !activeApproval) {
      root.innerHTML = `
        <div class="review-screen-container">
          <div class="review-screen-top-bar">
            <button type="button" class="btn-back-queue" id="btnBackToQueue">
              ← Back to queue
            </button>
          </div>
          <div class="admin-loading">Loading proposal details...</div>
        </div>
      `;
      root.querySelector("#btnBackToQueue")?.addEventListener("click", closeReviewScreen);
      return;
    }

    const members = activeApproval.members || {};
    const sortedMembers = Object.values(members).sort(
      (a, b) => (a.stage || 0) - (b.stage || 0) || (a.step || 0) - (b.step || 0)
    );

    // Identify current admin's member entry
    const myMember = members[currentAdminKey];
    const isMyTurn = myMember && myMember.status === "review" && activeApproval.status !== "revision";

    // Header Tag
    let turnTagHtml = "";
    if (isMyTurn) {
      turnTagHtml = `<span class="turn-badge">Your turn: Step ${myMember.step}</span>`;
    } else {
      turnTagHtml = `<div class="not-waiting-notice">This proposal is not waiting on you right now.</div>`;
    }

    // Details Grid
    const scheduleStr = `${activeEvent.startAt || "Date TBA"}${activeEvent.endAt ? ` - ${activeEvent.endAt}` : ""}`;
    const outsideGuestsStr = activeEvent.outsideGuests ? "Yes (Outside Guests)" : "No (Internal Only)";

    // Tracker Track Items
    const totalSteps = sortedMembers.length;
    let trackItemsHtml = "";

    // 1. Submitted Step
    trackItemsHtml += `
      <div class="admin-tracker-step">
        <div class="admin-step-connector is-green"></div>
        <div class="admin-step-dot dot-ok">✓</div>
        <span class="admin-step-num">Start</span>
        <span class="admin-step-label">Submitted</span>
        <span class="admin-step-status">${activeApproval.submittedAt ? new Date(activeApproval.submittedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Done"}</span>
      </div>
    `;

    // 2. Intermediate Steps
    sortedMembers.forEach((m, idx) => {
      const isLast = idx === sortedMembers.length - 1;
      const isOwnStep = m.key === currentAdminKey;
      let dotClass = "dot-wait";
      let dotIcon = "–";
      let statusText = "Waiting";
      let connectorGreen = false;

      if (m.status === "ok") {
        dotClass = "dot-ok";
        dotIcon = "✓";
        const dateStr = m.updatedAt
          ? new Date(m.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })
          : "Approved";
        statusText = `Approved ${dateStr}`;
        connectorGreen = true;
      } else if (m.status === "review") {
        dotClass = "dot-review";
        dotIcon = "⏱";
        statusText = "In review";
      } else if (m.status === "rev") {
        dotClass = "dot-rev";
        dotIcon = "✎";
        statusText = "Asked for changes";
      } else if (m.status === "rej") {
        dotClass = "dot-rej";
        dotIcon = "✕";
        statusText = "Rejected";
      }

      trackItemsHtml += `
        <div class="admin-tracker-step ${isOwnStep ? "is-own" : ""}" id="trackerStep_${esc(m.key)}">
          ${!isLast ? `<div class="admin-step-connector ${connectorGreen ? "is-green" : ""}"></div>` : `<div class="admin-step-connector ${connectorGreen ? "is-green" : ""}"></div>`}
          <div class="admin-step-dot ${dotClass}" title="${esc(m.label)}: ${statusText}">${dotIcon}</div>
          <span class="admin-step-num">STEP ${m.step}</span>
          <span class="admin-step-label">${esc(m.label)}</span>
          <span class="admin-step-status">${statusText}</span>
        </div>
      `;
    });

    // 3. Finish Step
    const isAllApproved = activeApproval.status === "approved" || (sortedMembers.length > 0 && sortedMembers.every((m) => m.status === "ok"));
    trackItemsHtml += `
      <div class="admin-tracker-step">
        <div class="admin-step-dot ${isAllApproved ? "dot-ok" : "dot-wait"}">${isAllApproved ? "✓" : "★"}</div>
        <span class="admin-step-num">End</span>
        <span class="admin-step-label">Finish</span>
        <span class="admin-step-status">${isAllApproved ? "Approved" : "Waiting"}</span>
      </div>
    `;

    // Notes List
    const actedMembers = sortedMembers.filter((m) => m.status !== "wait");
    let notesListHtml = "";
    if (actedMembers.length === 0) {
      notesListHtml = `<p style="font-size:13px; color:#78716c; margin:0;">No actions recorded yet.</p>`;
    } else {
      notesListHtml = actedMembers
        .map((m) => {
          const initials = (m.label || m.key).slice(0, 2).toUpperCase();
          const noteText = m.note || (m.status === "ok" ? "Approved proposal." : m.status === "review" ? "Currently reviewing proposal." : "Action taken.");
          return `
            <div class="admin-note-row">
              <div class="admin-note-avatar">${initials}</div>
              <div class="admin-note-body">
                <strong>${esc(m.label)} <small style="font-weight:normal; color:#786f70;">(${esc(m.status)})</small></strong>
                <p>${esc(noteText)}</p>
              </div>
            </div>
          `;
        })
        .join("");
    }

    // Next approver line
    const nextWaiting = sortedMembers.find((m) => m.status === "wait" || m.status === "review");
    const nextLineHtml = nextWaiting
      ? `<div class="next-approver-line">Next: ${esc(nextWaiting.label)} (Step ${nextWaiting.step} of ${totalSteps})</div>`
      : `<div class="next-approver-line">Next: None (Final approval reached)</div>`;

    // Documents List
    const files = activeApproval.files || {};
    const filesList = Object.values(files);
    let filesHtml = "";
    if (filesList.length === 0) {
      filesHtml = `<p style="font-size:13px; color:#78716c; margin:0;">No documents attached to this proposal.</p>`;
    } else {
      filesHtml = filesList
        .map((f) => {
          const hasRevision = f.status === "rev" || f.note;
          return `
            <div class="review-doc-row">
              <div class="review-doc-left">
                <div class="review-doc-icon">📄</div>
                <div>
                  <div class="review-doc-name">${esc(f.name)}</div>
                  <div class="review-doc-status ${hasRevision ? "has-note" : ""}">
                    ${hasRevision ? `Changes requested: "${esc(f.note)}"` : "No changes requested"}
                  </div>
                </div>
              </div>
            </div>
          `;
        })
        .join("");
    }

    // Decision Card HTML
    let decisionCardHtml = "";
    if (isMyTurn) {
      const fileOptions = filesList
        .map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`)
        .join("");

      decisionCardHtml = `
        <section class="review-decision-card">
          <h3>Decision</h3>
          <div class="decision-field-group">
            <label for="decisionNote">Note to organizer, needed for Request changes or Reject</label>
            <textarea id="decisionNote" class="decision-textarea" placeholder="Provide feedback or specify required revisions..."></textarea>
          </div>

          <div class="decision-field-group" id="decisionFileGroup">
            <label for="decisionFileSelect">If you request changes, which file?</label>
            <select id="decisionFileSelect" class="decision-select">
              <option value="" disabled selected>Select document...</option>
              ${fileOptions}
            </select>
          </div>

          <div id="decisionError" class="decision-validation-error" hidden></div>

          <div class="decision-buttons-row">
            <button type="button" class="btn-decision-approve" id="btnApprove">Approve</button>
            <button type="button" class="btn-decision-revise" id="btnRevise">Request changes</button>
            <button type="button" class="btn-decision-reject" id="btnReject">Reject</button>
          </div>
        </section>
      `;
    }

    // Admin Tools HTML (Remove approver who hasn't decided yet, Add approver not yet on chain)
    const canRemoveApprovers = sortedMembers.filter((m) => m.status !== "ok" && totalSteps > 1);
    const existingKeys = new Set(Object.keys(members));
    const availableToAdd = Object.entries(approverDirectory).filter(([k]) => !existingKeys.has(k));

    let adminToolsHtml = `
      <section class="admin-tools-card">
        <h4>Admin Tools</h4>
        <div style="font-size:13px; color:#57534e; margin-bottom:12px;">Manage approval chain steps for this event proposal.</div>

        <div class="admin-tools-approvers-list">
          ${canRemoveApprovers
            .map((m) => `
              <div class="admin-tool-row">
                <span>Step ${m.step}: <strong>${esc(m.label)}</strong> (${esc(m.status)})</span>
                <button type="button" class="btn-tool-remove" data-remove-key="${esc(m.key)}" data-remove-label="${esc(m.label)}">Remove</button>
              </div>
            `)
            .join("")}
        </div>

        ${
          availableToAdd.length > 0
            ? `
              <div class="admin-tools-add-row">
                <select id="addApproverSelect">
                  <option value="" disabled selected>Add another approver to chain...</option>
                  ${availableToAdd.map(([k, it]) => `<option value="${esc(k)}">${esc(it.label)} (Stage ${it.stage})</option>`).join("")}
                </select>
                <button type="button" class="btn-tool-add" id="btnAddApprover">Add to chain</button>
              </div>
            `
            : `<div style="font-size:12.5px; color:#78716c;">All available approver positions are included in this chain.</div>`
        }
      </section>
    `;

    root.innerHTML = `
      <div class="review-screen-container">
        <div class="review-screen-top-bar">
          <button type="button" class="btn-back-queue" id="btnBackToQueue">
            ← Back to queue
          </button>
        </div>

        <section class="review-header-card">
          <p class="review-source-eyebrow">Event source: ${esc(activeEvent.source || "Organizational")}</p>
          <div class="review-title-row">
            <h2>${esc(activeEvent.name || "Untitled Event")}</h2>
            ${isMyTurn ? turnTagHtml : ""}
          </div>
          ${!isMyTurn ? turnTagHtml : ""}

          <div class="review-details-grid">
            <div class="review-detail-item">
              <span class="review-detail-label">Organizer</span>
              <span class="review-detail-value">${esc(activeEvent.organizerName || "Event Organizer")}</span>
            </div>
            <div class="review-detail-item">
              <span class="review-detail-label">Schedule</span>
              <span class="review-detail-value">${esc(scheduleStr)}</span>
            </div>
            <div class="review-detail-item">
              <span class="review-detail-label">Venue</span>
              <span class="review-detail-value">${esc(activeEvent.venue || "PUP Biñan Campus")}</span>
            </div>
            <div class="review-detail-item">
              <span class="review-detail-label">Category</span>
              <span class="review-detail-value">${esc(activeEvent.category || "Academic & Learning")}</span>
            </div>
            <div class="review-detail-item">
              <span class="review-detail-label">Outside Guests</span>
              <span class="review-detail-value">${esc(outsideGuestsStr)}</span>
            </div>
          </div>
        </section>

        <!-- Approval Tracker -->
        <section class="review-tracker-card">
          <h3>Approval Tracker</h3>
          <div class="admin-tracker-track" id="adminTrackerTrack">
            ${trackItemsHtml}
          </div>

          <div class="admin-notes-wrap">
            ${notesListHtml}
            ${nextLineHtml}
          </div>
        </section>

        <!-- Documents List -->
        <section class="review-docs-card">
          <h3>Attached Documents</h3>
          ${filesHtml}
        </section>

        <!-- Decision Card -->
        ${decisionCardHtml}

        <!-- Admin Tools -->
        ${adminToolsHtml}
      </div>
    `;

    // Hook Back Button
    root.querySelector("#btnBackToQueue")?.addEventListener("click", closeReviewScreen);

    // Scroll active step into view
    setTimeout(() => {
      const ownStepEl = root.querySelector(".admin-tracker-step.is-own");
      if (ownStepEl) {
        ownStepEl.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
      }
    }, 150);

    // Decision Handlers
    if (isMyTurn) {
      const btnApprove = root.querySelector("#btnApprove");
      const btnRevise = root.querySelector("#btnRevise");
      const btnReject = root.querySelector("#btnReject");
      const noteInput = root.querySelector("#decisionNote");
      const fileSelect = root.querySelector("#decisionFileSelect");
      const errorEl = root.querySelector("#decisionError");

      const handleDecision = async (decision) => {
        if (errorEl) errorEl.hidden = true;
        const note = (noteInput?.value || "").trim();
        const fileId = fileSelect?.value || "";

        if ((decision === "revise" || decision === "reject") && note.length < 3) {
          if (errorEl) {
            errorEl.textContent = "Please enter a note of at least 3 characters explaining your decision to the organizer.";
            errorEl.hidden = false;
          }
          noteInput?.focus();
          return;
        }

        if (decision === "revise" && !fileId) {
          if (errorEl) {
            errorEl.textContent = "Please select which attached document requires changes.";
            errorEl.hidden = false;
          }
          fileSelect?.focus();
          return;
        }

        const confirmMsg =
          decision === "approve"
            ? "Approve this proposal and advance to the next step?"
            : decision === "revise"
            ? "Request changes from the organizer for this proposal?"
            : "Reject this event proposal?";
        if (!confirm(confirmMsg)) return;

        // Disable buttons
        [btnApprove, btnRevise, btnReject].forEach((b) => {
          if (b) b.disabled = true;
        });

        try {
          if (functions && navigator.onLine) {
            const decideFn = httpsCallable(functions, "decideApproval");
            await decideFn({
              eventId: activeReviewEventId,
              key: currentAdminKey,
              decision,
              note,
              fileId: decision === "revise" ? fileId : undefined,
            });
          }

          const toastMsg =
            decision === "approve"
              ? "Approved. The organizer was notified."
              : decision === "revise"
              ? "Changes requested. The organizer was notified."
              : "Proposal rejected. The organizer was notified.";

          showToast(toastMsg);
          closeReviewScreen();
        } catch (err) {
          alert("Could not process decision: " + (err.message || err));
          [btnApprove, btnRevise, btnReject].forEach((b) => {
            if (b) b.disabled = false;
          });
        }
      };

      btnApprove?.addEventListener("click", () => handleDecision("approve"));
      btnRevise?.addEventListener("click", () => handleDecision("revise"));
      btnReject?.addEventListener("click", () => handleDecision("reject"));
    }

    // Admin Tools Handlers
    root.querySelectorAll("[data-remove-key]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const key = btn.dataset.removeKey;
        const label = btn.dataset.removeLabel || key;
        if (!confirm(`Are you sure you want to remove "${label}" from the approval chain?`)) return;

        btn.disabled = true;
        try {
          if (functions && navigator.onLine) {
            const removeFn = httpsCallable(functions, "removeApprover");
            await removeFn({ eventId: activeReviewEventId, key });
          }
          showToast(`Removed ${label} from chain.`);
        } catch (err) {
          alert("Could not remove approver: " + (err.message || err));
          btn.disabled = false;
        }
      });
    });

    const btnAddApprover = root.querySelector("#btnAddApprover");
    const addSelect = root.querySelector("#addApproverSelect");
    if (btnAddApprover && addSelect) {
      btnAddApprover.addEventListener("click", async () => {
        const key = addSelect.value;
        if (!key) return;

        btnAddApprover.disabled = true;
        try {
          if (functions && navigator.onLine) {
            const addFn = httpsCallable(functions, "addApprover");
            await addFn({ eventId: activeReviewEventId, key });
          }
          showToast(`Added ${approverDirectory[key]?.label || key} to chain.`);
        } catch (err) {
          alert("Could not add approver: " + (err.message || err));
          btnAddApprover.disabled = false;
        }
      });
    }
  }

  // Cleanup on leaving page
  window.addEventListener("beforeunload", () => {
    if (queueListenerRef) off(queueListenerRef);
    if (decisionsListenerRef) off(decisionsListenerRef);
    if (activeEventRef) off(activeEventRef);
    if (activeApprovalRef) off(activeApprovalRef);
  });
})();
