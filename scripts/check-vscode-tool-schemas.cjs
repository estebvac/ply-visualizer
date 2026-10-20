'use strict';

const pkg = require('../package.json');

const tools = pkg.contributes?.languageModelTools ?? [];
const failures = [];

function visit(value, path) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, `${path}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object') {
    return;
  }
  if (value.type === 'array') {
    if (!Object.prototype.hasOwnProperty.call(value, 'items')) {
      failures.push(`${path}: array schema is missing items`);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'prefixItems')) {
      failures.push(`${path}: prefixItems is not supported by the VS Code/Copilot tool validator`);
    }
  }
  for (const [key, child] of Object.entries(value)) {
    visit(child, `${path}.${key}`);
  }
}

for (const tool of tools) {
  visit(tool.inputSchema, tool.name);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log(`${tools.length} VS Code tool schemas are Copilot-compatible: every array defines items and no prefixItems remain.`);
