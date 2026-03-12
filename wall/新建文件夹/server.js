const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const app = express();

// 设置中间件
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 确保数据目录存在
const dataDir = path.join(__dirname, 'data');
const uploadsDir = path.join(dataDir, 'uploads');
if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
}
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// 配置文件上传
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadsDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ 
    storage: storage,
    limits: {
        fileSize: 20 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        cb(null, true);
    }
});

// 数据文件路径
const dataFile = path.join(dataDir, 'posts.json');
const announcementsFile = path.join(dataDir, 'announcements.json');

// 初始化数据文件
function initializeDataFile() {
    if (!fs.existsSync(dataFile)) {
        fs.writeFileSync(dataFile, JSON.stringify([]));
    }
    if (!fs.existsSync(announcementsFile)) {
        fs.writeFileSync(announcementsFile, JSON.stringify([]));
    }
}

// 读取数据
function readData() {
    try {
        const data = fs.readFileSync(dataFile, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('读取数据失败:', err);
        return [];
    }
}

function readAnnouncements() {
    try {
        const data = fs.readFileSync(announcementsFile, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error('读取公告失败:', err);
        return [];
    }
}

// 写入数据
function writeData(data) {
    try {
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('写入数据失败:', err);
    }
}

function writeAnnouncements(data) {
    try {
        fs.writeFileSync(announcementsFile, JSON.stringify(data, null, 2));
    } catch (err) {
        console.error('写入公告失败:', err);
    }
}

initializeDataFile();

// 获取所有帖子
app.get('/api/posts', (req, res) => {
    try {
        const posts = readData();
        const announcements = readAnnouncements();
        const allContent = [...announcements, ...posts].sort((a, b) => new Date(b.time) - new Date(a.time));
        res.json(allContent);
    } catch (err) {
        console.error('获取数据失败:', err);
        res.status(500).json({ error: '服务器错误' });
    }
});

// 提交新帖子（带文件上传）
app.post('/api/posts', upload.single('file'), (req, res) => {
    try {
        const { sender, content } = req.body;
        const posts = readData();
        
        let attachmentInfo = null;
        if (req.file) {
            attachmentInfo = {
                filename: req.file.filename,
                originalname: req.file.originalname,
                size: req.file.size,
                mimetype: req.file.mimetype,
                path: `/api/uploads/${req.file.filename}`,
                preview: getPreviewType(req.file.mimetype)
            };
        }
        
        // 防止普通用户使用系统名称
        let actualSender = sender || '匿名用户';
        if (actualSender.toLowerCase() === '系统' || actualSender.toLowerCase() === 'admin') {
            actualSender = '匿名用户';
        }
        
        const newPost = {
            id: Date.now(),
            sender: actualSender,
            content: content,
            attachment: attachmentInfo,
            time: new Date().toLocaleString(),
            approved: false,
            type: 'post'
        };
        
        posts.push(newPost);
        writeData(posts);
        
        res.json({ success: true, post: newPost });
    } catch (err) {
        console.error('提交数据失败:', err);
        res.status(500).json({ error: '服务器错误' });
    }
});

// 判断文件类型以决定如何预览
function getPreviewType(mimetype) {
    if (mimetype.startsWith('image/')) {
        return 'image';
    } else if (mimetype.startsWith('video/')) {
        return 'video';
    } else if (mimetype.startsWith('audio/')) {
        return 'audio';
    } else {
        return 'file';
    }
}

// 提供上传文件的访问接口
app.get('/api/uploads/:filename', (req, res) => {
    const filename = req.params.filename;
    const filePath = path.join(uploadsDir, filename);
    
    if (fs.existsSync(filePath)) {
        res.sendFile(filePath);
    } else {
        res.status(404).json({ error: '文件不存在' });
    }
});

// 审核帖子
app.put('/api/posts/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { action } = req.body;
        
        if (!action) {
            return res.status(400).json({ error: '缺少action参数' });
        }
        
        const posts = readData();
        
        const postIndex = posts.findIndex(post => post.id == id);
        if (postIndex !== -1) {
            if (action === 'approve') {
                posts[postIndex].approved = true;
            } else if (action === 'reject') {
                if (posts[postIndex].attachment) {
                    const filePath = path.join(uploadsDir, posts[postIndex].attachment.filename);
                    if (fs.existsSync(filePath)) {
                        fs.unlinkSync(filePath);
                    }
                }
                posts.splice(postIndex, 1);
            }
            
            writeData(posts);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: '帖子不存在' });
        }
    } catch (err) {
        console.error('审核数据失败:', err);
        res.status(500).json({ error: '服务器错误' });
    }
});

