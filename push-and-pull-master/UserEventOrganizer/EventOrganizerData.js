const organizerEventStorageKey = "recovibeOrganizerEvents";

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

const demoOrganizerEvents = [
  {
    eventId: "demo-event-001",
    organizerId: "organizer-demo",
    organizerName: "Event Organizer",
    title: "PUP Biñan Leadership Seminar",
    dateISO: "2026-09-25",
    createdAt: "2026-09-01T09:00:00.000Z",
    time: "1:00 PM - 4:00 PM",
    location: "PUP Biñan Campus",
    room: "B2 4th Floor Big Room",
    category: "Leadership & Career",
    source: "PUP Biñan",
    capacity: 120,
    status: "Approved",
    published: true,
    description:
      "A practical seminar on student leadership and campus service.",
    hap1Approved: true,
    hap2Approved: true,
    hap3Approved: true,
  },
  {
    eventId: "demo-event-002",
    organizerId: "organizer-demo",
    organizerName: "Event Organizer",
    title: "IBITS Tech Innovation Forum",
    dateISO: "2026-09-28",
    createdAt: "2026-09-03T10:30:00.000Z",
    time: "9:00 AM - 12:00 PM",
    location: "PUP Biñan Campus",
    room: "AVR 2",
    category: "Tech & Innovation",
    source: "Organizational",
    capacity: 80,
    status: "Approved",
    published: true,
    description:
      "Students and faculty discuss emerging technology and innovation.",
    hap1Approved: true,
    hap2Approved: true,
    hap3Approved: true,
  },
  {
    eventId: "demo-event-003",
    organizerId: "organizer-demo",
    organizerName: "Event Organizer",
    title: "Campus Wellness Day",
    dateISO: "2026-10-02",
    createdAt: "2026-09-05T08:15:00.000Z",
    time: "8:00 AM - 3:00 PM",
    location: "PUP Biñan Campus",
    room: "Open Field",
    category: "Sports & Fitness",
    source: "PUP Biñan",
    capacity: 200,
    status: "Approved",
    published: true,
    description:
      "A full day of wellness activities, games, and fitness sessions.",
    hap1Approved: true,
    hap2Approved: true,
    hap3Approved: true,
  },
  {
    eventId: "demo-event-004",
    organizerId: "organizer-demo",
    organizerName: "Event Organizer",
    title: "Creative Writing Workshop",
    dateISO: "2026-10-06",
    createdAt: "2026-09-07T13:00:00.000Z",
    time: "2:00 PM - 5:00 PM",
    location: "PUP Biñan Campus",
    room: "Library Discussion Room",
    category: "Academic & Learning",
    source: "Organizational",
    capacity: 35,
    status: "Pending",
    published: false,
    description:
      "A guided workshop for students developing short fiction and essays.",
    hap1Approved: true,
    hap2Approved: false,
    hap3Approved: false,
  },
  {
    eventId: "demo-event-005",
    organizerId: "organizer-demo",
    organizerName: "Event Organizer",
    title: "Student Career Connect",
    dateISO: "2026-10-10",
    createdAt: "2026-09-08T09:45:00.000Z",
    time: "10:00 AM - 4:00 PM",
    location: "PUP Biñan Campus",
    room: "Multipurpose Hall",
    category: "Leadership & Career",
    source: "PUP Official",
    capacity: 150,
    status: "Approved",
    published: true,
    description:
      "Career talks and employer networking for graduating students.",
    hap1Approved: true,
    hap2Approved: true,
    hap3Approved: true,
  },
  {
    eventId: "demo-event-006",
    organizerId: "organizer-demo",
    organizerName: "Event Organizer",
    title: "Community Outreach Planning",
    dateISO: "2026-10-14",
    createdAt: "2026-09-10T11:20:00.000Z",
    time: "9:00 AM - 11:30 AM",
    location: "PUP Biñan Campus",
    room: "AVR 1",
    category: "Social Events",
    source: "Organizational",
    capacity: 60,
    status: "Draft",
    published: false,
    description:
      "Planning session for the next student-led community outreach program.",
    hap1Approved: false,
    hap2Approved: false,
    hap3Approved: false,
  },
  {
    eventId: "demo-event-007",
    organizerId: "organizer-demo",
    organizerName: "Event Organizer",
    title: "Digital Safety Awareness Talk",
    dateISO: "2026-10-18",
    createdAt: "2026-09-11T14:00:00.000Z",
    time: "1:30 PM - 3:30 PM",
    location: "PUP Biñan Campus",
    room: "Computer Lab 3",
    category: "Tech & Innovation",
    source: "PUP CITE",
    capacity: 45,
    status: "Approved",
    published: true,
    description:
      "An accessible introduction to privacy, security, and responsible technology use.",
    hap1Approved: true,
    hap2Approved: true,
    hap3Approved: true,
  },
  {
    eventId: "demo-event-008",
    organizerId: "organizer-demo",
    organizerName: "Event Organizer",
    title: "First Aid and Emergency Response",
    dateISO: "2026-10-22",
    createdAt: "2026-09-12T08:30:00.000Z",
    time: "8:30 AM - 12:00 PM",
    location: "PUP Biñan Campus",
    room: "Gymnasium",
    category: "Sports & Fitness",
    source: "PUP Biñan",
    capacity: 100,
    status: "Pending",
    published: false,
    description: "Hands-on emergency response training for campus volunteers.",
    hap1Approved: true,
    hap2Approved: true,
    hap3Approved: false,
  },
  {
    eventId: "demo-event-009",
    organizerId: "organizer-demo",
    organizerName: "Event Organizer",
    title: "Alumni Homecoming Mixer",
    dateISO: "2026-08-30",
    createdAt: "2026-08-01T10:00:00.000Z",
    time: "5:00 PM - 8:00 PM",
    location: "PUP Biñan Campus",
    room: "Multipurpose Hall",
    category: "Social Events",
    source: "PUP Official",
    capacity: 180,
    status: "Completed",
    published: false,
    description:
      "An evening gathering connecting current students with PUP Biñan alumni.",
    hap1Approved: true,
    hap2Approved: true,
    hap3Approved: true,
  },
  {
    eventId: "demo-event-010",
    organizerId: "organizer-demo",
    organizerName: "Event Organizer",
    title: "Research Presentation Series",
    dateISO: "2026-11-04",
    createdAt: "2026-09-15T15:30:00.000Z",
    time: "9:00 AM - 2:00 PM",
    location: "PUP Biñan Campus",
    room: "B1 Lecture Hall",
    category: "Academic & Learning",
    source: "PUP Official",
    capacity: 90,
    status: "Approved",
    published: true,
    description:
      "A showcase of student research, prototypes, and academic projects.",
    hap1Approved: true,
    hap2Approved: true,
    hap3Approved: true,
  },
];

