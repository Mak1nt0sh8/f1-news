const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const Parser = require("rss-parser");
const { createRaceDetails } = require("./race-details.cjs");

const sources = [
  {
    name: "BBC Sport",
    feedUrl: "https://feeds.bbci.co.uk/sport/formula1/rss.xml",
    hosts: ["bbc.co.uk", "bbc.com"],
    articlePath: "/sport/formula1/"
  },
  {
    name: "Autosport",
    feedUrl: "https://www.autosport.com/rss/f1/news/",
    hosts: ["autosport.com"],
    articlePath: "/f1/"
  },
  {
    name: "Motorsport.com",
    feedUrl: "https://www.motorsport.com/rss/f1/news/",
    hosts: ["motorsport.com"],
    articlePath: "/f1/"
  }
];

const cacheDuration = 5 * 60 * 1000;
let cachedArticles = null;
let cachedAt = 0;
let pendingRequest = null;

const files = new Map([
  ["/", {
    name: "index.html",
    type: "text/html; charset=utf-8"
  }],
  ["/index.html", {
    name: "index.html",
    type: "text/html; charset=utf-8"
  }],
  ["/style.css", {
    name: "style.css",
    type: "text/css; charset=utf-8"
  }],
  ["/script.js", {
    name: "script.js",
    type: "text/javascript; charset=utf-8"
  }],
  ["/grand-prix.html", {
    name: "grand-prix.html",
    type: "text/html; charset=utf-8"
  }],
  ["/grand-prix.js", {
    name: "grand-prix.js",
    type: "text/javascript; charset=utf-8"
  }]
]);

function newestFirst(a, b) {
  return (Date.parse(b.publishedAt) || 0) -
    (Date.parse(a.publishedAt) || 0);
}

function isArticle(item, source) {
  if (typeof item.title !== "string" || !item.title.trim()) {
    return false;
  }

  if (typeof item.link !== "string") {
    return false;
  }

  try {
    const url = new URL(item.link);
    const host = url.hostname.replace(/^www\./, "");

    return (url.protocol === "https:" || url.protocol === "http:") &&
      source.hosts.includes(host) &&
      url.pathname.startsWith(source.articlePath);
  } catch {
    return false;
  }
}

async function fetchSource(source) {
  const parser = new Parser({ timeout: 10000 });
  const feed = await parser.parseURL(source.feedUrl);

  const articles = feed.items
    .filter(function (item) {
      return isArticle(item, source);
    })
    .map(function (item) {
      return {
        title: item.title.trim(),
        description: "",
        url: item.link.trim(),
        source: source.name,
        publishedAt: item.isoDate || item.pubDate || null
      };
    })
    .sort(newestFirst)
    .slice(0, 10);

  console.log("Loaded " + articles.length + " headlines from " + source.name);
  return articles;
}

async function fetchArticles() {
  console.log("Fetching news feeds...");

  const results = await Promise.allSettled(
    sources.map(function (source) {
      return fetchSource(source);
    })
  );

  let successfulSources = 0;
  const articles = [];

  results.forEach(function (result, index) {
    if (result.status === "fulfilled") {
      successfulSources += 1;
      articles.push(...result.value);
    } else {
      console.warn(
        sources[index].name + " feed unavailable:",
        result.reason.message
      );
    }
  });

  if (successfulSources === 0) {
    throw new Error("All news feeds are unavailable.");
  }

  const seenUrls = new Set();

  return articles.sort(newestFirst).filter(function (article) {
    const url = new URL(article.url);
    url.hash = "";

    for (const key of [...url.searchParams.keys()]) {
      if (
        key.startsWith("utm_") ||
        key === "at_medium" ||
        key === "at_campaign"
      ) {
        url.searchParams.delete(key);
      }
    }

    const key = url.href;

    if (seenUrls.has(key)) {
      return false;
    }

    seenUrls.add(key);
    return true;
  });
}

async function getArticles() {
  const cacheIsFresh = cachedArticles !== null &&
    Date.now() - cachedAt < cacheDuration;

  if (cacheIsFresh) {
    return cachedArticles;
  }

  if (pendingRequest) {
    return pendingRequest;
  }

  pendingRequest = fetchArticles();

  try {
    cachedArticles = await pendingRequest;
    cachedAt = Date.now();
    return cachedArticles;
  } finally {
    pendingRequest = null;
  }
}

const calendarCache = new Map();
const calendarPending = new Map();
let jolpicaQueue = Promise.resolve();
let lastJolpicaStart = 0;
let jolpicaBlockedUntil = 0;

