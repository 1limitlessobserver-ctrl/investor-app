# Investor App

A white-label investor app: an installable web app (PWA) that gives an investor their portfolio,
activity and statements, alerts and support, money movement, identity verification, Legacy Studio
and the Oracle, using the account they already have on their company's platform.

It is a public template. Any company that runs the platform can copy it, point it at its own
platform and publish it under its own name, icon and colours. The app has no backend of its own:
the platform does all the server work.

> Work in progress. The app core is being built task by task; see
> [`docs/superpowers/plans`](docs/superpowers/plans) for the plan and
> [`docs/superpowers/specs`](docs/superpowers/specs) for the design. This README grows with it.

## Sample mode and live mode

The mode comes from `platformUrl` in `company.config.json`, the one file a company edits (together
with `branding/icon.png`).

- **Sample mode** (`platformUrl` is `""`). The app runs on a clearly labelled in-memory sample world
  and talks to no server. Every screen shows a "Sample" ribbon. Any email signs in; an email that
  contains `+2fa` takes the two-factor step, and the code is `123456`.
- **Live mode** (`platformUrl` is the company's HTTPS address). Investors sign in with the email,
  password and two-factor code they already use on the company's website, and every number comes
  from the platform's `/api/mobile/v1`.

## Getting started

You need Node 22 and npm.

```bash
npm install
npm run dev
```

## Commands

| Command                 | What it does                                                        |
| ----------------------- | ------------------------------------------------------------------- |
| `npm run dev`           | Starts the Vite dev server.                                         |
| `npm run build`         | Applies the company config, typechecks and builds into `dist/`.     |
| `npm run preview`       | Serves the built app on port 4173.                                  |
| `npm run typecheck`     | Type-checks the app and the config files.                           |
| `npm run lint`          | Runs ESLint; any warning fails.                                     |
| `npm run format`        | Formats the code with Prettier.                                     |
| `npm test`              | Runs the unit and component tests once.                             |
| `npm run test:watch`    | Runs the unit and component tests in watch mode.                    |
| `npm run test:e2e`      | Runs the Playwright tests against the built app (build first).      |
| `npm run apply-company` | Applies `company.config.json` and `branding/icon.png` to the app.   |
| `npm run verify`        | Typecheck, lint, tests and build, in order. Run it before a commit. |

More commands (icons, screenshots, Lighthouse, dependency audit) and the per-company, hosting and
repo-bot guides are added to this README as the corresponding work lands.

## Contributing

The rules for engineers and bots are in [`CLAUDE.md`](CLAUDE.md).

## License

[MIT](LICENSE)
