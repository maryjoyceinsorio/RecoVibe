import {
  createUserWithEmailAndPassword,
  deleteUser,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { auth, db, isFirebaseConfigured } from "./firebaseConfig.js";

const form = document.getElementById("student-registration-form");
const submitButton = document.getElementById("create-account");
const fields = {
  lastName: document.getElementById("reg-lastname"),
  firstName: document.getElementById("reg-firstname"),
  middleName: document.getElementById("reg-middlename"),
  studentId: document.getElementById("reg-student-id"),
  email: document.getElementById("reg-email"),
  contact: document.getElementById("reg-contact"),
  year: document.getElementById("reg-year"),
  department: document.getElementById("reg-department"),
  organization: document.getElementById("reg-organization"),
  password: document.getElementById("reg-pass"),
  confirmation: document.getElementById("reg-confirm"),
};

window.enhanceDropdownSelects?.("#reg-department, #reg-organization");
const noMiddleNameBox = document.getElementById("no-middle-name");
const namePattern = /^[A-Z][a-z]*(?: [A-Z][a-z]*)*$/;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const pupEmailPattern = /^[^\s@]+@(?:[a-z0-9-]+\.)*pup\.edu\.ph$/i;
const studentNumberPattern = /^20[0-9]{2}-[0-9]{5}-BN-[A-Za-z0-9]$/;
const contactPattern = /^09[0-9]{9}$/;
const yearPattern = /^[1-9][0-9]*-[1-9][0-9]*$/;

function setInvalid(fieldId, invalid, message) {
  const field = document.getElementById(fieldId);
  const control = field.querySelector("input, select");
  const error = field.querySelector(".error-msg");
  field.classList.toggle("invalid", invalid);
  control.setAttribute("aria-invalid", String(invalid));
  if (message) error.textContent = message;
}

function valueOf(control) {
  return control.value.trim();
}

function validateField(name) {
  const value = valueOf(fields[name]);

  if (name === "lastName" || name === "firstName") {
    const label = name === "lastName" ? "Last name" : "First name";
    if (!value) {
      setInvalid(
        `field-reg-${name === "lastName" ? "lastname" : "firstname"}`,
        true,
        `${label} is required.`,
      );
      return false;
    }
    const valid = namePattern.test(value);
    setInvalid(
      `field-reg-${name === "lastName" ? "lastname" : "firstname"}`,
      !valid,
      `${label} must start each word with a capital letter and contain letters only.`,
    );
    return valid;
  }

  if (name === "middleName") {
    if (noMiddleNameBox.checked) {
      setInvalid("field-reg-middlename", false);
      return true;
    }
    const valid = Boolean(value) && namePattern.test(value);
    setInvalid(
      "field-reg-middlename",
      !valid,
      valid
        ? ""
        : "Middle name must start each word with a capital letter and contain letters only.",
    );
    return valid;
  }

  if (name === "email") {
    const valid = emailPattern.test(value) && pupEmailPattern.test(value);
    setInvalid(
      "field-reg-email",
      !valid,
      "Please enter a valid PUP email address.",
    );
    return valid;
  }

  if (name === "studentId") {
    const valid = studentNumberPattern.test(value);
    setInvalid(
      "field-reg-student-id",
      !valid,
      "Student number must follow 20XX-XXXXX-BN-X.",
    );
    return valid;
  }

  if (name === "contact") {
    const valid = contactPattern.test(value);
    setInvalid(
      "field-reg-contact",
      !valid,
      "Contact number must contain exactly 11 digits and start with 09.",
    );
    return valid;
  }

  if (name === "year") {
    const valid = yearPattern.test(value);
    setInvalid(
      "field-reg-year",
      !valid,
      "Year must follow the format N-N without spaces.",
    );
    return valid;
  }

  if (name === "department") {
    const valid = Boolean(fields.department.value);
    setInvalid(
      "field-reg-department",
      !valid,
      "Please select your department.",
    );
    return valid;
  }

  if (name === "organization") {
    const valid = Boolean(fields.organization.value);
    setInvalid(
      "field-reg-organization",
      !valid,
      "Please select your organization.",
    );
    return valid;
  }

  if (name === "password") {
    const rawValue = fields.password.value;
    const valid = rawValue.length >= 6;
    setInvalid(
      "field-reg-pass",
      !valid,
      "Password must be at least 6 characters.",
    );
    return valid;
  }

  if (name === "confirmation") {
    const valid =
      Boolean(fields.confirmation.value) &&
      fields.confirmation.value === fields.password.value;
    setInvalid("field-reg-confirm", !valid, "Passwords do not match.");
    return valid;
  }

  return true;
}

function validateAll() {
  const order = [
    "lastName",
    "firstName",
    "middleName",
    "studentId",
    "email",
    "contact",
    "year",
    "department",
    "organization",
    "password",
    "confirmation",
  ];
  const results = order.map(validateField);

  const firstInvalidIndex = results.findIndex((result) => !result);
  if (firstInvalidIndex !== -1) {
    const firstField = document.getElementById(
      `field-reg-${["lastname", "firstname", "middlename", "student-id", "email", "contact", "year", "department", "organization", "pass", "confirm"][firstInvalidIndex]}`,
    );
    const invalidControl = firstField.querySelector("input, select");
    (
      firstField.querySelector(".native-filter-dropdown .filter-button") ||
      invalidControl
    ).focus();
    return false;
  }
  return true;
}

function updateLiveValidation(name) {
  validateField(name);
  if (name === "password" && fields.confirmation.value)
    validateField("confirmation");
}

Object.entries(fields).forEach(([name, control]) => {
  const eventName = control.tagName === "SELECT" ? "change" : "input";
  control.addEventListener(eventName, () => updateLiveValidation(name));
  control.addEventListener("blur", () => updateLiveValidation(name));
});

noMiddleNameBox.addEventListener("change", () => {
  fields.middleName.disabled = noMiddleNameBox.checked;
  if (noMiddleNameBox.checked) {
    fields.middleName.value = "";
    setInvalid("field-reg-middlename", false);
  } else {
    fields.middleName.focus();
    validateField("middleName");
  }
});

document
  .getElementById("reg-contact")
  ?.addEventListener("beforeinput", (event) => {
    if (
      event.data &&
      (/\D/.test(event.data) ||
        event.target.value.length + event.data.length > 11)
    )
      event.preventDefault();
  });

document.querySelectorAll(".toggle-password").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.target);
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    button.querySelector(".icon-eye").style.display = showing ? "" : "none";
    button.querySelector(".icon-eye-off").style.display = showing ? "none" : "";
    button.setAttribute(
      "aria-label",
      showing ? "Show password" : "Hide password",
    );
  });
});

