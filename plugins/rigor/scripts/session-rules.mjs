#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const RULES = new URL('../rules.md', import.meta.url);

process.stdout.write(readFileSync(RULES, 'utf8'));
