/**
 * Lightweight tagged template helper for HTML strings.
 * - Flattens nested arrays
 * - Ignores null/undefined/booleans
 * - Keeps 0 and other primitives
 * @param {TemplateStringsArray} strings
 * @param {...any} values
 * @returns {string}
 */
export function html(strings, ...values) {
    let out = '';
    for (let i = 0; i < strings.length; i += 1) {
        out += strings[i];
        if (i < values.length) {
            out += stringifyHtmlValue(values[i]);
        }
    }
    return out;
}

/**
 * @param {any} value
 * @returns {string}
 */
function stringifyHtmlValue(value) {
    if (Array.isArray(value)) {
        return value.map(stringifyHtmlValue).join('');
    }
    if (value === null || value === undefined || typeof value === 'boolean') {
        return '';
    }
    return String(value);
}
