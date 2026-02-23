export const courseColors = [
    "bg-red-100 text-red-700",
    "bg-orange-100 text-orange-700",
    "bg-amber-100 text-amber-700",
    "bg-green-100 text-green-700",
    "bg-emerald-100 text-emerald-700",
    "bg-teal-100 text-teal-700",
    "bg-cyan-100 text-cyan-700",
    "bg-sky-100 text-sky-700",
    "bg-blue-100 text-blue-700",
    "bg-indigo-100 text-indigo-700",
    "bg-violet-100 text-violet-700",
    "bg-purple-100 text-purple-700",
    "bg-fuchsia-100 text-fuchsia-700",
    "bg-pink-100 text-pink-700",
    "bg-rose-100 text-rose-700",
];

export const courseIcons = [
    "📚", "📝", "✍️", "🔬", "💻",
    "📊", "🧠", "🌍", "🎨", "🎵",
    "📈", "💡", "📖", "📐", "🚀"
];

export function getRandomColor(): string {
    const randomIndex = Math.floor(Math.random() * courseColors.length);
    return courseColors[randomIndex];
}

export function getRandomIcon(): string {
    const randomIndex = Math.floor(Math.random() * courseIcons.length);
    return courseIcons[randomIndex];
}
