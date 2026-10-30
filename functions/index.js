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
  const isWalkIn = !isRegistered;
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
  const isWalkIn = !isRegistered;
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
  if (!authData || !authData.uid) {
    throw new HttpsError("unauthenticated", "Caller must be authenticated.");
  }
  const roleSnap = await admin.database().ref(`roles/${authData.uid}`).once("value");
  const role = roleSnap.val();
  if (role !== "event_organizer" && role !== "teacher" && role !== "admin") {
    throw new HttpsError("permission-denied", "You do not have permission to manage this event.");
  }
  const eventSnap = await admin.database().ref(`events/${eventId}`).once("value");
  const eventData = eventSnap.val();
  if (!eventData) {
    throw new HttpsError("not-found", "The specified event does not exist.");
  }
  if (role !== "admin" && (eventData.organizerUid || eventData.organizerId) !== authData.uid) {
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

const PROPOSAL_VENUES = {
  "Open Field | PUP Biñan": { maxCapacity: 500, type: "outdoor" },
  "AVR1 | PUP Biñan": { maxCapacity: 150, type: "indoor" },
  "AVR2 | PUP Biñan": { maxCapacity: 100, type: "indoor" },
  "AVR2-1Room | PUP Biñan": { maxCapacity: 40, type: "indoor" },
  "AVR2-2Room | PUP Biñan": { maxCapacity: 40, type: "indoor" },
  "AVR2-3Room | PUP Biñan": { maxCapacity: 40, type: "indoor" },
  "Kiosk | PUP Biñan": { maxCapacity: 50, type: "outdoor" },
  "Open Field | PUP CITE": { maxCapacity: 500, type: "outdoor" },
  "4th Floor | PUP CITE": { maxCapacity: 200, type: "indoor" },
  "Others | Inside PUP": { maxCapacity: 100, type: "indoor" },
  "Others | Outside PUP": { maxCapacity: 200, type: "outdoor" },
  "Online / Virtual": { maxCapacity: 1000, type: "online" },
};

function manilaDateString(timestamp = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(timestamp);
}

function parseTimeMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(String(value || "").trim());
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > 23) return null;
  if (match[3]) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (match[3].toUpperCase() === "PM" ? 12 : 0);
  }
  return hour * 60 + minute;
}

function manilaTimestamp(dateValue, timeValue) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateValue || ""))) return NaN;
  const minutes = parseTimeMinutes(timeValue);
  if (minutes === null) return NaN;
  return Date.parse(`${dateValue}T${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}:00+08:00`);
}

function parseStoredEventTime(value, dateFallback, timeFallback) {
  if (typeof value === "number") return value;
  const text = String(value || "").trim();
  if (!text) return dateFallback && timeFallback ? manilaTimestamp(dateFallback, timeFallback) : NaN;
  const fullMatch = /^(\d{4}-\d{2}-\d{2})[ T](.+)$/.exec(text);
  if (fullMatch) return manilaTimestamp(fullMatch[1], fullMatch[2]);
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? NaN : parsed;
}

