import { MultiFileCachingCompiler } from 'meteor/caching-compiler';

import sass from 'sass';

import { pathToFileURL } from 'url';
const { fs, path } = Plugin;

const { env:{ DEBUG_PACKAGE_SASS } } = process;
const debugMode = !!(DEBUG_PACKAGE_SASS && !(DEBUG_PACKAGE_SASS === 'false' || DEBUG_PACKAGE_SASS === '0'));

const userOptions = _getConfig(
  '.scss.config.json',
  'scss-config.json', // legacy
);

let includePaths = [];
if('object' === typeof userOptions) {
  if(Array.isArray(userOptions.includePaths)) {
    includePaths = userOptions.includePaths;
  }
  delete userOptions.includePaths;
}

Plugin.registerCompiler({
  extensions: ['scss', 'sass'],
  archMatching: 'web'
}, () => new SassCompiler())

// CompileResult is {css, sourceMap}.
class SassCompiler extends MultiFileCachingCompiler {
  constructor() {
    super({
      compilerName: 'sass',
      defaultCacheSize: 1024 * 1024 * 10
    })
  }
  getCacheKey(inputFile) {
    return inputFile.getSourceHash();
  }
  compileResultSize(compileResult) {
    return compileResult.css?.length +
      this.sourceMapSize(compileResult.sourceMap)
  }

  // The heuristic is that a file is an import (ie, is not itself processed as a root) if it matches _*.sass, _*.scss
  // This can be overridden in either direction via an explicit `isImport` file option in api.addFiles.
  isRoot(inputFile) {
    const fileOptions = inputFile.getFileOptions();
    if(fileOptions.hasOwnProperty('isImport')) {
      return !fileOptions.isImport;
    }
    const pathInPackage = inputFile.getPathInPackage();
    const isPartial = hasUnderscore(pathInPackage);
    return !isPartial;
  }

  compileOneFileLater(inputFile, getResult) {
    inputFile.addStylesheet({
      path: inputFile.getPathInPackage()
    }, async () => {
      const result = await getResult();
      return result && {
        data: result.css,
        sourceMap: result.sourceMap
      }
    })
  }

