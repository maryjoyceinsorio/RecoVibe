const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");

if (!admin.apps.length) {
  admin.initializeApp();
}

const REGION = "asia-southeast1";
const COOLDOWN_MS = 180000; // 3-minute refresh cooldown
const QR_SECRET = process.env.QR_SECRET || "recovibe-secret-pup-binan-qr-key-2026";

/**
 * Generate HMAC signature for <uid>.<version>
 * Signature is the first 22 characters of base64url(HMAC-SHA256(secret, "<uid>.<version>"))
 */
function createSignature(uid, version) {
  return crypto
    .createHmac("sha256", QR_SECRET)
    .update(`${uid}.${version}`)
    .digest("base64url")
    .slice(0, 22);
}

/**
 * Generate permanent token in <uid>.<version>.<signature> format
 */
function generateToken(uid, version) {
  const sig = createSignature(uid, version);
  return `${uid}.${version}.${sig}`;
}

/**
 * Verify token signature using crypto.timingSafeEqual
 */
function verifySignature(uid, version, signature) {
  if (!uid || !version || !signature) return false;
  const expectedSig = createSignature(uid, version);
  const sigBuf = Buffer.from(String(signature));
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

/**
 * Verify caller has role 'event_organizer' or 'admin'
 */
async function verifyOrganizerRole(authData) {
  if (!authData || !authData.uid) {
    throw new HttpsError("unauthenticated", "Caller must be authenticated.");
  }
  const roleSnap = await admin.database().ref(`roles/${authData.uid}`).once("value");
  const role = roleSnap.val();
  if (role !== "event_organizer" && role !== "admin") {
    throw new HttpsError("permission-denied", "Only event organizers and admins can perform this action.");
  }
  return role;
}

/**
 * Helper to fetch student metadata from Firestore
 */
async function getStudentMetadata(uid, fallbackStudentNo = "") {
  try {
    const snap = await admin.firestore().collection("studentUser").doc(uid).get();
    if (snap.exists) {
      const data = snap.data();
      const sName = data.fullName || `${data.firstName || ""} ${data.lastName || ""}`.trim() || "Student";
      const sNo = data.studentNumber || data.studentId || fallbackStudentNo || "—";
      const sOrg = data.organization || "PUP Biñan";
      return { name: sName, studentNo: sNo, organization: sOrg };
    }
  } catch (err) {
    console.warn("Firestore studentUser lookup notice:", err);
  }
  return {
    name: "Student",
    studentNo: fallbackStudentNo || uid,
    organization: "PUP Biñan",
  };
}

/**
 * 1. getMyQrToken()
 * Returns permanent token, live version, and remaining cooldownMs (0 if none)
 */
exports.getMyQrToken = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to view your QR code.");
  }

  const uid = request.auth.uid;
  const versionRef = admin.database().ref(`qrVersions/${uid}`);
  const snap = await versionRef.once("value");
  const data = snap.val() || { v: 1, at: 0 };
  const version = Number(data.v) || 1;
  const lastAt = Number(data.at) || 0;

  const now = Date.now();
  const cooldownMs = Math.max(0, COOLDOWN_MS - (now - lastAt));
  const token = generateToken(uid, version);

  return {
    token,
    version,
    cooldownMs,
  };
});

/**
 * 2. regenerateMyQr()
 * Atomically bumps the student's QR version and returns the new token.
 * Enforces 3-minute cooldown inside a Realtime Database transaction.
 */
exports.regenerateMyQr = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to regenerate your QR code.");
  }

  const uid = request.auth.uid;
  const now = Date.now();
  const versionRef = admin.database().ref(`qrVersions/${uid}`);

  let updatedVersion = 1;
  const txResult = await versionRef.transaction((current) => {
    if (current) {
      const timeSinceLast = now - (Number(current.at) || 0);
      if (timeSinceLast < COOLDOWN_MS) {
        // Still cooling down: abort transaction
        return undefined;
      }
      updatedVersion = (Number(current.v) || 1) + 1;
    } else {
      updatedVersion = 2;
    }
    return { v: updatedVersion, at: now };
  });

  if (!txResult.committed) {
    const snap = await versionRef.once("value");
    const currentData = snap.val() || {};
    const retryAfterMs = Math.max(0, COOLDOWN_MS - (now - (Number(currentData.at) || 0)));
    throw new HttpsError(
      "resource-exhausted",
      "Please wait before refreshing your code again.",
      { retryAfterMs }
    );
  }

  const token = generateToken(uid, updatedVersion);
  return {
    token,
    version: updatedVersion,
    cooldownMs: COOLDOWN_MS,
  };
});

/**
 * 3. recordAttendance({ eventId, token, allowWalkIn })
 * Caller must be event_organizer or admin.
 * Returns: { status: 'ok' | 'already' | 'not_registered', walkIn, student }
 */
exports.recordAttendance = onCall({ region: REGION }, async (request) => {
  await verifyOrganizerRole(request.auth);

  const { eventId, token, allowWalkIn } = request.data || {};
  if (!eventId || !token) {
    throw new HttpsError("invalid-argument", "Missing required parameters: eventId and token.");
  }

  // Parse token: <uid>.<version>.<signature>
  const parts = String(token).trim().split(".");
  if (parts.length !== 3) {
    throw new HttpsError("invalid-argument", "Malformed QR token structure.");
  }
  const [uid, versionStr, signature] = parts;
  const version = Number(versionStr);
  if (!uid || Number.isNaN(version) || version <= 0 || !signature) {
    throw new HttpsError("invalid-argument", "Invalid QR token parameters.");
  }

  // Verify HMAC signature
  if (!verifySignature(uid, version, signature)) {
    throw new HttpsError("invalid-argument", "Invalid QR code signature.");
  }

  // Compare token's version with live version at qrVersions/{uid}
  const versionSnap = await admin.database().ref(`qrVersions/${uid}`).once("value");
  const liveVersionData = versionSnap.val() || { v: 1, at: 0 };
  const liveVersion = Number(liveVersionData.v) || 1;

  if (version !== liveVersion) {
    throw new HttpsError(
      "failed-precondition",
      "This QR code was replaced. Ask the student to download their new one."
    );
  }

  // Check event window and ended status
  const eventSnap = await admin.database().ref(`events/${eventId}`).once("value");
  const eventData = eventSnap.val();
  if (eventData) {
    const now = Date.now();
    if (eventData.endAt) {
      const endTime = new Date(eventData.endAt).getTime();
      if (!Number.isNaN(endTime) && now > endTime) {
        throw new HttpsError("failed-precondition", "This event has already ended.");
      }
    }
    if (eventData.startAt) {
      const startTime = new Date(eventData.startAt).getTime();
      // Allow check-in up to 3 hours before start
      const windowOpen = startTime - 3 * 60 * 60 * 1000;
      if (!Number.isNaN(startTime) && now < windowOpen) {
        throw new HttpsError("failed-precondition", "The check-in window for this event is not open yet.");
      }
    }
  }

  // Fetch student details
  const student = await getStudentMetadata(uid);

  // Check registration: registrations/{eventId}/{uid}
  const regSnap = await admin.database().ref(`registrations/${eventId}/${uid}`).once("value");
  const isRegistered = Boolean(regSnap.val());

  if (!isRegistered && !allowWalkIn) {
    return {
      status: "not_registered",
      student,
    };
  }

  // Record attendance row via atomic transaction (one attendance row per student per event)
  const attendanceRef = admin.database().ref(`attendance/${eventId}/${uid}`);
  let alreadyScannedTime = null;
  const isWalkIn = !isRegistered || Boolean(allowWalkIn);
  const scannedBy = request.auth.token.name || request.auth.token.email || "Event Organizer";

  const txResult = await attendanceRef.transaction((current) => {
    if (current) {
      alreadyScannedTime = current.scannedAt;
      return undefined; // Already checked in: abort write
    }
    return {
      scannedAt: Date.now(),
      scannedBy,
      walkIn: isWalkIn,
      name: student.name,
      studentNo: student.studentNo,
      organization: student.organization,
    };
  });

  if (!txResult.committed) {
    return {
      status: "already",
      student,
      scannedAt: alreadyScannedTime,
    };
  }

  admin
    .database()
    .ref(`publicEvents/${eventId}/checkedInCount`)
    .transaction((cnt) => (cnt || 0) + 1)
    .catch(() => {});

  return {
    status: "ok",
    walkIn: isWalkIn,
    student,
  };
});

