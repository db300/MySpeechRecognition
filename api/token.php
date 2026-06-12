<?php
/**
 * 阿里云 NLS Token 获取服务（PHP 版本）
 * - 通过服务端调用阿里云 POP API 获取 Access Token
 * - AccessKey 凭证仅在服务端使用，不暴露给前端
 * - 使用 HMAC-SHA1 签名，无需额外 SDK 依赖
 * - 与 Node.js 版本 (server.js /api/token) 返回格式完全一致
 */

header('Content-Type: application/json; charset=utf-8');

// ---- 读取 .env 配置 ----
$envFile = __DIR__ . '/../.env';
$env = [];
if (file_exists($envFile)) {
    $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    foreach ($lines as $line) {
        $line = trim($line);
        if ($line === '' || $line[0] === '#') continue;
        $eqPos = strpos($line, '=');
        if ($eqPos === false) continue;
        $key = trim(substr($line, 0, $eqPos));
        $value = trim(substr($line, $eqPos + 1));
        $env[$key] = $value;
    }
}

$accessKeyId = $env['ALIYUN_ACCESS_KEY_ID'] ?? '';
$accessKeySecret = $env['ALIYUN_ACCESS_KEY_SECRET'] ?? '';

if (!$accessKeyId || !$accessKeySecret) {
    echo json_encode([
        'success' => false,
        'message' => '服务端未配置阿里云 AccessKey 凭证，请在 .env 文件中设置 ALIYUN_ACCESS_KEY_ID 和 ALIYUN_ACCESS_KEY_SECRET',
    ]);
    exit;
}

// ---- 构造阿里云 POP API 请求参数 ----
$params = [
    'Action'            => 'CreateToken',
    'Format'            => 'JSON',
    'Version'           => '2019-02-28',
    'AccessKeyId'       => $accessKeyId,
    'SignatureMethod'   => 'HMAC-SHA1',
    'SignatureVersion'  => '1.0',
    'SignatureNonce'    => sprintf('%04x%04x%04x%04x%04x%04x%04x%04x',
        mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff),
        mt_rand(0, 0x0fff) | 0x4000, mt_rand(0, 0x3fff) | 0x8000,
        mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)),
    'Timestamp'         => gmdate('Y-m-d\TH:i:s\Z'),
    'RegionId'          => 'cn-shanghai',
];

// ---- POP API 签名算法 ----
function percentEncode($str) {
    $res = urlencode($str);
    $res = str_replace('+', '%20', $res);
    $res = str_replace('*', '%2A', $res);
    $res = str_replace('%7E', '~', $res);
    return $res;
}

// 按参数名排序
ksort($params);

// 拼接待签名字符串
$canonicalizedQueryString = '';
foreach ($params as $key => $value) {
    $canonicalizedQueryString .= '&' . percentEncode($key) . '=' . percentEncode($value);
}
$canonicalizedQueryString = substr($canonicalizedQueryString, 1);

// 构造用于签名的字符串: GET&%2F& + percentEncode(规范化查询字符串)
$stringToSign = 'GET&%2F&' . percentEncode($canonicalizedQueryString);

// HMAC-SHA1 签名
$signature = base64_encode(hash_hmac('sha1', $stringToSign, $accessKeySecret . '&', true));

// 将签名加入参数
$params['Signature'] = $signature;

// ---- 发送 HTTP 请求 ----
$url = 'https://nls-meta.cn-shanghai.aliyuncs.com/?' . http_build_query($params, '', '&', PHP_QUERY_RFC3986);

$ch = curl_init();
curl_setopt_array($ch, [
    CURLOPT_URL            => $url,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_SSL_VERIFYPEER => false,
    CURLOPT_TIMEOUT        => 10,
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
]);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError) {
    echo json_encode([
        'success' => false,
        'message' => '获取 Token 失败：' . $curlError,
    ]);
    exit;
}

// ---- 解析响应 ----
$result = json_decode($response, true);

if (json_last_error() !== JSON_ERROR_NONE) {
    echo json_encode([
        'success' => false,
        'message' => '获取 Token 失败：服务端返回无效响应',
    ]);
    exit;
}

// 检查 API 错误码
if (isset($result['ErrCode'])) {
    $message = '获取 Token 失败：' . ($result['ErrMsg'] ?? '未知错误') . ' (' . $result['ErrCode'] . ')';
    if ($result['ErrCode'] == 40020503) {
        $message = '当前 AccessKey 无 NLS 服务权限，请在阿里云 RAM 控制台授予 AliyunNLSFullAccess 权限';
    }
    echo json_encode([
        'success' => false,
        'message' => $message,
    ]);
    exit;
}

// 返回 Token
if (isset($result['Token'])) {
    echo json_encode([
        'success'   => true,
        'token'     => $result['Token']['Id'],
        'expireTime' => $result['Token']['ExpireTime'],
        'userId'    => $result['UserId'] ?? '',
    ]);
} else {
    echo json_encode([
        'success' => false,
        'message' => '获取 Token 失败：服务端返回无效响应',
    ]);
}
