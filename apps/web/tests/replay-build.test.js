import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { expect, it } from 'vitest';

it('serves Replay HTML with versioned scripts and styles from the same build', async () => {
  const result = await build({
    root: fileURLToPath(new URL('..', import.meta.url)),
    logLevel: 'silent',
    build: { write: false, copyPublicDir: false },
  });
  const files = new Map([result].flat().flatMap(({ output }) =>
    output.map((file) => [file.fileName, file]),
  ));
  const html = files.get('replay/terminal.html')?.source;
  expect(html).toContain('id="replay-tools-menu"');

  const assets = [...html.matchAll(/(?:src|href)="\/(assets\/[^"\s]+)"/g)].map(([, file]) => file);
  expect(assets).toEqual(expect.arrayContaining([
    expect.stringMatching(/^assets\/terminal-[\w-]+\.js$/),
    expect.stringMatching(/^assets\/terminal-[\w-]+\.css$/),
  ]));
  for (const asset of assets) expect(files.has(asset)).toBe(true);
  expect(html).not.toMatch(/(?:src|href)="(?:\.\/|\/replay\/)(?:js\/|css\/|terminal\.js)/);
}, 20_000);
