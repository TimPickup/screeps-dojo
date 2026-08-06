import { RENDER_COLORS, ROOM_SIZE_TILES, WALL_RENDER_STYLE } from './renderConstants.ts';

export interface WallPoint {
	x: number;
	y: number;
}

interface BoundaryEdge {
	from: WallPoint;
	to: WallPoint;
}

export interface WallContour {
	vertices: WallPoint[];
}

export interface WallIsland {
	contours: WallContour[];
}

interface RoundedCorner {
	vertex: WallPoint;
	entry: WallPoint;
	exit: WallPoint;
	radius: number;
}

const CARDINAL_NEIGHBOURS = [
	{ dx: 0, dy: -1 },
	{ dx: 1, dy: 0 },
	{ dx: 0, dy: 1 },
	{ dx: -1, dy: 0 },
] as const;

function isWall(rows: string[], x: number, y: number): boolean {
	return x >= 0 && x < ROOM_SIZE_TILES
		&& y >= 0 && y < ROOM_SIZE_TILES
		&& rows[y]?.[x] === '#';
}

function tileKey(x: number, y: number): number {
	return y * ROOM_SIZE_TILES + x;
}

function pointKey(point: WallPoint): string {
	return `${point.x},${point.y}`;
}

function samePoint(left: WallPoint, right: WallPoint): boolean {
	return left.x === right.x && left.y === right.y;
}

function edgeDirection(edge: BoundaryEdge): number {
	if (edge.to.x > edge.from.x) return 0;
	if (edge.to.y > edge.from.y) return 1;
	if (edge.to.x < edge.from.x) return 2;
	return 3;
}

function chooseNextEdge(current: BoundaryEdge, candidates: BoundaryEdge[]): BoundaryEdge {
	const currentDirection = edgeDirection(current);
	const turnPreference = [1, 0, 3, 2]; // right, straight, left, reverse
	return candidates.slice().sort((left, right) => {
		const leftTurn = (edgeDirection(left) - currentDirection + 4) % 4;
		const rightTurn = (edgeDirection(right) - currentDirection + 4) % 4;
		return turnPreference.indexOf(leftTurn) - turnPreference.indexOf(rightTurn);
	})[0];
}

function simplifyContour(vertices: WallPoint[]): WallPoint[] {
	if (vertices.length < 3) return vertices;
	return vertices.filter((vertex, index) => {
		const previous = vertices[(index + vertices.length - 1) % vertices.length];
		const next = vertices[(index + 1) % vertices.length];
		const incomingX = vertex.x - previous.x;
		const incomingY = vertex.y - previous.y;
		const outgoingX = next.x - vertex.x;
		const outgoingY = next.y - vertex.y;
		return incomingX !== outgoingX || incomingY !== outgoingY;
	});
}

function traceContours(edges: BoundaryEdge[]): WallContour[] {
	const outgoingEdges = new Map<string, BoundaryEdge[]>();
	for (const edge of edges) {
		const key = pointKey(edge.from);
		const outgoing = outgoingEdges.get(key) || [];
		outgoing.push(edge);
		outgoingEdges.set(key, outgoing);
	}

	const unusedEdges = new Set(edges);
	const contours: WallContour[] = [];
	while (unusedEdges.size > 0) {
		let edge = unusedEdges.values().next().value as BoundaryEdge;
		const firstPoint = edge.from;
		const vertices: WallPoint[] = [firstPoint];
		while (true) {
			unusedEdges.delete(edge);
			if (samePoint(edge.to, firstPoint)) break;
			vertices.push(edge.to);
			const candidates = (outgoingEdges.get(pointKey(edge.to)) || [])
				.filter((candidate) => unusedEdges.has(candidate));
			if (candidates.length === 0) {
				throw new Error(`Open wall contour at ${pointKey(edge.to)}`);
			}
			edge = chooseNextEdge(edge, candidates);
		}
		contours.push({ vertices: simplifyContour(vertices) });
	}
	return contours;
}

