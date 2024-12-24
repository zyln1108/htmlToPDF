const fs = require('fs');
const path = require('path');
const https = require('https');

const files = [
    {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.min.js',
        dest: 'public/js/pdf.min.js'
    },
    {
        url: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.11.338/pdf.worker.min.js',
        dest: 'public/js/pdf.worker.min.js'
    }
];

// 确保目录存在
const jsDir = path.join(__dirname, '..', 'public', 'js');
if (!fs.existsSync(jsDir)) {
    fs.mkdirSync(jsDir, { recursive: true });
}

// 下载文件
files.forEach(file => {
    const dest = path.join(__dirname, '..', file.dest);
    console.log(`Downloading ${file.url} to ${dest}`);
    
    https.get(file.url, (response) => {
        const fileStream = fs.createWriteStream(dest);
        response.pipe(fileStream);
        
        fileStream.on('finish', () => {
            fileStream.close();
            console.log(`Downloaded ${file.url}`);
        });
    }).on('error', (err) => {
        console.error(`Error downloading ${file.url}:`, err);
    });
}); 