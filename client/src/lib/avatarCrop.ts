export type CropArea = { x: number; y: number; width: number; height: number };

const key = (personId: string) => `legacygraph_avatar_crop_${personId}`;

export const loadAvatarCrop = (personId: string): CropArea | null => {
    try { return JSON.parse(localStorage.getItem(key(personId)) ?? 'null'); } catch { return null; }
};

export const saveAvatarCrop = (personId: string, area: CropArea): void =>
    void localStorage.setItem(key(personId), JSON.stringify(area));

export const clearAvatarCrop = (personId: string): void =>
    void localStorage.removeItem(key(personId));
