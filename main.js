const { app, BrowserWindow } = require('electron');
const path = require('path');
const express = require('express');
const net = require('net');  // 添加 net 模块用于检测端口

// 设置模块搜索路径
const modulePaths = [
    path.join(app.getAppPath(), 'app_modules'),
    path.join(app.getAppPath(), 'node_modules')
];

process.env.NODE_PATH = modulePaths.join(path.delimiter);
require('module').Module._initPaths();

// 添加错误处理
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    if (error.code === 'MODULE_NOT_FOUND') {
        console.error('Module search paths:', process.env.NODE_PATH);
    }
    const { dialog } = require('electron');
    dialog.showErrorBox('错误', `发生错误：${error.message}\n\n${error.stack}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    const { dialog } = require('electron');
    dialog.showErrorBox('未处理的Promise错误', `发生错误：${reason}`);
});

// 检查端口是否可用
function isPortAvailable(port) {
    return new Promise((resolve) => {
        const server = net.createServer();
        
        server.once('error', (err) => {
            if (err.code === 'EADDRINUSE') {
                resolve(false);
            }
        });
        
        server.once('listening', () => {
            server.close();
            resolve(true);
        });
        
        server.listen(port);
    });
}

// 找到可用的端口
async function findAvailablePort(startPort) {
    let port = startPort;
    while (!(await isPortAvailable(port))) {
        console.log(`端口 ${port} 已被占用，尝试下一个端口...`);
        port++;
        if (port > startPort + 100) {  // 最多尝试100个端口
            throw new Error('无法找到可用的端口');
        }
    }
    return port;
}

let mainWindow;
let expressApp;
let httpServer;

async function createWindow() {
    console.log('创建窗口...');
    try {
        // 确定图标路径
        let iconPath;
        if (process.env.NODE_ENV === 'development') {
            iconPath = path.join(__dirname, 'build', 'icon.ico');
        } else {
            iconPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'icon.ico');
        }

        console.log('使用图标路径:', iconPath);

        mainWindow = new BrowserWindow({
            width: 1200,
            height: 900,
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            },
            title: 'HTML转PDF工具',
            show: false,
            autoHideMenuBar: true,
            frame: true,
            icon: iconPath  // 设置窗口图标
        });

        console.log('加载Express...');
        expressApp = express();
        
        // 添加更多日志
        console.log('应用根目录:', app.getAppPath());
        console.log('资源目录:', process.resourcesPath);
        console.log('当前工作目录:', process.cwd());
        
        // 导入路由和中间件
        require('./server')(expressApp);

        // 查找可用端口并启动服务器
        const basePort = 3000;
        const port = await findAvailablePort(basePort);
        console.log(`使用端口: ${port}`);

        // 启动 Express 服务器
        httpServer = expressApp.listen(port, () => {
            console.log(`Server running at http://localhost:${port}`);
            mainWindow.loadURL(`http://localhost:${port}`).then(() => {
                console.log('页面加载完成');
                mainWindow.show();
            }).catch(err => {
                console.error('页面加载失败:', err);
                console.error('错误详情:', {
                    code: err.code,
                    message: err.message,
                    stack: err.stack
                });
                const { dialog } = require('electron');
                dialog.showErrorBox('加载失败', `页面加载失败：${err.message}\n\n详细信息：${err.stack}`);
            });
        });

        mainWindow.on('closed', function () {
            mainWindow = null;
            if (httpServer) {
                httpServer.close();
            }
        });

        mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
            console.error('页面加载失败:', errorCode, errorDescription);
            const { dialog } = require('electron');
            dialog.showErrorBox('加载失败', `页面加载失败：${errorDescription}`);
        });

    } catch (error) {
        console.error('创建窗口时发生错误:', error);
        const { dialog } = require('electron');
        dialog.showErrorBox('启动错误', `程序启动失败：${error.message}\n\n${error.stack}`);
    }
}

app.whenReady().then(() => {
    console.log('应用就绪...');
    createWindow().catch(error => {
        console.error('创建窗口失败:', error);
        const { dialog } = require('electron');
        dialog.showErrorBox('启动失败', `创建窗口失败：${error.message}`);
    });
}).catch(error => {
    console.error('应用启动失败:', error);
    const { dialog } = require('electron');
    dialog.showErrorBox('启动失败', `应用启动失败：${error.message}`);
});

app.on('window-all-closed', function () {
    console.log('所有窗口已关闭');
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', function () {
    console.log('激活应用');
    if (mainWindow === null) {
        createWindow();
    }
});

app.on('before-quit', () => {
    console.log('应用准备退出');
    if (httpServer) {
        httpServer.close();
    }
}); 