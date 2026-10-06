const newsList = document.getElementById("news-list");
const newsTemplate = document.getElementById("news-card-template");
const newsMessage = document.getElementById("news-message");
const refreshNewsButton = document.getElementById("refresh-news");
const searchInput = document.getElementById("news-search");

const calendarList = document.getElementById("calendar-list");
const calendarMessage = document.getElementById("calendar-message");
const calendarTitle = document.getElementById("calendar-title");
const seasonSelect = document.getElementById("season-select");
const refreshCalendarButton = document.getElementById("refresh-calendar");

let allArticles = [];

const statusLabels = {
  "completed": "Completed",
  "upcoming": "Upcoming",
  "race-today": "Race today",
  "results-pending": "Results pending",
  "results-unavailable": "Results unavailable"
};

async function getJSON(url) {
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(
      "Request failed: " + url + " (HTTP " + response.status + ")"
    );
  }

  return response.json();
}

function renderNews() {
  const searchText = searchInput.value.trim().toLowerCase();

  const matchingArticles = allArticles.filter(function (article) {
    return article.title.toLowerCase().includes(searchText);
  });

  newsList.replaceChildren();

  if (matchingArticles.length === 0) {
    newsMessage.textContent = allArticles.length === 0
      ? "No news available right now."
      : "No headlines match your search.";

    return;
  }

  newsMessage.textContent = "";
  const fragment = document.createDocumentFragment();

  matchingArticles.forEach(function (article) {
    const card = newsTemplate.content.firstElementChild.cloneNode(true);

    let metadata = article.source;
    const date = new Date(article.publishedAt);

    if (article.publishedAt && !Number.isNaN(date.getTime())) {
      metadata += " · " + date.toLocaleDateString("en-GB", {
        day: "numeric",
        month: "short",
        year: "numeric"
      });
    }

    card.querySelector("h3").textContent = article.title;
    card.querySelector("p").textContent = metadata;
    card.querySelector("a").href = article.url;

    fragment.appendChild(card);
  });

  newsList.appendChild(fragment);
}

async function loadNews() {
  refreshNewsButton.disabled = true;
  searchInput.disabled = true;

  newsList.setAttribute("aria-busy", "true");
  newsMessage.textContent = "Loading F1 news...";

  try {
    const articles = await getJSON("/api/news");

    if (!Array.isArray(articles)) {
      throw new Error("Unexpected news data.");
    }

    allArticles = articles;
    renderNews();
  } catch (error) {
    newsMessage.textContent = allArticles.length > 0
      ? "Unable to refresh news. Showing previously loaded headlines."
      : "Unable to load news. Click Refresh news to retry.";

    console.error(error);
  } finally {
    refreshNewsButton.disabled = false;
    searchInput.disabled = allArticles.length === 0;
    newsList.setAttribute("aria-busy", "false");
  }
}

function createTextElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function formatRaceDate(value) {
  const date = new Date(value + "T00:00:00Z");

  if (Number.isNaN(date.getTime())) {
    return "Date unavailable";
  }

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  });
}