function boundaryEdgesForTiles(tiles: WallPoint[]): BoundaryEdge[] {
	const edges: BoundaryEdge[] = [];
	const occupiedTiles = new Set(tiles.map((tile) => tileKey(tile.x, tile.y)));
	const containsTile = (x: number, y: number) => x >= 0 && x < ROOM_SIZE_TILES
		&& y >= 0 && y < ROOM_SIZE_TILES
		&& occupiedTiles.has(tileKey(x, y));
	for (const tile of tiles) {
		const { x, y } = tile;
		// Directed clockwise so the wall interior remains on the right. Hole
		// contours naturally receive the opposite winding.
		if (!containsTile(x, y - 1)) edges.push({ from: { x, y }, to: { x: x + 1, y } });
		if (!containsTile(x + 1, y)) edges.push({ from: { x: x + 1, y }, to: { x: x + 1, y: y + 1 } });
		if (!containsTile(x, y + 1)) edges.push({ from: { x: x + 1, y: y + 1 }, to: { x, y: y + 1 } });
		if (!containsTile(x - 1, y)) edges.push({ from: { x, y: y + 1 }, to: { x, y } });
	}
	return edges;
}

// Cardinal connectivity is deliberately room-local. Diagonally touching walls
// remain separate islands and no neighbouring room terrain is consulted.
export function buildWallIslands(rows: string[]): WallIsland[] {
	const visited = new Set<number>();
	const islands: WallIsland[] = [];
	for (let y = 0; y < ROOM_SIZE_TILES; y++) {
		for (let x = 0; x < ROOM_SIZE_TILES; x++) {
			if (!isWall(rows, x, y) || visited.has(tileKey(x, y))) continue;
			const tiles: WallPoint[] = [];
			const pending: WallPoint[] = [{ x, y }];
			visited.add(tileKey(x, y));
			while (pending.length > 0) {
				const tile = pending.pop()!;
				tiles.push(tile);
				for (const neighbour of CARDINAL_NEIGHBOURS) {
					const nextX = tile.x + neighbour.dx;
					const nextY = tile.y + neighbour.dy;
					const nextKey = tileKey(nextX, nextY);
					if (!isWall(rows, nextX, nextY) || visited.has(nextKey)) continue;
					visited.add(nextKey);
					pending.push({ x: nextX, y: nextY });
				}
			}
			islands.push({ contours: traceContours(boundaryEdgesForTiles(tiles)) });
		}
	}
	return islands;
}

function isRoomEdgeVertex(vertex: WallPoint): boolean {
	return vertex.x === 0 || vertex.x === ROOM_SIZE_TILES
		|| vertex.y === 0 || vertex.y === ROOM_SIZE_TILES;
}

function roundedCorners(contour: WallContour): RoundedCorner[] {
	return contour.vertices.map((vertex, index, vertices) => {
		const previous = vertices[(index + vertices.length - 1) % vertices.length];
		const next = vertices[(index + 1) % vertices.length];
		const incomingLength = Math.hypot(vertex.x - previous.x, vertex.y - previous.y);
		const outgoingLength = Math.hypot(next.x - vertex.x, next.y - vertex.y);
		const radius = isRoomEdgeVertex(vertex)
			? 0
			: Math.min(WALL_RENDER_STYLE.cornerRadius, incomingLength / 2, outgoingLength / 2);
		const incomingX = incomingLength ? (vertex.x - previous.x) / incomingLength : 0;
		const incomingY = incomingLength ? (vertex.y - previous.y) / incomingLength : 0;
		const outgoingX = outgoingLength ? (next.x - vertex.x) / outgoingLength : 0;
		const outgoingY = outgoingLength ? (next.y - vertex.y) / outgoingLength : 0;
		return {
			vertex,
			entry: { x: vertex.x - incomingX * radius, y: vertex.y - incomingY * radius },
			exit: { x: vertex.x + outgoingX * radius, y: vertex.y + outgoingY * radius },
			radius,
		};
	});
}

function appendRoundedContour(ctx: CanvasRenderingContext2D, contour: WallContour): void {
	const corners = roundedCorners(contour);
	if (corners.length === 0) return;
	ctx.moveTo(corners[0].entry.x, corners[0].entry.y);
	for (let index = 0; index < corners.length; index++) {
		const corner = corners[index];
		if (corner.radius > 0) {
			ctx.quadraticCurveTo(corner.vertex.x, corner.vertex.y, corner.exit.x, corner.exit.y);
		} else {
			ctx.lineTo(corner.vertex.x, corner.vertex.y);
		}
		const nextCorner = corners[(index + 1) % corners.length];
		ctx.lineTo(nextCorner.entry.x, nextCorner.entry.y);
	}
	ctx.closePath();
}

