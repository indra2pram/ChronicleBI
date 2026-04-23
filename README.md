# Electron + Next.js Boilerplate

A minimal desktop starter that runs a Next.js App Router UI inside an Electron shell.

## Scripts

- `npm install` installs dependencies.
- `npm run dev` starts Electron in development mode and boots the Next.js renderer server.
- `npm run start` builds the Next.js app and launches Electron in production mode.
- `npm run typecheck` runs TypeScript checks for the renderer code.

## Project structure

- `electron/main.js` creates the browser window, starts the embedded Next.js server, and registers IPC handlers.
- `electron/preload.js` exposes a small, safe API surface to the renderer.
- `app/` contains the Next.js App Router UI.

## Next steps

- Add more IPC methods in `electron/preload.js` and `electron/main.js`.
- Create additional routes in `app/`.
- Introduce native desktop capabilities like menus, file dialogs, notifications, or auto-updates.
