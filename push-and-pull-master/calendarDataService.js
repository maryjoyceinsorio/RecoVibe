import { fetchMonthHolidays } from "./holidayService.js";

let approvedEventsPromise;

export function loadApprovedFirestoreEvents() {
  if (!approvedEventsPromise) {
    let request;
    request = (async () => {
      try {
        const [{ db, isFirebaseConfigured }, firestore] = await Promise.all([
          import("./UserStudent/firebaseConfig.js"),
          import(
            "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"
          ),
        ]);

        if (!isFirebaseConfigured || !db) return [];

        const snapshot = await firestore.getDocs(
          firestore.collection(db, "events"),
        );
        return snapshot.docs
          .map((eventDocument) => {
            const data = eventDocument.data();
            const status = String(data.status || "")
              .toLowerCase()
              .replace(/[ _-]+/g, " ");
            if (
              !["approved", "published"].includes(status) &&
              data.published !== true
            ) {
              return null;
            }

            return {
              ...data,
              id: eventDocument.id,
              eventId: eventDocument.id,
              title: data.eventName || data.title || "Untitled event",
              dateISO: data.eventDate || data.dateISO || data.date || "",
              time:
                data.time ||
                [data.startTime, data.endTime].filter(Boolean).join(" - ") ||
                "Time TBA",
              source:
                data.source ||
                data.eventSource ||
                (data.organizerId
                  ? "Event Organizer"
                  : data.organization ||
                    data.organizerName ||
                    "Others / External"),
              location: data.venue || data.location || data.venueOther || "",
              description:
                data.eventDescription || data.description || data.desc || "",
            };
          })
          .filter(Boolean);
      } catch (error) {
        console.warn("Approved Firestore calendar events are unavailable:", error);
        if (approvedEventsPromise === request) {
          approvedEventsPromise = undefined;
        }
        return [];
      }
    })();
    approvedEventsPromise = request;
  }
  return approvedEventsPromise;
}

export async function loadCalendarData(currentEvents, year, monthIndex) {
  const [firestoreEvents, holidays] = await Promise.all([
    loadApprovedFirestoreEvents(),
    fetchMonthHolidays(year, monthIndex),
  ]);
  const seen = new Set();
  const events = [...firestoreEvents, ...currentEvents].filter((event) => {
    const id = String(event.eventId || event.id || "");
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  return { events, holidays };
}
