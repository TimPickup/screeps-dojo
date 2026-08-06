import { ROOM_SIZE_TILES } from './renderConstants.ts';

export interface TerrainPoint {
	x: number;
	y: number;
}

interface BoundaryEdge {
	from: TerrainPoint;
	to: TerrainPoint;
}

export interface TerrainContour {
	vertices: TerrainPoint[];
}

export interface TerrainIsland {
	contours: TerrainContour[];
}

export interface IslandPathTarget {
	moveTo(x: number, y: number): void;
	lineTo(x: number, y: number): void;
	quadraticCurveTo(controlX: number, controlY: number, x: number, y: number): void;
	closePath(): void;
}

interface RoundedCorner {
	vertex: TerrainPoint;
	entry: TerrainPoint;
	exit: TerrainPoint;
	radius: number;
}

const CARDINAL_NEIGHBOURS = [
	{ dx: 0, dy: -1 },
	{ dx: 1, dy: 0 },
	{ dx: 0, dy: 1 },
	{ dx: -1, dy: 0 },
] as const;

function hasTerrainType(rows: string[], terrainType: string, x: number, y: number): boolean {
	return x >= 0 && x < ROOM_SIZE_TILES
		&& y >= 0 && y < ROOM_SIZE_TILES
		&& rows[y]?.[x] === terrainType;
}

function tileKey(x: number, y: number): number {
	return y * ROOM_SIZE_TILES + x;
}

function pointKey(point: TerrainPoint): string {
	return `${point.x},${point.y}`;
}

