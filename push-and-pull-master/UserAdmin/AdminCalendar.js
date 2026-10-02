(() => {
  "use strict";
  const profile = read("recovibeAdminProfile", null),
    identity = localStorage.getItem("recovibeAdminId");
  if (
    !profile ||
    String(profile.role || "").toLowerCase() !== "admin" ||
    !identity
  ) {
    location.replace("AdminLogin.html");
    return;
  }
  const root = document.getElementById("calendarRoot"),
    host = document.getElementById("calendarModalHost"),
    today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Manila",
    }).format(new Date());
  let viewed = new Date(),
    activePopup = null;
  document.querySelector("[data-name]").textContent = (
    profile.name || identity
  ).toUpperCase();
  document.querySelector("[data-avatar]").textContent = (profile.name || "HA")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  document.querySelector("[data-role]").textContent =
    "Head of Academic Programs";
  document.querySelector("[data-today]").textContent =
    new Date().toLocaleDateString("en-US", {
      timeZone: "Asia/Manila",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  document.querySelector(".admin-logout").onclick = () =>
    localStorage.removeItem("recovibeAdminId");
  function read(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || "null") ?? fallback;
    } catch {
      return fallback;
    }
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
        })[ch],
    );
  }
  function stageVisible(event) {
    const status = String(event.status || "")
      .toLowerCase()
      .replace(/[ _-]+/g, " ");
    return (
      [
        "awaiting final documents",
        "final documents submitted",
        "ready to publish",
        "approved",
        "published",
        "cancelled",
        "canceled",
        "completed",
      ].includes(status) || event.published === true
    );
  }
  function allEvents() {
    const saved = ["recovibeTeacherEvents", "recovibeOrganizerEvents"].flatMap(
      (key) => {
        const list = read(key, []);
        return Array.isArray(list) ? list : [];
      },
    );
    const source = Array.isArray(window.RECOVIBE_EVENTS)
      ? window.RECOVIBE_EVENTS
      : [];
    const seen = new Set();
    return [...saved, ...source].filter((event) => {
      const id = String(event.eventId || event.id || "");
      if (
        !id ||
        seen.has(id) ||
        !stageVisible(event) ||
        ["cancelled", "canceled"].includes(
          String(event.status || "").toLowerCase(),
        )
      )
        return false;
      seen.add(id);
      return true;
    });
  }
  function sourceName(event) {
    const value = String(
      event.source || event.organizerName || "Others / External",
    );
    if (value === "PUP Biñan Campus") return "PUP Biñan";
    if (value === "Teacher / Faculty" || value === "Teachers/Faculty")
      return "Teachers / Faculty";
    if (value === "Event Organizer" || value === "Organizational")
      return "Organizational";
    return value;
  }
  function dateOf(event) {
    return String(event.dateISO || event.date || "").slice(0, 10);
  }
  function render() {
    try {
      const year = viewed.getFullYear(),
        month = viewed.getMonth(),
        first = new Date(year, month, 1),
        offset = first.getDay(),
        days = new Date(year, month + 1, 0).getDate(),
        last = new Date(year, month + 1, 0).getDay(),
        events = allEvents();
      let cells = "";
      for (let index = 0; index < offset; index++) {
        const day = new Date(year, month, 0).getDate() - offset + index + 1;
        cells += cell(day, "muted", "");
      }
      for (let day = 1; day <= days; day++) {
        const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
          dayEvents = events.filter((event) => dateOf(event) === iso);
        cells += cell(
          day,
          iso === today ? "today" : "",
          iso,
          dayEvents.length,
        );
      }
      for (let day = 1; day < 7 - last; day++) cells += cell(day, "muted", "");
      root.innerHTML = `<section class="admin-calendar"><div class="admin-calendar-toolbar"><button type="button" id="previousMonth" aria-label="Previous month">‹</button><strong class="admin-month-label">${viewed.toLocaleDateString("en-US", { timeZone: "Asia/Manila", month: "long", year: "numeric" })}</strong><div><button type="button" id="goToday">Today</button> <button type="button" id="nextMonth" aria-label="Next month">›</button></div></div><div class="admin-weekdays"><span>S</span><span>M</span><span>T</span><span>W</span><span>Th</span><span>F</span><span>S</span></div><div class="admin-month-grid">${cells}</div></section>`;
      root.querySelector("#previousMonth").onclick = () => move(-1);
      root.querySelector("#nextMonth").onclick = () => move(1);
      root.querySelector("#goToday").onclick = () => {
        viewed = new Date();
        render();
      };
      root
        .querySelectorAll("[data-iso]")
        .forEach(
          (button) => (button.onclick = () => openDay(button.dataset.iso)),
        );
    } catch (error) {
      root.innerHTML =
        '<div class="admin-error">Could not load calendar. <button id="retryCalendar" class="admin-row-action">Retry</button></div>';
      root.querySelector("#retryCalendar").onclick = render;
    }
  }
  function cell(day, klass, iso, count = 0) {
    return `<div class="admin-day ${klass}" ${iso ? `data-iso="${iso}"` : ""}><button type="button" ${iso ? `aria-label="${iso}, ${count} events"` : ""}>${day}</button></div>`;
  }
  function move(amount) {
    viewed = new Date(viewed.getFullYear(), viewed.getMonth() + amount, 1);
    render();
  }
  function openDay(iso) {
    const events = allEvents().filter((event) => dateOf(event) === iso);
    if (!events.length) return;
    const date = new Date(`${iso}T00:00:00`);
    const overlay = document.createElement("div");
    overlay.className = "admin-day-overlay";
    overlay.innerHTML = `<section class="admin-day-dialog" role="dialog" aria-modal="true" aria-labelledby="adminDayTitle" tabindex="-1"><button type="button" class="admin-close" aria-label="Close day details">×</button><h2 id="adminDayTitle">${date.toLocaleDateString("en-US", { timeZone: "Asia/Manila", month: "long", day: "numeric", year: "numeric" })}</h2><div class="admin-day-list">${events
      .map((event) => {
        const source = sourceName(event),
          time =
            event.time || `${event.startTime || ""} - ${event.endTime || ""}`,
          id = event.eventId || event.id,
          count = participants(id);
        return `<article class="admin-day-card" style="--event-source:${color(source)}"><strong>${esc(event.title || "Untitled event")}</strong><small>${esc(source)} · ${esc(date.toLocaleDateString("en-US", { month: "short", day: "numeric" }))}</small><p>${esc(time)}</p><p>${esc(event.venueOther || event.location || event.venue || "Venue to be announced")}</p><span class="admin-chip">${esc(source)}</span><p class="day-desc">${esc(event.description || event.desc || "")}</p><hr><small>${count} Students Participating</small><button type="button" data-details="${esc(id)}">View Details</button></article>`;
      })
      .join("")}</div></section>`;
    host.append(overlay);
    activePopup = overlay;
    document.body.style.overflow = "hidden";
    overlay.querySelector(".admin-close").onclick = closePopup;
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closePopup();
    });
    overlay.querySelectorAll("[data-details]").forEach(
      (button) =>
        (button.onclick = () => {
          const event = events.find(
            (item) =>
              String(item.eventId || item.id) === button.dataset.details,
          );
          closePopup();
          window.RecovibeEventDetails?.open(event);
        }),
    );
    overlay.querySelector(".admin-day-dialog").focus();
  }
  function color(source) {
    return (
      {
        "PUP Official": "#6b1220",
        "PUP Biñan": "#3a76a6",
        "PUP CITE": "#d6ae4a",
        Organizational: "#765092",
        CSC: "#31845b",
        "Teachers / Faculty": "#c64a52",
        "Others / External": "#8c8787",
      }[source] || "#8c8787"
    );
  }
  function participants(id) {
    const event = allEvents().find(
      (item) => String(item.eventId || item.id) === String(id),
    );
    if (!event || event.capacityMode === "N/A") return 0;
    const capacity = Number(
      event.maxCapacity ?? event.capacity ?? event.maxSlots,
    );
    const open = Number(
      event.openSlots ??
        event.slotsOpen ??
        event.availableSlots ??
        event.slots ??
        capacity,
    );
    return Number.isFinite(capacity) && Number.isFinite(open)
      ? Math.max(0, capacity - open)
      : 0;
  }
  function closePopup() {
    if (!activePopup) return;
    activePopup.remove();
    activePopup = null;
    document.body.style.overflow = "";
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activePopup) closePopup();
  });
  window.addEventListener("storage", (event) => {
    if (!event.key || event.key.includes("Events")) render();
  });
  window.addEventListener("focus", render);
  render();
})();
