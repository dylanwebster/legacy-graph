import {
    Calendar, MapPin, Heart, Sunrise, Sunset, Leaf, GraduationCap, Briefcase, Church,
    Ship, ScrollText, FileText, Users,
} from 'lucide-react';

export const EVENT_ICONS: Record<string, typeof Calendar> = {
    birth: Sunrise,
    death: Sunset,
    marriage: Heart,
    divorce: Heart,
    engagement: Heart,
    education: GraduationCap,
    occupation: Briefcase,
    residence: MapPin,
    immigration: Ship,
    emigration: Ship,
    military_service: ScrollText,
    adoption: Users,
    census: FileText,
    baptism: Church,
    burial: Leaf,
    generic: Calendar,
};

export const EVENT_LABELS: Record<string, string> = {
    birth: 'Birth', death: 'Death', marriage: 'Marriage', divorce: 'Divorce',
    engagement: 'Engagement', residence: 'Residence', census: 'Census',
    occupation: 'Occupation', education: 'Education', military_service: 'Military Service',
    immigration: 'Immigration', emigration: 'Emigration', adoption: 'Adoption',
    baptism: 'Baptism', burial: 'Burial', generic: 'Other',
};