function samePoint(left: TerrainPoint, right: TerrainPoint): boolean {
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

function simplifyContour(vertices: TerrainPoint[]): TerrainPoint[] {
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

function traceContours(edges: BoundaryEdge[]): TerrainContour[] {
	const outgoingEdges = new Map<string, BoundaryEdge[]>();
	for (const edge of edges) {
		const key = pointKey(edge.from);
		const outgoing = outgoingEdges.get(key) || [];
		outgoing.push(edge);
		outgoingEdges.set(key, outgoing);
	}

	const unusedEdges = new Set(edges);
	const contours: TerrainContour[] = [];
	while (unusedEdges.size > 0) {
		let edge = unusedEdges.values().next().value as BoundaryEdge;
		const firstPoint = edge.from;
		const vertices: TerrainPoint[] = [firstPoint];
		while (true) {
			unusedEdges.delete(edge);
			if (samePoint(edge.to, firstPoint)) break;
			vertices.push(edge.to);
			const candidates = (outgoingEdges.get(pointKey(edge.to)) || [])
				.filter((candidate) => unusedEdges.has(candidate));
			if (candidates.length === 0) {
				throw new Error(`Open terrain contour at ${pointKey(edge.to)}`);
			}
			edge = chooseNextEdge(edge, candidates);
		}
		contours.push({ vertices: simplifyContour(vertices) });
	}
	return contours;
}

function boundaryEdgesForTiles(tiles: TerrainPoint[]): BoundaryEdge[] {
	const edges: BoundaryEdge[] = [];
	const occupiedTiles = new Set(tiles.map((tile) => tileKey(tile.x, tile.y)));
	const containsTile = (x: number, y: number) => x >= 0 && x < ROOM_SIZE_TILES
		&& y >= 0 && y < ROOM_SIZE_TILES
		&& occupiedTiles.has(tileKey(x, y));
	for (const tile of tiles) {
		const { x, y } = tile;
		// Directed clockwise so the island interior remains on the right. Hole
		// contours naturally receive the opposite winding.
		if (!containsTile(x, y - 1)) edges.push({ from: { x, y }, to: { x: x + 1, y } });
		if (!containsTile(x + 1, y)) edges.push({ from: { x: x + 1, y }, to: { x: x + 1, y: y + 1 } });
		if (!containsTile(x, y + 1)) edges.push({ from: { x: x + 1, y: y + 1 }, to: { x, y: y + 1 } });
		if (!containsTile(x - 1, y)) edges.push({ from: { x, y: y + 1 }, to: { x, y } });
	}
	return edges;
}

// Connectivity is deliberately room-local and cardinal. Diagonally touching
// terrain remains separate and neighbouring room terrain is never consulted.
export function buildTerrainIslands(rows: string[], terrainType: string): TerrainIsland[] {
	const visited = new Set<number>();
	const islands: TerrainIsland[] = [];
	for (let y = 0; y < ROOM_SIZE_TILES; y++) {
		for (let x = 0; x < ROOM_SIZE_TILES; x++) {
			if (!hasTerrainType(rows, terrainType, x, y) || visited.has(tileKey(x, y))) continue;
			const tiles: TerrainPoint[] = [];
			const pending: TerrainPoint[] = [{ x, y }];
			visited.add(tileKey(x, y));
			while (pending.length > 0) {
				const tile = pending.pop()!;
				tiles.push(tile);
				for (const neighbour of CARDINAL_NEIGHBOURS) {
					const nextX = tile.x + neighbour.dx;
					const nextY = tile.y + neighbour.dy;
					const nextKey = tileKey(nextX, nextY);
					if (!hasTerrainType(rows, terrainType, nextX, nextY) || visited.has(nextKey)) continue;
					visited.add(nextKey);
					pending.push({ x: nextX, y: nextY });
				}
			}
			islands.push({ contours: traceContours(boundaryEdgesForTiles(tiles)) });
		}
	}
	return islands;
}

function isRoomEdgeVertex(vertex: TerrainPoint): boolean {
	return vertex.x === 0 || vertex.x === ROOM_SIZE_TILES
		|| vertex.y === 0 || vertex.y === ROOM_SIZE_TILES;
}

function roundedCorners(contour: TerrainContour, cornerRadius: number): RoundedCorner[] {
	return contour.vertices.map((vertex, index, vertices) => {
		const previous = vertices[(index + vertices.length - 1) % vertices.length];
		const next = vertices[(index + 1) % vertices.length];
		const incomingLength = Math.hypot(vertex.x - previous.x, vertex.y - previous.y);
		const outgoingLength = Math.hypot(next.x - vertex.x, next.y - vertex.y);
		const radius = isRoomEdgeVertex(vertex)
			? 0
			: Math.min(cornerRadius, incomingLength / 2, outgoingLength / 2);
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

function appendRoundedContour(
	target: IslandPathTarget,
	contour: TerrainContour,
	cornerRadius: number,
): void {
	const corners = roundedCorners(contour, cornerRadius);
	if (corners.length === 0) return;
	target.moveTo(corners[0].entry.x, corners[0].entry.y);
	for (let index = 0; index < corners.length; index++) {
		const corner = corners[index];
		if (corner.radius > 0) {
			target.quadraticCurveTo(corner.vertex.x, corner.vertex.y, corner.exit.x, corner.exit.y);
		} else {
			target.lineTo(corner.vertex.x, corner.vertex.y);
		}
		const nextCorner = corners[(index + 1) % corners.length];
		target.lineTo(nextCorner.entry.x, nextCorner.entry.y);
	}
	target.closePath();
}

function isRoomBoundarySegment(from: TerrainPoint, to: TerrainPoint): boolean {
	return (from.x === to.x && (from.x === 0 || from.x === ROOM_SIZE_TILES))
		|| (from.y === to.y && (from.y === 0 || from.y === ROOM_SIZE_TILES));
}

function appendDecorativeContour(
	target: IslandPathTarget,
	contour: TerrainContour,
	cornerRadius: number,
): void {
	const corners = roundedCorners(contour, cornerRadius);
	const edgeIsInternal = contour.vertices.map((vertex, index, vertices) => (
		!isRoomBoundarySegment(vertex, vertices[(index + 1) % vertices.length])
	));
	if (edgeIsInternal.every(Boolean)) {
		appendRoundedContour(target, contour, cornerRadius);
		return;
	}

	for (let startIndex = 0; startIndex < corners.length; startIndex++) {
		const previousIndex = (startIndex + corners.length - 1) % corners.length;
		if (!edgeIsInternal[startIndex] || edgeIsInternal[previousIndex]) continue;
		target.moveTo(corners[startIndex].exit.x, corners[startIndex].exit.y);
		let edgeIndex = startIndex;
		while (edgeIsInternal[edgeIndex]) {
			const nextIndex = (edgeIndex + 1) % corners.length;
			const nextCorner = corners[nextIndex];
			target.lineTo(nextCorner.entry.x, nextCorner.entry.y);
			if (!edgeIsInternal[nextIndex]) break;
			if (nextCorner.radius > 0) {
				target.quadraticCurveTo(
					nextCorner.vertex.x,
					nextCorner.vertex.y,
					nextCorner.exit.x,
					nextCorner.exit.y,
				);
			} else {
				target.lineTo(nextCorner.exit.x, nextCorner.exit.y);
			}
			edgeIndex = nextIndex;
		}
	}
}

export function appendIslandFillPaths(
	target: IslandPathTarget,
	islands: TerrainIsland[],
	cornerRadius: number,
): void {
	for (const island of islands) {
		for (const contour of island.contours) appendRoundedContour(target, contour, cornerRadius);
	}
}

export function appendIslandBoundaryPaths(
	target: IslandPathTarget,
	islands: TerrainIsland[],
	cornerRadius: number,
): void {
	for (const island of islands) {
		for (const contour of island.contours) appendDecorativeContour(target, contour, cornerRadius);
	}
}
