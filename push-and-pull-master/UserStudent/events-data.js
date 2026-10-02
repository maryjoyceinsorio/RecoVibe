window.enhanceDropdownSelects =
  window.enhanceDropdownSelects ||
  function (selector) {
    const selects = [...document.querySelectorAll(selector)].filter(
      (select) => !select.dataset.dropdownEnhanced,
    );
    const wrappers = [];

    function closeMenus(except) {
      wrappers.forEach(({ wrapper, button, menu }) => {
        if (wrapper === except) return;
        menu.classList.remove("show");
        button.setAttribute("aria-expanded", "false");
      });
    }

    selects.forEach((select) => {
      const wrapper = document.createElement("div");
      const button = document.createElement("button");
      const menu = document.createElement("div");
      const menuId = `${select.id || "dropdown"}Menu`;
      const originalStyle = getComputedStyle(select);
      wrapper.className =
        `filter-dropdown native-filter-dropdown ${select.classList.contains("cal-select") ? "cal-filter-dropdown" : ""} ${select.classList.contains("cal-year-select") ? "year-filter-dropdown" : ""}`.trim();
      button.className = "filter-button";
      button.type = "button";
      button.id = `${menuId}Button`;
      button.setAttribute("aria-haspopup", "listbox");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute(
        "aria-label",
        select.getAttribute("aria-label") ||
          select.labels?.[0]?.textContent.trim() ||
          "Choose an option",
      );
      button.setAttribute("aria-controls", menuId);
      const associatedLabel = select.labels?.[0];
      if (associatedLabel) {
        if (!associatedLabel.id) associatedLabel.id = `${menuId}Label`;
        button.setAttribute("aria-labelledby", associatedLabel.id);
      }
      button.style.minWidth = originalStyle.minWidth;
      menu.className = "filter-menu";
      menu.id = menuId;
      menu.setAttribute("role", "listbox");
      menu.setAttribute("aria-labelledby", button.id);

      function syncOptions() {
        const selected = select.options[select.selectedIndex];
        button.childNodes[0]?.remove();
        button.insertBefore(
          document.createTextNode(selected ? selected.textContent.trim() : ""),
          button.firstChild,
        );
        menu.replaceChildren();
        if (select.getAttribute("aria-invalid") === "true")
          button.setAttribute("aria-invalid", "true");
        else button.removeAttribute("aria-invalid");
        [...select.options].forEach((option) => {
          const item = document.createElement("button");
          item.className = `filter-option${option.selected ? " active" : ""}`;
          item.type = "button";
          item.disabled = option.disabled;
          item.setAttribute("role", "option");
          item.setAttribute("aria-selected", String(option.selected));
          item.dataset.value = option.value;
          item.textContent = option.textContent.trim();
          menu.appendChild(item);
        });
      }

      syncOptions();
      select.dataset.dropdownEnhanced = "true";
      select.hidden = true;
      select.setAttribute("aria-hidden", "true");
      select.tabIndex = -1;
      if (select.parentElement.matches(".my-events-filter"))
        select.parentElement.classList.add("native-filter-parent");
      select.parentNode.insertBefore(wrapper, select);
      wrapper.append(button, menu, select);
      wrappers.push({ wrapper, button, menu });
      associatedLabel?.addEventListener("click", (event) => {
        if (event.target.closest(".native-filter-dropdown")) return;
        event.preventDefault();
        button.focus();
      });
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        const wasOpen = menu.classList.contains("show");
        closeMenus();
        if (!wasOpen) {
          menu.classList.add("show");
          button.setAttribute("aria-expanded", "true");
        }
      });
      menu.addEventListener("click", (event) => {
        const item = event.target.closest(".filter-option");
        if (!item || item.disabled) return;
        event.stopPropagation();
        select.value = item.dataset.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        syncOptions();
        closeMenus();
        button.focus();
      });
      select.addEventListener("change", syncOptions);
      new MutationObserver(syncOptions).observe(select, {
        childList: true,
        attributes: true,
        attributeFilter: ["aria-invalid"],
      });
    });

    if (!window.dropdownMenusCloseHandler) {
      window.dropdownMenusCloseHandler = true;
      document.addEventListener("click", (event) => {
        if (event.target.closest(".native-filter-dropdown")) return;
        document
          .querySelectorAll(".native-filter-dropdown .filter-menu.show")
          .forEach((menu) => menu.classList.remove("show"));
        document
          .querySelectorAll(
            '.native-filter-dropdown .filter-button[aria-expanded="true"]',
          )
          .forEach((button) => button.setAttribute("aria-expanded", "false"));
      });
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        document
          .querySelectorAll(".native-filter-dropdown .filter-menu.show")
          .forEach((menu) => menu.classList.remove("show"));
        document
          .querySelectorAll(
            '.native-filter-dropdown .filter-button[aria-expanded="true"]',
          )
          .forEach((button) => button.setAttribute("aria-expanded", "false"));
      });
    }
  };