function readOrganizerEvents() {
  const storedEvents = localStorage.getItem(organizerEventStorageKey);

  if (!storedEvents) {
    localStorage.setItem(
      organizerEventStorageKey,
      JSON.stringify(demoOrganizerEvents),
    );
    if (!localStorage.getItem("recovibeOrganizerId")) {
      localStorage.setItem("recovibeOrganizerId", "organizer-demo");
    }
    return [...demoOrganizerEvents];
  }

  try {
    const events = JSON.parse(storedEvents);
    if (Array.isArray(events) && events.length) {
      return events;
    }

    localStorage.setItem(
      organizerEventStorageKey,
      JSON.stringify(demoOrganizerEvents),
    );
    if (!localStorage.getItem("recovibeOrganizerId")) {
      localStorage.setItem("recovibeOrganizerId", "organizer-demo");
    }
    return [...demoOrganizerEvents];
  } catch (error) {
    console.error("Unable to read organizer events:", error);
    return [];
  }
}

const organizerEvents = readOrganizerEvents();

function getOrganizerEvents() {
  return [...organizerEvents];
}

function saveOrganizerEvent(event) {
  organizerEvents.push(event);
  localStorage.setItem(
    organizerEventStorageKey,
    JSON.stringify(organizerEvents),
  );
}

function updateOrganizerEvent(eventId, changes) {
  const index = organizerEvents.findIndex((event) => event.eventId === eventId);
  if (index === -1) return false;
  organizerEvents[index] = {
    ...organizerEvents[index],
    ...changes,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(
    organizerEventStorageKey,
    JSON.stringify(organizerEvents),
  );
  window.dispatchEvent(new Event("recovibeOrganizerEventsChanged"));
  return true;
}

function removeOrganizerEvent(eventId) {
  const index = organizerEvents.findIndex((event) => event.eventId === eventId);
  if (index === -1) return false;
  organizerEvents.splice(index, 1);
  localStorage.setItem(
    organizerEventStorageKey,
    JSON.stringify(organizerEvents),
  );
  return true;
}

function isOrganizerEventHapApproved(event, hapNumber) {
  const nestedApproval = event.approvals?.[`hap${hapNumber}`];
  if (typeof nestedApproval === "boolean") {
    return nestedApproval;
  }
  if (typeof nestedApproval === "string") {
    return nestedApproval.toLowerCase() === "approved";
  }

  const approvalKey = `hap${hapNumber}Approved`;
  const statusKey = `hap_${hapNumber}_status`;
  const legacyKey = `hap${hapNumber}`;

  if (typeof event[approvalKey] === "boolean") {
    return event[approvalKey];
  }

  if (typeof event[statusKey] === "string") {
    return event[statusKey].toLowerCase() === "approved";
  }

  return event[legacyKey] === true;
}

function canPublishOrganizerEvent(event) {
  return (
    isOrganizerEventHapApproved(event, 1) &&
    isOrganizerEventHapApproved(event, 2) &&
    isOrganizerEventHapApproved(event, 3) &&
    event.status === "Approved" &&
    event.published !== true &&
    event.cancelled !== true
  );
}

function publishOrganizerEvent(eventId, currentOrganizerId) {
  const event = organizerEvents.find((item) => item.eventId === eventId);

  if (!event || String(event.organizerId) !== String(currentOrganizerId)) {
    return {
      success: false,
      message: "You do not have permission to publish this event.",
    };
  }

  if (!canPublishOrganizerEvent(event)) {
    return {
      success: false,
      message:
        "Event cannot be published until all three HAP approvals are completed.",
    };
  }

  const updated = updateOrganizerEvent(eventId, {
    status: "Published",
    published: true,
  });

  return {
    success: updated,
    message: updated ? "" : "Unable to publish the event.",
  };
}

function organizerEventToFeed(event) {
  return {
    id: event.eventId,
    eventId: event.eventId,
    dateISO: event.dateISO,
    title: event.title,
    location: event.location,
    room: event.room,
    time: event.time,
    source: "Event Organizer",
    tag: event.category,
    category: event.category,
    capacity: Number(event.capacity),
    maxSlots: Number(event.capacity),
    slots: Number(event.capacity),
    slotsOpen: Number(event.capacity),
    status: event.status,
    desc: event.description,
    organizerId: event.organizerId,
  };
}

function mergeOrganizerEventsIntoFeed() {
  if (!Array.isArray(window.RECOVIBE_EVENTS)) return;
  const existingIds = new Set(window.RECOVIBE_EVENTS.map((event) => event.id));
  getOrganizerEvents()
    .map(organizerEventToFeed)
    .forEach((event) => {
      if (!existingIds.has(event.id)) window.RECOVIBE_EVENTS.push(event);
    });
}
