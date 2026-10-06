const pageTitle = document.getElementById("gp-title");
const circuitText = document.getElementById("gp-circuit");
const raceMetadata = document.getElementById("gp-meta");
const backLink = document.getElementById("back-to-calendar");
const reloadButton = document.getElementById("reload-details");
const message = document.getElementById("details-message");
const content = document.getElementById("gp-content");
const scheduleSection = document.getElementById("weekend-schedule");
const scheduleList = document.getElementById("gp-schedule");
const timezoneNote = document.getElementById("timezone-note");
const sessionNavigation = document.getElementById("session-nav");
const sessionSections = document.getElementById("session-sections");

const parameters = new URLSearchParams(window.location.search);
const seasonParameter = parameters.get("season");
const roundParameter = parameters.get("round");
const season = Number(seasonParameter);
const round = Number(roundParameter);

const validQuery =
  /^\d{4}$/.test(seasonParameter || "") &&
  season >= 1950 &&
  season <= new Date().getUTCFullYear() + 1 &&
  /^[1-9]\d?$/.test(roundParameter || "") &&
  round >= 1;

const statusLabels = {
  completed: "Completed",
  upcoming: "Upcoming",
  "in-progress": "In progress",
  "results-pending": "Results pending",
  unavailable: "Results unavailable",
  cancelled: "Cancelled"
};

const emptyResultMessages = {
  completed: "No results are available from the data providers for this session.",
  upcoming: "Results will appear after the session, when the data providers publish them.",
  "in-progress": "The session is in progress. Final results are not available yet.",
  "results-pending": "Results have not been published by the data providers yet.",
  unavailable: "Results are unavailable from the data providers for this session.",
  cancelled: "This session was cancelled."
};

const validKinds = new Set([
  "practice", "qualifying", "race", "sprint", "sprint-qualifying"
]);

const browserTimezone =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "your browser’s local time zone";

function displayValue(value) {
  if (value === null || value === undefined || value === "") {
    return "—";
  }

  if (typeof value !== "string" && typeof value !== "number") {
    return "—";
  }

  return String(value);
}

function createElement(tagName, text, className) {
  const element = document.createElement(tagName);

  if (text !== undefined) {
    element.textContent = text;
  }

  if (className) {
    element.className = className;
  }

  return element;
}

function formatDateOnly(dateString) {
  if (typeof dateString !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return "Date unavailable";
  }

  const date = new Date(dateString + "T00:00:00Z");

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return date.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  });
}

function formatTimestamp(timestamp) {
  if (typeof timestamp !== "string" || !timestamp) {
    return null;
  }

  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short"
  });
}

function sessionTime(session) {
  const start = formatTimestamp(session.startsAt);

  if (start) {
    return start;
  }

  if (session.date) {
    return formatDateOnly(session.date) + " · Start time unavailable";
  }

  return "Date and start time unavailable";
}

function statusBadge(status) {
  const classSuffix = status === "unavailable"
    ? "results-unavailable"
    : status;

  return createElement(
    "span",
    statusLabels[status],
    "race-status status-" + classSuffix
  );
}

function validateDetails(details) {
  if (
    !details ||
    typeof details !== "object" ||
    Number(details.season) !== season ||
    Number(details.round) !== round ||
    typeof details.name !== "string" ||
    !details.name.trim() ||
    !details.circuit ||
    typeof details.circuit !== "object" ||
    !Array.isArray(details.sessions)
  ) {
    throw new Error("The server returned unexpected Grand Prix data.");
  }

  const sessionsAreValid = details.sessions.every(function (session) {
    return session &&
      typeof session === "object" &&
      typeof session.label === "string" &&
      session.label.trim() !== "" &&
      Object.hasOwn(statusLabels, session.status) &&
      validKinds.has(session.kind) &&
      Array.isArray(session.results) &&
      session.results.every(function (result) {
        return result && typeof result === "object" && !Array.isArray(result);
      });
  });

  if (!sessionsAreValid) {
    throw new Error("The server returned unexpected session data.");
  }
}

function resultColumns(kind) {
  if (kind === "practice") {
    return [
      ["Position", "position"], ["Driver", "driver"], ["Team", "team"],
      ["Best lap", "bestLap"], ["Laps", "laps"]
    ];
  }

  if (kind === "qualifying" || kind === "sprint-qualifying") {
    const prefix = kind === "sprint-qualifying" ? "SQ" : "Q";
    return [
      ["Position", "position"], ["Driver", "driver"], ["Team", "team"],
      [prefix + "1", "q1"], [prefix + "2", "q2"], [prefix + "3", "q3"]
    ];
  }

  return [
    ["Position", "position"], ["Driver", "driver"], ["Team", "team"],
    ["Grid", "grid"], ["Laps", "laps"], ["Time / gap", "time"],
    ["Points", "points"], ["Status", "status"], ["Fastest lap", "fastestLap"]
  ];
}

