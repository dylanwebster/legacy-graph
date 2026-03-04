import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface CustomAvatarProps {
    photoFilename?: string;
    firstName?: string;
    lastName?: string;
    className?: string;
    onClick?: () => void;
}

export function CustomAvatar({ photoFilename, firstName, lastName, className, onClick }: CustomAvatarProps) {
    const initials = `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase() || "?";
    const imageUrl = photoFilename ? `/assets/${photoFilename}` : undefined;

    return (
        <Avatar className={`${className ?? ''} ${onClick ? 'cursor-pointer' : ''}`} onClick={onClick}>
            {imageUrl && <AvatarImage src={imageUrl} alt={`${firstName} ${lastName}`} />}
            <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
    );
}
