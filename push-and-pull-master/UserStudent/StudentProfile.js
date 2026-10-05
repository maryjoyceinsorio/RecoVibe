function hydrateUserProfile() {
  const user =
    JSON.parse(localStorage.getItem("recovibeCurrentUser") || "null") || {};
  const storedFirstName = String(user.firstName || "").trim();
  const storedFullName = String(user.name || user.fullName || "").trim();
  const nameFromProfile = [storedFirstName, user.middleName, user.lastName]
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join(" ");
  const displayName = storedFullName || nameFromProfile || "Student";
  const firstName =
    storedFirstName ||
    storedFullName.split(/\s+/).filter(Boolean)[0] ||
    nameFromProfile.split(/\s+/).filter(Boolean)[0] ||
    "";
  const avatarFallback = [
    user.username,
    user.studentNumber,
    user.studentId,
    user.email,
  ]
    .map((value) => String(value || "").trim())
    .find(Boolean) || "";
  const avatarLetter =
    Array.from(firstName || avatarFallback)[0]?.toLocaleUpperCase() || "S";
  const organization = String(user.organization || "").trim();
  const role =
    organization && organization.toLowerCase() !== "none"
      ? organization
      : "Student";

  document.querySelectorAll(".user-name").forEach((element) => {
    element.textContent = displayName;
  });
  document.querySelectorAll(".user-role").forEach((element) => {
    element.textContent = role;
  });
  document.querySelectorAll(".avatar").forEach((element) => {
    element.textContent = avatarLetter;
  });
  document.querySelectorAll("#userFirstName").forEach((element) => {
    element.textContent = firstName;
  });
}

