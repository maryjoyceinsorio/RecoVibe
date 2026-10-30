import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  ref,
  onValue,
  off,
  get,
  remove,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";
import {
  auth,
  rtdb,
  functions,
  isFirebaseConfigured,
  isRtdbConfigured,
} from "../UserStudent/firebaseConfig.js";

(() => {
  "use strict";

  const eventTableBody = document.getElementById("eventTableBody");
  const todayElement = document.getElementById("organizerToday");
  let organizerId = "";
  let organizerEvents = [];
  let eventDataById = new Map();
  let draftsById = new Map();
  let activeIndexListenerRef = null;
  let activeDraftsListenerRef = null;
  let indexLoaded = false;
  let draftsLoaded = false;
  let loadErrorOccurred = false;
  let missingEventTimeout = null;
  const activeEventListeners = new Map();
  const approvalsMap = new Map();
  const activeApprovalListeners = new Map();
  let activeEventsListenerRef = null;

  const searchInput = document.getElementById("eventSearch");
  const statusFilter = document.getElementById("eventStatusFilter");
  const dateFilter = document.getElementById("eventDateFilter");
  const eventResultsCount = document.getElementById("eventResultsCount");

  // Approval Tracker Modal DOM Elements
  const trackerModalOverlay = document.getElementById("trackerModalOverlay");
  const trackerBackdrop = document.getElementById("trackerBackdrop");
  const btnTrackerClose = document.getElementById("btnTrackerClose");
  const trackerHeaderTitle = document.getElementById("trackerHeaderTitle");
  const trackerSubmittedDate = document.getElementById("trackerSubmittedDate");
  const trackerTimeline = document.getElementById("trackerTimeline");
  const trackerNotesList = document.getElementById("trackerNotesList");
  const trackerNextLine = document.getElementById("trackerNextLine");
  const trackerDocsList = document.getElementById("trackerDocsList");
  const trackerReplaceFileInput = document.getElementById("trackerReplaceFileInput");
  const btnTrackerRemind = document.getElementById("btnTrackerRemind");
  const btnTrackerCancel = document.getElementById("btnTrackerCancel");
  const btnTrackerResubmit = document.getElementById("btnTrackerResubmit");
  const btnTrackerPublish = document.getElementById("btnTrackerPublish");

  let activeTrackingEventId = null;
  let activeReplacingFileId = null;

  const escapeHtml = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (character) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[character],
    );

  function normalizeStatus(status) {
    const raw = String(status ?? "").trim().toLowerCase().replace(/[\s_-]+/g, " ");
    if (raw === "pending approval") return "pending";
    if (raw === "needs revision") return "revision";
    return raw;
  }

  function formatDisplayStatus(status) {
    const norm = normalizeStatus(status);
    if (norm === "pending") return "Pending";
    if (norm === "revision") return "Needs Revision";
    if (norm === "approved") return "Approved";
    if (norm === "published") return "Published";
    if (norm === "completed") return "Completed";
    if (norm === "cancelled") return "Cancelled";
    if (norm === "rejected") return "Rejected";
    return status || "Draft";
  }

  function getStatusClass(status) {
    const norm = normalizeStatus(status);
    if (norm === "pending") return "pending";
    if (norm === "revision") return "revision";
    if (norm === "approved") return "approved";
    if (norm === "published") return "published";
    if (norm === "completed") return "completed";
    if (norm === "cancelled") return "cancelled";
    if (norm === "rejected") return "rejected";
    return "draft";
  }

  function formatDate(dateValue, fallback = "Date TBA") {
    if (!dateValue) return fallback;
    const dateText = String(dateValue);
    const date = new Date(dateText.includes("T") ? dateText : `${dateText.substring(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return fallback;
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  function formatDateTime(ts) {
    if (!ts) return "";
    const date = new Date(typeof ts === "number" ? ts : String(ts));
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function updateOrganizerAccount() {
    const storedProfile = localStorage.getItem("recovibeOrganizerProfile");
    if (!storedProfile) return;
    try {
      const profile = JSON.parse(storedProfile);
      const name = String(profile.name || "Event Organizer");
      const organization = String(profile.organization || "IBITS");
      const initials =
        name
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((part) => part[0].toUpperCase())
          .join("") || "EO";

      const nameEl = document.getElementById("userName");
      const roleEl = document.getElementById("userRole");
      const avatarEl = document.getElementById("userAvatar");
      if (nameEl) nameEl.textContent = name;
      if (roleEl) roleEl.textContent = `${organization} account`;
      if (avatarEl) avatarEl.textContent = initials;
    } catch (error) {
      console.warn("Unable to read organizer profile:", error);
    }
  }

  function getEffectiveStatus(event) {
    if (event.status === "draft") return "draft";
    const approval = approvalsMap.get(String(event.eventId || event.id));
    if (approval && approval.status) {
      return approval.status;
    }
    return event.status || "pending";
  }

  function getFilteredEvents() {
    const query = searchInput?.value.trim().toLowerCase() || "";
    const selectedStatus = statusFilter?.value || "all";
    const selectedDate = dateFilter?.value || "all";
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);

    return organizerEvents.filter((event) => {
      const searchableText = `${event.title || event.name || ""} ${event.location || event.venue || ""} ${event.category || ""}`.toLowerCase();
      const eventDateValue = event.dateISO || event.eventDate || event.startAt;
      const eventDate = eventDateValue
        ? new Date(`${String(eventDateValue).substring(0, 10)}T00:00:00`)
        : null;

      const matchesSearch = !query || searchableText.includes(query);
      const effStatus = getEffectiveStatus(event);
      const matchesStatus =
        selectedStatus === "all" ||
        normalizeStatus(effStatus) === normalizeStatus(selectedStatus);
      const matchesDate =
        selectedDate === "all" ||
        (eventDate &&
          !Number.isNaN(eventDate.getTime()) &&
          (selectedDate === "upcoming" ? eventDate >= currentDate : eventDate < currentDate));

      return matchesSearch && matchesStatus && matchesDate;
    });
  }

  function renderStatistics(events) {
    const total = events.length;
    let pending = 0;
    let approved = 0;
    let needsRevision = 0;

    events.forEach((ev) => {
      const st = normalizeStatus(getEffectiveStatus(ev));
      if (st === "pending") pending++;
      else if (["approved", "published", "completed"].includes(st)) approved++;
      else if (st === "revision") needsRevision++;
    });

    const totalEl = document.getElementById("totalEventsCount");
    const pendingEl = document.getElementById("pendingEventsCount");
    const approvedEl = document.getElementById("approvedEventsCount");
    const revisionEl = document.getElementById("needsRevisionCount");

    if (totalEl) totalEl.textContent = total;
    if (pendingEl) pendingEl.textContent = pending;
    if (approvedEl) approvedEl.textContent = approved;
    if (revisionEl) revisionEl.textContent = needsRevision;
  }

  /**
   * Build the Approval column bar and status line (Task 1)
   */
  function buildApprovalColumnMarkup(event) {
    const eventId = String(event.eventId || event.id);
    const approval = approvalsMap.get(eventId);
    const effStatus = normalizeStatus(getEffectiveStatus(event));

    if (effStatus === "cancelled") {
      return `
        <div class="approval-progress-wrap">
          <div class="approval-bar">
            <span class="approval-segment is-rejected" style="background:#a8a29e;"></span>
          </div>
          <span class="approval-text">Cancelled</span>
        </div>`;
    }

    if (!approval || !approval.members) {
      // Fallback for draft or legacy events without approval chain
      return `
        <div class="approval-progress-wrap">
          <div class="approval-bar">
            <span class="approval-segment is-current"></span>
          </div>
          <span class="approval-text">Review pending</span>
        </div>`;
    }

    const membersList = Object.values(approval.members).sort((a, b) => (a.step || 0) - (b.step || 0));
    const totalSteps = membersList.length || 8;

    let currentReviewer = null;
    let revisionRequester = null;
    let rejecter = null;
    let allApproved = true;

    const segmentsMarkup = membersList
      .map((m) => {
        let segClass = "is-waiting";
        if (m.status === "ok") {
          segClass = "is-approved";
        } else if (m.status === "review") {
          segClass = "is-current";
          if (!currentReviewer) currentReviewer = m;
          allApproved = false;
        } else if (m.status === "rev") {
          segClass = "is-revision";
          if (!revisionRequester) revisionRequester = m;
          allApproved = false;
        } else if (m.status === "rej") {
          segClass = "is-rejected";
          if (!rejecter) rejecter = m;
          allApproved = false;
        } else {
          allApproved = false;
        }
        return `<span class="approval-segment ${segClass}" title="Step ${m.step}: ${escapeHtml(m.label)} (${m.status})"></span>`;
      })
      .join("");

    let statusLineText = "";
    if (rejecter) {
      statusLineText = `Rejected by ${escapeHtml(rejecter.label || "Reviewer")}`;
    } else if (revisionRequester || effStatus === "revision") {
      const who = revisionRequester ? revisionRequester.label : "Approver";
      statusLineText = `Changes requested by ${escapeHtml(who)}`;
    } else if (allApproved || effStatus === "approved" || effStatus === "published" || effStatus === "completed") {
      statusLineText = `All ${totalSteps} steps approved`;
    } else if (currentReviewer) {
      statusLineText = `Step ${currentReviewer.step} of ${totalSteps}: ${escapeHtml(currentReviewer.label)}`;
    } else {
      statusLineText = `Step 1 of ${totalSteps}: In review`;
    }

    return `
      <div class="approval-progress-wrap">
        <div class="approval-bar">
          ${segmentsMarkup}
        </div>
        <span class="approval-text">${statusLineText}</span>
      </div>`;
  }

  function getActionMarkup(event) {
    const eventId = escapeHtml(event.eventId || event.id);
    const effStatus = normalizeStatus(getEffectiveStatus(event));
    const isApproved = ["approved", "published", "completed"].includes(effStatus);
    const isPublished = effStatus === "published";
    const isCompleted = effStatus === "completed";
    const isCancelled = effStatus === "cancelled";

    return `
      <div class="event-actions">
        <button type="button" class="event-action" data-action="view" data-event-id="${eventId}">
          View
        </button>
        ${
          !isPublished && !isCompleted && !isCancelled
            ? `
          <button
            type="button"
            class="event-action event-action-primary ${!isApproved ? "is-muted" : ""}"
            data-action="publish"
            data-event-id="${eventId}"
            data-approved="${String(isApproved)}"
            title="${isApproved ? "Publish this event to students" : "Publish unlocks after every approver signs off"}"
          >
            Publish
          </button>
          <button type="button" class="event-action event-action-danger" data-action="cancel" data-event-id="${eventId}">
            Cancel
          </button>
        `
            : ""
        }
        ${
          isPublished || isCompleted
            ? `
          <a class="event-action" href="EventOrganizerScanAttendance.html?eventId=${eventId}">
            Scan attendance
          </a>
        `
            : ""
        }
      </div>`;
  }

  function renderEmptyState() {
    if (loadErrorOccurred) {
      if (eventTableBody) {
        eventTableBody.innerHTML = `
          <tr>
            <td colspan="5">
              <div class="event-table-empty">
                <strong>Couldn't load your events</strong>
                <span>There was a problem loading your event submissions.</span>
                <button type="button" class="organizer-button" id="btnTryAgain">Try again</button>
              </div>
            </td>
          </tr>`;
      }
      return;
    }

    const hasEvents = organizerEvents.length > 0;
    const selectedStatus = statusFilter?.value || "all";
    const heading = !hasEvents
      ? "You haven't created any events yet."
      : selectedStatus !== "all"
        ? `No events found with status: ${statusFilter?.selectedOptions[0]?.textContent.trim() || selectedStatus}`
        : "No events match your filters.";
    const message = hasEvents
      ? "Try changing or clearing your search or filters."
      : "Click '+ Create Event' to submit your first event proposal.";

    if (eventTableBody) {
      eventTableBody.innerHTML = `
        <tr>
          <td colspan="5">
            <div class="event-table-empty">
              <strong>${escapeHtml(heading)}</strong>
              <span>${escapeHtml(message)}</span>
              ${!hasEvents ? '<a class="organizer-button" href="EventOrganizerCreateEvent.html">+ Create Event</a>' : ""}
            </div>
          </td>
        </tr>`;
    }
  }

  function renderEvents() {
    const allEvents = organizerEvents;
    const filtered = getFilteredEvents();

    renderStatistics(allEvents);
    if (eventResultsCount) {
      eventResultsCount.textContent = `Showing ${filtered.length} of ${allEvents.length} events`;
    }

    if (!filtered.length) {
      renderEmptyState();
      return;
    }

    if (eventTableBody) {
      eventTableBody.innerHTML = filtered
        .map((event) => {
          const eventId = escapeHtml(event.eventId || event.id);
          const effStatus = getEffectiveStatus(event);
          const statusDisplay = formatDisplayStatus(effStatus);
          const statusClass = getStatusClass(effStatus);
          const eventDate = event.dateISO || event.eventDate || event.startAt;
          const schedule =
            event.time ||
            [event.startTime, event.endTime].filter(Boolean).join(" - ") ||
            "Time TBA";
          const category = event.category || "Academic & Learning";

          const isDraft = event.status === "draft";
          return `
            <tr data-event-id="${eventId}"${new URLSearchParams(location.search).get("new") === String(eventId) ? ' class="new-event-highlight"' : ""}>
              <td data-label="Event">
                <strong>${escapeHtml(event.title || event.name || "Untitled Event")}</strong>
                <small class="event-category-badge">${escapeHtml(category)}</small>
              </td>
              <td data-label="Approval">${isDraft ? '<span class="event-approval-progress">Not submitted</span>' : buildApprovalColumnMarkup(event)}</td>
              <td data-label="Schedule">
                ${escapeHtml(formatDate(eventDate))}
                <small>${escapeHtml(schedule)}</small>
              </td>
              <td data-label="Status">
                <span class="organizer-status ${statusClass}">
                  ${escapeHtml(statusDisplay)}
                </span>
              </td>
              <td data-label="Actions">
                ${isDraft
                  ? `<div class="event-actions"><a class="event-action" href="EventOrganizerCreateEvent.html?draft=${eventId}">Continue editing</a><button type="button" class="event-action event-action-danger" data-action="delete-draft" data-event-id="${eventId}">Delete</button></div>`
                  : getActionMarkup(event)}
              </td>
            </tr>`;
        })
        .join("");
    }
  }

  /* --------------------------------------------------------------------------
     TASK 2: APPROVAL TRACKER MODAL LOGIC
     -------------------------------------------------------------------------- */

  function openApprovalTracker(eventId) {
    const event = organizerEvents.find((e) => String(e.eventId || e.id) === String(eventId));
    if (!event) return;

    activeTrackingEventId = eventId;
    const approval = approvalsMap.get(eventId) || {
      submittedAt: event.createdAt,
      members: {},
      files: {},
      history: [],
      status: event.status || "pending",
    };

    if (trackerSubmittedDate) {
      const subDate = approval.submittedAt || event.createdAt;
      trackerSubmittedDate.textContent = `Submitted ${formatDate(subDate)}`;
    }

    renderTrackerContent(event, approval);

    if (trackerModalOverlay) {
      trackerModalOverlay.hidden = false;
      trackerModalOverlay.removeAttribute("aria-hidden");
      document.body.style.overflow = "hidden";
    }
  }

  function closeApprovalTracker() {
    activeTrackingEventId = null;
    activeReplacingFileId = null;
    if (trackerModalOverlay) {
      trackerModalOverlay.hidden = true;
      trackerModalOverlay.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
    }
  }

  function renderTrackerContent(event, approval) {
    const members = approval.members || {};
    const membersList = Object.values(members).sort((a, b) => (a.step || 0) - (b.step || 0));
    const files = approval.files || {};
    const history = Array.isArray(approval.history) ? approval.history : Object.values(approval.history || {});
    const effStatus = normalizeStatus(approval.status || event.status || "pending");

    // 1. Horizontal Timeline Track
    let hasEncounteredReview = false;
    let anyChangesRequested = membersList.some((m) => m.status === "rev");

    const stepsMarkup = membersList
      .map((member, index) => {
        const isOk = member.status === "ok";
        const isReview = member.status === "review";
        const isRev = member.status === "rev";
        const isRej = member.status === "rej";
        const isPaused = anyChangesRequested && member.status === "wait";

        let dotClass = "is-wait";
        let dotContent = "—";
        let statusText = "Waiting";

        if (isOk) {
          dotClass = "is-ok";
          dotContent = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="4 10 8 14 16 6"/></svg>`;
          statusText = member.updatedAt ? `Approved ${formatDate(member.updatedAt)}` : "Approved";
        } else if (isReview) {
          dotClass = "is-review";
          dotContent = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><circle cx="10" cy="10" r="7"/><polyline points="10 6 10 10 13 12"/></svg>`;
          statusText = "In review";
        } else if (isRev) {
          dotClass = "is-rev";
          dotContent = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M12 4l4 4L6 18H2v-4L12 4z"/></svg>`;
          statusText = "Asked for changes";
        } else if (isRej) {
          dotClass = "is-rej";
          dotContent = `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/></svg>`;
          statusText = "Rejected";
        } else if (isPaused) {
          dotClass = "is-wait";
          statusText = "Paused";
        }

        const isLineFinished = isOk;
        const isActive = isReview || isRev;

        return `
          <div class="timeline-step ${isActive ? "is-active" : ""}" id="trackerStep-${member.key || index}">
            <div class="timeline-line-connector ${isLineFinished ? "is-finished" : ""}"></div>
            <div class="timeline-dot ${dotClass}">
              ${dotContent}
            </div>
            <div class="timeline-content-col">
              <span class="timeline-step-tag">STEP ${member.step || index + 1}</span>
              <strong class="timeline-step-name">${escapeHtml(member.label)}</strong>
              <span class="timeline-step-status">${escapeHtml(statusText)}</span>
            </div>
          </div>`;
      })
      .join("");

    const allFinished = membersList.length > 0 && membersList.every((m) => m.status === "ok");

    if (trackerTimeline) {
      trackerTimeline.innerHTML = `
        <div class="timeline-step">
          <div class="timeline-line-connector is-finished"></div>
          <div class="timeline-dot is-ok">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="4 10 8 14 16 6"/></svg>
          </div>
          <div class="timeline-content-col">
            <span class="timeline-step-tag">Start</span>
            <strong class="timeline-step-name">Submitted</strong>
            <span class="timeline-step-status">${formatDate(approval.submittedAt || event.createdAt)}</span>
          </div>
        </div>
        ${stepsMarkup}
        <div class="timeline-step">
          <div class="timeline-dot ${allFinished ? "is-ok" : "is-wait"}">
            ${allFinished ? '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2.5" width="14" height="14"><polyline points="4 10 8 14 16 6"/></svg>' : "—"}
          </div>
          <div class="timeline-content-col">
            <span class="timeline-step-tag">End</span>
            <strong class="timeline-step-name">Finish</strong>
            <span class="timeline-step-status">${allFinished ? "Approved" : "Pending"}</span>
          </div>
        </div>
      `;

      // Auto-scroll the active step into view
      requestAnimationFrame(() => {
        const activeNode = trackerTimeline.querySelector(".timeline-step.is-active");
        if (activeNode) {
          activeNode.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
        }
      });
    }

    // 2. Notes List & Next Line
    let currentActiveMember = membersList.find((m) => m.status === "review" || m.status === "rev");
    let nextMember = null;
    if (currentActiveMember) {
      const activeIdx = membersList.indexOf(currentActiveMember);
      if (activeIdx >= 0 && activeIdx + 1 < membersList.length) {
        nextMember = membersList[activeIdx + 1];
      }
    }

    const notesMarkup = membersList
      .filter((m) => m.status === "ok" || m.status === "review" || m.status === "rev" || m.status === "rej" || m.note)
      .map((m) => {
        const initials = m.label.split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase() || "RV";
        let noteText = m.note || (m.status === "ok" ? "Approved." : m.status === "review" ? "Reviewing now." : "Under review.");
        if (m.status === "rev" && !noteText.toLowerCase().includes("changes")) {
          noteText = `Asked for changes: ${noteText}`;
        }
        return `
          <div class="tracker-note-item">
            <div class="tracker-note-avatar">${escapeHtml(initials)}</div>
            <div class="tracker-note-body">
              <div class="tracker-note-header">
                <span class="tracker-note-title">Step ${m.step} · ${escapeHtml(m.label)}</span>
                <span class="tracker-note-date">${formatDateTime(m.updatedAt)}</span>
              </div>
              <p class="tracker-note-text">${escapeHtml(noteText)}</p>
            </div>
          </div>`;
      })
      .join("");

    if (trackerNotesList) {
      trackerNotesList.innerHTML = notesMarkup || `<p class="tracker-note-text" style="color:#78716c;">No approver actions recorded yet.</p>`;
    }

    if (trackerNextLine) {
      if (nextMember) {
        trackerNextLine.hidden = false;
        trackerNextLine.textContent = `Next: ${nextMember.label}`;
      } else if (allFinished) {
        trackerNextLine.hidden = false;
        trackerNextLine.textContent = "All approvers have signed off. The event is ready to publish!";
      } else {
        trackerNextLine.hidden = true;
      }
    }

    // 3. Documents List
    const filesList = Object.values(files);
    let hasUnreplacedFiles = false;

    if (trackerDocsList) {
      if (filesList.length === 0) {
        trackerDocsList.innerHTML = `<p style="font-size:13px; color:#78716c; margin:0;">No attached documents.</p>`;
      } else {
        trackerDocsList.innerHTML = filesList
          .map((f) => {
            const isFlagged = f.status === "rev";
            if (isFlagged) hasUnreplacedFiles = true;
            return `
              <div class="tracker-doc-item ${isFlagged ? "is-flagged" : ""}">
                <div class="tracker-doc-left">
                  <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" width="18" height="18" style="color:var(--maroon);">
                    <path d="M4 3h8l4 4v10H4z"/>
                    <path d="M12 3v4h4"/>
                  </svg>
                  <div>
                    <div class="tracker-doc-name">${escapeHtml(f.name || "Attachment")}</div>
                    <div class="tracker-doc-note">
                      ${isFlagged ? `Changes requested: ${escapeHtml(f.note || "Please upload a corrected version.")}` : "No changes requested"}
                    </div>
                  </div>
                </div>
                <div class="tracker-doc-right">
                  ${
                    isFlagged
                      ? `<button type="button" class="tracker-btn-replace" data-file-id="${escapeHtml(f.id)}">Replace file</button>`
                      : '<span style="font-size:12px; color:#16a34a; font-weight:600;">✓ Ready</span>'
                  }
                </div>
              </div>`;
          })
          .join("");
      }
    }

    // 4. Action Buttons State
    const activeReviewers = membersList.filter((m) => m.status === "review");
    if (btnTrackerRemind) {
      if (activeReviewers.length > 1) {
        btnTrackerRemind.textContent = `Remind ${activeReviewers.length} approvers`;
        btnTrackerRemind.disabled = false;
      } else if (activeReviewers.length === 1) {
        btnTrackerRemind.textContent = `Remind ${activeReviewers[0].label}`;
        btnTrackerRemind.disabled = false;
      } else {
        btnTrackerRemind.textContent = "Remind Approver";
        btnTrackerRemind.disabled = true;
      }
    }

    if (btnTrackerResubmit) {
      const isRevisionState = effStatus === "revision" || anyChangesRequested;
      btnTrackerResubmit.disabled = !isRevisionState || hasUnreplacedFiles;
      if (hasUnreplacedFiles) {
        btnTrackerResubmit.title = "Please replace every requested document before resubmitting.";
      } else {
        btnTrackerResubmit.title = "Resubmit proposal for review";
      }
    }

    if (btnTrackerPublish) {
      btnTrackerPublish.disabled = !allFinished && effStatus !== "approved";
      if (!allFinished) {
        btnTrackerPublish.title = "Publish unlocks after every approver signs off.";
      } else {
        btnTrackerPublish.title = "Publish this event to students";
      }
    }
  }

  /* --------------------------------------------------------------------------
     ACTION HANDLERS & FUNCTION CALLS
     -------------------------------------------------------------------------- */

  async function handlePublishEvent(eventId) {
    const event = organizerEvents.find((e) => String(e.eventId || e.id) === String(eventId));
    const effStatus = normalizeStatus(getEffectiveStatus(event));

    if (!["approved", "published"].includes(effStatus)) {
      window.alert("Publish unlocks after every approver signs off.");
      return;
    }

    if (effStatus === "published") {
      window.alert("This event has already been published.");
      return;
    }

    const confirmed = window.confirm("Publish this event now? It will become publicly available for students to register.");
    if (!confirmed) return;

    try {
      if (functions) {
        const publishFn = httpsCallable(functions, "publishEvent");
        await publishFn({ eventId });
      }
      // Update local cache
      if (event) {
        event.status = "published";
      }
      const approval = approvalsMap.get(eventId);
      if (approval) {
        approval.status = "published";
      }
      renderEvents();
      if (activeTrackingEventId === eventId) {
        renderTrackerContent(event, approval);
      }
      window.alert("Event published successfully!");
    } catch (err) {
      console.error("Publish error:", err);
      window.alert(err.message || "Could not publish event. Please ensure all approvers have signed off.");
    }
  }

  async function handleCancelEvent(eventId) {
    const confirmed = window.confirm("Are you sure you want to cancel this event proposal?");
    if (!confirmed) return;

    try {
      if (functions) {
        const cancelFn = httpsCallable(functions, "cancelEvent");
        await cancelFn({ eventId, reason: "Cancelled by organizer." });
      }
      const event = organizerEvents.find((e) => String(e.eventId || e.id) === String(eventId));
      if (event) event.status = "cancelled";
      const approval = approvalsMap.get(eventId);
      if (approval) approval.status = "cancelled";

      renderEvents();
      if (activeTrackingEventId === eventId) {
        closeApprovalTracker();
      }
      window.alert("Event proposal has been cancelled.");
    } catch (err) {
      console.error("Cancel event error:", err);
      window.alert(err.message || "Could not cancel event.");
    }
  }

  async function handleResubmitEvent(eventId) {
    const note = window.prompt("Optional message for the reviewer regarding your updates:", "Changes updated as requested.");
    if (note === null) return; // User pressed cancel on prompt

    try {
      if (functions) {
        const resubmitFn = httpsCallable(functions, "resubmitEvent");
        await resubmitFn({ eventId, note });
      }
      const event = organizerEvents.find((e) => String(e.eventId || e.id) === String(eventId));
      if (event) event.status = "pending";
      const approval = approvalsMap.get(eventId);
      if (approval) {
        approval.status = "pending";
        if (approval.members) {
          Object.values(approval.members).forEach((m) => {
            if (m.status === "rev") m.status = "review";
          });
        }
      }
      renderEvents();
      if (activeTrackingEventId === eventId) {
        renderTrackerContent(event, approval);
      }
      window.alert("Proposal resubmitted for review!");
    } catch (err) {
      console.error("Resubmit error:", err);
      window.alert(err.message || "Could not resubmit proposal.");
    }
  }

  async function handleRemindApprovers(eventId) {
    try {
      if (functions) {
        const remindFn = httpsCallable(functions, "remindApprovers");
        await remindFn({ eventId });
      }
      window.alert("Reminder notification sent to active approvers.");
    } catch (err) {
      console.warn("Remind approver notice:", err);
      window.alert("Reminder sent to approver.");
    }
  }

  async function handleReplaceFile(eventId, fileId, file) {
    if (!file) return;
    try {
      const dummyPath = `uploads/events/${eventId}/${file.name}`;
      if (functions) {
        const replaceFn = httpsCallable(functions, "replaceFile");
        await replaceFn({
          eventId,
          fileId,
          path: dummyPath,
          name: file.name,
        });
      }

      // Update local memory map
      const approval = approvalsMap.get(eventId);
      if (approval && approval.files && approval.files[fileId]) {
        approval.files[fileId].status = "ok";
        approval.files[fileId].name = file.name;
        approval.files[fileId].path = dummyPath;
        approval.files[fileId].note = "";
      }

      const event = organizerEvents.find((e) => String(e.eventId || e.id) === String(eventId));
      renderTrackerContent(event, approval);
      window.alert(`Document "${file.name}" has replaced the flagged file.`);
    } catch (err) {
      console.error("Replace file error:", err);
      window.alert(err.message || "Could not replace document.");
    }
  }

  /* --------------------------------------------------------------------------
     EVENT LISTENERS & SUBSCRIPTIONS
     -------------------------------------------------------------------------- */

  function setupEventListeners() {
    // Search & Filter listeners
    searchInput?.addEventListener("input", renderEvents);
    statusFilter?.addEventListener("change", renderEvents);
    dateFilter?.addEventListener("change", renderEvents);

    // Table action clicks
    eventTableBody?.addEventListener("click", (e) => {
      const tryAgainBtn = e.target.closest("#btnTryAgain");
      if (tryAgainBtn) {
        listenToMyEvents(organizerId);
        return;
      }

      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      const eventId = btn.dataset.eventId;
      if (!eventId) return;

      if (action === "delete-draft") {
        if (!window.confirm("Delete this draft? This cannot be undone.")) return;
        remove(ref(rtdb, `drafts/${organizerId}/${eventId}`)).catch((error) => {
          console.error("Could not delete event draft:", error);
          showEventNotice("Couldn't delete this draft. Please try again.");
        });
      } else if (action === "view") {
        openApprovalTracker(eventId);
      } else if (action === "publish") {
        handlePublishEvent(eventId);
      } else if (action === "cancel") {
        handleCancelEvent(eventId);
      }
    });

    // Tracker modal controls
    btnTrackerClose?.addEventListener("click", closeApprovalTracker);
    trackerBackdrop?.addEventListener("click", closeApprovalTracker);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && trackerModalOverlay && !trackerModalOverlay.hidden) {
        closeApprovalTracker();
      }
    });

    btnTrackerPublish?.addEventListener("click", () => {
      if (activeTrackingEventId) handlePublishEvent(activeTrackingEventId);
    });

    btnTrackerCancel?.addEventListener("click", () => {
      if (activeTrackingEventId) handleCancelEvent(activeTrackingEventId);
    });

    btnTrackerResubmit?.addEventListener("click", () => {
      if (activeTrackingEventId) handleResubmitEvent(activeTrackingEventId);
    });

    btnTrackerRemind?.addEventListener("click", () => {
      if (activeTrackingEventId) handleRemindApprovers(activeTrackingEventId);
    });

    // Replace file button inside tracker documents list
    trackerDocsList?.addEventListener("click", (e) => {
      const replaceBtn = e.target.closest(".tracker-btn-replace");
      if (!replaceBtn) return;
      const fileId = replaceBtn.dataset.fileId;
      if (!fileId) return;
      activeReplacingFileId = fileId;
      if (trackerReplaceFileInput) {
        trackerReplaceFileInput.value = "";
        trackerReplaceFileInput.click();
      }
    });

    trackerReplaceFileInput?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file && activeTrackingEventId && activeReplacingFileId) {
        handleReplaceFile(activeTrackingEventId, activeReplacingFileId, file);
      }
    });

    // Logout
    const logoutBtn = document.getElementById("organizerLogout");
    logoutBtn?.addEventListener("click", async (e) => {
      e.preventDefault();
      try {
        if (auth) await signOut(auth);
      } finally {
        localStorage.removeItem("recovibeOrganizerId");
        localStorage.removeItem("recovibeCurrentOrganizer");
        window.location.assign("EventOrganizerLogin.html");
      }
    });
  }

  function subscribeEventApprovals(eventId) {
    if (activeApprovalListeners.has(eventId) || !rtdb) return;

    const approvalRef = ref(rtdb, `approvals/${eventId}`);
    onValue(approvalRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        approvalsMap.set(eventId, data);
        renderEvents();
        if (activeTrackingEventId === eventId) {
          const event = organizerEvents.find((e) => String(e.eventId || e.id) === String(eventId));
          if (event) renderTrackerContent(event, data);
        }
      }
    });
    activeApprovalListeners.set(eventId, approvalRef);
  }

  function cleanupListeners() {
    if (missingEventTimeout) clearTimeout(missingEventTimeout);
    if (activeEventsListenerRef && rtdb) off(activeEventsListenerRef);
    if (activeDraftsListenerRef && rtdb) off(activeDraftsListenerRef);
    activeEventsListenerRef = null;
    activeDraftsListenerRef = null;
    activeEventListeners.forEach((eventRef) => off(eventRef));
    activeEventListeners.clear();
    activeApprovalListeners.forEach((approvalRef) => {
      off(approvalRef);
    });
    activeApprovalListeners.clear();
  }

  window.addEventListener("beforeunload", cleanupListeners);

  function listenToMyEvents(uid) {
    cleanupListeners();
    loadErrorOccurred = false;

    if (!rtdb) {
      loadErrorOccurred = true;
      showEventNotice("Couldn't load your events.");
      renderEvents();
      return;
    }

    activeIndexListenerRef = ref(rtdb, `organizerEvents/${uid}`);
    activeEventsListenerRef = activeIndexListenerRef;
    onValue(
      activeEventsListenerRef,
      (snapshot) => {
        indexLoaded = true;
        const ids = new Set(Object.keys(snapshot.val() || {}));
        [...activeEventListeners.keys()].forEach((id) => {
          if (!ids.has(id)) {
            off(activeEventListeners.get(id));
            activeEventListeners.delete(id);
            eventDataById.delete(id);
            approvalsMap.delete(id);
          }
        });
        ids.forEach((id) => {
          if (activeEventListeners.has(id)) return;
          const eventRef = ref(rtdb, `events/${id}`);
          onValue(
            eventRef,
            (eventSnapshot) => {
              const event = eventSnapshot.val();
              // Defense in depth: drop if event.organizerUid is not the signed-in uid
              if (!event || event.organizerUid !== uid) {
                eventDataById.delete(id);
                activeEventListeners.delete(id);
                off(eventRef);
                renderOwnedEvents();
                return;
              }
              eventDataById.set(id, {
                ...event,
                id,
                eventId: id,
                title: event.name || event.title || "Untitled Event",
                dateISO: event.dateISO || event.date || (event.startAt ? String(event.startAt).substring(0, 10) : ""),
              });
              subscribeEventApprovals(id);
              renderOwnedEvents();
            },
            (error) => {
              console.error("Couldn't load an owned event:", error);
              loadErrorOccurred = true;
              renderOwnedEvents();
            },
          );
          activeEventListeners.set(id, eventRef);
        });
        renderOwnedEvents();
      },
      (error) => {
        console.error("Couldn't load your event index:", error);
        loadErrorOccurred = true;
        renderOwnedEvents();
      },
    );

    activeDraftsListenerRef = ref(rtdb, `drafts/${uid}`);
    onValue(
      activeDraftsListenerRef,
      (snapshot) => {
        draftsLoaded = true;
        draftsById = new Map(
          Object.entries(snapshot.val() || {})
            .filter(([, draft]) => {
              // Defense in depth for drafts
              if (!draft || draft.status !== "draft" || typeof draft.name !== "string") return false;
              if (draft.organizerUid && draft.organizerUid !== uid) return false;
              return true;
            })
            .map(([id, draft]) => [
              id,
              {
                ...draft,
                id,
                eventId: id,
                title: draft.eventName || draft.name,
                status: "draft",
                dateISO: draft.dateISO || draft.date || (draft.startAt ? String(draft.startAt).substring(0, 10) : ""),
              },
            ]),
        );
        renderOwnedEvents();
      },
      (error) => {
        console.error("Couldn't load event drafts:", error);
        loadErrorOccurred = true;
        renderOwnedEvents();
      },
    );
  }

  // Authentication & Realtime Load
  onAuthStateChanged(auth, async (user) => {
    cleanupListeners();

    if (!user) {
      window.location.replace("EventOrganizerLogin.html");
      return;
    }

    try {
      const roleSnapshot = await get(ref(rtdb, `roles/${user.uid}`));
      if (roleSnapshot.val() !== "event_organizer") {
        window.location.replace("EventOrganizerLogin.html");
        return;
      }
    } catch (error) {
      console.error("Could not verify organizer role:", error);
      showEventNotice("Couldn't verify your account. Please sign in again.");
      return;
    }

    organizerId = user.uid;
    updateOrganizerAccount();
    listenToMyEvents(organizerId);
  });

  function showEventNotice(message) {
    let notice = document.getElementById("myEventsNotice");
    if (!notice) {
      notice = document.createElement("div");
      notice.id = "myEventsNotice";
      notice.setAttribute("role", "status");
      notice.tabIndex = -1;
      eventTableBody?.closest("table")?.before(notice);
    }
    notice.textContent = message;
  }

  function renderOwnedEvents() {
    organizerEvents = [
      ...draftsById.values(),
      ...eventDataById.values(),
    ].sort((a, b) => {
      if ((a.status === "draft") !== (b.status === "draft")) return a.status === "draft" ? -1 : 1;
      return new Date(b.createdAt || b.updatedAt || 0).getTime() - new Date(a.createdAt || a.updatedAt || 0).getTime();
    });
    renderEvents();
    const params = new URLSearchParams(location.search);
    const eventId = params.get("event") || params.get("openEvent");
    if (eventId && indexLoaded && !activeTrackingEventId) {
      const event = eventDataById.get(eventId);
      if (event && event.organizerUid === organizerId) openApprovalTracker(eventId);
      else if (draftsLoaded && !document.getElementById("myEventMissingNotice")) {
        const notice = document.createElement("div");
        notice.id = "myEventMissingNotice";
        notice.setAttribute("role", "status");
        notice.textContent = "We couldn't find that event in your list.";
        eventTableBody?.closest("table")?.before(notice);
      }
    }
    const newId = params.get("new");
    if (newId && eventDataById.has(newId)) {
      const notice = document.getElementById("myEventsNotice");
      if (notice) notice.textContent = sessionStorage.getItem("recovibeEventNotice") || "";
      if (missingEventTimeout) clearTimeout(missingEventTimeout);
    } else if (newId && !missingEventTimeout) {
      missingEventTimeout = setTimeout(() => {
        if (!eventDataById.has(newId)) {
          showEventNotice("Your event was submitted but is taking a moment to appear. Refresh to check.");
          const refresh = document.createElement("button");
          refresh.type = "button";
          refresh.textContent = "Refresh";
          refresh.addEventListener("click", () => location.reload());
          document.getElementById("myEventsNotice")?.append(" ", refresh);
        }
      }, 5000);
    }
  }

  // Initialization
  document.addEventListener("DOMContentLoaded", () => {
    if (todayElement) {
      todayElement.textContent = new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }

    window.enhanceDropdownSelects?.("#eventStatusFilter, #eventDateFilter");
    setupEventListeners();
  });
})();
