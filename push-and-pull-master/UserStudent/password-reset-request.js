import { sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { auth, isFirebaseConfigured } from "./firebaseConfig.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PUP_EMAIL_PATTERN = /^[^\s@]+@(?:[a-z0-9-]+\.)*pup\.edu\.ph$/i;

function errorMessage(error) {
  switch (error.code) {
    case "auth/invalid-email":
      return "Enter a valid PUP email address.";
    case "auth/user-not-found":
      return "If an account exists for that PUP email, a reset link will be sent.";
    case "auth/too-many-requests":
      return "Too many requests. Please wait a while and try again.";
    case "auth/network-request-failed":
      return "Could not connect. Check your internet connection and try again.";
    default:
      return "We couldn't send the reset link. Please try again.";
  }
}

document.querySelectorAll("[data-password-reset-form]").forEach((form) => {
  const emailInput = form.querySelector('input[type="email"]');
  const button = form.querySelector('button[type="submit"]');
  const status = form.querySelector("[data-reset-status]");
  const field = emailInput?.closest(".field");

  if (!emailInput || !button || !status) return;

  emailInput.addEventListener("input", () => {
    field?.classList.remove("invalid");
    status.textContent = "";
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = emailInput.value.trim().toLowerCase();
    if (
      !EMAIL_PATTERN.test(email) ||
      !PUP_EMAIL_PATTERN.test(email) ||
      !emailInput.checkValidity()
    ) {
      field?.classList.add("invalid");
      status.textContent = "Enter a valid PUP email address.";
      emailInput.focus();
      return;
    }

    if (!isFirebaseConfigured || !auth) {
      status.textContent =
        "Password reset is temporarily unavailable. Please try again later.";
      return;
    }

    button.disabled = true;
    status.textContent = "Sending reset link…";
    try {
      await sendPasswordResetEmail(auth, email);
      field?.classList.remove("invalid");
      status.textContent =
        "If an account exists for that PUP email, a reset link will be sent. Check your inbox and spam folder.";
    } catch (error) {
      field?.classList.add("invalid");
      status.textContent = errorMessage(error);
    } finally {
      button.disabled = false;
    }
  });
});
