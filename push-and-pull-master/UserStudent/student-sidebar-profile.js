(() => {
  let user = {};

  try {
    user =
      JSON.parse(localStorage.getItem("recovibeCurrentUser") || "null") || {};
  } catch {
    user = {};
  }

  const nameFromProfile = [user.firstName, user.middleName, user.lastName]
    .filter(Boolean)
    .join(" ");
  const displayName = String(
    user.name || nameFromProfile || user.firstName || "Student",
  ).trim();
  const program = [user.department, user.year].filter(Boolean).join(" ");
  const roleParts = [];

  if (user.organization && user.organization !== "None")
    roleParts.push(user.organization);
  if (program) roleParts.push(`${program} Ladderized`);

  const role = roleParts.join(" · ") || user.role || user.organization || "Student";

  const firstLetter =
    Array.from(user.firstName || displayName || "Student")[0]?.toUpperCase() || "S";
  const firstName = user.firstName || displayName.split(/\s+/)[0];

  document.querySelectorAll(".user-name, #userName").forEach((element) => {
    element.textContent = displayName;
  });
  document.querySelectorAll(".user-role, #userRole").forEach((element) => {
    element.textContent = role;
  });
  document.querySelectorAll(".avatar, #userAvatar").forEach((element) => {
    element.textContent = firstLetter;
  });
  document.querySelectorAll("#userFirstName").forEach((element) => {
    element.textContent = firstName;
  });

  const greeting = document.getElementById("dashboardGreeting");
  if (greeting) {
    const hour = new Date().getHours();
    const salutation =
      hour < 12 ? "Good Morning" : hour < 18 ? "Good Noon" : "Good Evening";
    greeting.textContent = `${salutation}, ${displayName}`;
  }
})();
