module.exports = {
  hooks: {
    readPackage(pkg) {
      if (pkg.dependencies && pkg.dependencies.esbuild) {
        pkg.dependencies.esbuild = '0.28.1';
      }
      if (pkg.devDependencies && pkg.devDependencies.esbuild) {
        pkg.devDependencies.esbuild = '0.28.1';
      }
      return pkg;
    }
  }
};