async function cachedCalendarValue(key, duration, load) {
  const cached = calendarCache.get(key);

  if (cached && Date.now() - cached.at < duration) {
    return cached.value;
  }

  if (calendarPending.has(key)) {
    return calendarPending.get(key);
  }

  const pending = (async function () {
    const value = await load();
    calendarCache.set(key, { value, at: Date.now() });
    return value;
  })();

  calendarPending.set(key, pending);

  try {
    return await pending;
  } finally {
    calendarPending.delete(key);
  }
}

async function fetchJolpica(endpoint) {
  const turn = jolpicaQueue.then(async function () {
    const delay = Math.max(0, 350 - (Date.now() - lastJolpicaStart));

    if (delay > 0) {
      await new Promise(function (resolve) {
        setTimeout(resolve, delay);
      });
    }

    if (Date.now() < jolpicaBlockedUntil) {
      throw new Error("Race data service requested a pause. Try again later.");
    }

    lastJolpicaStart = Date.now();
  });

  jolpicaQueue = turn.catch(function () {});
  await turn;

  const response = await fetch("https://api.jolpi.ca/ergast/f1/" + endpoint, {
    headers: {
      "User-Agent": "F1Portfolio/1.0.0",
      "Accept": "application/json"
    },
    signal: AbortSignal.timeout(10000)
  });

  if (response.status === 429) {
    const retryAfter = response.headers.get("Retry-After");
    const seconds = retryAfter === null ? NaN : Number(retryAfter);
    const retryDate = Date.parse(retryAfter || "");

    const pauseUntil = Number.isFinite(seconds)
      ? Date.now() + Math.max(1, seconds) * 1000
      : Number.isFinite(retryDate)
        ? Math.max(Date.now() + 1000, retryDate)
        : Date.now() + 60000;

    jolpicaBlockedUntil = Math.max(jolpicaBlockedUntil, pauseUntil);
  }

  if (!response.ok) {
    throw new Error("Race data service returned HTTP " + response.status);
  }

  return response.json();
}

function readRaceList(data) {
  const races = data?.MRData?.RaceTable?.Races;

  if (!Array.isArray(races)) {
    throw new Error("Race data service returned an unexpected format.");
  }

  return races;
}

async function getSeasons() {
  return cachedCalendarValue("seasons", 60 * 60 * 1000, async function () {
    const data = await fetchJolpica("seasons/?limit=100");
    const seasons = data?.MRData?.SeasonTable?.Seasons;

    if (!Array.isArray(seasons)) {
      throw new Error("Season data service returned an unexpected format.");
    }

    const latestYear = new Date().getUTCFullYear() + 1;

    const years = seasons.map(function (season) {
      return Number(season.season);
    }).filter(function (year) {
      return Number.isInteger(year) && year >= 1950 && year <= latestYear;
    });

    return [...new Set(years)].sort(function (a, b) {
      return b - a;
    });
  });
}

function raceStatus(race, winner, resultsAvailable) {
  if (winner) {
    return "completed";
  }

  const today = new Date().toISOString().slice(0, 10);

  if (race.date > today) {
    return "upcoming";
  }

  if (race.date === today) {
    if (!race.time) {
      return "race-today";
    }

    const startsAt = Date.parse(race.date + "T" + race.time);

    if (Number.isFinite(startsAt) && startsAt > Date.now()) {
      return "upcoming";
    }
  }

  return resultsAvailable ? "results-pending" : "results-unavailable";
}

