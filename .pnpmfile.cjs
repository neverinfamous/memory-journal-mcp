module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.dependencies && pkg.dependencies.esbuild) {
        pkg.dependencies.esbuild = '0.28.2';
      }
      if (pkg.devDependencies && pkg.devDependencies.esbuild) {
        pkg.devDependencies.esbuild = '0.28.2';
      }
      return pkg;
    }
  }
};