function proposalFieldErrors(data, existingEvents, now = Date.now()) {
  const errors = [];
  const add = (field, message) => errors.push({ field, message });
  const name = String(data.eventName || data.name || data.title || "").trim();
  const categories = Array.isArray(data.categories)
    ? data.categories
    : String(data.category || "").split(",").map((item) => item.trim()).filter(Boolean);
  const date = String(data.date || data.dateISO || data.eventDate || "").slice(0, 10);
  const endDate = String(data.dateEnd || data.endDate || data.endDateISO || date).slice(0, 10);
  const timeStart = String(data.timeStart || "").trim();
  const timeEnd = String(data.timeEnd || "").trim();
  const startMinutes = parseTimeMinutes(timeStart);
  const endMinutes = parseTimeMinutes(timeEnd);
  const venue = String(data.venue || data.location || "").trim();
  const venueInfo = PROPOSAL_VENUES[venue];
  const registrationStart = Date.parse(`${String(data.registrationStart || "")}+08:00`);
  const registrationEndValue = data.registrationEnd || data.registrationDeadline || "";
  const registrationEnd = Date.parse(`${String(registrationEndValue).replace(" ", "T")}:00+08:00`);
  const approvalDocuments = Array.isArray(data.approvalDocuments) ? data.approvalDocuments : [];
  const capacity = Number(data.maxCapacity ?? data.capacity);

  if (name.length < 3 || name.length > 120) add("eventName", "Event name must be between 3 and 120 characters.");
  if (categories.length < 1 || categories.length > 3) add("category", "Choose between 1 and 3 event categories.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < manilaDateString(now)) {
    add("eventDate", "Choose an event date that is today or later.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(endDate) || endDate < date) add("eventDateEnd", "The event end date cannot be before its start date.");
  if (startMinutes === null || startMinutes < 480 || startMinutes > 1200) add("timeStart", "Start time must be between 8:00 AM and 8:00 PM.");
  if (endMinutes === null || endMinutes < 480 || endMinutes > 1200) add("timeEnd", "End time must be between 8:00 AM and 8:00 PM.");
  const startAtMs = manilaTimestamp(date, timeStart);
  const endAtMs = manilaTimestamp(endDate, timeEnd);
  if (Number.isFinite(startAtMs) && startAtMs < now) add("timeStart", "Start time must be in the future.");
  if (Number.isFinite(startAtMs) && Number.isFinite(endAtMs) && endAtMs <= startAtMs) add("timeEnd", "End time must be after the start time.");
  if (!venueInfo) add("venue", "Choose a valid venue.");
  if (!Number.isInteger(capacity) || capacity < 1 || (venueInfo && capacity > venueInfo.maxCapacity)) {
    add("maxCapacity", venueInfo
      ? `Capacity must be a whole number from 1 to ${venueInfo.maxCapacity}.`
      : "Capacity must be a positive whole number.");
  }
  if (!data.registrationStart || !Number.isFinite(registrationStart)) add("registrationStart", "Enter a valid registration start date and time.");
  if (!registrationEndValue || !Number.isFinite(registrationEnd)) add("registrationEnd", "Enter a valid registration deadline.");
  if (Number.isFinite(registrationStart) && Number.isFinite(registrationEnd) && registrationStart >= registrationEnd) {
    add("registrationEnd", "Registration must end after it starts.");
  }
  const eventDayEnd = Date.parse(`${endDate}T23:59:59+08:00`);
  if (Number.isFinite(registrationEnd) && Number.isFinite(eventDayEnd) && registrationEnd > eventDayEnd) {
    add("registrationEnd", "Registration deadline cannot be after the event date.");
  }
  const partners = Array.isArray(data.partnerOrganizations) ? data.partnerOrganizations : [];
  if (data.isCollaboration && partners.length < 1) add("partnerOrganizations", "Choose at least one additional department for a collaboration.");
  if (String(data.targetYear || "") === "Specified" && (!Array.isArray(data.targetYears) || data.targetYears.length < 1)) {
    add("targetYear", "Choose at least one target year.");
  }
  if (venueInfo?.type === "outdoor" && !String(data.weatherContingency || "").trim()) {
    add("weatherContingency", "Add a weather contingency plan for this outdoor venue.");
  }
  const contactName = String(data.contactPerson?.name || data.contactName || "").trim();
  const contactEmail = String(data.contactPerson?.email || data.contactEmail || "").trim();
  if (!contactName) add("contactName", "Enter the contact person's name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) add("contactEmail", "Enter a valid contact email address.");
  if (!approvalDocuments.some((document) => document && String(document.name || "").trim())) {
    add("approvalDocs", "Attach at least one required approval document.");
  }

  if (venueInfo && Number.isFinite(startAtMs) && Number.isFinite(endAtMs)) {
    const newVenueKey = venue.startsWith("Others |")
      ? `${venue}|${String(data.customVenueName || "").trim().toLowerCase()}|${String(data.customVenueAddress || "").trim().toLowerCase()}`
      : venue.toLowerCase();
    const conflict = existingEvents.some((event) => {
      if (!event || ["draft", "cancelled", "canceled", "rejected"].includes(String(event.status || "").toLowerCase())) return false;
      const currentVenue = String(event.venue || event.location || "").trim();
      const currentVenueKey = currentVenue.startsWith("Others |")
        ? `${currentVenue}|${String(event.customVenueName || event.venueName || "").trim().toLowerCase()}|${String(event.customVenueAddress || event.venueAddress || "").trim().toLowerCase()}`
        : currentVenue.toLowerCase();
      if (!currentVenueKey || currentVenueKey !== newVenueKey) return false;
      const oldDate = String(event.date || event.dateISO || event.eventDate || "").slice(0, 10);
      const oldStart = parseStoredEventTime(event.startAt, oldDate, event.timeStart);
      const oldEnd = parseStoredEventTime(event.endAt, oldDate, event.timeEnd);
      return Number.isFinite(oldStart) && Number.isFinite(oldEnd) && startAtMs < oldEnd && endAtMs > oldStart;
    });
    if (conflict) add("venue", "This venue is already booked during the selected date and time.");
  }
  return errors;
}

async function getEventCreatorIdentity(uid, role, authData) {
  const [userSnap, authUser] = await Promise.all([
    admin.database().ref(`users/${uid}`).once("value"),
    admin.auth().getUser(uid),
  ]);
  const account = userSnap.val() || {};
  const fullName = [account.firstName, account.middleName, account.lastName].filter(Boolean).join(" ").trim();
  const organizerName = role === "event_organizer"
    ? String(account.organization || account.organizationName || account.orgName || "").trim()
    : String(account.fullName || account.name || fullName || authUser.displayName || authData.token?.name || "").trim();
  if (!organizerName) {
    throw new HttpsError("failed-precondition", "Your account profile is missing the name required to create an event. Update your profile and try again.");
  }
  return { organizerName, source: role === "event_organizer" ? "Organizational" : "Teacher / Faculty" };
}

async function verifyEventCreator(authData) {
  if (!authData || !authData.uid) throw new HttpsError("unauthenticated", "Sign in before creating an event.");
  const roleSnap = await admin.database().ref(`roles/${authData.uid}`).once("value");
  const role = roleSnap.val();
  if (role !== "event_organizer" && role !== "teacher") {
    throw new HttpsError("permission-denied", "Only event organizers and teachers can create events.");
  }
  return role;
}

function validateDraftId(draftId) {
  return typeof draftId === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(draftId);
}

exports.saveEventDraft = onCall({ region: REGION }, async (request) => {
  const role = await verifyEventCreator(request.auth);
  const data = request.data || {};
  const name = String(data.eventName || data.name || data.title || "").trim();
  if (name.length < 3 || name.length > 120) {
    throw new HttpsError("invalid-argument", "Event name must be between 3 and 120 characters.", {
      fields: [{ field: "eventName", message: "Event name must be between 3 and 120 characters." }],
    });
  }
  const uid = request.auth.uid;
  const draftId = data.draftId ? data.draftId : `draft_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`;
  if (!validateDraftId(draftId)) throw new HttpsError("invalid-argument", "Draft ID is invalid.");
  const rootRef = admin.database().ref();
  const draftRef = rootRef.child(`drafts/${uid}/${draftId}`);
  const existing = await draftRef.once("value");
  if (!existing.exists()) {
    const draftsSnap = await rootRef.child(`drafts/${uid}`).once("value");
    if (Object.keys(draftsSnap.val() || {}).length >= 20) {
      throw new HttpsError("resource-exhausted", "You can keep up to 20 drafts. Delete a draft before saving another.");
    }
  }
  const identity = await getEventCreatorIdentity(uid, role, request.auth);
  const draft = { ...data };
  delete draft.draftId;
  delete draft.organizerUid;
  delete draft.createdByRole;
  delete draft.organizerName;
  delete draft.organizerId;
  delete draft.createdBy;
  draft.name = name;
  draft.eventName = name;
  draft.status = "draft";
  draft.source = identity.source;
  draft.organizerName = identity.organizerName;
  draft.organizerUid = uid;
  draft.createdByRole = role;
  draft.updatedAt = Date.now();
  if (!existing.exists()) draft.createdAt = draft.updatedAt;
  await draftRef.set(draft);
  return { draftId };
});

/**
 * Admin-only: rebuild organizerEvents/{uid} index from events/{id}.organizerUid
 * Requires confirmation flag: confirmed === true
 * Must not change any event.
 */
exports.rebuildOrganizerEventsIndex = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "Sign in before performing this action.");
  }
  const roleSnap = await admin.database().ref(`roles/${request.auth.uid}`).once("value");
  if (roleSnap.val() !== "admin") {
    throw new HttpsError("permission-denied", "Only administrators can rebuild the organizer events index.");
  }
  const { confirmed } = request.data || {};
  if (confirmed !== true) {
    throw new HttpsError(
      "failed-precondition",
      "Action requires explicit confirmation. Pass { confirmed: true } to proceed."
    );
  }

  const rootRef = admin.database().ref();
  const eventsSnap = await rootRef.child("events").once("value");
  const events = eventsSnap.val() || {};
  const updates = {};
  let count = 0;

  for (const [eventId, event] of Object.entries(events)) {
    if (!event) continue;
    const uid = event.organizerUid || event.organizerId;
    if (uid && typeof uid === "string") {
      updates[`organizerEvents/${uid}/${eventId}`] = true;
      count++;
    }
  }

  if (Object.keys(updates).length > 0) {
    await rootRef.update(updates);
  }

  return { success: true, indexedEventsCount: count };
});

