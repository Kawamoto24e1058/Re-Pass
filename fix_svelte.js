const fs = require('fs');
const path = require('path');

const replacements = [
    [/onclick={/g, 'on:click={'],
    [/onchange={/g, 'on:change={'],
    [/oninput={/g, 'on:input={'],
    [/onsubmit={/g, 'on:submit={'],
    [/onkeydown={/g, 'on:keydown={'],
    [/onkeyup={/g, 'on:keyup={'],
    [/onmouseenter={/g, 'on:mouseenter={'],
    [/onmouseleave={/g, 'on:mouseleave={'],
    [/onfocus={/g, 'on:focus={'],
    [/onblur={/g, 'on:blur={'],
    [/ondragstart={/g, 'on:dragstart={'],
    [/ondragend={/g, 'on:dragend={'],
    [/ondragover={/g, 'on:dragover={'],
    [/ondrop={/g, 'on:drop={'],
    [/{@render\s+(\w+)\(\)}/g, '<slot />'],
];

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
            replacements.forEach(([regex, replacement]) => {
                if (regex.test(content)) {
                    content = content.replace(regex, replacement);
                    modified = true;
                }
            });
            if (modified) {
                fs.writeFileSync(filePath, content, 'utf8');
                console.log(`Updated: ${filePath}`);
            }
        }
    });
}

walk(path.join(__dirname, 'src'));
