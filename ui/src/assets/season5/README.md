# Season 5 artwork

`reactor-core.png`, `reactor-edge.png` and `T.png` are vendored verbatim from
the official Season 5 mod, at the commit the dojo pins in `package.json`:

    https://github.com/screeps/mod-season5
    da5911877f9d06cc86d8d7db6c44576c3ffc757b   (assets/)

MIT licensed — see `LICENSE` in this directory, copied from that repository.

They are vendored rather than fetched from the official CDN because the dojo
renders offline and in a container, and because the same files have to be
readable by both renderers: the browser (Vite imports them) and the server-side
video/GIF export (`src/render/videoRenderer.js` reads them off disk).

Only the reactor and Thorium art is here. The rest of the dojo's rendering is
drawn procedurally, so a mod object without artwork still gets a labelled
marker rather than disappearing.
