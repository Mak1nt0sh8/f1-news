# F1 News · Race Calendar · Pit Wall

A Formula 1 portfolio project built with plain HTML, CSS, JavaScript, and Node.js. Browse recent headlines, explore race weekends, and try a free F1 chat demo. News, the calendar, Grand Prix details, and chat each have their own page.

**No API key or paid account is needed to run the default project.** Pit Wall uses prepared demo replies rather than an AI model in this mode.

## Features

- News from BBC Sport, Autosport, and Motorsport.com, with publisher-supplied images when available.
- Headline search, refresh controls, and links to the original articles.
- Season selection, race dates, circuits, locations, and available winners.
- A separate Grand Prix page with practice, qualifying, race, and sprint sessions where the data providers support them.
- Pit Wall demo chat with suggested questions, follow-ups, source links, copy, cancellation, and conversation history in the current browser tab.
- A consistent dark design, red slanted logos, responsive layouts, and keyboard focus indicators.
- Loading, empty, missing-data, and retry states for external data requests.

## Screenshots

Screenshots show the local project in its default demo configuration. Headlines and race data change as the sources update.

| News | Race calendar |
| --- | --- |
| ![F1 news page with publisher images and headline search](docs/screenshots/news.jpg) | ![Season calendar with circuits and race winners](docs/screenshots/calendar.jpg) |

| Grand Prix details | Pit Wall demo |
| --- | --- |
| ![Grand Prix schedule and session results](docs/screenshots/grand-prix.jpg) | ![Pit Wall F1 chat in clearly labeled demo mode](docs/screenshots/pit-wall.jpg) |

## Run locally

Install **Node.js 24 or newer**. Open a terminal in the project folder, then run:

```bash
npm ci
npm start
```

Open [http://127.0.0.1:3000/](http://127.0.0.1:3000/). Stop the server with **Control+C**.

The server binds to `127.0.0.1`, so this is a local portfolio demo. News and race data need an internet connection. The Node.js server must be running; opening the HTML files directly or using GitHub Pages alone will not provide the backend endpoints.

If port 3000 is already in use, stop the other server or choose a different port:

```bash
PORT=3001 npm start
```

Then open `http://127.0.0.1:3001/`.

## Pages

| Page | Local route |
| --- | --- |
| News | `/` |
| Race calendar | `/calendar.html` |
| Grand Prix details | `/grand-prix.html?season=2026&round=1` |
| Pit Wall | `/chat.html` |

Calendar cards generate the correct Grand Prix links for the selected season.

## How the project works

The browser scripts call the Node.js server. The server reads publisher RSS feeds and race-data APIs, normalizes their responses, and caches data to reduce repeated requests. The browser creates cards and tables from that JSON.

| Files | Purpose |
| --- | --- |
| `index.html`, `script.js` | News page, headline search, and image cards |
| `calendar.html`, `calendar.js` | Season selection and race cards |
| `grand-prix.html`, `grand-prix.js` | Weekend schedules and session results |
| `chat.html`, `chat.js`, `chat.css` | Pit Wall interface and conversation controls |
| `style.css` | Shared layouts, logos, buttons, and responsive styles |
| `server.cjs` | Local HTTP server, RSS feeds, race routes, and static-file allowlist |
| `news-images.cjs`, `race-details.cjs` | Publisher image extraction and weekend data normalization |
| `f1-chat.cjs` | Prepared demo replies and optional AI integration |
| `tests/` | Automated client and server regression checks |
| `docs/screenshots/` | Portfolio screenshots used in this README |

The browser scripts use the DOM. The `.cjs` files run on the server in Node.js.

## Pit Wall demo

Without `OPENAI_API_KEY`, Pit Wall answers a limited set of prepared F1 topics. It can also use this project's current news and calendar data for supported questions. Unsupported questions explain the demo's limits rather than inventing an answer. The web-search checkbox is unavailable in demo mode.

Try **The perfect pit stop**, **Inside the machine**, or **What's happening now?** Conversations stay in this tab's `sessionStorage`; **New conversation** clears them. Browser storage can be unavailable, in which case the conversation lasts until you leave the page.

<details>
<summary>Optional AI integration</summary>

AI integration is included for future use, but the default portfolio does not require it. OpenAI API requests and web search can incur charges.

To enable it, copy `.env.example` to `.env`, add your own `OPENAI_API_KEY` locally, and restart the server. `OPENAI_MODEL` selects the model; the template defaults to `gpt-5.4-mini`. Model availability depends on your API account.

The server uses the [OpenAI Responses API](https://developers.openai.com/api/docs/guides/text) and optional [web search](https://developers.openai.com/api/docs/guides/tools-web-search). Each answer identifies whether web search was actually used. AI answers can contain mistakes.

The key stays on the server. `.env` is ignored by Git and is not served to the browser. Recent conversation turns are sent to OpenAI in AI mode with `store: false`. The project does not save chats on its server. Cancellation aborts the local and provider requests but cannot guarantee that a request already started is unbilled.

</details>

## Checks

```bash
npm test
```

The checks cover demo answers, chat validation, response and citation parsing, error handling, local HTTP routes, and browser-script behavior for all four pages. Provider tests use simulated responses and do not spend API credits. They do not verify a live AI account, guarantee external data accuracy, or replace visual browser checks.

In an environment that prohibits local sockets, use:

```bash
F1_TEST_NO_SOCKETS=1 npm test
```

This runs the HTTP request handler with Node streams instead of opening a port. Client tests use a DOM event harness.

## Data and limitations

- News titles, dates, links, and image URLs come from the publishers' RSS feeds. Feed outages, missing images, and small thumbnails are handled in the interface. Full articles remain on the publishers' websites.
- [Jolpica F1](https://github.com/jolpica/jolpica-f1) provides calendar and race-result data; its [data terms](https://github.com/jolpica/jolpica-f1/blob/main/TERMS.md) apply.
- [OpenF1](https://openf1.org/docs/) supplies additional session data, including practice classifications from 2023 onward where available.
- Missing or unpublished results are labeled. Dates and schedules can change, and external services can be temporarily unavailable.
- The local chat limits messages to 2,000 characters, allows two simultaneous replies, and accepts up to 12 requests per minute from a local address.

This is an independent fan project. News content, publisher images, and race data belong to their respective owners and providers.
