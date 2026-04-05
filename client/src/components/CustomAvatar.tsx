import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export interface AvatarCropArea {
    x: number;
    y: number;
    width: number;
    height: number;
}

const SEX_COLORS: Record<string, string> = {
    M: '#60a5fa',
    F: '#f472b6',
    I: '#a78bfa',
    U: '#94a3b8',
};

interface CustomAvatarProps {
    photoFilename?: string;
    firstName?: string;
    lastName?: string;
    className?: string;
    onClick?: () => void;
    cropData?: AvatarCropArea | null;
    sex?: string;
}

export function CustomAvatar({ photoFilename, firstName, lastName, className, onClick, cropData, sex }: CustomAvatarProps) {
    const initials = `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase() || "?";
    const imageUrl = photoFilename ? `/assets/${photoFilename}` : undefined;
    const sexColor = sex ? (SEX_COLORS[sex] ?? SEX_COLORS['U']) : null;

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
        <Avatar
            key={imageUrl ?? '__fallback__'}
            className={`${className ?? ''} ${onClick ? 'cursor-pointer' : ''}`}
            onClick={onClick}
            style={sexColor ? { boxShadow: `0 0 0 2px ${sexColor}70` } : undefined}
        >
            {imageUrl && <AvatarImage src={imageUrl} alt={`${firstName} ${lastName}`} style={cropStyle} />}
            <AvatarFallback style={sexColor ? { backgroundColor: `${sexColor}22` } : undefined}>{initials}</AvatarFallback>
        </Avatar>
    );
}
