import type { Frame, FrameObject } from '../api/types.ts';

const populatedFrames = new WeakMap<Frame, string | undefined>();

export function populateObjectMy(object: FrameObject, botUserId?: string): FrameObject {
	object.my = botUserId !== undefined
		? String(object.user) === String(botUserId)
		: object.user === 'me';
	return object;
}

// Frame objects are immutable snapshots in recordings/live streams. Remember
// which bot id prepared each frame so a 60fps replay only walks it once.
export function populateFrameMy(frame: Frame, botUserId?: string): Frame {
	if (populatedFrames.has(frame) && populatedFrames.get(frame) === botUserId) return frame;
	for (const object of frame.objects) populateObjectMy(object, botUserId);
	populatedFrames.set(frame, botUserId);
	return frame;
}
