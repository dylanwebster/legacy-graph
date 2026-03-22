import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs/promises';
import * as path from 'path';
import sharp from 'sharp';
import { parseExifDateToISO, extractExifDate } from '../../src/core/assetMetaUtils';

const FIXTURES = path.join(__dirname, '../fixtures/assetMeta-test');

describe('parseExifDateToISO', () => {
    it('parses a Date object', () => {
        expect(parseExifDateToISO(new Date('2026-03-14T15:50:17.000Z'))).toBe('2026-03-14');
    });

    it('parses an ISO date string', () => {
        expect(parseExifDateToISO('2026-03-14T15:50:17.000Z')).toBe('2026-03-14');
    });

    it('returns null for undefined', () => {
        expect(parseExifDateToISO(undefined)).toBeNull();
    });

    it('returns null for null', () => {
        expect(parseExifDateToISO(null)).toBeNull();
    });

    it('returns null for a non-date string', () => {
        expect(parseExifDateToISO('not a date')).toBeNull();
    });

    it('handles a date at start of day in UTC', () => {
        expect(parseExifDateToISO(new Date('2020-01-01T00:00:00.000Z'))).toBe('2020-01-01');
    });
});

describe('extractExifDate', () => {
    beforeEach(() => fs.mkdir(FIXTURES, { recursive: true }));
    afterEach(() => fs.rm(FIXTURES, { recursive: true, force: true }));

    it('returns null for a non-image file', async () => {
        const p = path.join(FIXTURES, 'test.txt');
        await fs.writeFile(p, 'hello');
        expect(await extractExifDate(p)).toBeNull();
    });

    it('returns null for a non-image extension (pdf)', async () => {
        const p = path.join(FIXTURES, 'test.pdf');
        await fs.writeFile(p, '%PDF-1.4');
        expect(await extractExifDate(p)).toBeNull();
    });

    it('returns null for a synthetic JPEG with no EXIF date', async () => {
        const p = path.join(FIXTURES, 'no-exif.jpg');
        await sharp({
            create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 100, b: 50 } },
        }).jpeg().toFile(p);
        expect(await extractExifDate(p)).toBeNull();
    });

    it('returns null for a non-existent file path', async () => {
        expect(await extractExifDate(path.join(FIXTURES, 'ghost.jpg'))).toBeNull();
    });
});
