const express = require('express');
const multer = require('multer');
const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');
const { app: electronApp } = require('electron');

// 不再创建新的 app，而是接收传入的 app 实例
module.exports = function(app) {
    // 获取应用程序的根目录
    const appRoot = electronApp.getAppPath();
    const isDev = process.env.NODE_ENV === 'development';
    
    // 确定 uploads 目录的位置
    let uploadsDir;
    if (isDev) {
        uploadsDir = path.join(appRoot, 'uploads');
    } else {
        // 在打包后的应用中，使用用户数据目录
        uploadsDir = path.join(electronApp.getPath('userData'), 'uploads');
    }
    
    console.log('使用的 uploads 目录:', uploadsDir);
    
    // 确保上传目录存在
    if (!fs.existsSync(uploadsDir)) {
        try {
            fs.mkdirSync(uploadsDir, { recursive: true });
        } catch (err) {
            console.error('创建上传目录失败:', err);
            throw err;
        }
    }
    
    // 确定 public 目录的位置
    let publicDir;
    if (isDev) {
        publicDir = path.join(appRoot, 'public');
    } else {
        // 在打包后的应用中，资源可能在不同的位置
        const possiblePaths = [
            path.join(appRoot, 'public'),
            path.join(appRoot, '..', 'public'),
            path.join(process.resourcesPath, 'app.asar.unpacked', 'public'),
            path.join(process.resourcesPath, 'public')
        ];

        // 找到第一个存在的路径
        publicDir = possiblePaths.find(dir => fs.existsSync(dir));
        
        if (!publicDir) {
            console.error('找不到 public 目录，尝试过的路径:', possiblePaths);
            throw new Error('找不到 public 目录');
        }
    }
    
    console.log('使用的 public 目录:', publicDir);
    
    // 配置 multer，使用绝对路径
    const storage = multer.diskStorage({
        destination: function (req, file, cb) {
            cb(null, uploadsDir);
        },
        filename: function (req, file, cb) {
            cb(null, Date.now() + path.extname(file.originalname));
        }
    });
    const upload = multer({ storage: storage });

    // 静态文件服务，使用绝对路径
    app.use(express.static(publicDir));
    app.use('/uploads', express.static(uploadsDir));

    // 添�����������根路由处理
    app.get('/', (req, res) => {
        const indexPath = path.join(publicDir, 'index.html');
        if (fs.existsSync(indexPath)) {
            res.sendFile(indexPath);
        } else {
            console.error('index.html not found at:', indexPath);
            res.status(404).send('找不到 index.html 文件');
        }
    });

    // 清理uploads目录中的文件，排除指定的文件
    function cleanUploads(excludeFiles = []) {
        try {
            const files = fs.readdirSync(uploadsDir);
            files.forEach(file => {
                const filePath = path.join(uploadsDir, file);
                if (!excludeFiles.includes(filePath)) {
                    try {
                        if (fs.existsSync(filePath)) {
                            fs.unlinkSync(filePath);
                        }
                    } catch (err) {
                        console.error('删除文件失败:', filePath, err);
                    }
                }
            });
        } catch (err) {
            console.error('读取uploads目录失败:', err);
        }
    }

    // 安全删除文件的辅助函数
    function safeUnlink(filePath) {
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (err) {
            console.error('删除文件失败:', filePath, err);
        }
    }

    // 处理文件上传和转换
    app.post('/convert', upload.fields([
        { name: 'htmlFile', maxCount: 1 },
        { name: 'sealImage', maxCount: 1 }
    ]), async function(req, res) {
        console.log('开始处理转换请求...');
        const htmlFilePath = req.files.htmlFile[0].path;
        let pdfPath = null;
        let sealFilePath = null;
        let browser = null;
        let executablePath = null;

        try {
            console.log('HTML文件路径:', htmlFilePath);
            
            // 在处理新请求前清理之前的文件，但保留当前上传的文件
            const filesToKeep = [htmlFilePath];
            if (req.files.sealImage) {
                sealFilePath = req.files.sealImage[0].path;
                filesToKeep.push(sealFilePath);
                console.log('印章文件路径:', sealFilePath);
            }
            cleanUploads(filesToKeep);

            console.log('读取HTML内容...');
            const htmlContent = fs.readFileSync(htmlFilePath, 'utf-8');
            console.log('HTML内容长度:', htmlContent.length);
            
            // 生成PDF
            console.log('启动Puppeteer...');
            if (isDev) {
                executablePath = process.env.PUPPETEER_EXECUTABLE_PATH || null;
            } else {
                // 在打包后的应用中，尝试多个可能的 Chrome 路径
                const possiblePaths = [
                    path.join(process.resourcesPath, 'app.asar.unpacked', 'chromium', 'win64-116.0.5845.96', 'chrome-win', 'chrome.exe'),
                    path.join(process.resourcesPath, 'app.asar.unpacked', 'chromium', 'chrome-win', 'chrome.exe'),
                    path.join(process.resourcesPath, 'app.asar.unpacked', 'chromium', 'win64-1069273', 'chrome-win', 'chrome.exe'),
                    path.join(process.resourcesPath, 'app.asar.unpacked', 'chromium', 'win64-1108766', 'chrome-win', 'chrome.exe'),
                    // 添加更多可能的路径
                    path.join(process.resourcesPath, 'app.asar.unpacked', 'chromium', 'win64-*', 'chrome-win', 'chrome.exe'),
                    path.join(process.resourcesPath, 'app.asar.unpacked', 'chromium', '*', 'chrome-win', 'chrome.exe')
                ];

                // 查找第一个存在的 Chrome 路径
                for (const pattern of possiblePaths) {
                    if (pattern.includes('*')) {
                        // 如果路径包含通配符，使用 glob 模式查找
                        const glob = require('glob');
                        const matches = glob.sync(pattern);
                        if (matches.length > 0) {
                            executablePath = matches[0];
                            break;
                        }
                    } else if (fs.existsSync(pattern)) {
                        executablePath = pattern;
                        break;
                    }
                }

                if (!executablePath) {
                    // 如果找不到预定义路径，尝试搜索 chromium 目录
                    const chromiumDir = path.join(process.resourcesPath, 'app.asar.unpacked', 'chromium');
                    if (fs.existsSync(chromiumDir)) {
                        console.log('搜索 Chromium 目录...');
                        const findChrome = (dir) => {
                            const files = fs.readdirSync(dir);
                            for (const file of files) {
                                const fullPath = path.join(dir, file);
                                const stat = fs.statSync(fullPath);
                                if (stat.isDirectory()) {
                                    const result = findChrome(fullPath);
                                    if (result) return result;
                                } else if (file.toLowerCase() === 'chrome.exe') {
                                    return fullPath;
                                }
                            }
                            return null;
                        };
                        executablePath = findChrome(chromiumDir);
                    }
                }

                if (!executablePath) {
                    // 如果还是找不到，尝试使用 Puppeteer 内置的 Chrome
                    try {
                        executablePath = require('puppeteer').executablePath();
                        console.log('使用 Puppeteer 内置的 Chrome:', executablePath);
                    } catch (err) {
                        console.error('无法获取 Puppeteer 内置的 Chrome:', err);
                    }
                }

                if (!executablePath) {
                    console.error('Chrome可执行文件未找到，尝试过的路径:', possiblePaths);
                    console.error('Chromium目录内容:');
                    const chromiumDir = path.join(process.resourcesPath, 'app.asar.unpacked', 'chromium');
                    if (fs.existsSync(chromiumDir)) {
                        const listDir = (dir, level = 0) => {
                            const indent = '  '.repeat(level);
                            const files = fs.readdirSync(dir);
                            files.forEach(file => {
                                const fullPath = path.join(dir, file);
                                const stat = fs.statSync(fullPath);
                                console.error(`${indent}${file}${stat.isDirectory() ? '/' : ''}`);
                                if (stat.isDirectory()) {
                                    listDir(fullPath, level + 1);
                                }
                            });
                        };
                        listDir(chromiumDir);
                    } else {
                        console.error('Chromium目录不存在');
                    }
                    throw new Error('找不到Chrome可执行文件');
                }

                console.log('使用Chrome路径:', executablePath);
            }

            browser = await puppeteer.launch({
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu'
                ],
                executablePath: executablePath,
                ignoreDefaultArgs: ['--disable-extensions'],
                product: 'chrome'
            });
            
            console.log('创建新页面...');
            const page = await browser.newPage();
            
            console.log('设置HTML内容...');
            await page.setContent(htmlContent);
            
            const fileName = Date.now() + '.pdf';
            pdfPath = path.join(uploadsDir, fileName);
            console.log('PDF输出路径:', pdfPath);
            
            // 获取HTML内容的尺寸
            console.log('获取页面尺寸...');
            const dimensions = await page.evaluate(() => {
                return {
                    width: document.documentElement.scrollWidth,
                    height: document.documentElement.scrollHeight
                };
            });
            console.log('页面尺寸:', dimensions);
            
            // 根据内容尺寸生成PDF
            console.log('生成PDF...');
            await page.pdf({
                path: pdfPath,
                width: dimensions.width + 'px',
                height: dimensions.height + 'px',
                margin: {
                    top: '20px',
                    right: '20px',
                    bottom: '20px',
                    left: '20px'
                }
            });
            
            console.log('关闭浏览器...');
            await browser.close();
            browser = null;

            // 如果上传了公章，添加公章到PDF
            if (req.files.sealImage && req.body.sealX && req.body.sealY) {
                console.log('开始添加印章...');
                const sealX = parseFloat(req.body.sealX);
                const sealY = parseFloat(req.body.sealY);
                
                try {
                    // 读取原PDF
                    console.log('读取生成的PDF...');
                    const pdfBytes = fs.readFileSync(pdfPath);
                    const pdfDoc = await PDFDocument.load(pdfBytes);
                    
                    // 读取印章图片
                    console.log('读取印章图片...');
                    const sealBytes = fs.readFileSync(sealFilePath);

                    // 根据图片类型选择嵌入方法
                    let sealImage;
                    const imageType = req.files.sealImage[0].mimetype;
                    console.log('印章图片类型:', imageType);
                    
                    if (imageType.includes('png')) {
                        sealImage = await pdfDoc.embedPng(sealBytes);
                    } else if (imageType.includes('jpg') || imageType.includes('jpeg')) {
                        sealImage = await pdfDoc.embedJpg(sealBytes);
                    } else {
                        throw new Error('不支持的图片格式，请使用PNG或JPG/JPEG格式');
                    }
                    
                    // 获取所有页面并添加公章
                    const pages = pdfDoc.getPages();
                    console.log('PDF页数:', pages.length);
                    
                    pages.forEach((page, index) => {
                        console.log(`处理第${index + 1}页...`);
                        const { width, height } = page.getSize();
                        const sealDims = sealImage.size();
                        
                        // 确保印章在页面范围内
                        const finalX = Math.max(0, Math.min(sealX, width - sealDims.width));
                        const finalY = Math.max(0, Math.min(sealY, height - sealDims.height));
                        
                        page.drawImage(sealImage, {
                            x: finalX,
                            y: finalY,
                            width: req.body.sealWidth ? parseInt(req.body.sealWidth) : sealDims.width,
                            height: req.body.sealHeight ? parseInt(req.body.sealHeight) : sealDims.height,
                            opacity: 0.8
                        });
                    });

                    // 保存修改后的PDF
                    console.log('保存添加印章后的PDF...');
                    const modifiedPdfBytes = await pdfDoc.save();
                    fs.writeFileSync(pdfPath, modifiedPdfBytes);
                    
                    // 清理印章临时文件
                    console.log('清理印章临时文件...');
                    safeUnlink(sealFilePath);
                } catch (error) {
                    console.error('添加公章错误:', error);
                    throw new Error('添加公章失败: ' + error.message);
                }
            }

            // 返回预览链接和PDF尺寸信息
            console.log('准备返回结果...');
            const pdfDoc = await PDFDocument.load(fs.readFileSync(pdfPath));
            const firstPage = pdfDoc.getPages()[0];
            const { width, height } = firstPage.getSize();

            res.json({
                success: true,
                previewUrl: '/uploads/' + path.basename(fileName),
                fileName: 'converted.pdf',
                pdfSize: {
                    width: Math.round(width),
                    height: Math.round(height)
                }
            });

            // 清理HTML文件
            console.log('清���HTML文件...');
            safeUnlink(htmlFilePath);

        } catch (error) {
            console.error('转换过程中出现错误:', error);
            console.error('错误堆栈:', error.stack);
            console.error('Chrome路径:', executablePath);
            console.error('是否为开发环境:', isDev);
            console.error('资源路径:', process.resourcesPath);
            
            // 检查 Chrome 目录的内容
            try {
                const chromiumDir = path.join(process.resourcesPath, 'app.asar.unpacked', 'chromium');
                if (fs.existsSync(chromiumDir)) {
                    const listDir = (dir, level = 0) => {
                        const indent = '  '.repeat(level);
                        const files = fs.readdirSync(dir);
                        files.forEach(file => {
                            const fullPath = path.join(dir, file);
                            const stat = fs.statSync(fullPath);
                            console.error(`${indent}${file}${stat.isDirectory() ? '/' : ''}`);
                            if (stat.isDirectory()) {
                                listDir(fullPath, level + 1);
                            }
                        });
                    };
                    listDir(chromiumDir);
                } else {
                    console.error('Chromium目录不存在:', chromiumDir);
                }
            } catch (err) {
                console.error('读取Chromium目录失败:', err);
            }
            
            res.status(500).json({ 
                error: '转换过程中出现错误: ' + error.message,
                stack: error.stack,
                details: {
                    chromePath: executablePath,
                    isDev: isDev,
                    resourcesPath: process.resourcesPath,
                    error: error.toString()
                }
            });

            // 清理文件
            if (browser) {
                try {
                    await browser.close();
                } catch (err) {
                    console.error('关闭浏览器失败:', err);
                }
            }
            safeUnlink(htmlFilePath);
            if (sealFilePath) {
                safeUnlink(sealFilePath);
            }
            if (pdfPath) {
                safeUnlink(pdfPath);
            }
        }
    });

    // 启动时清理uploads目录
    cleanUploads();
}; 