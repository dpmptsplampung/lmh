import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const PAGE = readFileSync(join(process.cwd(), 'src/app/admin/chat/page.tsx'), 'utf8');

describe('admin chat session list a11y', () => {
  it('session list items use button (or role=button), not bare div onClick', () => {
    expect(PAGE).not.toMatch(/<div[\s\S]{0,120}onClick=\{\(\)\s*=>\s*handleSelectSession/);
    expect(PAGE).toMatch(/<button[\s\S]{0,200}onClick=\{\(\)\s*=>\s*handleSelectSession|type=["']button["'][\s\S]{0,120}onClick=\{\(\)\s*=>\s*handleSelectSession/);
  });
});
