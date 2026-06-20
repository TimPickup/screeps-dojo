'use strict';

// Dual-environment (Node + browser) SVG primitives: FakeRoomVisual drawing
// surface, elementToSvg converter, and svgEscape helper. No Node APIs; safe
// to inline into the browser editor. UMD-lite export mirrors creepSprite.js.
(function (exportTarget) {

	function normalizePoints(points) {
		return points.map(function (point) {
			return Array.isArray(point) ? [point[0], point[1]] : [point.x, point.y];
		});
	}

	class FakeRoomVisual {
		constructor(roomName) {
			this.roomName = roomName;
			this.elements = [];
		}

		line(x1, y1, x2, y2, style) {
			this.elements.push({ kind: 'line', x1: x1, y1: y1, x2: x2, y2: y2, style: style || {} });
			return this;
		}

		circle(x, y, style) {
			this.elements.push({ kind: 'circle', x: x, y: y, style: style || {} });
			return this;
		}

		rect(x, y, width, height, style) {
			this.elements.push({ kind: 'rect', x: x, y: y, width: width, height: height, style: style || {} });
			return this;
		}

		poly(points, style) {
			this.elements.push({ kind: 'poly', points: normalizePoints(points), style: style || {} });
			return this;
		}

		text(text, x, y, style) {
			this.elements.push({ kind: 'text', text: String(text), x: x, y: y, style: style || {} });
			return this;
		}

		clear() {
			this.elements = [];
			this.roads = undefined; // lib/RoomVisual.js road accumulator
			return this;
		}
	}

	function svgEscape(text) {
		return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;');
	}

	function styleColor(value, fallback) {
		if (value === undefined || value === null || value === false) return fallback;
		if (value === 'transparent') return 'none';
		return value;
	}

	// One RoomVisual element -> SVG, in TILE units (the caller wraps in a
	// scaled <g>). Tile centers sit at integer coordinates, so +0.5 shifts to
	// the tile-grid origin.
	function elementToSvg(element) {
		const style = element.style;
		const opacity = style.opacity !== undefined ? style.opacity : 1;
		switch (element.kind) {
			case 'line': {
				const stroke = styleColor(style.color, '#ffffff');
				const width = style.width !== undefined ? style.width : 0.1;
				return '<line x1="' + (element.x1 + 0.5) + '" y1="' + (element.y1 + 0.5)
					+ '" x2="' + (element.x2 + 0.5) + '" y2="' + (element.y2 + 0.5)
					+ '" stroke="' + stroke + '" stroke-width="' + width
					+ '" opacity="' + opacity + '" stroke-linecap="round"/>';
			}
			case 'circle': {
				const radius = style.radius !== undefined ? style.radius : 0.15;
				const fill = styleColor(style.fill, '#ffffff');
				const stroke = styleColor(style.stroke, 'none');
				const strokeWidth = style.strokeWidth !== undefined ? style.strokeWidth : 0.05;
				return '<circle cx="' + (element.x + 0.5) + '" cy="' + (element.y + 0.5)
					+ '" r="' + radius + '" fill="' + fill + '" stroke="' + stroke
					+ '" stroke-width="' + strokeWidth + '" opacity="' + opacity + '"/>';
			}
			case 'rect': {
				const fill = styleColor(style.fill, '#ffffff');
				const stroke = styleColor(style.stroke, 'none');
				const strokeWidth = style.strokeWidth !== undefined ? style.strokeWidth : 0.05;
				return '<rect x="' + (element.x + 0.5) + '" y="' + (element.y + 0.5)
					+ '" width="' + element.width + '" height="' + element.height
					+ '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="' + strokeWidth
					+ '" opacity="' + opacity + '"/>';
			}
			case 'poly': {
				const fill = styleColor(style.fill, 'none');
				const stroke = styleColor(style.stroke, '#ffffff');
				const strokeWidth = style.strokeWidth !== undefined ? style.strokeWidth : 0.05;
				const points = element.points.map(function (point) {
					return (point[0] + 0.5) + ',' + (point[1] + 0.5);
				}).join(' ');
				return '<polyline points="' + points + '" fill="' + fill + '" stroke="' + stroke
					+ '" stroke-width="' + strokeWidth + '" opacity="' + opacity
					+ '" stroke-linejoin="round"/>';
			}
			case 'text': {
				const color = styleColor(style.color, '#ffffff');
				// font may be a number (size in tiles) or a CSS-ish string; keep it simple
				let fontSize = 0.5;
				if (typeof style.font === 'number') fontSize = style.font;
				else if (typeof style.font === 'string') {
					const match = /([\d.]+)/.exec(style.font);
					if (match) fontSize = Number(match[1]);
				}
				const anchor = style.align === 'left' ? 'start' : style.align === 'right' ? 'end' : 'middle';
				let background = '';
				if (style.backgroundColor) {
					const padding = style.backgroundPadding !== undefined ? style.backgroundPadding : 0.3;
					const width = element.text.length * fontSize * 0.6 + padding * 2;
					const height = fontSize + padding * 2;
					background = '<rect x="' + (element.x + 0.5 - width / 2) + '" y="'
						+ (element.y + 0.5 - height / 2 - fontSize * 0.33) + '" width="' + width
						+ '" height="' + height + '" rx="' + padding + '" fill="'
						+ style.backgroundColor + '" opacity="' + opacity + '"/>';
				}
				return background + '<text x="' + (element.x + 0.5) + '" y="' + (element.y + 0.5)
					+ '" font-size="' + fontSize + '" fill="' + color + '" text-anchor="' + anchor
					+ '" font-family="DejaVu Sans" opacity="' + opacity + '">'
					+ svgEscape(element.text) + '</text>';
			}
			default:
				return '';
		}
	}

	exportTarget.FakeRoomVisual = FakeRoomVisual;
	exportTarget.elementToSvg = elementToSvg;
	exportTarget.svgEscape = svgEscape;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.DojoSvgPrimitives = {}));
