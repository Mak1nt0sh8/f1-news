const FIVE_MINUTES = 5 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const ONE_DAY = 24 * ONE_HOUR;
const LIVE_MARGIN = 30 * 60 * 1000;

function textOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalize(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizedCountry(value) {
  const country = normalize(value);
  const aliases = {
    usa: "unitedstates", us: "unitedstates", unitedstatesofamerica: "unitedstates",
    uk: "unitedkingdom", greatbritain: "unitedkingdom", britain: "unitedkingdom",
    uae: "unitedarabemirates"
  };
  return aliases[country] || country;
}

function timestamp(value) {
  if (!textOrNull(value)) return null;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function utcDate(value) {
  const milliseconds = timestamp(value);
  return milliseconds === null ? null : new Date(milliseconds).toISOString().slice(0, 10);
}

function scheduledStart(date, time) {
  if (!date || !time) return null;
  const milliseconds = timestamp(date + "T" + time);
  return milliseconds === null ? null : new Date(milliseconds).toISOString();
}

function formatSeconds(value) {
  const seconds = numberOrNull(value);
  if (seconds === null || seconds <= 0) return null;
  const totalMilliseconds = Math.round(seconds * 1000);
  const hours = Math.floor(totalMilliseconds / 3600000);
  const minutes = Math.floor(totalMilliseconds / 60000) % 60;
  const remaining = Math.floor(totalMilliseconds / 1000) % 60;
  const milliseconds = totalMilliseconds % 1000;
  const ending = String(remaining).padStart(2, "0") + "." +
    String(milliseconds).padStart(3, "0");
  return hours > 0
    ? hours + ":" + String(minutes).padStart(2, "0") + ":" + ending
    : minutes + ":" + ending;
}

function emptyResult() {
  return {
    position: null, driver: null, team: null, number: null, bestLap: null,
    q1: null, q2: null, q3: null, laps: null, grid: null, time: null,
    status: null, points: null, fastestLap: null
  };
}

function jolpicaResult(result) {
  return {
    ...emptyResult(),
    position: numberOrNull(result.position),
    driver: [textOrNull(result.Driver?.givenName), textOrNull(result.Driver?.familyName)]
      .filter(Boolean).join(" ") || null,
    team: textOrNull(result.Constructor?.name),
    number: numberOrNull(result.number ?? result.Driver?.permanentNumber),
    q1: textOrNull(result.Q1), q2: textOrNull(result.Q2), q3: textOrNull(result.Q3),
    laps: numberOrNull(result.laps), grid: numberOrNull(result.grid),
    time: textOrNull(result.Time?.time), status: textOrNull(result.status),
    points: numberOrNull(result.points), fastestLap: textOrNull(result.FastestLap?.Time?.time)
  };
}

function openF1Result(result, driver, kind) {
  const qualifying = Array.isArray(result.duration) ? result.duration : [];
  let raceTime = null;
  if (kind === "race" || kind === "sprint") {
    const gap = result.gap_to_leader;
    if (typeof gap === "string") raceTime = gap;
    else if (numberOrNull(gap) !== null && Number(gap) > 0) raceTime = "+" + Number(gap).toFixed(3);
    else raceTime = formatSeconds(result.duration);
  }
  return {
    ...emptyResult(),
    position: numberOrNull(result.position),
    driver: textOrNull(driver?.full_name) ||
      [textOrNull(driver?.first_name), textOrNull(driver?.last_name)].filter(Boolean).join(" ") || null,
    team: textOrNull(driver?.team_name), number: numberOrNull(result.driver_number),
    bestLap: kind === "practice" ? formatSeconds(result.duration) : null,
    q1: formatSeconds(qualifying[0]), q2: formatSeconds(qualifying[1]), q3: formatSeconds(qualifying[2]),
    laps: numberOrNull(result.number_of_laps), time: raceTime,
    status: result.dsq === true ? "Disqualified" : result.dns === true ? "Did not start" :
      result.dnf === true ? "Did not finish" : null
  };
}

function sortResults(results) {
  return results.sort(function (a, b) {
    return (a.position > 0 ? a.position : Infinity) - (b.position > 0 ? b.position : Infinity);
  });
}

function readRace(data, season, round, required) {
  const races = data?.MRData?.RaceTable?.Races;
  if (!Array.isArray(races)) throw new Error("Race service returned an unexpected response.");
  const matches = races.filter(function (race) {
    return Number(race.season) === season && Number(race.round) === round;
  });
  if (matches.length === 1) return matches[0];
  if (matches.length > 1 || races.length > 0) throw new Error("Race service returned a different event.");
  if (required) {
    const error = new Error("Race not found.");
    error.statusCode = 404;
    throw error;
  }
  return null;
}

function sessionType(name, season) {
  // OpenF1 used "Sprint Qualifying" for the sprint race in 2023.
  if (Number(season) === 2023 && normalize(name) === "sprintqualifying") {
    return ["sprint", "Sprint", "sprint"];
  }
  const types = {
    practice1: ["practice-1", "Practice 1", "practice"],
    practice2: ["practice-2", "Practice 2", "practice"],
    practice3: ["practice-3", "Practice 3", "practice"],
    qualifying: ["qualifying", "Qualifying", "qualifying"],
    race: ["race", "Race", "race"], sprint: ["sprint", "Sprint", "sprint"],
    sprintqualifying: ["sprint-qualifying", "Sprint qualifying", "sprint-qualifying"],
    sprintshootout: ["sprint-qualifying", "Sprint shootout", "sprint-qualifying"]
  };
  return types[normalize(name)] || null;
}

function makeSession(id, label, kind, timing) {
  const date = textOrNull(timing?.date);
  return {
    id, label, kind, date, startsAt: scheduledStart(date, textOrNull(timing?.time)),
    endsAt: null, status: "unavailable", source: null, message: null, results: []
  };
}

function classifySession(session, cancelled, unavailableMessage) {
  if (cancelled) {
    session.status = "cancelled";
    session.message = "This session was cancelled.";
  } else if (session.results.length > 0) {
    session.status = "completed";
    session.message = null;
  } else {
    const now = Date.now();
    const starts = timestamp(session.startsAt);
    const ends = timestamp(session.endsAt);
    const today = new Date(now).toISOString().slice(0, 10);
    if ((starts !== null && starts > now) || (starts === null && session.date > today)) {
      session.status = "upcoming";
      session.message = "Results will appear after this session.";
    } else if (starts !== null && ends !== null && starts <= now && now < ends) {
      session.status = "in-progress";
      session.message = "This session is in progress. Results are not available yet.";
    } else if (unavailableMessage) {
      session.status = "unavailable";
      session.message = unavailableMessage;
    } else {
      const ended = ends ?? starts ?? timestamp(session.date ? session.date + "T00:00:00Z" : null);
      session.status = ended !== null && now - ended < ONE_DAY ? "results-pending" : "unavailable";
      session.message = session.status === "results-pending"
        ? "Results have not been published yet." : "Results are unavailable for this session.";
    }
  }
  return session;
}

function safeVenueMatch(race, session) {
  const location = race.Circuit?.Location || {};
  const country = normalizedCountry(location.country);
  if (!country || country !== normalizedCountry(session.country_name)) return false;
  const expected = [race.Circuit?.circuitName, race.Circuit?.circuitId, location.locality]
    .map(normalize).filter(function (value) { return value.length >= 3; });
  const actual = [session.circuit_short_name, session.location].map(normalize)
    .filter(function (value) { return value.length >= 3; });
  return expected.some(function (a) {
    return actual.some(function (b) { return a === b || a.includes(b) || b.includes(a); });
  });
}

function oldEvent(race) {
  const starts = timestamp(race.date ? race.date + "T" + (race.time || "23:59:59Z") : null);
  return starts !== null && Date.now() - starts > ONE_DAY;
}

function createRaceDetails({ fetchJolpica, cachedValue }) {
  let openF1Queue = Promise.resolve();
  let lastOpenF1Start = 0;
  let openF1BlockedUntil = 0;

  async function fetchOpenF1(endpoint) {
    const turn = openF1Queue.then(async function () {
      const delay = Math.max(0, 2100 - (Date.now() - lastOpenF1Start));
      if (delay > 0) await new Promise(function (resolve) { setTimeout(resolve, delay); });
      if (Date.now() < openF1BlockedUntil) throw new Error("OpenF1 requested a temporary pause.");
      lastOpenF1Start = Date.now();
    });
    openF1Queue = turn.catch(function () {});
    await turn;
    const response = await fetch("https://api.openf1.org/v1/" + endpoint, {
      headers: { "Accept": "application/json", "User-Agent": "F1Portfolio/1.0.0" },
      signal: AbortSignal.timeout(10000)
    });
    if (response.status === 429) {
      const retryAfter = response.headers.get("Retry-After");
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const retryDate = Date.parse(retryAfter || "");
      const pauseUntil = Number.isFinite(seconds) ? Date.now() + Math.max(1, seconds) * 1000 :
        Number.isFinite(retryDate) ? Math.max(Date.now() + 1000, retryDate) : Date.now() + 60000;
      openF1BlockedUntil = Math.max(openF1BlockedUntil, pauseUntil);
    }
    if (!response.ok) throw new Error("OpenF1 returned HTTP " + response.status);
    const data = await response.json();
    if (!Array.isArray(data)) throw new Error("OpenF1 returned an unexpected response.");
    return data;
  }

  async function openF1Weekend(race, season) {
    const yearDuration = season < new Date().getUTCFullYear() ? ONE_HOUR : FIVE_MINUTES;
    const metadata = await cachedValue("details:openf1:sessions:" + season, yearDuration, function () {
      return fetchOpenF1("sessions?year=" + season);
    });
    const races = metadata.filter(function (session) {
      return Number(session.year) === season && normalize(session.session_name) === "race" &&
        utcDate(session.date_start) === race.date && safeVenueMatch(race, session);
    });
    if (races.length !== 1 || !Number.isInteger(Number(races[0].meeting_key)) || Number(races[0].meeting_key) <= 0) {
      return { sessions: [], results: [], drivers: [], problem: "Practice classifications could not be matched to this event." };
    }
    const meetingKey = Number(races[0].meeting_key);
    const seenSessionKeys = new Set();
    const sessions = metadata.filter(function (session) {
      const key = Number(session.session_key);
      if (seenSessionKeys.has(key)) return false;
      const matches = Number(session.year) === season && Number(session.meeting_key) === meetingKey &&
        sessionType(session.session_name, season) && Number.isInteger(key) && key > 0;
      if (matches) seenSessionKeys.add(key);
      return matches;
    });
    const now = Date.now();
    const active = sessions.some(function (session) {
      if (session.is_cancelled === true) return false;
      const start = timestamp(session.date_start);
      const end = timestamp(session.date_end);
      if (start === null) return false;
      if (end === null) return start - LIVE_MARGIN <= now && now - start < ONE_DAY;
      return start - LIVE_MARGIN <= now && now <= end + LIVE_MARGIN;
    });
    const hasHistoricalSession = sessions.some(function (session) {
      const end = timestamp(session.date_end);
      const start = timestamp(session.date_start);
      return session.is_cancelled !== true &&
        (end !== null ? end + LIVE_MARGIN < now : start !== null && now - start > ONE_DAY);
    });
    if (!hasHistoricalSession) return { sessions, results: [], drivers: [], problem: null };

    const duration = oldEvent(race) ? ONE_HOUR : FIVE_MINUTES;
    const weekend = await cachedValue("details:openf1:meeting:" + season + ":" + meetingKey, duration, async function () {
      if (active) {
        const completedPractices = sessions.filter(function (session) {
          const end = timestamp(session.date_end);
          return sessionType(session.session_name, season)?.[2] === "practice" &&
            session.is_cancelled !== true && end !== null && end + LIVE_MARGIN < now;
        });
        const completed = await Promise.all(completedPractices.map(function (session) {
          return cachedValue("details:openf1:practice:" + season + ":" + session.session_key, duration, async function () {
            const responses = await Promise.allSettled([
              fetchOpenF1("session_result?session_key=" + session.session_key),
              fetchOpenF1("drivers?session_key=" + session.session_key)
            ]);
            responses.forEach(function (response, index) {
              if (response.status === "rejected") console.warn("OpenF1 completed practice " +
                (index === 0 ? "results" : "drivers") + " unavailable:", response.reason?.message);
            });
            const matchingRows = function (rows) {
              return rows.filter(function (row) {
                return Number(row.meeting_key) === meetingKey && Number(row.session_key) === Number(session.session_key);
              });
            };
            return {
              results: responses[0].status === "fulfilled" ? matchingRows(responses[0].value) : [],
              drivers: responses[1].status === "fulfilled" ? matchingRows(responses[1].value) : [],
              failed: responses[0].status === "rejected"
            };
          });
        }));
        return {
          sessions,
          results: completed.flatMap(function (session) { return session.results; }),
          drivers: completed.flatMap(function (session) { return session.drivers; }),
          problem: completed.some(function (session) { return session.failed; })
            ? "Some completed practice results are temporarily unavailable." : null
        };
      }
      const responses = await Promise.allSettled([
        fetchOpenF1("session_result?meeting_key=" + meetingKey),
        fetchOpenF1("drivers?meeting_key=" + meetingKey)
      ]);
      responses.forEach(function (response, index) {
        if (response.status === "rejected") {
          console.warn("OpenF1 " + (index === 0 ? "results" : "drivers") + " unavailable:", response.reason?.message);
        }
      });
      const matchingRows = function (rows) {
        return rows.filter(function (row) { return Number(row.meeting_key) === meetingKey; });
      };
      return {
        sessions,
        results: responses[0].status === "fulfilled" ? matchingRows(responses[0].value) : [],
        drivers: responses[1].status === "fulfilled" ? matchingRows(responses[1].value) : [],
        problem: responses[0].status === "rejected" ? "Practice results are temporarily unavailable." : null
      };
    });
    return { ...weekend, sessions };
  }

  async function loadDetails(race, season, round) {
    const base = season + "/" + round + "/";
    const optional = await Promise.allSettled([
      fetchJolpica(base + "qualifying/?limit=100").then(function (data) { return readRace(data, season, round, false); }),
      fetchJolpica(base + "results/?limit=100").then(function (data) { return readRace(data, season, round, false); }),
      fetchJolpica(base + "sprint/?limit=100").then(function (data) { return readRace(data, season, round, false); })
    ]);
    const definitions = [
      ["FirstPractice", "practice-1", "Practice 1", "practice"],
      ["SecondPractice", "practice-2", "Practice 2", "practice"],
      ["ThirdPractice", "practice-3", "Practice 3", "practice"],
      ["Qualifying", "qualifying", "Qualifying", "qualifying"],
      ["SprintQualifying", "sprint-qualifying", "Sprint qualifying", "sprint-qualifying"],
      ["SprintShootout", "sprint-qualifying", "Sprint shootout", "sprint-qualifying"],
      ["Sprint", "sprint", "Sprint", "sprint"]
    ];
    const sessions = [];
    definitions.forEach(function ([key, id, label, kind]) {
      if (race[key] && !sessions.some(function (session) { return session.id === id; })) {
        sessions.push(makeSession(id, label, kind, race[key]));
      }
    });
    if (!sessions.some(function (session) { return session.id === "qualifying"; })) {
      sessions.push(makeSession("qualifying", "Qualifying", "qualifying", null));
    }
    sessions.push(makeSession("race", "Race", "race", race));
    const failures = new Map();
    const resultTypes = [["qualifying", "QualifyingResults"], ["race", "Results"], ["sprint", "SprintResults"]];
    optional.forEach(function (response, index) {
      const [id, property] = resultTypes[index];
      if (response.status === "rejected") {
        console.warn("Jolpica " + id + " unavailable:", response.reason?.message);
        failures.set(id, "Results are temporarily unavailable for this session.");
        return;
      }
      const rows = response.value?.[property];
      if (response.value !== null && !Array.isArray(rows)) {
        failures.set(id, "Results are temporarily unavailable for this session.");
        console.warn("Jolpica " + id + " returned missing result fields.");
      }
      if (!Array.isArray(rows) || rows.length === 0) return;
      let session = sessions.find(function (item) { return item.id === id; });
      if (!session) {
        session = makeSession(id, "Sprint", "sprint", response.value?.Sprint || null);
        sessions.push(session);
      }
      session.results = sortResults(rows.filter(function (row) {
        return row && typeof row === "object";
      }).map(jolpicaResult));
      session.source = "Jolpica";
    });

    let weekend = { sessions: [], results: [], drivers: [], problem: null };
    if (season >= 2023) {
      try { weekend = await openF1Weekend(race, season); }
      catch (error) {
        console.warn("OpenF1 session details unavailable:", error.message);
        weekend.problem = "Practice results are temporarily unavailable.";
      }
    } else {
      weekend.problem = "Practice classifications are available from 2023 onward.";
    }

    const driverMap = new Map(weekend.drivers.map(function (driver) {
      return [driver.session_key + ":" + driver.driver_number, driver];
    }));
    const metadataById = new Map();
    weekend.sessions.forEach(function (metadata) {
      const [id, label, kind] = sessionType(metadata.session_name, season);
      let session = sessions.find(function (item) { return item.id === id; });
      if (metadataById.has(id)) {
        session = makeSession(id + "-" + metadata.session_key, label, kind, null);
        sessions.push(session);
      } else if (!session) {
        session = makeSession(id, label, kind, null);
        sessions.push(session);
      }
      metadataById.set(session.id, metadata);
      session.startsAt = timestamp(metadata.date_start) === null ? session.startsAt :
        new Date(metadata.date_start).toISOString();
      session.endsAt = timestamp(metadata.date_end) === null ? null : new Date(metadata.date_end).toISOString();
      session.date = utcDate(metadata.date_start) || session.date;
      const openRows = weekend.results.filter(function (result) {
        return Number(result.session_key) === Number(metadata.session_key);
      }).map(function (result) {
        return openF1Result(result, driverMap.get(result.session_key + ":" + result.driver_number), kind);
      });
      if (session.results.length === 0 && openRows.length > 0) {
        session.results = sortResults(openRows);
        session.source = "OpenF1";
      } else if (openRows.length > 0) {
        session.results.forEach(function (result) {
          const extra = openRows.find(function (row) {
            return (result.number !== null && row.number === result.number) ||
              (result.driver && normalize(result.driver) === normalize(row.driver));
          });
          if (extra) Object.keys(result).forEach(function (key) {
            if (result[key] === null) result[key] = extra[key];
          });
        });
      }
    });
    if (!sessions.some(function (session) { return session.kind === "practice"; })) {
      sessions.unshift(makeSession("practice", "Practice sessions", "practice", null));
    }
    sessions.forEach(function (session) {
      const metadata = metadataById.get(session.id);
      const problem = session.kind === "practice" ? weekend.problem : failures.get(session.id);
      classifySession(session, metadata?.is_cancelled === true, problem);
    });
    sessions.sort(function (a, b) {
      const order = { practice: 0, "sprint-qualifying": 1, sprint: 2, qualifying: 3, race: 4 };
      const first = timestamp(a.startsAt) ?? timestamp(a.date ? a.date + "T00:00:00Z" : null);
      const second = timestamp(b.startsAt) ?? timestamp(b.date ? b.date + "T00:00:00Z" : null);
      return first !== null && second !== null ? first - second : order[a.kind] - order[b.kind];
    });
    const location = race.Circuit?.Location || {};
    return {
      season, round, name: textOrNull(race.raceName), date: textOrNull(race.date), time: textOrNull(race.time),
      circuit: { name: textOrNull(race.Circuit?.circuitName), locality: textOrNull(location.locality), country: textOrNull(location.country) },
      sessions
    };
  }

  return async function getRaceDetails(season, round) {
    season = Number(season);
    round = Number(round);
    if (!Number.isInteger(season) || season < 1950 || season > new Date().getUTCFullYear() + 1 ||
      !Number.isInteger(round) || round < 1 || round > 99) {
      const error = new Error("Invalid season or race round.");
      error.statusCode = 400;
      throw error;
    }
    const key = season + ":" + round;
    const scheduleDuration = season < new Date().getUTCFullYear() ? ONE_HOUR : FIVE_MINUTES;
    const race = await cachedValue("details:schedule:" + key, scheduleDuration, async function () {
      const data = await fetchJolpica(season + "/" + round + "/races/?limit=100");
      return readRace(data, season, round, true);
    });
    return cachedValue("details:event:" + key, oldEvent(race) ? ONE_HOUR : FIVE_MINUTES, function () {
      return loadDetails(race, season, round);
    });
  };
}

module.exports = { createRaceDetails };
