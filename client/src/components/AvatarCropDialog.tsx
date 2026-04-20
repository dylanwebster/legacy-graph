import { useState, useCallback } from 'react';
import Cropper from 'react-easy-crop';
import type { Area } from 'react-easy-crop';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/shared/ui/dialog';
import { Button } from '@/shared/ui/button';

export type { Area };

interface AvatarCropDialogProps {
    imageSrc: string;
    onConfirm: (croppedArea: Area) => void;
    onCancel: () => void;
}

export function AvatarCropDialog({ imageSrc, onConfirm, onCancel }: AvatarCropDialogProps) {
    const [crop, setCrop] = useState({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [croppedArea, setCroppedArea] = useState<Area | null>(null);

    const onCropComplete = useCallback((area: Area) => {
        setCroppedArea(area);
    }, []);

    const handleConfirm = () => {
        if (croppedArea) onConfirm(croppedArea);
    };

    return (
        <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
            <DialogContent className="max-w-sm gap-0 p-0 overflow-hidden">
                <DialogHeader className="px-4 pt-4 pb-2">
                    <DialogTitle>Crop avatar</DialogTitle>
                </DialogHeader>

                <div className="relative w-full" style={{ height: 320 }}>
                    <Cropper
                        image={imageSrc}
                        crop={crop}
                        zoom={zoom}
                        aspect={1}
                        cropShape="round"
                        showGrid={false}
                        onCropChange={setCrop}
                        onZoomChange={setZoom}
                        onCropComplete={onCropComplete}
                    />
                </div>

                <div className="px-6 pt-4 pb-2 flex items-center gap-3">
                    <span className="text-xs text-muted-foreground shrink-0">Zoom</span>
                    <input
                        type="range"
                        min={1}
                        max={3}
                        step={0.01}
                        value={zoom}
                        onChange={(e) => setZoom(Number(e.target.value))}
                        className="w-full accent-primary"
                    />
                </div>

                <DialogFooter className="px-4 pb-4 pt-2">
                    <Button variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
                    <Button size="sm" onClick={handleConfirm} disabled={!croppedArea}>Apply</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
