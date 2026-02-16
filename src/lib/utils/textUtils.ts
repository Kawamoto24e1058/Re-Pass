export function normalizeCourseName(name: string): string {
    if (!name) return "";

    // 1. Full-width to Half-width (Alphanumeric)
    let normalized = name.replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => {
        return String.fromCharCode(s.charCodeAt(0) - 0xFEE0);
    });

    // 2. Remove all spaces (full-width & half-width)
    normalized = normalized.replace(/\s+/g, "");

    // 3. Lowercase
    normalized = normalized.toLowerCase();

    return normalized;
}
