const accountStorageKey = "recovibeAccounts";
const currentUserStorageKey = "recovibeCurrentUser";

function getAccounts() {
  return JSON.parse(localStorage.getItem(accountStorageKey) || "[]");
}

function setInvalid(fieldId, invalid) {
  document.getElementById(fieldId).classList.toggle("invalid", invalid);
}

function showBanner(message) {
  const banner = document.getElementById("login-banner");
  banner.textContent = message;
  banner.classList.add("show");
}

document.getElementById("login-submit").addEventListener("click", () => {
  const studentId = document
    .getElementById("student-id")
    .value.trim()
    .toLowerCase();
  const password = document.getElementById("student-pass").value;

  setInvalid("field-id", !studentId);
  setInvalid("field-pass", !password);
  document.getElementById("login-banner").classList.remove("show");
  if (!studentId || !password) return;

  const account = getAccounts().find(
    (item) => item.studentId?.toLowerCase() === studentId,
  );
  if (!account) {
    showBanner(
      "No account was found for that student ID. Create an account first.",
    );
    setInvalid("field-id", true);
    return;
  }
  if (account.password !== password) {
    setInvalid("field-pass", true);
    return;
  }

  localStorage.setItem(currentUserStorageKey, JSON.stringify(account));
  window.location.href = "Dashboard.html";
});

(function () {
  const input = document.getElementById("student-pass");
  const toggle = document.getElementById("pass-toggle");
  const icon = document.getElementById("eye-icon");
  const eyeOpen =
    '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/>';
  const eyeClosed =
    '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.93 19.93 0 0 1 4.22-5.94M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 8 11 8a19.86 19.86 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>';

  toggle.addEventListener("click", function () {
    const isHidden = input.type === "password";
    input.type = isHidden ? "text" : "password";
    icon.innerHTML = isHidden ? eyeClosed : eyeOpen;
    toggle.setAttribute(
      "aria-label",
      isHidden ? "Hide password" : "Show password",
    );
    toggle.setAttribute("aria-pressed", String(isHidden));
  });
})();
