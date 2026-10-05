(function () {
  document
    .querySelector('.link-btn[href*="ForgetPassword"]')
    ?.setAttribute("href", "EventOrganizerForgetPassword.html");
  const email = document.getElementById("login-email");
  const password = document.getElementById("login-pass");
  const setInvalid = (id, invalid) =>
    document.getElementById(id).classList.toggle("invalid", invalid);
  const loginButton = document.getElementById("login-submit");
  const banner = document.getElementById("login-banner");

  loginButton.addEventListener("click", async function () {
    const normalizedEmail = email.value.trim().toLowerCase();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
    setInvalid("field-email", !validEmail);
    setInvalid("field-pass", !password.value);
    banner.classList.remove("show");
    if (!validEmail || !password.value) return;

    loginButton.disabled = true;
    loginButton.textContent = "Signing in...";
    try {
      const [{ auth, isFirebaseConfigured }, { signInWithEmailAndPassword }] =
        await Promise.all([
          import("../UserStudent/firebaseConfig.js"),
          import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
        ]);
      if (!isFirebaseConfigured || !auth)
        throw new Error("Firebase authentication is not configured.");

      const credential = await signInWithEmailAndPassword(
        auth,
        normalizedEmail,
        password.value,
      );
      localStorage.setItem("recovibeOrganizerId", normalizedEmail);
      const profile = JSON.parse(
        localStorage.getItem("recovibeOrganizerProfile") || "{}",
      );
      localStorage.setItem(
        "recovibeOrganizerProfile",
        JSON.stringify({
          ...profile,
          uid: credential.user.uid,
          email: normalizedEmail,
        }),
      );
      window.location.href = "EventOrganizerDashBoard.html";
    } catch (error) {
      if (
        [
          "auth/invalid-credential",
          "auth/user-not-found",
          "auth/wrong-password",
          "auth/invalid-email",
        ].includes(error.code)
      ) {
        banner.textContent = "Incorrect email or password.";
      } else if (error.code === "auth/too-many-requests") {
        banner.textContent = "Too many attempts. Please try again later.";
      } else {
        banner.textContent =
          error.message || "Unable to sign in right now. Please try again.";
      }
      banner.classList.add("show");
    } finally {
      loginButton.disabled = false;
      loginButton.textContent = "Sign in";
    }
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