function renderCalendar(data) {
  calendarList.replaceChildren();

  if (data.races.length === 0) {
    calendarMessage.textContent = "No races are listed for this season.";
    return;
  }

  calendarMessage.textContent = data.resultsAvailable === false
    ? "Race winners are temporarily unavailable. Dates and circuits are shown."
    : data.races.length + " races";

  const fragment = document.createDocumentFragment();

  data.races.forEach(function (race) {
    const card = document.createElement("article");
    card.className = "race-card";
    const link = document.createElement("a");
    link.className = "race-card-link";
    link.href = "/grand-prix.html?season=" + race.season + "&round=" + race.round;

    const status = Object.hasOwn(statusLabels, race.status)
      ? race.status
      : "results-pending";

    link.appendChild(createTextElement(
      "span",
      "race-status status-" + status,
      statusLabels[status]
    ));

    link.appendChild(createTextElement(
      "h3",
      "race-title",
      "Round " + race.round + " · " + race.name
    ));

    link.appendChild(createTextElement(
      "p",
      "race-date",
      formatRaceDate(race.date)
    ));

    link.appendChild(createTextElement(
      "p",
      "race-circuit",
      race.circuit.name
    ));

    const location = [
      race.circuit.locality,
      race.circuit.country
    ].filter(Boolean).join(" · ");

    if (location) {
      link.appendChild(createTextElement(
        "p",
        "race-location",
        location
      ));
    }

    let winnerText = statusLabels[status];

    if (race.winner) {
      winnerText = "Winner: " + race.winner.name;

      if (race.winner.team) {
        winnerText += " · " + race.winner.team;
      }
    }

    link.appendChild(createTextElement(
      "p",
      "race-winner",
      winnerText
    ));
    link.appendChild(createTextElement("span", "view-weekend", "View weekend →"));
    card.appendChild(link);

    fragment.appendChild(card);
  });

  calendarList.appendChild(fragment);
}

async function loadCalendar() {
  const season = seasonSelect.value;

  if (!season) {
    return loadSeasons();
  }

  seasonSelect.disabled = true;
  refreshCalendarButton.disabled = true;

  calendarList.setAttribute("aria-busy", "true");
  calendarList.replaceChildren();

    calendarTitle.textContent = season + " race calendar";
  calendarMessage.textContent = "Loading " + season + " races...";

  try {
    const data = await getJSON("/api/calendar?season=" + season);

    if (
      !data ||
      !Array.isArray(data.races) ||
      data.season !== Number(season)
    ) {
      throw new Error("Unexpected calendar data.");
    }

    renderCalendar(data);
    const pageUrl = new URL(location.href);
    pageUrl.searchParams.set("season", season);
    history.replaceState(null, "", pageUrl);
  } catch (error) {
    calendarMessage.textContent =
      "Unable to load this calendar. Click Refresh calendar to retry.";

    console.error(error);
  } finally {
    seasonSelect.disabled = false;
    refreshCalendarButton.disabled = false;
    calendarList.setAttribute("aria-busy", "false");
  }
}

async function loadSeasons() {
  seasonSelect.disabled = true;
  refreshCalendarButton.disabled = true;

  calendarMessage.textContent = "Loading available seasons...";
  calendarList.setAttribute("aria-busy", "true");

  try {
    const seasons = await getJSON("/api/seasons");

    if (!Array.isArray(seasons) || seasons.length === 0) {
      throw new Error("No seasons available.");
    }

    seasonSelect.replaceChildren();

    seasons.forEach(function (year) {
      const option = document.createElement("option");
      option.value = String(year);
      option.textContent = String(year);
      seasonSelect.appendChild(option);
    });

    const currentYear = new Date().getUTCFullYear();

    const requestedYear = Number(new URLSearchParams(location.search).get("season"));
    const initialYear = seasons.includes(requestedYear)
      ? requestedYear
      : seasons.includes(currentYear) ? currentYear : seasons.find(function (year) {
          return year <= currentYear;
        }) || seasons[0];

    seasonSelect.value = String(initialYear);

    await loadCalendar();
  } catch (error) {
    seasonSelect.replaceChildren();

    const option = document.createElement("option");
    option.value = "";
    option.textContent = "Seasons unavailable";
    seasonSelect.appendChild(option);

    calendarMessage.textContent =
      "Unable to load seasons. Click Refresh calendar to retry.";

    console.error(error);
  } finally {
    seasonSelect.disabled = !seasonSelect.value;
    refreshCalendarButton.disabled = false;
    calendarList.setAttribute("aria-busy", "false");
  }
}

refreshNewsButton.addEventListener("click", loadNews);
searchInput.addEventListener("input", renderNews);
seasonSelect.addEventListener("change", loadCalendar);

refreshCalendarButton.addEventListener("click", function () {
  if (seasonSelect.value) {
    loadCalendar();
  } else {
    loadSeasons();
  }
});

loadNews();
loadSeasons();
