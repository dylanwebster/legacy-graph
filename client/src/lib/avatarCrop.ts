export type CropArea = { x: number; y: number; width: number; height: number };

const key = (personId: string) => `legacygraph_avatar_crop_${personId}`;

export const loadAvatarCrop = (personId: string): CropArea | null => {
    const raw = localStorage.getItem(key(personId));
    if (raw === null) return null;
    try {
        const p = JSON.parse(raw) as Record<string, unknown>;
        const { x, y, width, height } = p;
        const ok = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
        if (!ok(x) || !ok(y) || !ok(width) || !ok(height) || width <= 0 || height <= 0) {
            localStorage.removeItem(key(personId));
            return null;
        }
        return { x, y, width, height };
    } catch {
        localStorage.removeItem(key(personId));
        return null;
    }
};

export const saveAvatarCrop = (personId: string, area: CropArea): void =>
    void localStorage.setItem(key(personId), JSON.stringify(area));

export const clearAvatarCrop = (personId: string): void =>
    void localStorage.removeItem(key(personId));