async function getCalendar(season) {
  const currentYear = new Date().getUTCFullYear();
  const duration = season < currentYear
    ? 60 * 60 * 1000
    : 5 * 60 * 1000;

  return cachedCalendarValue("calendar:" + season, duration, async function () {
    const responses = await Promise.allSettled([
      fetchJolpica(season + "/races/?limit=100").then(readRaceList),
      fetchJolpica(season + "/results/1/?limit=100").then(readRaceList)
    ]);

    if (responses[0].status === "rejected") {
      throw responses[0].reason;
    }

    const schedule = responses[0].value;
    const resultsAvailable = responses[1].status === "fulfilled";
    const winners = new Map();

    if (resultsAvailable) {
      responses[1].value.forEach(function (race) {
        const raceResults = Array.isArray(race.Results) ? race.Results : [];

        const result = raceResults.find(function (result) {
          return String(result.position) === "1";
        });

        if (result?.Driver) {
          const name = [result.Driver.givenName, result.Driver.familyName]
            .filter(Boolean)
            .join(" ");

          if (name) {
            winners.set(race.season + "-" + race.round, {
              name,
              team: result.Constructor?.name || null
            });
          }
        }
      });
    } else {
      console.warn("Race results unavailable:", responses[1].reason.message);
    }

    const races = schedule.map(function (race) {
      const winner = winners.get(race.season + "-" + race.round) || null;
      const circuit = race.Circuit || {};
      const location = circuit.Location || {};

      return {
        season: Number(race.season),
        round: Number(race.round),
        name: race.raceName,
        date: race.date,
        time: race.time || null,
        circuit: {
          id: circuit.circuitId || null,
          name: circuit.circuitName || "Circuit details unavailable",
          locality: location.locality || null,
          country: location.country || null
        },
        winner,
        status: raceStatus(race, winner, resultsAvailable)
      };
    }).sort(function (a, b) {
      return a.round - b.round;
    });

    return {
      season,
      resultsAvailable,
      retrievedAt: new Date().toISOString(),
      source: "Jolpica",
      sourceUrl: "https://github.com/jolpica/jolpica-f1",
      dataTermsUrl: "https://github.com/jolpica/jolpica-f1/blob/main/TERMS.md",
      races
    };
  });
}

const getRaceDetails = createRaceDetails({
  fetchJolpica,
  cachedValue: cachedCalendarValue
});

const server = http.createServer(async function (request, response) {
  let pathname;
  let requestUrl;

  try {
    requestUrl = new URL(request.url, "http://127.0.0.1:3000");
    pathname = requestUrl.pathname;
  } catch {
    response.statusCode = 400;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("Invalid request URL.");
    return;
  }

  if (pathname === "/api/race-details") {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    const seasonText = requestUrl.searchParams.get("season") || "";
    const roundText = requestUrl.searchParams.get("round") || "";
    const season = Number(seasonText);
    const round = Number(roundText);

    if (!/^\d{4}$/.test(seasonText) || season < 1950 ||
        season > new Date().getUTCFullYear() + 1 ||
        !/^[1-9]\d?$/.test(roundText)) {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: "Choose a valid season and Grand Prix round." }));
      return;
    }

    try {
      response.end(JSON.stringify(await getRaceDetails(season, round)));
    } catch (error) {
      console.error("Grand Prix data error:", error.message);
      response.statusCode = error.statusCode === 404 ? 404 : 502;
      response.end(JSON.stringify({
        error: response.statusCode === 404
          ? "This Grand Prix was not found in the selected season."
          : "Unable to load this Grand Prix. Please try again."
      }));
    }
    return;
  }

  if (pathname === "/api/seasons" || pathname === "/api/calendar") {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");

    try {
      if (pathname === "/api/seasons") {
        response.end(JSON.stringify(await getSeasons()));
      } else {
        const currentYear = new Date().getUTCFullYear();
        const seasonText = requestUrl.searchParams.get("season") ??
          String(currentYear);
        const season = Number(seasonText);

        if (
          !/^\d{4}$/.test(seasonText) ||
          season < 1950 ||
          season > currentYear + 1
        ) {
          response.statusCode = 400;
          response.end(JSON.stringify({ error: "Choose a valid F1 season." }));
          return;
        }

        response.end(JSON.stringify(await getCalendar(season)));
      }
    } catch (error) {
      console.error("Calendar data error:", error.message);
      response.statusCode = 502;
      response.end(
        JSON.stringify({ error: "Unable to load F1 calendar data." })
      );
    }

    return;
  }

  if (pathname === "/api/news") {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");

    try {
      const articles = await getArticles();
      response.end(JSON.stringify(articles));
    } catch (error) {
      console.error("News feed error:", error.message);
      response.statusCode = 502;
      response.end(
        JSON.stringify({ error: "Unable to load live F1 news." })
      );
    }

    return;
  }

  const file = files.get(pathname);

  if (!file) {
    response.statusCode = 404;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("Page not found.");
    return;
  }

  try {
    const contents = await fs.readFile(path.join(__dirname, file.name));
    response.setHeader("Content-Type", file.type);
    response.setHeader("Cache-Control", "no-cache");
    response.end(contents);
  } catch (error) {
    console.error("Website file error:", error.message);
    response.statusCode = 500;
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.end("Unable to load the website.");
  }
});

server.listen(3000, "127.0.0.1", function () {
  console.log("Website: http://127.0.0.1:3000/");
});
