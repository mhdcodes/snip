# snip

A desktop app to cut, crop and shrink videos, so they fit on Discord, WhatsApp or in an email.

snip runs ffmpeg on your computer, so your videos never leave it.

## Features

- Open a video, or drop it anywhere on the window
- Trim it to the part you want
- Crop freely, or to 16:9, 4:3, 3:4 or 9:16
- Pick a target: an 8, 16 or 25 MB file, SD, HD or best quality, or an animated GIF
- Keep the sound, lower its quality or remove it
- Preview the result and save it wherever you like
- See the exact ffmpeg commands it will run

## Download

The [releases page](https://github.com/mhdcodes/snip/releases) has, each with ffmpeg included:

- `snip-windows-x64-setup.exe`: installs snip for your user, with a Start menu entry.
- `snip-linux-amd64.deb`: for Ubuntu 22.04, Debian 12 and newer. Install it with
  `sudo apt install ./snip-linux-amd64.deb`.
- `snip-linux-x86_64.AppImage`: for any other Linux distribution from the last few years.
- `snip-mac-arm64.dmg`: for Macs with Apple silicon (M1 and newer).
- `snip-mac-x64.dmg`: for Macs with an Intel processor.

To run the AppImage, make it executable and start it:

```sh
chmod +x snip-linux-x86_64.AppImage
./snip-linux-x86_64.AppImage
```

On Ubuntu 24.04 and newer, the system doesn't let AppImages use Chromium's sandbox, so snip
turns it off there. snip only shows its own pages, never websites.

On a Mac, open the DMG and drag snip to Applications. snip isn't notarized by Apple, so the
first time you open it macOS refuses. Go to System Settings, Privacy & Security, and click
Open Anyway, or run this once:

```sh
xattr -dr com.apple.quarantine /Applications/snip.app
```

## Build from source

You need [Node.js](https://nodejs.org) 24 or newer, [pnpm](https://pnpm.io) 12, and ffmpeg 6 or
newer built with libx264.

```sh
pnpm install
pnpm start
```

`pnpm start` runs snip with the ffmpeg on your PATH. It turns off Chromium's sandbox, which
needs setup as root on many Linux systems; the downloads keep it where the system allows it.
Run the tests with `pnpm test`. `pnpm lint` checks the code with oxlint and oxfmt, and
`pnpm format` fixes the formatting; CI runs both checks on every push and pull request.

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

## Website

`website` is the landing page: plain HTML styled with [Tailwind](https://tailwindcss.com).
Its stylesheet, `tailwind.css`, is built from `style.css` and the classes in `index.html`, and is
committed so the page needs no build step to serve. After changing either file, rebuild it:

```sh
npx tailwindcss@3.4.17 -c website/tailwind.config.js -i website/style.css -o website/tailwind.css --minify
```

Tailwind only includes the classes it finds in `index.html`, so a new class shows up unstyled
until you rebuild.

## Good to know

Some presets keep the original video as it is, to save time and quality. With those, the clip
can start a few frames early. If you need exact cuts, pick a preset that says nothing about
keeping the original.

## License

[MIT](LICENSE). The downloads include ffmpeg, which is licensed under the
[GPL](https://ffmpeg.org/legal.html).