/**
 * 4. recordAttendanceByStudentNo({ eventId, studentNo, allowWalkIn })
 * Manual fallback lookup by student number for organizers.
 */
exports.recordAttendanceByStudentNo = onCall({ region: REGION }, async (request) => {
  await verifyOrganizerRole(request.auth);

  const { eventId, studentNo, allowWalkIn } = request.data || {};
  if (!eventId || !studentNo) {
    throw new HttpsError("invalid-argument", "Missing required parameters: eventId and studentNo.");
  }

  const cleanNo = String(studentNo).trim();

  // Find student in Firestore studentUser by studentNumber or studentId
  let studentUid = null;
  let studentData = null;

  const usersRef = admin.firestore().collection("studentUser");
  let querySnap = await usersRef.where("studentNumber", "==", cleanNo).limit(1).get();
  if (querySnap.empty) {
    querySnap = await usersRef.where("studentId", "==", cleanNo).limit(1).get();
  }

  if (!querySnap.empty) {
    const docSnap = querySnap.docs[0];
    studentUid = docSnap.id;
    const d = docSnap.data();
    studentData = {
      name: d.fullName || `${d.firstName || ""} ${d.lastName || ""}`.trim() || "Student",
      studentNo: d.studentNumber || d.studentId || cleanNo,
      organization: d.organization || "PUP Biñan",
    };
  } else {
    // If not found in studentUser collection, search users or fallback
    studentUid = cleanNo.replace(/[^a-zA-Z0-9_-]/g, "_");
    studentData = {
      name: "Student",
      studentNo: cleanNo,
      organization: "PUP Biñan",
    };
  }

  // Check registration
  const regSnap = await admin.database().ref(`registrations/${eventId}/${studentUid}`).once("value");
  const isRegistered = Boolean(regSnap.val());

  if (!isRegistered && !allowWalkIn) {
    return {
      status: "not_registered",
      student: studentData,
    };
  }

  // Record attendance row
  const attendanceRef = admin.database().ref(`attendance/${eventId}/${studentUid}`);
  let alreadyScannedTime = null;
  const isWalkIn = !isRegistered || Boolean(allowWalkIn);
  const scannedBy = request.auth.token.name || request.auth.token.email || "Event Organizer";

  const txResult = await attendanceRef.transaction((current) => {
    if (current) {
      alreadyScannedTime = current.scannedAt;
      return undefined;
    }
    return {
      scannedAt: Date.now(),
      scannedBy,
      walkIn: isWalkIn,
      name: studentData.name,
      studentNo: studentData.studentNo,
      organization: studentData.organization,
    };
  });

  if (!txResult.committed) {
    return {
      status: "already",
      student: studentData,
      scannedAt: alreadyScannedTime,
    };
  }

  admin
    .database()
    .ref(`publicEvents/${eventId}/checkedInCount`)
    .transaction((cnt) => (cnt || 0) + 1)
    .catch(() => {});

  return {
    status: "ok",
    walkIn: isWalkIn,
    student: studentData,
  };
});

/* ==========================================================================
   EVENT ORGANIZER APPROVALS & ATTENDANCE BACKEND CONTRACT
   ========================================================================== */

const APPROVER_DIRECTORY = {
  event_head: { key: "event_head", label: "Event Head", stage: 1, defaultOn: true, required: true },
  vp_doc: { key: "vp_doc", label: "VP for Documentation", stage: 2, defaultOn: true, required: true },
  vp_ext: { key: "vp_ext", label: "VP for External", stage: 3, defaultOn: false, required: false, suggestIf: "outsideGuests" },
  org_pres: { key: "org_pres", label: "Org President", stage: 4, defaultOn: true, required: true },
  org_adv: { key: "org_adv", label: "Org Adviser", stage: 5, defaultOn: true, required: true },
  sir_abelida: { key: "sir_abelida", label: "Sir Abelida", stage: 6, defaultOn: true, required: true },
  hap: { key: "hap", label: "HAP", stage: 7, defaultOn: true, required: true },
  osas: { key: "osas", label: "OSAS", stage: 8, defaultOn: true, required: true },
};

/**
 * Seed approverDirectory in RTDB if empty
 */
async function ensureApproverDirectory() {
  try {
    const dirRef = admin.database().ref("approverDirectory");
    const snap = await dirRef.once("value");
    if (!snap.exists()) {
      await dirRef.set(APPROVER_DIRECTORY);
    }
  } catch (err) {
    console.warn("Could not seed approverDirectory:", err);
  }
}

/**
 * Helper to check that the caller owns the event or is an admin
 */
async function verifyOrganizerEventOwnership(authData, eventId) {
  const role = await verifyOrganizerRole(authData);
  const eventSnap = await admin.database().ref(`events/${eventId}`).once("value");
  const eventData = eventSnap.val();
  if (!eventData) {
    throw new HttpsError("not-found", "The specified event does not exist.");
  }
  if (role !== "admin" && eventData.organizerId !== authData.uid) {
    throw new HttpsError("permission-denied", "You can only view or manage your own events.");
  }
  return { role, eventData };
}

/**
 * 5. getApproverDirectory()
 * Returns the default 8-step approval directory
 */
exports.getApproverDirectory = onCall({ region: REGION }, async (request) => {
  await ensureApproverDirectory();
  const dirSnap = await admin.database().ref("approverDirectory").once("value");
  return dirSnap.val() || APPROVER_DIRECTORY;
});

/**
 * 6. createEventProposal({ name, venue, category, startAt, endAt, outsideGuests, approvers, files })
 */
