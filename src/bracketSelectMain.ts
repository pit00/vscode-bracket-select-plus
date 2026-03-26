'use strict';
import * as vscode from 'vscode';

type Pair = { open: string; close: string };

// Order matters
const PAIRS: Pair[] = [
    { open: "<!--", close: "-->" },
    
    { open: "/*", close: "*/" },
    
    { open: "/", close: "/" }, // regex
    
    { open: "(", close: ")" },
    { open: "{", close: "}" },
    { open: "[", close: "]" },
    { open: "<", close: ">" },
    { open: ">", close: "<" },
    
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: "`", close: "`" },
];

// Fast prefilter
const FIRST_CHARS = new Set(PAIRS.map(p => p.open[0]));

// Safety limit
const MAX_STEPS = 20000;

// ---------- helpers ----------

function isLikelyRegexStart(text: string, index: number) {
    const prev = text[index - 1];
    if (!prev) return true;
    
    // avoid division cases like: a / b
    return !/[a-zA-Z0-9)\]]/.test(prev);
}

function findNearestOpen(text: string, from: number) {
    for (let i = from; i >= 0; i--) {
        if (!FIRST_CHARS.has(text[i])) continue;
        
        for (const pair of PAIRS) {
            if (pair.open === "/" && !isLikelyRegexStart(text, i)) continue;
            
            if (text.startsWith(pair.open, i)) {
                return { pair, index: i };
            }
        }
    }
    return null;
}

function findClose(text: string, from: number, pair: Pair) {
    let i = from + pair.open.length;
    let steps = 0;
    
    // ---------- regex "/" ----------
    if (pair.open === "/") {
        let escaped = false;
        
        while (i < text.length) {
            if (++steps > MAX_STEPS) return -1;
            
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
            if (++steps > MAX_STEPS) return -1;
            
            if (text[i] === "<") {
                lastValid = i;
                
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
        if (++steps > MAX_STEPS) return -1;
        
        if (supportsNesting && text.startsWith(pair.open, i)) {
            depth++;
            i += pair.open.length;
            continue;
        }
        
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
    let steps = 0;
    
    while (true) {
        if (++steps > MAX_STEPS) return null;
        
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
        
        const isExactInner = start === innerStart && end === innerEnd;
        const isExactOuter = start === fullStart && end === fullEnd;
        
        // step 2 → include tokens
        if (isExactInner) {
            return { start: fullStart, end: fullEnd };
        }
        
        // step 3 → go outer
        if (isExactOuter) {
            cursor = open.index - 1;
            continue;
        }
        
        // step 1 → go inside
        if (fullStart <= start && fullEnd >= end) {
            return { start: innerStart, end: innerEnd };
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
        
        const lineStartOffset = doc.offsetAt(line.range.start);
        
        const start = doc.offsetAt(sel.start) - lineStartOffset;
        const end = doc.offsetAt(sel.end) - lineStartOffset;
        
        const found = findEnclosing(text, start, end);
        if (!found) return sel;
        
        return new vscode.Selection(
            doc.positionAt(found.start + lineStartOffset),
            doc.positionAt(found.end + lineStartOffset)
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
