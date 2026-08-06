import type { Frame, FrameObject, StageLayout } from '../api/types.ts';
import { ROOM_SIZE_TILES } from './renderConstants.ts';

interface CachedFrameOrder {
	frame: Frame;
	orderedObjects: FrameObject[];
}

const RECENT_FRAME_CACHE_SIZE = 4;
const recentFrameOrdersByLayout = new WeakMap<StageLayout, CachedFrameOrder[]>();

function worldY(object: FrameObject, layout: StageLayout): number {
	const roomOffset = layout.offsets[object.room];
	return roomOffset ? roomOffset.row * ROOM_SIZE_TILES + object.y : Number.POSITIVE_INFINITY;
}

// Keep only the frames involved in the current interpolation/scrub window.
// This avoids repeated subframe sorts without retaining a second object array
// for every frame in a long recording.
export function frameObjectsInDrawOrder(frame: Frame, layout: StageLayout): FrameObject[] {
	const recentFrameOrders = recentFrameOrdersByLayout.get(layout) || [];
	const cachedOrder = recentFrameOrders.find((entry) => entry.frame === frame);
	if (cachedOrder) return cachedOrder.orderedObjects;

	const orderedObjects = frame.objects
		.map((object, recordingIndex) => ({
			object,
			recordingIndex,
			worldY: worldY(object, layout),
		}))
		.sort((left, right) => (
			left.worldY - right.worldY
			|| left.recordingIndex - right.recordingIndex
		))
		.map(({ object }) => object);
	recentFrameOrders.push({ frame, orderedObjects });
	if (recentFrameOrders.length > RECENT_FRAME_CACHE_SIZE) recentFrameOrders.shift();
	recentFrameOrdersByLayout.set(layout, recentFrameOrders);
	return orderedObjects;
}
