import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

// Run by the existing Mocha node suite, without requiring a VS Code host.
suite('NumPy editor contributions', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, '../../../../package.json'), 'utf8')
  );
  const contributes = packageJson.contributes;

  test('NPY/NPZ appear in Open With without forcing a default editor', () => {
    const editor = contributes.customEditors.find((entry: any) =>
      entry.viewType === 'plyViewer.numpyEditor'
    );
    assert.ok(editor, 'NumPy custom editor must be contributed');
    assert.strictEqual(editor.priority, 'option');
    assert.deepStrictEqual(
      editor.selector.map((entry: any) => entry.filenamePattern).sort(),
      ['*.npy', '*.npz']
    );
  });

  test('NPY/NPZ context command does not imply a file conversion', () => {
    const command = contributes.commands.find((entry: any) =>
      entry.command === 'plyViewer.convertNpyToPointCloud'
    );
    assert.ok(command);
    assert.match(command.title, /^Open NPY\/NPZ/);
    const explorer = contributes.menus['explorer/context'].find((entry: any) =>
      entry.command === 'plyViewer.openFile'
    );
    assert.ok(explorer.when.includes('resourceExtname == .npz'));
    assert.ok(explorer.when.includes('resourceExtname == .npy'));
    const titleMenu = contributes.menus['editor/title/context'].find((entry: any) =>
      entry.command === 'plyViewer.openFile'
    );
    assert.ok(titleMenu?.when.includes('resourceExtname == .npz'));
  });
});
