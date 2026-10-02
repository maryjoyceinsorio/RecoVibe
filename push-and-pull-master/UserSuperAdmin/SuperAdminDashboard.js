import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, isFirebaseConfigured } from "../UserStudent/firebaseConfig.js";

(() => {
  "use strict";

  const tables = [
    {
      table: document.getElementById("recent-audit-table"),
      tbody: document.getElementById("recent-audit-tbody"),
      limit: 8,
    },
    {
      table: document.getElementById("audit-activity-table"),
      tbody: document.getElementById("audit-activity-rows"),
      limit: 0,
    },
  ].filter((entry) => entry.table && entry.tbody);
  const modal =
    document.getElementById("audit-modal-backdrop") ||
    document.getElementById("audit-detail-modal");
  const viewEventLink = document.getElementById("audit-view-event");
  const payloadElement = document.getElementById("audit-detail-payload");
  const recordsById = new Map();
  const fieldIds = {
    action: "audit-detail-action",
    performedBy: "audit-detail-performed-by",
    dateTime: "audit-detail-date-time",
    eventName: "audit-detail-event",
    organizer: "audit-detail-organizer",
    previousStatus: "audit-detail-previous-status",
    newStatus: "audit-detail-new-status",
    details: "audit-detail-description",
  };

  function dateFrom(value) {
    if (value?.toDate) return value.toDate();
    const date = value ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  }

  function formatRowTimestamp(value) {
    const date = dateFrom(value);
    if (!date) return { date: "Date unavailable", time: "" };
    return {
      date: new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila",
        month: "2-digit",
        day: "2-digit",
        year: "2-digit",
      }).format(date),
      time: new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Manila",
        hour: "numeric",
        minute: "2-digit",
      }).format(date),
    };
  }

  function formatDetailTimestamp(value) {
    const date = dateFrom(value);
    if (!date) return "Date unavailable";
    const dateLabel = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      month: "long",
      day: "numeric",
      year: "numeric",
    }).format(date);
    const timeLabel = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Manila",
      hour: "numeric",
      minute: "2-digit",
    }).format(date);
    return `${dateLabel} — ${timeLabel}`;
  }

  function normalizeRecord(documentSnapshot) {
    const data = documentSnapshot.data();
    const user = data.user || data.actorName || data.performedBy || "System";
    const action = data.action || data.actionHeader || "Activity recorded";
    const isUserAction = data.category === "User Management";
    return {
      ...data,
      rawData: data,
      id: documentSnapshot.id,
      user,
      action,
      actionHeader: data.actionHeader || action,
      performedBy: data.user || data.performedBy || data.actorName || user,
      timestamp: data.timestamp || data.createdAt || null,
      eventName: isUserAction ? "Not applicable" : data.eventName || "Not applicable",
      organizer: isUserAction
        ? "Not applicable"
        : data.organizer || data.organization || "Not applicable",
      previousStatus: data.previousStatus || "Not applicable",
      newStatus: data.newStatus || "Not applicable",
      details: data.details || action,
      hasEvent: !isUserAction && Boolean(data.eventId || data.eventName),
    };
  }

  function appendCell(row, label, content) {
    const cell = document.createElement("td");
    cell.dataset.label = label;
    cell.append(content);
    row.append(cell);
  }

  function renderTable({ tbody, limit }, records) {
    tbody.replaceChildren();
    const visibleRecords = limit ? records.slice(0, limit) : records;
    if (!visibleRecords.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.className = "user-table-empty";
      cell.colSpan = 4;
      cell.textContent = "No audit activity yet.";
      row.append(cell);
      tbody.append(row);
      return;
    }

    visibleRecords.forEach((record) => {
      const row = document.createElement("tr");
      row.id = `audit-row-${record.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      row.dataset.auditId = record.id;
      row.tabIndex = 0;

      const timestamp = document.createElement("time");
      const date = dateFrom(record.timestamp);
      if (date) timestamp.dateTime = date.toISOString();
      const labels = formatRowTimestamp(record.timestamp);
      const dateText = document.createElement("strong");
      dateText.textContent = labels.date;
      const timeText = document.createElement("span");
      timeText.textContent = labels.time;
      timestamp.append(dateText, timeText);
      appendCell(row, "Timestamp", timestamp);

      const user = document.createElement("strong");
      user.textContent = record.user;
      appendCell(row, "User", user);
      const action = document.createElement("span");
      action.textContent = record.action;
      appendCell(row, "Action", action);

      const arrow = document.createElement("button");
      arrow.className = "audit-detail-button";
      arrow.type = "button";
      arrow.setAttribute("aria-label", `View audit record by ${record.user}`);
      const icon = document.createElement("span");
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = "▶";
      arrow.append(icon);
      const actionCell = document.createElement("td");
      actionCell.className = "audit-action-cell";
      actionCell.append(arrow);
      row.append(actionCell);
      tbody.append(row);
    });
  }

  function showRecord(record) {
    const modalTitle = document.getElementById("audit-modal-title");
    if (modalTitle) {
      modalTitle.textContent = `${record.user} → ${record.actionHeader}`;
    }
    Object.entries(fieldIds).forEach(([field, id]) => {
      const element = document.getElementById(id);
      if (element) {
        element.textContent =
          field === "dateTime"
            ? formatDetailTimestamp(record.timestamp)
            : record[field] || "Not available";
      }
    });
    if (payloadElement) {
      payloadElement.textContent = JSON.stringify(record.rawData || record, null, 2);
      payloadElement.hidden = false;
    }

    if (viewEventLink) {
      viewEventLink.href = record.hasEvent
        ? `../UserAdmin/AdminAllEvents.html?q=${encodeURIComponent(record.eventName)}`
        : "#";
      viewEventLink.setAttribute("aria-disabled", String(!record.hasEvent));
      viewEventLink.tabIndex = record.hasEvent ? 0 : -1;
      viewEventLink.classList.toggle("is-disabled", !record.hasEvent);
    }
    if (modal?.showModal) modal.showModal();
  }

  function resetModal() {
    const modalTitle = document.getElementById("audit-modal-title");
    if (modalTitle) modalTitle.textContent = "Audit Activity Details";
    Object.values(fieldIds).forEach((id) => {
      const element = document.getElementById(id);
      if (element) element.textContent = "";
    });
    if (payloadElement) {
      payloadElement.textContent = "";
      payloadElement.hidden = true;
    }
    if (viewEventLink) {
      viewEventLink.href = "#";
      viewEventLink.setAttribute("aria-disabled", "true");
      viewEventLink.tabIndex = -1;
      viewEventLink.classList.add("is-disabled");
    }
  }

  function setDashboardDate() {
    const dateElement = document.getElementById("dashboard-today-date");
    if (!dateElement) return;
    const now = new Date();
    const dateText = dateElement.querySelector("span");
    if (dateText) {
      dateText.textContent = new Intl.DateTimeFormat("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }).format(now);
    }
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    dateElement.dateTime = `${year}-${month}-${day}`;
  }

  function greetingForCurrentHour() {
    const hour = new Date().getHours();
    return hour < 12
      ? "Good Morning"
      : hour < 17
        ? "Good Afternoon"
        : "Good Evening";
  }

  function nameInitials(name) {
    const nameParts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!nameParts.length) return "SA";
    if (nameParts.length === 1) return nameParts[0].slice(0, 2).toUpperCase();
    return `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase();
  }

  function fullNameFromProfile(profile, user) {
    const firstLastName = [profile.firstName, profile.middleName, profile.lastName]
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(" ");
    return String(
      profile.fullName ||
      firstLastName ||
      profile.name ||
      profile.displayName ||
      user.displayName ||
      user.email ||
      "Super Admin",
    );
  }

  function renderAuthenticatedProfile(profile, user) {
    const fullName = fullNameFromProfile(profile, user);
    const lastName =
      String(profile.lastName || "").trim() || fullName.trim().split(/\s+/).at(-1);
    const role = String(profile.role || profile.userRole || "Super Admin").trim();
    const greeting = document.getElementById("dashboard-greeting");
    const sidebarName = document.getElementById("sidebar-user-name");
    const sidebarRole = document.getElementById("sidebar-user-role");
    const sidebarAvatar = document.getElementById("sidebar-user-avatar");

    if (greeting) greeting.textContent = `${greetingForCurrentHour()}, ${lastName}!`;
    if (sidebarName) sidebarName.textContent = fullName;
    if (sidebarRole) sidebarRole.textContent = role;
    if (sidebarAvatar) sidebarAvatar.textContent = nameInitials(fullName);
  }

  function updateUserMetrics(snapshot) {
    const users = snapshot.docs.map((documentSnapshot) => documentSnapshot.data());
    const activeCount = users.filter(
      (user) => user.status === "Active" || user.isActive === true,
    ).length;
    const adminCount = users.filter((user) =>
      String(user.role || "").toLowerCase().includes("admin"),
    ).length;
    const teacherOrganizerCount = users.filter((user) =>
      /teacher|organizer|\beo\b/i.test(String(user.role || "")),
    ).length;
    const metrics = [
      ["#metric-total-users", snapshot.size],
      ["#metric-active-users", activeCount],
      ["#metric-total-admins", adminCount],
      ["#metric-total-teachers-eo", teacherOrganizerCount],
    ];

    metrics.forEach(([selector, value]) => {
      const valueElement = document.querySelector(`${selector} .metric-value`);
      if (valueElement) valueElement.textContent = value.toLocaleString();
    });
  }

  function renderTableError(table, message) {
    if (!table?.tbody) return;
    console.info(`[SuperAdminDashboard] ${message}; retaining static audit rows.`);
  }

  try {
  setDashboardDate();

  tables.forEach(({ table }) => {
    table.addEventListener("click", (event) => {
      const row = event.target.closest("tr[data-audit-id]");
      if (!row || !table.contains(row)) return;
      const record = recordsById.get(row.dataset.auditId);
      if (record) showRecord(record);
    });
    table.addEventListener("keydown", (event) => {
      if (
        !event.target.matches("tr[data-audit-id]") ||
        !["Enter", " "].includes(event.key)
      ) {
        return;
      }
      event.preventDefault();
      const record = recordsById.get(event.target.dataset.auditId);
      if (record) showRecord(record);
    });
  });

  if (modal) {
    document
      .getElementById("audit-close-modal")
      ?.addEventListener("click", () => modal.close());
    modal.addEventListener("click", (event) => {
      if (event.target === modal) modal.close();
    });
    modal.addEventListener("close", resetModal);
    viewEventLink?.addEventListener("click", (event) => {
      if (viewEventLink.getAttribute("aria-disabled") === "true") event.preventDefault();
    });
  }

  if (!isFirebaseConfigured || !db) {
    console.info("[SuperAdminDashboard] Firebase unavailable; retaining static dashboard content.");
    return;
  }

  const unsubscribers = [];
  window.addEventListener("superadmin-profile-authorized", (event) => {
    const { profile, user } = event.detail || {};
    if (profile && user) renderAuthenticatedProfile(profile, user);
  });

  const recentTable = tables.find(({ table }) => table.id === "recent-audit-table");
  const allAuditTable = tables.find(
    ({ table }) => table.id === "audit-activity-table",
  );

  if (document.getElementById("metric-total-users")) {
    unsubscribers.push(
      onSnapshot(
        collection(db, "studentUser"),
        updateUserMetrics,
        (error) => {
          console.info("[SuperAdminDashboard] Metrics listener failed; retaining static values.", error);
        },
      ),
    );
  }

  if (recentTable) {
    unsubscribers.push(
      onSnapshot(
        query(
          collection(db, "audit_logs"),
          orderBy("timestamp", "desc"),
          limit(8),
        ),
        (snapshot) => {
          const records = snapshot.docs.map(normalizeRecord);
          recordsById.clear();
          records.forEach((record) => recordsById.set(record.id, record));
          renderTable(recentTable, records);
        },
        (error) => {
          console.info("[SuperAdminDashboard] Recent audit listener failed.", error);
          renderTableError(recentTable, "Could not load recent audit activity.");
        },
      ),
    );
  }

  if (allAuditTable) {
    unsubscribers.push(
      onSnapshot(
        query(collection(db, "audit_logs"), orderBy("timestamp", "desc")),
        (snapshot) => {
          const records = snapshot.docs.map(normalizeRecord);
          recordsById.clear();
          records.forEach((record) => recordsById.set(record.id, record));
          renderTable(allAuditTable, records);
        },
        (error) => {
          console.info("[SuperAdminDashboard] Audit log listener failed.", error);
          renderTableError(allAuditTable, "Could not load audit activity.");
        },
      ),
    );
  }

  window.addEventListener(
    "beforeunload",
    () => unsubscribers.forEach((unsubscribe) => unsubscribe()),
    { once: true },
  );
  } catch (error) {
    console.info("[SuperAdminDashboard] Initialization failed; static UI remains mounted.", error);
  }
})();
