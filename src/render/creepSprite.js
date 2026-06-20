'use strict';

// In-game-style creep rendering (body-part ring), shared between the Node
// renderer and the browser viewer (no Node APIs; UMD-lite export at the
// bottom). Look: black ring, MOVE arc bottom-centred, action arcs stacked
// symmetrically at the top (earlier types peek out beneath later ones),
// TOUGH outline at the bottom-left, grey body, cargo dot.
(function (exportTarget) {
	const MAX_BODY_PARTS = 50;
	const PART_ANGLE = 360 / MAX_BODY_PARTS;
	const PART_COLORS = {
		heal: '#5cff6a',
		rangedAttack: '#5f8fdc',
		attack: '#ff3b4f',
		work: '#ffe25a',
		claim: '#b46cff',
		move: '#d7e0e5',
		tough: '#e8e8e8',
		ring: '#1c1c1c',
		inner: '#666666',
		energy: '#ffe25a',
		cargoOther: '#ffffff'
	};
	const TOP_PART_ORDER = [
		{ key: 'heal', color: PART_COLORS.heal },
		{ key: 'rangedAttack', color: PART_COLORS.rangedAttack },
		{ key: 'attack', color: PART_COLORS.attack },
		{ key: 'work', color: PART_COLORS.work },
		{ key: 'claim', color: PART_COLORS.claim }
	];

	function pointOnCircle(cx, cy, radius, angleDeg) {
		const rad = angleDeg * Math.PI / 180;
		return { x: cx + Math.sin(rad) * radius, y: cy - Math.cos(rad) * radius };
	}

	function arcPath(cx, cy, radius, startAngle, endAngle) {
		const start = pointOnCircle(cx, cy, radius, startAngle);
		const end = pointOnCircle(cx, cy, radius, endAngle);
		const largeArcFlag = Math.abs(endAngle - startAngle) > 180 ? 1 : 0;
		return 'M ' + start.x.toFixed(3) + ' ' + start.y.toFixed(3)
			+ ' A ' + radius.toFixed(3) + ' ' + radius.toFixed(3) + ' 0 ' + largeArcFlag + ' 1 '
			+ end.x.toFixed(3) + ' ' + end.y.toFixed(3);
	}

	function arc(cx, cy, radius, startAngle, endAngle, color, width) {
		if (Math.abs(endAngle - startAngle) <= 0.001) return '';
		return '<path d="' + arcPath(cx, cy, radius, startAngle, endAngle)
			+ '" fill="none" stroke="' + color + '" stroke-width="' + width.toFixed(3)
			+ '" stroke-linecap="butt"/>';
	}

	// body = [{type, hits}] from the recording; destroyed parts (hits 0) vanish
	// from the ring, mirroring how damage reads in the real client.
	function countBodyParts(body) {
		const counts = {};
		for (const part of body || []) {
			if (part.hits !== undefined && part.hits <= 0) continue;
			counts[part.type] = (counts[part.type] || 0) + 1;
		}
		return counts;
	}

	// cx/cy = tile-centre coordinates (tile units); size = creep diameter in
	// tiles. storeCapacity scales the cargo dot (full load almost — never
	// quite — covers the inner body color). rotationDegrees turns the whole
	// ring about its centre: the design "faces" UP (action arcs at the top,
	// MOVE at the bottom), so pass facing+90 to point it along a heading
	// where 0 degrees = east. Returns an SVG fragment (<g>); the caller
	// controls layer order.
	function generateCreepSvg(cx, cy, size, bodyCounts, store, opacity, innerColor, storeCapacity, rotationDegrees) {
		const unit = size / 100; // geometry below lives in a 100-unit design space
		const ringRadius = 28 * unit;
		const ringWidth = 12 * unit;
		const innerRadius = 18 * unit;

		const rotation = rotationDegrees ? ' transform="rotate(' + rotationDegrees.toFixed(1)
			+ ' ' + cx + ' ' + cy + ')"' : '';
		let svg = '<g class="dojo-creep" opacity="' + (opacity !== undefined ? opacity : 1) + '"' + rotation + '>';
		svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + ringRadius.toFixed(3)
			+ '" fill="none" stroke="' + PART_COLORS.ring + '" stroke-width="' + ringWidth.toFixed(3) + '"/>';

		if (bodyCounts.tough > 0) {
			const toughSpan = bodyCounts.tough * PART_ANGLE;
			const toughRadius = ringRadius + ringWidth / 2 + 2 * unit;
			svg += arc(cx, cy, toughRadius, 225 - toughSpan / 2, 225 + toughSpan / 2, PART_COLORS.tough, 4 * unit);
		}

		if (bodyCounts.move > 0) {
			const moveSpan = bodyCounts.move * PART_ANGLE;
			svg += arc(cx, cy, ringRadius, 180 - moveSpan / 2, 180 + moveSpan / 2, PART_COLORS.move, ringWidth);
		}

		// top arcs: each type spans the cumulative count of itself plus every
		// type after it in TOP_PART_ORDER, drawn widest-first, so earlier types
		// peek out symmetrically beneath later ones
		for (let i = 0; i < TOP_PART_ORDER.length; i++) {
			let cumulative = 0;
			for (let j = i; j < TOP_PART_ORDER.length; j++) cumulative += bodyCounts[TOP_PART_ORDER[j].key] || 0;
			if (cumulative <= 0) continue;
			const span = cumulative * PART_ANGLE;
			svg += arc(cx, cy, ringRadius, -span / 2, span / 2, TOP_PART_ORDER[i].color, ringWidth);
		}

		svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + innerRadius.toFixed(3)
			+ '" fill="' + (innerColor || PART_COLORS.inner) + '"/>';

		// cargo dot: energy-yellow when carrying only energy, white otherwise.
		// Radius scales with fill fraction; at full capacity it reaches 16 of
		// the inner body's 18 units, so the body color always stays visible.
		const carried = Object.keys(store || {}).filter(function (resource) { return (store || {})[resource] > 0; });
		if (carried.length > 0) {
			const cargoColor = carried.length === 1 && carried[0] === 'energy'
				? PART_COLORS.energy : PART_COLORS.cargoOther;
			let cargoRadius = 6 * unit;
			if (typeof storeCapacity === 'number' && storeCapacity > 0) {
				let used = 0;
				for (const resource of carried) used += store[resource];
				const fraction = Math.min(1, used / storeCapacity);
				cargoRadius = (4 + 12 * fraction) * unit;
			}
			svg += '<circle cx="' + cx + '" cy="' + cy + '" r="' + cargoRadius.toFixed(3)
				+ '" fill="' + cargoColor + '"/>';
		}

		svg += '</g>';
		return svg;
	}

	exportTarget.generateCreepSvg = generateCreepSvg;
	exportTarget.countBodyParts = countBodyParts;
})(typeof module !== 'undefined' && module.exports ? module.exports : (window.DojoCreepSprite = {}));
