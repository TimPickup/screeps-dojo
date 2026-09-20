import { describe, expect, it } from 'vitest';
import {
	BOOSTS, PLACEABLES, glyphFor, labelFor, mineralTypes, placeable, placeablesFor, rclLimit, roadHitsFor,
} from '../gameData';

describe('RCL limits', () => {
	it('matches CONTROLLER_STRUCTURES at the levels that matter', () => {
		expect(rclLimit('spawn', 0)).toBe(0);
		expect(rclLimit('spawn', 7)).toBe(2);
		expect(rclLimit('spawn', 8)).toBe(3);
		expect(rclLimit('extension', 2)).toBe(5);
		expect(rclLimit('extension', 8)).toBe(60);
		expect(rclLimit('tower', 3)).toBe(1);
		expect(rclLimit('tower', 8)).toBe(6);
		expect(rclLimit('lab', 6)).toBe(3);
		expect(rclLimit('lab', 8)).toBe(10);
		expect(rclLimit('link', 5)).toBe(2);
		expect(rclLimit('storage', 4)).toBe(1);
		expect(rclLimit('terminal', 6)).toBe(1);
		expect(rclLimit('factory', 7)).toBe(1);
		expect(rclLimit('nuker', 8)).toBe(1);
		expect(rclLimit('container', 0)).toBe(5);
	});

	it('reports no limit for things the controller does not gate', () => {
		expect(rclLimit('source', 8)).toBeNull();
		expect(rclLimit('creep', 8)).toBeNull();
		expect(rclLimit('keeperLair', 8)).toBeNull();
		expect(rclLimit('energy', 8)).toBeNull();
	});

	it('clamps an out-of-range RCL rather than reading past the table', () => {
		expect(rclLimit('tower', -3)).toBe(0);
		expect(rclLimit('tower', 99)).toBe(6);
	});
});

describe('placeables', () => {
	it('hides a mod object until its mod is selected', () => {
		expect(placeablesFor(undefined).some((item) => item.type === 'reactor')).toBe(false);
		expect(placeablesFor(['season5']).some((item) => item.type === 'reactor')).toBe(true);
	});

	it('adds a mod mineral to the mineral list', () => {
		expect(mineralTypes(undefined)).not.toContain('T');
		expect(mineralTypes(['season5'])).toContain('T');
	});

	it('covers every type the dojo loader knows how to place', () => {
		const known = [
			'spawn', 'extension', 'tower', 'storage', 'terminal', 'link', 'lab', 'factory',
			'observer', 'powerSpawn', 'nuker', 'rampart', 'constructedWall', 'road', 'container',
			'extractor', 'keeperLair', 'invaderCore', 'powerBank', 'source', 'mineral', 'controller',
			'deposit', 'creep', 'flag',
		];
		for (const type of known) expect(placeable(type), type).toBeDefined();
	});

	it('gives every placeable a label and a glyph', () => {
		for (const item of PLACEABLES) {
			expect(labelFor(item.type)).toBeTruthy();
			expect(glyphFor(item.type)).toBeTruthy();
		}
	});
});

describe('boosts', () => {
	it('offers three tiers for each boostable part', () => {
		for (const part of ['attack', 'ranged_attack', 'heal', 'carry', 'move', 'tough']) {
			expect(BOOSTS[part], part).toHaveLength(3);
		}
		// work has four separate actions boosted, three tiers each
		expect(BOOSTS.work).toHaveLength(12);
	});

	it('offers none for claim, which vanilla does not boost', () => {
		expect(BOOSTS.claim).toEqual([]);
	});
});

describe('road hits', () => {
	it('scales with the terrain the road sits on', () => {
		expect(roadHitsFor('.')).toBe(5000);
		expect(roadHitsFor('~')).toBe(25000);
		expect(roadHitsFor('#')).toBe(750000);
	});
});
