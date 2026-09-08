import { createLazyFileRoute } from '@tanstack/react-router';
import { MapView } from '@/features/map/MapView';

/** Query params driving the Map View — deep-linkable and shareable.
 *  scope=all|focal|lineage  person=N_xxx  t=<startYear>  t_end=<endYear>
 *  g=year|decade|century    speed=0.5|1|2|4   play=0|1  loop=0|1
 *  event=<eventId>          types=birth,death,... */
export const Route = createLazyFileRoute('/map')({
    component: MapView,
});