function isRoomBoundarySegment(from: WallPoint, to: WallPoint): boolean {
	return (from.x === to.x && (from.x === 0 || from.x === ROOM_SIZE_TILES))
		|| (from.y === to.y && (from.y === 0 || from.y === ROOM_SIZE_TILES));
}

function appendDecorativeContour(ctx: CanvasRenderingContext2D, contour: WallContour): void {
	const corners = roundedCorners(contour);
	const edgeIsInternal = contour.vertices.map((vertex, index, vertices) => (
		!isRoomBoundarySegment(vertex, vertices[(index + 1) % vertices.length])
	));
	if (edgeIsInternal.every(Boolean)) {
		appendRoundedContour(ctx, contour);
		return;
	}

	for (let startIndex = 0; startIndex < corners.length; startIndex++) {
		const previousIndex = (startIndex + corners.length - 1) % corners.length;
		if (!edgeIsInternal[startIndex] || edgeIsInternal[previousIndex]) continue;
		ctx.moveTo(corners[startIndex].exit.x, corners[startIndex].exit.y);
		let edgeIndex = startIndex;
		while (edgeIsInternal[edgeIndex]) {
			const nextIndex = (edgeIndex + 1) % corners.length;
			const nextCorner = corners[nextIndex];
			ctx.lineTo(nextCorner.entry.x, nextCorner.entry.y);
			if (!edgeIsInternal[nextIndex]) break;
			if (nextCorner.radius > 0) {
				ctx.quadraticCurveTo(
					nextCorner.vertex.x,
					nextCorner.vertex.y,
					nextCorner.exit.x,
					nextCorner.exit.y,
				);
			} else {
				ctx.lineTo(nextCorner.exit.x, nextCorner.exit.y);
			}
			edgeIndex = nextIndex;
		}
	}
}

function appendFillPaths(ctx: CanvasRenderingContext2D, islands: WallIsland[]): void {
	ctx.beginPath();
	for (const island of islands) {
		for (const contour of island.contours) appendRoundedContour(ctx, contour);
	}
}

function appendDecorativePaths(ctx: CanvasRenderingContext2D, islands: WallIsland[]): void {
	ctx.beginPath();
	for (const island of islands) {
		for (const contour of island.contours) appendDecorativeContour(ctx, contour);
	}
}

function strokeDecorativePaths(
	ctx: CanvasRenderingContext2D,
	islands: WallIsland[],
	color: string,
	width: number,
): void {
	appendDecorativePaths(ctx, islands);
	ctx.strokeStyle = color;
	ctx.lineWidth = width;
	ctx.lineCap = 'butt';
	ctx.lineJoin = 'round';
	ctx.stroke();
}

function drawRoomTexture(ctx: CanvasRenderingContext2D, texture: CanvasImageSource): void {
	ctx.imageSmoothingEnabled = true;
	ctx.globalAlpha = WALL_RENDER_STYLE.textureOpacity;
	ctx.globalCompositeOperation = 'source-over';
	ctx.drawImage(texture, 0, 0, ROOM_SIZE_TILES, ROOM_SIZE_TILES);
}

export function drawWallIslands(
	ctx: CanvasRenderingContext2D,
	rows: string[],
	texture?: CanvasImageSource,
): void {
	const islands = buildWallIslands(rows);
	if (islands.length === 0) return;

	ctx.save();
	strokeDecorativePaths(
		ctx,
		islands,
		RENDER_COLORS.terrain.wallOuterShadow,
		WALL_RENDER_STYLE.outerShadowWidth,
	);
	ctx.restore();

	ctx.save();
	appendFillPaths(ctx, islands);
	ctx.fillStyle = RENDER_COLORS.terrain.wall;
	ctx.fill();
	if (texture) {
		ctx.clip();
		drawRoomTexture(ctx, texture);
	}
	ctx.restore();

	ctx.save();
	appendFillPaths(ctx, islands);
	ctx.clip();
	strokeDecorativePaths(
		ctx,
		islands,
		RENDER_COLORS.terrain.wallInnerGlow,
		WALL_RENDER_STYLE.innerGlowWidth,
	);
	strokeDecorativePaths(
		ctx,
		islands,
		RENDER_COLORS.terrain.wallInnerHighlight,
		WALL_RENDER_STYLE.innerHighlightWidth,
	);
	ctx.restore();

	ctx.save();
	strokeDecorativePaths(
		ctx,
		islands,
		RENDER_COLORS.terrain.wallOutline,
		WALL_RENDER_STYLE.outlineWidth,
	);
	ctx.restore();
}
