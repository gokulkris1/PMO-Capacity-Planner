const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'netlify', 'functions', 'qbr.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Replace: const [something] = await sql`...`;
// With:    const [something] = (await sql`...`) as any[];
content = content.replace(/const \[(.*?)\] = await sql`([\s\S]*?)`;/g, 'const [$1] = (await sql`$2`) as any[];');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Fixed qbr.ts');