(() => {
  hydrateUserProfile();
  const user =
    JSON.parse(localStorage.getItem("recovibeCurrentUser") || "null") || {};
  const preferenceKey = "recovibePreferences";
  const categories = [
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
  const sources = [
    "PUP Official",
    "PUP Biñan",
    "PUP CITE",
    "IBITS",
    "Organization",
    "CSC",
    "Teacher / Faculty",
    "Admin",
    "Other / External",
  ];
  const defaults = {
    categories: ["Academic & Learning", "Tech & Innovation"],
    sources: ["PUP Official", "PUP Biñan", "PUP CITE", "IBITS"],
  };
  let preferences =
    JSON.parse(localStorage.getItem(preferenceKey) || "null") || defaults;

  const setText = (id, value) => {
    const element = document.getElementById(id);
    if (element) element.textContent = String(value || "").trim() || "Not provided";
  };
  const storedName = String(user.fullName || user.name || "").trim();
  const nameParts = storedName.split(/\s+/).filter(Boolean);
  const firstName = String(user.firstName || "").trim() || nameParts[0] || "";
  const lastName =
    String(user.lastName || "").trim() ||
    (nameParts.length > 1 ? nameParts.at(-1) : "");
  setText("profileFirstName", firstName);
  setText(
    "profileMiddleName",
    String(user.middleName || "").trim() ||
      (nameParts.length > 2 ? nameParts.slice(1, -1).join(" ") : ""),
  );
  setText("profileLastName", lastName);
  setText("profileStudentId", user.studentNumber || user.studentId);
  setText("profileEmail", user.email);
  setText("profileContact", user.contactNumber || user.contact);
  setText("profileDepartment", user.department);
  setText("profileYear", user.year);
  setText("profileOrganization", user.organization);
  setText(
    "todayDate",
    new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  );
  const renderSummary = (id, items, emptyMessage) => {
    const container = document.getElementById(id);
    if (!container) return;
    container.replaceChildren();
    if (!items.length) {
      const emptyState = document.createElement("p");
      emptyState.className = "preference-empty";
      emptyState.textContent = emptyMessage;
      container.append(emptyState);
      return;
    }
    items.forEach((item) => {
      const chip = document.createElement("span");
      chip.className = "preference-chip";
      chip.textContent = item;
      container.append(chip);
    });
  };
  renderSummary(
    "categorySummary",
    preferences.categories,
    "No categories selected.",
  );
  renderSummary("sourceSummary", preferences.sources, "No sources selected.");
  const organization = String(user.organization || "").trim();
  const role =
    organization && organization.toLowerCase() !== "none"
      ? organization
      : "Student";
  setText("userRole", role);
  setText("userName", storedName || firstName);
  hydrateUserProfile();

  const sidebar = document.getElementById("sidebar");
  const collapseButton = document.getElementById("collapseBtn");
  const setCollapsed = (collapsed) => {
    sidebar.classList.toggle("is-collapsed", collapsed);
    if (collapseButton) {
      collapseButton.setAttribute("aria-expanded", String(!collapsed));
      collapseButton.setAttribute(
        "aria-label",
        collapsed ? "Expand sidebar" : "Collapse sidebar",
      );
      collapseButton.setAttribute(
        "title",
        collapsed ? "Expand sidebar" : "Collapse sidebar",
      );
    }
    localStorage.setItem("sidebarCollapsed", String(collapsed));
  };
  const mobileSidebar = window.matchMedia("(max-width: 860px)");
  setCollapsed(
    mobileSidebar.matches
      ? false
      : localStorage.getItem("sidebarCollapsed") === "true",
  );
  if (collapseButton) {
    collapseButton.addEventListener("click", () => {
      if (!mobileSidebar.matches)
        setCollapsed(!sidebar.classList.contains("is-collapsed"));
    });
  }
  document.querySelector(".logout").addEventListener("click", (event) => {
    event.preventDefault();
    localStorage.removeItem("recovibeCurrentUser");
    window.location.href = "StudentLogin.html";
  });

  const categoryChoices = document.getElementById("categoryChoices");
  const sourceChoices = document.getElementById("sourceChoices");
  const renderChoices = (container, items, selected) => {
    container.innerHTML = items
      .map(
        (item) =>
          `<button type="button" class="choice${selected.includes(item) ? " is-selected" : ""}" data-choice="${item}"><span>${item}</span><span class="choice-mark">${selected.includes(item) ? "✓" : "+"}</span></button>`,
      )
      .join("");
  };
  const openEditor = () => {
    renderChoices(categoryChoices, categories, preferences.categories);
    renderChoices(sourceChoices, sources, preferences.sources);
    document.getElementById("preferenceEditor").hidden = false;
    document.getElementById("editPreferences").hidden = true;
  };
  document
    .getElementById("editPreferences")
    .addEventListener("click", openEditor);
  document.getElementById("cancelPreferences").addEventListener("click", () => {
    document.getElementById("preferenceEditor").hidden = true;
    document.getElementById("editPreferences").hidden = false;
  });
  document.addEventListener("click", (event) => {
    const choice = event.target.closest(".choice");
    if (!choice) return;
    choice.classList.toggle("is-selected");
    choice.querySelector(".choice-mark").textContent =
      choice.classList.contains("is-selected") ? "✓" : "+";
  });
  document.getElementById("savePreferences").addEventListener("click", () => {
    preferences = {
      categories: [
        ...categoryChoices.querySelectorAll(".choice.is-selected"),
      ].map((item) => item.dataset.choice),
      sources: [...sourceChoices.querySelectorAll(".choice.is-selected")].map(
        (item) => item.dataset.choice,
      ),
    };
    localStorage.setItem(preferenceKey, JSON.stringify(preferences));
    renderSummary(
      "categorySummary",
      preferences.categories,
      "No categories selected.",
    );
    renderSummary(
      "sourceSummary",
      preferences.sources,
      "No sources selected.",
    );
    document.getElementById("cancelPreferences").click();
    const toast = document.getElementById("toast");
    toast.textContent = "Preferences saved.";
    toast.classList.add("is-visible");
    setTimeout(() => toast.classList.remove("is-visible"), 2200);
  });
})();
