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

On a Mac, open the DMG and drag snip to Applications. snip isn't notarized by Apple, so the
first time you open it macOS refuses. Go to System Settings, Privacy & Security, and click
Open Anyway, or run this once:

```sh
xattr -dr com.apple.quarantine /Applications/snip.app
```

## Good to know

Some presets keep the original video as it is, to save time and quality. With those, the clip
can start a few frames early. If you need exact cuts, pick a preset that says nothing about
keeping the original.

The preview can't play every format ffmpeg reads, like HEVC or WMV. For those, snip first makes a
smaller copy to edit with; the saved video is still made from the original.

## Contributing

To build snip yourself or change it, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE). The downloads include ffmpeg, which is licensed under the
[GPL](https://ffmpeg.org/legal.html). The interface uses the Archivo Black font, licensed under the
[SIL Open Font License](src/renderer/fonts/OFL.txt).
