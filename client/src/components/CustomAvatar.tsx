import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export interface AvatarCropArea {
    x: number;
    y: number;
    width: number;
    height: number;
}

interface CustomAvatarProps {
    photoFilename?: string;
    firstName?: string;
    lastName?: string;
    className?: string;
    onClick?: () => void;
    cropData?: AvatarCropArea | null;
}

export function CustomAvatar({ photoFilename, firstName, lastName, className, onClick, cropData }: CustomAvatarProps) {
    const initials = `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase() || "?";
    const imageUrl = photoFilename ? `/assets/${photoFilename}` : undefined;

    const cropStyle: React.CSSProperties | undefined =
        imageUrl && cropData
            ? {
                  position: 'absolute',
                  width: `${10000 / cropData.width}%`,
                  height: `${10000 / cropData.height}%`,
                  left: `${-cropData.x / cropData.width * 100}%`,
                  top: `${-cropData.y / cropData.height * 100}%`,
                  maxWidth: 'none',
                  aspectRatio: 'auto',
                  objectFit: 'cover',
              }
            : undefined;

    return (
        <Avatar key={imageUrl ?? '__fallback__'} className={`${className ?? ''} ${onClick ? 'cursor-pointer' : ''}`} onClick={onClick}>
            {imageUrl && <AvatarImage src={imageUrl} alt={`${firstName} ${lastName}`} style={cropStyle} />}
            <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
    );
}
