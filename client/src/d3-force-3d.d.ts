// eslint-disable-next-line @typescript-eslint/no-explicit-any
declare module 'd3-force-3d' {
    export function forceCollide(radius?: number | ((node: unknown) => number)): {
        iterations(n: number): ReturnType<typeof forceCollide>;
        radius(r: number | ((node: unknown) => number)): ReturnType<typeof forceCollide>;
    };
}
