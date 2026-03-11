import fs from 'fs';
import path from 'path';

const filePath = path.resolve('netlify', 'functions', 'qbr.ts');
let content = fs.readFileSync(filePath, 'utf8');

// Replace: const [something] = await sql`...`;
// With:    const [something] = (await sql`...`) as any[];
content = content.replace(/const \[([\w\d_]+)\]\s*=\s*await\s+sql`([\s\S]*?)`;/g, 'const [$1] = (await sql`$2`) as any[];');

fs.writeFileSync(filePath, content, 'utf8');
console.log('Fixed qbr.ts');
