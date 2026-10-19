/**
 * RecoVibe - Unified Create Event Page (Teacher & Event Organizer)
 * Complies with strict role-based access, accessible design, live preview,
 * readiness checks, conflict checking, reusable past events, and robust input rules.
 */
import { auth, rtdb, functions, isFirebaseConfigured } from "../UserStudent/firebaseConfig.js";
import { httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const APPROVER_DIRECTORY = {
  event_head: { key: "event_head", label: "Event Head", stage: 1, defaultOn: true, required: true },
  vp_doc: { key: "vp_doc", label: "VP for Documentation", stage: 2, defaultOn: true, required: true },
  vp_ext: { key: "vp_ext", label: "VP for External", stage: 3, defaultOn: false, required: false, suggestIf: "outsideGuests" },
  org_pres: { key: "org_pres", label: "Org President", stage: 4, defaultOn: true, required: true },
  org_adv: { key: "org_adv", label: "Org Adviser", stage: 5, defaultOn: true, required: true },
  sir_abelida: { key: "sir_abelida", label: "Sir Abelida", stage: 6, defaultOn: true, required: true },
  hap: { key: "hap", label: "HAP", stage: 7, defaultOn: true, required: true },
  osas: { key: "osas", label: "OSAS", stage: 8, defaultOn: true, required: true },
};

(function initCreateEventModule() {
  "use strict";

  // Ensure page explicitly runs in light theme matching Photo 3 & 4
  try {
    document.documentElement.setAttribute("data-theme", "light");
    if (document.body) {
      document.body.classList.remove("dark-mode");
    }
  } catch (e) {}

  // 1. Detect Context & Page
  const isOrganizerPage = /EventOrganizerCreateEvent\.html$/i.test(location.pathname);
  const root = document.getElementById("createEventRoot");
  if (!root) {
    console.error("Root element #createEventRoot not found.");
    return;
  }
  root.setAttribute("data-theme", "light");

  // Check URL parameters for explicit unauthorized testing (e.g. ?role=Student or ?role=Admin)
  const urlParams = new URLSearchParams(location.search);
  const queryRole = urlParams.get("role")?.toLowerCase();
  const queryUnauthorized = urlParams.get("unauthorized");

  if (queryUnauthorized === "true" || (queryRole && ["student", "admin", "superadmin"].includes(queryRole))) {
    renderUnauthorized("Access Restricted", "This page is strictly reserved for Teachers and Event Organizers. You do not have permission to create events.");
    return;
  }

  // 2. Identify Role & Profiles with Safe Fallbacks
  const teacherId = localStorage.getItem("recovibeTeacherId");
  const teacherProfile = readJSON("recovibeCurrentTeacher", null) || readJSON("recovibeTeacher", null) || {};
  const organizerId = localStorage.getItem("recovibeOrganizerId");
  const organizerProfile = readJSON("recovibeOrganizerProfile", null) || readJSON("recovibeOrganizer", null) || {};

  const currentRole = isOrganizerPage ? "Event Organizer" : "Teacher";

  const userIdentifier = isOrganizerPage
    ? String(organizerId || organizerProfile.id || organizerProfile.email || "organizer-ibits").trim()
    : String(teacherId || teacherProfile.id || teacherProfile.email || "teacher-faculty").trim();

  const teacherName = String(teacherProfile.name || teacherProfile.fullName || "Prof. Faculty").trim();
  const organizerOrgName = String(organizerProfile.organization || organizerProfile.orgName || organizerProfile.name || "IBITS").trim();

  const readOnlyOrganizerValue = isOrganizerPage ? organizerOrgName : teacherName;
  const defaultEventSource = isOrganizerPage ? "" : "Teachers / Faculty";

  const storageKeyEvents = isOrganizerPage ? "recovibeOrganizerEvents" : "recovibeTeacherEvents";
  const redirectListUrl = isOrganizerPage ? "EventOrganizerMyEvents.html" : "TeacherMyEvent.html";

  // System Settings
  const systemSettings = readJSON("recovibeSystemSettings", {}) || {};
  const requireApproval = systemSettings.requireApprovalForNewEvents !== false;
  const registrationEnabled = systemSettings.registrationEnabled !== false;

  // Manila Date & Timezone Helpers (Never derive local day from toISOString)
  function getManilaDateInfo() {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const dateStr = formatter.format(now); // e.g. "2026-10-13"
    const [yStr] = dateStr.split("-");
    const currentYear = parseInt(yStr, 10);
    const maxYear = currentYear % 2 === 0 ? currentYear + 2 : currentYear + 1;
    const maxDateStr = `${maxYear}-12-31`;
    return {
      todayStr: dateStr,
      currentYear,
      maxYear,
      maxDateStr,
    };
  }

  function getManilaCurrentMinutes() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      hour12: false,
      hour: "numeric",
      minute: "numeric",
    }).formatToParts(now);
    const h = parseInt(parts.find((p) => p.type === "hour").value, 10);
    const m = parseInt(parts.find((p) => p.type === "minute").value, 10);
    return h * 60 + m;
  }

  // 3. Dropdown & Constant Data
  const EVENT_SOURCES = [
    "PUP Official",
    "CSC",
    "Teachers / Faculty",
    "Student Council",
    "Academic Organization",
    "Non-Academic Organization",
    "External",
  ];

  const CATEGORIES = [
    "Academic & Learning",
    "Tech & Innovation",
    "Leadership & Career",
    "Sports & Fitness",
    "Music & Entertainment",
    "Orgs & Student Acts",
    "Social Events",
    "Community & Outreach",
    "Competitions",
    "Seminars & Workshops",
    "Arts & Culture",
    "University & Campuses",
  ];

  // Target Year Level: Default "All Levels"
  const TARGET_YEARS = [
    "All Levels",
    "1st Year",
    "2nd Year",
    "3rd Year",
    "4th Year",
    "Ladderize",
  ];

  // Venue Records with explicit type (indoor, outdoor, online)
  const VENUES_GROUPED = [
    {
      campus: "PUP Biñan",
      venues: [
        { name: "Open Field | PUP Biñan", maxCapacity: 500, type: "outdoor" },
        { name: "AVR1 | PUP Biñan", maxCapacity: 150, type: "indoor" },
        { name: "AVR2 | PUP Biñan", maxCapacity: 100, type: "indoor" },
        { name: "AVR2-1Room | PUP Biñan", maxCapacity: 40, type: "indoor" },
        { name: "AVR2-2Room | PUP Biñan", maxCapacity: 40, type: "indoor" },
        { name: "AVR2-3Room | PUP Biñan", maxCapacity: 40, type: "indoor" },
        { name: "Kiosk | PUP Biñan", maxCapacity: 50, type: "outdoor" },
      ],
    },
    {
      campus: "PUP CITE",
      venues: [
        { name: "Open Field | PUP CITE", maxCapacity: 500, type: "outdoor" },
        { name: "4th Floor | PUP CITE", maxCapacity: 200, type: "indoor" },
      ],
    },
    {
      campus: "Other",
      venues: [
        { name: "Others | Inside PUP", maxCapacity: 100, type: "indoor" },
        { name: "Others | Outside PUP", maxCapacity: 200, type: "outdoor" },
        { name: "Online / Virtual", maxCapacity: 1000, type: "online" },
      ],
    },
  ];

  const VENUES_FLAT_MAP = {};
  VENUES_GROUPED.forEach((group) => {
    group.venues.forEach((v) => {
      VENUES_FLAT_MAP[v.name] = { maxCapacity: v.maxCapacity, type: v.type };
    });
  });

  const manilaDateInfo = getManilaDateInfo();

  // 4. State Management
  const state = {
    mode: "existing", // "existing" (default) | "new"
    searchQuery: "",
    isCopied: false,
    copiedFrom: null,
    editingEventId: null,
    dirty: false,
    selectedCategories: [],
    participatingFaculty: isOrganizerPage
      ? []
      : [{ id: userIdentifier, name: teacherName, email: teacherProfile.email || "faculty@pup.edu.ph" }],
    participantDocs: [],
    approvalDocs: [],
    conflict: null,
    highlightedFields: new Set(),
    categoryDropdownOpen: false,
    deadlineManuallyEdited: false,
    outsideGuests: false,
    selectedApprovers: Object.keys(APPROVER_DIRECTORY).filter(
      (k) => APPROVER_DIRECTORY[k].defaultOn || APPROVER_DIRECTORY[k].required
    ),
  };

  Object.defineProperty(state, "participantFiles", {
    get() { return this.participantDocs; },
    set(val) { this.participantDocs = Array.isArray(val) ? val : []; }
  });
  Object.defineProperty(state, "approvalFiles", {
    get() { return this.approvalDocs; },
    set(val) { this.approvalDocs = Array.isArray(val) ? val : []; }
  });

  // 5. Safe Utilities
  function readJSON(key, fallback) {
    try {
      const val = localStorage.getItem(key);
      return val ? JSON.parse(val) : fallback;
    } catch {
      return fallback;
    }
  }

  function writeJSON(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  }

  function escapeHTML(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // 6. Toast Notification Helper
  function showToast(message) {
    const existing = document.querySelector(".ce-toast");
    if (existing) existing.remove();

    const toast = document.createElement("div");
    toast.className = "ce-toast";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("is-visible");
    }, 10);

    setTimeout(() => {
      toast.classList.remove("is-visible");
      setTimeout(() => toast.remove(), 250);
    }, 3000);
  }

  // 7. Load Past Events for Current User
  function loadCurrentUserEvents() {
    const list = readJSON(storageKeyEvents, []);
    const filtered = list.filter((ev) => {
      if (!ev) return false;
      if (isOrganizerPage) {
        const orgMatch = (ev.organizer || ev.organizerName || "").toLowerCase().includes(organizerOrgName.toLowerCase()) ||
                         (ev.organizer || ev.organizerName || "").toLowerCase().includes("ibits") ||
                         (ev.organizer || ev.organizerName || "").toLowerCase().includes("organizer");
        const idMatch = String(ev.createdBy || ev.organizerId || "").toLowerCase() === userIdentifier.toLowerCase();
        return orgMatch || idMatch;
      } else {
        const creatorMatch = String(ev.createdBy || ev.teacherId || "").toLowerCase() === userIdentifier.toLowerCase();
        const facultyMatch = Array.isArray(ev.participatingFaculty) && ev.participatingFaculty.some((f) =>
          String(f.id || f.name || "").toLowerCase().includes(teacherName.toLowerCase()) ||
          String(f.id || "").toLowerCase() === userIdentifier.toLowerCase()
        );
        const nameMatch = (ev.organizer || ev.organizerName || "").toLowerCase().includes(teacherName.toLowerCase());
        return creatorMatch || facultyMatch || nameMatch;
      }
    });

    if (filtered.length === 0) {
      const sampleEvents = isOrganizerPage ? [
        {
          id: "seed-org-1",
          eventId: "seed-org-1",
          title: "IBITS General Assembly 2025",
          organizer: organizerOrgName,
          organizerName: organizerOrgName,
          source: "Academic Organization",
          category: "Orgs & Student Acts, Leadership & Career",
          categories: ["Orgs & Student Acts", "Leadership & Career"],
          targetYear: "All Levels",
          date: "2025-09-18",
          dateISO: "2025-09-18",
          timeStart: "08:00 AM",
          timeEnd: "12:00 PM",
          venue: "AVR1 | PUP Biñan",
          maxCapacity: 120,
          description: "Annual general assembly for all IBITS members and computer studies students.",
          isCommon: true,
          participantDocuments: [{ name: "General_Assembly_Program.pdf", size: 245000, type: "PDF" }],
        },
        {
          id: "seed-org-2",
          eventId: "seed-org-2",
          title: "Web Development Bootcamp & Tech Talk",
          organizer: organizerOrgName,
          organizerName: organizerOrgName,
          source: "Academic Organization",
          category: "Tech & Innovation, Academic & Learning",
          categories: ["Tech & Innovation", "Academic & Learning"],
          targetYear: "2nd Year",
          date: "2025-11-12",
          dateISO: "2025-11-12",
          timeStart: "01:00 PM",
          timeEnd: "05:00 PM",
          venue: "AVR2 | PUP Biñan",
          maxCapacity: 80,
          description: "Hands-on workshop covering modern web technologies and industry practices.",
          isCommon: true,
          participantDocuments: [{ name: "Bootcamp_Handout.docx", size: 180000, type: "DOCX" }],
        },
        {
          id: "seed-org-3",
          eventId: "seed-org-3",
          title: "CodeFest 2025: Hackathon Championship",
          organizer: organizerOrgName,
          organizerName: organizerOrgName,
          source: "Academic Organization",
          category: "Competitions, Tech & Innovation",
          categories: ["Competitions", "Tech & Innovation"],
          targetYear: "All Levels",
          date: "2025-12-05",
          dateISO: "2025-12-05",
          timeStart: "08:00 AM",
          timeEnd: "06:00 PM",
          venue: "Open Field | PUP Biñan",
          maxCapacity: 250,
          description: "Inter-collegiate programming contest and development sprint.",
          isCommon: false,
          participantDocuments: [{ name: "Hackathon_Mechanics.pdf", size: 310000, type: "PDF" }],
        },
      ] : [
        {
          id: "seed-tch-1",
          eventId: "seed-tch-1",
          title: "Faculty Research & Curriculum Colloquium",
          organizer: teacherName,
          organizerName: teacherName,
          source: "Teachers / Faculty",
          category: "Academic & Learning, Seminars & Workshops",
          categories: ["Academic & Learning", "Seminars & Workshops"],
          targetYear: "All Levels",
          date: "2025-10-15",
          dateISO: "2025-10-15",
          timeStart: "09:00 AM",
          timeEnd: "12:00 PM",
          venue: "AVR1 | PUP Biñan",
          maxCapacity: 100,
          description: "Curriculum alignment and faculty research showcase.",
          isCommon: true,
          participatingFaculty: [{ id: userIdentifier, name: teacherName, email: "faculty@pup.edu.ph" }],
          participantDocuments: [{ name: "Research_Colloquium_Agenda.pdf", size: 320000, type: "PDF" }],
        },
        {
          id: "seed-tch-2",
          eventId: "seed-tch-2",
          title: "Midterm Review & Academic Consultation Session",
          organizer: teacherName,
          organizerName: teacherName,
          source: "Teachers / Faculty",
          category: "Academic & Learning",
          categories: ["Academic & Learning"],
          targetYear: "1st Year",
          date: "2025-11-20",
          dateISO: "2025-11-20",
          timeStart: "01:00 PM",
          timeEnd: "05:00 PM",
          venue: "AVR2 | PUP Biñan",
          maxCapacity: 80,
          description: "Departmental academic consultation and tutoring clinic.",
          isCommon: false,
          participatingFaculty: [{ id: userIdentifier, name: teacherName, email: "faculty@pup.edu.ph" }],
          participantDocuments: [{ name: "Consultation_Schedule.pdf", size: 150000, type: "PDF" }],
        },
      ];

      if (isOrganizerPage) {
        if (!readJSON("recovibeOrganizerEvents", null)) {
          writeJSON("recovibeOrganizerEvents", sampleEvents);
        }
      } else {
        if (!readJSON("recovibeTeacherEvents", null)) {
          writeJSON("recovibeTeacherEvents", sampleEvents);
        }
      }
      return sampleEvents;
    }

    return filtered;
  }

  // 8. Load Faculty Pool for Chips Suggestions
  function loadFacultyPool() {
    const pool = [
      { id: "fac-1", name: "Prof. Maria Santos", email: "msantos@pup.edu.ph" },
      { id: "fac-2", name: "Engr. Roberto Cruz", email: "rcruz@pup.edu.ph" },
      { id: "fac-3", name: "Dr. Elena Alcantara", email: "ealcantara@pup.edu.ph" },
      { id: "fac-4", name: "Prof. Antonio Reyes", email: "areyes@pup.edu.ph" },
      { id: "fac-5", name: "Prof. Grace Dizon", email: "gdizon@pup.edu.ph" },
      { id: "fac-6", name: "Engr. Kenneth Bautista", email: "kbautista@pup.edu.ph" },
    ];
    if (teacherName && !pool.some((f) => f.name.toLowerCase() === teacherName.toLowerCase())) {
      pool.unshift({ id: userIdentifier, name: teacherName, email: teacherProfile.email || "faculty@pup.edu.ph" });
    }
    return pool;
  }

  // 9. Render Unauthorized Message
  function renderUnauthorized(heading, message) {
    root.innerHTML = `
      <div class="ce-unauthorized-wrap">
        <div class="ce-unauthorized-card">
          <div class="ce-unauthorized-icon">
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#701219" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
            </svg>
          </div>
          <h2 class="ce-unauthorized-title">${escapeHTML(heading)}</h2>
          <p class="ce-unauthorized-text">${escapeHTML(message)}</p>
          <div class="ce-unauthorized-actions">
            <a href="javascript:history.back()" class="ce-btn-primary">Return to Previous Page</a>
          </div>
        </div>
      </div>
    `;
  }

  // 10. Main Rendering Controller
  function render() {
    const isEditMode = Boolean(state.editingEventId);
    const manilaInfo = getManilaDateInfo();

    root.innerHTML = `
      <div class="ce-container">
        <!-- Top Section: Mode Switch Segmented Toggle -->
        ${!isEditMode ? `
          <header class="ce-header">
            <div class="ce-mode-toggle" role="radiogroup" aria-label="Event Creation Mode">
              <button type="button"
                      class="ce-mode-btn ${state.mode === "existing" ? "is-active" : ""}"
                      data-mode="existing"
                      role="radio"
                      aria-checked="${state.mode === "existing"}">
                Create Existing Event
              </button>
              <button type="button"
                      class="ce-mode-btn ${state.mode === "new" ? "is-active" : ""}"
                      data-mode="new"
                      role="radio"
                      aria-checked="${state.mode === "new"}">
                Create New Event
              </button>
            </div>
          </header>
        ` : ""}

        <!-- Main Body: Existing View OR Form with Side Panel -->
        ${state.mode === "existing" && !isEditMode
          ? renderExistingEventsView()
          : renderCreateFormView(manilaInfo)}
      </div>
    `;

    setupEventHandlers();
    updateDescCounter();
    checkVenueCapacityHint();
    updateAllReadinessChecks();
    updateLivePreview();
  }

  // 11. "Create Existing Event" View
  function renderExistingEventsView() {
    const past = loadCurrentUserEvents();
    const query = (state.searchQuery || "").trim().toLowerCase();

    const filtered = past.filter((ev) => {
      if (!query) return true;
      const title = (ev.title || ev.eventName || "").toLowerCase();
      const venue = (ev.venue || ev.location || "").toLowerCase();
      const cat = (ev.category || "").toLowerCase();
      return title.includes(query) || venue.includes(query) || cat.includes(query);
    });

    const commonKeywords = /assembly|orientation|seminar|workshop|general|meeting|training|convocation|bootcamp/i;
    const commonEvents = [];
    const uniqueEvents = [];

    filtered.forEach((ev) => {
      const t = (ev.title || ev.eventName || "").trim();
      if (ev.isCommon || commonKeywords.test(t)) {
        commonEvents.push(ev);
      } else {
        uniqueEvents.push(ev);
      }
    });

    return `
      <div class="ce-existing-view">
        <div class="ce-search-wrap">
          <input type="search"
                 id="searchPastEvents"
                 class="ce-search-input"
                 placeholder="Search past events by title, venue, or category..."
                 value="${escapeHTML(state.searchQuery || "")}"
                 aria-label="Search past events">
        </div>

        <div class="ce-existing-columns">
          <div class="ce-existing-col">
            <h3 class="ce-existing-col-title">Common Events (${commonEvents.length})</h3>
            <div class="ce-existing-col-list">
              ${commonEvents.length === 0
                ? '<div class="ce-existing-empty"><p>No common past events found.</p></div>'
                : commonEvents.map((ev) => renderPastEventCard(ev)).join("")}
            </div>
          </div>

          <div class="ce-existing-col">
            <h3 class="ce-existing-col-title">Unique Events (${uniqueEvents.length})</h3>
            <div class="ce-existing-col-list">
              ${uniqueEvents.length === 0
                ? '<div class="ce-existing-empty"><p>No unique past events found.</p></div>'
                : uniqueEvents.map((ev) => renderPastEventCard(ev)).join("")}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderPastEventCard(ev) {
    const id = ev.id || ev.eventId || "ev-" + Math.random();
    const title = ev.title || ev.eventName || "Untitled Event";
    const date = ev.date || ev.dateISO || ev.eventDate || "Past date";
    const venue = ev.venue || ev.location || "Venue not set";

    return `
      <div class="ce-existing-card" data-event-id="${escapeHTML(id)}">
        <div class="ce-existing-card-body">
          <h4 class="ce-existing-title">${escapeHTML(title)}</h4>
          <div class="ce-existing-meta">
            <span>Last held ${escapeHTML(date)} · ${escapeHTML(venue)}</span>
          </div>
        </div>
        <button type="button" class="ce-reuse-btn" data-reuse-id="${escapeHTML(id)}" aria-label="Reuse ${escapeHTML(title)}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/>
          </svg>
          Reuse
        </button>
      </div>
    `;
  }

  function calculateNextLogicalDate(oldDateStr) {
    if (!oldDateStr) return getManilaDateInfo().todayStr;
    const parts = oldDateStr.split("-");
    if (parts.length !== 3) return getManilaDateInfo().todayStr;

    const month = parseInt(parts[1], 10);
    const day = parseInt(parts[2], 10);

    const now = new Date();
    const currentYear = now.getFullYear();

    let candidate = new Date(currentYear, month - 1, day);
    if (candidate <= now) {
      candidate = new Date(currentYear + 1, month - 1, day);
    }

    const y = candidate.getFullYear();
    const m = String(candidate.getMonth() + 1).padStart(2, "0");
    const d = String(candidate.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  // 12. Create / Edit Form View (Left Form, Right Sticky Side Panel)
  function renderCreateFormView(manilaInfo) {
    const isEditMode = Boolean(state.editingEventId);

    return `
      ${state.isCopied && state.copiedFrom ? `
        <div class="ce-copied-banner" role="alert">
          <div class="ce-copied-banner-content">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
            <span>
              Copied from <strong>${escapeHTML(state.copiedFrom.title || "Past Event")}</strong>
              (last held ${escapeHTML(state.copiedFrom.date || "earlier")}). Review the highlighted date and time, and attach new approval documents.
            </span>
          </div>
          <button type="button" class="ce-banner-dismiss" id="btnDismissBanner" aria-label="Dismiss notice">✕</button>
        </div>
      ` : ""}

      <div class="ce-layout-grid ce-main-layout">
        <!-- Left Column: Form Cards -->
        <div class="ce-form-column ce-form-col">
          <form id="createEventMainForm" novalidate autocomplete="off">
            <!-- Card 1: Event Identity -->
            <section class="ce-card" id="card-identity">
              <div class="ce-card-header">
                <h2 class="ce-card-title">1. Event Identity</h2>
              </div>
              <div class="ce-fields-grid">
                <div class="ce-field ce-field--full ${state.highlightedFields.has("eventName") ? "is-copied-highlight" : ""}" id="wrap-eventName">
                  <label for="eventName">Event Name <span class="ce-req">*</span></label>
                  <input type="text"
                         id="eventName"
                         name="eventName"
                         maxlength="150"
                         placeholder="e.g. Annual IT Tech Summit 2026"
                         required
                         aria-describedby="duplicateNotice error-eventName">
                  <p id="duplicateNotice" class="ce-warning-note" role="status" aria-live="polite" hidden></p>
                  <p class="ce-error" id="error-eventName" hidden></p>
                </div>

                <div class="ce-field" id="wrap-eventOrganizer">
                  <label for="eventOrganizer">Event Organizer <span class="ce-readonly-tag">(Auto-filled)</span></label>
                  <input type="text"
                         id="eventOrganizer"
                         name="eventOrganizer"
                         value="${escapeHTML(readOnlyOrganizerValue)}"
                         readonly
                         class="ce-input--readonly">
                  <small class="ce-hint">Automatically set based on your account credentials.</small>
                </div>

                <div class="ce-field" id="wrap-eventSource">
                  <label for="eventSource">Event Source</label>
                  <select id="eventSource" name="eventSource">
                    ${isOrganizerPage ? '<option value="">Select source (optional)...</option>' : ""}
                    ${EVENT_SOURCES.map((src) => `
                      <option value="${escapeHTML(src)}" ${src === defaultEventSource ? "selected" : ""}>
                        ${escapeHTML(src)}
                      </option>
                    `).join("")}
                  </select>
                </div>

                <!-- Category Multi-Select Dropdown with Checkboxes (1 to 3 allowed) -->
                <div class="ce-field ce-field--full ${state.highlightedFields.has("category") ? "is-copied-highlight" : ""}" id="wrap-category">
                  <label id="catLabel">Categories <span class="ce-req">*</span> <small>(Select 1 to 3)</small></label>
                  <div class="ce-cat-dropdown" id="catDropdownContainer">
                    <button type="button"
                            class="ce-cat-button"
                            id="catDropdownBtn"
                            aria-haspopup="listbox"
                            aria-expanded="false"
                            aria-labelledby="catLabel catDropdownBtn">
                      <span id="catBtnText">Select 1 to 3 categories...</span>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="6 9 12 15 18 9"></polyline>
                      </svg>
                    </button>
                    <div class="ce-cat-menu" id="catDropdownMenu" role="listbox" aria-multiselectable="true">
                      ${CATEGORIES.map((cat, idx) => `
                        <label class="ce-cat-item">
                          <input type="checkbox"
                                 class="ce-cat-checkbox"
                                 value="${escapeHTML(cat)}"
                                 ${state.selectedCategories.includes(cat) ? "checked" : ""}>
                          <span>${escapeHTML(cat)}</span>
                        </label>
                      `).join("")}
                    </div>
                  </div>
                  <p class="ce-error" id="error-category" hidden></p>
                </div>

                <!-- Target Year Level (Default "All Levels") -->
                <div class="ce-field" id="wrap-targetYear">
                  <label for="targetYear">Target Year Level</label>
                  <select id="targetYear" name="targetYear">
                    ${TARGET_YEARS.map((opt) => `
                      <option value="${escapeHTML(opt)}" ${opt === "All Levels" ? "selected" : ""}>${escapeHTML(opt)}</option>
                    `).join("")}
                  </select>
                </div>
              </div>
            </section>

            <!-- Card 2: Schedule & Venue -->
            <section class="ce-card" id="card-schedule">
              <div class="ce-card-header">
                <h2 class="ce-card-title">2. Schedule & Venue</h2>
              </div>
              <div class="ce-fields-grid">
                <!-- Date with Manila Min/Max -->
                <div class="ce-field ${state.highlightedFields.has("eventDate") ? "is-copied-highlight" : ""}" id="wrap-eventDate">
                  <label for="eventDate">Date <span class="ce-req">*</span></label>
                  <input type="date"
                         id="eventDate"
                         name="eventDate"
                         value="${escapeHTML(manilaInfo.todayStr)}"
                         min="${escapeHTML(manilaInfo.todayStr)}"
                         max="${escapeHTML(manilaInfo.maxDateStr)}"
                         required
                         aria-describedby="holidayNotice error-eventDate">
                  <p id="holidayNotice" class="ce-holiday-notice" role="status" aria-live="polite" hidden></p>
                  <p class="ce-error" id="error-eventDate" hidden></p>
                </div>

                <!-- Time Start: Default 8:00 AM, min 8:00 AM -->
                <div class="ce-field ${state.highlightedFields.has("timeStart") ? "is-copied-highlight" : ""}" id="wrap-timeStart">
                  <label for="timeStart">Time Start <span class="ce-req">*</span></label>
                  <div class="ce-timepicker-wrap" id="picker-wrap-timeStart">
                    <input type="text"
                           id="timeStart"
                           name="timeStart"
                           class="ce-timepicker-input"
                           value="08:00 AM"
                           min="08:00"
                           max="20:00"
                           readonly
                           required
                           aria-describedby="error-timeStart"
                           aria-expanded="false"
                           aria-haspopup="true">
                    <button type="button" class="ce-timepicker-btn" id="btnToggle-timeStart" aria-label="Choose start time" tabindex="-1">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 12 16 14"></polyline>
                      </svg>
                    </button>
                    <div class="ce-timepicker-dropdown" id="dropdown-timeStart" hidden>
                      <div class="ce-timepicker-cols">
                        <div class="ce-timepicker-col" data-col="hour" aria-label="Hours"></div>
                        <div class="ce-timepicker-col" data-col="minute" aria-label="Minutes"></div>
                        <div class="ce-timepicker-col" data-col="period" aria-label="Period"></div>
                      </div>
                    </div>
                  </div>
                  <p class="ce-error" id="error-timeStart" hidden></p>
                </div>

                <!-- Time End: Default 8:00 PM, max 8:00 PM -->
                <div class="ce-field ${state.highlightedFields.has("timeEnd") ? "is-copied-highlight" : ""}" id="wrap-timeEnd">
                  <label for="timeEnd">Time End <span class="ce-req">*</span></label>
                  <div class="ce-timepicker-wrap" id="picker-wrap-timeEnd">
                    <input type="text"
                           id="timeEnd"
                           name="timeEnd"
                           class="ce-timepicker-input"
                           value="08:00 PM"
                           min="08:00"
                           max="20:00"
                           readonly
                           required
                           aria-describedby="error-timeEnd"
                           aria-expanded="false"
                           aria-haspopup="true">
                    <button type="button" class="ce-timepicker-btn" id="btnToggle-timeEnd" aria-label="Choose end time" tabindex="-1">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"></circle>
                        <polyline points="12 6 12 16 14"></polyline>
                      </svg>
                    </button>
                    <div class="ce-timepicker-dropdown" id="dropdown-timeEnd" hidden>
                      <div class="ce-timepicker-cols">
                        <div class="ce-timepicker-col" data-col="hour" aria-label="Hours"></div>
                        <div class="ce-timepicker-col" data-col="minute" aria-label="Minutes"></div>
                        <div class="ce-timepicker-col" data-col="period" aria-label="Period"></div>
                      </div>
                    </div>
                  </div>
                  <p class="ce-error" id="error-timeEnd" hidden></p>
                </div>

                <!-- Grouped Venue Dropdown -->
                <div class="ce-field" id="wrap-venue">
                  <label for="venue">Venue <span class="ce-req">*</span></label>
                  <select id="venue" name="venue" required aria-describedby="error-venue">
                    <option value="">Select venue...</option>
                    ${VENUES_GROUPED.map((grp) => `
                      <optgroup label="${escapeHTML(grp.campus)}">
                        ${grp.venues.map((v) => `
                          <option value="${escapeHTML(v.name)}" data-capacity="${v.maxCapacity}" data-type="${v.type || ""}">
                            ${escapeHTML(v.name)} (Max: ${v.maxCapacity})
                          </option>
                        `).join("")}
                      </optgroup>
                    `).join("")}
                  </select>
                  <p class="ce-error" id="error-venue" hidden></p>
                </div>

                <div class="ce-field" id="wrap-maxCapacity">
                  <label for="maxCapacity">Max Capacity</label>
                  <input type="number"
                         id="maxCapacity"
                         name="maxCapacity"
                         min="1"
                         step="1"
                         placeholder="e.g. 100"
                         aria-describedby="venueCapacityHint error-maxCapacity">
                  <small class="ce-hint" id="venueCapacityHint">Select a venue to view capacity limit.</small>
                  <p class="ce-error" id="error-maxCapacity" hidden></p>
                </div>

                <!-- Weather Contingency: Read-Only & Auto-Linked to Venue -->
                <div class="ce-field" id="wrap-weatherContingency">
                  <label for="weatherContingency">Weather Contingency <span class="ce-readonly-tag">(Auto-linked)</span></label>
                  <input type="text"
                         id="weatherContingency"
                         name="weatherContingency"
                         readonly
                         class="ce-input--readonly"
                         placeholder="Select a venue to determine weather contingency"
                         aria-describedby="error-weatherContingency">
                  <p class="ce-error" id="error-weatherContingency" hidden></p>
                </div>
              </div>
            </section>

            <!-- Card 3: Approval Chain & Attendees (Task 3) -->
            <section class="ce-card" id="card-approval-chain">
              <div class="ce-card-header">
                <h2 class="ce-card-title">3. Approval Chain & Attendees</h2>
              </div>
              <div class="ce-fields-grid">
                <div class="ce-field ce-field--full ce-field--toggle" id="wrap-outsideGuests">
                  <span class="ce-toggle-label">Outside Guests</span>
                  <label class="ce-switch">
                    <input type="checkbox" id="outsideGuests" name="outsideGuests">
                    <span class="ce-slider"></span>
                  </label>
                  <span class="ce-toggle-text">Outside guests will attend this event</span>
                </div>

                <div class="ce-field ce-field--full" id="wrap-approverList">
                  <div class="ce-label-split" style="margin-bottom: 8px;">
                    <label id="approverListLabel">Sequential Approval Steps <span class="ce-req">*</span></label>
                    <span class="ce-counter" id="approverCountText">7 approvers selected</span>
                  </div>
                  <p class="ce-hint" style="margin-bottom: 12px;">
                    Approvals run sequentially in 8 steps. Each step opens only after the one before approves. Unticked approvers are skipped and the rest are numbered by position.
                  </p>
                  <div class="ce-approver-list" id="approverList">
                    <!-- Dynamic approver items -->
                  </div>
                  <p class="ce-error" id="error-approvers" hidden></p>
                </div>
              </div>
            </section>

            <!-- Card 4: Registration -->
            <section class="ce-card" id="card-registration">
              <div class="ce-card-header">
                <h2 class="ce-card-title">4. Registration Information</h2>
              </div>
              <div class="ce-fields-grid">
                <!-- Registration Deadline (Defaults to event Date at 11:59 PM) -->
                <div class="ce-field ${state.highlightedFields.has("registrationDeadline") ? "is-copied-highlight" : ""}" id="wrap-registrationDeadline">
                  <div class="ce-label-split">
                    <label for="registrationDeadline">Registration Deadline <span class="ce-req">*</span></label>
                    <button type="button" class="ce-text-link" id="btnResetAutoDeadline" title="Reset to 11:59 PM of event date">Reset to auto</button>
                  </div>
                  <input type="datetime-local"
                         id="registrationDeadline"
                         name="registrationDeadline"
                         value="${escapeHTML(manilaInfo.todayStr)}T23:59"
                         required
                         aria-describedby="error-registrationDeadline">
                  <p class="ce-error" id="error-registrationDeadline" hidden></p>
                </div>

                <div class="ce-field ce-field--toggle" id="wrap-attendanceRequired">
                  <span class="ce-toggle-label">Attendance Tracking</span>
                  <label class="ce-switch">
                    <input type="checkbox" id="attendanceRequired" name="attendanceRequired" checked>
                    <span class="ce-slider"></span>
                  </label>
                  <span class="ce-toggle-text">Require attendance tracking for attendees</span>
                </div>
              </div>
            </section>

            <!-- Card 4: Event Details -->
            <section class="ce-card" id="card-details">
              <div class="ce-card-header">
                <h2 class="ce-card-title">4. Event Details & Faculty</h2>
              </div>
              <div class="ce-fields-grid">
                <div class="ce-field ce-field--full" id="wrap-description">
                  <div class="ce-label-split">
                    <label for="description">Event Description</label>
                    <span class="ce-counter" id="descCharCounter">0 / 1500</span>
                  </div>
                  <textarea id="description"
                            name="description"
                            rows="4"
                            maxlength="1500"
                            placeholder="Provide a comprehensive summary of the event objectives, agenda, and target outcomes..."></textarea>
                </div>

                <!-- Key Details with bullet support -->
                <div class="ce-field ce-field--full" id="wrap-keyDetails">
                  <label for="keyDetails">Key Details <small>(bulleted list)</small></label>
                  <textarea id="keyDetails"
                            name="keyDetails"
                            rows="3"
                            placeholder="• Event highlights&#10;• Special guests&#10;• Certificate provided"></textarea>
                </div>

                <!-- Requirements & Reminders with bullet support -->
                <div class="ce-field ce-field--full" id="wrap-requirements">
                  <label for="requirements">Requirements & Reminders <small>(bulleted list)</small></label>
                  <textarea id="requirements"
                            name="requirements"
                            rows="3"
                            placeholder="• Bring valid school ID&#10;• Attire: Business casual&#10;• Install required software"></textarea>
                </div>

                <!-- Participating Faculty Members (Optional) with No Numbers in Names -->
                <div class="ce-field ce-field--full" id="wrap-facultyChips">
                  <label for="facultySearchInput">Participating Faculty Members <small>(Optional)</small></label>
                  <div class="ce-chips-container" id="facultyChipsContainer">
                    <div id="facultyChipsList" class="ce-chips-list"></div>
                    <input type="text"
                           id="facultySearchInput"
                           class="ce-chip-input"
                           placeholder="Type to search faculty (optional)..."
                           autocomplete="off">
                  </div>
                  <div class="ce-chip-suggestions" id="facultySuggestions" hidden></div>
                  <p class="ce-inline-hint" id="facultyNoNumbersHint" style="color: #b3261e; font-size: 12px; margin-top: 4px;" hidden></p>
                  <small class="ce-hint">Participating faculty members who will attend or facilitate (optional).</small>
                </div>

                <!-- Contact Person Section: Empty by default, No Numbers in Name, 09 Lock on Phone -->
                <div class="ce-field ce-field--full" id="wrap-contactPerson">
                  <h3 style="margin: 10px 0 6px; font-size: 15px; font-weight: 600; color: #241a17;">Contact Person</h3>
                  <div class="ce-fields-grid" style="margin-top: 6px;">
                    <div class="ce-field" id="wrap-contactName">
                      <label for="contactName">Name <span class="ce-req">*</span></label>
                      <input type="text"
                             id="contactName"
                             name="contactName"
                             placeholder="Contact person's full name"
                             value=""
                             autocomplete="off"
                             required
                             aria-describedby="contactNameNoNumbersHint error-contactName">
                      <p class="ce-inline-hint" id="contactNameNoNumbersHint" style="color: #b3261e; font-size: 12px; margin-top: 4px;" hidden></p>
                      <p class="ce-error" id="error-contactName" hidden></p>
                    </div>

                    <div class="ce-field" id="wrap-contactEmail">
                      <label for="contactEmail">Email <span class="ce-req">*</span></label>
                      <input type="email"
                             id="contactEmail"
                             name="contactEmail"
                             placeholder="name@pup.edu.ph"
                             value=""
                             autocomplete="off"
                             required
                             aria-describedby="error-contactEmail">
                      <p class="ce-error" id="error-contactEmail" hidden></p>
                    </div>

                    <div class="ce-field" id="wrap-contactPhone">
                      <label for="contactPhone">Contact Number <small>(Optional)</small></label>
                      <input type="tel"
                             id="contactPhone"
                             name="contactPhone"
                             placeholder="09XXXXXXXXX"
                             value="09"
                             maxlength="11"
                             inputmode="numeric"
                             autocomplete="off"
                             aria-describedby="error-contactPhone">
                      <p class="ce-error" id="error-contactPhone" hidden></p>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <!-- Card 5: Documents -->
            <section class="ce-card" id="card-documents">
              <div class="ce-card-header">
                <h2 class="ce-card-title">5. Attached Documents</h2>
              </div>
              <div class="ce-documents-grid">
                <!-- Participant Documents -->
                <div class="ce-dropzone-group" id="wrap-participantDocs">
                  <div class="ce-dropzone-title-bar">
                    <h3 class="ce-dropzone-title">Participant Documents <small>(Optional)</small></h3>
                  </div>
                  <div class="ce-dropzone"
                       id="dropzoneParticipant"
                       tabindex="0"
                       role="region"
                       aria-label="Upload participant documents">
                    <!-- Dropzone content rendered by component -->
                  </div>
                  <p class="ce-error ce-dropzone-error" id="error-participantDocs" hidden></p>
                  <input type="file"
                         id="inputParticipantFiles"
                         accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                         multiple
                         hidden>
                </div>

                <!-- Approval Documents (Required) -->
                <div class="ce-dropzone-group" id="wrap-approvalDocs">
                  <div class="ce-dropzone-title-bar">
                    <h3 class="ce-dropzone-title">
                      Approval Documents <span class="ce-req" id="reqStarApproval">*</span>
                    </h3>
                    <p class="ce-dropzone-req-note" id="reqMsgApproval">At least 1 approval document is required before submission</p>
                  </div>
                  <div class="ce-dropzone"
                       id="dropzoneApproval"
                       tabindex="0"
                       role="region"
                       aria-label="Upload approval documents">
                    <!-- Dropzone content rendered by component -->
                  </div>
                  <p class="ce-error ce-dropzone-error" id="error-approvalDocs" hidden></p>
                  <input type="file"
                         id="inputApprovalFiles"
                         accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                         multiple
                         hidden>
                </div>
              </div>
            </section>
          </form>
        </div>

        <!-- Right Column: Sticky Side Panel (Live Preview & Readiness Checklist) -->
        <aside class="ce-side-panel">
          <!-- Card A: Live Event Preview -->
          <div class="ce-preview-card" aria-live="polite">
            <div class="ce-preview-header-area">
              <span class="ce-preview-kicker">Live Event Preview</span>
              <div class="ce-preview-meta-row">
                <span class="ce-preview-type">Campus Event</span>
                <span class="ce-preview-status" id="previewStatus">Draft</span>
              </div>
            </div>

            <h3 class="ce-preview-title" id="previewTitle" title="Untitled Event">Untitled Event</h3>

            <div class="ce-preview-chips-row">
              <span class="ce-preview-source" id="previewSource">Source: ${escapeHTML(defaultEventSource || "Not specified")}</span>
              <div class="ce-preview-tags" id="previewTags">
                <span class="ce-preview-tag">General</span>
              </div>
            </div>

            <div class="ce-preview-details-list">
              <div class="ce-preview-detail">
                <svg class="ce-preview-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
                  <line x1="16" y1="2" x2="16" y2="6"/>
                  <line x1="8" y1="2" x2="8" y2="6"/>
                  <line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                <span class="ce-preview-text is-muted" id="previewDateTime">Date and time not set</span>
              </div>

              <div class="ce-preview-detail">
                <svg class="ce-preview-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/>
                  <circle cx="12" cy="10" r="3"/>
                </svg>
                <span class="ce-preview-text is-muted" id="previewVenue">Venue not set</span>
              </div>

              <div class="ce-preview-detail">
                <svg class="ce-preview-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                  <circle cx="9" cy="7" r="4"/>
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                  <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
                </svg>
                <span class="ce-preview-text is-muted" id="previewCapacity">Capacity not specified</span>
              </div>

              <div class="ce-preview-detail">
                <svg class="ce-preview-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 14 14"></polyline>
                </svg>
                <span class="ce-preview-text is-muted" id="previewDeadline">Deadline not set</span>
              </div>

              <div class="ce-preview-detail">
                <svg class="ce-preview-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path>
                  <path d="M2 12h20"></path>
                </svg>
                <div class="ce-preview-targets-wrap">
                  <span class="ce-preview-target-badge" id="previewTargetYear">Target: All Levels</span>
                  <span class="ce-preview-dot-sep">·</span>
                  <span class="ce-preview-org-badge" id="previewOrganizer">${escapeHTML(readOnlyOrganizerValue)}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- Card B: Event Readiness Checklist -->
          <div class="ce-checks-card">
            <div class="ce-checks-header">
              <h2 class="ce-checks-title">Event Readiness</h2>
              <span class="ce-checks-badge" id="checksBadge" aria-live="polite">0 of 8 Ready</span>
            </div>
            <div class="ce-checks-progress-track" aria-hidden="true">
              <div class="ce-checks-progress-bar" id="checksProgressBar"></div>
            </div>
            <p class="ce-checks-subtitle">All requirements must be fulfilled before submission.</p>
            <ul class="ce-checks-list" id="checksList" aria-live="polite">
              <li class="ce-check-item is-failed" id="check-name">
                <span class="ce-check-icon" aria-hidden="true">✕</span>
                <span class="ce-check-status-sr sr-only">Not yet: </span>
                <span class="ce-check-label">Event name provided (min 3 chars)</span>
              </li>
              <li class="ce-check-item is-failed" id="check-category">
                <span class="ce-check-icon" aria-hidden="true">✕</span>
                <span class="ce-check-status-sr sr-only">Not yet: </span>
                <span class="ce-check-label">1 to 3 categories selected</span>
              </li>
              <li class="ce-check-item is-failed" id="check-times">
                <span class="ce-check-icon" aria-hidden="true">✕</span>
                <span class="ce-check-status-sr sr-only">Not yet: </span>
                <span class="ce-check-label">Time End is after Time Start</span>
              </li>
              <li class="ce-check-item is-failed" id="check-conflict">
                <span class="ce-check-icon" aria-hidden="true">✕</span>
                <span class="ce-check-status-sr sr-only">Not yet: </span>
                <span class="ce-check-label">No venue booking conflict</span>
              </li>
              <li class="ce-check-item is-failed" id="check-deadline">
                <span class="ce-check-icon" aria-hidden="true">✕</span>
                <span class="ce-check-status-sr sr-only">Not yet: </span>
                <span class="ce-check-label">Deadline is on or before 11:59 PM of event date</span>
              </li>
              <li class="ce-check-item is-failed" id="check-capacity">
                <span class="ce-check-icon" aria-hidden="true">✕</span>
                <span class="ce-check-status-sr sr-only">Not yet: </span>
                <span class="ce-check-label">Capacity is within venue limit</span>
              </li>
              <li class="ce-check-item is-failed" id="check-contact">
                <span class="ce-check-icon" aria-hidden="true">✕</span>
                <span class="ce-check-status-sr sr-only">Not yet: </span>
                <span class="ce-check-label">Contact person name and valid email</span>
              </li>
              <li class="ce-check-item is-failed" id="check-approvalDocs">
                <span class="ce-check-icon" aria-hidden="true">✕</span>
                <span class="ce-check-status-sr sr-only">Not yet: </span>
                <span class="ce-check-label">Approval document attached</span>
              </li>
            </ul>
          </div>
        </aside>
      </div>

      <!-- Sticky Bottom Action Bar with Cancel, Save Draft, and Submit -->
      <footer class="ce-bottom-bar">
        <div class="ce-bottom-bar-inner">
          <div class="ce-bottom-status" id="bottomStatusMessage">
            <span id="bottomStatusText">Review your event information before submitting.</span>
          </div>
          <div class="ce-bottom-actions">
            <button type="button" class="ce-btn-secondary" id="btnCancelEvent">
              Cancel
            </button>
            <button type="button" class="ce-btn-secondary" id="btnSaveDraft">
              Save Draft
            </button>
            <button type="button" class="ce-btn-primary" id="btnSubmitApproval">
              ${requireApproval ? "Submit for Approval" : "Publish Event"}
            </button>
          </div>
        </div>
      </footer>

      <!-- Confirmation Pop-Up Modal -->
      <div class="ce-dialog-layer" id="ceConfirmModal" role="dialog" aria-modal="true" aria-labelledby="confirmModalTitle" hidden>
        <div class="ce-confirm">
          <h2 id="confirmModalTitle">Confirm Action</h2>
          <p id="confirmModalText">Are you sure you want to proceed?</p>
          <div class="ce-confirm-actions">
            <button type="button" class="ce-btn-secondary" id="confirmModalCancelBtn">Cancel</button>
            <button type="button" class="ce-btn-primary" id="confirmModalPrimaryBtn">Confirm</button>
          </div>
        </div>
      </div>
    `;
  }

  // 13. Mode Switch Handler
  function handleModeSwitch(newMode) {
    if (state.mode === newMode) return;
    if (state.dirty) {
      showConfirmModal({
        title: "Discard Changes?",
        text: "You have unsaved changes in this form. Switching modes will discard them. Continue?",
        confirmText: "Discard",
        cancelText: "Keep Editing",
        onConfirm: () => {
          state.dirty = false;
          state.isCopied = false;
          state.copiedFrom = null;
          state.mode = newMode;
          render();
        },
      });
      return;
    }
    state.mode = newMode;
    render();
  }

  // 14. Prefill Form from Copied/Existing Event
  function prefillFormFromEvent(ev) {
    state.isCopied = true;
    state.copiedFrom = ev;
    state.mode = "new";
    state.dirty = true;
    state.deadlineManuallyEdited = true;

    state.highlightedFields = new Set(["eventDate", "timeStart", "timeEnd", "category"]);

    if (Array.isArray(ev.categories) && ev.categories.length > 0) {
      state.selectedCategories = [...ev.categories.slice(0, 3)];
    } else if (ev.category) {
      state.selectedCategories = String(ev.category)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 3);
    } else {
      state.selectedCategories = [];
    }

    if (Array.isArray(ev.participatingFaculty)) {
      state.participatingFaculty = [...ev.participatingFaculty];
    } else if (!isOrganizerPage) {
      state.participatingFaculty = [{ id: userIdentifier, name: teacherName, email: teacherProfile?.email || "faculty@pup.edu.ph" }];
    } else {
      state.participatingFaculty = [];
    }

    render();

    const form = document.getElementById("createEventMainForm");
    if (form) {
      if (form.eventName) form.eventName.value = ev.title || ev.eventName || "";
      if (form.eventSource && ev.source) form.eventSource.value = ev.source;
      if (form.targetYear && ev.targetYear) form.targetYear.value = ev.targetYear;
      if (form.eventDate) form.eventDate.value = calculateNextLogicalDate(ev.date || ev.dateISO || ev.eventDate);
      if (form.timeStart && ev.timeStart) form.timeStart.value = ev.timeStart;
      if (form.timeEnd && ev.timeEnd) form.timeEnd.value = ev.timeEnd;
      if (form.venue && ev.venue) form.venue.value = ev.venue;
      if (form.maxCapacity && ev.maxCapacity) form.maxCapacity.value = ev.maxCapacity;
      if (form.description && ev.description) form.description.value = ev.description;

      if (form.keyDetails) {
        if (Array.isArray(ev.keyDetails) && ev.keyDetails.length) {
          form.keyDetails.value = ev.keyDetails.map((k) => "• " + String(k).replace(/^[•\-\*]\s*/, "")).join("\n");
        } else if (typeof ev.keyDetails === "string" && ev.keyDetails) {
          form.keyDetails.value = ev.keyDetails;
        } else {
          form.keyDetails.value = "• ";
        }
      }

      if (form.requirements) {
        if (Array.isArray(ev.requirements) && ev.requirements.length) {
          form.requirements.value = ev.requirements.map((r) => "• " + String(r).replace(/^[•\-\*]\s*/, "")).join("\n");
        } else if (typeof ev.requirements === "string" && ev.requirements) {
          form.requirements.value = ev.requirements;
        } else {
          form.requirements.value = "• ";
        }
      }

      if (form.contactName && (ev.contactPerson?.name || ev.contactName)) {
        form.contactName.value = ev.contactPerson?.name || ev.contactName || "";
      }
      if (form.contactEmail && (ev.contactPerson?.email || ev.contactEmail)) {
        form.contactEmail.value = ev.contactPerson?.email || ev.contactEmail || "";
      }
      if (form.contactPhone) {
        const ph = ev.contactPerson?.phone || ev.contactPhone || "";
        form.contactPhone.value = ph.startsWith("09") ? ph.slice(0, 11) : "09";
      }

      checkVenueCapacityHint();
      updateAllReadinessChecks();
      updateLivePreview();
      updateDescCounter();

      const dateField = document.getElementById("wrap-eventDate");
      if (dateField) {
        dateField.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }

  // 15. Setup Event Listeners & Interactive Handlers
  function setupEventHandlers() {
    // Mode switch listeners
    root.querySelectorAll(".ce-mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        handleModeSwitch(btn.dataset.mode);
      });
    });

    // Dismiss banner
    const btnDismiss = document.getElementById("btnDismissBanner");
    if (btnDismiss) {
      btnDismiss.addEventListener("click", () => {
        state.isCopied = false;
        state.copiedFrom = null;
        state.highlightedFields.clear();
        const banner = document.querySelector(".ce-copied-banner");
        if (banner) banner.remove();
        root.querySelectorAll(".is-copied-highlight").forEach((el) => el.classList.remove("is-copied-highlight"));
      });
    }

    // Reuse past event cards
    root.querySelectorAll(".ce-reuse-btn, .ce-existing-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        const reuseId = e.target.closest("[data-reuse-id]")?.dataset.reuseId ||
                        e.target.closest("[data-event-id]")?.dataset.eventId;
        if (!reuseId) return;
        const past = loadCurrentUserEvents();
        const found = past.find((x) => String(x.id || x.eventId) === String(reuseId));
        if (found) {
          prefillFormFromEvent(found);
        }
      });
    });

    // Search past events filter
    const searchInput = document.getElementById("searchPastEvents");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        state.searchQuery = searchInput.value || "";
        const container = root.querySelector(".ce-existing-view");
        if (container) {
          const past = loadCurrentUserEvents();
          const q = (state.searchQuery || "").trim().toLowerCase();
          const filtered = past.filter((ev) => {
            if (!q) return true;
            const title = (ev.title || ev.eventName || "").toLowerCase();
            const venue = (ev.venue || ev.location || "").toLowerCase();
            const cat = (ev.category || "").toLowerCase();
            return title.includes(q) || venue.includes(q) || cat.includes(q);
          });
          const commonKeywords = /assembly|orientation|seminar|workshop|general|meeting|training|convocation|bootcamp/i;
          const commonEvents = [];
          const uniqueEvents = [];
          filtered.forEach((ev) => {
            const t = (ev.title || ev.eventName || "").trim();
            if (ev.isCommon || commonKeywords.test(t)) commonEvents.push(ev);
            else uniqueEvents.push(ev);
          });

          const colLists = container.querySelectorAll(".ce-existing-col");
          if (colLists[0]) {
            colLists[0].querySelector(".ce-existing-col-title").textContent = `Common Events (${commonEvents.length})`;
            colLists[0].querySelector(".ce-existing-col-list").innerHTML =
              commonEvents.length === 0
                ? '<div class="ce-existing-empty"><p>No common past events found.</p></div>'
                : commonEvents.map((ev) => renderPastEventCard(ev)).join("");
          }
          if (colLists[1]) {
            colLists[1].querySelector(".ce-existing-col-title").textContent = `Unique Events (${uniqueEvents.length})`;
            colLists[1].querySelector(".ce-existing-col-list").innerHTML =
              uniqueEvents.length === 0
                ? '<div class="ce-existing-empty"><p>No unique past events found.</p></div>'
                : uniqueEvents.map((ev) => renderPastEventCard(ev)).join("");
          }
        }
      });
    }

    // Input change and dirty marking
    [
      "eventName",
      "eventSource",
      "targetYear",
      "eventDate",
      "timeStart",
      "timeEnd",
      "venue",
      "maxCapacity",
      "attendanceRequired",
      "weatherContingency",
      "description",
      "keyDetails",
      "requirements",
      "contactName",
      "contactEmail",
      "contactPhone",
    ].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        const handler = () => {
          state.dirty = true;
          clearFieldError(id);
          removeHighlight(id);
          updateAllReadinessChecks();
          updateLivePreview();
          if (id === "description") updateDescCounter();
          if (id === "venue" || id === "maxCapacity") checkVenueCapacityHint();
          if (id === "eventName") checkDuplicateNameWarning();
          if (id === "eventDate") checkDateHolidayNotice();
        };
        el.addEventListener("input", handler);
        el.addEventListener("change", handler);
      }
    });

    // Date Auto-Follow for Registration Deadline
    const dateInput = document.getElementById("eventDate");
    const deadlineInput = document.getElementById("registrationDeadline");
    if (dateInput && deadlineInput) {
      dateInput.addEventListener("change", () => {
        if (!state.deadlineManuallyEdited) {
          const dVal = dateInput.value;
          if (dVal) {
            deadlineInput.value = `${dVal}T23:59`;
            deadlineInput.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }
      });

      deadlineInput.addEventListener("input", () => {
        state.deadlineManuallyEdited = true;
      });

      const btnResetDeadline = document.getElementById("btnResetAutoDeadline");
      if (btnResetDeadline) {
        btnResetDeadline.addEventListener("click", () => {
          const dVal = dateInput.value || getManilaDateInfo().todayStr;
          deadlineInput.value = `${dVal}T23:59`;
          state.deadlineManuallyEdited = false;
          clearFieldError("registrationDeadline");
          deadlineInput.dispatchEvent(new Event("input", { bubbles: true }));
          deadlineInput.dispatchEvent(new Event("change", { bubbles: true }));
          showToast("Registration deadline reset to 11:59 PM of event date.");
        });
      }
    }

    // Set up Input Rules Helpers
    setupCategoryDropdown();
    setupFacultyChipsInput();
    setupCustomTimepickers();
    setupContactPhoneInput();
    setupBulletTextarea("keyDetails");
    setupBulletTextarea("requirements");
    setupNoNumbersInput("contactName", "contactNameNoNumbersHint");
    setupNoNumbersInput("facultySearchInput", "facultyNoNumbersHint");
    setupApproverChain();
    setupDropzone({
      stateKey: "participantDocs",
      dropzoneId: "dropzoneParticipant",
      inputId: "inputParticipantFiles",
      errorId: "error-participantDocs",
      isRequired: false,
      maxFiles: 5,
      maxSizeBytes: 10 * 1024 * 1024,
      helperText: "PDF, DOC, DOCX, JPG, PNG up to 10MB (max 5)",
    });
    setupDropzone({
      stateKey: "approvalDocs",
      dropzoneId: "dropzoneApproval",
      inputId: "inputApprovalFiles",
      errorId: "error-approvalDocs",
      isRequired: true,
      reqMsgId: "reqMsgApproval",
      reqStarId: "reqStarApproval",
      maxFiles: 5,
      maxSizeBytes: 10 * 1024 * 1024,
      helperText: "Letter of request, activity approval, endorsements (min 1 required)",
    });

    // Cancel Button with Confirmation Modal
    const btnCancel = document.getElementById("btnCancelEvent");
    if (btnCancel) {
      btnCancel.addEventListener("click", () => {
        showConfirmModal({
          title: "Cancel Event Creation?",
          text: "Are you sure you want to cancel? Any unsaved changes will be discarded.",
          confirmText: "Yes, Discard",
          cancelText: "Keep Editing",
          onConfirm: () => {
            location.href = redirectListUrl;
          },
        });
      });
    }

    // Save Draft Button with Confirmation Modal
    const btnSaveDraft = document.getElementById("btnSaveDraft");
    if (btnSaveDraft) {
      btnSaveDraft.addEventListener("click", () => {
        const form = document.getElementById("createEventMainForm");
        const nameVal = form?.eventName?.value.trim() || "";
        if (!nameVal) {
          showToast("Please enter an event name before saving draft.");
          form?.eventName?.focus();
          return;
        }

        showConfirmModal({
          title: "Save as Draft?",
          text: "Save this event as a draft? You can return and continue editing it at any time.",
          confirmText: "Save Draft",
          cancelText: "Cancel",
          onConfirm: () => {
            const draft = serializeEvent("Draft");
            persistEvent(draft);
            state.dirty = false;
            showToast("Draft saved successfully!");
          },
        });
      });
    }

    // Submit for Approval Button with Confirmation Modal
    const btnSubmit = document.getElementById("btnSubmitApproval");
    if (btnSubmit) {
      btnSubmit.addEventListener("click", () => {
        if (!validateForm()) {
          showToast("Please resolve all marked errors before submitting.");
          return;
        }

        showConfirmModal({
          title: requireApproval ? "Submit for Approval?" : "Publish Event?",
          text: requireApproval
            ? "Once submitted, this event proposal will enter the 8-step approval chain for review."
            : "Are you sure you want to publish this event? It will immediately become live.",
          confirmText: requireApproval ? "Submit Proposal" : "Publish Event",
          cancelText: "Cancel",
          onConfirm: async () => {
            const finalStatus = requireApproval ? "Pending Approval" : "Published";
            const form = document.getElementById("createEventMainForm");
            const title = form?.eventName?.value.trim() || "Untitled Event";
            const date = form?.eventDate?.value || "";
            const timeStart = form?.timeStart?.value || "08:00 AM";
            const timeEnd = form?.timeEnd?.value || "08:00 PM";
            const venue = form?.venue?.value || "PUP Biñan Campus";
            const category = state.selectedCategories.join(", ") || "Academic & Learning";
            const outsideGuests = Boolean(form?.outsideGuests?.checked);

            let serverEventId = null;
            if (isFirebaseConfigured && functions) {
              try {
                const createProposalFn = httpsCallable(functions, "createEventProposal");
                const res = await createProposalFn({
                  name: title,
                  venue,
                  category,
                  startAt: `${date} ${timeStart}`,
                  endAt: `${date} ${timeEnd}`,
                  outsideGuests,
                  approvers: state.selectedApprovers,
                  files: [...state.approvalDocs, ...state.participantDocs].map((f) => ({
                    name: f.name || f.fileName || "Document",
                    path: f.path || f.url || "",
                  })),
                });
                if (res?.data?.eventId) {
                  serverEventId = res.data.eventId;
                }
              } catch (cfErr) {
                console.warn("Cloud Function createEventProposal notice:", cfErr);
              }
            }

            const eventObj = serializeEvent(finalStatus);
            if (serverEventId) {
              eventObj.id = serverEventId;
              eventObj.eventId = serverEventId;
            }
            eventObj.outsideGuests = outsideGuests;
            eventObj.approvers = [...state.selectedApprovers];
            persistEvent(eventObj);
            state.dirty = false;
            showToast("Event submitted for approval successfully!");
            setTimeout(() => {
              location.href = redirectListUrl;
            }, 1000);
          },
        });
      });
    }
  }

  function setupApproverChain() {
    const list = document.getElementById("approverList");
    const countText = document.getElementById("approverCountText");
    const outsideCheckbox = document.getElementById("outsideGuests");
    const errEl = document.getElementById("error-approvers");
    if (!list) return;

    const keys = Object.keys(APPROVER_DIRECTORY).sort(
      (a, b) => (APPROVER_DIRECTORY[a].stage || 0) - (APPROVER_DIRECTORY[b].stage || 0)
    );

    function updateStepTags() {
      const checkedKeys = keys.filter((k) => {
        const input = document.getElementById(`approver-${k}`);
        return input ? input.checked : state.selectedApprovers.includes(k);
      });
      state.selectedApprovers = checkedKeys;

      let currentStep = 1;
      keys.forEach((key) => {
        const tag = document.getElementById(`stepTag-${key}`);
        const item = document.getElementById(`approverItem-${key}`);
        const isChecked = checkedKeys.includes(key);
        if (tag) {
          if (isChecked) {
            tag.textContent = `Step ${currentStep}`;
            tag.classList.remove("is-skipped");
            currentStep += 1;
          } else {
            tag.textContent = "Skipped";
            tag.classList.add("is-skipped");
          }
        }
        if (item) {
          item.classList.toggle("is-selected", isChecked);
        }
      });

      if (countText) {
        countText.textContent = `${checkedKeys.length} approver${checkedKeys.length === 1 ? "" : "s"} selected`;
      }

      if (errEl) {
        if (checkedKeys.length === 0) {
          errEl.hidden = false;
          errEl.textContent = "At least one approver must be selected.";
        } else {
          errEl.hidden = true;
          errEl.textContent = "";
        }
      }
    }

    list.innerHTML = keys
      .map((key) => {
        const info = APPROVER_DIRECTORY[key];
        const isPreChecked = state.selectedApprovers.includes(key);
        const isReq = Boolean(info.required);
        const isSuggest = info.suggestIf === "outsideGuests";

        return `
          <div class="ce-approver-item ${isPreChecked ? "is-selected" : ""} ${isReq ? "is-disabled" : ""}" id="approverItem-${key}">
            <div class="ce-approver-col-left">
              <span class="ce-step-tag" id="stepTag-${key}">Step -</span>
              <span class="ce-approver-name">${escapeHTML(info.label)}</span>
              ${isReq ? '<span class="ce-req-badge">Required</span>' : ""}
              ${isSuggest ? `<span class="ce-suggested-badge" id="suggestBadge-${key}" ${state.outsideGuests ? "" : "hidden"}>Suggested: outside guests</span>` : ""}
            </div>
            <div class="ce-approver-col-right">
              <input type="checkbox"
                     class="ce-approver-checkbox"
                     id="approver-${key}"
                     data-key="${key}"
                     ${isPreChecked ? "checked" : ""}
                     ${isReq ? "disabled" : ""}>
            </div>
          </div>
        `;
      })
      .join("");

    keys.forEach((key) => {
      const input = document.getElementById(`approver-${key}`);
      if (input && !APPROVER_DIRECTORY[key].required) {
        input.addEventListener("change", () => {
          updateStepTags();
          state.dirty = true;
        });
      }
    });

    if (outsideCheckbox) {
      outsideCheckbox.addEventListener("change", (e) => {
        state.outsideGuests = Boolean(e.target.checked);
        const vpExtInput = document.getElementById("approver-vp_ext");
        const vpExtBadge = document.getElementById("suggestBadge-vp_ext");
        if (state.outsideGuests) {
          if (vpExtInput && !vpExtInput.checked) {
            vpExtInput.checked = true;
          }
          if (vpExtBadge) vpExtBadge.hidden = false;
        } else {
          if (vpExtBadge) vpExtBadge.hidden = true;
        }
        updateStepTags();
        state.dirty = true;
      });
    }

    updateStepTags();
  }

  // 16. Custom 3-Column Scrollable Timepicker (Hour, Minute, AM/PM)
  function setupCustomTimepickers() {
    var PICKER_HOURS = ["12", "01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11"];
    var PICKER_MINUTES = [];
    for (var i = 0; i < 60; i++) {
      PICKER_MINUTES.push(String(i).padStart(2, "0"));
    }
    var PICKER_PERIODS = ["AM", "PM"];

    ["timeStart", "timeEnd"].forEach(function(fieldId) {
      var input = document.getElementById(fieldId);
      var wrap = document.getElementById("picker-wrap-" + fieldId);
      var dropdown = document.getElementById("dropdown-" + fieldId);
      var toggleBtn = document.getElementById("btnToggle-" + fieldId);
      if (!input || !wrap || !dropdown) return;

      var hourCol = dropdown.querySelector('[data-col="hour"]');
      var minCol = dropdown.querySelector('[data-col="minute"]');
      var periodCol = dropdown.querySelector('[data-col="period"]');
      if (!hourCol || !minCol || !periodCol) return;

      // Populate columns
      hourCol.innerHTML = PICKER_HOURS.map(function(h) {
        return '<div class="ce-timepicker-item" data-value="' + h + '" role="button" tabindex="0">' + h + '</div>';
      }).join("");

      minCol.innerHTML = PICKER_MINUTES.map(function(m) {
        return '<div class="ce-timepicker-item" data-value="' + m + '" role="button" tabindex="0">' + m + '</div>';
      }).join("");

      periodCol.innerHTML = PICKER_PERIODS.map(function(p) {
        return '<div class="ce-timepicker-item" data-value="' + p + '" role="button" tabindex="0">' + p + '</div>';
      }).join("");

      function parseCurrent() {
        var val = (input.value || "").trim();
        var match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(val);
        if (match) {
          return {
            h: match[1].padStart(2, "0"),
            m: match[2].padStart(2, "0"),
            p: (match[3] || "AM").toUpperCase()
          };
        }
        return fieldId === "timeStart" ? { h: "08", m: "00", p: "AM" } : { h: "08", m: "00", p: "PM" };
      }

      function syncActiveClasses(scrollToCenter) {
        var cur = parseCurrent();

        hourCol.querySelectorAll(".ce-timepicker-item").forEach(function(el) {
          var isMatch = el.dataset.value === cur.h;
          el.classList.toggle("is-selected", isMatch);
          if (isMatch && scrollToCenter) {
            el.scrollIntoView({ block: "center", behavior: "auto" });
          }
        });

        minCol.querySelectorAll(".ce-timepicker-item").forEach(function(el) {
          var isMatch = el.dataset.value === cur.m;
          el.classList.toggle("is-selected", isMatch);
          if (isMatch && scrollToCenter) {
            el.scrollIntoView({ block: "center", behavior: "auto" });
          }
        });

        periodCol.querySelectorAll(".ce-timepicker-item").forEach(function(el) {
          var isMatch = el.dataset.value === cur.p;
          el.classList.toggle("is-selected", isMatch);
          if (isMatch && scrollToCenter) {
            el.scrollIntoView({ block: "center", behavior: "auto" });
          }
        });
      }

      function openDropdown() {
        document.querySelectorAll(".ce-timepicker-dropdown").forEach(function(d) {
          if (d !== dropdown) d.hidden = true;
        });
        document.querySelectorAll(".ce-timepicker-input").forEach(function(inp) {
          if (inp !== input) inp.setAttribute("aria-expanded", "false");
        });

        dropdown.hidden = false;
        input.setAttribute("aria-expanded", "true");
        syncActiveClasses(true);
      }

      function closeDropdown() {
        dropdown.hidden = true;
        input.setAttribute("aria-expanded", "false");
      }

      function updateValue(newH, newM, newP) {
        var cur = parseCurrent();
        var h = newH !== undefined ? newH : cur.h;
        var m = newM !== undefined ? newM : cur.m;
        var p = newP !== undefined ? newP : cur.p;
        input.value = h + ":" + m + " " + p;
        syncActiveClasses(false);

        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }

      hourCol.addEventListener("click", function(e) {
        var item = e.target.closest(".ce-timepicker-item");
        if (item) updateValue(item.dataset.value, undefined, undefined);
      });

      minCol.addEventListener("click", function(e) {
        var item = e.target.closest(".ce-timepicker-item");
        if (item) updateValue(undefined, item.dataset.value, undefined);
      });

      periodCol.addEventListener("click", function(e) {
        var item = e.target.closest(".ce-timepicker-item");
        if (item) updateValue(undefined, undefined, item.dataset.value);
      });

      input.addEventListener("click", function() {
        if (dropdown.hidden) openDropdown();
        else closeDropdown();
      });

      if (toggleBtn) {
        toggleBtn.addEventListener("click", function(e) {
          e.stopPropagation();
          if (dropdown.hidden) openDropdown();
          else closeDropdown();
        });
      }

      wrap.addEventListener("keydown", function(e) {
        if (e.key === "Escape" && !dropdown.hidden) {
          closeDropdown();
          input.focus();
        }
      });

      document.addEventListener("click", function(e) {
        if (!wrap.contains(e.target)) {
          closeDropdown();
        }
      });
    });
  }

  // 17. Contact Phone "09" Lock Helper
  function setupContactPhoneInput() {
    const input = document.getElementById("contactPhone");
    if (!input) return;

    if (!input.value || !input.value.startsWith("09")) {
      input.value = "09";
    }

    function lockCursor() {
      if (input.selectionStart < 2) {
        input.setSelectionRange(2, Math.max(2, input.selectionEnd));
      }
    }

    input.addEventListener("focus", lockCursor);
    input.addEventListener("click", lockCursor);
    input.addEventListener("keyup", lockCursor);
    input.addEventListener("mouseup", lockCursor);
    input.addEventListener("touchend", lockCursor);

    input.addEventListener("keydown", (e) => {
      if (e.key === "Backspace" && input.selectionStart <= 2 && input.selectionEnd <= 2) {
        e.preventDefault();
      } else if (e.key === "Delete" && input.selectionStart < 2) {
        e.preventDefault();
      } else if (e.key === "ArrowLeft" && input.selectionStart <= 2) {
        e.preventDefault();
      } else if (e.key === "Home") {
        e.preventDefault();
        input.setSelectionRange(2, 2);
      }
    });

    input.addEventListener("beforeinput", (e) => {
      if (e.inputType === "deleteContentBackward" && input.selectionStart <= 2 && input.selectionEnd <= 2) {
        e.preventDefault();
        return;
      }
      if (e.data && !/^\d+$/.test(e.data)) {
        e.preventDefault();
        return;
      }
      if (e.data && input.value.length >= 11 && input.selectionStart === input.selectionEnd) {
        e.preventDefault();
      }
    });

    input.addEventListener("input", () => {
      let val = input.value.replace(/\D/g, "");
      if (!val.startsWith("09")) {
        if (val.startsWith("639")) {
          val = "09" + val.slice(3);
        } else if (val.startsWith("9")) {
          val = "09" + val.slice(1);
        } else {
          val = "09" + val.replace(/^0+/, "");
        }
      }
      val = val.slice(0, 11);
      if (val.length < 2) val = "09";
      input.value = val;
      lockCursor();
    });

    input.addEventListener("paste", (e) => {
      e.preventDefault();
      const pasted = (e.clipboardData || window.clipboardData).getData("text") || "";
      let digits = pasted.replace(/\D/g, "");
      if (digits.startsWith("639")) {
        digits = "09" + digits.slice(3);
      } else if (digits.startsWith("9")) {
        digits = "09" + digits.slice(1);
      } else if (!digits.startsWith("09")) {
        digits = "09" + digits;
      }
      input.value = digits.slice(0, 11);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  // 18. Bullet Textarea Helper for Key Details and Requirements
  function setupBulletTextarea(id) {
    const textarea = document.getElementById(id);
    if (!textarea) return;

    if (!textarea.value.trim()) {
      textarea.value = "• ";
    }

    textarea.addEventListener("keydown", (e) => {
      const val = textarea.value;
      const selStart = textarea.selectionStart;
      const selEnd = textarea.selectionEnd;

      if (e.key === "Enter") {
        e.preventDefault();
        const before = val.substring(0, selStart);
        const after = val.substring(selEnd);
        const insert = "\n• ";
        textarea.value = before + insert + after;
        textarea.selectionStart = textarea.selectionEnd = selStart + insert.length;
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      } else if (e.key === "Backspace") {
        const lineStart = val.lastIndexOf("\n", selStart - 1) + 1;
        const lineText = val.substring(lineStart, selStart);
        if (lineText === "• " && selStart === selEnd) {
          e.preventDefault();
          const before = val.substring(0, lineStart);
          const after = val.substring(selStart);
          textarea.value = before + after;
          textarea.selectionStart = textarea.selectionEnd = lineStart;
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
        }
      }
    });

    textarea.addEventListener("paste", (e) => {
      e.preventDefault();
      const text = (e.clipboardData || window.clipboardData).getData("text") || "";
      const lines = text.split(/\r?\n/).map((l) => l.trim().replace(/^[•\-\*]\s*/, "")).filter(Boolean);
      const bulleted = lines.map((l) => "• " + l).join("\n");

      const val = textarea.value;
      const selStart = textarea.selectionStart;
      const selEnd = textarea.selectionEnd;

      if (val === "• " || !val.trim()) {
        textarea.value = bulleted || "• ";
        textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
      } else {
        const before = val.substring(0, selStart);
        const after = val.substring(selEnd);
        textarea.value = before + (bulleted || "") + after;
        textarea.selectionStart = textarea.selectionEnd = selStart + (bulleted || "").length;
      }
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  // 19. No Numbers in Names Helper
  function setupNoNumbersInput(inputId, hintId) {
    const input = document.getElementById(inputId);
    const hint = document.getElementById(hintId);
    if (!input) return;

    let hintTimeout = null;
    function showBlockedHint() {
      if (!hint) return;
      hint.textContent = "Numbers are not allowed";
      hint.hidden = false;
      if (hintTimeout) clearTimeout(hintTimeout);
      hintTimeout = setTimeout(() => {
        hint.hidden = true;
      }, 2500);
    }

    input.addEventListener("beforeinput", (e) => {
      if (e.data && /\d/.test(e.data)) {
        e.preventDefault();
        showBlockedHint();
      }
    });

    input.addEventListener("input", () => {
      if (/\d/.test(input.value)) {
        input.value = input.value.replace(/\d+/g, "");
        showBlockedHint();
      }
    });

    input.addEventListener("paste", (e) => {
      const pasted = (e.clipboardData || window.clipboardData).getData("text") || "";
      if (/\d/.test(pasted)) {
        e.preventDefault();
        const cleaned = pasted.replace(/\d+/g, "");
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const val = input.value;
        input.value = val.substring(0, start) + cleaned + val.substring(end);
        input.selectionStart = input.selectionEnd = start + cleaned.length;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        showBlockedHint();
      }
    });
  }

  // 20. Confirmation Modal Helper
  function showConfirmModal({ title, text, confirmText, cancelText, onConfirm }) {
    const modal = document.getElementById("ceConfirmModal");
    const titleEl = document.getElementById("confirmModalTitle");
    const textEl = document.getElementById("confirmModalText");
    const primaryBtn = document.getElementById("confirmModalPrimaryBtn");
    const cancelBtn = document.getElementById("confirmModalCancelBtn");

    if (!modal) return;

    if (titleEl) titleEl.textContent = title || "Confirm Action";
    if (textEl) textEl.textContent = text || "Are you sure you want to proceed?";
    if (primaryBtn) primaryBtn.textContent = confirmText || "Confirm";
    if (cancelBtn) cancelBtn.textContent = cancelText || "Cancel";

    modal.hidden = false;
    modal.classList.add("is-visible");
    primaryBtn?.focus();

    function closeModal() {
      modal.hidden = true;
      modal.classList.remove("is-visible");
      primaryBtn.onclick = null;
      cancelBtn.onclick = null;
      modal.onclick = null;
    }

    primaryBtn.onclick = () => {
      closeModal();
      if (typeof onConfirm === "function") onConfirm();
    };

    cancelBtn.onclick = () => {
      closeModal();
    };

    modal.onclick = (e) => {
      if (e.target === modal) {
        closeModal();
      }
    };
  }

  function removeHighlight(id) {
    if (state.highlightedFields.has(id)) {
      state.highlightedFields.delete(id);
      const wrap = document.getElementById(`wrap-${id}`);
      if (wrap) wrap.classList.remove("is-copied-highlight");
    }
  }

  function updateDescCounter() {
    const desc = document.getElementById("description");
    const counter = document.getElementById("descCharCounter");
    if (desc && counter) {
      counter.textContent = `${desc.value.length} / 1500`;
    }
  }

  function checkVenueCapacityHint() {
    const venueEl = document.getElementById("venue");
    const hint = document.getElementById("venueCapacityHint");
    const weatherEl = document.getElementById("weatherContingency");
    if (!venueEl) return;

    const chosenVenue = venueEl.value;
    const venueRecord = VENUES_FLAT_MAP[chosenVenue];

    if (venueRecord && venueRecord.maxCapacity) {
      if (hint) hint.textContent = `Venue maximum capacity: ${venueRecord.maxCapacity} attendees.`;
    } else {
      if (hint) hint.textContent = "Select a venue to view capacity limit.";
    }

    if (weatherEl) {
      const type = venueRecord?.type ? String(venueRecord.type).toLowerCase() : "";
      if (type === "indoor") {
        weatherEl.value = "Indoor";
      } else if (type === "online") {
        weatherEl.value = "Online";
      } else if (type === "outdoor") {
        weatherEl.value = "Outdoor - It might rain or it might be too hot.";
      } else {
        weatherEl.value = "";
      }
      weatherEl.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  // 21. Check Duplicate Event Name against Past Events
  function checkDuplicateNameWarning() {
    const nameEl = document.getElementById("eventName");
    const notice = document.getElementById("duplicateNotice");
    if (!nameEl || !notice) return;

    const val = nameEl.value.trim().toLowerCase();
    if (val.length < 4) {
      notice.hidden = true;
      notice.textContent = "";
      return;
    }

    const past = loadCurrentUserEvents();
    const match = past.find((ev) => {
      const t = (ev.title || ev.eventName || "").toLowerCase().trim();
      return t === val && String(ev.id || ev.eventId) !== String(state.editingEventId || "");
    });

    if (match) {
      notice.textContent = `Note: You previously held an event titled "${match.title || match.eventName}". You may proceed or adjust the name.`;
      notice.hidden = false;
    } else {
      notice.hidden = true;
      notice.textContent = "";
    }
  }

  // 22. Check Holiday Notice on Selected Date
  async function checkDateHolidayNotice() {
    const dateEl = document.getElementById("eventDate");
    const notice = document.getElementById("holidayNotice");
    if (!dateEl || !notice) return;

    const val = dateEl.value;
    if (!val) {
      notice.hidden = true;
      notice.textContent = "";
      return;
    }

    try {
      let holidayFn = null;
      try {
        const mod = await import("../holidayService.js");
        holidayFn = mod.checkPhilippineHoliday;
      } catch (err) {
        // Fallback gracefully if module loading is restricted
      }
      if (holidayFn) {
        const res = await holidayFn(val);
        if (res && res.isHoliday) {
          notice.textContent = `Holiday Notice: ${res.holidayName || "Official Holiday"} falls on this date.`;
          notice.hidden = false;
          return;
        }
      }
      notice.hidden = true;
      notice.textContent = "";
    } catch {
      notice.hidden = true;
    }
  }

  // 23. Category Dropdown: Multi-Select with Checkboxes (1 to 3)
  function setupCategoryDropdown() {
    const btn = document.getElementById("catDropdownBtn");
    const menu = document.getElementById("catDropdownMenu");
    const textSpan = document.getElementById("catBtnText");
    if (!btn || !menu) return;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.categoryDropdownOpen = !state.categoryDropdownOpen;
      menu.classList.toggle("is-open", state.categoryDropdownOpen);
      btn.setAttribute("aria-expanded", String(state.categoryDropdownOpen));
    });

    document.addEventListener("click", (e) => {
      if (!menu.contains(e.target) && !btn.contains(e.target)) {
        state.categoryDropdownOpen = false;
        menu.classList.remove("is-open");
        btn.setAttribute("aria-expanded", "false");
      }
    });

    const checkboxes = menu.querySelectorAll(".ce-cat-checkbox");

    function updateLabelAndCount() {
      const selected = Array.from(checkboxes)
        .filter((c) => c.checked)
        .map((c) => c.value);

      state.selectedCategories = selected;

      checkboxes.forEach((cb) => {
        if (!cb.checked && selected.length >= 3) {
          cb.disabled = true;
          cb.parentElement.classList.add("is-disabled");
        } else {
          cb.disabled = false;
          cb.parentElement.classList.remove("is-disabled");
        }
      });

      if (selected.length === 0) {
        textSpan.textContent = "Select 1 to 3 categories...";
      } else {
        textSpan.textContent = `${selected.join(", ")} (${selected.length}/3)`;
      }

      state.dirty = true;
      clearFieldError("category");
      removeHighlight("category");
      updateAllReadinessChecks();
      updateLivePreview();
    }

    checkboxes.forEach((cb) => {
      cb.addEventListener("change", () => {
        updateLabelAndCount();
      });
    });

    updateLabelAndCount();
  }

  // 24. Participating Faculty Members: Searchable Chips (Optional)
  function setupFacultyChipsInput() {
    const input = document.getElementById("facultySearchInput");
    const suggestions = document.getElementById("facultySuggestions");
    if (!input || !suggestions) return;

    const allFaculty = loadFacultyPool();

    input.addEventListener("input", () => {
      const q = input.value.trim().toLowerCase();
      if (!q) {
        suggestions.hidden = true;
        suggestions.innerHTML = "";
        return;
      }

      const matches = allFaculty.filter((f) => {
        const notAdded = !state.participatingFaculty.some((pf) => pf.id === f.id || pf.name === f.name);
        return notAdded && (f.name.toLowerCase().includes(q) || (f.email && f.email.toLowerCase().includes(q)));
      }).slice(0, 6);

      if (matches.length === 0) {
        suggestions.hidden = true;
        suggestions.innerHTML = "";
        return;
      }

      suggestions.innerHTML = matches.map((f) => `
        <div class="ce-chip-suggestion-item" data-faculty-id="${escapeHTML(f.id)}" data-faculty-name="${escapeHTML(f.name)}" data-faculty-email="${escapeHTML(f.email || "")}">
          <strong>${escapeHTML(f.name)}</strong>
          <small>${escapeHTML(f.email || "Faculty")}</small>
        </div>
      `).join("");
      suggestions.hidden = false;

      suggestions.querySelectorAll(".ce-chip-suggestion-item").forEach((item) => {
        item.addEventListener("click", () => {
          const fObj = {
            id: item.dataset.facultyId,
            name: item.dataset.facultyName,
            email: item.dataset.facultyEmail,
          };
          addFacultyChip(fObj);
          input.value = "";
          suggestions.hidden = true;
          suggestions.innerHTML = "";
        });
      });
    });

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const first = suggestions.querySelector(".ce-chip-suggestion-item");
        if (first) {
          first.click();
        } else if (input.value.trim()) {
          const customName = input.value.trim().replace(/\d+/g, "");
          if (customName) {
            addFacultyChip({
              id: "custom-" + Date.now(),
              name: customName,
              email: "Faculty Member",
            });
            input.value = "";
            suggestions.hidden = true;
          }
        }
      } else if (e.key === "Escape") {
        suggestions.hidden = true;
      }
    });

    document.addEventListener("click", (e) => {
      if (!input.contains(e.target) && !suggestions.contains(e.target)) {
        suggestions.hidden = true;
      }
    });

    renderFacultyChipsList();
  }

  function addFacultyChip(facultyObj) {
    if (!facultyObj || !facultyObj.name) return;
    if (state.participatingFaculty.some((f) => f.name.toLowerCase() === facultyObj.name.toLowerCase())) {
      return;
    }
    state.participatingFaculty.push(facultyObj);
    state.dirty = true;
    renderFacultyChipsList();
    updateLivePreview();
  }

  function removeFacultyChip(index) {
    state.participatingFaculty.splice(index, 1);
    state.dirty = true;
    renderFacultyChipsList();
    updateLivePreview();
  }

  function renderFacultyChipsList() {
    const list = document.getElementById("facultyChipsList");
    if (!list) return;

    list.innerHTML = state.participatingFaculty.map((f, idx) => `
      <div class="ce-chip" data-chip-index="${idx}">
        <span class="ce-chip-label">${escapeHTML(f.name)}</span>
        <button type="button" class="ce-chip-remove" aria-label="Remove ${escapeHTML(f.name)}" data-remove-idx="${idx}">✕</button>
      </div>
    `).join("");

    list.querySelectorAll(".ce-chip-remove").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        removeFacultyChip(parseInt(btn.dataset.removeIdx, 10));
      });
    });
  }

  // 25. Reusable Drag & Drop File Upload Component
  const dropzoneInstances = new Map();

  function setupDropzone(configOrKey, dropzoneId, inputId, legacyIsRequired) {
    let config = {};
    if (typeof configOrKey === "string") {
      // Backward compatibility signature: (stateKey, dropzoneId, inputId, legacyIsRequired)
      config = {
        stateKey: configOrKey,
        dropzoneId,
        inputId,
        errorId: `error-${configOrKey}`,
        isRequired: Boolean(legacyIsRequired),
        reqMsgId: configOrKey === "approvalDocs" ? "reqMsgApproval" : null,
        reqStarId: configOrKey === "approvalDocs" ? "reqStarApproval" : null,
        maxFiles: 5,
        maxSizeBytes: 10 * 1024 * 1024,
        helperText: configOrKey === "approvalDocs"
          ? "Letter of request, activity approval, endorsements (min 1 required)"
          : "PDF, DOC, DOCX, JPG, PNG up to 10MB (max 5)",
      };
    } else {
      config = { ...configOrKey };
    }

    const {
      stateKey,
      dropzoneId: zId,
      inputId: inId,
      errorId,
      isRequired = false,
      reqMsgId = null,
      reqStarId = null,
      maxFiles = 5,
      maxSizeBytes = 10 * 1024 * 1024,
      allowedExtensions = [".pdf", ".doc", ".docx", ".jpg", ".jpeg", ".png"],
      helperText = "PDF, DOC, DOCX, JPG, PNG up to 10MB (max 5)",
    } = config;

    const zone = document.getElementById(zId);
    const input = document.getElementById(inId);
    const errorEl = document.getElementById(errorId);
    const reqMsgEl = reqMsgId ? document.getElementById(reqMsgId) : null;
    const reqStarEl = reqStarId ? document.getElementById(reqStarId) : null;
    const wrapEl = document.getElementById(`wrap-${stateKey}`);

    if (!zone || !input) return null;

    function getFiles() {
      if (!Array.isArray(state[stateKey])) {
        state[stateKey] = [];
      }
      return state[stateKey];
    }

    function setInlineError(msg) {
      if (errorEl) {
        errorEl.textContent = msg;
        errorEl.hidden = false;
      }
    }

    function clearInlineError() {
      if (errorEl) {
        errorEl.textContent = "";
        errorEl.hidden = true;
      }
      if (wrapEl) wrapEl.classList.remove("has-error");
      zone.classList.remove("has-error");
    }

    function updateRequiredIndicators() {
      if (!isRequired) return;
      const count = getFiles().length;
      const hasFiles = count >= 1;
      if (reqMsgEl) {
        reqMsgEl.hidden = hasFiles;
        reqMsgEl.style.display = hasFiles ? "none" : "block";
      }
      if (reqStarEl) {
        reqStarEl.hidden = hasFiles;
        reqStarEl.style.display = hasFiles ? "none" : "inline";
      }
    }

    function render() {
      updateRequiredIndicators();
      const files = getFiles();
      if (files.length === 0) {
        renderEmpty();
      } else {
        renderPopulated(files);
      }
    }

    function renderEmpty() {
      zone.classList.remove("has-files");
      zone.setAttribute("tabindex", "0");
      zone.setAttribute("role", "button");
      zone.setAttribute("aria-label", isRequired ? "Upload approval documents" : "Upload participant documents");

      zone.innerHTML = `
        <div class="ce-dropzone-empty">
          <svg class="ce-dropzone-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
          <p class="ce-dropzone-text"><strong>Drag & drop</strong> or <span class="ce-link-browse">browse files</span></p>
          <p class="ce-dropzone-subtext">${escapeHTML(helperText)}</p>
        </div>
      `;

      const emptyArea = zone.querySelector(".ce-dropzone-empty");
      if (emptyArea) {
        emptyArea.addEventListener("click", () => {
          input.click();
        });
      }
    }

    function renderPopulated(files) {
      zone.classList.add("has-files");
      zone.removeAttribute("role");
      zone.removeAttribute("tabindex");

      const isMax = files.length >= maxFiles;
      const counterText = `${files.length} / ${maxFiles} files`;

      zone.innerHTML = `
        <div class="ce-dropzone-populated">
          <div class="ce-dropzone-header">
            <span class="ce-dropzone-counter ${isMax ? 'is-max' : ''}">
              ${counterText}${isMax ? ' (Maximum reached)' : ''}
            </span>
            ${!isMax ? '<span class="ce-dropzone-drag-hint">Drag & drop to add more</span>' : ''}
          </div>

          <div class="ce-files-inside-list" role="list">
            ${files.map((file) => renderRowHtml(file)).join("")}
          </div>

          <div class="ce-dropzone-actions">
            <button type="button"
                    class="ce-btn-add-more"
                    ${isMax ? 'disabled aria-disabled="true" style="display: none;"' : ''}
                    aria-label="Add more files">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 2a.75.75 0 0 1 .75.75v4.5h4.5a.75.75 0 0 1 0 1.5h-4.5v4.5a.75.75 0 0 1-1.5 0v-4.5h-4.5a.75.75 0 0 1 0-1.5h4.5v-4.5A.75.75 0 0 1 8 2z"/>
              </svg>
              <span>+ Add more</span>
            </button>
          </div>
        </div>
      `;

      const addMoreBtn = zone.querySelector(".ce-btn-add-more");
      if (addMoreBtn && !isMax) {
        addMoreBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          input.click();
        });
      }

      zone.querySelectorAll(".ce-file-remove").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const removeId = btn.dataset.removeId;
          removeFile(removeId);
        });
      });

      zone.querySelectorAll(".ce-file-retry-btn").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          const retryId = btn.dataset.retryId;
          retryFile(retryId);
        });
      });
    }

    function renderRowHtml(file) {
      const isImg = file.type === "JPG" || file.type === "JPEG" || file.type === "PNG" ||
        (file.mime && file.mime.startsWith("image/")) ||
        (file.thumbnail && file.thumbnail.length > 0);

      let preview = "";
      if (isImg && file.thumbnail) {
        preview = `<img class="ce-file-thumb" src="${file.thumbnail}" alt="" />`;
      } else if (isImg) {
        preview = `
          <span class="ce-file-badge ce-file-badge-image" title="Image file" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
          </span>`;
      } else if (file.type === "PDF") {
        preview = `
          <span class="ce-file-badge ce-file-badge-pdf" title="PDF document" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            PDF
          </span>`;
      } else {
        preview = `
          <span class="ce-file-badge ce-file-badge-doc" title="Document" aria-hidden="true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            ${escapeHTML(file.type || "DOC")}
          </span>`;
      }

      const isUploading = Boolean(file.uploading);
      const isError = Boolean(file.error);
      const progress = typeof file.progress === "number" ? file.progress : 100;

      return `
        <div class="ce-file-item ${isError ? 'is-error' : ''}" role="listitem" data-file-id="${escapeHTML(file.id)}">
          <div class="ce-file-preview">
            ${preview}
          </div>
          <div class="ce-file-details">
            <div class="ce-file-name-row">
              <span class="ce-file-name" title="${escapeHTML(file.name)}">${escapeHTML(file.name)}</span>
              <span class="ce-file-size">${formatFileSize(file.size)}</span>
            </div>
            ${isUploading ? `
              <div class="ce-file-progress-track" aria-label="Uploading file">
                <div class="ce-file-progress-bar" style="width: ${progress}%;"></div>
              </div>
            ` : ''}
            ${isError ? `
              <div class="ce-file-error-row">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                  <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0-1A6 6 0 1 0 8 2a6 6 0 0 0 0 12zM7.25 4v5h1.5V4h-1.5zm.75 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"/>
                </svg>
                <span class="ce-file-error-text">${escapeHTML(file.error)}</span>
                <button type="button" class="ce-file-retry-btn" data-retry-id="${escapeHTML(file.id)}" aria-label="Retry upload of ${escapeHTML(file.name)}">Retry</button>
              </div>
            ` : ''}
          </div>
          <button type="button"
                  class="ce-file-remove"
                  data-remove-id="${escapeHTML(file.id)}"
                  aria-label="Remove ${escapeHTML(file.name)}"
                  title="Remove ${escapeHTML(file.name)}">
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
              <line x1="3" y1="3" x2="13" y2="13"/>
              <line x1="13" y1="3" x2="3" y2="13"/>
            </svg>
          </button>
        </div>
      `;
    }

    function removeFile(fileId) {
      const files = getFiles();
      const idx = files.findIndex((f) => f.id === fileId);
      if (idx !== -1) {
        if (files[idx].thumbnail && files[idx].thumbnail.startsWith("blob:")) {
          try { URL.revokeObjectURL(files[idx].thumbnail); } catch (e) {}
        }
        files.splice(idx, 1);
        state.dirty = true;
        clearInlineError();
        render();
        updateAllReadinessChecks();
      }
    }

    function retryFile(fileId) {
      const files = getFiles();
      const file = files.find((f) => f.id === fileId);
      if (file) {
        file.error = null;
        file.uploading = true;
        file.progress = 25;
        render();
        simulateUpload(file);
      }
    }

    function simulateUpload(docItem) {
      setTimeout(() => {
        docItem.progress = 75;
        const bar = zone.querySelector(`[data-file-id="${docItem.id}"] .ce-file-progress-bar`);
        if (bar) bar.style.width = "75%";
      }, 140);

      setTimeout(() => {
        docItem.progress = 100;
        docItem.uploading = false;
        const track = zone.querySelector(`[data-file-id="${docItem.id}"] .ce-file-progress-track`);
        if (track) {
          track.style.opacity = "0";
          setTimeout(() => track.remove(), 200);
        }
      }, 380);
    }

    function handleFiles(selectedFiles) {
      clearInlineError();
      const files = getFiles();
      const errMsgs = [];
      const validToAdd = [];

      Array.from(selectedFiles).forEach((file) => {
        const ext = "." + (file.name.split(".").pop() || "").toLowerCase();

        // 1. Check type
        if (!allowedExtensions.includes(ext)) {
          errMsgs.push(`"${file.name}" rejected: Only PDF, DOC, DOCX, JPG, PNG allowed.`);
          return;
        }

        // 2. Check size
        if (file.size > maxSizeBytes) {
          errMsgs.push(`"${file.name}" rejected: Exceeds 10MB limit (${formatFileSize(file.size)}).`);
          return;
        }

        // 3. Check duplicate
        const isDuplicate = files.some((f) => f.name === file.name && f.size === file.size) ||
          validToAdd.some((f) => f.name === file.name && f.size === file.size);
        if (isDuplicate) {
          errMsgs.push(`"${file.name}" is already added.`);
          return;
        }

        // 4. Check max limit
        if (files.length + validToAdd.length >= maxFiles) {
          errMsgs.push(`Maximum of ${maxFiles} files reached. "${file.name}" was not added.`);
          return;
        }

        let thumb = "";
        if (file instanceof File && (file.type.startsWith("image/") || /\.(jpe?g|png)$/i.test(file.name))) {
          try {
            thumb = URL.createObjectURL(file);
          } catch (e) {
            thumb = "";
          }
        }

        validToAdd.push({
          id: "doc-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
          name: file.name,
          size: file.size,
          type: ext.replace(".", "").toUpperCase(),
          mime: file.type || "",
          thumbnail: thumb,
          uploading: true,
          progress: 30,
          fileRef: file,
        });
      });

      // Add valid files without discarding them
      if (validToAdd.length > 0) {
        validToAdd.forEach((item) => {
          files.push(item);
          simulateUpload(item);
        });
        state.dirty = true;
      }

      if (errMsgs.length > 0) {
        setInlineError(errMsgs.join(" "));
      } else {
        clearInlineError();
      }

      render();
      updateAllReadinessChecks();
    }

    // Drag and Drop listeners on zone
    ["dragenter", "dragover"].forEach((evt) => {
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.add("is-dragover");
      });
    });

    ["dragleave", "drop"].forEach((evt) => {
      zone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        zone.classList.remove("is-dragover");
      });
    });

    zone.addEventListener("drop", (e) => {
      const dtFiles = e.dataTransfer?.files;
      if (dtFiles && dtFiles.length) {
        handleFiles(dtFiles);
      }
    });

    // Native file input listener
    input.addEventListener("change", () => {
      if (input.files && input.files.length) {
        handleFiles(input.files);
        input.value = "";
      }
    });

    // Click support on empty dropzone
    zone.addEventListener("click", () => {
      if (getFiles().length === 0) {
        input.click();
      }
    });

    // Keyboard support on empty dropzone
    zone.addEventListener("keydown", (e) => {
      if (getFiles().length === 0 && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        input.click();
      }
    });

    // Initial render
    render();

    const instance = { render, clearInlineError, setInlineError };
    dropzoneInstances.set(stateKey, instance);
    return instance;
  }

  function renderFileList(stateKey) {
    const inst = dropzoneInstances.get(stateKey);
    if (inst) {
      inst.render();
    }
  }

  function formatFileSize(bytes) {
    if (!bytes || bytes <= 0) return "0 B";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  // 26. Live Event Preview Synchronizer
  function updateLivePreview() {
    const form = document.getElementById("createEventMainForm");
    if (!form) return;

    // Title
    const titleEl = document.getElementById("previewTitle");
    if (titleEl) {
      const titleText = form.eventName?.value.trim() || "Untitled Event";
      titleEl.textContent = titleText;
      titleEl.title = titleText;
    }

    // Event Source reflects directly under event name
    const srcEl = document.getElementById("previewSource");
    if (srcEl) {
      const srcVal = form.eventSource?.value;
      srcEl.textContent = srcVal ? `Source: ${srcVal}` : "Source: Not specified";
    }

    // Categories
    const tagsEl = document.getElementById("previewTags");
    if (tagsEl) {
      if (state.selectedCategories.length === 0) {
        tagsEl.innerHTML = '<span class="ce-preview-tag">General</span>';
      } else {
        tagsEl.innerHTML = state.selectedCategories.map((c) => `
          <span class="ce-preview-tag">${escapeHTML(c)}</span>
        `).join("");
      }
    }

    // Date & Time
    const dtEl = document.getElementById("previewDateTime");
    if (dtEl) {
      const d = form.eventDate?.value;
      const ts = form.timeStart?.value;
      const te = form.timeEnd?.value;
      if (d && ts && te) {
        dtEl.textContent = `${formatDatePreview(d)} · ${ts} - ${te}`;
        dtEl.classList.remove("is-muted");
      } else if (d) {
        dtEl.textContent = formatDatePreview(d);
        dtEl.classList.remove("is-muted");
      } else {
        dtEl.textContent = "Date and time not set";
        dtEl.classList.add("is-muted");
      }
    }

    // Venue
    const venueEl = document.getElementById("previewVenue");
    if (venueEl) {
      const v = form.venue?.value;
      venueEl.textContent = v || "Venue not set";
      venueEl.classList.toggle("is-muted", !v);
    }

    // Capacity
    const capEl = document.getElementById("previewCapacity");
    if (capEl) {
      const c = form.maxCapacity?.value;
      capEl.textContent = c ? `Capacity: ${c} attendees` : "Capacity not specified";
      capEl.classList.toggle("is-muted", !c);
    }

    // Registration Deadline
    const dlineEl = document.getElementById("previewDeadline");
    if (dlineEl) {
      const dl = form.registrationDeadline?.value;
      if (dl) {
        try {
          const dObj = new Date(dl);
          dlineEl.textContent = `Deadline: ${dObj.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${dObj.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
        } catch {
          dlineEl.textContent = `Deadline: ${dl}`;
        }
        dlineEl.classList.remove("is-muted");
      } else {
        dlineEl.textContent = "Deadline not set";
        dlineEl.classList.add("is-muted");
      }
    }

    // Target Year
    const yearEl = document.getElementById("previewTargetYear");
    if (yearEl) {
      yearEl.textContent = `Target: ${form.targetYear?.value || "All Levels"}`;
    }

    // Organizer
    const orgEl = document.getElementById("previewOrganizer");
    if (orgEl) {
      orgEl.textContent = readOnlyOrganizerValue;
    }
  }

  function formatDatePreview(isoStr) {
    try {
      const parts = isoStr.split("-");
      if (parts.length === 3) {
        const date = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      }
    } catch {
      // fallback
    }
    return isoStr;
  }

  // 27. 8 Readiness Checks (Live Icons & Status)
  function parseTimeInMinutes(timeStr) {
    const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec((timeStr || "").trim());
    if (!match) return null;
    let hour = parseInt(match[1], 10);
    const min = parseInt(match[2], 10);
    const period = (match[3] || "AM").toUpperCase();
    if (period === "PM" && hour < 12) hour += 12;
    if (period === "AM" && hour === 12) hour = 0;
    return hour * 60 + min;
  }

  function checkCrossEventConflict(date, venue, startTimeStr, endTimeStr) {
    if (!date || !venue || !startTimeStr || !endTimeStr) return null;
    if (venue.startsWith("Others |") || venue.includes("Online")) return null;

    const startMins = parseTimeInMinutes(startTimeStr);
    const endMins = parseTimeInMinutes(endTimeStr);
    if (startMins === null || endMins === null) return null;

    const allEvents = [
      ...readJSON("recovibeOrganizerEvents", []),
      ...readJSON("recovibeTeacherEvents", []),
    ];

    const conflicting = allEvents.find((ev) => {
      if (!ev) return false;
      const evId = String(ev.id || ev.eventId || "");
      if (state.editingEventId && evId === String(state.editingEventId)) return false;

      const st = String(ev.status || "").toLowerCase();
      if (!["approved", "published", "pending", "pending approval", "pending_approval"].includes(st)) {
        return false;
      }

      const evDate = String(ev.date || ev.dateISO || ev.eventDate || "").slice(0, 10);
      if (evDate !== date) return false;

      const evVenue = String(ev.venue || ev.location || "");
      if (evVenue !== venue) return false;

      const timeRange = String(ev.time || "").split(/\s*[-–]\s*/);
      const evStart = parseTimeInMinutes(ev.startTime ? formatTo12Hr(ev.startTime) : timeRange[0]);
      const evEnd = parseTimeInMinutes(ev.endTime ? formatTo12Hr(ev.endTime) : timeRange[1]);

      if (evStart === null || evEnd === null) return false;

      return startMins < evEnd && endMins > evStart;
    });

    return conflicting || null;
  }

  function formatTo12Hr(t24) {
    if (!t24) return "";
    const p = t24.split(":");
    if (p.length < 2) return t24;
    const h = parseInt(p[0], 10);
    const m = p[1];
    return `${String(h % 12 || 12).padStart(2, "0")}:${m} ${h < 12 ? "AM" : "PM"}`;
  }

  function updateAllReadinessChecks() {
    const form = document.getElementById("createEventMainForm");
    if (!form) return;

    let readyCount = 0;
    const manilaInfo = getManilaDateInfo();

    // 1. Event name provided (min 3 chars)
    const nameVal = form.eventName?.value.trim() || "";
    const namePass = nameVal.length >= 3;
    setCheckStatus("check-name", namePass, "Event name provided (min 3 chars)");
    if (namePass) readyCount++;

    // 2. At least 1 category selected (1 to 3)
    const catPass = state.selectedCategories.length >= 1 && state.selectedCategories.length <= 3;
    setCheckStatus("check-category", catPass, "1 to 3 categories selected");
    if (catPass) readyCount++;

    // 3. Time End is after Time Start & within 8 AM - 8 PM
    const tStart = parseTimeInMinutes(form.timeStart?.value);
    const tEnd = parseTimeInMinutes(form.timeEnd?.value);
    const dateVal = form.eventDate?.value || "";
    const currentMins = getManilaCurrentMinutes();
    const passedCheck = dateVal === manilaInfo.todayStr ? (tStart !== null && tStart > currentMins) : true;
    const timeLimitsPass = tStart !== null && tEnd !== null && tStart >= 480 && tEnd <= 1200;
    const timesPass = timeLimitsPass && tEnd > tStart && passedCheck;
    setCheckStatus("check-times", timesPass, timesPass ? "Time End is after Time Start" : "Time End must be after Time Start (8 AM - 8 PM)");
    if (timesPass) readyCount++;

    // 4. Cross-event venue conflict check
    const venueVal = form.venue?.value || "";
    const conflict = checkCrossEventConflict(dateVal, venueVal, form.timeStart?.value, form.timeEnd?.value);
    state.conflict = conflict;
    const conflictPass = !conflict;
    setCheckStatus("check-conflict", conflictPass, conflict ? `Venue conflict with "${conflict.title || "another event"}"` : "No venue booking conflict");
    if (conflictPass) readyCount++;

    // 5. Registration deadline is on or before 11:59 PM of event date & not in past
    let deadlinePass = false;
    const deadlineVal = form.registrationDeadline?.value;
    if (deadlineVal && dateVal) {
      const dlineDate = new Date(deadlineVal);
      const isPast = dlineDate < new Date();
      const maxDeadlineStr = `${dateVal}T23:59`;
      const isAfterEventDay = deadlineVal > maxDeadlineStr;
      deadlinePass = !isNaN(dlineDate.getTime()) && !isPast && !isAfterEventDay;
    }
    setCheckStatus("check-deadline", deadlinePass, deadlinePass ? "Deadline is on or before 11:59 PM of event date" : "Deadline cannot be in past or after event date");
    if (deadlinePass) readyCount++;

    // 6. Capacity is within venue limit
    let capacityPass = true;
    const capVal = form.maxCapacity?.value ? parseInt(form.maxCapacity.value, 10) : null;
    const venueRecord = VENUES_FLAT_MAP[venueVal];
    const maxVenueLimit = venueRecord?.maxCapacity;
    if (capVal && maxVenueLimit) {
      capacityPass = capVal <= maxVenueLimit;
    }
    setCheckStatus("check-capacity", capacityPass, capacityPass ? "Capacity is within venue limit" : `Capacity exceeds venue limit of ${maxVenueLimit}`);
    if (capacityPass) readyCount++;

    // 7. Contact person name and valid email (no numbers in name)
    const contactNameVal = form.contactName?.value.trim() || "";
    const contactEmailVal = form.contactEmail?.value.trim() || "";
    const noNumsInName = !/\d/.test(contactNameVal);
    const contactPass = contactNameVal.length >= 2 && noNumsInName && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmailVal);
    setCheckStatus("check-contact", contactPass, contactPass ? "Contact person name and email provided" : "Provide contact person name and valid email");
    if (contactPass) readyCount++;

    // 8. At least 1 approval document attached
    const approvalPass = state.approvalDocs.length >= 1;
    setCheckStatus("check-approvalDocs", approvalPass, approvalPass ? "Approval document attached" : "At least 1 approval document required");
    if (approvalPass) readyCount++;

    // Summary Badge & Progress Bar in Side Panel & Bottom Bar
    const badge = document.getElementById("checksBadge");
    if (badge) {
      badge.textContent = `${readyCount} of 8 Ready`;
      badge.classList.toggle("is-complete", readyCount === 8);
    }

    const bar = document.getElementById("checksProgressBar");
    if (bar) {
      const pct = Math.round((readyCount / 8) * 100);
      bar.style.width = `${pct}%`;
      bar.classList.toggle("is-complete", readyCount === 8);
    }

    const bText = document.getElementById("bottomStatusText");
    if (bText) {
      if (readyCount === 8) {
        bText.textContent = "All 8 readiness checks passed. Ready for submission!";
        bText.style.color = "#15803d";
      } else {
        bText.textContent = `${8 - readyCount} check${8 - readyCount === 1 ? "" : "s"} remaining before submitting.`;
        bText.style.color = "#b91c1c";
      }
    }
  }

  function setCheckStatus(elementId, passed, labelText) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.classList.toggle("is-passed", passed);
    el.classList.toggle("is-failed", !passed);
    const icon = el.querySelector(".ce-check-icon");
    if (icon) {
      icon.textContent = passed ? "✓" : "✕";
    }
    const sr = el.querySelector(".ce-check-status-sr");
    if (sr) {
      sr.textContent = passed ? "Passed: " : "Not yet: ";
    }
    const label = el.querySelector(".ce-check-label");
    if (label && labelText) {
      label.textContent = labelText;
    }
  }

  // 28. Comprehensive Form Validation on Submit
  function validateForm() {
    const form = document.getElementById("createEventMainForm");
    if (!form) return false;

    let isValid = true;
    let firstErrorElement = null;

    function markError(id, msg) {
      isValid = false;
      const errEl = document.getElementById(`error-${id}`);
      const wrapEl = document.getElementById(`wrap-${id}`);
      let inputEl = document.getElementById(id);
      if (!inputEl) {
        if (id === "approvalDocs") inputEl = document.getElementById("dropzoneApproval");
        else if (id === "participantDocs") inputEl = document.getElementById("dropzoneParticipant");
      }
      if (errEl) {
        errEl.textContent = msg;
        errEl.hidden = false;
      }
      if (wrapEl) wrapEl.classList.add("has-error");
      if (inputEl) {
        inputEl.setAttribute("aria-invalid", "true");
        inputEl.classList.add("has-error");
      }
      if (!firstErrorElement && inputEl) {
        firstErrorElement = inputEl;
      }
    }

    // Clear old errors
    root.querySelectorAll(".ce-error").forEach((el) => {
      el.textContent = "";
      el.hidden = true;
    });
    root.querySelectorAll(".has-error").forEach((el) => el.classList.remove("has-error"));
    root.querySelectorAll("[aria-invalid]").forEach((el) => el.removeAttribute("aria-invalid"));

    const manilaInfo = getManilaDateInfo();

    // 1. Event Name
    const nameVal = form.eventName?.value.trim() || "";
    if (nameVal.length < 3) {
      markError("eventName", "Event name is required (minimum 3 characters).");
    }

    // 2. Categories
    if (state.selectedCategories.length < 1 || state.selectedCategories.length > 3) {
      markError("category", "Please select 1 to 3 categories for this event.");
    }

    // 3. Date Validation (Asia/Manila Today up to Dec 31, maxYear)
    const dateVal = form.eventDate?.value || "";
    if (!dateVal) {
      markError("eventDate", "Event date is required.");
    } else if (dateVal < manilaInfo.todayStr || dateVal > manilaInfo.maxDateStr) {
      markError("eventDate", `Choose a date from today up to December 31, ${manilaInfo.maxYear}`);
    }

    // 4. Time Start & Time End
    const tStart = parseTimeInMinutes(form.timeStart?.value);
    const tEnd = parseTimeInMinutes(form.timeEnd?.value);

    if (tStart === null) {
      markError("timeStart", "Time start is required.");
    } else if (tStart < 480) {
      markError("timeStart", "Time Start cannot be earlier than 8:00 AM.");
    } else if (dateVal === manilaInfo.todayStr && tStart <= getManilaCurrentMinutes()) {
      markError("timeStart", "Start time has already passed");
    }

    if (tEnd === null) {
      markError("timeEnd", "Time end is required.");
    } else if (tEnd > 1200) {
      markError("timeEnd", "Time End cannot be later than 8:00 PM.");
    } else if (tStart !== null && tEnd <= tStart) {
      markError("timeEnd", "Time End must be strictly after Time Start.");
    }

    // 5. Venue
    const venueVal = form.venue?.value || "";
    if (!venueVal) {
      markError("venue", "Please select a venue for the event.");
    }

    // 6. Capacity
    const venueRecord = VENUES_FLAT_MAP[venueVal];
    const maxVenueLimit = venueRecord?.maxCapacity;
    if (form.maxCapacity?.value) {
      const cap = parseInt(form.maxCapacity.value, 10);
      if (cap <= 0) {
        markError("maxCapacity", "Capacity must be a positive number.");
      } else if (maxVenueLimit && cap > maxVenueLimit) {
        markError("maxCapacity", `Capacity cannot exceed venue maximum of ${maxVenueLimit}.`);
      }
    }

    // 7. Venue Conflict
    if (state.conflict) {
      markError("venue", `Conflict: Venue is already booked on this date/time for "${state.conflict.title || "another event"}".`);
    }

    // 8. Registration Deadline (cannot be in past, cannot exceed 11:59 PM of event date)
    const deadlineVal = form.registrationDeadline?.value;
    if (!deadlineVal) {
      markError("registrationDeadline", "Registration deadline is required.");
    } else {
      const dlineDate = new Date(deadlineVal);
      if (isNaN(dlineDate.getTime())) {
        markError("registrationDeadline", "Please enter a valid registration deadline date and time.");
      } else if (dlineDate < new Date()) {
        markError("registrationDeadline", "Registration deadline cannot be in the past.");
      } else if (dateVal && deadlineVal > `${dateVal}T23:59`) {
        markError("registrationDeadline", "Registration deadline cannot be later than 11:59 PM of the event date.");
      }
    }

    // 9. Contact Person Name (No numbers allowed)
    const contactNameVal = form.contactName?.value.trim() || "";
    if (contactNameVal.length < 2) {
      markError("contactName", "Contact person name is required.");
    } else if (/\d/.test(contactNameVal)) {
      markError("contactName", "Contact person name cannot contain numbers.");
    }

    // 10. Contact Person Email
    const contactEmailVal = form.contactEmail?.value.trim() || "";
    if (!contactEmailVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmailVal)) {
      markError("contactEmail", "A valid email address is required for the contact person.");
    }

    // 11. Contact Phone (09 locked, exactly 11 digits if entered)
    const phoneVal = (form.contactPhone?.value || "").trim();
    if (phoneVal && phoneVal !== "09") {
      if (!/^09\d{9}$/.test(phoneVal)) {
        markError("contactPhone", "Enter a valid 11-digit mobile number starting with 09");
      }
    }

    // 12. Approval Documents
    if (state.approvalDocs.length === 0) {
      markError("approvalDocs", "At least 1 approval document is required before submission.");
    }

    // 13. Approval Chain (Task 3)
    if (!state.selectedApprovers || state.selectedApprovers.length === 0) {
      markError("approvers", "At least one approver must be selected in the approval chain.");
    }

    if (!isValid && firstErrorElement) {
      firstErrorElement.focus();
      firstErrorElement.scrollIntoView({ behavior: "smooth", block: "center" });
    }

    return isValid;
  }

  function clearFieldError(id) {
    const errEl = document.getElementById(`error-${id}`);
    const wrapEl = document.getElementById(`wrap-${id}`);
    let inputEl = document.getElementById(id);
    if (!inputEl) {
      if (id === "approvalDocs") inputEl = document.getElementById("dropzoneApproval");
      else if (id === "participantDocs") inputEl = document.getElementById("dropzoneParticipant");
      else if (id === "approvers") inputEl = document.getElementById("approverList");
    }
    if (errEl) {
      errEl.textContent = "";
      errEl.hidden = true;
    }
    if (wrapEl) wrapEl.classList.remove("has-error");
    if (inputEl) {
      inputEl.removeAttribute("aria-invalid");
      inputEl.classList.remove("has-error");
    }
  }

  // 29. Save Draft & Submit Event Handlers
  function serializeEvent(status) {
    const form = document.getElementById("createEventMainForm");
    const id = state.editingEventId || `${isOrganizerPage ? "org" : "tch"}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const nowISO = new Date().toISOString();

    const title = form?.eventName?.value.trim() || "Untitled Event";
    const date = form?.eventDate?.value || "";
    const timeStart = form?.timeStart?.value || "";
    const timeEnd = form?.timeEnd?.value || "";
    const venue = form?.venue?.value || "";
    const maxCapacity = form?.maxCapacity?.value ? parseInt(form.maxCapacity.value, 10) : null;
    const outsideGuests = Boolean(form?.outsideGuests?.checked);

    // Contact phone: treat bare "09" as empty
    let cleanPhone = (form?.contactPhone?.value || "").trim();
    if (cleanPhone === "09") cleanPhone = "";

    // Clean bulleted lists for Key Details and Requirements
    const cleanKeyDetails = form?.keyDetails?.value
      .split("\n")
      .map((s) => s.trim().replace(/^[•\-\*]\s*/, ""))
      .filter(Boolean) || [];

    const cleanRequirements = form?.requirements?.value
      .split("\n")
      .map((s) => s.trim().replace(/^[•\-\*]\s*/, ""))
      .filter(Boolean) || [];

    return {
      id,
      eventId: id,
      title,
      eventName: title,
      organizer: readOnlyOrganizerValue,
      organizerName: readOnlyOrganizerValue,
      organizerId: userIdentifier,
      createdBy: userIdentifier,
      creatorRole: currentRole,
      source: form?.eventSource?.value || defaultEventSource,
      categories: [...state.selectedCategories],
      category: state.selectedCategories.join(", "),
      targetYear: form?.targetYear?.value || "All Levels",
      date,
      dateISO: date,
      timeStart,
      timeEnd,
      time: timeStart && timeEnd ? `${timeStart} - ${timeEnd}` : "",
      venue,
      location: venue,
      maxCapacity,
      capacity: maxCapacity,
      openSlots: maxCapacity,
      slots: maxCapacity,
      registrationDeadline: form?.registrationDeadline?.value || "",
      registrationEnabled,
      attendanceRequired: form?.attendanceRequired?.checked ?? true,
      weatherContingency: form?.weatherContingency?.value || "",
      description: form?.description?.value.trim() || "",
      keyDetails: cleanKeyDetails,
      requirements: cleanRequirements,
      participatingFaculty: [...state.participatingFaculty],
      contactPerson: {
        name: form?.contactName?.value.trim() || "",
        email: form?.contactEmail?.value.trim() || "",
        phone: cleanPhone,
      },
      contactName: form?.contactName?.value.trim() || "",
      contactEmail: form?.contactEmail?.value.trim() || "",
      contactPhone: cleanPhone,
      participantDocuments: [...state.participantDocs],
      attachments: [...state.participantDocs],
      approvalDocuments: [...state.approvalDocs],
      outsideGuests: Boolean(outsideGuests),
      approvers: [...state.selectedApprovers],
      status, // "Draft", "Pending Approval", or "Published"
      createdAt: nowISO,
      updatedAt: nowISO,
      hap1Approved: false,
      hap2Approved: false,
      hap3Approved: false,
    };
  }

  function persistEvent(eventObj) {
    const list = readJSON(storageKeyEvents, []);
    const idx = list.findIndex((ev) => String(ev.id || ev.eventId) === String(eventObj.id));

    if (idx >= 0) {
      list[idx] = { ...list[idx], ...eventObj, updatedAt: new Date().toISOString() };
    } else {
      list.unshift(eventObj);
    }

    writeJSON(storageKeyEvents, list);

    // Also mirror to global RECOVIBE_EVENTS for student feed compatibility if approved/published
    if (eventObj.status === "Published") {
      const studentEvents = readJSON("recovibeEvents", []);
      studentEvents.unshift(eventObj);
      writeJSON("recovibeEvents", studentEvents);
    }
  }

  // 30. Check Query Param for Direct Edit Mode (?eventId=xxx)
  const queryEventId = urlParams.get("eventId");
  if (queryEventId) {
    const past = loadCurrentUserEvents();
    const target = past.find((ev) => String(ev.id || ev.eventId) === String(queryEventId));
    if (target) {
      state.editingEventId = queryEventId;
      state.mode = "new";
      state.selectedCategories = Array.isArray(target.categories) ? [...target.categories] : [];
      state.participatingFaculty = Array.isArray(target.participatingFaculty) ? [...target.participatingFaculty] : [];
      state.participantDocs = Array.isArray(target.participantDocuments) ? [...target.participantDocuments] : [];
      state.approvalDocs = Array.isArray(target.approvalDocuments) ? [...target.approvalDocuments] : [];
      state.deadlineManuallyEdited = true;
    }
  }

  // Initial Run
  render();

  if (state.editingEventId) {
    const past = loadCurrentUserEvents();
    const target = past.find((ev) => String(ev.id || ev.eventId) === String(state.editingEventId));
    if (target) {
      const form = document.getElementById("createEventMainForm");
      if (form) {
        if (form.eventName) form.eventName.value = target.title || target.eventName || "";
        if (form.eventSource && target.source) form.eventSource.value = target.source;
        if (form.targetYear && target.targetYear) form.targetYear.value = target.targetYear;
        if (form.eventDate) form.eventDate.value = target.date || target.dateISO || target.eventDate || "";
        if (form.timeStart && target.timeStart) form.timeStart.value = target.timeStart;
        if (form.timeEnd && target.timeEnd) form.timeEnd.value = target.timeEnd;
        if (form.venue && target.venue) form.venue.value = target.venue;
        if (form.maxCapacity && target.maxCapacity) form.maxCapacity.value = target.maxCapacity;
        if (form.weatherContingency) form.weatherContingency.value = target.weatherContingency || "";
        if (form.registrationDeadline && target.registrationDeadline) form.registrationDeadline.value = target.registrationDeadline;
        if (form.description && target.description) form.description.value = target.description;

        if (form.keyDetails) {
          if (Array.isArray(target.keyDetails) && target.keyDetails.length) {
            form.keyDetails.value = target.keyDetails.map((k) => "• " + String(k).replace(/^[•\-\*]\s*/, "")).join("\n");
          } else if (typeof target.keyDetails === "string" && target.keyDetails) {
            form.keyDetails.value = target.keyDetails;
          } else {
            form.keyDetails.value = "• ";
          }
        }

        if (form.requirements) {
          if (Array.isArray(target.requirements) && target.requirements.length) {
            form.requirements.value = target.requirements.map((r) => "• " + String(r).replace(/^[•\-\*]\s*/, "")).join("\n");
          } else if (typeof target.requirements === "string" && target.requirements) {
            form.requirements.value = target.requirements;
          } else {
            form.requirements.value = "• ";
          }
        }

        if (form.contactName) form.contactName.value = target.contactPerson?.name || target.contactName || "";
        if (form.contactEmail) form.contactEmail.value = target.contactPerson?.email || target.contactEmail || "";
        if (form.contactPhone) {
          const ph = target.contactPerson?.phone || target.contactPhone || "";
          form.contactPhone.value = ph.startsWith("09") ? ph.slice(0, 11) : "09";
        }

        checkVenueCapacityHint();
        updateAllReadinessChecks();
        updateLivePreview();
        updateDescCounter();
      }
    }
  }
})();
