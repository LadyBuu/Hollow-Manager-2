#!/usr/bin/env node
/**
 * scripts/strip-success-logs.js
 *
 * Removes success-path console.log calls from JS source files.
 * Keeps console.warn, console.error, and console.log calls that
 * look like warnings/errors by content.
 *
 * CONSERVATIVE: dry-run by default. Pass --apply to write.
 *
 * USAGE:
 *   node scripts/strip-success-logs.js              # dry run
 *   node scripts/strip-success-logs.js --apply      # write changes
 *   node scripts/strip-success-logs.js --verbose    # per-line detail
 *
 * RULES:
 *   1. Remove `console.log(...)` statements on a single line.
 *   2. Keep `console.warn(...)` and `console.error(...)`.
 *   3. Keep `console.log` calls that contain any of these substrings
 *      (case-insensitive), because they are warnings in disguise:
 *        warn, error, fail, invalid, missing, cannot, unable,
 *        unexpected, deprecated, corruption, malformed
 *   4. Skip the script itself, node_modules, .git, dist, build.
 *   5. Skip files that don't end in .js (configurable).
 *
 * LIMITATIONS:
 *   - Handles single-line `console.log(...)` calls only.
 *     Multi-line calls are left alone (safer than trying to parse).
 *   - Does not touch commented-out console.log lines.
 *   - Does not touch template literals containing `console.log`.
 *   - Does not attempt to handle `console.log` inside strings.
 *     (If a string literal contains `console.log(`, it stays. That's
 *      rare and the alternative is a real parser.)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ============================================================
// CONFIG
// ============================================================

const ROOT = process.cwd();
const APPLY = process.argv.includes('--apply');
const VERBOSE = process.argv.includes('--verbose');

const SKIP_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'coverage',
    '.cache',
    'scripts'   // don't strip the stripper
]);

const EXTENSIONS = new Set(['.js']);

// Substrings that mark a console.log as a warning-in-disguise.
// If any of these appear in the argument text, the line is kept.
const KEEP_SUBSTRINGS = [
    'warn',
    'error',
    'fail',
    'invalid',
    'missing',
    'cannot',
    'unable',
    'unexpected',
    'deprecated',
    'corrupt',
    'malformed'
];

// ============================================================
// FILE WALKER
// ============================================================

function* walk(dir) {
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
        return;
    }

    for (const entry of entries) {
        const full = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            yield* walk(full);
            continue;
        }

        if (!entry.isFile()) continue;

        const ext = path.extname(entry.name);
        if (!EXTENSIONS.has(ext)) continue;

        // Never touch the stripper itself
        if (entry.name === 'strip-success-logs.js') continue;

        yield full;
    }
}

// ============================================================
// LINE CLASSIFIER
// ============================================================

/**
 * Returns true if the line contains a `console.log(...)` call
 * that should be REMOVED.
 *
 * Returns false if the line should be kept (for any reason).
 */
function shouldStripLine(line) {
    // Must contain `console.log(`
    const idx = line.indexOf('console.log(');
    if (idx === -1) return false;

    // Ignore commented-out lines: look at what's before the call
    const before = line.slice(0, idx);

    // If there's an unescaped `//` before the call, it's a comment.
    if (before.includes('//')) return false;

    // If we're inside a block comment, this won't catch it perfectly,
    // but a line like ` * console.log(...)` (JSDoc) starts with `*`
    // or contains `/*`. Skip those.
    const trimmed = before.trim();
    if (trimmed.startsWith('*') || trimmed.startsWith('/*')) return false;

    // Get the argument text of the console.log call.
    // We do a simple paren-matching scan from the opening paren.
    const argStart = idx + 'console.log('.length;
    const argText = extractBalanced(line, argStart);
    if (argText === null) {
        // Unbalanced — multi-line call, string literal with parens, etc.
        // Skip: not safe to remove.
        return false;
    }

    // If the argument contains any keep-substring, keep the line.
    const lower = argText.toLowerCase();
    for (const needle of KEEP_SUBSTRINGS) {
        if (lower.includes(needle)) return false;
    }

    // If the line is inside a string literal that happens to contain
    // `console.log(`, we can't tell without a parser. Heuristic:
    // if there's a quote char before the call and the count of
    // matching quotes is odd, skip.
    if (looksLikeInsideString(before)) return false;

    return true;
}

