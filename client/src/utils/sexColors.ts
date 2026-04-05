export const SEX_COLOR: Record<string, string> = {
    M: '#60a5fa',
    F: '#f472b6',
    I: '#94a3b8',
    U: '#94a3b8',
};

export function sexColor(sex: string): string {
    return SEX_COLOR[sex] ?? SEX_COLOR['U'];
}
