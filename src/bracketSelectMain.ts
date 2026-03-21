'use strict';
import * as vscode from 'vscode';

type Pair = { open: string; close: string };

// Order matters
const PAIRS: Pair[] = [
    { open: "<!--", close: "-->" },

    { open: "/*", close: "*/" },
    // { open: "//", close: "\n" },

    { open: "/", close: "/" },

    { open: "(", close: ")" },
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "<", close: ">" },
    { open: ">", close: "<" },

    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: "`", close: "`" },
];

// ---------- helpers ----------

function findNearestOpen(text: string, from: number) {
    for (let i = from; i >= 0; i--) {
        for (const pair of PAIRS) {
            if (text.startsWith(pair.open, i)) {
                return { pair, index: i };
            }
        }
    }
    return null;
}

function findClose(text: string, from: number, pair: Pair) {
    let i = from + pair.open.length;

    // ---------- "/" (regex-like) ----------
    if (pair.open === "/") {
        let escaped = false;

        while (i < text.length) {
            const ch = text[i];

            if (!escaped && ch === "/") {
                return i;
            }

            escaped = !escaped && ch === "\\";
            i++;
        }

        return -1;
    }

    // ---------- "><" chain ----------
    if (pair.open === ">" && pair.close === "<") {
        let lastValid = -1;

        while (i < text.length) {
            if (text[i] === "<") {
                lastValid = i;

                // extend chain if pattern continues
                if (text[i + 1] === ">") {
                    i += 2;
                    continue;
                }

                return lastValid;
            }
            i++;
        }

        return lastValid;
    }

    // ---------- normal nesting ----------
    const supportsNesting = pair.open !== pair.close;
    let depth = 0;

    while (i < text.length) {
        // line comment
        if (pair.open === "//" && text[i] === "\n") {
            return i;
        }

        // nested open
        if (supportsNesting && text.startsWith(pair.open, i)) {
            depth++;
            i += pair.open.length;
            continue;
        }

        // close
        if (text.startsWith(pair.close, i)) {
            if (depth === 0) {
                return i;
            }
            depth--;
            i += pair.close.length;
            continue;
        }

        i++;
    }

    return -1;
}

function findEnclosing(text: string, start: number, end: number) {
    let cursor = start;

    while (true) {
        const open = findNearestOpen(text, cursor);
        if (!open) return null;

        const closeIndex = findClose(text, open.index, open.pair);

        if (closeIndex === -1) {
            cursor = open.index - 1;
            continue;
        }

        const fullStart = open.index;
        const fullEnd = closeIndex + open.pair.close.length;

        const innerStart = fullStart + open.pair.open.length;
        const innerEnd = closeIndex;

        const isExactInner =
            start === innerStart && end === innerEnd;

        const isExactOuter =
            start === fullStart && end === fullEnd;

        // step 2 → include tokens
        if (isExactInner) {
            return {
                start: fullStart,
                end: fullEnd,
                pair: open.pair
            };
        }

        // step 3 → go outer
        if (isExactOuter) {
            cursor = open.index - 1;
            continue;
        }

        // step 1 → go inside
        if (fullStart <= start && fullEnd >= end) {
            return {
                start: innerStart,
                end: innerEnd,
                pair: open.pair
            };
        }

        cursor = open.index - 1;
    }
}

// ---------- main ----------

function expandSelection(editor: vscode.TextEditor) {
    const doc = editor.document;

    editor.selections = editor.selections.map(sel => {
        const line = doc.lineAt(sel.active.line);
        const text = line.text;

        const lineStart = doc.offsetAt(line.range.start);

        const start = doc.offsetAt(sel.start) - lineStart;
        const end = doc.offsetAt(sel.end) - lineStart;

        const found = findEnclosing(text, start, end);
        if (!found) return sel;

        return new vscode.Selection(
            doc.positionAt(found.start + lineStart),
            doc.positionAt(found.end + lineStart)
        );
    });
}

// ---------- extension ----------

export function activate(context: vscode.ExtensionContext) {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'brackets-selection-plus.select',
            () => {
                const editor = vscode.window.activeTextEditor;
                if (!editor) return;
                expandSelection(editor);
            }
        )
    );
}

export function deactivate() {}