/**
 * Extract the balanced text starting at `start` (which points at the
 * first char after the opening paren of console.log). Returns the
 * argument text (between parens) or null if unbalanced on this line.
 *
 * Does NOT handle nested strings perfectly, but handles the common
 * case: `console.log('foo', bar);` and `console.log("foo " + baz);`
 */
function extractBalanced(line, start) {
    let depth = 1;
    let i = start;
    let inString = false;
    let stringChar = null;
    let inTemplate = false;
    let inRegex = false;
    let prevChar = '';

    while (i < line.length) {
        const ch = line[i];

        if (inString) {
            if (ch === '\\') { i += 2; continue; }
            if (ch === stringChar) { inString = false; stringChar = null; }
            i++;
            continue;
        }

        if (inTemplate) {
            if (ch === '\\') { i += 2; continue; }
            if (ch === '`') { inTemplate = false; }
            i++;
            continue;
        }

        if (ch === '"' || ch === "'") {
            inString = true;
            stringChar = ch;
            i++;
            continue;
        }

        if (ch === '`') {
            inTemplate = true;
            i++;
            continue;
        }

        // Naive regex detection: `/` preceded by `(` `,` `=` `:` `[` `!` `&` `|` `?` `{` `;` or start
        if (ch === '/' && prevChar !== '' && /[\(\[=:,!&\|?{;]/.test(prevChar)) {
            inRegex = true;
            i++;
            continue;
        }

        if (inRegex) {
            if (ch === '\\') { i += 2; continue; }
            if (ch === '/') { inRegex = false; }
            i++;
            continue;
        }

        if (ch === '(') {
            depth++;
            i++;
            continue;
        }

        if (ch === ')') {
            depth--;
            if (depth === 0) {
                return line.slice(start, i);
            }
            i++;
            continue;
        }

        prevChar = ch;
        i++;
    }

    return null;  // unbalanced on this line
}

/**
 * Crude heuristic: is `before` inside a string literal?
 * Count unescaped single and double quotes. If odd for either, we're
 * probably inside a string.
 */
function looksLikeInsideString(before) {
    let singleCount = 0;
    let doubleCount = 0;
    let escaped = false;

    for (let i = 0; i < before.length; i++) {
        const ch = before[i];
        if (escaped) { escaped = false; continue; }
        if (ch === '\\') { escaped = true; continue; }
        if (ch === "'") singleCount++;
        if (ch === '"') doubleCount++;
    }

    return (singleCount % 2 === 1) || (doubleCount % 2 === 1);
}

// ============================================================
// FILE PROCESSOR
// ============================================================

function processFile(filePath) {
    let content;
    try {
        content = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
        return { filePath, error: err.message, removed: 0, lines: [] };
    }

    const lines = content.split('\n');
    const kept = [];
    const removedLines = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (shouldStripLine(line)) {
            removedLines.push({ lineNumber: i + 1, text: line });
            // Drop the line. (No blank-line replacement; keeps file tight.)
        } else {
            kept.push(line);
        }
    }

    if (removedLines.length === 0) {
        return { filePath, error: null, removed: 0, lines: [] };
    }

    if (APPLY) {
        try {
            fs.writeFileSync(filePath, kept.join('\n'), 'utf8');
        } catch (err) {
            return { filePath, error: err.message, removed: 0, lines: [] };
        }
    }

    return { filePath, error: null, removed: removedLines.length, lines: removedLines };
}

// ============================================================
// MAIN
// ============================================================

function main() {
    const mode = APPLY ? 'APPLY' : 'DRY RUN';

    let totalFiles = 0;
    let touchedFiles = 0;
    let totalRemoved = 0;
    const errors = [];

    for (const filePath of walk(ROOT)) {
        totalFiles++;
        const result = processFile(filePath);

        if (result.error) {
            errors.push({ filePath, message: result.error });
            continue;
        }

        if (result.removed > 0) {
            touchedFiles++;
            totalRemoved += result.removed;

            const rel = path.relative(ROOT, filePath);

            if (VERBOSE) {
                for (const r of result.lines) {
                }
            }
        }
    }


    if (errors.length > 0) {
        console.log('--- errors ---');
        for (const e of errors) {
        }
    }

    if (!APPLY && touchedFiles > 0) {
    }

    if (APPLY && touchedFiles > 0) {
    }
}

main();