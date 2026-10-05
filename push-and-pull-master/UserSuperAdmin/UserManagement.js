import { deleteApp, getApp, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  getAuth,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db, isFirebaseConfigured } from "../UserStudent/firebaseConfig.js";

(() => {
  "use strict";

  const tableBody = document.getElementById("user-table-tbody");
  const roleDialog = document.getElementById("account-type-dialog");
  const createDialog = document.getElementById("create-user-dialog");
  const detailsDialog = document.getElementById("user-details-modal-backdrop");
  const createForm = document.getElementById("create-user-form");
  const staffAuthFields = document.getElementById("staff-auth-fields");
  const passwordInput = document.getElementById("new-user-password");
  const passwordConfirmationInput = document.getElementById(
    "new-user-password-confirmation",
  );
  const statusButton = document.getElementById("toggle-user-status-button");
  const deleteButton = document.getElementById("delete-user-button");
  const toast = document.getElementById("user-management-status");
  let studentsList = [];
  let staffList = [];
  let selectedUserId = null;
  let selectedUserCollection = null;
  let unsubscribeStudents;
  let unsubscribeStaff;

  function showMessage(message, isError = false) {
    if (!toast) return;
    toast.textContent = message;
    toast.dataset.state = isError ? "error" : "success";
    toast.hidden = false;
  }

  function stringValue(value, fallback = "") {
    return value == null ? fallback : String(value);
  }

  function setStaffCredentialFields(role) {
    const staffRole = ["Admin", "Event Organizer"].includes(role);
    staffAuthFields.hidden = !staffRole;
    passwordInput.required = staffRole;
    passwordConfirmationInput.required = staffRole;
    if (!staffRole) {
      passwordInput.value = "";
      passwordConfirmationInput.value = "";
    }
  }

  function authErrorMessage(error) {
    if (error?.code === "auth/email-already-in-use") {
      return "An account already exists with this email address.";
    }
    if (error?.code === "auth/weak-password") {
      return "Password must contain at least 6 characters.";
    }
    if (error?.code === "auth/invalid-email") {
      return "Enter a valid email address.";
    }
    return error?.message || "Could not create the staff account.";
  }

  async function provisionStaffAccount(email, password, targetCollection, profile) {
    const appName = `recovibe-staff-provision-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;
    const provisioningApp = initializeApp(getApp().options, appName);
    const provisioningAuth = getAuth(provisioningApp);
    let userCredential;

    try {
      userCredential = await createUserWithEmailAndPassword(
        provisioningAuth,
        email,
        password,
      );
      await setDoc(
        doc(db, targetCollection, userCredential.user.uid),
        profile,
      );
      return userCredential.user.uid;
    } catch (error) {
      if (userCredential?.user) {
        try {
          await deleteUser(userCredential.user);
        } catch (cleanupError) {
          console.error("Unable to remove Auth user after profile write failed:", cleanupError);
        }
      }
      throw error;
    } finally {
      try {
        await signOut(provisioningAuth);
      } catch (signOutError) {
        console.warn("Unable to sign out provisioning Auth session:", signOutError);
      }
      try {
        await deleteApp(provisioningApp);
      } catch (cleanupError) {
        console.warn("Unable to clean up provisioning Firebase app:", cleanupError);
      }
    }
  }

  function normalizeUser(userId, data, collectionName) {
    const familyFirstName = [data.lastName, data.firstName]
      .map((value) => stringValue(value).trim())
      .filter(Boolean)
      .join(" ");
    const fullName =
      data.fullName || familyFirstName || data.name || data.displayName || "Unnamed User";
    const accountNumber =
      data.studentNumber ||
      data.accountNo ||
      data.studentNo ||
      "—";
    const status = data.status || (data.isActive ? "Active" : "Inactive");

    return {
      ...data,
      id: userId,
      collectionName,
      fullName: stringValue(fullName, "Unnamed User"),
      accountNumber: stringValue(accountNumber, "—"),
      email: stringValue(data.email, "—"),
      role: stringValue(data.role || (collectionName === "studentUser" ? "Student" : "Staff")),
      status,
      contactNumber: stringValue(data.contactNumber || data.phone),
      department: stringValue(data.department || data.course || data.program),
      yearSection: stringValue(data.yearSection || data.section),
      organization: stringValue(data.organization || data.org),
    };
  }

  function createCell(label, value, emphasize = false) {
    const cell = document.createElement("td");
    cell.dataset.label = label;
    if (emphasize) {
      const strong = document.createElement("strong");
      strong.textContent = value;
      cell.append(strong);
    } else {
      cell.textContent = value;
    }
    return cell;
  }

  function renderUsers() {
    const allUsers = [...studentsList, ...staffList];
    tableBody.replaceChildren();
    if (!allUsers.length) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 6;
      cell.className = "user-table-empty";
      cell.textContent = "No user accounts to display.";
      row.append(cell);
      tableBody.append(row);
      return;
    }

    allUsers.forEach((user) => {
      const row = document.createElement("tr");
      row.id = `user-row-${user.collectionName}-${user.id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
      row.dataset.id = user.id;
      row.dataset.collection = user.collectionName;
      row.append(
        createCell("User", user.fullName, true),
        createCell("Account No.", user.accountNumber, true),
        createCell("Email", user.email),
        createCell("Role", user.role),
      );
      const statusCell = document.createElement("td");
      statusCell.dataset.label = "Status";
      const statusPill = document.createElement("span");
      const statusClass = user.status.toLowerCase().replace(/[^a-z0-9]+/g, "-");
      statusPill.className = `user-status-pill status-${statusClass}`;
      statusPill.textContent = user.status;
      statusCell.append(statusPill);
      row.append(statusCell);

      const actionCell = document.createElement("td");
      actionCell.dataset.label = "Action";
      const viewButton = document.createElement("button");
      viewButton.className = "user-view-button";
      viewButton.type = "button";
      viewButton.dataset.id = user.id;
      viewButton.dataset.collection = user.collectionName;
      viewButton.textContent = "View";
      viewButton.setAttribute("aria-label", `View ${user.fullName}`);
      actionCell.append(viewButton);
      row.append(actionCell);
      tableBody.append(row);
    });
  }

  function handleUsersSnapshot(collectionName, snapshot) {
    const mappedUsers = snapshot.docs.map((userDocument) =>
      normalizeUser(userDocument.id, userDocument.data(), collectionName),
    );
    if (collectionName === "studentUser") {
      studentsList = mappedUsers;
    } else {
      staffList = mappedUsers;
    }
    renderUsers();

    const selectedUser = [...studentsList, ...staffList].find(
      (user) =>
        user.id === selectedUserId &&
        user.collectionName === selectedUserCollection,
    );
    if (selectedUser && detailsDialog.open) populateDetails(selectedUser);
  }

  function displayValue(value) {
    return value?.trim() || "Not provided";
  }

  function populateDetails(user) {
    document.getElementById("user-details-name").textContent = user.fullName;
    document.getElementById("user-details-role").textContent = user.role;
    document.getElementById("user-details-status").textContent = user.status;
    document.getElementById("user-detail-full-name").textContent = user.fullName;
    document.getElementById("user-detail-account-number").textContent = user.accountNumber;
    document.getElementById("user-detail-email").textContent = user.email;
    document.getElementById("user-detail-contact").textContent = displayValue(
      user.contactNumber,
    );
    document.getElementById("user-detail-department").textContent = displayValue(
      user.department,
    );
    document.getElementById("user-detail-year-section").textContent = displayValue(
      user.yearSection,
    );
    document.getElementById("user-detail-organization").textContent = displayValue(
      user.organization,
    );
    document.getElementById("user-detail-role").textContent = user.role;
    statusButton.textContent =
      user.status === "Active" ? "Suspend Account" : "Activate Account";
    document.getElementById("view-user-activity").href =
      `SuperAdminAuditLogs.html?user=${encodeURIComponent(user.id)}`;
  }

  async function openDetails(userId, collectionName) {
    try {
      const snapshot = await getDoc(doc(db, collectionName, userId));
      if (!snapshot.exists()) {
        showMessage("This user record no longer exists.", true);
        return;
      }
      const user = normalizeUser(snapshot.id, snapshot.data(), collectionName);
      selectedUserId = snapshot.id;
      selectedUserCollection = collectionName;
      populateDetails(user);
      detailsDialog.showModal();
    } catch (error) {
      console.error("Unable to fetch user document:", error);
      showMessage("Could not load user details. Please try again.", true);
    }
  }

  async function createUser(event) {
    event.preventDefault();
    const values = new FormData(createForm);
    const role = stringValue(values.get("role")).trim();
    const isStaffAccount = ["Admin", "Event Organizer"].includes(role);
    setStaffCredentialFields(role);
    passwordConfirmationInput.setCustomValidity(
      isStaffAccount &&
        passwordConfirmationInput.value !== passwordInput.value
        ? "Passwords do not match."
        : "",
    );
    if (!createForm.reportValidity()) return;
    const fullName = stringValue(values.get("fullName")).trim();
    const accountNo = stringValue(values.get("accountNumber")).trim();
    const email = stringValue(values.get("email")).trim().toLowerCase();
    const contactNumber = stringValue(values.get("contactNumber")).trim();
    const organization = stringValue(values.get("organizationDepartment")).trim();
    const password = passwordInput.value;
    const nameParts = fullName.split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.length > 1 ? nameParts[nameParts.length - 1] : "";
    const middleName = nameParts.slice(1, -1).join(" ");
    const targetCollection = isStaffAccount ? "adminUser" : "studentUser";
    const user = isStaffAccount
      ? {
          fullName,
          firstName,
          lastName,
          middleName,
          email,
          contactNumber,
          organization,
          role,
          accountNo,
          status: "Active",
          isActive: true,
          createdAt: serverTimestamp(),
        }
      : {
          fullName,
          accountNo,
          role,
          email,
          contactNumber,
          organization,
          status: "Active",
          isActive: true,
          createdAt: serverTimestamp(),
        };
    const submitButton = createForm.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      const createdUserId = isStaffAccount
        ? await provisionStaffAccount(email, password, targetCollection, user)
        : (await addDoc(collection(db, targetCollection), user)).id;
      createForm.reset();
      createDialog.close();
      if (isStaffAccount) {
        try {
          await appendUserAudit(
            `Created new ${role} account for ${fullName}`,
            createdUserId,
            targetCollection,
          );
          showMessage(`${role} account created.`);
        } catch (auditError) {
          console.error("Staff account created, but its audit log could not be saved:", auditError);
          showMessage("Account created, but its audit record could not be saved.", true);
        }
      } else {
        showMessage("User account created.");
      }
    } catch (error) {
      console.error("Unable to create user:", error);
      showMessage(
        isStaffAccount
          ? authErrorMessage(error)
          : "Could not create the user. Please try again.",
        true,
      );
    } finally {
      submitButton.disabled = false;
    }
  }

  function superAdminIdentifier() {
    const tag =
      document.querySelector(".account-badge")?.textContent.trim() || "SA1";
    const name =
      document.getElementById("superadmin-name")?.textContent.trim() ||
      "Super Admin";
    return `${tag} – ${name}`;
  }

  async function appendUserAudit(action, targetUserId, targetCollection) {
    await addDoc(collection(db, "audit_logs"), {
      timestamp: serverTimestamp(),
      user: superAdminIdentifier(),
      action,
      category: "User Management",
      targetUserId,
      ...(targetCollection ? { targetCollection } : {}),
    });
  }

  async function toggleUserStatus() {
    const user = [...studentsList, ...staffList].find(
      (item) =>
        item.id === selectedUserId &&
        item.collectionName === selectedUserCollection,
    );
    if (!user || statusButton.disabled || deleteButton.disabled) return;
    const reactivating = user.status.toLowerCase() === "suspended";
    const nextStatus = reactivating ? "Active" : "Suspended";
    statusButton.disabled = true;
    deleteButton.disabled = true;
    try {
      await updateDoc(doc(db, user.collectionName, user.id), {
        status: nextStatus,
        isActive: nextStatus === "Active",
        updatedAt: serverTimestamp(),
      });
      try {
        await appendUserAudit(
          `${reactivating ? "Reactivated" : "Suspended"} account of ${user.fullName}`,
          user.id,
          user.collectionName,
        );
        showMessage(`${user.fullName}'s account was ${reactivating ? "reactivated" : "suspended"}.`);
      } catch (auditError) {
        console.error("Status changed, but its audit log could not be saved:", auditError);
        showMessage("Status changed, but its audit log could not be saved.", true);
      }
      detailsDialog.close();
    } catch (error) {
      console.error("Unable to update user status:", error);
      showMessage("Could not update user status. Please try again.", true);
    } finally {
      statusButton.disabled = false;
      deleteButton.disabled = false;
    }
  }

  async function deleteSelectedUser() {
    const user = [...studentsList, ...staffList].find(
      (item) =>
        item.id === selectedUserId &&
        item.collectionName === selectedUserCollection,
    );
    if (
      !user ||
      statusButton.disabled ||
      deleteButton.disabled ||
      !window.confirm(`Delete ${user.fullName}'s account? This cannot be undone.`)
    ) {
      return;
    }
    statusButton.disabled = true;
    deleteButton.disabled = true;
    try {
      await deleteDoc(doc(db, user.collectionName, user.id));
      const identifier = user.email !== "—" ? user.email : user.accountNumber;
      try {
        await appendUserAudit(
          `Permanently deleted account: ${user.fullName} (${identifier})`,
          user.id,
          user.collectionName,
        );
        showMessage(`${user.fullName}'s account was deleted.`);
      } catch (auditError) {
        console.error("User deleted, but its audit log could not be saved:", auditError);
        showMessage("User deleted, but its audit log could not be saved.", true);
      }
      detailsDialog.close();
    } catch (error) {
      console.error("Unable to delete user:", error);
      showMessage("Could not delete the user. Please try again.", true);
    } finally {
      statusButton.disabled = false;
      deleteButton.disabled = false;
    }
  }

  document.getElementById("create-user-button").addEventListener("click", () => {
    roleDialog.showModal();
    roleDialog.querySelector("[data-select-role]").focus();
  });

  roleDialog.querySelectorAll("[data-select-role]").forEach((button) => {
    button.addEventListener("click", () => {
      const role = button.dataset.selectRole;
      document.getElementById("new-user-role").value = role;
      document.getElementById("new-user-role-value").value = role;
      setStaffCredentialFields(role);
      roleDialog.close();
      createDialog.showModal();
      createForm.elements.fullName.focus();
    });
  });

  createForm.addEventListener("submit", createUser);
  tableBody.addEventListener("click", (event) => {
    const viewButton = event.target.closest("button[data-id]");
    if (viewButton) {
      openDetails(viewButton.dataset.id, viewButton.dataset.collection);
    }
  });
  statusButton.addEventListener("click", toggleUserStatus);
  deleteButton.addEventListener("click", deleteSelectedUser);

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog").close());
  });

  [roleDialog, createDialog, detailsDialog].forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
  });

  createDialog.addEventListener("close", () => {
    createForm.reset();
    setStaffCredentialFields("");
    passwordConfirmationInput.setCustomValidity("");
  });
  detailsDialog.addEventListener("close", () => {
    selectedUserId = null;
    selectedUserCollection = null;
    [
      "user-details-name",
      "user-details-role",
      "user-details-status",
      "user-detail-full-name",
      "user-detail-account-number",
      "user-detail-email",
      "user-detail-contact",
      "user-detail-department",
      "user-detail-year-section",
      "user-detail-organization",
      "user-detail-role",
    ].forEach((id) => {
      document.getElementById(id).textContent = "";
    });
    statusButton.textContent = "Suspend Account";
    document.getElementById("view-user-activity").href =
      "SuperAdminAuditLogs.html";
  });

  if (!isFirebaseConfigured || !db) {
    tableBody.innerHTML =
      '<tr><td class="user-table-empty" colspan="6">User data is unavailable. Please check Firebase configuration.</td></tr>';
    return;
  }

  tableBody.innerHTML =
    '<tr><td class="user-table-empty" colspan="6">Loading user accounts…</td></tr>';
  unsubscribeStudents = onSnapshot(
    collection(db, "studentUser"),
    (snapshot) => {
      console.info("[UserManagement] studentUser snapshot size:", snapshot.size);
      snapshot.docs.forEach((userDocument) => {
        console.debug(
          "[UserManagement] studentUser document:",
          userDocument.id,
          userDocument.data(),
        );
      });
      handleUsersSnapshot("studentUser", snapshot);
    },
    (error) => {
      console.error("Unable to load studentUser accounts:", error);
      showMessage("Could not load student accounts.", true);
    },
  );

  unsubscribeStaff = onSnapshot(
    collection(db, "adminUser"),
    (snapshot) => {
      console.info("[UserManagement] adminUser snapshot size:", snapshot.size);
      snapshot.docs.forEach((userDocument) => {
        console.debug(
          "[UserManagement] adminUser document:",
          userDocument.id,
          userDocument.data(),
        );
      });
      handleUsersSnapshot("adminUser", snapshot);
    },
    (error) => {
      console.error("Unable to load adminUser accounts:", error);
      showMessage("Could not load staff accounts.", true);
    },
  );

  window.addEventListener("beforeunload", () => {
    unsubscribeStudents?.();
    unsubscribeStaff?.();
  });
})();