exports.createEventProposal = onCall({ region: REGION }, async (request) => {
  await verifyOrganizerRole(request.auth);
  await ensureApproverDirectory();

  const {
    name,
    venue,
    category,
    startAt,
    endAt,
    outsideGuests,
    approvers,
    files,
    description,
    source,
    capacity,
  } = request.data || {};
  if (!name || !String(name).trim()) {
    throw new HttpsError("invalid-argument", "Event name is required.");
  }
  if (!startAt) {
    throw new HttpsError("invalid-argument", "Event date and start time are required.");
  }

  // Load approver directory
  const dirSnap = await admin.database().ref("approverDirectory").once("value");
  const directory = dirSnap.val() || APPROVER_DIRECTORY;

  // Validate approvers
  let selectedKeys = Array.isArray(approvers) ? approvers.filter((k) => directory[k]) : [];
  if (selectedKeys.length === 0) {
    // Default to required + defaultOn
    selectedKeys = Object.keys(directory).filter((k) => directory[k].defaultOn || directory[k].required);
  }
  // Ensure required approvers cannot be omitted
  Object.keys(directory).forEach((k) => {
    if (directory[k].required && !selectedKeys.includes(k)) {
      selectedKeys.push(k);
    }
  });

  // Sort by stage ascending
  selectedKeys.sort((a, b) => (directory[a]?.stage || 0) - (directory[b]?.stage || 0));

  const uid = request.auth.uid;
  const callerName = request.auth.token.name || request.auth.token.email || "Event Organizer";
  const eventId = `ev_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const now = Date.now();

  const minStage = selectedKeys.length ? directory[selectedKeys[0]].stage : 1;

  // Build members object and assign sequential step numbers
  const members = {};
  selectedKeys.forEach((key, index) => {
    const dirItem = directory[key];
    const isFirstStage = dirItem.stage === minStage;
    members[key] = {
      key,
      label: dirItem.label,
      stage: dirItem.stage,
      step: index + 1,
      status: isFirstStage ? "review" : "wait",
      note: isFirstStage ? "Reviewing proposal." : "",
      updatedAt: now,
    };
  });

  // Build files object
  const filesMap = {};
  if (Array.isArray(files)) {
    files.forEach((f, idx) => {
      if (f && (f.name || f.path)) {
        const fileId = `file_${idx + 1}_${crypto.randomBytes(2).toString("hex")}`;
        filesMap[fileId] = {
          id: fileId,
          name: f.name || `Document ${idx + 1}`,
          path: f.path || "",
          status: "ok",
          note: "",
          uploadedAt: now,
        };
      }
    });
  }

  const distinctStages = [...new Set(selectedKeys.map((k) => directory[k].stage))].sort((a, b) => a - b);

  const eventPayload = {
    id: eventId,
    eventId,
    name: String(name).trim(),
    title: String(name).trim(),
    venue: String(venue || "PUP Biñan Campus").trim(),
    location: String(venue || "PUP Biñan Campus").trim(),
    category: String(category || "Academic & Learning").trim(),
    startAt: String(startAt),
    endAt: String(endAt || ""),
    description: String(description || request.data?.eventDescription || "").trim(),
    source: String(source || request.data?.eventSource || "Organizational").trim(),
    capacity: Number(capacity || request.data?.maxCapacity || 0) || null,
    outsideGuests: Boolean(outsideGuests),
    organizerId: uid,
    organizerName: callerName,
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };

  const approvalPayload = {
    eventId,
    status: "pending",
    currentStep: 1,
    totalSteps: selectedKeys.length,
    members,
    stages: distinctStages,
    files: filesMap,
    history: [
      {
        action: "submitted",
        by: callerName,
        at: now,
        note: "Event proposal submitted.",
      },
    ],
    submittedAt: now,
  };

  const rootRef = admin.database().ref();
  const updates = {};
  updates[`events/${eventId}`] = eventPayload;
  updates[`approvals/${eventId}`] = approvalPayload;
  updates[`organizerEvents/${uid}/${eventId}`] = {
    id: eventId,
    name: eventPayload.name,
    status: "pending",
    createdAt: now,
  };

  // Add proposal to first stage approver's queue if assigned
  const firstReviewKey = selectedKeys.find((k) => members[k] && members[k].status === "review");
  if (firstReviewKey && directory[firstReviewKey]) {
    const firstDir = directory[firstReviewKey];
    if (firstDir.uid) {
      updates[`approverQueue/${firstDir.uid}/${eventId}`] = {
        eventId,
        name: eventPayload.name,
        title: eventPayload.name,
        date: eventPayload.startAt,
        venue: eventPayload.venue,
        category: eventPayload.category,
        step: members[firstReviewKey].step,
        status: "pending",
        updatedAt: now,
      };
      updates[`notifications/${firstDir.uid}/${eventId}_first_turn`] = {
        eventId,
        type: "review_needed",
        title: "Your Review is Needed",
        message: `Your review is needed for "${eventPayload.name}". (Step ${members[firstReviewKey].step})`,
        read: false,
        createdAt: now,
      };
    }
  }

  await rootRef.update(updates);

  // Send submission confirmation notification
  try {
    const notifRef = admin.database().ref(`notifications/${uid}`).push();
    await notifRef.set({
      eventId,
      title: "Proposal Submitted",
      message: `Your event proposal "${eventPayload.name}" was submitted for review.`,
      read: false,
      createdAt: now,
    });
  } catch (err) {
    console.warn("Could not write notification:", err);
  }

  return {
    success: true,
    eventId,
  };
});

/**
 * 7. replaceFile({ eventId, fileId, path, name })
 */
exports.replaceFile = onCall({ region: REGION }, async (request) => {
  const { eventId, fileId, path, name } = request.data || {};
  if (!eventId || !fileId || !path) {
    throw new HttpsError("invalid-argument", "Missing required parameters: eventId, fileId, path.");
  }
  await verifyOrganizerEventOwnership(request.auth, eventId);

  const fileRef = admin.database().ref(`approvals/${eventId}/files/${fileId}`);
  const snap = await fileRef.once("value");
  if (!snap.exists()) {
    throw new HttpsError("not-found", "The specified document file does not exist.");
  }

  const callerName = request.auth.token.name || request.auth.token.email || "Event Organizer";
  const now = Date.now();

  await fileRef.update({
    path,
    name: name || snap.val().name,
    status: "ok",
    note: "",
    replacedAt: now,
  });

  const historyRef = admin.database().ref(`approvals/${eventId}/history`).push();
  await historyRef.set({
    action: "file_replaced",
    by: callerName,
    at: now,
    fileId,
    note: `Document replaced: ${name || snap.val().name}`,
  });

  return { success: true };
});

/**
 * 8. resubmitEvent({ eventId, note })
 */
exports.resubmitEvent = onCall({ region: REGION }, async (request) => {
  const { eventId, note } = request.data || {};
  if (!eventId) {
    throw new HttpsError("invalid-argument", "Event ID is required.");
  }
  const { eventData } = await verifyOrganizerEventOwnership(request.auth, eventId);

  const approvalRef = admin.database().ref(`approvals/${eventId}`);
  const approvalSnap = await approvalRef.once("value");
  const approvalData = approvalSnap.val() || {};

  if (approvalData.status !== "revision" && eventData.status !== "revision") {
    throw new HttpsError("failed-precondition", "Only proposals with changes requested can be resubmitted.");
  }

  // Block resubmit until every flagged file is replaced
  const files = approvalData.files || {};
  const hasUnreplacedFile = Object.values(files).some((f) => f && f.status === "rev");
  if (hasUnreplacedFile) {
    throw new HttpsError("failed-precondition", "Please replace every requested document before resubmitting.");
  }

  const callerName = request.auth.token.name || request.auth.token.email || "Event Organizer";
  const now = Date.now();

  // Resubmit sends the proposal back to the approver who asked, and everyone earlier keeps their approval
  const members = approvalData.members || {};
  let revKey = null;
  Object.keys(members).forEach((key) => {
    if (members[key].status === "rev") {
      revKey = key;
      members[key].status = "review";
      members[key].updatedAt = now;
      members[key].note = note ? `Resubmitted: ${note}` : "Resubmitted for review.";
    }
  });

  const rootRef = admin.database().ref();
  const updates = {};
  updates[`events/${eventId}/status`] = "pending";
  updates[`events/${eventId}/updatedAt`] = now;
  updates[`approvals/${eventId}/status`] = "pending";
  updates[`approvals/${eventId}/members`] = members;
  updates[`organizerEvents/${eventData.organizerId}/${eventId}/status`] = "pending";

  if (revKey) {
    const dirSnap = await admin.database().ref(`approverDirectory/${revKey}`).once("value");
    const dirItem = dirSnap.val() || APPROVER_DIRECTORY[revKey] || {};
    if (dirItem.uid) {
      updates[`approverQueue/${dirItem.uid}/${eventId}`] = {
        eventId,
        name: eventData.name || "Event",
        title: eventData.name || "Event",
        date: eventData.startAt || "",
        venue: eventData.venue || "",
        category: eventData.category || "",
        step: members[revKey].step,
        status: "pending",
        paused: false,
        updatedAt: now,
      };
      updates[`notifications/${dirItem.uid}/${eventId}_resubmit`] = {
        eventId,
        type: "review_resubmitted",
        title: "Proposal Resubmitted",
        message: `"${eventData.name || "Event"}" was resubmitted for your review.`,
        read: false,
        createdAt: now,
      };
    }
  }

  await rootRef.update(updates);

  const historyRef = admin.database().ref(`approvals/${eventId}/history`).push();
  await historyRef.set({
    action: "resubmitted",
    by: callerName,
    at: now,
    note: note || "Proposal resubmitted with requested updates.",
  });

  return { success: true };
});

/**
 * 9. publishEvent({ eventId })
 */
exports.publishEvent = onCall({ region: REGION }, async (request) => {
  const { eventId } = request.data || {};
  if (!eventId) {
    throw new HttpsError("invalid-argument", "Event ID is required.");
  }
  const { eventData } = await verifyOrganizerEventOwnership(request.auth, eventId);

  const approvalSnap = await admin.database().ref(`approvals/${eventId}`).once("value");
  const approvalData = approvalSnap.val() || {};

  // Check if every member has signed off
  const members = Object.values(approvalData.members || {});
  const allSignedOff = members.length > 0 && members.every((m) => m && m.status === "ok");

  if (!allSignedOff && approvalData.status !== "approved" && eventData.status !== "approved") {
    throw new HttpsError("failed-precondition", "Publish unlocks after every approver signs off.");
  }

  const callerName = request.auth.token.name || request.auth.token.email || "Event Organizer";
  const now = Date.now();

  const rootRef = admin.database().ref();
  const updates = {};
  updates[`events/${eventId}/status`] = "published";
  updates[`events/${eventId}/publishedAt`] = now;
  updates[`events/${eventId}/updatedAt`] = now;
  updates[`approvals/${eventId}/status`] = "published";
  updates[`organizerEvents/${eventData.organizerId}/${eventId}/status`] = "published";

  // Make public for students to discover
  updates[`publicEvents/${eventId}`] = {
    ...eventData,
    description: eventData.description || eventData.eventDescription || "",
    organizerName: eventData.organizerName || callerName,
    source: eventData.source || eventData.eventSource || "Organizational",
    capacity: eventData.capacity !== undefined ? eventData.capacity : (eventData.maxCapacity || null),
    registeredCount: typeof eventData.registeredCount === "number" ? eventData.registeredCount : 0,
    status: "published",
    publishedAt: now,
  };

  await rootRef.update(updates);

  const historyRef = admin.database().ref(`approvals/${eventId}/history`).push();
  await historyRef.set({
    action: "published",
    by: callerName,
    at: now,
    note: "Event published.",
  });

  return { success: true };
});

/**
 * 10. cancelEvent({ eventId, reason })
 */
exports.cancelEvent = onCall({ region: REGION }, async (request) => {
  const { eventId, reason } = request.data || {};
  if (!eventId) {
    throw new HttpsError("invalid-argument", "Event ID is required.");
  }
  const { eventData } = await verifyOrganizerEventOwnership(request.auth, eventId);

  if (eventData.status === "completed") {
    throw new HttpsError("failed-precondition", "Completed events cannot be cancelled.");
  }

  const callerName = request.auth.token.name || request.auth.token.email || "Event Organizer";
  const now = Date.now();

  const rootRef = admin.database().ref();
  const updates = {};
  updates[`events/${eventId}/status`] = "cancelled";
  updates[`events/${eventId}/cancelledAt`] = now;
  updates[`events/${eventId}/updatedAt`] = now;
  updates[`approvals/${eventId}/status`] = "cancelled";
  updates[`organizerEvents/${eventData.organizerId}/${eventId}/status`] = "cancelled";
  updates[`publicEvents/${eventId}`] = null; // remove from public listing

  await rootRef.update(updates);

  const historyRef = admin.database().ref(`approvals/${eventId}/history`).push();
  await historyRef.set({
    action: "cancelled",
    by: callerName,
    at: now,
    note: reason || "Event cancelled by organizer.",
  });

  return { success: true };
});

/**
 * 11. completeEvent({ eventId })
 * Closes check-in, marks unscanned registered students as absent, computes totals.
 */
exports.completeEvent = onCall({ region: REGION }, async (request) => {
  const { eventId } = request.data || {};
  if (!eventId) {
    throw new HttpsError("invalid-argument", "Event ID is required.");
  }
  const { eventData } = await verifyOrganizerEventOwnership(request.auth, eventId);

  if (eventData.status !== "published" && eventData.status !== "approved") {
    throw new HttpsError("failed-precondition", "Only published events can be marked completed.");
  }

  const callerName = request.auth.token.name || request.auth.token.email || "Event Organizer";
  const now = Date.now();

  // Fetch registrations & attendance
  const regSnap = await admin.database().ref(`registrations/${eventId}`).once("value");
  const registrations = regSnap.val() || {};

  const attSnap = await admin.database().ref(`attendance/${eventId}`).once("value");
  const attendance = attSnap.val() || {};

  let checkedInCount = 0;
  let walkInCount = 0;

  Object.values(attendance).forEach((row) => {
    if (row && row.scannedAt) {
      checkedInCount += 1;
      if (row.walkIn) {
        walkInCount += 1;
      }
    }
  });

  // Calculate unscanned registered students and write to absences/{eventId}/{uid}
  let absentCount = 0;
  const absenceUpdates = {};
  Object.keys(registrations).forEach((uid) => {
    if (registrations[uid] && (!attendance[uid] || !attendance[uid].scannedAt)) {
      absentCount += 1;
      absenceUpdates[`absences/${eventId}/${uid}`] = {
        studentUid: uid,
        markedAt: now,
        reason: "unscanned",
      };
    }
  });

  const rootRef = admin.database().ref();
  const updates = {
    ...absenceUpdates,
  };
  updates[`events/${eventId}/status`] = "completed";
  updates[`events/${eventId}/completedAt`] = now;
  updates[`events/${eventId}/updatedAt`] = now;
  updates[`approvals/${eventId}/status`] = "completed";
  updates[`organizerEvents/${eventData.organizerId}/${eventId}/status`] = "completed";
  updates[`publicEvents/${eventId}/status`] = "completed";

  await rootRef.update(updates);

  const totals = {
    checkedIn: checkedInCount,
    walkIns: walkInCount,
    absent: absentCount,
  };

  const historyRef = admin.database().ref(`approvals/${eventId}/history`).push();
  await historyRef.set({
    action: "completed",
    by: callerName,
    at: now,
    note: `Event completed. ${checkedInCount} checked in (${walkInCount} walk-ins), ${absentCount} absent.`,
    totals,
  });

  return {
    success: true,
    totals,
  };
});

/**
 * 12. reopenEvent({ eventId })
 * Allows organizer to reopen event within 24 hours of completion
 */
exports.reopenEvent = onCall({ region: REGION }, async (request) => {
  const { eventId } = request.data || {};
  if (!eventId) {
    throw new HttpsError("invalid-argument", "Event ID is required.");
  }
  const { role, eventData } = await verifyOrganizerEventOwnership(request.auth, eventId);

  if (eventData.status !== "completed") {
    throw new HttpsError("failed-precondition", "Only completed events can be reopened.");
  }

  const completedAt = Number(eventData.completedAt) || 0;
  const now = Date.now();
  const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;

  // Admin powers: allow any admin to reopen a completed event even after 24 hours
  if (role !== "admin" && now - completedAt > TWENTY_FOUR_HOURS) {
    throw new HttpsError("failed-precondition", "Events can only be reopened within 24 hours of completion.");
  }

  const callerName = request.auth.token.name || request.auth.token.email || "Event Organizer";

  const rootRef = admin.database().ref();
  const updates = {};
  updates[`events/${eventId}/status`] = "published";
  updates[`events/${eventId}/completedAt`] = null;
  updates[`events/${eventId}/updatedAt`] = now;
  updates[`approvals/${eventId}/status`] = "published";
  updates[`organizerEvents/${eventData.organizerId}/${eventId}/status`] = "published";
  updates[`absences/${eventId}`] = null; // Clear marked absences upon reopening

  await rootRef.update(updates);

  const historyRef = admin.database().ref(`approvals/${eventId}/history`).push();
  await historyRef.set({
    action: "reopened",
    by: callerName,
    at: now,
    note: "Event reopened for attendance check-in.",
  });

  return { success: true };
});

/**
 * 13. addApprover({ eventId, key })
 */
exports.addApprover = onCall({ region: REGION }, async (request) => {
  const { eventId, key } = request.data || {};
  if (!eventId || !key) {
    throw new HttpsError("invalid-argument", "Missing required parameters: eventId and key.");
  }
  await verifyOrganizerRole(request.auth);

  const dirSnap = await admin.database().ref("approverDirectory").once("value");
  const directory = dirSnap.val() || APPROVER_DIRECTORY;
  const dirItem = directory[key];
  if (!dirItem) {
    throw new HttpsError("not-found", `Approver key "${key}" not found in approver directory.`);
  }

  const approvalRef = admin.database().ref(`approvals/${eventId}`);
  const snap = await approvalRef.once("value");
  if (!snap.exists()) {
    throw new HttpsError("not-found", "Proposal approval record not found.");
  }
  const approval = snap.val() || {};
  const members = approval.members || {};

  if (members[key]) {
    throw new HttpsError("already-exists", "This approver is already in the approval chain.");
  }

  const now = Date.now();
  const callerName = request.auth.token.name || request.auth.token.email || "Administrator";

  members[key] = {
    key,
    label: dirItem.label,
    stage: dirItem.stage,
    status: "wait",
    note: "",
    updatedAt: now,
  };

  // Re-sort and renumber all members
  const memberKeys = Object.keys(members);
  memberKeys.sort((a, b) => (members[a].stage || 0) - (members[b].stage || 0));
  const updatedMembers = {};
  memberKeys.forEach((k, idx) => {
    updatedMembers[k] = {
      ...members[k],
      step: idx + 1,
    };
  });

  const distinctStages = [...new Set(memberKeys.map((k) => updatedMembers[k].stage))].sort((a, b) => a - b);

  await approvalRef.child("members").set(updatedMembers);
  await approvalRef.child("stages").set(distinctStages);
  await approvalRef.child("totalSteps").set(memberKeys.length);

  const historyRef = admin.database().ref(`approvals/${eventId}/history`).push();
  await historyRef.set({
    action: "approver_added",
    by: callerName,
    at: now,
    note: `Added ${dirItem.label} to approval chain.`,
  });

  return { success: true };
});

/**
 * 14. removeApprover({ eventId, key })
 * Removing is only for approvers who have not decided yet, and never leaves a proposal with zero approvers.
 */
exports.removeApprover = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const callerUid = request.auth.uid;
  const roleSnap = await admin.database().ref(`roles/${callerUid}`).once("value");
  if (roleSnap.val() !== "admin") {
    throw new HttpsError("permission-denied", "Only administrators can remove approvers.");
  }

  const { eventId, key } = request.data || {};
  if (!eventId || !key) {
    throw new HttpsError("invalid-argument", "Missing required parameters: eventId and key.");
  }

  const approvalRef = admin.database().ref(`approvals/${eventId}`);
  const snap = await approvalRef.once("value");
  if (!snap.exists()) {
    throw new HttpsError("not-found", "Approval record not found.");
  }

  const approval = snap.val();
  const members = approval.members || {};
  const targetMember = members[key];
  if (!targetMember) {
    throw new HttpsError("not-found", `Approver "${key}" is not part of this proposal.`);
  }

  if (targetMember.status === "ok") {
    throw new HttpsError("failed-precondition", "Cannot remove an approver who has already approved.");
  }

  const remainingKeys = Object.keys(members).filter((k) => k !== key);
  if (remainingKeys.length === 0) {
    throw new HttpsError("failed-precondition", "An event proposal must have at least one approver.");
  }

  const now = Date.now();
  const callerName = request.auth.token.name || request.auth.token.email || "Administrator";
  const wasInReview = targetMember.status === "review";

  const dirSnap = await admin.database().ref("approverDirectory").once("value");
  const directory = dirSnap.val() || APPROVER_DIRECTORY;

  remainingKeys.sort((a, b) => (members[a].stage || 0) - (members[b].stage || 0) || (members[a].step || 0) - (members[b].step || 0));

  const updatedMembers = {};
  remainingKeys.forEach((k, idx) => {
    updatedMembers[k] = {
      ...members[k],
      step: idx + 1,
    };
  });

  const distinctStages = [...new Set(remainingKeys.map((k) => updatedMembers[k].stage))].sort((a, b) => a - b);

  const rootRef = admin.database().ref();
  const updates = {};

  const targetDir = directory[key] || {};
  if (targetDir.uid) {
    updates[`approverQueue/${targetDir.uid}/${eventId}`] = null;
  }

  if (wasInReview) {
    const nextWaitingKey = remainingKeys.find((k) => updatedMembers[k].status === "wait");
    if (nextWaitingKey) {
      updatedMembers[nextWaitingKey].status = "review";
      updatedMembers[nextWaitingKey].updatedAt = now;
      const nextDir = directory[nextWaitingKey] || {};
      if (nextDir.uid) {
        const eventSnap = await admin.database().ref(`events/${eventId}`).once("value");
        const event = eventSnap.val() || {};
        updates[`approverQueue/${nextDir.uid}/${eventId}`] = {
          eventId,
          name: event.name || "Event",
          title: event.name || "Event",
          date: event.startAt || "",
          venue: event.venue || "",
          category: event.category || "",
          step: updatedMembers[nextWaitingKey].step,
          status: "pending",
          updatedAt: now,
        };
        updates[`notifications/${nextDir.uid}/${eventId}_turn`] = {
          eventId,
          type: "review_needed",
          title: "Your Review is Needed",
          message: `Your review is needed for "${event.name}". (Step ${updatedMembers[nextWaitingKey].step})`,
          read: false,
          createdAt: now,
        };
      }
    } else {
      const allOk = remainingKeys.every((k) => updatedMembers[k].status === "ok");
      if (allOk) {
        updates[`approvals/${eventId}/status`] = "approved";
        updates[`events/${eventId}/status`] = "approved";
      }
    }
  }

  updates[`approvals/${eventId}/members`] = updatedMembers;
  updates[`approvals/${eventId}/stages`] = distinctStages;
  updates[`approvals/${eventId}/totalSteps`] = remainingKeys.length;

  const historyKey = rootRef.child(`approvals/${eventId}/history`).push().key;
  updates[`approvals/${eventId}/history/${historyKey}`] = {
    action: "approver_removed",
    by: callerName,
    at: now,
    key,
    label: targetMember.label || key,
    note: `Removed ${targetMember.label || key} from approval chain.`,
  };

  await rootRef.update(updates);
  return { success: true };
});

/**
 * 15. decideApproval({ eventId, key, decision, note, fileId })
 * Only the assigned admin can decide, and only on their turn.
 * Revise needs a note and a file. Reject needs a note.
 */
exports.decideApproval = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const callerUid = request.auth.uid;
  const roleSnap = await admin.database().ref(`roles/${callerUid}`).once("value");
  if (roleSnap.val() !== "admin") {
    throw new HttpsError("permission-denied", "Only administrators can decide event approvals.");
  }

  const { eventId, key, decision, note, fileId } = request.data || {};
  if (!eventId || !key || !decision) {
    throw new HttpsError("invalid-argument", "Missing required parameters: eventId, key, decision.");
  }

  if (!["approve", "revise", "reject"].includes(decision)) {
    throw new HttpsError("invalid-argument", "Invalid decision. Must be 'approve', 'revise', or 'reject'.");
  }

  const approvalRef = admin.database().ref(`approvals/${eventId}`);
  const snap = await approvalRef.once("value");
  if (!snap.exists()) {
    throw new HttpsError("not-found", "Proposal approval record not found.");
  }
  const approval = snap.val();
  const members = approval.members || {};
  const member = members[key];

  if (!member) {
    throw new HttpsError("not-found", `Approver step "${key}" not found on this proposal.`);
  }

  const dirSnap = await admin.database().ref(`approverDirectory/${key}`).once("value");
  const dirItem = dirSnap.val() || APPROVER_DIRECTORY[key] || {};
  if (dirItem.uid && dirItem.uid !== callerUid) {
    throw new HttpsError("permission-denied", `Only the assigned administrator (${dirItem.label || key}) can decide this step.`);
  }

  if (member.status !== "review") {
    if (member.status === "wait") {
      throw new HttpsError("failed-precondition", "It is not your turn yet. Earlier steps must approve first.");
    }
    if (member.status === "ok") {
      throw new HttpsError("failed-precondition", "You have already approved this step.");
    }
    if (member.status === "rev") {
      throw new HttpsError("failed-precondition", "This proposal is currently paused awaiting revisions from the organizer.");
    }
    if (member.status === "rej") {
      throw new HttpsError("failed-precondition", "This proposal was already rejected.");
    }
    throw new HttpsError("failed-precondition", "This proposal is not currently in review for your step.");
  }

  const cleanNote = String(note || "").trim();
  if ((decision === "revise" || decision === "reject") && cleanNote.length < 3) {
    throw new HttpsError("invalid-argument", "A note of at least 3 characters is required when requesting changes or rejecting.");
  }

  if (decision === "revise" && !fileId) {
    throw new HttpsError("invalid-argument", "Please select which document requires revision.");
  }

  const eventSnap = await admin.database().ref(`events/${eventId}`).once("value");
  const event = eventSnap.val() || {};
  const callerName = request.auth.token.name || request.auth.token.email || dirItem.label || "Administrator";
  const now = Date.now();
  const rootRef = admin.database().ref();
  const updates = {};

  if (decision === "approve") {
    members[key].status = "ok";
    members[key].note = cleanNote || "Approved.";
    members[key].updatedAt = now;
    members[key].decidedBy = callerName;

    // Remove from current admin's queue
    updates[`approverQueue/${callerUid}/${eventId}`] = null;

    // Find next waiting member
    const waitingKeys = Object.keys(members)
      .filter((k) => members[k].status === "wait")
      .sort((a, b) => (members[a].stage || 0) - (members[b].stage || 0) || (members[a].step || 0) - (members[b].step || 0));

    if (waitingKeys.length > 0) {
      const nextKey = waitingKeys[0];
      const nextMember = members[nextKey];
      nextMember.status = "review";
      nextMember.updatedAt = now;

      const nextDirSnap = await admin.database().ref(`approverDirectory/${nextKey}`).once("value");
      const nextDir = nextDirSnap.val() || APPROVER_DIRECTORY[nextKey] || {};
      if (nextDir.uid) {
        updates[`approverQueue/${nextDir.uid}/${eventId}`] = {
          eventId,
          name: event.name || "Event",
          title: event.name || "Event",
          date: event.startAt || "",
          venue: event.venue || "",
          category: event.category || "",
          step: nextMember.step,
          status: "pending",
          updatedAt: now,
        };
        updates[`notifications/${nextDir.uid}/${eventId}_turn`] = {
          eventId,
          type: "review_needed",
          title: "Your Review is Needed",
          message: `Your review is needed for "${event.name}". (Step ${nextMember.step})`,
          read: false,
          createdAt: now,
        };
      }
    } else {
      // All approvers finished! Proposal is fully approved
      updates[`approvals/${eventId}/status`] = "approved";
      updates[`events/${eventId}/status`] = "approved";
      if (event.organizerId) {
        updates[`organizerEvents/${event.organizerId}/${eventId}/status`] = "approved";
        updates[`notifications/${event.organizerId}/${eventId}_approved`] = {
          eventId,
          type: "approved",
          title: "Event Proposal Approved",
          message: `Congratulations! Your event proposal "${event.name}" was approved by all approvers. You can now publish it.`,
          read: false,
          createdAt: now,
        };
      }
    }

    updates[`approvals/${eventId}/members`] = members;

    const historyKey = rootRef.child(`approvals/${eventId}/history`).push().key;
    updates[`approvals/${eventId}/history/${historyKey}`] = {
      action: "approved",
      by: callerName,
      at: now,
      key,
      label: dirItem.label || key,
      note: cleanNote || "Approved.",
    };

    updates[`approverDecisions/${callerUid}/${eventId}`] = {
      eventId,
      name: event.name || "Event",
      decision: "Approved",
      note: cleanNote,
      decidedAt: now,
    };

  } else if (decision === "revise") {
    members[key].status = "rev";
    members[key].note = cleanNote;
    members[key].updatedAt = now;
    members[key].decidedBy = callerName;

    if (fileId && approval.files && approval.files[fileId]) {
      updates[`approvals/${eventId}/files/${fileId}/status`] = "rev";
      updates[`approvals/${eventId}/files/${fileId}/note`] = cleanNote;
    }

    updates[`approvals/${eventId}/status`] = "revision";
    updates[`events/${eventId}/status`] = "revision";
    if (event.organizerId) {
      updates[`organizerEvents/${event.organizerId}/${eventId}/status`] = "revision";
      updates[`notifications/${event.organizerId}/${eventId}_revision`] = {
        eventId,
        type: "revision",
        title: "Revisions Requested",
        message: `${callerName} requested changes for "${event.name}": ${cleanNote}`,
        note: cleanNote,
        read: false,
        createdAt: now,
      };
    }

    updates[`approverQueue/${callerUid}/${eventId}`] = {
      eventId,
      name: event.name || "Event",
      title: event.name || "Event",
      date: event.startAt || "",
      venue: event.venue || "",
      category: event.category || "",
      step: member.step,
      status: "paused",
      paused: true,
      updatedAt: now,
    };

    updates[`approvals/${eventId}/members`] = members;

    const historyKey = rootRef.child(`approvals/${eventId}/history`).push().key;
    updates[`approvals/${eventId}/history/${historyKey}`] = {
      action: "revision_requested",
      by: callerName,
      at: now,
      key,
      label: dirItem.label || key,
      note: cleanNote,
      fileId,
    };

    updates[`approverDecisions/${callerUid}/${eventId}`] = {
      eventId,
      name: event.name || "Event",
      decision: "Asked for changes",
      note: cleanNote,
      decidedAt: now,
    };

  } else if (decision === "reject") {
    members[key].status = "rej";
    members[key].note = cleanNote;
    members[key].updatedAt = now;
    members[key].decidedBy = callerName;

    updates[`approvals/${eventId}/status`] = "rejected";
    updates[`events/${eventId}/status`] = "rejected";
    if (event.organizerId) {
      updates[`organizerEvents/${event.organizerId}/${eventId}/status`] = "rejected";
      updates[`notifications/${event.organizerId}/${eventId}_rejected`] = {
        eventId,
        type: "rejected",
        title: "Event Proposal Rejected",
        message: `${callerName} rejected your proposal for "${event.name}": ${cleanNote}`,
        note: cleanNote,
        read: false,
        createdAt: now,
      };
    }

    updates[`approverQueue/${callerUid}/${eventId}`] = null;
    updates[`approvals/${eventId}/members`] = members;

    const historyKey = rootRef.child(`approvals/${eventId}/history`).push().key;
    updates[`approvals/${eventId}/history/${historyKey}`] = {
      action: "rejected",
      by: callerName,
      at: now,
      key,
      label: dirItem.label || key,
      note: cleanNote,
    };

    updates[`approverDecisions/${callerUid}/${eventId}`] = {
      eventId,
      name: event.name || "Event",
      decision: "Rejected",
      note: cleanNote,
      decidedAt: now,
    };
  }

  await rootRef.update(updates);
  return { success: true, decision };
});

/**
 * 16. linkAdminToApprover({ key })
 * Links caller's admin account to a step in approverDirectory and syncs any current pending proposals.
 */
exports.linkAdminToApprover = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }
  const callerUid = request.auth.uid;
  const roleSnap = await admin.database().ref(`roles/${callerUid}`).once("value");
  if (roleSnap.val() !== "admin") {
    throw new HttpsError("permission-denied", "Only administrators can link to approver positions.");
  }

  const { key } = request.data || {};
  if (!key) {
    throw new HttpsError("invalid-argument", "Approver key is required.");
  }

  await ensureApproverDirectory();
  const dirRef = admin.database().ref(`approverDirectory/${key}`);
  const snap = await dirRef.once("value");
  if (!snap.exists()) {
    throw new HttpsError("not-found", `Approver position "${key}" not found.`);
  }

  await dirRef.child("uid").set(callerUid);

  const approvalsSnap = await admin.database().ref("approvals").once("value");
  const approvals = approvalsSnap.val() || {};
  const eventsSnap = await admin.database().ref("events").once("value");
  const events = eventsSnap.val() || {};

  const updates = {};
  const now = Date.now();

  Object.entries(approvals).forEach(([eventId, app]) => {
    if (app && app.members && app.members[key]) {
      const member = app.members[key];
      const ev = events[eventId] || {};
      if (member.status === "review") {
        updates[`approverQueue/${callerUid}/${eventId}`] = {
          eventId,
          name: ev.name || ev.title || "Event",
          title: ev.name || ev.title || "Event",
          date: ev.startAt || "",
          venue: ev.venue || "",
          category: ev.category || "",
          step: member.step,
          status: "pending",
          updatedAt: member.updatedAt || now,
        };
      } else if (member.status === "rev" || app.status === "revision") {
        updates[`approverQueue/${callerUid}/${eventId}`] = {
          eventId,
          name: ev.name || ev.title || "Event",
          title: ev.name || ev.title || "Event",
          date: ev.startAt || "",
          venue: ev.venue || "",
          category: ev.category || "",
          step: member.step,
          status: "paused",
          paused: true,
          updatedAt: member.updatedAt || now,
        };
      }
    }
  });

  if (Object.keys(updates).length > 0) {
    await admin.database().ref().update(updates);
  }

  return { success: true, key, label: snap.val().label };
});

/**
 * 17. remindApprovers({ eventId, keys })
 */
exports.remindApprovers = onCall({ region: REGION }, async (request) => {
  const { eventId, keys } = request.data || {};
  if (!eventId) {
    throw new HttpsError("invalid-argument", "Event ID is required.");
  }
  const { eventData } = await verifyOrganizerEventOwnership(request.auth, eventId);

  const approvalSnap = await admin.database().ref(`approvals/${eventId}`).once("value");
  const approvalData = approvalSnap.val() || {};
  const members = approvalData.members || {};

  const targetKeys = Array.isArray(keys) && keys.length > 0 ? keys : Object.keys(members).filter((k) => members[k].status === "review");
  const callerName = request.auth.token.name || request.auth.token.email || "Event Organizer";
  const now = Date.now();

  const historyRef = admin.database().ref(`approvals/${eventId}/history`).push();
  await historyRef.set({
    action: "reminded",
    by: callerName,
    at: now,
    note: `Reminder sent to ${targetKeys.map((k) => members[k]?.label || k).join(", ")}.`,
  });

  return { success: true, count: targetKeys.length };
});

/**
 * 18. submitCorrectionRequest({ field, message })
 * Saves a student correction request for locked fields to RTDB and Firestore
 */
exports.submitCorrectionRequest = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to submit a correction request.");
  }

  const { field, message } = request.data || {};
  if (!field || typeof field !== "string") {
    throw new HttpsError("invalid-argument", "Please select which detail is wrong.");
  }
  const allowedFields = [
    "Student number",
    "Year and section",
    "Department",
    "Organization",
    "studentNo",
    "yearSection",
    "department",
    "organization",
  ];
  if (!allowedFields.includes(field.trim())) {
    throw new HttpsError("invalid-argument", "Invalid field selected.");
  }

  const trimmedMessage = String(message || "").trim();
  if (trimmedMessage.length < 10) {
    throw new HttpsError("invalid-argument", "Message must be at least 10 characters long.");
  }

  const uid = request.auth.uid;
  const reqRef = admin.database().ref("correctionRequests").push();
  const reqId = reqRef.key;
  const now = admin.database.ServerValue.TIMESTAMP;

  const requestData = {
    uid,
    field: field.trim(),
    message: trimmedMessage,
    status: "open",
    createdAt: now,
  };

  await reqRef.set(requestData);

  try {
    await admin.firestore().collection("correctionRequests").doc(reqId).set({
      ...requestData,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } catch (fsErr) {
    console.warn("Firestore correctionRequests backup notice:", fsErr);
  }

  return { success: true, id: reqId };
});

/**
 * 19. syncUserEmail()
 * Synchronizes verified Firebase Auth email to RTDB users/{uid}/email and Firestore studentUser/{uid}/email via Admin SDK
 */
exports.syncUserEmail = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to sync your email.");
  }

  const uid = request.auth.uid;
  const userRecord = await admin.auth().getUser(uid);
  const authEmail = userRecord.email;

  if (!authEmail) {
    throw new HttpsError("failed-precondition", "No email associated with this account.");
  }

  await admin.database().ref(`users/${uid}/email`).set(authEmail);
  try {
    await admin.firestore().collection("studentUser").doc(uid).set({ email: authEmail }, { merge: true });
  } catch (err) {
    console.warn("Firestore sync email notice:", err);
  }

  return { success: true, email: authEmail };
});

/**
 * 20. initializeStudentProfile({ uid, profile })
 * Admin SDK function to write locked fields (studentNo, yearSection, department, organization, email)
 * to RTDB users/{uid}
 */
exports.initializeStudentProfile = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Caller must be authenticated.");
  }

  const uid = request.auth.uid;
  const data = request.data || {};

  const updates = {
    firstName: String(data.firstName || "").trim(),
    middleName: String(data.middleName || "").trim(),
    lastName: String(data.lastName || "").trim(),
    contactNumber: String(data.contactNumber || data.contact || "").trim(),
    studentNo: String(data.studentNo || data.studentNumber || data.studentId || "").trim(),
    yearSection: String(data.yearSection || data.year || "").trim(),
    department: String(data.department || "").trim(),
    organization: String(data.organization || "").trim(),
    email: String(data.email || request.auth.token?.email || "").trim().toLowerCase(),
    updatedAt: admin.database.ServerValue.TIMESTAMP,
  };

  await admin.database().ref(`users/${uid}`).update(updates);
  return { success: true };
});

/**
 * 21. registerForEvent({ eventId })
 * Callable function for student to register for a published event.
 * Server-enforces capacity via transaction and writes registrations and userRegistrations.
 */
exports.registerForEvent = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to register for an event.");
  }

  const { eventId } = request.data || {};
  if (!eventId || typeof eventId !== "string") {
    throw new HttpsError("invalid-argument", "Event ID is required.");
  }

  const uid = request.auth.uid;
  const rootRef = admin.database().ref();

  // 1. Fetch event from publicEvents (or fallback events)
  const publicEventSnap = await rootRef.child(`publicEvents/${eventId}`).once("value");
  let eventData = publicEventSnap.val();
  if (!eventData) {
    const eventSnap = await rootRef.child(`events/${eventId}`).once("value");
    eventData = eventSnap.val();
  }

  if (!eventData) {
    throw new HttpsError("not-found", "Event not found.");
  }

  // 2. Status check
  if (eventData.status !== "published") {
    throw new HttpsError("failed-precondition", "Registration is closed because this event is not published.");
  }

  // 3. Time check: not ended
  const now = Date.now();
  let endAt = eventData.endAt;
  if (!endAt && eventData.startAt) {
    endAt = eventData.startAt + 3 * 60 * 60 * 1000;
  }
  if (endAt && now >= endAt) {
    throw new HttpsError("failed-precondition", "Registration is closed because this event has ended.");
  }

  // 4. Check if already registered (return success, no double count)
  const userRegSnap = await rootRef.child(`userRegistrations/${uid}/${eventId}`).once("value");
  const existingUserReg = userRegSnap.val();
  const directRegSnap = await rootRef.child(`registrations/${eventId}/${uid}`).once("value");
  if ((existingUserReg && existingUserReg.status === "registered") || directRegSnap.val() === true) {
    return { success: true, message: "Already registered." };
  }

  // 5. Transaction on registeredCount (server-enforced capacity)
  const capacity = (typeof eventData.capacity === "number" && eventData.capacity > 0)
    ? eventData.capacity
    : (eventData.maxCapacity && Number(eventData.maxCapacity) > 0 ? Number(eventData.maxCapacity) : null);

  const countRef = rootRef.child(`publicEvents/${eventId}/registeredCount`);
  let newCount = 0;

  const txResult = await countRef.transaction((currentCount) => {
    const count = (currentCount === null || currentCount === undefined || currentCount < 0) ? 0 : currentCount;
    if (capacity !== null && count >= capacity) {
      // Abort transaction because event is full
      return undefined;
    }
    return count + 1;
  });

  if (!txResult.committed) {
    throw new HttpsError("failed-precondition", "This event is full.");
  }

  newCount = txResult.snapshot.val();

  // 6. Write registrations/{eventId}/{uid} and userRegistrations/{uid}/{eventId}
  try {
    const updates = {};
    updates[`registrations/${eventId}/${uid}`] = true;
    updates[`userRegistrations/${uid}/${eventId}`] = {
      status: "registered",
      at: now,
    };
    updates[`events/${eventId}/registeredCount`] = newCount;
    if (eventData.organizerId) {
      updates[`organizerEvents/${eventData.organizerId}/${eventId}/registeredCount`] = newCount;
    }
    await rootRef.update(updates);
  } catch (err) {
    // Roll back transaction increment if write fails
    console.error("Failed to commit user registration, rolling back count:", err);
    await countRef.transaction((curr) => (curr && curr > 0 ? curr - 1 : 0));
    throw new HttpsError("internal", "Could not complete registration. Please try again.");
  }

  return { success: true, registeredCount: newCount };
});

/**
 * 22. cancelRegistration({ eventId })
 * Callable function for student to cancel registration for an event.
 * Server decrements registeredCount, removes registration, and sets userRegistration status to 'cancelled'.
 */
exports.cancelRegistration = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to cancel your registration.");
  }

  const { eventId } = request.data || {};
  if (!eventId || typeof eventId !== "string") {
    throw new HttpsError("invalid-argument", "Event ID is required.");
  }

  const uid = request.auth.uid;
  const rootRef = admin.database().ref();

  // 1. Fetch event from publicEvents or events
  const publicEventSnap = await rootRef.child(`publicEvents/${eventId}`).once("value");
  let eventData = publicEventSnap.val();
  if (!eventData) {
    const eventSnap = await rootRef.child(`events/${eventId}`).once("value");
    eventData = eventSnap.val();
  }

  // 2. Check if event has ended
  const now = Date.now();
  if (eventData) {
    let endAt = eventData.endAt;
    if (!endAt && eventData.startAt) {
      endAt = eventData.startAt + 3 * 60 * 60 * 1000;
    }
    if (endAt && now >= endAt) {
      throw new HttpsError("failed-precondition", "Registration is closed because this event has ended.");
    }
  }

  // 3. Check if currently registered
  const userRegSnap = await rootRef.child(`userRegistrations/${uid}/${eventId}`).once("value");
  const existingUserReg = userRegSnap.val();
  const directRegSnap = await rootRef.child(`registrations/${eventId}/${uid}`).once("value");
  const isRegistered = (existingUserReg && existingUserReg.status === "registered") || directRegSnap.val() === true;

  if (!isRegistered) {
    return { success: true, message: "Not registered." };
  }

  // 4. Decrement registeredCount atomically
  const countRef = rootRef.child(`publicEvents/${eventId}/registeredCount`);
  let newCount = 0;
  try {
    const txResult = await countRef.transaction((currentCount) => {
      if (currentCount === null || currentCount === undefined || currentCount <= 0) {
        return 0;
      }
      return currentCount - 1;
    });
    newCount = txResult.snapshot ? (txResult.snapshot.val() || 0) : 0;
  } catch (txErr) {
    console.warn("Could not decrement registeredCount transaction:", txErr);
  }

  // 5. Update userRegistrations, remove registrations, and update event copies
  const updates = {};
  updates[`registrations/${eventId}/${uid}`] = null;
  updates[`userRegistrations/${uid}/${eventId}`] = {
    status: "cancelled",
    at: now,
  };
  updates[`events/${eventId}/registeredCount`] = newCount;
  if (eventData && eventData.organizerId) {
    updates[`organizerEvents/${eventData.organizerId}/${eventId}/registeredCount`] = newCount;
  }
  await rootRef.update(updates);

  return { success: true, registeredCount: newCount };
});