window.RECOVIBE_EVENTS = [
  {
    id: "leadership-seminar",
    dateISO: "2026-09-11",
    month: "SEP",
    day: 11,
    title: "PUP Biñan Leadership Seminar",
    location: "PUP Biñan Campus",
    time: "1:00 PM - 4:00 PM",
    room: "B2 4th Floor Big Room",
    source: "PUP Biñan Campus",
    tag: "Leadership & Career",
    category: "Student Development / Leadership",
    capacity: 200,
    slots: 80,
    maxSlots: 80,
    slotsOpen: 80,
    status: "Available to Join",
    statusClass: "status-participating",
    desc: "The PUP Biñan Leadership Seminar is a student development program designed to help students strengthen their leadership skills, communication abilities, decision-making, teamwork, and sense of responsibility within the university community. The seminar will feature discussions and interactive activities focused on practical leadership principles that students can apply in academic organizations, group projects, student activities, and future professional environments.",
    registrationDeadline: "March 13, 2027 — 11:59 PM",
    requirements: {
      required: ["Valid PUP Student ID", "Registration through RECOVIBE"],
      recommended: [
        "Notebook and pen",
        "Mobile device for event-related activities",
      ],
    },
    reminders: [
      "Please arrive at least 15–30 minutes before the event.",
      "Bring your valid PUP Student ID.",
      "Keep your RECOVIBE registration confirmation available if verification is required.",
      "Follow the instructions of the event organizers and assigned personnel.",
      "Participants are expected to observe university rules and proper conduct.",
    ],
    detailedInfo: [
      "Leadership and personal development discussions",
      "Communication and teamwork activities",
    ],
    registrationInfo: "Available to Join",
  },
  {
    id: "intramurals-opening",
    dateISO: "2027-04-02",
    month: "APR",
    day: 2,
    title: "Intramurals Opening Program",
    location: "PUP Biñan Campus",
    time: "7:00 AM - 10:00 AM",
    room: "Open Field",
    source: "PUP Official",
    tag: "PUP Biñan Campus",
    category: "Sports",
    slots: 120,
    maxSlots: 200,
    slotsOpen: 120,
    status: "Rejected",
    statusClass: "status-rejected",
    desc: "The official kick-off of this year's Intramurals with the parade of athletes and opening rites.",
  },
  {
    id: "cite-hackathon",
    dateISO: "2027-04-18",
    month: "APR",
    day: 18,
    title: "CITE Mini Hackathon",
    location: "PUP Biñan Campus",
    time: "9:00 AM - 5:00 PM",
    room: "Computer Lab 3",
    source: "PUP CITE",
    tag: "PUP CITE",
    category: "Tech",
    slots: 18,
    maxSlots: 40,
    slotsOpen: 18,
    desc: "A one-day build sprint for CITE students to prototype solutions for real campus problems.",
  },
  {
    id: "ibits-week",
    dateISO: "2027-04-02",
    month: "APR",
    day: 2,
    title: "IBITS Week",
    location: "PUP CITE",
    time: "7:00 AM - 10:00 AM",
    room: "Open Field",
    source: "PUP CITE",
    tag: "IBITS",
    category: "Arts",
    slots: 0,
    maxSlots: 150,
    slotsOpen: 0,
    status: "Registration Closed",
    statusClass: "status-closed",
    desc: "A week of activities and community events for IBITS students.",
  },
  {
    id: "ibits-general-assembly",
    dateISO: "2027-05-05",
    month: "MAY",
    day: 5,
    title: "IBITS General Assembly",
    location: "PUP Biñan Campus",
    time: "2:00 PM - 4:00 PM",
    room: "AVR Hall",
    source: "IBITS",
    tag: "IBITS",
    category: "Academic",
    slots: 45,
    maxSlots: 60,
    slotsOpen: 45,
    desc: "Quarterly general assembly for IBITS members covering organization updates and upcoming activities.",
  },
];

