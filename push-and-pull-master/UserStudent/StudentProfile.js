function hydrateUserProfile() {
  const user =
    JSON.parse(localStorage.getItem("recovibeCurrentUser") || "null") || {};
  const name = String(user.name || "Joshua Lopez").trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const firstName = user.firstName || parts[0] || "Joshua";
  const displayName =
    user.firstName && parts.length > 1
      ? `${user.firstName} ${parts[parts.length - 1]}`
      : name;
  const role =
    user.organization && user.year
      ? `${user.organization} | BSIT ${user.year} Ladderized`
      : "IBITS | BSIT 2-3 Ladderized";

  document.querySelectorAll(".user-name").forEach((element) => {
    element.textContent = displayName;
  });
  document.querySelectorAll(".user-role").forEach((element) => {
    element.textContent = role;
  });
  document.querySelectorAll(".avatar").forEach((element) => {
    element.textContent = displayName
      .split(" ")
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
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
    if (element) element.textContent = value || "-";
  };
  const firstName = user.firstName || (user.name || "Joshua").split(/\s+/)[0];
  const nameParts = (user.name || `${firstName} Lopez`).split(/\s+/);
  setText("userFirstName", firstName);
  setText("profileFirstName", firstName);
  setText(
    "profileMiddleName",
    nameParts.length > 2 ? nameParts.slice(1, -1).join(" ") : "-",
  );
  setText("profileLastName", nameParts[nameParts.length - 1]);
  setText("profileStudentId", user.studentId);
  setText("profileEmail", user.email);
  setText("profileContact", user.contact);
  setText("profileDepartment", user.department);
  setText("profileYear", user.year);
  setText("profileOrganization", user.organization);
  setText(
    "userAvatar",
    nameParts
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase(),
  );
  setText(
    "todayDate",
    new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }),
  );
  setText("userFirstName", firstName);
  setText(
    "categorySummary",
    preferences.categories.join("  •  ") || "No categories selected.",
  );
  setText(
    "sourceSummary",
    preferences.sources.join("  •  ") || "No sources selected.",
  );
  setText("userFirstName", firstName);
  const role =
    [user.organization, user.year && `BSIT ${user.year} Ladderized`]
      .filter(Boolean)
      .join(" | ") || "Student | Portal account";
  setText("userRole", role);
  setText("userName", user.name || `${firstName} Lopez`);
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
    setText(
      "categorySummary",
      preferences.categories.join("  •  ") || "No categories selected.",
    );
    setText(
      "sourceSummary",
      preferences.sources.join("  •  ") || "No sources selected.",
    );
    document.getElementById("cancelPreferences").click();
    const toast = document.getElementById("toast");
    toast.textContent = "Preferences saved.";
    toast.classList.add("is-visible");
    setTimeout(() => toast.classList.remove("is-visible"), 2200);
  });
})();
