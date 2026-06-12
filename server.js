/**
 * 阿里云 NLS Token 获取服务
 * - 通过服务端调用阿里云 SDK 获取 Access Token
 * - AccessKey 凭证仅在服务端使用，不暴露给前端
 * - 同时提供静态文件服务
 */

require('dotenv').config();
const express = require('express');
const path = require('path');
const Core = require('@alicloud/pop-core');

const app = express();
const PORT = process.env.PORT || 3000;

// ---- 静态文件服务 ----
app.use(express.static(path.join(__dirname)));

// ---- API: 获取阿里云 NLS Token ----
app.get('/api/token', async (req, res) => {
  const accessKeyId = process.env.ALIYUN_ACCESS_KEY_ID;
  const accessKeySecret = process.env.ALIYUN_ACCESS_KEY_SECRET;

  if (!accessKeyId || !accessKeySecret) {
    return res.status(500).json({
      success: false,
      message: '服务端未配置阿里云 AccessKey 凭证，请在 .env 文件中设置 ALIYUN_ACCESS_KEY_ID 和 ALIYUN_ACCESS_KEY_SECRET',
    });
  }

  try {
    const client = new Core({
      accessKeyId,
      accessKeySecret,
      endpoint: 'https://nls-meta.cn-shanghai.aliyuncs.com',
      apiVersion: '2019-02-28',
    });

    const result = await client.request('CreateToken', {
      RegionId: 'cn-shanghai',
    }, { method: 'POST' });

    if (result.ErrCode) {
      // API 返回了错误码
      console.error('阿里云API错误:', result.ErrCode, result.ErrMsg);
      let message = `获取 Token 失败：${result.ErrMsg || '未知错误'} (${result.ErrCode})`;
      if (result.ErrCode === 40020503) {
        message = '当前 AccessKey 无 NLS 服务权限，请在阿里云 RAM 控制台授予 AliyunNLSFullAccess 权限';
      }
      return res.status(500).json({
        success: false,
        message,
      });
    }

    if (result.Token) {
      res.json({
        success: true,
        token: result.Token.Id,
        expireTime: result.Token.ExpireTime,
        userId: result.UserId || '',
      });
    } else {
      res.status(500).json({
        success: false,
        message: '获取 Token 失败：服务端返回无效响应',
      });
    }
  } catch (err) {
    console.error('获取阿里云 Token 失败:', err.message || err);
    res.status(500).json({
      success: false,
      message: '获取 Token 失败，请检查 AccessKey 凭证是否正确',
    });
  }
});

// ---- 启动服务 ----
app.listen(PORT, () => {
  console.log(`语音识别服务已启动: http://localhost:${PORT}`);
  console.log(`Token API: http://localhost:${PORT}/api/token`);
});
