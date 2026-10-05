import {
  browserLocalPersistence,
  browserSessionPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db, isFirebaseConfigured } from "./firebaseConfig.js";

const currentUserStorageKey = "recovibeCurrentUser";
const studentIdInput = document.getElementById("student-id");
const passwordInput = document.getElementById("student-pass");
const submitButton = document.getElementById("login-submit");

function setInvalid(fieldId, invalid) {
  document.getElementById(fieldId).classList.toggle("invalid", invalid);
}

function showBanner(message) {
  const banner = document.getElementById("login-banner");
  banner.textContent = message;
  banner.classList.add("show");
}

function loginErrorMessage(error) {
  switch (error?.code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "Incorrect email or password.";
    case "student/not-found":
      return "Incorrect email or password.";
    case "auth/too-many-requests":
      return "Too many sign-in attempts. Please wait and try again.";
    case "auth/network-request-failed":
      return "A network error occurred. Check your connection and try again.";
    case "permission-denied":
      return "Unable to look up your student account. Please contact support.";
    case "student/duplicate-number":
      return "This student ID is linked to more than one account. Please contact support.";
    case "student/missing-email":
      return "The student account has no sign-in email. Please contact support.";
    case "student/profile-mismatch":
      return "The signed-in account does not match this student profile. Please contact support.";
    default:
      return "We couldn't sign you in right now. Please try again.";
  }
}

async function signIn() {
  const studentNumber = studentIdInput.value.trim();
  const password = passwordInput.value;
  const banner = document.getElementById("login-banner");

  setInvalid("field-id", !studentNumber);
  setInvalid("field-pass", !password);
  banner.classList.remove("show");
  if (!studentNumber || !password) return;

  if (!isFirebaseConfigured || !auth || !db) {
    showBanner("Sign in is not configured. Please contact support.");
    return;
  }

  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");

  try {
    const studentQuery = query(
      collection(db, "studentUser"),
      where("studentNumber", "==", studentNumber),
    );
    const studentMatches = await getDocs(studentQuery);
    if (studentMatches.empty) {
      setInvalid("field-id", true);
      showBanner(loginErrorMessage({ code: "student/not-found" }));
      return;
    }
    if (studentMatches.size !== 1) {
      throw Object.assign(new Error("Duplicate student number."), {
        code: "student/duplicate-number",
      });
    }

    const matchedProfile = studentMatches.docs[0].data();
    const email = String(matchedProfile.email || "").trim().toLowerCase();
    if (!email) {
      throw Object.assign(new Error("Student profile email is missing."), {
        code: "student/missing-email",
      });
    }

    const persistence = document.getElementById("remember").checked
      ? browserLocalPersistence
      : browserSessionPersistence;
    await setPersistence(auth, persistence);
    const credential = await signInWithEmailAndPassword(auth, email, password);
    const profileSnapshot = await getDoc(
      doc(db, "studentUser", credential.user.uid),
    );

    if (!profileSnapshot.exists()) {
      await signOut(auth);
      throw new Error("No student profile is associated with this account.");
    }

    const profile = profileSnapshot.data();
    if (
      profile.studentNumber !== studentNumber ||
      (profile.uid && profile.uid !== credential.user.uid)
    ) {
      await signOut(auth);
      throw Object.assign(new Error("Student profile identity mismatch."), {
        code: "student/profile-mismatch",
      });
    }
    const currentUser = {
      ...profile,
      uid: credential.user.uid,
      email: profile.email || credential.user.email || email,
      studentId: profile.studentNumber || studentNumber,
    };
    localStorage.setItem(currentUserStorageKey, JSON.stringify(currentUser));
    window.location.assign("Dashboard.html");
  } catch (error) {
    console.error("Student sign-in error:", error);
    if (
      error?.code === "auth/invalid-credential" ||
      error?.code === "auth/wrong-password"
    ) {
      setInvalid("field-pass", true);
    }
    showBanner(loginErrorMessage(error));
  } finally {
    submitButton.disabled = false;
    submitButton.removeAttribute("aria-busy");
  }
}

submitButton.addEventListener("click", signIn);
passwordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    signIn();
  }
});

(function () {
  const toggle = document.getElementById("pass-toggle");
  const icon = document.getElementById("eye-icon");
  const eyeOpen =
    '<path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/>';
  const eyeClosed =
    '<path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a19.93 19.93 0 0 1 4.22-5.94M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 8 11 8a19.86 19.86 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><path d="M1 1l22 22"/>';

  toggle.addEventListener("click", function () {
    const isHidden = passwordInput.type === "password";
    passwordInput.type = isHidden ? "text" : "password";
    icon.innerHTML = isHidden ? eyeClosed : eyeOpen;
    toggle.setAttribute(
      "aria-label",
      isHidden ? "Hide password" : "Show password",
    );
    toggle.setAttribute("aria-pressed", String(isHidden));
  });
})();
