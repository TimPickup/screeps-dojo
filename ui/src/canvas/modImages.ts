// Artwork a game mod brings with it, shared by the three renderers that draw a
// frame: the live preview, the replay, and the server-side video/GIF export.
//
// Every field is optional and every drawing routine has a vector fallback: the
// canvas tests run without any images at all, and a renderer that could not
// load a file must still draw something recognisable rather than nothing.
export interface ModImages {
	reactorCore?: CanvasImageSource;
	reactorEdge?: CanvasImageSource;
	thorium?: CanvasImageSource;
}