// Only approved role-created records enter the student feed.
try {
  const organizerRecords = JSON.parse(
    localStorage.getItem("recovibeOrganizerEvents") || "[]",
  );
  const knownIds = new Set(window.RECOVIBE_EVENTS.map((event) => event.id));
  organizerRecords.forEach((event) => {
    if (
      ["approved", "published"].includes(
        String(event.status || "").toLowerCase(),
      ) &&
      !knownIds.has(event.eventId)
    ) {
      window.RECOVIBE_EVENTS.push({
        ...event,
        id: event.eventId,
        dateISO: event.dateISO,
        title: event.title,
        location: event.location,
        room: event.room,
        time: event.time,
        source: event.source || "Event Organizer",
        tag: event.category,
        category: event.category,
        capacity:
          event.capacityMode === "N/A"
            ? null
            : Number(event.maxCapacity ?? event.capacity),
        maxSlots:
          event.capacityMode === "N/A"
            ? null
            : Number(event.maxCapacity ?? event.capacity),
        slots:
          event.capacityMode === "N/A"
            ? null
            : Number(event.openSlots ?? event.maxCapacity ?? event.capacity),
        slotsOpen:
          event.capacityMode === "N/A"
            ? null
            : Number(event.openSlots ?? event.maxCapacity ?? event.capacity),
        status: "Approved",
        desc: event.description,
        organizerId: event.organizerId,
      });
      knownIds.add(event.eventId);
    }
  });
} catch (error) {
  console.warn("Organizer event records could not be loaded.", error);
}

try {
  const teacherRecords = JSON.parse(
    localStorage.getItem("recovibeTeacherEvents") || "[]",
  );
  const knownIds = new Set(
    window.RECOVIBE_EVENTS.map((event) => String(event.id)),
  );
  teacherRecords.forEach((event) => {
    const id = String(event.eventId || event.id || "");
    if (
      id &&
      ["approved", "published"].includes(
        String(event.status || "").toLowerCase(),
      ) &&
      !knownIds.has(id)
    ) {
      window.RECOVIBE_EVENTS.push({
        ...event,
        id,
        eventId: id,
        dateISO: event.dateISO || event.date,
        category: event.categories || event.category || event.tag || "General",
        capacity: event.maxCapacity ?? event.capacity ?? 0,
        maxSlots: event.maxCapacity ?? event.maxSlots ?? event.capacity ?? 0,
        slotsOpen:
          event.openSlots ??
          event.slotsOpen ??
          event.maxCapacity ??
          event.capacity ??
          0,
        description: event.description || event.desc || "",
        desc: event.description || event.desc || "",
        status: "Approved",
      });
      knownIds.add(id);
    }
  });
} catch (error) {
  console.warn("Teacher event records could not be loaded.", error);
}
