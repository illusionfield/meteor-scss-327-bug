Package.describe({
  name: 'fourseven:scss',
  version: '5.0.0-alpha.3',
  summary: 'Style with attitude. Sass and SCSS support for Meteor.js.',
  git: 'https://github.com/Meteor-Community-Packages/meteor-scss.git',
  documentation: 'README.md'
});

Package.registerBuildPlugin({
  name: 'compileScssBatch',
  use: [
    'caching-compiler@1.2.2 || 2.0.0',
    'ecmascript@0.16.7 || 0.16.10',
  ],
  sources: ['plugin/compile-scss.js'],
  npmDependencies: {
    'sass': '1.83.4'
  }
});

Package.onUse(api => {
  api.versionsFrom(['2.10.0', '3.0.1']);
  api.use('isobuild:compiler-plugin@1.0.0');
});

Package.onTest(api => {
  api.versionsFrom(['2.10.0', '3.0.1']);
  api.use([
    'test-helpers', 'tinytest',
    'ecmascript',
    'fourseven:scss'
  ]);

  // Tests for .scss
  api.addFiles([
    'test/scss/_emptyimport.scss',
    'test/scss/_not-included.scss',
    'test/scss/_top.scss',
    'test/scss/_top3.scss',
    'test/scss/empty.scss',
    'test/scss/dir/_in-dir.scss',
    'test/scss/dir/_in-dir2.scss',
    'test/scss/dir/root.scss',
    'test/scss/dir/subdir/_in-subdir.scss',
  ]);

  api.addFiles('test/scss/top2.scss', 'client', { isImport: true });

  // Test for includePaths
  api.addFiles(['test/include-paths/include-paths.scss', 'test/include-paths/modules/module/_module.scss']);

  api.mainModule('tests.js', 'client');
});
