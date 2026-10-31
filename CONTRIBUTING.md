# Contributing to snip

## Build from source

You need [Node.js](https://nodejs.org) 24 or newer, [pnpm](https://pnpm.io) 12, and ffmpeg 6 or
newer built with libx264.

```sh
pnpm install
pnpm start
```

`pnpm start` runs snip with the ffmpeg on your PATH. Run the tests with `pnpm test`. `pnpm lint`
checks the code with oxlint and oxfmt, and `pnpm format` fixes the formatting; CI runs both checks
on every push and pull request.

To build the downloads, run `pnpm dist`. They land in `dist`; `electron-builder.yml` says
what goes into them. To include ffmpeg the way the releases do, put it in `ffmpeg/bin`
first; see `.github/workflows/release.yml`.

## How it fits together

snip is an [Electron](https://www.electronjs.org) app:

- `src/main` is the main process. `media` turns your choices into ffmpeg commands, and
  `videos.js` runs them and keeps track of the opened videos.
- `src/renderer` is the interface: plain HTML, CSS and JavaScript. With `pnpm start`, Ctrl+R
  reloads it after a change and Ctrl+Shift+I opens the developer tools.
- `src/preload` connects the two.

The preview can't play every format ffmpeg reads, like HEVC or WMV. For those, snip first
makes a smaller copy to edit with; the conversion still uses the original.

## Chromium's sandbox

`pnpm start` turns off Chromium's sandbox, which needs setup as root on many Linux systems; the
downloads keep it where the system allows it.

On Ubuntu 24.04 and newer, the system doesn't let AppImages use Chromium's sandbox, so the
AppImage turns it off there. snip only shows its own pages, never websites.

## Website

`website` is the landing page: plain HTML styled with [Tailwind](https://tailwindcss.com).
Its stylesheet, `tailwind.css`, is built from `style.css` and the classes in `index.html` and
`404.html`, and is committed so the page needs no build step to serve. After changing either file, rebuild it:

```sh
npx tailwindcss@3.4.17 -c website/tailwind.config.js -i website/style.css -o website/tailwind.css --minify
```

Tailwind only includes the classes it finds in `index.html` and `404.html`, so a new class shows up unstyled
until you rebuild.

`og.png` (the 1200×630 picture in link previews) and `apple-touch-icon.png` are committed images.
If the headline or the logo changes, remake them to match.