function registrationErrorMessage(error) {
  switch (error.code) {
    case "auth/email-already-in-use":
      return "An account already exists for this email. Please sign in instead.";
    case "auth/weak-password":
      return "Choose a password with at least 6 characters.";
    case "auth/invalid-email":
      return "Please enter a valid PUP email address.";
    case "auth/operation-not-allowed":
      return "Student registration is unavailable right now. Please contact support.";
    case "permission-denied":
    case "firestore/permission-denied":
      return "Your account could not be saved due to database permissions. Please publish the Firestore rules.";
    case "auth/network-request-failed":
      return "A network error occurred. Check your connection and try again.";
    default:
      return "We couldn't create your account right now: " + error.message;
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!validateAll()) return;

  if (!isFirebaseConfigured || !auth || !db) {
    alert("Student registration is not configured yet. Please check firebaseConfig.js.");
    return;
  }

  const lastName = valueOf(fields.lastName);
  const firstName = valueOf(fields.firstName);
  const middleName = noMiddleNameBox.checked ? "" : valueOf(fields.middleName);
  const email = valueOf(fields.email).toLowerCase();
  const studentNumber = valueOf(fields.studentId);
  const contactNumber = valueOf(fields.contact);
  const department = fields.department.selectedOptions?.[0]?.textContent.trim() || valueOf(fields.department);
  const year = valueOf(fields.year);
  const organization = fields.organization.value;

  // 1:1 Form Layout mapping
  const profile = {
    // Row 1
    lastName,
    firstName,
    middleName,

    // Row 2
    email,
    studentNumber,
    contactNumber,

    // Row 3
    department,
    year,
    organization,

    // Metadata
    fullName: [firstName, middleName, lastName].filter(Boolean).join(" "),
    uid: "",
    role: "student",
    status: "Active",
    createdAt: serverTimestamp(),
  };

  submitButton.disabled = true;
  submitButton.setAttribute("aria-busy", "true");
  submitButton.textContent = "Creating account...";

  let user;
  try {
    const credential = await createUserWithEmailAndPassword(
      auth,
      email,
      fields.password.value,
    );
    user = credential.user;
    profile.uid = user.uid;

    // Isusulat sa `studentuser` collection
    await setDoc(doc(db, "studentuser", user.uid), profile);

    alert("Your student account has been created! Redirecting...");
    window.location.assign("StudentLogin.html");
  } catch (error) {
    console.error("Registration error:", error);
    if (user) {
      try {
        await deleteUser(user);
      } catch (delError) {
        console.error("Cleanup error:", delError);
      }
    }
    alert(registrationErrorMessage(error));
  } finally {
    submitButton.disabled = false;
    submitButton.removeAttribute("aria-busy");
    submitButton.textContent = "Create account";
  }
});