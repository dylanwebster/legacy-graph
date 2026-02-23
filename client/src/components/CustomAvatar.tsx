import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface CustomAvatarProps {
    photoFilename?: string;
    firstName?: string;
    lastName?: string;
    className?: string;
}

export function CustomAvatar({ photoFilename, firstName, lastName, className }: CustomAvatarProps) {
    const initials = `${firstName?.[0] || ""}${lastName?.[0] || ""}`.toUpperCase() || "?";
    const imageUrl = photoFilename ? `/assets/${photoFilename}` : undefined;

    return (
        <Avatar className={className}>
            {imageUrl && <AvatarImage src={imageUrl} alt={`${firstName} ${lastName}`} />}
            <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
    );
}
