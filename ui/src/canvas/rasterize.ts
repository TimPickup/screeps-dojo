// Rasterize an SVG string to an HTMLImageElement for canvas drawing.
// encodeURIComponent (NOT raw — a '#' in a fill colour truncates the data URL;
// NOT base64 — slower). The SVGs are self-contained so the canvas is never tainted.
export function svgToImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  });
}