  async compileOneFile(inputFile, allFiles) {
    const sourceRoot = inputFile.getSourceRoot();
    const allFilesByPath = new Map();
    for(const [absoluteImportPath, file] of allFiles.entries()) {
      const absolutePath = path.join(file.getSourceRoot(), file.getPathInPackage());
      const convertedAbsolutePath = Plugin.convertToOSPath(absolutePath);
      allFilesByPath.set(convertedAbsolutePath, absoluteImportPath);
    }

    const getRealImportPath = (url) => {
      const basename = decodeURIComponent(url);

      let importPath;
      switch(true) {
        case basename.search(/~[^\/]/) !== -1:
          importPath = basename.replace(/^.*~([^\/])/, '{}/node_modules/$1');
          break;
        case basename.search(/^meteor[:\/]/) !== -1:
          importPath = basename.replace(/^meteor[:\/]/, '');
          break;
        case basename.search(/^\/[^\/]/) !== -1:
          importPath = basename.replace(/^\//, '{}/');
          break;
        default:
          importPath = basename;
          break;
      }

      //SASS has a whole range of possible import files from one import statement, try each of them
      const possibleFiles = [];
      const possibleFilesIndex = [];

      //If the referenced file has no extension, try possible extensions, starting with extension of the parent file.
      let possibleExtensions = ['scss','sass','css'];

      if(!importPath.match(/\.s?(a|c)ss$/)){
        possibleExtensions = [
          inputFile.getExtension(),
          ...possibleExtensions.filter(e => e !== inputFile.getExtension())
          ]
        for (const extension of possibleExtensions){
          possibleFiles.push(`${importPath}.${extension}`);
          possibleFilesIndex.push(`${importPath}/index.${extension}`)
          possibleFilesIndex.push(`${importPath}/_index.${extension}`)
        }
      } else {
        possibleFiles.push(importPath);
      }

      //Try files prefixed with underscore
      for(const possibleFile of possibleFiles) {
        if(!hasUnderscore(possibleFile)) {
          possibleFiles.push(
            path.join(path.dirname(possibleFile), `_${path.basename(possibleFile)}`)
          );
        }
      }

      //Try if one of the possible files exists
      for(const possibleFile of possibleFiles.concat(possibleFilesIndex)) {
        const file = allFiles.get(possibleFile);
        if(file) {
          return path.join(file.getSourceRoot(), file.getPathInPackage());
        }
        if(fileExists(possibleFile)) {
          return possibleFile;
        }
        const possibleFileFullPath = path.join(sourceRoot, possibleFile.replace(/^\{\}\//, ''));
        if(fileExists(possibleFileFullPath)) {
          return possibleFileFullPath;
        }
      }
      //Nothing found...
      return null;
    };

    const findFileUrl = (url, ctx) => {
      // Later if we need to know the parent file
      //const sourcePath = ctx?.containingUrl?.pathname;
      //const parentPath = allFilesByPath.get(sourcePath) || sourcePath;
      //const prev = allFiles.get(allFilesByPath.get(sourcePath));

      const importPath = getRealImportPath(url);
      if(importPath) {
        const convertedImportPath = Plugin.convertToOSPath(importPath);
        return pathToFileURL(convertedImportPath);
      }

      // Try include paths if not found
      for(const includePath of includePaths) {
        const basename = decodeURIComponent(url);
        const extendedUrl = new URL(path.join(includePath, basename));
        const importPath = getRealImportPath(extendedUrl);
        if(importPath) {
          const convertedImportPath = Plugin.convertToOSPath(importPath);
          return pathToFileURL(convertedImportPath);
        }
      }

      return null;
    }

    // Start compile sass (async)
    // https://sass-lang.com/documentation/js-api/interfaces/options/
    const options = {
      sourceMap: true,
      sourceMapIncludeSources: true,
      importers: [{findFileUrl}],

      // if dev mode, use expanded style, otherwise use compressed, or set in config file
      //style: isDev ? 'expanded' : 'compressed',
      style: 'expanded',

      quietDeps: true,
      verbose: false,
    }

    if(userOptions?.hasOwnProperty) {
      if(userOptions.hasOwnProperty('loadPaths')) {
        //options.loadPaths = userOptions.loadPaths;
      }
      if(userOptions.hasOwnProperty('silenceDeprecations')) {
        //options.silenceDeprecations = userOptions.silenceDeprecations;
      }
      if(userOptions.hasOwnProperty('quietDeps')) {
        options.quietDeps = userOptions.quietDeps;
      }
      if(userOptions.hasOwnProperty('verbose')) {
        options.verbose = userOptions.verbose;
      }
    }

    // Compile
    let output;
    try {
      let filePath = inputFile.getPathInPackage();
      if(inputFile.getPackageName()) {
        filePath = `${inputFile.getSourceRoot()}/${filePath}`;
      }
      const convertedFilePath = Plugin.convertToOSPath(filePath);
      output = await sass.compileAsync(convertedFilePath, options);
    } catch(e) {
      inputFile.error({
        message: `Scss compiler ${e}\n`,
        sourcePath: inputFile.getDisplayPath()
      });
      if(debugMode) {
        console.error(e);
      }
      return null;
    }

    // Get all referenced files for watcher
    const referencedImportPaths = [];
    if(output?.loadedUrls && output.loadedUrls.length > 0) {
      const skippedImportPaths = [];
      for(const loadedUrl of output.loadedUrls) {
        const filePath = convertToStandardPath(loadedUrl.pathname);
        const convertedFilePath = Plugin.convertToOSPath(filePath);
        const referencedImportPath = allFilesByPath.get(convertedFilePath);
        if(referencedImportPath) {
          referencedImportPaths.push(referencedImportPath);
        } else {
          skippedImportPaths.push(loadedUrl.pathname);
        }
      }
      if(skippedImportPaths.length) {
        console.warn(`[ SASS Compiler ] The following external files were loaded but are not tracked by the project:\n - ${skippedImportPaths.join('\n - ')}`);
      }
    }

    // Fix source map
    const sourceMap = output?.sourceMap || null;
    if(sourceMap) {
      const sourceRoot = inputFile.getSourceRoot();
      const entryFileDisplayPath = inputFile.getDisplayPath();

      sourceMap.sources = sourceMap.sources.map(src => {
        let url;
        try {
          url = new URL(src);
        } catch(e) {
          return src;
        }
        switch(url?.protocol) {
          case 'file:':
            const filePath = convertToStandardPath(url.pathname);
            let srcPath = filePath.replace(new RegExp(`^${sourceRoot}/?`), '');
            srcPath = convertToStandardPath(srcPath);
            const fullPath = `${entryFileDisplayPath}/${srcPath}`
            try {
              return path.normalize(fullPath);
            } catch(e) {
              return fullPath;
            }
          default:
            return src;
        }
      });
    }

    return {
      compileResult: {
        css: output.css?.toString('utf-8'),
        sourceMap,
      },
      referencedImportPaths,
    };
  }

  addCompileResult(inputFile, compileResult) {
    inputFile.addStylesheet({
      data: compileResult.css,
      path: `${inputFile.getPathInPackage()}.css`,
      sourceMap: compileResult.sourceMap
    })
  }
}

// --------------------------------------------------------------------------------------------

function _getConfig(...configFileNames) {
  const appdir = process.env.PWD || process.cwd();

  for(const configFileName of configFileNames) {
    const configPath = path.join(appdir, configFileName);
    if(fileExists(configPath)) {
      try {
        return JSON.parse(fs.readFileSync(configPath, {encoding: 'utf8'}));
      } catch(e) {
        console.warn(`[ SASS Compiler ] Custom config ignored (${configFileName}):\n - ${e}`);
        if(debugMode) {
          console.error(e);
        }
        break;
      }
    }
  }
}

function hasUnderscore(file) {
  return path.basename(file).startsWith('_');
}

function fileExists(file) {
  if(fs.statSync){
    try {
      fs.statSync(file);
    } catch(e) {
      return false;
    }
    return true;
  } else if(fs.existsSync) {
    return fs.existsSync(file);
  }
}

function convertToStandardPath(osPath) {
  if(process.platform === "win32") {
    return osPath.split(':').join('');
  }
  return osPath;
}