function createResultsTable(session) {
  const columns = resultColumns(session.kind);
  const scrollContainer = createElement("div", undefined, "table-scroll");
  scrollContainer.tabIndex = 0;
  scrollContainer.setAttribute("role", "region");
  scrollContainer.setAttribute("aria-label", session.label + " results table");

  const table = createElement("table", undefined, "results-table");
  table.appendChild(createElement("caption", session.label + " results"));

  const head = createElement("thead");
  const headingRow = createElement("tr");

  columns.forEach(function (column) {
    const heading = createElement("th", column[0]);
    heading.scope = "col";
    headingRow.appendChild(heading);
  });

  head.appendChild(headingRow);
  table.appendChild(head);

  const body = createElement("tbody");

  session.results.forEach(function (result) {
    const row = createElement("tr");

    columns.forEach(function (column) {
      row.appendChild(createElement("td", displayValue(result[column[1]])));
    });

    body.appendChild(row);
  });

  table.appendChild(body);
  scrollContainer.appendChild(table);
  return scrollContainer;
}

function renderDetails(details) {
  pageTitle.textContent = details.name + " " + season;
  document.title = details.name + " " + season + " | F1 News";

  const location = [details.circuit.locality, details.circuit.country]
    .filter(function (part) {
      return typeof part === "string" && part.trim() !== "";
    })
    .join(", ");

  circuitText.textContent = displayValue(details.circuit.name) +
    (location ? " · " + location : "");
  raceMetadata.textContent = "Round " + round + " · Race date: " +
    formatDateOnly(details.date);
  timezoneNote.textContent = "Session times are shown in your local time zone: " +
    browserTimezone + ". Dates without a start time retain the provider’s calendar date.";

  scheduleList.replaceChildren();
  sessionNavigation.replaceChildren();
  sessionSections.replaceChildren();

  details.sessions.forEach(function (session, index) {
    const sectionId = "session-" + (index + 1);
    const anchor = createElement("a", session.label);
    anchor.href = "#" + sectionId;
    sessionNavigation.appendChild(anchor);

    const scheduleItem = createElement("article", undefined, "schedule-item");
    scheduleItem.appendChild(createElement("h3", session.label));
    scheduleItem.appendChild(createElement("p", sessionTime(session), "details-meta"));

    const end = formatTimestamp(session.endsAt);
    if (end) {
      scheduleItem.appendChild(createElement("p", "Ends: " + end, "details-meta"));
    }

    scheduleItem.appendChild(statusBadge(session.status));
    scheduleList.appendChild(scheduleItem);

    const section = createElement("section", undefined, "session-section");
    section.id = sectionId;
    const headingId = sectionId + "-title";
    section.setAttribute("aria-labelledby", headingId);

    const sectionHeader = createElement("div", undefined, "section-heading");
    const heading = createElement("h2", session.label);
    heading.id = headingId;
    sectionHeader.appendChild(heading);
    sectionHeader.appendChild(statusBadge(session.status));
    section.appendChild(sectionHeader);
    section.appendChild(createElement("p", sessionTime(session), "details-meta"));

    if (typeof session.message === "string" && session.message.trim()) {
      section.appendChild(createElement("p", session.message, "session-note"));
    } else if (session.results.length === 0) {
      section.appendChild(createElement(
        "p", emptyResultMessages[session.status], "session-note"
      ));
    }

    if (session.results.length > 0) {
      section.appendChild(createResultsTable(session));
    }

    if (session.source === "Jolpica" || session.source === "OpenF1") {
      section.appendChild(createElement(
        "p", "Results source: " + session.source, "session-note"
      ));
    }

    sessionSections.appendChild(section);
  });

  const hasSessions = details.sessions.length > 0;
  scheduleSection.hidden = !hasSessions;
  sessionNavigation.hidden = !hasSessions;
  message.textContent = hasSessions ? "" : "No sessions are available for this Grand Prix.";
}

async function loadDetails() {
  if (!validQuery || reloadButton.disabled) {
    return;
  }

  reloadButton.disabled = true;
  reloadButton.textContent = "Loading…";
  content.setAttribute("aria-busy", "true");
  message.textContent = "Loading Grand Prix details…";
  let failed = false;

  try {
    const response = await fetch(
      "/api/race-details?season=" + season + "&round=" + round,
      { cache: "no-store" }
    );

    if (!response.ok) {
      const error = new Error("The Grand Prix details could not be loaded.");
      error.status = response.status;
      throw error;
    }

    const details = await response.json();
    validateDetails(details);
    renderDetails(details);
  } catch (error) {
    failed = true;
    message.textContent = error.status === 404
      ? "This Grand Prix was not found. Choose another race from the calendar."
      : "Unable to load Grand Prix details. Please try again.";
    console.error("Grand Prix details error:", error);
  } finally {
    content.setAttribute("aria-busy", "false");
    reloadButton.disabled = false;
    reloadButton.textContent = failed ? "Retry loading details" : "Refresh details";
  }
}

reloadButton.addEventListener("click", loadDetails);

if (validQuery) {
  backLink.href = "/?season=" + season + "#calendar-title";
  loadDetails();
} else {
  content.setAttribute("aria-busy", "false");
  reloadButton.hidden = true;
  message.textContent = "Choose a Grand Prix from the calendar to view its details.";
}