/**
 * 6. createEventProposal({ clientRequestId, draftId?, ...form })
 */
exports.createEventProposal = onCall({ region: REGION }, async (request) => {
  const role = await verifyEventCreator(request.auth);
  await ensureApproverDirectory();
  const uid = request.auth.uid;
  const data = request.data || {};
  const requestId = String(data.clientRequestId || "").trim();
  if (!requestId || requestId.length > 120) {
    throw new HttpsError("invalid-argument", "A submission request ID is required.");
  }
  const requestKey = crypto.createHash("sha256").update(requestId).digest("hex");
  const rootRef = admin.database().ref();
  const requestRef = rootRef.child(`eventRequestIds/${uid}/${requestKey}`);
  const priorEventId = (await requestRef.once("value")).val();
  if (typeof priorEventId === "string") return { eventId: priorEventId };

  const now = Date.now();
  const eventsSnap = await rootRef.child("events").once("value");
  const errors = proposalFieldErrors(data, Object.values(eventsSnap.val() || {}), now);
  if (errors.length) {
    throw new HttpsError("invalid-argument", "Please fix the highlighted fields before submitting.", { fields: errors });
  }
  if (data.draftId && !validateDraftId(data.draftId)) {
    throw new HttpsError("invalid-argument", "Draft ID is invalid.");
  }
  const draftRef = data.draftId ? rootRef.child(`drafts/${uid}/${data.draftId}`) : null;
  const draftSnap = draftRef ? await draftRef.once("value") : null;
  if (data.draftId && !draftSnap.exists()) {
    throw new HttpsError("invalid-argument", "This draft is no longer available. Save it again before submitting.");
  }

  const limitRef = rootRef.child(`eventSubmissionLimits/${uid}`);
  const limitResult = await limitRef.transaction((current) => {
    const recent = (Array.isArray(current) ? current : []).filter((timestamp) => Number(timestamp) > now - 60 * 60 * 1000);
    if (recent.length >= 10) return;
    recent.push(now);
    return recent;
  });
  if (!limitResult.committed) {
    throw new HttpsError("resource-exhausted", "You are submitting too fast. Try again in a few minutes.");
  }

  const identity = await getEventCreatorIdentity(uid, role, request.auth);
  const settingsSnap = await admin.firestore().collection("system_settings").doc("global_config").get();
  const configuredStages = settingsSnap.exists && Array.isArray(settingsSnap.data()?.approvalStages)
    ? settingsSnap.data().approvalStages
    : null;
  const directorySnap = await rootRef.child("approverDirectory").once("value");
  const directory = directorySnap.val() || APPROVER_DIRECTORY;
  const submittedApprovers = new Set(Array.isArray(data.approvers) ? data.approvers.map(String) : []);
  const stageList = configuredStages?.length
    ? configuredStages.map((stage, index) => ({
      id: String(stage.id || `stage-${index + 1}`),
      label: String(stage.name || `Stage ${index + 1}`),
      reviewer: String(stage.reviewer || stage.name || ""),
      required: stage.required !== false,
      order: index + 1,
      uid: stage.uid || stage.reviewerUid || stage.userId || "",
    })).filter((stage) => stage.required || submittedApprovers.has(stage.id))
    : Object.entries(directory).map(([id, stage], index) => ({
      id,
      label: String(stage.label || stage.name || id),
      reviewer: String(stage.reviewer || stage.label || stage.name || id),
      required: Boolean(stage.required),
      order: Number(stage.stage) || index + 1,
      uid: stage.uid || stage.reviewerUid || "",
    })).filter((stage) => stage.required || stage.defaultOn || submittedApprovers.has(stage.id));
  if (!stageList.length) throw new HttpsError("failed-precondition", "No approval stages are configured. Contact an administrator.");
  stageList.sort((first, second) => first.order - second.order);

  const eventId = `ev_${now}_${crypto.randomBytes(5).toString("hex")}`;
  const eventName = String(data.eventName || data.name || data.title).trim();
  const venue = String(data.venue || data.location).trim();
  const date = String(data.date || data.dateISO || data.eventDate).slice(0, 10);
  const dateEnd = String(data.dateEnd || data.endDate || data.endDateISO || date).slice(0, 10);
  const timeStart = String(data.timeStart).trim();
  const timeEnd = String(data.timeEnd).trim();
  const startAt = `${date} ${timeStart}`;
  const endAt = `${dateEnd} ${timeEnd}`;
  const eventPayload = {
    ...data,
    id: eventId,
    eventId,
    name: eventName,
    title: eventName,
    venue,
    location: venue,
    category: Array.isArray(data.categories) ? data.categories.join(", ") : String(data.category || ""),
    startAt,
    endAt,
    organizerUid: uid,
    createdByRole: role,
    organizerName: identity.organizerName,
    source: identity.source,
    organizerId: uid,
    createdBy: uid,
    creatorRole: role === "event_organizer" ? "Event Organizer" : "Teacher",
    status: "pending",
    createdAt: now,
    updatedAt: now,
  };
  delete eventPayload.clientRequestId;
  delete eventPayload.draftId;

  const members = {};
  const firstStage = stageList[0];
  stageList.forEach((stage, index) => {
    members[stage.id] = {
      key: stage.id,
      label: stage.reviewer || stage.label,
      stage: stage.order,
      step: index + 1,
      status: index === 0 ? "review" : "wait",
      note: index === 0 ? "Reviewing proposal." : "",
      updatedAt: now,
    };
  });
  const approvalFiles = {};
  (Array.isArray(data.approvalDocuments) ? data.approvalDocuments : []).forEach((file, index) => {
    if (!file || !String(file.name || "").trim()) return;
    const fileId = `file_${index + 1}_${crypto.randomBytes(2).toString("hex")}`;
    approvalFiles[fileId] = {
      id: fileId,
      name: String(file.name).slice(0, 255),
      path: String(file.path || file.url || "").slice(0, 2048),
      status: "ok",
      note: "",
      uploadedAt: now,
    };
  });
  const approvalPayload = {
    eventId,
    status: "pending",
    currentStep: 1,
    totalSteps: stageList.length,
    members,
    stages: [...new Set(stageList.map((stage) => stage.order))],
    files: approvalFiles,
    history: [{ action: "submitted", by: identity.organizerName, at: now, note: "Event proposal submitted." }],
    submittedAt: now,
  };

  const updates = {
    [`events/${eventId}`]: eventPayload,
    [`approvals/${eventId}`]: approvalPayload,
    [`organizerEvents/${uid}/${eventId}`]: true,
    [`eventRequestIds/${uid}/${requestKey}`]: eventId,
    [`notifications/${uid}/${eventId}_submitted`]: {
      eventId,
      type: "proposal_submitted",
      title: "Proposal Submitted",
      message: `Your event proposal "${eventName}" was submitted for review.`,
      read: false,
      createdAt: now,
    },
  };
  if (draftRef) updates[`drafts/${uid}/${data.draftId}`] = null;

  const assignedReviewerUids = new Set([firstStage.uid].filter(Boolean).map(String));
  if (!assignedReviewerUids.size) {
    const rolesSnap = await rootRef.child("roles").once("value");
    Object.entries(rolesSnap.val() || {}).forEach(([reviewerUid, reviewerRole]) => {
      if (reviewerRole === "admin") assignedReviewerUids.add(reviewerUid);
    });
  }
  assignedReviewerUids.forEach((reviewerUid) => {
    updates[`approverQueue/${reviewerUid}/${eventId}`] = {
      eventId,
      name: eventName,
      title: eventName,
      date: startAt,
      venue,
      category: eventPayload.category,
      step: 1,
      status: "pending",
      updatedAt: now,
    };
    updates[`notifications/${reviewerUid}/${eventId}_first_turn`] = {
      eventId,
      type: "review_needed",
      title: "Your Review is Needed",
      message: `Your review is needed for "${eventName}" (${firstStage.label}).`,
      read: false,
      createdAt: now,
    };
  });

  await rootRef.update(updates);
  return { eventId, firstReviewer: firstStage.label };
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
    organization: eventData.organization || eventData.department || eventData.organizerName || callerName,
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

/**
 * 23. setFavorite({ eventId, favorite, replaceEventId, allowDuplicate, title })
 * Callable function for organizer to favorite/unfavorite events.
 * Runs in a transaction on reuseLibrary/{uid}, checks event ownership,
 * enforces 5-favorites limit and duplicate title check.
 */
exports.setFavorite = onCall({ region: REGION }, async (request) => {
  if (!request.auth || !request.auth.uid) {
    throw new HttpsError("unauthenticated", "You must be signed in to manage favorites.");
  }

  const uid = request.auth.uid;
  const { eventId, favorite, replaceEventId, allowDuplicate, title: clientTitle } = request.data || {};

  if (!eventId || typeof eventId !== "string") {
    throw new HttpsError("invalid-argument", "Event ID is required.");
  }

  const isFavorite = Boolean(favorite);
  const rootRef = admin.database().ref();

  // 1. Verify event ownership
  const orgEventSnap = await rootRef.child(`organizerEvents/${uid}/${eventId}`).once("value");
  const eventSnap = await rootRef.child(`events/${eventId}`).once("value");
  const publicSnap = await rootRef.child(`publicEvents/${eventId}`).once("value");

  const orgEvent = orgEventSnap.val();
  const mainEvent = eventSnap.val();
  const pubEvent = publicSnap.val();

  const isOwned =
    Boolean(orgEvent) ||
    (mainEvent && (mainEvent.organizerId === uid || mainEvent.createdBy === uid || mainEvent.teacherId === uid)) ||
    (pubEvent && (pubEvent.organizerId === uid || pubEvent.createdBy === uid)) ||
    eventId.startsWith("seed-") ||
    eventId.startsWith("org-") ||
    eventId.startsWith("tch-");

  if (!isOwned) {
    throw new HttpsError("permission-denied", "You can only manage favorites for your own events.");
  }

  let targetEventTitle = (
    clientTitle ||
    orgEvent?.name ||
    orgEvent?.title ||
    mainEvent?.name ||
    mainEvent?.title ||
    pubEvent?.name ||
    pubEvent?.title ||
    ""
  ).trim();

  // If replacing, verify ownership of replaceEventId too
  if (replaceEventId) {
    if (typeof replaceEventId !== "string") {
      throw new HttpsError("invalid-argument", "Replace Event ID must be a string.");
    }
    const repOrgSnap = await rootRef.child(`organizerEvents/${uid}/${replaceEventId}`).once("value");
    const repEventSnap = await rootRef.child(`events/${replaceEventId}`).once("value");
    const repMain = repEventSnap.val();
    const isRepOwned =
      Boolean(repOrgSnap.val()) ||
      (repMain && (repMain.organizerId === uid || repMain.createdBy === uid || repMain.teacherId === uid)) ||
      replaceEventId.startsWith("seed-") ||
      replaceEventId.startsWith("org-") ||
      replaceEventId.startsWith("tch-");

    if (!isRepOwned) {
      throw new HttpsError("permission-denied", "You can only replace your own events.");
    }
  }

  // 2. Duplicate title check if setting favorite to true
  const reuseRef = rootRef.child(`reuseLibrary/${uid}`);

  if (isFavorite && !allowDuplicate && targetEventTitle) {
    const reuseSnap = await reuseRef.once("value");
    const currentReuse = reuseSnap.val() || {};
    const lowerTarget = targetEventTitle.toLowerCase();

    for (const [key, data] of Object.entries(currentReuse)) {
      if (data && data.favorite === true && key !== eventId && key !== replaceEventId) {
        let existingTitle = "";
        const kOrgSnap = await rootRef.child(`organizerEvents/${uid}/${key}`).once("value");
        const kEventSnap = await rootRef.child(`events/${key}`).once("value");
        const kPubSnap = await rootRef.child(`publicEvents/${key}`).once("value");
        existingTitle = (
          kOrgSnap.val()?.name || kOrgSnap.val()?.title ||
          kEventSnap.val()?.name || kEventSnap.val()?.title ||
          kPubSnap.val()?.name || kPubSnap.val()?.title || ""
        ).trim();

        if (existingTitle && existingTitle.toLowerCase() === lowerTarget) {
          throw new HttpsError("already-exists", "A favorite with this name already exists.");
        }
      }
    }
  }

  // 3. Run Transaction on reuseLibrary/{uid}
  let txError = null;
  const txResult = await reuseRef.transaction((current) => {
    const data = current || {};
    const now = Date.now();

    if (isFavorite) {
      let favCount = 0;
      for (const [k, item] of Object.entries(data)) {
        if (item && item.favorite === true && k !== eventId && k !== replaceEventId) {
          favCount++;
        }
      }

      if (favCount >= 5) {
        txError = "Favorites are full.";
        return undefined; // abort transaction
      }

      if (replaceEventId && data[replaceEventId]) {
        data[replaceEventId] = {
          ...data[replaceEventId],
          favorite: false,
          updatedAt: now,
        };
      }

      data[eventId] = {
        ...(data[eventId] || {}),
        favorite: true,
        hidden: data[eventId]?.hidden || false,
        updatedAt: now,
      };
    } else {
      if (data[eventId]) {
        data[eventId] = {
          ...data[eventId],
          favorite: false,
          updatedAt: now,
        };
      } else {
        data[eventId] = {
          favorite: false,
          hidden: false,
          updatedAt: now,
        };
      }
    }

    return data;
  });

  if (!txResult.committed) {
    if (txError === "Favorites are full.") {
      throw new HttpsError("failed-precondition", "Favorites are full.");
    }
    throw new HttpsError("aborted", "Could not update favorites. Please try again.");
  }

  return {
    success: true,
    eventId,
    favorite: isFavorite,
    replacedEventId: replaceEventId || null,
  };
});