// 管理员API端点
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin' && password === '123456') {
        res.json({ success: true });
    } else {
        res.status(401).json({ error: '用户名或密码错误' });
    }
});

// 获取待审核内容
app.get('/api/pending', (req, res) => {
    try {
        const posts = readData();
        const pendingPosts = posts.filter(post => !post.approved);
        res.json(pendingPosts);
    } catch (err) {
        console.error('获取待审核内容失败:', err);
        res.status(500).json({ error: '服务器错误' });
    }
});

// 添加系统公告（带文件上传）
app.post('/api/announcements', upload.single('file'), (req, res) => {
    try {
        const { title, content } = req.body;
        const announcements = readAnnouncements();
        
        let attachmentInfo = null;
        if (req.file) {
            attachmentInfo = {
                filename: req.file.filename,
                originalname: req.file.originalname,
                size: req.file.size,
                mimetype: req.file.mimetype,
                path: `/api/uploads/${req.file.filename}`,
                preview: getPreviewType(req.file.mimetype)
            };
        }
        
        const newAnnouncement = {
            id: Date.now(),
            title: title || '公告',
            content: content,
            attachment: attachmentInfo,
            time: new Date().toLocaleString(),
            type: 'announcement'
        };
        
        announcements.push(newAnnouncement);
        writeAnnouncements(announcements);
        
        res.json({ success: true, announcement: newAnnouncement });
    } catch (err) {
        console.error('添加公告失败:', err);
        res.status(500).json({ error: '服务器错误' });
    }
});

// 删除公告
app.delete('/api/announcements/:id', (req, res) => {
    try {
        const { id } = req.params;
        const announcements = readAnnouncements();
        
        const index = announcements.findIndex(announcement => announcement.id == id);
        if (index !== -1) {
            // 删除附件文件
            if (announcements[index].attachment) {
                const filePath = path.join(uploadsDir, announcements[index].attachment.filename);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
            announcements.splice(index, 1);
            writeAnnouncements(announcements);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: '公告不存在' });
        }
    } catch (err) {
        console.error('删除公告失败:', err);
        res.status(500).json({ error: '服务器错误' });
    }
});

// 管理员发布系统帖子（带文件上传）
app.post('/api/system-posts', upload.single('file'), (req, res) => {
    try {
        const { content } = req.body;
        const posts = readData();
        
        let attachmentInfo = null;
        if (req.file) {
            attachmentInfo = {
                filename: req.file.filename,
                originalname: req.file.originalname,
                size: req.file.size,
                mimetype: req.file.mimetype,
                path: `/api/uploads/${req.file.filename}`,
                preview: getPreviewType(req.file.mimetype)
            };
        }
        
        const newSystemPost = {
            id: Date.now(),
            sender: '系统',
            content: content,
            attachment: attachmentInfo,
            time: new Date().toLocaleString(),
            approved: true,
            type: 'system-post'
        };
        
        posts.push(newSystemPost);
        writeData(posts);
        
        res.json({ success: true, post: newSystemPost });
    } catch (err) {
        console.error('发布系统帖子失败:', err);
        res.status(500).json({ error: '服务器错误' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`服务器运行在 http://localhost:${PORT}`);
    console.log(`数据将保存在 ./data/posts.json 文件中`);
    console.log(`公告将保存在 ./data/announcements.json 文件中`);
    console.log(`上传文件将保存在 ./data/uploads/ 目录中`);
});