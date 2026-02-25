/**
 * Escape a string for safe insertion into HTML.
 * Use this before passing untrusted values to {@link html} or any innerHTML context.
 * @param {string} s
 * @returns {string}
 */
export function escapeHtml(s) {
    if (typeof s !== 'string') return '';
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Lightweight tagged template helper for HTML strings.
 * - Flattens nested arrays
 * - Ignores null/undefined/booleans
 * - Keeps 0 and other primitives
 *
 * @warning Does NOT escape HTML. Callers must sanitize untrusted values before
 * interpolation. When setting innerHTML, wrap untrusted inputs with {@link escapeHtml}.
 *
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
