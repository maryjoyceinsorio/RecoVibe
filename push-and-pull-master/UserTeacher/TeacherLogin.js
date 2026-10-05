(function () {
  const email = document.getElementById("login-email");
  const password = document.getElementById("login-pass");
  const banner = document.getElementById("login-banner");
  const setInvalid = (id, invalid) =>
    document.getElementById(id).classList.toggle("invalid", invalid);

  document
    .getElementById("login-submit")
    .addEventListener("click", function () {
      const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
      const validPassword = Boolean(password.value);
      setInvalid("field-email", !validEmail);
      setInvalid("field-pass", !validPassword);
      banner.classList.remove("show");
      if (!validEmail || !validPassword) {
        banner.textContent = "Enter a valid email and password.";
        banner.classList.add("show");
        return;
      }
      const normalizedEmail = email.value.trim().toLowerCase();
      let teacher = {};
      try {
        teacher = JSON.parse(
          localStorage.getItem("recovibeCurrentTeacher") || "{}",
        );
      } catch (error) {
        console.warn("Unable to read teacher account:", error);
      }
      const existingName =
        String(teacher.email || "").trim().toLowerCase() === normalizedEmail
          ? teacher.name
          : "";
      const nameFromEmail = normalizedEmail
        .split("@")[0]
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
      teacher = {
        ...teacher,
        name: existingName || nameFromEmail || "Teacher",
        email: normalizedEmail,
        department: teacher.department || "PUP Biñan Campus",
        role: teacher.role || "Faculty account",
      };
      localStorage.setItem("recovibeCurrentTeacher", JSON.stringify(teacher));
      localStorage.setItem("recovibeTeacherId", normalizedEmail);
      window.location.href = "TeacherDashBoard.html";
    });

  document.getElementById("pass-toggle").addEventListener("click", function () {
    const visible = password.type === "password";
    password.type = visible ? "text" : "password";
    this.setAttribute(
      "aria-label",
      visible ? "Hide password" : "Show password",
    );
    this.setAttribute("aria-pressed", String(visible));
  });
})();
