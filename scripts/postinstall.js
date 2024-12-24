const fs = require('fs-extra');
const path = require('path');

async function copyDependencies() {
    const appModulesDir = path.join(__dirname, '..', 'app_modules');
    const nodeModulesDir = path.join(__dirname, '..', 'node_modules');

    // 清理并创建 app_modules 目录
    await fs.remove(appModulesDir);
    await fs.ensureDir(appModulesDir);

    // 读取 package.json
    const packageJson = require('../package.json');
    const dependencies = packageJson.dependencies || {};

    // 已复制的模块集合，避免重复复制
    const copiedModules = new Set();

    // 递归复制依赖及其子依赖
    async function copyModuleWithDependencies(moduleName, isRoot = false) {
        if (copiedModules.has(moduleName)) {
            return;
        }

        const src = path.join(nodeModulesDir, moduleName);
        const dest = path.join(appModulesDir, moduleName);

        if (await fs.pathExists(src)) {
            try {
                // 复制模块
                await fs.copy(src, dest);
                copiedModules.add(moduleName);
                console.log(`Copied ${moduleName} to app_modules`);

                // 读取模块的 package.json
                const modulePkgPath = path.join(src, 'package.json');
                if (await fs.pathExists(modulePkgPath)) {
                    const modulePkg = require(modulePkgPath);
                    const moduleDeps = {
                        ...modulePkg.dependencies,
                        ...modulePkg.peerDependencies
                    };

                    // 递归复制子依赖
                    for (const dep of Object.keys(moduleDeps || {})) {
                        await copyModuleWithDependencies(dep, false);
                    }
                }
            } catch (err) {
                console.error(`Error copying ${moduleName}:`, err);
                if (isRoot) {
                    throw err; // 只有根依赖的错误才抛出
                }
            }
        } else {
            console.warn(`Module not found: ${moduleName}`);
            if (isRoot) {
                throw new Error(`Root dependency not found: ${moduleName}`);
            }
        }
    }

    // 复制每个主依赖及其子依赖
    for (const dep of Object.keys(dependencies)) {
        await copyModuleWithDependencies(dep, true);
    }

    console.log('All dependencies copied successfully');
}

copyDependencies().catch(error => {
    console.error('Failed to copy dependencies:', error);
    process.exit(1);
}); 