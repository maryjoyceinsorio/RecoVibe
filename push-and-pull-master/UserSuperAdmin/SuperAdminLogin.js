(function () {
  document
    .querySelector('.link-btn[href*="ForgetPassword"]')
    ?.setAttribute("href", "SuperAdminForgetPassword.html");
  const email = document.getElementById("login-email");
  const password = document.getElementById("login-pass");
  const setInvalid = (id, invalid) =>
    document.getElementById(id).classList.toggle("invalid", invalid);
  document
    .getElementById("login-submit")
    .addEventListener("click", function () {
      const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value.trim());
      setInvalid("field-email", !validEmail);
      setInvalid("field-pass", !password.value);
      if (validEmail && password.value)
        window.location.href = "../FirstPage.html";
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
