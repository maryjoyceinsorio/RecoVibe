(() => {
  const monthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const rawEvents = Array.isArray(window.RECOVIBE_EVENTS)
    ? [...window.RECOVIBE_EVENTS]
    : [];
  const events = rawEvents.reduce((list, event) => {
    const uniqueKey = event.id || event.eventId;
    if (
      !uniqueKey ||
      list.some((item) => String(item.id || item.eventId) === String(uniqueKey))
    )
      return list;
    list.push(event);
    return list;
  }, []);

  const filterInputs = document.querySelectorAll(".filter-option input");
  const state = {
    date: new Date(),
    view: "month",
  };
  const monthSelect = document.getElementById("calMonthSelect");
  const yearSelect = document.getElementById("calYearSelect");
  const calendarDays = document.getElementById("calFullDays");
  const calendarListView = document.getElementById("calendarListView");
  const modal = document.getElementById("organizerModalOverlay");
  const dayModal = document.getElementById("organizerDayOverlay");
  const upcomingPanel = document.querySelector(".upcoming-panel");
  const todayButton = document.querySelector(".cal-toggle");
  const monthModeButton = document.getElementById("calendarMonthMode");
  const listModeButton = document.getElementById("calendarListMode");
  const resetButton = document.querySelector(".filter-reset");

  const toDate = (value) => {
    if (!value) return null;
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const escape = (value) =>
    String(value ?? "").replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );

  function eventSource(event) {
    const source = event.source || "PUP Biñan Campus";
    if (source === "Event Organizer") return "Others/External";
    return (
      {
        "PUP Biñan": "PUP Biñan Campus",
        "Teachers / Faculty": "Teachers/Faculty",
        "Other / External": "Others/External",
      }[source] || source
    );
  }

  function visibleEvents() {
    const checked = [...filterInputs]
      .filter((input) => input.checked)
      .map((input) => input.dataset.source);
    return events.filter((event) => checked.includes(eventSource(event)));
  }

  function buildUpcomingList() {
    if (!upcomingPanel) return;

    const now = new Date();
    const upcoming = visibleEvents()
      .filter((event) => {
        const date = toDate(event.dateISO || event.date);
        return (
          date &&
          date >= new Date(now.getFullYear(), now.getMonth(), now.getDate())
        );
      })
      .sort((a, b) =>
        String(a.dateISO || "").localeCompare(String(b.dateISO || "")),
      )
      .slice(0, 5);

    if (!upcoming.length) {
      upcomingPanel.innerHTML =
        '<h3>Upcoming</h3><div class="upcoming-empty">No upcoming events.</div>';
      return;
    }

    upcomingPanel.innerHTML = [
      "<h3>Upcoming</h3>",
      ...upcoming.map((event) => {
        const date = toDate(event.dateISO || event.date);
        const month = date
          ? date.toLocaleDateString("en-US", { month: "short" }).toUpperCase()
          : "TBA";
        const day = date ? date.getDate() : "";
        const sourceLabel = event.source || "PUP Biñan Campus";
        return `
          <div class="upcoming-item" data-event-id="${escape(event.id || event.eventId || "")}" tabindex="0" role="button">
            <div class="upcoming-date"><span>${day}</span><small>${month}</small></div>
            <div class="upcoming-copy">
              <strong>${escape(event.title || "Untitled event")}</strong>
              <span>${escape(sourceLabel)}</span>
            </div>
          </div>
        `;
      }),
    ].join("");
  }

  function renderCalendar() {
    const year = state.date.getFullYear();
    const month = state.date.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const totalDays = new Date(year, month + 1, 0).getDate();

    renderYearOptions();
    monthSelect.value = String(month);
    yearSelect.value = String(year);

    const visible = visibleEvents();
    const cells = [];

    for (let index = 0; index < firstDay; index += 1) {
      cells.push({ day: "", iso: "", muted: true, events: [] });
    }

    for (let day = 1; day <= totalDays; day += 1) {
      const iso = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      cells.push({
        day,
        iso,
        muted: false,
        events: visible.filter(
          (event) => (event.dateISO || event.date) === iso,
        ),
      });
    }

    while (cells.length % 7 !== 0) {
      cells.push({ day: "", iso: "", muted: true, events: [] });
    }

    calendarDays.innerHTML = cells
      .map((cell) => {
        const currentDate = new Date();
        const todayIso = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, "0")}-${String(currentDate.getDate()).padStart(2, "0")}`;
        const today = cell.iso && cell.iso === todayIso;
        const eventCount =
          cell.events && cell.events.length ? cell.events.length : 0;
        return `
        <div class="cal-day-full ${cell.muted ? "is-muted" : ""} ${eventCount ? "has-event" : ""} ${today ? "is-today" : ""}" ${cell.iso ? `data-iso="${cell.iso}" tabindex="0"` : ""}>
          <span class="day-num">${cell.day || ""}</span>
          ${
            cell.events && cell.events.length
              ? `<span class="calendar-hover-preview"><strong>${eventCount} event${eventCount > 1 ? "s" : ""}</strong>${cell.events
                  .slice(0, 3)
                  .map(
                    (event) =>
                      `<span class="calendar-hover-event"><b>${escape(event.title || "Untitled event")}</b><small>${escape(event.time || "Time TBA")}</small></span>`,
                  )
                  .join("")}</span>`
              : ""
          }
        </div>
      `;
      })
      .join("");

    renderListView();
    buildUpcomingList();
  }

  function renderListView() {
    const year = state.date.getFullYear();
    const month = state.date.getMonth();
    const monthEvents = visibleEvents()
      .filter((event) => {
        const date = toDate(event.dateISO || event.date);
        return date && date.getFullYear() === year && date.getMonth() === month;
      })
      .sort((first, second) =>
        String(first.dateISO || "").localeCompare(String(second.dateISO || "")),
      );

    calendarListView.innerHTML = monthEvents.length
      ? monthEvents
          .map((event) => {
            const date = toDate(event.dateISO || event.date);
            const source = eventSource(event);
            const dateLabel = date.toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            });
            return `<button class="calendar-list-event" type="button" data-event-id="${escape(event.id || event.eventId)}"><span class="calendar-list-event-date">${dateLabel}</span><span class="calendar-list-event-copy"><strong>${escape(event.title || "Untitled event")}</strong><small>${escape(event.time || "Time TBA")} · ${escape(source)}</small></span></button>`;
          })
          .join("")
      : '<div class="calendar-list-empty">No events for this month.</div>';
  }

  function openEventModal(eventId) {
    const event = events.find(
      (item) => String(item.id || item.eventId) === String(eventId),
    );
    if (!event) return;
    window.RecovibeStudentEventDetails?.open(event);
  }

  function closeModal() {
    if (modal) modal.classList.remove("is-open");
  }

  function openDay(iso) {
    const dayEvents = visibleEvents().filter(
      (event) => (event.dateISO || event.date) === iso,
    );
    if (!dayEvents.length) return;

    if (dayEvents.length === 1) {
      openEventModal(dayEvents[0].id || dayEvents[0].eventId);
      return;
    }

    const dayTitle = document.getElementById("organizerDayTitle");
    const dayList = document.getElementById("organizerDayList");
    const date = toDate(iso);

    dayTitle.textContent = date
      ? date.toLocaleDateString("en-US", {
          month: "long",
          day: "numeric",
          year: "numeric",
        })
      : iso;
    dayList.innerHTML = dayEvents
      .map(
        (event) =>
          `<button class="day-modal-row" type="button" data-event-id="${event.id || event.eventId}"><strong>${escape(event.title || "Untitled event")}</strong><small>${escape(event.time || "Time TBA")}</small></button>`,
      )
      .join("");
    dayModal.classList.add("is-open");
  }

  function renderYearOptions() {
    const currentYear = state.date.getFullYear();
    const years = Array.from(
      { length: 21 },
      (_, index) => currentYear - 10 + index,
    );
    yearSelect.innerHTML = years
      .map((year) => `<option value="${year}">${year}</option>`)
      .join("");
  }

  function setCalendarMonth(year, month) {
    const day = Math.min(
      state.date.getDate(),
      new Date(year, month + 1, 0).getDate(),
    );
    state.date = new Date(year, month, day);
    renderCalendar();
  }

  function setView(view) {
    state.view = view;
    const isList = view === "list";
    document
      .querySelector(".calendar-page")
      .classList.toggle("is-list-view", isList);
    document.querySelector(".cal-grid--dow").hidden = isList;
    calendarDays.hidden = isList;
    calendarListView.hidden = !isList;
    monthModeButton.classList.toggle("is-active", !isList);
    listModeButton.classList.toggle("is-active", isList);
    monthModeButton.setAttribute("aria-pressed", String(!isList));
    listModeButton.setAttribute("aria-pressed", String(isList));
    renderCalendar();
  }

  function bindCalendarInteractions() {
    calendarDays.addEventListener("click", (event) => {
      const cell = event.target.closest("[data-iso]");
      if (!cell) return;
      openDay(cell.dataset.iso);
    });

    calendarDays.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        const cell = event.target.closest("[data-iso]");
        if (cell) {
          event.preventDefault();
          openDay(cell.dataset.iso);
        }
      }
    });

    upcomingPanel.addEventListener("click", (event) => {
      const item = event.target.closest("[data-event-id]");
      if (!item) return;
      openEventModal(item.dataset.eventId);
    });

    upcomingPanel.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        const item = event.target.closest("[data-event-id]");
        if (item) {
          event.preventDefault();
          openEventModal(item.dataset.eventId);
        }
      }
    });

    document
      .getElementById("organizerDayList")
      .addEventListener("click", (event) => {
        const button = event.target.closest("[data-event-id]");
        if (!button) return;
        openEventModal(button.dataset.eventId);
        if (dayModal) dayModal.classList.remove("is-open");
      });

    document
      .getElementById("organizerModalClose")
      .addEventListener("click", closeModal);
    document
      .getElementById("organizerDayClose")
      .addEventListener("click", () => {
        if (dayModal) dayModal.classList.remove("is-open");
      });

    if (modal) {
      modal.addEventListener("click", (event) => {
        if (event.target === modal) closeModal();
      });
    }

    if (dayModal) {
      dayModal.addEventListener("click", (event) => {
        if (event.target === dayModal) dayModal.classList.remove("is-open");
      });
    }

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeModal();
        if (dayModal) dayModal.classList.remove("is-open");
      }
    });

    document
      .getElementById("organizerModalEdit")
      .addEventListener("click", (event) => {
        event.preventDefault();
        const eventId = document
          .getElementById("organizerModalEdit")
          .getAttribute("data-event-id");
        if (!eventId) return;
        const selectedEvent = events.find(
          (item) => String(item.id || item.eventId) === String(eventId),
        );
        if (selectedEvent) window.RecovibeEventDetails?.open(selectedEvent);
      });
  }

  monthSelect.innerHTML = monthNames
    .map((month, index) => `<option value="${index}">${month}</option>`)
    .join("");
  renderYearOptions();
  window.enhanceDropdownSelects?.("#calMonthSelect, #calYearSelect");

  monthSelect.addEventListener("change", () => {
    setCalendarMonth(state.date.getFullYear(), Number(monthSelect.value));
  });

  yearSelect.addEventListener("change", () => {
    setCalendarMonth(Number(yearSelect.value), state.date.getMonth());
  });

  document.getElementById("calFullPrev").addEventListener("click", () => {
    setCalendarMonth(state.date.getFullYear(), state.date.getMonth() - 1);
  });

  document.getElementById("calFullNext").addEventListener("click", () => {
    setCalendarMonth(state.date.getFullYear(), state.date.getMonth() + 1);
  });

  todayButton.addEventListener("click", () => {
    state.date = new Date();
    renderCalendar();
  });

  monthModeButton.addEventListener("click", () => setView("month"));
  listModeButton.addEventListener("click", () => setView("list"));

  filterInputs.forEach((input) => {
    input.addEventListener("change", () => {
      renderCalendar();
    });
  });

  calendarListView.addEventListener("click", (event) => {
    const button = event.target.closest("[data-event-id]");
    if (button) openEventModal(button.dataset.eventId);
  });

  resetButton.addEventListener("click", () => {
    filterInputs.forEach((input) => {
      input.checked = true;
    });
    renderCalendar();
  });

  bindCalendarInteractions();
  document.addEventListener("recovibeParticipationChanged", (event) => {
    const changed = events.find(
      (item) =>
        String(item.id || item.eventId) === String(event.detail.eventId),
    );
    if (changed) changed.slotsOpen = event.detail.slotsOpen;
    renderCalendar();
  });
  window.addEventListener("storage", (event) => {
    if (
      event.key !== "recovibeParticipations" &&
      event.key !== "recovibeEventSlots"
    )
      return;
    const savedSlots = (() => {
      try {
        return JSON.parse(localStorage.getItem("recovibeEventSlots") || "{}");
      } catch (error) {
        return {};
      }
    })();
    events.forEach((item) => {
      const id = String(item.id || item.eventId);
      if (savedSlots[id] !== undefined) item.slotsOpen = savedSlots[id];
    });
    renderCalendar();
  });
  renderCalendar();
})();
