import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// This regex targets "on" followed by lowercase letters and then "={"
// It avoids things like "only={", "once={", etc. by checking if it's a common event handler start
const eventHandlerRegex = /\bon([a-z]+)=\{/g;

function walk(dir) {
    const files = fs.readdirSync(dir);
    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        if (stat.isDirectory()) {
            walk(filePath);
        } else if (filePath.endsWith('.svelte')) {
            let content = fs.readFileSync(filePath, 'utf8');
            let modified = false;

            // Generic event handler replacement
            if (eventHandlerRegex.test(content)) {
                content = content.replace(eventHandlerRegex, (match, p1) => {
                    // List of common event names that don't start with "on" in legacy Svelte (they are just the event name)
                    // e.g. onclick -> on:click
                    // Some words might start with "on" but are not event handlers, but they are rare with "={"
                    if (['ly', 'ce', 'to'].includes(p1)) return match; // exclude only={, once={, onto={
                    return `on:${p1}={`;
                });
                modified = true;
            }

            // Also fix slots if missed
            const slotRegex = /{@render\s+(\w+)\(\)}/g;
            if (slotRegex.test(content)) {
                content = content.replace(slotRegex, '<slot />');
                modified = true;
            }

            if (modified) {
                fs.writeFileSync(filePath, content, 'utf8');
                console.log(`Updated: ${filePath}`);
            }
        }
    });
}

walk(path.join(__dirname, 'src'));
console.log('Svelte syntax fix completed.');
