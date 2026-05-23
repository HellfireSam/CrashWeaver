// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { renderMarkdownPreview } from './markdownPreview';

describe('renderMarkdownPreview security hardening', () => {
  it('removes unsafe elements and inline event attributes', () => {
    const rendered = renderMarkdownPreview(
      '<script>alert(1)</script><img src="ok.png" onerror="alert(2)"><p onclick="x()">safe text</p>',
    );

    expect(rendered).not.toContain('<script');
    expect(rendered).not.toContain('onerror=');
    expect(rendered).not.toContain('onclick=');
    expect(rendered).toContain('safe text');
  });

  it('removes href values that use unsafe protocols', () => {
    const rendered = renderMarkdownPreview('<a href="javascript:alert(1)">bad</a> [good](https://example.com)');

    expect(rendered).not.toContain('javascript:');
    expect(rendered).toContain('https://example.com');
  });

  it('rewrites vault-relative image links to crashweaver-local protocol', () => {
    const rendered = renderMarkdownPreview('![demo](assets/image.png)', '/vault/root');

    expect(rendered).toContain('crashweaver-local://asset');
    expect(rendered).toContain('path=%2Fvault%2Froot%2Fassets%2Fimage.png');
  });

  it('rewrites vault-relative anchor links to crashweaver-local protocol', () => {
    const rendered = renderMarkdownPreview('[note](docs/topic.md)', '/vault/root');

    expect(rendered).toContain('crashweaver-local://asset');
    expect(rendered).toContain('path=%2Fvault%2Froot%2Fdocs%2Ftopic.md');
  });
});
